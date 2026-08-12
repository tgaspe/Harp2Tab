/**
 * Radix-2 Cooley–Tukey FFT, written here rather than taken as a dependency.
 *
 * Nothing in the project provided one, and the alternatives all cost more than ~120 lines
 * of extremely well-specified arithmetic: a dependency that has to work under Metro on web
 * *and* React Native, or a WASM toolchain this project doesn't otherwise have.
 *
 * Two classes, because the transform this project actually needs is the real-input one:
 * audio is real, and computing an N-point real FFT as an N/2-point complex FFT plus an
 * untangle pass is close to twice as fast as zero-filling an imaginary part. The complex
 * transform stays exported because the untangle needs it and the verification harness
 * checks it directly against a naive DFT.
 *
 * Instances own their scratch buffers rather than sharing module-level ones (which is what
 * `pitchDetector.ts` does): the STFT front end holds one for the whole pass, and a future
 * Worker would need its own without a rewrite.
 */

function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

function reverseBits(value: number, bits: number): number {
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | ((value >>> i) & 1);
  }
  return result >>> 0;
}

/** In-place complex FFT of a fixed power-of-two size. Forward transform only — nothing here
 *  needs an inverse, and an unused one is an untested one. */
export class ComplexFft {
  readonly size: number;

  /** cos/sin at 2πi/size for i < size/2. Float64 on purpose: the tables are built once and
   *  reused for every frame of the take, so a rounding error here is systematic rather than
   *  averaging out. */
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly reversed: Uint32Array;

  constructor(size: number) {
    if (!isPowerOfTwo(size)) {
      throw new Error(`ComplexFft size must be a power of two, got ${size}`);
    }
    this.size = size;

    const half = size >>> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }

    const bits = Math.round(Math.log2(size));
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) this.reversed[i] = reverseBits(i, bits);
  }

  /** Transforms `re`/`im` in place. Both must be exactly `size` long. */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.size;

    for (let i = 0; i < n; i++) {
      const j = this.reversed[i];
      if (j > i) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }

    for (let width = 2; width <= n; width *= 2) {
      const half = width >>> 1;
      const step = n / width;
      for (let start = 0; start < n; start += width) {
        for (let j = start, k = 0; j < start + half; j++, k += step) {
          const l  = j + half;
          const c  = this.cosTable[k];
          const s  = this.sinTable[k];
          // Forward transform: e^{-i2πk/N}, hence the sign on the sine terms.
          const tr =  re[l] * c + im[l] * s;
          const ti = -re[l] * s + im[l] * c;
          re[l] = re[j] - tr;
          im[l] = im[j] - ti;
          re[j] += tr;
          im[j] += ti;
        }
      }
    }
  }
}

/**
 * Real-input FFT of size N, producing the N/2+1 bins that aren't redundant.
 *
 * Packs the real signal's even and odd samples into the real and imaginary parts of an
 * N/2-point complex sequence, transforms that, then separates the two interleaved
 * transforms and recombines them with a half-size twiddle. Standard, and worth the extra
 * forty lines: the STFT runs this ~26,000 times on a five-minute take and it is the single
 * dominant cost in the whole analysis pass.
 */
export class RealFft {
  readonly size: number;
  /** Number of bins written by `forward` — DC through Nyquist inclusive. */
  readonly bins: number;

  private readonly inner:   ComplexFft;
  private readonly halfRe:  Float32Array;
  private readonly halfIm:  Float32Array;
  private readonly twiddleCos: Float64Array;
  private readonly twiddleSin: Float64Array;

  constructor(size: number) {
    if (!isPowerOfTwo(size) || size < 4) {
      throw new Error(`RealFft size must be a power of two >= 4, got ${size}`);
    }
    this.size = size;
    this.bins = (size >>> 1) + 1;

    const half = size >>> 1;
    this.inner  = new ComplexFft(half);
    this.halfRe = new Float32Array(half);
    this.halfIm = new Float32Array(half);

    // e^{-i2πk/N} for k = 0..N/2, applied to the odd-sample transform.
    this.twiddleCos = new Float64Array(half + 1);
    this.twiddleSin = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
      this.twiddleCos[k] = Math.cos((2 * Math.PI * k) / size);
      this.twiddleSin[k] = Math.sin((2 * Math.PI * k) / size);
    }
  }

  /**
   * `input` must be exactly `size` long; `outRe`/`outIm` at least `bins` long.
   * `input` is not modified.
   */
  forward(input: Float32Array, outRe: Float32Array, outIm: Float32Array): void {
    const n    = this.size;
    const half = n >>> 1;

    for (let i = 0; i < half; i++) {
      this.halfRe[i] = input[2 * i];
      this.halfIm[i] = input[2 * i + 1];
    }
    this.inner.transform(this.halfRe, this.halfIm);

    // Bin 0 and bin N/2 are both real, and both fall out of Z[0] alone: the even-sample
    // transform contributes Re(Z[0]) and the odd-sample transform Im(Z[0]).
    const evenDc = this.halfRe[0];
    const oddDc  = this.halfIm[0];
    outRe[0]    = evenDc + oddDc;
    outIm[0]    = 0;
    outRe[half] = evenDc - oddDc;
    outIm[half] = 0;

    for (let k = 1; k < half; k++) {
      const ar = this.halfRe[k];
      const ai = this.halfIm[k];
      // Conjugate of the mirrored bin — the other half of the interleaved pair.
      const br =  this.halfRe[half - k];
      const bi = -this.halfIm[half - k];

      // Even-sample transform: (a + b)/2. Odd-sample transform: (a - b)/2i.
      const er = 0.5 * (ar + br);
      const ei = 0.5 * (ai + bi);
      const or =  0.5 * (ai - bi);
      const oi = -0.5 * (ar - br);

      const c = this.twiddleCos[k];
      const s = this.twiddleSin[k];
      outRe[k] = er + (or * c + oi * s);
      outIm[k] = ei + (oi * c - or * s);
    }
  }
}

/** Magnitudes for `bins` bins. Separate from `forward` because the salience path wants
 *  magnitude and phase from the same transform and neither should pay for the other. */
export function magnitudes(re: Float32Array, im: Float32Array, out: Float32Array, bins: number): void {
  for (let k = 0; k < bins; k++) out[k] = Math.hypot(re[k], im[k]);
}

/** Phases in (-π, π]. */
export function phases(re: Float32Array, im: Float32Array, out: Float32Array, bins: number): void {
  for (let k = 0; k < bins; k++) out[k] = Math.atan2(im[k], re[k]);
}

/** Naive O(n²) DFT. Exists only so the harness can check `RealFft` against something with
 *  no shared machinery — a bug in the twiddle tables would otherwise pass unnoticed. */
export function naiveDft(input: Float32Array): { re: Float64Array; im: Float64Array } {
  const n  = input.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      sumRe += input[t] * Math.cos(angle);
      sumIm += input[t] * Math.sin(angle);
    }
    re[k] = sumRe;
    im[k] = sumIm;
  }
  return { re, im };
}
