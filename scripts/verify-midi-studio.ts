/**
 * Harness for the MIDI Studio foundations (Phase 11-1 / 11-2).
 *
 * Three layers, each checked against the one below:
 *  - the tempo/meter map, where the payoff is bar lines that stay glued to the music
 *    across a tempo change (what keeping only `tempos[0]` could never do);
 *  - SMF write/read, hand-written on the way out so the round trip isn't @tonejs/midi
 *    checking itself;
 *  - project serialization, including the sidecar carrying the per-track state SMF has
 *    nowhere to put.
 *
 * Run: npx tsx scripts/verify-midi-studio.ts
 */

import { base64ToBytes, bytesToBase64 } from '../src/audio/base64';
import {
  createProject,
  createTrack,
  deserializeProject,
  projectFromSmfBytes,
  serializeProject,
} from '../src/audio/midiProject';
import { getChromaticRows } from '../src/audio/HarmonicaMapper';
import { convertTrackToRecording, reconvertFromSource } from '../src/audio/convertTrack';
import {
  appendTabNote,
  applyTabNoteChange,
  removeTabNote,
  trackToTabNotes,
} from '../src/audio/studioNotes';
import { audibleTracks } from '../src/audio/studioTracks';
import { breathScaleFor, withBreathForce } from '../src/audio/breathForce';
import { voiceForProgram, velocityGain } from '../src/audio/timbre';
import type { TabNote } from '../src/types';
import { hasSmfHeader, readSmf, writeSmf } from '../src/audio/smf';
import {
  barToMs,
  beatToMs,
  compileTempoMap,
  constantTempoMap,
  gridLines,
  meterAt,
  msToBar,
  msToBarInMap,
  msToBeat,
  snapMsToGridInMap,
  bpmAt,
} from '../src/audio/tempo';

// ── Assertions ────────────────────────────────────────────────────────────────

interface CaseResult { name: string; passed: boolean; detail: string }

const results: CaseResult[] = [];

function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

// ── Tempo map ─────────────────────────────────────────────────────────────────

/** With one tempo and 4/4, the map must agree with the scalar API it generalises. */
function constantTempoMatchesScalar(): void {
  const map = constantTempoMap(120);
  const samples = [0, 250, 500, 1999, 2000, 7300];
  const worst = Math.max(...samples.map((ms) => Math.abs(msToBarInMap(map, ms) - msToBar(ms, 120))));

  check(
    'constant-tempo map agrees with the scalar msToBar',
    worst < 1e-9,
    `worst divergence ${worst.toExponential(2)} bars over ${samples.length} samples`,
  );
}

/**
 * The drift fix, stated as a test.
 *
 * 120 BPM for four bars (8000ms), then 60 BPM. Bars 1–4 are 2000ms each; bars 5 onward are
 * 4000ms. Bar 6 therefore begins at 12000ms — and a scalar 120 BPM reading, which is what
 * keeping only `tempos[0]` gave you, puts bar 6 at 10000ms instead.
 */
function tempoChangeKeepsBarsAligned(): void {
  const map = compileTempoMap(
    [{ timeMs: 0, bpm: 120 }, { timeMs: 8000, bpm: 60 }],
    [{ timeMs: 0, numerator: 4, denominator: 4 }],
  );

  const bar5 = msToBarInMap(map, 8000);
  const bar6 = msToBarInMap(map, 12000);
  const bar6Ms = barToMs(map, 6);

  check(
    'bar numbering survives a mid-piece tempo change',
    near(bar5, 5, 1e-9) && near(bar6, 6, 1e-9) && near(bar6Ms, 12000, 1e-6),
    `bar at 8000ms = ${bar5}, at 12000ms = ${bar6}, bar 6 starts at ${bar6Ms}ms`,
  );

  // The bug this replaces, asserted explicitly so the fix can't silently regress.
  const scalarBar6 = msToBar(12000, 120);
  check(
    'the scalar reading really would have drifted (regression guard)',
    Math.abs(scalarBar6 - 6) > 0.9,
    `scalar msToBar(12000, 120) = ${scalarBar6}, map = ${bar6}`,
  );

  check(
    'bpmAt reports the tempo in force on each side of the change',
    bpmAt(map, 0) === 120 && bpmAt(map, 7999) === 120 && bpmAt(map, 8000) === 60 && bpmAt(map, 20000) === 60,
    `${bpmAt(map, 7999)} before, ${bpmAt(map, 8000)} after`,
  );
}

/** ms ↔ beat must round-trip on both sides of a change, or every conversion built on
 *  them (snapping, grid lines, tick positions) inherits the error. */
