import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';
import { frequencyToTab } from './HarmonicaMapper';

export interface NoteDetectorConfig {
  graceMs:          number;  // silence must persist this long to end a run
  confirmMs:        number;  // a new tab must persist this long to start a run
  minDurationMs:    number;  // committed runs shorter than this are discarded
  minGapMs:         number;  // a same-tab re-attack must have a real RMS dip at least this long to split (filters single-frame glitches, below graceMs so it beats the "resume before grace expires" merge)

  // Amplitude-envelope onset detector: catches re-attacks of the same tab (e.g. tongued
  // repeats) whose RMS dip never crosses the native silence-gate threshold, which defaults
  // to 0 and often never gates `tab` to null between two fast identical notes.
  dipRatio:         number;  // rms must fall to <= this fraction of the local peak to start a dip
  riseRatio:        number;  // rms must recover to >= this fraction of the local peak to confirm a re-attack (hysteresis above dipRatio)
  minDipMs:         number;  // dip must last this long (~1 native window) to count as real, not frame noise

  // Raw rms is an absolute value whose scale varies by device (mic gain, AGC, etc.), so a
  // fixed "quiet note" cutoff isn't portable. Instead, learn this device/environment's
  // ambient noise floor live from frames seen during confirmed silence, and require a note's
  // peak to clear a multiple of it before onset (dip) detection is trusted.
  noiseFloorAlpha:  number;  // EMA smoothing factor for the ambient floor (~2s time constant at ~43ms frames)
  noiseFloorMult:   number;  // envelope peak must exceed this multiple of the ambient floor for onset detection to run
  minPeakRmsFloor:  number;  // absolute fallback used only before any ambient noise has been sampled yet
}

export const DEFAULT_NOTE_DETECTOR_CONFIG: NoteDetectorConfig = {
  graceMs:         150,
  confirmMs:       40,
  minDurationMs:   110,
  minGapMs:        60,
  dipRatio:        0.5,
  riseRatio:       0.65,
  minDipMs:        50,
  noiseFloorAlpha: 0.02,
  noiseFloorMult:  2.5,
  minPeakRmsFloor: 0.001,
};

type Tab = string | null;

interface RunState {
  tab: Tab;
  note: Tab;
  runStartMs: number;
  lastMatchMs: number;
  matchCount: number;
  totalCount: number;
}

interface PendingCandidate {
  tab: Tab;
  note: Tab;
  startMs: number;
  count: number;
}

interface EnvelopeState {
  peak: number;
  dipping: boolean;
  dipStartMs: number;
}

function emptyRun(): RunState {
  return { tab: null, note: null, runStartMs: 0, lastMatchMs: 0, matchCount: 0, totalCount: 0 };
}

function emptyEnvelope(peak = 0): EnvelopeState {
  return { peak, dipping: false, dipStartMs: 0 };
}

export function createNoteDetector(
  onNote: (n: Omit<TabNote, 'id'>) => void,
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  configOverrides?: Partial<NoteDetectorConfig>,
) {
  const cfg: NoteDetectorConfig = { ...DEFAULT_NOTE_DETECTOR_CONFIG, ...configOverrides };

  let current: RunState = emptyRun();
  let pending: PendingCandidate | null = null;
  let envelope: EnvelopeState = emptyEnvelope();
  let ambientRms = 0;

  function detectOnset(rms: number, now: number): boolean {
    if (rms > envelope.peak) envelope.peak = rms;
    const minPeak = Math.max(cfg.minPeakRmsFloor, ambientRms * cfg.noiseFloorMult);
    if (envelope.peak < minPeak) return false;

    if (!envelope.dipping) {
      if (rms <= envelope.peak * cfg.dipRatio) {
        envelope.dipping = true;
        envelope.dipStartMs = now;
      }
      return false;
    }

    if (rms >= envelope.peak * cfg.riseRatio) {
      const dipDuration = now - envelope.dipStartMs;
      envelope.dipping = false;
      if (dipDuration >= cfg.minDipMs) {
        envelope.peak = rms;
        return true;
      }
    }
    return false;
  }

  function commit(run: RunState, recordingStartMs: number) {
    const duration = run.lastMatchMs - run.runStartMs;
    if (duration < cfg.minDurationMs) return;
    const confidence = Math.round((run.matchCount / run.totalCount) * 100);
    onNote({
      tab:        run.tab ?? '',
      note:       run.note ?? '',
      duration,
      start_time: run.runStartMs - recordingStartMs,
      confidence,
    });
  }

  return {
    reset() {
      current = emptyRun();
      pending = null;
      envelope = emptyEnvelope();
    },

    flush(recordingStartMs: number) {
      if (current.tab !== null) commit(current, recordingStartMs);
      current = emptyRun();
      pending = null;
      envelope = emptyEnvelope();
    },

    // `now` is passed in explicitly (rather than read via Date.now() internally) so this
    // can be driven by either a live wall clock (mic capture) or a replayed relative
    // timestamp (Frame Inspector's tuning preview, and eventually the file-upload path) —
    // the detector only ever needs consistent relative deltas between calls, not real time.
    process(frame: { frequency: number; rms: number }, now: number, recordingStartMs: number) {
      const result = frequencyToTab(frame.frequency, key, harmonicaType);
      const tab: Tab = result?.tab ?? null;
      const note: Tab = result?.note ?? null;

      // No note open and this frame itself reads as silence — safe to treat as an ambient
      // noise sample and fold it into the live per-device/per-room floor estimate.
      if (current.tab === null && tab === null) {
        ambientRms += cfg.noiseFloorAlpha * (frame.rms - ambientRms);
      }

      const onset = current.tab !== null ? detectOnset(frame.rms, now) : false;

      if (tab === current.tab) {
        // Either a real silence dip (native RMS gate) was mid-flight but hadn't reached
        // graceMs yet, or the amplitude envelope itself dipped and recovered without ever
        // crossing the (often-zero) silence gate — either way the tab resuming to the same
        // value is a re-attack (e.g. tongued repeats), not one continuous tone. Split.
        const realSilenceGap = pending !== null && pending.tab === null && now - pending.startMs >= cfg.minGapMs;
        if (onset || realSilenceGap) {
          commit(current, recordingStartMs);
          current = { tab, note, runStartMs: now, lastMatchMs: now, matchCount: 1, totalCount: 1 };
          // Same tab implies similar loudness — never shrink the peak reference across a same-tab
          // streak (only carry it forward/up). A short middle note in a fast triplet may not have
          // time to rebuild peak from scratch before the next dip starts; decaying it further would
          // make that next dip's threshold too strict to detect.
          envelope = { peak: Math.max(frame.rms, envelope.peak), dipping: false, dipStartMs: 0 };
          pending = null;
          return;
        }
        current.lastMatchMs = now;
        current.matchCount += 1;
        current.totalCount += 1;
        pending = null;
        return;
      }

      current.totalCount += 1;

      if (pending !== null && pending.tab === tab) {
        pending.count += 1;
      } else {
        pending = { tab, note, startMs: now, count: 1 };
      }

      const requiredMs = tab === null ? cfg.graceMs : cfg.confirmMs;
      if (now - pending.startMs >= requiredMs) {
        if (current.tab !== null) commit(current, recordingStartMs);
        current = {
          tab:         pending.tab,
          note:        pending.note,
          runStartMs:  pending.startMs,
          lastMatchMs: now,
          matchCount:  pending.count,
          totalCount:  pending.count,
        };
        envelope = emptyEnvelope(frame.rms);
        pending = null;
      }
    },
  };
}
