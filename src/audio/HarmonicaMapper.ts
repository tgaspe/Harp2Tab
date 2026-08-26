import type { HarmonicaKey, HarmonicaType } from '@/types';

// C-diatonic layout: maps C-space MIDI note → { tab, note name without octave }
// Multiple-option notes use best mapping: non-bend first, then lower hole.
//
// Notation: a leading `-` is draw, no prefix is blow, `'` marks bend depth, `o` marks an
// overblow/overdraw. The prefix always states the breath direction, so everything else
// follows from which reed sits higher in each group: holes 1-6 bend on the draw (`-2'`)
// and holes 8-10 bend on the blow (`8'`); an overblow is blown (`4o`) and an overdraw is
// drawn (`-9o`).
//
// Overblow (holes 1-6) sounds a semitone above the DRAW reed; overdraw (holes 7-10) sounds
// a semitone above the BLOW reed. The overdraws are what let a diatonic reach C#6, G#6 and
// C#7 — the only pitches in the chromatic span it otherwise couldn't touch. They're brutal
// to play, but "needs an extreme technique" is a different claim from "impossible", and the
// grid used to make the second one.
const C_DIATONIC: Record<number, string> = {
  60: '1',     // C4  hole 1 blow
  61: "-1'",   // C#4 hole 1 draw bend
  62: '-1',    // D4  hole 1 draw
  63: '1o',    // D#4 hole 1 overblow
  64: '2',     // E4  hole 2 blow
  65: "-2''",  // F4  hole 2 draw double bend
  66: "-2'",   // F#4 hole 2 draw bend
  67: '-2',    // G4  hole 2 draw (preferred over hole 3 blow)
  68: "-3'''", // G#4 hole 3 draw triple bend
  69: "-3''",  // A4  hole 3 draw double bend
  70: "-3'",   // A#4 hole 3 draw bend
  71: '-3',    // B4  hole 3 draw
  72: '4',     // C5  hole 4 blow
  73: "-4'",   // C#5 hole 4 draw bend
  74: '-4',    // D5  hole 4 draw
  75: '4o',    // D#5 hole 4 overblow
  76: '5',     // E5  hole 5 blow (preferred over draw bend)
  77: '-5',    // F5  hole 5 draw
  78: '5o',    // F#5 hole 5 overblow
  79: '6',     // G5  hole 6 blow
  80: "-6'",   // G#5 hole 6 draw bend
  81: '-6',    // A5  hole 6 draw
  82: '6o',    // A#5 hole 6 overblow
  83: '-7',    // B5  hole 7 draw
  84: '7',     // C6  hole 7 blow
  85: '-7o',   // C#6 hole 7 overdraw
  86: '-8',    // D6  hole 8 draw
  87: "8'",    // D#6 hole 8 blow bend
  88: '8',     // E6  hole 8 blow
  89: '-9',    // F6  hole 9 draw (preferred over hole 8 overdraw)
  90: "9'",    // F#6 hole 9 blow bend
  91: '9',     // G6  hole 9 blow
  92: '-9o',   // G#6 hole 9 overdraw
  93: '-10',   // A6  hole 10 draw (preferred over blow triple bend)
  94: "10''",  // A#6 hole 10 blow double bend
  95: "10'",   // B6  hole 10 blow bend
  96: '10',    // C7  hole 10 blow
  97: '-10o',  // C#7 hole 10 overdraw — the diatonic's true top, level with chromatic's
};

