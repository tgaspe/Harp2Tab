import { frequencyToTab } from './HarmonicaMapper';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

const GRACE_MS      = 150;   // silence must persist this long to end a run
const CONFIRM_MS    = 40;    // a new tab must persist this long to start a run
const MIN_DURATION  = 110;   // committed runs shorter than this are discarded
const MIN_GAP_MS    = 60;    // a same-tab re-attack must have a real RMS dip at least this long to split (filters single-frame glitches, below GRACE_MS so it beats the "resume before grace expires" merge)

// Amplitude-envelope onset detector: catches re-attacks of the same tab (e.g. tongued
// repeats) whose RMS dip never crosses the native silence-gate threshold, which defaults
// to 0 and often never gates `tab` to null between two fast identical notes.
const DIP_RATIO     = 0.5;   // rms must fall to <= this fraction of the local peak to start a dip
const RISE_RATIO    = 0.65;  // rms must recover to >= this fraction of the local peak to confirm a re-attack (hysteresis above DIP_RATIO)
const MIN_DIP_MS    = 35;    // dip must last this long (~1 native window) to count as real, not frame noise
const MIN_PEAK_RMS  = 0.003; // skip dip detection when the note is too quiet for ratio math to be meaningful

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
) {
  let current: RunState = emptyRun();
  let pending: PendingCandidate | null = null;
  let envelope: EnvelopeState = emptyEnvelope();

  function detectOnset(rms: number, now: number): boolean {
    if (rms > envelope.peak) envelope.peak = rms;
    if (envelope.peak < MIN_PEAK_RMS) return false;

    if (!envelope.dipping) {
      if (rms <= envelope.peak * DIP_RATIO) {
        envelope.dipping = true;
        envelope.dipStartMs = now;
      }
      return false;
    }

    if (rms >= envelope.peak * RISE_RATIO) {
      const dipDuration = now - envelope.dipStartMs;
      envelope.dipping = false;
      if (dipDuration >= MIN_DIP_MS) {
        envelope.peak = rms;
        return true;
      }
    }
    return false;
  }

  function commit(run: RunState, recordingStartMs: number) {
    const duration = run.lastMatchMs - run.runStartMs;
    if (duration < MIN_DURATION) return;
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

    process(frame: { frequency: number; rms: number }, recordingStartMs: number) {
      const now = Date.now();
      const result = frequencyToTab(frame.frequency, key, harmonicaType);
      const tab: Tab = result?.tab ?? null;
      const note: Tab = result?.note ?? null;

      const onset = current.tab !== null ? detectOnset(frame.rms, now) : false;

      if (tab === current.tab) {
        // Either a real silence dip (native RMS gate) was mid-flight but hadn't reached
        // GRACE_MS yet, or the amplitude envelope itself dipped and recovered without ever
        // crossing the (often-zero) silence gate — either way the tab resuming to the same
        // value is a re-attack (e.g. tongued repeats), not one continuous tone. Split.
        const realSilenceGap = pending !== null && pending.tab === null && now - pending.startMs >= MIN_GAP_MS;
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

      const requiredMs = tab === null ? GRACE_MS : CONFIRM_MS;
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
