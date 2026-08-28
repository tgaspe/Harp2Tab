/**
 * Native stub — audio export is web-only.
 *
 * The renderer is an `OfflineAudioContext` driving spessasynth's AudioWorklet, and native
 * has neither. Rendering audio on native would mean a second, unrelated synthesizer, which
 * is Phase 15's question rather than this one's. The UI never offers WAV/MP3/OGG off web
 * (`Platform.OS === 'web'` gates the Audio section), so this throwing is a programming
 * error, not a user-reachable path.
 */

import type { RenderedAudio } from '@/export/audioFormats';

export async function renderMidiAudio(_smf: Uint8Array): Promise<RenderedAudio> {
  throw new Error('Audio export is only available on the web version.');
}
