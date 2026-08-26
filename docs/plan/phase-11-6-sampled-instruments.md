# Phase 11-6 — Sampled instruments (MuseScore General)

*Part of the [Harp2Tab implementation plan](README.md). Unblocks the one open item in
[Phase 11](phase-11-midi-studio.md#11-6--control-lanes).*

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Studio's oscillator test tones with real MuseScore General samples on
web, for every GM program *and the drum kit*, loading only the instruments a project
actually uses and falling back silently to the existing oscillators whenever a sample
isn't there.

**Architecture:** An offline script converts a pinned `MuseScore_General.sf3` into
per-program manifests plus Ogg samples under `public/soundfonts/`. At runtime a pure
resolver maps (program, MIDI key) → (sample, playback rate); a web-only cache fetches and
decodes on demand; `Playback.web.ts` schedules `AudioBufferSourceNode` voices instead of
`OscillatorNode` ones when a sample is resolved, and the oscillator path stays exactly
where it is as the fallback. Native is explicitly out of scope for this phase and keeps
`synthesizeWav`.

**Tech Stack:** TypeScript, Web Audio (`AudioBufferSourceNode`, `BiquadFilterNode`,
`DynamicsCompressorNode`), `tsx` harnesses, Firebase Hosting.

**Spec:** [`phase-11-midi-studio.md`](phase-11-midi-studio.md) §11-6, plus the blocker
recorded at [`README.md:223`](README.md) — *"which soundfont (they carry real and differing
licences), and bundled vs. fetched on demand"*. This plan answers both.

---

## Global Constraints

- **Expo SDK 55.** Read `https://docs.expo.dev/versions/v55.0.0/` before writing any code
  that touches an Expo API (`AGENTS.md`).
- **There is no Jest or Vitest.** Tests are standalone `tsx` programs in `scripts/`, named
  `verify-*.ts`, printing a `PASS`/`FAIL` table and exiting non-zero on failure
  (`docs/testing.md`). Every new harness carries a docblock saying what it protects.
- **A `tsx` harness has no `AudioContext` and no `fetch` of local assets.** Anything that
  needs Web Audio is verified in the browser, not in the harness — the same split
  `docs/testing.md` already records for Basic Pitch. Design so the *decisions* are pure
  functions and only the *scheduling* needs a browser.
- **Web-first. Native may lose the feature in the port** — Phase 11's standing decision
  (`phase-11-midi-studio.md:62`). Do not downscope any web work because native can't match it.
- **Assets are same-origin.** `public/` is copied to `dist/` on export and served by
  Firebase Hosting. No CDN, no CSP change.
- **`git add .` before every commit.** Never stage individual files.
- Every user-visible string follows the copy already in `TrackList.tsx` — sentence case, no
  trailing period on a control label.

---

## What already exists (do not rebuild)

Measured against the code, not the roadmap.

- **`voiceForProgram(program)` and `velocityGain(velocity)`** (`src/audio/timbre.ts:47`,
  `:71`) — the GM-family → oscillator mapping. `timbre.ts:8` already says in so many words
  that this is *"what the SoundFont path (11-6) falls back to when samples aren't loaded."*
  It is the fallback. Do not change its behaviour.
- **`noteNameToMidi(name): number | null`** (`src/audio/HarmonicaMapper.ts:171`) and
  `midiToNoteName(midi)` (`:163`). `TabNote.note` is a pitch *name*; the resolver works in
  MIDI numbers. Use these, don't write a third converter.
- **The whole web scheduler** — `playNotes` (`src/native/Playback.web.ts:54`) with its seek
  handling, rate handling, ADSR clamping and metronome. This phase swaps the *voice*, not
  the schedule.
- **Mute and solo are already resolved before playback.** `studio.tsx:218` builds
  `audibleNotes` via `audibleTracks(tracks)`. There is nothing about mute/solo for this
  phase to preserve — `playNotes` never knew about them.
- **The loop region is implemented by re-calling `playNotes` per pass**
  (`useRollTransport.ts:156`), not by a `PlaybackOptions` field. So every loop pass
  re-creates every voice from scratch. That is a *cache-warmth test*, not a behaviour to
  preserve.
- **`useRollTransport` has exactly one `play()` call site** (`useRollTransport.ts:92`,
  *"One `play()` call site, so no rule can forget the loop region or the tempo map"*). That
  is where preloading goes, and it is why preloading needs one edit rather than five.
- **`firebase.json` already has the header pattern this needs** — `/models/**` gets
  `public, max-age=604800`. `public/models` is 900K and committed.

---

## Decisions taken

These are the corrections that came out of checking the first draft of this plan against
the code. Each one is a thing the obvious plan gets wrong.

### Transport rate must NOT multiply into `playbackRate`

The tempting sentence is *"use `playbackRate` for pitch transposition and transport
speed."* It is wrong. Today `options.rate` compresses **schedule times only** — the
oscillator's `frequency` is untouched (`Playback.web.ts:71-73`), so playing at 2× is
faster, not higher. Folding rate into an `AudioBufferSourceNode`'s `playbackRate` would
transpose the whole project up an octave at 2×. `playbackRate` carries pitch and tuning
only; rate stays exactly where it is, dividing the scheduled offsets.

### Drums are in scope, because sampling makes them worse than they are now

`midiProject.ts:145` deliberately keeps percussion tracks — *"a drum track is legitimate
context to see and hear."* But `studio.tsx:218` flattens every audible track into one flat
`TabNote[]`, and `TabNote` (`src/types/index.ts:37-70`) carries `program` and **no
channel**. Today a drum track plays as an undifferentiated wash of tones and nobody minds.
Under sampled playback every kick and hi-hat would become a convincing acoustic grand
piano — far more obviously wrong than the tones it replaces. So this phase adds a
percussion flag to `TabNote` and a GM drum-kit manifest keyed by note rather than
transposed by it. Task 5.

### `.sf3` sample data is already Ogg Vorbis — repackage, never re-encode

That is what the `3` means: the `smpl` chunk holds concatenated Ogg Vorbis streams instead
of 16-bit PCM. Extraction is a byte-range slice, not a transcode. Two consequences:
no generation loss, and — because Vorbis is lossy — **loop points are frame-approximate
after decode**. Sustained instruments may click at the loop seam. That is a listening
check (Task 4), not something the structural validator can catch.

### Loop points are stored in frames and used in seconds

`decodeAudioData` resamples to `ctx.sampleRate` (typically 48000) regardless of the
sample's own rate. `AudioBufferSourceNode.loopStart`/`loopEnd` are in **seconds**, so the
manifest stores the SF2 loop offsets in original frames *plus the original `sampleRate`*,
and the resolver divides. Store frames and divide by the decoded buffer's rate and every
loop is wrong by the ratio of the two rates.

### The manifest carries the low-pass filter, or the result sounds synthetic

SF2/SF3 zones carry `initialFilterFc`/`initialFilterQ`, and for a lot of MuseScore General
that filter is most of the timbre. Omit it and you will have done all of the sample work
and the result will still sound bright and wrong, in a way that is very hard to diagnose
after the assets are built. A per-voice `BiquadFilterNode` costs nothing. It is in the
manifest schema from Task 2.

### One velocity layer for this phase

Where a preset splits zones by velocity, take the layer covering velocity 64 and drop the
rest. It roughly halves the asset count, and `velocityGain` (`timbre.ts:71`) already shapes
loudness. Record the dropped layers in the build report so adding them later is a data
change, not an archaeology exercise.

### No streaming scheduler — preload the instruments, then play

`playNotes` schedules *every note of the piece* in one synchronous pass at
`ctx.currentTime` (`Playback.web.ts:54-110`). There is no lookahead scheduler, so "start
when the first window is ready and stream the rest" cannot be built without rewriting the
scheduler, and rewriting the scheduler would drag in pause (`ctx.suspend()`), seek, and the
loop restart. It is also unnecessary: what loads is *N instruments*, bounded by track count
(≤16 in practice), not a piece's worth of audio. Await the distinct programs before the
first note. Task 7.

### Failure is silent

The app currently always makes sound. A visible "using basic sound — tap to retry" banner
turns a working experience into a broken-looking one. A failed fetch or decode falls back
to `voiceForProgram` with no UI at all. The only place a failure is ever surfaced is an
instrument *preview*, where the user asked for that specific sound and silence would be
confusing.

