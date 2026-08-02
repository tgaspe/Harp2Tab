/**
 * Picked file → raw bytes, web half. See readFileBytes.ts for why this is its own module
 * rather than living inside the decoders.
 */

import { AudioImportError, type PickedAudioFile } from './audioImport';

export async function readFileBytes(picked: PickedAudioFile): Promise<Uint8Array> {
  try {
    const file = picked.file as File | undefined;
    // The picker hands back a real File on web; the uri fetch is only a fallback for a
    // blob:/data: uri arriving from somewhere else (a future drag-and-drop zone).
    const buffer = file
      ? await file.arrayBuffer()
      : await (await fetch(picked.uri)).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    throw new AudioImportError('decodeFailed', `"${picked.name}" couldn't be read.`);
  }
}
