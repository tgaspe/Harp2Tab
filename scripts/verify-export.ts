/**
 * Harness for multi-track export (Phase 11-10).
 *
 * The regression that would otherwise slip through unnoticed is *single-track* output
 * changing — every file a user has ever exported looks like that, so it's asserted first
 * and hardest. After that: the escaping the CSV format never needed until track names
 * entered it, and the per-part keys that make a multi-track tab file interpretable at all.
 *
 * Run: npx tsx scripts/verify-export.ts
 */

import { generateForFormat, singlePart, type ExportPart } from '../src/export/generators';
import { tabToNote } from '../src/audio/HarmonicaMapper';
import { readSmf } from '../src/audio/smf';
import { base64ToBytes } from '../src/audio/base64';
import type { HarmonicaKey, HarmonicaType, TabNote } from '../src/types';

interface CaseResult { name: string; passed: boolean; detail: string }
const results: CaseResult[] = [];
function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

function notesFor(tabs: string[], key: HarmonicaKey): TabNote[] {
  return tabs.map((tab, i) => ({
    id:         `n${i}`,
    tab,
    note:       tabToNote(tab, key, 'diatonic') ?? 'C4',
    duration:   300,
    start_time: i * 400,
    confidence: 100,
  }));
}

const melody = notesFor(['4', '-4', '5', '-5', '6'], 'C');
const bass   = notesFor(['2', '-2', '3', '-3'], 'G');

const twoParts: ExportPart[] = [
  { name: 'Melody',    key: 'C', harmonicaType: 'diatonic', notes: melody },
  { name: 'Bass Line', key: 'G', harmonicaType: 'diatonic', notes: bass },
];

// ── Single-track output must not regress ──────────────────────────────────────

function singleTrackTxtUnchanged(): void {
  const { content } = generateForFormat(singlePart(melody, 'C', 'diatonic'), 'TXT');
  // Exactly the shape this format has always had: header, 40-dash divider, packed tabs.
  const expected = [
    'Harp2Tab -- Key of C -- 5 notes',
    '-'.repeat(40),
    '4  -4  5  -5  6',
  ].join('\n');

  check(
    'single-track TXT is byte-identical to the historical format',
    content === expected,
    content === expected ? 'exact match' : `got:\n${content}`,
  );
}

function singleTrackCsvRowOrder(): void {
  const { content } = generateForFormat(singlePart(melody, 'C', 'diatonic'), 'CSV');
  const lines = content.split('\n');
  const starts = lines.slice(1).map((l) => Number(l.split(',')[2]));
  const ordered = starts.every((v, i) => i === 0 || v >= starts[i - 1]);

  check(
    'single-track CSV keeps its historical row order and leading columns',
    lines[0].startsWith('tab,note,start_time_ms,duration_ms')
      && lines[1].startsWith('4,C5,0,300')
      && ordered,
    lines[1],
  );
}

function singleTrackJsonShape(): void {
  const { content } = generateForFormat(singlePart(melody, 'C', 'diatonic'), 'JSON');
  const parsed = JSON.parse(content);
  check(
    'single-track JSON keeps the version 1 shape',
    parsed.version === 1 && parsed.key === 'C' && Array.isArray(parsed.notes) && parsed.notes.length === 5,
    `version ${parsed.version}, ${parsed.notes?.length} notes`,
  );
}

// ── CSV escaping and per-part columns ─────────────────────────────────────────

function csvEscapesTrackNames(): void {
  const parts: ExportPart[] = [
    { name: 'Lead, Alto', key: 'C', harmonicaType: 'diatonic', notes: notesFor(['4'], 'C') },
    { name: 'He said "hi"', key: 'D', harmonicaType: 'chromatic', notes: notesFor(['5'], 'D') },
  ];
  const { content } = generateForFormat(parts, 'CSV');
  const lines = content.split('\n');

  // The failure mode this guards is a *silent* one: an unescaped comma adds a column
  // rather than raising anything, so the row count stays right while every field shifts.
  const allSameWidth = lines.every((l) => splitCsv(l).length === 8);
  const names = lines.slice(1).map((l) => splitCsv(l)[5]);

  check(
    'a comma in a track name does not split the row',
    allSameWidth && names.includes('Lead, Alto'),
    `${lines.length} rows, names ${JSON.stringify(names)}`,
  );

  check(
    'a quote in a track name is doubled per RFC 4180',
    content.includes('"He said ""hi"""'),
    content.split('\n')[2],
  );
}

