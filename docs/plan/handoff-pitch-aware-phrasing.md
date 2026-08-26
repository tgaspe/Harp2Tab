# Handoff: pitch-aware phrasing, validated against MelodyHub

Paste this into a clean session to continue the work.

---

## Goal

The TXT tab export in harp2tab breaks lines at musical phrase boundaries, inferred by a
heuristic in `src/export/phrasing.ts`. That heuristic reads **only timing** — when notes start
and how long they last — and is structurally blind to pitch. Build a **pitch-aware** version and
measure it properly against the **MelodyHub segmentation subset**, which is ~35,000 melodies
with human-annotated phrase boundaries.

The target: get good enough that we can skip a 177M-parameter model and a Python service.

## Repo

`/Users/theo/harp2tab`, branch `web_version`. Expo/React Native + web. Read `AGENTS.md` first.
No test runner — the convention is `npx tsx scripts/verify-*.ts` with a `check(name, passed,
detail)` harness. See `scripts/verify-export.ts`.

## Current state (all uncommitted)

| file | what |
|---|---|
| `src/export/phrasing.ts` | the heuristic — NEW |
| `src/export/generators.ts` | modified: `tabLines` uses `groupIntoPhrases`, renders trailing commas |
| `scripts/verify-phrasing.ts` | 14 passing cases |
| `scripts/spike-tab-to-abc.ts` | TabNote→ABC converter w/ grid + key detection (spike quality) |
| `docs/plan/spike-melodyt5-segmentation.md` | the MelodyT5 spike plan + results |

Test data: `~/Downloads/{Evidencias,Ode_To_Joy_C,chart_loch_lomond,house_of_the_rising_sun}.json`
— all four are **MIDI-derived** JSON exports (v1 shape: `{version, key, harmonicaType, notes}`).

## How the current heuristic works

A phrase boundary is a **local maximum of boundary strength**, not a threshold crossing.
`strength[i] = rest[i] + max(0, duration[i] - medianDuration)`. A boundary must exceed its
neighbours within ±3 notes. Then: orphan single-note lines merge back, and any phrase over 12
notes is force-split at its largest internal gap.

Fixed thresholds were tried first and **fail** — measured on a real 407-note tab, the gap
distribution is a smooth continuum with no natural dividing line, so any fixed threshold lands
in dense territory and coin-flips on near-identical gaps. That made the same melodic phrase
break in one repeat and not the next. Don't reintroduce fixed thresholds.

## Two known bugs, unfixed, worth landing first

1. **Leading one-note line never merges.** The orphan merge only looks backward, so a
   single-note first phrase is stranded (visible as a stray `-4,` opening Ode to Joy). Merge
   forward when it's the first phrase.
2. **Adjacent real boundaries get swallowed.** The ±3 window suppresses a genuine peak when a
   larger one sits within 3 notes (measured case: strength 490 suppressed by a 604 two notes
   later — both real). Fix is a dominance ratio: require a strict local max at ±1 **and**
   `strength[i] >= 0.6–0.7 × max(strength in ±window)`. Measured effect: Loch Lomond goes from
   **15 forced wraps to 1**, Evidencias slightly improves.

## What's already been established — don't re-derive

- **The heuristic wins on 3 of 4 test songs; it fails completely on one.** Loch Lomond produced
  **byte-identical output across 12 parameter combinations** (window 3–4 × dominance 0.5–0.8 ×
  floor percentile 70–85). Its rests are all 6–8 ms and it has 4 distinct durations. There is no
  timing signal to tune against. **This is the case pitch has to solve.**
- **MelodyT5 was tested and works**: notes preserved exactly, ~2.3 s/tune on CPU, and prefilling
  the `E:8` control code makes output deterministic (otherwise `E:` is sampled and granularity
  varies by seed). It beat the heuristic on Loch Lomond, and **lost** to it on House of the
  Rising Sun. So the model is a fallback for one input class, not a replacement.
- **Grid detection matters enormously.** Correct grids per file: 1/4 (Ode to Joy), 1/16 (Loch
  Lomond), 1/16 (Evidencias), 1/8 (House). A hardcoded 1/16 shredded Ode to Joy's conversion.
