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
import { compileTempoMap, type TempoEvent, type TimeSignatureEvent } from './tempo';
import type { MidiNote, MidiProject, MidiTrackData } from '@/types';

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
  };
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

/** Per-track state SMF has nowhere to put. Positional — SMF preserves track order. */
export interface StoredTrackMeta {
  id:     string;
  color:  string;
  muted:  boolean;
  soloed: boolean;
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
    smf:        bytesToBase64(projectToSmfBytes(project)),
    trackMeta:  project.tracks.map((t) => ({
      id: t.id, color: t.color, muted: t.muted, soloed: t.soloed,
    })),
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
  };
}

/** Compiled map for a project, for callers doing timeline math. Cheap, but not free —
 *  memoize it on `project.tempos`/`timeSignatures` identity in components. */
export function tempoMapOf(project: Pick<MidiProject, 'tempos' | 'timeSignatures'>) {
  return compileTempoMap(project.tempos, project.timeSignatures);
}

export type { TempoEvent, TimeSignatureEvent, MidiNote };