// 12-hole chromatic layout (Hohner Chromonica 270, C-space).
// Tab: blow=`1`–`12`, draw=`-1`–`-12`, blow+slide=`1+`, draw+slide=`-1+` etc.
// Duplicate pitches (e.g. hole 4 draw = hole 5 blow = C5) resolved: prefer blow of
// upper group (more natural playing position) and non-slide over slide.
const C_CHROMATIC: Record<number, string> = {
  60: '1',    // C4   hole 1 blow
  61: '1+',   // C#4  hole 1 blow+slide
  62: '-1',   // D4   hole 1 draw
  63: '-1+',  // D#4  hole 1 draw+slide
  64: '2',    // E4   hole 2 blow
  65: '-2',   // F4   hole 2 draw  (preferred over 2+)
  66: '-2+',  // F#4  hole 2 draw+slide
  67: '3',    // G4   hole 3 blow
  68: '3+',   // G#4  hole 3 blow+slide
  69: '-3',   // A4   hole 3 draw
  70: '-3+',  // A#4  hole 3 draw+slide
  71: '4',    // B4   hole 4 blow
  72: '5',    // C5   hole 5 blow  (preferred over -4 draw and 4+)
  73: '5+',   // C#5  hole 5 blow+slide (preferred over -4+)
  74: '-5',   // D5   hole 5 draw
  75: '-5+',  // D#5  hole 5 draw+slide
  76: '6',    // E5   hole 6 blow
  77: '-6',   // F5   hole 6 draw  (preferred over 6+)
  78: '-6+',  // F#5  hole 6 draw+slide
  79: '7',    // G5   hole 7 blow
  80: '7+',   // G#5  hole 7 blow+slide
  81: '-7',   // A5   hole 7 draw
  82: '-7+',  // A#5  hole 7 draw+slide
  83: '8',    // B5   hole 8 blow
  84: '9',    // C6   hole 9 blow  (preferred over -8 draw and 8+)
  85: '9+',   // C#6  hole 9 blow+slide (preferred over -8+)
  86: '-9',   // D6   hole 9 draw
  87: '-9+',  // D#6  hole 9 draw+slide
  88: '10',   // E6   hole 10 blow
  89: '-10',  // F6   hole 10 draw (preferred over 10+)
  90: '-10+', // F#6  hole 10 draw+slide
  91: '11',   // G6   hole 11 blow
  92: '11+',  // G#6  hole 11 blow+slide
  93: '-11',  // A6   hole 11 draw
  94: '-11+', // A#6  hole 11 draw+slide
  95: '12',   // B6   hole 12 blow
  96: '-12',  // C7   hole 12 draw (preferred over 12+)
  97: '-12+', // C#7  hole 12 draw+slide
};

// All 48 chromatic positions for reverse lookup (tab → C-space MIDI).
// Includes alternates not in the forward map (4+, -4, -8, 8+, 6+, 10+, 12+).
const TAB_TO_C_MIDI_CHROMATIC: Record<string, number> = {
  '1': 60,  '1+': 61,  '-1': 62,  '-1+': 63,
  '2': 64,  '2+': 65,  '-2': 65,  '-2+': 66,
  '3': 67,  '3+': 68,  '-3': 69,  '-3+': 70,
  '4': 71,  '4+': 72,  '-4': 72,  '-4+': 73,
  '5': 72,  '5+': 73,  '-5': 74,  '-5+': 75,
  '6': 76,  '6+': 77,  '-6': 77,  '-6+': 78,
  '7': 79,  '7+': 80,  '-7': 81,  '-7+': 82,
  '8': 83,  '8+': 84,  '-8': 84,  '-8+': 85,
  '9': 84,  '9+': 85,  '-9': 86,  '-9+': 87,
  '10': 88, '10+': 89, '-10': 89, '-10+': 90,
  '11': 91, '11+': 92, '-11': 93, '-11+': 94,
  '12': 95, '12+': 96, '-12': 96, '-12+': 97,
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

// Reverse map: tab string → C-space MIDI (auto-includes overblows via C_DIATONIC entries)
// The manual entries are valid positions the auto-reversal can't see, because C_DIATONIC
// maps their pitch to an easier alternate: hole 3 blow (G4 → '-2'), hole 3 overblow and
// hole 8 overdraw (C5 → '4', F6 → '-9'). A user who types one should still get the right
// pitch back, even though the mapper never emits it.
//
// The `-8'`-style entries are the pre-v2 spelling of the hole 8-10 blow bends, which used
// a draw prefix (see migrateRecordings). Kept as read-only aliases so a tab that predates
// the migration — or one hand-typed from an old chart — still resolves rather than
// silently becoming unplayable; nothing writes them any more.
const TAB_TO_C_MIDI: Record<string, number> = {
  ...Object.fromEntries(
    Object.entries(C_DIATONIC).map(([midi, tab]) => [tab, Number(midi)]),
  ),
  '3':   67,
  '3o':  72,
  '-8o': 89,
  "-8'":   87,
  "-9'":   90,
  "-10''": 94,
  "-10'":  95,
};

// Keys G–B have raw offset >= 7 and are shifted down an octave to stay in C-layout range.
const KEY_OFFSETS: Record<HarmonicaKey, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5,
  'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

function getTranspose(key: HarmonicaKey): number {
  const offset = KEY_OFFSETS[key];
  return offset >= 7 ? offset - 12 : offset;
}

/** MIDI number → scientific pitch name, in the sharp spelling every other note string in
 *  the app uses (`TabNote.note`, `noteToTab`'s input). */
export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  return NOTE_NAMES[((rounded % 12) + 12) % 12] + (Math.floor(rounded / 12) - 1);
}

