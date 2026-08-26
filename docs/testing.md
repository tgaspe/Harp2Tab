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
| `verify-midi-import.ts` | 24 | MIDI-upload round trip. Fixtures are both the app's own exported SMF and hand-built bytes for what the exporter can't produce (multi-track, percussion, tempo changes, chords) |
| `verify-midi-studio.ts` | 81 | Studio foundations: the tempo/meter map, SMF write/read, project serialization and its per-track sidecar |
| `verify-export.ts` | 16 | Multi-track export across all five formats, asserting single-track output hardest — every file a user has ever exported looks like that |
| `verify-recordings-migration.ts` | 18 | Persisted-schema migrations for the recordings store, driven with hand-authored old payloads |
| `verify-sync-merge.ts` | 58 | The sync merge (7b) — every row of its decision table, tombstone expiry either side of the boundary, two devices disagreeing about a deletion, plan idempotence — plus the wire round trip and the v4 migration. No network, no emulator |
| `verify-entitlement.ts` | 54 | The entitlement resolver — RevenueCat event → document → access — with an injected clock, so renewals and expiries don't take a month to test |
| `verify-firestore-rules.ts` | 24 | `firestore.rules` against the emulator. **Needs a second terminal**, see below |
| `verify-hsa.ts` | 17 | The HSA v2 engine (Phase 16): chunked CQT equals whole-file CQT, the poly pass frame-for-frame against the Python reference, `detectReattacks` unit cases, `resegment` purity, and the round trip on a real take |
| `verify-soundfont.ts` | 20 | Sampled-instrument resolution (11-6): zone boundaries, semitone/octave playback rates, cents folding, loop offsets against the sample's own rate, drum keys selected rather than transposed |

### Firestore rules

Runs against the emulator, so it never touches the real project:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # see below
export PATH="$JAVA_HOME/bin:$PATH"                 # firebase-tools resolves `java` from PATH
npx firebase emulators:start --only firestore      # terminal 1
npx tsx scripts/verify-firestore-rules.ts          # terminal 2
```

> **The emulator needs JDK 21 or newer.** `firebase-tools` refuses to start on anything older,
> and the error names Java rather than the emulator, which is easy to read as "the harness is
> broken." If several JDKs are installed, the default is often not the newest — `/usr/libexec/java_home -V`
> lists them. This is worth setting up rather than skipping: these 24 checks are the only thing
> standing between the rules file and a paywall bypass, and the rule shapes involved (a
> permissive parent `match` silently overriding a nested `allow write: if false`) are invisible
> to code review.

### HSA v2

`verify-hsa.ts` is a **regression gate, not a measurement tool** — the opposite of the
`verify-spectral-pitch.ts` it replaced ([Phase 16](plan/phase-16-hsa-engine.md) supersedes
Phase 14, and that harness went with the engine it calibrated). Its first two assertions are
the port's correctness claim: the chunked CQT must be bit-comparable to the whole-file CQT, and
the TypeScript poly pass must reproduce the Python notebook's pitch set on every frame. A
failure there is a real defect, not a tuning state.

Its Python-reference fixtures live in `scripts/fixtures/`. Basic Pitch is deliberately absent —
it needs TensorFlow.js and an `OfflineAudioContext`, neither of which exists under `tsx`;
comparing against it is `compare-engines.ts`'s job, in a browser.

## Tooling and fixtures

These are not tests — they generate material or produce measurements.

| Script | Purpose |
|---|---|
| `compare-engines.ts` | Side-by-side of HSA v2 against Basic Pitch on a real recording. `npx tsx scripts/compare-engines.ts <file.wav> [--write-midi]` |
| `perf-studio-lanes.ts` | Perf spike for the Studio's multi-track render path against a 12-track / 5,400-note fixture |
| `make-perf-fixture.ts` | Generates that fixture as the exact localStorage payload the Studio's store expects |
| `make-test-wav.ts` | Renders a known tab sequence to WAV, for exercising the audio-upload path by hand |

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
