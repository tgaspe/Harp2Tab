/**
 * Verification harness for the spectral transcription engine.
 *
 * The engine's stated goal is the lowest octave-error rate of the three, so that is what
 * this measures first and reports loudest. A note whose pitch class is right but whose
 * octave is wrong is counted separately from a note that is simply wrong: the first is a
 * plausible-looking answer a player will copy, the second is obvious noise.
 *
 * It also measures **pMPM on the same material**, because the octave objective began as a
 * design prior rather than an observation. If the classic tracker is already near-perfect
 * here, the constraints this engine accepts to beat it are not worth paying.
 *
 * Basic Pitch is deliberately absent: it needs TensorFlow.js and an `OfflineAudioContext`,
 * neither of which exists under `tsx`. Comparing against it is a browser job.
 *
 * Run: npx tsx scripts/verify-spectral-pitch.ts
 */

import { analyzeSamples } from '../src/audio/analyzeSamples';
import { spectralAlgorithm, analyzeSpectral } from '../src/audio/algorithms/spectral';
import { defaultParams } from '../src/audio/algorithms';
import type { DecodedAudio } from '../src/audio/audioImport';
import { naiveDft, RealFft } from '../src/audio/dsp/fft';
import {
  candidatesToNotes, DEFAULT_SEGMENT_CONFIG, MAX_CANDIDATES,
} from '../src/audio/segmenters/candidatesToNotes';
import type { MidiNote } from '../src/types';

const SAMPLE_RATE = 44100;

// ── Synthesis ───────────────────────────────────────────────────────────────────
//
// `synthesizeWav.ts` already renders note sequences, but it renders *pure sine tones*
// (`synthesizeWav.ts:105`). That is both too easy for a harmonic-summation engine — there
// is nothing to sum — and too hard, since there are no partials to cancel with and no
// octave ghosts to reject. A harmonic-rich source is the only material on which this
// engine's failure modes even exist, so the harness carries its own.

interface Event {
  midi:       number;
  startMs:    number;
  durationMs: number;
  /** Emphasise upper partials and weaken the fundamental — a hand-cupped harmonica tone,
   *  and the classic trigger for reporting the octave above. */
  cupped?:    boolean;
  /** Cents of pitch bend applied over the note's length. */
  bendCents?: number;
}

const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Reed partials are slightly stretched, which is exactly the deviation the match tolerance
 *  has to absorb. */
const INHARMONICITY = 8e-6;
const PARTIALS = 8;

function synthesize(events: Event[], noiseLevel = 0): DecodedAudio {
  const endMs   = events.reduce((m, e) => Math.max(m, e.startMs + e.durationMs), 0) + 100;
  const total   = Math.ceil((endMs / 1000) * SAMPLE_RATE);
  const samples = new Float32Array(total);

  for (const event of events) {
    const start = Math.floor((event.startMs / 1000) * SAMPLE_RATE);
    const count = Math.floor((event.durationMs / 1000) * SAMPLE_RATE);
    const base  = midiToHz(event.midi);
    const fade  = Math.max(1, Math.min(Math.round(SAMPLE_RATE * 0.008), Math.floor(count / 4)));

    for (let k = 1; k <= PARTIALS; k++) {
      const partial = k * Math.sqrt(1 + INHARMONICITY * k * k);
      if (base * partial > SAMPLE_RATE * 0.45) break;

      let amplitude = 1 / k;
      if (event.cupped) amplitude = k === 1 ? 0.12 : 1 / Math.sqrt(k);

      const phase0 = Math.random() * Math.PI * 2;
      let phase = phase0;
      for (let i = 0; i < count; i++) {
        const index = start + i;
        if (index >= total) break;
        const progress = i / count;
        // A little vibrato, plus any requested bend. Both move the partials, which is what
        // makes this a pitch-tracking test rather than a spectrum-matching one.
        const cents  = (event.bendCents ?? 0) * progress + 4 * Math.sin(2 * Math.PI * 5 * i / SAMPLE_RATE);
        const freq   = base * partial * Math.pow(2, cents / 1200);
        phase += (2 * Math.PI * freq) / SAMPLE_RATE;

        let gain = amplitude;
        if (i < fade)             gain *= i / fade;
        else if (i > count - fade) gain *= (count - i) / fade;
        samples[index] += gain * Math.sin(phase);
      }
    }
  }

  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0) for (let i = 0; i < total; i++) samples[i] = (samples[i] / peak) * 0.7;
  if (noiseLevel > 0) {
    for (let i = 0; i < total; i++) samples[i] += (Math.random() * 2 - 1) * noiseLevel;
  }

  return { samples, sampleRate: SAMPLE_RATE, durationMs: endMs };
}

