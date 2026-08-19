# Phase 16 — HSA v2 replaces the spectral engine, with re-attack segmentation

*Part of the [Harp2Tab implementation plan](README.md).*

Phase 14 built the spectral engine around one objective: the lowest octave-error rate of the
three engines. It met that goal by construction — candidates restricted to the harp's own
range, two-way mismatch, a separate octave-evidence probe — and it is being replaced anyway,
because a better polyphonic algorithm now exists outside this repo.

`HSA_v2_polyphonic.ipynb` (`/Users/theo/audio_analysis/`) is a CQT-based harmonic-summation
detector with iterative cancellation, developed and measured against real harmonica takes
with known answers. This phase ports it into `src/audio/` as the offline polyphonic engine
and deletes the spectral engine outright.

It also closes a gap that neither engine has ever addressed. **pMPM is the only engine in the
app that can hear the same note played twice.** Not because its pitch tracking is better —
it is monophonic and coarser — but because `NoteDetector` carries an amplitude-envelope
re-attack detector (`NoteDetector.ts:79`) that splits a run when the RMS dips and recovers,
even when the pitch never changes and never gates to silence. Both note-lane engines
(Basic Pitch, spectral) write a tongued repeat as one long note. This phase gives HSA v2
that detector.

### Settled by Theo, 2026-08-19

1. **HSA v2 replaces the spectral engine wholesale.** The octave probe, the `octaveEvidence`
   control and the `PLAYABLE_MIDI_RANGE` candidate restriction all go with it. HSA v2 treats
   octave splits as out of scope (notebook §9 measures the excess as real but modest, and
   concludes exploiting it costs more than it returns), and that trade is accepted here.
2. **The re-attack detector is global.** One broadband RMS envelope for the take; a confirmed
   re-attack ends and restarts *every* note currently sounding, bypassing gap-bridging.
   Exactly what pMPM does. A harmonica double-stop is articulated by one breath, so both
   notes of a chord genuinely do re-attack together. The accepted risk is a melody re-attack
   over a sustained drone splitting the drone too — rare on a diatonic harp.
3. **The CQT is vendored, not written.** See the measurement section below.
4. **The re-attack constants are re-tuned against synthesised material** in the notebook
   before being carried into TypeScript. They cannot be copied across — see 16-5.
5. **`cancel_factor` stays a constant.** Every other tuning knob becomes a cheap-half
   parameter; that one would require retaining the CQT, and it is not a concept a player can
   reason about.

### What HSA v2 is

Framing, from notebook cell 3, all pinned to 44.1kHz:

| | |
|---|---|
| Sample rate | 44,100 (resampled — see 16-2) |
| Hop | 512 samples = **11.61ms** |
| RMS frame (voicing gate only) | 1024 samples |
| Bins per octave | 24 (quarter-tone) |
| `fmin` | `180 / 2^(1/12)` = **169.897Hz** |
| `n_bins` | 152, to `min(3200 · 4 · 2^(1/12), 0.99 · sr/2)` ≈ 13.56kHz |
| Q | `1/(2^(1/24) − 1)` = **34.13** |
| F0 search | 180–3200Hz, ~100 candidate bins |
| Harmonics | 4, offsets `[0, 24, 38, 48]` bins, weights `0.84^k` |
| Voicing gate | frame RMS > −20dB relative to the take's max |

Per frame: harmonic-sum salience over the CQT column, take the argmax, parabolic-interpolate
it, cancel the winner's partials from the residual, repeat up to 4 times. A voice after the
first is admitted only if it scores ≥ `rel_threshold` (0.60) × the first voice's salience.
Cancellation is *envelope* mode — fit a `β` rolloff through the winner's four partials in
log-log, clip `β` to [0, 3], subtract `cancel_factor` (0.85) × that model with a ±1-bin
triangular taper, clamp at zero. Bins within `min_separation_bins` (3, = 1.5 semitones) of an
accepted voice are masked out for the rest of the frame.

