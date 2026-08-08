/**
 * The conversion boundary: one Studio track → one harmonica tab.
 *
 * This is the only place in the Studio's half of the app that knows what a harmonica is,
 * and it exists as a seam rather than a step inside the screen for two reasons. It's where
 * the per-track decisions live — each track gets its own key and its own octave fit, which
 * is what makes a melody handed from a flute to a cello convertible at all — and it's a
 * pure function over a project and a track, so the harness can drive it.
 *
 * Conversion is a snapshot, not a live link. The result carries `sourceProjectId` and
 * `sourceTrackId` so "re-convert from source" can find the track again, which is most of
 * what linking would buy without needing any merge semantics for a hand-edited tab.
 */

import { trackAudibleNotes } from './midiProject';
import { MIN_NOTE_MS, reduceToMonophonic } from './midiToNotes';
import { notesToTabs, rankKeysForMidi, shiftMidiNotes, type MidiKeyRanking } from './notesToTabs';
import { octaveShiftForMidiRange } from './pitchRange';
import type {
  HarmonicaKey,
  HarmonicaType,
  MidiNote,
  MidiProject,
  MidiTrackData,
  TabNote,
  TabRecording,
} from '@/types';

export interface ConversionResult {
  recording: TabRecording;
  /** The harp chosen, and how it scored — surfaced so the UI can say why, and offer
   *  alternates, rather than presenting a key as if it were the only option. */
  key:       HarmonicaKey;
  /** Whole octaves applied before mapping, 0 when the part already sat in range. Must be
   *  surfaced to the user: it changes the pitches relative to the source. */
  octaveShiftSemitones: number;
  /** Notes with no position on the chosen harp. They keep their pitch as `tab: ''` — the
   *  app's existing policy — but the count is worth stating up front. */
  unplayableCount: number;
}

export interface ConvertOptions {
  /** Overrides the automatically ranked best key. */
  key?:           HarmonicaKey;
  harmonicaType?: HarmonicaType;
  title?:         string;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * The reduction every harmonica decision is made against: one voice, fitted to the register.
 *
 * Factored out because the key *picker* and the conversion both need it and must agree. If
 * the picker scored the raw track while conversion scored the fitted one, the list would
 * recommend a key that a default conversion then wouldn't choose — the two would disagree
 * about the same track on the same screen.
 *
 * Returns null when nothing survives, which is the same "nothing convertible here" condition
 * `convertTrackToRecording` reports by returning null.
 */
function fitTrackNotes(
  notes: readonly MidiNote[],
): { notes: MidiNote[]; octaveShiftSemitones: number } | null {
  // A harmonica plays one note at a time, so chords and overlaps within the track collapse
  // to the top voice — the same reduction MIDI import applies, reused rather than restated.
  const monophonic = reduceToMonophonic([...notes]);
  if (monophonic.length === 0) return null;

  // Per-track, deliberately. A global shift computed across the whole project would be a
  // compromise between a piccolo and a bass line that suits neither; each track is fitted
  // to the harp's register on its own.
  const octaveShiftSemitones = octaveShiftForMidiRange(monophonic.map((n) => n.midi));
  return { notes: shiftMidiNotes(monophonic, octaveShiftSemitones), octaveShiftSemitones };
}

/**
 * Score every harp for a track without converting it — what the picker offers.
 *
 * Null for a track with nothing convertible, so the caller can say so instead of opening a
 * picker over an empty list.
 */
export function rankKeysForTrack(
  track: Pick<MidiTrackData, 'notes' | 'velocityFloor'>,
  harmonicaType: HarmonicaType,
): MidiKeyRanking | null {
  // The filtered set, matching what `convertTrackToRecording` will actually convert — a
  // ranking scored over notes the conversion then drops would recommend a harp for music
  // the user isn't taking with them.
  const fitted = fitTrackNotes(trackAudibleNotes(track));
  if (!fitted) return null;
  return rankKeysForMidi(fitted.notes, harmonicaType, fitted.octaveShiftSemitones);
}

/**
 * Returns null when the track has nothing convertible — no notes, or nothing left after
 * the articulation floor. A caller should say so rather than opening an empty editor.
 */
export function convertTrackToRecording(
  project: Pick<MidiProject, 'id' | 'title' | 'tempos'>,
  track: MidiTrackData,
  options: ConvertOptions = {},
): ConversionResult | null {
  const harmonicaType = options.harmonicaType ?? 'diatonic';

  // The track's velocity floor is applied here, at the boundary out of the Studio: a note
  // hidden in the roll and silent in playback would be a surprise to find in the tab. The
  // project keeps it either way, so lowering the line and re-converting brings it back.
  const fit = fitTrackNotes(trackAudibleNotes(track));
  if (!fit) return null;
  const { notes: fitted, octaveShiftSemitones } = fit;

  const ranking = rankKeysForMidi(fitted, harmonicaType, octaveShiftSemitones);
  const key = options.key ?? ranking.ranked[0].key;

  // The track's own provenance, carried down onto every note it produces: a tab converted
  // out of an imported MIDI file holds a composer's stated velocities, one converted out of
  // a transcribed audio upload holds an engine's estimate, and the editor's filter has to
  // be able to tell the user which.
  const tabbed = notesToTabs(fitted, key, harmonicaType, track.velocitySource ?? 'midiVelocity');
  if (tabbed.length === 0) return null;

  const notes: TabNote[] = tabbed.map((note, index) => ({
    ...note,
    id: `note-${index}-${Math.random().toString(36).slice(2, 7)}`,
    // Velocity survives the conversion — the Studio's dynamics are exactly the harmonica's,
    // so dropping them here would discard real musical information.
    velocity: fitted[index]?.velocity,
  }));

  const duration = notes.reduce((max, n) => Math.max(max, n.start_time + n.duration), 0);

  return {
    recording: {
      id:            newId('rec'),
      title:         options.title ?? `${project.title} — ${track.name}`,
      key,
      harmonicaType,
      tabNotes:      notes,
      createdAt:     Date.now(),
      duration,
      // MIDI carries a real tempo map, but a tab session holds a single BPM, so the
      // opening tempo is what transfers. The map stays with the project.
      bpm:           project.tempos[0]?.bpm ? Math.round(project.tempos[0].bpm) : undefined,
      source:        'midiStudio',
      sourceProjectId: project.id,
      sourceTrackId:   track.id,
    },
    key,
    octaveShiftSemitones,
    unplayableCount: ranking.unplayableByKey[key] ?? 0,
  };
}

/** Re-run a conversion from the tab's recorded source. Returns null if the project or
 *  track is gone — a dangling reference is an expected state, not an error. */
export function reconvertFromSource(
  recording: TabRecording,
  projects: readonly MidiProject[],
  options: ConvertOptions = {},
): ConversionResult | null {
  if (!recording.sourceProjectId || !recording.sourceTrackId) return null;
  const project = projects.find((p) => p.id === recording.sourceProjectId);
  const track = project?.tracks.find((t) => t.id === recording.sourceTrackId);
  if (!project || !track) return null;

  const result = convertTrackToRecording(project, track, {
    key: options.key ?? recording.key,
    harmonicaType: options.harmonicaType ?? recording.harmonicaType,
    title: options.title ?? recording.title,
  });
  if (!result) return null;

  // Same id, so re-converting replaces the tab in the library rather than accumulating
  // near-duplicates of it.
  return { ...result, recording: { ...result.recording, id: recording.id, createdAt: recording.createdAt } };
}

export { MIN_NOTE_MS };