function msBeatRoundTrip(): void {
  const map = compileTempoMap([
    { timeMs: 0,    bpm: 90 },
    { timeMs: 3000, bpm: 150 },
    { timeMs: 9000, bpm: 70 },
  ]);

  const samples = [0, 1234, 2999, 3000, 3001, 8999, 9000, 15000];
  const worst = Math.max(...samples.map((ms) => Math.abs(beatToMs(map, msToBeat(map, ms)) - ms)));

  check(
    'ms → beat → ms round-trips across multiple tempo changes',
    worst < 1e-6,
    `worst error ${worst.toExponential(2)}ms over ${samples.length} samples`,
  );
}

/** A 3/4 bar is three quarter notes, and 6/8 is three as well — the denominator is a note
 *  value, not a beat count. */
function timeSignatureBarLength(): void {
  const waltz = compileTempoMap(
    [{ timeMs: 0, bpm: 120 }],
    [{ timeMs: 0, numerator: 3, denominator: 4 }],
  );
  // 120 BPM → 500ms per quarter → 1500ms per 3/4 bar.
  const bar3 = msToBarInMap(waltz, 3000);

  const sixEight = compileTempoMap(
    [{ timeMs: 0, bpm: 120 }],
    [{ timeMs: 0, numerator: 6, denominator: 8 }],
  );
  const sixEightBar2 = msToBarInMap(sixEight, 1500);

  check(
    '3/4 and 6/8 bars are three quarter notes long',
    near(bar3, 3, 1e-9) && near(sixEightBar2, 2, 1e-9),
    `3/4: bar at 3000ms = ${bar3}; 6/8: bar at 1500ms = ${sixEightBar2}`,
  );
}

/** A meter change mid-piece shifts every bar after it. */
function meterChange(): void {
  const map = compileTempoMap(
    [{ timeMs: 0, bpm: 120 }],
    [
      { timeMs: 0,    numerator: 4, denominator: 4 }, // 2000ms bars
      { timeMs: 4000, numerator: 3, denominator: 4 }, // 1500ms bars, from bar 3
    ],
  );

  const bar3 = msToBarInMap(map, 4000);
  const bar4 = msToBarInMap(map, 5500);
  const meterLate = meterAt(map, 6000);

  check(
    'a meter change re-lengths every bar after it',
    near(bar3, 3, 1e-9) && near(bar4, 4, 1e-9) && meterLate.numerator === 3,
    `bar at 4000ms = ${bar3}, at 5500ms = ${bar4}, meter there = ${meterLate.numerator}/${meterLate.denominator}`,
  );
}

/** Snapping happens on the beat axis, so an eighth note is half a beat on both sides of a
 *  tempo change even though its length in ms differs. */
function snapAcrossTempoChange(): void {
  const map = compileTempoMap([{ timeMs: 0, bpm: 120 }, { timeMs: 4000, bpm: 60 }]);

  // Before: 120 BPM → beat 500ms → eighth 250ms. 1240ms should snap to 1250ms.
  const before = snapMsToGridInMap(map, 1240, 8);
  // After: 60 BPM → beat 1000ms → eighth 500ms. Bar starts at 4000; 4260 → 4500.
  const after = snapMsToGridInMap(map, 4260, 8);

  check(
    'snapping stays musical across a tempo change',
    near(before, 1250, 1e-6) && near(after, 4500, 1e-6),
    `1240ms → ${before}ms (120 BPM), 4260ms → ${after}ms (60 BPM)`,
  );

  check(
    'snap off is a no-op',
    snapMsToGridInMap(map, 1234.5, 'off') === 1234.5,
    'unchanged',
  );
}

/** Grid lines must land on real bar starts and carry the right subdivision count. */
function gridLineLayout(): void {
  const map = compileTempoMap(
    [{ timeMs: 0, bpm: 120 }],
    [{ timeMs: 0, numerator: 4, denominator: 4 }],
  );

  const lines = gridLines(map, 0, 4000, 8);
  const bars  = lines.filter((l) => l.isBar);
  const beats = lines.filter((l) => l.isBeat);

  // 0–4000ms at 120 BPM 4/4 = two full bars plus the line at 4000 itself.
  const barsAtRightMs = bars.every((l) => near(l.ms % 2000, 0, 1e-6));
  const barNumbers = bars.map((l) => l.bar);

  check(
    'grid bar lines land on bar starts and are numbered from 1',
    barsAtRightMs && barNumbers[0] === 1 && barNumbers[1] === 2,
    `${bars.length} bar lines at ${bars.map((l) => l.ms).join(', ')}ms, numbered ${barNumbers.join(', ')}`,
  );

  // Eighths at 120 BPM are 250ms, so 0–4000 inclusive is 17 lines, 9 of them beats.
  check(
    'eighth-note grid emits the right subdivision and beat counts',
    lines.length === 17 && beats.length === 9,
    `${lines.length} lines, ${beats.length} beats`,
  );

  const waltz = compileTempoMap(
    [{ timeMs: 0, bpm: 120 }],
    [{ timeMs: 0, numerator: 3, denominator: 4 }],
  );
  const waltzBars = gridLines(waltz, 0, 3000, 4).filter((l) => l.isBar);
  check(
    '3/4 grid puts bar lines every three beats',
    waltzBars.length === 3 && near(waltzBars[1].ms, 1500, 1e-6),
    `bars at ${waltzBars.map((l) => l.ms).join(', ')}ms`,
  );
}

