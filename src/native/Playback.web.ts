import { noteNameToFrequency } from '@/audio/synthesizeWav';
import { BEATS_PER_BAR, beatDurationMs, type PlaybackOptions } from '@/audio/tempo';
import type { TabNote } from '@/types';

// Web gets real-time OscillatorNode scheduling — no pre-render/file-write round-trip
// needed like the native path, since Web Audio can schedule tones directly.
const AMPLITUDE = 0.3;

let audioContext: AudioContext | null = null;
let activeOscillators: OscillatorNode[] = [];

function scheduleMetronome(ctx: AudioContext, now: number, totalMs: number, bpm: number): void {
  const beatSec = beatDurationMs(bpm) / 1000;
  let beatIndex = 0;
  for (let t = 0; t <= totalMs / 1000; t += beatSec, beatIndex++) {
    const accented = beatIndex % BEATS_PER_BAR === 0;
    const startSec = now + t;
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

export async function playNotes(notes: TabNote[], options?: PlaybackOptions): Promise<void> {
  stopPlayback();
  if (notes.length === 0) return;

  const ctx = new AudioContext();
  audioContext = ctx;
  const now = ctx.currentTime;

  for (const n of notes) {
    const freq = noteNameToFrequency(n.note);
    if (freq <= 0) continue;

    const startSec = now + n.start_time / 1000;
    const durSec    = n.duration / 1000;
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
    scheduleMetronome(ctx, now, totalMs, options.bpm);
  }
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
