/**
 * Round-trip harness for the MIDI-import pipeline.
 *
 * Two kinds of fixture, deliberately:
 *  - The app's own MIDI export (`generateForFormat(..., 'MIDI')`, hand-written SMF bytes)
 *    parsed back in — the closest thing to a real user file, and the one case where the
 *    expected tabs and timings are known exactly.
 *  - Hand-built SMF bytes (`buildSmf` below) for everything the exporter can't produce:
 *    multiple tracks, a percussion channel, a mid-file tempo change, chords, overlaps.
 *    Written here rather than with @tonejs/midi's writer so the fixtures don't come from
 *    the same code being tested.
 *
 * Run: npx tsx scripts/verify-midi-import.ts
 */

import { generateForFormat, singlePart } from '../src/export/generators';
import { midiToNoteName, noteToTab, tabToNote } from '../src/audio/HarmonicaMapper';
import {
  MIN_NOTE_MS,
  mergeTracks,
  mostMelodicTrack,
  parseMidiFile,
  reduceToMonophonic,
  type MidiNote,
} from '../src/audio/midiToNotes';
import { notesToTabs, rankKeysForMidi, shiftMidiNotes } from '../src/audio/notesToTabs';
import { octaveShiftForMidiRange } from '../src/audio/pitchRange';
import type { HarmonicaKey, TabNote } from '../src/types';

// ── SMF fixture builder ───────────────────────────────────────────────────────

const PPQ = 480;

interface NoteSpec  { midi: number; tick: number; durationTicks: number }
interface TempoSpec { tick: number; bpm: number }
interface TrackSpec {
  name?:    string;
  channel?: number;
  program?: number;
  tempos?:  TempoSpec[];
  notes:    NoteSpec[];
}

function vlq(value: number): number[] {
  if (value === 0) return [0];
  const bytes: number[] = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) { bytes.unshift((rest & 0x7f) | 0x80); rest >>>= 7; }
  return bytes;
}

function be(value: number, width: number): number[] {
  return Array.from({ length: width }, (_, i) => (value >> (8 * (width - 1 - i))) & 0xff);
}

/** Meta events first at a given tick, then note-offs, then note-ons — the same ordering
 *  convention the app's own exporter uses, so a note ending where the next begins doesn't
 *  read back as an overlap. */
const ORDER_META = 0, ORDER_OFF = 1, ORDER_ON = 2;

function buildTrack(spec: TrackSpec): number[] {
  const channel = spec.channel ?? 0;
  const events: { tick: number; order: number; bytes: number[] }[] = [];

  if (spec.name !== undefined) {
    const text = Array.from(spec.name, (c) => c.charCodeAt(0));
    events.push({ tick: 0, order: ORDER_META, bytes: [0xff, 0x03, text.length, ...text] });
  }
  if (spec.program !== undefined) {
    events.push({ tick: 0, order: ORDER_META, bytes: [0xc0 | channel, spec.program] });
  }
  for (const tempo of spec.tempos ?? []) {
    const usPerBeat = Math.round(60_000_000 / tempo.bpm);
    events.push({ tick: tempo.tick, order: ORDER_META, bytes: [0xff, 0x51, 0x03, ...be(usPerBeat, 3)] });
  }
  for (const note of spec.notes) {
    events.push({ tick: note.tick, order: ORDER_ON, bytes: [0x90 | channel, note.midi, 80] });
    events.push({
      tick:  note.tick + note.durationTicks,
      order: ORDER_OFF,
      bytes: [0x80 | channel, note.midi, 0],
    });
  }

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const body: number[] = [];
  let cursor = 0;
  for (const event of events) {
    body.push(...vlq(event.tick - cursor), ...event.bytes);
    cursor = event.tick;
  }
  body.push(0, 0xff, 0x2f, 0x00); // end of track

  return [0x4d, 0x54, 0x72, 0x6b, ...be(body.length, 4), ...body];
}

function buildSmf(tracks: TrackSpec[]): Uint8Array {
  const header = [
    0x4d, 0x54, 0x68, 0x64, ...be(6, 4),
    ...be(1, 2),               // format 1 — one track per part
    ...be(tracks.length, 2),
    ...be(PPQ, 2),
  ];
  return new Uint8Array([...header, ...tracks.flatMap(buildTrack)]);
}

