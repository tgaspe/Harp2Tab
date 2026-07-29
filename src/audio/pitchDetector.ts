// JS port of MPMPitchDetector (android/audiocapture/src/main/cpp/AudioEngine.cpp).
// Probabilistic MPM (pMPM): sweeps PMPM_N_CUTOFFS clarity thresholds and
// accumulates probability weight to whichever key-maximum wins at each
// threshold. Suppresses octave errors without a half-period correction step.

const WINDOW_SIZE = 2048;
const W = WINDOW_SIZE / 2;
const MAX_MAXIMA = 32;
const FREQ_MIN = 180.0;
const FREQ_MAX = 3200.0;

const PMPM_N_CUTOFFS = 10;
const PMPM_CUTOFF_BEGIN = 0.8;
const PMPM_CUTOFF_STEP = 0.02; // 0.80, 0.82, ..., 0.98
const PMPM_PROB_DIST = 0.1; // weight per winning cutoff
const SMALL_CUTOFF = 0.5; // pre-filter weak candidates
const NSDF_FLOOR = 0.75;

// Preallocated scratch buffers — the hot path allocates nothing per call.
const _nsdf = new Float32Array(W + 1);
const _kmTau = new Int32Array(MAX_MAXIMA);
const _kmVal = new Float32Array(MAX_MAXIMA);
const _candTau = new Int32Array(MAX_MAXIMA);
const _candVal = new Float32Array(MAX_MAXIMA);
const _prob = new Float32Array(MAX_MAXIMA);

export function computeRms(samples: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  return Math.sqrt(sumSq / samples.length);
}

// samples must be exactly WINDOW_SIZE (2048) long. Returns a frequency in Hz,
// or NaN if no pitch was detected.
export function detectPitch(samples: Float32Array, sampleRate: number): number {
  // Pass 1: NSDF n'(tau) for tau = 0..W
  let running = 0;
  for (let j = 0; j < WINDOW_SIZE; j++) running += samples[j] * samples[j];
  running *= 2.0;

  for (let tau = 0; tau <= W; tau++) {
    if (tau > 0) {
      const dL = samples[tau - 1];
      const dR = samples[WINDOW_SIZE - tau];
      running -= dL * dL + dR * dR;
    }
    if (running <= 0) {
      _nsdf[tau] = 0;
      continue;
    }
    let r = 0;
    const len = WINDOW_SIZE - tau;
    for (let j = 0; j < len; j++) r += samples[j] * samples[j + tau];
    _nsdf[tau] = (2.0 * r) / running;
  }

  // Pass 2: Key maxima inside positive-NSDF regions
  const tauMin = Math.max(1, Math.round(sampleRate / FREQ_MAX));
  const tauMax = Math.min(W - 1, Math.round(sampleRate / FREQ_MIN));

  let kmCount = 0;
  let globalMax = -Infinity;
  let inPositiveRegion = false;
  let regionMax = -Infinity;
  let regionMaxTau = -1;

  for (let tau = tauMin; tau <= tauMax && kmCount < MAX_MAXIMA; tau++) {
    const val = _nsdf[tau];
    if (!inPositiveRegion) {
      if (val > 0) {
        inPositiveRegion = true;
        regionMax = val;
        regionMaxTau = tau;
      }
    } else {
      if (val > regionMax) {
        regionMax = val;
        regionMaxTau = tau;
      }
      const end = val <= 0 || tau === tauMax;
      if (end) {
        if (regionMaxTau > tauMin && regionMaxTau < tauMax) {
          _kmTau[kmCount] = regionMaxTau;
          _kmVal[kmCount] = regionMax;
          kmCount++;
        }
        if (regionMax > globalMax) globalMax = regionMax;
        inPositiveRegion = false;
        regionMax = -Infinity;
        regionMaxTau = -1;
      }
    }
  }

  if (kmCount === 0 || globalMax <= 0) return NaN;
  if (globalMax < NSDF_FLOOR) return NaN;

  // Pass 3: Pre-filter — discard candidates below SMALL_CUTOFF
  let candCount = 0;
  for (let k = 0; k < kmCount; k++) {
    if (_kmVal[k] > SMALL_CUTOFF) {
      _candTau[candCount] = _kmTau[k];
      _candVal[candCount] = _kmVal[k];
      candCount++;
    }
  }
  if (candCount === 0) return NaN;

  // Pass 4: Sweep cutoffs, accumulate probability to winning candidate
  _prob.fill(0, 0, candCount);
  let cutoff = PMPM_CUTOFF_BEGIN;
  for (let i = 0; i < PMPM_N_CUTOFFS; i++) {
    const thresh = cutoff * globalMax;
    let winner = -1;
    for (let k = 0; k < candCount; k++) {
      if (_candVal[k] >= thresh) {
        winner = k;
        break;
      }
    }
    if (winner >= 0) _prob[winner] += PMPM_PROB_DIST;
    cutoff += PMPM_CUTOFF_STEP;
  }

  // Pass 5: Pick highest-probability candidate
  let bestIdx = -1;
  let bestProb = 0;
  for (let k = 0; k < candCount; k++) {
    if (_prob[k] > bestProb) {
      bestProb = _prob[k];
      bestIdx = k;
    }
  }
  if (bestIdx < 0) return NaN;
  const bestTau = _candTau[bestIdx];

  // Pass 6: Parabolic interpolation
  let tInterp = bestTau;
  if (bestTau > 0 && bestTau < W) {
    const s0 = _nsdf[bestTau - 1];
    const s1 = _nsdf[bestTau];
    const s2 = _nsdf[bestTau + 1];
    const denom = 2.0 * (2.0 * s1 - s0 - s2);
    if (Math.abs(denom) > 1e-9) tInterp = bestTau + (s2 - s0) / denom;
  }

  if (tInterp <= 0) return NaN;
  const freq = sampleRate / tInterp;
  if (freq < FREQ_MIN || freq > FREQ_MAX) return NaN;
  return freq;
}

export const PITCH_WINDOW_SIZE = WINDOW_SIZE;
