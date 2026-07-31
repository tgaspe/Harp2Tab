// Ported from aubio's `aubio_notes_do` (src/notes/notes.c, Paul Brossier, GPLv3 —
// https://github.com/aubio/aubio), aubio's purpose-built monophonic note-segmentation
// algorithm ("Fast labelling of notes in music signals", Brossier 2004). This is a fresh
// TypeScript reimplementation of the algorithm's decision logic, not a copy of aubio's C
// source — same control flow and defaults, our own code.
//
// The real algorithm combines three independent signals:
//  - an onset detector (aubio defaults to a spectral method, "HFC" — High Frequency
//    Content) that fires whenever a new attack transient is detected, silence or not
//  - a dB-level silence test, checked independently of onset detection
//  - a "release drop": the note ends if the level falls more than `releaseDropDb` below
//    whatever the level was at its last onset — a simpler, non-adaptive alternative to the
//    adaptive-floor approach the rest of this codebase uses
//
// and a debounced, median-smoothed pitch: every frame's raw pitch (rounded to the nearest
// semitone) rolls into a fixed-size window; `medianFrames` frames after an onset arms it,
// the median of that window becomes the committed note's pitch — smoothing over the
// unstable pitch reading right at an attack's transient, at the cost of a small reporting
// delay (fewer than `medianFrames` frames after the true onset).
//
// One real deviation from the source: aubio's default onset detector needs the FFT
// spectrum, which isn't available here — this codebase's segmenters only ever see
// per-frame {frequency, rms}, no raw samples or spectral bins. Onset events are
// approximated with this codebase's existing adaptive-threshold peak-relative dip/rise
// gate (envelope.ts's createEnvelopeGate — the same "is a new attack happening" signal the
// other segmenters use), treating its 'start' and 'split' events as onsets. Silence and
// release-drop are ported faithfully in dB, exactly as aubio computes them from RMS.

import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';
import { frequencyToTab } from '../HarmonicaMapper';
import { createEnvelopeGate, type EnvelopeConfig } from './envelope';

export interface AubioNotesSegmenterConfig extends EnvelopeConfig {
  silenceDb:     number; // aubio: AUBIO_DEFAULT_NOTES_SILENCE — level below this counts as silent
  releaseDropDb: number; // aubio: AUBIO_DEFAULT_NOTES_RELEASE_DROP — note ends once level falls this far below its level at the last onset
  minOnsetGapMs: number; // aubio: minioi_ms — ignore onset events closer together than this
  medianFrames:  number; // aubio: `median` — frames of pitch history averaged (median) before a note commits
  minMidi:       number; // aubio: hardcoded floor of 45 — committed notes below this MIDI pitch are rejected
}

export const DEFAULT_AUBIO_NOTES_CONFIG: AubioNotesSegmenterConfig = {
  floorMs:             2000,
  thresholdMult:       2.5,
  hysteresisLowRatio:  0.7,
  minFloorAbs:         0.001,
  hangoverMs:          40,
  dipRatio:            0.5,
  riseRatio:           0.65,
  minDipMs:            30,
  silenceDb:           -70,
  releaseDropDb:       10,
  minOnsetGapMs:       30,
  medianFrames:        6,
  minMidi:             45,
};

function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function dbOf(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -999;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface SegmentFrame { frequency: number; rms: number }

export function createAubioNotesSegmenter(
  onNote: (n: Omit<TabNote, 'id'>) => void,
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  configOverrides?: Partial<AubioNotesSegmenterConfig>,
) {
  const cfg: AubioNotesSegmenterConfig = { ...DEFAULT_AUBIO_NOTES_CONFIG, ...configOverrides };
  const gate = createEnvelopeGate(cfg);

  // Rolling window of the last `medianFrames` raw pitch readings (MIDI, rounded to the
  // nearest semitone) — updated every frame regardless of onset/note state, exactly like
  // aubio's note_buffer / note_append.
  let pitchBuffer: number[] = [];

  let curNoteMidi = 0;       // 0 == no note open, mirrors aubio's curnote
  let curNoteConfidence = 100;
  let noteStartMs = 0;
  let armedOnsetMs = 0;      // when isReady was last set to 1 — the note's *true* onset time
  let lastOnsetLevelDb = cfg.silenceDb;
  let isReady = 0;           // 0 = not counting; counts 1..medianFrames after an onset arms it
  let lastAcceptedOnsetMs = -Infinity;
  let lastMs = 0;

  function commitNoteOff(endMs: number, recordingStartMs: number) {
    if (curNoteMidi === 0) return;
    const duration = endMs - noteStartMs;
    if (duration > 0) {
      const result = frequencyToTab(midiToFrequency(curNoteMidi), key, harmonicaType);
      if (result) {
        onNote({
          tab:        result.tab,
          note:       result.note,
          duration,
          start_time: noteStartMs - recordingStartMs,
          confidence: curNoteConfidence,
        });
      }
    }
    curNoteMidi = 0;
  }

  function resetState() {
    gate.reset();
    pitchBuffer = [];
    curNoteMidi = 0;
    isReady = 0;
    lastOnsetLevelDb = cfg.silenceDb;
    lastAcceptedOnsetMs = -Infinity;
  }

  return {
    reset() {
      resetState();
    },

    flush(recordingStartMs: number) {
      commitNoteOff(lastMs, recordingStartMs);
      resetState();
    },

    process(frame: SegmentFrame, now: number, recordingStartMs: number) {
      lastMs = now;

      // Silence/invalid readings append 0 (aubio's pitch detector does the same on
      // silence) — combined with the minMidi floor below, this naturally suppresses
      // committing a note whose median window was mostly silence, without a separate check.
      const validPitch = isFinite(frame.frequency) && frame.frequency > 0;
      const roundedMidi = validPitch ? Math.round(frequencyToMidi(frame.frequency)) : 0;
      pitchBuffer.push(roundedMidi);
      if (pitchBuffer.length > cfg.medianFrames) pitchBuffer.shift();

      const { event } = gate.step(frame.rms, now);
      const isOnset = (event?.type === 'start' || event?.type === 'split')
        && now - lastAcceptedOnsetMs >= cfg.minOnsetGapMs;

      const levelDb = dbOf(frame.rms);
      const silent  = levelDb < cfg.silenceDb;

      if (isOnset) {
        lastAcceptedOnsetMs = now;
        if (silent) {
          isReady = 0;
          commitNoteOff(now, recordingStartMs);
        } else {
          isReady = 1;
          armedOnsetMs = now;
          lastOnsetLevelDb = levelDb;
        }
        return;
      }

      if (levelDb < lastOnsetLevelDb - cfg.releaseDropDb) {
        commitNoteOff(now, recordingStartMs);
        lastOnsetLevelDb = cfg.silenceDb;
        return;
      }

      if (isReady > 0) {
        isReady++;
        if (isReady === cfg.medianFrames) {
          // The old note's end and the new note's start are the same instant — the true
          // onset that armed this commit, not `now` (which is delayed by the median wait).
          commitNoteOff(armedOnsetMs, recordingStartMs);
          const newNoteMidi = median(pitchBuffer);
          if (newNoteMidi > cfg.minMidi) {
            // aubio has no confidence concept of its own — this is a display-only addition
            // so low-agreement commits fade in the Notes track like the other variants do.
            const agreement = pitchBuffer.filter((m) => m === Math.round(newNoteMidi)).length / pitchBuffer.length;
            curNoteMidi       = newNoteMidi;
            curNoteConfidence = Math.round(agreement * 100);
            noteStartMs       = armedOnsetMs;
          }
        }
      }
    },
  };
}
