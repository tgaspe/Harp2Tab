# Phase 18 — Score notation view and export (SVG / PDF / PNG)

*Part of the [Harp2Tab implementation plan](README.md).*

> **For agentic workers:** implement task-by-task, in order. Steps use checkbox (`- [ ]`)
> syntax. Verification is `npx tsx scripts/verify-*.ts` — there is no Jest or Vitest in this
> repo, see [`../testing.md`](../testing.md).

**Goal:** a Score view beside List and Piano Roll showing conventional staff notation with
Harp2Tab tabs under each note, and SVG/PDF/PNG export rendered from that same score.

**Architecture:** a platform-independent *score document* is the single source of truth. It
is built from `TabNote[]` by a non-destructive quantizer, consumed by the MusicXML generator
and by the renderer, and never derived back from SVG or XML text.

```text
ExportPart[] + ScoreSettings (bpm, origin, meter, key, rhythm mode)
                  |
                  v
        quantize.ts  (non-destructive)
                  |
                  v
          ScoreDocument  ◄── the source of truth
            /             \
           v               v
   musicXml.ts        score renderer (OSMD, web)
           |                   |
           v            /      |      \
   .musicxml file     SVG    PDF     PNG
```

**Tech stack:** TypeScript, Expo SDK 55 / RN 0.83 / React 19, `opensheetmusicdisplay` (web
only, lazy-loaded), existing `src/export` file + sharing lifecycle.

**Spec:** this document. It replaces the unnumbered `music-notation-view-and-export.md`,
which was audited against the codebase on 2026-08-30; the eleven findings from that audit are
folded in below and called out inline as **[audit N]** where they changed a decision.

---

## Global constraints

- **Web first.** The Score view and all three new exports ship on **web only** in this phase.
  Native is a later port and may drop features. This is the same call Phase 17 made for audio
  export, and for the same kind of reason: the renderer is a DOM library. **[audit 5, 10]**
  Nothing in this phase may be deferred or downscoped because of a native limitation.
- **No test framework.** Verification is standalone `scripts/verify-*.ts` harnesses run with
  `npx tsx`, each printing a PASS/FAIL table and exiting non-zero on failure. There is no
  Jest, no Vitest, no snapshot runner, and no visual-diff runner. **[audit 1]**
- **`scripts/verify-export.ts` must stay green** (42 cases) at every commit. It asserts
  today's MusicXML part list and XML escaping, and single-track TXT byte-for-byte.
- **`generateForFormat(parts, format)` keeps working with two arguments.** Multi-part
  MusicXML has no live UI caller today (the Studio exports MIDI+audio, `/profile` exports
  JSON), but it is public API and the harness asserts it, so the score document is
  multi-part-capable from the start even though the *view* renders one part. **[audit 3]**
- **Quantization is derived, never applied.** No code path in this phase may write
  `TabNote.start_time` or `TabNote.duration`.
- **Lazy-load the renderer.** `opensheetmusicdisplay` is ~1 MB with its Bravura font, on top
  of a web bundle that already carries `@spotify/basic-pitch` and a soundfont. It must be
  reached through `await import()`, the pattern in
  `src/audio/algorithms/basicPitch.web.ts:160`. **[audit 2]**
- **Pin dependency versions when adding them.** `opensheetmusicdisplay@^1.9.0` is the only
  new runtime dependency this phase adds. `expo-print`, `react-native-webview` and
  `react-native-view-shot` are **not** used — see Phase 18-7 and 18-8. **[audit 2]**

---

## What the audit changed

