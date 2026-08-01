/**
 * File selection for the audio-upload entry point. A single wrapper over
 * `expo-document-picker` so the two platforms' result shapes are normalized into
 * `PickedAudioFile` before anything downstream sees them.
 *
 * This is also the accessibility commitment for upload: the picker is opened by a real
 * button, so keyboard and screen-reader users have a first-class path in. A drag-and-drop
 * zone can be layered on later, but it can never be the only way to choose a file.
 */

import * as DocumentPicker from 'expo-document-picker';
import { assertSizeWithinLimit, type PickedAudioFile } from './audioImport';

// Broad on purpose — Android reports WAV as any of audio/wav, audio/x-wav or
// audio/vnd.wave depending on the source app, so narrowing by extension would hide
// perfectly valid files behind a greyed-out picker.
const AUDIO_MIME_TYPES = ['audio/*'];

/** Returns null when the user dismisses the picker — a cancel, not an error. */
export async function pickAudioFile(): Promise<PickedAudioFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type:                 AUDIO_MIME_TYPES,
    multiple:             false,
    copyToCacheDirectory: true,
    // Web-only, and it defaults to *true* — which would base64-encode the entire file into
    // the result uri. The web decoder reads `asset.file` directly instead, so that copy is
    // pure waste at these file sizes.
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

  // Checked here rather than after decoding so an oversized file is rejected before it's
  // read into memory.
  assertSizeWithinLimit(picked.size, picked.name);
  return picked;
}
