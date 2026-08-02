/**
 * The parse half of MIDI import: SMF bytes → per-track timed pitches → one monophonic
 * line. This is where audio import's expensive half (decode + pitch detection) simply
 * doesn't exist — MIDI already states what was played and when.
 *
 * Deliberately pure and platform-free: no file reading, no store, no DOM. The verification
 * harness drives it directly.
 */

import { Midi } from '@tonejs/midi';
import { AudioImportError } from './audioImport';
import { midiToNoteName } from './HarmonicaMapper';
import type { MidiNote } from '@/types';
import type { TempoEvent, TimeSignatureEvent } from './tempo';

/** Canonical since Phase 11 gave the Studio the same note shape — re-exported here so the
 *  import pipeline's existing `from './midiToNotes'` imports keep working. */
export type { MidiNote };

/** Everything the track picker needs to describe a track without re-parsing the file. */
export interface MidiTrack {
  /** Index in the parsed file — the picker's selection value. */
  id:         number;
  name:       string;
  channel:    number;
  noteCount:  number;
  lowestNote:  number;
  highestNote: number;
  durationMs: number;
  notes:      MidiNote[];
}

export interface ParsedMidi {
  /** Note-bearing, non-percussion tracks, in file order. Never empty (parse throws). */
  tracks:     MidiTrack[];
  /** Tempo at the start of the file, when it declares one — MIDI carries a real tempo map,
   *  so the session's BPM doesn't have to default to 100 the way an audio import's does.
   *  A tab session has exactly one tempo, so this is what the *import* path commits; the
   *  full map below is what the Studio opens with. */
  bpm:        number | null;
  /** Every tempo change in the file, not just the first. Before Phase 11 the rest were
   *  discarded, which left bar lines drifting further from the music with each change —
   *  and since snapping quantizes against those bars, editing degraded with them. */
  tempos:         TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  durationMs: number;
}

/** Same floor the note detector applies to recorded audio (`NoteDetector`'s
 *  `minDurationMs`): a run this short isn't something a player can articulate, so imported
 *  grace notes are discarded rather than becoming untabbable specks. */
export const MIN_NOTE_MS = 110;

/** Channel 10 in one-based MIDI terms — pitch there names a drum, not a note, so a
 *  percussion track has nothing to transcribe. */
const PERCUSSION_CHANNEL = 9;

/** Tracks with fewer notes than this are unlikely to be the melody (a lone pickup bar, a
 *  program-change-only track), so they don't compete for the default selection. */
const MELODY_MIN_NOTES = 8;

/** Every SMF starts with the four bytes "MThd". Checked here rather than left to the
 *  parser so picking an mp3 by mistake says so, instead of reporting a corrupt MIDI file. */
function hasMidiHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64;
}