| # | Finding | Resolution |
|---|---|---|
| 1 | Testing strategy named runners that don't exist | Task 2 creates `scripts/verify-notation.ts`; Task 5 extends `verify-export.ts` |
| 2 | No dependencies named or pinned; no lazy-load | Global constraints above; only OSMD is added |
| 3 | Score document scoped to one part collides with multi-part `generateForFormat` | `ScoreDocument.parts[]` from day one |
| 4 | `GeneratedFile` is one string — can't carry multi-page PNG/SVG | Task 11: score exports use a second lane, like audio formats already do |
| 5 | Native PNG had no mechanism | Web-only phase; native is follow-up |
| 6 | Quantizer had no downbeat origin and no BPM source | `ScoreSettings.originMs` + `bpm` threaded from the session store (Task 6) |
| 7 | No triplet grid, though `SnapDivision` already has `12` | `RhythmMode` includes `'triplet'` |
| 8 | Key signature never mentioned; runtime note names are always sharps | `ScoreSettings.keyFifths` + `spellPitch()` (Task 3) |
| 9 | Plan unnumbered, untracked, not in the roadmap index | This file; README entry added in Task 1 |
| 10 | Cross-platform-first contradicted web-first | Global constraints |
| 11 | Renderer spike front-loaded the least reusable work | Tasks 1–6 are renderer-independent and land first; the spike is Task 7 |

---

## File structure

| File | Responsibility |
|---|---|
| `src/notation/tabText.ts` | **Created by moving** the tab-token layer out of `src/export/generators.ts`: `CHORD_WINDOW_MS`, `PLAIN_HOLE`, `tabOrFallback`, `groupSimultaneous`, `chordToken`, `byPitch`, `voicingOf`, `Voicing`. One definition of "how a tab is written" for TXT and notation alike |
| `src/notation/scoreDocument.ts` | The model: types, `TICKS_PER_QUARTER`, the note-value table, `decomposeSpan()`, `spellPitch()` |
| `src/notation/quantize.ts` | `buildScoreDocument(parts, settings)` — the only place milliseconds become musical time |
| `src/notation/musicXml.ts` | `scoreToMusicXml(doc)` |
| `src/export/generators.ts` | Modified: `generateMusicXml` becomes a thin adapter; tab helpers now imported |
| `scripts/verify-notation.ts` | New harness for the three modules above |
| `scripts/verify-export.ts` | Modified: MusicXML assertions extended for tempo, ties, chords, lyrics |
| `src/notation/render/osmd.web.ts` | Task 8: lazy OSMD load, engrave into a DOM node, note↔`sourceIds` map |
| `src/app/edit.tsx`, `src/store/useAppStore.ts` | Task 9: `viewMode` gains `'score'` |
| `src/components/ScoreView.web.tsx` | Task 9: the view |
| `src/export/scoreFormats.ts`, `src/export/exportScore.web.ts` | Task 11: the SVG/PDF/PNG lane |

---

## Task 1: Land the plan in the roadmap

**Files:** Create `docs/plan/phase-18-score-notation.md` (this file); Delete
`docs/plan/music-notation-view-and-export.md`; Modify `docs/plan/README.md`

- [ ] **Step 1:** Delete the unnumbered plan — it is untracked, so no history is lost.

```bash
rm docs/plan/music-notation-view-and-export.md
```

- [ ] **Step 2:** Add Phase 18 to the status paragraph at the top of `docs/plan/README.md`,
  alongside the existing Phase 17 sentence.

- [ ] **Step 3:** Commit.

```bash
git add . && git commit -m "docs: add Phase 18 score notation plan"
```

---

## Task 2: Extract the tab-token layer

Nothing about the output changes. This is a pure move so notation and TXT cannot invent
different tab conventions — the same reasoning that put every format behind
`generateForFormat` in the first place.

**Files:**
- Create: `src/notation/tabText.ts`
- Modify: `src/export/generators.ts` (delete the moved declarations, add the import)
- Test: `scripts/verify-export.ts` (unchanged — it is the regression gate for this task)

**Interfaces produced:**

```ts
export const CHORD_WINDOW_MS = 50;
export const PLAIN_HOLE: RegExp;
export function tabOrFallback(n: TabNote): string;
export function groupSimultaneous(notes: readonly TabNote[]): TabNote[][];
export function chordToken(group: readonly TabNote[], harmonicaType: HarmonicaType): string | null;
export function byPitch(a: TabNote, b: TabNote): number;
export interface Voicing { token: string; kind: 'single' | 'chord' | 'group'; counts: number; lead: TabNote }
export function voicingOf(group: TabNote[], harmonicaType: HarmonicaType, index: number): Voicing;
```

