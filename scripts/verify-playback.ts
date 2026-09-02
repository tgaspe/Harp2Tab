/**
 * Harness for the web scheduler (Phase 11-6).
 *
 * `Playback.web.ts` needs Web Audio and `tsx` has none, which is exactly where the Studio's
 * worst bugs lived — `playNotes` is called without `await`, so anything it throws becomes an
 * unhandled rejection and the symptom is silence with a running playhead. So this fakes the
 * smallest Web Audio surface the scheduler touches and asserts on what actually happened.
 *
 * Plain Node resolves `SoundFontSynth` to the native stub, whose `currentSynth()` is always
 * null. That is deliberate here: it exercises the oscillator fallback, and it keeps
 * `spessasynth_lib` (ESM-only) out of a CJS harness. The MIDI path is covered through
 * `assignChannels` and `buildEvents`, which are pure.
 *
 * Run: npx tsx scripts/verify-playback.ts
 */

interface CaseResult { name: string; passed: boolean; detail: string }
const results: CaseResult[] = [];
function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

// ── The smallest Web Audio that playback touches ──────────────────────────────

/* Browsers cap concurrent AudioContexts per page — Chrome at six — and construction throws
 * past it. `close()` is async, so creating one per playback call and closing the old one
 * without awaiting piles them up faster than they are released. */
const MAX_HARDWARE_CONTEXTS = 6;
let liveContexts = 0;
let contextsCreated = 0;
let started: { kind: string; when: number }[] = [];
/** The one shared context, so a case can move its clock the way the audio device would. */
let lastContext: FakeContext | null = null;
/** Seconds added to `currentTime` on every read. Off by default; a case turns it on to catch
 *  code that samples the clock twice and treats both reads as the same instant. */
let autoAdvancePerRead = 0;

