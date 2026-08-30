/**
 * Harness for the score document (Phase 18).
 *
 * What it protects is the layer *between* the editor's milliseconds and anything anyone
 * sees: written note values, key-aware pitch spelling, and the quantizer. Every one of
 * those is a place where a plausible-looking score is silently the wrong music, and none of
 * them is visible in a rendered SVG — a half note starting on beat 2 engraves perfectly and
 * is still unreadable, and a B-flat spelled A-sharp looks fine until a player reads it.
 *
 * The rule the whole phase turns on is asserted here too: quantization is derived, never
 * applied. `TabNote.start_time` and `TabNote.duration` must come back untouched.
 *
 * Run: npx tsx scripts/verify-notation.ts
 */

import { singlePart } from '../src/export/generators';
import { buildScoreDocument } from '../src/notation/quantize';
import {
  decomposeSpan, fifthsForKey, spellPitch,
} from '../src/notation/scoreDocument';
import type { TabNote } from '../src/types';

interface CaseResult { name: string; passed: boolean; detail: string }
const results: CaseResult[] = [];
function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

// ── Written note values ───────────────────────────────────────────────────────

function decomposition(): void {
  const quarterOnBeat = decomposeSpan(0, 24, 'balanced');
  check(
    'a quarter on the beat is one quarter note',
    quarterOnBeat.length === 1 && quarterOnBeat[0].type === 'quarter' && quarterOnBeat[0].dots === 0,
    JSON.stringify(quarterOnBeat),
  );

  const dotted = decomposeSpan(0, 36, 'balanced');
  check(
    '36 ticks on the beat is one dotted quarter',
    dotted.length === 1 && dotted[0].type === 'quarter' && dotted[0].dots === 1,
    JSON.stringify(dotted),
  );

  // A half note's worth of time, but starting on beat 2 it cannot be written as one — a
  // half note there straddles the middle of the bar and stops reading as a beat count.
  const offBeatHalf = decomposeSpan(24, 48, 'balanced');
  check(
    'a half-note span starting on beat 2 is written as two tied quarters',
    offBeatHalf.length === 2 && offBeatHalf.every((p) => p.type === 'quarter' && p.dots === 0),
    JSON.stringify(offBeatHalf),
  );

  const wholeBar = decomposeSpan(0, 96, 'balanced');
  check(
    'a full bar from beat 1 is one whole note',
    wholeBar.length === 1 && wholeBar[0].type === 'whole',
    JSON.stringify(wholeBar),
  );

  const triplet = decomposeSpan(0, 8, 'triplet');
  check(
    'one third of a beat is an eighth with 3:2 time modification',
    triplet.length === 1 && triplet[0].type === 'eighth'
      && triplet[0].timeModification?.actualNotes === 3
      && triplet[0].timeModification?.normalNotes === 2,
    JSON.stringify(triplet),
  );

  check(
    'a plain beat is still written plainly in triplet mode',
    decomposeSpan(0, 24, 'triplet')[0].timeModification === undefined,
    JSON.stringify(decomposeSpan(0, 24, 'triplet')),
  );

  // The invariant that makes measures add up. Every span the quantizer hands over has
  // already been cut to fit inside a bar, so a decomposition that loses or invents ticks
  // is a measure that no notation program will accept.
  const spans: [number, number][] = [[6, 30], [3, 21], [12, 84], [18, 6], [0, 95]];
  const sums = spans.map(([start, len]) =>
    decomposeSpan(start, len, 'precise').reduce((s, p) => s + p.ticks, 0) === len);
  check(
    'a decomposition always sums to the span it was given',
    sums.every(Boolean),
    `${sums.filter(Boolean).length}/${spans.length} spans`,
  );

  check(
    'decomposition terminates on a span the grid cannot express',
    decomposeSpan(0, 7, 'balanced').reduce((s, p) => s + p.ticks, 0) === 7,
    JSON.stringify(decomposeSpan(0, 7, 'balanced')),
  );
}

// ── Pitch spelling ────────────────────────────────────────────────────────────

