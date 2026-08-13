# Testing

There is no Jest or Vitest setup. Verification is done by standalone harnesses in `scripts/`,
each a plain TypeScript program run with `tsx` that exercises real project code against
hand-authored fixtures and prints a pass/fail table.

```bash
npx tsx scripts/verify-audio-import.ts
```

Every harness carries a docblock at the top explaining what it protects and why it was
written that way. Read that before changing one.

## The suite

| Harness | Cases | Covers |
|---|---|---|
| `verify-audio-import.ts` | 22 | Audio-upload round trip: `parseWav` → `analyzeSamples` → `framesToNotes`. WAV format matrix, take retention, key detection |
| `verify-midi-import.ts` | 23 | MIDI-upload round trip. Fixtures are both the app's own exported SMF and hand-built bytes for what the exporter can't produce (multi-track, percussion, tempo changes, chords) |
| `verify-midi-studio.ts` | 81 | Studio foundations: the tempo/meter map, SMF write/read, project serialization and its per-track sidecar |
| `verify-export.ts` | 16 | Multi-track export across all five formats, asserting single-track output hardest — every file a user has ever exported looks like that |
| `verify-recordings-migration.ts` | 18 | Persisted-schema migrations for the recordings store, driven with hand-authored old payloads |
| `verify-entitlement.ts` | 45 | The entitlement resolver — RevenueCat event → document → access — with an injected clock, so renewals and expiries don't take a month to test |
| `verify-firestore-rules.ts` | — | `firestore.rules` against the emulator. **Needs a second terminal**, see below |
| `verify-spectral-pitch.ts` | — | Calibration harness for the spectral engine. A measurement tool, not a regression gate — see below |

### Firestore rules

Runs against the emulator, so it never touches the real project:

```bash
npx firebase emulators:start --only firestore   # terminal 1
npx tsx scripts/verify-firestore-rules.ts       # terminal 2
```

### Spectral engine calibration

`verify-spectral-pitch.ts` measures octave-error rate for the spectral engine, and measures
pMPM on the same material for comparison. It is a **calibration harness for in-progress work**
([Phase 14](plan/phase-14-spectral.md)), so failing checks there are the current state of the
engine rather than a broken build. Basic Pitch is deliberately absent — it needs TensorFlow.js
and an `OfflineAudioContext`, neither of which exists under `tsx`; comparing against it is a
browser job.

## Tooling and fixtures

These are not tests — they generate material or produce measurements.

| Script | Purpose |
|---|---|
| `compare-engines.ts` | Side-by-side of the spectral engine against Basic Pitch on a real recording. `npx tsx scripts/compare-engines.ts <file.wav> [--write-midi]` |
| `perf-studio-lanes.ts` | Perf spike for the Studio's multi-track render path against a 12-track / 5,400-note fixture |
| `make-perf-fixture.ts` | Generates that fixture as the exact localStorage payload the Studio's store expects |
| `make-test-wav.ts` | Renders a known tab sequence to WAV, for exercising the audio-upload path by hand |
| `_dbg.ts` | Ad-hoc spectral debugging scratch |

## Manual verification

Some things can only be checked by hand, and are expected to be:

- A full record → edit → "New Recording" cycle producing a `TabRecording` in the library
  before state resets, on both native and web.
- Frame Inspector's rendered tracks against a live recording's committed `TabNote`s for the
  same session.
- Playback correctness by ear; piano-roll pitch-snap against `HarmonicaMapper` for at least
  one diatonic and one chromatic key.

When verifying anything web-affecting, start the dev server with `--clear` and confirm the
served bundle actually reflects the change before browser-testing — a stale bundle has
repeatedly looked like a failed fix.
