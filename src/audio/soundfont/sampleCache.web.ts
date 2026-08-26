/**
 * Fetch + decode + keep. Web only, because `decodeAudioData` is; the resolver next door is
 * pure so that everything except this file can be tested without a browser.
 *
 * Two caches, for two different costs. Manifests are small JSON and cached forever. Decoded
 * `AudioBuffer`s are large, so they are held per (program, file) and evicted least-recently-
 * used. Both are keyed by in-flight promise as well as by value, so eight tracks that all
 * want the grand piano issue one request between them rather than eight.
 *
 * Nothing here ever rejects. A null return is the signal to fall back to `voiceForProgram`,
 * and that fallback is silent by design — the app has always made sound, and a banner saying
 * it is degraded turns a working experience into a broken-looking one.
 */

import type { DrumKitManifest, DrumZone, InstrumentManifest } from './types';

/** The single place the version pinned in `docs/plan/soundfont-source.md` appears. The
 *  directory name carries it so a deploy can never pair new manifests with cached old
 *  samples. */
export const SOUNDFONT_DIR = 'musescore-general-0.2.0';
const BASE = `/soundfonts/${SOUNDFONT_DIR}`;

/** Out of the 0–127 range on purpose, so a drum sample can never collide with a melodic one
 *  in the buffer cache. Mirrors GM's own convention of putting the kit in bank 128. */
export const DRUM_PROGRAM = 128;

/** Decoded audio is the expensive thing to hold. 64 buffers is roughly four instruments'
 *  worth at the zone density this phase ships. */
const MAX_BUFFERS = 64;

/**
 * Decoding-only context, deliberately not the playing one: `playNotes` builds a fresh
 * `AudioContext` on every call (`Playback.web.ts:58`) and closes it in `stopPlayback`, so a
 * buffer decoded against the playing context would die with it. An `AudioBuffer` is usable
 * from any context; the caveat is that `decodeAudioData` resamples to the *decoding*
 * context's rate, and both contexts here are created with no options and so both run at the
 * device rate. If that ever stops being true, pitch goes wrong by the ratio of the two rates
 * and this comment is where to look.
 */
let decodeCtx: AudioContext | null = null;
function decodeContext(): AudioContext {
  if (!decodeCtx) decodeCtx = new AudioContext();
  return decodeCtx;
}

const manifests = new Map<number, InstrumentManifest | null>();
const manifestsInFlight = new Map<number, Promise<InstrumentManifest | null>>();
const buffers = new Map<string, AudioBuffer>();
const buffersInFlight = new Map<string, Promise<AudioBuffer | null>>();

let drumKit: DrumKitManifest | null | undefined;
let drumKitInFlight: Promise<DrumKitManifest | null> | null = null;
let catalogDirs: Map<number, string> | null = null;

async function instrumentDir(program: number): Promise<string | null> {
  if (!catalogDirs) {
    try {
      const response = await fetch(`${BASE}/catalog.json`);
      if (!response.ok) return null;
      const catalog = await response.json();
      catalogDirs = new Map<number, string>(
        catalog.instruments.map((e: { program: number; dir: string }) => [e.program, e.dir]),
      );
    } catch {
      return null;
    }
  }
  return catalogDirs.get(program) ?? null;
}

export async function loadInstrument(program: number): Promise<InstrumentManifest | null> {
  if (manifests.has(program)) return manifests.get(program)!;
  const existing = manifestsInFlight.get(program);
  if (existing) return existing;

  const request = (async () => {
    try {
      const dir = await instrumentDir(program);
      if (!dir) return null;
      const response = await fetch(`${BASE}/${dir}/manifest.json`);
      if (!response.ok) return null;
      return (await response.json()) as InstrumentManifest;
    } catch {
      return null;
    }
  })();

  manifestsInFlight.set(program, request);
  const manifest = await request;
  manifestsInFlight.delete(program);
  manifests.set(program, manifest);
  return manifest;
}

export async function loadDrumKit(): Promise<DrumKitManifest | null> {
  if (drumKit !== undefined) return drumKit;
  if (drumKitInFlight) return drumKitInFlight;

  drumKitInFlight = (async () => {
    try {
      const response = await fetch(`${BASE}/drums/manifest.json`);
      if (!response.ok) return null;
      return (await response.json()) as DrumKitManifest;
    } catch {
      return null;
    }
  })();

  drumKit = await drumKitInFlight;
  drumKitInFlight = null;
  return drumKit;
}

function touch(key: string, buffer: AudioBuffer): void {
  // Re-insertion moves the key to the end of Map iteration order, which is what makes the
  // first key the least recently used one.
  buffers.delete(key);
  buffers.set(key, buffer);
  while (buffers.size > MAX_BUFFERS) {
    const oldest = buffers.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    buffers.delete(oldest);
  }
}

/** Keyed by file rather than by zone, so the two halves of a stereo pair are ordinary cache
 *  entries instead of a special case threaded through every caller. */
export async function sampleBufferFor(program: number, file: string): Promise<AudioBuffer | null> {
  const key = `${program}/${file}`;
  const cached = buffers.get(key);
  if (cached) { touch(key, cached); return cached; }
  const existing = buffersInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const dir = program === DRUM_PROGRAM ? 'drums' : await instrumentDir(program);
      if (!dir) return null;
      const response = await fetch(`${BASE}/${dir}/${file}`);
      if (!response.ok) return null;
      const buffer = await decodeContext().decodeAudioData(await response.arrayBuffer());
      touch(key, buffer);
      return buffer;
    } catch {
      return null;
    }
  })();

  buffersInFlight.set(key, request);
  const buffer = await request;
  buffersInFlight.delete(key);
  return buffer;
}

/** Warm everything a set of programs can need, so the scheduler afterwards is synchronous.
 *  Never rejects: a program that fails to load simply plays as an oscillator. */
export async function ensureProgramsLoaded(programs: number[], includeDrums: boolean): Promise<void> {
  await Promise.all(programs.map(async (program) => {
    const manifest = await loadInstrument(program);
    if (!manifest) return;
    await Promise.all(manifest.zones.flatMap((zone) => [
      sampleBufferFor(program, zone.file),
      ...(zone.fileRight ? [sampleBufferFor(program, zone.fileRight)] : []),
    ]));
  }));

  if (includeDrums) {
    const kit = await loadDrumKit();
    if (!kit) return;
    await Promise.all(kit.zones.flatMap((zone) => [
      sampleBufferFor(DRUM_PROGRAM, zone.file),
      ...(zone.fileRight ? [sampleBufferFor(DRUM_PROGRAM, zone.fileRight)] : []),
    ]));
  }
}

// Synchronous lookups for the scheduler, which cannot await per note.

export function cachedManifest(program: number): InstrumentManifest | null {
  return manifests.get(program) ?? null;
}

export function cachedDrumKit(): DrumKitManifest | null {
  return drumKit ?? null;
}

export function cachedBuffer(program: number, file: string): AudioBuffer | null {
  const key = `${program}/${file}`;
  const buffer = buffers.get(key);
  if (buffer) touch(key, buffer);
  return buffer ?? null;
}

export function cachedDrumBuffer(zone: DrumZone): AudioBuffer | null {
  return cachedBuffer(DRUM_PROGRAM, zone.file);
}
