/**
 * The spectral engine: an FFT front end, harmonic-sum salience, two-way mismatch and
 * iterative cancellation, wired into the algorithm registry.
 *
 * It exists because the other two engines each give up something this one keeps. pMPM is
 * offline and instant but monophonic by construction — one NSDF, one winning lag, one
 * frequency. Basic Pitch hears chords but is web-only, needs a ~900KB download on first use
 * and drags TensorFlow.js behind it. This one is polyphonic, offline, dependency-free and
 * pure TypeScript, so it runs on both bundles.
 *
 * **Its stated goal is the lowest octave-error rate of the three, not the most polyphony.**
 * A blow 7 reported as blow 4 is worse than a missed note: it is a plausible-looking wrong
 * answer a player will copy, and it corrupts key detection too, since `rankKeysForMidi`
 * scores whatever pitches it is handed. Three decisions follow from that and would look
 * arbitrary without it — the candidate range below, the cancellation factor in
 * `harmonicSalience.ts`, and the existence of a separate octave-evidence control.
 *
 * Deliberately *not* the general-purpose engine. Restricting candidates to the harmonica's
 * own range is most of the anti-halving benefit and it is free, but it makes this the wrong
 * choice for an arbitrary uploaded file — see `SPECTRAL_MIN_MIDI` below. Basic Pitch remains
 * the right default there.
 */

import { AudioImportError, type DecodedAudio } from '../audioImport';
import { SalienceAnalyzer, type Candidate } from '../dsp/harmonicSalience';
import { frameCountFor, StftAnalyzer, stftConfigFor } from '../dsp/stft';
import { PLAYABLE_MIDI_RANGE } from '../pitchRange';
import {
  candidatesToNotes, DEFAULT_SEGMENT_CONFIG, MAX_CANDIDATES,
  type SegmentConfig, type SpectralCandidates,
} from '../segmenters/candidatesToNotes';
import type {
  ParamValues, Prepared, PrepareOptions, Segmentation, TranscriptionAlgorithm,
  TranscriptionParam,
} from './index';

/**
 * The candidate pitch range, read from the layout tables rather than hardcoded.
 *
 * This is the single largest anti-halving measure in the engine and it costs nothing: a
 * subharmonic ghost an octave below a played note has nowhere to live, because there is no
 * candidate down there to win. It is a hypothesis space, not a filter on the audio.
 *
 * The cost, stated plainly: material recorded an octave below the harp is no longer folded
 * up by `octaveShiftForMidiRange`, because this engine never emits the low pitches that
 * fold reads. In practice it partly self-corrects — a source an octave low has its second
 * partial inside the harp's range, so the engine tends to report the octave-up reading,
 * which is what the fold would have produced — but "tends to" is not a guarantee, and it is
 * why the picker copy points people at the neural engine for other instruments.
 */
const { min: SPECTRAL_MIN_MIDI, max: SPECTRAL_MAX_MIDI } = PLAYABLE_MIDI_RANGE;

/** Sounds estimated per frame. One more than `maxVoices` can admit, so the octave probe
 *  always has a slot even in a frame that is already busy. */
const SOUNDS_PER_FRAME = MAX_CANDIDATES;

/** Frames between event-loop yields. Same value and the same reason as
 *  `analyzeSamples.ts:26` — small enough that Cancel stays responsive and the progress bar
 *  moves, large enough that yielding isn't itself the bottleneck. */
const FRAMES_PER_CHUNK = 64;

/** Silence gate, reused wholesale from `analyzeSamples.ts:33-36` so "too quiet to bother
 *  with" means the same thing in both offline engines. Gated frames skip the FFT entirely,
 *  which on a real recording is the largest single saving in the pass. */
const SILENCE_RATIO = 0.06;
const SILENCE_ABSOLUTE_FLOOR = 1e-4;

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

