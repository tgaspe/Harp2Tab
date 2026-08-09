/**
 * Tempo estimation from note onsets.
 *
 * Why this exists at all: in a transcription app the session's BPM is a guess about a
 * performance that has *already happened*. Unlike a sequencer — where you set a tempo, play
 * to a click, and the number is a constraint the music obeys — here it's applied afterwards
 * to draw a ruler over audio recorded at whatever tempo the player actually felt. A constant
 * default is therefore wrong essentially every time, and no better constant fixes that. The
 * onsets already carry the answer: they were measured off the real performance.
 *
 * ## Method
 *
 * Inter-onset-interval clustering with integer-ratio reinforcement, after Simon Dixon's
 * BeatRoot (*Automatic Extraction of Tempo and Beat from Expressive Performances*, JNMR
 * 2001). The shape of it:
 *
 *  1. Take **every** pair of onsets close enough together to be musically related, not just
 *     consecutive ones. A thirty-note phrase yields hundreds of intervals rather than
 *     twenty-nine, and the beat shows up in that pile far more strongly than in any single
 *     interval.
 *  2. Cluster those intervals at a fixed width in milliseconds. This is the part that makes
 *     the method survive human timing: a player's eighth notes scatter over a few tens of
 *     milliseconds, and a cluster's running mean re-centres on where they actually landed
 *     instead of asking each one to hit a line.
 *  3. Let clusters related by small integer ratios reinforce each other. The beat is the
 *     interval whose multiples *and* subdivisions both have support — bars above it, eighths
 *     and triplets below — so counting that mutual support is what separates the beat from an
 *     arbitrary subdivision that merely happens to be common.
 *
 * This replaced a grid-fitting approach that scored candidate tempos by what share of onsets
 * fell near a grid line. That worked on quantized MIDI and collapsed on real playing: with a
 * hard tolerance window, ordinary human timing pushed most onsets outside it, so a correctly
 * detected tempo scored barely better than a wrong one and nothing could be gated on it.
 *
 * ## Known limits
 *
 *  - **Constant tempo.** One BPM for the whole take. A rubato performance has no single right
 *    answer, and `confidence` is what says so — it falls off exactly when the assumption does.
 *  - **Metrical ambiguity is real, and no amount of tuning removes it.** Some performances
 *    have two correct answers because the onsets are literally identical under both: a rhythm
 *    of quarters and eighths at N BPM is the same onset sequence as halves and quarters at
 *    2N, and a shuffle at N is the same as a quarter-eighth figure at 1.5N straight. Telling
 *    those apart needs accent or duration information that onsets alone do not carry. The
 *    tempo prior is the only tie-breaker available, and being centred on one tempo it cannot
 *    be right at both ends of the range at once. What makes this survivable is that the
 *    alternative reading still yields a *correctly aligned* grid — every bar line falls on a
 *    real beat, there are just twice as many — so snapping keeps working either way.
 */

import type { TabNote } from '@/types';

/** Below this many distinct onsets there isn't enough evidence to be worth reporting. */
const MIN_ONSETS = 6;

// Interval window, from BeatRoot. Below 70ms is faster than notes are played and is almost
// always two onsets of one event; above 2.5s the two notes are too far apart to imply a
// common pulse.
const MIN_IOI_MS = 70;
const MAX_IOI_MS = 2500;

/**
 * Cluster width, in absolute milliseconds.
 *
 * Absolute rather than a share of the interval, which is the crux of why this survives real
 * playing: timing error is a property of the player's hands and of the onset detector, not of
 * the tempo, so it does not shrink when the notes get faster. 25ms is Dixon's value.
 */
const CLUSTER_WIDTH_MS = 25;

// The beat itself has to land in a range a human would count in.
const MIN_BPM = 50;
const MAX_BPM = 220;
const MIN_BEAT_MS = 60000 / MAX_BPM;
const MAX_BEAT_MS = 60000 / MIN_BPM;