/** Ticks → ms at a given tempo, for expressing expectations in the same units the parser
 *  reports. At 120 BPM and PPQ 480 one beat is 480 ticks / 500ms. */
function tickMs(bpm: number): number {
  return 60_000 / bpm / PPQ;
}

// ── Assertions ────────────────────────────────────────────────────────────────

interface CaseResult { name: string; passed: boolean; detail: string }

const results: CaseResult[] = [];

function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

function near(actual: number, expected: number, toleranceMs: number): boolean {
  return Math.abs(actual - expected) <= toleranceMs;
}

// ── Cases ─────────────────────────────────────────────────────────────────────

/** The app's own export, parsed back and re-tabbed — tabs and timings must survive. */
function ownExportRoundTrip(): void {
  const key: HarmonicaKey = 'C';
  const tabs = ['4', '-4', '5', '-5', '6', "-6'", '-7', '7'];
  const NOTE_MS = 300, GAP_MS = 100;

  const original: TabNote[] = tabs.map((tab, i) => ({
    id:         `n${i}`,
    tab,
    note:       tabToNote(tab, key, 'diatonic') ?? '',
    duration:   NOTE_MS,
    start_time: i * (NOTE_MS + GAP_MS),
    confidence: 100,
  }));

  const { content } = generateForFormat(singlePart(original, key, 'diatonic'), 'MIDI');
  const bytes  = Uint8Array.from(Buffer.from(content, 'base64'));
  const parsed = parseMidiFile(bytes, 'export.mid');

  const notes  = reduceToMonophonic(parsed.tracks[0].notes);
  const tabbed = notesToTabs(notes, key, 'diatonic', 'midiVelocity');

  const tabsMatch = tabbed.length === tabs.length && tabbed.every((n, i) => n.tab === tabs[i]);
  // One tick is ~1.04ms at the exporter's 120 BPM / PPQ 480, so a couple of ms of
  // quantization is expected; anything more means real drift.
  const TOLERANCE_MS = 3;
  const timingOk = tabbed.every((n, i) =>
    near(n.start_time, original[i].start_time, TOLERANCE_MS)
    && near(n.duration, original[i].duration, TOLERANCE_MS),
  );
  const worstDrift = Math.max(...tabbed.map((n, i) =>
    Math.max(Math.abs(n.start_time - original[i].start_time), Math.abs(n.duration - original[i].duration)),
  ));

  check(
    'own MIDI export round-trips to the same tabs',
    tabsMatch && timingOk,
    tabsMatch
      ? `${tabbed.length} notes, worst drift ${worstDrift}ms`
      : `expected ${tabs.join(' ')}, got ${tabbed.map((n) => n.tab || '·').join(' ')}`,
  );

  check(
    'own MIDI export carries its tempo',
    parsed.bpm !== null && near(parsed.bpm, 120, 0.5),
    `bpm = ${parsed.bpm}`,
  );
}

/** A chord in the chosen track collapses to its top voice, not to a lower one. */
function chordFlattening(): void {
  const ms = tickMs(120);
  const bytes = buildSmf([{
    name:  'Piano',
    notes: [
      // Two triads, each a beat long.
      { midi: 60, tick: 0,   durationTicks: 480 },
      { midi: 64, tick: 0,   durationTicks: 480 },
      { midi: 67, tick: 0,   durationTicks: 480 },
      { midi: 62, tick: 480, durationTicks: 480 },
      { midi: 65, tick: 480, durationTicks: 480 },
      { midi: 69, tick: 480, durationTicks: 480 },
    ],
  }]);

  const parsed = parseMidiFile(bytes, 'chords.mid');
  const notes  = reduceToMonophonic(parsed.tracks[0].notes);

  const pitches = notes.map((n) => n.midi);
  check(
    'chords flatten to the top voice within a track',
    pitches.length === 2 && pitches[0] === 67 && pitches[1] === 69,
    `kept ${pitches.map(midiToNoteName).join(' ')}`,
  );
  check(
    'flattened chord notes keep their full length',
    notes.every((n) => near(n.durationMs, 480 * ms, 1)),
    `durations ${notes.map((n) => Math.round(n.durationMs)).join(', ')}ms`,
  );
}