// ── SMF ───────────────────────────────────────────────────────────────────────

function smfNoteRoundTrip(): void {
  const bytes = writeSmf(
    [
      {
        name:    'Melody',
        program: 73, // GM flute
        channel: 0,
        notes: [
          { midi: 60, timeMs: 0,    durationMs: 500, velocity: 100 },
          { midi: 64, timeMs: 500,  durationMs: 500, velocity: 80 },
          { midi: 67, timeMs: 1000, durationMs: 1000, velocity: 40 },
        ],
      },
      {
        name:    'Bass',
        program: 33,
        channel: 1,
        notes: [{ midi: 36, timeMs: 0, durationMs: 2000, velocity: 90 }],
      },
    ],
    [{ timeMs: 0, bpm: 120 }],
    [{ timeMs: 0, numerator: 4, denominator: 4 }],
  );

  check('writeSmf emits a valid SMF header', hasSmfHeader(bytes), `${bytes.length} bytes`);

  const read = readSmf(bytes);
  const melody = read.tracks[0];
  const bass   = read.tracks[1];

  check(
    'SMF round-trips track names, programs and channels',
    melody?.name === 'Melody' && melody?.program === 73 && melody?.channel === 0
      && bass?.name === 'Bass' && bass?.program === 33 && bass?.channel === 1,
    `${read.tracks.length} tracks: ${read.tracks.map((t) => `${t.name}/${t.program}/ch${t.channel}`).join(', ')}`,
  );

  // One tick is ~1.04ms at 120 BPM / PPQ 480, so a couple of ms is quantization.
  const TOLERANCE_MS = 3;
  const pitchesOk = melody.notes.map((n) => n.midi).join(',') === '60,64,67';
  const timingOk  = near(melody.notes[0].timeMs, 0, TOLERANCE_MS)
    && near(melody.notes[1].timeMs, 500, TOLERANCE_MS)
    && near(melody.notes[2].timeMs, 1000, TOLERANCE_MS)
    && near(melody.notes[2].durationMs, 1000, TOLERANCE_MS);

  check(
    'SMF round-trips note pitches and timings',
    pitchesOk && timingOk,
    `pitches ${melody.notes.map((n) => n.midi).join(',')}, starts ${melody.notes.map((n) => Math.round(n.timeMs)).join(',')}ms`,
  );

  // Velocity survives a 0–127 → 0–1 → 0–127 trip through @tonejs/midi's normalisation.
  const velocities = melody.notes.map((n) => n.velocity ?? -1);
  check(
    'SMF round-trips velocity on MIDI\'s 0–127 scale',
    velocities.every((v, i) => near(v, [100, 80, 40][i], 1)),
    `expected 100,80,40 — got ${velocities.join(',')}`,
  );
}

function smfTempoMapRoundTrip(): void {
  const bytes = writeSmf(
    [{ name: 'T', notes: [{ midi: 60, timeMs: 0, durationMs: 100 }] }],
    [{ timeMs: 0, bpm: 120 }, { timeMs: 8000, bpm: 60 }, { timeMs: 16000, bpm: 180 }],
    [{ timeMs: 0, numerator: 4, denominator: 4 }, { timeMs: 8000, numerator: 3, denominator: 4 }],
  );
  const read = readSmf(bytes);

  const bpms = read.tempos.map((t) => Math.round(t.bpm));
  const tempoTimesOk = near(read.tempos[0].timeMs, 0, 3)
    && near(read.tempos[1].timeMs, 8000, 3)
    && near(read.tempos[2].timeMs, 16000, 3);

  check(
    'SMF round-trips a full tempo map, not just the first entry',
    bpms.join(',') === '120,60,180' && tempoTimesOk,
    `${bpms.join(',')} at ${read.tempos.map((t) => Math.round(t.timeMs)).join(',')}ms`,
  );

  const sigs = read.timeSignatures.map((s) => `${s.numerator}/${s.denominator}`);
  check(
    'SMF round-trips the meter map',
    sigs.join(' ') === '4/4 3/4' && near(read.timeSignatures[1].timeMs, 8000, 3),
    `${sigs.join(' ')} at ${read.timeSignatures.map((s) => Math.round(s.timeMs)).join(',')}ms`,
  );
}

