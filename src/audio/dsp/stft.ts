/**
 * The STFT front end for the spectral engine: windowed frames in, a list of refined
 * spectral peaks out.
 *
 * Everything here is derived from `sampleRate` and expressed in Hz and ms, so no resampling
 * happens anywhere in this engine. `basicPitch.web.ts` resamples only because its model
 * demands 22050Hz, and `analyzeSamples.ts:14-21` warns that a global rate change silently
 * retunes every calibrated threshold. Nothing here needs a fixed rate — which is also what
 * lets this engine run on native, where there is no `OfflineAudioContext`.
 *
 * The output is a *peak list*, not a spectrum, and that is a deliberate choice with a
 * consequence for the whole engine: two-way mismatch (see `harmonicSalience.ts`) asks
 * whether a predicted harmonic has a real peak to explain it, and that question only has a
 * crisp answer if "peak" is a decision made once, here. Reading raw bins instead would mean
 * every predicted harmonic finds *some* energy, which is exactly how a subharmonic ghost
 * accumulates support it hasn't earned.
 */

import { magnitudes, phases, RealFft } from './fft';

/** Hann's main lobe is 4 bins wide, so a real partial produces exactly one local maximum
 *  and its neighbours are not separate peaks. */
function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  return w;
}

export interface StftConfig {
  sampleRate: number;
  /** Power of two. ~93ms — see the plan's table: the smallest size where a semitone at the
   *  bottom of the harmonica's range is still about one bin, and the largest that fits
   *  inside a 16th note at 120bpm. */
  frameSize:  number;
  /** `frameSize / 8`. The 8× overlap is what makes the phase-difference frequency estimate
   *  unambiguous: it resolves deviations up to ±sampleRate/(2·hop), about ±4 bins. */
  hop:        number;
}

/** ~93ms of window, rounded to a power of two. 4096 at both 44.1kHz and 48kHz. */
export function stftConfigFor(sampleRate: number): StftConfig {
  const target    = 0.093 * sampleRate;
  const frameSize = 2 ** Math.round(Math.log2(target));
  return { sampleRate, frameSize, hop: frameSize >>> 3 };
}

export function frameCountFor(sampleCount: number, config: StftConfig): number {
  if (sampleCount < config.frameSize) return 0;
  return Math.floor((sampleCount - config.frameSize) / config.hop) + 1;
}

export function frameTimeMs(frameIndex: number, config: StftConfig): number {
  // The centre of the window, not its start: a note's energy is centred in the frames that
  // contain it, and reporting the leading edge would bias every onset early by half a
  // window. `candidatesToNotes` refines from here using spectral flux.
  const centre = frameIndex * config.hop + config.frameSize / 2;
  return (centre * 1000) / config.sampleRate;
}

/** Peaks per frame. Klapuri's own implementations cap at exactly 100; five voices with
 *  twenty usable partials each is the most the salience step can consume anyway. */
export const MAX_PEAKS = 100;

/** Whitening exponent — 0 would flatten the spectrum completely, 1 would leave it alone. */
const WHITENING_NU = 0.33;

/** A peak must stand this far above its own local noise floor. */
const PEAK_OVER_FLOOR = 1.6;

/** ...and this far above the frame's loudest bin (-60dB), purely to bound the list. */
const PEAK_OVER_FRAME_MAX = 1e-3;

/** Bands used for both the whitening envelope and the local floor. A third of an octave is
 *  Klapuri's choice and is wide enough that a single partial cannot define its own floor. */
const BAND_RATIO = 2 ** (1 / 3);
const BAND_LOW_HZ = 50;

/**
 * One frame's analysis result. Parallel arrays rather than objects: 26,000 frames × 100
 * peaks is 2.6M allocations otherwise, and this is the hot path of the whole engine.
 */
export interface FrameSpectrum {
  peakCount:  number;
  /** Refined peak frequencies in Hz. Valid for `peakCount` entries, in no particular
   *  order — once the list is full the weakest entry is replaced in place. */
  frequency:  Float32Array;
  /** Whitened, interpolated peak magnitudes, same indexing. */
  magnitude:  Float32Array;
  /** RMS of the raw (unwindowed) samples — the same quantity `analyzeSamples` computes, so
   *  the silence gate means the same thing in both engines. */
  rms:        number;
  /** Half-wave-rectified spectral flux against the previous analysed frame. Drives onset
   *  placement, not detection. */
  flux:       number;
}