The Q value is the single most consequential number and it is easy to miss: at 24 bins/octave
the effective analysis window runs from **8,858 samples (201ms) at 170Hz down to 111 samples
(2.5ms) at 13.6kHz**. The 512-sample hop oversamples the low end heavily. This is why the
re-attack detector is not a nice-to-have — the pitch track physically cannot resolve a fast
repeated low note, while the 1024-sample RMS envelope can.

### The CQT: measured before deciding, 2026-08-19

The original plan for this phase was a hand-written multirate octave-wise CQT, on the
assumption that no usable JavaScript CQT exists. That assumption was wrong and was checked
rather than trusted.

Surveyed and rejected:

- **essentia.js** — `ConstantQ`, `NSGConstantQ` and `NSGIConstantQ` are all on its published
  excluded-algorithms list. The WASM build does not contain them.
- **showcqt** (LGPL) — the ffmpeg visualiser. Emits an RGBA canvas buffer over a fixed
  E0–E10 range with no configurable bins-per-octave. Not a transform you can read bins from.
- **@audio/spectral-cqt** — 34 lines: a per-bin windowed DFT with `Math.cos`/`Math.sin` in the
  inner loop, one frame per call, no FFT. ~13 billion transcendental calls on a five-minute
  take at our config. Its own header scopes it to "log-frequency display".

**`cqt-web`** (MIT, zero dependencies, 162KB as `cqt.js` + `cqt.wasm`) exposes
`StandardCQT` / `HybridCQT` / `PseudoCQT` / `VQT` against librosa's four corresponding
functions, taking exactly the five parameters this phase needs. Measured against
librosa 0.11.0 at the config above, then fed to the notebook's own `compute_hsa_v2_poly` and
scored on frame-wise detected pitch sets for `34Blow.wav`:

| variant | vs `librosa.cqt` bin magnitudes | est. 5-min take | HSA v2 pitch sets |
|---|---|---|---|
| `StandardCQT` | 0.8% median, 2.2% p90 | **~134s** | 603/603 frames identical |
| `HybridCQT` | 3.7% median, 37.9% p90 | **~5–9s** | **603/603 frames identical** |
| `PseudoCQT` | 96.9% median | ~23s | not evaluated |

Magnitude errors are over energy-carrying bins (> 5% of peak) on a 10s synthetic signal; the
pitch-set column is `34Blow.wav`, a real double-stop take whose answer is in its filename.
Frame counts matched librosa exactly on every signal tested (173, 862 and 603 frames), as did
Q (34.13).

`HybridCQT`'s p90 looks disqualifying until the control is run: **librosa's own `cqt` and
`hybrid_cqt` differ by 40.3% p90 on the same signal**, and also produce 100% identical HSA v2
output. The disagreement lives in low-energy bins that a four-harmonic weighted sum never
leans on. `HybridCQT` is therefore both the fast variant and, for this algorithm,
indistinguishable from the reference.

**Decision: vendor `cqt-web` and use `HybridCQT`.** `StandardCQT` is accurate and 25× too
slow. Writing our own is unnecessary work whose only remaining benefit is native support,
which this phase does not have anyway (below).

### What this costs

- **The engine becomes web-only.** WASM does not run under Hermes, so `hsa.ts` is an
  `available: false` stub and `hsa.web.ts` is the real one — the same split
  `basicPitch.ts` / `basicPitch.web.ts` already uses. The spectral engine it replaces ran on
  both bundles and was the only polyphonic engine native could ever have run. **After this
  phase, native has pMPM and nothing else.** That is consistent with the web-first rule, and
  it is a real narrowing that Phase 15 now inherits.
- **We own a WASM blob we cannot patch.** Vendored rather than depended on: `cqt-web` has 56
  downloads/month, one maintainer, and all five of its versions were published on a single
  day in December 2025. Two files and zero dependencies make vendoring cheap, and it removes
  registry supply-chain exposure, pins the exact binary that was measured, and lets the wasm
  be bundled rather than fetched at runtime.