function spelling(): void {
  // MIDI 70 is the black note between A and B. An F harp is one flat, a G harp one sharp,
  // and the same sounding pitch has to be written two different ways.
  const flat  = spellPitch(70, fifthsForKey('F'));
  const sharp = spellPitch(70, fifthsForKey('G'));
  check(
    'a flat key spells the black note as a flat',
    flat.step === 'B' && flat.alter === -1,
    JSON.stringify(flat),
  );
  check(
    'a sharp key spells the same sounding pitch as a sharp',
    sharp.step === 'A' && sharp.alter === 1,
    JSON.stringify(sharp),
  );

  const middleC = spellPitch(60, 0);
  check(
    'MIDI 60 is middle C in octave 4',
    middleC.step === 'C' && middleC.alter === 0 && middleC.octave === 4,
    JSON.stringify(middleC),
  );

  check(
    'a natural note is never given an accidental',
    spellPitch(65, fifthsForKey('F')).step === 'F' && spellPitch(65, fifthsForKey('F')).alter === 0,
    'F4 natural',
  );

  const keys = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'] as const;
  check(
    'every harmonica key has a key signature',
    keys.every((k) => Number.isInteger(fifthsForKey(k))),
    keys.map((k) => `${k}:${fifthsForKey(k)}`).join(' '),
  );
}


// ── Quantization ──────────────────────────────────────────────────────────────

/** At 120 BPM a quarter note is 500 ms and a bar is 2000 ms, which keeps the arithmetic in
 *  these cases readable at a glance. */
const BALANCED_120 = {
  bpm: 120, originMs: 0, beats: 4, beatType: 4, rhythmMode: 'balanced' as const,
};

function at(id: string, tab: string, note: string, start: number, duration: number): TabNote {
  return { id, tab, note, start_time: start, duration, confidence: 100 };
}

function quantizerRhythm(): void {
  const four = buildScoreDocument(
    singlePart([
      at('a', '4', 'C4', 0, 500), at('b', '-4', 'D4', 500, 500),
      at('c', '5', 'E4', 1000, 500), at('d', '-5', 'F4', 1500, 500),
    ], 'C', 'diatonic'),
    BALANCED_120,
  );
  const measures = four.parts[0].measures;
  check(
    'four quarter notes fill exactly one measure',
    measures.length === 1 && measures[0].elements.length === 4
      && measures[0].elements.every((e) => e.type === 'quarter' && e.dots === 0),
    `${measures.length} measure(s), ${measures[0]?.elements.length} elements`,
  );

  const slower = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 0, 1000)], 'C', 'diatonic'), { ...BALANCED_120, bpm: 90 });
  check(
    'the measure carries the session tempo, not a hard-coded 120',
    slower.parts[0].measures[0].tempoBpm === 90,
    `${slower.parts[0].measures[0].tempoBpm} bpm`,
  );

  const gapped = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 0, 500), at('b', '5', 'E4', 1500, 500)], 'C', 'diatonic'),
    BALANCED_120,
  );
  const els = gapped.parts[0].measures[0].elements;
  const rests = els.filter((e) => e.pitches.length === 0);
  check(
    'a gap between notes becomes rests covering exactly the silence',
    rests.length === 2 && rests.reduce((s, e) => s + e.durationTicks, 0) === 48,
    els.map((e) => `${e.pitches.length ? 'note' : 'rest'}:${e.durationTicks}`).join(' '),
  );

  // Every measure must add up, or no notation program will open the file.
  const ragged = buildScoreDocument(
    singlePart([
      at('a', '4', 'C4', 137, 490), at('b', '-4', 'D4', 611, 217),
      at('c', '5', 'E4', 902, 1450), at('d', '-5', 'F4', 2410, 300),
    ], 'C', 'diatonic'),
    BALANCED_120,
  );
  const barTicks = 96;
  const sums = ragged.parts[0].measures.map(
    (m) => m.elements.reduce((s, e) => s + e.durationTicks, 0));
  check(
    'every measure sums to a full bar',
    sums.every((s) => s === barTicks),
    sums.join(' '),
  );
}

function quantizerTies(): void {
  // Starts on beat 4 and runs a full second — half in this bar, half in the next.
  const across = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 1500, 1000)], 'C', 'diatonic'), BALANCED_120);
  const bars = across.parts[0].measures;
  const first = bars[0].elements.filter((e) => e.pitches.length > 0);
  const second = bars[1].elements.filter((e) => e.pitches.length > 0);
  check(
    'a note crossing the bar line is split and tied',
    bars.length === 2 && first.at(-1)?.tieStart === true && second[0]?.tieStop === true,
    `${bars.length} bars, ${first.length}+${second.length} notes`,
  );
  check(
    'a tied continuation does not repeat the tab',
    first.at(-1)?.tab === '4' && second[0]?.tab === '',
    `"${first.at(-1)?.tab}" then "${second[0]?.tab}"`,
  );
  check(
    'both halves of a tie still point at the source note',
    first.at(-1)?.sourceIds[0] === 'a' && second[0]?.sourceIds[0] === 'a',
    'sourceIds preserved',
  );
}

