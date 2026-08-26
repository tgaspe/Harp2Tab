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
const GEN_INITIAL_FILTER_FC = 8;
const GEN_INITIAL_FILTER_Q = 9;
const GEN_PAN = 17;
const GEN_RELEASE_VOL_ENV = 38;
const GEN_INSTRUMENT = 41;
const GEN_KEY_RANGE = 43;
const GEN_VEL_RANGE = 44;
const GEN_INITIAL_ATTENUATION = 48;
const GEN_COARSE_TUNE = 51;
const GEN_FINE_TUNE = 52;
const GEN_SAMPLE_ID = 53;
const GEN_SAMPLE_MODES = 54;
const GEN_OVERRIDING_ROOT_KEY = 58;

/** SF2's default cutoff, in absolute cents. It works out to ~19,912 Hz — above hearing — so
 *  a zone at or above this is unfiltered and gets no BiquadFilterNode at all. Comparing
 *  against 19912 instead (the same default expressed in Hz) never omits anything and hangs
 *  an inaudible filter on every voice. */
const FILTER_FC_NONE_CENTS = 13500;

/** How far above a zone's own fundamental a cutoff has to sit to count as tone-shaping
 *  rather than muting — two octaves, so at least the first few harmonics survive.
 *
 *  This is the one number in the build that is a judgement rather than a conversion, and it
 *  is the knob to turn if the sampled set sounds wrong. Lower it (towards 1) to keep more of
 *  the soundfont's filtering and get a darker, duller set; raise it to drop more filters and
 *  get a brighter, more synthetic one. At 1 a zone whose cutoff sits exactly on its
 *  fundamental keeps a filter that removes every harmonic, which is audibly worse than
 *  having no filter at all. */
const FILTER_MIN_HARMONICS = 4;

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
  /** Already converted out of SF2's units — see `convertZone`. */
  tuneCents: number;
  gain: number;
  pan: number;
  filterHz?: number;
  filterQ?: number;
  releaseSec: number;
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

/** A zone's own generators over its level's global-zone defaults. */
function withDefaults(global: Map<number, Gen>, local: Map<number, Gen>): Map<number, Gen> {
  const merged = new Map(global);
  for (const [op, gen] of local) merged.set(op, gen);
  return merged;
}

/**
 * One generator's value, applying SF2's two-level rule: instrument-level generators are
 * *absolute*, and preset-level ones are *offsets added on top*. Getting this backwards (or
 * letting the preset overwrite rather than add) is how an instrument ends up at the right
 * pitch but the wrong volume, or vice versa.
 */
function genValue(
  inst: Map<number, Gen>,
  preset: Map<number, Gen>,
  op: number,
  fallback: number,
): number {
  const base = inst.get(op)?.amount ?? fallback;
  return base + (preset.get(op)?.amount ?? 0);
}

/**
 * The zone's low-pass, or nothing.
 *
 * Two ways a zone has no filter. The first is SF2's own: a cutoff at or above 13500 cents is
 * the default, meaning unfiltered.
 *
 * The second is a judgement this build makes, and it is worth understanding before changing
 * it. MuseScore General sets ONE `initialFilterFc` on an instrument's global zone covering
 * every register — the grand piano's is 6237 cents (300 Hz) for the whole keyboard. A real
 * SF2 synth sweeps that cutoff open with the modulation envelope (`modEnvToFilterFc`), which
 * appears in only 56 of this file's generator records; applying the cutoff *statically*, as a
 * plain BiquadFilter does, leaves B7 about 45 dB down — a silenced top octave rather than a
 * dark one.
 *
 * So: a cutoff below the zone's own root fundamental is not shaping the tone, it is removing
 * it, and the zone ships unfiltered. Above the fundamental it is a real timbre control and is
 * kept. This keeps the dark low register the author asked for and drops the filter exactly
 * where it would mute the note.
 */
