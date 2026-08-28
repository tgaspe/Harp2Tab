/**
 * The standard MIDI bytes each screen hands the audio renderer.
 *
 * Both screens already know how to produce an SMF — the tab editor through
 * `generateForFormat(..., 'MIDI')`, the Studio through `projectToSmfBytes`. Audio export
 * reuses those rather than walking the notes again, which is what guarantees the audio a
 * user exports is the MIDI file they could have exported, rendered. A second note→MIDI path
 * would drift from the first the moment either changed.
 *
 * Pure and platform-neutral: no browser API, no store access. That is deliberate — this is
 * the only part of the audio pipeline the Node harness can test end to end.
 */

import { base64ToBytes } from '@/audio/base64';
import { audibleProject, projectToSmfBytes } from '@/audio/midiProject';
import { DEFAULT_PROGRAM } from '@/audio/timbre';
import { generateForFormat, singlePart } from '@/export/generators';
import type { HarmonicaKey, HarmonicaType, MidiProject, TabNote } from '@/types';

/** Raised when there is nothing to render, so the UI can say so before spinning up a
 *  40MB soundfont and an offline audio context to render silence. */
export class EmptyArrangementError extends Error {
  constructor() {
    super('There is nothing to export — this arrangement has no notes.');
    this.name = 'EmptyArrangementError';
  }
}

/**
 * The tab editor's audio source.
 *
 * `notes` must already be the *audible* set (`useAudibleNotes`), matching every other export
 * path: a note hidden by the velocity or duration floor is excluded from the editor, the
 * note count and playback, so it must not be audible in an exported file either.
 */
export function tabAudioSource(
  notes: TabNote[],
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  program = DEFAULT_PROGRAM,
): Uint8Array {
  if (notes.length === 0) throw new EmptyArrangementError();
  const { content } = generateForFormat(singlePart(notes, key, harmonicaType, 'Harmonica', program), 'MIDI');
  return base64ToBytes(content);
}

/**
 * The Studio's audio source — the same bytes `handleDownloadMidi` writes.
 *
 * `audibleProject` applies the per-track velocity and duration floors and nothing else.
 * **Mute and solo are deliberately ignored** (Phase 17 decision 7): those are a mixing desk,
 * a way of listening while you work, and an export carries the music rather than the desk —
 * which is what the Studio's MIDI download has always done. Filtering by them here would
 * also make WAV and MIDI of one project two different pieces of music.
 *
 * Note the filtering happens *to the project*, never inside `projectToSmfBytes`: that
 * function is also how projects are persisted (`serializeProject`), so a filter inside it
 * would delete notes from saved work.
 */
export function projectAudioSource(project: MidiProject): Uint8Array {
  const audible = audibleProject(project);
  const hasNotes = audible.tracks.some((t) => t.notes.length > 0);
  if (!hasNotes) throw new EmptyArrangementError();
  return projectToSmfBytes(audible);
}
