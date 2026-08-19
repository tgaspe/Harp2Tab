/**
 * The CQT front end for the HSA v2 engine — a thin wrapper over vendored `cqt-web`.
 *
 * Two things here are not incidental.
 *
 * **The chunking.** `compute()` is one blocking WASM call: 5–9 seconds on a five-minute
 * take with the stack never unwinding, so no progress bar moves, no Cancel is delivered,
 * and the page does not paint. `computeWithProgress` does not help — its callback runs
 * inside the same stack. So the input is sliced, with enough context either side that every
 * retained frame sees the same samples it would have seen in a whole-file run, and the
 * event loop is yielded between slices. `verify-hsa.ts`'s first assertion exists because a
 * wrong slice produces plausible-looking numbers rather than an error.
 *
 * **The Node shim.** The published build is compiled `-sENVIRONMENT=web,worker` and asserts
 * `!ENVIRONMENT_IS_NODE` on load. Without the three lines in `loadModule` the verification
 * harnesses cannot run at all. See `vendor/PROVENANCE.md`.
 */

// Vendored Emscripten glue. It ships no types and `allowJs` resolves it as `any`, which is
// what the wrapper below exists to contain.
import createCQTModule from './vendor/cqt.js';
import { CQT_WASM_BASE64 } from './vendor/cqtWasm';

export interface CqtConfig {
  sampleRate:    number;
  hop:           number;
  binsPerOctave: number;
  nBins:         number;
  fmin:          number;
}

export interface CqtResult {
  nBins:      number;
  frameCount: number;
  /** Row-major, `frame * nBins + bin`. */
  data:       Float32Array;
}

/**
 * The notebook's framing (`HSA_v2_polyphonic.ipynb` cell 3), unchanged.
 *
 * `fmin` is `180 / 2^(1/12)` — a semitone of margin under the 180Hz F0 floor, so the lowest
 * candidate still has a bin beneath it. 152 bins reaches `3200 · 4 · 2^(1/12)` ≈ 13.6kHz, so
 * every candidate is scored on all four of its harmonics.
 *
 * At 24 bins/octave the Q is `1/(2^(1/24) − 1)` ≈ 34.1, which puts the effective analysis
 * window at ~201ms down at 170Hz and ~2.5ms at the top. That spread is why the hop looks
 * oversampled and why `reattack.ts` exists: the pitch track cannot resolve a fast repeated
 * low note, and the RMS envelope can.
 */
export const HSA_CQT_CONFIG: CqtConfig = {
  sampleRate:    44100,
  hop:           512,
  binsPerOctave: 24,
  nBins:         152,
  fmin:          180 / Math.pow(2, 1 / 12),
};

/** Frames per slice — ~9.3s at 11.61ms. Large enough that the context overhead is ~8%,
 *  small enough that a Cancel press lands within about a second. */
const CHUNK_FRAMES = 800;

/**
 * Frames of context kept either side of a slice and then discarded.
 *
 * The longest filter is `Q · sr / fmin` = 8,858 samples, and the transform centres each
 * filter on its frame, so a frame needs ~4,429 samples either side to be computed the way a
 * whole-file run would compute it. 32 hops is 16,384 samples — comfortable margin, and cheap.
 */
const CONTEXT_FRAMES = 32;

let modulePromise: Promise<any> | null = null;
let wasmBinary: Uint8Array | null = null;

/** Decoded once. `atob` exists in every environment this runs in — browsers, and Node
 *  since v16 — so there is no platform branch here. */