### "Remove downloaded sounds" is dropped, not deferred

The source plan put a storage-settings control for deleting downloaded sounds under its
loading/storage UX. Bundling the assets removes the thing it managed: on web there is no
per-user download to delete, only ordinary HTTP cache the browser already owns a control
for. It comes back only if native ever downloads packages (see "Native"), and it belongs to
that milestone rather than this one.

### Bundled, versioned, same-origin

`public/soundfonts/musescore-general-<version>/`, copied into `dist/` on export, served
from the app's own origin under an immutable cache header. No CDN and therefore no CSP
question — which is half of the blocker at `README.md:224`, answered by doing the boring
thing. The generated assets are committed; the source `.sf3` is not (Task 1 pins it by
checksum). If Task 6's report puts the full set above 60 MB, ship the curated subset
instead and record the cut — see Task 6, Step 6.

---

## File structure

```
docs/plan/soundfont-source.md          Task 1 — provenance, licence, checksums, decisions

src/audio/soundfont/
  types.ts          Manifest/zone/catalog shapes. No logic, no I/O.
  resolver.ts       Pure: key → zone, zone → playback rate, drum key → zone. tsx-testable.
  sampleCache.web.ts  Fetch + decode + LRU + in-flight dedupe. Web only. Owns the AudioContext-
                      dependent half, so `resolver.ts` stays pure.
  index.ts          The three functions the rest of the app calls.

src/native/Playback.web.ts             Modified — sampled voice + oscillator fallback
src/types/index.ts                     Modified — TabNote.percussion
src/audio/midiProject.ts               Modified — set percussion from channel 9
src/audio/studioNotes.ts               Modified — carry percussion through the flatten
src/hooks/useRollTransport.ts          Modified — preload before play

scripts/
  build-soundfont.ts                   The converter + validator + report
  verify-soundfont.ts                  tsx harness for resolver.ts

public/soundfonts/musescore-general-<version>/
  catalog.json  LICENSE.txt  000-acoustic-grand-piano/{manifest.json,*.ogg}  …  drums/
```

---

## Task 1: Pin the source, settle the licence, and check for a prebuilt set

No code. This is the task that unblocks `README.md:223`, and it is also the hour that can
delete Task 6 entirely.

**Files:**
- Create: `docs/plan/soundfont-source.md`

**Interfaces:**
- Produces: the pinned version string used as the asset directory name
  (`musescore-general-<version>`), and the go/no-go on writing a converter at all.

- [ ] **Step 1: Download a specific release, never "latest"**

Get a named release of `MuseScore_General.sf3` from MuseScore's own distribution. Record
in `docs/plan/soundfont-source.md`: the exact URL, the release/version string, the file
size, and `shasum -a 256` of the file. Put the file somewhere outside the repo and note
where. It is not committed.

```bash
shasum -a 256 MuseScore_General.sf3
ls -l MuseScore_General.sf3
```

- [ ] **Step 2: Read the licence from the release, not from a wiki page**

MuseScore General is widely described as MIT. Do not take that from a summary. Find the
licence text that ships with the release you just pinned (or the licence file in its
repository at that tag), copy it verbatim into `docs/plan/soundfont-source.md`, and note
who holds the copyright and what attribution it requires. This is the one fact in the whole
phase worth checking at the source, because it is the thing that is expensive to be wrong
about after shipping.

- [ ] **Step 3: Timebox one hour on prebuilt sets**

Before writing a converter, check whether someone has already split a GM soundfont into
per-instrument web assets. Known candidates: `gleitz/midi-js-soundfonts` (ships FluidR3_GM —
MuseScore General's ancestor — pre-split per instrument as ogg and mp3) and `smplr`'s hosted
sets. For each, record in the doc: what it covers, whether it includes a drum kit, its
licence, its per-note or per-zone granularity, and its total size.

Decision rule, written down explicitly in the doc:
- If one covers all 128 programs *and* a drum kit under a licence you can ship, adopt it.
  **Task 6 collapses to "mirror it under `public/soundfonts/` and generate manifests for
  it"**, and Tasks 2, 3, 4, 5, 7, 8, 9 are unchanged.
- If none does, write down which requirement each one failed. Then build the converter.

Either way the hour is repaid: adopting one saves the largest task in the phase, and
rejecting them all means Task 6 is being written for a reason that is on the record.

- [ ] **Step 4: Record the asset-hosting decision**

Restate, in the doc, the answer to `README.md:224`: bundled under `public/soundfonts/`,
versioned directory name, same-origin, immutable cache header, generated assets committed
and source `.sf3` not. This is what closes the blocker note in the README.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "docs: pin the soundfont source, licence and hosting decision for 11-6"
```

---

## Task 2: The pure resolver

Everything that can be decided without an `AudioContext`, so it can be tested under `tsx`.

**Files:**
- Create: `src/audio/soundfont/types.ts`
- Create: `src/audio/soundfont/resolver.ts`
- Test: `scripts/verify-soundfont.ts`

**Interfaces:**
- Consumes: `noteNameToMidi` from `@/audio/HarmonicaMapper`.
- Produces:
  - `interface SampleZone`, `InstrumentManifest`, `DrumZone`, `DrumKitManifest`, `Catalog`
  - `zoneForKey(manifest: InstrumentManifest, midiKey: number): SampleZone | null`
  - `drumZoneForKey(kit: DrumKitManifest, midiKey: number): DrumZone | null`
  - `playbackRateFor(zone: SampleZone, midiKey: number): number`
  - `loopSecondsFor(zone: SampleZone): { start: number; end: number } | null`

- [ ] **Step 1: Write `types.ts`**

```ts
/**
 * The shapes `scripts/build-soundfont.ts` writes and the runtime reads. Deliberately flat
 * and free of behaviour: this file is the contract between an offline build and a browser,
 * so anything clever here becomes a version-skew bug later.
 */

/** One sample plus the SF2 generators that decide how it is played back. */
export interface SampleZone {
  /** File name, relative to the instrument's own directory. */
  file: string;
  /** MIDI key at which the sample plays untransposed. */
  rootKey: number;
  /** Inclusive key range this zone covers. */
  loKey: number;
  hiKey: number;
  /** The sample's ORIGINAL rate. `decodeAudioData` resamples to the context rate, so loop
   *  offsets below are only meaningful against this number — see `loopSecondsFor`. */
  sampleRate: number;
  /** SF2 loop offsets in original frames. Absent means the sample is one-shot (a struck
   *  instrument decaying to silence) rather than sustained. */
  loopStartFrames?: number;
  loopEndFrames?: number;
  /** Fine tuning, cents. Folded into the playback rate. */
  tuneCents: number;
  /** Linear gain multiplier for this zone, so families sit together in a mix. */
  gain: number;
  /** -1 (hard left) … 1 (hard right). */
  pan: number;
  /** SF2 `initialFilterFc` in Hz. Absent means the zone is unfiltered. Omitting this at
   *  playback is what makes a sampled GM set sound synthetic — see "Decisions taken". */
  filterHz?: number;
  filterQ?: number;
  /** Volume-envelope release, seconds. Attack and decay are already in the audio. */
  releaseSec: number;
  bytes: number;
  sha256: string;
}

export interface InstrumentManifest {
  /** GM program, 0–127. */
  program: number;
  name: string;
  zones: SampleZone[];
  source: { soundfont: string; version: string; license: string };
}

/** A drum zone is selected by key rather than transposed by it, so it pins its own key and
 *  the name of the sound sitting there in the GM percussion map. */
export interface DrumZone extends SampleZone {
  key: number;
  drumName: string;
}

export interface DrumKitManifest {
  name: string;
  zones: DrumZone[];
  source: { soundfont: string; version: string; license: string };
}

export interface CatalogEntry {
  program: number;
  name: string;
  /** Directory name under the catalog's own directory, e.g. `000-acoustic-grand-piano`. */
  dir: string;
  bytes: number;
}

export interface Catalog {
  /** Pinned soundfont version. Also the asset directory name, so a new build can never mix
   *  old manifests with new samples. */
  version: string;
  instruments: CatalogEntry[];
  drums: { dir: string; bytes: number };
}
```

- [ ] **Step 2: Write the failing harness**

Create `scripts/verify-soundfont.ts` in the idiom of `scripts/verify-midi-studio.ts` — a
`check(name, passed, detail)` collector, a `PASS`/`FAIL` table, non-zero exit on failure.

```ts
/**
 * Harness for the sampled-instrument resolver (Phase 11-6).
 *
 * Everything here is deliberately pure: `tsx` has no `AudioContext`, so the split in this
 * phase is that all the *decisions* (which sample, what rate, where the loop is) live in
 * `resolver.ts` and are checked here, while only the *scheduling* needs a browser. The
 * cases that matter most are the boundary ones — a key exactly on a zone edge, and the
 * loop-offset conversion, which is silently wrong by the ratio of two sample rates if you
 * divide by the decoded buffer's rate instead of the sample's own.
 *
 * Run: npx tsx scripts/verify-soundfont.ts
 */

import {
  drumZoneForKey,
  loopSecondsFor,
  playbackRateFor,
  zoneForKey,
} from '../src/audio/soundfont/resolver';
import type { DrumKitManifest, InstrumentManifest, SampleZone } from '../src/audio/soundfont/types';

interface CaseResult { name: string; passed: boolean; detail: string }
const results: CaseResult[] = [];
function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}
function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