- **The verification harnesses need a shim.** The published build is compiled
  `-sENVIRONMENT=web,worker` and asserts `!ENVIRONMENT_IS_NODE` on load, so it throws under
  `tsx`. A four-line shim — set `globalThis.window`, delete `globalThis.process`, pass
  `wasmBinary` explicitly — makes it load in Node; this is how the table above was produced.
  It depends on emscripten internals and belongs in one place, behind `CqtAnalyzer`.

### Licensing

`cqt-web` is MIT. `src/audio/dsp/vendor/PROVENANCE.md` records the package name, exact
version, source URL, retrieval date, the full MIT text, and why `HybridCQT` was chosen over
`StandardCQT`. This is the second vendored component in `src/audio/` — the aubio segmenter
port declares its own provenance at `segmenters/aubioNotesSegmenter.ts:1` — and it follows the
same rule: say where it came from, in the file.

---

## 16-1 · The CQT wrapper — `src/audio/dsp/cqt.ts`

Vendored assets land at `src/audio/dsp/vendor/cqt.js`, `cqt.wasm`, `PROVENANCE.md`. Nothing
outside `cqt.ts` imports them.

```ts
export interface CqtConfig { sampleRate: number; hop: number; binsPerOctave: number;
                             nBins: number; fmin: number; }
export interface CqtResult { nBins: number; frameCount: number; data: Float32Array; }
export class CqtAnalyzer {
  static create(config: CqtConfig): Promise<CqtAnalyzer>;
  analyze(samples: Float32Array, options?: PrepareOptions): Promise<CqtResult>;
  dispose(): void;
}
```

`data` is row-major `frame * nBins + bin`, matching what the WASM module returns.

**Chunking is the load-bearing part.** `compute()` is a single blocking WASM call — 5–9
seconds on a five-minute take with the stack never unwinding, so no progress bar moves, no
Cancel is delivered, and the page does not paint. `computeWithProgress` does not help: its
callback runs inside the same stack. So `analyze()` slices the input into ~10s chunks with
0.25s of left context (the longest filter is 8,858 samples ≈ 0.2s), trims the contaminated
leading frames from every chunk after the first, and `await`s `setTimeout(0)` between them —
the same `yieldToEventLoop` idiom `analyzeSamples.ts:47` already uses. Progress and
cancellation then work exactly as they do for every other engine.

The chunk boundary is the one place this can silently produce wrong numbers, so it is the
first assertion in the harness: **chunked output must equal whole-file output**, bit for bit
where the trim is correct.

Module instantiation is once per process, memoised; `dispose()` releases the WASM instance.

## 16-2 · The expensive pass — `src/audio/algorithms/hsa.web.ts`

`prepare()`:

1. **Resample to 44,100Hz mono** via `OfflineAudioContext`, as `basicPitch.web.ts` already
   does for 22,050. Every constant above is pinned to 44.1k and `decodeAudio.web.ts` returns
   the AudioContext's rate, usually 48k. Resampling is what makes the TypeScript engine
   directly comparable to the notebook rather than approximately so.
2. **Frame RMS** at 1024/512, centred the way `librosa.feature.rms` centres, and the voicing
   gate `20·log10(rms / max(rms)) > −20`.
3. **CQT** via 16-1.
4. **The poly pass** — a faithful port of `compute_hsa_v2_poly`, run to all 4 voices
   unconditionally on gated frames, yielding every 64 frames.
5. **Store, then discard the CQT.**

Retained per frame: 4 × frequency, 4 × salience, the frame's first-voice salience, RMS, CQT
flux, and the voicing mask — **41 bytes/frame, ~1.1MB** at the five-minute cap (~25,800
frames). The CQT itself would be ~15.7MB.

The voicing mask is stored rather than recomputed because the gate is relative to the take's
maximum RMS, and `detectReattacks` needs it to know which frames feed the ambient-noise
estimate. Recomputing it in the cheap half would mean re-deriving a threshold the expensive
half already knows, on every slider drag.