function filterFor(
  filterCents: number,
  filterQCb: number,
  rootKey: number,
): { filterHz?: number; filterQ?: number } {
  if (filterCents >= FILTER_FC_NONE_CENTS) return {};
  const hz = 8.176 * 2 ** (filterCents / 1200);
  const fundamentalHz = 440 * 2 ** ((rootKey - 69) / 12);
  if (hz < fundamentalHz * FILTER_MIN_HARMONICS) return {};
  return { filterHz: hz, filterQ: 10 ** (filterQCb / 200) };
}

/** SF2 units → the units the browser wants. Each line is a place a wrong constant produces a
 *  plausible-sounding but wrong instrument, so each says what it is converting from. */
function convertZone(
  sample: SampleHeader,
  sampleIndex: number,
  inst: Map<number, Gen>,
  preset: Map<number, Gen>,
  keyRange: Gen | undefined,
  velRange: Gen | undefined,
): ResolvedZone {
  // Centibels of attenuation → a linear multiplier.
  const attenuationCb = genValue(inst, preset, GEN_INITIAL_ATTENUATION, 0);
  // Tenths of a percent, -500…500 → -1…1.
  const panTenths = genValue(inst, preset, GEN_PAN, 0);
  // Absolute cents → Hz.
  const filterCents = genValue(inst, preset, GEN_INITIAL_FILTER_FC, FILTER_FC_NONE_CENTS);
  const filterQCb = genValue(inst, preset, GEN_INITIAL_FILTER_Q, 0);
  // Timecents → seconds. -12000 tc (the SF2 default) is 1 ms.
  const releaseTimecents = genValue(inst, preset, GEN_RELEASE_VOL_ENV, -12000);
  const modes = genValue(inst, preset, GEN_SAMPLE_MODES, 0);

  return {
    sample,
    sampleIndex,
    loKey: keyRange?.lo ?? 0, hiKey: keyRange?.hi ?? 127,
    loVel: velRange?.lo ?? 0, hiVel: velRange?.hi ?? 127,
    rootKey: inst.get(GEN_OVERRIDING_ROOT_KEY)?.amount ?? sample.rootKey,
    // SF2 sampleModes: 1 and 3 loop, 0 and 2 do not.
    loops: modes === 1 || modes === 3,
    tuneCents: sample.correctionCents
      + genValue(inst, preset, GEN_FINE_TUNE, 0)
      + genValue(inst, preset, GEN_COARSE_TUNE, 0) * 100,
    gain: Math.min(1, 10 ** (-attenuationCb / 200)),
    pan: Math.max(-1, Math.min(1, panTenths / 500)),
    ...filterFor(filterCents, filterQCb, inst.get(GEN_OVERRIDING_ROOT_KEY)?.amount ?? sample.rootKey),
    releaseSec: Math.max(0.02, Math.min(4, 2 ** (releaseTimecents / 1200))),
  };
}

/** Every sample zone reachable from a preset, with every generator this phase reads already
 *  converted out of SF2's units. */
export function zonesForPreset(sf: Soundfont, presetIndex: number): ResolvedZone[] {
  const preset = sf.presets[presetIndex];
  const nextBag = presetIndex + 1 < sf.presets.length ? sf.presets[presetIndex + 1].bagIndex : sf.pbag.length;
  const zones: ResolvedZone[] = [];
  let presetGlobal = new Map<number, Gen>();

  for (let pb = preset.bagIndex; pb < nextBag; pb++) {
    const pgens = gensOfBag(sf.pgen, sf.pbag, pb);
    const instGen = pgens.get(GEN_INSTRUMENT);
    // A preset bag with no `instrument` generator is the preset's global zone: it carries
    // defaults for its siblings rather than naming an instrument of its own.
    if (!instGen) { presetGlobal = pgens; continue; }

    const presetGens = withDefaults(presetGlobal, pgens);
    const instrument = sf.instruments[instGen.amount];
    if (!instrument) continue;
    const instNext = instGen.amount + 1 < sf.instruments.length
      ? sf.instruments[instGen.amount + 1].bagIndex
      : sf.ibag.length;
    let instGlobal = new Map<number, Gen>();

    for (let ib = instrument.bagIndex; ib < instNext; ib++) {
      const igens = gensOfBag(sf.igen, sf.ibag, ib);
      if (!igens.has(GEN_SAMPLE_ID)) { instGlobal = igens; continue; }

      const instGens = withDefaults(instGlobal, igens);
      const sampleIndex = instGens.get(GEN_SAMPLE_ID)!.amount;
      const sample = sf.samples[sampleIndex];
      if (!sample) continue;

      zones.push(convertZone(
        sample, sampleIndex, instGens, presetGens,
        instGens.get(GEN_KEY_RANGE) ?? presetGens.get(GEN_KEY_RANGE),
        instGens.get(GEN_VEL_RANGE) ?? presetGens.get(GEN_VEL_RANGE),
      ));
    }
  }
  return zones;
}