/** A higher note starting inside a held one truncates it; a lower one is dropped. */
function overlapHandling(): void {
  const ms = tickMs(120);
  const bytes = buildSmf([{
    name:  'Overlaps',
    notes: [
      // A held note, then a higher note starting halfway through it.
      { midi: 72, tick: 0,    durationTicks: 960 },
      { midi: 79, tick: 480,  durationTicks: 480 },
      // A held note with a lower one underneath it — the lower one is accompaniment.
      { midi: 76, tick: 1440, durationTicks: 960 },
      { midi: 60, tick: 1680, durationTicks: 480 },
    ],
  }]);

  const parsed = parseMidiFile(bytes, 'overlap.mid');
  const notes  = reduceToMonophonic(parsed.tracks[0].notes);

  check(
    'a higher note truncates the note it interrupts',
    notes.length === 3
      && notes[0].midi === 72 && near(notes[0].durationMs, 480 * ms, 1)
      && notes[1].midi === 79,
    `got ${notes.map((n) => `${midiToNoteName(n.midi)}@${Math.round(n.timeMs)}+${Math.round(n.durationMs)}`).join(' ')}`,
  );
  check(
    'a lower note under a held one is dropped',
    !notes.some((n) => n.midi === 60),
    notes.some((n) => n.midi === 60) ? 'C4 survived reduction' : 'C4 correctly dropped',
  );
  check(
    'reduction never emits a zero or negative duration',
    notes.every((n) => n.durationMs >= MIN_NOTE_MS),
    `shortest ${Math.round(Math.min(...notes.map((n) => n.durationMs)))}ms`,
  );
}

/** A tempo change mid-file has to move every note after it, not just the bar ruler. */
function tempoChange(): void {
  const bytes = buildSmf([{
    name:   'Tempo',
    tempos: [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }],
    notes:  [
      { midi: 72, tick: 0,    durationTicks: 480 }, // 120 BPM → 0ms,   500ms long
      { midi: 74, tick: 480,  durationTicks: 480 }, // 120 BPM → 500ms, 500ms long
      { midi: 76, tick: 960,  durationTicks: 480 }, //  60 BPM → 1000ms, 1000ms long
      { midi: 77, tick: 1440, durationTicks: 480 }, //  60 BPM → 2000ms, 1000ms long
    ],
  }]);

  const parsed = parseMidiFile(bytes, 'tempo.mid');
  const notes  = parsed.tracks[0].notes;
  const expected = [
    { timeMs: 0,    durationMs: 500 },
    { timeMs: 500,  durationMs: 500 },
    { timeMs: 1000, durationMs: 1000 },
    { timeMs: 2000, durationMs: 1000 },
  ];

  check(
    'a mid-file tempo change re-times the notes after it',
    notes.length === 4 && notes.every((n, i) =>
      near(n.timeMs, expected[i].timeMs, 2) && near(n.durationMs, expected[i].durationMs, 2)),
    notes.map((n) => `${Math.round(n.timeMs)}+${Math.round(n.durationMs)}`).join(' '),
  );

  // Phase 11: the whole map is retained, not just `tempos[0]`. `bpm` still reports the
  // opening tempo, since that's the single value a tab session commits.
  check(
    'the parser keeps every tempo change, not just the first',
    parsed.tempos.length === 2
      && Math.round(parsed.tempos[0].bpm) === 120
      && Math.round(parsed.tempos[1].bpm) === 60
      && near(parsed.tempos[1].timeMs, 1000, 2)
      && parsed.bpm !== null && near(parsed.bpm, 120, 0.5),
    `${parsed.tempos.map((t) => `${Math.round(t.bpm)}@${Math.round(t.timeMs)}ms`).join(', ')}; opening bpm ${parsed.bpm}`,
  );
}

