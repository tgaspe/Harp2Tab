/**
 * The key-dependent half of MIDI import — the same seam `framesToNotes` occupies for
 * audio, just fed by explicit pitches instead of detected ones.
 *
 * It also owns the one definition of "how playable is this on this harp", which automatic
 * key *detection* (keyDetection.ts) and MIDI's target-key *selection* both score with.
 * Two entry points, one notion of playability — otherwise the same tab could be described
 * as a good fit on one screen and a poor one on the other.
 */

import { HARMONICA_KEYS } from '@/constants/keys';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';
import { midiToNoteName, noteToTab } from './HarmonicaMapper';
import type { MidiNote } from './midiToNotes';

/** Weights for the awkward positions. An overblow is penalized harder than a bend because
 *  it's the harder technique, and a tab full of them usually means the wrong harp. */
const BEND_PENALTY     = 0.35;
const OVERBLOW_PENALTY = 0.6;

/** Semitone offsets of each key from C, for position arithmetic. */
const KEY_SEMITONES: Record<HarmonicaKey, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5,
  'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

export interface KeyCandidate {
  key:   HarmonicaKey;
  /** 0..1 — mapped coverage, discounted by how much of it needs bends/overblows. */
  score: number;
  /** Share of the material that landed on a real position at all. */
  mappedFraction:   number;
  /** Shares of the mapped notes needing a bend / an overblow. */
  bendFraction:     number;
  overblowFraction: number;
  /** Harmonica position relative to the winning key (1 = straight harp, 2 = cross harp).
   *  Derived from the winner, on the assumption that the best-fitting harp is 1st position. */
  position: number;
}

/** A bend is written with apostrophes, an overblow/overdraw with a trailing "o" — the tab
 *  vocabulary already encodes technique, so no lookup table is needed. */
export function isBend(tab: string): boolean     { return tab.includes("'"); }
export function isOverblow(tab: string): boolean { return tab.endsWith('o'); }

/**
 * Playability of an already-mapped set of notes.
 *
 * `totalMs` is what coverage is measured against, and differs by entry point: audio has no
 * note at all where a pitch didn't map, so its denominator is the voiced frame time; MIDI
 * keeps unplayable notes with `tab: ''`, so its denominator is every note's duration.
 * Either way the numerator is the same — time spent on a real hole.
 */
export function scoreTabbedNotes(
  notes: readonly Omit<TabNote, 'id'>[],
  totalMs: number,
): Omit<KeyCandidate, 'key' | 'position'> {
  let mapped   = 0;
  let bend     = 0;
  let overblow = 0;
  for (const note of notes) {
    if (!note.tab) continue;
    mapped += note.duration;
    if (isBend(note.tab))     bend     += note.duration;
    if (isOverblow(note.tab)) overblow += note.duration;
  }

  // Detected note durations can slightly exceed the voiced frame total (a note's run spans
  // the frames on either side of its onset), so coverage is clamped rather than allowed
  // above 1 where it would reward the wrong key.
  const mappedFraction   = totalMs > 0 ? Math.min(1, mapped / totalMs) : 0;
  const bendFraction     = mapped > 0 ? bend / mapped : 0;
  const overblowFraction = mapped > 0 ? overblow / mapped : 0;

  // Multiplicative rather than subtractive: the penalties scale what was actually covered,
  // so a key that maps very little can't out-score a key that maps everything cleanly.
  const score = mappedFraction * Math.max(
    0,
    1 - BEND_PENALTY * bendFraction - OVERBLOW_PENALTY * overblowFraction,
  );

  return { score, mappedFraction, bendFraction, overblowFraction };
}

/**
 * Harmonica position of `key` when the tune sits in `tonic` — 1st position (straight harp)
 * is the same key, 2nd (cross harp) is the harp a fourth below the tune, and each further
 * position is another fifth around the circle.
 */
export function positionOf(key: HarmonicaKey, tonic: HarmonicaKey): number {
  const distance = (KEY_SEMITONES[tonic] - KEY_SEMITONES[key] + 12) % 12;
  // distance = 7 × (position − 1) mod 12; 7 and 12 are coprime, so stepping fifths finds it.
  for (let position = 1; position <= 12; position++) {
    if ((7 * (position - 1)) % 12 === distance) return position;
  }
  return 1;
}

/**
 * MIDI notes → tab notes for one harmonica.
 *
 * A pitch with no position on this harp keeps its pitch and gets `tab: ''` — the state the
 * app already uses when switching harmonica type makes a note unreachable. It is never
 * dropped (that would change what lines up against the timeline) and never snapped to a
 * neighbouring pitch (that would silently rewrite the music into something the user can't
 * detect without checking the source). PianoRoll renders it, every export format writes it
 * as a bracketed pitch, and the editor already warns about it before export.
 */
export function notesToTabs(
  notes: readonly MidiNote[],
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
): Omit<TabNote, 'id'>[] {
  return notes.map((note) => {
    const name = midiToNoteName(note.midi);
    return {
      tab:        noteToTab(name, key, harmonicaType) ?? '',
      note:       name,
      duration:   Math.max(1, Math.round(note.durationMs)),
      start_time: Math.max(0, Math.round(note.timeMs)),
      // MIDI states the pitch outright; there is nothing to be uncertain about, unlike a
      // frequency recovered from audio.
      confidence: 100,
    };
  });
}

export interface MidiKeyRanking {
  /** All 12 keys, best first. */
  ranked: KeyCandidate[];
  /** Unplayable note counts per key, for the picker's "C: 14 unplayable" line. */
  unplayableByKey: Record<HarmonicaKey, number>;
  /** Whole-recording octave shift applied before scoring, in semitones (0 if none). */
  octaveShiftSemitones: number;
}

/**
 * Score every key for a set of MIDI notes. Scoring all 12 costs nothing here — no DSP, just
 * `noteToTab` over a few hundred notes — which is what lets the target-key picker show
 * playability per key and turn most "this note isn't reachable" problems into a one-tap
 * change of harp before the user ever reaches the editor.
 */
export function rankKeysForMidi(
  notes: readonly MidiNote[],
  harmonicaType: HarmonicaType,
  octaveShiftSemitones: number,
): MidiKeyRanking {
  const totalMs = notes.reduce((sum, n) => sum + n.durationMs, 0);

  const scored = HARMONICA_KEYS.map((key) => {
    const tabbed = notesToTabs(notes, key, harmonicaType);
    return { key, ...scoreTabbedNotes(tabbed, totalMs), unplayable: tabbed.filter((n) => !n.tab).length };
  });
  scored.sort((a, b) => b.score - a.score);

  // The best-fitting harp is taken as 1st position, which is what every other position is
  // then measured against.
  const tonic  = scored[0].key;
  const ranked = scored.map(({ unplayable: _unplayable, ...c }) => ({
    ...c,
    position: positionOf(c.key, tonic),
  }));

  const unplayableByKey = Object.fromEntries(
    scored.map((c) => [c.key, c.unplayable]),
  ) as Record<HarmonicaKey, number>;

  return { ranked, unplayableByKey, octaveShiftSemitones };
}

/** Move every note by whole octaves, to fit the harmonica's register. */
export function shiftMidiNotes(notes: readonly MidiNote[], semitones: number): MidiNote[] {
  if (semitones === 0) return notes as MidiNote[];
  return notes.map((n) => ({ ...n, midi: n.midi + semitones }));
}
