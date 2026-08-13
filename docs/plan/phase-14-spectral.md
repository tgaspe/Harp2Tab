# Phase 14 — Spectral polyphonic transcription (FFT), a third engine

*Part of the [Harp2Tab implementation plan](README.md).*


Basic Pitch is the accurate engine and it is web-only, needs a ~900KB download on first
use, and drags TensorFlow.js in behind it. pMPM is the offline engine and it is
monophonic by construction — one NSDF, one winning lag, one frequency
(`pitchDetector.ts:35`). Nothing in the app hears a double-stop without a network round
trip, and native hears one at all.

This phase adds a third engine that is **polyphonic, offline, dependency-free and pure
TypeScript**: an STFT front end, harmonic-sum pitch salience over a fixed MIDI grid, and
iterative estimation-and-cancellation to resolve simultaneous notes (the Klapuri 2006
multiple-F0 method, implemented from the published description — no GPL source is copied,
unlike the aubio segmenter port, which says so at `segmenters/aubioNotesSegmenter.ts:1`).

**It changes nothing outside `src/audio/`.** The note lane in `transcription.ts` already
takes polyphonic `MidiNote[]`, folds the octave, rejects unplayable pitches and ranks all
12 keys; the picker, the settings screen and the per-engine param store all read the
registry rather than a hardcoded list. A new engine is a new file plus one array entry.

### The primary objective: octave-error rate

**Polyphony is the capability; not reporting the wrong octave is the goal.** A blow 7 that
comes out as blow 4 is worse than a missed note — it is a *plausible-looking* wrong answer
that a player will copy, and it silently corrupts key detection too, since
`rankKeysForMidi` scores whatever pitches it is handed. Every design choice below that has
a cost is paid in the direction of fewer octave errors.

This is stated as a design prior, not a logged bug: nobody has measured how often the
current engines get an octave wrong. **So 14-7 measures the baseline first** — octave-error
rate for pMPM and Basic Pitch on the same material, before a line of this engine is tuned.
If pMPM is already at 1%, the prior is wrong and this phase should be re-argued.

Note that the two directions are different failures with different fixes, and conflating
them is the usual way this gets mis-engineered:

- **Halving** (C6 played, C5 reported). The C5 hypothesis claims every real partial of C6
  as its own *even* harmonics. Its *odd* harmonics — 523, 1570, 2617Hz — are empty. A
  candidate whose odd harmonics carry no energy is a subharmonic ghost, and that is a
  direct, cheap test.
- **Doubling** (C5 played, C6 reported). The C6 hypothesis's partials are all genuinely
  present — they are a subset of C5's. Nothing is missing, so the odd-harmonic test cannot
  fire. It is rejected instead by preferring the **lowest candidate that explains the
  spectrum**: C5 and its 3rd partial are present and unexplained by C6.

Neither test is about frequency resolution, which is why the window size below is chosen on
entirely separate grounds.

### Settled by Theo, 2026-08-10

1. **Simultaneous octaves are penalised, not forbidden.** An octave-apart pair must clear a
   much higher bar than any other interval, but tongue-blocked octave splits stay possible.
2. **Candidates are restricted to the harmonica's own range** — `PLAYABLE_MIDI`'s bounds,
   MIDI 55–103, derived from the layout tables rather than hardcoded. Subharmonic ghosts
   below the harp are then structurally impossible. Consequences in 14-3.
3. **Time resolution targets 16ths at ~120bpm** (~125ms notes), which is what N=4096 is
   sized against.

### Prior art, and what it settles (researched 2026-08-10)

The literature is unusually direct about the objective this phase picked:

- **Octave errors are the dominant error class in multi-F0 estimation**, not one failure
  among many. The multi-F0 literature repeatedly reports that when octave errors are
  excluded from scoring, error rates drop drastically across nearly all instruments. Theo's
  prior is the field's consensus, and step zero's metric is measuring the right thing.
- **The odd-harmonic argument has a name and a 1994 pedigree: Two-Way Mismatch**
  (Maher & Beauchamp, JASA 95(4)). Its stated motivation is exactly the halving case —
  an F0 an octave below the true one explains the measured peaks well, but many of *its*
  odd harmonics find no peak to explain. TWM is the canonical fix and it subsumes both of
  the ad-hoc rules this plan had, which is why 14-3 below is now built on it.
- **The modern version is Duan/Pardo/Zhang 2010**, which models spectral peaks *and*
  non-peak regions as a complementary pair — peak likelihood finds F0s whose harmonics
  explain peaks, non-peak likelihood rejects F0s whose harmonics land where no peak is.
  Same insight, probabilistic. **Not adoptable as-is**: its parameters are learned from
  labelled monophonic and polyphonic training data, and this project has no training
  pipeline. Kept as the reference for what "better" would look like.
- **Klapuri's constants are confirmed from two independent sources** — α=27, β=320 in the
  harmonic weight `(f+α)/(k·f+β)` are what this plan already had. Two things it did *not*
  have and now does: **spectral whitening before salience**, and a **principled polyphony
  stopping rule** (below).

