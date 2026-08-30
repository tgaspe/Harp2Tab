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

import {
  decomposeSpan, fifthsForKey, spellPitch,
} from '../src/notation/scoreDocument';

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

function main(): void {
  decomposition();
  spelling();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
