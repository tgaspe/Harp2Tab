# HSA v2 Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the spectral transcription engine with a port of `HSA_v2_polyphonic.ipynb` (CQT harmonic summation + iterative cancellation), and give it pMPM's amplitude-envelope re-attack detector so repeated notes stop being written as one long note.

**Architecture:** A vendored WASM CQT (`cqt-web`, `HybridCQT`) behind a chunked `CqtAnalyzer` wrapper feeds a faithful TypeScript port of `compute_hsa_v2_poly`. The expensive half stores ~41 bytes/frame; every user-facing knob re-runs only the cheap half, which segments per-semitone activation rows and splits them at re-attacks detected on the broadband RMS envelope.

**Tech Stack:** TypeScript, Expo/React Native (web target), vendored Emscripten WASM, `tsx` verification harnesses (no Jest/Vitest), Python 3 + librosa 0.11.0 for reference dumps and tuning.

**Spec:** `docs/plan/phase-16-hsa-engine.md`

## Global Constraints

- **Sample rate is 44,100 Hz.** Every constant is pinned to it. Resample in `prepare()` via `OfflineAudioContext`.
- **Hop 512 samples = 11.61 ms.** RMS frame 1024. Bins/octave 24. `n_bins` 152. `fmin = 180 / 2^(1/12)` = 169.8973762827048. Q = 34.13.
- **F0 search 180–3200 Hz. 4 harmonics, bin offsets `[0, 24, 38, 48]`, weights `0.84^k`.**
- **`rel_threshold` 0.60, `cancel_factor` 0.85 (envelope mode), `max_voices` 4, `min_separation_bins` 3, `cancel_width` 1.**
- **Voicing gate:** frame RMS > −20 dB relative to the take's max RMS, i.e. `rms > 0.1 * max(rms)`.
- **No test framework exists.** Verification is `tsx` harnesses in `scripts/` printing a pass/fail table via a local `check(label, passed, detail)` and `process.exit(1)` on failure. Follow `scripts/verify-spectral-pitch.ts`.
- **Every new file carries a docblock** explaining what it does and why it is shaped that way. This codebase's comments explain decisions, not mechanics. Match that.
- **The engine is web-only.** `hsa.ts` is an `available: false` stub; `hsa.web.ts` is the implementation. Mirror `basicPitch.ts` / `basicPitch.web.ts`.
- **Python reference lives in `/Users/theo/audio_analysis`** with its venv at `/Users/theo/audio_analysis/venv/bin/python3`. That is a **separate repo** — commit there separately, never from `harp2tab`.

---

### Task 1: Re-tune the re-attack constants in the notebook

**This task can invalidate the design.** It runs first for that reason. If 5 Hz vibrato cannot be separated from a tongued repeat at any threshold triple, the global re-attack decision is wrong and Tasks 5–6 change shape before any TypeScript exists.

**Files:**
- Create: `/Users/theo/audio_analysis/reattack_sweep.py`
- Test: the sweep's own printed table is the deliverable

**Interfaces:**
- Consumes: nothing
- Produces: four numbers carried into Task 5 as `DEFAULT_REATTACK_CONFIG` — `dipRatio`, `riseRatio`, `minDipMs`, plus the confirmed verdict on whether vibrato separates. The measured trade table goes into `reattack.ts`'s docblock.

- [ ] **Step 1: Write the synthesis and the detector under test**

Create `/Users/theo/audio_analysis/reattack_sweep.py`:

```python
"""
Re-tuning pMPM's amplitude-envelope re-attack constants for HSA v2's framing.

pMPM's dipRatio 0.5 / riseRatio 0.65 / minDipMs 50 were calibrated against 46.4ms
non-overlapping frames (analyzeSamples.ts). HSA v2 runs at 11.61ms with a 1024-sample RMS
window, where minDipMs 50 is ~4 frames instead of ~1 and vibrato ripple is fully resolved.

The objective is deliberately constrained rather than maximised: pick the triple with the
best repeat onset F1 SUBJECT TO zero false splits on the vibrato control. A detector that
splits a held vibrato note is worse than one that misses a fast repeat -- the first
fabricates notes the player never played.
"""
import numpy as np, itertools

SR = 44100
HOP = 512
RMS_FRAME = 1024
HOP_MS = 1000.0 * HOP / SR          # 11.61
NOISE_FLOOR_ALPHA = 0.005           # ~2.3s time constant at 11.61ms, rescaled from pMPM's 0.02
NOISE_FLOOR_MULT = 2.5
MIN_PEAK_RMS_FLOOR = 0.001


def render(events, duration_s, f0=440.0, snr_db=30.0, tremolo_hz=0.0, tremolo_depth=0.0,
           attack=0.008, release=0.02, seed=0):
    """events: list of (start_s, end_s). One pitch throughout -- this tests the ENVELOPE,
    so pitch is deliberately held constant: a detector that needs a pitch change to split
    is the thing we already have."""
    rng = np.random.default_rng(seed)
    n = int(duration_s * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for start, end in events:
        i0, i1 = int(start * SR), int(end * SR)
        seg = np.zeros(n, dtype=bool)
        seg[i0:i1] = True
        env = np.zeros(n)
        env[i0:i1] = 1.0
        a = min(int(attack * SR), (i1 - i0) // 2)
        r = min(int(release * SR), (i1 - i0) // 2)
        if a: env[i0:i0 + a] = np.linspace(0, 1, a)
        if r: env[i1 - r:i1] = np.linspace(1, 0, r)
        sig = np.zeros(n)
        for h in range(1, 9):
            if f0 * h < 0.45 * SR:
                sig += (h ** -0.6) * np.sin(2 * np.pi * f0 * h * t)
        y += env * sig / 8
    if tremolo_depth > 0:
        y *= 1.0 - tremolo_depth * 0.5 * (1 - np.cos(2 * np.pi * tremolo_hz * t))
    if snr_db is not None:
        rms = np.sqrt(np.mean(y[y != 0] ** 2)) if np.any(y) else 1.0
        y = y + rng.normal(0, rms * 10 ** (-snr_db / 20), n)
    peak = np.max(np.abs(y))
    return 0.9 * y / peak if peak > 0 else y


def frame_rms(y):
    """Matches librosa.feature.rms(frame_length=1024, hop_length=512, center=True), which is
    what the TypeScript side will reimplement."""
    pad = RMS_FRAME // 2
    p = np.pad(y, pad, mode="reflect")
    n = 1 + len(y) // HOP
    return np.array([np.sqrt(np.mean(p[i * HOP:i * HOP + RMS_FRAME] ** 2)) for i in range(n)])


def detect_reattacks(rms, dip_ratio, rise_ratio, min_dip_ms):
    """The exact state machine from NoteDetector.detectOnset (NoteDetector.ts:79), offline.
    Returns frame indices of confirmed re-attacks."""
    gate = 0.1 * rms.max()
    ambient, peak = 0.0, 0.0
    dipping, dip_start = False, 0
    out = []
    for i, v in enumerate(rms):
        if v < gate:
            ambient = ambient + NOISE_FLOOR_ALPHA * (v - ambient) if ambient > 0 else v
        if v > peak:
            peak = v
        if peak < max(MIN_PEAK_RMS_FLOOR, ambient * NOISE_FLOOR_MULT):
            continue
        if not dipping:
            if v <= peak * dip_ratio:
                dipping, dip_start = True, i
            continue
        if v >= peak * rise_ratio:
            dipping = False
            if (i - dip_start) * HOP_MS >= min_dip_ms:
                peak = v
                out.append(i)
    return out
```

- [ ] **Step 2: Add the cases and the scoring, and run it**

Append to the same file:

```python
def repeats(rate_hz, gap_frac, n=8, t0=0.3):
    """n notes at rate_hz, each with a gap of gap_frac of the period."""
    period = 1.0 / rate_hz
    gap = gap_frac * period
    return [(t0 + i * period, t0 + i * period + period - gap) for i in range(n)]


def onset_f1(detected_ms, truth_ms, tol_ms=50.0):
    used, tp = set(), 0
    for d in detected_ms:
        best, bi = tol_ms, -1
        for j, t in enumerate(truth_ms):
            if j in used:
                continue
            if abs(d - t) < best:
                best, bi = abs(d - t), j
        if bi >= 0:
            used.add(bi); tp += 1
    fp, fn = len(detected_ms) - tp, len(truth_ms) - tp
    p = tp / max(tp + fp, 1e-9)
    r = tp / max(tp + fn, 1e-9)
    return 2 * p * r / max(p + r, 1e-9)


CASES = []
for rate in (2, 4, 6, 8):
    for gap in (0.5, 0.3, 0.15, 0.05):     # full silence down to a shallow dip
        ev = repeats(rate, gap)
        CASES.append((f"repeat {rate}/s gap {gap:.2f}", ev, 8.0 / rate + 1.0,
                      [e[0] * 1000 for e in ev[1:]], 0.0, 0.0))   # truth = re-attacks only
VIBRATO = [(f"vibrato {hz}Hz d{d:.1f}", [(0.3, 3.3)], 4.0, [], hz, d)
           for hz in (4.0, 5.0, 6.5) for d in (0.4, 0.5, 0.6)]

print(f"{'dip':>5}{'rise':>6}{'minDip':>8} | {'repeat F1':>10}{'vib splits':>12}")
print("-" * 45)
rows = []
for dip, rise, mind in itertools.product((0.35, 0.4, 0.5, 0.6, 0.7),
                                         (0.55, 0.65, 0.75, 0.85),
                                         (20.0, 35.0, 50.0, 80.0, 120.0)):
    if rise <= dip:
        continue                      # hysteresis must be positive
    f1s, vib = [], 0
    for name, ev, dur, truth, hz, depth in CASES + VIBRATO:
        y = render(ev, dur, tremolo_hz=hz, tremolo_depth=depth)
        got = [i * HOP_MS for i in detect_reattacks(frame_rms(y), dip, rise, mind)]
        if name.startswith("vibrato"):
            vib += len(got)
        else:
            f1s.append(onset_f1(got, truth))
    rows.append((np.mean(f1s), vib, dip, rise, mind))
    print(f"{dip:>5.2f}{rise:>6.2f}{mind:>8.0f} | {np.mean(f1s):>10.3f}{vib:>12}")

clean = [r for r in rows if r[1] == 0]
print("\n-- best with ZERO vibrato false splits --")
if clean:
    f1, vib, dip, rise, mind = max(clean)
    print(f"dipRatio={dip}  riseRatio={rise}  minDipMs={mind}  repeat F1={f1:.3f}")
else:
    print("NONE. No triple separates vibrato from repeats -- the global design fails.")
    print("Escalate: the fallback is broadband dip as trigger + per-voice salience dip as")
    print("confirmation (spec 'Risks specific to this phase').")
f1, vib, dip, rise, mind = max(rows)
print(f"\nunconstrained best: dip={dip} rise={rise} minDip={mind} F1={f1:.3f} vibSplits={vib}")
print(f"pMPM's constants here: ", end="")
for r in rows:
    if (r[2], r[3], r[4]) == (0.5, 0.65, 50.0):
        print(f"F1={r[0]:.3f} vibSplits={r[1]}")
```

- [ ] **Step 3: Run the sweep**

Run: `/Users/theo/audio_analysis/venv/bin/python3 /Users/theo/audio_analysis/reattack_sweep.py`

Expected: a table of ~80 rows, then a "best with ZERO vibrato false splits" line. **Record the winning triple and the `pMPM's constants here` line** — both go into `reattack.ts`'s docblock in Task 5.