const SOURCE = { soundfont: 'MuseScore General', version: 'test', license: 'MIT' };

function zone(partial: Partial<SampleZone>): SampleZone {
  return {
    file: 'c4.ogg', rootKey: 60, loKey: 0, hiKey: 127, sampleRate: 44100,
    tuneCents: 0, gain: 1, pan: 0, releaseSec: 0.1, bytes: 1, sha256: '', ...partial,
  };
}

const piano: InstrumentManifest = {
  program: 0, name: 'Acoustic Grand Piano', source: SOURCE,
  zones: [
    zone({ file: 'c2.ogg', rootKey: 36, loKey: 0,  hiKey: 47 }),
    zone({ file: 'c4.ogg', rootKey: 60, loKey: 48, hiKey: 71 }),
    zone({ file: 'c6.ogg', rootKey: 84, loKey: 72, hiKey: 127 }),
  ],
};

function zonesSplitByRange(): void {
  check('zone: middle of a range', zoneForKey(piano, 60)?.file === 'c4.ogg', 'key 60 → c4');
  check('zone: low range',        zoneForKey(piano, 24)?.file === 'c2.ogg', 'key 24 → c2');
  check('zone: high range',       zoneForKey(piano, 100)?.file === 'c6.ogg', 'key 100 → c6');
}

function zoneBoundariesAreInclusive(): void {
  // The off-by-one that a "sounds fine" listening test never catches: one key either side
  // of a zone edge must land in different zones, and both edges are inclusive.
  check('zone: hiKey is inclusive', zoneForKey(piano, 47)?.file === 'c2.ogg', 'key 47 → c2');
  check('zone: loKey is inclusive', zoneForKey(piano, 48)?.file === 'c4.ogg', 'key 48 → c4');
  check('zone: upper edge',         zoneForKey(piano, 71)?.file === 'c4.ogg', 'key 71 → c4');
  check('zone: next zone starts',   zoneForKey(piano, 72)?.file === 'c6.ogg', 'key 72 → c6');
}

function keyOutsideEveryZone(): void {
  const narrow: InstrumentManifest = {
    program: 1, name: 'Narrow', source: SOURCE,
    zones: [zone({ loKey: 60, hiKey: 62 })],
  };
  check('zone: no cover → null', zoneForKey(narrow, 30) === null, 'key 30 has no zone');
}

function playbackRateBySemitoneAndOctave(): void {
  const z = zone({ rootKey: 60 });
  check('rate: root plays untransposed', near(playbackRateFor(z, 60), 1, 1e-9), '60 → 1.0');
  check('rate: octave up is 2×',         near(playbackRateFor(z, 72), 2, 1e-9), '72 → 2.0');
  check('rate: octave down is 0.5×',     near(playbackRateFor(z, 48), 0.5, 1e-9), '48 → 0.5');
  check('rate: one semitone up',         near(playbackRateFor(z, 61), 1.059463, 1e-6), '61 → 2^(1/12)');
}

function tuningFoldsIntoRate(): void {
  const sharp = zone({ rootKey: 60, tuneCents: 100 });
  check('rate: +100 cents equals a semitone',
    near(playbackRateFor(sharp, 60), playbackRateFor(zone({ rootKey: 60 }), 61), 1e-9),
    '100 cents == 1 semitone');
}

function loopOffsetsUseTheSamplesOwnRate(): void {
  // The bug this exists to catch: dividing by the decoded buffer's rate (48000) instead of
  // the sample's own (44100) shortens every loop by ~8%, which reads as a subtly wrong
  // pitch-stable wobble rather than as an obvious defect.
  const looped = zone({ sampleRate: 44100, loopStartFrames: 44100, loopEndFrames: 88200 });
  const loop = loopSecondsFor(looped);
  check('loop: start in seconds', loop !== null && near(loop.start, 1, 1e-9), '44100 frames @44.1k → 1.0s');
  check('loop: end in seconds',   loop !== null && near(loop.end, 2, 1e-9),   '88200 frames @44.1k → 2.0s');
  check('loop: one-shot has none', loopSecondsFor(zone({})) === null, 'no loop frames → null');
}

function drumsAreSelectedNotTransposed(): void {
  const kit: DrumKitManifest = {
    name: 'Standard Kit', source: SOURCE,
    zones: [
      { ...zone({ file: 'kick.ogg', rootKey: 36 }), key: 36, drumName: 'Bass Drum 1' },
      { ...zone({ file: 'snare.ogg', rootKey: 38 }), key: 38, drumName: 'Acoustic Snare' },
    ],
  };
  check('drums: key 36 is the kick',  drumZoneForKey(kit, 36)?.file === 'kick.ogg', '36 → kick');
  check('drums: key 38 is the snare', drumZoneForKey(kit, 38)?.file === 'snare.ogg', '38 → snare');
  check('drums: unmapped key is silent', drumZoneForKey(kit, 21) === null, '21 → null');
  const kick = drumZoneForKey(kit, 36)!;
  check('drums: never transposed', near(playbackRateFor(kick, kick.key), 1, 1e-9), 'kick plays at 1.0');
}

