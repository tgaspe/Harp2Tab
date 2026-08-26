# Spike: MelodyT5 segmentation for the TXT tab export

**Status:** proposed, not started · **Type:** throwaway experiment, no production code
**Question:** does MelodyT5's `%%segmentation` phrase a harmonica tab better than the shipped
timing heuristic — and specifically, does it work where the heuristic structurally cannot?

## Why

The TXT export now breaks lines at phrase boundaries inferred from timing alone
(`src/export/phrasing.ts`). Measured against three real tabs, it holds up on two and collapses
on the third:

| tab | character | heuristic result |
|---|---|---|
| Evidencias (407 notes) | live, expressive ballad | good — 62 lines, median 6, 2 forced wraps |
| Ode to Joy (93 notes) | live, slow, legato | acceptable — real 4-note bars found |
| Loch Lomond (275 notes) | **quantized**, rests all 6–8 ms | fails — median line 11, 15 forced wraps |

Loch Lomond is the finding that motivates this. Its output is **byte-identical across twelve
different parameter combinations** (window 3–4 × dominance 0.5–0.8 × floor percentile 70–85).
The parameters do nothing because the signal is gone: four distinct note durations, no rests.
No tuning fixes that.

The heuristic reads only *when* notes start and how long they last. It is blind to pitch.
Loch Lomond has perfectly legible melodic structure — repeated motifs, cadences — that the rule
cannot see by construction. MelodyT5 reads the notes. That is a different class of information,
not a better threshold.

Two of the three tabs (Loch Lomond, Ode to Joy) are very likely *inside* MelodyT5's training
distribution (abcnotation.com, KernScores, folk corpora). Evidencias — Brazilian sertanejo — is
not. So the model should be strongest exactly where the heuristic is weakest, which argues for a
hybrid as much as a replacement.

## What the model expects

Confirmed against a real MelodyHub training row (`sander-wood/melodyhub`, row ~615000):

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

Three things matter here:

1. The mark is `!breath!`, and it attaches to the **last note of the phrase** (it derives from
   chorale fermatas, which sit *on* the phrase-final note). So the line break goes *after* the
   marked note, not before it.
2. The body is otherwise reproduced unchanged — which is what makes mapping back to `TabNote`
   indices possible at all, and is the first thing to verify.
3. `E:` is the edit-distance control code and can be prefilled to steer output.

`prompt.txt` is parsed as `%%input\n%%<task>\n<abc>\n%%output\n<optional prefill>`
(`inference.py:50-56`).

## Success criteria

Fixed now, before running, so results aren't rationalised afterwards.

1. **Notes must be preserved exactly** — only `!breath!` added. If the model rewrites pitches or
   rhythms, the approach is unusable for an exporter regardless of how good the phrasing is.
   Hard fail.
2. **Loch Lomond must improve** — the heuristic finds essentially no boundaries there (15 forced
   wraps). Anything less than a clear improvement means the pitch signal isn't buying what we
   think it is.
3. **Repeated material must phrase consistently** — the bug that drove the heuristic's redesign.
4. **It must look right to a harmonica player.** Theo's judgment. 1–3 are necessary conditions;
   this is the actual criterion.

## Steps

### Step 0 — Get the model running (gate, ~1 h)

Everything happens in a scratch directory. Nothing enters the harp2tab repo.

- Clone `sanderwood/melodyt5`; Python 3.11 venv; `pip install torch transformers unidecode
  samplings`. **Ignore the README's Python 3.7.9 and CUDA pins** — the only heavy imports are
  `GPT2LMHeadModel` / `GPT2Config` / `EncoderDecoderModel`, whose APIs are stable, and
  `inference.py` already falls back to CPU when CUDA is absent.
- Download `weights.pth` (~450 MB) from `sander-wood/melodyt5`.
- Run the shipped `prompt.txt` (a `%%variation` example) unchanged — confirms the model loads
  and emits coherent ABC.
- Then run `%%segmentation` on a **known-good Loch Lomond ABC from abcnotation.com**. This is
  in-distribution and tells us what "good" looks like before any of our data is involved.

**Gate:** if the model isn't producing sane segmented ABC within about an hour, stop and report.
Everything downstream is wasted otherwise.

### Step 1 — TabNote → ABC (the real work)

The model needs a quantized score. Our notes are millisecond onsets and durations.

- **Tempo:** reuse `detectTempo` (`src/audio/detectTempo.ts:233`) — already exists, needs only
  `start_time`.
- **Rhythm:** quantize durations against that tempo to eighths/sixteenths; emit `L:1/8`, `M:4/4`.
- **Pitch:** convert the `note` field (`"A#4"`) to ABC pitch with octave marks (`^A`).
- **Rests:** gaps become `z`.
- **Key:** take it from the JSON `key` field, but note the inaccuracy — the *harp* key is not the
  tune's key (a Bb harp in 2nd position plays in F). Record this as a known error source rather
  than pretending it's right.

Written as `scripts/spike-tab-to-abc.ts`, explicitly labelled throwaway.

**Validate before proceeding:** paste each generated ABC into <https://abc.rectanglered.com/> and
check it sounds like the tune. If Evidencias' ABC doesn't, that is itself the headline finding —
it means the blocker is our quantization, not the model, and no inference service fixes it.

### Step 2 — Segment and map back

- Build `prompt.txt` per the format above; try with and without an `E:` prefill.
- Run with a fixed `-seed` and `-num_tunes 3`. The default temperature of 2.6 is high, so also
  try lower values — output is otherwise nondeterministic.
- Parse `!breath!` positions, count notes preceding each, break *after* the marked note.
- Map the nth ABC note to the nth `TabNote`. Only valid if criterion 1 holds — assert it.

### Step 3 — Compare

Render both phrasings as TXT, side by side, for all three tabs. Report lines, median length,
forced wraps, and consistency across repeated material — the same measurements already taken for
the heuristic, so the comparison is like-for-like. Then look at them.

### Step 4 — Report

Findings and a recommendation, one of: **adopt** (justifies building the Python service),
**hybrid** (model only where timing is degenerate — the quantized/MIDI case, which is also the
cheap case since that input is already quantized), or **drop**.

## Risks

- **Model rewrites notes** → hard fail. Detected in step 0, cheaply.
- **ABC quality gates everything.** The most likely failure mode, and it is our problem, not the
  model's. Step 1's listening check exists to catch it before it contaminates the result.
- **Wrong key or meter** → the model sees a different tune than was played.
- **Sampling nondeterminism** at temperature 2.6 → fixed seed, three samples.
- **Length:** 256 patches × 64 chars ≈ 16 k chars input, and `-max_patch 128` bounds output.
  Evidencias' ABC should be well under, but check rather than assume.

## Out of scope

No Cloud Run, no service, no app integration, no dependency added to harp2tab. This spike buys
an answer, not code.

Separately and independently: two real bugs surfaced in the heuristic while gathering this data —
a leading one-note line never merges (the stray `-4,` opening Ode to Joy), and genuinely adjacent
boundaries get swallowed by the dominance window. The dominance-ratio fix takes Loch Lomond from
15 forced wraps to 1 and slightly improves Evidencias. Worth landing whatever this spike concludes.
