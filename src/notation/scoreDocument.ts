/**
 * The score document — the one thing in Phase 18 that is allowed to be the source of truth.
 *
 * The editor preview, the MusicXML file and the SVG/PDF/PNG exports all read *this*, never
 * each other. That is the whole point: the previous MusicXML generator quantized raw
 * milliseconds inline, so the only way to know what rhythm it had decided on was to read the
 * XML it had already written, and any second renderer would have decided differently.
 *
 * Nothing here knows about OSMD, React, the DOM or a file format. It is plain data plus the
 * two functions that turn a performance into *written music* — which note values to use, and
 * how to spell a pitch — because both are decisions, not conversions, and both are wrong in
 * ways that still render perfectly.
 */

import type { HarmonicaKey, HarmonicaType } from '@/types';

/**
 * Ticks per quarter note.
 *
 * 24 rather than a power of two because it has to divide by three. A 32nd is 3 ticks, a 16th
 * 6, an eighth 12 — and an eighth-note *triplet* is 8. A power-of-two resolution cannot write
 * a shuffle at all, and shuffle is most of what a harmonica plays; the same reasoning is
 * already written down at `SnapDivision` in `src/audio/tempo.ts`, which is why the piano
 * roll's snap grid includes 12.
 */
export const TICKS_PER_QUARTER = 24;

/**
 * How fine a grid the performance is fitted to.
 *
 * `triplet` is not "detect swing" — nothing here infers a feel. It is the user saying the
 * material is in three, exactly as they would pick 1/12 on the piano roll's snap control.
 */
export type RhythmMode = 'readable' | 'balanced' | 'precise' | 'triplet';

/** Grid unit in ticks: an eighth, a sixteenth, a 32nd, and the eighth-note triplet. */
export const GRID_TICKS: Record<RhythmMode, number> = {
  readable: 12,
  balanced: 6,
  precise:  3,
  triplet:  8,
};

export type NoteTypeName = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';

/** Three in the time of two — the only tuplet this release writes. */
export interface TimeModification {
  actualNotes: number;
  normalNotes: number;
}

export interface ScorePitch {
  /** A–G. The accidental lives in `alter`, so `Bb4` is step B, alter -1. */
  step:   string;
  alter:  -1 | 0 | 1;
  octave: number;
}

/** One written symbol: a note, a chord, or a rest. */
export interface ScoreElement {
  /** Empty means a rest. More than one means a chord. */
  pitches:       ScorePitch[];
  durationTicks: number;
  type:          NoteTypeName;
  dots:          0 | 1;
  /** Present only on a tuplet member. */
  timeModification?: TimeModification;
  tieStart:      boolean;
  tieStop:       boolean;
  /**
   * The Harp2Tab token printed under the note, from `src/notation/tabText.ts`.
   *
   * Empty on a rest, and empty on every piece of a tie after the first: a tab repeated under
   * a tied continuation reads as a second attack, which is the opposite of what a tie means.
   */
  tab:           string;
  /**
   * The `TabNote.id`s this element stands for — several for a chord, none for a rest.
   *
   * This is the link back to the editor. Clicking a notehead selects its source notes, and
   * playback highlights the element whose ids contain the sounding note, so neither has to
   * re-derive a mapping from timings that quantization has already moved.
   */
  sourceIds:     string[];
}

export interface ScoreMeasure {
  number: number;
  /** Written on measure 1, and again whenever any of it changes. */
  attributes?: {
    divisions: number;
    keyFifths: number;
    beats:     number;
    beatType:  number;
  };
  /** Written on measure 1, and again at a tempo change. */
  tempoBpm?: number;
  elements:  ScoreElement[];
}

export interface ScorePart {
  id:            string;
  name:          string;
  key:           HarmonicaKey;
  harmonicaType: HarmonicaType;
  measures:      ScoreMeasure[];
}

/**
 * A note the quantizer had to move far enough that the written score is an approximation of
 * the performance rather than a record of it.
 *
 * Collected rather than thrown: a warned score is still the score the user asked for, and
 * the view says so in a banner instead of refusing to draw.
 */
export interface QuantizationWarning {
  sourceId: string;
  kind:     'onsetMoved' | 'durationClamped' | 'overlapTruncated';
  /** How far it moved, in milliseconds. */
  deltaMs:  number;
}

export interface ScoreDocument {
  title:        string;
  encodingDate: string;
  parts:        ScorePart[];
  warnings:     QuantizationWarning[];
}

// ── Pitch spelling ────────────────────────────────────────────────────────────

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * The harp's own key signature, in fifths — first position.
 *
 * A player in second position is reading cross-harp against the harp's signature with
 * accidentals written in, which is what a transcription should show until the user says
 * otherwise. Guessing position from the notes would be a musical claim the detector never
 * made.
 */
const FIFTHS: Record<HarmonicaKey, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5,
};

export function fifthsForKey(key: HarmonicaKey): number {
  return FIFTHS[key] ?? 0;
}