- [ ] **Step 1:** Move those declarations verbatim from `src/export/generators.ts` into
  `src/notation/tabText.ts`, carrying their docblocks with them. Add a module docblock saying
  why the module exists (two consumers, one convention).

- [ ] **Step 2:** In `generators.ts`, replace them with
  `import { ... } from '@/notation/tabText';`.

- [ ] **Step 3:** Verify nothing changed.

```bash
npx tsx scripts/verify-export.ts
```

Expected: `42/42 cases passed`.

- [ ] **Step 4:** Commit.

```bash
git add . && git commit -m "refactor: extract tab-token layer to src/notation/tabText.ts"
```

---

## Task 3: The score document model

**Files:** Create `src/notation/scoreDocument.ts`; Create `scripts/verify-notation.ts`

**Why 24 ticks per quarter:** it divides by 8 (32nd = 3 ticks), by 4 (16th = 6), by 2
(eighth = 12) *and* by 3 (eighth-triplet = 8). A power-of-two resolution cannot write a
shuffle, and shuffle is most of what a harmonica plays — the reasoning already written down
at `SnapDivision` in `src/audio/tempo.ts`. **[audit 7]**

**Interfaces produced:**

```ts
export const TICKS_PER_QUARTER = 24;

export type RhythmMode = 'readable' | 'balanced' | 'precise' | 'triplet';

/** Grid unit in ticks. 'triplet' is the eighth-note triplet — three to the beat. */
export const GRID_TICKS: Record<RhythmMode, number> = {
  readable: 12, balanced: 6, precise: 3, triplet: 8,
};

export type NoteTypeName = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';

export interface ScorePitch { step: string; alter: -1 | 0 | 1; octave: number }

export interface ScoreElement {
  /** Empty = a rest. More than one = a chord. */
  pitches: ScorePitch[];
  durationTicks: number;
  type: NoteTypeName;
  dots: 0 | 1;
  /** Present only for triplets: 3 in the time of 2. */
  timeModification?: { actualNotes: number; normalNotes: number };
  tieStart: boolean;
  tieStop: boolean;
  /** The Harp2Tab token printed under the note. '' for rests and for tied continuations. */
  tab: string;
  /** `TabNote.id`s this element stands for. The renderer maps a clicked notehead back
   *  through these; a chord carries several, a rest none. */
  sourceIds: string[];
}

export interface ScoreMeasure {
  number: number;
  /** Emitted on measure 1 and again whenever it changes. */
  attributes?: { divisions: number; keyFifths: number; beats: number; beatType: number };
  /** Emitted on measure 1 and again at a tempo change. */
  tempoBpm?: number;
  elements: ScoreElement[];
}

export interface ScorePart {
  id: string;
  name: string;
  key: HarmonicaKey;
  harmonicaType: HarmonicaType;
  measures: ScoreMeasure[];
}

/** A note the quantizer had to move far enough that the written score is an approximation. */
export interface QuantizationWarning {
  sourceId: string;
  kind: 'onsetMoved' | 'durationClamped' | 'overlapTruncated';
  /** How far, in ms. */
  deltaMs: number;
}

export interface ScoreDocument {
  title: string;
  encodingDate: string;
  parts: ScorePart[];
  warnings: QuantizationWarning[];
}

export function spellPitch(midi: number, keyFifths: number): ScorePitch;
export function decomposeSpan(
  startTick: number, ticks: number, mode: RhythmMode,
): { ticks: number; type: NoteTypeName; dots: 0 | 1; timeModification?: { actualNotes: number; normalNotes: number } }[];
export function fifthsForKey(key: HarmonicaKey): number;
```

**`spellPitch`:** runtime note names are always sharps (`NOTE_NAMES` in
`src/audio/HarmonicaMapper.ts:120`), so there is no spelling in the source to preserve — the
score has to *choose* one. Flat keys spell flats, sharp keys spell sharps. Without this, a
cross-harp piece on an F harp prints every B♭ as A♯. **[audit 8]**

