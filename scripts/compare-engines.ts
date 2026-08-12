/**
 * Side-by-side of the spectral engine against Basic Pitch on a real recording.
 *
 * Synthetic tones tell you whether the algorithm is correct; they cannot tell you whether it
 * is *useful*. Real harmonica has breath noise, reed transients, room, and a player who
 * slides into notes — and Basic Pitch, whatever its costs, is the reference for what a good
 * transcription of that looks like. This script runs both over the same file and reports how
 * far apart they are.
 *
 * Basic Pitch normally can't run outside a browser: `basicPitch.web.ts` resamples with
 * `OfflineAudioContext` and fetches the model over HTTP. Both are replaced here — a
 * windowed-sinc decimator and a filesystem model loader — so the *segmentation* half, which
 * is the part that decides what the notes are, is the project's own unmodified code.
 *
 * Run: npx tsx scripts/compare-engines.ts <file.wav> [--write-midi]
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import * as tf from '@tensorflow/tfjs';

import { defaultParams } from '../src/audio/algorithms';
import { spectralAlgorithm } from '../src/audio/algorithms/spectral';
import { DEFAULT_BASIC_PITCH_CONFIG, segment } from '../src/audio/algorithms/basicPitch.web';
import type { DecodedAudio } from '../src/audio/audioImport';
import { shiftMidiNotes } from '../src/audio/notesToTabs';
import { isPlayableOnAnyHarmonica, octaveShiftForMidiRange } from '../src/audio/pitchRange';
import { parseWav } from '../src/audio/wav';
import type { MidiNote } from '../src/types';

const MODEL_DIR        = resolve(__dirname, '../public/models/basic-pitch');
const MODEL_SAMPLE_RATE = 22050;

// ── Resampling, without a browser ───────────────────────────────────────────────

/**
 * Windowed-sinc decimation to the model's rate.
 *
 * Not linear interpolation: `basicPitch.web.ts:118-124` explains why. Point sampling aliases
 * the upper harmonics the model reads to tell a bend from the note above it, which would
 * make this comparison a measurement of the resampler.
 */
function resample(audio: DecodedAudio, targetRate: number): Float32Array {
  if (audio.sampleRate === targetRate) return audio.samples;

  const ratio  = targetRate / audio.sampleRate;
  const cutoff = Math.min(0.5 * ratio, 0.5) * 0.9;
  const taps   = 128;
  const half   = taps / 2;

  const kernel = new Float64Array(taps + 1);
  let sum = 0;
  for (let i = 0; i <= taps; i++) {
    const x = i - half;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / taps); // Hamming
    kernel[i] = sinc * window;
    sum += kernel[i];
  }
  for (let i = 0; i <= taps; i++) kernel[i] /= sum;

  const outLength = Math.floor(audio.samples.length * ratio);
  const out = new Float32Array(outLength);
  for (let n = 0; n < outLength; n++) {
    const centre = n / ratio;
    const base   = Math.round(centre);
    let acc = 0;
    for (let i = 0; i <= taps; i++) {
      const index = base + i - half;
      if (index < 0 || index >= audio.samples.length) continue;
      acc += audio.samples[index] * kernel[i];
    }
    out[n] = acc;
  }
  return out;
}

// ── Basic Pitch, from disk ──────────────────────────────────────────────────────

async function loadModelFromDisk(): Promise<tf.GraphModel> {
  const modelPath = join(MODEL_DIR, 'model.json');
  const modelJson = JSON.parse(readFileSync(modelPath, 'utf8'));

  const specs: tf.io.WeightsManifestEntry[] = [];
  const buffers: Buffer[] = [];
  for (const group of modelJson.weightsManifest) {
    specs.push(...group.weights);
    for (const path of group.paths) buffers.push(readFileSync(join(dirname(modelPath), path)));
  }
  const merged = Buffer.concat(buffers);
  const weightData = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);

  return tf.loadGraphModel(tf.io.fromMemory({
    modelTopology: modelJson.modelTopology,
    weightSpecs:   specs,
    weightData:    weightData as ArrayBuffer,
  }));
}

