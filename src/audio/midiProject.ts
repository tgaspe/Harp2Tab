/**
 * `MidiProject` construction and persistence.
 *
 * The persisted form is base64 SMF plus a small sidecar, not the project object itself.
 * SMF carries everything musical — notes, velocities, programs, channels, track names, the
 * tempo and meter maps — compactly and in a format other tools can read. What it has no
 * place for is the Studio's own per-track UI state (our stable track id, lane colour, mute
 * and solo), so that rides alongside as `trackMeta`, indexed positionally since SMF
 * preserves track order.
 *
 * Pure and platform-free, so the round-trip harness drives it directly and the store stays
 * a thin wrapper.
 */

import { base64ToBytes, bytesToBase64 } from './base64';
import { readSmf, writeSmf, type SmfTrack } from './smf';
import { compileTempoMap, DEFAULT_BPM, type TempoEvent, type TimeSignatureEvent } from './tempo';
import { passesDurationFloor } from './duration';
import { passesVelocityFloor } from './velocity';
import type {
  MidiNote, MidiProject, MidiTrackData, RecordingSource, VelocitySource,
} from '@/types';

/** Lane colours, assigned round-robin so a freshly imported arrangement is legible at
 *  arrange-view scale without anyone picking colours by hand. */
export const TRACK_COLORS = [
  '#4F9DF7', '#F7834F', '#5FCE7E', '#C77DF7',
  '#F7D24F', '#4FD4D4', '#F76F8E', '#9BA8F7',
] as const;

export const DEFAULT_TRACK_COLOR = TRACK_COLORS[0];

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function trackColorFor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}

/** Last sounding moment across every track, which is what the timeline has to span. */
export function projectDurationMs(tracks: readonly MidiTrackData[]): number {
  let end = 0;
  for (const track of tracks) {
    for (const note of track.notes) {
      const noteEnd = note.timeMs + note.durationMs;
      if (noteEnd > end) end = noteEnd;
    }
  }
  return end;
}

/** Where the music actually begins — the earliest note anywhere in the project.
 *
 * Deliberately over *stored* notes rather than `trackAudibleNotes`: the two floors are a
 * lens, not a delete (see `trackAudibleNotes`), so a note hidden under a floor is still
 * part of the arrangement. Reading the start from audible notes only would mean raising a
 * floor moves the start, and lowering it again lands the newly-revealed note at a negative
 * time.
 *
 * 0 for a project with no notes at all, so callers get a usable number rather than Infinity.
 */
export function projectStartMs(tracks: readonly MidiTrackData[]): number {
  let start = Infinity;
  for (const track of tracks) {
    for (const note of track.notes) {
      if (note.timeMs < start) start = note.timeMs;
    }
  }
  return Number.isFinite(start) ? start : 0;
}

/**
 * Slide a tempo or meter map along with the notes it describes.
 *
 * Two rules, both forced by `compileTempoMap`, which needs an event at 0 and cannot read a
 * negative one:
 *
 *  - The opening event stays pinned at 0. A shift to the right opens a silent lead-in, and
 *    the tempo governing that lead-in is the one the piece already opened with.
 *  - A later event dragged to or past 0 by a leftward shift *becomes* the opening event.
 *    It is the one in force by the time the music starts, so dropping it would leave the
 *    wrong opening tempo standing. When several overrun, the last one wins.
 */
function shiftTimedEvents<T extends { timeMs: number }>(
  events: readonly T[], deltaMs: number,
): T[] {
  if (events.length === 0) return [];

  const later: T[] = [];
  let overrun: T | null = null;

  for (const event of events.slice(1)) {
    const timeMs = event.timeMs + deltaMs;
    if (timeMs > 0) later.push({ ...event, timeMs });
    else overrun = event;
  }

  return [{ ...(overrun ?? events[0]), timeMs: 0 }, ...later];
}

/**
 * Move the whole arrangement along the timeline — every note on every track, plus both
 * event maps, by the same delta.
 *
 * This is how the Studio's "Starts at" control trims or pads the silence before the first
 * note: `shiftProjectTime(project, target - projectStartMs(project.tracks))`. Uniformity is
 * the point — one delta for everything means relative timing, across tracks as much as
 * within them, comes out the far side untouched.
 *
 * The maps travel too, which is the part that is easy to leave out and wrong to. Tempo and
 * meter events are `timeMs`-stamped like notes; move the notes alone and a tempo change
 * written for one bar fires against a different one.
 */
export function shiftProjectTime(project: MidiProject, deltaMs: number): MidiProject {
  if (deltaMs === 0) return project;

  const tracks = project.tracks.map((track) => ({
    ...track,
    notes: track.notes.map((note) => ({ ...note, timeMs: note.timeMs + deltaMs })),
  }));

  return {
    ...project,
    tracks,
    tempos:         shiftTimedEvents(project.tempos, deltaMs),
    timeSignatures: shiftTimedEvents(project.timeSignatures, deltaMs),
    // Stored, and what the transport reads as its total time — a stale span would leave the
    // playhead unable to reach the end of a right-shifted arrangement.
    durationMs:     projectDurationMs(tracks),
  };
}

