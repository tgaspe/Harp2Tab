/**
 * SPIKE — throwaway. Converts a JSON tab export into ABC notation so MelodyT5's
 * `%%segmentation` task can be tested against real harp2tab data.
 * See docs/plan/spike-melodyt5-segmentation.md. NOT production code.
 *
 * Run: npx tsx scripts/spike-tab-to-abc.ts <export.json> [--bpm N] [--key C] [--quiet]
 */

import { readFileSync } from 'node:fs';
import { detectTempo } from '../src/audio/detectTempo';
import { noteNameToMidi } from '../src/audio/HarmonicaMapper';
import type { TabNote } from '../src/types';

const BEATS_PER_BAR = 4;   // assumed 4/4
const BARS_PER_LINE = 4;

/**
 * Subdivisions of the beat the grid detector will consider. Straight values are emitted as a
 * standard `L:` unit with integer note lengths; a triplet win is reported but snapped to the
 * nearest straight grid, since `L:1/12` is not something the model has seen.
 */
const SUBDIVISIONS = [1, 2, 3, 4, 6, 8];
const STRAIGHT = new Set([1, 2, 4, 8]);

/** Concentration of values on a grid of spacing g: 1 = dead on the grid, ~0 = random. */
function concentration(values: readonly number[], g: number): number {
  if (values.length < 3 || g <= 0) return 0;
  let re = 0, im = 0;
  for (const v of values) {
    const a = (2 * Math.PI * (((v % g) + g) % g)) / g;
    re += Math.cos(a); im += Math.sin(a);
  }
  return Math.hypot(re, im) / values.length;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Which subdivision of the beat the performance is actually played on.
 *
 * Measured over sliding windows rather than the whole take: a live performance drifts, and a
 * global measurement collapses to noise even when every local passage is cleanly quantized
 * (on the reference ballad, windowing lifted the score from 0.12 to 0.52).
 *
 * Among grids that explain the data about equally well, the *coarsest* wins — every grid also
 * fits at half its spacing, and the finer harmonic is not the one the music is written on.
 */
function detectGrid(onsets: readonly number[], beatMs: number): {
  subdivision: number; score: number; spacing: number; ranked: { sub: number; score: number }[];
} {
  const WIN = 20000, STEP = 10000;
  const windows: number[][] = [];
  for (let t = onsets[0]; t < onsets[onsets.length - 1] - WIN / 2; t += STEP) {
    const w = onsets.filter((o) => o >= t && o < t + WIN);
    if (w.length >= 6) windows.push(w);
  }
  const pools = windows.length ? windows : [[...onsets]];

  /**
   * Best spacing near a nominal one. The tempo estimate is only ever close — on the reference
   * ballad it was 2% out, which is under half a grid unit per bar but more than a whole unit
   * across a 20-second window, and that is enough to destroy the measurement. So the spacing
   * is refined directly and the tempo is read back from it.
   */
  const refine = (nominal: number) => {
    let best = { g: nominal, score: -1 };
    for (let g = nominal * 0.94; g <= nominal * 1.06; g += nominal * 0.002) {
      const score = median(pools.map((w) => concentration(w, g)));
      if (score > best.score) best = { g, score };
    }
    return best;
  };

  const ranked = SUBDIVISIONS
    .map((sub) => { const { g, score } = refine(beatMs / sub); return { sub, score, spacing: g }; })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0].score;
  // Coarsest grid within reach of the best score, so we don't land on a finer harmonic.
  const coarsest = ranked.filter((r) => r.score >= best * 0.95).sort((a, b) => a.sub - b.sub)[0];
  return { subdivision: coarsest.sub, score: coarsest.score, spacing: coarsest.spacing, ranked };
}

// ── Key detection ─────────────────────────────────────────────────────────────
// The stored `key` field is the *harmonica's* key, not the tune's — a Bb harp played in
// second position sounds in F — so the key is inferred from pitch content instead.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Key name -> sharps (positive) or flats (negative) in its signature. */
const KEY_FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6,
  Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5,
  Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5, Ebm: -6,
};
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER  = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
/** Preferred minor spellings, so a flat-side minor isn't named with sharps. */
const MINOR_NAME: Record<number, string> = {
  9: 'Am', 4: 'Em', 11: 'Bm', 6: 'F#m', 1: 'C#m', 8: 'G#m',
  2: 'Dm', 7: 'Gm', 0: 'Cm', 5: 'Fm', 10: 'Bbm', 3: 'Ebm',
};
const MAJOR_NAME: Record<number, string> = {
  0: 'C', 7: 'G', 2: 'D', 9: 'A', 4: 'E', 11: 'B', 6: 'F#',
  5: 'F', 10: 'Bb', 3: 'Eb', 8: 'Ab', 1: 'Db',
};

