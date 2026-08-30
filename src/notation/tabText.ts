/**
 * How a tab is *written* — the token layer, one definition for every format that prints one.
 *
 * It used to live inside `generators.ts`, where TXT was the only thing that printed a tab.
 * Phase 18's score view prints the same tokens under staff notation, and a second copy of
 * these rules is the one way the two surfaces could start disagreeing about what a chord is
 * or how an off-harp pitch reads. Nothing here knows about a file format: it turns notes
 * into the text a player reads and stops there.
 */

import { noteNameToMidi } from '@/audio/HarmonicaMapper';
import type { HarmonicaType, TabNote } from '@/types';


// A note with tab: '' has no real position on the current harmonica (see
// getGridRows/PianoRoll.tsx) — human-facing text formats show its pitch instead of a
// blank, bracketed so it reads as "not a real tab" rather than a malformed one.
export function tabOrFallback(n: TabNote): string {
  return n.tab || `[${n.note}]`;
}

/**
 * How close two onsets have to be to count as one attack.
 *
 * Chords in real material never land on the same millisecond — a strum spreads, and a
 * humanised MIDI file jitters every onset on purpose — so an exact-match rule would write
 * a chord out as an arpeggio. 50ms is comfortably wider than that jitter and still far
 * shorter than any note a player would hear as separate.
 */
export const CHORD_WINDOW_MS = 50;

/** A tab that is nothing but a hole number, optionally drawn: no bend, no overblow, no
 *  chromatic slide. Only these can be run together into a chord. */
export const PLAIN_HOLE = /^-?\d+$/;

/** One moment of the tab: what to print, and how many notes it stands for. */
export interface Voicing {
  token: string;
  /** Which group notation this token uses, so the legend can quote a real one. */
  kind: 'single' | 'chord' | 'group';
  /** What the header counts. A chord a player can take in one breath is one thing to play;
   *  a group that isn't playable as written is still separate notes to deal with. */
  counts: number;
  /** Stand-in note carrying the group's span, so phrasing measures rests from where the
   *  whole group ends rather than from whichever member happened to be first. */
  lead: TabNote;
}

/** Notes sharing an onset, within the window. Anchored on the group's *first* onset rather
 *  than the previous note's, so a slow arpeggio can't chain itself into one chord. */
export function groupSimultaneous(notes: readonly TabNote[]): TabNote[][] {
  const ordered = [...notes].sort((a, b) => a.start_time - b.start_time);
  const groups: TabNote[][] = [];
  for (const note of ordered) {
    const current = groups[groups.length - 1];
    if (current && note.start_time - current[0].start_time <= CHORD_WINDOW_MS) current.push(note);
    else groups.push([note]);
  }
  return groups;
}

/**
 * The chord form: hole numbers run together behind a single breath sign — `456`, `-1234`.
 *
 * The shared sign is the point. You cannot blow and draw at once, so every chord a
 * harmonica can actually sound is one breath direction, and hoisting the `-` to the front
 * states that rather than repeating it four times. It also matches how a player says it:
 * "draw one through four".
 *
 * Null when the group isn't one breath of plain holes, which is the caller's signal to fall
 * back to the slash form. Two limits are worth naming:
 *  - Bends, overblows and slides are single-hole techniques; a group containing one is not
 *    a chord, whatever else is in it.
 *  - Diatonic only. Holes run 1–10 there and a `0` can only follow a `1`, so even `8910`
 *    parses one way. A chromatic reaches hole 12, where `12` is indistinguishable from
 *    holes 1 and 2, and there is no way to tell them apart in a format with no legend.
 */
export function chordToken(group: readonly TabNote[], harmonicaType: HarmonicaType): string | null {
  if (harmonicaType !== 'diatonic') return null;
  if (!group.every((n) => PLAIN_HOLE.test(n.tab))) return null;

  const draw = group[0].tab.startsWith('-');
  if (!group.every((n) => n.tab.startsWith('-') === draw)) return null;

  const holes = group.map((n) => Number(n.tab.replace('-', ''))).sort((a, b) => a - b);
  return (draw ? '-' : '') + holes.join('');
}

/** Ascending pitch, for groups that aren't chords — an unplayable pitch has no hole to
 *  order by, so the note name is what's left. Unparseable names keep their relative order. */
export function byPitch(a: TabNote, b: TabNote): number {
  return (noteNameToMidi(a.note) ?? 0) - (noteNameToMidi(b.note) ?? 0);
}

export function voicingOf(group: TabNote[], harmonicaType: HarmonicaType, index: number): Voicing {
  const start = Math.min(...group.map((n) => n.start_time));
  const end   = Math.max(...group.map((n) => n.start_time + n.duration));
  // A synthetic id, so the lookup back from a phrase can't be confused by duplicate ids in
  // the source. Nothing prints it.
  const lead: TabNote = { ...group[0], id: `v${index}`, start_time: start, duration: end - start };

  // Two notes on the same hole are one thing to play, however the source spelled them.
  const seen = new Set<string>();
  const distinct = group.filter((n) => {
    const token = tabOrFallback(n);
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  });

  if (distinct.length === 1) return { token: tabOrFallback(distinct[0]), kind: 'single', counts: 1, lead };

  const chord = chordToken(distinct, harmonicaType);
  if (chord) return { token: chord, kind: 'chord', counts: 1, lead };

  // Not playable as one breath: slashes say "these sound together" without claiming a player
  // could do it. `/` is the one separator the tab vocabulary hasn't already spent.
  return {
    token:  [...distinct].sort(byPitch).map(tabOrFallback).join('/'),
    kind:   'group',
    counts: distinct.length,
    lead,
  };
}