**`decomposeSpan`:** greedy largest-first over the note-value table, with the rule that a
value may only be used at a tick position that is a multiple of its undotted length. That is
what stops a half note from starting on beat 2. Values that do not fit are tied.

- [ ] **Step 1: Write the failing harness.** Create `scripts/verify-notation.ts` with the
  `check()`/`results` shape copied from `scripts/verify-export.ts:18-22`, and these cases:

```ts
import {
  TICKS_PER_QUARTER, decomposeSpan, spellPitch, fifthsForKey,
} from '../src/notation/scoreDocument';

function decomposition(): void {
  const quarterOnBeat = decomposeSpan(0, 24, 'balanced');
  check('a quarter on the beat is one quarter note',
    quarterOnBeat.length === 1 && quarterOnBeat[0].type === 'quarter' && quarterOnBeat[0].dots === 0,
    JSON.stringify(quarterOnBeat));

  const dotted = decomposeSpan(0, 36, 'balanced');
  check('36 ticks on the beat is one dotted quarter',
    dotted.length === 1 && dotted[0].type === 'quarter' && dotted[0].dots === 1,
    JSON.stringify(dotted));

  // 48 ticks is a half note, but starting on beat 2 it cannot be written as one.
  const offBeatHalf = decomposeSpan(24, 48, 'balanced');
  check('a half-note span starting on beat 2 is written as two tied quarters',
    offBeatHalf.length === 2 && offBeatHalf.every((p) => p.type === 'quarter'),
    JSON.stringify(offBeatHalf));

  const triplet = decomposeSpan(0, 8, 'triplet');
  check('one third of a beat is an eighth with 3:2 time modification',
    triplet.length === 1 && triplet[0].type === 'eighth'
      && triplet[0].timeModification?.actualNotes === 3
      && triplet[0].timeModification?.normalNotes === 2,
    JSON.stringify(triplet));

  const total = decomposeSpan(6, 30, 'balanced').reduce((s, p) => s + p.ticks, 0);
  check('a decomposition always sums to the span it was given', total === 30, `${total} ticks`);
}

function spelling(): void {
  // MIDI 70 = A#4/Bb4. An F harp is one flat, a G harp one sharp.
  const flat  = spellPitch(70, fifthsForKey('F'));
  const sharp = spellPitch(70, fifthsForKey('G'));
  check('a flat key spells the black note as a flat',
    flat.step === 'B' && flat.alter === -1, JSON.stringify(flat));
  check('a sharp key spells the same note as a sharp',
    sharp.step === 'A' && sharp.alter === 1, JSON.stringify(sharp));
  check('C4 is middle C in octave 4',
    spellPitch(60, 0).step === 'C' && spellPitch(60, 0).octave === 4, 'C4');
}
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
npx tsx scripts/verify-notation.ts
```

Expected: fails to resolve `../src/notation/scoreDocument`.

- [ ] **Step 3: Implement `src/notation/scoreDocument.ts`** — the types above plus:

```ts
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Major-key signature of the harp itself — first position. A player in second position is
 *  still reading the harp's key signature with accidentals, which is what a transcription
 *  should show until the user says otherwise. */
const FIFTHS: Record<HarmonicaKey, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5,
};

export function fifthsForKey(key: HarmonicaKey): number { return FIFTHS[key] ?? 0; }

export function spellPitch(midi: number, keyFifths: number): ScorePitch {
  const names = keyFifths < 0 ? FLAT_NAMES : SHARP_NAMES;
  const name = names[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return {
    step: name[0],
    alter: name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0,
    octave,
  };
}

/** ticks → written value, longest first. Dotted values sit next to their undotted base. */
const VALUES: { ticks: number; type: NoteTypeName; dots: 0 | 1 }[] = [
  { ticks: 96, type: 'whole',   dots: 0 },
  { ticks: 72, type: 'half',    dots: 1 },
  { ticks: 48, type: 'half',    dots: 0 },
  { ticks: 36, type: 'quarter', dots: 1 },
  { ticks: 24, type: 'quarter', dots: 0 },
  { ticks: 18, type: 'eighth',  dots: 1 },
  { ticks: 12, type: 'eighth',  dots: 0 },
  { ticks:  9, type: '16th',    dots: 1 },
  { ticks:  6, type: '16th',    dots: 0 },
  { ticks:  3, type: '32nd',    dots: 0 },
];

/** Triplet values, used only in triplet mode: three in the time of two. */
const TRIPLETS: { ticks: number; type: NoteTypeName }[] = [
  { ticks: 16, type: 'quarter' },
  { ticks:  8, type: 'eighth'  },
  { ticks:  4, type: '16th'    },
];

export function decomposeSpan(startTick: number, ticks: number, mode: RhythmMode) {
  const out = [];
  let pos = startTick;
  let left = ticks;
  while (left > 0) {
    // A value may only be written where its own undotted length divides the position —
    // this is what keeps a half note off beat 2, which is unreadable however correct
    // its duration is.
    const base = VALUES.find((v) => {
      const undotted = v.dots === 1 ? (v.ticks * 2) / 3 : v.ticks;
      return v.ticks <= left && pos % undotted === 0;
    });
    const trip = mode === 'triplet'
      ? TRIPLETS.find((t) => t.ticks <= left && pos % t.ticks === 0)
      : undefined;
    // Prefer whichever writes more of the span in one symbol; a tie is won by the
    // plain value, which needs no bracket to read.
    const pick = base && (!trip || base.ticks >= trip.ticks)
      ? { ticks: base.ticks, type: base.type, dots: base.dots }
      : trip
        ? { ticks: trip.ticks, type: trip.type, dots: 0 as const,
            timeModification: { actualNotes: 3, normalNotes: 2 } }
        // Nothing aligned: take the smallest value that fits, so the loop always
        // terminates rather than spinning on an unwritable remainder.
        : { ticks: Math.min(3, left), type: '32nd' as NoteTypeName, dots: 0 as const };
    out.push(pick);
    pos  += pick.ticks;
    left -= pick.ticks;
  }
  return out;
}
```

- [ ] **Step 4: Run the harness.**

```bash
npx tsx scripts/verify-notation.ts
```

Expected: all cases PASS.

- [ ] **Step 5: Commit.**

```bash
git add . && git commit -m "feat: score document model with key-aware pitch spelling"
```

---

## Task 4: The quantizer

**Files:** Create `src/notation/quantize.ts`; Modify `scripts/verify-notation.ts`

**Interfaces produced:**

```ts
export interface ScoreSettings {
  bpm: number;
  /** Where bar 1 beat 1 sits on the recording's millisecond clock.
   *
   *  Not zero by default. A take keeps its leading silence (commit 07e94de), and the beat
   *  offset is only removed from the notes when the user presses Detect
   *  (`applyTempoEstimate`, useAppStore.ts:172). Defaulting to the first audible onset means
   *  an un-detected recording starts at the music instead of six empty bars — a capture
   *  artifact is not an anacrusis. `buildScoreDocument` fills this in when it is omitted. */
  originMs?: number;
  beats: number;      // default 4
  beatType: number;   // default 4
  rhythmMode: RhythmMode;
  title?: string;
}

export function buildScoreDocument(parts: ExportPart[], settings: ScoreSettings): ScoreDocument;
```

**Algorithm, per part:**

1. `groupSimultaneous` (from `tabText.ts`) collapses near-simultaneous onsets into chords,
   using the same 50 ms window TXT already uses — so a strum is a chord in both formats.
2. `voicingOf` gives the group its printed tab token.
3. Onset and end are quantized to `GRID_TICKS[mode]` **independently**, then the duration is
   floored at one grid unit.
4. An onset that lands before the previous group's end truncates that group
   (`overlapTruncated` warning) — the score is monophonic-per-voice in this release.
5. Gaps become rests.
6. Spans are split at bar lines, and the pieces tied.
7. `decomposeSpan` writes each piece; the second and later pieces carry `tieStop`, and every
   piece but the last carries `tieStart`. Only the first piece carries the tab token — a tab
   printed again under a tied continuation reads as a second attack.