/**
 * How to *write* a sounding pitch.
 *
 * Runtime note names are always sharps (`NOTE_NAMES`, `src/audio/HarmonicaMapper.ts`), so
 * there is no spelling in the source to preserve — the score has to choose one. Without this
 * a piece on an F harp prints every B-flat as A-sharp: correct pitch, wrong music, and a
 * player reading it has to translate every accidental back.
 */
export function spellPitch(midi: number, keyFifths: number): ScorePitch {
  const names = keyFifths < 0 ? FLAT_NAMES : SHARP_NAMES;
  const name  = names[((Math.round(midi) % 12) + 12) % 12];
  return {
    step:   name[0],
    alter:  name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0,
    octave: Math.floor(Math.round(midi) / 12) - 1,
  };
}

// ── Written note values ───────────────────────────────────────────────────────

interface WrittenValue {
  ticks: number;
  type:  NoteTypeName;
  dots:  0 | 1;
  timeModification?: TimeModification;
}

/** Longest first — the decomposition is greedy, so the order is the preference. */
const VALUES: { ticks: number; type: NoteTypeName; dots: 0 | 1 }[] = [
  { ticks: 96, type: 'whole',   dots: 0 },
  { ticks: 72, type: 'half',    dots: 1 },
  { ticks: 48, type: 'half',    dots: 0 },
  { ticks: 36, type: 'quarter', dots: 1 },
  { ticks: 24, type: 'quarter', dots: 0 },
  { ticks: 18, type: 'eighth',  dots: 1 },
  { ticks: 12, type: 'eighth',  dots: 0 },
  { ticks:  9, type: '16th',    dots: 1 },
  { ticks:  6, type: '16th',    dots: 0 },
  { ticks:  3, type: '32nd',    dots: 0 },
];

/** Tuplet values, offered only in triplet mode: three of these in the time of two. */
const TRIPLETS: { ticks: number; type: NoteTypeName }[] = [
  { ticks: 16, type: 'quarter' },
  { ticks:  8, type: 'eighth'  },
  { ticks:  4, type: '16th'    },
];

/** A dotted value is written where its *undotted* length would start. */
function undottedLength(v: { ticks: number; dots: 0 | 1 }): number {
  return v.dots === 1 ? (v.ticks * 2) / 3 : v.ticks;
}

/**
 * Two rules decide whether a symbol may be used at a position, and both are about reading
 * rather than arithmetic — a wrong choice here has exactly the right duration and is still
 * hard to play from.
 *
 *  - **Alignment.** A value starts where its own undotted length divides the position. This
 *    is what keeps a half note off beat 2.
 *  - **Nesting.** A value may not cross a boundary of twice its own length. This is what
 *    turns beat-2-to-beat-4 into two tied quarters instead of a dotted quarter tied to an
 *    eighth: the dotted quarter would straddle the middle of the bar, where a reader counts.
 */
function fits(position: number, value: { ticks: number; dots: 0 | 1 }): boolean {
  const unit = undottedLength(value);
  if (position % unit !== 0) return false;
  const boundary = unit * 2;
  return Math.floor(position / boundary) === Math.floor((position + value.ticks - 1) / boundary);
}

/**
 * Write a span of ticks as one or more symbols, to be tied together by the caller.
 *
 * `startTick` is the position **within the measure**, not within the piece: every rule above
 * is about where a reader is in the bar. The quantizer has already cut spans at bar lines
 * before calling this, so a returned list never crosses one.
 */
export function decomposeSpan(startTick: number, ticks: number, mode: RhythmMode): WrittenValue[] {
  const out: WrittenValue[] = [];
  let position = startTick;
  let left     = Math.max(0, Math.round(ticks));

  while (left > 0) {
    const plain = VALUES.find((v) => v.ticks <= left && fits(position, v));
    const tuplet = mode === 'triplet'
      ? TRIPLETS.find((t) => t.ticks <= left && fits(position, { ticks: t.ticks, dots: 0 }))
      : undefined;

    let pick: WrittenValue;
    if (plain && (!tuplet || plain.ticks >= tuplet.ticks)) {
      // A tie goes to the plain value: it needs no bracket to read.
      pick = { ticks: plain.ticks, type: plain.type, dots: plain.dots };
    } else if (tuplet) {
      pick = {
        ticks: tuplet.ticks,
        type:  tuplet.type,
        dots:  0,
        timeModification: { actualNotes: 3, normalNotes: 2 },
      };
    } else {
      // Nothing aligned. Unreachable from the quantizer, whose spans and positions are both
      // multiples of the grid unit — this is the backstop that keeps a hand-built span from
      // spinning the loop, and it never loses a tick even when it has to lie about the type.
      const any = VALUES.find((v) => v.ticks <= left);
      pick = any
        ? { ticks: any.ticks, type: any.type, dots: any.dots }
        : { ticks: left, type: '32nd', dots: 0 };
    }

    out.push(pick);
    position += pick.ticks;
    left     -= pick.ticks;
  }

  return out;
}