function decodeWasm(): Uint8Array {
  if (wasmBinary) return wasmBinary;
  const binary = atob(CQT_WASM_BASE64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  wasmBinary = bytes;
  return bytes;
}

function loadModule(): Promise<any> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    // The vendored build refuses to initialise when it detects Node: it computes
    // `ENVIRONMENT_IS_NODE` from `process.versions?.node` and asserts against it. Under
    // `tsx` (the verification harnesses) that assert fires before any of our code runs, so
    // the environment is disguised for the duration of instantiation only.
    //
    // Scoped narrowly on purpose. An earlier version deleted `globalThis.process` outright,
    // which is a hazard in the browser: instantiation is asynchronous, and any code that
    // read `process.env` during that window would have thrown. Only `versions` is masked, so
    // everything else on `process` keeps working, and the browser — where Metro defines no
    // `process.versions` at all — takes neither branch.
    const g = globalThis as any;
    const hadWindow   = 'window' in g;
    const realProcess = g.process;
    const disguise    = Boolean(realProcess?.versions?.node);
    if (!hadWindow) g.window = g;
    if (disguise) {
      g.process = new Proxy(realProcess, {
        get: (target, key) => (key === 'versions' ? {} : Reflect.get(target, key)),
      });
    }
    try {
      // `wasmBinary` given explicitly, so Emscripten never runs its own fetch path — which
      // has no working answer under `tsx` and would need an asset rule plus a CSP allowance
      // in the browser. See `vendor/cqtWasm.ts`.
      return await createCQTModule({ wasmBinary: decodeWasm() });
    } finally {
      if (disguise) g.process = realProcess;
      if (!hadWindow) delete g.window;
    }
  })();
  return modulePromise;
}

/** Matches the transform's own centred framing, and `librosa.feature.rms` with
 *  `center=True` — which is what keeps the RMS envelope frame-aligned with the CQT. */
export function cqtFrameCount(sampleCount: number, hop: number): number {
  return 1 + Math.floor(sampleCount / hop);
}

export class CqtAnalyzer {
  private readonly config: CqtConfig;
  private instance: any;

  private constructor(config: CqtConfig, instance: any) {
    this.config   = config;
    this.instance = instance;
  }

  static async create(config: CqtConfig): Promise<CqtAnalyzer> {
    const Module = await loadModule();
    const instance = new Module.HybridCQT(
      config.sampleRate, config.hop, config.binsPerOctave, config.nBins, config.fmin,
    );
    return new CqtAnalyzer(config, instance);
  }

  /** One call, no yielding. The harness's reference; never used by the app. */
  analyzeWhole(samples: Float32Array): CqtResult {
    const out = this.instance.compute(samples) as Float32Array;
    return {
      nBins:      this.config.nBins,
      frameCount: out.length / this.config.nBins,
      data:       Float32Array.from(out),
    };
  }

  async analyze(
    samples: Float32Array,
    options: { onProgress?: (fraction: number) => void; shouldCancel?: () => boolean } = {},
  ): Promise<CqtResult> {
    const { hop, nBins } = this.config;
    const frameCount = cqtFrameCount(samples.length, hop);
    const data = new Float32Array(frameCount * nBins);

    for (let first = 0; first < frameCount; first += CHUNK_FRAMES) {
      const last = Math.min(frameCount, first + CHUNK_FRAMES);

      // Slice bounds in samples. Both edges are whole hops, so a slice frame maps onto a
      // global frame by a plain integer offset — which is the property the trim relies on.
      const leadFrames = Math.min(CONTEXT_FRAMES, first);
      const start      = (first - leadFrames) * hop;
      const end        = Math.min(samples.length, (last + CONTEXT_FRAMES) * hop);
      const slice      = samples.subarray(start, end);

      const out      = this.instance.compute(slice) as Float32Array;
      const produced = out.length / nBins;

      for (let f = first; f < last; f++) {
        const local = leadFrames + (f - first);
        if (local >= produced) break;
        data.set(out.subarray(local * nBins, local * nBins + nBins), f * nBins);
      }

      options.onProgress?.(Math.min(1, last / frameCount));
      if (options.shouldCancel?.()) break;
      // setTimeout, not a microtask — a resolved promise would not let React paint the
      // progress bar or let a Cancel press be delivered between slices.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return { nBins, frameCount, data };
  }

  dispose(): void {
    this.instance?.delete();
    this.instance = null;
  }
}
