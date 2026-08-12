/**
 * Multiple-F0 estimation over one frame's spectral peaks.
 *
 * Three published ideas, each doing a job the others can't:
 *
 *  - **Harmonic summation** (Klapuri, ISMIR 2006) *generates* candidates. Salience is a
 *    weighted sum of the amplitudes of a candidate's partials, with `g(k) = (f+α)/(k·f+β)`,
 *    α=27, β=320. It is fast and it finds everything — including, reliably, the octave
 *    below everything, because a subharmonic gets to sum the real note's partials as its
 *    own even harmonics.
 *  - **Two-way mismatch** (Maher & Beauchamp, JASA 1994) *discriminates*. It is the octave
 *    fix, and it is two-way because the two octave errors are opposite failures:
 *      · predicted→measured penalises harmonics the candidate predicts where no peak
 *        exists — an octave-low candidate predicts partials at 1.5×, 2.5×, 3.5× f₀ and
 *        nothing is there. **This catches halving.**
 *      · measured→predicted penalises peaks the candidate fails to explain — an octave-high
 *        candidate leaves f₀ and its odd partials measured but unaccounted for.
 *        **This catches doubling.**
 *  - **Iterative cancellation with a polyphony criterion** (Klapuri again) turns one
 *    estimate into several: take the winner, remove its partials, repeat, and stop when
 *    `S_p / p^γ` stops rising rather than at a fixed voice count. A clean single note stops
 *    at one voice, which is itself an anti-ghost measure.
 *
 * Candidates are generated from the peaks themselves (every peak divided by every plausible
 * harmonic number) rather than from a fixed semitone grid, which is what keeps the estimate
 * cent-accurate through a bend without paying for a 10-cent-resolution search.
 */

import type { FrameSpectrum } from './stft';

/** Klapuri's harmonic weighting constants, stated in the ISMIR 2006 paper. */
const ALPHA = 27;
const BETA  = 320;

/** Most partials a candidate is scored on. Beyond ~20 the weighting has made them
 *  irrelevant and reed inharmonicity has moved them anyway. */
const MAX_HARMONICS = 20;

/** How far a measured peak may sit from a predicted harmonic and still be its match. A
 *  quarter-tone absorbs reed inharmonicity and bend transients; much wider and, at high
 *  harmonic numbers, neighbouring partials start matching each other. */
const MATCH_TOLERANCE_CENTS = 50;

/** TWM constants as commonly cited for Maher & Beauchamp's formulation. Worth re-deriving
 *  against the paper if the octave-error rate ever plateaus somewhere disappointing —
 *  these came from secondary sources. */
const TWM_P   = 0.5;
const TWM_Q   = 1.4;
const TWM_R   = 0.5;
const TWM_RHO = 0.33;

/** Bounds on how many predicted harmonics a candidate is scored over. */
const TWM_MIN_HARMONICS = 4;
const TWM_MAX_HARMONICS = 10;

/** Peaks considered when generating candidates, strongest first. */
const CANDIDATE_SOURCE_PEAKS = 12;
/** Harmonic numbers a peak may be, when treated as evidence for a lower fundamental. */
const CANDIDATE_MAX_SUBHARMONIC = 8;
/** Candidates within this distance are the same hypothesis. */
const CANDIDATE_MERGE_CENTS = 20;
/** ...and a candidate this close to an already-committed sound *is* that sound. Wider than
 *  the merge above: a re-estimate after cancellation drifts a little, and reporting the
 *  same note twice is worse than losing a genuine quarter-tone neighbour that no harmonica
 *  can play anyway. */
const ACCEPTED_MERGE_CENTS = 60;
/** How many salience leaders get the (more expensive) TWM treatment. */
const TWM_SHORTLIST = 10;

/** Klapuri's polyphony exponent. Applied in the cheap half — see `candidatesToNotes`. */
export const POLYPHONY_GAMMA = 0.7;

/** Below this a candidate isn't worth storing at all. Deliberately far under any threshold
 *  the tune screen can reach, so lowering a slider always has somewhere to go. */
const MIN_REPORTED_SALIENCE = 0.02;

/** ...and a sound this weak doesn't get an octave probed above it. See `probeOctaves`. */
const PROBE_MIN_BASE_SALIENCE = 0.20;