/** Percussion is pitchless, so channel 10 must never reach the track picker. */
function percussionExclusion(): void {
  const bytes = buildSmf([
    { name: 'Melody', channel: 0, notes: [
      { midi: 72, tick: 0,   durationTicks: 480 },
      { midi: 74, tick: 480, durationTicks: 480 },
    ] },
    { name: 'Drums', channel: 9, notes: [
      { midi: 36, tick: 0,   durationTicks: 120 },
      { midi: 38, tick: 240, durationTicks: 120 },
    ] },
  ]);

  const parsed = parseMidiFile(bytes, 'band.mid');
  check(
    'the percussion channel is excluded from the track list',
    parsed.tracks.length === 1 && parsed.tracks[0].name === 'Melody',
    `tracks: ${parsed.tracks.map((t) => `${t.name}(ch${t.channel})`).join(', ')}`,
  );

  const drumsOnly = buildSmf([{ name: 'Drums', channel: 9, notes: [
    { midi: 36, tick: 0, durationTicks: 120 },
  ] }]);
  let failedClearly = false;
  try { parseMidiFile(drumsOnly, 'drums.mid'); } catch (err) {
    failedClearly = err instanceof Error && /drum/i.test(err.message);
  }
  check(
    'a drums-only file fails with a clear message, not an empty picker',
    failedClearly,
    failedClearly ? 'rejected with a drum-part explanation' : 'did not reject',
  );
}

/** The picker's four facts about each track have to be right, and the pre-selection
 *  has to land on the melody rather than the bass. */
function trackEnumeration(): void {
  const bytes = buildSmf([
    { name: 'Bass', channel: 0, program: 33, notes: Array.from({ length: 12 }, (_, i) => ({
      midi: 40 + (i % 5), tick: i * 480, durationTicks: 480,
    })) },
    { name: 'Melody', channel: 1, notes: Array.from({ length: 16 }, (_, i) => ({
      midi: 72 + (i % 8), tick: i * 240, durationTicks: 240,
    })) },
    { name: 'Pad', channel: 2, notes: [{ midi: 60, tick: 0, durationTicks: 1920 }] },
  ]);

  const parsed = parseMidiFile(bytes, 'arrangement.mid');
  const [bass, melody, pad] = parsed.tracks;

  check(
    'track enumeration reports names, note counts and pitch ranges',
    parsed.tracks.length === 3
      && bass.name === 'Bass'   && bass.noteCount === 12
      && bass.lowestNote === 40 && bass.highestNote === 44
      && melody.name === 'Melody' && melody.noteCount === 16
      && melody.lowestNote === 72 && melody.highestNote === 79
      && pad.noteCount === 1,
    parsed.tracks.map((t) =>
      `${t.name}: ${t.noteCount} notes ${midiToNoteName(t.lowestNote)}–${midiToNoteName(t.highestNote)}`,
    ).join(' | '),
  );

  check(
    'the most melody-like track is pre-selected',
    mostMelodicTrack(parsed.tracks).name === 'Melody',
    `pre-selected ${mostMelodicTrack(parsed.tracks).name}`,
  );

  check(
    'merging every track produces every note',
    mergeTracks(parsed.tracks).length === 12 + 16 + 1,
    `${mergeTracks(parsed.tracks).length} notes merged`,
  );
}

/** A melody two octaves below the harp is a register problem, fixed for the whole piece. */
function octaveFold(): void {
  const low: MidiNote[] = [72, 74, 76, 77, 79].map((midi, i) => ({
    midi:       midi - 24,
    timeMs:     i * 400,
    durationMs: 300,
  }));

  const shift   = octaveShiftForMidiRange(low.map((n) => n.midi));
  const shifted = shiftMidiNotes(low, shift);
  const tabbed  = notesToTabs(shifted, 'C', 'diatonic', 'midiVelocity');

  check(
    'a melody two octaves low is folded back into the harp\'s range',
    shift === 24 && tabbed.every((n) => n.tab !== ''),
    `shift ${shift} semitones, tabs ${tabbed.map((n) => n.tab || '·').join(' ')}`,
  );

  const inRange = [72, 74, 76, 77, 79];
  check(
    'a melody already in range is left alone',
    octaveShiftForMidiRange(inRange) === 0,
    `shift ${octaveShiftForMidiRange(inRange)} semitones`,
  );
}

/** The decided policy: unplayable pitches survive as `tab: ''`, never dropped, never
 *  snapped to a neighbour. */
