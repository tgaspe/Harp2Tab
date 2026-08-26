/**
 * Converts a pinned MuseScore_General.sf3 into the per-instrument sound packages the web
 * player reads (`src/audio/soundfont/`). Provenance, licence and the checksum this expects:
 * `docs/plan/soundfont-source.md`.
 *
 * The one thing to understand before changing this: in an .sf3 the `smpl` chunk holds
 * concatenated **Ogg Vorbis streams**, and `shdr`'s start/end are BYTE offsets into it —
 * whereas the loop offsets in the same record are frames of *decoded* audio. So extraction
 * is a byte-range slice with no re-encoding, and the two units must never be mixed. Both
 * facts are verified against the pinned file in `docs/plan/soundfont-source.md`.
 *
 * Phase 11-6 Task 3 scope: list presets, and extract one. The full generator table and all
 * 128 programs plus the drum kit are Task 6.
 *
 * Run: npx tsx scripts/build-soundfont.ts --source <file.sf3> --list-presets
 *      npx tsx scripts/build-soundfont.ts --source <file.sf3> --preset 0 --out public/soundfonts/<dir>
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── RIFF ──────────────────────────────────────────────────────────────────────

interface Chunk { id: string; start: number; length: number }

/** Walk a RIFF chunk list, returning every direct child of the range. LIST chunks report
 *  their four-byte form type as the id, which is what makes `sdta` and `pdta` findable. */
function readChunks(bytes: Uint8Array, start: number, end: number): Chunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    if (id === 'LIST' || id === 'RIFF') {
      const form = String.fromCharCode(...bytes.subarray(offset + 8, offset + 12));
      chunks.push({ id: form, start: offset + 12, length: length - 4 });
    } else {
      chunks.push({ id, start: offset + 8, length });
    }
    // Chunks are word-aligned: an odd length is followed by a pad byte.
    offset += 8 + length + (length % 2);
  }
  return chunks;
}

function name20(bytes: Uint8Array, offset: number): string {
  const raw = bytes.subarray(offset, offset + 20);
  const nul = raw.indexOf(0);
  return String.fromCharCode(...raw.subarray(0, nul === -1 ? 20 : nul)).trim();
}

// ── SF2 record tables ─────────────────────────────────────────────────────────

export interface SampleHeader {
  name: string;
  /** In sf3 these are BYTE offsets into `smpl` bounding one Ogg stream, not frame indices. */
  start: number;
  end: number;
  /** Frames of decoded audio, relative to the sample's own start. */
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  rootKey: number;
  correctionCents: number;
}

/** `shdr` is a flat array of 46-byte records terminated by one named "EOS". */
function readSampleHeaders(bytes: Uint8Array, chunk: Chunk): SampleHeader[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headers: SampleHeader[] = [];
  for (let offset = chunk.start; offset + 46 <= chunk.start + chunk.length; offset += 46) {
    const name = name20(bytes, offset);
    if (name === 'EOS') break;
    const start = view.getUint32(offset + 20, true);
    headers.push({
      name,
      start,
      end:             view.getUint32(offset + 24, true),
      loopStart:       view.getUint32(offset + 28, true) - start,
      loopEnd:         view.getUint32(offset + 32, true) - start,
      sampleRate:      view.getUint32(offset + 36, true),
      rootKey:         view.getUint8(offset + 40),
      correctionCents: view.getInt8(offset + 41),
    });
  }
  return headers;
}

interface Preset { name: string; program: number; bank: number; bagIndex: number }

/** `phdr` is 38-byte records, terminated by one named "EOP" whose bag index bounds the last
 *  real preset's zones. */
function readPresets(bytes: Uint8Array, chunk: Chunk): Preset[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const presets: Preset[] = [];
  for (let offset = chunk.start; offset + 38 <= chunk.start + chunk.length; offset += 38) {
    presets.push({
      name:     name20(bytes, offset),
      program:  view.getUint16(offset + 20, true),
      bank:     view.getUint16(offset + 22, true),
      bagIndex: view.getUint16(offset + 24, true),
    });
  }
  return presets;
}