Running to 4 voices unconditionally is what makes `relThreshold` and `maxVoices` cheap-half
parameters, and it is exactly equivalent to the notebook for any value of them: in
`compute_hsa_v2_poly` the `rel_threshold` break happens *before* cancellation, so voices the
notebook would have rejected cannot influence the salience of any voice it would have kept.

`Prepared.dispose()` empties a closure, matching all three existing engines.

## 16-3 · The cheap half — `src/audio/segmenters/hsaToNotes.ts`

Per frame: admit voice *i* where `salience[i] ≥ relThreshold × sFirst` (voice 0 always),
capped at `maxVoices`. Round to semitones and build per-pitch activation rows valued
`salience / sFirst`.

Then the state machine carried over from `candidatesToNotes.ts` rather than the notebook's
`note_runs`: onset needs the high bar, sustain the low one, gaps shorter than `bridgeMs` do
not end a note, notes shorter than `minNoteLengthMs` are discarded, onsets optionally snap to
a nearby CQT-flux peak. `note_runs` has no gap tolerance at all (`i - prev > 1` ends a run),
and the hysteresis shape — high onset bar, low sustain floor, generous bridging — was worth
81% → 87% F1 on a real 81-second take in Phase 14's sweep. That measurement is not thrown
away because the front end changed.

Timing stays centre-of-window, for the reason `candidatesToNotes.ts:229` records.

## 16-4 · The re-attack detector — `src/audio/segmenters/reattack.ts`

One pure exported function, no DSP, no dependency on the engine:

```ts
export function detectReattacks(
  rms: Float32Array, voiced: Uint8Array, hopMs: number, config: ReattackConfig,
): number[];   // frame indices where a re-attack was confirmed
```

The state machine is `NoteDetector.detectOnset` (`NoteDetector.ts:79`) lifted out and made
offline:

- running `peak` = max RMS seen since the last confirmation;
- **dip** starts when `rms ≤ peak × dipRatio`;
- **confirmed** when `rms ≥ peak × riseRatio` *and* the dip has lasted `≥ minDipMs`;
  on confirmation `peak` resets to the current `rms`;
- nothing is trusted until `peak` clears `max(minPeakRmsFloor, ambient × noiseFloorMult)`,
  where `ambient` is an EMA over ungated frames.

The gap between `dipRatio` and `riseRatio` is hysteresis and is what stops a wobble reading as
two notes; it must be preserved when the constants are re-tuned.

**One constant is rescaled rather than re-tuned.** `noiseFloorAlpha` is 0.02 at pMPM's 46.4ms
frames, giving a ~2.3s time constant. At 11.61ms the same time constant needs **α = 0.005**.
This is arithmetic, not a judgement call, and it is separated from 16-5 for that reason.

In `hsaToNotes`, a confirmed split frame closes every open note at that frame and reopens it
there, bypassing `bridgeMs` entirely. Bridging and re-attack pull in opposite directions by
design — bridging rides over a 70ms dropout, a tongued repeat's gap looks exactly like one,
and the envelope is the evidence that decides between them.

## 16-5 · Re-tuning the constants — notebook work, before the port

pMPM's `dipRatio 0.5 / riseRatio 0.65 / minDipMs 50` are calibrated against **46.4ms
non-overlapping** frames. HSA v2 runs at 11.61ms with a 1024-sample window. `minDipMs 50`
goes from roughly one frame to four, and amplitude ripple that was invisible at the old
spacing is fully resolved at the new one. Copying the numbers across would be a guess wearing
a measurement's clothes.

Extend the notebook's `render_events` with two families and sweep against exact ground truth:

- **Repeated notes** — the same pitch re-articulated at 2, 4, 6 and 8 notes per second,
  across gap depths from full silence down to a 30% dip. These must split.
