import { noteNameToFrequency } from '@/audio/synthesizeWav';
import { constantTempoMap, gridLines, type PlaybackOptions } from '@/audio/tempo';
import type { TabNote } from '@/types';

// Web gets real-time OscillatorNode scheduling — no pre-render/file-write round-trip
// needed like the native path, since Web Audio can schedule tones directly.
const AMPLITUDE = 0.3;

let audioContext: AudioContext | null = null;
let activeOscillators: OscillatorNode[] = [];

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
    gain.connect(ctx.destination);
    osc.start(startSec);
    osc.stop(startSec + 0.04);
    activeOscillators.push(osc);
  }
}

export async function playNotes(notes: TabNote[], options?: PlaybackOptions, startAtMs = 0): Promise<void> {
  stopPlayback();
  if (notes.length === 0) return;

  const ctx = new AudioContext();
  audioContext = ctx;
  const now = ctx.currentTime;
  const rate = options?.rate ?? 1;

  for (const n of notes) {
    const noteEnd = n.start_time + n.duration;
    if (noteEnd <= startAtMs) continue; // fully before the seek point

    const freq = noteNameToFrequency(n.note);
    if (freq <= 0) continue;

    // Notes straddling the seek point start partway through rather than jumping to
    // wherever they'd naturally begin, so playback picks up exactly at the seek point.
    const effectiveStart = Math.max(n.start_time, startAtMs);
    const startSec = now + (effectiveStart - startAtMs) / 1000 / rate;
    const durSec    = (noteEnd - effectiveStart) / 1000 / rate;
    const fadeSec   = Math.min(0.01, durSec / 4);

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;

    // Short fade in/out avoids audible clicks at note boundaries.
    gain.gain.setValueAtTime(0, startSec);
    gain.gain.linearRampToValueAtTime(AMPLITUDE, startSec + fadeSec);
    gain.gain.setValueAtTime(AMPLITUDE, startSec + durSec - fadeSec);
    gain.gain.linearRampToValueAtTime(0, startSec + durSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startSec);
    osc.stop(startSec + durSec + 0.02);
    activeOscillators.push(osc);
  }

  if (options?.metronomeEnabled) {
    const totalMs = notes.reduce((max, n) => Math.max(max, n.start_time + n.duration), 0);
    scheduleMetronome(ctx, now, totalMs, options, rate, startAtMs);
  }
}

// Single-tone preview (e.g. clicking a note in the piano-roll editor to hear it) — its
// own one-shot AudioContext, entirely independent from the transport's `audioContext`
// above, so it can't be paused/stopped by playback controls and doesn't touch
// isPlaying/isPaused state. Closed once the tone finishes so repeated clicks don't leak
// contexts.
export function previewNote(noteName: string, durationMs = 180): void {
  const freq = noteNameToFrequency(noteName);
  if (freq <= 0) return;

  const ctx = new AudioContext();
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
  osc.onended = () => { ctx.close(); };
}

export function pausePlayback(): void {
  audioContext?.suspend();
}

export function resumePlayback(): void {
  audioContext?.resume();
}

export function stopPlayback(): void {
  activeOscillators.forEach((osc) => {
    try { osc.stop(); } catch { /* already stopped */ }
  });
  activeOscillators = [];
  audioContext?.close();
  audioContext = null;
}