function yieldToEventLoop(): Promise<void> {
  // setTimeout, not a microtask — a resolved promise wouldn't let React paint the progress
  // bar or let a Cancel press be delivered between chunks.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function percentile(values: Float32Array, fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const index  = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

/**
 * The expensive pass. One STFT and one multiple-F0 estimate per frame.
 *
 * Two passes over the frames rather than one, because the silence gate is relative to *this
 * recording*: the RMS of every frame is needed before any of them can be judged quiet. The
 * first pass is a sum of squares per frame and is trivial next to the second.
 */
export async function analyzeSpectral(
  audio: DecodedAudio,
  options: PrepareOptions = {},
): Promise<SpectralCandidates> {
  const config     = stftConfigFor(audio.sampleRate);
  const frameCount = frameCountFor(audio.samples.length, config);

  const data: SpectralCandidates = {
    sampleRate:     audio.sampleRate,
    hop:            config.hop,
    frameSize:      config.frameSize,
    frameCount,
    pitch:          new Float32Array(frameCount * MAX_CANDIDATES).fill(NaN),
    salience:       new Float32Array(frameCount * MAX_CANDIDATES),
    support:        new Float32Array(frameCount * MAX_CANDIDATES),
    octaveEvidence: new Float32Array(frameCount * MAX_CANDIDATES),
    rms:            new Float32Array(frameCount),
    flux:           new Float32Array(frameCount),
  };
  if (frameCount === 0) return data;

  for (let frame = 0; frame < frameCount; frame++) {
    let sumSq = 0;
    const offset = frame * config.hop;
    for (let i = 0; i < config.frameSize; i++) {
      const s = audio.samples[offset + i];
      sumSq += s * s;
    }
    data.rms[frame] = Math.sqrt(sumSq / config.frameSize);
  }
  const gate = Math.max(SILENCE_ABSOLUTE_FLOOR, percentile(data.rms, 0.95) * SILENCE_RATIO);

  const stft     = new StftAnalyzer(config);
  const salience = new SalienceAnalyzer({
    minFrequency: midiToHz(SPECTRAL_MIN_MIDI),
    maxFrequency: midiToHz(SPECTRAL_MAX_MIDI),
    sampleRate:   audio.sampleRate,
  });
  const found: Candidate[] = [];

  for (let frame = 0; frame < frameCount; frame++) {
    if (data.rms[frame] >= gate) {
      const spectrum = stft.analyze(audio.samples, frame * config.hop);
      data.flux[frame] = spectrum.flux;

      const count = salience.analyze(spectrum, SOUNDS_PER_FRAME, found);
      for (let slot = 0; slot < count && slot < MAX_CANDIDATES; slot++) {
        const index = frame * MAX_CANDIDATES + slot;
        data.pitch[index]          = hzToMidi(found[slot].frequency);
        data.salience[index]       = found[slot].salience;
        data.support[index]        = found[slot].support;
        data.octaveEvidence[index] = found[slot].octaveEvidence;
      }
    } else {
      // Tell the analyser its phase history is broken, so the next audible frame doesn't
      // difference its phase against a frame that isn't adjacent to it.
      stft.skipFrame();
    }

    if ((frame + 1) % FRAMES_PER_CHUNK === 0) {
      if (options.shouldCancel?.()) {
        throw new AudioImportError('cancelled', 'Transcription cancelled.');
      }
      options.onProgress?.({ stage: 'analyzing', fraction: (frame + 1) / frameCount });
      await yieldToEventLoop();
    }
  }

  options.onProgress?.({ stage: 'analyzing', fraction: 1 });
  return data;
}

/**
 * The knobs, in the user's language rather than the algorithm's.
 *
 * Every one re-runs `candidatesToNotes` and nothing else — no FFT, no salience, no
 * cancellation — which is the rule for what may appear here at all. Deliberately absent, and
 * for the same reason: the window size, the hop, the whitening exponent, the harmonic
 * weighting, the two-way-mismatch constants, the cancellation factor and the candidate pitch
 * range. Every one of them re-runs the whole analysis pass.
 */
const SPECTRAL_PARAMS: readonly TranscriptionParam[] = [
  {
    id:     'onsetThreshold',
    kind:   'number',
    label:  'Onset sensitivity',
    help:   'How clearly a note has to be heard before it counts. Lower hears more, '
          + 'including some that were never played.',
    min:    0.05,
    max:    0.95,
    step:   0.05,
    default: DEFAULT_SEGMENT_CONFIG.onsetThreshold,
    format: (v) => v.toFixed(2),
  },
  {
    id:     'sustainThreshold',
    kind:   'number',
    label:  'Note confidence',
    help:   'How sure it has to stay that a note is still sounding. Lower holds notes '
          + 'through quiet moments; higher clips their tails.',
    min:    0.02,
    max:    0.90,
    step:   0.02,
    default: DEFAULT_SEGMENT_CONFIG.sustainThreshold,
    format: (v) => v.toFixed(2),
  },
  {
    id:     'octaveEvidence',
    kind:   'number',
    label:  'Octave splits',
    help:   'How much proof it takes before two notes an octave apart are both written '
          + 'down. Raise it if single notes are coming out doubled.',
    min:    0.05,
    max:    0.80,
    step:   0.05,
    default: DEFAULT_SEGMENT_CONFIG.octaveEvidence,
    format: (v) => v.toFixed(2),
  },
  {
    id:     'minNoteLengthMs',
    kind:   'number',
    label:  'Shortest note',
    help:   'Anything briefer is discarded. Raise it to clear blips; too high and fast '
          + 'passages lose their inner notes.',
    min:    12,
    max:    300,
    step:   6,
    default: DEFAULT_SEGMENT_CONFIG.minNoteLengthMs,
    format: (v) => `${Math.round(v)} ms`,
  },
  {
    id:     'maxVoices',
    kind:   'number',
    label:  'Most notes at once',
    help:   'The ceiling on simultaneous notes. Set it to 1 for a single melodic line.',
    min:    1,
    max:    5,
    step:   1,
    default: DEFAULT_SEGMENT_CONFIG.maxVoices,
    format: (v) => (v <= 1 ? 'one at a time' : `${Math.round(v)} at once`),
  },
  {
    id:     'snapToAttacks',
    kind:   'boolean',
    label:  'Snap starts to attacks',
    help:   'Moves each note back to the attack that began it, instead of to the moment it '
          + 'became certain.',
    default: DEFAULT_SEGMENT_CONFIG.snapToAttacks,
    advanced: true,
  },
  {
    id:     'bridgeMs',
    kind:   'number',
    label:  'Ride over dropouts',
    help:   'How long a gap a note survives before it ends. Higher rides over breaths; '
          + 'lower ends notes tightly.',
    min:    0,
    max:    200,
    step:   10,
    default: DEFAULT_SEGMENT_CONFIG.bridgeMs,
    format: (v) => `${Math.round(v)} ms`,
    advanced: true,
  },
];

function number(params: ParamValues, id: keyof SegmentConfig, fallback: number): number {
  const value = params[id as string];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function configFromParams(params: ParamValues): SegmentConfig {
  return {
    onsetThreshold:   number(params, 'onsetThreshold',   DEFAULT_SEGMENT_CONFIG.onsetThreshold),
    sustainThreshold: number(params, 'sustainThreshold', DEFAULT_SEGMENT_CONFIG.sustainThreshold),
    octaveEvidence:   number(params, 'octaveEvidence',   DEFAULT_SEGMENT_CONFIG.octaveEvidence),
    minNoteLengthMs:  number(params, 'minNoteLengthMs',  DEFAULT_SEGMENT_CONFIG.minNoteLengthMs),
    maxVoices:        Math.round(number(params, 'maxVoices', DEFAULT_SEGMENT_CONFIG.maxVoices)),
    bridgeMs:         number(params, 'bridgeMs',         DEFAULT_SEGMENT_CONFIG.bridgeMs),
    snapToAttacks:    typeof params.snapToAttacks === 'boolean'
      ? params.snapToAttacks
      : DEFAULT_SEGMENT_CONFIG.snapToAttacks,
  };
}

export const spectralAlgorithm: TranscriptionAlgorithm = {
  id:    'spectral',
  label: 'Spectral transcription',
  description:
    'Hears chords and double-stops, runs instantly and offline with nothing to download, '
    + 'and only ever listens inside the harmonica\'s own range. Best for harmonica takes; '
    + 'use the neural engine for other instruments.',
  available:      true,
  producesFrames: false,
  polyphonic:     true,
  params:         SPECTRAL_PARAMS,

  async prepare(audio: DecodedAudio, options: PrepareOptions = {}): Promise<Prepared> {
    const analysis = await analyzeSpectral(audio, options);
    // Held in a closure the caller can empty rather than exposed for the caller to null out,
    // matching both other engines. Far smaller than either of them — about 2MB at the
    // five-minute cap — but the tune screen releases all three the same way, so there is one
    // rule rather than an exception to remember.
    let held: SpectralCandidates | null = analysis;
    return {
      algorithm:  'spectral',
      durationMs: audio.durationMs,
      get data() { return held; },
      dispose() { held = null; },
    };
  },

  async resegment(prepared: Prepared, params: ParamValues): Promise<Segmentation> {
    const analysis = prepared.data as SpectralCandidates | null;
    // Disposed while a debounced re-segment was still in flight — only happens on the way
    // off the screen, where an error would be reported to nobody.
    if (!analysis) return { output: { kind: 'notes', notes: [] }, detectorConfig: null };
    return {
      output:         { kind: 'notes', notes: candidatesToNotes(analysis, configFromParams(params)) },
      detectorConfig: null,
    };
  },
};