// ── Stereo pairs, velocity layers, thinning ───────────────────────────────────

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
    // Pan is neutralised on a pair. SF2 stores the stereo image *as* pan — the (L) half
    // carries -500 and the (R) half +500 — and the scheduler already hard-pans the two
    // sources apart. Inheriting the (L) pan would then pan the summed voice hard left as
    // well, collapsing the whole note to one side. 67 of 68 stereo zones in this soundfont
    // carry a non-zero pan, so this is the common case, not the edge.
    out.push({ ...zone, right: zones[right].sample, pan: 0 });
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

const SOURCE = {
  soundfont: 'MuseScore General',
  version: '0.2.0',
  license: 'MIT. FluidR3 (c) 2000-02, 2008 Frank Wen; FluidR3Mono (c) 2014-17 Michael Cowgill; '
    + 'MuseScore_General adaptation (c) 2018-19 S. Christian Collins; Temple Blocks (c) 2002 '
    + 'Ethan Winer; Drumline Cymbals (c) 2016 Michael Schorsch. These acknowledgements must be '
    + 'included in any derivative work — see LICENSE.txt.',
};

interface WrittenZone {
  file: string; fileRight?: string;
  rootKey: number; loKey: number; hiKey: number; sampleRate: number;
  loopStartFrames?: number; loopEndFrames?: number;
  tuneCents: number; gain: number; pan: number;
  filterHz?: number; filterQ?: number; releaseSec: number;
  bytes: number; sha256: string; bytesRight?: number; sha256Right?: string;
  key?: number; drumName?: string;
}

/** Write a zone's audio and return its manifest entry. Files are named after the sample, so
 *  two zones sharing a sample share the file rather than duplicating it. */
function writeZone(sf: Soundfont, zone: ResolvedZone, outDir: string, written: Set<string>): WrittenZone {
  const emit = (sample: SampleHeader): { file: string; bytes: number; sha256: string } => {
    const ogg = extractOgg(sf, sample);
    const file = `${slugify(sample.name)}.ogg`;
    if (!written.has(file)) {
      fs.writeFileSync(path.join(outDir, file), ogg);
      written.add(file);
    }
    return { file, bytes: ogg.length, sha256: sha256(ogg) };
  };

  const left = emit(zone.sample);
  const right = zone.right ? emit(zone.right) : undefined;
  const loops = zone.loops && zone.sample.loopEnd > zone.sample.loopStart;

  return {
    file: left.file,
    ...(right ? { fileRight: right.file } : {}),
    rootKey: zone.rootKey,
    loKey: zone.loKey,
    hiKey: zone.hiKey,
    sampleRate: zone.sample.sampleRate,
    ...(loops ? { loopStartFrames: zone.sample.loopStart, loopEndFrames: zone.sample.loopEnd } : {}),
    tuneCents: zone.tuneCents,
    gain: Number(zone.gain.toFixed(4)),
    pan: Number(zone.pan.toFixed(3)),
    ...(zone.filterHz !== undefined
      ? { filterHz: Math.round(zone.filterHz), filterQ: Number((zone.filterQ ?? 1).toFixed(3)) }
      : {}),
    releaseSec: Number(zone.releaseSec.toFixed(3)),
    bytes: left.bytes,
    sha256: left.sha256,
    ...(right ? { bytesRight: right.bytes, sha256Right: right.sha256 } : {}),
  };
}

/** GM percussion key map, 35–81. Names come from the General MIDI spec rather than from the
 *  soundfont, because a kit's sample names describe the recording ("Kick Drum 3") while the
 *  manifest needs to say which GM slot it fills. */