function quantizerChords(): void {
  const chord = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 0, 500), at('b', '5', 'E4', 20, 500)], 'C', 'diatonic'),
    BALANCED_120,
  );
  const element = chord.parts[0].measures[0].elements[0];
  check(
    'onsets inside the chord window become one chord element',
    element.pitches.length === 2 && element.sourceIds.length === 2,
    `${element.pitches.length} pitches, ${element.sourceIds.length} ids`,
  );
  check(
    'a chord prints the same token the TXT export would',
    element.tab === '45',
    `"${element.tab}"`,
  );

  // Far enough apart to be an arpeggio, not a strum.
  const apart = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 0, 500), at('b', '5', 'E4', 250, 500)], 'C', 'diatonic'),
    BALANCED_120,
  );
  const attacks = apart.parts[0].measures[0].elements
    .filter((e) => e.pitches.length > 0 && !e.tieStop);
  check(
    'onsets outside the chord window stay separate notes',
    attacks.length === 2,
    `${attacks.length} attack(s)`,
  );
}

function quantizerOrigin(): void {
  const late = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 8000, 500)], 'C', 'diatonic'),
    { bpm: 120, beats: 4, beatType: 4, rhythmMode: 'balanced' },
  );
  check(
    'leading silence is not written as four empty bars',
    late.parts[0].measures.length === 1,
    `${late.parts[0].measures.length} measure(s)`,
  );

  const kept = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 8000, 500)], 'C', 'diatonic'),
    { bpm: 120, originMs: 0, beats: 4, beatType: 4, rhythmMode: 'balanced' },
  );
  check(
    'an explicit origin of 0 does keep the silence',
    kept.parts[0].measures.length === 5,
    `${kept.parts[0].measures.length} measure(s)`,
  );
}

function quantizerIsNonDestructive(): void {
  const source = [at('a', '4', 'C4', 137, 490), at('b', '-4', 'D4', 611, 217)];
  const before = JSON.stringify(source);
  buildScoreDocument(singlePart(source, 'C', 'diatonic'), BALANCED_120);
  check(
    'quantizing never edits the source notes',
    JSON.stringify(source) === before,
    `${source[0].start_time}/${source[0].duration}`,
  );
}

function quantizerWarnings(): void {
  // Rounding can never move an onset by more than half a grid unit — 62ms at a sixteenth
  // grid and 120 BPM — so that is what "moved substantially" has to mean. 562ms is exactly
  // that case: it is written on the beat, 62ms before it was played.
  const moved = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 0, 500), at('b', '5', 'E4', 562, 500)], 'C', 'diatonic'),
    BALANCED_120,
  );
  check(
    'a note dragged well off its onset is warned about',
    moved.warnings.some((w) => w.sourceId === 'b' && w.kind === 'onsetMoved'),
    moved.warnings.map((w) => `${w.sourceId}:${w.kind}:${Math.round(w.deltaMs)}`).join(' ') || 'none',
  );

  const clean = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 0, 500), at('b', '5', 'E4', 500, 500)], 'C', 'diatonic'),
    BALANCED_120,
  );
  check(
    'a performance already on the grid produces no warnings',
    clean.warnings.length === 0,
    `${clean.warnings.length} warning(s)`,
  );
}

function multiPart(): void {
  const doc = buildScoreDocument([
    { name: 'Melody', key: 'C', harmonicaType: 'diatonic', notes: [at('a', '4', 'C4', 0, 500)] },
    { name: 'Bass',   key: 'G', harmonicaType: 'diatonic', notes: [at('b', '2', 'G3', 0, 500)] },
  ], BALANCED_120);
  check(
    'the score document holds several parts, each with its own harp',
    doc.parts.length === 2 && doc.parts[0].key === 'C' && doc.parts[1].key === 'G',
    `${doc.parts.length} parts`,
  );
}

function main(): void {
  decomposition();
  spelling();
  quantizerRhythm();
  quantizerTies();
  quantizerChords();
  quantizerOrigin();
  quantizerIsNonDestructive();
  quantizerWarnings();
  multiPart();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