**Calibrate expectations from a practitioner, not from the papers.** The one public
independent implementation of Klapuri 2006 (`tjrantal/PolyphonicPitchDetection`, Java, GPL)
reports detecting *two* notes from an electric guitar consistently, and being too slow for
real time on the hardware of its day. Another implementer reports never reaching the
paper's stated results, blaming the spectral-estimation-and-cancellation step as vaguely
described. This is a well-trodden path with a modest ceiling — which is an argument for
step zero, for the harmonica-range restriction, and against promising parity with a CNN.

### Licensing: papers yes, Essentia no

Essentia has a working `MultiPitchKlapuri` and it is the obvious place to resolve every
detail the papers leave vague. **It is off limits.** Essentia is AGPLv3 *for
non-commercial use*, with commercial use requiring a paid licence from UPF — so
`essentia.js` cannot be bundled into a paid product, and reimplementing from its source is
a materially worse risk than the existing aubio precedent
(`segmenters/aubioNotesSegmenter.ts:1`), because UPF actively sells the commercial licence
that reading-then-reimplementing would be routing around.

The published papers are the specification: Klapuri's ISMIR 2006 for salience, whitening
and the polyphony criterion; Maher & Beauchamp JASA 1994 for TWM. Algorithms described in
papers are not the papers' copyright, and every constant this plan uses is stated in them.
Where a paper is genuinely vague, **the resolution is the harness in 14-7, not someone
else's source tree** — pick a formulation, measure it, keep what scores.

### Why it fits the seam without bending it

The registry's one rule is that a declared param re-runs only the cheap half
(`algorithms/index.ts:55-69`). This algorithm splits along that line naturally, and lands
on the same output shape Basic Pitch already produces:

| | Expensive (once) | Cheap (per param change) |
|---|---|---|
| Basic Pitch | `runInference` — CNN | `segment` — pure over 3 matrices |
| pMPM | `analyzeSamples` — NSDF | `framesToNotes` — no DSP |
| **Spectral** | **STFT + salience + TWM + cancellation → per-frame pitch candidates** | **threshold/segment those candidates — no DSP** |

The expensive half produces a **per-frame candidate list**: up to six scored pitch
candidates per frame, cent-accurate, with their salience and their two-way-mismatch
support. That plays the same role as Basic Pitch's `frames` matrix — a scored intermediate
that segmentation reads — which is why the two-phase contract, the tune screen, the
debounced re-segment and `Prepared.dispose()` all apply unchanged.

Three concrete advantages over the neural lane, all of them consequences of that shape:

- **~2MB retained, against ~90MB.** Six candidates × three floats × 25,840 frames at the
  5-minute cap, versus Basic Pitch's three 88/88/264-bin matrices. `algorithms/index.ts:140`
  calls that the single biggest memory lever in the flow; this engine all but removes it.
- **No defensive deep copy per re-segment.** `basicPitch.web.ts:243` must clone ~36MB on
  every slider tick because `constrainFrequency` zeroes bins in place. Our cheap half reads
  a `Float32Array` and writes notes; it never mutates its input, so the tune step gets
  genuinely instant.
- **It runs on native.** Pure arithmetic on `Float32Array` — no tfjs, no
  `OfflineAudioContext`, no `.web.ts` split. This is the first polyphonic engine mobile can
  have, and it costs nothing extra to get there. (Per the web-first rule, that is a free
  side effect, not a reason to shape any decision below.)

### What it will not be

Not a claim of parity with Basic Pitch on accuracy. A CNN trained on real instruments will
beat a harmonic model on messy input, and 14-7 exists to measure the gap rather than assume
it. The value proposition is *instant, offline, no download, hears chords* — and, plausibly,
better on clean solo harmonica, whose spectrum is close to the model this algorithm assumes.
If 14-7 says otherwise, the honest outcome is to ship it as the offline polyphonic option
and leave Basic Pitch as the default.

## 14-1 · FFT core — `src/audio/dsp/fft.ts`

There is no FFT in the codebase and no dependency that provides one (`smf.ts` and
`basicPitch.web.ts` only mention the letters). Write one; it is ~120 lines of extremely
well-specified arithmetic and it removes a dependency question entirely.

- Iterative in-place radix-2 Cooley–Tukey, bit-reversal permutation, twiddle tables
  precomputed once per size and cached by size.
- **Real-input optimisation**: an N-point real FFT via an N/2-point complex FFT plus an
  untangle pass. Roughly 2× the throughput, and the front end only ever transforms real
  audio. This is the one place where the extra ~40 lines pay for themselves on every frame.
- Preallocated scratch, in the style of `pitchDetector.ts:19-25` — the hot path allocates
  nothing per call. A `class Fft` holding its own buffers, not module globals, so a future
  Worker can hold two.
- Exports: `forwardReal(input, outRe, outIm)` and `magnitudeAndPhase(re, im, mag, phase)`.

## 14-2 · STFT front end — `src/audio/dsp/stft.ts`