function main(): void {
  zonesSplitByRange();
  zoneBoundariesAreInclusive();
  keyOutsideEveryZone();
  playbackRateBySemitoneAndOctave();
  tuningFoldsIntoRate();
  loopOffsetsUseTheSamplesOwnRate();
  drumsAreSelectedNotTransposed();

  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main();
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx tsx scripts/verify-soundfont.ts
```

Expected: a module-resolution failure — `Cannot find module '../src/audio/soundfont/resolver'`.

- [ ] **Step 4: Write `resolver.ts`**

```ts
/**
 * Pure sample selection. No fetch, no decode, no AudioContext — that is
 * `sampleCache.web.ts`'s job, and keeping the split means every decision in this file is
 * checkable under `tsx` (`scripts/verify-soundfont.ts`) where nothing about Web Audio is.
 */

import type { DrumKitManifest, DrumZone, InstrumentManifest, SampleZone } from './types';

/** The zone covering `midiKey`, or null when the instrument doesn't reach that far — in
 *  which case the caller falls back to an oscillator rather than stretching a sample two
 *  octaves and producing a chipmunk. */
export function zoneForKey(manifest: InstrumentManifest, midiKey: number): SampleZone | null {
  for (const zone of manifest.zones) {
    if (midiKey >= zone.loKey && midiKey <= zone.hiKey) return zone;
  }
  return null;
}

/** GM percussion is a *map*, not a scale: key 36 is a kick and key 38 is a snare, and
 *  neither is the other one transposed. An unmapped key is silent rather than approximate. */
export function drumZoneForKey(kit: DrumKitManifest, midiKey: number): DrumZone | null {
  for (const zone of kit.zones) {
    if (zone.key === midiKey) return zone;
  }
  return null;
}

/** Semitone distance from the zone's root, plus the zone's fine tuning, as a rate.
 *
 *  This is pitch ONLY. The transport's `options.rate` must never be folded in here: it
 *  compresses schedule times and has never changed pitch (`Playback.web.ts:71-73`), so
 *  multiplying it in would transpose the whole project up an octave at 2× speed. */
export function playbackRateFor(zone: SampleZone, midiKey: number): number {
  return Math.pow(2, (midiKey - zone.rootKey) / 12 + zone.tuneCents / 1200);
}

/** Loop points in seconds, for `AudioBufferSourceNode.loopStart`/`loopEnd`.
 *
 *  Divided by the sample's OWN rate, not the decoded buffer's: `decodeAudioData` resamples
 *  to the context rate (usually 48000) while the SF2 offsets are frames at the recorded
 *  rate, and seconds is the one unit that survives the resample unchanged. */
export function loopSecondsFor(zone: SampleZone): { start: number; end: number } | null {
  if (zone.loopStartFrames === undefined || zone.loopEndFrames === undefined) return null;
  if (zone.loopEndFrames <= zone.loopStartFrames) return null;
  return {
    start: zone.loopStartFrames / zone.sampleRate,
    end:   zone.loopEndFrames / zone.sampleRate,
  };
}
```

- [ ] **Step 5: Run the harness and watch it pass**

```bash
npx tsx scripts/verify-soundfont.ts
```

Expected: `20/20 cases passed`, exit 0.

- [ ] **Step 6: Add the harness to the suite table**

Add a row to the table in `docs/testing.md` under "The suite":

```
| `verify-soundfont.ts` | 20 | Sampled-instrument resolution (11-6): zone boundaries, semitone/octave playback rates, cents folding, loop offsets against the sample's own rate, drum keys selected rather than transposed |
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: pure sample resolver for the soundfont path, with its harness"
```

---

## Task 3: Extract one instrument and cache it in the browser

The spike that answers the questions that can kill this phase, using one preset and a
hand-checked manifest. Do not generalise here — Task 6 does that, and it should be written
after you know what the audio actually sounds like.

**Files:**
- Create: `scripts/build-soundfont.ts` (single-preset mode only, for now)
- Create: `src/audio/soundfont/sampleCache.web.ts`
- Create: `src/audio/soundfont/index.ts`
- Create: `public/soundfonts/musescore-general-<version>/000-acoustic-grand-piano/`

**Interfaces:**
- Consumes: `zoneForKey`, `playbackRateFor`, `loopSecondsFor` from Task 2.
- Produces:
  - `loadInstrument(program: number): Promise<InstrumentManifest | null>`
  - `loadDrumKit(): Promise<DrumKitManifest | null>`
  - `sampleBufferFor(program: number, zone: SampleZone): Promise<AudioBuffer | null>`
  - `ensureProgramsLoaded(programs: number[], includeDrums: boolean): Promise<void>`
  - `cachedManifest(program: number): InstrumentManifest | null`
  - `cachedDrumKit(): DrumKitManifest | null`
  - `cachedBuffer(program: number, zone: SampleZone): AudioBuffer | null`
  - `cachedDrumBuffer(zone: DrumZone): AudioBuffer | null`

None of these take an `AudioContext`. The cache owns one long-lived context used *only* for
decoding, because `playNotes` builds a fresh `AudioContext` on every call
(`Playback.web.ts:58`) and closes it in `stopPlayback` — so a buffer decoded against the
playing context would die with it. An `AudioBuffer` is usable from any context; the one
caveat is that `decodeAudioData` resamples to the *decoding* context's rate, and both
contexts here are created with no options and therefore both run at the device rate. If that
ever stops being true, pitch goes wrong by the ratio of the two rates and this comment is
where to look.

- [ ] **Step 1: Write the SF2/SF3 chunk walker**

`scripts/build-soundfont.ts`. An SF3 file is RIFF: a `sfbk` form containing `LIST INFO`,
`LIST sdta` (whose `smpl` chunk holds the concatenated Ogg Vorbis streams) and `LIST pdta`
(`phdr`, `pbag`, `pgen`, `inst`, `ibag`, `igen`, `shdr`). For this task you need `smpl` and
`shdr` only — one preset's samples can be picked out by name and their ranges written by
hand. Full generator resolution is Task 6.

```ts
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

interface SampleHeader {
  name: string;
  /** In sf3 these are BYTE offsets into `smpl` bounding one Ogg stream, not frame indices. */
  start: number;
  end: number;
  /** Frames, relative to the decoded sample's own start. */
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
    const raw = bytes.subarray(offset, offset + 20);
    const nul = raw.indexOf(0);
    const name = String.fromCharCode(...raw.subarray(0, nul === -1 ? 20 : nul));
    if (name === 'EOS') break;
    headers.push({
      name,
      start:           view.getUint32(offset + 20, true),
      end:             view.getUint32(offset + 24, true),
      loopStart:       view.getUint32(offset + 28, true) - view.getUint32(offset + 20, true),
      loopEnd:         view.getUint32(offset + 32, true) - view.getUint32(offset + 20, true),
      sampleRate:      view.getUint32(offset + 36, true),
      rootKey:         view.getUint8(offset + 40),
      correctionCents: view.getInt8(offset + 41),
    });
  }
  return headers;
}
```

- [ ] **Step 2: Slice the acoustic grand's samples out and write them as `.ogg`**

In sf3 the bytes between `shdr.start` and `shdr.end` inside `smpl` are a complete Ogg
Vorbis stream. Write them straight to disk — **no re-encoding**, which is the whole reason
the source is an `.sf3` and not an `.sf2`.

```ts
const smpl = chunks.find((c) => c.id === 'smpl')!;
const data = bytes.subarray(smpl.start + header.start, smpl.start + header.end);
await fs.writeFile(path.join(outDir, `${slug(header.name)}.ogg`), data);
```

Verify each written file really is Ogg before trusting it — the first four bytes must be
`OggS`. If they are not, the source is an `.sf2` (raw PCM) rather than an `.sf3`, and Task 1
pinned the wrong file.

```bash
head -c 4 public/soundfonts/musescore-general-*/000-acoustic-grand-piano/*.ogg | xxd | head
```

- [ ] **Step 3: Hand-write `manifest.json` for the acoustic grand**

Fill in the `SampleZone` fields from the sample headers you just read: `rootKey`,
`sampleRate`, `loopStartFrames`/`loopEndFrames` (omit both where the header's loop is
degenerate), `tuneCents` from `correctionCents`, `gain: 1`, `pan: 0`, `releaseSec: 0.3`,
`bytes` and `sha256` from the written file. Pick `loKey`/`hiKey` so the zones tile 21–108
with no gap and no overlap. Leave `filterHz` out for the grand piano — it is one of the
presets that does not need it, which is exactly why it is the right spike.

Also write `catalog.json` next to it with one entry, and copy the licence text from Task 1
to `LICENSE.txt` in the version directory.

- [ ] **Step 4: Write `sampleCache.web.ts`**

```ts
/**
 * Fetch + decode + keep. Web only, because `decodeAudioData` is; the resolver next door is
 * pure so that everything except this file can be tested without a browser.
 *
 * Two caches, for two different costs. Manifests are small JSON and cached forever.
 * Decoded `AudioBuffer`s are large, so they are held per (program, file) and evicted
 * least-recently-used. Both are keyed by in-flight promise as well as by value, so eight
 * tracks that all want the grand piano issue one request between them rather than eight.
 */

import type { InstrumentManifest, SampleZone } from './types';

/** The single place the pinned version from Task 1 appears. Substitute the real version
 *  string here; the directory name carries it so a deploy can never mix new manifests with
 *  cached old samples. */
export const SOUNDFONT_DIR = 'musescore-general-<version>';
const BASE = `/soundfonts/${SOUNDFONT_DIR}`;

/** Decoding-only context. See the note on this task's Interfaces for why it isn't the
 *  playback context. Created lazily so importing this module never starts audio hardware. */
let decodeCtx: AudioContext | null = null;
function decodeContext(): AudioContext {
  if (!decodeCtx) decodeCtx = new AudioContext();
  return decodeCtx;
}
/** Decoded audio is the expensive thing to hold. 64 buffers is roughly four instruments'
 *  worth at the zone density this phase ships, which covers every project seen so far. */
const MAX_BUFFERS = 64;

const manifests = new Map<number, InstrumentManifest | null>();
const manifestsInFlight = new Map<number, Promise<InstrumentManifest | null>>();
const buffers = new Map<string, AudioBuffer>();
const buffersInFlight = new Map<string, Promise<AudioBuffer | null>>();

let catalogDirs: Map<number, string> | null = null;