// ── Metrics ─────────────────────────────────────────────────────────────────────

interface OctaveStats {
  compared: number;
  correct:  number;
  halved:   number;
  doubled:  number;
  other:    number;
}

function emptyStats(): OctaveStats {
  return { compared: 0, correct: 0, halved: 0, doubled: 0, other: 0 };
}

function score(stats: OctaveStats, truth: number, reported: number): void {
  stats.compared++;
  const delta = reported - truth;
  if (delta === 0) stats.correct++;
  else if (delta % 12 === 0 && delta < 0) stats.halved++;
  else if (delta % 12 === 0 && delta > 0) stats.doubled++;
  else stats.other++;
}

function rate(stats: OctaveStats): string {
  if (stats.compared === 0) return 'no data';
  const octave = ((stats.halved + stats.doubled) / stats.compared) * 100;
  const right  = (stats.correct / stats.compared) * 100;
  return `${right.toFixed(1)}% correct, ${octave.toFixed(1)}% octave errors `
       + `(${stats.halved} halved, ${stats.doubled} doubled), ${stats.other} other`;
}

/** Ground-truth pitch sounding at a given moment, or null. Cases with one note at a time
 *  only — the frame-level comparison is meaningless for chords. */
function truthAt(events: Event[], timeMs: number): number | null {
  for (const event of events) {
    if (timeMs >= event.startMs + 30 && timeMs <= event.startMs + event.durationMs - 30) {
      return event.midi;
    }
  }
  return null;
}

// ── Frame-level comparison: the two offline engines, same audio ─────────────────

async function frameLevelOctaveErrors(events: Event[], noise = 0): Promise<{
  spectral: OctaveStats;
  pmpm:     OctaveStats;
}> {
  const audio = synthesize(events, noise);

  const spectral = emptyStats();
  const analysis = await analyzeSpectral(audio);
  for (let frame = 0; frame < analysis.frameCount; frame++) {
    const timeMs = ((frame * analysis.hop + analysis.frameSize / 2) * 1000) / analysis.sampleRate;
    const truth  = truthAt(events, timeMs);
    if (truth === null) continue;
    const pitch = analysis.pitch[frame * MAX_CANDIDATES];
    if (!Number.isFinite(pitch)) continue;
    // Only the leading candidate: this measures what the engine most believes, which is the
    // number a monophonic tracker can be compared against at all.
    score(spectral, truth, Math.round(pitch));
  }

  const pmpm   = emptyStats();
  const frames = await analyzeSamples(audio);
  for (const frame of frames) {
    if (!Number.isFinite(frame.frequency) || frame.frequency <= 0) continue;
    const truth = truthAt(events, frame.t);
    if (truth === null) continue;
    score(pmpm, truth, Math.round(69 + 12 * Math.log2(frame.frequency / 440)));
  }

  return { spectral, pmpm };
}

// ── Note-level comparison ───────────────────────────────────────────────────────

interface NoteScore {
  expected:  number;
  matched:   number;
  spurious:  number;
  octaveFp:  number;
  worstDrift: number;
}

function scoreNotes(events: Event[], notes: MidiNote[], toleranceMs = 60): NoteScore {
  const used = new Set<number>();
  let matched    = 0;
  let worstDrift = 0;

  for (const event of events) {
    for (let i = 0; i < notes.length; i++) {
      if (used.has(i)) continue;
      if (notes[i].midi !== event.midi) continue;
      const drift = Math.abs(notes[i].timeMs - event.startMs);
      if (drift > toleranceMs) continue;
      used.add(i);
      matched++;
      worstDrift = Math.max(worstDrift, drift);
      break;
    }
  }

  let octaveFp = 0;
  for (let i = 0; i < notes.length; i++) {
    if (used.has(i)) continue;
    const clash = events.some((e) =>
      (notes[i].midi - e.midi) % 12 === 0
      && notes[i].timeMs < e.startMs + e.durationMs
      && notes[i].timeMs + notes[i].durationMs > e.startMs);
    if (clash) octaveFp++;
  }

  return {
    expected: events.length,
    matched,
    spurious: notes.length - matched,
    octaveFp,
    worstDrift,
  };
}