/** A note shorter than one tick must still exist on read-back rather than collapsing into
 *  a note-on and note-off at the same tick. */
function subTickNoteSurvives(): void {
  const bytes = writeSmf(
    [{ name: 'T', notes: [{ midi: 60, timeMs: 0, durationMs: 0.2 }] }],
    [{ timeMs: 0, bpm: 120 }],
  );
  const read = readSmf(bytes);

  check(
    'a sub-tick note survives the write/read round trip',
    read.tracks[0]?.notes.length === 1 && read.tracks[0].notes[0].durationMs > 0,
    `${read.tracks[0]?.notes.length ?? 0} note(s), duration ${read.tracks[0]?.notes[0]?.durationMs?.toFixed(2) ?? 'n/a'}ms`,
  );
}

function base64RoundTrip(): void {
  // Every byte value, plus lengths hitting each of base64's three padding cases.
  for (const length of [255, 256, 257]) {
    const original = new Uint8Array(length);
    for (let i = 0; i < length; i++) original[i] = i % 256;
    const restored = base64ToBytes(bytesToBase64(original));
    const identical = restored.length === original.length
      && original.every((b, i) => restored[i] === b);
    check(
      `base64 round-trips ${length} bytes exactly`,
      identical,
      identical ? 'byte-identical' : `length ${restored.length} vs ${original.length}`,
    );
  }
}

// ── Project serialization ─────────────────────────────────────────────────────

function projectRoundTrip(): void {
  const project = createProject({
    title:  'Test arrangement',
    tempos: [{ timeMs: 0, bpm: 100 }, { timeMs: 6000, bpm: 140 }],
    timeSignatures: [{ timeMs: 0, numerator: 4, denominator: 4 }],
    tracks: [
      createTrack(0, {
        name: 'Lead', program: 73, color: '#ABCDEF', muted: false, soloed: true,
        notes: [
          { midi: 72, timeMs: 0,   durationMs: 400, velocity: 110 },
          { midi: 74, timeMs: 400, durationMs: 400, velocity: 90 },
        ],
      }),
      createTrack(1, {
        name: 'Pad', program: 89, color: '#123456', muted: true, soloed: false,
        notes: [{ midi: 48, timeMs: 0, durationMs: 3000, velocity: 60 }],
      }),
    ],
  });

  const restored = deserializeProject(serializeProject(project));

  check(
    'project round-trips its identity and tempo map',
    restored.id === project.id
      && restored.title === project.title
      && restored.createdAt === project.createdAt
      && restored.tempos.length === 2
      && Math.round(restored.tempos[1].bpm) === 140,
    `${restored.tracks.length} tracks, tempos ${restored.tempos.map((t) => Math.round(t.bpm)).join(',')}`,
  );

  // The sidecar's whole reason for existing: SMF has nowhere to put any of these.
  const lead = restored.tracks[0];
  const pad  = restored.tracks[1];
  check(
    'project round-trips per-track state SMF cannot carry',
    lead.id === project.tracks[0].id && lead.color === '#ABCDEF' && lead.soloed === true
      && pad.id === project.tracks[1].id && pad.color === '#123456' && pad.muted === true,
    `lead ${lead.color}/solo=${lead.soloed}, pad ${pad.color}/mute=${pad.muted}`,
  );

  check(
    'project round-trips notes with velocity',
    lead.notes.length === 2
      && lead.notes[0].midi === 72
      && near(lead.notes[0].velocity ?? -1, 110, 1)
      && pad.notes[0].midi === 48,
    `lead ${lead.notes.length} notes, first velocity ${lead.notes[0]?.velocity}`,
  );
}

/** A missing sidecar must degrade to regenerated colours, not a failed open. */
function projectSurvivesMissingSidecar(): void {
  const project = createProject({
    tracks: [createTrack(0, { name: 'A', notes: [{ midi: 60, timeMs: 0, durationMs: 100 }] })],
  });
  const stored = serializeProject(project);
  const restored = deserializeProject({ ...stored, trackMeta: [] });

  check(
    'a project with a missing sidecar still opens',
    restored.tracks.length === 1 && restored.tracks[0].name === 'A' && !!restored.tracks[0].color,
    `recovered track "${restored.tracks[0]?.name}" with colour ${restored.tracks[0]?.color}`,
  );
}

/**
 * The Studio keeps every track, unlike `parseMidiFile`, which drops percussion and
 * note-less tracks for tab import. A save/load round trip must not be lossy.
 */
