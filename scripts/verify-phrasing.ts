/**
 * Harness for phrase-based line breaking in the TXT export.
 *
 * The case that matters most is the *absence* of a change: a tab with no rests in it must come
 * out wrapped exactly as it always was, because that is what every MIDI-imported tab looks like
 * and what every previously exported file looks like. After that: the local-maximum break rule
 * (including the consistency case it exists for), the section rest, and the guards that keep a
 * line from being one note long or thirteen.
 *
 * Run: npx tsx scripts/verify-phrasing.ts
 *      npx tsx scripts/verify-phrasing.ts <export.json>   # print real playing, phrased
 */

import { readFileSync } from 'node:fs';
import { generateForFormat, singlePart } from '../src/export/generators';
import { groupIntoPhrases, MAX_NOTES_PER_LINE } from '../src/export/phrasing';
import type { HarmonicaKey, TabNote } from '../src/types';

interface CaseResult { name: string; passed: boolean; detail: string }
const results: CaseResult[] = [];
function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

/** Builds a run of notes from `[durationMs, restAfterMs]` pairs, so each case reads as the
 *  rhythm it is testing rather than as a column of absolute timestamps. */
function notesFrom(spec: readonly (readonly [number, number])[]): TabNote[] {
  let t = 0;
  return spec.map(([duration, rest], i) => {
    const note: TabNote = {
      id: `n${i}`, tab: String(i % 10), note: 'C5',
      duration, start_time: t, confidence: 100,
    };
    t += duration + rest;
    return note;
  });
}

const shape = (notes: readonly TabNote[]) => groupIntoPhrases(notes).map((p) => p.notes.length);

// ── The thing that must not change ────────────────────────────────────────────

function restFreeInputWrapsAsBefore(): void {
  // A MIDI import: notes abut exactly, so there is no phrasing evidence anywhere.
  const notes = notesFrom(Array.from({ length: 30 }, () => [200, 0] as const));
  const lens = shape(notes);
  check(
    'rest-free input still wraps at the historical fixed width',
    lens.join(',') === '12,12,6',
    lens.join(','),
  );
}

function everyLineRespectsTheCap(): void {
  const notes = notesFrom(Array.from({ length: 97 }, (_, i) => [200, i === 40 ? 900 : 3] as const));
  const lens = shape(notes);
  check(
    'no line exceeds the cap, whatever the rests do',
    lens.every((n) => n <= MAX_NOTES_PER_LINE) && lens.reduce((a, b) => a + b, 0) === 97,
    `lines ${lens.join(',')}`,
  );
}

// ── The break rules ───────────────────────────────────────────────────────────

function silenceEndsAPhrase(): void {
  // Four notes, a clear breath, four more. Typical spacing is 250ms; the rest is 600ms.
  const notes = notesFrom([
    [200, 50], [200, 50], [200, 50], [200, 600],
    [200, 50], [200, 50], [200, 50], [200, 0],
  ]);
  const lens = shape(notes);
  check('a real silence ends a phrase', lens.join(',') === '4,4', lens.join(','));
}

function heldNotePlusShortBreathEndsAPhrase(): void {
  // The rest here (140ms) is well under the silence threshold on its own; the held note is
  // what makes it a boundary.
  const notes = notesFrom([
    [200, 40], [200, 40], [200, 40], [600, 140],
    [200, 40], [200, 40], [200, 40], [200, 0],
  ]);
  const lens = shape(notes);
  check('a held note plus a short breath ends a phrase', lens.join(',') === '4,4', lens.join(','));
}

function briefDropoutDoesNotBreak(): void {
  // A 60ms hole mid-run is pitch-detector dropout, not a breath — the absolute floor is what
  // keeps this from phrasing on every glitch.
  const notes = notesFrom([[200, 20], [200, 60], [200, 20], [200, 60], [200, 20], [200, 0]]);
  const lens = shape(notes);
  check('a brief detector dropout does not break the line', lens.join(',') === '6', lens.join(','));
}

function boundaryMustDominateItsNeighbourhood(): void {
  // A moderate gap three notes before a much larger one is mid-phrase hesitation, not a
  // boundary — breaking at both is what produced 2-note fragments.
  const notes = notesFrom([
    [200, 60], [200, 60], [200, 300], [200, 60], [200, 600],
    [200, 60], [200, 60], [200, 60], [200, 60], [200, 0],
  ]);
  const lens = shape(notes);
  check('a weaker gap next to a stronger one does not break', lens.join(',') === '5,5', lens.join(','));
}

function repeatedPhrasesBreakConsistently(): void {
  // The regression this rule exists for. Four identical 6-note phrases whose separating
  // breaths differ slightly (200/240/300ms) — a fixed threshold lands between them and breaks
  // some repeats but not others, so the same melody phrases two different ways in one file.
  const phrase = (breath: number) =>
    [[200, 60], [200, 60], [200, 60], [200, 60], [200, 60], [200, breath]] as const;
  const notes = notesFrom([...phrase(200), ...phrase(240), ...phrase(300), ...phrase(0)]);
  const lens = shape(notes);
  check(
    'the same phrase breaks the same way however its breath varies',
    lens.join(',') === '6,6,6,6',
    lens.join(','),
  );
}

// ── Sections and guards ───────────────────────────────────────────────────────

