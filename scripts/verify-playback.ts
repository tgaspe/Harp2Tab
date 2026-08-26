/**
 * Harness for the web scheduler (Phase 11-6).
 *
 * `Playback.web.ts` could not be tested before this: it needs Web Audio, and `tsx` has none.
 * That gap is exactly where the Studio's "play makes no sound until you solo a track" bug
 * lived — `playNotes` is called without `await` from `usePlayback.play`, so anything it
 * throws becomes an unhandled rejection and the symptom is silence with a running playhead.
 *
 * So this fakes the smallest Web Audio surface the scheduler touches, serves the real
 * sound packages off disk, and asserts on what actually got scheduled. A throw here is a
 * failed case rather than a silent no-op.
 *
 * Run: npx tsx scripts/verify-playback.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface CaseResult { name: string; passed: boolean; detail: string }
const results: CaseResult[] = [];
function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

// ── The smallest Web Audio that `playNotes` touches ───────────────────────────

let started: { type: string; when: number }[] = [];
let nodeCount = 0;

class FakeParam { value = 0;
  setValueAtTime(v: number, t: number) { assertFinite(v, t); return this; }
  linearRampToValueAtTime(v: number, t: number) { assertFinite(v, t); return this; }
  exponentialRampToValueAtTime(v: number, t: number) { assertFinite(v, t); return this; }
}
function assertFinite(v: number, t: number): void {
  // Web Audio throws on a non-finite value or time. In the browser that aborts the whole
  // scheduling loop, so every note after it is silently lost.
  if (!Number.isFinite(v)) throw new Error(`non-finite AudioParam value: ${v}`);
  if (!Number.isFinite(t)) throw new Error(`non-finite AudioParam time: ${t}`);
  if (t < 0) throw new Error(`negative AudioParam time: ${t}`);
}
class FakeNode {
  gain = new FakeParam(); frequency = new FakeParam(); Q = new FakeParam();
  pan = new FakeParam(); playbackRate = new FakeParam(); detune = new FakeParam();
  threshold = new FakeParam(); ratio = new FakeParam();
  type = ''; buffer: unknown = null; loop = false; loopStart = 0; loopEnd = 0;
  onended: (() => void) | null = null;
  constructor(public kind: string) { nodeCount++; }
  connect(_n: unknown) { return _n; }
  disconnect() { /* no-op */ }
  start(when = 0, offset = 0) {
    if (!Number.isFinite(when) || when < 0) throw new Error(`bad start time ${when}`);
    if (!Number.isFinite(offset) || offset < 0) throw new Error(`bad start offset ${offset}`);
    started.push({ type: this.kind, when });
  }
  stop(when = 0) { if (!Number.isFinite(when)) throw new Error(`bad stop time ${when}`); }
}
/* Browsers cap concurrent AudioContexts per page — Chrome at six — and construction throws
 * past it: "The number of hardware contexts provided (6) is greater than or equal to the
 * maximum bound (6)". `close()` is async, so creating one per playback call and closing the
 * old one without awaiting piles them up faster than they are released. */
const MAX_HARDWARE_CONTEXTS = 6;
let liveContexts = 0;
let contextsCreated = 0;

class FakeContext {
  currentTime = 0;
  destination = new FakeNode('destination');
  state = 'running';
  constructor() {
    if (liveContexts >= MAX_HARDWARE_CONTEXTS) {
      throw new Error(`Failed to construct 'AudioContext': The number of hardware contexts provided (${liveContexts}) is greater than or equal to the maximum bound (${MAX_HARDWARE_CONTEXTS}).`);
    }
    liveContexts++; contextsCreated++;
  }
  createGain() { return new FakeNode('gain'); }
  createOscillator() { return new FakeNode('oscillator'); }
  createBufferSource() { return new FakeNode('buffer'); }
  createBiquadFilter() { return new FakeNode('filter'); }
  createStereoPanner() { return new FakeNode('panner'); }
  createDynamicsCompressor() { return new FakeNode('compressor'); }
  decodeAudioData(bytes: ArrayBuffer) {
    return Promise.resolve({ duration: 1, length: 44100, sampleRate: 44100, numberOfChannels: 1, _bytes: bytes.byteLength });
  }
  suspend() { return Promise.resolve(); }
  resume() { return Promise.resolve(); }
  close() {
    // Async, exactly as in the browser: the slot is not freed on the turn `close()` is
    // called, which is the whole reason a per-playback context piles up.
    return new Promise<void>((resolve) => { setTimeout(() => { liveContexts--; resolve(); }, 0); });
  }
}

