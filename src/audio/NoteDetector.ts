import { frequencyToTab } from './HarmonicaMapper';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

const HISTORY_SIZE = 7;
const GRACE_MS     = 150;
const MIN_DURATION = 170;

interface ActiveNote {
  tab: string;
  note: string;
  absStartMs: number;
  confidence: number;
}

export function createNoteDetector(
  onNote: (n: Omit<TabNote, 'id'>) => void,
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
) {
  const history: (string | null)[] = [];
  let active: ActiveNote | null = null;
  let silentSince: number | null = null;

  function commit(note: ActiveNote, absNow: number, recordingStartMs: number) {
    const duration = absNow - note.absStartMs;
    if (duration >= MIN_DURATION) {
      onNote({
        tab:        note.tab,
        note:       note.note,
        duration,
        start_time: note.absStartMs - recordingStartMs,
        confidence: note.confidence,
      });
    }
  }

  return {
    reset() {
      history.length = 0;
      active = null;
      silentSince = null;
    },

    process(frame: { frequency: number; rms: number }, recordingStartMs: number) {
      const absNow = Date.now();

      const result = frequencyToTab(frame.frequency, key, harmonicaType);
      const currentTab = result?.tab ?? null;

      history.push(currentTab);
      if (history.length > HISTORY_SIZE) history.shift();

      // Majority vote — needs more than half the window
      const counts = new Map<string, number>();
      for (const t of history) {
        if (t !== null) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      let votedTab: string | null = null;
      let votedCount = 0;
      let votedNote: string | null = result?.note ?? null;
      for (const [tab, count] of counts) {
        if (count > HISTORY_SIZE / 2) { votedTab = tab; votedCount = count; break; }
      }

      if (votedTab === null) {
        // Silent frame
        if (silentSince === null) silentSince = absNow;
        if (active && absNow - silentSince >= GRACE_MS) {
          commit(active, absNow, recordingStartMs);
          active = null;
          silentSince = null;
        }
      } else {
        silentSince = null;
        const confidence = Math.round((votedCount / HISTORY_SIZE) * 100);
        if (active?.tab !== votedTab) {
          if (active) commit(active, absNow, recordingStartMs);
          active = { tab: votedTab, note: votedNote ?? '', absStartMs: absNow, confidence };
        } else {
          active.confidence = confidence;
        }
      }
    },
  };
}