function studioKeepsEveryTrack(): void {
  const bytes = writeSmf(
    [
      { name: 'Melody', channel: 0, notes: [{ midi: 60, timeMs: 0, durationMs: 500 }] },
      { name: 'Drums',  channel: 9, notes: [{ midi: 38, timeMs: 0, durationMs: 100 }] },
      { name: 'Empty',  channel: 2, notes: [] },
    ],
    [{ timeMs: 0, bpm: 120 }],
  );

  const project = projectFromSmfBytes(bytes, 'kitchen sink');
  const names = project.tracks.map((t) => t.name);

  check(
    'the Studio keeps percussion and empty tracks that tab import drops',
    project.tracks.length === 3 && names.includes('Drums') && names.includes('Empty'),
    `${project.tracks.length} tracks: ${names.join(', ')}`,
  );

  check(
    'imported project takes its duration from the content',
    project.durationMs > 0,
    `${Math.round(project.durationMs)}ms`,
  );
}

/** Track ids must be stable across a save/load cycle — `sourceTrackId` on a converted tab
 *  is a dangling reference otherwise. */
function trackIdsAreStable(): void {
  const project = createProject({
    tracks: [
      createTrack(0, { name: 'One', notes: [{ midi: 60, timeMs: 0, durationMs: 100 }] }),
      createTrack(1, { name: 'Two', notes: [{ midi: 62, timeMs: 0, durationMs: 100 }] }),
    ],
  });

  const once  = deserializeProject(serializeProject(project));
  const twice = deserializeProject(serializeProject(once));

  check(
    'track ids survive repeated save/load cycles',
    twice.tracks.map((t) => t.id).join(',') === project.tracks.map((t) => t.id).join(','),
    `${project.tracks.map((t) => t.id).join(', ')}`,
  );
}

/** A default channel assignment must never land a melodic track on percussion. */
function noAccidentalPercussionChannel(): void {
  const tracks = Array.from({ length: 12 }, (_, i) => createTrack(i));
  const onNine = tracks.filter((t) => t.channel === 9);

  check(
    'default channel assignment skips the percussion channel',
    onNine.length === 0,
    `channels ${tracks.map((t) => t.channel).join(',')}`,
  );
}

// ── Row model ─────────────────────────────────────────────────────────────────

/** The Studio's ladder must be gapless, ordered like the harmonica one, and free of any
 *  harmonica meaning — the piano roll indexes rows positionally and reads `note`/`midi`,
 *  so those are the invariants that let one component serve both stages. */
function chromaticRowLadder(): void {
  const rows = getChromaticRows(60, 72);

  const descending = rows.every((r, i) => i === 0 || rows[i - 1].midi === r.midi + 1);
  check(
    'chromatic rows are gapless and ordered highest pitch first',
    rows.length === 13 && rows[0].midi === 72 && rows[12].midi === 60 && descending,
    `${rows.length} rows, ${rows[0]?.note} down to ${rows[rows.length - 1]?.note}`,
  );

  check(
    'every chromatic row is playable and carries no tab',
    rows.every((r) => r.playable && r.tab === ''),
    'no harmonica meaning attached',
  );

  // Note names are the join key the piano roll matches notes to rows by, so duplicates
  // would silently send two pitches to the same row.
  const unique = new Set(rows.map((r) => r.note));
  check(
    'chromatic row note names are unique',
    unique.size === rows.length,
    `${unique.size} distinct names for ${rows.length} rows`,
  );

  const full = getChromaticRows();
  check(
    'the default chromatic ladder spans the full MIDI range',
    full.length === 128 && full[0].midi === 127 && full[127].midi === 0,
    `${full.length} rows, ${full[0]?.note} down to ${full[127]?.note}`,
  );

  // Out-of-order and out-of-range arguments must clamp rather than produce a broken ladder.
  const clamped = getChromaticRows(-20, 200);
  check(
    'chromatic row bounds are clamped to the MIDI range',
    clamped.length === 128 && clamped[0].midi === 127,
    `${clamped.length} rows`,
  );
}

// ── Note adapter ──────────────────────────────────────────────────────────────

/** Positional identity has to survive a time edit, since that's the common case: a note
 *  dragged later keeps its slot because the array is never re-sorted. */
