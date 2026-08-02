/**
 * Native decoder — WAV only.
 *
 * Expo SDK 55 exposes no API that decodes compressed audio (mp3/m4a) to raw PCM, and this
 * app's own native audio module is a capture bridge, not a codec. So Android reads WAV
 * bytes directly (see wav.ts) and tells the user plainly when a file is something else,
 * rather than failing opaquely. Lifting that limit means a MediaCodec-backed Expo module —
 * tracked as Phase 5c, deliberately not a blocker for the web path.
 */

import {
  AudioImportError,
  assertDecodedWithinLimits,
  assertSizeWithinLimit,
  type DecodedAudio,
  type PickedAudioFile,
} from './audioImport';
import { readFileBytes } from './readFileBytes';
import { parseWav } from './wav';

function looksLikeWav(picked: PickedAudioFile): boolean {
  if (picked.name.toLowerCase().endsWith('.wav')) return true;
  const mime = picked.mimeType?.toLowerCase() ?? '';
  return mime.includes('wav') || mime.includes('wave');
}

export async function decodeAudioFile(picked: PickedAudioFile): Promise<DecodedAudio> {
  assertSizeWithinLimit(picked.size, picked.name);

  if (!looksLikeWav(picked)) {
    throw new AudioImportError(
      'unsupportedFormat',
      `"${picked.name}" can't be transcribed on Android yet — only WAV files are supported here. Record directly in the app, or upload this file from the web version.`,
    );
  }

  const bytes = await readFileBytes(picked);
  const audio = parseWav(bytes, picked.name);
  assertDecodedWithinLimits(audio, picked.name);
  return audio;
}