const GM_DRUM_NAMES: Record<number, string> = {
  35: 'Acoustic Bass Drum', 36: 'Bass Drum 1', 37: 'Side Stick', 38: 'Acoustic Snare',
  39: 'Hand Clap', 40: 'Electric Snare', 41: 'Low Floor Tom', 42: 'Closed Hi Hat',
  43: 'High Floor Tom', 44: 'Pedal Hi Hat', 45: 'Low Tom', 46: 'Open Hi Hat',
  47: 'Low-Mid Tom', 48: 'Hi-Mid Tom', 49: 'Crash Cymbal 1', 50: 'High Tom',
  51: 'Ride Cymbal 1', 52: 'Chinese Cymbal', 53: 'Ride Bell', 54: 'Tambourine',
  55: 'Splash Cymbal', 56: 'Cowbell', 57: 'Crash Cymbal 2', 58: 'Vibraslap',
  59: 'Ride Cymbal 2', 60: 'Hi Bongo', 61: 'Low Bongo', 62: 'Mute Hi Conga',
  63: 'Open Hi Conga', 64: 'Low Conga', 65: 'High Timbale', 66: 'Low Timbale',
  67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas',
  71: 'Short Whistle', 72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro',
  75: 'Claves', 76: 'Hi Wood Block', 77: 'Low Wood Block', 78: 'Mute Cuica',
  79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle',
};

interface BuildResult { dir: string; name: string; zones: number; bytes: number; droppedLayers: number }

function buildInstrument(sf: Soundfont, presetIndex: number, outRoot: string): BuildResult {
  const preset = sf.presets[presetIndex];
  const all = zonesForPreset(sf, presetIndex);
  const zones = thinZones(all);
  if (zones.length === 0) throw new Error(`preset "${preset.name}" has no zones at velocity ${LAYER_VELOCITY}`);

  const dir = `${String(preset.program).padStart(3, '0')}-${slugify(preset.name)}`;
  const outDir = path.join(outRoot, dir);
  fs.mkdirSync(outDir, { recursive: true });

  const written = new Set<string>();
  const manifestZones = zones.map((zone) => writeZone(sf, zone, outDir, written));
  const manifest = { program: preset.program, name: preset.name, zones: manifestZones, source: SOURCE };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const bytes = manifestZones.reduce((sum, z) => sum + z.bytes + (z.bytesRight ?? 0), 0);
  const layers = new Set(all.map((z) => `${z.loVel}-${z.hiVel}`)).size;
  return { dir, name: preset.name, zones: manifestZones.length, bytes, droppedLayers: Math.max(0, layers - 1) };
}

/**
 * The GM standard kit (bank 128, program 0).
 *
 * Unlike a melodic instrument, a drum zone is *selected* by key rather than transposed by
 * it, so a zone spanning several keys becomes one entry per key rather than one entry with a
 * range. First zone wins on a collision — later zones in a kit are alternates.
 */
