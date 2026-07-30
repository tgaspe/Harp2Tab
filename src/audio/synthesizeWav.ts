import { beatDurationMs, BEATS_PER_BAR } from './tempo';
import type { TabNote } from '@/types';

const SAMPLE_RATE = 22050;
const AMPLITUDE = 0.3; // headroom, since overlapping/edited notes could stack

export interface MetronomeOptions {
  bpm:     number;
  enabled: boolean;
}

// Short percussive blip with a fast exponential decay — a click, not a tone. The first
// beat of each bar is a higher-pitched accent, same convention as a real metronome.
function addMetronomeClick(mix: Float32Array, sampleRate: number, startSample: number, accented: boolean): void {
  const freq       = accented ? 1800 : 1200;
  const amp        = accented ? 0.5 : 0.35;
  const durSamples = Math.round(sampleRate * 0.03);
  const decayRate  = sampleRate * 0.005;

  for (let i = 0; i < durSamples; i++) {
    const idx = startSample + i;
    if (idx < 0 || idx >= mix.length) continue;
    const decay = Math.exp(-i / decayRate);
    mix[idx] += amp * decay * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
}

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

/** Scientific pitch name (e.g. "G4") → frequency in Hz. Same MIDI-based formula as
 *  `HarmonicaMapper.noteToTab`, just solved for frequency instead of a tab position. */
export function noteNameToFrequency(note: string): number {
  const m = note.match(/^([A-G]#?)(\d+)$/);
  if (!m) return 0;
  const semitone = NOTE_SEMITONES[m[1]];
  if (semitone === undefined) return 0;
  const midi = (parseInt(m[2], 10) + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function writeAsciiString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function buildWavFile(pcm: Int16Array, sampleRate: number): Uint8Array {
  const blockAlign = 2; // mono, 16-bit
  const byteRate   = sampleRate * blockAlign;
  const dataSize   = pcm.length * 2;
  const buffer     = new ArrayBuffer(44 + dataSize);
  const view       = new DataView(buffer);

  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, 'WAVE');
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // audio format = PCM
  view.setUint16(22, 1, true);  // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++, offset += 2) {
    view.setInt16(offset, pcm[i], true);
  }
  return new Uint8Array(buffer);
}

/**
 * Renders a `TabNote[]` sequence to a mono 16-bit PCM WAV file — the shared synthesis
 * step behind native playback (which has no OscillatorNode equivalent, so it plays a
 * pre-rendered file instead of scheduling tones live like the web path does).
 */
export function synthesizeWav(
  notes: TabNote[],
  sampleRate: number = SAMPLE_RATE,
  metronome?: MetronomeOptions,
): Uint8Array {
  if (notes.length === 0 && !metronome?.enabled) return buildWavFile(new Int16Array(0), sampleRate);

  const totalMs = notes.reduce((max, n) => Math.max(max, n.start_time + n.duration), 0);
  const tailSamples = Math.round(sampleRate * 0.05);
  const totalSamples = Math.ceil((totalMs / 1000) * sampleRate) + tailSamples;
  const mix = new Float32Array(totalSamples);

  for (const n of notes) {
    const freq = noteNameToFrequency(n.note);
    if (freq <= 0) continue;

    const startSample = Math.floor((n.start_time / 1000) * sampleRate);
    const durSamples   = Math.floor((n.duration / 1000) * sampleRate);
    // Short fade in/out avoids audible clicks at note boundaries.
    const fadeSamples  = Math.max(1, Math.min(Math.round(sampleRate * 0.01), Math.floor(durSamples / 4)));

    for (let i = 0; i < durSamples; i++) {
      const idx = startSample + i;
      if (idx >= mix.length) break;
      let amp = AMPLITUDE;
      if (i < fadeSamples) amp *= i / fadeSamples;
      else if (i > durSamples - fadeSamples) amp *= (durSamples - i) / fadeSamples;
      mix[idx] += amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }
  }

  if (metronome?.enabled) {
    const beatMs = beatDurationMs(metronome.bpm);
    let beatIndex = 0;
    for (let t = 0; t <= totalMs; t += beatMs, beatIndex++) {
      const startSample = Math.round((t / 1000) * sampleRate);
      addMetronomeClick(mix, sampleRate, startSample, beatIndex % BEATS_PER_BAR === 0);
    }
  }

  const pcm = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) {
    const clamped = Math.max(-1, Math.min(1, mix[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return buildWavFile(pcm, sampleRate);
}