function noteIdentitySurvivesEdits(): void {
  const track = createTrack(0, {
    name: 'T',
    notes: [
      { midi: 60, timeMs: 0,    durationMs: 400 },
      { midi: 62, timeMs: 400,  durationMs: 400 },
      { midi: 64, timeMs: 800,  durationMs: 400 },
    ],
  });

  const adapted = trackToTabNotes(track);
  check(
    'track notes adapt to piano-roll notes with pitch names and no tab',
    adapted.length === 3 && adapted[0].note === 'C4' && adapted.every((n) => n.tab === ''),
    adapted.map((n) => n.note).join(' '),
  );

  // Move the *first* note past the last one. Its id must still address it.
  const movedId = adapted[0].id;
  const afterMove = applyTabNoteChange(track, movedId, { start_time: 5000 });
  const movedTrack = { ...track, notes: afterMove };
  const readBack = trackToTabNotes(movedTrack).find((n) => n.id === movedId);

  check(
    'a note keeps its id after being dragged past its neighbours',
    readBack?.start_time === 5000 && readBack?.note === 'C4' && afterMove.length === 3,
    `id ${movedId} now at ${readBack?.start_time}ms`,
  );

  const repitched = applyTabNoteChange(track, adapted[1].id, { note: 'F#5' });
  check(
    'a pitch edit maps the note name back to a MIDI number',
    repitched[1].midi === 78,
    `F#5 → ${repitched[1].midi}`,
  );

  // An unparseable name must leave the pitch alone rather than relocating the note.
  const bogus = applyTabNoteChange(track, adapted[1].id, { note: 'not-a-note' });
  check(
    'an unparseable pitch name leaves the note where it was',
    bogus === track.notes || bogus[1].midi === 62,
    `still ${bogus[1]?.midi}`,
  );

  const appended = appendTabNote(track, {
    tab: '', note: 'A4', start_time: 2000, duration: 250, confidence: 100,
  });
  check(
    'creating a note appends it, leaving existing ids valid',
    appended.length === 4 && appended[3].midi === 69
      && trackToTabNotes({ ...track, notes: appended })[0].id === adapted[0].id,
    `${appended.length} notes, new pitch ${appended[3]?.midi}`,
  );

  const removed = removeTabNote(track, adapted[1].id);
  check(
    'deleting a note removes exactly that note',
    removed.length === 2 && removed.map((n) => n.midi).join(',') === '60,64',
    removed.map((n) => n.midi).join(','),
  );

  // A stale id from another track must be inert rather than corrupting this one.
  const foreign = applyTabNoteChange(track, 'track-elsewhere#0', { start_time: 1 });
  check(
    'an id belonging to another track is ignored',
    foreign === track.notes,
    'unchanged',
  );
}

// ── Conversion boundary ───────────────────────────────────────────────────────

/** The Studio's whole point of contact with the harmonica: one track in, one tab out,
 *  with its own key and its own octave fit. */
function conversionProducesATab(): void {
  const project = createProject({
    title: 'Song',
    tempos: [{ timeMs: 0, bpm: 96 }],
    tracks: [
      createTrack(0, {
        name: 'Melody',
        // A plain C-major line, comfortably inside a harmonica's range.
        notes: [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({
          midi, timeMs: i * 400, durationMs: 350, velocity: 90,
        })),
      }),
      createTrack(1, { name: 'Silent', notes: [] }),
    ],
  });

  const result = convertTrackToRecording(project, project.tracks[0]);

  check(
    'converting a track produces a tab recording stamped with its source',
    !!result
      && result.recording.tabNotes.length === 8
      && result.recording.sourceProjectId === project.id
      && result.recording.sourceTrackId === project.tracks[0].id
      && result.recording.source === 'midiStudio',
    result
      ? `${result.recording.tabNotes.length} notes on a ${result.key} harp, ${result.unplayableCount} unplayable`
      : 'returned null',
  );

  check(
    'conversion takes the project\'s opening tempo',
    result?.recording.bpm === 96,
    `bpm ${result?.recording.bpm}`,
  );

  check(
    'velocity carries through conversion as breath force',
    result?.recording.tabNotes.every((n) => n.breathForce === 90) ?? false,
    `first note breathForce ${result?.recording.tabNotes[0]?.breathForce}`,
  );

  check(
    'a track with no notes converts to null rather than an empty tab',
    convertTrackToRecording(project, project.tracks[1]) === null,
    'null as expected',
  );
}

/**
 * The melody-handoff case that motivated the whole feature: two tracks in wildly different
 * registers must each get their *own* octave fit, not one shared compromise.
 */
