/**
 * `RenderedAudio` → MP3 or Ogg Vorbis, via LAME and libvorbis compiled to WebAssembly.
 *
 * **Everything here is vendored into `public/encoders/` and loaded by URL. Nothing from
 * `wasm-media-encoders` is imported into the bundle** — the package is a devDependency,
 * present only so the three artifacts can be re-copied on upgrade.
 *
 * That is stronger than the usual "Metro can't resolve .wasm" story, and it was measured
 * rather than assumed. Importing the package's ESM entry — even as a dynamic `import()`
 * calling only `createEncoder(mime, url)` — pulled **760KB of base64-inlined WASM** into a
 * chunk, because that one 783KB module also defines `createMp3Encoder`/`createOggEncoder`,
 * whose inline binaries Metro does not tree-shake. The codecs would have been downloaded
 * twice: once as dead base64 in JavaScript, once as the real `.wasm` we fetch.
 *
 * The UMD build is the same library with the inlining stripped: 5.9KB of glue that fetches
 * its binary from a URL you hand it. Loaded through a `<script>` tag, so no bundler is
 * involved in the decision at all — the same reasoning that puts the spessasynth worklet and
 * the soundfont in `public/` (see `SoundFontSynth.web.ts`).
 *
 * Note the explicit wasm URLs matter for more than size: the UMD build's *default* is to
 * fetch its binaries from unpkg.com. Passing our own paths keeps the export path free of any
 * third-party network request.
 */

import { AUDIO_FORMAT_FILE, type AudioExportResult, type RenderedAudio } from './audioFormats';

const GLUE_URL = '/encoders/WasmMediaEncoder.min.js';

const WASM_URL: Record<'MP3' | 'OGG', string> = {
  MP3: '/encoders/mp3.wasm',
  OGG: '/encoders/ogg.wasm',
};

const MIME: Record<'MP3' | 'OGG', 'audio/mpeg' | 'audio/ogg'> = {
  MP3: 'audio/mpeg',
  OGG: 'audio/ogg',
};

/** 192kbps CBR: transparent enough for solo harmonica and a size people recognise. CBR
 *  rather than VBR so the file plays in the widest range of old players. */
const MP3_BITRATE = 192;
/** libvorbis quality, -0.1..1.0. 0.5 is roughly 160kbps — comparable to the MP3 setting. */
const OGG_QUALITY = 0.5;

/** The slice of the UMD global this file uses. Hand-written rather than imported from the
 *  package: importing its types is harmless, but importing anything else from it is exactly
 *  what this module exists to avoid, and one interface is cheaper than that risk. */
interface VendoredEncoder {
  configure(params: {
    sampleRate: number;
    channels: 1 | 2;
    bitrate?: number;
    vbrQuality?: number;
  }): void;
  encode(samples: readonly Float32Array[]): Uint8Array;
  finalize(): Uint8Array;
}

interface WasmMediaEncoderGlobal {
  createEncoder(mimeType: string, wasm: string): Promise<VendoredEncoder>;
}

declare global {
  // eslint-disable-next-line no-var
  var WasmMediaEncoder: WasmMediaEncoderGlobal | undefined;
}

export class AudioEncodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AudioEncodeError';
  }
}

let gluePromise: Promise<WasmMediaEncoderGlobal> | null = null;

/** Load the 5.9KB UMD glue once per page. The script defines `globalThis.WasmMediaEncoder`;
 *  it registers no module system of its own when evaluated from a plain `<script>`. */
function loadGlue(): Promise<WasmMediaEncoderGlobal> {
  if (globalThis.WasmMediaEncoder) return Promise.resolve(globalThis.WasmMediaEncoder);
  if (gluePromise) return gluePromise;

  gluePromise = new Promise<WasmMediaEncoderGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GLUE_URL;
    script.async = true;
    script.onload = () => {
      const global = globalThis.WasmMediaEncoder;
      if (global) resolve(global);
      else reject(new Error('encoder glue loaded but defined no global'));
    };
    script.onerror = () => reject(new Error(`could not load ${GLUE_URL}`));
    document.head.appendChild(script);
  }).catch((e) => {
    // Allow a later export to retry rather than caching the failure for the page's lifetime.
    gluePromise = null;
    throw e;
  });

  return gluePromise;
}

export async function encodeCompressed(
  audio: RenderedAudio,
  format: 'MP3' | 'OGG',
): Promise<AudioExportResult> {
  const { ext, mimeType } = AUDIO_FORMAT_FILE[format];

  let encoder: VendoredEncoder;
  try {
    const lib = await loadGlue();
    encoder = await lib.createEncoder(MIME[format], WASM_URL[format]);
  } catch (e) {
    throw new AudioEncodeError(
      `Could not load the ${format} encoder. Try reloading the page, or export WAV instead.`,
      { cause: e },
    );
  }

  try {
    encoder.configure({
      sampleRate: audio.sampleRate,
      channels:   2,
      ...(format === 'MP3' ? { bitrate: MP3_BITRATE } : { vbrQuality: OGG_QUALITY }),
    });

    const chunks: Uint8Array[] = [];
    let total = 0;
    // Both `encode` and `finalize` return a view onto memory the encoder still owns and will
    // overwrite on the next call — the copy is mandatory, not defensive.
    const take = (chunk: Uint8Array) => {
      chunks.push(new Uint8Array(chunk));
      total += chunk.length;
    };
    take(encoder.encode([audio.left, audio.right]));
    take(encoder.finalize());

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }

    return { blob: new Blob([out.buffer as ArrayBuffer], { type: mimeType }), ext, mimeType };
  } catch (e) {
    throw new AudioEncodeError(`Encoding the ${format} file failed. Try WAV instead.`, { cause: e });
  }
}
