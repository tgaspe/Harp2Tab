/**
 * The session's notes as the noise gate leaves them.
 *
 * Deliberately a hook rather than a plain zustand selector: `s.tabNotes.filter(...)` inside
 * a selector returns a fresh array identity on every store read, which zustand compares by
 * reference and treats as a change — an infinite re-render. The filtering has to happen
 * behind a `useMemo` keyed on the two inputs that can actually change it.
 *
 * Everything the user sees, hears or exports should read from here. The raw
 * `selectTabNotes` stays the source of truth for anything that *writes* — every store
 * mutation is id-based and operates on the full set, so edits made while notes are hidden
 * still land correctly.
 */

import { useMemo } from 'react';
import { selectNoiseGate, selectTabNotes, useAppStore } from '@/store/useAppStore';
import type { TabNote } from '@/types';

/**
 * A note with no stated dynamic is always audible.
 *
 * This is the back-compat guarantee that keeps the gate from being a data-loss bug: every
 * recording saved before `breathForce` existed, every MIDI import that didn't state a
 * velocity, and every note typed by hand in the editor has `breathForce === undefined`.
 * Treating those as silent would empty the editor the moment the slider left zero.
 */
export function isAudible(note: TabNote, gate: number): boolean {
  return (note.breathForce ?? 127) >= gate;
}

export interface AudibleNotes {
  /** The gated set — what to render, play and export. */
  notes:        TabNote[];
  audibleCount: number;
  /** Every note in the session, hidden ones included. Shown next to the audible count so
   *  it's visible that hiding isn't deleting. */
  totalCount:   number;
  gate:         number;
  /**
   * Whether the gate can do anything here — true once any note carries a dynamic.
   *
   * Sessions built entirely from sources that state no velocity (a hand-built tab, an audio
   * upload transcribed before the engine recorded one) would otherwise show a slider that
   * silently does nothing at every position.
   */
  supported:    boolean;
}

export function useAudibleNotes(): AudibleNotes {
  const allNotes = useAppStore(selectTabNotes);
  const gate     = useAppStore(selectNoiseGate);

  return useMemo(() => {
    // The overwhelmingly common case is gate 0, where filtering would allocate a copy of
    // the whole array on every render to produce exactly the same contents.
    const notes = gate <= 0 ? allNotes : allNotes.filter((n) => isAudible(n, gate));
    return {
      notes,
      audibleCount: notes.length,
      totalCount:   allNotes.length,
      gate,
      supported:    allNotes.some((n) => n.breathForce !== undefined),
    };
  }, [allNotes, gate]);
}