function buildDrumKit(sf: Soundfont, presetIndex: number, outRoot: string): BuildResult {
  const preset = sf.presets[presetIndex];
  const zones = pairStereo(
    zonesForPreset(sf, presetIndex).filter((z) => z.loVel <= LAYER_VELOCITY && LAYER_VELOCITY <= z.hiVel),
  );

  const outDir = path.join(outRoot, 'drums');
  fs.mkdirSync(outDir, { recursive: true });

  const written = new Set<string>();
  const byKey = new Map<number, WrittenZone>();
  for (const zone of zones) {
    for (let key = zone.loKey; key <= zone.hiKey; key++) {
      if (byKey.has(key)) continue;
      const entry = writeZone(sf, zone, outDir, written);
      // A drum is never transposed, so its root is its own key — otherwise `playbackRateFor`
      // would pitch-shift a snare to wherever the sample's recorded root happened to be.
      byKey.set(key, { ...entry, key, drumName: GM_DRUM_NAMES[key] ?? `Key ${key}`, rootKey: key, loKey: key, hiKey: key });
    }
  }

  const kitZones = [...byKey.values()].sort((a, b) => (a.key ?? 0) - (b.key ?? 0));
  const manifest = { name: preset.name, zones: kitZones, source: SOURCE };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const bytes = kitZones.reduce((sum, z) => sum + z.bytes + (z.bytesRight ?? 0), 0);
  return { dir: 'drums', name: preset.name, zones: kitZones.length, bytes, droppedLayers: 0 };
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Fails the build rather than warning. Every one of these is a defect that is silent at
 *  runtime: a gap plays as an oscillator, a bad checksum means the asset and the manifest
 *  disagree, and a missing licence is a shipping problem rather than an audio one. */
function validate(outRoot: string): string[] {
  const problems: string[] = [];
  const catalog = JSON.parse(fs.readFileSync(path.join(outRoot, 'catalog.json'), 'utf8'));

  for (let program = 0; program < 128; program++) {
    if (!catalog.instruments.some((e: { program: number }) => e.program === program)) {
      problems.push(`GM program ${program} is missing from the catalog`);
    }
  }
  if (!fs.existsSync(path.join(outRoot, 'LICENSE.txt'))) problems.push('LICENSE.txt is missing');

  const checkZones = (label: string, dir: string, zones: WrittenZone[], drums: boolean): void => {
    for (const zone of zones) {
      for (const [file, expectBytes, expectHash] of [
        [zone.file, zone.bytes, zone.sha256] as const,
        ...(zone.fileRight ? [[zone.fileRight, zone.bytesRight, zone.sha256Right] as const] : []),
      ]) {
        const full = path.join(dir, file);
        if (!fs.existsSync(full)) { problems.push(`${label}: ${file} does not exist`); continue; }
        const data = new Uint8Array(fs.readFileSync(full));
        if (String.fromCharCode(...data.subarray(0, 4)) !== 'OggS') problems.push(`${label}: ${file} is not an Ogg stream`);
        if (data.length !== expectBytes) problems.push(`${label}: ${file} is ${data.length} bytes, manifest says ${expectBytes}`);
        if (sha256(data) !== expectHash) problems.push(`${label}: ${file} checksum does not match the manifest`);
      }
      if (zone.loopStartFrames !== undefined && zone.loopEndFrames !== undefined
        && zone.loopEndFrames <= zone.loopStartFrames) {
        problems.push(`${label}: ${zone.file} has a loop that ends before it starts`);
      }
      if (drums && zone.loKey !== zone.hiKey) problems.push(`${label}: drum key ${zone.key} spans a range`);
    }
    if (drums) return;
    const sorted = [...zones].sort((a, b) => a.loKey - b.loKey);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].loKey !== sorted[i - 1].hiKey + 1) {
        problems.push(`${label}: key coverage breaks between ${sorted[i - 1].hiKey} and ${sorted[i].loKey}`);
      }
    }
  };

  for (const entry of catalog.instruments) {
    const dir = path.join(outRoot, entry.dir);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (!manifest.source?.license) problems.push(`${entry.dir}: manifest has no source.license`);
    if (!manifest.source?.version) problems.push(`${entry.dir}: manifest has no source.version`);
    checkZones(entry.dir, dir, manifest.zones, false);
  }

  const drumDir = path.join(outRoot, catalog.drums.dir);
  const kit = JSON.parse(fs.readFileSync(path.join(drumDir, 'manifest.json'), 'utf8'));
  checkZones('drums', drumDir, kit.zones, true);

  return problems;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function buildAll(sf: Soundfont, outRoot: string, licenseFile: string): void {
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
  fs.copyFileSync(licenseFile, path.join(outRoot, 'LICENSE.txt'));

  const instruments: BuildResult[] = [];
  for (let program = 0; program < 128; program++) {
    const index = sf.presets.findIndex((p) => p.bank === 0 && p.program === program);
    if (index === -1) throw new Error(`bank 0 has no program ${program} — the source is not a full GM set`);
    instruments.push(buildInstrument(sf, index, outRoot));
  }

  const drumIndex = sf.presets.findIndex((p) => p.bank === 128 && p.program === 0);
  if (drumIndex === -1) throw new Error('bank 128 has no program 0 — the source has no GM drum kit');
  const drums = buildDrumKit(sf, drumIndex, outRoot);

  const catalog = {
    version: SOURCE.version,
    instruments: instruments.map((r, program) => ({ program, name: r.name, dir: r.dir, bytes: r.bytes })),
    drums: { dir: drums.dir, bytes: drums.bytes },
  };
  fs.writeFileSync(path.join(outRoot, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

  const problems = validate(outRoot);
  writeReport(instruments, drums, problems);

  if (problems.length > 0) {
    console.error(`\n${problems.length} validation problems:`);
    for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }

  const total = instruments.reduce((sum, r) => sum + r.bytes, 0) + drums.bytes;
  console.log(`\n128 instruments + ${drums.zones}-key drum kit, ${(total / 1024 / 1024).toFixed(1)} MB, validation clean`);
}

function writeReport(instruments: BuildResult[], drums: BuildResult, problems: string[]): void {
  const total = instruments.reduce((sum, r) => sum + r.bytes, 0) + drums.bytes;
  const heaviest = [...instruments].sort((a, b) => b.bytes - a.bytes);
  const dropped = instruments.filter((r) => r.droppedLayers > 0);

  const lines = [
    '# Soundfont build report',
    '',
    `*Generated by \`scripts/build-soundfont.ts\` from the source pinned in [\`soundfont-source.md\`](soundfont-source.md).*`,
    '',
    `- **${instruments.length} melodic programs** + a **${drums.zones}-key drum kit**`,
    `- **${(total / 1024 / 1024).toFixed(1)} MB** total`,
    `- Validation: ${problems.length === 0 ? 'clean' : `**${problems.length} problems**`}`,
    '',
    '## Every program, heaviest first',
    '',
    '| Program | Name | Zones | Size | Velocity layers dropped |',
    '|---:|---|---:|---:|---:|',
    ...heaviest.map((r) =>
      `| ${r.dir.slice(0, 3)} | ${r.name} | ${r.zones} | ${(r.bytes / 1024).toFixed(0)} KB | ${r.droppedLayers} |`),
    `| — | ${drums.name} (drum kit) | ${drums.zones} | ${(drums.bytes / 1024).toFixed(0)} KB | 0 |`,
    '',
    '## Velocity layers',
    '',
    'This build keeps only the layer covering velocity ' + LAYER_VELOCITY + '; `velocityGain`',
    '(`timbre.ts:71`) shapes loudness at playback instead. Restoring a layer is a data change,',
    'not an investigation — these are the programs that had more than one:',
    '',
    ...(dropped.length === 0 ? ['None.'] : dropped
      .sort((a, b) => b.droppedLayers - a.droppedLayers)
      .map((r) => `- ${r.name} — ${r.droppedLayers} dropped`)),
    '',
  ];
  if (problems.length > 0) {
    lines.push('## Validation problems', '', ...problems.map((p) => `- ${p}`), '');
  }
  fs.writeFileSync('docs/plan/soundfont-build-report.md', lines.join('\n'));
}

function main(): void {
  const source = arg('--source');
  if (!source) {
    console.error('usage: --source <file.sf3> [--list-presets | --all --out <dir> --license <file>]');
    process.exitCode = 1;
    return;
  }
  const sf = readSoundfont(source);
  console.log(`${path.basename(source)}: ${sf.presets.length - 1} presets, ${sf.samples.length} samples`);

  if (process.argv.includes('--list-presets')) {
    for (let i = 0; i < sf.presets.length - 1; i++) {
      const p = sf.presets[i];
      console.log(`  bank ${String(p.bank).padStart(3)} program ${String(p.program).padStart(3)}  ${p.name.padEnd(24)} ${zonesForPreset(sf, i).length} zones`);
    }
    return;
  }

  const out = arg('--out');
  const license = arg('--license');
  if (process.argv.includes('--all') && out && license) {
    buildAll(sf, out, license);
    return;
  }

  console.error('nothing to do: pass --list-presets or --all --out <dir> --license <file>');
  process.exitCode = 1;
}

if (require.main === module) main();