Everything here is expressed in Hz and ms and derived from `audio.sampleRate`, so the
engine is rate-independent and **no resampling happens anywhere**. That is deliberate:
`basicPitch.web.ts:11-14` resamples only because its model demands 22050, and
`analyzeSamples.ts:14-21` warns that changing rates silently retunes every calibrated
threshold. Nothing here needs a fixed rate, so nothing here pays that cost — which is also
what lets it run on native, where there is no `OfflineAudioContext`.

- **Window**: Hann, `N` = the power of two nearest 93ms → 4096 at both 44.1k and 48k.
  At 44.1k that is 92.9ms and a 10.77Hz bin spacing.

  Sized against the harp's *lowest* fundamental (MIDI 55, 196Hz) and the target material
  (16ths at 120bpm = 125ms notes):

  | N @44.1k | window | bin | semitone at 196Hz | verdict |
  |---|---|---|---|---|
  | 2048 | 46ms | 21.5Hz | 0.54 bins | too coarse to separate semitones at the bottom |
  | **4096** | **92.9ms** | **10.8Hz** | **1.08 bins** | fits inside a 125ms note with margin |
  | 8192 | 186ms | 5.4Hz | 2.2 bins | better resolution, but longer than the note itself |

  4096 is the smallest power of two where a semitone at the bottom of the harp is still
  about one bin — which is the condition the instantaneous-frequency refinement below needs
  to work from — and the largest that still fits inside the shortest note we target. It is
  **not** an octave-robustness choice: as the objective section explains, both octave tests
  are about which harmonics carry energy, and 98Hz-versus-196Hz is trivially resolvable at
  any of these sizes. If the target material ever moves to 180bpm the answer is a
  multi-resolution front end (long windows low, short windows high), not a smaller N.
- **Hop**: `N/8` = 512 samples. At 44.1kHz that is **11.61ms — exactly Basic Pitch's frame
  period** (22050/256, `basicPitch.web.ts:32-34`), so the two engines' outputs are directly
  comparable frame for frame in the harness. 8× overlap is what makes the phase-difference
  step below well-conditioned.
- **Instantaneous frequency**, not bin centres. Bin spacing at the bottom of the analysis
  range (82Hz) is wider than a semitone, so peak frequencies come from the phase difference
  against the previous frame (`f = (Δφ unwrapped to the bin's expected advance) / (2π·hop/sr)`),
  with parabolic interpolation as the fallback when the phase estimate lands outside the
  bin's plausible band. One retained `Float32Array` of previous-frame phase, reused.
- **Peak list per frame**: local maxima of magnitude, each carrying its IF-refined
  frequency, capped at ~100 per frame. (Klapuri's own implementations cap at exactly 100,
  which is a useful sanity check on the number rather than a coincidence.) TWM in 14-3
  consumes this list directly and never touches raw bins — a harmonic either matches a real
  peak or it does not, and that binary is what gives the octave test its teeth.

  Peak refinement uses instantaneous frequency plus parabolic interpolation, **not**
  zero-padding. Klapuri's implementations zero-pad by 4×, which at N=4096 means a
  16384-point FFT and roughly 4× the cost of the dominant step in the whole pass; the phase
  method reaches comparable accuracy for the price of one retained phase array. Worth a
  comment in the file, since it is a deliberate divergence from the reference method.
- **Spectral whitening before salience** (Klapuri 2006), flattening the spectral envelope
  so that salience measures harmonic structure rather than timbre. This is the step that
  addresses case 3 of the harness — a hand-cupped harmonica whose fundamental sits well
  below its second partial is precisely the spectrum that makes an un-whitened harmonic sum
  double. It was missing from the first draft of this plan.
- **Silence gate, reused wholesale from `analyzeSamples.ts:33-36`** — 95th-percentile RMS
  × 0.06, floored at 1e-4. Gated frames skip the FFT entirely and write a zero activation
  row. On a real take this is the largest single saving, exactly as it is for pMPM.
- **Chunked yielding** every 64 frames with `setTimeout(0)`, copying `analyzeSamples.ts:94-100`
  verbatim in shape, so progress moves and Cancel is delivered. The registry's
  `onProgress`/`shouldCancel` contract is honoured with no new machinery.

**Why one bin per semitone at the bottom is enough.** Harmonic-sum salience identifies a
pitch from its *upper* partials, which are spaced proportionally wider: at a 196Hz
fundamental the 10th partial sits at 1960Hz, where a semitone is 116Hz — nearly 11 bins.
The fundamental's bin being marginal costs almost nothing, because the fundamental is the
least informative part of the evidence. This is the property the whole method rests on and
it is worth a comment in the file.

## 14-3 · Salience and cancellation — `src/audio/dsp/harmonicSalience.ts`

The expensive half's actual work. Per frame:

1. **Candidate grid: the harmonica's range and nothing outside it** — `min(PLAYABLE_MIDI)`
   to `max(PLAYABLE_MIDI)` (`pitchRange.ts`), currently MIDI 55–103, 49 bins, one per
   semitone. Read from the layout tables at module load, not hardcoded, so a layout change
   moves the analysis grid with it.

   **This is the single largest anti-halving measure in the phase and it is free**: a
   subharmonic ghost an octave below a played note has nowhere to live, because there is no
   candidate down there to win. It is a hypothesis space, not an observation window — the
   audio is unchanged.

   What it costs, stated plainly because it is a real trade:
   - Material recorded an octave *above* the harp finds nothing rather than folding down.
     Rare in practice (it would be above G7) and the failure is silence, not a wrong answer.
   - Material an octave *below* — a guitar line, a low whistle — is no longer folded up by
     `octaveShiftForMidiRange`, because the engine never emits the low pitches the fold
     reads. In practice it partly self-corrects: a source an octave low has its 2nd partial
     inside the harp's range, so the engine tends to report the octave-up reading, which is
     what the fold would have produced anyway. But "tends to" is not a guarantee.
   - **Therefore this engine is the harmonica-optimised one, not the general-purpose one.**
     Basic Pitch stays the right default for arbitrary uploads. That is a clean division of
     labour between three engines and it should be said in the picker copy (14-5).
2. **Salience** `S(p) = Σ_k g(k)·A(k·f₀(p))`, where `A(f)` is the largest peak magnitude
   within a quarter-tone of `f` (min one bin), `g(k) = (f₀+α)/(k·f₀+β)` with α=27Hz,
   β=320Hz — Klapuri's weighting, which keeps low pitches with many partials from
   automatically outscoring high ones. Normalised by `Σg(k)` over the harmonics actually
   available, `K = min(20, ⌊0.9·Nyquist/f₀⌋)`, for the same reason. **That normalisation is
   itself an anti-halving measure**: an unnormalised harmonic sum systematically favours the
   subharmonic, which is exactly how naive implementations halve.
3. **Re-rank the top candidates by Two-Way Mismatch** (Maher & Beauchamp 1994). Salience is
   a good *generator* of candidates and a poor *discriminator* between octaves, because a
   subharmonic gets to sum the real note's partials as its own evens. TWM is the
   discriminator, and it is two-way precisely because the two octave errors need opposite
   tests:

   - `Err_predicted→measured` — for each harmonic the candidate predicts, the frequency
     distance to the nearest measured peak. **This is the halving test**: a candidate an
     octave low predicts partials at 1.5×, 2.5×, 3.5× the true f₀, and nothing is there.
   - `Err_measured→predicted` — for each measured peak, the distance to the nearest harmonic
     the candidate predicts. **This is the doubling test**: a candidate an octave high
     leaves the real f₀ and its odd partials measured but unexplained.

   Combined as `Err = Err_p→m/N + ρ·Err_m→p/K`, each term weighted by partial amplitude and
   by `f^-p` so high, unreliable partials count for less. The commonly cited constants are
   `p=0.5, q=1.4, r=0.5, ρ=0.33` — **confirm these against the JASA paper before
   implementing**; they are quoted here from secondary sources and this plan does not treat
   them as verified.

   This replaces the two separate ad-hoc rules an earlier draft of this section had. One
   error function, both directions, thirty years of use behind it — and no ordering hazard
   between two guards that could fight each other.
4. **Estimate, cancel, repeat**, with a principled stopping rule rather than a fixed voice
   count:
   - take the candidate minimising TWM error among the top salience peaks;
   - record it, then cancel its partials from the **peak list** — reducing matched peak
     magnitudes rather than rewriting 2048 bins, which is both cheaper and keeps "does a
     peak exist here" well-defined on the next iteration;
   - recompute and repeat, and **stop when `S_p / p^γ` stops increasing**, where `S_p` is
     the summed salience of the `p` sounds detected so far and `γ ≈ 0.7`. This is Klapuri's
     polyphony criterion, and it is a real improvement on the first draft's "up to five
     voices, stop below an absolute floor" — it lets a clean single note stop at one, which
     is itself an anti-ghost measure.
5. **Simultaneous octaves are penalised, not forbidden** (Theo, settled above). A candidate
   an octave above an accepted pitch is scored by its *own* TWM error against the residual
   peak list — after the lower note's partials have been cancelled, what remains must still
   explain the upper note. It has to clear a bar no other interval clears. Fifths get the
   same treatment.

   The bar is **not** applied here. Each candidate's TWM support travels into the stored
   frame so the cheap half applies it — which makes "how much evidence an octave needs" a
   slider rather than a buried constant, and it is the one threshold nobody can guess in
   advance.
6. **Normalisation**: salience is divided by the frame's total in-band magnitude, clipped to
   0..1 — a loudness-independent quantity so one threshold works across a take with
   dynamics. This is the one number in the phase that must be *calibrated rather than
   derived*; 14-7 settles it, and the param defaults fall out of it.

Output, held by `Prepared.data`. **Sparse, not a dense matrix** — a change forced by the
research: salience wants ~10-cent resolution to place a bent note, and a dense
`frames × 480 cent-bins` matrix would be over 100MB at the 5-minute cap. Storing only what
each frame actually found is both smaller than the dense semitone grid an earlier draft
proposed *and* keeps cent accuracy:

```ts
/** Candidates retained per frame, stored BEFORE the polyphony criterion is applied, so the
 *  cheap half can re-decide without re-running any DSP. */
const MAX_CANDIDATES = 6;

interface SpectralCandidates {
  sampleRate: number; hop: number; frameCount: number;
  /** frameCount × MAX_CANDIDATES, row-major. NaN in unused slots. */
  cents:    Float32Array;  // cent-accurate pitch — survives bends
  salience: Float32Array;  // whitened harmonic sum, 0..1, normalised per frame
  support:  Float32Array;  // 1/(1+TWM error), 0..1 — the octave evidence
  rms:      Float32Array;  // per frame — velocity and the silence gate
  flux:     Float32Array;  // per frame — half-wave-rectified, for onset timing
}
```

25,840 frames × 6 candidates × 3 floats ≈ **1.9MB**, against ~10MB for the dense semitone
grid and ~90MB for Basic Pitch's matrices. The polyphony criterion runs in the cheap half
too, since everything it needs is stored — so `γ` *could* become a param later, though this
plan pins it at 0.7 rather than adding a slider nobody can interpret.

The one thing the sparse form gives up: a threshold can never reveal a seventh candidate
that was not stored. With `maxVoices` capped at 5 and the polyphony criterion typically
stopping at 1–2 on harmonica, a sixth slot is already generous headroom.

## 14-4 · Candidates → notes — `src/audio/segmenters/candidatesToNotes.ts`

The cheap half. Pure, no DSP, walks each pitch row once. Everything it needs was computed
in 14-3, which is what makes every param below legal under the registry's rule.

- **Hysteresis**: a note opens when activation crosses `onsetThreshold` and stays open while
  it holds above `sustainThreshold` (kept strictly lower — the gap is what stops a wobble
  becoming two notes, the same argument `pmpm.ts:107-108` already makes for `riseRatio`).
- **Bridging**: dropouts shorter than `bridgeMs` do not end the note.
- **Re-attacks**: activation stays high through a re-tongued repeat of the same hole, which
  is the exact problem `NoteDetector`'s dip/rise detector solves for loudness. Apply the
  same peak-relative dip/rise test to the per-pitch activation envelope. **Evaluate
  `createEnvelopeGate` (`segmenters/envelope.ts`) for reuse first** — it is already the
  shared driver for precisely this decision, and its header says the point is that the
  boundary logic can never drift between segmenters. Write it inline only if a normalised
  activation genuinely does not fit its config.
- **Onset timing**: activation rises when the note fills enough of a 93ms window, so the
  crossing frame lags the attack. Backtrack to the nearest preceding local maximum of
  `flux` within one window. Exposed as a boolean param, since flux is precomputed and the
  backtrack is free.
- **The octave bar**: when a frame holds two pitches exactly 12 semitones apart, the upper
  one survives only if its `support` (the stored TWM score) clears `octaveEvidence`. Everything needed was
  computed in 14-3, so this is a genuine slider — and it is the control that decides whether
  a take is read as octave splits or as ghosts, which is the one judgement call that
  actually varies by player and by microphone.
- **Voice limit**: keep the top `maxVoices` activations per frame. Cheap because all five
  candidates are already in the matrix — and `maxVoices = 1` gives a monophonic mode for
  free, which is a real answer for someone transcribing a single-line solo. Note it does
  *not* substitute for the octave bar: with `maxVoices = 1` a halving ghost that outscored
  the real note would simply be the one survivor.
- **Minimum length**, applied last, in ms.
- **Velocity**: peak activation × frame RMS, normalised against the take's 95th percentile,
  mapped to 1..127 — the same 1..127 clamp `basicPitch.web.ts:273` uses, so the Studio's
  velocity lane reads the same scale whichever engine produced the notes.
- Returns notes **sorted by `timeMs` then `midi`**. `basicPitch.web.ts:277` had to add that
  sort after the fact; everything downstream assumes onset order.

No pitch bends. The IF estimate could give cents deviation per frame, but `MidiNote`
(`types/index.ts:128`) has nowhere to put it and the Basic Pitch adapter drops its bends
too. Consistency now, one shared decision later if the Studio ever grows the lane.

## 14-5 · The registry adapter — `src/audio/algorithms/spectral.ts`

```ts
id: 'spectral',
label: 'Spectral transcription',
description: 'Hears chords and double-stops, runs instantly and offline with nothing to '
           + 'download, and only ever listens inside the harmonica\'s own range. Best for '
           + 'harmonica takes; use the neural engine for other instruments.',
available: true, producesFrames: false, polyphonic: true,
```

`prepare` runs 14-2 + 14-3 and holds the matrix in a closure with `dispose()` emptying it —
the same pattern as `basicPitch.web.ts:387-393` and `pmpm.ts:154-163`, for the same reason.
`resegment` runs 14-4 and returns `{ output: { kind: 'notes', notes }, detectorConfig: null }`.

Declared params, all of them 14-4's and therefore cheap:

| id | label | range | default |
|---|---|---|---|
| `onsetThreshold` | Onset sensitivity | 0.05–0.95 | from 14-7 |
| `sustainThreshold` | Note confidence | 0.02–0.90 | from 14-7 |
| `octaveEvidence` | Octave splits | 0.0–1.0 | from 14-7 |
| `minNoteLengthMs` | Shortest note | 12–300ms | 58 |
| `maxVoices` | Most notes at once | 1–5 | 4 |
| `snapToAttacks` | Snap starts to attacks | bool | true |
| `bridgeMs` | Ride over dropouts | 0–200ms | ~46 (advanced) |
| `dipRatio` / `riseRatio` | Re-attack depth / recovery | as `pmpm.ts` | (advanced) |

`octaveEvidence`'s help text has to earn its place, because the control is meaningless in
library terms and obvious in playing terms: *"How much proof it takes before two notes an
octave apart are both written down. Raise it if single notes are coming out doubled."*
That sentence is the phase's objective, made adjustable.

`minNoteLengthMs` defaults to 58 to match Basic Pitch exactly, so a side-by-side run in the
harness differs by engine and not by gate.

**Deliberately not params**, and the file should say so the way the other two adapters do:
window size, hop, whitening, the harmonic weighting `g(k)`, the TWM constants,
`MAX_CANDIDATES` and the analysis pitch range.
Every one of them re-runs the whole STFT, which is the line `algorithms/index.ts:66-69`
draws. `maxVoices` looks like a violation and is not — the expensive half always finds five
and the cheap half chooses how many to keep.

## 14-6 · Integration — what actually changes outside the engine

Almost nothing, and that is the point.

- `algorithms/index.ts:25` — add `'spectral'` to `TranscriptionAlgorithmId`.
- `algorithms/index.ts:209` — one entry in `TRANSCRIPTION_ALGORITHMS`. Registration order
  is display order; put it after Basic Pitch, before pMPM.
- **No platform split, no native stub.** Unlike `algorithms/basicPitch.ts`, which exists
  only to report `available: false`, this engine resolves and runs on both bundles.
- `transcription.ts` — **unchanged**. The note lane already does the octave fold,
  `isPlayableOnAnyHarmonica` and `rankKeysForMidi`, and already documents that it must not
  re-filter what the engine's own minimum length already handled.
- `useSettingsStore.ts:49` — `transcriptionParams` is `Partial<Record<TranscriptionAlgorithmId, …>>`
  and `withDefaults` (`algorithms/index.ts:121`) already drops unknown keys and fills missing
  ones. Persistence widens by itself.
- `import.tsx:250`, `recording.tsx:96`, `settings.tsx:40` — all call `availableAlgorithms()`.
  The third engine appears with no edits.
- `TranscriptionEngineModal` — check it at 1280×640 with **three** rows rather than two. The
  Phase 13 notes flag exactly this failure mode for the convert modal (`maxHeight` + internal
  scroll so the actions stay reachable).
- `DEFAULT_ALGORITHM_ID` (`algorithms/index.ts:214`) — untouched until 14-7 produces numbers.

## 14-7 · Calibration and verification — `scripts/verify-spectral-pitch.ts`

The plan's defaults above are stated as "from 14-7" because they genuinely are: the
normalisation in 14-3 fixes what the thresholds mean, and guessing them would be inventing
numbers. This step is where they come from, and it is the largest single piece of work in
the phase.

### Step zero: measure the baseline before building anything

The octave objective is a design prior, not an observation — nobody has counted how often
the current engines get an octave wrong. Build the metric first and point it at what already
ships:

- **Octave-error rate**, as its own first-class number, separate from ordinary pitch error:
  of the notes whose *pitch class* is correct, what fraction land in the wrong octave, split
  by direction (halved / doubled). A note that is simply wrong is a different failure and is
  counted separately.
- Run it over pMPM and Basic Pitch on the same synthesized cases and on Theo's real
  recordings, and write the numbers into this section.

Two outcomes, both useful. If pMPM is already around 1%, the prior is wrong, this phase's
headline objective is not worth the constraints it imposes, and the harmonica-range
restriction in particular should be re-argued. If it is 5–10%, the phase has a target to
beat and every later decision has a number attached to it.

**Correctness, bottom up:**

- FFT against a naïve DFT for N = 8…1024 on random input, max absolute error < 1e-4, plus
  a Parseval check. Cheap, and it makes every later failure attributable to the algorithm
  rather than the transform.
- A synthesised sine sweep across MIDI 45–103 → detected f₀ within 15 cents at every
  semitone. This is the IF-refinement test and it will fail loudly if the phase unwrapping
  is wrong at either end of the range.

**Polyphony, against ground truth.** `synthesizeWav` already mixes overlapping notes
(`synthesizeWav.ts:97`, `mix[idx] +=`) but renders **pure sine tones**, which is both too
easy for this algorithm (nothing to sum) and too hard (no partials to cancel with). The
harness needs a harmonic-rich synth — partials 1..8 at ~1/k with a little inharmonicity and
vibrato. Add it beside `scripts/make-test-wav.ts` rather than changing `synthesizeWav`,
which is production playback code.