async function instrumentDir(program: number): Promise<string | null> {
  if (!catalogDirs) {
    const response = await fetch(`${BASE}/catalog.json`);
    if (!response.ok) return null;
    const catalog = await response.json();
    catalogDirs = new Map(catalog.instruments.map((e: { program: number; dir: string }) => [e.program, e.dir]));
  }
  return catalogDirs.get(program) ?? null;
}

/** Never rejects. A null return is the signal to fall back to `voiceForProgram`, and the
 *  fallback is silent by design — see "Failure is silent" in the plan. */
export async function loadInstrument(program: number): Promise<InstrumentManifest | null> {
  if (manifests.has(program)) return manifests.get(program)!;
  const existing = manifestsInFlight.get(program);
  if (existing) return existing;

  const request = (async () => {
    try {
      const dir = await instrumentDir(program);
      if (!dir) return null;
      const response = await fetch(`${BASE}/${dir}/manifest.json`);
      if (!response.ok) return null;
      return (await response.json()) as InstrumentManifest;
    } catch {
      return null;
    }
  })();

  manifestsInFlight.set(program, request);
  const manifest = await request;
  manifestsInFlight.delete(program);
  manifests.set(program, manifest);
  return manifest;
}

function touch(key: string, buffer: AudioBuffer): void {
  // Re-insertion moves the key to the end of Map iteration order, which is what makes the
  // first key the least recently used one.
  buffers.delete(key);
  buffers.set(key, buffer);
  while (buffers.size > MAX_BUFFERS) {
    const oldest = buffers.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    buffers.delete(oldest);
  }
}

export async function sampleBufferFor(
  program: number,
  zone: SampleZone,
): Promise<AudioBuffer | null> {
  const key = `${program}/${zone.file}`;
  const cached = buffers.get(key);
  if (cached) { touch(key, cached); return cached; }
  const existing = buffersInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const dir = await instrumentDir(program);
      if (!dir) return null;
      const response = await fetch(`${BASE}/${dir}/${zone.file}`);
      if (!response.ok) return null;
      const buffer = await decodeContext().decodeAudioData(await response.arrayBuffer());
      touch(key, buffer);
      return buffer;
    } catch {
      return null;
    }
  })();

  buffersInFlight.set(key, request);
  const buffer = await request;
  buffersInFlight.delete(key);
  return buffer;
}

/** Warm everything a set of programs can need, so the scheduler afterwards is synchronous.
 *  Never rejects: a program that fails to load simply plays as an oscillator. */
export async function ensureProgramsLoaded(programs: number[], includeDrums: boolean): Promise<void> {
  await Promise.all(programs.map(async (program) => {
    const manifest = await loadInstrument(program);
    if (!manifest) return;
    await Promise.all(manifest.zones.map((zone) => sampleBufferFor(program, zone)));
  }));
  if (includeDrums) {
    const kit = await loadDrumKit();
    // Drum zones share the buffer cache under a program number no GM program can occupy.
    if (kit) await Promise.all(kit.zones.map((zone) => sampleBufferFor(DRUM_PROGRAM, zone)));
  }
}

/** Out of the 0–127 range on purpose, so a drum sample can never collide with a melodic one
 *  in the buffer cache. Mirrors GM's own convention of putting the kit in bank 128. */
export const DRUM_PROGRAM = 128;

/** Synchronous lookup for the scheduler, which cannot await per note. */
export function cachedBuffer(program: number, zone: SampleZone): AudioBuffer | null {
  const key = `${program}/${zone.file}`;
  const buffer = buffers.get(key);
  if (buffer) touch(key, buffer);
  return buffer ?? null;
}

export function cachedManifest(program: number): InstrumentManifest | null {
  return manifests.get(program) ?? null;
}
```

- [ ] **Step 5: Write the native stub and the shared entry point**

`src/audio/soundfont/index.ts` re-exports the resolver (pure, both platforms) and the
cache. Metro resolves `sampleCache.web.ts` on web; create `sampleCache.ts` alongside it
returning nulls so the native bundle compiles and native silently keeps its oscillators —
the same platform split `Playback.ts` / `Playback.web.ts` already uses.

```ts
// src/audio/soundfont/sampleCache.ts — native. Phase 11-6 ships web only (see the plan's
// "Native" section); returning nulls here is what makes the fallback automatic rather than
// something every caller has to remember. Signatures must stay identical to the .web.ts
// twin or the platform split compiles on one platform and not the other.

import type { DrumKitManifest, DrumZone, InstrumentManifest, SampleZone } from './types';

export const SOUNDFONT_DIR = '';
export const DRUM_PROGRAM = 128;
export async function loadInstrument(_program: number): Promise<InstrumentManifest | null> { return null; }
export async function loadDrumKit(): Promise<DrumKitManifest | null> { return null; }
export async function sampleBufferFor(_program: number, _zone: SampleZone): Promise<null> { return null; }
export async function ensureProgramsLoaded(_programs: number[], _includeDrums: boolean): Promise<void> { /* no-op */ }
export function cachedManifest(_program: number): null { return null; }
export function cachedDrumKit(): null { return null; }
export function cachedBuffer(_program: number, _zone: SampleZone): null { return null; }
export function cachedDrumBuffer(_zone: DrumZone): null { return null; }
```

- [ ] **Step 6: Compile-check without a browser**

The web dev server serves stale code often enough that a clean restart is worth it, and a
per-module bundle request compile-checks the new files without opening anything:

```bash
npx expo start --web --clear
curl -s 'http://localhost:8081/src/audio/soundfont/index.bundle?platform=web&modulesOnly=true' | head -5
```

Expected: JavaScript, not a red Metro error payload.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: extract the acoustic grand from the pinned sf3 and cache it on web"
```

---

## Task 4: Sampled voices in the web scheduler

The milestone that answers "does this sound good". Everything before it is preparation and
everything after it is scale.

**Files:**
- Modify: `src/native/Playback.web.ts:54-110` (the note loop), `:11` (the node list),
  `:145-160` (`stopPlayback`)

**Interfaces:**
- Consumes: `zoneForKey`, `playbackRateFor`, `loopSecondsFor`, `cachedManifest`,
  `cachedBuffer`, and the existing `voiceForProgram`, `velocityGain`, `noteVelocity`.
- Produces: no new exports. `playNotes`, `pausePlayback`, `resumePlayback`, `stopPlayback`
  keep their current signatures exactly.

- [ ] **Step 1: Widen the node list**

`activeOscillators: OscillatorNode[]` becomes `activeVoices: AudioScheduledSourceNode[]` —
the common supertype of `OscillatorNode` and `AudioBufferSourceNode`, both of which have
`start`/`stop`. `stopPlayback` needs no other change; the metronome keeps pushing
oscillators onto the same list.

- [ ] **Step 2: Add the shared output stage**

One `DynamicsCompressorNode` between every voice and the destination, for both the sampled
and the oscillator path. A dozen sampled tracks clip where a dozen sine waves did not, and
applying it to only one path would make the fallback audibly louder than the real thing —
which is precisely backwards.

```ts
const compressor = ctx.createDynamicsCompressor();
compressor.threshold.value = -12;
compressor.ratio.value = 4;
compressor.connect(ctx.destination);
```

Every `gain.connect(ctx.destination)` in `playNotes` becomes `gain.connect(compressor)`.
Leave `previewNote`'s own context alone — it is a single tone with nothing to sum against.

- [ ] **Step 3: Add the imports**

At the top of `Playback.web.ts`, beside the existing `voiceForProgram` import:

```ts
import { noteNameToMidi } from '@/audio/HarmonicaMapper';
import {
  cachedBuffer, cachedDrumBuffer, cachedDrumKit, cachedManifest,
  drumZoneForKey, loopSecondsFor, playbackRateFor, zoneForKey,
} from '@/audio/soundfont';
```

- [ ] **Step 4: Add the sampled voice, ahead of the oscillator branch**

Inside the existing per-note loop, after `effectiveStart`/`startSec`/`durSec` are computed
and before the `voiceForProgram` branch. Falling through to the existing code on any null is
what makes the fallback automatic.