const ASSETS = path.join(__dirname, '..', 'public');
let fetched: { url: string; bytes: number }[] = [];
(globalThis as any).AudioContext = FakeContext;
(globalThis as any).fetch = async (url: string) => {
  const file = path.join(ASSETS, url.replace(/^\//, ''));
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  const data = fs.readFileSync(file);
  fetched.push({ url, bytes: data.length });
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(data.toString('utf8')),
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  };
};

/* Metro resolves `./sampleCache` to `sampleCache.web.ts` when bundling for web; plain Node
 * has no platform resolution and would silently pick up the native stub next to it, whose
 * functions all return null. The harness would then "reproduce" a total fallback to
 * oscillators that has nothing to do with the browser. So mimic Metro: prefer a `.web.ts`
 * sibling wherever one exists. */
const Module = require('node:module') as { _resolveFilename: (...args: unknown[]) => string };
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function patched(request: unknown, ...rest: unknown[]): string {
  const resolved = resolveFilename.call(this, request, ...rest);
  const webVariant = resolved.replace(/\.ts$/, '.web.ts');
  return webVariant !== resolved && fs.existsSync(webVariant) ? webVariant : resolved;
};

// Imported after the globals above exist, so module-level code sees them.
const { playNotes, stopPlayback } = require('../src/native/Playback.web');
const { ensureNotesLoaded } = require('../src/audio/soundfont');
const { noteNameToMidi, midiToNoteName } = require('../src/audio/HarmonicaMapper');

interface TestNote {
  id: string; tab: string; note: string; duration: number; start_time: number;
  confidence: number; program?: number; percussion?: boolean; velocity?: number;
}

function note(i: number, midi: number, program?: number, percussion?: boolean): TestNote {
  return {
    id: `n${i}`, tab: '', note: midiToNoteName(midi), duration: 400,
    start_time: i * 250, confidence: 100, velocity: 100, program, percussion,
  };
}

/** A Studio project shaped like the one that failed: several melodic tracks plus drums. */
function multiTrackProject(): TestNote[] {
  const notes: TestNote[] = [];
  let i = 0;
  for (const program of [0, 24, 33, 40, 56, 73]) {
    for (let k = 0; k < 12; k++) notes.push(note(i++, 48 + k * 3, program));
  }
  for (const key of [36, 38, 42, 46, 49]) {
    for (let k = 0; k < 6; k++) notes.push(note(i++, key, 0, true));
  }
  return notes.sort((a, b) => a.start_time - b.start_time);
}

async function requestsFor(notes: TestNote[]) {
  return notes.map((n) => ({
    program: n.program ?? 22,
    midiKey: noteNameToMidi(n.note),
    percussion: n.percussion,
  })).filter((r: { midiKey: number | null }) => r.midiKey !== null);
}

/** One track, dense: chords stacked eight deep, every beat, for four minutes. This is the
 *  shape that "plays for a bit then stops" — the whole song is committed to the graph in one
 *  synchronous pass, so a failure partway through loses every note after it. */
function denseChordTrack(): TestNote[] {
  const notes: TestNote[] = [];
  let i = 0;
  for (let beat = 0; beat < 480; beat++) {
    for (let voice = 0; voice < 8; voice++) {
      notes.push({
        id: `d${i++}`, tab: '', note: midiToNoteName(48 + voice * 4),
        duration: 900, start_time: beat * 500, confidence: 100, velocity: 100, program: 0,
      });
    }
  }
  return notes;
}

async function main(): Promise<void> {
  const { SOUNDFONT_DIR } = require('../src/audio/soundfont');
  check('harness: the web sample cache is the one under test', SOUNDFONT_DIR !== '',
    SOUNDFONT_DIR === '' ? 'resolved the native stub — platform resolution is wrong' : SOUNDFONT_DIR);

  const project = multiTrackProject();

  // ── The failing case: every track audible ─────────────────────────────────
  started = []; nodeCount = 0; fetched = [];
  await ensureNotesLoaded(await requestsFor(project));
  const audio = fetched.filter((f) => f.url.endsWith('.ogg'));
  const mb = audio.reduce((sum, f) => sum + f.bytes, 0) / 1024 / 1024;
  console.log(`  [preload] ${fetched.length} requests, ${audio.length} audio files, ${mb.toFixed(1)} MB`);
  let threw: string | null = null;
  try {
    await playNotes(project, { bpm: 120, metronomeEnabled: false, rate: 1 }, 0);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check('multitrack: scheduling does not throw', threw === null, threw ?? 'no exception');
  const sampled = started.filter((s) => s.type === 'buffer').length;
  const osc = started.filter((s) => s.type === 'oscillator').length;
  check('multitrack: every note is scheduled', sampled + osc >= project.length,
    `${project.length} notes → ${sampled} sampled + ${osc} oscillator`);
  check('multitrack: notes play as samples, not fallback tones', sampled > 0,
    `${sampled} sampled voices`);
  stopPlayback();

  // ── The working case: one track soloed ────────────────────────────────────
  const solo = project.filter((n) => n.program === 0 && !n.percussion);
  started = [];
  await ensureNotesLoaded(await requestsFor(solo));
  let soloThrew: string | null = null;
  try {
    await playNotes(solo, { bpm: 120, metronomeEnabled: false, rate: 1 }, 0);
  } catch (error) {
    soloThrew = error instanceof Error ? error.message : String(error);
  }
  check('solo: scheduling does not throw', soloThrew === null, soloThrew ?? 'no exception');
  check('solo: every note is scheduled', started.length >= solo.length,
    `${solo.length} notes → ${started.length} voices`);
  stopPlayback();

  // ── A malformed manifest must not take the whole transport down ───────────
  // `playNotes` is called without `await` and the preload gates it, so anything that
  // rejects in there means play() is never reached: silence, no playhead, no error the user
  // can see. One odd program in a project must cost that program its samples and nothing
  // more.
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string) => {
    if (url.includes('/033-')) return { ok: true, status: 200, json: async () => ({ program: 33, name: 'Broken' }), arrayBuffer: async () => new ArrayBuffer(0) };
    return realFetch(url);
  };
  let poisoned: string | null = null;
  try {
    await ensureNotesLoaded(await requestsFor(project));
  } catch (error) {
    poisoned = error instanceof Error ? error.message : String(error);
  }
  (globalThis as any).fetch = realFetch;
  check('a manifest with no zones does not reject the preload', poisoned === null,
    poisoned ?? 'resolved');

  // ── Repeated restarts must not exhaust the browser's context budget ───────
  // Every solo toggle, seek, tempo change and live edit reschedules. If each one builds a
  // fresh AudioContext, a handful of clicks hits the per-page cap and every later play is
  // silent — which is what "add tracks until no sound comes out" looks like from outside.
  stopPlayback();
  await new Promise((r) => setTimeout(r, 5));
  const before = contextsCreated;
  let exhausted: string | null = null;
  started = [];
  for (let i = 0; i < 12; i++) {
    try {
      await playNotes(solo, { bpm: 120, metronomeEnabled: false, rate: 1 }, 0);
    } catch (error) {
      exhausted = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  check('12 restarts do not exhaust the context budget', exhausted === null,
    exhausted ?? `${contextsCreated - before} contexts for 12 restarts`);
  check('the last restart still scheduled voices', started.length > 0,
    `${started.length} voices on the final pass`);

  // ── One dense track ───────────────────────────────────────────────────────
  stopPlayback();
  const dense = denseChordTrack();
  await ensureNotesLoaded(await requestsFor(dense));
  started = []; nodeCount = 0;
  let denseThrew: string | null = null;
  try {
    await playNotes(dense, { bpm: 120, metronomeEnabled: false, rate: 1 }, 0);
  } catch (error) {
    denseThrew = error instanceof Error ? error.message : String(error);
  }
  check('dense: scheduling does not throw', denseThrew === null, denseThrew ?? 'no exception');
  check('dense: every note is scheduled', started.length >= dense.length,
    `${dense.length} notes → ${started.length} voices, ${nodeCount} nodes`);
  stopPlayback();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

void main();