async function basicPitchNotes(audio: DecodedAudio): Promise<MidiNote[]> {
  await tf.setBackend('cpu');
  await tf.ready();

  const { BasicPitch } = await import('@spotify/basic-pitch');
  const model     = loadModelFromDisk();
  const instance  = new BasicPitch(model);
  const resampled = resample(audio, MODEL_SAMPLE_RATE);

  const frames: number[][]   = [];
  const onsets: number[][]   = [];
  const contours: number[][] = [];

  let lastReported = -1;
  await instance.evaluateModel(
    resampled,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    (percent) => {
      const step = Math.floor(percent * 10);
      if (step > lastReported) {
        lastReported = step;
        process.stdout.write(`\r    inference ${Math.round(percent * 100)}%   `);
      }
    },
  );
  process.stdout.write('\r                          \r');

  // The project's own segmentation, unmodified — the half that decides what the notes are.
  return segment({ frames, onsets, contours }, DEFAULT_BASIC_PITCH_CONFIG);
}

/**
 * The reference, cached beside the recording.
 *
 * Inference costs ~95s on the CPU backend, which is fine once and intolerable inside a
 * parameter sweep. The cache holds Basic Pitch's *raw* output so the post-processing stays
 * live — that part is the app's own code and is exactly what a change to it should be
 * visible in.
 */
async function loadReference(file: string, audio: DecodedAudio): Promise<MidiNote[]> {
  const cachePath = file.replace(/\.wav$/i, '.basicpitch.json');
  if (existsSync(cachePath)) {
    console.log('Basic Pitch (cached)');
    return JSON.parse(readFileSync(cachePath, 'utf8')) as MidiNote[];
  }
  console.log('Basic Pitch (reference)…');
  const notes = await basicPitchNotes(audio);
  writeFileSync(cachePath, JSON.stringify(notes));
  console.log(`  cached to ${cachePath}`);
  return notes;
}

/** Basic Pitch's raw notes → what the app would actually show. */
function asAppShows(notes: MidiNote[]): MidiNote[] {
  const shift = octaveShiftForMidiRange(notes.map((n) => n.midi));
  return shiftMidiNotes(notes, shift).filter((n) => isPlayableOnAnyHarmonica(n.midi));
}

function f1Against(reference: MidiNote[], subject: MidiNote[], toleranceMs = 100): number {
  const a = agreement(reference, subject, toleranceMs);
  const recall    = reference.length ? a.matched / reference.length : 0;
  const precision = subject.length   ? a.matched / subject.length   : 0;
  return precision + recall > 0 ? (200 * precision * recall) / (precision + recall) : 0;
}

/**
 * Grid search over the segmentation parameters, scored against Basic Pitch.
 *
 * Only the cheap half re-runs — that is the whole point of the two-phase split, and it is
 * what makes a sweep of this size take seconds rather than hours.
 */
