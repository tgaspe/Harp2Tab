import { noteNameToMidi } from '@/audio/HarmonicaMapper';
import {
  currentSynth, loadSynth, PERCUSSION_CHANNEL, synthAttempted,
} from '@/audio/synth/SoundFontSynth';
import type { Synth } from '@/audio/synth/types';
import { noteNameToFrequency } from '@/audio/synthesizeWav';
import { constantTempoMap, gridLines, type PlaybackOptions } from '@/audio/tempo';
import { DEFAULT_PROGRAM, velocityGain, voiceForProgram } from '@/audio/timbre';
import { noteVelocity } from '@/audio/velocity';
import type { TabNote } from '@/types';

/*
 * Web playback is a General MIDI synthesizer fed a stream of MIDI events, not a graph of
 * per-note audio nodes. The node-per-note design it replaced cost 19,200 nodes for a single
 * dense track and the audio thread gave up partway through a song; here the graph is one
 * worklet node whatever the song is. See `SoundFontSynth.web.ts` for why the whole sampler
 * went with it.
 *
 * The oscillator path below survives untouched as the fallback, for the moment before the
 * soundfont has loaded and for any browser where the worklet won't start.
 */

const AMPLITUDE = 0.3;

/** How often the scheduler wakes, and how far past that it looks. Events are handed to the
 *  synth with an absolute context time, so the window only has to outlast the timer's own
 *  jitter — it is not what makes the timing accurate. Matching Signal's player. */
const TIMER_INTERVAL_MS = 50;
const LOOK_AHEAD_MS = 100;

/**
 * One context for the whole session, not one per playback.
 *
 * Browsers cap concurrent AudioContexts per page — Chrome at six — and `close()` is
 * asynchronous, so building a fresh one on every play and closing the old one without
 * awaiting piles them up faster than they are released. Every solo toggle, seek, tempo
 * change and live edit reschedules, so half a dozen clicks was enough to hit the cap;
 * construction then throws, and since `playNotes` is called without `await` that surfaces as
 * an unhandled rejection and the app goes permanently silent.
 */
let audioContext: AudioContext | null = null;

function playbackContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  // A context built outside a user gesture starts suspended, and `pausePlayback` suspends
  // this one deliberately — either way a fresh schedule needs it running.
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

/** Oscillator voices and metronome clicks, so `stopPlayback` can silence them. Synth notes
 *  are not in here — they are stopped through the synth itself. */
let activeVoices: AudioScheduledSourceNode[] = [];
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function scheduleMetronome(
  ctx: AudioContext,
  now: number,
  totalMs: number,
  options: PlaybackOptions,
  rate: number,
  startAtMs: number,
): void {
  // Beats come from the tempo map rather than a fixed step, so a click still lands on the
  // beat after a tempo change and the accent still lands on beat 1 of the bar — including
  // when the bar length itself changes. `options.tempoMap` is absent for a tab session,
  // which has one tempo by construction.
  const map = options.tempoMap ?? constantTempoMap(options.bpm);
  const beats = gridLines(map, 0, totalMs, 4).filter((l) => l.isBeat);

  // Positions stay in nominal (unscaled) units — only the actual schedule time is
  // compressed/stretched by rate, otherwise the loop would run ~rate× too many iterations
  // past the (now shorter/longer) note audio itself.
  const startAtSec = startAtMs / 1000;
  for (const beat of beats) {
    const t = beat.ms / 1000;
    if (t < startAtSec) continue;
    const accented = beat.isBar;
    const startSec = now + (t - startAtSec) / rate;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = accented ? 1800 : 1200;
    // Short percussive decay — a click, not a tone. exponentialRamp can't target
    // exactly 0, hence the tiny epsilon floor.
    gain.gain.setValueAtTime(accented ? 0.5 : 0.35, startSec);
    gain.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.03);
    osc.connect(gain);
    // Deliberately straight to the destination: a reference click should not duck under a
    // loud bar the way it would through the synth's own output.
    gain.connect(ctx.destination);
    osc.start(startSec);
    osc.stop(startSec + 0.04);
    activeVoices.push(osc);
  }
}

// ── MIDI event scheduling ─────────────────────────────────────────────────────

