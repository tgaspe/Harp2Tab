/**
 * HSA v2 — the offline polyphonic engine. A port of `HSA_v2_polyphonic.ipynb`.
 *
 * CQT harmonic summation with iterative estimation and cancellation. Hears chords and
 * double-stops, and — through `reattack.ts` — is the first note-lane engine that writes a
 * repeated note as separate notes instead of one long one.
 *
 * Replaces the spectral engine (Phase 14). What went with it: the odd-harmonic octave probe,
 * the `octaveEvidence` control, and the harmonica-range candidate restriction. HSA v2
 * measured octave splits as not worth exploiting (notebook §9 — the excess amplitude is real
 * but modest) and that trade is accepted here.
 *
 * ## Why the resampling
 *
 * Every constant in `HSA_CQT_CONFIG` and `hsaPoly.ts` is pinned to 44.1kHz, and
 * `decodeAudio.web.ts` returns the AudioContext's own rate — usually 48k. Resampling here,
 * and only here, is what makes this engine directly comparable to the notebook rather than
 * approximately so, and it is why `verify-hsa.ts` can assert frame-for-frame equality
 * against a Python dump at all. Same reasoning and same mechanism as `basicPitch.web.ts:125`.
 */

import { AudioImportError, type DecodedAudio } from '../audioImport';
import { CqtAnalyzer, HSA_CQT_CONFIG, cqtFrameCount } from '../dsp/cqt';
import { analyzePoly, MAX_VOICES, type PolyFrames } from '../dsp/hsaPoly';
import { DEFAULT_REATTACK_CONFIG } from '../segmenters/reattack';
import {
  hsaToNotes, DEFAULT_HSA_SEGMENT_CONFIG, type HsaSegmentConfig,
} from '../segmenters/hsaToNotes';
import type {
  ParamValues, PrepareOptions, Prepared, Segmentation, TranscriptionAlgorithm,
  TranscriptionParam,
} from './index';

const TARGET_SAMPLE_RATE = HSA_CQT_CONFIG.sampleRate;
const HOP = HSA_CQT_CONFIG.hop;
/** The RMS window, from the notebook's `FRAME_SIZE`. Only the voicing gate and the re-attack
 *  envelope use it — the CQT sets its own window per bin from Q. */
const RMS_FRAME = 1024;
/** −20dB relative to the take's loudest frame, the notebook's `ENERGY_THRESHOLD_DB`. */
const GATE_RATIO = 0.1;

export interface HsaAnalysis extends PolyFrames {
  sampleRate: number;
  hop:        number;
  /** Per frame, from the raw samples — what `reattack.ts` reads. */
  rms:        Float32Array;
  /** Per frame, 1 where the gate passed. Stored rather than recomputed: the gate is relative
   *  to the take's maximum, which the cheap half would otherwise have to re-derive on every
   *  slider drag. */
  voiced:     Uint8Array;
  /** Half-wave-rectified CQT flux. Places onsets; never detects them. */
  flux:       Float32Array;
}