/** Minimal RFC 4180 reader, so the assertions parse the file the way a consumer would
 *  rather than trusting the writer's own idea of the field boundaries. */
function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else current += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { fields.push(current); current = ''; }
    else current += c;
  }
  fields.push(current);
  return fields;
}

function csvCarriesPerPartKeys(): void {
  const { content } = generateForFormat(twoParts, 'CSV');
  const rows = content.split('\n').slice(1).map(splitCsv);

  const keysByTrack = new Map(rows.map((r) => [r[5], r[6]]));
  check(
    'each CSV row carries its own part\'s key, not one file-wide key',
    keysByTrack.get('Melody') === 'C' && keysByTrack.get('Bass Line') === 'G',
    `Melody→${keysByTrack.get('Melody')}, Bass Line→${keysByTrack.get('Bass Line')}`,
  );

  const starts = rows.map((r) => Number(r[2]));
  check(
    'multi-track CSV rows are in global time order',
    starts.every((v, i) => i === 0 || v >= starts[i - 1]) && rows.length === 9,
    `${rows.length} rows: ${starts.join(',')}`,
  );
}

// ── TXT sections ──────────────────────────────────────────────────────────────

function txtSections(): void {
  const { content } = generateForFormat(twoParts, 'TXT');
  check(
    'multi-track TXT emits one titled section per part, each with its own key',
    content.startsWith('Harp2Tab -- 2 tracks')
      && content.includes('Melody -- Key of C -- 5 notes')
      && content.includes('Bass Line -- Key of G -- 4 notes'),
    content.split('\n').slice(0, 6).join(' / '),
  );
}

// ── MIDI ──────────────────────────────────────────────────────────────────────

function midiMultiTrack(): void {
  const { content, encoding } = generateForFormat(twoParts, 'MIDI');
  const smf = readSmf(base64ToBytes(content));
  // The conductor track carries tempo and no notes; the parts follow it.
  const noteTracks = smf.tracks.filter((t) => t.notes.length > 0);

  check(
    'multi-track MIDI writes one named track per part',
    encoding === 'base64'
      && noteTracks.length === 2
      && noteTracks[0].name === 'Melody'
      && noteTracks[1].name === 'Bass Line',
    `${noteTracks.length} note tracks: ${noteTracks.map((t) => t.name).join(', ')}`,
  );

  check(
    'multi-track MIDI keeps each part on its own channel',
    noteTracks[0].channel !== noteTracks[1].channel,
    `channels ${noteTracks.map((t) => t.channel).join(', ')}`,
  );

  check(
    'multi-track MIDI still declares the exporter\'s 120 BPM',
    smf.tempos.length > 0 && Math.round(smf.tempos[0].bpm) === 120,
    `${Math.round(smf.tempos[0]?.bpm)} BPM`,
  );
}

/** An unmappable pitch must be dropped rather than written as a wrong note. */
function midiSkipsUnparseablePitches(): void {
  const broken: TabNote[] = [
    { id: 'a', tab: '', note: 'not-a-pitch', duration: 300, start_time: 0, confidence: 100 },
    { id: 'b', tab: '4', note: 'C5', duration: 300, start_time: 400, confidence: 100 },
  ];
  const { content } = generateForFormat(singlePart(broken, 'C', 'diatonic'), 'MIDI');
  const smf = readSmf(base64ToBytes(content));
  const notes = smf.tracks.flatMap((t) => t.notes);

  check(
    'an unparseable pitch is dropped from MIDI, not written as middle C',
    notes.length === 1 && notes[0].midi === 72,
    `${notes.length} note(s), pitch ${notes[0]?.midi}`,
  );
}