**If the "NONE" branch prints, STOP and report to the user.** The global re-attack decision is invalidated and Tasks 5–6 need redesigning before proceeding.

- [ ] **Step 4: Commit (in the audio_analysis repo only)**

```bash
cd /Users/theo/audio_analysis && git add reattack_sweep.py && git commit -m "Sweep re-attack constants for HSA v2's 11.61ms framing"
```

---

### Task 2: Vendor cqt-web and wrap it in a chunked CqtAnalyzer

**Files:**
- Create: `src/audio/dsp/vendor/cqt.js`, `src/audio/dsp/vendor/cqt.wasm`, `src/audio/dsp/vendor/PROVENANCE.md`
- Create: `src/audio/dsp/cqt.ts`
- Create: `scripts/verify-hsa.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export interface CqtConfig { sampleRate: number; hop: number; binsPerOctave: number; nBins: number; fmin: number; }
  export interface CqtResult { nBins: number; frameCount: number; data: Float32Array; }  // row-major frame*nBins+bin
  export const HSA_CQT_CONFIG: CqtConfig;
  export class CqtAnalyzer {
    static create(config: CqtConfig): Promise<CqtAnalyzer>;
    analyze(samples: Float32Array, options?: { onProgress?: (f: number) => void; shouldCancel?: () => boolean }): Promise<CqtResult>;
    analyzeWhole(samples: Float32Array): CqtResult;   // unchunked, harness only
    dispose(): void;
  }
  ```

- [ ] **Step 1: Vendor the package**

```bash
cd /Users/theo/harp2tab && mkdir -p src/audio/dsp/vendor
npm pack cqt-web@1.0.4 --pack-destination /tmp
tar xzf /tmp/cqt-web-1.0.4.tgz -C /tmp
cp /tmp/package/dist/cqt.js  src/audio/dsp/vendor/cqt.js
cp /tmp/package/dist/cqt.wasm src/audio/dsp/vendor/cqt.wasm
cp /tmp/package/LICENSE       src/audio/dsp/vendor/LICENSE.cqt-web
```

Then write `src/audio/dsp/vendor/PROVENANCE.md`:

```markdown
# Vendored: cqt-web 1.0.4

Source: https://www.npmjs.com/package/cqt-web (https://github.com/timcsy/cqt-web)
Retrieved: 2026-08-19 · License: MIT (see LICENSE.cqt-web)
Files: `dist/cqt.js`, `dist/cqt.wasm`, unmodified.

## Why vendored rather than depended on

56 downloads/month, one maintainer, all five versions published on a single day in
December 2025. Vendoring pins the exact binary that was measured, removes registry
supply-chain exposure, and lets the wasm be bundled rather than fetched at runtime.

## Why HybridCQT and not StandardCQT

Measured against librosa 0.11.0 at this engine's config (44.1kHz, hop 512, 24 bins/octave,
152 bins, fmin 169.897), then fed to the notebook's own `compute_hsa_v2_poly`:

| variant | vs librosa.cqt magnitudes | 5-min take | HSA v2 pitch sets on 34Blow.wav |
|---|---|---|---|
| StandardCQT | 0.8% median, 2.2% p90 | ~134s | 603/603 frames identical |
| HybridCQT | 3.7% median, 37.9% p90 | ~5-9s | 603/603 frames identical |
| PseudoCQT | 96.9% median | ~23s | not evaluated |

HybridCQT's p90 looks disqualifying until the control is run: librosa's own `cqt` and
`hybrid_cqt` differ by 40.3% p90 on the same signal and also give 100% identical HSA v2
output. The disagreement lives in low-energy bins a four-harmonic weighted sum never leans
on. HybridCQT is both the fast variant and, for this algorithm, indistinguishable.

## The Node shim

The published build is compiled `-sENVIRONMENT=web,worker` and asserts `!ENVIRONMENT_IS_NODE`
on load, so it throws under `tsx`. `../cqt.ts` shims it. Do not remove that shim without
running `npx tsx scripts/verify-hsa.ts`.
```

- [ ] **Step 2: Write the failing chunk-equality assertion**

Create `scripts/verify-hsa.ts`:

```ts
/**
 * Verification harness for the HSA v2 engine. Replaces verify-spectral-pitch.ts.
 *
 * Assertion 1 is the one that earns its place: `CqtAnalyzer` slices the audio so the UI can
 * paint between chunks, and a wrong slice produces plausible-looking numbers rather than an
 * error. Everything downstream is measured against a Python reference, so a silently wrong
 * CQT would be attributed to the port.
 *
 * Run: npx tsx scripts/verify-hsa.ts
 */
import { CqtAnalyzer, HSA_CQT_CONFIG } from '../src/audio/dsp/cqt';

let failures = 0;
function check(label: string, passed: boolean, detail: string): void {
  if (!passed) failures++;
  console.log(`${passed ? '  ok  ' : ' FAIL '} ${label} — ${detail}`);
}

const SAMPLE_RATE = 44100;

/** Harmonic-rich material: a pure sine gives a four-harmonic sum nothing to sum. */
function synth(seconds: number, pitches: { hz: number; from: number; to: number }[]): Float32Array {
  const n = Math.floor(seconds * SAMPLE_RATE);
  const y = new Float32Array(n);
  for (const { hz, from, to } of pitches) {
    for (let i = Math.floor(from * SAMPLE_RATE); i < Math.min(n, Math.floor(to * SAMPLE_RATE)); i++) {
      const t = i / SAMPLE_RATE;
      for (let h = 1; h <= 8; h++) {
        if (hz * h >= 0.45 * SAMPLE_RATE) break;
        y[i] += Math.pow(h, -0.6) * Math.sin(2 * Math.PI * hz * h * t);
      }
    }
  }
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < n; i++) y[i] = (0.9 * y[i]) / peak;
  return y;
}

async function main(): Promise<void> {
  console.log('\n=== 1. Chunked CQT equals whole-file CQT ===\n');
  {
    const audio = synth(25, [
      { hz: 392.0,  from: 0.3,  to: 6.0 },
      { hz: 523.25, from: 0.3,  to: 6.0 },
      { hz: 880.0,  from: 8.0,  to: 14.0 },
      { hz: 293.66, from: 16.0, to: 24.0 },
    ]);
    const cqt = await CqtAnalyzer.create(HSA_CQT_CONFIG);
    const whole   = cqt.analyzeWhole(audio);
    const chunked = await cqt.analyze(audio);
    cqt.dispose();

    check('frame counts match', whole.frameCount === chunked.frameCount,
          `whole ${whole.frameCount}, chunked ${chunked.frameCount}`);

    let worst = 0, worstFrame = -1;
    const n = Math.min(whole.data.length, chunked.data.length);
    for (let i = 0; i < n; i++) {
      const d = Math.abs(whole.data[i] - chunked.data[i]);
      if (d > worst) { worst = d; worstFrame = Math.floor(i / whole.nBins); }
    }
    let peak = 0;
    for (const v of whole.data) peak = Math.max(peak, v);
    check('chunked CQT is bit-comparable to whole-file',
          worst < 1e-5 * peak,
          `worst abs diff ${worst.toExponential(2)} at frame ${worstFrame} (peak ${peak.toFixed(3)})`);
  }

  console.log('');
  if (failures > 0) { console.log(`${failures} failure(s)\n`); process.exit(1); }
  console.log('All checks passed\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: FAIL — `Cannot find module '../src/audio/dsp/cqt'`

- [ ] **Step 4: Implement `CqtAnalyzer`**

Create `src/audio/dsp/cqt.ts`:

```ts
/**
 * The CQT front end for the HSA v2 engine — a thin wrapper over vendored `cqt-web`.
 *
 * Two things here are not incidental.
 *
 * **The chunking.** `compute()` is one blocking WASM call: 5–9 seconds on a five-minute
 * take with the stack never unwinding, so no progress bar moves, no Cancel is delivered,
 * and the page does not paint. `computeWithProgress` does not help — its callback runs
 * inside the same stack. So the input is sliced, with enough context either side that
 * every retained frame sees the same samples it would have seen in a whole-file run, and
 * the event loop is yielded between slices. `verify-hsa.ts`'s first assertion exists
 * because a wrong slice produces plausible numbers rather than an error.
 *
 * **The Node shim.** The published build is compiled `-sENVIRONMENT=web,worker` and
 * asserts `!ENVIRONMENT_IS_NODE` on load. Without the three lines in `loadModule` the
 * verification harnesses cannot run at all. See `vendor/PROVENANCE.md`.
 */

// @ts-expect-error — vendored Emscripten glue, no types shipped.
import createCQTModule from './vendor/cqt.js';

export interface CqtConfig {
  sampleRate:    number;
  hop:           number;
  binsPerOctave: number;
  nBins:         number;
  fmin:          number;
}

export interface CqtResult {
  nBins:      number;
  frameCount: number;
  /** Row-major, `frame * nBins + bin`. */
  data:       Float32Array;
}

/**
 * The notebook's framing (`HSA_v2_polyphonic.ipynb` cell 3), unchanged.
 *
 * `fmin` is `180 / 2^(1/12)` — a semitone of margin under the 180Hz F0 floor so the lowest
 * candidate still has a bin under it. 152 bins reaches `3200 · 4 · 2^(1/12)` ≈ 13.6kHz, so
 * every candidate is scored on all four of its harmonics.
 */
export const HSA_CQT_CONFIG: CqtConfig = {
  sampleRate:    44100,
  hop:           512,
  binsPerOctave: 24,
  nBins:         152,
  fmin:          180 / Math.pow(2, 1 / 12),
};

/** Frames per slice — ~9.3s at 11.61ms. Large enough that the 2×32-frame context overhead
 *  is ~8%, small enough that a Cancel press lands within a second. */
const CHUNK_FRAMES = 800;

/**
 * Frames of context kept either side of a slice and then discarded.
 *
 * The longest filter is `Q · sr / fmin` = 8,858 samples, and the transform centres each
 * filter on its frame, so a frame needs 4,429 samples either side to be computed the same
 * way a whole-file run would compute it. 32 hops is 16,384 samples — comfortable margin,
 * and cheap.
 */
const CONTEXT_FRAMES = 32;

let modulePromise: Promise<any> | null = null;

function loadModule(): Promise<any> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    // The vendored build refuses to initialise when it detects Node. Under `tsx` (the
    // verification harnesses) that assert fires before any of our code runs, so the
    // environment is disguised for the duration of instantiation only. In a browser all
    // three lines are no-ops.
    const g = globalThis as any;
    const hadWindow = 'window' in g;
    const realProcess = g.process;
    if (!hadWindow) g.window = g;
    if (realProcess) delete g.process;
    try {
      return await createCQTModule();
    } finally {
      if (realProcess) g.process = realProcess;
      if (!hadWindow) delete g.window;
    }
  })();
  return modulePromise;
}

function frameCountFor(sampleCount: number, hop: number): number {
  // Matches the transform's own centred framing, and `librosa.feature.rms` with
  // `center=True` — which is what keeps the RMS envelope frame-aligned with the CQT.
  return 1 + Math.floor(sampleCount / hop);
}

export class CqtAnalyzer {
  private readonly config: CqtConfig;
  private instance: any;

  private constructor(config: CqtConfig, instance: any) {
    this.config   = config;
    this.instance = instance;
  }