export interface MidiEvent {
  /** Nominal project time, ms — unscaled by playback rate, like every position in this file. */
  atMs: number;
  channel: number;
  key: number;
  /** Absent for a note-off. */
  velocity?: number;
}

/**
 * Programs get a MIDI channel each, because a channel is what carries an instrument in MIDI.
 *
 * Channel 9 is reserved: GM puts percussion there, keyed by note rather than transposed by
 * it, and the synth applies that rule from the channel alone. A project with more distinct
 * instruments than the remaining fifteen channels reuses channel 0 for the overflow, which
 * makes those tracks share a sound rather than fall silent.
 */
export function assignChannels(notes: TabNote[]): Map<number, number> {
  const channels = new Map<number, number>();
  let next = 0;
  for (const n of notes) {
    if (n.percussion) continue;
    const program = n.program ?? DEFAULT_PROGRAM;
    if (channels.has(program)) continue;
    if (next === PERCUSSION_CHANNEL) next++;
    if (next > 15) continue;
    channels.set(program, next++);
  }
  return channels;
}

/** Note-ons and note-offs in time order, ready for the window loop to walk once. */
export function buildEvents(notes: TabNote[], channels: Map<number, number>, startAtMs: number): MidiEvent[] {
  const events: MidiEvent[] = [];
  for (const n of notes) {
    const noteEnd = n.start_time + n.duration;
    if (noteEnd <= startAtMs) continue; // fully before the seek point
    const key = noteNameToMidi(n.note);
    if (key === null) continue;

    const channel = n.percussion
      ? PERCUSSION_CHANNEL
      : channels.get(n.program ?? DEFAULT_PROGRAM) ?? 0;

    /* A note straddling the seek point is re-struck at the seek position rather than
     * resumed part-way through. The sampler this replaced could start a buffer at an offset;
     * MIDI has no way to say "this note is already half over", so the choice is a fresh
     * attack or silence. Signal's player makes the same one. */
    events.push({ atMs: Math.max(n.start_time, startAtMs), channel, key, velocity: noteVelocity(n) ?? 100 });
    events.push({ atMs: noteEnd, channel, key });
  }
  return events.sort((a, b) => a.atMs - b.atMs);
}

