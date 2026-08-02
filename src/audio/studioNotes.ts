/**
 * The bridge between a project's `MidiNote[]` and what `PianoRoll` renders.
 *
 * The mismatch is real and worth stating: the piano roll was built for the tab editor, so
 * it takes `TabNote[]`, identifies notes by a string `id`, and matches them to rows by
 * pitch *name*. A project stores pitch as a MIDI number and has no note identity at all —
 * SMF doesn't identify notes, so ids can't survive a save/load round trip.
 *
 * Rather than give `MidiNote` a persisted id (a sidecar per note, for something only the
 * editor needs), identity is *positional*: a note's id encodes its track and its index in
 * that track's array. That works because the array's order is insertion order and is never
 * re-sorted — a note dragged later in time keeps its slot, so its id survives the edit.
 * Ids are regenerated on load, which is fine: nothing persists a selection.
 */

import { midiToNoteName, noteNameToMidi } from './HarmonicaMapper';
import type { MidiNote, MidiTrackData, TabNote } from '@/types';

/** Separator chosen so it can't occur in a generated track id (`track-<ts>-<rand>`). */
const ID_SEPARATOR = '#';

export function studioNoteId(trackId: string, index: number): string {
  return `${trackId}${ID_SEPARATOR}${index}`;
}

export function parseStudioNoteId(id: string): { trackId: string; index: number } | null {
  const at = id.lastIndexOf(ID_SEPARATOR);
  if (at === -1) return null;
  const index = Number(id.slice(at + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return { trackId: id.slice(0, at), index };
}

/**
 * Adapt a track's notes for the piano roll.
 *
 * `tab` is empty throughout because there is no harmonica at this stage — the roll already
 * understands that state (it's what an unreachable pitch looks like in the tab editor) and
 * renders such notes by pitch. `confidence` is 100 for the same reason MIDI import sets it:
 * the pitch is stated outright, there is nothing to be uncertain about.
 */
export function trackToTabNotes(track: MidiTrackData): TabNote[] {
  return track.notes.map((note, index) => ({
    id:          studioNoteId(track.id, index),
    tab:         '',
    note:        midiToNoteName(note.midi),
    duration:    Math.max(1, Math.round(note.durationMs)),
    start_time:  Math.max(0, Math.round(note.timeMs)),
    confidence:  100,
    breathForce: note.velocity,
  }));
}

/** Apply a piano-roll edit back onto a track's notes. Returns the same array reference when
 *  nothing changed, so callers can skip a store write. */
export function applyTabNoteChange(
  track: MidiTrackData,
  noteId: string,
  changes: Partial<Pick<TabNote, 'note' | 'start_time' | 'duration'>>,
): MidiNote[] {
  const parsed = parseStudioNoteId(noteId);
  if (!parsed || parsed.trackId !== track.id) return track.notes;

  const existing = track.notes[parsed.index];
  if (!existing) return track.notes;

  const midi = changes.note !== undefined ? noteNameToMidi(changes.note) : null;
  const next: MidiNote = {
    ...existing,
    // A pitch name that doesn't parse leaves the pitch alone rather than moving the note
    // somewhere arbitrary.
    midi:       midi ?? existing.midi,
    timeMs:     changes.start_time ?? existing.timeMs,
    durationMs: changes.duration ?? existing.durationMs,
  };

  if (next.midi === existing.midi
    && next.timeMs === existing.timeMs
    && next.durationMs === existing.durationMs) {
    return track.notes;
  }

  const notes = [...track.notes];
  notes[parsed.index] = next;
  return notes;
}

/** Append a note created by the piano roll. Appending (rather than inserting in time
 *  order) is what keeps every existing note's positional id valid. */
export function appendTabNote(track: MidiTrackData, created: Omit<TabNote, 'id'>): MidiNote[] {
  const midi = noteNameToMidi(created.note);
  if (midi === null) return track.notes;
  return [
    ...track.notes,
    {
      midi,
      timeMs:     Math.max(0, created.start_time),
      durationMs: Math.max(1, created.duration),
      velocity:   created.breathForce,
    },
  ];
}

/**
 * Remove a note.
 *
 * Deleting shifts every later note's index, and therefore its id — which is why the caller
 * must re-adapt after this rather than reusing an id it captured beforehand. That's the
 * cost of positional identity, and it's contained to this one operation.
 */
export function removeTabNote(track: MidiTrackData, noteId: string): MidiNote[] {
  const parsed = parseStudioNoteId(noteId);
  if (!parsed || parsed.trackId !== track.id || !track.notes[parsed.index]) return track.notes;
  return track.notes.filter((_, i) => i !== parsed.index);
}