Cases, scored as precision/recall/F1 on (pitch, onset within ±50ms) **and separately on
octave-error rate**, which is the number that decides the phase:

*Octave robustness — the primary suite:*

1. **Every hole, every octave, monophonic.** Each playable position on a C harp in turn,
   held ~400ms. Octave-error rate must be near zero; this is the case the whole design is
   for, and it is the one to run after every change to 14-3.
2. **The same pitch class at three registers** — blow 4, blow 7, blow 10 in sequence (C5,
   C6, C7). Checks the engine tracks the actual octave rather than collapsing onto one
   register, which is the failure a per-note test can miss entirely.
3. **Timbre and dynamics stress.** The same notes with a weak fundamental (a bright,
   cupped-tone spectrum where partial 1 is well below partial 2) and at low amplitude.
   A weak fundamental is the classic trigger for doubling, and it is exactly what a
   hand-cupped harmonica produces.
4. **Bends.** Reed bends move partials non-uniformly, so this is both a pitch-accuracy case
   and an octave case — a badly-tracked bend can land the salience peak on a subharmonic.

*Polyphony — the secondary suite:*

5. major thirds and fifths (draw 1+2, blow 2+3);
6. whole-tone double stops (blow 4+5) — tests frequency resolution;
7. octave splits (blow 1+4), scored **both ways**: recall of the real split, and the
   false-positive rate of case 1 producing a phantom split. `octaveEvidence` is the knob
   that trades one against the other, and the deliverable here is that trade curve, not a
   single score. Theo's call was penalise-not-forbid, so the default sits wherever case 1
   stays clean.
8. three-note chords;
9. a fast passage — onset drift ≤ 30ms, reusing the drift measurement
   `verify-audio-import.ts` already computes.

**Re-segmentation stability**, the property the tune step rests on: one `prepare`, several
param sets, note counts monotonic as thresholds rise, and identical output when the same
params are re-applied. Basic Pitch needed a defensive copy to hold this invariant; ours
should hold it structurally, and the test is what proves it.

**A/B against Basic Pitch** on the same files, reported as a table — note counts, F1,
wall-clock. The reference point already exists: Theo's Python `predict()` on
`Amazing_Grace_C` gives 165 notes, and the current pipeline agrees with it. That file is not
in the repo and will need to be dropped in.

Then set the defaults from the sweep, and only then revisit `DEFAULT_ALGORITHM_ID`.

## 14-8 · Performance budget

Cost is dominated by the FFT: an N=4096 real transform is ~150 kflop including windowing
and magnitudes, and a 5-minute take at 44.1kHz is 25,840 frames → ~3.9 Gflop, which at
realistic JS throughput lands somewhere around **10–20s of continuous sound**, less on real
takes where the silence gate skips whole passages. That is in the same territory as the CNN
and acceptable for an offline pass with a progress bar — but it is an estimate, and 14-7
reports the measured number per audio-second before anything is tuned around it.

Levers, in the order to reach for them:

1. the silence gate (already in 14-2 — free, and biggest on real recordings);
2. precomputed harmonic bin tables per (sampleRate, N) — the salience loop becomes lookups,
   49 pitches × ≤20 harmonics × 5 iterations, negligible against the FFT;
3. hop `N/4` instead of `N/8` — halves the cost, doubles the frame period to 23ms, and
   costs onset precision. Only if the measurement demands it, and only as a constant, never
   as a param.

**The Worker question is deliberately out of scope.** Both existing engines run on the main
thread with `setTimeout` yields, and moving one to a Worker is a cross-engine change with a
platform split behind it (native has no `Worker`). If the pass is too slow to sit under the
progress bar, that is an argument for a separate phase covering all three engines, not for
this one growing a web-only fast path.

Same answer for WebAssembly, and it is worth writing down why, because the number is
tempting: published comparisons put a Rust-to-WASM pitch-detection FFT at roughly **8×** a
pure-JS equivalent. That would turn a 15-second pass into two seconds. It also adds a
toolchain, a build step, a second language and a platform question to a project that
currently has none of those, for an offline pass that already has a progress bar. Revisit
only if 14-8's measurement comes back badly enough to make the flow unusable.

## Decisions still needed

1. **Third option, or replacement for pMPM?** pMPM is the only engine that feeds Frame
   Inspector (`producesFrames: true`), so it cannot simply be dropped — but three engines is
   a lot of picker for one screen, and Phase 13 already asks whether pMPM should stay
   user-visible at all. Recommendation: ship as a third option, non-default, and let 14-7's
   A/B decide whether it retires pMPM as the *offline* choice while pMPM stays the frame
   source.
2. **Should the candidate list feed Frame Inspector?** A scored candidate list is strictly richer
   inspector material than `RawFrame[]` — it shows what the engine considered, not just what
   it picked. But it means a third `TranscriptionOutput` kind, and `algorithms/index.ts:14-17`
   argues carefully for keeping the union at two. Recommendation: not this phase; it is the
   natural successor to `producesFrames` once there is something to look at.