/**
 * Fraction of a matched peak's magnitude removed when its sound is cancelled.
 *
 * Measured, not chosen. Sweeping it on synthetic harmonic tones gives a clean trade curve
 * between the two things that matter, and they pull in opposite directions:
 *
 * | factor | octave split (1+4) heard | phantom octave on a single note |
 * |--------|--------------------------|---------------------------------|
 * | 0.95   | never                    | never                           |
 * | 0.85   | rarely                   | never                           |
 * | 0.70   | never                    | 9% of frames                    |
 * | 0.55   | always                   | 24% of frames                   |
 *
 * 0.85 is the value that keeps single notes — overwhelmingly the common case, and the
 * thing this engine exists to get right — completely free of phantom octaves. Genuine
 * octave splits are not abandoned to it: they are probed for explicitly below, and admitted
 * by the `octaveEvidence` control rather than by how much energy cancellation happened to
 * leave behind.
 */
const CANCEL_FACTOR = 0.85;

export interface SalienceConfig {
  /** Lowest and highest fundamental worth considering, in Hz. The engine passes the
   *  harmonica's own range, which is what makes a subharmonic ghost below the harp
   *  structurally impossible rather than merely unlikely. */
  minFrequency: number;
  maxFrequency: number;
  sampleRate:   number;
}

export interface Candidate {
  frequency: number;
  /** Whitened harmonic sum, normalised against the frame's strongest peak. 0..1. */
  salience:  number;
  /** `1/(1+TWM error)`, 0..1. Higher means the candidate's harmonics and the measured
   *  peaks agree in both directions — the anti-ghost score. */
  support:   number;
  /**
   * Evidence that this pitch is genuinely sounding *as well as* the note an octave below
   * it, 0..1. Zero for every candidate that isn't an octave probe.
   *
   * A separate number from `support` because it answers a question two-way mismatch
   * structurally cannot. TWM compares predicted harmonic *frequencies* against measured
   * peaks — but a note an octave above another produces no frequency the lower note does
   * not already produce. Its partials are exactly the lower note's even harmonics. There is
   * no missing peak to find and no unexplained peak to punish, so TWM scores a real octave
   * split and a phantom one identically.
   *
   * The only evidence that can exist is *amplitude*: in a real split the even harmonics are
   * stronger than the lower note's own spectral envelope would predict. See
   * `octaveEvidenceFor`.
   */
  octaveEvidence: number;
}

function centsBetween(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}

/**
 * Per-frame working state. Held across frames so the hot path allocates nothing: this runs
 * ~26,000 times on a five-minute take.
 */
export class SalienceAnalyzer {
  private readonly config: SalienceConfig;

  private readonly candFreq = new Float64Array(CANDIDATE_SOURCE_PEAKS * CANDIDATE_MAX_SUBHARMONIC);
  private readonly candSal  = new Float64Array(CANDIDATE_SOURCE_PEAKS * CANDIDATE_MAX_SUBHARMONIC);
  private readonly candErr  = new Float64Array(CANDIDATE_SOURCE_PEAKS * CANDIDATE_MAX_SUBHARMONIC);
  private candCount = 0;

  /** Working copy of the frame's peaks, so cancellation can consume them without
   *  destroying the caller's frame. */
  private readonly peakFreq = new Float64Array(256);
  private readonly peakMag  = new Float64Array(256);
  private peakCount = 0;

  /** The frame's peaks before any cancellation. The octave probe needs these: cancellation
   *  has removed most of the shared partials the octave hypothesis is made of. */
  private readonly origFreq = new Float64Array(256);
  private readonly origMag  = new Float64Array(256);

  private readonly strongest = new Int32Array(CANDIDATE_SOURCE_PEAKS);

  /** Fundamentals already committed in this frame. Cancellation is partial by design — a
   *  partial shared with a co-sounding note has to survive it — so without this the same
   *  pitch simply wins again on the next iteration and is reported twice. */
  private readonly accepted = new Float64Array(8);
  private readonly acceptedSalience = new Float64Array(8);
  private acceptedCount = 0;

  constructor(config: SalienceConfig) {
    this.config = config;
  }