- **A vibrato negative control** — one sustained note with 5Hz amplitude modulation at
  40–60% depth. This must produce **zero** splits. At 5Hz the half-period is 100ms,
  comfortably past `minDipMs = 50`, and the depth is comfortably past `dipRatio = 0.5`. The
  expectation going in is that pMPM's constants **fail this case**, and that this is the test
  that moves them. If it passes unchanged, that is a real finding and the constants stand.

Score onset F1 at 50ms tolerance. Sweep `dipRatio × riseRatio × minDipMs`; choose the values
maximising repeat F1 **subject to zero vibrato false splits**, not the unconstrained maximum.
Carry the winners into `reattack.ts` as defaults, with the measured trade table in the
docblock — the format `harmonicSalience.ts:76` uses for `CANCEL_FACTOR`.

Real takes then get a qualitative pass. Synthetic attacks are cleaner than a tongue block,
so the synthetic optimum is a starting point, not a result.

## 16-6 · Integration, removal, migration

**Deleted:** `algorithms/spectral.ts`, `dsp/stft.ts`, `dsp/harmonicSalience.ts`,
`segmenters/candidatesToNotes.ts`, `scripts/_dbg.ts`. `dsp/stft.ts` and
`dsp/harmonicSalience.ts` have no other importers (verified). `dsp/fft.ts` survives only if
something still uses it after the deletions; if not, it goes too.

**`pitchRange.ts`** keeps `PLAYABLE_MIDI_RANGE` — the note lane's own octave fold and
playability rejection use it — but the comment at `pitchRange.ts:73` describing the spectral
engine's use of it must go, or it will outlive the thing it describes.

**Parameters**, all cheap-half:

| id | label | default |
|---|---|---|
| `relThreshold` | Chord sensitivity | 0.60 |
| `onsetThreshold` | Onset sensitivity | from the sweep |
| `maxVoices` | Most notes at once | 4 |
| `minNoteLengthMs` | Shortest note | 40ms |
| `splitRepeats` | Split repeated notes | true |
| `bridgeMs` | Ride over dropouts *(advanced)* | 70ms |
| `snapToAttacks` | Snap starts to attacks *(advanced)* | from the sweep |
| `dipRatio` | Re-attack dip depth *(advanced)* | from 16-5 |
| `riseRatio` | Re-attack recovery *(advanced)* | from 16-5 |
| `minDipMs` | Shortest dip *(advanced)* | from 16-5 |

**Migration.** The registry id changes `'spectral'` → `'hsa'`. `useSettingsStore` persists
`defaultAlgorithm` and `transcriptionParams` keyed by that id and its `persist` config has
**no `version` and no `migrate`**. Without one, anyone who had selected the spectral engine
silently lands on pMPM via `getAlgorithm`'s unavailable-engine fallback, and their saved
parameters are orphaned under a dead key. Add `version: 1` plus a `migrate` that rewrites the
id in both fields. The blast radius is small — `DEFAULT_ALGORITHM_ID` is `basicPitch` — but
silent is the wrong failure mode for a setting a user deliberately changed.

**Picker copy** in `TranscriptionEngineModal` needs rewriting: the spectral engine's
description promises "runs instantly and offline with nothing to download" and "only ever
listens inside the harmonica's own range". Neither is true of HSA v2. The honest version is
that it hears chords and double-stops, splits repeated notes, and runs in the browser without
a network round trip.

## 16-7 · Verification — `scripts/verify-hsa.ts`

Replaces `verify-spectral-pitch.ts`. Repo convention: a `tsx` harness printing a pass/fail
table, with a docblock saying what it protects (`docs/testing.md`).

1. **Chunked CQT equals whole-file CQT.** The one place 16-1 can be silently wrong.
2. **The TypeScript poly pass matches Python frame for frame.** A companion dump script
   writes expected pitch lists for `34Blow.wav` and the synthetic cases; the harness asserts
   equality of rounded MIDI sets per frame. This is the port's correctness claim and the only
   test that can substantiate it.