/** Inverse of `midiToNoteName`, for the Studio, which stores pitch as a MIDI number while
 *  the piano roll matches rows by name. Returns null rather than a fallback pitch for an
 *  unparseable name — a caller silently getting middle C would be worse than knowing. */
export function noteNameToMidi(name: string): number | null {
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return null;
  const semitone = NOTE_NAMES.indexOf(match[1]);
  if (semitone === -1) return null;
  return (parseInt(match[2], 10) + 1) * 12 + semitone;
}

export function frequencyToTab(
  frequency: number,
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
): { tab: string; note: string } | null {
  if (!isFinite(frequency) || frequency <= 0) return null;

  const layout = harmonicaType === 'chromatic' ? C_CHROMATIC : C_DIATONIC;
  const midi   = Math.round(69 + 12 * Math.log2(frequency / 440));
  const cMidi  = midi - getTranspose(key);
  const tab    = layout[cMidi];
  if (!tab) return null;

  const octave = Math.floor(midi / 12) - 1;
  const note   = NOTE_NAMES[midi % 12] + octave;

  return { tab, note };
}

export function tabToNote(tab: string, key: HarmonicaKey, harmonicaType: HarmonicaType): string | null {
  const reverseMap = harmonicaType === 'chromatic' ? TAB_TO_C_MIDI_CHROMATIC : TAB_TO_C_MIDI;
  const cMidi = reverseMap[tab];
  if (cMidi === undefined) return null;
  const midi   = cMidi + getTranspose(key);
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

export function noteToTab(note: string, key: HarmonicaKey, harmonicaType: HarmonicaType): string | null {
  const m = note.match(/^([A-G]#?)(\d+)$/);
  if (!m) return null;
  const semitone = NOTE_SEMITONES[m[1]];
  if (semitone === undefined) return null;
  const layout = harmonicaType === 'chromatic' ? C_CHROMATIC : C_DIATONIC;
  const midi   = (parseInt(m[2]) + 1) * 12 + semitone;
  const cMidi  = midi - getTranspose(key);
  return layout[cMidi] ?? null;
}

export interface PlayablePosition {
  tab:  string;
  note: string;
  midi: number;
}

/**
 * Every position actually playable on the given harmonica key/type, sorted from highest
 * to lowest pitch — the piano-roll editor's pitch axis (rows), so dragging a note can only
 * snap to a real hole/bend/overblow, not free chromatic movement. Built from the forward
 * layout tables (cMidi → tab) rather than the reverse lookup, so each pitch appears once
 * under its preferred/canonical tab rather than listing every alternate spelling too.
 */
export function getPlayablePositions(key: HarmonicaKey, harmonicaType: HarmonicaType): PlayablePosition[] {
  const layout    = harmonicaType === 'chromatic' ? C_CHROMATIC : C_DIATONIC;
  const transpose = getTranspose(key);

  const positions = Object.entries(layout).map(([cMidiStr, tab]) => {
    const midi   = Number(cMidiStr) + transpose;
    const octave = Math.floor(midi / 12) - 1;
    const note   = NOTE_NAMES[midi % 12] + octave;
    return { tab, note, midi };
  });

  positions.sort((a, b) => b.midi - a.midi);
  return positions;
}

export interface GridRow extends PlayablePosition {
  /** False for a row that exists on the chromatic grid but has no equivalent position
   *  on the current (diatonic) instrument — see getGridRows. */
  playable: boolean;
}

/**
 * Every row the piano-roll editor draws — a gapless chromatic ladder, not just the
 * current instrument's own playable positions. This is what gives transpose/octave-shift
 * somewhere real to land, and what a note "falls off the edge" clamps against.
 *
 * Both instruments now cover their whole span: chromatic always did, and diatonic does too
 * once the overdraws are counted (they fill C#6/G#6/C#7, the only holes the layout used to
 * have). So `playable: false` no longer means "gap inside the range" — it means **outside
 * this harp's range entirely**, which is only reachable via `extraMidis`.
 *
 * `extraMidis` are pitches that must have a row even though the instrument can't reach
 * them — the pitches of the notes currently in the piece. Without it, translating to a
 * lower-pitched harp doesn't grey out the notes above its ceiling, it deletes their rows:
 * the note stays in the store and in every export while vanishing from the grid, with no
 * way to see or fix it. The ladder is widened to cover them and stays gapless, since
 * everything downstream indexes rows positionally and steps between adjacent ones.
 *
 * The diatonic 3 blow / -2 draw pair is the deliberate exception to one row per pitch:
 * both fundamental positions are shown, with 3 immediately above -2.
 */
export function getGridRows(
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  extraMidis: readonly number[] = [],
): GridRow[] {
  const transpose = getTranspose(key);
  // The instrument's own span, in real (not C-space) MIDI. Chromatic's is the wider of the
  // two and diatonic now matches it exactly, but deriving it from the layout keeps this
  // correct if either table ever grows.
  const layout    = harmonicaType === 'chromatic' ? C_CHROMATIC : C_DIATONIC;
  const cMidis    = Object.keys(layout).map(Number);
  let low  = Math.min(...cMidis) + transpose;
  let high = Math.max(...cMidis) + transpose;

  for (const midi of extraMidis) {
    if (!Number.isFinite(midi)) continue;
    low  = Math.min(low,  Math.round(midi));
    high = Math.max(high, Math.round(midi));
  }

  const rows: GridRow[] = [];
  // Highest pitch first — row index 0 is the top of the grid, matching getChromaticRows.
  for (let midi = high; midi >= low; midi--) {
    const note = midiToNoteName(midi);
    const tab  = noteToTab(note, key, harmonicaType) ?? '';
    // Hole 3 blow and hole 2 draw are the same pitch. Keep the alternate immediately
    // above the canonical -2 row so either real playing position can be drawn/edited.
    if (harmonicaType === 'diatonic' && midi - transpose === 67) {
      rows.push({ tab: '3', note, midi, playable: true });
    }
    rows.push({ tab, note, midi, playable: tab !== '' });
  }
  return rows;
}

/** Widest range worth drawing — the full MIDI span, which is what a piano roll editing
 *  arbitrary MIDI has to be able to reach. */
export const FULL_RANGE_LOW_MIDI  = 0;
export const FULL_RANGE_HIGH_MIDI = 127;

/**
 * The MIDI Studio's row ladder: every semitone in range, with no harmonica attached.
 *
 * Same `GridRow` shape as `getGridRows` deliberately, so the piano roll takes one kind of
 * row list and doesn't grow a second layout path. The difference is what the fields mean —
 * here `tab` is empty because there is no tab vocabulary at this stage (the music hasn't
 * been assigned to an instrument yet), and every row is `playable` because a pitch outside
 * a harmonica's reach is still perfectly real music. Harmonica constraints apply at the
 * conversion boundary, not in the Studio.
 */
export function getChromaticRows(
  lowMidi:  number = FULL_RANGE_LOW_MIDI,
  highMidi: number = FULL_RANGE_HIGH_MIDI,
): GridRow[] {
  const low  = Math.max(0, Math.min(127, Math.round(lowMidi)));
  const high = Math.max(low, Math.min(127, Math.round(highMidi)));

  const rows: GridRow[] = [];
  // Highest pitch first, matching `getPlayablePositions`' ordering — row index 0 is the
  // top of the grid in both models.
  for (let midi = high; midi >= low; midi--) {
    rows.push({ tab: '', note: midiToNoteName(midi), midi, playable: true });
  }
  return rows;
}