  /**
   * Estimate up to `maxSounds` fundamentals in one frame.
   *
   * Always runs to `maxSounds` rather than stopping at the polyphony criterion: the
   * criterion is applied in the cheap half, so every candidate it might accept has to be
   * stored. Stops early only when nothing audible is left.
   */
  analyze(frame: FrameSpectrum, maxSounds: number, out: Candidate[]): number {
    this.loadPeaks(frame);
    this.acceptedCount = 0;
    if (this.peakCount === 0) return 0;

    // Normalised against the frame's strongest peak, not the sum of all of them. Salience
    // is already a weighted *average* partial amplitude (the weights sum to one), so
    // dividing by the loudest partial gives a stable "how strongly is this pitch present"
    // in 0..1. Dividing by the sum instead makes the value depend on how many peaks the
    // frame happened to contain, which drifts with noise and polyphony and leaves every
    // threshold meaning something different from frame to frame.
    let total = 0;
    for (let i = 0; i < this.peakCount; i++) if (this.peakMag[i] > total) total = this.peakMag[i];
    if (total <= 0) return 0;

    let found = 0;
    for (let sound = 0; sound < maxSounds; sound++) {
      this.buildCandidates();
      if (this.candCount === 0) break;

      const winner = this.pickWinner();
      if (winner < 0) break;

      const frequency = this.candFreq[winner];
      const salience  = this.candSal[winner] / total;
      if (salience < MIN_REPORTED_SALIENCE) break;

      out[found] = {
        frequency,
        salience:       Math.min(1, salience),
        support:        1 / (1 + this.candErr[winner]),
        // Not an octave probe: this candidate stood on its own evidence.
        octaveEvidence: 0,
      };
      found++;

      if (this.acceptedCount < this.accepted.length) {
        this.acceptedSalience[this.acceptedCount] = salience;
        this.accepted[this.acceptedCount++]       = frequency;
      }
      this.cancel(frequency);
    }
    found = this.probeOctaves(found, maxSounds, total, out);
    this.scoreOctavePairs(found, out);
    return found;
  }

  /**
   * Give every octave pair in the frame its amplitude evidence, whoever found it.
   *
   * The probe is not the only way a pitch an octave above another one reaches the output —
   * the main loop finds them too, most often in a note's *release*, where the fundamental
   * peak sinks below the local noise floor before the upper partials do and the octave above
   * briefly becomes the best remaining explanation of what is left. Those arrive with no
   * evidence attached, so without this they would sail past a control specifically built to
   * stop them.
   *
   * Scored here rather than in the cheap half because it needs the frame's peaks, which
   * only exist during analysis.
   */
  private scoreOctavePairs(found: number, out: Candidate[]): void {
    for (let upper = 0; upper < found; upper++) {
      if (out[upper].octaveEvidence > 0) continue;
      for (let lower = 0; lower < found; lower++) {
        if (lower === upper) continue;
        if (Math.abs(centsBetween(out[upper].frequency, out[lower].frequency * 2)) < ACCEPTED_MERGE_CENTS) {
          out[upper].octaveEvidence = this.octaveEvidenceFor(out[lower].frequency);
          break;
        }
      }
    }
  }

  /**
   * Explicitly test the octave above each committed sound.
   *
   * Cancellation is tuned so that single notes never sprout a phantom octave, and the price
   * of that is that a genuine tongue-blocked octave split rarely survives it either. Rather
   * than move the cancellation factor — which would trade the common case for the rare one —
   * the octave hypothesis is asked directly, scored by its own two-way mismatch against
   * what cancellation left behind, and stored with that score.
   *
   * Nothing is decided here. Whether the probe becomes a note is the `octaveEvidence`
   * control's job in the cheap half, which is what makes "how much proof an octave needs"
   * a slider a player can move instead of a constant only this file knows about.
   */
  private probeOctaves(found: number, maxSounds: number, total: number, out: Candidate[]): number {
    const committed = this.acceptedCount;
    for (let i = 0; i < committed && found < maxSounds; i++) {
      // Only credible sounds get an octave probed above them. Iterative cancellation always
      // leaves a tail of weak also-rans — an ordinary frame carries two or three around
      // salience 0.03 — and probing above those manufactures a well-evidenced octave for a
      // note that was never there. Measured: this is where every phantom octave in the
      // note-level tests came from, and none of them came from a real note's probe.
      if (this.acceptedSalience[i] < PROBE_MIN_BASE_SALIENCE) continue;

      const lower  = this.accepted[i];
      const octave = lower * 2;
      if (octave > this.config.maxFrequency) continue;

      let alreadyThere = false;
      for (let a = 0; a < this.acceptedCount; a++) {
        if (Math.abs(centsBetween(octave, this.accepted[a])) < ACCEPTED_MERGE_CENTS) alreadyThere = true;
      }
      if (alreadyThere) continue;

      const evidence = this.octaveEvidenceFor(lower);
      if (evidence <= 0) continue;

      out[found] = {
        frequency:      octave,
        // Scored against the *original* peaks, not the cancelled residual: cancellation has
        // deliberately removed most of the shared partials, which is exactly the energy this
        // hypothesis is made of.
        salience:       Math.min(1, (this.salienceOfOriginal(octave) / total) * evidence),
        support:        1 / (1 + this.twmError(octave)),
        octaveEvidence: evidence,
      };
      found++;
      if (this.acceptedCount < this.accepted.length) this.accepted[this.acceptedCount++] = octave;
    }
    return found;
  }