function startScheduler(
  ctx: AudioContext,
  synth: Synth,
  events: MidiEvent[],
  startAtMs: number,
  rate: number,
): void {
  const originSec = ctx.currentTime;
  let index = 0;

  const pump = (): void => {
    // `ctx.currentTime` freezes while the context is suspended, so a paused transport
    // simply stops finding events in range — the timer can keep ticking harmlessly.
    const horizonSec = ctx.currentTime + LOOK_AHEAD_MS / 1000;
    while (index < events.length) {
      const event = events[index];
      const timeSec = originSec + (event.atMs - startAtMs) / 1000 / rate;
      if (timeSec > horizonSec) break;
      // Absolute context time, so the synth places the event to the sample even though this
      // loop only wakes every 50 ms.
      const at = { time: Math.max(timeSec, ctx.currentTime) };
      if (event.velocity === undefined) synth.noteOff(event.channel, event.key, at);
      else synth.noteOn(event.channel, event.key, event.velocity, at);
      index++;
    }
    if (index >= events.length && schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
  };

  pump();
  if (index < events.length) schedulerTimer = setInterval(pump, TIMER_INTERVAL_MS);
}

export async function playNotes(notes: TabNote[], options?: PlaybackOptions, startAtMs = 0): Promise<void> {
  stopPlayback();
  if (notes.length === 0) return;

  const ctx = playbackContext();
  const now = ctx.currentTime;
  const rate = options?.rate ?? 1;

  const synth = currentSynth();
  if (synth) {
    const channels = assignChannels(notes);
    for (const [program, channel] of channels) synth.programChange(channel, program);
    startScheduler(ctx, synth, buildEvents(notes, channels, startAtMs), startAtMs, rate);
  } else {
    // The soundfont isn't up yet. Play the oscillator voices this file has always had, and
    // start the load so the next press is the real thing.
    if (!synthAttempted()) void loadSynth(ctx);
    scheduleOscillators(ctx, notes, startAtMs, rate);
  }

  if (options?.metronomeEnabled) {
    const totalMs = notes.reduce((max, n) => Math.max(max, n.start_time + n.duration), 0);
    scheduleMetronome(ctx, now, totalMs, options, rate, startAtMs);
  }
}

/** The pre-synth engine, kept whole as the fallback. Distinguishable rather than realistic —
 *  see `timbre.ts` for what these voices are for. */
function scheduleOscillators(ctx: AudioContext, notes: TabNote[], startAtMs: number, rate: number): void {
  const now = ctx.currentTime;
  for (const n of notes) {
    const noteEnd = n.start_time + n.duration;
    if (noteEnd <= startAtMs) continue;

    const freq = noteNameToFrequency(n.note);
    if (freq <= 0) continue;

    const effectiveStart = Math.max(n.start_time, startAtMs);
    const startSec = now + (effectiveStart - startAtMs) / 1000 / rate;
    const durSec   = (noteEnd - effectiveStart) / 1000 / rate;
    const fadeSec  = Math.min(0.01, durSec / 4);

    const voice = voiceForProgram(n.program);
    const peak  = AMPLITUDE * voice.gain * velocityGain(noteVelocity(n));

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = voice.type;
    osc.frequency.value = freq;

    const attack  = Math.min(voice.attackSec, durSec * 0.4);
    const decay   = Math.min(voice.decaySec, Math.max(0, durSec - attack) * 0.6);
    const release = Math.min(voice.releaseSec, Math.max(fadeSec, durSec - attack - decay));
    const sustainPeak = peak * voice.sustainLevel;

    gain.gain.setValueAtTime(0, startSec);
    gain.gain.linearRampToValueAtTime(peak, startSec + attack);
    if (decay > 0) gain.gain.linearRampToValueAtTime(sustainPeak, startSec + attack + decay);
    gain.gain.setValueAtTime(sustainPeak, startSec + Math.max(attack + decay, durSec - release));
    gain.gain.linearRampToValueAtTime(0, startSec + durSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startSec);
    osc.stop(startSec + durSec + 0.02);
    activeVoices.push(osc);
  }
}

/**
 * Single-tone preview — clicking a note in the piano roll.
 *
 * Runs on the shared context and the shared synth, unlike the separate one-shot context this
 * used to build. `stopAll` is deliberately not called here: a preview must not silence a
 * running transport, and a short note released on its own is enough.
 */
export function previewNote(noteName: string, durationMs = 180, program = DEFAULT_PROGRAM): void {
  const ctx = playbackContext();
  const key = noteNameToMidi(noteName);
  const synth = currentSynth();

  if (synth && key !== null) {
    const at = ctx.currentTime;
    synth.programChange(15, program);
    synth.noteOn(15, key, 100, { time: at });
    synth.noteOff(15, key, { time: at + durationMs / 1000 });
    return;
  }

  if (!synthAttempted()) void loadSynth(ctx);

  const freq = noteNameToFrequency(noteName);
  if (freq <= 0) return;
  const now = ctx.currentTime;
  const durSec  = durationMs / 1000;
  const fadeSec = Math.min(0.01, durSec / 4);

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(AMPLITUDE, now + fadeSec);
  gain.gain.setValueAtTime(AMPLITUDE, now + durSec - fadeSec);
  gain.gain.linearRampToValueAtTime(0, now + durSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durSec + 0.02);
  activeVoices.push(osc);
}

export function pausePlayback(): void {
  audioContext?.suspend();
}

export function resumePlayback(): void {
  audioContext?.resume();
}

export function stopPlayback(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  // Everything the synth is holding, including notes whose note-off was never reached
  // because the transport stopped mid-phrase.
  currentSynth()?.stopAll(true);
  activeVoices.forEach((voice) => {
    try { voice.stop(); } catch { /* already stopped */ }
  });
  activeVoices = [];
  // The context is deliberately kept — closing it is what used to exhaust the browser's
  // context budget.
}

/** Warm the worklet and soundfont. Callers use this to get the load out of the way before
 *  the first play rather than after it; it never rejects. */
export async function warmSynth(): Promise<void> {
  await loadSynth(playbackContext());
}