export class StftAnalyzer {
  readonly config: StftConfig;

  private readonly fft:      RealFft;
  private readonly window:   Float32Array;
  private readonly windowed: Float32Array;
  private readonly re:       Float32Array;
  private readonly im:       Float32Array;
  private readonly mag:      Float32Array;
  private readonly phase:    Float32Array;
  private readonly envelope: Float32Array;

  private readonly prevPhase: Float32Array;
  private readonly prevMag:   Float32Array;
  /** False after a skipped (gated) frame — the phase estimate needs two consecutive
   *  transforms and would otherwise read a stale array as if it were the previous frame. */
  private hasPrevious = false;

  private readonly bandStart: Int32Array;
  private readonly bandEnd:   Int32Array;
  private readonly bandValue: Float32Array;

  private readonly result: FrameSpectrum;

  constructor(config: StftConfig) {
    this.config   = config;
    this.fft      = new RealFft(config.frameSize);
    this.window   = hannWindow(config.frameSize);
    this.windowed = new Float32Array(config.frameSize);

    const bins = this.fft.bins;
    this.re        = new Float32Array(bins);
    this.im        = new Float32Array(bins);
    this.mag       = new Float32Array(bins);
    this.phase     = new Float32Array(bins);
    this.envelope  = new Float32Array(bins);
    this.prevPhase = new Float32Array(bins);
    this.prevMag   = new Float32Array(bins);

    // Third-octave band edges, in bins.
    const binHz  = config.sampleRate / config.frameSize;
    const starts: number[] = [];
    const ends:   number[] = [];
    for (let lo = BAND_LOW_HZ; lo < config.sampleRate / 2; lo *= BAND_RATIO) {
      const hi    = lo * BAND_RATIO;
      const start = Math.max(1, Math.floor(lo / binHz));
      const end   = Math.min(bins - 1, Math.ceil(hi / binHz));
      if (end > start) { starts.push(start); ends.push(end); }
    }
    this.bandStart = Int32Array.from(starts);
    this.bandEnd   = Int32Array.from(ends);
    this.bandValue = new Float32Array(starts.length);

    this.result = {
      peakCount: 0,
      frequency: new Float32Array(MAX_PEAKS),
      magnitude: new Float32Array(MAX_PEAKS),
      rms:       0,
      flux:      0,
    };
  }

  /** Call when a frame is skipped, so the next analysed frame doesn't difference its phase
   *  against a frame that isn't adjacent to it. */
  skipFrame(): void {
    this.hasPrevious = false;
  }

  /**
   * Analyse the frame starting at `offset`. The returned object is reused on every call —
   * copy anything that has to outlive the next one.
   */
  analyze(samples: Float32Array, offset: number): FrameSpectrum {
    const { frameSize, hop, sampleRate } = this.config;
    const bins  = this.fft.bins;
    const binHz = sampleRate / frameSize;

    let sumSq = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = samples[offset + i];
      sumSq += s * s;
      this.windowed[i] = s * this.window[i];
    }
    this.result.rms = Math.sqrt(sumSq / frameSize);

    this.fft.forward(this.windowed, this.re, this.im);
    magnitudes(this.re, this.im, this.mag, bins);
    phases(this.re, this.im, this.phase, bins);

    this.computeEnvelope(bins);

    let flux = 0;
    if (this.hasPrevious) {
      for (let b = 1; b < bins; b++) {
        const d = this.mag[b] - this.prevMag[b];
        if (d > 0) flux += d;
      }
    }
    this.result.flux = flux;

    this.pickPeaks(bins, binHz, hop, sampleRate);