// ── MusicXML ──────────────────────────────────────────────────────────────────

function musicXmlParts(): void {
  const { content } = generateForFormat(twoParts, 'MusicXML');
  const scoreParts = (content.match(/<score-part /g) ?? []).length;
  const partBodies = (content.match(/<part id="P/g) ?? []).length;

  check(
    'MusicXML declares and emits one part per track',
    scoreParts === 2 && partBodies === 2
      && content.includes('Melody (C harp)')
      && content.includes('Bass Line (G harp)'),
    `${scoreParts} score-parts, ${partBodies} part bodies`,
  );

  const single = generateForFormat(singlePart(melody, 'C', 'diatonic'), 'MusicXML').content;
  check(
    'single-track MusicXML keeps its original single Harmonica part',
    single.includes('<part-name>Harmonica</part-name>')
      && (single.match(/<score-part /g) ?? []).length === 1,
    'unchanged',
  );
}

/** A track name containing XML metacharacters must not break the document. */
function musicXmlEscapesNames(): void {
  const parts: ExportPart[] = [
    { name: 'Sax & <Brass>', key: 'C', harmonicaType: 'diatonic', notes: notesFor(['4'], 'C') },
    { name: 'Other',         key: 'C', harmonicaType: 'diatonic', notes: notesFor(['5'], 'C') },
  ];
  const { content } = generateForFormat(parts, 'MusicXML');
  check(
    'MusicXML escapes XML metacharacters in track names',
    content.includes('Sax &amp; &lt;Brass&gt;') && !content.includes('<Brass>'),
    'escaped',
  );
}

function jsonMultiPart(): void {
  const { content } = generateForFormat(twoParts, 'JSON');
  const parsed = JSON.parse(content);
  check(
    'multi-track JSON uses the version 2 tracks shape',
    parsed.version === 2 && parsed.tracks?.length === 2 && parsed.tracks[1].key === 'G',
    `version ${parsed.version}, ${parsed.tracks?.length} tracks`,
  );
}


// ── Chord notation ────────────────────────────────────────────────────────────

/** One note at a stated onset. Chord fixtures are built by giving several the same one. */
let tabSeq = 0;
function at(
  tab: string,
  start: number,
  opts: { key?: HarmonicaKey; type?: HarmonicaType; note?: string; dur?: number } = {},
): TabNote {
  const key  = opts.key  ?? 'C';
  const type = opts.type ?? 'diatonic';
  return {
    id:         `c${tabSeq++}`,
    tab,
    note:       opts.note ?? tabToNote(tab, key, type) ?? 'C4',
    duration:   opts.dur ?? 300,
    start_time: start,
    confidence: 100,
  };
}

function txt(notes: TabNote[], type: HarmonicaType = 'diatonic', key: HarmonicaKey = 'C'): string {
  const { content } = generateForFormat([{ name: 'Harmonica', key, harmonicaType: type, notes }], 'TXT');
  return content;
}

/** The tab itself, without the two header lines. */
function txtBody(notes: TabNote[], type: HarmonicaType = 'diatonic', key: HarmonicaKey = 'C'): string {
  return txt(notes, type, key).split('\n').slice(2).join('\n').trim();
}

function txtHeader(notes: TabNote[], type: HarmonicaType = 'diatonic'): string {
  return txt(notes, type).split('\n')[0];
}

function chordsConcatenate(): void {
  check(
    'a blow chord concatenates its holes',
    txtBody([at('4', 0), at('5', 0), at('6', 0)]) === '456',
    `got "${txtBody([at('4', 0), at('5', 0), at('6', 0)])}"`,
  );

  const draw = txtBody([at('-1', 0), at('-2', 0), at('-3', 0), at('-4', 0)]);
  check(
    'a draw chord carries one shared breath sign',
    draw === '-1234',
    `got "${draw}"`,
  );

  // Holes run 1–10 on a diatonic, and a '0' can only ever follow a '1', so "10" reads
  // unambiguously even when concatenated behind other holes.
  const tenth = txtBody([at('8', 0), at('9', 0), at('10', 0)]);
  check(
    'hole 10 concatenates without ambiguity',
    tenth === '8910',
    `got "${tenth}"`,
  );

  const unsorted = txtBody([at('6', 0), at('4', 0), at('5', 0)]);
  check(
    'chord holes read low to high whatever order they arrive in',
    unsorted === '456',
    `got "${unsorted}"`,
  );

  const dupes = txtBody([at('4', 0), at('4', 0), at('5', 0)]);
  check(
    'two notes landing on one hole are written once',
    dupes === '45',
    `got "${dupes}"`,
  );
}

function chordOnsetWindow(): void {
  const together = txtBody([at('4', 0), at('5', 50)]);
  check(
    'notes 50ms apart are one chord',
    together === '45',
    `got "${together}"`,
  );

  const apart = txtBody([at('4', 0), at('5', 51)]);
  check(
    'notes 51ms apart stay separate',
    apart === '4  5',
    `got "${apart}"`,
  );

  // Anchored on the group's first onset, so a slow arpeggio can't chain into one chord.
  const arpeggio = txtBody([at('4', 0), at('5', 40), at('6', 80)]);
  check(
    'a spread arpeggio does not chain into one chord',
    arpeggio === '45  6',
    `got "${arpeggio}"`,
  );
}

function unplayableGroupsUseSlashes(): void {
  const breath = txtBody([at('6', 0), at('-6', 0)]);
  check(
    'blow and draw at once is written with slashes, not as a chord',
    breath === '6/-6',
    `got "${breath}"`,
  );

  const overblow = txtBody([at('6', 0), at('6o', 0)]);
  check(
    'a group containing an overblow is not a chord',
    overblow === '6/6o',
    `got "${overblow}"`,
  );

  // A bend sits below the note it bends from, so ascending pitch puts -4' first.
  const bend = txtBody([at('-4', 0), at("-4'", 0)]);
  check(
    'a group containing a bend is not a chord',
    bend === "-4'/-4",
    `got "${bend}"`,
  );

  const offHarp = txtBody([at('4', 0), at('', 0, { note: 'C#7' })]);
  check(
    'an off-harp pitch keeps its bracketed name inside the group',
    offHarp === '4/[C#7]',
    `got "${offHarp}"`,
  );

  // Holes run to 12 on a chromatic, so "12" would be unreadable as holes 1 and 2.
  const chromatic = txtBody([at('1', 0, { type: 'chromatic' }), at('2', 0, { type: 'chromatic' })], 'chromatic');
  check(
    'a chromatic chord stays slashed, since hole 12 collides with holes 1+2',
    chromatic === '1/2',
    `got "${chromatic}"`,
  );
}

function chordHeaderCount(): void {
  // A playable chord is one thing to play; a group that isn't playable is still separate notes.
  const notes = [
    at('4', 0), at('5', 0), at('6', 0),   // one chord      → counts 1
    at('6', 1000), at('-6', 1000),        // not playable   → counts 2
    at('-4', 2000),                       // a single note  → counts 1
  ];
  check(
    'the header counts a playable chord once and an unplayable group per note',
    txtHeader(notes) === 'Harp2Tab -- Key of C -- 4 notes',
    `got "${txtHeader(notes)}"`,
  );

  check(
    'a lone note is still counted, and singular reads correctly',
    txtHeader([at('4', 0)]) === 'Harp2Tab -- Key of C -- 1 note',
    `got "${txtHeader([at('4', 0)])}"`,
  );
}

function main(): void {
  singleTrackTxtUnchanged();
  singleTrackCsvRowOrder();
  singleTrackJsonShape();
  csvEscapesTrackNames();
  csvCarriesPerPartKeys();
  txtSections();
  midiMultiTrack();
  midiSkipsUnparseablePitches();
  musicXmlParts();
  musicXmlEscapesNames();
  jsonMultiPart();
  chordsConcatenate();
  chordOnsetWindow();
  unplayableGroupsUseSlashes();
  chordHeaderCount();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
