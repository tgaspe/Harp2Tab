/**
 * Does the tune screen's pitch range actually bound what Basic Pitch reports?
 *
 * The interesting part is not "are notes removed" — it is *which* notes, at the two edges.
 * `constrainFrequency` turns each bound into a bin index and clears whole columns, and its
 * low bound is inclusive while its high bound is exclusive (toMidi.ts:263). Hand it a
 * harp's top note as-is and that note disappears — the one pitch a control named after
 * that harp must never drop. So every case here probes the boundary pitches themselves,
 * not the comfortable middle.
 *
 * Runs on synthetic posteriograms rather than audio: the segmenter is a pure function of
 * the model's three matrices, so a column of activation at a known MIDI pitch is a note at
 * that pitch, with no inference and no model download.
 *
 * Run: npx tsx scripts/verify-pitch-range.ts
 */

import { basicPitchAlgorithm } from '../src/audio/algorithms/basicPitch.web';
import { harmonicaMidiRange } from '../src/audio/pitchRange';
import type { Prepared } from '../src/audio/algorithms';
import type { HarmonicaKey } from '../src/types';

/** The model's output width: MIDI 21-108, one column each. */
const N_BINS = 88;
const MIDI_OFFSET = 21;
const ROWS = 60;

/** Posteriograms holding one sustained, confidently-onset note at each given pitch. */
function posteriograms(midis: number[]) {
  const zeros = (width: number) =>
    Array.from({ length: ROWS }, () => new Array<number>(width).fill(0));
  const frames = zeros(N_BINS);
  const onsets = zeros(N_BINS);
  // Three bins per semitone, and all zero: pitch bends are not what this is testing.
  const contours = zeros(N_BINS * 3);

  for (const midi of midis) {
    const bin = midi - MIDI_OFFSET;
    onsets[5][bin] = 0.95;
    for (let row = 5; row < 40; row++) frames[row][bin] = 0.95;
  }
  return { frames, onsets, contours };
}

async function pitchesFor(midis: number[], pitchRange: HarmonicaKey | null): Promise<number[]> {
  const data = posteriograms(midis);
  const prepared: Prepared = {
    algorithm:  'basicPitch',
    durationMs: (ROWS * 256 * 1000) / 22050,
    get data() { return data; },
    dispose() {},
  };
  const segmentation = await basicPitchAlgorithm.resegment(prepared, {
    onsetThreshold:  0.5,
    frameThreshold:  0.3,
    minNoteLengthMs: 58,
    // Both off so that what comes back is the constraint's doing and nothing else's.
    melodiaTrick:    false,
    inferOnsets:     false,
    energyTolerance: 11,
    pitchRange,
  });
  const notes = segmentation.output.kind === 'notes' ? segmentation.output.notes : [];
  return [...new Set(notes.map((n) => n.midi))].sort((a, b) => a - b);
}

interface Case {
  name:     string;
  probes:   number[];
  key:      HarmonicaKey | null;
  expected: number[];
}

const G = harmonicaMidiRange('G');   // 55-92
const C = harmonicaMidiRange('C');   // 60-97

const CASES: Case[] = [
  {
    name:     'off keeps everything',
    probes:   [50, 55, 70, 92, 100],
    key:      null,
    expected: [50, 55, 70, 92, 100],
  },
  {
    name:     "G keeps its own edges and drops the semitones outside them",
    probes:   [G.min - 1, G.min, 70, G.max, G.max + 1],
    key:      'G',
    expected: [G.min, 70, G.max],
  },
  {
    name:     "C keeps its own edges and drops the semitones outside them",
    probes:   [C.min - 1, C.min, 80, C.max, C.max + 1],
    key:      'C',
    expected: [C.min, 80, C.max],
  },
  {
    name:     'a G harp rejects pitches a C harp accepts',
    probes:   [C.max, G.max],
    key:      'G',
    expected: [G.max],
  },
];

(async () => {
  let failed = 0;
  for (const testCase of CASES) {
    const actual = await pitchesFor(testCase.probes, testCase.key);
    const passed = actual.join() === testCase.expected.join();
    if (!passed) failed++;
    console.log(
      `${passed ? 'PASS' : 'FAIL'}  ${testCase.name}\n` +
      `      probes ${testCase.probes.join(' ')}  ->  ${actual.join(' ') || '(none)'}` +
      (passed ? '' : `  — expected ${testCase.expected.join(' ')}`),
    );
  }
  console.log(failed === 0 ? '\nAll cases passed.' : `\n${failed} case(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
})();