  static async create(config: CqtConfig): Promise<CqtAnalyzer> {
    const Module = await loadModule();
    const instance = new Module.HybridCQT(
      config.sampleRate, config.hop, config.binsPerOctave, config.nBins, config.fmin,
    );
    return new CqtAnalyzer(config, instance);
  }

  /** One call, no yielding. The harness's reference; never used by the app. */
  analyzeWhole(samples: Float32Array): CqtResult {
    const out = this.instance.compute(samples) as Float32Array;
    return {
      nBins:      this.config.nBins,
      frameCount: out.length / this.config.nBins,
      data:       Float32Array.from(out),
    };
  }

  async analyze(
    samples: Float32Array,
    options: { onProgress?: (fraction: number) => void; shouldCancel?: () => boolean } = {},
  ): Promise<CqtResult> {
    const { hop, nBins } = this.config;
    const frameCount = frameCountFor(samples.length, hop);
    const data = new Float32Array(frameCount * nBins);

    for (let first = 0; first < frameCount; first += CHUNK_FRAMES) {
      const last = Math.min(frameCount, first + CHUNK_FRAMES);

      // Slice bounds in samples. Both edges are whole hops, so a slice frame maps onto a
      // global frame by a plain integer offset — which is the property the trim relies on.
      const leadFrames = Math.min(CONTEXT_FRAMES, first);
      const start      = (first - leadFrames) * hop;
      const end        = Math.min(samples.length, (last + CONTEXT_FRAMES) * hop);
      const slice      = samples.subarray(start, end);

      const out = this.instance.compute(slice) as Float32Array;
      const produced = out.length / nBins;

      for (let f = first; f < last; f++) {
        const local = leadFrames + (f - first);
        if (local >= produced) break;
        data.set(out.subarray(local * nBins, local * nBins + nBins), f * nBins);
      }

      options.onProgress?.(Math.min(1, last / frameCount));
      if (options.shouldCancel?.()) break;
      // setTimeout, not a microtask — a resolved promise would not let React paint the
      // progress bar or let a Cancel press be delivered between slices.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return { nBins, frameCount, data };
  }

  dispose(): void {
    this.instance?.delete();
    this.instance = null;
  }
}
```

- [ ] **Step 5: Run the harness to verify it passes**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: PASS on both checks. If the frame counts match but the values do not, the trim offset is wrong — `leadFrames` must equal the number of frames dropped from the slice's output, and `start` must be a whole multiple of `hop`.

- [ ] **Step 6: Commit**

```bash
git add src/audio/dsp/vendor src/audio/dsp/cqt.ts scripts/verify-hsa.ts
git commit -m "Vendor cqt-web and wrap it in a chunked CqtAnalyzer"
```

---

### Task 3: Port the poly pass, verified against Python frame for frame

**Files:**
- Create: `src/audio/dsp/hsaPoly.ts`
- Create: `/Users/theo/audio_analysis/dump_hsa_fixture.py`
- Create: `scripts/fixtures/hsa/` (holds the dumped `.f32` / `.json`)
- Modify: `scripts/verify-hsa.ts` (add assertion 2)

**Interfaces:**
- Consumes: `CqtResult`, `HSA_CQT_CONFIG` from Task 2
- Produces:
  ```ts
  export const MAX_VOICES = 4;
  export interface PolyFrames {
    frameCount: number;
    pitch:    Float32Array;   // frame*MAX_VOICES+slot, fractional MIDI, NaN when unused
    salience: Float32Array;   // same indexing
    sFirst:   Float32Array;   // per frame
  }
  export function analyzePoly(cqt: CqtResult, config: CqtConfig, voiced: Uint8Array): PolyFrames;
  ```

- [ ] **Step 1: Write the Python fixture dump**

Create `/Users/theo/audio_analysis/dump_hsa_fixture.py`:

```python
"""
Dumps HSA v2's reference output for the TypeScript port to be checked against.

The port's correctness claim is 'it computes what the notebook computes'. Only a
frame-for-frame comparison against the notebook's own code can substantiate that, so this
writes both the input (as f32 PCM at 44.1kHz, so the TS side decodes nothing) and the
expected per-frame pitch sets.
"""
import json, sys, numpy as np, librosa
sys.path.insert(0, "/Users/theo/audio_analysis")
from hsa import compute_hsa_v2_poly     # extracted from HSA_v2_polyphonic.ipynb cell 11

SR, HOP, BPO, NB = 44100, 512, 24, 152
FMIN = 180.0 / 2 ** (1 / 12)
OUT = "/Users/theo/harp2tab/scripts/fixtures/hsa"

def gate(y):
    db = librosa.amplitude_to_db(
        librosa.feature.rms(y=y, frame_length=1024, hop_length=HOP)[0], ref=np.max)
    return db > -20.0

def dump(name, y):
    y = y.astype(np.float32)
    y.tofile(f"{OUT}/{name}.f32")
    v = gate(y)
    spec = np.abs(librosa.cqt(y.astype(np.float64), sr=SR, hop_length=HOP,
                              fmin=FMIN, n_bins=NB, bins_per_octave=BPO))
    out = compute_hsa_v2_poly(spec, FMIN, BPO, v)          # rel_threshold 0.60 applied
    frames = [sorted(int(round(m)) for m in librosa.hz_to_midi(r[r > 0])) if (r > 0).any() else []
              for r in out]
    json.dump({"sampleRate": SR, "frameCount": len(frames),
               "voiced": [bool(x) for x in v], "pitches": frames},
              open(f"{OUT}/{name}.json", "w"))
    print(f"{name}: {len(y)/SR:.1f}s, {int(v.sum())} gated frames, "
          f"{sum(len(f) for f in frames)} voice-frames")

y, _ = librosa.load("/Users/theo/recordings_harmonica/double_notes/34Blow.wav", sr=SR, mono=True)
dump("34blow", y)

# A synthetic double-stop with an exactly known answer, so a failure can be localised to a
# pitch rather than only to a frame.
t = np.arange(int(3.0 * SR)) / SR
s = np.zeros_like(t)
for f0 in (392.0, 523.25):
    for h in range(1, 9):
        s[(t >= 0.3) & (t < 2.5)] += (h ** -0.6) * np.sin(2 * np.pi * f0 * h * t)[(t >= 0.3) & (t < 2.5)]
dump("synth_g4c5", 0.9 * s / np.max(np.abs(s)))
```

- [ ] **Step 2: Run the dump**

```bash
mkdir -p /Users/theo/harp2tab/scripts/fixtures/hsa
cd /Users/theo/audio_analysis && venv/bin/python3 dump_hsa_fixture.py
```

Expected: `34blow: 7.0s, 227 gated frames, ...` and a `synth_g4c5` line. Four files in `scripts/fixtures/hsa/`.

`hsa.py` must exist alongside — extract it from the notebook if it does not:

```bash
cd /Users/theo/audio_analysis && venv/bin/python3 -c "
import json
nb = json.load(open('HSA_v2_polyphonic.ipynb'))
open('hsa.py','w').write(
  'import numpy as np\nMAX_VOICES=4\nREL_THRESHOLD=0.60\nCANCEL_FACTOR=0.85\n'
  \"CANCEL_MODE='envelope'\n\" + 'F0_MIN=180.0\nF0_MAX=3200.0\nNUM_HARMONICS=4\n'
  + ''.join(nb['cells'][11]['source']))"
```

- [ ] **Step 3: Write the failing parity assertion**

Add to `scripts/verify-hsa.ts`, before the final summary block:

```ts
  console.log('\n=== 2. Poly pass matches the Python reference ===\n');
  {
    for (const name of ['synth_g4c5', '34blow']) {
      const pcm = new Float32Array(
        readFileSync(`${FIXTURES}/${name}.f32`).buffer.slice(0),
      );
      const expected = JSON.parse(readFileSync(`${FIXTURES}/${name}.json`, 'utf8')) as {
        frameCount: number; voiced: boolean[]; pitches: number[][];
      };

      const cqtAnalyzer = await CqtAnalyzer.create(HSA_CQT_CONFIG);
      const cqt = await cqtAnalyzer.analyze(pcm);
      cqtAnalyzer.dispose();

      const voiced = Uint8Array.from(expected.voiced, (v) => (v ? 1 : 0));
      const poly = analyzePoly(cqt, HSA_CQT_CONFIG, voiced);

      let same = 0;
      const total = Math.min(poly.frameCount, expected.frameCount);
      for (let f = 0; f < total; f++) {
        const got: number[] = [];
        for (let s = 0; s < MAX_VOICES; s++) {
          const p = poly.pitch[f * MAX_VOICES + s];
          if (!Number.isFinite(p)) continue;
          if (poly.salience[f * MAX_VOICES + s] < 0.60 * poly.sFirst[f]) continue;
          got.push(Math.round(p));
        }
        got.sort((a, b) => a - b);
        const want = expected.pitches[f];
        if (got.length === want.length && got.every((v, i) => v === want[i])) same++;
      }
      check(`${name}: pitch sets match Python`, same === total,
            `${same}/${total} frames identical`);
    }
  }
```

Add the imports at the top of the file:

```ts
import { readFileSync } from 'node:fs';
import { analyzePoly, MAX_VOICES } from '../src/audio/dsp/hsaPoly';

const FIXTURES = `${__dirname}/fixtures/hsa`;
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: FAIL — `Cannot find module '../src/audio/dsp/hsaPoly'`

- [ ] **Step 5: Implement the poly pass**

Create `src/audio/dsp/hsaPoly.ts`:

```ts
/**
 * Multiple-F0 estimation over one CQT column, by iterative estimation and cancellation.
 *
 * A direct port of `compute_hsa_v2_poly` from `HSA_v2_polyphonic.ipynb` (cell 11). Every
 * constant below is that notebook's, and the port is checked frame-for-frame against its
 * output by `scripts/verify-hsa.ts`. **Do not re-tune anything here without re-running the
 * notebook** — the numbers were chosen together by a sweep, and moving one of them alone
 * moves the operating point the others were picked at.
 *
 * One deliberate divergence: the notebook stops accepting voices as soon as one scores
 * below `rel_threshold × the first voice`, and this runs to all four regardless, recording
 * each voice's salience so the threshold can be applied later. That makes `relThreshold`
 * and `maxVoices` cheap-half parameters — a slider drag re-reads stored numbers instead of
 * re-running the CQT. It is exactly equivalent for any threshold value, because the
 * notebook's break happens *before* cancellation: a voice it would have rejected can never
 * have influenced the salience of a voice it would have kept.
 */

import type { CqtConfig, CqtResult } from './cqt';

/** Voices estimated per frame. The notebook's `MAX_VOICES`. */
export const MAX_VOICES = 4;

const NUM_HARMONICS = 4;
const ATTENUATION   = 0.84;
const F0_MIN        = 180.0;
const F0_MAX        = 3200.0;
const CANCEL_FACTOR = 0.85;
const CANCEL_WIDTH  = 1;
/** Bins masked either side of an accepted voice — 3 at 24 bins/octave is 1.5 semitones. */
const MIN_SEPARATION_BINS = 3;
/** Clamp on the fitted rolloff exponent, so a noisy fit cannot invent or erase energy. */
const BETA_MAX = 3.0;

export interface PolyFrames {
  frameCount: number;
  /** `frame * MAX_VOICES + slot`. Fractional MIDI — a bend is not rounded away here.
   *  NaN in unused slots. */
  pitch:    Float32Array;
  /** Same indexing. Raw harmonic-sum salience, not normalised. */
  salience: Float32Array;
  /** Per frame: the first (strongest) voice's salience, the reference every threshold is
   *  relative to. Zero on ungated frames. */
  sFirst:   Float32Array;
}

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export function analyzePoly(cqt: CqtResult, config: CqtConfig, voiced: Uint8Array): PolyFrames {
  const { nBins, frameCount, data } = cqt;
  const { fmin, binsPerOctave } = config;

  const binHz = (b: number) => fmin * Math.pow(2, b / binsPerOctave);

  // Candidate bins: those whose centre frequency is a plausible fundamental.
  const cand: number[] = [];
  for (let b = 0; b < nBins; b++) {
    const f = binHz(b);
    if (f >= F0_MIN && f <= F0_MAX) cand.push(b);
  }

  const offsets = new Int32Array(NUM_HARMONICS);
  const weights = new Float64Array(NUM_HARMONICS);
  for (let h = 0; h < NUM_HARMONICS; h++) {
    offsets[h] = Math.round(binsPerOctave * Math.log2(h + 1));
    weights[h] = Math.pow(ATTENUATION, h);
  }

  // Candidate × harmonic bin lookup, built once. `used` normalises by the weights actually
  // available, so a candidate near the top of the spectrum is not penalised for harmonics
  // that fall off the end of it.
  const idxTab  = new Int32Array(cand.length * NUM_HARMONICS);
  const inside  = new Uint8Array(cand.length * NUM_HARMONICS);
  const usedTab = new Float64Array(cand.length);
  for (let c = 0; c < cand.length; c++) {
    for (let h = 0; h < NUM_HARMONICS; h++) {
      const p = cand[c] + offsets[h];
      idxTab[c * NUM_HARMONICS + h] = p;
      if (p < nBins) {
        inside[c * NUM_HARMONICS + h] = 1;
        usedTab[c] += weights[h];
      }
    }
  }

  const out: PolyFrames = {
    frameCount,
    pitch:    new Float32Array(frameCount * MAX_VOICES).fill(NaN),
    salience: new Float32Array(frameCount * MAX_VOICES),
    sFirst:   new Float32Array(frameCount),
  };

  const residual = new Float64Array(nBins);
  const sal      = new Float64Array(cand.length);
  const accepted = new Int32Array(MAX_VOICES);
  const amps     = new Float64Array(NUM_HARMONICS);
  const model    = new Float64Array(NUM_HARMONICS);

  for (let frame = 0; frame < frameCount; frame++) {
    if (!voiced[frame]) continue;
    for (let b = 0; b < nBins; b++) residual[b] = data[frame * nBins + b];

    let acceptedCount = 0;
    for (let voice = 0; voice < MAX_VOICES; voice++) {
      for (let c = 0; c < cand.length; c++) {
        let sum = 0;
        for (let h = 0; h < NUM_HARMONICS; h++) {
          if (inside[c * NUM_HARMONICS + h]) sum += weights[h] * residual[idxTab[c * NUM_HARMONICS + h]];
        }
        sal[c] = sum / Math.max(usedTab[c], 1e-12);
      }

      // Never re-pick a bin adjacent to a voice already taken this frame.
      for (let a = 0; a < acceptedCount; a++) {
        const lo = Math.max(0, accepted[a] - MIN_SEPARATION_BINS - cand[0]);
        const hi = Math.min(cand.length, accepted[a] + MIN_SEPARATION_BINS + 1 - cand[0]);
        for (let c = lo; c < hi; c++) sal[c] = Number.NEGATIVE_INFINITY;
      }

      let k = 0;
      for (let c = 1; c < cand.length; c++) if (sal[c] > sal[k]) k = c;
      if (!Number.isFinite(sal[k])) break;

      if (voice === 0) out.sFirst[frame] = sal[k];

      // Parabolic interpolation across the salience peak, so a bend survives the
      // quarter-tone bin grid.
      let d = 0;
      if (k > 0 && k < cand.length - 1 && Number.isFinite(sal[k - 1]) && Number.isFinite(sal[k + 1])) {
        const den = 2 * (2 * sal[k] - sal[k - 1] - sal[k + 1]);
        if (Math.abs(den) > 1e-12) d = Math.max(-0.5, Math.min(0.5, (sal[k + 1] - sal[k - 1]) / den));
      }

      const hz = fmin * Math.pow(2, (cand[k] + d) / binsPerOctave);
      out.pitch[frame * MAX_VOICES + voice]    = hzToMidi(hz);
      out.salience[frame * MAX_VOICES + voice] = sal[k];
      accepted[acceptedCount++] = cand[k];

      // ── Cancellation, envelope mode ──────────────────────────────────────────
      //
      // Subtracting the winner's *measured* partials would also remove a co-sounding
      // note's energy wherever they share a bin. Fitting a smooth rolloff through the four
      // partials and subtracting that instead removes only what this note's own envelope
      // predicts, and leaves the excess — which is the co-sounding note.
      let count = 0;
      for (let h = 0; h < NUM_HARMONICS; h++) {
        const p = cand[k] + offsets[h];
        if (p < nBins) amps[count++] = residual[p];
      }
      if (count >= 2 && amps[0] > 0) {
        let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let h = 0; h < count; h++) {
          const x = Math.log(h + 1);
          const y = Math.log(Math.max(amps[h], 1e-12));
          n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
        }
        const den = n * sxx - sx * sx;
        const slope = Math.abs(den) > 1e-12 ? (n * sxy - sx * sy) / den : 0;
        const beta = Math.max(0, Math.min(BETA_MAX, -slope));
        for (let h = 0; h < count; h++) {
          model[h] = Math.min(amps[0] * Math.pow(h + 1, -beta), amps[h]);
        }
      } else {
        for (let h = 0; h < count; h++) model[h] = amps[h];
      }

      let j = 0;
      for (let h = 0; h < NUM_HARMONICS; h++) {
        const p = cand[k] + offsets[h];
        if (p >= nBins) continue;
        const lo = Math.max(0, p - CANCEL_WIDTH);
        const hi = Math.min(nBins, p + CANCEL_WIDTH + 1);
        for (let i = lo; i < hi; i++) {
          const taper = 1 - Math.abs(i - p) / (CANCEL_WIDTH + 1);
          residual[i] = Math.max(0, residual[i] - CANCEL_FACTOR * model[j] * taper);
        }
        j++;
      }
    }
  }

  return out;
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: PASS — `synth_g4c5: pitch sets match Python — N/N frames identical` and the same for `34blow`.

If a handful of frames differ, print the disagreeing frames and compare `sFirst` — the usual cause is `offsets` rounding (`Math.round(24 * Math.log2(3))` must be 38, not 39) or the `min_separation_bins` mask being applied against bin indices rather than candidate indices.

- [ ] **Step 7: Commit**

```bash
git add src/audio/dsp/hsaPoly.ts scripts/verify-hsa.ts scripts/fixtures/hsa
git commit -m "Port HSA v2's poly pass, verified frame-for-frame against Python"
cd /Users/theo/audio_analysis && git add dump_hsa_fixture.py hsa.py && \
  git commit -m "Dump HSA v2 reference fixtures for the harp2tab port"
```

---

### Task 4: The re-attack detector

**Files:**
- Create: `src/audio/segmenters/reattack.ts`
- Modify: `scripts/verify-hsa.ts` (add assertion 3)

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export interface ReattackConfig {
    dipRatio: number; riseRatio: number; minDipMs: number;
    noiseFloorAlpha: number; noiseFloorMult: number; minPeakRmsFloor: number;
  }
  export const DEFAULT_REATTACK_CONFIG: ReattackConfig;
  export function detectReattacks(rms: Float32Array, voiced: Uint8Array, hopMs: number, config: ReattackConfig): number[];
  ```

- [ ] **Step 1: Write the failing unit cases**

Add to `scripts/verify-hsa.ts`:

```ts
  console.log('\n=== 3. Re-attack detection ===\n');
  {
    const HOP_MS = 1000 * HSA_CQT_CONFIG.hop / HSA_CQT_CONFIG.sampleRate;
    const frames = (ms: number) => Math.round(ms / HOP_MS);

    /** Build an RMS envelope directly — this tests the state machine, not the DSP. */
    function envelope(spec: { level: number; ms: number }[]): Float32Array {
      const out: number[] = [];
      for (const { level, ms } of spec) for (let i = 0; i < frames(ms); i++) out.push(level);
      return Float32Array.from(out);
    }
    const allVoiced = (n: number) => Uint8Array.from({ length: n }, () => 1);

    const clean = envelope([
      { level: 0.5, ms: 300 }, { level: 0.02, ms: 120 }, { level: 0.5, ms: 300 },
    ]);
    const cleanHits = detectReattacks(clean, allVoiced(clean.length), HOP_MS, DEFAULT_REATTACK_CONFIG);
    check('a clean repeat splits exactly once', cleanHits.length === 1,
          `${cleanHits.length} split(s) at frame(s) [${cleanHits}]`);

    const shallow = envelope([
      { level: 0.5, ms: 300 }, { level: 0.45, ms: 120 }, { level: 0.5, ms: 300 },
    ]);
    check('a shallow dip does not split',
          detectReattacks(shallow, allVoiced(shallow.length), HOP_MS, DEFAULT_REATTACK_CONFIG).length === 0,
          'dip never reaches dipRatio');

    const brief = envelope([
      { level: 0.5, ms: 300 }, { level: 0.02, ms: 12 }, { level: 0.5, ms: 300 },
    ]);
    check('a dip shorter than minDipMs does not split',
          detectReattacks(brief, allVoiced(brief.length), HOP_MS, DEFAULT_REATTACK_CONFIG).length === 0,
          '12ms dip, one frame');

    // The case that moved the constants. 5Hz at 50% depth: half-period 100ms, comfortably
    // past minDipMs, depth comfortably past dipRatio. It must still not split.
    const n = frames(3000);
    const vibrato = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      vibrato[i] = 0.5 * (1 - 0.5 * 0.5 * (1 - Math.cos(2 * Math.PI * 5 * ((i * HOP_MS) / 1000))));
    }
    const vibHits = detectReattacks(vibrato, allVoiced(n), HOP_MS, DEFAULT_REATTACK_CONFIG);
    check('5Hz vibrato at 50% depth produces no splits', vibHits.length === 0,
          `${vibHits.length} split(s)`);

    const quiet = envelope([
      { level: 0.0005, ms: 300 }, { level: 0.00002, ms: 120 }, { level: 0.0005, ms: 300 },
    ]);
    check('below the noise floor, nothing splits',
          detectReattacks(quiet, new Uint8Array(quiet.length), HOP_MS, DEFAULT_REATTACK_CONFIG).length === 0,
          'peak never clears minPeakRmsFloor');
  }
```

Add to the imports:

```ts
import { detectReattacks, DEFAULT_REATTACK_CONFIG } from '../src/audio/segmenters/reattack';
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: FAIL — `Cannot find module '../src/audio/segmenters/reattack'`

- [ ] **Step 3: Implement it**

Create `src/audio/segmenters/reattack.ts`. **Fill `DEFAULT_REATTACK_CONFIG`'s first three values with the triple Task 1 measured, and paste Task 1's table into the docblock** in place of the bracketed line:

```ts
/**
 * Re-attack detection from the amplitude envelope alone.
 *
 * This is the one thing pMPM does that no note-lane engine has ever done: hear the same
 * note played twice. `NoteDetector` has carried it since the live path was written
 * (`NoteDetector.ts:79`) and it is why the classic tracker splits a tongued repeat while
 * Basic Pitch and the old spectral engine wrote it as one long note. Pitch cannot decide
 * this — the pitch does not change — and neither can silence, since a tongued repeat's gap
 * often never reaches the voicing gate. Amplitude is the only evidence there is.
 *
 * It matters more here than it did in pMPM. At 24 bins/octave the CQT's effective window is
 * ~201ms at the bottom of the harmonica's range, so the pitch track physically cannot
 * resolve a fast repeated low note. The 1024-sample RMS envelope can.
 *
 * ## The constants
 *
 * pMPM's own (`dipRatio 0.5 / riseRatio 0.65 / minDipMs 50`) are calibrated against 46.4ms
 * non-overlapping frames. This engine runs at 11.61ms, where `minDipMs 50` is ~4 frames
 * instead of ~1 and vibrato ripple is fully resolved rather than smeared. They were
 * re-swept against synthesised repeats and a vibrato control
 * (`/Users/theo/audio_analysis/reattack_sweep.py`):
 *
 * [PASTE Task 1's result table here: the winning triple, its repeat F1, and what pMPM's
 *  own constants scored on the same material including their vibrato false-split count.]
 *
 * The objective was deliberately constrained rather than maximised: best repeat F1
 * **subject to zero vibrato false splits**. A detector that splits a held vibrato note
 * fabricates notes the player never played, which is worse than missing a fast repeat.
 *
 * `noiseFloorAlpha` is the one value that was rescaled rather than re-measured. pMPM's 0.02
 * at 46.4ms gives a ~2.3s time constant; 0.005 at 11.61ms gives the same. That is
 * arithmetic, not a judgement call.
 */

export interface ReattackConfig {
  /** RMS must fall to ≤ this fraction of the running peak to start a dip. */
  dipRatio:        number;
  /** ...and recover to ≥ this fraction to confirm one. Kept above `dipRatio` on purpose —
   *  the gap between them is the hysteresis that stops a wobble reading as two notes. */
  riseRatio:       number;
  /** How long the dip must last to count as real rather than frame noise. */
  minDipMs:        number;
  /** EMA factor for the ambient floor, learned from ungated frames. */
  noiseFloorAlpha: number;
  /** The envelope peak must exceed this multiple of the ambient floor before any of this
   *  is trusted. Raw RMS is device-dependent, so a fixed cutoff is not portable. */
  noiseFloorMult:  number;
  /** Absolute fallback, used before any ambient noise has been sampled. */
  minPeakRmsFloor: number;
}

export const DEFAULT_REATTACK_CONFIG: ReattackConfig = {
  dipRatio:        0.5,   // ← replace with Task 1's measured value
  riseRatio:       0.65,  // ← replace with Task 1's measured value
  minDipMs:        50,    // ← replace with Task 1's measured value
  noiseFloorAlpha: 0.005,
  noiseFloorMult:  2.5,
  minPeakRmsFloor: 0.001,
};

/**
 * Frame indices at which a re-attack was confirmed.
 *
 * Pure — same inputs, same output, no state across calls — because the cheap half runs it
 * on every slider tick.
 */
export function detectReattacks(
  rms:    Float32Array,
  voiced: Uint8Array,
  hopMs:  number,
  config: ReattackConfig = DEFAULT_REATTACK_CONFIG,
): number[] {
  const splits: number[] = [];
  let ambient  = 0;
  let peak     = 0;
  let dipping  = false;
  let dipStart = 0;

  for (let i = 0; i < rms.length; i++) {
    const level = rms[i];

    // The ambient floor is learned from frames the gate rejected — the only frames where
    // "this is the room, not the player" is known rather than assumed.
    if (!voiced[i]) ambient = ambient > 0 ? ambient + config.noiseFloorAlpha * (level - ambient) : level;

    if (level > peak) peak = level;
    if (peak < Math.max(config.minPeakRmsFloor, ambient * config.noiseFloorMult)) continue;

    if (!dipping) {
      if (level <= peak * config.dipRatio) {
        dipping  = true;
        dipStart = i;
      }
      continue;
    }

    if (level >= peak * config.riseRatio) {
      dipping = false;
      if ((i - dipStart) * hopMs >= config.minDipMs) {
        // Peak resets to the new attack, so a decaying take doesn't make every later dip
        // look shallow against a peak set at the very start.
        peak = level;
        splits.push(i);
      }
    }
  }

  return splits;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: PASS on all five re-attack checks. **The vibrato check is the one that matters** — if it fails with the swept constants, Task 1's sweep and this implementation disagree and the state machines must be diffed line by line.

- [ ] **Step 5: Commit**

```bash
git add src/audio/segmenters/reattack.ts scripts/verify-hsa.ts
git commit -m "Add the amplitude-envelope re-attack detector, re-tuned for 11.61ms frames"
```

---

### Task 5: The expensive pass — resample, gate, and store

**Files:**
- Create: `src/audio/algorithms/hsa.web.ts`
- Create: `src/audio/algorithms/hsa.ts`
- Modify: `src/audio/algorithms/index.ts:25` (add `'hsa'` to `TranscriptionAlgorithmId`)

**Interfaces:**
- Consumes: `CqtAnalyzer`, `HSA_CQT_CONFIG`, `analyzePoly`, `PolyFrames`, `MAX_VOICES`
- Produces:
  ```ts
  export interface HsaAnalysis extends PolyFrames {
    sampleRate: number; hop: number;
    rms: Float32Array; voiced: Uint8Array; flux: Float32Array;
  }
  export async function analyzeHsa(audio: DecodedAudio, options?: PrepareOptions): Promise<HsaAnalysis>;
  export const hsaAlgorithm: TranscriptionAlgorithm;
  ```

- [ ] **Step 1: Write the native stub**

Create `src/audio/algorithms/hsa.ts`:

```ts
/**
 * Native stub. HSA v2's CQT is a vendored WebAssembly module, and WASM does not run under
 * Hermes — so this engine is web-only, exactly as Basic Pitch is.
 *
 * This file exists purely so the native bundle resolves `./hsa`. The registry reads
 * `available` and hides the option rather than offering a choice that throws.
 *
 * **Native therefore has only the classic tracker.** The spectral engine this replaced was
 * pure TypeScript and ran on both bundles; it was the only polyphonic engine native could
 * ever have run. That narrowing is deliberate and is recorded in
 * `docs/plan/phase-16-hsa-engine.md`.
 */

import { AudioImportError, type DecodedAudio } from '../audioImport';
import type { Prepared, Segmentation, TranscriptionAlgorithm } from './index';

export const hsaAlgorithm: TranscriptionAlgorithm = {
  id:             'hsa',
  label:          'Harmonic transcription (HSA v2)',
  description:    'Not available on this platform yet.',
  available:      false,
  producesFrames: false,
  polyphonic:     true,
  params:         [],

  async prepare(_audio: DecodedAudio): Promise<Prepared> {
    throw new AudioImportError(
      'unsupportedFormat',
      'Harmonic transcription is only available on the web version.',
    );
  },

  async resegment(): Promise<Segmentation> {
    throw new AudioImportError(
      'unsupportedFormat',
      'Harmonic transcription is only available on the web version.',
    );
  },
};
```

- [ ] **Step 2: Add the id to the union**

In `src/audio/algorithms/index.ts:25`:

```ts
export type TranscriptionAlgorithmId = 'basicPitch' | 'hsa' | 'spectral' | 'pmpm';
```

`'spectral'` stays for now — Task 8 removes it, and keeping both compiles while the old engine is still available for comparison.

- [ ] **Step 3: Write the failing round-trip assertion**

Add to `scripts/verify-hsa.ts`:

```ts
  console.log('\n=== 4. Expensive pass: framing and gating ===\n');
  {
    const pcm = new Float32Array(readFileSync(`${FIXTURES}/34blow.f32`).buffer.slice(0));
    const expected = JSON.parse(readFileSync(`${FIXTURES}/34blow.json`, 'utf8')) as {
      voiced: boolean[]; frameCount: number;
    };
    const analysis = await analyzeHsa({
      samples: pcm, sampleRate: 44100, durationMs: (pcm.length / 44100) * 1000,
    });

    check('frame count matches the Python reference',
          analysis.frameCount === expected.frameCount,
          `${analysis.frameCount} vs ${expected.frameCount}`);

    let agree = 0;
    for (let f = 0; f < expected.frameCount; f++) {
      if ((analysis.voiced[f] === 1) === expected.voiced[f]) agree++;
    }
    check('voicing gate matches librosa within 1 frame in 200',
          agree >= expected.frameCount - Math.ceil(expected.frameCount / 200),
          `${agree}/${expected.frameCount} frames agree`);
  }
```

Add the import:

```ts
import { analyzeHsa } from '../src/audio/algorithms/hsa.web';
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: FAIL — `Cannot find module '../src/audio/algorithms/hsa.web'`

- [ ] **Step 5: Implement the expensive pass**

Create `src/audio/algorithms/hsa.web.ts`:

```ts
/**
 * HSA v2 — the offline polyphonic engine. A port of `HSA_v2_polyphonic.ipynb`.
 *
 * CQT harmonic summation with iterative estimation and cancellation. Hears chords and
 * double-stops, and — through `reattack.ts` — is the first note-lane engine that splits a
 * repeated note instead of writing it as one long one.
 *
 * Replaces the spectral engine (Phase 14). What went with it: the odd-harmonic octave
 * probe, the `octaveEvidence` control, and the harmonica-range candidate restriction. HSA
 * v2 measured octave splits as not worth exploiting (notebook §9) and that trade is
 * accepted here.
 *
 * ## Why the resampling
 *
 * Every constant in `HSA_CQT_CONFIG` and `hsaPoly.ts` is pinned to 44.1kHz, and
 * `decodeAudio.web.ts` returns the AudioContext's own rate — usually 48k. Resampling here,
 * and only here, is what makes this engine directly comparable to the notebook rather than
 * approximately so, and it is why `verify-hsa.ts` can assert frame-for-frame equality
 * against a Python dump at all. Same reasoning, same mechanism as `basicPitch.web.ts:125`.
 */

import { AudioImportError, type DecodedAudio } from '../audioImport';
import { CqtAnalyzer, HSA_CQT_CONFIG } from '../dsp/cqt';
import { analyzePoly, MAX_VOICES, type PolyFrames } from '../dsp/hsaPoly';
import type { PrepareOptions, Prepared } from './index';

const TARGET_SAMPLE_RATE = HSA_CQT_CONFIG.sampleRate;
const HOP = HSA_CQT_CONFIG.hop;
/** The RMS window, from the notebook's `FRAME_SIZE`. Only the voicing gate uses it — the
 *  CQT sets its own window per bin from Q. */
const RMS_FRAME = 1024;
/** −20dB relative to the take's loudest frame, as `ENERGY_THRESHOLD_DB` in the notebook. */
const GATE_RATIO = 0.1;

export interface HsaAnalysis extends PolyFrames {
  sampleRate: number;
  hop:        number;
  /** Per frame, from the raw samples — what `reattack.ts` reads. */
  rms:        Float32Array;
  /** Per frame, 1 where the gate passed. Stored rather than recomputed: the gate is
   *  relative to the take's maximum, which the cheap half would otherwise have to
   *  re-derive on every slider drag. */
  voiced:     Uint8Array;
  /** Half-wave-rectified CQT flux. Places onsets; never detects them. */
  flux:       Float32Array;
}

async function resampleTo44k(audio: DecodedAudio): Promise<Float32Array> {
  if (audio.sampleRate === TARGET_SAMPLE_RATE) return audio.samples;

  const targetLength = Math.max(
    1,
    Math.ceil((audio.samples.length * TARGET_SAMPLE_RATE) / audio.sampleRate),
  );
  const ctx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const buffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
  // `.set` rather than `copyToChannel`, which is typed against a plain-ArrayBuffer-backed
  // Float32Array and rejects the decoder's.
  buffer.getChannelData(0).set(audio.samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/**
 * Frame RMS, matching `librosa.feature.rms(frame_length=1024, hop_length=512, center=True)`.
 *
 * The reflect padding is not decoration: it is what makes frame *i* centred on sample
 * `i * hop`, which is what keeps the envelope aligned with the CQT's own frames. Without it
 * every re-attack would be reported half a window early.
 */
function frameRms(samples: Float32Array): Float32Array {
  const pad   = RMS_FRAME / 2;
  const count = 1 + Math.floor(samples.length / HOP);
  const out   = new Float32Array(count);
  const at = (i: number): number => {
    // np.pad(..., mode='reflect'): mirrors without repeating the edge sample.
    let j = i - pad;
    if (j < 0) j = -j;
    if (j >= samples.length) j = 2 * (samples.length - 1) - j;
    return j >= 0 && j < samples.length ? samples[j] : 0;
  };
  for (let f = 0; f < count; f++) {
    let sumSq = 0;
    for (let i = 0; i < RMS_FRAME; i++) {
      const s = at(f * HOP + i);
      sumSq += s * s;
    }
    out[f] = Math.sqrt(sumSq / RMS_FRAME);
  }
  return out;
}

export async function analyzeHsa(
  audio: DecodedAudio,
  options: PrepareOptions = {},
): Promise<HsaAnalysis> {
  const samples = await resampleTo44k(audio);

  const rms = frameRms(samples);
  let peak = 0;
  for (const v of rms) if (v > peak) peak = v;
  const gate   = peak * GATE_RATIO;
  const voiced = Uint8Array.from(rms, (v) => (v >= gate ? 1 : 0));

  const analyzer = await CqtAnalyzer.create(HSA_CQT_CONFIG);
  let cqt;
  try {
    cqt = await analyzer.analyze(samples, {
      onProgress:   (fraction) => options.onProgress?.({ stage: 'analyzing', fraction: fraction * 0.9 }),
      shouldCancel: options.shouldCancel,
    });
  } finally {
    analyzer.dispose();
  }
  if (options.shouldCancel?.()) {
    throw new AudioImportError('cancelled', 'Transcription cancelled.');
  }

  const frameCount = Math.min(cqt.frameCount, rms.length);
  const flux = new Float32Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    let sum = 0;
    for (let b = 0; b < cqt.nBins; b++) {
      const d = cqt.data[f * cqt.nBins + b] - cqt.data[(f - 1) * cqt.nBins + b];
      if (d > 0) sum += d;
    }
    flux[f] = sum;
  }

  const poly = analyzePoly(cqt, HSA_CQT_CONFIG, voiced);
  options.onProgress?.({ stage: 'analyzing', fraction: 1 });

  return {
    ...poly,
    frameCount: poly.frameCount,
    sampleRate: TARGET_SAMPLE_RATE,
    hop:        HOP,
    rms:        rms.subarray(0, poly.frameCount),
    voiced:     voiced.subarray(0, poly.frameCount),
    flux,
  };
}

export { MAX_VOICES };
```

The registry entry (`hsaAlgorithm` with `prepare`/`resegment`/`params`) is added in Task 7, once the cheap half exists to call.

- [ ] **Step 6: Run it to verify it passes**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: PASS on both new checks. A frame-count mismatch of exactly 1 means `frameCountFor` and `frameRms` disagree about centring — both must be `1 + floor(n / hop)`.

- [ ] **Step 7: Commit**

```bash
git add src/audio/algorithms/hsa.ts src/audio/algorithms/hsa.web.ts src/audio/algorithms/index.ts scripts/verify-hsa.ts
git commit -m "Add HSA v2's expensive pass: resample, gate, CQT, poly, storage"
```

---

### Task 6: The cheap half — segmentation with re-attack splitting

**Files:**
- Create: `src/audio/segmenters/hsaToNotes.ts`
- Modify: `scripts/verify-hsa.ts` (add assertion 5)

**Interfaces:**
- Consumes: `HsaAnalysis`, `MAX_VOICES`, `detectReattacks`, `DEFAULT_REATTACK_CONFIG`
- Produces:
  ```ts
  export interface HsaSegmentConfig {
    relThreshold: number; onsetThreshold: number; maxVoices: number;
    minNoteLengthMs: number; bridgeMs: number; snapToAttacks: boolean;
    splitRepeats: boolean; reattack: ReattackConfig;
  }
  export const DEFAULT_HSA_SEGMENT_CONFIG: HsaSegmentConfig;
  export function hsaToNotes(analysis: HsaAnalysis, config?: HsaSegmentConfig): MidiNote[];
  ```

- [ ] **Step 1: Write the failing assertions**

Add to `scripts/verify-hsa.ts`:

```ts
  console.log('\n=== 5. Segmentation ===\n');
  {
    const pcm = new Float32Array(readFileSync(`${FIXTURES}/34blow.f32`).buffer.slice(0));
    const analysis = await analyzeHsa({
      samples: pcm, sampleRate: 44100, durationMs: (pcm.length / 44100) * 1000,
    });

    const first  = hsaToNotes(analysis, DEFAULT_HSA_SEGMENT_CONFIG);
    const second = hsaToNotes(analysis, DEFAULT_HSA_SEGMENT_CONFIG);
    check('resegment is pure',
          JSON.stringify(first) === JSON.stringify(second),
          `${first.length} notes, identical across two runs`);

    check('notes are in onset order',
          first.every((n, i) => i === 0 || n.timeMs >= first[i - 1].timeMs),
          'everything downstream assumes this');

    // 34Blow.wav is holes 3+4 blown on a C harp: G4 (67) and C5 (72).
    const hit = (midi: number) => first.filter((n) => n.midi === midi).length;
    check('finds both expected pitches of the double stop',
          hit(67) > 0 && hit(72) > 0,
          `G4 ×${hit(67)}, C5 ×${hit(72)}, ${first.length} notes total`);

    // A synthetic repeated note: same pitch, four articulations, clear gaps.
    const repeatPcm = (() => {
      const sr = 44100, n = sr * 3;
      const y = new Float32Array(n);
      for (let k = 0; k < 4; k++) {
        const from = Math.floor((0.3 + k * 0.6) * sr);
        const to   = Math.floor((0.3 + k * 0.6 + 0.42) * sr);
        for (let i = from; i < to; i++) {
          const t = i / sr;
          for (let h = 1; h <= 8; h++) y[i] += Math.pow(h, -0.6) * Math.sin(2 * Math.PI * 523.25 * h * t);
        }
      }
      let p = 0; for (const v of y) p = Math.max(p, Math.abs(v));
      for (let i = 0; i < n; i++) y[i] = (0.9 * y[i]) / p;
      return y;
    })();
    const repeatAnalysis = await analyzeHsa({
      samples: repeatPcm, sampleRate: 44100, durationMs: 3000,
    });
    const split = hsaToNotes(repeatAnalysis, DEFAULT_HSA_SEGMENT_CONFIG);
    const merged = hsaToNotes(repeatAnalysis, { ...DEFAULT_HSA_SEGMENT_CONFIG, splitRepeats: false });
    check('four articulations of one pitch become four notes',
          split.filter((n) => n.midi === 72).length === 4,
          `${split.filter((n) => n.midi === 72).length} C5 notes with splitRepeats on, ` +
          `${merged.filter((n) => n.midi === 72).length} with it off`);
  }
```

Add the import:

```ts
import { hsaToNotes, DEFAULT_HSA_SEGMENT_CONFIG } from '../src/audio/segmenters/hsaToNotes';
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: FAIL — `Cannot find module '../src/audio/segmenters/hsaToNotes'`

- [ ] **Step 3: Implement the cheap half**

Create `src/audio/segmenters/hsaToNotes.ts`:

```ts
/**
 * HSA v2's cheap half: per-frame voices → committed notes.
 *
 * Pure, no DSP, one pass per pitch. Everything it reads was computed by the expensive pass,
 * which is what makes every parameter here legal under the registry's rule that a declared
 * param re-runs only this half — a slider drag walks a few thousand small numbers instead
 * of re-running a CQT.
 *
 * The state machine is carried over from the spectral engine's `candidatesToNotes`, not
 * from the notebook's `note_runs`. `note_runs` breaks a run on a single missing frame
 * (`i - prev > 1`) and has no gap tolerance at all; the hysteresis shape here — a high
 * onset bar, a low sustain floor, generous bridging — was measured at 81% → 87% F1 against
 * Basic Pitch on a real 81-second take. Changing the front end doesn't invalidate that.
 */

import { MAX_VOICES } from '../dsp/hsaPoly';
import type { HsaAnalysis } from '../algorithms/hsa.web';
import { detectReattacks, DEFAULT_REATTACK_CONFIG, type ReattackConfig } from './reattack';
import type { MidiNote } from '@/types';

export interface HsaSegmentConfig {
  /** A voice must score at least this fraction of the frame's strongest voice to sound at
   *  all. The notebook's `rel_threshold`. */
  relThreshold:    number;
  /** ...and this much to *start* a note. Kept above `relThreshold`; the gap is what stops a
   *  wobble becoming two notes. */
  onsetThreshold:  number;
  maxVoices:       number;
  minNoteLengthMs: number;
  /** Dropouts shorter than this don't end a note. */
  bridgeMs:        number;
  snapToAttacks:   boolean;
  /** Whether a confirmed re-attack breaks a held note in two. */
  splitRepeats:    boolean;
  reattack:        ReattackConfig;
}

export const DEFAULT_HSA_SEGMENT_CONFIG: HsaSegmentConfig = {
  relThreshold:    0.60,
  onsetThreshold:  0.75,
  maxVoices:       MAX_VOICES,
  minNoteLengthMs: 40,
  bridgeMs:        70,
  snapToAttacks:   true,
  splitRepeats:    true,
  reattack:        DEFAULT_REATTACK_CONFIG,
};

/** A flux peak must beat the crossing frame's by this much before an onset is moved. */
const SNAP_MIN_FLUX_RATIO = 1.2;
/** Frames searched either side when snapping. Deliberately small: with centre-based timing
 *  the threshold crossing is already close, and a long backward hunt drags every onset
 *  earlier than the truth rather than closer to it. */
const SNAP_FRAMES = 4;

function frameMs(analysis: HsaAnalysis, frame: number): number {
  // The transform centres each frame on `frame * hop`, so this is already the centre of the
  // evidence — no half-window correction, unlike the old STFT front end.
  return (frame * analysis.hop * 1000) / analysis.sampleRate;
}

function snapOnset(analysis: HsaAnalysis, frame: number): number {
  const from = Math.max(0, frame - SNAP_FRAMES);
  const to   = Math.min(analysis.frameCount - 1, frame + SNAP_FRAMES);
  let best = frame;
  let bestValue = analysis.flux[frame];
  for (let f = from; f <= to; f++) {
    // Strictly greater, so a run of equal values keeps the earliest.
    if (analysis.flux[f] > bestValue) { bestValue = analysis.flux[f]; best = f; }
  }
  return bestValue > analysis.flux[frame] * SNAP_MIN_FLUX_RATIO ? best : frame;
}

/** Per-semitone activation over time, valued as a fraction of the frame's strongest voice. */
function buildRows(analysis: HsaAnalysis, config: HsaSegmentConfig): Map<number, Float32Array> {
  const rows = new Map<number, Float32Array>();
  for (let frame = 0; frame < analysis.frameCount; frame++) {
    const first = analysis.sFirst[frame];
    if (!(first > 0)) continue;
    let admitted = 0;
    for (let slot = 0; slot < MAX_VOICES && admitted < config.maxVoices; slot++) {
      const pitch = analysis.pitch[frame * MAX_VOICES + slot];
      if (!Number.isFinite(pitch)) continue;
      const level = analysis.salience[frame * MAX_VOICES + slot] / first;
      // Voice 0 is always admitted — it defines the reference the others are scored against.
      if (slot > 0 && level < config.relThreshold) continue;
      admitted++;
      const midi = Math.round(pitch);
      let row = rows.get(midi);
      if (!row) { row = new Float32Array(analysis.frameCount); rows.set(midi, row); }
      // Max, not overwrite: two voices can round to the same semitone when a bend sits
      // between them, and the note is as strong as its strongest evidence.
      if (level > row[frame]) row[frame] = level;
    }
  }
  return rows;
}

function velocityFor(peak: number, peakRms: number, loudnessRef: number): number {
  const loudness = Math.min(1, peakRms / loudnessRef);
  const scaled   = Math.sqrt(loudness) * (0.5 + 0.5 * Math.min(1, peak));
  return Math.max(1, Math.min(127, Math.round(scaled * 127)));
}

function percentile(values: Float32Array, fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const index  = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

export function hsaToNotes(
  analysis: HsaAnalysis,
  config: HsaSegmentConfig = DEFAULT_HSA_SEGMENT_CONFIG,
): MidiNote[] {
  if (analysis.frameCount === 0) return [];

  const hopMs        = (analysis.hop * 1000) / analysis.sampleRate;
  const bridgeFrames = Math.max(0, Math.round(config.bridgeMs / hopMs));
  const loudnessRef  = percentile(analysis.rms, 0.95) || 1;

  // One broadband envelope for the whole take, so a re-attack ends every note sounding at
  // that instant. A harmonica double-stop is articulated by one breath — both notes of a
  // chord genuinely do re-attack together.
  const splitFrames = config.splitRepeats
    ? new Set(detectReattacks(analysis.rms, analysis.voiced, hopMs, config.reattack))
    : new Set<number>();

  const notes: MidiNote[] = [];

  for (const [midi, row] of buildRows(analysis, config)) {
    let start   = -1;
    let gap     = 0;
    let peak    = 0;
    let peakRms = 0;

    const commit = (endFrame: number): void => {
      const durationMs = ((endFrame - start) * analysis.hop * 1000) / analysis.sampleRate;
      if (durationMs >= config.minNoteLengthMs) {
        notes.push({
          midi,
          timeMs:     Math.round(frameMs(analysis, start)),
          durationMs: Math.round(durationMs),
          velocity:   velocityFor(peak, peakRms, loudnessRef),
        });
      }
      start = -1;
    };

    for (let frame = 0; frame <= analysis.frameCount; frame++) {
      const level  = frame < analysis.frameCount ? row[frame] : 0;
      const active = level >= config.relThreshold;

      // A confirmed re-attack ends the note here and lets it start again on this same
      // frame, bypassing the bridge. Bridging and re-attack pull in opposite directions by
      // design: a tongued repeat's gap looks exactly like a 70ms dropout, and the envelope
      // is the evidence that tells them apart.
      if (start >= 0 && frame < analysis.frameCount && splitFrames.has(frame)) {
        commit(frame);
        if (active) { start = frame; gap = 0; peak = level; peakRms = analysis.rms[frame]; }
        continue;
      }

      if (start < 0) {
        if (level >= config.onsetThreshold) {
          start   = config.snapToAttacks ? snapOnset(analysis, frame) : frame;
          gap     = 0;
          peak    = level;
          peakRms = analysis.rms[frame];
        }
        continue;
      }

      if (active) {
        gap = 0;
        if (level > peak) peak = level;
        if (frame < analysis.frameCount && analysis.rms[frame] > peakRms) peakRms = analysis.rms[frame];
        continue;
      }

      gap++;
      if (gap <= bridgeFrames && frame < analysis.frameCount) continue;
      commit(frame - gap + 1);
    }
  }

  // The walk above is per pitch, so its natural order is by pitch. Everything downstream
  // assumes onset order.
  return notes.sort((a, b) => a.timeMs - b.timeMs || a.midi - b.midi);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx scripts/verify-hsa.ts`
Expected: PASS on all four segmentation checks.

If "four articulations become four notes" fails with a count of 1, the re-attack frames are not reaching the row walk — check that `splitFrames` is non-empty and that `analysis.rms` is the resampled envelope, not the original. If it fails with more than 4, `onsetThreshold` is too low for this material; report the number rather than tuning it here — it is a Task 8 measurement, not a fix.

- [ ] **Step 5: Commit**

```bash
git add src/audio/segmenters/hsaToNotes.ts scripts/verify-hsa.ts
git commit -m "Add HSA v2's cheap half with global re-attack splitting"
```

---

### Task 7: Registry entry, parameters, and the settings migration

**Files:**
- Modify: `src/audio/algorithms/hsa.web.ts` (append the registry entry)
- Modify: `src/audio/algorithms/index.ts:207-213` (register it)
- Modify: `src/store/useSettingsStore.ts:100-105` (add `version` + `migrate`)

**Interfaces:**
- Consumes: `hsaToNotes`, `DEFAULT_HSA_SEGMENT_CONFIG`, `analyzeHsa`
- Produces: `hsaAlgorithm: TranscriptionAlgorithm` with `id: 'hsa'`, registered

- [ ] **Step 1: Add the registry entry and its params**

Append to `src/audio/algorithms/hsa.web.ts`:

```ts
/**
 * The knobs, in the user's language rather than the algorithm's.
 *
 * Every one re-runs `hsaToNotes` and nothing else — no resampling, no CQT, no cancellation.
 * That is the rule for what may appear here at all. Deliberately absent for the same
 * reason: the sample rate, the hop, the bins per octave, the harmonic count and weights,
 * and `cancel_factor`. Every one of them re-runs the whole analysis pass, and `cancel_factor`
 * is not a concept a player can reason about anyway.
 */
const HSA_PARAMS: readonly TranscriptionParam[] = [
  {
    id:     'relThreshold',
    kind:   'number',
    label:  'Chord sensitivity',
    help:   'How loud a second note must be, next to the loudest one, to be written down '
          + 'too. Lower hears more of a chord, including notes that were never played.',
    min:    0.30, max: 0.90, step: 0.05,
    default: DEFAULT_HSA_SEGMENT_CONFIG.relThreshold,
    format: (v) => v.toFixed(2),
  },
  {
    id:     'onsetThreshold',
    kind:   'number',
    label:  'Onset sensitivity',
    help:   'How clearly a note has to be heard before it starts. Lower catches quiet '
          + 'entries; higher waits for certainty.',
    min:    0.35, max: 1.00, step: 0.05,
    default: DEFAULT_HSA_SEGMENT_CONFIG.onsetThreshold,
    format: (v) => v.toFixed(2),
  },
  {
    id:     'maxVoices',
    kind:   'number',
    label:  'Most notes at once',
    help:   'The ceiling on simultaneous notes. Set it to 1 for a single melodic line.',
    min:    1, max: 4, step: 1,
    default: DEFAULT_HSA_SEGMENT_CONFIG.maxVoices,
    format: (v) => (v <= 1 ? 'one at a time' : `${Math.round(v)} at once`),
  },
  {
    id:     'minNoteLengthMs',
    kind:   'number',
    label:  'Shortest note',
    help:   'Anything briefer is discarded. Raise it to clear blips; too high and fast '
          + 'passages lose their inner notes.',
    min:    12, max: 300, step: 6,
    default: DEFAULT_HSA_SEGMENT_CONFIG.minNoteLengthMs,
    format: (v) => `${Math.round(v)} ms`,
  },
  {
    id:     'splitRepeats',
    kind:   'boolean',
    label:  'Split repeated notes',
    help:   'Writes a tongued repeat as separate notes instead of one held one, by '
          + 'listening for the dip between them.',
    default: DEFAULT_HSA_SEGMENT_CONFIG.splitRepeats,
  },
  {
    id:     'bridgeMs',
    kind:   'number',
    label:  'Ride over dropouts',
    help:   'How long a gap a note survives before it ends. Higher rides over breaths; '
          + 'lower ends notes tightly.',
    min:    0, max: 200, step: 10,
    default: DEFAULT_HSA_SEGMENT_CONFIG.bridgeMs,
    format: (v) => `${Math.round(v)} ms`,
    advanced: true,
  },
  {
    id:     'snapToAttacks',
    kind:   'boolean',
    label:  'Snap starts to attacks',
    help:   'Moves each note back to the attack that began it, instead of to the moment it '
          + 'became certain.',
    default: DEFAULT_HSA_SEGMENT_CONFIG.snapToAttacks,
    advanced: true,
  },
  {
    id:     'dipRatio',
    kind:   'number',
    label:  'Re-attack dip depth',
    help:   'How far the sound must drop, against the note\'s own peak, for a repeat to '
          + 'begin registering.',
    min:    0.1, max: 0.9, step: 0.05,
    default: DEFAULT_REATTACK_CONFIG.dipRatio,
    format: (v) => v.toFixed(2),
    advanced: true,
  },
  {
    id:     'riseRatio',
    kind:   'number',
    label:  'Re-attack recovery',
    help:   'How far it must come back up to confirm one. Kept above the dip depth on '
          + 'purpose — the gap between them is what stops a wobble reading as two notes.',
    min:    0.15, max: 0.95, step: 0.05,
    default: DEFAULT_REATTACK_CONFIG.riseRatio,
    format: (v) => v.toFixed(2),
    advanced: true,
  },
  {
    id:     'minDipMs',
    kind:   'number',
    label:  'Shortest dip',
    help:   'How long that drop must last to count as real rather than frame noise.',
    min:    10, max: 200, step: 5,
    default: DEFAULT_REATTACK_CONFIG.minDipMs,
    format: (v) => `${Math.round(v)} ms`,
    advanced: true,
  },
];

function number(params: ParamValues, id: string, fallback: number): number {
  const value = params[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolean(params: ParamValues, id: string, fallback: boolean): boolean {
  const value = params[id];
  return typeof value === 'boolean' ? value : fallback;
}

function configFromParams(params: ParamValues): HsaSegmentConfig {
  const d = DEFAULT_HSA_SEGMENT_CONFIG;
  return {
    relThreshold:    number(params, 'relThreshold',    d.relThreshold),
    onsetThreshold:  number(params, 'onsetThreshold',  d.onsetThreshold),
    maxVoices:       Math.round(number(params, 'maxVoices', d.maxVoices)),
    minNoteLengthMs: number(params, 'minNoteLengthMs', d.minNoteLengthMs),
    bridgeMs:        number(params, 'bridgeMs',        d.bridgeMs),
    snapToAttacks:   boolean(params, 'snapToAttacks',  d.snapToAttacks),
    splitRepeats:    boolean(params, 'splitRepeats',   d.splitRepeats),
    reattack: {
      ...DEFAULT_REATTACK_CONFIG,
      dipRatio:  number(params, 'dipRatio',  DEFAULT_REATTACK_CONFIG.dipRatio),
      riseRatio: number(params, 'riseRatio', DEFAULT_REATTACK_CONFIG.riseRatio),
      minDipMs:  number(params, 'minDipMs',  DEFAULT_REATTACK_CONFIG.minDipMs),
    },
  };
}

export const hsaAlgorithm: TranscriptionAlgorithm = {
  id:    'hsa',
  label: 'Harmonic transcription (HSA v2)',
  description:
    'Hears chords and double-stops, and is the only engine that writes a repeated note as '
    + 'separate notes rather than one long one. Runs in the browser with no network round '
    + 'trip. Best for harmonica takes.',
  available:      true,
  producesFrames: false,
  polyphonic:     true,
  params:         HSA_PARAMS,

  async prepare(audio: DecodedAudio, options: PrepareOptions = {}): Promise<Prepared> {
    const analysis = await analyzeHsa(audio, options);
    // Held in a closure the caller can empty rather than exposed for the caller to null
    // out, matching every other engine. ~1.1MB at the five-minute cap.
    let held: HsaAnalysis | null = analysis;
    return {
      algorithm:  'hsa',
      durationMs: audio.durationMs,
      get data() { return held; },
      dispose() { held = null; },
    };
  },

  async resegment(prepared: Prepared, params: ParamValues): Promise<Segmentation> {
    const analysis = prepared.data as HsaAnalysis | null;
    // Disposed while a debounced re-segment was still in flight — only happens on the way
    // off the screen, where an error would be reported to nobody.
    if (!analysis) return { output: { kind: 'notes', notes: [] }, detectorConfig: null };
    return {
      output:         { kind: 'notes', notes: hsaToNotes(analysis, configFromParams(params)) },
      detectorConfig: null,
    };
  },
};
```

Extend the file's imports:

```ts
import { hsaToNotes, DEFAULT_HSA_SEGMENT_CONFIG, type HsaSegmentConfig } from '../segmenters/hsaToNotes';
import { DEFAULT_REATTACK_CONFIG } from '../segmenters/reattack';
import type {
  ParamValues, PrepareOptions, Prepared, Segmentation, TranscriptionAlgorithm,
  TranscriptionParam,
} from './index';
```

- [ ] **Step 2: Register it**

In `src/audio/algorithms/index.ts`, add the import beside the others and put `hsaAlgorithm` where `spectralAlgorithm` sits (registration order is display order):

```ts
import { basicPitchAlgorithm } from './basicPitch';
import { hsaAlgorithm } from './hsa';
import { pmpmAlgorithm } from './pmpm';
import { spectralAlgorithm } from './spectral';

export const TRANSCRIPTION_ALGORITHMS: readonly TranscriptionAlgorithm[] = [
  basicPitchAlgorithm,
  hsaAlgorithm,
  spectralAlgorithm,
  pmpmAlgorithm,
];
```

- [ ] **Step 3: Add the settings migration**

In `src/store/useSettingsStore.ts`, replace the `persist` options object:

```ts
    {
      name:    'harp2tab-settings',
      storage: settingsStorage,
      /**
       * v1 (Phase 16): the spectral engine became `'hsa'`.
       *
       * Without this, anyone who had *chosen* the spectral engine silently lands on the
       * classic tracker — `getAlgorithm` falls back to pMPM for an id it doesn't recognise
       * — and their tuned parameters are orphaned under a dead key. Silent is the wrong
       * failure mode for a setting someone deliberately changed.
       */
      version: 1,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as SettingsState;
        if (version < 1 && state) {
          if ((state.defaultAlgorithm as string) === 'spectral') state.defaultAlgorithm = 'hsa';
          const params = state.transcriptionParams as Record<string, ParamValues> | undefined;
          if (params && 'spectral' in params) {
            // Deliberately dropped, not renamed: the two engines share no parameter ids
            // beyond a couple of coincidental names, and carrying a spectral tuning across
            // would apply numbers chosen for a different salience scale.
            delete params.spectral;
          }
        }
        return state;
      },
    },
```

- [ ] **Step 4: Verify the migration and the registry**

Run: `npx tsx -e "
import { getAlgorithm, TRANSCRIPTION_ALGORITHMS, defaultParams } from './src/audio/algorithms';
const hsa = getAlgorithm('hsa');
console.log('id', hsa.id, 'available', hsa.available, 'params', hsa.params.length);
console.log('registered:', TRANSCRIPTION_ALGORITHMS.map(a => a.id).join(', '));
console.log('defaults:', JSON.stringify(defaultParams(hsa)));
"`

Expected: `id hsa available false params 0` under `tsx` (Node resolves `hsa.ts`, the native stub — that is correct and is what native will see), and `basicPitch, hsa, spectral, pmpm`.

Then run the full harness to confirm nothing regressed: `npx tsx scripts/verify-hsa.ts` — all checks still pass.

- [ ] **Step 5: Commit**

```bash
git add src/audio/algorithms/hsa.web.ts src/audio/algorithms/index.ts src/store/useSettingsStore.ts
git commit -m "Register HSA v2 with its parameter schema and migrate the spectral engine id"
```

---

### Task 8: Delete the spectral engine and retarget the docs

**Files:**
- Delete: `src/audio/algorithms/spectral.ts`, `src/audio/dsp/stft.ts`, `src/audio/dsp/harmonicSalience.ts`, `src/audio/segmenters/candidatesToNotes.ts`, `scripts/_dbg.ts`, `scripts/verify-spectral-pitch.ts`
- Modify: `src/audio/algorithms/index.ts` (drop `'spectral'` from the union and the registry)
- Modify: `src/audio/pitchRange.ts:71-78` (the comment describing the spectral engine)
- Modify: `scripts/compare-engines.ts` (retarget to `hsaAlgorithm`)
- Modify: `docs/testing.md` (suite table)
- Modify: `src/components/TranscriptionEngineModal.tsx` (only if it hardcodes copy — check first)

- [ ] **Step 1: Record the octave-error number before deleting the harness that measures it**

The spectral engine's octave-error rate was measured under 1%. HSA v2 has no equivalent
measurement and no octave machinery. Run the old harness one last time and keep the number:

```bash
npx tsx scripts/verify-spectral-pitch.ts 2>&1 | tail -20
```

Record the `TOTAL spectral` and `TOTAL pmpm` lines in the commit message. This is a number to
have, not a gate to pass — see the spec's risk list.

- [ ] **Step 2: Delete**

```bash
git rm src/audio/algorithms/spectral.ts src/audio/dsp/stft.ts \
       src/audio/dsp/harmonicSalience.ts src/audio/segmenters/candidatesToNotes.ts \
       scripts/_dbg.ts scripts/verify-spectral-pitch.ts
```

Then check whether `dsp/fft.ts` still has any importer:

```bash
grep -rn --include='*.ts' --include='*.tsx' "dsp/fft" src scripts | grep -v node_modules
```

If nothing prints, `git rm src/audio/dsp/fft.ts` — it existed only for the STFT this deletes.
If something prints, leave it.

- [ ] **Step 3: Drop the id and the registration**

In `src/audio/algorithms/index.ts`:

```ts
export type TranscriptionAlgorithmId = 'basicPitch' | 'hsa' | 'pmpm';
```

Remove `import { spectralAlgorithm } from './spectral';` and its entry in
`TRANSCRIPTION_ALGORITHMS`. Also update the module docblock at the top of that file: it
describes "Two algorithms sit behind it" and names Basic Pitch and pMPM's shapes — the union
of `frames` and `notes` outputs is unchanged, but the engine list is not.

- [ ] **Step 4: Fix the stale comment in `pitchRange.ts`**

`src/audio/pitchRange.ts:71-78` describes the spectral engine's use of `PLAYABLE_MIDI_RANGE`
to make subharmonic ghosts impossible. `PLAYABLE_MIDI_RANGE` stays — the note lane's octave
fold and playability rejection use it — but that paragraph now outlives the thing it
describes. Replace it with what the constant is actually for: the range the note lane folds
into and rejects against.

- [ ] **Step 5: Retarget `compare-engines.ts`**

Replace every `spectralAlgorithm` with `hsaAlgorithm` (imported from
`'../src/audio/algorithms/hsa.web'`, not `'./hsa'` — the harness wants the real engine, and
Node resolves the stub otherwise). Update the sweep at `compare-engines.ts:173-196` to sweep
HSA's parameter ids (`relThreshold`, `onsetThreshold`, `minNoteLengthMs`, `bridgeMs`,
`splitRepeats`) rather than the spectral engine's, and the comment at line 302 that explains
why octave-off notes are impossible — that was a property of the range restriction this phase
removed.

Run it and record the F1: `npx tsx scripts/compare-engines.ts`

- [ ] **Step 6: Update `docs/testing.md`**

Replace the `verify-spectral-pitch.ts` row in the suite table with:

```markdown
| `verify-hsa.ts` | — | The HSA v2 engine: chunked-vs-whole CQT equality, the poly pass against a Python reference dump, re-attack unit cases, and segmentation. Fixtures in `scripts/fixtures/hsa/`, regenerated by `/Users/theo/audio_analysis/dump_hsa_fixture.py` |
```

Also update the note further down that describes `verify-spectral-pitch.ts` as "a measurement
tool, not a regression gate" — `verify-hsa.ts` *is* a regression gate, since assertions 1 and
2 are equality claims rather than measurements.

- [ ] **Step 7: Verify the whole suite still passes**

```bash
npx tsx scripts/verify-hsa.ts
npx tsx scripts/verify-audio-import.ts
npx tsx scripts/verify-midi-import.ts
npx tsx scripts/verify-midi-studio.ts
npx tsx scripts/verify-export.ts
npx tsx scripts/verify-recordings-migration.ts
npx tsx scripts/verify-sync-merge.ts
npx tsx scripts/verify-entitlement.ts
npx expo lint
```

Expected: all pass. `verify-audio-import.ts` exercises the pMPM path and must be unaffected.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Delete the spectral engine; HSA v2 replaces it

Final spectral octave-error measurement before deletion: <paste Step 1's numbers>."
```

- [ ] **Step 9: Check it in a browser**

The harnesses run under Node against the native-resolved stub for `./hsa`; nothing so far has
loaded the WASM in a real browser or exercised `OfflineAudioContext`. Per project convention,
restart the dev server with `--clear` (a stale bundle will serve old code and make a working
fix look broken):

```bash
npx expo start --web --clear
```

Then: upload a harmonica take → pick **Harmonic transcription (HSA v2)** → confirm the
progress bar moves during analysis and Cancel works → confirm notes appear → drag
**Chord sensitivity** and **Split repeated notes** and confirm the roll updates without
re-analysing. Report anything that differs from the harness's behaviour rather than fixing it
silently — a browser-only failure means the WASM path or the resampler differs from what was
measured under Node.

---

## Notes for the executor

- **Task 1 gates everything.** If its "NONE" branch prints, stop and report; Tasks 4 and 6
  need redesigning around the per-voice fallback in the spec's risk list.
- **Do not re-tune `hsaPoly.ts`'s constants.** They were chosen together by a sweep in the
  notebook. If output looks wrong, the port is wrong — assertion 2 localises it.
- **The `'spectral'` id survives until Task 8** on purpose, so the old engine stays available
  as a live comparison while the new one is being proven.
- **Two repos.** `/Users/theo/audio_analysis` is not `harp2tab`. Commit separately, never
  `git add` across them.
