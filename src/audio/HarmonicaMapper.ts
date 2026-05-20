import type { HarmonicaKey } from '@/types';

// C-diatonic layout: maps C-space MIDI note → { tab, note name without octave }
// Multiple-option notes use best mapping: non-bend first, then lower hole.
const C_DIATONIC: Record<number, string> = {
  60: '1',     // C4  hole 1 blow
  61: "-1'",   // C#4 hole 1 draw bend
  62: '-1',    // D4  hole 1 draw
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
  76: '5',     // E5  hole 5 blow (preferred over draw bend)
  77: '-5',    // F5  hole 5 draw
  79: '6',     // G5  hole 6 blow
  80: "-6'",   // G#5 hole 6 draw bend
  81: '-6',    // A5  hole 6 draw
  83: '-7',    // B5  hole 7 draw
  84: '7',     // C6  hole 7 blow
  86: '-8',    // D6  hole 8 draw
  87: "-8'",   // D#6 hole 8 blow bend
  88: '8',     // E6  hole 8 blow
  89: '-9',    // F6  hole 9 draw (preferred over blow double bend)
  90: "-9'",   // F#6 hole 9 blow bend
  91: '9',     // G6  hole 9 blow
  93: '-10',   // A6  hole 10 draw (preferred over blow triple bend)
  94: "-10''", // A#6 hole 10 blow double bend
  95: "-10'",  // B6  hole 10 blow bend
  96: '10',    // C7  hole 10 blow
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

// Reverse map: tab string → C-space MIDI (excludes overblows — no note mapping for those)
const TAB_TO_C_MIDI: Record<string, number> = Object.fromEntries(
  Object.entries(C_DIATONIC).map(([midi, tab]) => [tab, Number(midi)]),
);

// Keys G–B have raw offset >= 7 and are shifted down an octave to stay in C-layout range.
const KEY_OFFSETS: Record<HarmonicaKey, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5,
  'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

function getTranspose(key: HarmonicaKey): number {
  const offset = KEY_OFFSETS[key];
  return offset >= 7 ? offset - 12 : offset;
}

export function frequencyToTab(
  frequency: number,
  key: HarmonicaKey,
): { tab: string; note: string } | null {
  if (!isFinite(frequency) || frequency <= 0) return null;

  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const cMidi = midi - getTranspose(key);
  const tab = C_DIATONIC[cMidi];
  if (!tab) return null;

  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12] + octave;

  return { tab, note };
}

export function tabToNote(tab: string, key: HarmonicaKey): string | null {
  const cMidi = TAB_TO_C_MIDI[tab];
  if (cMidi === undefined) return null; // overblow or unknown tab
  const midi   = cMidi + getTranspose(key);
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

export function noteToTab(note: string, key: HarmonicaKey): string | null {
  const m = note.match(/^([A-G]#?)(\d+)$/);
  if (!m) return null;
  const semitone = NOTE_SEMITONES[m[1]];
  if (semitone === undefined) return null;
  const midi  = (parseInt(m[2]) + 1) * 12 + semitone;
  const cMidi = midi - getTranspose(key);
  return C_DIATONIC[cMidi] ?? null;
}
