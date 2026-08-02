/**
 * Picked file → raw bytes, native half.
 *
 * Split out of `decodeAudio` because MIDI import needs the same bytes with no codec
 * involved at all: reading a file and decoding one are two different problems, and only
 * the second is platform-limited. Both importers now share one answer to "how does a
 * picked file become bytes".
 */

import { File } from 'expo-file-system';
import { AudioImportError, type PickedAudioFile } from './audioImport';

export async function readFileBytes(picked: PickedAudioFile): Promise<Uint8Array> {
  try {
    return await new File(picked.uri).bytes();
  } catch {
    throw new AudioImportError('decodeFailed', `"${picked.name}" couldn't be read.`);
  }
}
