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
    // Carried so playback can voice the track; the piano roll ignores it entirely.
    program:     track.program,
  }));
}

export interface BackgroundLane {
  id:    string;
  color: string;
  notes: readonly TabNote[];
}

export interface BackgroundBlock {
  key:   string;
  left:  number;
  top:   number;
  width: number;
  color: string;
}

export interface LaneWindow {
  visibleStartMs:  number;
  visibleEndMs:    number;
  firstVisibleRow: number;
  lastVisibleRow:  number;
  pxPerSecond:     number;
  rowHeight:       number;
}

/**
 * Lay out the inert background lanes, culled on both axes.
 *
 * Pure and outside the component on purpose: this is the loop whose cost decides whether a
 * twelve-track orchestral file is usable, since a project has far more background notes
 * than foreground ones. Keeping it here means it can be measured directly rather than
 * inferred from how the UI feels.
 *
 * `rowIndexByNote` is passed in rather than rebuilt per call — it depends only on the row
 * ladder, which changes far less often than the scroll position.
 */
export function layoutBackgroundLanes(
  lanes: readonly BackgroundLane[] | undefined,
  rowIndexByNote: ReadonlyMap<string, number>,
  window: LaneWindow,
): BackgroundBlock[] {
  if (!lanes?.length) return [];
  const { visibleStartMs, visibleEndMs, firstVisibleRow, lastVisibleRow, pxPerSecond, rowHeight } = window;

  const blocks: BackgroundBlock[] = [];
  for (const lane of lanes) {
    for (const note of lane.notes) {
      // Time first: it rejects the most notes for the least work, since a viewport spans a
      // few seconds of a piece that runs for minutes.
      if (note.start_time + note.duration < visibleStartMs || note.start_time > visibleEndMs) continue;
      const rowIndex = rowIndexByNote.get(note.note);
      if (rowIndex === undefined || rowIndex < firstVisibleRow || rowIndex > lastVisibleRow) continue;
      blocks.push({
        key:   `${lane.id}:${note.id}`,
        left:  (note.start_time / 1000) * pxPerSecond,
        top:   rowIndex * rowHeight,
        // Same 1px-ish floor the foreground blocks use (MIN_NOTE_WIDTH_PX): a background
        // lane that stopped shrinking while the track on top of it kept going would
        // misreport the other tracks' rhythm at exactly the zoom you'd use to compare them.
        width: Math.max(2, (note.duration / 1000) * pxPerSecond),
        color: lane.color,
      });
    }
  }
  return blocks;
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