8. A group whose quantized onset moved more than half a grid unit records an `onsetMoved`
   warning, so the view can say the score is an approximation.

- [ ] **Step 1: Add the failing cases** to `scripts/verify-notation.ts`:

```ts
import { buildScoreDocument } from '../src/notation/quantize';

const at = (id: string, tab: string, note: string, start: number, duration: number): TabNote =>
  ({ id, tab, note, start_time: start, duration, confidence: 100 });

function quantizerCases(): void {
  // 120 BPM: a quarter note is 500 ms, a bar is 2000 ms.
  const s = { bpm: 120, originMs: 0, beats: 4, beatType: 4, rhythmMode: 'balanced' as const };

  const four = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 0, 500), at('b', '-4', 'D4', 500, 500),
                at('c', '5', 'E4', 1000, 500), at('d', '-5', 'F4', 1500, 500)], 'C', 'diatonic'),
    s,
  );
  const m = four.parts[0].measures;
  check('four quarter notes fill exactly one measure',
    m.length === 1 && m[0].elements.length === 4
      && m[0].elements.every((e) => e.type === 'quarter' && e.dots === 0),
    `${m.length} measure(s), ${m[0]?.elements.length} elements`);

  check('the measure carries the session tempo, not a hard-coded 120',
    buildScoreDocument(singlePart([at('a', '4', 'C4', 0, 1000)], 'C', 'diatonic'),
      { ...s, bpm: 90 }).parts[0].measures[0].tempoBpm === 90,
    'tempo threaded through');

  const gap = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 0, 500), at('b', '5', 'E4', 1500, 500)], 'C', 'diatonic'), s);
  const els = gap.parts[0].measures[0].elements;
  check('a gap between notes becomes a rest of the right length',
    els.length === 3 && els[1].pitches.length === 0 && els[1].durationTicks === 24,
    els.map((e) => `${e.pitches.length ? 'note' : 'rest'}:${e.durationTicks}`).join(' '));

  // Starts on beat 4 and runs 1000ms — half in this bar, half in the next.
  const across = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 1500, 1000)], 'C', 'diatonic'), s);
  const bars = across.parts[0].measures;
  const first = bars[0].elements.filter((e) => e.pitches.length > 0);
  const second = bars[1].elements.filter((e) => e.pitches.length > 0);
  check('a note crossing the bar line is split and tied',
    bars.length === 2 && first.at(-1)?.tieStart === true && second[0]?.tieStop === true,
    `${bars.length} bars`);
  check('a tied continuation does not repeat the tab',
    second[0]?.tab === '' && first.at(-1)?.tab === '4', `"${second[0]?.tab}"`);

  const chord = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 0, 500), at('b', '5', 'E4', 20, 500)], 'C', 'diatonic'), s);
  const ch = chord.parts[0].measures[0].elements[0];
  check('onsets inside the chord window become one chord element',
    ch.pitches.length === 2 && ch.sourceIds.length === 2 && ch.tab === '45',
    `${ch.pitches.length} pitches, tab "${ch.tab}"`);

  const late = buildScoreDocument(
    singlePart([at('a', '4', 'C4', 8000, 500)], 'C', 'diatonic'),
    { bpm: 120, beats: 4, beatType: 4, rhythmMode: 'balanced' });
  check('leading silence is not written as empty bars',
    late.parts[0].measures.length === 1, `${late.parts[0].measures.length} measure(s)`);

  const src = [at('a', '4', 'C4', 137, 490)];
  buildScoreDocument(singlePart(src, 'C', 'diatonic'), s);
  check('quantizing never edits the source notes',
    src[0].start_time === 137 && src[0].duration === 490,
    `${src[0].start_time}/${src[0].duration}`);
}
```

- [ ] **Step 2:** Run it; expect failures on the unresolved import.

- [ ] **Step 3:** Implement `src/notation/quantize.ts` to the algorithm above.

