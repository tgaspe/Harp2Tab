/**
 * Generates a large multi-track project and prints the exact localStorage payload the
 * Studio's persisted store expects, so the perf spike measures the real render path
 * (store → deserialize → PianoRoll) rather than a synthetic component benchmark.
 *
 * Run: npx tsx scripts/make-perf-fixture.ts > /tmp/perf-project.json
 */

import { createProject, createTrack, serializeProject } from '../src/audio/midiProject';
import type { MidiNote } from '../src/types';

const TRACKS = 12;
const NOTES_PER_TRACK = 450;   // ~5,400 notes total
const NOTE_MS = 220;
const GAP_MS  = 40;

/** Spread across the register the way a real arrangement is — piccolo down to contrabass —
 *  so row culling is exercised rather than every track sitting in one octave. */
const TRACK_SPECS = [
  { name: 'Piccolo',     program: 72, base: 84 },
  { name: 'Flute',       program: 73, base: 79 },
  { name: 'Oboe',        program: 68, base: 74 },
  { name: 'Clarinet',    program: 71, base: 69 },
  { name: 'Trumpet',     program: 56, base: 67 },
  { name: 'Horn',        program: 60, base: 62 },
  { name: 'Trombone',    program: 57, base: 55 },
  { name: 'Violin I',    program: 40, base: 76 },
  { name: 'Violin II',   program: 40, base: 71 },
  { name: 'Viola',       program: 41, base: 64 },
  { name: 'Cello',       program: 42, base: 52 },
  { name: 'Contrabass',  program: 43, base: 40 },
];

const SCALE = [0, 2, 4, 5, 7, 9, 11];

function buildNotes(base: number, seed: number): MidiNote[] {
  const notes: MidiNote[] = [];
  let x = seed;
  for (let i = 0; i < NOTES_PER_TRACK; i++) {
    // Deterministic pseudo-random walk, so repeated runs measure the same content.
    x = (x * 1103515245 + 12345) % 2147483648;
    const degree = Math.floor((x / 2147483648) * SCALE.length);
    const octave = ((x >> 8) % 3) - 1;
    notes.push({
      midi:       base + SCALE[degree] + octave * 12,
      timeMs:     i * (NOTE_MS + GAP_MS),
      durationMs: NOTE_MS,
      velocity:   64 + ((x >> 16) % 48),
    });
  }
  return notes;
}

const project = createProject({
  title: 'Perf fixture — 12-track orchestral',
  tempos: [
    { timeMs: 0,      bpm: 120 },
    { timeMs: 40_000, bpm: 92 },   // a real tempo change, so the map is exercised too
    { timeMs: 80_000, bpm: 138 },
  ],
  timeSignatures: [
    { timeMs: 0,      numerator: 4, denominator: 4 },
    { timeMs: 60_000, numerator: 3, denominator: 4 },
  ],
  tracks: TRACK_SPECS.slice(0, TRACKS).map((spec, i) =>
    createTrack(i, { name: spec.name, program: spec.program, notes: buildNotes(spec.base, i + 1) }),
  ),
});

const stored = serializeProject(project);
const total = project.tracks.reduce((n, t) => n + t.notes.length, 0);

process.stderr.write(
  `${project.tracks.length} tracks, ${total} notes, ` +
  `${(stored.smf.length / 1024).toFixed(1)} KB of base64 SMF\n`,
);

// Exactly what zustand's persist middleware writes.
process.stdout.write(JSON.stringify({ state: { projects: [stored] }, version: 0 }));