/** The tempo the piece opens at — the one the Studio's BPM field shows and edits. */
export function openingBpmOf(project: MidiProject): number {
  return project.tempos[0]?.bpm ?? DEFAULT_BPM;
}

/**
 * Change the arrangement's tempo, stretching the music rather than just the ruler over it.
 *
 * `bpm` names the *opening* tempo, and everything scales by the ratio it implies: note times
 * and lengths, and both maps' event positions. Scaling the later tempo events too is what
 * keeps a ritardando a ritardando — the map's internal ratios are musical content, and
 * pinning them to their old milliseconds while the notes move would slide the tempo change
 * off the note it belongs to.
 *
 * The invariant is that every note comes out on the beat it went in on: time stretches, the
 * music doesn't. That's the opposite of `shiftProjectTime`, which moves the music through
 * time without changing its tempo, and it's the same operation the tab editor's `setBpm`
 * performs on a session with a single tempo.
 *
 * Deliberately *not* what a tempo change means to a DAW holding an imported performance,
 * where the recorded timing is the truth and the tempo map is a reading of it. The Studio's
 * BPM control lives on the transport bar next to play and loop, where "+5 BPM" means "play
 * this faster"; re-notating instead left the piece exactly as long as it was.
 */
export function scaleProjectTempo(project: MidiProject, bpm: number): MidiProject {
  const openingBpm = openingBpmOf(project);
  if (!(bpm > 0) || bpm === openingBpm) return project;

  // Time scales inversely with tempo: twice the BPM, half the milliseconds.
  const ratio = openingBpm / bpm;

  const tracks = project.tracks.map((track) => ({
    ...track,
    notes: track.notes.map((note) => ({
      ...note,
      timeMs:     Math.round(note.timeMs * ratio),
      // Floor of 1ms so rounding can't collapse a very short note at a very high tempo into
      // a zero-length one, which no longer sounds and can't be grabbed in the roll.
      durationMs: Math.max(1, Math.round(note.durationMs * ratio)),
    })),
  }));

  const tempos: TempoEvent[] = project.tempos.length > 0
    ? project.tempos.map((t) => ({ ...t, timeMs: Math.round(t.timeMs * ratio), bpm: t.bpm / ratio }))
    : [{ timeMs: 0, bpm }];

  return {
    ...project,
    tracks,
    tempos,
    timeSignatures: project.timeSignatures.map((s) => ({ ...s, timeMs: Math.round(s.timeMs * ratio) })),
    durationMs:     projectDurationMs(tracks),
  };
}

/**
 * Swap one track's notes, keeping the stored `durationMs` true.
 *
 * `durationMs` is stored rather than derived — it's what the transport reads as its total
 * time — so every edit that can move the last sounding moment has to recompute it. Editing
 * notes through a plain spread didn't, which left the playhead unable to reach a note
 * dragged past the old end of the piece until the project was reloaded.
 */
export function replaceTrackNotes(
  project: MidiProject, trackId: string, notes: MidiTrackData['notes'],
): MidiProject {
  const tracks = project.tracks.map((t) => (t.id === trackId ? { ...t, notes } : t));
  return { ...project, tracks, durationMs: projectDurationMs(tracks) };
}

export function createTrack(index: number, init: Partial<MidiTrackData> = {}): MidiTrackData {
  return {
    id:      init.id      ?? newId('track'),
    name:    init.name    ?? `Track ${index + 1}`,
    program: init.program ?? 0,
    // Channel 9 is percussion, so a plain index would silently make the tenth track drums.
    channel: init.channel ?? (index % 16 === 9 ? 15 : index % 16),
    color:   init.color   ?? trackColorFor(index),
    muted:   init.muted   ?? false,
    soloed:  init.soloed  ?? false,
    notes:   init.notes   ?? [],
    velocitySource: init.velocitySource,
    velocityFloor:  init.velocityFloor,
    durationFloorMs: init.durationFloorMs,
  };
}

/**
 * A track's notes as its two floors leave them.
 *
 * The one place the floors are applied to *music*, so the roll, playback, MIDI export and
 * conversion can't disagree about which notes are in. Returns the same array reference when
 * both are off — the overwhelmingly common case, where filtering would copy every track's
 * notes on every render for identical contents.
 *
 * Note what this is deliberately *not* used by: `serializeProject`. Saving must keep every
 * note, or the filters stop being a lens and become a delete with extra steps.
 */