interface Instrument { name: string; bagIndex: number }

/** `inst` is 22-byte records, terminated by one named "EOI". */
function readInstruments(bytes: Uint8Array, chunk: Chunk): Instrument[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const instruments: Instrument[] = [];
  for (let offset = chunk.start; offset + 22 <= chunk.start + chunk.length; offset += 22) {
    instruments.push({ name: name20(bytes, offset), bagIndex: view.getUint16(offset + 20, true) });
  }
  return instruments;
}

/** `pbag`/`ibag` are 4-byte records; only the generator index matters here (modulators are
 *  out of scope for this phase — see the plan). */
function readBags(bytes: Uint8Array, chunk: Chunk): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bags: number[] = [];
  for (let offset = chunk.start; offset + 4 <= chunk.start + chunk.length; offset += 4) {
    bags.push(view.getUint16(offset, true));
  }
  return bags;
}

interface Gen { op: number; amount: number; lo: number; hi: number }

/** `pgen`/`igen` are 4-byte records: a generator op and two bytes of amount, read three
 *  ways depending on the op (word, signed word, or a lo/hi byte range). */
function readGens(bytes: Uint8Array, chunk: Chunk): Gen[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gens: Gen[] = [];
  for (let offset = chunk.start; offset + 4 <= chunk.start + chunk.length; offset += 4) {
    gens.push({
      op:     view.getUint16(offset, true),
      amount: view.getInt16(offset + 2, true),
      lo:     view.getUint8(offset + 2),
      hi:     view.getUint8(offset + 3),
    });
  }
  return gens;
}

// The generators this phase reads. Everything else is deliberately ignored.
const GEN_KEY_RANGE = 43;
const GEN_VEL_RANGE = 44;
const GEN_INSTRUMENT = 41;
const GEN_SAMPLE_ID = 53;
const GEN_OVERRIDING_ROOT_KEY = 58;
const GEN_SAMPLE_MODES = 54;

export interface Soundfont {
  bytes: Uint8Array;
  smpl: Chunk;
  samples: SampleHeader[];
  presets: Preset[];
  instruments: Instrument[];
  pbag: number[]; pgen: Gen[];
  ibag: number[]; igen: Gen[];
}

export function readSoundfont(file: string): Soundfont {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const top = readChunks(bytes, 12, bytes.length);
  const find = (list: Chunk[], id: string): Chunk => {
    const chunk = list.find((c) => c.id === id);
    if (!chunk) throw new Error(`${file}: missing ${id} chunk — is this a SoundFont?`);
    return chunk;
  };
  const sdta = find(top, 'sdta');
  const pdta = find(top, 'pdta');
  const sdtaChunks = readChunks(bytes, sdta.start, sdta.start + sdta.length);
  const pdtaChunks = readChunks(bytes, pdta.start, pdta.start + pdta.length);

  return {
    bytes,
    smpl:        find(sdtaChunks, 'smpl'),
    samples:     readSampleHeaders(bytes, find(pdtaChunks, 'shdr')),
    presets:     readPresets(bytes, find(pdtaChunks, 'phdr')),
    instruments: readInstruments(bytes, find(pdtaChunks, 'inst')),
    pbag:        readBags(bytes, find(pdtaChunks, 'pbag')),
    pgen:        readGens(bytes, find(pdtaChunks, 'pgen')),
    ibag:        readBags(bytes, find(pdtaChunks, 'ibag')),
    igen:        readGens(bytes, find(pdtaChunks, 'igen')),
  };
}

// ── Preset → sample resolution ────────────────────────────────────────────────

export interface ResolvedZone {
  sample: SampleHeader;
  sampleIndex: number;
  /** The other half of an SF2 stereo pair, when `pairStereo` matched one. */
  right?: SampleHeader;
  loKey: number; hiKey: number;
  loVel: number; hiVel: number;
  rootKey: number;
  loops: boolean;
}

