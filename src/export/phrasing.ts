import type { TabNote } from '@/types';

/**
 * Grouping a tab into musical phrases, from timing alone.
 *
 * A `TabNote` carries no bar structure — only when it started and how long it lasted — so
 * phrasing here is inferred the way a listener infers it: from silences and from notes held
 * longer than their neighbours.
 *
 * The rule is deliberately *relative* rather than absolute. Measured against a real 407-note
 * recording, the gaps between notes form a smooth continuum with no natural dividing line —
 * they decay steadily from 0ms out past 3s, with no gap in the histogram to cut at. Any fixed
 * threshold therefore lands in dense territory and coin-flips on near-identical gaps, which is
 * what made the same melodic phrase break in one repeat and not in the next.
 *
 * So a boundary is not "a gap over X". It is a gap that is *larger than its neighbours* — a
 * local maximum of boundary strength. Repeated material has the same shape each time it
 * recurs, so it phrases the same way each time, and a passage played slightly slower doesn't
 * suddenly sprout line breaks.
 */

/** Cap on notes per line. Also the historical fixed wrap width, which is what this degrades
 *  to when a tab has no rests at all (MIDI imports, where notes abut exactly). */
export const MAX_NOTES_PER_LINE = 12;

/** When an over-long phrase must be cut anyway, never cut before this many notes — a 2-note
 *  line followed by a 10-note one reads worse than one even break. */
const MIN_SPLIT_NOTES = 6;

/**
 * How far either side a gap must dominate to count as a boundary.
 *
 * This is the parameter that matters. On the reference recording, 3 drops fragmentary lines
 * (≤3 notes) from 26 to 2 while leaving only 4 lines long enough to need a forced cut; 5 is
 * too coarse (it misses real boundaries and 16 lines hit the cap), 2 is too fine.
 */
const BOUNDARY_WINDOW = 3;

/** Noise floor, so near-silent gaps in a dense run can't win their neighbourhood by default.
 *  Capped at half the typical spacing so fast playing isn't flattened into one long line. */
const BOUNDARY_FLOOR_MS = 200;

/** Silence this long is a section change rather than a breath — but only if it also stands
 *  out within this particular tab, hence the percentile. On the reference recording this gives
 *  11 sections for a 4½-minute song; the earlier relative rule gave 20. */
const SECTION_FLOOR_MS  = 2000;
const SECTION_PERCENTILE = 97;

export interface Phrase {
  notes: TabNote[];
  /** A section-sized rest precedes this phrase — consumers render a blank line before it. */
  startsSection: boolean;
  /**
   * This entry is the front half of a phrase too long for one line, so the music runs straight
   * into the next entry. Without this a reader can't tell a line that *ended* from a line that
   * merely *wrapped* — which matters here, because a phrase end is where the player breathes.
   */
  continuesNext: boolean;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length * p) / 100))];
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Silence between two consecutive notes. Clamped at 0 because notes can overlap — a negative
 *  rest is not evidence of anything, it just isn't a boundary. */
function restBetween(a: TabNote, b: TabNote): number {
  return Math.max(0, b.start_time - (a.start_time + a.duration));
}

function maxOf(values: readonly number[], from: number, to: number): number {
  let best = -Infinity;
  for (let i = Math.max(0, from); i < Math.min(values.length, to); i++) {
    if (values[i] > best) best = values[i];
  }
  return best;
}

/**
 * Greedy cut for a phrase that exceeds the line cap: take the largest internal rest among the
 * candidate line lengths, ties going to the longer line.
 *
 * The tie-break is what preserves the old behaviour for rest-free input — when every candidate
 * gap is 0 this lands on MAX_NOTES_PER_LINE, i.e. exactly the fixed wrap this replaced.
 */
function chooseCut(notes: readonly TabNote[]): number {
  let bestLen  = MAX_NOTES_PER_LINE;
  let bestRest = -1;
  for (let len = MIN_SPLIT_NOTES; len <= MAX_NOTES_PER_LINE; len++) {
    const gap = restBetween(notes[len - 1], notes[len]);
    if (gap >= bestRest) { bestRest = gap; bestLen = len; }
  }
  return bestLen;
}

export function groupIntoPhrases(notes: readonly TabNote[]): Phrase[] {
  if (notes.length === 0) return [];
  if (notes.length === 1) return [{ notes: [notes[0]], startsSection: false, continuesNext: false }];

  // Sorted defensively: rests computed on out-of-order notes would be meaningless, and the
  // CSV path already treats time order as the canonical order for a part.
  const ordered = [...notes].sort((a, b) => a.start_time - b.start_time);

  const rests: number[] = [];
  const iois:  number[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    iois.push(ordered[i + 1].start_time - ordered[i].start_time);
    rests.push(restBetween(ordered[i], ordered[i + 1]));
  }

  // Median rather than mean: one long held final note shouldn't stretch the scale that
  // lengthening is measured against.
  const medDur = median(ordered.map((n) => n.duration));

  /**
   * Boundary strength: silence plus however much the note overran a typical one. The two are
   * summed rather than tested separately because they are the same cue — a player either stops
   * or leans on the note, and both read as "the line ended here".
   */
  const strength = rests.map((rest, i) => rest + Math.max(0, ordered[i].duration - medDur));

  const floor       = Math.min(BOUNDARY_FLOOR_MS, median(iois) / 2);
  const sectionRest = Math.max(SECTION_FLOOR_MS, percentile(rests, SECTION_PERCENTILE));

  // Strictly greater on the left, greater-or-equal on the right, so a run of equal strengths
  // yields one boundary (the first) rather than one per note.
  function breaksAfter(i: number): boolean {
    if (strength[i] < floor) return false;
    return strength[i] > maxOf(strength, i - BOUNDARY_WINDOW, i)
        && strength[i] >= maxOf(strength, i + 1, i + 1 + BOUNDARY_WINDOW);
  }

  const phrases: Phrase[] = [];
  let current: TabNote[] = [ordered[0]];
  let startsSection = false;
  for (let i = 0; i < ordered.length - 1; i++) {
    if (breaksAfter(i)) {
      phrases.push({ notes: current, startsSection, continuesNext: false });
      startsSection = rests[i] >= sectionRest;
      current = [];
    }
    current.push(ordered[i + 1]);
  }
  phrases.push({ notes: current, startsSection, continuesNext: false });

  // A one-note line looks like a bug rather than a phrase, so it folds back — unless a section
  // rest put it there, where a lone pickup note genuinely is the start of something.
  const merged: Phrase[] = [];
  for (const phrase of phrases) {
    const prev = merged[merged.length - 1];
    if (prev && phrase.notes.length === 1 && !phrase.startsSection) {
      prev.notes.push(...phrase.notes);
    } else {
      merged.push(phrase);
    }
  }

  // Splitting runs last so that merging can't leave a line over the cap.
  const out: Phrase[] = [];
  for (const phrase of merged) {
    let rest = phrase.notes;
    let section = phrase.startsSection;
    while (rest.length > MAX_NOTES_PER_LINE) {
      const cut = chooseCut(rest);
      // continuesNext marks this as a wrap, not a phrase end — the music carries on.
      out.push({ notes: rest.slice(0, cut), startsSection: section, continuesNext: true });
      rest = rest.slice(cut);
      section = false; // a forced cut is not a section boundary
    }
    out.push({ notes: rest, startsSection: section, continuesNext: false });
  }
  return out;
}