function longRestStartsASection(): void {
  const notes = notesFrom([
    [200, 50], [200, 50], [200, 50], [200, 2500],
    [200, 50], [200, 50], [200, 50], [200, 0],
  ]);
  const phrases = groupIntoPhrases(notes);
  check(
    'a section-sized rest marks the next phrase',
    phrases.length === 2 && phrases[0].startsSection === false && phrases[1].startsSection === true,
    phrases.map((p) => `${p.notes.length}${p.startsSection ? '*' : ''}`).join(','),
  );
}

function orphanNoteMergesBack(): void {
  // The trailing note is separated by a breath but not by a section rest, so it folds back
  // rather than sitting alone on its own line.
  const notes = notesFrom([[200, 50], [200, 50], [200, 50], [200, 600], [200, 0]]);
  const lens = shape(notes);
  check('a lone trailing note merges into the line above', lens.join(',') === '5', lens.join(','));
}

function orphanAfterSectionRestSurvives(): void {
  const notes = notesFrom([[200, 50], [200, 50], [200, 50], [200, 2500], [200, 0]]);
  const phrases = groupIntoPhrases(notes);
  check(
    'a lone note after a section rest keeps its own line',
    phrases.length === 2 && phrases[1].notes.length === 1 && phrases[1].startsSection,
    phrases.map((p) => p.notes.length).join(','),
  );
}

function degenerateInput(): void {
  const empty  = groupIntoPhrases([]);
  const single = groupIntoPhrases(notesFrom([[200, 0]]));
  check(
    'empty and single-note input are handled',
    empty.length === 0 && single.length === 1 && single[0].notes.length === 1,
    `${empty.length} / ${single.length}`,
  );
}

function unsortedInputIsOrdered(): void {
  const notes = notesFrom([[200, 50], [200, 50], [200, 600], [200, 50], [200, 0]]);
  const shuffled = [notes[3], notes[0], notes[4], notes[2], notes[1]];
  const phrases = groupIntoPhrases(shuffled);
  const ids = phrases.flatMap((p) => p.notes.map((n) => n.id));
  check(
    'out-of-order notes are put back in time order before phrasing',
    ids.join(',') === 'n0,n1,n2,n3,n4',
    ids.join(','),
  );
}

// ── End to end through the exporter ───────────────────────────────────────────

/** The tab body: everything below the last divider, so the header and the legend that now
 *  sits under it are both skipped. */
function txtBody(content: string): string[] {
  const lines = content.split('\n');
  return lines.slice(lines.lastIndexOf('-'.repeat(40)) + 1);
}

function txtRendersSectionsAsBlankLines(): void {
  const notes = notesFrom([
    [200, 50], [200, 50], [200, 600],
    [200, 2500],
    [200, 50], [200, 0],
  ]);
  const { content } = generateForFormat(singlePart(notes, 'C', 'diatonic'), 'TXT');
  const body = txtBody(content);
  check(
    'TXT puts a blank line at a section boundary and never leads with one',
    body.includes('') && body[0] !== '',
    JSON.stringify(body),
  );
}

function commaMarksBreathsNotWraps(): void {
  // Twenty abutting notes (one phrase, too long for a line), a breath, then five more. The
  // forced wrap must read as continuing; only the real phrase end takes a comma; the final
  // line has nothing to run into so it takes none either.
  const notes = notesFrom([
    ...Array.from({ length: 19 }, () => [200, 0] as const), [200, 900],
    ...Array.from({ length: 5 }, () => [200, 0] as const),
  ]);
  const { content } = generateForFormat(singlePart(notes, 'C', 'diatonic'), 'TXT');
  const body = txtBody(content);
  const commas = body.map((l) => (l.endsWith(',') ? 1 : 0));
  check(
    'a comma marks a breath; a forced wrap and the final line carry none',
    body.length === 3 && commas.join(',') === '0,1,0'
      && body.map((l) => l.replace(/,$/, '').split(/\s+/).length).join(',') === '12,8,5',
    body.map((l, i) => `${l.split(/\s+/).length}${commas[i] ? ',' : ''}`).join(' | '),
  );
}

// ── Optional: real playing ────────────────────────────────────────────────────

/** Prints a real recording's phrased TXT from a v1 JSON export, so the thresholds can be
 *  judged against actual playing instead of synthetic rhythms. */
function printRealExport(path: string): void {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const notes: TabNote[] = (parsed.notes ?? parsed.tracks?.[0]?.notes ?? []).map(
    (n: Partial<TabNote>, i: number) => ({ ...n, id: n.id ?? `n${i}`, confidence: n.confidence ?? 100 } as TabNote),
  );
  const key: HarmonicaKey = parsed.key ?? parsed.tracks?.[0]?.key ?? 'C';
  if (notes.length === 0) { console.log(`no notes found in ${path}`); return; }

  const lens = shape(notes);
  console.log(generateForFormat(singlePart(notes, key, parsed.harmonicaType ?? 'diatonic'), 'TXT').content);
  console.log(`\n${notes.length} notes → ${lens.length} lines (${lens.join(', ')})`);
}

function main(): void {
  const path = process.argv[2];
  if (path) { printRealExport(path); return; }

  restFreeInputWrapsAsBefore();
  everyLineRespectsTheCap();
  silenceEndsAPhrase();
  heldNotePlusShortBreathEndsAPhrase();
  briefDropoutDoesNotBreak();
  boundaryMustDominateItsNeighbourhood();
  repeatedPhrasesBreakConsistently();
  longRestStartsASection();
  orphanNoteMergesBack();
  orphanAfterSectionRestSurvives();
  degenerateInput();
  unsortedInputIsOrdered();
  txtRendersSectionsAsBlankLines();
  commaMarksBreathsNotWraps();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