export function trackAudibleNotes(
  track: Pick<MidiTrackData, 'notes' | 'velocityFloor' | 'durationFloorMs'>,
): MidiNote[] {
  const floor         = track.velocityFloor ?? 0;
  const durationFloor = track.durationFloorMs ?? 0;
  if (floor <= 0 && durationFloor <= 0) return track.notes;
  return track.notes.filter((n) =>
    passesVelocityFloor(n.velocity, floor) && passesDurationFloor(n.durationMs, durationFloor));
}

/**
 * The project as its per-track floors leave it — what leaves the Studio, never what's
 * stored. Both export paths (Download MIDI, convert to tab) go through this so a note the
 * user has filtered out doesn't reappear in the file they just downloaded.
 */
export function audibleProject(project: MidiProject): MidiProject {
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      const notes = trackAudibleNotes(t);
      return notes === t.notes ? t : { ...t, notes };
    }),
  };
}

/**
 * A title that no existing project already uses — "Folk tune", then "Folk tune 2", "3"...
 *
 * Every creation path could previously mint a duplicate: `createProject` defaults to the
 * constant `'Untitled project'`, and the two import paths take the source file's name
 * verbatim, so importing one file twice produced two cards that were identical in every
 * visible respect. A library you cannot tell apart is not a library.
 *
 * Applied on insert only (see `saveProject`), never on update — renaming a project because
 * it was saved again would be worse than the collision.
 */
