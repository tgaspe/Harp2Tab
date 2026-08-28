/**
 * Standard MIDI bytes → rendered stereo PCM, through the same soundfont playback uses.
 *
 * The alternative was synthesizing export audio ourselves, which would make an exported
 * file sound like neither the app's playback nor the instruments the user picked. Going
 * through spessasynth offline means an export *is* playback, rendered faster than realtime:
 * program changes, the percussion channel, velocity layers, filter envelopes and loop points
 * all come along because it is literally the same engine reading the same `.sf3`.
 *
 * Deliberately independent of `SoundFontSynth.web.ts`'s live singleton. Reusing that
 * instance would interrupt playback, and could not satisfy the ordering rule below in any
 * case — it has already had a soundbank added by the time anyone asks for an export.
 */

import { BasicMIDI } from 'spessasynth_core';
import { WorkletSynthesizer } from 'spessasynth_lib';

import {
  AUDIO_EXPORT_SAMPLE_RATE,
  AUDIO_EXPORT_TAIL_SEC,
  type RenderedAudio,
} from '@/export/audioFormats';

/** Same two URLs the live synth uses (`SoundFontSynth.web.ts`), and for the same reason:
 *  loaded by plain path rather than `new URL(..., import.meta.url)`, because Metro does not
 *  implement `import.meta.url` and silently emits a path the browser cannot fetch. */
const PROCESSOR_URL = '/spessasynth_processor.min.js';
const SOUNDFONT_URL = '/soundfonts/MuseScore_General-0.2.0.sf3';

/**
 * The soundfont, cached as *bytes* rather than as an `ArrayBuffer`.
 *
 * This is not a style choice. `startOfflineRender` posts its `soundBankList` buffers to the
 * worklet as **transferables** (`spessasynth_lib/dist/index.js`), so the `ArrayBuffer` it is
 * handed is detached the moment a render starts. Caching the buffer itself would work
 * exactly once and hand every later export a zero-length buffer; caching bytes lets each
 * render take its own copy.
 */
let soundFontBytes: Uint8Array | null = null;
let soundFontLoad: Promise<Uint8Array> | null = null;

/** Thrown for conditions the user can act on, so the popup can say something better than
 *  "export failed". `cause` is the underlying error where there is one. */
export class AudioRenderError extends Error {
  constructor(
    readonly kind: 'unsupported' | 'assetLoad' | 'render',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AudioRenderError';
  }
}

function assertSupported() {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new AudioRenderError(
      'unsupported',
      "This browser can't render audio exports. Try the latest Chrome, Firefox or Safari.",
    );
  }
}

async function loadSoundFontBytes(): Promise<Uint8Array> {
  if (soundFontBytes) return soundFontBytes;
  if (soundFontLoad) return soundFontLoad;

  soundFontLoad = (async () => {
    let response: Response;
    try {
      response = await fetch(SOUNDFONT_URL);
    } catch (e) {
      soundFontLoad = null;
      throw new AudioRenderError('assetLoad', 'Could not download the instrument sounds. Check your connection and try again.', { cause: e });
    }
    if (!response.ok) {
      soundFontLoad = null;
      throw new AudioRenderError('assetLoad', `Could not download the instrument sounds (${response.status}).`);
    }
    soundFontBytes = new Uint8Array(await response.arrayBuffer());
    return soundFontBytes;
  })();

  return soundFontLoad;
}

/**
 * Render one standard MIDI file to stereo PCM.
 *
 * The call order in here is load-bearing and is spessasynth's own requirement: the worklet
 * module, then the synthesizer, then `startOfflineRender` with **nothing in between**.
 * Chromium drops worklet messages posted to an `OfflineAudioContext` before the render
 * starts, so the usual `soundBankManager.addSoundBank()` / `await isReady` dance the live
 * synth does would silently produce a file of pure silence. The soundbank travels inside the
 * render config instead, which is exactly why that API takes one.
 */
export async function renderMidiAudio(smf: Uint8Array): Promise<RenderedAudio> {
  assertSupported();

  const bytes = await loadSoundFontBytes();
  // `.slice()` copies. Handing over `bytes.buffer` would detach the cache itself — see the
  // note on `soundFontBytes`.
  const soundBankBuffer = bytes.slice().buffer;

  const midi = BasicMIDI.fromArrayBuffer(smf.slice().buffer as ArrayBuffer);
  if (midi.duration <= 0) {
    throw new AudioRenderError('render', 'There is nothing to export — this arrangement has no notes.');
  }

  // An OfflineAudioContext is fixed-length at construction and cannot grow, so the tail has
  // to be budgeted for here rather than discovered at the end.
  const frames = Math.ceil((midi.duration + AUDIO_EXPORT_TAIL_SEC) * AUDIO_EXPORT_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, frames, AUDIO_EXPORT_SAMPLE_RATE);

  try {
    await ctx.audioWorklet.addModule(PROCESSOR_URL);
  } catch (e) {
    throw new AudioRenderError('assetLoad', 'Could not load the audio engine. Try reloading the page.', { cause: e });
  }

  const synth = new WorkletSynthesizer(ctx);
  try {
    synth.connect(ctx.destination);
    await synth.startOfflineRender({
      midiSequence:  midi,
      loopCount:     0,
      soundBankList: [{ bankOffset: 0, soundBankBuffer }],
    });
    // Without this the promise above resolves having rendered nothing — `startOfflineRender`
    // arms the sequencer, `startRendering` actually turns the handle.
    const buffer = await ctx.startRendering();
    return {
      left:        buffer.getChannelData(0),
      right:       buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0),
      sampleRate:  buffer.sampleRate,
      durationSec: buffer.duration,
    };
  } catch (e) {
    if (e instanceof AudioRenderError) throw e;
    throw new AudioRenderError('render', 'Rendering the audio failed. Try again, or export MIDI instead.', { cause: e });
  } finally {
    synth.destroy();
  }
}