/**
 * Centre of the tempo prior, and its width in octaves.
 *
 * Only ever used to choose between readings the evidence says are equally good — see the
 * ambiguity note above. Centred on 110 as a harmonica-weighted middle (slow blues 60–80,
 * shuffles 90–130, jump 140–180) and deliberately wide, so real evidence outvotes it.
 */
const PREFERRED_BPM = 110;
const PRIOR_OCTAVES = 0.9;

/** Phase offsets tried across one subdivision cell when locating the downbeat. */
const PHASE_STEPS = 32;

/** A take needs at least this many beats before a tempo means anything. */
const MIN_BEATS = 4;

export type TempoFeel = 'straight' | 'triplet';

export interface TempoEstimate {
  /** Whole BPM, within [MIN_BPM, MAX_BPM]. */
  bpm:        number;
  feel:       TempoFeel;
  /**
   * How much the winning beat hypothesis dominates the alternatives, 0–1.
   *
   * The winner's reinforced cluster score as a share of all clusters' scores. Deliberately
   * *not* "share of onsets that landed on the grid": that measures how tightly the take was
   * played, so an ordinary human performance scores low even when the tempo found is exactly
   * right, and gating on it rejects real music for being played by a person. Loose timing
   * widens every cluster together and leaves this ratio broadly intact, while genuinely
   * un-metrical input spreads its intervals across many clusters and drives it down — which
   * is the case where the tempo should be left alone.
   */
  confidence: number;
  /**
   * Milliseconds to subtract from every note's `start_time` so the detected downbeat lands
   * at 0, which is where bar 1 is — the roll's grid has no offset of its own, so the notes
   * have to move to meet it.
   *
   * Guaranteed not to push anything negative: where aligning backwards would do that, the
   * grid is met a beat later instead, so this can be negative (notes move later). A uniform
   * shift, so it slides the take against the bar lines without disturbing relative timing.
   */
  offsetMs:   number;
}

interface Cluster {
  /** Running mean of the intervals in it, in ms. */
  mean:  number;
  size:  number;
  score: number;
}

/**
 * Group every inter-onset interval into clusters of near-equal length.
 *
 * Pairwise, not consecutive-only: two quarter notes are evidence of the beat whether or not
 * another note falls between them, and skipping non-adjacent pairs throws away most of a
 * take's rhythmic information.
 */
function clusterIntervals(onsets: readonly number[]): Cluster[] {
  const clusters: Cluster[] = [];

  for (let i = 0; i < onsets.length; i++) {
    for (let j = i + 1; j < onsets.length; j++) {
      const ioi = onsets[j] - onsets[i];
      if (ioi < MIN_IOI_MS) continue;
      // Onsets are sorted, so every later j is further still.
      if (ioi > MAX_IOI_MS) break;

      let placed = false;
      for (const c of clusters) {
        if (Math.abs(c.mean - ioi) < CLUSTER_WIDTH_MS) {
          c.mean = (c.mean * c.size + ioi) / (c.size + 1);
          c.size++;
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ mean: ioi, size: 1, score: 0 });
    }
  }

  // Merge clusters that drifted together as their means moved — two that started apart can
  // end up describing the same interval once enough members have pulled them in.
  clusters.sort((a, b) => a.mean - b.mean);
  const merged: Cluster[] = [];
  for (const c of clusters) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.mean - c.mean) < CLUSTER_WIDTH_MS) {
      prev.mean = (prev.mean * prev.size + c.mean * c.size) / (prev.size + c.size);
      prev.size += c.size;
    } else {
      merged.push({ ...c });
    }
  }
  return merged;
}

/**
 * Score clusters, letting those in simple integer relationships reinforce each other.
 *
 * A cluster's own membership is only weak evidence that it is the *beat* rather than some
 * subdivision that happens to be played a lot. What marks the beat is company: a real pulse
 * has intervals at 2x and 3x it (bars, phrases) and at 1/2 and 1/3 of it (eighths, triplets).
 * So each pair related by a small integer degree adds the *other's* weight, more heavily for
 * the closer relationships — Dixon's weighting, `6 - degree` down to a floor of 1.
 */