- [ ] **Step 4:** `npx tsx scripts/verify-notation.ts` — all PASS.

- [ ] **Step 5:** Commit: `feat: non-destructive rhythm quantizer for the score document`.

---

## Task 5: MusicXML from the score document

**Files:** Create `src/notation/musicXml.ts`; Modify `src/export/generators.ts`,
`scripts/verify-export.ts`

Everything the old generator got wrong, in one place: real tempo, chords, ties, rests
measured correctly, dotted values, key signature, and the tab under each note as a lyric.

```xml
<lyric number="1"><syllabic>single</syllabic><text>-4'</text></lyric>
```

`generateMusicXml(parts, options)` becomes
`scoreToMusicXml(buildScoreDocument(parts, settingsFrom(options)))`.

- [ ] **Step 1:** Extend `scripts/verify-export.ts` with a `musicXmlScoreFeatures()` case
  asserting, on a fixture with a chord, a bar-crossing note and a gap: `<per-minute>` equals
  the passed BPM; a `<chord/>` element is present; `<tie type="start"/>` and
  `<tie type="stop"/>` are present; every measure's `<duration>` values sum to
  `divisions * 4`; a `<lyric>` carries the tab token. Register it in `main()`.

- [ ] **Step 2:** Run `npx tsx scripts/verify-export.ts`; expect the new case to FAIL and the
  existing 42 to PASS.

- [ ] **Step 3:** Implement `src/notation/musicXml.ts` and reduce `generateMusicXml` to the
  adapter. Keep `xmlText()` escaping, and keep the part-name strings exactly as they are —
  `verify-export.ts` asserts `Melody (C harp)` and `<part-name>Harmonica</part-name>`.

- [ ] **Step 4:** Run both harnesses. Expected: `verify-export.ts` all green including the new
  case, `verify-notation.ts` unchanged.

- [ ] **Step 5:** Commit: `feat: MusicXML from the score document — tempo, chords, ties, tabs`.

---

## Task 6: Thread the session BPM through export

**Files:** Modify `src/export/generators.ts`, `src/app/edit.tsx:1356,1369`,
`src/app/export.tsx:78,93,121`

```ts
export interface ExportOptions { bpm?: number; rhythmMode?: RhythmMode }
export function generateForFormat(
  parts: ExportPart[], format: ExportFormat, options: ExportOptions = {},
): GeneratedFile;
```

The default is `DEFAULT_BPM` (100, `src/audio/tempo.ts:14`) rather than the old hard-coded
120 — a two-argument call is a caller that has no tempo to offer, and 100 is what a fresh
session actually runs at. The editor and export screen both hold `bpm` in the session store
and pass it. **[audit 6]**

- [ ] **Step 1:** Add the parameter, defaulting so every existing two-argument call compiles.
- [ ] **Step 2:** Pass `{ bpm }` from the three call sites, reading `bpm` from
      `useAppStore((s) => s.bpm)`.
- [ ] **Step 3:** `npx tsx scripts/verify-export.ts && npx tsc --noEmit && npx expo lint`.
- [ ] **Step 4:** Commit: `feat: exported MusicXML uses the session tempo`.

---

## Task 7: OSMD spike (web only, timeboxed)

**Timebox: one working session.** The spike is here, not first, because Tasks 2–6 are
renderer-independent and would survive any outcome. **[audit 11]**

- [ ] Add `opensheetmusicdisplay@^1.9.0`. Confirm `npx expo export --platform web` succeeds
      and that the OSMD chunk is *not* in the entry bundle (it is behind `await import()`).
- [ ] Engrave a generated fixture into a `<div>` obtained from a react-native-web `View` ref —
      RN Web renders a `View` as a real `div`, which is what makes OSMD usable without a
      WebView.
- [ ] Confirm Bravura loads from the bundled package with no network request.
- [ ] Extract the rendered `<svg>` via `outerHTML`.
- [ ] Establish the notehead → `ScoreElement.sourceIds` mapping (OSMD's
      `GraphicalNote.sourceNote` chain), and confirm it survives a re-render.
