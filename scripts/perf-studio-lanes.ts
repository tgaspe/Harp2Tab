/**
 * Perf spike for the Studio's multi-track render path (Phase 11-4).
 *
 * Measures the work that actually scales with project size — deserializing a project, and
 * laying out the culled background lanes on every scroll frame — against a 12-track,
 * 5,400-note orchestral fixture. It does *not* measure React reconciliation or paint; what
 * it establishes is the budget available to them, and whether the culling design keeps the
 * per-frame block count bounded regardless of how big the project is.
 *
 * Run: npx tsx scripts/perf-studio-lanes.ts
 */

import { getChromaticRows } from '../src/audio/HarmonicaMapper';
import {
  createProject,
  createTrack,
  deserializeProject,
  serializeProject,
} from '../src/audio/midiProject';
import { layoutBackgroundLanes, trackToTabNotes } from '../src/audio/studioNotes';
import { audibleTracks } from '../src/audio/studioTracks';
import type { MidiNote } from '../src/types';

const ROW_HEIGHT = 28;           // must match PianoRoll's constant
const PX_PER_SECOND = 90;        // its DEFAULT_PX_PER_SECOND
const VIEWPORT_W = 1200;
const VIEWPORT_H = 700;
const CULL_MARGIN_MS = 2000;
const CULL_MARGIN_ROWS = 4;

const TRACK_SPECS = [
  { name: 'Piccolo', program: 72, base: 84 }, { name: 'Flute', program: 73, base: 79 },
  { name: 'Oboe', program: 68, base: 74 },    { name: 'Clarinet', program: 71, base: 69 },
  { name: 'Trumpet', program: 56, base: 67 }, { name: 'Horn', program: 60, base: 62 },
  { name: 'Trombone', program: 57, base: 55 },{ name: 'Violin I', program: 40, base: 76 },
  { name: 'Violin II', program: 40, base: 71 },{ name: 'Viola', program: 41, base: 64 },
  { name: 'Cello', program: 42, base: 52 },   { name: 'Contrabass', program: 43, base: 40 },
];
const NOTES_PER_TRACK = 450;
const SCALE = [0, 2, 4, 5, 7, 9, 11];

function buildNotes(base: number, seed: number): MidiNote[] {
  const notes: MidiNote[] = [];
  let x = seed;
  for (let i = 0; i < NOTES_PER_TRACK; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    notes.push({
      midi:       base + SCALE[Math.floor((x / 2147483648) * SCALE.length)] + (((x >> 8) % 3) - 1) * 12,
      timeMs:     i * 260,
      durationMs: 220,
      velocity:   64 + ((x >> 16) % 48),
    });
  }
  return notes;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const project = createProject({
  title: 'Perf fixture',
  tempos: [{ timeMs: 0, bpm: 120 }, { timeMs: 40_000, bpm: 92 }],
  timeSignatures: [{ timeMs: 0, numerator: 4, denominator: 4 }],
  tracks: TRACK_SPECS.map((spec, i) =>
    createTrack(i, { name: spec.name, program: spec.program, notes: buildNotes(spec.base, i + 1) }),
  ),
});

const totalNotes = project.tracks.reduce((n, t) => n + t.notes.length, 0);
const durationMs = project.durationMs;

console.log(`Fixture: ${project.tracks.length} tracks, ${totalNotes} notes, ${(durationMs / 1000).toFixed(0)}s\n`);

// ── Persistence round trip ────────────────────────────────────────────────────

const t0 = performance.now();
const stored = serializeProject(project);
const serializeMs = performance.now() - t0;

const t1 = performance.now();
deserializeProject(stored);
const deserializeMs = performance.now() - t1;

console.log('Persistence (once, on open/save)');
console.log(`  serialize      ${serializeMs.toFixed(1)}ms`);
console.log(`  deserialize    ${deserializeMs.toFixed(1)}ms`);
console.log(`  payload        ${(stored.smf.length / 1024).toFixed(1)} KB base64 SMF`);
console.log(`  vs raw JSON    ${(JSON.stringify(project.tracks).length / 1024).toFixed(1)} KB\n`);

// ── Per-scroll-frame layout ───────────────────────────────────────────────────

const rows = getChromaticRows();
const rowIndexByNote = new Map<string, number>();
rows.forEach((r, i) => rowIndexByNote.set(r.note, i));

// Editing the first track, so the other eleven are background lanes — the worst realistic
// case, and the one the design has to hold up under.
const selected = project.tracks[0];
const lanes = audibleTracks(project.tracks)
  .filter((t) => t.id !== selected.id)
  .map((t) => ({ id: t.id, color: t.color, notes: trackToTabNotes(t) }));

const laneNotes = lanes.reduce((n, l) => n + l.notes.length, 0);

const samples: number[] = [];
const blockCounts: number[] = [];

// Sweep the viewport across the whole piece and down the row ladder, the way scrolling
// actually moves through it.
for (let step = 0; step < 200; step++) {
  const scrollX = (step / 200) * ((durationMs / 1000) * PX_PER_SECOND);
  const scrollY = ((step * 37) % (rows.length * ROW_HEIGHT - VIEWPORT_H));

  const window = {
    visibleStartMs:  (scrollX / PX_PER_SECOND) * 1000 - CULL_MARGIN_MS,
    visibleEndMs:    ((scrollX + VIEWPORT_W) / PX_PER_SECOND) * 1000 + CULL_MARGIN_MS,
    firstVisibleRow: Math.max(0, Math.floor(scrollY / ROW_HEIGHT) - CULL_MARGIN_ROWS),
    lastVisibleRow:  Math.min(rows.length - 1, Math.ceil((scrollY + VIEWPORT_H) / ROW_HEIGHT) + CULL_MARGIN_ROWS),
    pxPerSecond:     PX_PER_SECOND,
    rowHeight:       ROW_HEIGHT,
  };

  const start = performance.now();
  const blocks = layoutBackgroundLanes(lanes, rowIndexByNote, window);
  samples.push(performance.now() - start);
  blockCounts.push(blocks.length);
}

console.log(`Background lane layout (every scroll frame, ${lanes.length} lanes / ${laneNotes} notes)`);
console.log(`  median         ${median(samples).toFixed(3)}ms`);
console.log(`  p95            ${percentile(samples, 0.95).toFixed(3)}ms`);
console.log(`  worst          ${Math.max(...samples).toFixed(3)}ms`);
console.log(`  blocks/frame   median ${median(blockCounts)}, worst ${Math.max(...blockCounts)}`);
console.log(`  budget         16.7ms per frame at 60fps\n`);

const worst = Math.max(...samples);
const worstBlocks = Math.max(...blockCounts);
const verdict = worst < 4 && worstBlocks < 600;
console.log(verdict
  ? `PASS  layout stays well inside frame budget and block count stays bounded`
  : `FAIL  worst ${worst.toFixed(2)}ms / ${worstBlocks} blocks — culling is not holding`);
if (!verdict) process.exitCode = 1;