function scoreClusters(clusters: Cluster[]): void {
  for (const c of clusters) c.score = 10 * c.size;

  for (let a = 0; a < clusters.length; a++) {
    for (let b = a + 1; b < clusters.length; b++) {
      const lo = clusters[a].mean;
      const hi = clusters[b].mean;
      const degree = Math.round(hi / lo);
      if (degree < 2 || degree > 8) continue;
      // The tolerance grows with the degree: an error of one cluster width in the short
      // interval becomes `degree` widths once multiplied up.
      if (Math.abs(lo * degree - hi) >= CLUSTER_WIDTH_MS * degree) continue;

      const weight = degree >= 5 ? 1 : 6 - degree;
      clusters[a].score += weight * clusters[b].size;
      clusters[b].score += weight * clusters[a].size;
    }
  }
}

/** Distance from `t` to the nearest line of a grid of spacing `cell` starting at `phase`. */
function distanceToGrid(t: number, phase: number, cell: number): number {
  const r = (((t - phase) % cell) + cell) % cell;
  return Math.min(r, cell - r);
}

/** How well onsets sit on a grid. Gaussian rather than a hard window, so a note played a
 *  little late degrades its contribution instead of being discarded outright. */
function gridFit(onsets: readonly number[], phase: number, cell: number): number {
  const sigma = Math.max(12, cell * 0.12);
  let score = 0;
  for (const t of onsets) {
    const d = distanceToGrid(t, phase, cell);
    score += Math.exp(-(d * d) / (2 * sigma * sigma));
  }
  return score;
}

function tempoPrior(bpm: number): number {
  return Math.exp(-0.5 * ((Math.log2(bpm / PREFERRED_BPM) / PRIOR_OCTAVES) ** 2));
}

/**
 * Estimate the tempo of a set of notes, or null when there isn't enough to go on.
 *
 * Pass the notes the user can actually see — the filtered set. Feeding it everything means
 * scoring the tracker's spurious blips as though they were played; they contribute intervals
 * belonging to no cluster and dilute the ones that matter.
 */