function pearson(a: number[], b: number[]): number {
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function detectKey(weighted: number[]): { name: string; score: number; runnerUp: string } {
  const scored: { name: string; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      // Profile index 0 is the tonic, so rotate it onto the histogram's pitch classes.
      const base = minor ? MINOR : MAJOR;
      const rotated = new Array(12).fill(0).map((_, pc) => base[(pc - tonic + 12) % 12]);
      const name = minor ? MINOR_NAME[tonic] : MAJOR_NAME[tonic];
      if (!name) continue;
      scored.push({ name, score: pearson(weighted, rotated) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return { name: scored[0].name, score: scored[0].score, runnerUp: scored[1].name };
}

/** Letter -> alteration implied by the key signature. */
function signatureMap(key: string): Record<string, number> {
  const fifths = KEY_FIFTHS[key] ?? 0;
  const map: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => { map[l] = 1; });
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach((l) => { map[l] = -1; });
  return map;
}

const SPELL_SHARP: [string, number][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const SPELL_FLAT: [string, number][] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];

/** One tick is one `L:` unit, so every length is a plain integer. */
function lengthSuffix(ticks: number): string {
  return ticks === 1 ? '' : String(ticks);
}

function octaveMark(letter: string, octave: number): string {
  if (octave >= 5) return letter.toLowerCase() + "'".repeat(octave - 5);
  return letter + ','.repeat(Math.max(0, 4 - octave));
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const path = args[0];
  if (!path) { console.error('usage: spike-tab-to-abc.ts <export.json> [--bpm N] [--key C]'); process.exit(1); }
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const quiet = args.includes('--quiet');

  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const raw: TabNote[] = (parsed.notes ?? parsed.tracks?.[0]?.notes ?? []);
  const notes = [...raw].sort((a, b) => a.start_time - b.start_time);
  if (notes.length === 0) { console.error('no notes'); process.exit(1); }

  const est = detectTempo(notes);
  const bpm = Number(flag('--bpm') ?? est?.bpm ?? 100);
  const beatMs = 60000 / bpm;

  const onsets = notes.map((n) => n.start_time);
  const grid = flag('--grid')
    ? { subdivision: Number(flag('--grid')), score: NaN, spacing: beatMs / Number(flag('--grid')), ranked: [] as { sub: number; score: number }[] }
    : detectGrid(onsets, beatMs);
  // A triplet grid is reported but not emitted: `L:1/12` is outside anything the model was
  // trained on, so snap to the nearest straight subdivision and say so.
  const snapped = STRAIGHT.has(grid.subdivision)
    ? grid.subdivision
    : [1, 2, 4, 8].reduce((b, v) => (Math.abs(v - grid.subdivision) < Math.abs(b - grid.subdivision) ? v : b), 4);
  const TICKS_PER_BEAT = snapped;
  const BAR_TICKS = TICKS_PER_BEAT * BEATS_PER_BAR;
  const unitDenom = 4 * TICKS_PER_BEAT;
  // Quantize on the refined spacing, not the nominal one.
  const msPerTick = STRAIGHT.has(grid.subdivision) ? grid.spacing : beatMs / TICKS_PER_BEAT;
  const refinedBpm = 60000 / (msPerTick * TICKS_PER_BEAT);

  // Quantize onto the sixteenth grid, aligned to the detected downbeat.
  const offset = est?.offsetMs ?? 0;
  let events = notes.map((n) => {
    const midi = noteNameToMidi(n.note);
    return {
      midi,
      start: Math.round((n.start_time - offset) / msPerTick),
      len:   Math.max(1, Math.round(n.duration / msPerTick)),
    };
  }).filter((e) => e.midi !== null) as { midi: number; start: number; len: number }[];

  // Shift into the first bar, keeping any anacrusis where it falls within that bar.
  const shift = Math.floor(events[0].start / BAR_TICKS) * BAR_TICKS;
  events = events.map((e) => ({ ...e, start: e.start - shift }));

  /**
   * Close up the gap to the next onset, or leave a rest.
   *
   * A pitch detector reports a note ending when the sound decays, which is earlier than where
   * notation puts it: two adjacent quarter notes are written as two quarters, never as
   * quarter-rest-quarter. Left alone this puts a rest after nearly every note. A gap only
   * survives as a rest when it is big enough to be one — more than a grid unit, and more than
   * a third of the space between the two onsets.
   */
  for (let i = 0; i < events.length - 1; i++) {
    const span = events[i + 1].start - events[i].start;
    if (span <= 0) { events[i].len = 0; continue; }
    const gap = span - events[i].len;
    if (gap > 0 && gap <= Math.max(1, Math.round(span / 3))) events[i].len = span;
    if (events[i].len > span) events[i].len = span;
  }
  events = events.filter((e) => e.len > 0);

  const weighted = new Array(12).fill(0);
  for (const e of events) weighted[e.midi % 12] += e.len;
  const key = flag('--key') ?? detectKey(weighted).name;
  const detected = detectKey(weighted);
  const sig = signatureMap(key);
  const useFlats = (KEY_FIFTHS[key] ?? 0) < 0;
  const spell = useFlats ? SPELL_FLAT : SPELL_SHARP;

  // Emit.
  const out: string[] = [];
  let line: string[] = [];
  let bar: string[] = [];
  let acc: Record<string, number> = { ...sig };
  let tick = 0;

  const closeBar = () => {
    line.push(bar.join(' ') + ' |');
    bar = []; acc = { ...sig };
    if (line.length >= BARS_PER_LINE) { out.push(line.join(' ')); line = []; }
  };

  const emitSpan = (midi: number | null, start: number, len: number) => {
    let pos = start, remaining = len;
    while (remaining > 0) {
      const barEnd = (Math.floor(pos / BAR_TICKS) + 1) * BAR_TICKS;
      const chunk = Math.min(remaining, barEnd - pos);
      let token: string;
      if (midi === null) {
        token = 'z' + lengthSuffix(chunk);
      } else {
        const [letter, alter] = spell[midi % 12];
        const octave = Math.floor(midi / 12) - 1;
        let prefix = '';
        if (acc[letter] !== alter) {
          prefix = alter === 1 ? '^' : alter === -1 ? '_' : '=';
          acc[letter] = alter;
        }
        token = prefix + octaveMark(letter, octave) + lengthSuffix(chunk);
      }
      pos += chunk; remaining -= chunk;
      if (remaining > 0 && midi !== null) token += '-';
      bar.push(token);
      if (pos % BAR_TICKS === 0) closeBar();
    }
  };

  for (const e of events) {
    if (e.start > tick) emitSpan(null, tick, e.start - tick);
    emitSpan(e.midi, Math.max(tick, e.start), e.len);
    tick = Math.max(tick, e.start) + e.len;
  }
  if (bar.length) { const pad = BAR_TICKS - (tick % BAR_TICKS); if (pad % BAR_TICKS) emitSpan(null, tick, pad); }
  if (bar.length) closeBar();
  if (line.length) out.push(line.join(' '));

  const body = out.join(' \n').replace(/\|$/, '|]');

  if (!quiet) {
    console.error(`# file      ${path}`);
    console.error(`# notes     ${notes.length} (${events.length} pitched)`);
    console.error(`# harp key  ${parsed.key}   detected key  ${detected.name} (r=${detected.score.toFixed(2)}, runner-up ${detected.runnerUp})`);
    console.error(`# tempo     ${bpm} BPM${est ? ` (confidence ${est.confidence.toFixed(2)}, feel ${est.feel}, offset ${Math.round(offset)}ms)` : ' (no estimate — default)'}`);
    const rank = grid.ranked.map((r) => `1/${4 * r.sub}${STRAIGHT.has(r.sub) ? '' : 'T'}:${r.score.toFixed(2)}`).join('  ');
    console.error(`# refined   ${refinedBpm.toFixed(1)} BPM (tick ${msPerTick.toFixed(1)}ms)`);
    console.error(`# grid      1/${unitDenom} (beat/${TICKS_PER_BEAT}, score ${Number.isNaN(grid.score) ? 'forced' : grid.score.toFixed(2)})${snapped !== grid.subdivision ? ` [snapped from beat/${grid.subdivision}]` : ''}`);
    if (rank) console.error(`# grid fit  ${rank}`);
    console.error(`# abc chars ${body.length}`);
  }
  console.log(`L:1/${unitDenom}`);
  console.log('M:4/4');
  console.log(`K:${key}`);
  console.log(body);
}

main();