3. **`detectReattacks` unit cases** over hand-built envelopes: a clean repeat, a shallow dip
   that must not fire, a dip shorter than `minDipMs`, a 5Hz vibrato that must produce nothing,
   and a below-noise-floor passage.
4. **`resegment` purity** — same `Prepared` and same params twice must give identical notes.
5. **The engine round trip** — `prepare` → `resegment` → notes, on a real take.

`scripts/compare-engines.ts` retargets from `spectralAlgorithm` to `hsaAlgorithm` and keeps
scoring against Basic Pitch on the 81-second take, so the F1 number stays comparable across
the replacement. `docs/testing.md`'s suite table is updated in the same change.

## Performance budget

| stage | 5-minute take |
|---|---|
| Resample to 44.1k | < 1s (`OfflineAudioContext`) |
| CQT (`HybridCQT`, chunked) | **5–9s**, measured at 209ms/7s and 178ms/10s |
| Poly pass | ~0.1–0.3s (~2k ops/frame × 25,800 frames) |
| Cheap half per slider drag | milliseconds |
| Retained | ~1.0MB |

The CQT dominates and is the only stage worth optimising if this proves too slow. The
cheapest lever is skipping ungated regions entirely rather than computing the CQT over
silence — deliberately not done in the first cut, because it complicates the chunk-boundary
invariant that 16-7's first assertion protects.

## Decisions still needed

1. **What `onsetThreshold` and `snapToAttacks` default to.** Both come out of a sweep that
   has not run. Phase 14's defaults are not transferable — its salience was normalised
   against the frame's loudest peak, HSA v2's against the frame's first voice.
2. **Whether `dsp/fft.ts` survives.** It exists for the STFT this phase deletes. If nothing
   else imports it, deleting it is correct; leaving it is dead code.
3. **Whether the vendored wasm is bundled or fetched.** Bundling costs 87KB in the web
   bundle unconditionally; fetching adds a request and a CSP consideration but only for users
   who pick this engine. Not settled here.

## Suggested build order

1. **16-5 first, in Python.** It is the only step that can invalidate a decision already
   taken — if the vibrato control cannot be separated from real repeats at any setting, the
   global re-attack design is wrong and this phase changes shape before any TypeScript exists.
2. 16-1 + assertion 1 of 16-7. The CQT wrapper is worthless until chunking is proven.
3. 16-2 + assertion 2. The port's correctness claim, against the Python dump.
4. 16-3, then 16-4 with the constants from step 1.
5. 16-6 — deletion, migration, copy. Last, so the old engine stays available as a comparison
   while the new one is being proven.
6. Retarget `compare-engines.ts` and update `docs/testing.md`.

## Risks specific to this phase

- **The vibrato case may not separate.** If real harmonica vibrato and a tongued repeat are
  not distinguishable by any `dipRatio`/`riseRatio`/`minDipMs` triple, the global design
  fails and the fallback is the hybrid the brainstorm rejected: broadband dip as trigger,
  per-voice salience dip as confirmation. Step 1 of the build order exists to find this out
  before anything depends on it.
- **`cqt-web` is a bus-factor-one dependency.** Vendoring pins the risk rather than removing
  it: a bug found later is ours to work around, because rebuilding the wasm requires an
  emscripten toolchain this project does not have.
- **The Node shim depends on emscripten internals.** An upstream rebuild could break the
  harnesses without breaking the app, which is a confusing failure. Contained to `cqt.ts`,
  and worth a comment saying exactly why each of the three lines is there.
- **Native loses its only polyphonic engine.** Stated in full above; noted here so Phase 15
  inherits it explicitly rather than by discovery.
- **Deleting Phase 14 deletes a measured artefact.** The spectral engine's octave-error rate
  was measured under 1% by `verify-spectral-pitch.ts`. HSA v2 has no equivalent measurement
  and, by decision 1, no octave machinery. If octave errors turn out to be common on real
  takes, this phase has regressed something that was deliberately engineered. Worth running
  the old harness's octave-error scoring against HSA v2 once, as a number to record rather
  than a gate to pass.
