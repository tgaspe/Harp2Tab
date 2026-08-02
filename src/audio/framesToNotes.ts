/**
 * The cheap, key-dependent half of the import pipeline: `RawFrame[]` → committed notes,
 * with no DSP involved. Separated from analyzeSamples.ts on purpose — automatic key
 * detection re-runs *this* twelve times (once per candidate key) over one set of frames,
 * instead of re-analyzing the audio, and a future "re-detect in a different key" button in
 * the editor is the same call again.
 *
 * The frames themselves can come from anywhere: an uploaded file's analysis pass, or a
 * live session's retained buffer.
 */

import { createNoteDetector, type NoteDetectorConfig } from './NoteDetector';
import { withBreathForce } from './breathForce';
import type { HarmonicaKey, HarmonicaType, RawFrame, TabNote } from '@/types';

export function framesToNotes(
  frames: RawFrame[],
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  config?: Partial<NoteDetectorConfig>,
): Omit<TabNote, 'id'>[] {
  const notes: Omit<TabNote, 'id'>[] = [];
  const detector = createNoteDetector((note) => notes.push(note), key, harmonicaType, config);

  // `RawFrame.t` is already relative to the session start, so the recording-start baseline
  // the detector subtracts is 0 here — unlike the live path, which passes wall-clock
  // timestamps and the session's epoch start.
  for (const frame of frames) detector.process(frame, frame.t, 0);
  detector.flush(0);

  // Annotated after segmentation rather than during it: breath force is measured against
  // the *take's* dynamic range, which isn't known until every frame has been seen.
  return withBreathForce(notes, frames);
}