export function detectTempo(notes: readonly Pick<TabNote, 'start_time'>[]): TempoEstimate | null {
  // Distinct onsets: two notes struck together are one piece of rhythmic evidence, not two,
  // and counting them twice would let a chord-heavy passage outvote the rest of the take.
  const onsets = [...new Set(notes.map((n) => Math.max(0, Math.round(n.start_time))))]
    .sort((a, b) => a - b);
  if (onsets.length < MIN_ONSETS) return null;

  const firstOnset = onsets[0];
  const span = onsets[onsets.length - 1] - firstOnset;
  if (span <= 0) return null;

  const clusters = clusterIntervals(onsets);
  if (clusters.length === 0) return null;
  scoreClusters(clusters);

  const totalScore = clusters.reduce((sum, c) => sum + c.score, 0);
  if (totalScore <= 0) return null;

  /**
   * Beat hypotheses.
   *
   * A cluster's interval is a candidate beat when it lands in the range a human would count
   * in. When it doesn't — a fast run whose every interval is a sixteenth, a slow air whose
   * intervals span whole bars — that cluster still implies a beat, at a small integer
   * multiple or division of itself, so those are offered too. Derived hypotheses inherit the
   * cluster's score, being the same evidence read at a different metrical level, and the
   * prior settles which level to believe.
   */
  const inRange = (periodMs: number) =>
    periodMs >= MIN_BEAT_MS && periodMs <= MAX_BEAT_MS && span >= periodMs * MIN_BEATS;

  // Directly observed first: a cluster sitting in the beat range is an interval the player
  // actually played, carrying its own reinforced score. Letting those compete on their own
  // evidence is what decides between a tempo and its double — the faster reading's cluster
  // has more members and more relatives (its own subdivisions *and* its multiples), so it
  // outscores the halved reading without the prior having to arbitrate.
  const hypotheses: { periodMs: number; score: number }[] = clusters
    .filter((c) => inRange(c.mean))
    .map((c) => ({ periodMs: c.mean, score: c.score }));

  // Only when nothing landed in range does the beat have to be inferred rather than observed
  // — a fast run whose every interval is a sixteenth, a slow air whose intervals span whole
  // bars. Derived periods are discounted, since an interval nobody played is weaker evidence
  // than one they did.
  if (hypotheses.length === 0) {
    for (const c of clusters) {
      for (const factor of [2, 3, 4, 1 / 2, 1 / 3, 1 / 4]) {
        const periodMs = c.mean * factor;
        if (!inRange(periodMs)) continue;
        hypotheses.push({ periodMs, score: c.score * 0.5 });
      }
    }
  }
  if (hypotheses.length === 0) return null;

  let best: { periodMs: number; score: number } | null = null;
  let bestWeighted = -1;
  for (const h of hypotheses) {
    const weighted = h.score * tempoPrior(60000 / h.periodMs);
    if (weighted > bestWeighted) {
      bestWeighted = weighted;
      best = h;
    }
  }
  if (!best) return null;

  const bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(60000 / best.periodMs)));
  const period = 60000 / bpm;

  // Straight or shuffle: whichever subdivision of the beat the onsets actually sit on. Read
  // off the notes rather than off the clusters, because a shuffle's defining evidence is
  // *where within the beat* the off-beat note falls, which an interval histogram has already
  // averaged away.
  let feel: TempoFeel = 'straight';
  let bestCell = period / 4;
  let bestPhase = 0;
  let bestFit = -1;
  for (const [candidateFeel, divisions] of [['straight', 4], ['triplet', 3]] as const) {
    const cell = period / divisions;
    for (let step = 0; step < PHASE_STEPS; step++) {
      const phase = (step / PHASE_STEPS) * cell;
      const fit = gridFit(onsets, phase, cell);
      if (fit > bestFit) {
        bestFit = fit;
        feel = candidateFeel;
        bestCell = cell;
        bestPhase = phase;
      }
    }
  }

  // Which cell of the group carries the pulse — the subdivision phase says where the cells
  // start, not which one is the beat.
  const divisions = feel === 'triplet' ? 3 : 4;
  let beatPhase = bestPhase;
  let beatFit = -1;
  for (let n = 0; n < divisions; n++) {
    const candidate = bestPhase + n * bestCell;
    const fit = gridFit(onsets, candidate, period);
    if (fit > beatFit) {
      beatFit = fit;
      beatPhase = candidate;
    }
  }

  let offsetMs = ((beatPhase % period) + period) % period;
  // Aligning backwards must never push a note before time 0 — the roll has no negative side.
  // Meeting the grid a beat later is the same alignment reached from the other direction.
  if (firstOnset - offsetMs < 0) offsetMs -= period;

  return {
    bpm,
    feel,
    confidence: Math.max(0, Math.min(1, best.score / totalScore)),
    offsetMs:   Math.round(offsetMs),
  };
}

/**
 * Above this, the estimate is worth stating as a finding rather than a guess.
 *
 * Calibrated from measurement, not taste: structureless input — uniform-random onsets,
 * free-time rubato drift — tops out around 0.08, while real melodies played with human
 * timing sit near 0.11 and rise from there as the playing tightens. 0.10 is the gap between
 * those populations. See the scratchpad `confidenceCheck` harness.
 *
 * Note what this is *not* used for: deciding whether to apply the estimate at all. Both
 * automatic paths apply whatever they find, because the thing they'd fall back to is an
 * arbitrary constant — a hard-coded 120 in the Studio, `DEFAULT_BPM` in a fresh session —
 * and a low-confidence number read off the actual notes is not worse than a number chosen
 * before anyone played anything. This only decides how the result is *described*.
 */
export const TEMPO_CONFIDENCE_GOOD = 0.10;