async function transcribe(audio: DecodedAudio, overrides: Record<string, number | boolean> = {}) {
  const prepared = await spectralAlgorithm.prepare(audio);
  try {
    const params = { ...defaultParams(spectralAlgorithm), ...overrides };
    const result = await spectralAlgorithm.resegment(prepared, params);
    return result.output.kind === 'notes' ? result.output.notes : [];
  } finally {
    prepared.dispose();
  }
}

// ── Cases ───────────────────────────────────────────────────────────────────────

const HARP_C_BLOW = [60, 64, 67, 72, 76, 79, 84, 88, 91, 96]; // holes 1–10 blow, C harp
const HARP_C_DRAW = [62, 67, 71, 74, 77, 81, 83, 86, 89, 93]; // holes 1–10 draw

function ladder(midis: number[], durationMs = 350, gapMs = 120): Event[] {
  return midis.map((midi, i) => ({ midi, startMs: i * (durationMs + gapMs), durationMs }));
}

let failures = 0;

function check(label: string, passed: boolean, detail: string): void {
  if (!passed) failures++;
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${label} — ${detail}`);
}

async function main(): Promise<void> {
  console.log('\n=== 1. FFT correctness ===\n');
  {
    let worst = 0;
    for (const size of [8, 16, 64, 256, 1024]) {
      const input = new Float32Array(size);
      for (let i = 0; i < size; i++) input[i] = Math.random() * 2 - 1;
      const reference = naiveDft(input);
      const fft = new RealFft(size);
      const re  = new Float32Array(fft.bins);
      const im  = new Float32Array(fft.bins);
      fft.forward(input, re, im);
      for (let k = 0; k < fft.bins; k++) {
        worst = Math.max(worst, Math.abs(re[k] - reference.re[k]), Math.abs(im[k] - reference.im[k]));
      }
    }
    check('real FFT vs naive DFT', worst < 1e-3, `max abs error ${worst.toExponential(2)}`);
  }

  console.log('\n=== 2. Octave errors, frame level — the objective ===\n');
  {
    const cases: { name: string; events: Event[]; noise?: number }[] = [
      { name: 'C harp, all blow holes', events: ladder(HARP_C_BLOW) },
      { name: 'C harp, all draw holes', events: ladder(HARP_C_DRAW) },
      { name: 'same pitch class, 3 registers (blow 4/7/10)', events: ladder([72, 84, 96]) },
      { name: 'cupped tone, weak fundamental', events: ladder([60, 72, 84]).map((e) => ({ ...e, cupped: true })) },
      { name: 'with broadband noise', events: ladder([60, 67, 74, 81]), noise: 0.03 },
      { name: 'bends (-100 cents over the note)', events: ladder([62, 67, 74]).map((e) => ({ ...e, bendCents: -100 })) },
    ];

    let spectralTotal = emptyStats();
    let pmpmTotal     = emptyStats();

    for (const testCase of cases) {
      const { spectral, pmpm } = await frameLevelOctaveErrors(testCase.events, testCase.noise);
      console.log(`  ${testCase.name}`);
      console.log(`    spectral : ${rate(spectral)}`);
      console.log(`    pMPM     : ${rate(pmpm)}`);
      for (const key of ['compared', 'correct', 'halved', 'doubled', 'other'] as const) {
        spectralTotal[key] += spectral[key];
        pmpmTotal[key]     += pmpm[key];
      }
    }

    const spectralOctave = ((spectralTotal.halved + spectralTotal.doubled) / spectralTotal.compared) * 100;
    const pmpmOctave     = ((pmpmTotal.halved + pmpmTotal.doubled) / pmpmTotal.compared) * 100;
    console.log('');
    console.log(`  TOTAL spectral : ${rate(spectralTotal)}`);
    console.log(`  TOTAL pMPM     : ${rate(pmpmTotal)}`);
    check('spectral octave-error rate under 1%', spectralOctave < 1,
          `${spectralOctave.toFixed(2)}% (pMPM baseline ${pmpmOctave.toFixed(2)}%)`);
  }

  console.log('\n=== 3. Polyphony ===\n');
  {
    const polyCases: { name: string; events: Event[]; expectOctaveSplit?: boolean }[] = [
      { name: 'fifth (blow 2+3)',       events: [{ midi: 64, startMs: 100, durationMs: 500 }, { midi: 67, startMs: 100, durationMs: 500 }] },
      { name: 'whole tone (blow 4+5)',  events: [{ midi: 72, startMs: 100, durationMs: 500 }, { midi: 76, startMs: 100, durationMs: 500 }] },
      { name: 'triad',                  events: [{ midi: 60, startMs: 100, durationMs: 500 }, { midi: 64, startMs: 100, durationMs: 500 }, { midi: 67, startMs: 100, durationMs: 500 }] },
      { name: 'octave split (blow 1+4)', events: [{ midi: 60, startMs: 100, durationMs: 500 }, { midi: 72, startMs: 100, durationMs: 500 }], expectOctaveSplit: true },
    ];

    for (const testCase of polyCases) {
      const notes  = await transcribe(synthesize(testCase.events));
      const result = scoreNotes(testCase.events, notes);
      check(testCase.name, result.matched === result.expected && result.spurious === 0,
            `${result.matched}/${result.expected} matched, ${result.spurious} spurious, `
            + `worst onset drift ${result.worstDrift}ms`);
    }
  }

  console.log('\n=== 4. Phantom octaves on single notes (false-positive side) ===\n');
  {
    const events = ladder([60, 67, 72, 79, 84], 400, 150);
    const notes  = await transcribe(synthesize(events));
    const result = scoreNotes(events, notes);
    check('single notes produce no octave partners', result.octaveFp === 0,
          `${result.matched}/${result.expected} matched, ${result.octaveFp} octave false positives, `
          + `${result.spurious} spurious total`);

    // The control has to work in both directions, which is the whole reason it is a slider.
    const permissive = await transcribe(synthesize(events), { octaveEvidence: 0.05 });
    const strict     = await transcribe(synthesize(events), { octaveEvidence: 0.80 });
    check('octaveEvidence changes what survives', permissive.length >= strict.length,
          `permissive ${permissive.length} notes, strict ${strict.length} notes`);
  }

  console.log('\n=== 5. Timing and fast passages ===\n');
  {
    const events = ladder([72, 74, 76, 77, 79, 77, 76, 74], 125, 0); // 16ths at 120bpm
    const notes  = await transcribe(synthesize(events));
    const result = scoreNotes(events, notes, 60);
    check('16ths at 120bpm', result.matched >= events.length - 1 && result.worstDrift <= 60,
          `${result.matched}/${result.expected} matched, worst onset drift ${result.worstDrift}ms`);
  }

  console.log('\n=== 6. Re-segmentation stability ===\n');
  {
    const audio    = synthesize(ladder([60, 67, 72, 79], 400, 150));
    const analysis = await analyzeSpectral(audio);

    const counts = [0.15, 0.25, 0.35, 0.45, 0.55].map((onsetThreshold) =>
      candidatesToNotes(analysis, { ...DEFAULT_SEGMENT_CONFIG, onsetThreshold }).length);
    const monotonic = counts.every((count, i) => i === 0 || count <= counts[i - 1]);
    check('note count falls as onset threshold rises', monotonic, `[${counts.join(', ')}]`);

    const first  = candidatesToNotes(analysis, DEFAULT_SEGMENT_CONFIG);
    const second = candidatesToNotes(analysis, DEFAULT_SEGMENT_CONFIG);
    check('re-segmenting is pure', JSON.stringify(first) === JSON.stringify(second),
          `${first.length} notes both times`);
  }

  console.log('\n=== 7. Performance ===\n');
  {
    const audio = synthesize(ladder(HARP_C_BLOW.concat(HARP_C_DRAW), 400, 100));
    const began = Date.now();
    const analysis = await analyzeSpectral(audio);
    const elapsed  = Date.now() - began;
    const seconds  = audio.durationMs / 1000;
    const ratio    = elapsed / 1000 / seconds;
    console.log(`  ${seconds.toFixed(1)}s of audio in ${elapsed}ms — ${ratio.toFixed(3)}× real time`);
    console.log(`  ${analysis.frameCount} frames, `
      + `${((analysis.pitch.byteLength * 4 + analysis.rms.byteLength * 2) / 1024 / 1024).toFixed(2)}MB retained`);
    console.log(`  projected for a 5-minute take: ${(ratio * 300).toFixed(1)}s`);
    check('faster than 0.25× real time', ratio < 0.25, `${ratio.toFixed(3)}×`);
  }

  console.log('');
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
