/**
 * The session's notes as the roll's two filters leave them.
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
import { passesDurationFloor } from '@/audio/duration';
import { noteVelocity, passesVelocityFloor } from '@/audio/velocity';
import { selectDurationFloorMs, selectNoiseGate, selectTabNotes, useAppStore } from '@/store/useAppStore';
import type { TabNote, VelocitySource } from '@/types';

/**
 * Does a note survive both floors?
 *
 * AND, not OR: each line states an independent reason a note isn't wanted, so clearing one
 * bar doesn't excuse failing the other. A note with no stated dynamic is always past the
 * gate — see `passesVelocityFloor` for why that rule is load-bearing, and why both
 * predicates are shared with the Studio rather than inlined here.
 */
export function isAudible(note: TabNote, gate: number, durationFloorMs = 0): boolean {
  return passesVelocityFloor(noteVelocity(note), gate)
    && passesDurationFloor(note.duration, durationFloorMs);
}

export interface AudibleNotes {
  /** The filtered set — what to render, play and export. */
  notes:        TabNote[];
  /** How many notes survive **both** floors, which is what each line's readout reports.
   *  So dragging one line moves the other's count: the number answers "how much is on
   *  screen", the only reading that never overstates what the user can see. */
  audibleCount: number;
  /** Every note in the session, hidden ones included. Shown next to the audible count so
   *  it's visible that hiding isn't deleting. */
  totalCount:   number;
  gate:         number;
  /** The duration line's position, in ms. 0 is off. */
  durationFloorMs: number;
  /**
   * Whether the gate can do anything here — true once any note carries a dynamic.
   *
   * Sessions built entirely from sources that state no velocity (a hand-built tab, an audio
   * upload transcribed before the engine recorded one) would otherwise show a slider that
   * silently does nothing at every position.
   */
  supported:    boolean;
  /**
   * Where these velocities came from, so the slider can say so.
   *
   * The three producers are not comparable — a threshold of 60 hides half a tracked take
   * and almost nothing from a neural one — so the number alone is misleading without it.
   * `'mixed'` when notes disagree (a converted project edited by hand), `undefined` when
   * nothing states a source, which includes every tab saved before this field existed.
   */
  source:       VelocitySource | 'mixed' | undefined;
}

export function useAudibleNotes(): AudibleNotes {
  const allNotes        = useAppStore(selectTabNotes);
  const gate            = useAppStore(selectNoiseGate);
  const durationFloorMs = useAppStore(selectDurationFloorMs);

  return useMemo(() => {
    // The overwhelmingly common case is both floors off, where filtering would allocate a
    // copy of the whole array on every render to produce exactly the same contents.
    const notes = gate <= 0 && durationFloorMs <= 0
      ? allNotes
      : allNotes.filter((n) => isAudible(n, gate, durationFloorMs));

    // Walked over the full set, not the filtered one, so the label doesn't change as the
    // user drags a line past the last note of one source.
    let source: VelocitySource | 'mixed' | undefined;
    for (const n of allNotes) {
      if (n.velocitySource === undefined) continue;
      if (source === undefined)       source = n.velocitySource;
      else if (source !== n.velocitySource) { source = 'mixed'; break; }
    }

    return {
      notes,
      audibleCount: notes.length,
      totalCount:   allNotes.length,
      gate,
      durationFloorMs,
      supported:    allNotes.some((n) => noteVelocity(n) !== undefined),
      source,
    };
  }, [allNotes, gate, durationFloorMs]);
}