/** Read one bag's generator list into a lookup. A bag's generators run from its own index to
 *  the next bag's. */
function gensOfBag(gens: Gen[], bags: number[], bagIndex: number): Map<number, Gen> {
  const from = bags[bagIndex];
  const to = bagIndex + 1 < bags.length ? bags[bagIndex + 1] : gens.length;
  const map = new Map<number, Gen>();
  for (let i = from; i < to; i++) map.set(gens[i].op, gens[i]);
  return map;
}

/**
 * Every sample zone reachable from a preset, with the key and velocity ranges that select
 * it. Deliberately partial: this resolves *which sample plays for which key*, and leaves the
 * generators that shape its sound (filter, attenuation, pan, release, tuning) to Task 6 —
 * the split the plan draws between the one-instrument spike and the full conversion.
 */
export function zonesForPreset(sf: Soundfont, presetIndex: number): ResolvedZone[] {
  const preset = sf.presets[presetIndex];
  const nextBag = presetIndex + 1 < sf.presets.length ? sf.presets[presetIndex + 1].bagIndex : sf.pbag.length;
  const zones: ResolvedZone[] = [];

  for (let pb = preset.bagIndex; pb < nextBag; pb++) {
    const pgens = gensOfBag(sf.pgen, sf.pbag, pb);
    const instGen = pgens.get(GEN_INSTRUMENT);
    // A preset bag with no `instrument` generator is the preset's global zone: it carries
    // defaults for its siblings rather than naming an instrument of its own.
    if (!instGen) continue;

    const instrument = sf.instruments[instGen.amount];
    const instNext = instGen.amount + 1 < sf.instruments.length
      ? sf.instruments[instGen.amount + 1].bagIndex
      : sf.ibag.length;
    const presetKey = pgens.get(GEN_KEY_RANGE);
    const presetVel = pgens.get(GEN_VEL_RANGE);

    for (let ib = instrument.bagIndex; ib < instNext; ib++) {
      const igens = gensOfBag(sf.igen, sf.ibag, ib);
      const sampleGen = igens.get(GEN_SAMPLE_ID);
      if (!sampleGen) continue; // the instrument's own global zone

      const key = igens.get(GEN_KEY_RANGE) ?? presetKey;
      const vel = igens.get(GEN_VEL_RANGE) ?? presetVel;
      const sample = sf.samples[sampleGen.amount];
      if (!sample) continue;
      const modes = igens.get(GEN_SAMPLE_MODES)?.amount ?? 0;

      zones.push({
        sample,
        sampleIndex: sampleGen.amount,
        loKey: key?.lo ?? 0,   hiKey: key?.hi ?? 127,
        loVel: vel?.lo ?? 0,   hiVel: vel?.hi ?? 127,
        rootKey: igens.get(GEN_OVERRIDING_ROOT_KEY)?.amount ?? sample.rootKey,
        // SF2 sampleModes: 1 and 3 loop, 0 and 2 do not.
        loops: modes === 1 || modes === 3,
      });
    }
  }
  return zones;
}

// ── Extraction ────────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Slice one sample's Ogg stream straight out of `smpl`. No decode, no re-encode — the
 *  bytes written are byte-for-byte the bytes MuseScore shipped. */
