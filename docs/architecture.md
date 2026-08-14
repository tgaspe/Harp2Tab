# Architecture

How Harp2Tab is put together, and the conventions worth knowing before changing anything.
For phase-by-phase design records, see [plan/](plan/).

## One codebase, three targets

Harp2Tab is an Expo / React Native app that runs on Android (bare workflow, with custom
native code) and on the web via `react-native-web`. iOS is prebuilt but has no configured
build. Web is the primary target for new work.

Platform differences are resolved by **file extension, not by branching**. A module named
`foo.ts` is the native implementation and `foo.web.ts` the web one; the bundler picks, and
callers import `foo` and stay ignorant. The pairs that exist today:

```
src/native/AudioCapture.ts   / .web.ts     microphone → frames
src/native/Playback.ts       / .web.ts     audio output
src/audio/decodeAudio.ts     / .web.ts     file → PCM
src/audio/readFileBytes.ts   / .web.ts     file → bytes
src/auth/firebase.ts         / .web.ts     SDK bootstrap (RN Firebase vs. JS SDK)
src/auth/auth.ts             / .web.ts
src/auth/entitlement.ts      / .web.ts
src/hooks/useIAP.ts          / .web.ts     Play Billing vs. web billing
```

Keep new platform work inside this seam. If a feature needs a `Platform.OS` check spread
through a screen, that usually means the seam is in the wrong place.

## The pipeline: decode → frames → notes → tab

Everything — live recording, audio upload, MIDI upload — converges on the same late stages.
What differs is only where a source enters.

```
                    ┌─ microphone ──→ AudioCapture ──┐
   source           ├─ audio file ──→ decodeAudio ───┤──→ transcription engine
                    └─ MIDI file ───→ midiToNotes ───────────────┐
                                                                 │
   engine output    frames (pitch/loudness stream)   or    notes (pitched events)
                              │                                  │
                              ▼                                  ▼
                    NoteDetector / framesToNotes          rankKeysForMidi
                              │                                  │
                              └──────────→ notesToTabs ←─────────┘
                                                │
                                                ▼
                                      TabNote[] → editor → export
```

The two engine output shapes are a deliberate union rather than one normalised type; the
reasoning is documented at the top of `src/audio/algorithms/index.ts`. In short: pMPM emits
a continuous pitch track and leaves segmentation to `NoteDetector` (which segments on *tab
identity*, making a 12-key search cheap), while Basic Pitch emits note events directly and
never produces a pitch track at all — so it joins where MIDI import joins.

### Transcription engines

Registered in `src/audio/algorithms/`, selected at import time:

| Engine | Where it runs | Notes |
|---|---|---|
| `pmpm` | everywhere | Offline pitch tracker. Monophonic by construction. Feeds Frame Inspector |
| `basicPitch` | web only | Neural, polyphonic. ~900 KB model fetched on first use, pulls in TensorFlow.js. The default for uploads |
| `spectral` | planned | FFT-based, polyphonic, pure TypeScript. See [plan/phase-14-spectral.md](plan/phase-14-spectral.md) |

### Native capture

On Android, capture is C++ (Oboe) with MPM pitch detection, in `android/audiocapture/`,
emitting `{frequency, rms, nsdf}` at ~50 Hz over `DeviceEventEmitter`.

On web the equivalent is `src/native/AudioCapture.web.ts`, which uses a
**`ScriptProcessorNode`** — deprecated, but chosen over an `AudioWorklet` because every
`NoteDetector` threshold is calibrated against 2048-sample frames at the device sample rate,
and the worklet's fixed 128-sample render quantum would have meant recalibrating all of them.
Retained take audio is likewise kept at the device rate; Basic Pitch resamples to its own
22050 Hz later, with a proper windowed-sinc resampler.

> `AudioFrame.nsdf` is typed but never populated — Android never sets it and web hardcodes
> `0`. Nothing downstream reads it.

## Harmonica mapping

`src/audio/HarmonicaMapper.ts` is the pitch ↔ hole/breath translation, and works in both
directions: `frequencyToTab` for the live and audio paths, `noteToTab` for MIDI import.

Notation is self-encoding, which is why UI code can classify a note with a substring check
rather than a lookup: a leading `-` is draw and no prefix is blow, `'` marks bend depth, and
`o` marks an overblow (holes 1–6) or overdraw (holes 7–10). All 12 keys are supported by
transposing against a C-diatonic layout.

## State and persistence

Persisted Zustand stores in `src/store/`, with storage split `storage.ts` / `storage.native.ts`.
Data is **local-first**: everything works signed-out, and the cloud is a mirror rather than
the source of truth. `useAppStore` holds the working session; `useRecordingsStore` the
library; `useMidiProjectsStore` the Studio.

**Cloud sync (`src/sync/`, 7b)** reconciles the two library stores against
`/users/{uid}/…` when signed in with a confirmed address. The rule that keeps it cheap: **no
screen ever reads Firestore.** `syncEngine.ts` is the only module that awaits the network and
it writes into the same stores every screen already reads, so no component gains a loading or
error state. `merge.ts` is pure — whole-document last-write-wins on `updatedAt`, with
tombstones under `/users/{uid}/deleted` so a delete on one device is not undone by another —
and `firestore.ts` / `firestore.web.ts` is the platform-split façade, so nothing outside it
holds a Firebase type. Bodies travel as one opaque JSON string, never expanded maps: Firestore
charges per field name per array element. Gated by `SYNC_ENABLED` in `syncEngine.ts`.

`useHeaderActionStore` is a one-slot register that lets a screen drive a button in the global
`TopBar`, which renders in the root layout outside any screen's tree. Screens must clear the
slot on unmount or the button follows them to the next route.

## Accounts, entitlements and billing

Firebase Auth (Google + email/password), with entitlement state written to
`/entitlements/{uid}` in Firestore and read by every platform, so premium status is portable
regardless of where the user paid.

- **Android** — Play Billing via `react-native-iap`, one-time SKU `harp2tab_premium`.
- **Web** — Stripe Managed Payments behind RevenueCat, with Stripe as merchant of record.
  The webhook → Cloud Function entitlement writer lives in `functions/`.

Details and the decision record: [plan/phase-07-accounts.md](plan/phase-07-accounts.md),
[plan/phase-07b-sync.md](plan/phase-07b-sync.md) and
[plan/phase-08-monetization.md](plan/phase-08-monetization.md).

## Conventions

- **Reuse the editor's components.** The Studio is `edit.tsx`'s screen with the track panel
  swapped in, not a new screen. Anything added there should import what the editor already has.
- **Drag interactions use `react-native-gesture-handler`'s `Gesture.Pan()`**, not
  `PanResponder` — the latter proved unreliable on web, where a `<Text>` inside a draggable
  area could trigger native text selection mid-drag.
- **Every drag-based interaction needs a keyboard alternative** (arrow-key nudge, or an
  explicit button beside any drop zone). This is a standing commitment, not per-feature.
- **Web-first.** Native is a later port that may drop features; web work is not deferred or
  scaled down to match native limits.