- [ ] Measure engrave time and memory on a 500-note fixture.
- [ ] **Record the outcome in a Status section in this file**, including the fallback
      decision. If OSMD fails, the fallback is **not** VexFlow-as-drop-in: VexFlow has no
      line-breaking or page layout, so choosing it means owning engraving layout. Price
      rendering `ScoreDocument` straight to `react-native-svg` (already a dependency at
      15.15.3) at the same time, since that is the only option that would later give native
      the same renderer.

---

## Task 8: `src/notation/render/osmd.web.ts`

Wraps the spike's findings: lazy load, engrave a `ScoreDocument` (via its MusicXML) into a
host element, expose `svgString()`, `highlight(sourceId)`, `onNoteClick(cb)`, and `dispose()`.
Highlighting and selection must not re-engrave.

---

## Task 9: The Score view

`viewMode` becomes `'list' | 'pianoRoll' | 'score'` in `src/store/useAppStore.ts:70,130` and
`src/app/edit.tsx`. Read-only in this release; List and Piano Roll stay the editing surfaces.
Includes: empty/loading/error states, a rhythm-mode selector, a tabs toggle, a warning banner
fed by `ScoreDocument.warnings`, refresh on edit, click-a-note-to-select, click-to-seek, and
playback highlighting. The view reads the same filtered note set the rest of the editor does,
so notes hidden by `noiseGate`/`durationFloorMs` are absent from the score too.

On native the segment is not rendered; the editor keeps two views.

---

## Task 10: SVG, PDF and PNG from the canonical SVG

- **SVG:** OSMD's own output, with Bravura embedded as a base64 `@font-face` in a `<style>`
  block. Without that the file renders as empty boxes anywhere but this app — and the PNG
  path inherits the same problem, because an `<img>` pointed at an SVG will not fetch an
  external font.
- **PDF:** on web, print-to-PDF from a hidden paginated document containing the SVG pages.
  `expo-print` is a native module and is not used. **[audit 5]**
- **PNG:** draw the embedded-font SVG onto a `<canvas>` at 1×/2×/3× and `toBlob()`. White
  background by default. One PNG per page.
- Multi-page delivery: sequential `triggerWebDownload` calls, one per page, with
  page-numbered filenames from `exportFileName()`. No ZIP until a user asks for one.

---

## Task 11: Export UI

Score formats are a **second lane**, exactly as audio formats already are: `ExportFormat`
stays the five text formats, and `src/export/scoreFormats.ts` mirrors
`src/export/audioFormats.ts` with `isScoreFormat()` and a `SCORE` section appended by
`tabExportSections()` on web. This is what keeps the one-string `GeneratedFile` contract
intact — a multi-page PNG export cannot be expressed as `{ content: string }`. **[audit 4]**

Controls: rhythm mode, include tabs, title/metadata, page size and orientation, PNG scale,
and a preview that uses the same `ScoreDocument` and renderer configuration as the export.

---

## First-release acceptance criteria

- Score is a third editor view **on web**; native still shows two.
- Standard treble-clef notation with Harp2Tab tokens aligned under the notes.
- Preview and every export share one `ScoreDocument` and one renderer configuration.
- Quantization at any rhythm mode leaves `TabNote.start_time` and `duration` untouched.
- The session BPM appears in the score and in exported MusicXML.
- Rests, chords, dotted values and bar-crossing ties are correct, and every measure's
  durations sum to a full bar.
- Playback highlighting stays in sync without re-engraving.
- SVG, PDF and PNG open correctly outside the app, with notation glyphs intact.
- `scripts/verify-export.ts` and `scripts/verify-notation.ts` both pass.

## Explicit first-release limits

- **Web only.** Native score view and score exports are follow-up scope.
- 4/4 only for tab recordings; the model carries per-measure meter so this can be lifted.
- No direct editing on the staff.
- Triplets are a rhythm mode the user chooses, never inferred; no swing interpretation, and
  triplet groups are written per note without beam brackets.
- Overlapping polyphony beyond a chord is truncated with a warning, not engraved as multiple
  voices.