export function uniqueProjectTitle(desired: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(desired)) return desired;
  for (let n = 2; ; n++) {
    const candidate = `${desired} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function createProject(init: Partial<MidiProject> = {}): MidiProject {
  const now = Date.now();
  const tracks = init.tracks ?? [createTrack(0)];
  return {
    id:             init.id        ?? newId('proj'),
    title:          init.title     ?? 'Untitled project',
    createdAt:      init.createdAt ?? now,
    updatedAt:      init.updatedAt ?? now,
    tracks,
    tempos:         init.tempos         ?? [{ timeMs: 0, bpm: 120 }],
    timeSignatures: init.timeSignatures ?? [{ timeMs: 0, numerator: 4, denominator: 4 }],
    durationMs:     init.durationMs     ?? projectDurationMs(tracks),
    origin:         init.origin,
  };
}

/**
 * Build a project from raw SMF bytes — the import path.
 *
 * Every track is kept, including percussion and note-less ones, because this is an editor
 * rather than the tab-import pipeline: a drum track is legitimate context to see and hear
 * while working, and silently dropping tracks would make a save/load round trip lossy.
 * `parseMidiFile` still does the filtering the *conversion* step needs.
 */
export function projectFromSmfBytes(bytes: Uint8Array, title: string): MidiProject {
  const smf = readSmf(bytes);

  const tracks = smf.tracks.map((track, index) =>
    createTrack(index, {
      name:    track.name ?? `Track ${index + 1}`,
      program: track.program,
      channel: track.channel,
      notes:   track.notes.map((n) => ({ ...n })),
    }),
  );

  return createProject({
    title,
    tracks,
    tempos:         smf.tempos,
    timeSignatures: smf.timeSignatures,
    durationMs:     smf.durationMs || projectDurationMs(tracks),
  });
}

/**
 * Build a single-track project from transcribed notes — the audio-import path.
 *
 * Audio arrives as one voice's worth of detected notes with no tracks, no tempo map and no
 * instrument, so this is `projectFromSmfBytes`'s counterpart for a source that carries none
 * of that structure. It stays a thin composition of `createProject`/`createTrack` rather
 * than assembling a project literal, so a field added to either keeps arriving here.
 *
 * `velocitySource` is required, not optional: a transcription's velocities always came from
 * a specific engine, and a track that reaches conversion without one would have its notes
 * mislabelled as stated MIDI velocities.
 */
export function projectFromMidiNotes(
  notes: MidiNote[],
  title: string,
  options: {
    bpm?: number;
    velocitySource: VelocitySource;
    trackName?: string;
    /** What produced these notes — a live take or an uploaded file. Travels with the
     *  project so the tab it eventually becomes reports its real origin rather than the
     *  route it took to get there. */
    origin?: RecordingSource;
  },
): MidiProject {
  const track = createTrack(0, {
    // Named for the source rather than "Track 1": this is the only track, and the Studio's
    // track list is where the user first sees what was imported.
    name:  options.trackName ?? title,
    notes: notes.map((n) => ({ ...n })),
    velocitySource: options.velocitySource,
  });

  return createProject({
    title,
    tracks: [track],
    // Audio has no tempo map — a transcription is a stream of timestamps, not bars — so the
    // caller reads one off the onsets and passes it here. Absent when detection wasn't
    // confident enough to name one, and then `createProject`'s 120 stands as a display grid
    // rather than a claim about the performance. Either way every note's position is
    // absolute ms, so this cannot mistime anything: it decides where the bar lines fall, not
    // where the notes do.
    tempos: options.bpm ? [{ timeMs: 0, bpm: Math.round(options.bpm) }] : undefined,
    origin: options.origin,
  });
}

/** Per-track state SMF has nowhere to put. Positional — SMF preserves track order. */
export interface StoredTrackMeta {
  id:     string;
  color:  string;
  muted:  boolean;
  soloed: boolean;
  /** SMF stores a velocity byte but nothing about what scale it's on, and a transcribed
   *  project's velocities are an engine's estimate rather than a composer's intent.
   *  Optional: absent on every project saved before this existed, and on ordinary MIDI
   *  imports, where `convertTrackToRecording` correctly assumes stated MIDI velocity.
   *
   *  Survives the user editing individual note velocities in the roll — the scale is a
   *  property of how the track was measured, not of any one note's current value. */
  velocitySource?: VelocitySource;
  /** The track's velocity-floor line, so where the user left it survives a reload. Absent
   *  on every project saved before this existed, which reads as 0 — filter off. */
  velocityFloor?: number;
  /** The track's duration-floor line in ms, so where the user left it survives a reload.
   *  Absent on every project saved before this existed, which reads as 0 — filter off. */
  durationFloorMs?: number;
}

export interface StoredProject {
  id:         string;
  title:      string;
  createdAt:  number;
  updatedAt:  number;
  durationMs: number;
  /** base64 SMF: notes, velocities, programs, channels, names, tempo and meter maps. */
  smf:        string;
  trackMeta:  StoredTrackMeta[];
  /** SMF has nowhere to state where a project came from, so it rides alongside. Absent on
   *  everything saved before this existed. */
  origin?:    RecordingSource;
}

/**
 * The project as a standard MIDI file.
 *
 * Shared by persistence (which stores projects as base64 SMF) and the Studio's Download
 * MIDI — the same bytes either way, which is what makes the downloaded file exactly the
 * project rather than a second, subtly different rendering of it. Studio-only state
 * (lane colour, mute, solo) has no SMF representation and rides in `trackMeta` instead;
 * a downloaded file therefore carries the music, not the mixing desk.
 */
export function projectToSmfBytes(project: MidiProject): Uint8Array {
  const smfTracks: SmfTrack[] = project.tracks.map((track) => ({
    name:    track.name,
    program: track.program,
    channel: track.channel,
    notes:   track.notes,
  }));
  return writeSmf(smfTracks, project.tempos, project.timeSignatures);
}

export function serializeProject(project: MidiProject): StoredProject {
  return {
    id:         project.id,
    title:      project.title,
    createdAt:  project.createdAt,
    updatedAt:  project.updatedAt,
    durationMs: project.durationMs,
    // The project itself, floors ignored — a filtered-out note is hidden, not gone, so it
    // has to survive the save that the filter's own persistence rides along in.
    smf:        bytesToBase64(projectToSmfBytes(project)),
    trackMeta:  project.tracks.map((t) => ({
      id: t.id, color: t.color, muted: t.muted, soloed: t.soloed,
      velocitySource: t.velocitySource,
      velocityFloor:  t.velocityFloor,
      durationFloorMs: t.durationFloorMs,
    })),
    origin: project.origin,
  };
}

export function deserializeProject(stored: StoredProject): MidiProject {
  const smf = readSmf(base64ToBytes(stored.smf));

  const tracks: MidiTrackData[] = smf.tracks.map((track, index) => {
    // A missing sidecar entry is survivable — a project whose colours are regenerated is
    // far better than one that fails to open.
    const meta = stored.trackMeta[index];
    return createTrack(index, {
      id:      meta?.id,
      name:    track.name ?? `Track ${index + 1}`,
      program: track.program,
      channel: track.channel,
      color:   meta?.color,
      muted:   meta?.muted,
      soloed:  meta?.soloed,
      velocitySource: meta?.velocitySource,
      velocityFloor:  meta?.velocityFloor,
      durationFloorMs: meta?.durationFloorMs,
      notes:   track.notes.map((n) => ({ ...n })),
    });
  });

  return {
    id:             stored.id,
    title:          stored.title,
    createdAt:      stored.createdAt,
    updatedAt:      stored.updatedAt,
    tracks,
    tempos:         smf.tempos,
    timeSignatures: smf.timeSignatures,
    durationMs:     stored.durationMs || projectDurationMs(tracks),
    origin:         stored.origin,
  };
}

/** Compiled map for a project, for callers doing timeline math. Cheap, but not free —
 *  memoize it on `project.tempos`/`timeSignatures` identity in components. */
export function tempoMapOf(project: Pick<MidiProject, 'tempos' | 'timeSignatures'>) {
  return compileTempoMap(project.tempos, project.timeSignatures);
}

export type { TempoEvent, TimeSignatureEvent, MidiNote };
