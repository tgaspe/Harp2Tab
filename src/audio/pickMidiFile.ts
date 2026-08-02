/**
 * File selection for the MIDI-upload entry point — sibling of pickAudioFile, and the same
 * accessibility commitment: a real button opens the picker, so keyboard and screen-reader
 * users have a first-class path in. Drag-and-drop can be layered on later; it can never be
 * the only way to choose a file.
 */

import * as DocumentPicker from 'expo-document-picker';
import { assertSizeWithinLimit, type PickedAudioFile } from './audioImport';

// MIME *and* extension, because Android reports MIDI as any of audio/midi, audio/x-midi
// or application/octet-stream depending on where the file came from — the same
// inconsistency WAV has. The real gate is the "MThd" header check in parseMidiFile; this
// list only decides what the picker greys out.
const MIDI_TYPES = ['audio/midi', 'audio/x-midi', 'audio/mid', '.mid', '.midi'];

/** Returns null when the user dismisses the picker — a cancel, not an error. */
export async function pickMidiFile(): Promise<PickedAudioFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type:                 MIDI_TYPES,
    multiple:             false,
    copyToCacheDirectory: true,
    // Web-only, and it defaults to *true* — which would base64-encode the whole file into
    // the result uri. readFileBytes reads `asset.file` directly instead.
    base64:               false,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const picked: PickedAudioFile = {
    name:     asset.name,
    uri:      asset.uri,
    mimeType: asset.mimeType,
    size:     asset.size,
    file:     asset.file,
  };

  assertSizeWithinLimit(picked.size, picked.name);
  return picked;
}