function unplayablePolicy(): void {
  // C#6 (85) and G#6 (92) have no position at all on a C diatonic harp — the layout table
  // has gaps there, unlike the accidentals covered by bends and overblows lower down.
  const pitches = [84, 85, 86, 91, 92, 93];
  const notes: MidiNote[] = pitches.map((midi, i) => ({ midi, timeMs: i * 400, durationMs: 300 }));
  const tabbed = notesToTabs(notes, 'C', 'diatonic', 'midiVelocity');

  const kept        = tabbed.length === pitches.length;
  const pitchesKept = tabbed.every((n, i) => n.note === midiToNoteName(pitches[i]));
  const blanks      = tabbed.filter((n) => !n.tab).map((n) => n.note);

  check(
    'unreachable pitches arrive as tab: \'\' with their pitch intact',
    kept && pitchesKept && blanks.length === 2 && blanks[0] === 'C#6' && blanks[1] === 'G#6',
    `${tabbed.length}/${pitches.length} notes kept, unplayable: ${blanks.join(', ') || 'none'}`,
  );

  check(
    'unreachable pitches are not snapped to a neighbouring hole',
    tabbed.every((n) => n.tab === '' || noteToTab(n.note, 'C', 'diatonic') === n.tab),
    'every non-blank tab is the note\'s own position',
  );

  // Timeline alignment is the other half of "never dropped" — the notes after a gap must
  // still sit where the file put them.
  check(
    'unplayable notes keep the timeline aligned',
    tabbed.every((n, i) => n.start_time === i * 400),
    tabbed.map((n) => n.start_time).join(', '),
  );
}

/** Key scoring is what turns "this note isn't reachable" into a one-tap change of harp. */
function keyScoring(): void {
  // A plain G major scale, G4–G5. On a G harp that's eight clean blows and draws; on a C
  // harp the same notes need a bend and an overblow, so the ranking should be decisive.
  // (Register matters here: an octave higher, holes 7–10 invert the bend layout and both
  // harps need a bend for the F#, which is a real tie rather than a scoring failure.)
  const scale = [67, 69, 71, 72, 74, 76, 78, 79];
  const notes: MidiNote[] = scale.map((midi, i) => ({
    midi,
    timeMs:     i * 400,
    durationMs: 300,
  }));

  const { ranked, unplayableByKey } = rankKeysForMidi(notes, 'diatonic', 0);
  check(
    'per-key scoring ranks the obvious key first',
    ranked[0].key === 'G',
    `${ranked.slice(0, 3).map((c) => `${c.key} ${c.score.toFixed(2)}`).join(' > ')}`,
  );
  check(
    'the winning key is reported as 1st position',
    ranked[0].position === 1 && ranked.find((c) => c.key === 'C')?.position === 2,
    `G = position ${ranked[0].position}, C = position ${ranked.find((c) => c.key === 'C')?.position}`,
  );
  check(
    'unplayable counts are reported per key',
    unplayableByKey.G === 0 && Object.keys(unplayableByKey).length === 12,
    `G: ${unplayableByKey.G} unplayable, worst key: ${
      Math.max(...Object.values(unplayableByKey))}`,
  );
}

/** Grace notes shorter than the detector's own floor are discarded, as they are for audio. */
function shortNoteFloor(): void {
  const ms = tickMs(120);
  const shortTicks = Math.floor((MIN_NOTE_MS - 20) / ms);
  const bytes = buildSmf([{
    name:  'Grace',
    notes: [
      { midi: 72, tick: 0,   durationTicks: 480 },
      { midi: 74, tick: 480, durationTicks: shortTicks },
      { midi: 76, tick: 960, durationTicks: 480 },
    ],
  }]);

  const parsed = parseMidiFile(bytes, 'grace.mid');
  const notes  = reduceToMonophonic(parsed.tracks[0].notes);
  check(
    'grace notes below the articulation floor are discarded',
    notes.length === 2 && notes.every((n) => n.durationMs >= MIN_NOTE_MS),
    `kept ${notes.map((n) => midiToNoteName(n.midi)).join(' ')}`,
  );
}

function main(): void {
  ownExportRoundTrip();
  chordFlattening();
  overlapHandling();
  tempoChange();
  percussionExclusion();
  trackEnumeration();
  octaveFold();
  unplayablePolicy();
  keyScoring();
  shortNoteFloor();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
