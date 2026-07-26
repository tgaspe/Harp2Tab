import { frequencyToTab } from './HarmonicaMapper';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

const GRACE_MS     = 150; // silence must persist this long to end a run
const CONFIRM_MS   = 40;  // a new tab must persist this long to start a run
const MIN_DURATION = 170; // committed runs shorter than this are discarded

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

function emptyRun(): RunState {
  return { tab: null, note: null, runStartMs: 0, lastMatchMs: 0, matchCount: 0, totalCount: 0 };
}

export function createNoteDetector(
  onNote: (n: Omit<TabNote, 'id'>) => void,
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
) {
  let current: RunState = emptyRun();
  let pending: PendingCandidate | null = null;

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
    },

    flush(recordingStartMs: number) {
      if (current.tab !== null) commit(current, recordingStartMs);
      current = emptyRun();
      pending = null;
    },

    process(frame: { frequency: number; rms: number }, recordingStartMs: number) {
      const now = Date.now();
      const result = frequencyToTab(frame.frequency, key, harmonicaType);
      const tab: Tab = result?.tab ?? null;
      const note: Tab = result?.note ?? null;

      if (tab === current.tab) {
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
        pending = null;
      }
    },
  };
}