  /**
   * How much stronger the even harmonics of `lower` are than `lower` alone can explain.
   *
   * The odd harmonics (1, 3, 5, 7…) belong to the lower note and to nothing else — a note
   * an octave above cannot contribute to them. So a smooth envelope fitted through *only*
   * the odd partials is a prediction of what the even partials should be if the lower note
   * were sounding alone. Whatever the even partials measure above that prediction is the
   * octave above, and there is no other place that evidence can come from.
   *
   * Fitted as a straight line in log-amplitude against log-frequency, which is a decent
   * model of a reed's partial rolloff over the handful of harmonics involved and needs only
   * two points to be defined at all.
   */
  private octaveEvidenceFor(lower: number): number {
    const nyquist = this.config.sampleRate * 0.45;
    const maxK    = Math.min(MAX_HARMONICS, Math.floor(nyquist / lower));
    if (maxK < 4) return 0;

    let n = 0, sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    for (let k = 1; k <= maxK; k += 2) {
      const match = this.nearestOriginalPeak(k * lower);
      if (match < 0 || this.origMag[match] <= 0) continue;
      const x = Math.log(k * lower);
      const y = Math.log(this.origMag[match]);
      n++; sumX += x; sumY += y; sumXX += x * x; sumXY += x * y;
    }
    if (n < 2) return 0;

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-12) return 0;
    const slope     = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    let excess = 0;
    let measured = 0;
    for (let k = 2; k <= maxK; k += 2) {
      const match = this.nearestOriginalPeak(k * lower);
      if (match < 0 || this.origMag[match] <= 0) continue;
      const predicted = Math.exp(intercept + slope * Math.log(k * lower));
      excess   += Math.max(0, this.origMag[match] - predicted);
      measured += this.origMag[match];
    }
    return measured > 0 ? Math.min(1, excess / measured) : 0;
  }

  /** Salience against the pristine peak list — see `probeOctaves` for why. */
  private salienceOfOriginal(f0: number): number {
    const saveFreq = this.peakFreq.slice(0, this.peakCount);
    const saveMag  = this.peakMag.slice(0, this.peakCount);
    this.peakFreq.set(this.origFreq.subarray(0, this.peakCount));
    this.peakMag.set(this.origMag.subarray(0, this.peakCount));
    const value = this.salienceOf(f0);
    this.peakFreq.set(saveFreq);
    this.peakMag.set(saveMag);
    return value;
  }

  private nearestOriginalPeak(frequency: number): number {
    let best     = -1;
    let bestDiff = MATCH_TOLERANCE_CENTS;
    for (let i = 0; i < this.peakCount; i++) {
      if (this.origMag[i] <= 0) continue;
      const diff = Math.abs(centsBetween(this.origFreq[i], frequency));
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  }

  private loadPeaks(frame: FrameSpectrum): void {
    const n = Math.min(frame.peakCount, this.peakFreq.length);
    for (let i = 0; i < n; i++) {
      this.peakFreq[i] = frame.frequency[i];
      this.peakMag[i]  = frame.magnitude[i];
      this.origFreq[i] = frame.frequency[i];
      this.origMag[i]  = frame.magnitude[i];
    }
    this.peakCount = n;
  }

  /**
   * Candidate fundamentals, taken from the peaks rather than from a grid.
   *
   * Every strong peak is tried as the 1st, 2nd, … 8th harmonic of some fundamental. A real
   * note's f₀ therefore appears whether or not its own fundamental was detected as a peak,
   * which matters: a cupped harmonica tone can have a fundamental well below its second
   * partial, and a grid-free method that required the fundamental peak would simply miss it.
   */
  private buildCandidates(): void {
    const { minFrequency, maxFrequency } = this.config;

    const take = Math.min(CANDIDATE_SOURCE_PEAKS, this.peakCount);
    for (let i = 0; i < take; i++) this.strongest[i] = -1;
    for (let p = 0; p < this.peakCount; p++) {
      for (let s = 0; s < take; s++) {
        const cur = this.strongest[s];
        if (cur < 0 || this.peakMag[p] > this.peakMag[cur]) {
          for (let t = take - 1; t > s; t--) this.strongest[t] = this.strongest[t - 1];
          this.strongest[s] = p;
          break;
        }
      }
    }

    this.candCount = 0;
    for (let s = 0; s < take; s++) {
      const p = this.strongest[s];
      if (p < 0) continue;
      for (let k = 1; k <= CANDIDATE_MAX_SUBHARMONIC; k++) {
        const f0 = this.peakFreq[p] / k;
        if (f0 < minFrequency || f0 > maxFrequency) continue;

        let duplicate = false;
        for (let c = 0; c < this.candCount; c++) {
          if (Math.abs(centsBetween(f0, this.candFreq[c])) < CANDIDATE_MERGE_CENTS) {
            duplicate = true;
            break;
          }
        }
        for (let a = 0; a < this.acceptedCount && !duplicate; a++) {
          if (Math.abs(centsBetween(f0, this.accepted[a])) < ACCEPTED_MERGE_CENTS) duplicate = true;
        }
        if (duplicate) continue;

        this.candFreq[this.candCount] = f0;
        this.candSal[this.candCount]  = this.salienceOf(f0);
        this.candErr[this.candCount]  = 0;
        this.candCount++;
      }
    }
  }

  /** Klapuri's weighted harmonic sum over matched peaks. Normalised by the weights actually
   *  used, so a low candidate with many available harmonics doesn't win by counting. */
  private salienceOf(f0: number): number {
    const nyquist = this.config.sampleRate * 0.45;
    const maxK    = Math.min(MAX_HARMONICS, Math.floor(nyquist / f0));
    if (maxK < 1) return 0;

    let sum       = 0;
    let weightSum = 0;
    for (let k = 1; k <= maxK; k++) {
      const w = (f0 + ALPHA) / (k * f0 + BETA);
      weightSum += w;
      const match = this.nearestPeak(k * f0);
      if (match >= 0) sum += w * this.peakMag[match];
    }
    return weightSum > 0 ? sum / weightSum : 0;
  }

  /** Index of the peak nearest `frequency` within the match tolerance, or -1. Used by
   *  salience, where "no partial here" must mean no contribution. */
  private nearestPeak(frequency: number): number {
    let best     = -1;
    let bestDiff = MATCH_TOLERANCE_CENTS;
    for (let i = 0; i < this.peakCount; i++) {
      if (this.peakMag[i] <= 0) continue;
      const diff = Math.abs(centsBetween(this.peakFreq[i], frequency));
      if (diff < bestDiff) {
        bestDiff = diff;
        best     = i;
      }
    }
    return best;
  }

  /**
   * Index of the nearest peak at any distance, or -1 if the list is empty.
   *
   * Two-way mismatch needs this rather than the tolerance-bounded version, and the
   * difference is not cosmetic — it is the difference between TWM working and TWM inverting.
   * Scoring an unmatched harmonic with a fixed large penalty makes the penalty grow with
   * the harmonic's frequency, which rewards *low* candidates: their unmatched partials sit
   * lower in the spectrum than a high candidate's do. Measured distance to a real peak has
   * no such bias, and it is what Maher & Beauchamp actually specify.
   */
  private nearestPeakAny(frequency: number): number {
    let best     = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.peakCount; i++) {
      if (this.peakMag[i] <= 0) continue;
      const diff = Math.abs(this.peakFreq[i] - frequency);
      if (diff < bestDiff) {
        bestDiff = diff;
        best     = i;
      }
    }
    return best;
  }

  /**
   * Two-way mismatch error for one candidate. Lower is better.
   *
   * The amplitude term is what stops a candidate being rewarded for ignoring a loud peak:
   * a mismatch against a strong partial costs more than one against a weak one.
   */
  private twmError(f0: number): number {
    let ampMax     = 0;
    let maxPeakHz  = 0;
    for (let i = 0; i < this.peakCount; i++) {
      if (this.peakMag[i] <= 0) continue;
      if (this.peakMag[i] > ampMax)    ampMax    = this.peakMag[i];
      if (this.peakFreq[i] > maxPeakHz) maxPeakHz = this.peakFreq[i];
    }
    if (ampMax <= 0) return Number.POSITIVE_INFINITY;

    // Harmonics scored, bounded by where the spectrum actually ends. A fixed count would
    // punish a genuinely high note for the spectrum running out above it; an unbounded one
    // would let a low candidate accumulate cheap agreement forever.
    const maxK = Math.min(TWM_MAX_HARMONICS,
                          Math.max(TWM_MIN_HARMONICS, Math.floor(maxPeakHz / f0) + 1));

    // Predicted → measured. A subharmonic ghost predicts partials at 1.5×, 2.5×, 3.5× the
    // real fundamental, and the nearest real peak to each is half a fundamental away.
    let errPm = 0;
    for (let k = 1; k <= maxK; k++) {
      const predicted = k * f0;
      const match     = this.nearestPeakAny(predicted);
      if (match < 0) continue;
      const df     = Math.abs(this.peakFreq[match] - predicted);
      const scaled = df * Math.pow(predicted, -TWM_P);
      errPm += scaled + (this.peakMag[match] / ampMax) * (TWM_Q * scaled - TWM_R);
    }

    // Measured → predicted. An octave-high ghost leaves the real fundamental and every odd
    // partial measured but unexplained.
    let errMp = 0;
    let used  = 0;
    for (let i = 0; i < this.peakCount; i++) {
      if (this.peakMag[i] <= 0) continue;
      used++;
      const harmonic  = Math.max(1, Math.round(this.peakFreq[i] / f0));
      const predicted = harmonic * f0;
      const df        = Math.abs(this.peakFreq[i] - predicted);
      const scaled    = df * Math.pow(this.peakFreq[i], -TWM_P);
      errMp += scaled + (this.peakMag[i] / ampMax) * (TWM_Q * scaled - TWM_R);
    }

    return errPm / maxK + (used > 0 ? (TWM_RHO * errMp) / used : 0);
  }

  /**
   * Salience shortlists; two-way mismatch decides.
   *
   * Deliberately not `argmax salience`: on a single note that is very often the octave
   * below it. Deliberately not `argmin error` over everything either — TWM alone will
   * happily award a near-perfect score to a high candidate matching two peaks, so the
   * shortlist is what keeps the decision anchored to where the energy actually is.
   */
  private pickWinner(): number {
    const shortlist = Math.min(TWM_SHORTLIST, this.candCount);
    const order: number[] = [];
    for (let i = 0; i < this.candCount; i++) order.push(i);
    order.sort((a, b) => this.candSal[b] - this.candSal[a]);

    let best      = -1;
    let bestError = Number.POSITIVE_INFINITY;
    for (let i = 0; i < shortlist; i++) {
      const c   = order[i];
      const err = this.twmError(this.candFreq[c]);
      this.candErr[c] = err;
      if (err < bestError) {
        bestError = err;
        best      = c;
      }
    }
    return best;
  }

  /**
   * Remove a detected sound's partials from the peak list.
   *
   * Operating on ~100 peaks rather than 2048 bins is both cheaper and much easier to reason
   * about — and it keeps "is there a peak here" a well-defined question on the next
   * iteration, which is the question the whole method rests on. This is the step the
   * literature describes most vaguely and the one most likely to need revisiting against
   * the harness.
   */
  private cancel(f0: number): void {
    const nyquist = this.config.sampleRate * 0.45;
    const maxK    = Math.min(MAX_HARMONICS, Math.floor(nyquist / f0));
    for (let k = 1; k <= maxK; k++) {
      const match = this.nearestPeak(k * f0);
      if (match < 0) continue;
      this.peakMag[match] = Math.max(0, this.peakMag[match] * (1 - CANCEL_FACTOR));
    }
  }
}