function perTrackOctaveFit(): void {
  const project = createProject({
    title: 'Handoff',
    tracks: [
      createTrack(0, {
        name: 'Piccolo',
        notes: [96, 98, 100, 101, 103, 105].map((midi, i) => ({
          midi, timeMs: i * 400, durationMs: 350,
        })),
      }),
      createTrack(1, {
        name: 'Cello',
        notes: [36, 38, 40, 41, 43, 45].map((midi, i) => ({
          midi, timeMs: i * 400, durationMs: 350,
        })),
      }),
    ],
  });

  const high = convertTrackToRecording(project, project.tracks[0]);
  const low  = convertTrackToRecording(project, project.tracks[1]);

  check(
    'a high and a low track each get their own octave fit',
    !!high && !!low
      && high.octaveShiftSemitones !== low.octaveShiftSemitones
      && low.octaveShiftSemitones > 0
      && high.octaveShiftSemitones < 0,
    `piccolo ${high?.octaveShiftSemitones} semitones, cello ${low?.octaveShiftSemitones}`,
  );

  // Both must land somewhere playable — the point of fitting each separately.
  check(
    'both fitted tracks map to real harmonica positions',
    !!high && !!low
      && high.recording.tabNotes.some((n) => n.tab !== '')
      && low.recording.tabNotes.some((n) => n.tab !== ''),
    `piccolo ${high?.unplayableCount} unplayable, cello ${low?.unplayableCount} unplayable`,
  );
}

/** Re-convert replaces the tab in place; a dangling source is a state, not an error. */
function reconvertFromSourceCase(): void {
  const project = createProject({
    title: 'Song',
    tracks: [createTrack(0, {
      name: 'Melody',
      notes: [60, 62, 64, 65].map((midi, i) => ({ midi, timeMs: i * 400, durationMs: 350 })),
    })],
  });

  const first = convertTrackToRecording(project, project.tracks[0]);
  if (!first) { check('re-convert setup produced a tab', false, 'conversion returned null'); return; }

  const again = reconvertFromSource(first.recording, [project]);
  check(
    're-converting from source replaces the tab rather than duplicating it',
    again?.recording.id === first.recording.id
      && again?.recording.createdAt === first.recording.createdAt
      && again?.recording.tabNotes.length === first.recording.tabNotes.length,
    `same id ${again?.recording.id === first.recording.id}`,
  );

  check(
    're-converting a tab whose project is gone returns null',
    reconvertFromSource(first.recording, []) === null,
    'null as expected',
  );

  const handWritten = { ...first.recording, sourceProjectId: undefined, sourceTrackId: undefined };
  check(
    'a tab with no source cannot be re-converted',
    reconvertFromSource(handWritten, [project]) === null,
    'null as expected',
  );
}

/** Mute and solo have to resolve the same way for the panel and for playback. */
function soloMuteResolution(): void {
  const tracks = [
    createTrack(0, { name: 'A' }),
    createTrack(1, { name: 'B' }),
    createTrack(2, { name: 'C' }),
  ];

  check(
    'with nothing soloed, every unmuted track is audible',
    audibleTracks([tracks[0], { ...tracks[1], muted: true }, tracks[2]])
      .map((t) => t.name).join(',') === 'A,C',
    audibleTracks([tracks[0], { ...tracks[1], muted: true }, tracks[2]]).map((t) => t.name).join(','),
  );

  check(
    'one soloed track silences the others, and mute still wins over solo',
    audibleTracks([
      { ...tracks[0], soloed: true },
      tracks[1],
      { ...tracks[2], soloed: true, muted: true },
    ]).map((t) => t.name).join(',') === 'A',
    audibleTracks([
      { ...tracks[0], soloed: true },
      tracks[1],
      { ...tracks[2], soloed: true, muted: true },
    ]).map((t) => t.name).join(',') || '(none)',
  );
}

// ── Breath force + timbre ─────────────────────────────────────────────────────

/** Mic RMS is not breath force — it has to be normalised against the take's own range,
 *  or the lane shows how close the microphone was. */
function breathForceNormalisation(): void {
  // A crescendo: three notes at rising loudness, plus frames between them.
  const frames = [
    ...Array.from({ length: 10 }, (_, i) => ({ frequency: 440, rms: 0.02, t: i * 20 })),
    ...Array.from({ length: 10 }, (_, i) => ({ frequency: 440, rms: 0.10, t: 400 + i * 20 })),
    ...Array.from({ length: 10 }, (_, i) => ({ frequency: 440, rms: 0.20, t: 800 + i * 20 })),
  ];
  const notes: Omit<TabNote, 'id'>[] = [
    { tab: '4', note: 'C5', start_time: 0,   duration: 190, confidence: 100 },
    { tab: '5', note: 'E5', start_time: 400, duration: 190, confidence: 100 },
    { tab: '6', note: 'G5', start_time: 800, duration: 190, confidence: 100 },
  ];

  const annotated = withBreathForce(notes, frames);
  const forces = annotated.map((n) => n.breathForce ?? -1);

  check(
    'breath force rises with a crescendo and spans the take\'s range',
    forces[0] < forces[1] && forces[1] < forces[2] && forces[0] >= 0 && forces[2] <= 127,
    `${forces.join(' → ')}`,
  );

  // A recording at one constant level has no dynamics to report. Inventing a full range
  // from its noise floor would be worse than saying nothing.
  const flat = Array.from({ length: 30 }, (_, i) => ({ frequency: 440, rms: 0.1, t: i * 20 }));
  const flatAnnotated = withBreathForce(notes, flat);
  check(
    'a take with no dynamic variation is left unannotated rather than invented',
    !breathScaleFor(flat).usable && flatAnnotated.every((n) => n.breathForce === undefined),
    'no breath force assigned',
  );

  // Loudness is relative to the take, so doubling the gain on everything must not change
  // the reported dynamics — that's the whole point of normalising.
  const louder = frames.map((f) => ({ ...f, rms: f.rms * 4 }));
  const louderForces = withBreathForce(notes, louder).map((n) => n.breathForce ?? -1);
  check(
    'recording the same performance louder reports the same breath force',
    louderForces.join(',') === forces.join(','),
    `${forces.join(',')} vs ${louderForces.join(',')}`,
  );
}