```ts
const midiKey = noteNameToMidi(n.note);
const manifest = n.program === undefined ? null : cachedManifest(n.program);
const zone = manifest && midiKey !== null ? zoneForKey(manifest, midiKey) : null;
const buffer = zone && n.program !== undefined ? cachedBuffer(n.program, zone) : null;

if (zone && buffer && midiKey !== null) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // Pitch and tuning only. `rate` divides the scheduled times below, exactly as it does for
  // the oscillator path — folding it in here would transpose the project at 2× speed.
  source.playbackRate.value = playbackRateFor(zone, midiKey);

  const loop = loopSecondsFor(zone);
  if (loop) {
    source.loop = true;
    source.loopStart = loop.start;
    source.loopEnd = loop.end;
  }

  const gain = ctx.createGain();
  const peak = AMPLITUDE_SAMPLED * zone.gain * velocityGain(noteVelocity(n));
  // No ADSR here: the attack and decay are already in the recording, and re-applying the
  // oscillator envelope on top of them would blunt exactly what makes a sample sound real.
  // Only the 2 ms declick in and the zone's own release out.
  const attack  = Math.min(0.002, durSec / 4);
  const release = Math.min(zone.releaseSec, Math.max(0.002, durSec - attack));
  gain.gain.setValueAtTime(0, startSec);
  gain.gain.linearRampToValueAtTime(peak, startSec + attack);
  gain.gain.setValueAtTime(peak, startSec + Math.max(attack, durSec - release));
  gain.gain.linearRampToValueAtTime(0, startSec + durSec);

  let tail: AudioNode = gain;
  if (zone.filterHz !== undefined) {
    // SF2's `initialFilterFc`. Skipping it is what makes a sampled GM set sound synthetic.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = zone.filterHz;
    filter.Q.value = zone.filterQ ?? 1;
    gain.connect(filter);
    tail = filter;
  }
  if (zone.pan !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = zone.pan;
    tail.connect(panner);
    tail = panner;
  }
  tail.connect(compressor);

  source.connect(gain);
  // A sample seeked into mid-note starts partway through itself, matching what the
  // oscillator path already does with `effectiveStart`.
  const offsetSec = (effectiveStart - n.start_time) / 1000;
  source.start(startSec, offsetSec * source.playbackRate.value);
  source.stop(startSec + durSec + 0.02);
  activeVoices.push(source);
  continue;
}
```

Add `const AMPLITUDE_SAMPLED = 0.5;` beside the existing `AMPLITUDE`. Samples are recorded
well below full scale where the oscillators were written to `0.3` against a bare
destination; Step 7 is where this number gets set against the fallback by ear rather than
by guess.

- [ ] **Step 5: Verify it compiles**

```bash
npx expo start --web --clear
curl -s 'http://localhost:8081/src/native/Playback.bundle?platform=web&modulesOnly=true' | head -5
```

- [ ] **Step 6: Listen to a single note**

Open the Studio, set a track to Acoustic Grand Piano, and play one long note. This is the
first moment the phase has any evidence in it. Check, in this order:

1. It is a piano, not a chipmunk or a foghorn — if it is, `rootKey` or `sampleRate` is wrong.
2. The pitch is right against the tab editor's own tone at the same note.
3. It decays naturally rather than being cut off.

- [ ] **Step 7: Listen to the things the harness cannot check**

- **Loop seam.** Hold a long note on a looped zone. Vorbis is lossy, so the SF2 loop points
  are frame-approximate after decode — a tick or a pitch blip at the seam is expected, not
  surprising. If you hear one, note the zone in `docs/plan/soundfont-source.md`; the fix is a
  short crossfade in Task 6's converter, and it is much cheaper to know now than after 128
  instruments are built.
- **Zone boundaries.** Play a chromatic run across the whole range. A jump in timbre at a
  boundary is normal; a jump in *pitch* means `loKey`/`hiKey` and `rootKey` disagree.
- **Playback rate.** Play at 0.5× and 2×. The pitch must not move. This is the regression
  the "Decisions taken" section exists to prevent, and it is the one that is easy to ship.
- **Seek into a held note.** Click mid-note in the roll. It should resume partway through
  the sample, not restart it.
- **Fallback.** Set a track to any program other than Acoustic Grand Piano. It must play the
  old oscillator tone, with no error and no silence.

- [ ] **Step 8: Balance the two paths**

Play a project with one sampled track and one fallback track together and adjust
`AMPLITUDE_SAMPLED` until neither buries the other. Record the number you landed on and why
in a comment beside the constant.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: schedule sampled voices on web, with the oscillator path as fallback"
```

---

## Task 5: Percussion

Do this before the full converter, because the converter has to emit a drum kit and the
manifest shape has to be settled first.

**Files:**
- Modify: `src/types/index.ts:37-70` (`TabNote`)
- Modify: `src/audio/midiProject.ts` (project construction)
- Modify: `src/audio/studioNotes.ts` (`trackToTabNotes`)
- Modify: `src/native/Playback.web.ts` (the branch from Task 4)
- Test: `scripts/verify-soundfont.ts`, `scripts/verify-midi-studio.ts`

**Interfaces:**
- Consumes: `MidiTrack.channel` (`src/types/index.ts:191`, *"0-based MIDI channel; 9 is percussion"*).
- Produces: `TabNote.percussion?: boolean`. The drum-kit half of the cache
  (`loadDrumKit`, `cachedDrumKit`, `cachedDrumBuffer`, `DRUM_PROGRAM`) was declared in
  Task 3's interfaces and is implemented here — `cachedDrumBuffer(zone)` is
  `cachedBuffer(DRUM_PROGRAM, zone)`, and `loadDrumKit` fetches
  `${BASE}/drums/manifest.json` through the same in-flight-dedupe path as
  `loadInstrument`.

- [ ] **Step 1: Write the failing cases first**

Add to `scripts/verify-soundfont.ts`, and a matching one to `verify-midi-studio.ts` next to
its existing `noAccidentalPercussionChannel` case:

```ts
function percussionSurvivesTheFlatten(): void {
  // studio.tsx:218 flattens every audible track into one TabNote[] that carries `program`
  // and nothing else. Before this case, a drum track arrived at the scheduler indis-
  // tinguishable from a piano track — harmless while everything was a test tone, and a
  // room full of pianos playing a drum part the moment samples arrived.
  const project = createProject('Kit test');
  const drums = createTrack({ name: 'Drums', channel: 9 });
  drums.notes = [{ midi: 36, startMs: 0, durationMs: 100, velocity: 100 }];
  const flattened = trackToTabNotes(drums);
  check('percussion: flagged on channel 9', flattened[0]?.percussion === true, 'channel 9 → percussion');

  const piano = createTrack({ name: 'Piano', channel: 0 });
  piano.notes = [{ midi: 60, startMs: 0, durationMs: 100, velocity: 100 }];
  check('percussion: absent elsewhere', trackToTabNotes(piano)[0]?.percussion !== true, 'channel 0 → not percussion');
}
```

Match the real signatures of `createProject`, `createTrack` and `trackToTabNotes` as they
exist in the tree — read `verify-midi-studio.ts`'s own `studioKeepsEveryTrack` and
`noAccidentalPercussionChannel` cases for the exact call shapes rather than trusting the
sketch above.

- [ ] **Step 2: Run both harnesses and watch the new cases fail**

```bash
npx tsx scripts/verify-soundfont.ts
npx tsx scripts/verify-midi-studio.ts
```

- [ ] **Step 3: Add the field**

In `src/types/index.ts`, beside `program`:

```ts
  /** True when the note came from MIDI channel 9, where pitch names a drum rather than a
   *  note. A *playback* hint only, exactly like `program` — the tab pipeline drops
   *  percussion long before this (`midiToNotes.ts:85`), so nothing downstream of a tab ever
   *  sees it set. Absent everywhere else, including hand-drawn notes. */
  percussion?: boolean;