export function extractOgg(sf: Soundfont, sample: SampleHeader): Uint8Array {
  const data = sf.bytes.subarray(sf.smpl.start + sample.start, sf.smpl.start + sample.end);
  if (String.fromCharCode(...data.subarray(0, 4)) !== 'OggS') {
    throw new Error(
      `Sample "${sample.name}" is not an Ogg stream. The source is probably an .sf2 (raw PCM) `
      + 'rather than an .sf3 — see docs/plan/soundfont-source.md for the file this expects.',
    );
  }
  return data;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** MuseScore General names the two halves of a stereo sample `Something (L)` and
 *  `Something (R)`, as two mono samples sharing one key range. */
const STEREO_SUFFIX = /\s*\((L|R)\)\s*$/i;

/**
 * Collapse SF2 stereo pairs into one zone carrying both files.
 *
 * Without this, a pair reads as two zones with *identical* key ranges, the thinning below
 * keeps whichever sorts first, and the instrument silently plays one channel of a stereo
 * recording — which sounds like a slightly wrong, slightly thin instrument rather than like
 * a bug. It hits the grand piano and every drum kit, so it is not an edge case.
 */
export function pairStereo(zones: ResolvedZone[]): ResolvedZone[] {
  const out: ResolvedZone[] = [];
  const takenRight = new Set<number>();

  for (const zone of zones) {
    const match = STEREO_SUFFIX.exec(zone.sample.name);
    if (!match || match[1].toUpperCase() !== 'L') continue;
    const stem = zone.sample.name.replace(STEREO_SUFFIX, '');
    const right = zones.findIndex((other) =>
      !takenRight.has(other.sampleIndex)
      && STEREO_SUFFIX.exec(other.sample.name)?.[1].toUpperCase() === 'R'
      && other.sample.name.replace(STEREO_SUFFIX, '') === stem
      && other.loKey === zone.loKey && other.hiKey === zone.hiKey);
    if (right === -1) continue;
    takenRight.add(zones[right].sampleIndex);
    out.push({ ...zone, right: zones[right].sample });
  }

  // A lone (L) with no matching (R) stays as an ordinary mono zone rather than being
  // dropped — better a half-stereo instrument than a hole in the keyboard.
  for (const zone of zones) {
    if (takenRight.has(zone.sampleIndex)) continue;
    if (out.some((o) => o.sampleIndex === zone.sampleIndex)) continue;
    out.push(zone);
  }
  return out;
}

/** The velocity a single-layer build is cut at. Where a preset splits zones by velocity we
 *  keep the layer covering this and drop the rest — see the plan's "One velocity layer for
 *  this phase". `velocityGain` (timbre.ts:71) still shapes loudness at playback. */
const LAYER_VELOCITY = 64;

/** Roughly a minor third between samples. Closer than this buys very little once
 *  `playbackRate` is doing the work, and the asset count is linear in it. */
const SEMITONES_PER_SAMPLE = 3;

/**
 * Velocity-filter, then thin, then close the gaps.
 *
 * The last step is the one that matters: after dropping zones the survivors no longer tile
 * the keyboard, and a key that falls in a hole resolves to null and silently plays as an
 * oscillator. So each kept zone is widened to meet the next one, and the outermost two are
 * widened to the ends of the original range.
 */
export function thinZones(zones: ResolvedZone[]): ResolvedZone[] {
  const layer = pairStereo(zones.filter((z) => z.loVel <= LAYER_VELOCITY && LAYER_VELOCITY <= z.hiVel));
  if (layer.length === 0) return [];

  const sorted = [...layer].sort((a, b) => a.loKey - b.loKey || a.hiKey - b.hiKey);
  const kept: ResolvedZone[] = [];
  for (const zone of sorted) {
    const last = kept[kept.length - 1];
    // Zones overlapping one already kept are duplicates of the same region at this
    // resolution; a zone far enough up the keyboard earns its own sample.
    if (!last || zone.loKey - last.loKey >= SEMITONES_PER_SAMPLE) kept.push({ ...zone });
  }

  const loEnd = Math.min(...sorted.map((z) => z.loKey));
  const hiEnd = Math.max(...sorted.map((z) => z.hiKey));
  for (let i = 0; i < kept.length; i++) {
    kept[i].loKey = i === 0 ? loEnd : kept[i].loKey;
    kept[i].hiKey = i === kept.length - 1 ? hiEnd : kept[i + 1].loKey - 1;
  }
  return kept;
}

function extractPreset(sf: Soundfont, presetIndex: number, outRoot: string): void {
  const preset = sf.presets[presetIndex];
  const zones = thinZones(zonesForPreset(sf, presetIndex));
  if (zones.length === 0) throw new Error(`preset "${preset.name}" has no zones at velocity ${LAYER_VELOCITY}`);

  const dir = `${String(preset.program).padStart(3, '0')}-${slugify(preset.name)}`;
  const outDir = path.join(outRoot, dir);
  fs.mkdirSync(outDir, { recursive: true });

  const manifestZones = zones.map((zone) => {
    const ogg = extractOgg(sf, zone.sample);
    const file = `${slugify(zone.sample.name)}.ogg`;
    fs.writeFileSync(path.join(outDir, file), ogg);

    let right: { fileRight: string; bytesRight: number; sha256Right: string } | undefined;
    if (zone.right) {
      const oggRight = extractOgg(sf, zone.right);
      const fileRight = `${slugify(zone.right.name)}.ogg`;
      fs.writeFileSync(path.join(outDir, fileRight), oggRight);
      right = { fileRight, bytesRight: oggRight.length, sha256Right: sha256(oggRight) };
    }

    return {
      file,
      ...(right ?? {}),
      rootKey: zone.rootKey,
      loKey: zone.loKey,
      hiKey: zone.hiKey,
      sampleRate: zone.sample.sampleRate,
      ...(zone.loops && zone.sample.loopEnd > zone.sample.loopStart
        ? { loopStartFrames: zone.sample.loopStart, loopEndFrames: zone.sample.loopEnd }
        : {}),
      tuneCents: zone.sample.correctionCents,
      // Task 3 defers the generators that shape the sound — initialAttenuation, pan,
      // releaseVolEnv and the low-pass filter are Task 6's generator table. These three
      // neutral values are what "hand-written manifest" means in the plan.
      gain: 1,
      pan: 0,
      releaseSec: 0.3,
      bytes: ogg.length,
      sha256: sha256(ogg),
    };
  });

  const manifest = {
    program: preset.program,
    name: preset.name,
    zones: manifestZones,
    source: {
      soundfont: 'MuseScore General',
      version: '0.2.0',
      license: 'MIT — see LICENSE.txt in this directory. The acknowledgements and copyright '
        + 'notices it carries must be included in any derivative work.',
    },
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const total = manifestZones.reduce((sum, z) => sum + z.bytes + (z.bytesRight ?? 0), 0);
  console.log(`  ${dir}: ${manifestZones.length} zones, ${(total / 1024).toFixed(0)} KB`);

  const catalog = {
    version: '0.2.0',
    instruments: [{ program: preset.program, name: preset.name, dir, bytes: total }],
    drums: { dir: 'drums', bytes: 0 },
  };
  fs.writeFileSync(path.join(outRoot, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
}

function main(): void {
  const source = arg('--source');
  if (!source) {
    console.error('usage: --source <file.sf3> [--list-presets | --bank B --program P --out <dir>]');
    process.exitCode = 1;
    return;
  }
  const sf = readSoundfont(source);
  console.log(`${path.basename(source)}: ${sf.presets.length - 1} presets, ${sf.samples.length} samples`);

  if (process.argv.includes('--list-presets')) {
    for (let i = 0; i < sf.presets.length - 1; i++) {
      const p = sf.presets[i];
      const zones = zonesForPreset(sf, i);
      console.log(`  bank ${String(p.bank).padStart(3)} program ${String(p.program).padStart(3)}  ${p.name.padEnd(24)} ${zones.length} zones`);
    }
    return;
  }

  const out = arg('--out');
  const bank = Number(arg('--bank') ?? 0);
  const program = arg('--program');
  if (out && program !== undefined) {
    const index = sf.presets.findIndex((p) => p.bank === bank && p.program === Number(program));
    if (index === -1) throw new Error(`no preset at bank ${bank} program ${program}`);
    extractPreset(sf, index, out);
    return;
  }

  console.error('nothing to do: pass --list-presets or --bank B --program P --out <dir>');
  process.exitCode = 1;
}

if (require.main === module) main();