async function sweep(audio: DecodedAudio, reference: MidiNote[]): Promise<void> {
  const prepared = await spectralAlgorithm.prepare(audio);
  const base     = defaultParams(spectralAlgorithm);

  const grid = {
    onsetThreshold:   [0.20, 0.25, 0.30, 0.35, 0.40],
    sustainThreshold: [0.08, 0.12, 0.15, 0.20],
    bridgeMs:         [30, 46, 70, 100],
    minNoteLengthMs:  [40, 58, 80],
    octaveEvidence:   [0.15, 0.20, 0.30, 0.50],
  } as const;

  let best = { score: -1, params: base, count: 0 };
  let evaluated = 0;

  for (const onsetThreshold of grid.onsetThreshold) {
    for (const sustainThreshold of grid.sustainThreshold) {
      if (sustainThreshold >= onsetThreshold) continue;
      for (const bridgeMs of grid.bridgeMs) {
        for (const minNoteLengthMs of grid.minNoteLengthMs) {
          for (const octaveEvidence of grid.octaveEvidence) {
            const params = {
              ...base, onsetThreshold, sustainThreshold, bridgeMs, minNoteLengthMs, octaveEvidence,
            };
            const result = await spectralAlgorithm.resegment(prepared, params);
            const notes  = result.output.kind === 'notes' ? result.output.notes : [];
            const score  = f1Against(reference, notes);
            evaluated++;
            if (score > best.score) best = { score, params, count: notes.length };
          }
        }
      }
    }
  }

  prepared.dispose();
  console.log(`\n─── Sweep (${evaluated} parameter sets, cheap half only) ───`);
  console.log(`  best F1 ${best.score.toFixed(1)}% with ${best.count} notes`);
  for (const [key, value] of Object.entries(best.params)) {
    const changed = base[key] !== value ? '  <- changed' : '';
    console.log(`    ${key.padEnd(18)} ${String(value).padEnd(6)}${changed}`);
  }
}

// ── Comparison ──────────────────────────────────────────────────────────────────

interface Agreement {
  matched:      number;
  onlyReference: number;
  onlySubject:  number;
  medianDrift:  number;
}

/** Greedy one-to-one match on (same pitch, onset within tolerance). */
function agreement(reference: MidiNote[], subject: MidiNote[], toleranceMs: number): Agreement {
  const used   = new Set<number>();
  const drifts: number[] = [];

  for (const note of reference) {
    let best      = -1;
    let bestDrift = toleranceMs + 1;
    for (let i = 0; i < subject.length; i++) {
      if (used.has(i) || subject[i].midi !== note.midi) continue;
      const drift = Math.abs(subject[i].timeMs - note.timeMs);
      if (drift < bestDrift) { bestDrift = drift; best = i; }
    }
    if (best >= 0) { used.add(best); drifts.push(subject[best].timeMs - note.timeMs); }
  }

  drifts.sort((a, b) => a - b);
  return {
    matched:       drifts.length,
    onlyReference: reference.length - drifts.length,
    onlySubject:   subject.length - drifts.length,
    medianDrift:   drifts.length ? drifts[Math.floor(drifts.length / 2)] : NaN,
  };
}

function describe(label: string, notes: MidiNote[], durationMs: number): void {
  if (notes.length === 0) { console.log(`  ${label}: no notes`); return; }
  const pitches   = notes.map((n) => n.midi).sort((a, b) => a - b);
  const durations = notes.map((n) => n.durationMs).sort((a, b) => a - b);
  const sounding  = notes.reduce((sum, n) => sum + n.durationMs, 0);

  // How often more than one note is sounding — the polyphony the engine actually reports.
  let overlapping = 0;
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      if (notes[j].timeMs >= notes[i].timeMs + notes[i].durationMs) break;
      overlapping++;
    }
  }

  console.log(`  ${label}`);
  console.log(`    notes           ${notes.length}`);
  console.log(`    pitch range     ${pitches[0]}–${pitches[pitches.length - 1]} `
            + `(median ${pitches[Math.floor(pitches.length / 2)]})`);
  console.log(`    median duration ${durations[Math.floor(durations.length / 2)]}ms`);
  console.log(`    note density    ${(notes.length / (durationMs / 1000)).toFixed(2)}/s`);
  console.log(`    polyphony       ${overlapping} overlapping pairs, `
            + `${((sounding / durationMs) * 100).toFixed(0)}% cumulative sounding`);
}