```

- [ ] **Step 4: Set it at the two places a `TabNote` is born from a track**

`midiProject.ts` where tracks are built from SMF, and `studioNotes.ts`'s `trackToTabNotes`
where a track's notes become `TabNote`s for the roll and the scheduler. Both already have
the channel in hand; `midiProject.ts:58` already reasons about channel 9 explicitly.

- [ ] **Step 5: Branch on it in the scheduler**

In `Playback.web.ts`, ahead of the melodic sampled branch from Task 4:

```ts
if (n.percussion) {
  const kit = cachedDrumKit();
  const drum = kit && midiKey !== null ? drumZoneForKey(kit, midiKey) : null;
  const drumBuffer = drum ? cachedDrumBuffer(drum) : null;

  if (drum && drumBuffer) {
    const source = ctx.createBufferSource();
    source.buffer = drumBuffer;
    // Selected, never transposed. GM percussion is a map — key 36 is a kick and key 38 is a
    // snare, and neither is the other one pitched up. playbackRate stays at 1.

    const gain = ctx.createGain();
    const peak = AMPLITUDE_SAMPLED * drum.gain * velocityGain(noteVelocity(n));
    gain.gain.setValueAtTime(0, startSec);
    gain.gain.linearRampToValueAtTime(peak, startSec + 0.002);

    let tail: AudioNode = gain;
    if (drum.pan !== 0) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = drum.pan;
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(compressor);

    source.connect(gain);
    source.start(startSec);
    // Deliberately NOT stopped at `startSec + durSec`. A drum sample is a one-shot whose
    // length is a property of the sound, so cutting a crash off at its notated duration is
    // the single most obvious way to make a sampled kit sound wrong. It ends when the
    // buffer does; `stopPlayback` still kills it on transport stop because it is in
    // `activeVoices`.
    activeVoices.push(source);
    continue;
  }
  // A percussion note with no kit loaded falls through to the oscillator below, which is
  // exactly what it does today.
}
```

Note what is *absent* relative to a melodic voice, and why: no `playbackRate`, no loop, no
release ramp, no `stop()`, and no filter — the drum samples in a GM kit are already the
finished sound.

- [ ] **Step 6: Run both harnesses, then listen**

```bash
npx tsx scripts/verify-soundfont.ts
npx tsx scripts/verify-midi-studio.ts
```

Expected: all cases pass, including everything that passed before. Then import a MIDI file
with a drum track and confirm the kit is a kit — and, with the kit assets not yet built (they
arrive in Task 6), that it still falls back cleanly to the old tones rather than to silence.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: carry percussion through to the scheduler so drums stop playing as piano"
```

---

## Task 6: The full converter

Now generalise the Task 3 spike to all 128 programs plus the drum kit, with validation and a
report. **If Task 1 adopted a prebuilt set, this task is instead: mirror it under
`public/soundfonts/<version>/`, generate manifests in the Task 2 shapes from its metadata,
and run the same validator.** Everything below about validation still applies.

**Files:**
- Modify: `scripts/build-soundfont.ts`
- Create: `public/soundfonts/musescore-general-<version>/` (all instruments, `drums/`,
  `catalog.json`, `LICENSE.txt`)
- Create: `docs/plan/soundfont-build-report.md`

**Interfaces:**
- Produces: a `catalog.json` conforming to `Catalog`, one `manifest.json` per program
  conforming to `InstrumentManifest`, and `drums/manifest.json` conforming to
  `DrumKitManifest`.

- [ ] **Step 1: Resolve the generator graph**

Task 3 read `smpl` and `shdr` only. The full conversion needs the preset → instrument →
sample chain: `phdr`/`pbag`/`pgen` map a (bank, program) to instrument zones, and
`inst`/`ibag`/`igen` map those to samples plus their generators. The generators this phase
reads, and nothing else:

| Generator | id | Becomes |
|---|---|---|
| `keyRange` | 43 | `loKey` / `hiKey` |
| `velRange` | 44 | velocity-layer filter (keep the layer covering 64) |
| `overridingRootKey` | 58 | `rootKey`, when present, else `shdr.rootKey` |
| `fineTune` / `coarseTune` | 52 / 51 | `tuneCents` (plus `shdr.correctionCents`) |
| `initialAttenuation` | 48 | `gain` = `10 ** (-cB / 200)` |
| `pan` | 17 | `pan`, from tenths of a percent to −1…1 |
| `initialFilterFc` | 8 | `filterHz` = `8.176 * 2 ** (cents / 1200)`, omitted at or above 19912 cents (the SF2 default, i.e. no filter) |
| `initialFilterQ` | 9 | `filterQ` = `10 ** (cB / 200)` |
| `releaseVolEnv` | 38 | `releaseSec` = `2 ** (timecents / 1200)` |
| `sampleModes` | 54 | loop on/off — 1 and 3 loop, 0 and 2 do not |

Instrument-level generators are overridden by preset-level ones, and each level's global
zone (the one with no `keyRange`) supplies defaults for its siblings. Bank 128 is the
percussion bank: its preset 0 is the standard kit, and each of its zones is a drum keyed by
its own `keyRange` (`loKey === hiKey`), which is what fills `DrumZone.key` and `drumName`.

- [ ] **Step 2: Thin the zones**

