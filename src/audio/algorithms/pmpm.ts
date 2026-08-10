/**
 * The classic tracker, as an algorithm-registry entry.
 *
 * A thin wrapper over `analyzeSamples` — the pitch detection itself is unchanged and stays
 * where it is, since the live mic path calls straight into `detectPitch` and must keep
 * bypassing this seam entirely (a 2s neural window is no use to a real-time HUD).
 *
 * Its two halves split differently from the neural engine's, and the difference is the one
 * thing to keep in mind here: the cheap half is `framesToNotes`, which segments on **tab
 * identity** and therefore needs a harmonica key. So this engine's `resegment` hands its
 * parameters onward as a segmenter configuration instead of returning notes — the frames it
 * produced are the same frames whatever the parameters say, and the notes can't exist until
 * a key does. See `Segmentation.detectorConfig`.
 */

import { analyzeSamples } from '../analyzeSamples';
import type { DecodedAudio } from '../audioImport';
import { DEFAULT_NOTE_DETECTOR_CONFIG, type NoteDetectorConfig } from '../NoteDetector';
import type {
  ParamValues, Prepared, Segmentation, TranscribeOptions, TranscriptionAlgorithm,
  TranscriptionParam,
} from './index';
import type { RawFrame } from '@/types';

/**
 * `DEFAULT_NOTE_DETECTOR_CONFIG`, unfrozen and named for players rather than for the state
 * machine that reads it.
 *
 * The analysis hop is deliberately **not** here, despite being the other number that shapes
 * what this engine hears. It belongs to `analyzeSamples` — the expensive half — so a slider
 * for it would re-run the whole DSP pass on every drag, breaking the one rule that makes
 * this screen affordable. It is also load-bearing in a way a slider can't express: the hop
 * is pinned to the live capture's frame size precisely so an uploaded file segments into
 * notes the same way a recording does, and every threshold below is calibrated against that
 * spacing. Changing it silently retunes all of them at once.
 *
 * The three noise-floor values are likewise absent: they adapt to the device and room on
 * their own, which is what they exist to do, and a control for them would be a control for
 * a measurement.
 */
const PMPM_PARAMS: readonly TranscriptionParam[] = [
  {
    id:     'confirmMs',
    kind:   'number',
    label:  'Hold before a note starts',
    help:   'How long a pitch must stay put to be believed. Lower catches fast passages; '
          + 'higher ignores slides and stray squeaks.',
    min:    10,
    max:    200,
    step:   5,
    default: DEFAULT_NOTE_DETECTOR_CONFIG.confirmMs,
    format: (v) => `${Math.round(v)} ms`,
  },
  {
    id:     'graceMs',
    kind:   'number',
    label:  'Silence before a note ends',
    help:   'How long a gap has to last to end the note. Higher rides over breaths and '
          + 'dropouts; lower ends notes tightly.',
    min:    40,
    max:    500,
    step:   10,
    default: DEFAULT_NOTE_DETECTOR_CONFIG.graceMs,
    format: (v) => `${Math.round(v)} ms`,
  },
  {
    id:     'minDurationMs',
    kind:   'number',
    label:  'Shortest note',
    help:   'Anything briefer is discarded. Raise it to clear blips; too high and fast '
          + 'passages lose their inner notes.',
    min:    20,
    max:    400,
    step:   10,
    default: DEFAULT_NOTE_DETECTOR_CONFIG.minDurationMs,
    format: (v) => `${Math.round(v)} ms`,
  },
  {
    id:     'minGapMs',
    kind:   'number',
    label:  'Shortest repeat gap',
    help:   'How much of a dip separates two hits of the same hole from one held note. '
          + 'Lower splits tongued repeats; higher keeps long notes whole.',
    min:    10,
    max:    200,
    step:   5,
    default: DEFAULT_NOTE_DETECTOR_CONFIG.minGapMs,
    format: (v) => `${Math.round(v)} ms`,
  },
  {
    id:     'dipRatio',
    kind:   'number',
    label:  'Re-attack dip depth',
    help:   'How far the sound must drop, against the note\'s own peak, for a repeat to '
          + 'begin registering.',
    min:    0.1,
    max:    0.9,
    step:   0.05,
    default: DEFAULT_NOTE_DETECTOR_CONFIG.dipRatio,
    format: (v) => v.toFixed(2),
    advanced: true,
  },
  {
    id:     'riseRatio',
    kind:   'number',
    label:  'Re-attack recovery',
    help:   'How far it must come back up to confirm one. Kept above the dip depth on '
          + 'purpose — the gap between them is what stops a wobble reading as two notes.',
    min:    0.15,
    max:    0.95,
    step:   0.05,
    default: DEFAULT_NOTE_DETECTOR_CONFIG.riseRatio,
    format: (v) => v.toFixed(2),
    advanced: true,
  },
  {
    id:     'minDipMs',
    kind:   'number',
    label:  'Shortest dip',
    help:   'How long that drop must last to count as real rather than frame noise. Around '
          + 'one analysis frame is the floor worth using.',
    min:    10,
    max:    200,
    step:   5,
    default: DEFAULT_NOTE_DETECTOR_CONFIG.minDipMs,
    format: (v) => `${Math.round(v)} ms`,
    advanced: true,
  },
];

function number(params: ParamValues, id: keyof NoteDetectorConfig): number {
  const value = params[id as string];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_NOTE_DETECTOR_CONFIG[id];
}

export const pmpmAlgorithm: TranscriptionAlgorithm = {
  id:             'pmpm',
  label:          'Classic pitch tracker',
  description:
    'Instant, runs entirely offline, and tuned for a solo harmonica line. Hears one note '
    + 'at a time, and is the only engine that records data for the Frame Inspector.',
  available:      true,
  producesFrames: true,
  polyphonic:     false,
  params:         PMPM_PARAMS,

  async prepare(audio: DecodedAudio, options: TranscribeOptions = {}): Promise<Prepared> {
    const frames = await analyzeSamples(audio, {
      onProgress:   (fraction) => options.onProgress?.({ stage: 'analyzing', fraction }),
      shouldCancel: options.shouldCancel,
    });
    let held: RawFrame[] | null = frames;
    return {
      algorithm:  'pmpm',
      durationMs: audio.durationMs,
      get data() { return held; },
      // Frames are a fraction of what the neural matrices cost — roughly 12 bytes a frame
      // against three floats per pitch bin — but the screen releases both the same way, so
      // there is one rule rather than an exception to remember.
      dispose() { held = null; },
    };
  },

  async resegment(prepared: Prepared, params: ParamValues): Promise<Segmentation> {
    const frames = (prepared.data as RawFrame[] | null) ?? [];
    return {
      // Unchanged, and deliberately not copied: nothing downstream mutates a frame stream,
      // and re-cloning several thousand frames on every slider tick would cost more than
      // the segmentation it is protecting.
      output: { kind: 'frames', frames },
      detectorConfig: {
        confirmMs:     number(params, 'confirmMs'),
        graceMs:       number(params, 'graceMs'),
        minDurationMs: number(params, 'minDurationMs'),
        minGapMs:      number(params, 'minGapMs'),
        dipRatio:      number(params, 'dipRatio'),
        riseRatio:     number(params, 'riseRatio'),
        minDipMs:      number(params, 'minDipMs'),
      },
    };
  },
};