function pitchHistogram(label: string, notes: MidiNote[]): void {
  const counts = new Map<number, number>();
  for (const note of notes) counts.set(note.midi, (counts.get(note.midi) ?? 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`  ${label}: ` + rows.map(([midi, count]) => `${midi}×${count}`).join('  '));
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npx tsx scripts/compare-engines.ts <file.wav> [--write-midi]');
    process.exit(1);
  }

  const bytes = readFileSync(file);
  const audio = parseWav(new Uint8Array(bytes), file);
  console.log(`\n${file}`);
  console.log(`${(audio.durationMs / 1000).toFixed(1)}s, ${audio.sampleRate}Hz, `
            + `${audio.samples.length} samples\n`);

  const bpBegan = Date.now();
  const rawReference = await loadReference(file, audio);
  const bpElapsed = Date.now() - bpBegan;

  // What the app would actually show. Basic Pitch's raw output on a harmonica take contains
  // a substantial tail of notes far below any harmonica — breath noise and room read as
  // pitch — and `transcription.ts` removes them before anything reaches the editor. The
  // spectral engine cannot produce them at all, since its candidate range is the harp's, so
  // comparing against the unfiltered output would score it down for a class of error it is
  // structurally incapable of making. Same two steps, same order, as the note lane.
  const reference = asAppShows(rawReference);

  console.log('Spectral…');
  const spBegan = Date.now();
  const prepared = await spectralAlgorithm.prepare(audio);
  const result   = await spectralAlgorithm.resegment(prepared, defaultParams(spectralAlgorithm));
  const subject  = result.output.kind === 'notes' ? result.output.notes : [];
  prepared.dispose();
  const spElapsed = Date.now() - spBegan;

  console.log(`\n─── Timing ───`);
  console.log(`  Basic Pitch ${(bpElapsed / 1000).toFixed(1)}s   Spectral ${(spElapsed / 1000).toFixed(1)}s`
            + `   (${(bpElapsed / spElapsed).toFixed(1)}× faster)`);

  console.log(`\n─── Shape ───`);
  describe('Basic Pitch (raw)', rawReference, audio.durationMs);
  describe('Basic Pitch (as the app shows it)', reference, audio.durationMs);
  describe('Spectral',    subject,   audio.durationMs);

  console.log(`\n─── Pitch content (top 10) ───`);
  pitchHistogram('Basic Pitch', reference);
  pitchHistogram('Spectral   ', subject);

  console.log(`\n─── Agreement ───`);
  for (const tolerance of [50, 100, 200]) {
    const a = agreement(reference, subject, tolerance);
    const recall    = (a.matched / reference.length) * 100;
    const precision = subject.length ? (a.matched / subject.length) * 100 : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    console.log(`  ±${tolerance}ms: ${a.matched} matched  `
              + `recall ${recall.toFixed(0)}%  precision ${precision.toFixed(0)}%  F1 ${f1.toFixed(0)}%  `
              + `median drift ${Number.isNaN(a.medianDrift) ? '—' : `${a.medianDrift}ms`}`);
  }

  // Octave relationships between what one engine found and the other missed: the specific
  // disagreement this engine was built to avoid.
  const unmatched = agreement(reference, subject, 100);
  console.log(`\n─── Octave disagreement ───`);
  let octaveOff = 0;
  for (const note of subject) {
    const partner = reference.find((r) =>
      Math.abs(r.timeMs - note.timeMs) < 100 && (note.midi - r.midi) % 12 === 0 && note.midi !== r.midi);
    if (partner) octaveOff++;
  }
  console.log(`  spectral notes that are an octave off a Basic Pitch note: ${octaveOff}`);
  console.log(`  spectral notes with no Basic Pitch counterpart at all:    ${unmatched.onlySubject}`);
  console.log(`  Basic Pitch notes the spectral engine missed:             ${unmatched.onlyReference}`);

  if (process.argv.includes('--sweep')) await sweep(audio, reference);

  if (process.argv.includes('--write-midi')) {
    for (const [name, notes] of [['basicpitch', reference], ['spectral', subject]] as const) {
      const path = file.replace(/\.wav$/i, `.${name}.json`);
      writeFileSync(path, JSON.stringify(notes, null, 2));
      console.log(`  wrote ${path}`);
    }
  }
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
