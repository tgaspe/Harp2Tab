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

import { drumZoneForKey, keysToEvict, zoneForKey } from './resolver';
import type { DrumKitManifest, DrumZone, InstrumentManifest } from './types';

/** The single place the version pinned in `docs/plan/soundfont-source.md` appears. The
 *  directory name carries it so a deploy can never pair new manifests with cached old
 *  samples. */
export const SOUNDFONT_DIR = 'musescore-general-0.2.0';
const BASE = `/soundfonts/${SOUNDFONT_DIR}`;

/** Out of the 0–127 range on purpose, so a drum sample can never collide with a melodic one
 *  in the buffer cache. Mirrors GM's own convention of putting the kit in bank 128. */
export const DRUM_PROGRAM = 128;

/** Headroom for buffers outside the current project's working set — a previously-played
 *  project, an instrument auditioned in the picker. The working set itself is pinned and is
 *  never counted against this, because a project that needs more entries than the cap must
 *  still play: the GM drum kit alone is 60 files before a single melodic track. */
const MAX_UNPINNED_BUFFERS = 128;

/** Buffer keys the transport is about to need. Eviction skips these. Replaced wholesale on
 *  every `ensureNotesLoaded`, so the previous project's samples become evictable the moment
 *  a new one is prepared. */
let pinnedKeys: Set<string> = new Set();

/** In-flight sample requests. Enough to saturate a real connection, few enough not to bury
 *  the dev server. */
const MAX_CONCURRENT_FETCHES = 8;

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
  for (const evict of keysToEvict([...buffers.keys()], pinnedKeys, MAX_UNPINNED_BUFFERS)) {
    buffers.delete(evict);
  }
}

/** What a note needs, in the cache's own terms — no `TabNote` in here, so the sound bank
 *  stays independent of the editor's shapes. */
export interface NoteRequest {
  program: number;
  midiKey: number;
  percussion?: boolean;
}

/**
 * Load exactly the samples a set of notes will play, and pin them.
 *
 * Deliberately not "every zone of every program". A project touching eight instruments plus
 * drums has several hundred zones between them, of which the notes actually reach a few
 * dozen; loading the rest costs seconds of fetching and tens of MB of decoded audio for
 * samples nothing will ever ask for.
 *
 * Never rejects. A program that fails to load simply plays as an oscillator.
 */
export async function ensureNotesLoaded(requests: NoteRequest[]): Promise<void> {
  const programs = [...new Set(requests.filter((r) => !r.percussion).map((r) => r.program))];
  const needsDrums = requests.some((r) => r.percussion);

  // Manifests first: they are small, and the zone lookup below needs them before it can say
  // which audio files are actually reachable.
  const manifestList = await Promise.all(programs.map((p) => loadInstrument(p)));
  const byProgram = new Map(programs.map((p, i) => [p, manifestList[i]]));
  const kit = needsDrums ? await loadDrumKit() : null;

  const needed = new Set<string>();
  for (const request of requests) {
    if (request.percussion) {
      const zone = kit ? drumZoneForKey(kit, request.midiKey) : null;
      if (zone) {
        needed.add(`${DRUM_PROGRAM}/${zone.file}`);
        if (zone.fileRight) needed.add(`${DRUM_PROGRAM}/${zone.fileRight}`);
      }
      continue;
    }
    const manifest = byProgram.get(request.program);
    const zone = manifest ? zoneForKey(manifest, request.midiKey) : null;
    if (!zone) continue;
    needed.add(`${request.program}/${zone.file}`);
    if (zone.fileRight) needed.add(`${request.program}/${zone.fileRight}`);
  }

  // Pin before loading, or `touch` evicts each arrival to make room for the next.
  pinnedKeys = needed;

  // Bounded, not `Promise.all` over the lot. A project can reach fifty-odd files, and
  // firing them all at once is enough to stall Metro's dev server — which used to hang the
  // transport, back when playback waited on this.
  const queue = [...needed];
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_FETCHES, queue.length) }, async () => {
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      const slash = key.indexOf('/');
      await sampleBufferFor(Number(key.slice(0, slash)), key.slice(slash + 1));
    }
  });
  await Promise.all(workers);
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
