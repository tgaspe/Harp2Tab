/**
 * Orchestrates one MIDI-file import: read bytes → parse. That's the whole pipeline —
 * MIDI is the audio path with its expensive half deleted, so there is no decode, no pitch
 * detection, and nothing to report progress about.
 *
 * Kept as its own module for the same reason as runAudioImport: the import screen deals
 * with errors and choices, not with how a file becomes notes, and the verification harness
 * can drive the parse side without any of this.
 */

import { assertSizeWithinLimit, type PickedAudioFile } from './audioImport';
import { parseMidiFile, type ParsedMidi } from './midiToNotes';
import { readFileBytes } from './readFileBytes';

export interface MidiImportResult extends ParsedMidi {
  /** The original file, retained so "Open in Studio" can build a project from it.
   *  `ParsedMidi` can't stand in: it drops percussion and note-less tracks for tab import,
   *  and the Studio has to keep every track a file declares. */
  bytes: Uint8Array;
}

export async function runMidiImport(picked: PickedAudioFile): Promise<MidiImportResult> {
  // Checked before reading, so an oversized file is rejected rather than loaded.
  assertSizeWithinLimit(picked.size, picked.name);
  const bytes = await readFileBytes(picked);
  return { ...parseMidiFile(bytes, picked.name), bytes };
}
