# Vendored: cqt-web 1.0.4

Source: https://www.npmjs.com/package/cqt-web (https://github.com/timcsy/cqt-web)
Retrieved: 2026-08-19 · License: MIT (see `LICENSE.cqt-web`)
Files: `dist/cqt.js`, `dist/cqt.wasm`, unmodified.

## Why vendored rather than depended on

56 downloads/month, one maintainer, all five versions published on a single day in
December 2025. Vendoring pins the exact binary that was measured, removes registry
supply-chain exposure, and lets the wasm be bundled rather than fetched at runtime.

## Why HybridCQT and not StandardCQT

Measured against librosa 0.11.0 at this engine's config (44.1kHz, hop 512, 24 bins/octave,
152 bins, fmin 169.897), then fed to the notebook's own `compute_hsa_v2_poly`:

| variant | vs `librosa.cqt` magnitudes | 5-min take | HSA v2 pitch sets on 34Blow.wav |
|---|---|---|---|
| StandardCQT | 0.8% median, 2.2% p90 | ~134s | 603/603 frames identical |
| HybridCQT | 3.7% median, 37.9% p90 | ~5–9s | 603/603 frames identical |
| PseudoCQT | 96.9% median | ~23s | not evaluated |

Magnitude errors are over energy-carrying bins (> 5% of peak) on a 10s synthetic signal.

HybridCQT's p90 looks disqualifying until the control is run: **librosa's own `cqt` and
`hybrid_cqt` differ by 40.3% p90 on the same signal** and also give 100% identical HSA v2
output. The disagreement lives in low-energy bins that a four-harmonic weighted sum never
leans on. HybridCQT is both the fast variant and, for this algorithm, indistinguishable from
the reference.

StandardCQT is accurate and 25× too slow: 134 seconds for a five-minute take, against 28ms
for librosa doing the same job.

## The Node shim

The published build is compiled `-sENVIRONMENT=web,worker` and asserts `!ENVIRONMENT_IS_NODE`
on load, so it throws under `tsx`. `../cqt.ts` disguises the environment for the duration of
instantiation. Do not remove that shim without running `npx tsx scripts/verify-hsa.ts`.

## Alternatives surveyed, 2026-08-19

- **essentia.js** — `ConstantQ`, `NSGConstantQ` and `NSGIConstantQ` are all on its published
  excluded-algorithms list. The WASM build does not contain them.
- **showcqt** (LGPL) — the ffmpeg visualiser. Emits an RGBA canvas buffer over a fixed
  E0–E10 range with no configurable bins-per-octave.
- **@audio/spectral-cqt** — a per-bin windowed DFT with `Math.cos`/`Math.sin` in the inner
  loop, one frame per call, no FFT. ~13 billion transcendental calls on a five-minute take
  at this config.

## Regenerating `cqtWasm.ts`

`cqt.wasm` is inlined as base64 in `cqtWasm.ts` so the module loads identically in a browser
bundle, a `tsx` harness and any future worker — Emscripten skips its own fetch path entirely
when `wasmBinary` is supplied. After replacing `cqt.wasm`:

```bash
python3 - <<'PY'
import base64, textwrap
raw = open('src/audio/dsp/vendor/cqt.wasm','rb').read()
lines = textwrap.wrap(base64.b64encode(raw).decode(), 100)
body = "\n".join(f"  '{l}' +" for l in lines[:-1]) + f"\n  '{lines[-1]}';"
# ...then write the file with the same docblock it already carries.
PY
```