- **Tempo needs refining, not just detecting.** `detectTempo` was 2% out on Evidencias — under
  half a grid unit per bar, but more than a whole unit across a 20 s window, which destroys any
  measurement. Refining the grid spacing directly lifted fit 0.18 → 0.51.
- **Measure over sliding windows, not globally.** Live performances drift; a global measurement
  collapses to noise even when every local passage is cleanly quantized.
- **The harp key is not the tune's key.** A Bb harp in 2nd position sounds in F. Detected keys:
  G (Loch, C harp), F (Evidencias, Bb harp), Am (House, C harp). Krumhansl-Kessler profiles work.
- **The JSON export throws away tempo and meter that `midiToNotes.ts` already parsed** (it reads
  every tempo change and the time signatures — `src/audio/midiToNotes.ts:41-44`). Adding those to
  the export would remove a whole category of guessing. House of the Rising Sun is really in 6/8
  and has been segmented against a hardcoded 4/4 this whole time.
- **The audio-recording path has never been tested.** All four files are MIDI imports.

## MelodyHub: the validation corpus

Dataset `sander-wood/melodyhub` on HuggingFace, 1,055,046 rows, fields
`dataset / task / input / output`. Rows are grouped by task alphabetically; **segmentation sits
at roughly offsets 605,000–640,000** (~35k rows). Fetch via the datasets-server:

```
https://datasets-server.huggingface.co/rows?dataset=sander-wood%2Fmelodyhub&config=default&split=train&offset=615000&length=5
```

Format (real row, JSB Chorales):

```
input:   %%segmentation
         L:1/4
         M:4/4
         K:F
         E | ^F/ G F/ G/A/ B | A3/2 G/ ^F2 | z ^F G =F | ...

output:  E:8
         L:1/4
         M:4/4
         K:F
          E | ^F/ G F/ G/A/ B | A3/2 G/ !breath!^F2 | z ^F G =F | ...
```

**Critical:** `!breath!` attaches to the **last note of the phrase** — it derives from chorale
fermatas, which sit *on* the phrase-final note. So the boundary goes **after** the marked note.
Get this backwards and every boundary is off by one phrase.

Annotation sources: Humdrum curly braces (KernScores, Meertens Tune Collections) and JSB Chorale
fermatas. Reference scores on this data: MelodyT5 **F1 0.9055**, Bi-LSTM-CRF baseline **0.8400**.

## Plan

1. **Land the two known bugs** above, with cases in `scripts/verify-phrasing.ts`. Establishes a
   clean baseline.
2. **Write an ABC → TabNote converter** — the inverse of `scripts/spike-tab-to-abc.ts`, which
   already has the pitch-spelling and duration logic to mirror. Parse `L:`/`M:`/`K:`, walk note
   tokens, emit `start_time`/`duration` in ms at an assumed tempo. Handle ties, rests, and
   accidental-persists-to-end-of-bar.
3. **Build the harness**: pull N segmentation rows, convert each to `TabNote[]` plus a
   ground-truth list of boundary note-indices, run `groupIntoPhrases`, and report
   **precision / recall / F1** on boundary positions. That's the first real accuracy number in
   this investigation — everything so far has been eyeballing four songs.
4. **Add pitch.** The current rule is two of the three profiles in Cambouropoulos' LBDM (Local
   Boundary Detection Model): rest and inter-onset interval. The missing one is **pitch
   interval** — large melodic leaps mark boundaries. Also worth trying: contour reversal, and
   repeated-motif/self-similarity detection, since Loch Lomond repeats a 4-phrase group verbatim.
5. **Jitter experiment.** MelodyHub melodies are perfectly quantized — the Loch Lomond case. Add
   controlled timing noise and measure where each profile earns its keep: at what humanization
   does timing start beating pitch, and where does the pitch-blind version fall over?
6. **Re-check the four real songs.** MelodyHub is folk and chorale melodies, not harmonica
   arrangements, and none of it exercises the real pipeline. Corpus F1 is necessary, not
   sufficient.

## Guardrails

- Report numbers, not impressions. Every claim in this document came from a measurement.
- Beware overfitting: each of the four songs so far exposed a *structural* bug, not a bad
  constant. Expect the same from the corpus.
- Keep spike code labelled and out of `src/`. The grid detector is the exception — it's worth
  promoting to `src/audio/` regardless, since it improves the MusicXML export too.