export function parseMidiFile(bytes: Uint8Array, fileName: string): ParsedMidi {
  if (!hasMidiHeader(bytes)) {
    throw new AudioImportError(
      'unsupportedFormat',
      `"${fileName}" isn't a MIDI file. Choose a .mid or .midi file — to transcribe audio, use Upload Audio instead.`,
    );
  }

  let midi: Midi;
  try {
    midi = new Midi(bytes);
  } catch {
    throw new AudioImportError(
      'unsupportedFormat',
      `"${fileName}" couldn't be read as a MIDI file. It may be corrupt, or not a MIDI file at all.`,
    );
  }

  const tracks: MidiTrack[] = [];
  for (const [index, track] of midi.tracks.entries()) {
    if (track.notes.length === 0) continue;
    if (track.channel === PERCUSSION_CHANNEL || track.instrument?.percussion) continue;

    const notes: MidiNote[] = track.notes.map((note) => ({
      midi:       note.midi,
      timeMs:     note.time * 1000,
      durationMs: note.duration * 1000,
      // @tonejs/midi normalises velocity to 0–1; the app stores MIDI's own 0–127 so the
      // breath-force lane and the SMF writer share one convention.
      velocity:   Math.round(note.velocity * 127),
    }));

    const pitches = notes.map((n) => n.midi);
    tracks.push({
      id:          index,
      // The track-name meta event first, then the instrument the program change selects,
      // then a positional label — the first of these that says anything.
      name:        track.name?.trim() || track.instrument?.name || `Track ${index + 1}`,
      channel:     track.channel,
      noteCount:   notes.length,
      lowestNote:  Math.min(...pitches),
      highestNote: Math.max(...pitches),
      durationMs:  Math.max(...notes.map((n) => n.timeMs + n.durationMs)),
      notes,
    });
  }

  if (tracks.length === 0) {
    throw new AudioImportError(
      'noAudio',
      `"${fileName}" has no notes to transcribe — it may contain only drum parts, which a harmonica can't play.`,
    );
  }

  const header = midi.header;
  return {
    tracks,
    bpm:    header.tempos.length > 0 ? header.tempos[0].bpm : null,
    tempos: header.tempos.map((t) => ({
      timeMs: header.ticksToSeconds(t.ticks) * 1000,
      bpm:    t.bpm,
    })),
    timeSignatures: header.timeSignatures.map((s) => ({
      timeMs:      header.ticksToSeconds(s.ticks) * 1000,
      numerator:   s.timeSignature[0],
      denominator: s.timeSignature[1],
    })),
    durationMs: midi.duration * 1000,
  };
}

/**
 * Which track to offer first: the highest-register track carrying a real phrase. Median
 * rather than mean pitch, so one low pedal note in an otherwise high part doesn't drag a
 * melody below an accompaniment. A default, not a decision — the user can still pick.
 */
export function mostMelodicTrack(tracks: MidiTrack[]): MidiTrack {
  const substantial = tracks.filter((t) => t.noteCount >= MELODY_MIN_NOTES);
  const pool = substantial.length > 0 ? substantial : tracks;
  return pool.reduce((best, track) =>
    medianPitch(track) > medianPitch(best) ? track : best,
  );
}

function medianPitch(track: MidiTrack): number {
  const sorted = track.notes.map((n) => n.midi).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The explicit "All tracks merged" option — occasionally right for a two-hand piano part,
 *  never a default, because a merged line hops between instruments without saying so. */
export function mergeTracks(tracks: MidiTrack[]): MidiNote[] {
  return tracks.flatMap((t) => t.notes);
}

/**
 * Collapse chords and overlaps to the single voice a harmonica can play.
 *
 * Sorted by onset then pitch descending, so at any moment the top voice is seen first:
 * a note overlapping one already kept is dropped when it's lower (a chord tone, or an
 * accompaniment note under a held melody) and truncates the earlier note when it's higher
 * (the melody moving on). Notes too short to articulate are then discarded, matching what
 * the audio path's detector already does with recorded runs.
 */
export function reduceToMonophonic(notes: MidiNote[]): MidiNote[] {
  const sorted = [...notes].sort((a, b) => a.timeMs - b.timeMs || b.midi - a.midi);

  const kept: MidiNote[] = [];
  for (const note of sorted) {
    const prev = kept[kept.length - 1];
    if (prev) {
      const prevEnd = prev.timeMs + prev.durationMs;
      if (note.timeMs < prevEnd) {
        if (note.midi <= prev.midi) continue;
        const trimmed = note.timeMs - prev.timeMs;
        // A higher note landing on the same onset would leave nothing of the earlier one;
        // it replaces it rather than becoming a zero-length note.
        if (trimmed < 1) kept.pop();
        else prev.durationMs = trimmed;
      }
    }
    kept.push({ ...note });
  }

  return kept.filter((n) => n.durationMs >= MIN_NOTE_MS);
}

/** Pitch range as note names, for the track picker's "what does this part cover" line. */
export function pitchRangeLabel(track: MidiTrack): string {
  return `${midiToNoteName(track.lowestNote)}–${midiToNoteName(track.highestNote)}`;
}