    this.prevPhase.set(this.phase);
    this.prevMag.set(this.mag);
    this.hasPrevious = true;
    return this.result;
  }

  /**
   * Smoothed magnitude envelope, doing double duty.
   *
   * As a *floor*, it is what separates tonal peaks from the broadband breath noise a
   * harmonica produces in quantity — a single global threshold either keeps noise down in
   * the loud low register or discards real partials up at 3kHz, where the upper partials
   * are genuinely quiet.
   *
   * As a *whitener*, it is Klapuri's spectral whitening: dividing it out makes salience
   * measure harmonic structure rather than timbre. That is what stops a cupped tone, whose
   * fundamental can sit well below its second partial, from reading as the octave above.
   */
  private computeEnvelope(bins: number): void {
    const bandCount = this.bandValue.length;
    for (let i = 0; i < bandCount; i++) {
      const start = this.bandStart[i];
      const end   = this.bandEnd[i];
      let sum = 0;
      for (let b = start; b < end; b++) sum += this.mag[b] * this.mag[b];
      this.bandValue[i] = Math.sqrt(sum / (end - start));
    }

    // Linear interpolation between band centres, held flat outside the outermost ones.
    let band = 0;
    for (let b = 0; b < bins; b++) {
      while (band < bandCount - 1 && b > (this.bandStart[band + 1] + this.bandEnd[band + 1]) / 2) band++;
      if (band >= bandCount - 1) {
        this.envelope[b] = this.bandValue[bandCount - 1];
        continue;
      }
      const c0 = (this.bandStart[band] + this.bandEnd[band]) / 2;
      const c1 = (this.bandStart[band + 1] + this.bandEnd[band + 1]) / 2;
      const t  = Math.min(1, Math.max(0, (b - c0) / (c1 - c0)));
      this.envelope[b] = this.bandValue[band] * (1 - t) + this.bandValue[band + 1] * t;
    }
  }

  private pickPeaks(bins: number, binHz: number, hop: number, sampleRate: number): void {
    let frameMax = 0;
    for (let b = 1; b < bins - 1; b++) if (this.mag[b] > frameMax) frameMax = this.mag[b];

    const envFloor  = frameMax * 1e-6 + 1e-12;
    const absFloor  = frameMax * PEAK_OVER_FRAME_MAX;
    // Deviations beyond this can't be represented by the phase difference, so a value
    // outside it means the bin isn't a steady sinusoid.
    const maxIfDev  = sampleRate / (2 * hop);

    let count = 0;
    for (let b = 1; b < bins - 1; b++) {
      const m = this.mag[b];
      if (m < absFloor) continue;
      if (m <= this.mag[b - 1] || m < this.mag[b + 1]) continue;

      const env = Math.max(this.envelope[b], envFloor);
      if (m < env * PEAK_OVER_FLOOR) continue;

      // Parabolic interpolation on log magnitude: the true peak falls between bins, and
      // reading the bin value under-reads amplitude by up to ~1.4dB with a Hann window.
      const l = Math.log(this.mag[b - 1] + 1e-20);
      const c = Math.log(m + 1e-20);
      const r = Math.log(this.mag[b + 1] + 1e-20);
      const denom = l - 2 * c + r;
      const delta = Math.abs(denom) > 1e-12 ? (0.5 * (l - r)) / denom : 0;
      const offset = Math.abs(delta) <= 0.5 ? delta : 0;

      const parabolicHz = (b + offset) * binHz;
      const peakMag     = Math.exp(c - 0.25 * (l - r) * offset);

      let frequency = parabolicHz;
      if (this.hasPrevious) {
        const expected = (2 * Math.PI * b * hop) / this.config.frameSize;
        let d = this.phase[b] - this.prevPhase[b] - expected;
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        const deviation = (d * sampleRate) / (2 * Math.PI * hop);
        const ifHz = b * binHz + deviation;
        // Trust the phase estimate only when it agrees with the shape of the peak. A
        // disagreement means a transient, or two partials beating inside one bin — both
        // cases where the single-frame estimate is the honest one.
        if (Math.abs(deviation) < maxIfDev && Math.abs(ifHz - parabolicHz) < 0.5 * binHz) {
          frequency = ifHz;
        }
      }

      // Whitening applied to the peak rather than the whole spectrum: the salience step
      // only ever reads peaks, so whitening 2048 bins would be work nothing consumes.
      const whitened = peakMag * Math.pow(env, WHITENING_NU - 1);

      if (count < MAX_PEAKS) {
        this.result.frequency[count] = frequency;
        this.result.magnitude[count] = whitened;
        count++;
      } else {
        // Full: replace the weakest, if this one beats it. Keeps the strongest 100 without
        // sorting the whole list on every frame.
        let weakest = 0;
        for (let i = 1; i < MAX_PEAKS; i++) {
          if (this.result.magnitude[i] < this.result.magnitude[weakest]) weakest = i;
        }
        if (whitened > this.result.magnitude[weakest]) {
          this.result.frequency[weakest] = frequency;
          this.result.magnitude[weakest] = whitened;
        }
      }
    }

    this.result.peakCount = count;
  }
}