Keep one sample every few semitones, plus every zone whose timbre genuinely differs (a
different `filterHz`, a different loop mode, or a `rootKey` more than a fifth from its
neighbour's). Widen the surviving zones' `loKey`/`hiKey` to tile the original range with no
gaps. Never thin the drum kit — every drum key is a different sound.

- [ ] **Step 3: Validate, and fail the build**

The script exits non-zero on any of:

- a GM program 0–127 with no manifest
- a manifest referencing a file that does not exist
- a gap or an overlap in a manifest's key coverage
- a loop offset beyond its sample's length
- a `sha256` or byte size that does not match the file on disk
- a missing `source.license` or `source.version` on any manifest
- a written `.ogg` not starting with `OggS`
- a drum zone whose `loKey !== hiKey`

- [ ] **Step 4: Write the report**

`docs/plan/soundfont-build-report.md`: every program with its zone count and total bytes,
sorted heaviest first; the drum kit's key count and bytes; the grand total; and the list of
velocity layers dropped by the "keep the layer covering 64" rule, so restoring them later is
a data change rather than an investigation.

- [ ] **Step 5: Run it**

```bash
npx tsx scripts/build-soundfont.ts --source ~/soundfonts/MuseScore_General.sf3
du -sh public/soundfonts/musescore-general-*
```

- [ ] **Step 6: Decide on the total, against the number you just measured**

`public/models` is 900K and committed, so this is a real step change in repo size and the
decision belongs here rather than in a preference.

- **Under 60 MB:** commit the whole set. It is written once, never churns, and the immutable
  versioned directory means a future build adds a new directory rather than rewriting this one.
- **Over 60 MB:** ship a curated subset — piano, harmonica, the guitars, the basses, the
  strings, the brass and the standard kit — and let every other program fall back to its
  oscillator, which is exactly what it does today and no worse. Record the cut list in the
  report, and record that `catalog.json` simply omits them, so the runtime needs no change
  at all to handle it.

- [ ] **Step 7: Listen across the families**

Piano, acoustic guitar, bass, violin, trumpet, saxophone, flute, harmonica, synth lead, and
the drum kit. Then a dense multitrack file, rapid repeated notes, and a long sustained note
seeked into the middle of. Note anything that sounds wrong against the family it belongs to.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: convert the full MuseScore General set to app sound packages"
```

---

## Task 7: Preload before the clock starts

**Files:**
- Modify: `src/hooks/useRollTransport.ts:92-104` (the single `play()` call site)

**Interfaces:**
- Consumes: `ensureProgramsLoaded` from `@/audio/soundfont`.
- Produces: `instrumentsLoading: boolean` on `useRollTransport`'s return value.

- [ ] **Step 1: Understand why it goes here and not in `playNotes`**

`usePlayback.play` sets `startedAtRef.current = Date.now() - …`, calls `playNotes` **without
awaiting it**, then starts the rAF ticker and arms the end timeout (`usePlayback.ts:140-150`).
So an `await` inside `playNotes` would leave the playhead running for the whole load with no
sound under it, and would shift the end timeout by the same amount. The load has to complete
*before* `play` is called. `useRollTransport.ts:92` is the one call site, and it says so.

- [ ] **Step 2: Await the distinct programs there**

```ts
// Sampled instruments must be resident before the clock starts: `usePlayback.play` back-
// dates `startedAtRef` and starts the ticker synchronously, so anything awaited inside
// `playNotes` would run the playhead over silence. What loads is a handful of instruments,
// not a piece of audio — see the plan's "No streaming scheduler".
const programs = [...new Set(notes.map((n) => n.program).filter((p): p is number => p !== undefined))];
setInstrumentsLoading(true);
await ensureProgramsLoaded(programs, notes.some((n) => n.percussion));
setInstrumentsLoading(false);
play(notes, options, startMs, loopRegion ?? undefined);
```

`ensureProgramsLoaded` never rejects, so no `try`/`catch`: a failed load resolves and every
note falls back to its oscillator, silently, exactly as in Task 4.

- [ ] **Step 3: Show the indicator only when it is slow**

Surface `instrumentsLoading` in `WebTransportBar` as a small inline "Loading instruments…"
next to the play control, on a 300 ms delay so a warm cache never flashes it. Nothing else
changes state — the transport is not disabled, because the load is bounded and interrupting
it is the user's business.

- [ ] **Step 4: Verify the loop stays warm**

Mark a loop region and let it run five passes. `useRollTransport.ts:156` re-calls the play
path on every pass, so every pass re-creates every voice; if the cache is working, passes 2
through 5 have no gap at the seam and the indicator never appears. If they do, the cache
key or the LRU size is wrong — 64 buffers may be too few for the project you are testing.

- [ ] **Step 5: Verify a cold first play**

Hard-reload with the cache disabled in devtools, then press play. The indicator appears,
then playback starts *with the playhead at zero* — not already partway down the roll. That
is the whole point of this task.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: load a project's instruments before the transport clock starts"
```

---

## Task 8: Instrument previews use the instrument

**Files:**
- Modify: `src/native/Playback.web.ts:119` (`previewNote`)
- Modify: `src/native/Playback.ts:37` (`previewNote`)
- Modify: `src/app/edit.tsx:167` (the caller)
- Modify: `src/components/TrackList.tsx` (instrument selection)

**Interfaces:**
- Produces: `previewNote(noteName: string, durationMs?: number, program?: number): void`
  on web and `Promise<void>` on native. The third parameter is optional, so `edit.tsx:167`
  compiles unchanged and the tab editor keeps the plain tone it has always had.

- [ ] **Step 1: Add the parameter to both implementations**

Web: if `program` is given and its manifest and buffer are cached, schedule an
`AudioBufferSourceNode` in the preview's own one-shot context, exactly as in Task 4; else
the existing sine. Native: ignore the parameter entirely — `synthesizeWav` has no sample
path and this phase is not giving it one.

- [ ] **Step 2: Preview from the instrument picker**

Selecting an instrument in `TrackList` previews a representative note (C4 for most, C2 for
the basses, C3 for the tuba and the contrabass) on the newly selected program. Selecting
another cancels the previous preview by closing its context — the web `previewNote` already
owns its context and closes it in `onended`, so cancellation is `ctx.close()` on a retained
handle rather than new machinery.

- [ ] **Step 3: Load on demand, and say so if it is slow**

If the program is not cached, kick off `ensureProgramsLoaded` for it and show a small
spinner on the row past 300 ms. This is the one place a load failure is visible: the user
asked to hear *this instrument*, so falling back to a sine with no explanation would read as
the picker being broken. Show "Couldn't load this sound" on the row and play the fallback.

- [ ] **Step 4: Verify**

Click through a dozen instruments quickly. Each preview cuts the last one off, none overlap,
none leak a context (check `performance.memory` or just that the tab does not grow), and the
tab editor's own note preview (`edit.tsx:167`) sounds exactly as it did before.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: preview an instrument with its own sound in the track list"
```

---

## Task 9: Ship it

**Files:**
- Modify: `firebase.json` (hosting headers)
- Modify: `docs/plan/README.md` (the 11-6 blocker note)

- [ ] **Step 1: Add the cache header**

Beside the existing `/models/**` rule. Immutable, because the version is in the directory
name and a new build writes a new directory:

```json
{
  "source": "/soundfonts/**",
  "headers": [
    { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
  ]
}
```

- [ ] **Step 2: Confirm the assets survive the export**

```bash
npx expo export --platform web
ls dist/soundfonts/
```

Expected: the version directory, with `catalog.json` and the instrument directories in it.
If it is missing, `public/` is not being copied and the asset path is wrong — fix that before
deploying, not after.

- [ ] **Step 3: Measure the node graph**

Play the densest multitrack file to hand and record, in the build report: peak
`AudioBufferSourceNode` count, peak JS heap, and whether playback stays glitch-free. Every
note of the piece is scheduled up front (`Playback.web.ts:54`), and each sampled voice now
pins a decoded buffer where an oscillator pinned nothing — so this is a real number worth
having on the record before a user finds it. If it does not hold, the fix is a lookahead
scheduler, and that is its own phase with its own plan.

- [ ] **Step 4: Cross-browser pass**

Safari, Chrome and Firefox: one melodic track, one drum track, 0.5× and 2×, a loop region,
and a cold load. Safari is the one to watch — its `decodeAudioData` is the strictest of the
three about Ogg, and if it refuses the files this is where you find out.

- [ ] **Step 5: Offline pass**

Load the app, then go offline and press play. Playback must start, on oscillators, with no
error dialog and no silence.

- [ ] **Step 6: Deploy**

```bash
npx firebase deploy --only hosting
curl -sI https://harp2tab.com/soundfonts/musescore-general-<version>/catalog.json | grep -i cache-control
```

Expected: `public, max-age=31536000, immutable`.

- [ ] **Step 7: Close the blocker**

Update the 11-6 note at `docs/plan/README.md:223` — the two questions it names (which
soundfont, and bundled vs. fetched) are answered in `docs/plan/soundfont-source.md`, and the
phase is no longer blocked on a decision. Mark 11-6 done in the Phase 11 checklist at
`README.md:162`, less the native half.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: serve the sampled instruments, and close the 11-6 blocker"
```

---

## Native — explicitly not in this phase

Native keeps `synthesizeWav` and `voiceForProgram`. This is Phase 11's standing decision
(`phase-11-midi-studio.md:62`) applied to sound rather than to UI, and it is a deferral of
the *port*, not a downscoping of the web work — the web feature ships complete.

Two things constrain whoever picks it up:

- **Do not schedule each MIDI note as its own `expo-audio` player.** Timing, polyphony,
  seeking and cleanup all become fragile at once. Native keeps the pre-rendered-file model
  and upgrades the renderer: `synthesizeWav` learns to mix decoded samples instead of
  summing oscillators, and the rest of `Playback.ts` is untouched.
- **`Playback.ts:2` currently imports `expo-file-system/legacy`.** Moving to the modern
  `File`/`Directory`/`Paths` API is a migration of existing code, not a greenfield choice,
  and it should be its own commit ahead of any renderer work. Downloaded sound packages
  belong under `Paths.cache` — Expo documents cache content as removable by the OS, which is
  correct for something re-downloadable. Read
  `https://docs.expo.dev/versions/v55.0.0/sdk/filesystem/` first.

Until that exists, no native UI may promise "MuseScore sound".

---

## Risks

- **Vorbis loop seams.** The one thing that could make sustained instruments unusable and
  that no structural check catches. Task 4, Step 7 puts a listening test in front of the
  128-instrument build precisely so this is found on one instrument rather than on all of them.
- **Safari's `decodeAudioData` on Ogg.** Found at Task 9, Step 4, which is late. If it is a
  worry, pull that single check forward into Task 4, Step 6 — it costs one browser and five minutes there.
- **Node-graph weight under dense multitrack.** Measured at Task 9, Step 3. The mitigation is
  a lookahead scheduler, which is a separate phase; nothing in this plan should grow one.
- **Repo size.** Answered by a measured number at Task 6, Step 6, with a curated-subset
  fallback that needs no runtime change.

## Verification

| What | How |
|---|---|
| Resolver: zones, rates, cents, loops, drums | `npx tsx scripts/verify-soundfont.ts` |
| Percussion survives the flatten | `npx tsx scripts/verify-soundfont.ts`, `npx tsx scripts/verify-midi-studio.ts` |
| Nothing in the Studio regressed | `npx tsx scripts/verify-midi-studio.ts`, `npx tsx scripts/verify-midi-import.ts`, `npx tsx scripts/verify-export.ts` |
| Assets are complete and self-consistent | `npx tsx scripts/build-soundfont.ts` exits 0 |
| It sounds right | Task 4 Step 7, Task 6 Step 7 — both are listening tests, and neither is optional |
| It ships | Task 9 Steps 2–6 |

## Build order

1–2–3–4 in order: the first four tasks exist to get *one* instrument audible before anything
is built at scale, because Task 4's listening test is what tells you whether the manifest
shape from Task 2 is right. 5 before 6, because the converter has to emit a drum kit. 7, 8, 9
in any order after 6. Native is a separate milestone with its own plan.