class FakeParam {
  value = 0;
  setValueAtTime(v: number, t: number) { assertFinite(v, t); return this; }
  linearRampToValueAtTime(v: number, t: number) { assertFinite(v, t); return this; }
  exponentialRampToValueAtTime(v: number, t: number) { assertFinite(v, t); return this; }
}
function assertFinite(v: number, t: number): void {
  if (!Number.isFinite(v)) throw new Error(`non-finite AudioParam value: ${v}`);
  if (!Number.isFinite(t) || t < 0) throw new Error(`bad AudioParam time: ${t}`);
}
class FakeNode {
  gain = new FakeParam(); frequency = new FakeParam(); Q = new FakeParam();
  pan = new FakeParam(); playbackRate = new FakeParam();
  threshold = new FakeParam(); ratio = new FakeParam();
  type = '';
  constructor(public kind: string) {}
  connect(n: unknown) { return n; }
  disconnect() { /* no-op */ }
  start(when = 0) {
    if (!Number.isFinite(when) || when < 0) throw new Error(`bad start time ${when}`);
    started.push({ kind: this.kind, when });
  }
  stop(when = 0) { if (!Number.isFinite(when)) throw new Error(`bad stop time ${when}`); }
}
class FakeContext {
  _currentTime = 0;
  // A getter, so `autoAdvancePerRead` can make time pass *between* two reads — which is what
  // separates one origin sampled once from the same origin sampled twice.
  get currentTime() { const t = this._currentTime; this._currentTime += autoAdvancePerRead; return t; }
  set currentTime(v: number) { this._currentTime = v; }
  /** What the browser reports between scheduling a sample and hearing it. */
  outputLatency = 0;
  baseLatency = 0;
  destination = new FakeNode('destination');
  state = 'running';
  audioWorklet = { addModule: async () => undefined };
  constructor() {
    lastContext = this;
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
  suspend() { return Promise.resolve(); }
  resume() { return Promise.resolve(); }
  close() {
    // Async, exactly as in the browser: the slot is not freed on the turn `close()` is
    // called, which is the whole reason a per-playback context used to pile up.
    return new Promise<void>((resolve) => { setTimeout(() => { liveContexts--; resolve(); }, 0); });
  }
}
(globalThis as any).AudioContext = FakeContext;

const {
  playNotes, stopPlayback, assignChannels, buildEvents, playbackClockMs, playbackLatencyMs,
} = require('../src/native/Playback.web');
const { midiToNoteName } = require('../src/audio/HarmonicaMapper');

interface TestNote {
  id: string; tab: string; note: string; duration: number; start_time: number;
  confidence: number; program?: number; percussion?: boolean; velocity?: number;
}
function note(i: number, midi: number, program?: number, percussion?: boolean, start = i * 250): TestNote {
  return {
    id: `n${i}`, tab: '', note: midiToNoteName(midi), duration: 400,
    start_time: start, confidence: 100, velocity: 100, program, percussion,
  };
}

// ── Channels ──────────────────────────────────────────────────────────────────

function channelsCarryInstruments(): void {
  const notes = [note(0, 60, 0), note(1, 62, 24), note(2, 64, 0), note(3, 36, 0, true)];
  const channels = assignChannels(notes);
  check('channels: one per distinct program', channels.size === 2, `${channels.size} channels for 2 programs`);
  check('channels: a program is stable across notes',
    channels.get(0) === channels.get(0) && channels.get(0) !== channels.get(24), 'program 0 ≠ program 24');
  check('channels: percussion is not assigned one',
    ![...channels.values()].includes(9), 'channel 9 stays reserved');
}

function percussionNeverTakesAMelodicChannel(): void {
  // GM keys percussion by note rather than transposing it, and the synth applies that from
  // the channel alone — so a drum note on a melodic channel is a piano playing the drum part.
  const many = Array.from({ length: 20 }, (_, i) => note(i, 60, i));
  const channels = assignChannels(many);
  check('channels: 9 is never handed out', ![...channels.values()].includes(9), 'reserved');
  check('channels: no more than 15 melodic', channels.size <= 15, `${channels.size} assigned`);
  check('channels: all within MIDI range',
    [...channels.values()].every((c) => c >= 0 && c <= 15), 'every channel 0–15');
}

// ── Events ────────────────────────────────────────────────────────────────────

function everyNoteBecomesAnOnAndAnOff(): void {
  const notes = [note(0, 60, 0), note(1, 64, 0)];
  const events = buildEvents(notes, assignChannels(notes), 0);
  check('events: an on and an off per note', events.length === 4, `2 notes → ${events.length} events`);
  check('events: half are note-ons',
    events.filter((e: any) => e.velocity !== undefined).length === 2, '2 note-ons');
  check('events: time-ordered',
    events.every((e: any, i: number) => i === 0 || events[i - 1].atMs <= e.atMs), 'sorted by atMs');
}

function seekDropsWhatAlreadyFinished(): void {
  const notes = [note(0, 60, 0, false, 0), note(1, 64, 0, false, 5000)];
  const events = buildEvents(notes, assignChannels(notes), 4000);
  check('events: a note finished before the seek is dropped', events.length === 2, `${events.length} events`);
  check('events: nothing is scheduled before the seek point',
    events.every((e: any) => e.atMs >= 4000), 'all at or after 4000ms');
}

function drumsRideChannelNine(): void {
  const notes = [note(0, 36, 0, true), note(1, 60, 0)];
  const events = buildEvents(notes, assignChannels(notes), 0);
  const drum = events.find((e: any) => e.key === 36);
  const melodic = events.find((e: any) => e.key === 60);
  check('events: a drum note is on channel 9', drum?.channel === 9, `channel ${drum?.channel}`);
  check('events: a melodic note is not', melodic?.channel !== 9, `channel ${melodic?.channel}`);
}

// ── Scheduling ────────────────────────────────────────────────────────────────

function denseTrackDoesNotThrow(): void {
  // 3,840 notes in one track. Under the node-per-note engine this cost 19,200 audio nodes
  // in a single synchronous pass and the audio thread gave up partway through the song.
  const dense: TestNote[] = [];
  let i = 0;
  for (let beat = 0; beat < 480; beat++) {
    for (let voice = 0; voice < 8; voice++) dense.push(note(i++, 48 + voice * 4, 0, false, beat * 500));
  }
  const channels = assignChannels(dense);
  const events = buildEvents(dense, channels, 0);
  check('dense: every note becomes two events', events.length === dense.length * 2,
    `${dense.length} notes → ${events.length} events`);
  check('dense: one channel for one instrument', channels.size === 1, `${channels.size} channel`);
}

async function restartsDoNotExhaustTheContextBudget(): Promise<void> {
  // Every solo toggle, seek, tempo change and live edit reschedules. If each one builds a
  // fresh AudioContext, a handful of clicks hits the per-page cap and every later play is
  // silent — which is what "add tracks until no sound comes out" looked like from outside.
  const notes = Array.from({ length: 12 }, (_, i) => note(i, 60 + i, 0));
  stopPlayback();
  await new Promise((r) => setTimeout(r, 5));
  const before = contextsCreated;
  let exhausted: string | null = null;
  started = [];
  for (let i = 0; i < 12; i++) {
    try {
      await playNotes(notes, { bpm: 120, metronomeEnabled: false, rate: 1 }, 0);
    } catch (error) {
      exhausted = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  check('12 restarts do not exhaust the context budget', exhausted === null,
    exhausted ?? `${contextsCreated - before} new contexts for 12 restarts`);
  check('fallback: the last restart still scheduled voices', started.length > 0,
    `${started.length} oscillator voices with no synth loaded`);
  stopPlayback();
}


// ── The playhead clock ────────────────────────────────────────────────────────

function near(actual: number | null, expected: number, tolerance = 1): boolean {
  return actual !== null && Math.abs(actual - expected) <= tolerance;
}

/**
 * The red line and the sound have to come off one clock.
 *
 * They used not to: the playhead counted `Date.now()` from the moment `play()` was called,
 * while every note was handed to the synth at an `AudioContext.currentTime` sampled
 * separately, and nothing ever reconciled the two. Any gap opened at the origin — a context
 * still resuming samples a *frozen* `currentTime`, and `resume()` is not awaited — was baked
 * in for the whole pass, and every pause/resume added more, because the wall clock ran
 * through a suspension the audio clock sat out. The symptom is a red line ahead of the music.
 */
async function clockFollowsTheAudioNotTheWallClock(): Promise<void> {
  stopPlayback();
  check('clock: nothing to report while stopped', playbackClockMs() === null, `${playbackClockMs()}`);

  const notes = [note(0, 60, 0, false, 0), note(1, 64, 0, false, 4000)];
  await playNotes(notes, { bpm: 120, metronomeEnabled: false, rate: 1 }, 4000);
  const ctx = lastContext!;
  check('clock: opens at the seek point', near(playbackClockMs(), 4000), `${playbackClockMs()}`);

  ctx.currentTime += 1;
  check('clock: advances with the audio clock', near(playbackClockMs(), 5000), `${playbackClockMs()}`);

  // The bug, in one assertion: an audio clock that is not moving is audio that is not
  // playing, and the line has no business moving without it. Wall-clock time passes here
  // and the context's does not — exactly a context part-way through `resume()`.
  const frozen = playbackClockMs();
  await new Promise((r) => setTimeout(r, 60));
  check('clock: a frozen audio clock freezes the playhead', near(playbackClockMs(), frozen!),
    `${frozen} → ${playbackClockMs()} across 60ms of wall time`);

  stopPlayback();
  check('clock: nothing to report after stop', playbackClockMs() === null, `${playbackClockMs()}`);
}

/** Nominal note-timeline units, like every other position in the transport: at 2x, one
 *  second of audio covers two seconds of the score. */
async function clockReportsNominalTimeAtEveryRate(): Promise<void> {
  stopPlayback();
  const notes = [note(0, 60, 0, false, 0), note(1, 64, 0, false, 8000)];
  await playNotes(notes, { bpm: 120, metronomeEnabled: false, rate: 2 }, 0);
  const ctx = lastContext!;
  ctx.currentTime += 1;
  check('clock: rate scales the nominal position', near(playbackClockMs(), 2000), `${playbackClockMs()}`);
  stopPlayback();
}

/** `currentTime` is where the renderer is, not where the speaker is; the gap is
 *  `outputLatency`, and on Bluetooth it is a quarter of a second. The line has to show the
 *  note being *heard*, not the one being handed to the sound card. */
async function clockShowsWhatIsBeingHeard(): Promise<void> {
  stopPlayback();
  const notes = [note(0, 60, 0, false, 0), note(1, 64, 0, false, 4000)];
  const ctx = lastContext!;
  ctx.outputLatency = 0.2;
  await playNotes(notes, { bpm: 120, metronomeEnabled: false, rate: 1 }, 2000);
  check('clock: output latency is taken off the playhead', near(playbackClockMs(), 1800),
    `${playbackClockMs()} at a 200ms output latency`);
  check('latency: reported to the transport in ms', playbackLatencyMs() === 200, `${playbackLatencyMs()}`);
  ctx.currentTime += 0.2;
  check('clock: reaches the seek point once the sound does', near(playbackClockMs(), 2000),
    `${playbackClockMs()}`);
  ctx.outputLatency = 0;
  stopPlayback();
}

/** Notes and clicks were sampled from `ctx.currentTime` separately — the metronome from one
 *  read, the voices from another taken after the whole event list had been built and sorted.
 *  Two origins is a click that does not sit on its own beat. */
async function everythingSharesOneOrigin(): Promise<void> {
  stopPlayback();
  started = [];
  autoAdvancePerRead = 0.01;   // 10ms of wall time between any two reads of the clock
  const notes = [note(0, 60, 0, false, 0), note(1, 64, 0, false, 2000)];
  await playNotes(notes, { bpm: 120, metronomeEnabled: true, rate: 1 }, 0);
  autoAdvancePerRead = 0;

  const voices = started.filter((s) => s.kind === 'oscillator').map((s) => s.when);
  const first = Math.min(...voices);
  const downbeatCount = voices.filter((w) => Math.abs(w - first) < 1e-9).length;
  // A note at 0ms and the bar-one click both land on the origin — unless there are two.
  check('origin: the first note and the first click share it', downbeatCount >= 2,
    `${downbeatCount} voices on the downbeat, from ${voices.length} scheduled`);
  stopPlayback();
}

async function main(): Promise<void> {
  channelsCarryInstruments();
  percussionNeverTakesAMelodicChannel();
  everyNoteBecomesAnOnAndAnOff();
  seekDropsWhatAlreadyFinished();
  drumsRideChannelNine();
  denseTrackDoesNotThrow();
  await restartsDoNotExhaustTheContextBudget();
  await clockFollowsTheAudioNotTheWallClock();
  await clockReportsNominalTimeAtEveryRate();
  await clockShowsWhatIsBeingHeard();
  await everythingSharesOneOrigin();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

void main();