3. **Live HUD polyphony.** Unlike Basic Pitch, this algorithm is causal with ~93ms of
   latency and decides each frame locally, so it *could* replace `detectPitch` in the live
   path and hear double-stops in real time. `NoteDetector` segments on tab identity and is
   monophonic end to end, so that is a phase of its own — worth recording that the door is
   open, and not opening it here.
4. **Whether native gets it on day one.** It costs nothing to enable and would be mobile's
   first polyphonic engine, but mobile is otherwise frozen. Recommendation: leave
   `available: true` (there is no code to write either way) and simply not test it on native
   until mobile is back in scope.
5. **Whether the engine should be pre-selected for recordings.** The harmonica-range
   restriction (14-3) makes it the best engine for a take of someone playing harmonica into
   a microphone and the wrong one for an arbitrary uploaded file. The picker already has two
   hosts (Phase 13-5), so recording could default to spectral while file import defaults to
   Basic Pitch. Recommendation: hold until 14-7's baseline exists — a per-host default is
   easy to add and impossible to justify without the numbers.

## Suggested build order

0. **14-7's step zero** — the harmonic-rich synth, the case-1 material, and the
   octave-error metric, pointed at pMPM and Basic Pitch. Half a day, no new DSP, and it is
   the only thing that can tell you whether the rest of this phase is worth building. If the
   baseline comes back clean, stop here and re-argue the phase.
1. **14-1** — the FFT, with its DFT cross-check written at the same time. Pure, testable in
   isolation, and everything else is unverifiable until it is right.
2. **14-2** — the STFT front end, verified by the sine-sweep case alone (monophonic, no
   salience involved): peaks land within 15 cents or the phase work is wrong.
3. **14-3** — salience and cancellation, brought up in three stages, each gated by the
   metric from step 0: plain harmonic-sum salience first (should roughly match pMPM on case
   1, and will probably halve on case 3 — that is the point), then spectral whitening and
   TWM re-ranking, then cancellation and the polyphony criterion.
4. **14-4 + 14-5** — the cheap half and the adapter, at which point the engine is real and
   selectable end to end.
5. **14-7's sweep** — set the defaults. Nothing before this point should hardcode a
   threshold anywhere but the adapter's `default` fields.
6. **14-6's UI check** — the three-row modal at 1280×640, and per project convention restart
   the dev server with `--clear` and confirm the served bundle before browser-testing.

Steps 0–3 are self-contained DSP with no UI and no store involvement; they can be built and
verified without touching a screen. If the phase has to be cut short, the natural stopping
point is after step 3 with the harness green — an unused but verified salience module is a
much better place to pause than a wired-up engine with guessed thresholds. Step 0 stands
alone regardless: an octave-error metric over the two shipping engines is worth having even
if this engine is never built.

## Risks specific to this phase

- **Octave errors are the make-or-break**, and cases 1–3 are where that is decided. If TWM
  re-ranking does not hold up, the fallback is NNLS over a fixed harmonic dictionary (49
  templates, the Chordino approach) behind the *same* `prepare`/`resegment` seam — more
  accurate, several times slower, and a drop-in replacement for exactly one module. Worth
  stating up front so the interface is not shaped around the cheaper method.
- **The cancellation step is the known-underspecified part of this method**, by the
  testimony of people who have implemented it: one public implementer reports never reaching
  the paper's stated results and blames precisely the spectral estimation and cancellation
  of the detected sound. The mitigations are that cancellation here operates on a ~100-entry
  peak list rather than a full spectrum (much easier to reason about and to inspect), that
  TWM does the octave discrimination *before* cancellation rather than depending on it, and
  that 14-7 measures each variant instead of trusting a formula.
- **A faithful implementation of this method has a modest ceiling.** The one public
  independent implementation reliably resolves two simultaneous notes on electric guitar.
  Aim there — two notes, correct octave, on harmonica — not at Basic Pitch's chord
  transcription. Anything more is upside, not the plan.
- **The harmonica-range restriction is a product decision wearing DSP clothes.** It buys
  most of the anti-halving benefit for free, and it quietly makes this engine wrong for
  non-harmonica uploads. That is fine while it is one of three engines and the copy says so;
  it would not be fine if it ever became the default for file import.
- **Calibrating the normalisation is empirical work, not derivation.** It is the one part of
  this phase that cannot be reasoned to a number, and it is on the critical path for every
  default.
- **Harmonica reeds are not perfectly harmonic**, and bends in particular move partials
  non-uniformly. The salience search tolerance (a quarter-tone) is the knob that absorbs
  this, and case 4 is what proves it — a badly-tracked bend does not just misreport a pitch,
  it can move the salience peak onto a subharmonic and become an octave error.
- **A third engine is a third thing to explain.** Three rows in the picker, three saved
  param sets, three descriptions that must each say plainly why someone would choose it.
  That is a copy problem and it is real; the descriptions in 14-5 are a first draft, not a
  finished answer.