async function resampleTo44k(audio: DecodedAudio): Promise<Float32Array> {
  if (audio.sampleRate === TARGET_SAMPLE_RATE) return audio.samples;

  const targetLength = Math.max(
    1,
    Math.ceil((audio.samples.length * TARGET_SAMPLE_RATE) / audio.sampleRate),
  );
  const ctx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const buffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
  // `.set` rather than `copyToChannel`, which is typed against a plain-ArrayBuffer-backed
  // Float32Array and rejects the decoder's. Same single copy either way.
  buffer.getChannelData(0).set(audio.samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/**
 * Frame RMS, matching `librosa.feature.rms(frame_length=1024, hop_length=512, center=True)`.
 *
 * The reflect padding is not decoration: it is what makes frame *i* centred on sample
 * `i * hop`, which is what keeps this envelope aligned with the CQT's own frames. Without it
 * every re-attack would be reported half a window early, and the fixture comparison in
 * `verify-hsa.ts` would drift against the Python gate.
 */
function frameRms(samples: Float32Array): Float32Array {
  const pad   = RMS_FRAME / 2;
  const count = cqtFrameCount(samples.length, HOP);
  const out   = new Float32Array(count);
  const last  = samples.length - 1;

  const at = (i: number): number => {
    // np.pad(..., mode='reflect'): mirrors without repeating the edge sample.
    let j = i - pad;
    if (j < 0) j = -j;
    if (j > last) j = 2 * last - j;
    return j >= 0 && j <= last ? samples[j] : 0;
  };

  for (let f = 0; f < count; f++) {
    let sumSq = 0;
    for (let i = 0; i < RMS_FRAME; i++) {
      const s = at(f * HOP + i);
      sumSq += s * s;
    }
    out[f] = Math.sqrt(sumSq / RMS_FRAME);
  }
  return out;
}

export async function analyzeHsa(
  audio: DecodedAudio,
  options: PrepareOptions = {},
): Promise<HsaAnalysis> {
  const samples = await resampleTo44k(audio);

  const rms = frameRms(samples);
  let peak = 0;
  for (const v of rms) if (v > peak) peak = v;
  const gate   = peak * GATE_RATIO;
  const voiced = Uint8Array.from(rms, (v) => (v >= gate ? 1 : 0));

  const analyzer = await CqtAnalyzer.create(HSA_CQT_CONFIG);
  let cqt;
  try {
    cqt = await analyzer.analyze(samples, {
      // The CQT is the overwhelming majority of the wall clock, so it owns almost all of the
      // progress bar; the poly pass that follows is ~2% of it.
      onProgress:   (fraction) => options.onProgress?.({ stage: 'analyzing', fraction: fraction * 0.95 }),
      shouldCancel: options.shouldCancel,
    });
  } finally {
    analyzer.dispose();
  }
  if (options.shouldCancel?.()) {
    throw new AudioImportError('cancelled', 'Transcription cancelled.');
  }

  const frameCount = Math.min(cqt.frameCount, rms.length);
  const flux = new Float32Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    let sum = 0;
    for (let b = 0; b < cqt.nBins; b++) {
      const d = cqt.data[f * cqt.nBins + b] - cqt.data[(f - 1) * cqt.nBins + b];
      if (d > 0) sum += d;
    }
    flux[f] = sum;
  }

  const poly = analyzePoly(cqt, HSA_CQT_CONFIG, voiced);
  options.onProgress?.({ stage: 'analyzing', fraction: 1 });

  return {
    ...poly,
    sampleRate: TARGET_SAMPLE_RATE,
    hop:        HOP,
    rms:        rms.subarray(0, poly.frameCount),
    voiced:     voiced.subarray(0, poly.frameCount),
    flux,
  };
}

/**
 * The knobs, in the user's language rather than the algorithm's.
 *
 * Every one re-runs `hsaToNotes` and nothing else — no resampling, no CQT, no cancellation.
 * That is the rule for what may appear here at all. Deliberately absent for the same reason:
 * the sample rate, the hop, the bins per octave, the harmonic count and weights, and
 * `cancel_factor`. Each of them re-runs the whole analysis pass, and `cancel_factor` is not
 * a concept a player can reason about anyway.
 */
const HSA_PARAMS: readonly TranscriptionParam[] = [
  {
    id:     'relThreshold',
    kind:   'number',
    label:  'Chord sensitivity',
    help:   'How loud a second note must be, next to the loudest one, to be written down '
          + 'too. Lower hears more of a chord, including notes that were never played.',
    min:    0.30, max: 0.90, step: 0.05,
    default: DEFAULT_HSA_SEGMENT_CONFIG.relThreshold,
    format: (v) => v.toFixed(2),
  },
  {
    id:     'onsetThreshold',
    kind:   'number',
    label:  'Onset sensitivity',
    help:   'How clearly a note has to be heard before it starts. Lower catches quiet '
          + 'entries; higher waits for certainty.',
    min:    0.35, max: 1.00, step: 0.05,
    default: DEFAULT_HSA_SEGMENT_CONFIG.onsetThreshold,
    format: (v) => v.toFixed(2),
  },
  {
    id:     'maxVoices',
    kind:   'number',
    label:  'Most notes at once',
    help:   'The ceiling on simultaneous notes. Set it to 1 for a single melodic line.',
    min:    1, max: 4, step: 1,
    default: DEFAULT_HSA_SEGMENT_CONFIG.maxVoices,
    format: (v) => (v <= 1 ? 'one at a time' : `${Math.round(v)} at once`),
  },
  {
    id:     'minNoteLengthMs',
    kind:   'number',
    label:  'Shortest note',
    help:   'Anything briefer is discarded. Raise it to clear blips; too high and fast '
          + 'passages lose their inner notes.',
    min:    12, max: 300, step: 6,
    default: DEFAULT_HSA_SEGMENT_CONFIG.minNoteLengthMs,
    format: (v) => `${Math.round(v)} ms`,
  },
  {
    id:     'splitRepeats',
    kind:   'boolean',
    label:  'Split repeated notes',
    help:   'Writes a tongued repeat as separate notes instead of one held one, by listening '
          + 'for the dip between them.',
    default: DEFAULT_HSA_SEGMENT_CONFIG.splitRepeats,
  },
  {
    id:     'bridgeMs',
    kind:   'number',
    label:  'Ride over dropouts',
    help:   'How long a gap a note survives before it ends. Higher rides over breaths; '
          + 'lower ends notes tightly.',
    min:    0, max: 200, step: 10,
    default: DEFAULT_HSA_SEGMENT_CONFIG.bridgeMs,
    format: (v) => `${Math.round(v)} ms`,
    advanced: true,
  },
  {
    id:     'snapToAttacks',
    kind:   'boolean',
    label:  'Snap starts to attacks',
    help:   'Moves each note back to the attack that began it, instead of to the moment it '
          + 'became certain.',
    default: DEFAULT_HSA_SEGMENT_CONFIG.snapToAttacks,
    advanced: true,
  },
  {
    id:     'dipRatio',
    kind:   'number',
    label:  'Re-attack dip depth',
    help:   'How far the sound must drop, against the note\'s own peak, for a repeat to '
          + 'begin registering.',
    min:    0.10, max: 0.90, step: 0.05,
    default: DEFAULT_REATTACK_CONFIG.dipRatio,
    format: (v) => v.toFixed(2),
    advanced: true,
  },
  {
    id:     'riseRatio',
    kind:   'number',
    label:  'Re-attack recovery',
    help:   'How far it must come back up to confirm one. Kept above the dip depth on '
          + 'purpose — the gap between them is what stops a wobble reading as two notes.',
    min:    0.15, max: 0.95, step: 0.05,
    default: DEFAULT_REATTACK_CONFIG.riseRatio,
    format: (v) => v.toFixed(2),
    advanced: true,
  },
  {
    id:     'minDipMs',
    kind:   'number',
    label:  'Shortest dip',
    help:   'How long that drop must last to count as real rather than frame noise.',
    min:    10, max: 200, step: 5,
    default: DEFAULT_REATTACK_CONFIG.minDipMs,
    format: (v) => `${Math.round(v)} ms`,
    advanced: true,
  },
];

function number(params: ParamValues, id: string, fallback: number): number {
  const value = params[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolean(params: ParamValues, id: string, fallback: boolean): boolean {
  const value = params[id];
  return typeof value === 'boolean' ? value : fallback;
}

function configFromParams(params: ParamValues): HsaSegmentConfig {
  const d = DEFAULT_HSA_SEGMENT_CONFIG;
  return {
    relThreshold:    number(params, 'relThreshold',    d.relThreshold),
    onsetThreshold:  number(params, 'onsetThreshold',  d.onsetThreshold),
    maxVoices:       Math.round(number(params, 'maxVoices', d.maxVoices)),
    minNoteLengthMs: number(params, 'minNoteLengthMs', d.minNoteLengthMs),
    bridgeMs:        number(params, 'bridgeMs',        d.bridgeMs),
    snapToAttacks:   boolean(params, 'snapToAttacks',  d.snapToAttacks),
    splitRepeats:    boolean(params, 'splitRepeats',   d.splitRepeats),
    reattack: {
      ...DEFAULT_REATTACK_CONFIG,
      dipRatio:  number(params, 'dipRatio',  DEFAULT_REATTACK_CONFIG.dipRatio),
      riseRatio: number(params, 'riseRatio', DEFAULT_REATTACK_CONFIG.riseRatio),
      minDipMs:  number(params, 'minDipMs',  DEFAULT_REATTACK_CONFIG.minDipMs),
    },
  };
}

export const hsaAlgorithm: TranscriptionAlgorithm = {
  id:    'hsa',
  label: 'Harmonic transcription (HSA v2)',
  description:
    'Hears chords and double-stops, and is the only engine that writes a repeated note as '
    + 'separate notes rather than one long one. Runs in the browser with no network round '
    + 'trip. Best for harmonica takes.',
  available:      true,
  producesFrames: false,
  polyphonic:     true,
  params:         HSA_PARAMS,

  async prepare(audio: DecodedAudio, options: PrepareOptions = {}): Promise<Prepared> {
    const analysis = await analyzeHsa(audio, options);
    // Held in a closure the caller can empty rather than exposed for the caller to null out,
    // matching every other engine. ~1.1MB at the five-minute cap, against ~90MB for Basic
    // Pitch's matrices — but the tune screen releases them the same way, so there is one
    // rule rather than an exception to remember.
    let held: HsaAnalysis | null = analysis;
    return {
      algorithm:  'hsa',
      durationMs: audio.durationMs,
      get data() { return held; },
      dispose() { held = null; },
    };
  },

  async resegment(prepared: Prepared, params: ParamValues): Promise<Segmentation> {
    const analysis = prepared.data as HsaAnalysis | null;
    // Disposed while a debounced re-segment was still in flight — only happens on the way
    // off the screen, where an error would be reported to nobody.
    if (!analysis) return { output: { kind: 'notes', notes: [] }, detectorConfig: null };
    return {
      output:         { kind: 'notes', notes: hsaToNotes(analysis, configFromParams(params)) },
      detectorConfig: null,
    };
  },
};

export { MAX_VOICES };