/** Tracks have to be audibly distinguishable, which means different families getting
 *  genuinely different voices rather than all collapsing to one default. */
function timbreFamilies(): void {
  const programs = [0, 19, 26, 33, 42, 57, 66, 73];   // piano…pipe, one per family
  const voices = programs.map(voiceForProgram);
  const distinct = new Set(voices.map((v) => `${v.type}:${v.attackSec}:${v.sustainLevel}`));

  check(
    'GM families map to genuinely different voices',
    distinct.size >= 5,
    `${distinct.size} distinct voices across ${programs.length} families`,
  );

  check(
    'a struck instrument decays while a sustained one holds',
    voiceForProgram(0).sustainLevel < voiceForProgram(19).sustainLevel,
    `piano sustain ${voiceForProgram(0).sustainLevel}, organ ${voiceForProgram(19).sustainLevel}`,
  );

  check(
    'an unstated program falls back to the plain tone the tab editor has always used',
    voiceForProgram(undefined).type === 'sine' && velocityGain(undefined) === 1,
    'unchanged for tab sessions',
  );

  check(
    'velocity maps to gain monotonically across its range',
    velocityGain(0) === 0 && velocityGain(127) === 1 && velocityGain(64) < velocityGain(100),
    `0→${velocityGain(0)}, 64→${velocityGain(64).toFixed(2)}, 127→${velocityGain(127)}`,
  );
}

/**
 * Grid-line generation has to stay bounded by the *window*, not the piece.
 *
 * This is what makes the low end of the zoom range viable: at 3px/s a long project spans
 * thousands of bars, and generating every subdivision across all of them would cost a View
 * each for lines nobody can see.
 */
function gridLinesAreWindowed(): void {
  const map = compileTempoMap(
    [{ timeMs: 0, bpm: 120 }],
    [{ timeMs: 0, numerator: 4, denominator: 4 }],
  );

  const sevenMinutes = 7 * 60 * 1000;
  const whole = gridLines(map, 0, sevenMinutes, 16);
  // A ~4s viewport at the same resolution.
  const window = gridLines(map, 120_000, 124_000, 16);

  check(
    'windowed grid generation is bounded by the viewport, not the piece',
    window.length < 100 && whole.length > 50 * window.length,
    `${whole.length} lines for the whole piece vs ${window.length} for a 4s window`,
  );

  check(
    'a windowed request still reports absolute bar numbers',
    window.filter((l) => l.isBar).every((l) => (l.bar ?? 0) > 55),
    `first bar in window: ${window.find((l) => l.isBar)?.bar}`,
  );

  check(
    'an empty or inverted window yields nothing rather than throwing',
    gridLines(map, 5000, 5000, 8).length === 0 && gridLines(map, 9000, 1000, 8).length === 0,
    'no lines, as expected',
  );
}

function main(): void {
  constantTempoMatchesScalar();
  tempoChangeKeepsBarsAligned();
  msBeatRoundTrip();
  timeSignatureBarLength();
  meterChange();
  snapAcrossTempoChange();
  gridLineLayout();

  smfNoteRoundTrip();
  smfTempoMapRoundTrip();
  subTickNoteSurvives();
  base64RoundTrip();

  chromaticRowLadder();
  noteIdentitySurvivesEdits();
  conversionProducesATab();
  perTrackOctaveFit();
  reconvertFromSourceCase();
  soloMuteResolution();
  breathForceNormalisation();
  timbreFamilies();
  gridLinesAreWindowed();

  projectRoundTrip();
  projectSurvivesMissingSidecar();
  studioKeepsEveryTrack();
  trackIdsAreStable();
  noAccidentalPercussionChannel();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
