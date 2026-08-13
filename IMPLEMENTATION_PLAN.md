# Harp2Tab — Full Roadmap Implementation Plan

> Status as of 2026-08-09: Phases 0–6 and 11 are implemented on `web_version`. Phases 7–10
> and 12 are still just this plan — not started.
>
> - [x] Phase 0 — Recording-session foundation
> - [x] Phase 1 — Home-as-library + recording history
> - [x] Phase 2 — Frame retention plumbing + real Frame Inspector
> - [x] Phase 3 — Playback (+ metronome, added beyond the original scope below)
> - [x] Phase 4 — Piano-roll editor (+ desktop-native toolbar redesign, added beyond the original scope below)
> - [x] Phase 5 — Audio upload (5a decode/pipeline, 5b auto key detection); 5c native
>       compressed-audio decode deferred
> - [x] Phase 6 — MIDI upload → tab conversion
> - [ ] Phase 7 — User accounts (Firebase Auth) + cloud sync. Detailed plan written
>       2026-08-12. **Now split: 7a (accounts) ships here, 7b (the sync engine) ships after
>       Phase 8** — under the subscribe-time signup model there is nobody with an account to
>       sync until billing exists. Decisions taken by the user the same day: local-first
>       storage with a cloud mirror; **Google + email/password** (superseding the locked
>       email-link decision); **accounts created at subscribe, plus a voluntary sign-in
>       everywhere** (an earlier same-day save/export wall was dropped — it would have
>       removed the live app's only output); **free accounts get sync**; and a full
>       **`/profile` route** (which answers 12-4). Sign-in is the small half — the
>       email/password surface, `/profile` and the merge engine are the work. Account
>       deletion + a privacy-policy/Data-safety update are release blockers the moment
>       accounts exist. Three separate pieces of work block on buying the custom domain.
> - [ ] Phase 8 — Better monetization + remaining web billing. Detailed plan written
>       2026-08-13. Five decisions taken by the user the same day: **Stripe Managed Payments
>       behind RevenueCat**, making Stripe the merchant of record (the July "RevenueCat +
>       Stripe" decision has since split into three products that differ in who owes each
>       buyer's sales tax); **the July prices stand** — $3.49/$27.99/$44.99, lifetime still
>       sold on web; **web only**, Android keeps `react-native-iap` and its one-time SKU
>       untouched; **grandfathering is a manual grant**, because there is exactly one existing
>       Play buyer and he is known personally — which deletes the reconciliation subsystem
>       this phase was budgeted for; and **the free tier does not change**. The work that
>       replaces it: the webhook→Cloud Function entitlement writer against 7a's reader, and
>       **making `isPurchased` revocable** — it is a one-way latch today, correct for a
>       lifetime unlock and wrong for every subscription. No promo codes or free trials are
>       possible on this billing path; that is a knowing trade. **Staged 8a/8b/8c so no
>       financial commitment is needed until the code works**: 8a is most of the phase's code
>       against the Firebase emulator with no accounts anywhere; 8b is real purchases through
>       Stripe *test mode*, which an un-activated account can do and which cannot charge real
>       money; 8c is the only slice that costs anything — Stripe activation, a bank account,
>       Managed Payments, the domain, and the free-tier flip.
> - [ ] Phase 9 — iOS version
> - [ ] Phase 10 — Improve web UI polish. Now also holds two items found during Phase 7:
>       **10-1** two modals that are still phone sheets on a desktop viewport, and **10-2**
>       modal Escape/focus-trap/focus-restore, which 7a-UI committed to and which is unmet
>       almost everywhere in the app.
> - [x] Phase 11 — MIDI Studio (multi-track DAW), except the SoundFont sound module
>       (11-6), which is blocked on a product decision — see below.
>       Harnesses: `verify-midi-studio.ts` (65 cases), `verify-export.ts` (16),
>       `perf-studio-lanes.ts` (the 11-4 spike). Existing suites still green.
> - [ ] Phase 12 — UX pass: home naming/sidebar, landing page + SEO, profile page,
>       calibration timing, MIDI Studio fixes, first-run tutorials (added 2026-08-09).
>       Not dependent on 7–10 except 12-3's pricing (Phase 8) and 12-4 (Phase 7).
> - [ ] Phase 13 — Record → transcribe → Studio: retain the take's PCM, pick an engine and
>       tune its params after Finish, land in the Studio as a draft (added 2026-08-10).
>       Independent of 7–10. Carries one monetization decision (where the free-tier session
>       is consumed) — see Decisions under the phase.
> - [ ] Phase 14 — Spectral polyphonic transcription (FFT): a third engine that hears chords
>       offline, with no download and no TensorFlow (added 2026-08-10). **Its stated goal is
>       the lowest octave-error rate of the three**, not maximum polyphony; polyphony is the
>       capability, octave accuracy is the objective. Pure TypeScript, so it is also the
>       first polyphonic engine native could run. Independent of every other phase — it adds
>       files under `src/audio/` and one registry entry, and changes nothing in the pipeline
>       it plugs into. Starts with a measurement step that can cancel the phase.
> - [ ] Phase 15 — **Native port scope — a deferred decision, not scheduled work**
>       (added 2026-08-12). Holds the question of which features get ported to native at
>       all, collected from every phase that parked one (7-14, 11's "may drop features",
>       5c, 13's native no-ops). Native is measurably further along than the phase text
>       above implies — recording, playback, MIDI import and IAP are all real there — and
>       it has one known dead end: the Studio's Export lives in a `TopBar` that is `null`
>       on native. **This phase does not license hedging web work**; the rule in
>       `feedback_web_first_no_mobile_hedging` still stands.
>
> **Phase 11 — what shipped, against what was planned**
> - 11-1…11-5, 11-8…11-10 complete. End-to-end: import MIDI → Open in Studio → edit →
>   Convert to tabs → Edit, plus blank projects, quantize, multi-track export.
> - **11-7 (arrange view) was built and then removed at the user's request** — the toggle
>   was judged not to earn its place, and with it gone the view was unreachable, so
>   `ArrangeView.tsx` and `arrangeGaps.ts` were deleted rather than left as dead code. The
>   handoff case it addressed is still visible in the roll itself: other tracks render as
>   background lanes behind the one being edited.
> - **11-6 was largely already built and I missed it.** `PianoRoll` has had a
>   **Breath Force / Duration / Confidence / Pitch Bend** data panel since Phase 4
>   (`metricTab`, `PianoRoll.tsx:431` at the pre-Phase-11 commit). I built a second
>   `ControlLane`/`LaneSpec` strip and stacked it under the existing one, so the Studio
>   rendered "Breath force" three times. **`ControlLane.tsx` has been deleted.** What
>   survives from 11-6 is the part that genuinely didn't exist and feeds the panel that
>   does: `timbre.ts` (GM voices, so tracks are audibly distinct) and `breathForce.ts`
>   (RMS → breath force, normalised against the take's own range).
>   **SoundFont** still hasn't shipped, and is blocked on a decision rather than effort:
>   which soundfont (they carry real and differing licences), and bundled vs. fetched on
>   demand (tens of MB against a network dependency and a CSP question).
> - **The Studio is the editor's screen with the track panel swapped in — not a new one.**
>   The first version treated it as a fresh screen that merely embedded `PianoRoll`, so it
>   inherited none of `edit.tsx`'s chrome and re-solved solved problems. Reworked to import
>   the editor's own `WebTransportBar` (loop / tempo / metronome / skip / stop / play-pause
>   / rate / time — it previously had a single "Play" text button) and to leave the piano
>   roll's own data panel alone. Rule for anything added here later: **reuse the editor's
>   components; the Studio only adds tracks and conversion.**
> - **The Studio has no chrome row of its own**, by request. The project title rides in the
>   piano roll's tool row via `headerLeft` (exactly where the editor puts its chart title),
>   Export is parked in the global `TopBar` through `useHeaderActionStore`, and the
>   Harp2Tab logo is the way back to the library — it already is on every other screen.
>   `useHeaderActionStore` is a one-slot register for this: `TopBar` renders in the root
>   layout, outside any screen's tree, so a screen can't hand it a callback directly. It
>   generalises the trick the editor already uses to drive its List/Piano-Roll toggle from
>   there. Screens must clear the slot on unmount or the button follows them.
> - The track panel collapses to a 44px colour rail, mirroring the editor's icon sidebar.
> - **Deviations worth recording:**
>   - The arrange view must stay height-capped (`MAX_PANEL_HEIGHT`) and internally
>     scrollable, and defaults to collapsed. Uncapped, a 29-track project rendered ~700px
>     of lanes inside a fixed-height flex column and squeezed the piano roll to zero — the
>     editor simply vanished. It is an overview above the editor, never a replacement.
>   - The Studio opens on `mostMelodicTrack`, not `tracks[0]`. Real files routinely lead
>     with a note-less conductor or marker track, which opened the editor blank at the top
>     of a 128-row ladder.
>   - `PianoRoll`'s bulk edit paths (quantize, duplicate, paste, group move, arrow nudge)
>     reached into `useAppStore` directly while single-note paths went through `onUpdate`.
>     Invisible while the tab editor was the only caller, wrong the moment the Studio
>     appeared — a Studio quantize would have edited the tab session. Now routed through
>     `onUpdateMany`/`onCreateMany` props that default to the old store calls.
>   - Studio notes needed identity the data model doesn't have (SMF doesn't identify notes).
>     Resolved as *positional* ids in `studioNotes.ts` rather than a per-note persisted id.
>   - The perf spike ran headlessly (`perf-studio-lanes.ts`) rather than in a browser, and
>     forced the lane layout out of the component into `studioNotes.layoutBackgroundLanes`.
>     12 tracks / 5,400 notes: worst 1.24ms per frame against a 16.7ms budget, blocks per
>     frame bounded at 581. It also confirmed the SMF-persistence decision — 64 KB against
>     309 KB as raw JSON. It measures layout, not React reconciliation or paint.
>   - The arrange view's gap detection was initially written as "selected idle AND another
>     sounding", which the harness caught: an accompanying track's own rests shredded one
>     long handoff into sub-second fragments that the length filter then discarded, so the
>     handoff vanished entirely. Rewritten to define the gap by the selected track's
>     silence, then test overlap exactly.
>
> The phase write-ups below are left as originally planned/approved (before implementation) —
> they're the design record, not a changelog. Notable deviations from the original plan that
> came up during implementation:
> - Phase 2/3/4 grew a **real BPM/tempo field + audible metronome** and a **snap-to-grid**
>   piano-roll, which were not in the original scope — added per follow-up requests once the
>   config-object refactor made them cheap.
> - The piano-roll's `PanResponder`-based drag turned out unreliable on web (a `<Text>` inside
>   the draggable area could trigger native text-selection mid-drag, plus missing capture-phase
>   handlers) and was migrated to `react-native-gesture-handler`'s `Gesture.Pan()` instead —
>   already proven elsewhere in this app (list drag-to-reorder).
> - The piano-roll's desktop toolbar/transport bar was redesigned again mid-Phase-4 to look
>   like a real desktop editing tool (compact icon toolbar + minimal transport bar) rather than
>   the mobile-style stacked touch buttons the rest of the app still uses on native.
> - Phase 5 landed close to the detailed plan below, with two measured corrections: analysis
>   is ~5% of realtime (8.5s for 3 minutes of near-continuous playing), so the contingency
>   Web Worker was never needed; and the note-committing step moved *after* the key
>   confirmation step, since detection can only be presented for approval if notes aren't
>   already built. `scripts/verify-audio-import.ts` is the harness (17 cases: round-trip
>   detection, WAV format matrix, key detection).
> - Phase 6 landed as planned, with two additions requested during implementation: the
>   **per-track preview button** (listed as optional polish in 6-6) shipped, since choosing a
>   track by reading a pitch range is harder than hearing four bars; and the confirm step
>   gained explicit **dead-end warnings** — one for a track with nothing left after the
>   110ms articulation floor (Continue disabled, since it can only produce an empty editor),
>   one for a part no key can map at all (Continue still enabled, since the pitches are real
>   and editable). The audio confirm step got the matching "no key fits anything" warning so
>   both paths say so before committing rather than after.
>   `scripts/verify-midi-import.ts` is the harness (22 cases).

## Context

The app is live in production on Android; the web version's core functionality shipped 2026-07-29. The roadmap (README.md, `project_roadmap` memory) has grown to 10+ items spanning data model changes, new UI surfaces, new audio pipelines, and business infrastructure, decided incrementally over several sessions but never sequenced against each other or against the actual codebase. The goal here is a single dependency-ordered implementation sequence so features get built in an order that doesn't require redoing earlier work, with the specific technical risks in this stack (Expo/RN, no existing audio-output or file-decode capability, a wall-clock-dependent note detector) called out up front instead of discovered mid-phase.

This plan was validated against the actual code (not just the roadmap descriptions) via three research passes: current data/persistence model, the audio pipeline's frame lifecycle, and the screens/navigation structure — plus a dedicated architecture-review pass that caught several hidden dependencies (noted inline below).

## Key existing pieces to reuse (don't rebuild)
- `src/audio/pitchDetector.ts` — pure, platform-agnostic `detectPitch(samples, sampleRate)` / `computeRms(samples)`. Already proven on web; reusable for iOS and for audio-upload decoding.
- `src/audio/HarmonicaMapper.ts` — `frequencyToTab`, `tabToNote`, `noteToTab`. Covers both the live pitch→tab direction and the reverse note→tab direction needed for MIDI upload.
- `src/export/generators.ts` — tab→file format generation (txt/csv/json/midi/musicxml), pure functions over `TabNote[]`.
- `src/store/useSettingsStore.ts` + `src/store/storage.ts`/`storage.native.ts` — the persisted-Zustand-store pattern to copy for a new recordings store.
- Edit screen's own header (`src/app/edit.tsx`) — self-contained, not routed through global `TopBar`; the natural home for both a piano-roll toggle and an "Inspect frames" button.

## Phase 0 — Recording-session foundation
Unlocks nearly everything downstream; currently there is no concept of a saved/identified recording, only a single ephemeral `tabNotes: TabNote[]` in `useAppStore`.
- Add a `TabRecording` type (`id`, `title`, `key`, `harmonicaType`, `tabNotes`, `createdAt`, `duration`) alongside `TabNote` in `src/types/index.ts`.
- Generate a `recordingId` in `startRecording()` (`useAppStore.ts`), stored alongside `recordingStartTime`.
- New `useRecordingsStore.ts`, persisted via the same `persist` + storage-shim pattern as `useSettingsStore.ts`, holding a `TabRecording[]` library.
- **Gotcha to get right**: `reset()` in `useAppStore.ts` wipes `tabNotes`/`selectedKey`/`harmonicaType` in one shot. At both existing call sites (`edit.tsx` "New Recording", `export.tsx` "New Recording"), snapshot the current session into a `TabRecording` and push it to `useRecordingsStore` **before** calling `reset()`, not after.
- Extract the free-tier paywall gate (currently only in `index.tsx`'s `handleStart`, with the usage counter only incremented in `recording.tsx`) into a shared "consume a free session" helper. Needed now because Phase 1 adds sibling entry points (upload audio/MIDI) that must hit the same gate — cheap to do here, easy to forget later and ship an accidental unlimited-usage bypass.

## Phase 1 — Home-as-library + recording history
- Rebuild `index.tsx` as a library/dashboard: recents list sourced from `useRecordingsStore`, plus 3 entry-point CTAs (Record / Upload Audio / Upload MIDI). Record works today; the upload CTAs ship as disabled "coming soon" until Phases 5–6 land, so the IA lands before the harder pipelines do.
- Wire the save-to-library snapshot (Phase 0) into both reset points.
- All entry points route through the shared session-gate helper from Phase 0.

## Phase 2 — Frame retention plumbing + real Frame Inspector
- Build the frame buffer as a **standalone module keyed by `recordingId`**, not bolted into `useAudioCapture.ts`. That hook's effect ordering around `detectorRef.current?.flush()` is already fragile, and Phase 5's upload decoder won't go through this hook at all — it needs to push into the same buffer from a different code path. The mic-capture listener and the future upload decoder should both just call `frameBuffer.push(recordingId, frame)`.
- Add an explicit per-frame timestamp (neither platform emits one today).
- **Required refactor, not optional**: `NoteDetector.process()` currently calls `Date.now()` internally — every duration/threshold (`GRACE_MS`, `CONFIRM_MS`, `MIN_DURATION`, the envelope dip/rise onset logic) assumes frames arrive paced to real time. Change `process(frame, recordingStartMs)` to take an explicit per-frame timestamp instead of reading the wall clock. This is a hard prerequisite for Phase 5 (a file-decode loop will otherwise blow through `Date.now()` near-instantly and collapse every threshold to zero) — do it here since the timestamp field is already being added.
- While in there: lift the module-level constants (`GRACE_MS`, `CONFIRM_MS`, `MIN_DURATION`, `DIP_RATIO`, `RISE_RATIO`, `MIN_DIP_MS`, `NOISE_FLOOR_MULT`, `NoteDetector.ts:11-24`) into an optional config object on `createNoteDetector(...)`, defaulting to current values. Small mechanical change, and it's what makes the Advanced-disclosure tuning sliders below actually do something.
- Build the real Frame Inspector screen per the already-approved layout mockup (loudness/pitch/notes/segmentation tracks + zoomable raw-note DNA-style track + overview minimap). Entry point: "Inspect frames" button on `edit.tsx`'s own header (not global `TopBar` — keeps it scoped to the screen that owns it). Visualization tracks ship to all users by default; raw threshold sliders live behind an "Advanced" disclosure using the new config object — this is already the documented recommendation, not an open question, so it doesn't need to gate this phase.
- Note for scope-tracking: the acceptance bar "works on sessions from either creation path" can't be fully exercised until Phase 5/6 exist. Write the buffer/screen generically now (keyed by `recordingId`, not by "is currently recording") so that when upload ships, Frame Inspector needs no rework — just don't mark this bar fully verified until then.

## Phase 3 — Playback (new audio-output infrastructure)
Re-scoped from the original one-line roadmap item: **no audio-output capability exists anywhere in the codebase today** (confirmed by search — no `expo-av`/`expo-audio` usage). This is greenfield, not "wrap the existing MIDI generator."
- Build a real-time tone scheduler that plays directly from `TabNote[]` (`start_time`/`duration`/`note` → oscillator/tone per note), rather than round-tripping through `generators.ts`'s exported MIDI bytes (which would additionally require a MIDI-playback/synth library this stack doesn't have).
- Web: `OscillatorNode` scheduling via Web Audio (same API family already used for capture). Native: needs its own scoped decision (likely a small oscillator/tone approach via an audio-capable Expo module) — treat as its own spike if `expo-audio` doesn't cover it.
- Expose as a `usePlayback` hook — shared by the list edit screen, the piano-roll editor (Phase 4), and a pre-export preview.

## Phase 4 — Piano-roll editor
- Toggle in `edit.tsx`'s header (identified seam) switching list view ↔ piano-roll view; both share the same `tabNotes` data and the existing bottom action row (Undo/New/Add/Export), so only the note-display/editing body swaps.
- Pitch axis snapped to notes actually playable on the selected key/type, via `HarmonicaMapper`.
- Depends on Phase 3 (hear-while-editing playback).
- Accessibility: arrow-key nudge as an alternative to drag-to-move/resize, from the start — not a retrofit.

## Phase 5 — Audio upload (split into two sub-phases — these are two different hard problems)
**5a — decode + reuse existing pipeline, user still manually picks key**
- Add `expo-document-picker`. Native has no existing Expo API to decode an arbitrary uploaded audio file to PCM — this needs a scoped spike; recommend limiting native to WAV-only for the first pass pending that spike's outcome. Web gets this for free via `AudioContext.decodeAudioData`, matching the existing web capture code path.
- Feed decoded PCM through the existing `pitchDetector.ts` (`detectPitch`/`computeRms`) frame-by-frame, into the Phase-2-refactored `NoteDetector` (explicit timestamps, not wall clock) — same downstream pipeline as live recording, just a different frame source.
- Uses the Phase 0 session-gate helper, same as any other entry point.

**5b — automatic harmonica key detection**
- Separate algorithmic task: a key-agnostic frequency-extraction pass over the whole decoded file, score all 12 candidate keys via `frequencyToTab` (fewest unmappable/awkward notes wins), then run the final key-aware `NoteDetector` pass with the winning key.
- Don't conflate with 5a — 5a can ship (manual key picker) before 5b's heuristic is ready.

---

# Phase 5 — Detailed implementation plan (written 2026-08-01)

Expands the summary above against the code as it actually stands after Phases 0–4. Two
things the original write-up assumed are already done and don't need doing again:
`NoteDetector.process(frame, now, recordingStartMs)` already takes an explicit per-frame
timestamp (`NoteDetector.ts:139`) with a full `NoteDetectorConfig` object, and
`frameBuffer.pushFrame(recordingId, frame)` is already a standalone module any pipeline can
push into. So the upload path is genuinely additive — it feeds existing pipes, it doesn't
refactor them.

## The organizing idea: decode → frames → notes

The single most important structural decision here. Split the pipeline at the frame boundary:

```
file → [decode]  → Float32 PCM  → [analyze]  → RawFrame[]  → [detect]  → TabNote[]
        platform    (mono, Hz)     EXPENSIVE    key-agnostic   CHEAP      key-specific
        split                      (DSP)                       (no DSP)
```

`detectPitch` is the only expensive step, and it does not depend on the harmonica key —
`frequencyToTab` is applied later, inside `NoteDetector`. Retaining `RawFrame[]` in the
middle buys three things at once:
1. **5b becomes nearly free.** Scoring 12 candidate keys = 12 re-runs of the *cheap* half.
   No re-decoding, no re-running MPM.
2. **Frame Inspector works with zero extra wiring** — `RawFrame[]` is exactly what
   `pushFrame`/`TabRecording.frames` already store, closing Phase 2's deferred acceptance
   bar ("works on sessions from either creation path").
3. **Re-detect-on-key-change** later becomes a cheap editor feature, not a new pipeline.

Build it in this order and 5b is a small addition on top of 5a rather than a second pass
over the same problem.

## Assumptions taken (flag if wrong)
- **Web is the shipping target for Phase 5.** Web decodes every browser-supported format
  via `decodeAudioData`. Native ships **WAV-only** via a JS RIFF parser (see 5a-2); mp3/m4a
  on Android surface a clear "not supported yet, use WAV or record directly" error rather
  than blocking the phase. A native decoder is split out as **5c** below, unscheduled.
- **Key detection optimizes playability, not convention** — fewest bends/overblows/
  unmappable notes wins, which will usually pick 1st position. Cross-harp players expect a
  C harp for a G tune; that's surfaced as a ranked alternate labelled with its position,
  not by changing the objective function.
- **Detection is shown, never silent.** 5b preselects the key on the import screen with a
  visible confidence and an override dropdown. "No manual key picker needed" is satisfied by
  a correct default, not by hiding the choice.

## 5a — Audio upload with manual key selection

### 5a-1 · Entry point + session identity
- `npx expo install expo-document-picker`.
- Home (`index.tsx:316-337`): enable the "Upload Audio" button (MIDI stays "Soon"), plus
  the web hero card's upload tile (`index.tsx:503-521`). The picker button *is* the
  accessible path — the roadmap's "real browse-files button, not drag-and-drop-only"
  commitment is satisfied by construction; a DnD zone can be added later as an extra.
- `handleUploadAudio()` mirrors `handleStart()` (`index.tsx:177-184`) exactly: gate first via
  `resolveSessionGate` → `showRating`/`showPaywall` branches, then pick, then navigate. A
  cancelled picker consumes nothing.
- **New `useAppStore` action `startImportedSession()`** — a sibling of `startRecording()`
  that generates `recordingId`, sets `recordingStartTime`, clears notes/history, but leaves
  `isRecording: false` so `useAudioCapture` never engages and `/recording` is never involved.
  Do not reuse `startRecording()` for this; the mic hook keys off `isRecording`.
- Default `recordingTitle` to the picked filename (minus extension) instead of the timestamp
  fallback in `getDefaultRecordingTitle()` — free, and much better in the library list.
- **Consume the free-tier session only on success**, after analysis produces notes —
  mirroring `recording.tsx:116-119`'s `incrementRecordingCount()` at Stop, not at Start. A
  failed decode must not cost a user one of their 3 free recordings.

### 5a-2 · Decode module — `src/audio/decodeAudio.ts` (+ `.web.ts`)
Returns `{ samples: Float32Array /* mono */, sampleRate: number, durationMs: number }`.
- **Web** (`decodeAudio.web.ts`): `file.arrayBuffer()` → `new AudioContext().decodeAudioData()`
  → average channels to mono. Platform split is genuine here (DOM API), not hedging.
- **Native** (`decodeAudio.ts`): `expo-file-system` read as base64 → existing
  `src/audio/base64.ts` → RIFF/WAV parser (PCM 16/24/32-bit + IEEE float, mono/stereo
  downmix). This is the exact inverse of `buildWavFile` in `synthesizeWav.ts:50` — put the
  reader beside it as `wav.ts` rather than duplicating header knowledge. Anything not WAV
  throws a typed `UnsupportedFormatError`.
- Guard rails, both platforms: reject > ~5 min or > ~25 MB with a specific message; reject
  sample rates below 16 kHz (MPM's `FREQ_MAX` 3200 Hz needs headroom); handle a zero-length
  or fully silent decode as "no notes detected" rather than dropping the user into an empty
  editor.

### 5a-3 · Offline analysis — `src/audio/analyzeSamples.ts`
Pure, platform-agnostic, cancelable, progress-reporting. `samples → RawFrame[]`.
- **Window 2048 (`PITCH_WINDOW_SIZE`), hop 2048 (non-overlapping).** This is load-bearing:
  the live web path uses a 2048-sample `ScriptProcessorNode` (`AudioCapture.web.ts:45`), so
  frames arrive ~46 ms apart at 44.1 kHz, and every `NoteDetector` default (`graceMs` 150,
  `confirmMs` 40, `minDurationMs` 110, `minDipMs` 50) is tuned against that spacing. Matching
  hop to the live frame rate is what makes uploaded audio segment like recorded audio.
  Overlapping hops are a knob to revisit *after* the round-trip test exists, not before.
- `t = round(frameIndex * 2048 / sampleRate * 1000)` — relative ms, matching `RawFrame.t`.
- **Silence gate:** skip `detectPitch` entirely when `computeRms(window)` is below a
  file-relative floor (e.g. a low percentile of the file's own frame RMS), emitting
  `frequency: NaN`. Mirrors the live `rms >= threshold` gate in `AudioCapture.web.ts:52` —
  and since silence is where a real recording spends much of its time, this is also the
  cheapest large CPU win. Note the live threshold comes from `micSensitivity`, which is
  meaningless for a file; derive it from the file instead.
- **CPU is the main risk.** One `detectPitch` call is ~2M multiply-adds; a 3-minute file is
  ~3,900 frames. Expect tens of seconds single-threaded. Mitigations in order: (1) the
  silence gate above, (2) `await` a macrotask yield every ~100 frames so the UI stays alive
  and Cancel works, (3) determinate progress bar — the frame count is known up front, so
  progress is exact, not faked. Measure with a real 3-minute file before reaching for a Web
  Worker; add one only if the measurement demands it (and note it can't help native).
- Every frame also goes to `pushFrame(recordingId, frame)`. Frame Inspector then works on
  uploads for free.

### 5a-4 · Detection wrapper — `src/audio/framesToNotes.ts`
`(frames: RawFrame[], key, harmonicaType, config?) → Omit<TabNote,'id'>[]`. Creates a
detector, calls `process(frame, frame.t, 0)` per frame (`recordingStartMs: 0` since `t` is
already relative), then `flush(0)`. Tiny, but it's the seam 5b re-runs 12 times and the
seam a future "re-detect in a different key" reuses. Commit via the existing bulk
`addTabNotes()` action (`useAppStore.ts:150`) — one history entry for the whole import.

### 5a-5 · Import screen — `src/app/import.tsx`
A route rather than a modal on Home, because Phase 6 needs the same screen and 5b adds a
confirmation step to it. Shows filename, determinate progress, Cancel, typed error states,
and (once 5b lands) the detected key with an override before Continue. On success it routes
to `/edit` — same downstream editor as every other entry point, per the app-architecture
decision that creation method must not fork the editor.

### 5a-6 · Persistence gotcha — frame payload size
`saveCurrentSessionToLibrary` persists `frames` into `TabRecording` via AsyncStorage
(`sessionSnapshot.ts:49`). Short live recordings made this harmless; a 3-minute upload is
~3,900 frames (~150 KB of JSON) and Android AsyncStorage has a hard total-size ceiling. Add
a decimation step at save time — keep full resolution up to ~2,000 frames, then keep every
Nth — before uploads make this a real bug. Frame Inspector's minimap doesn't need
per-frame fidelity across a whole long file anyway.

## 5b — Automatic harmonica key detection

Runs on the `RawFrame[]` from 5a-3, so it adds no DSP cost.

### 5b-1 · Octave fold (shared with Phase 6)
`frequencyToTab` returns `null` outside the layout's ~C4–C7 span (`HarmonicaMapper.ts:5-41`),
so a recording pitched an octave low maps to nothing *for every key* and scoring degenerates.
Compute the median detected MIDI, compare against the layout's median (~78), and choose a
whole-recording shift of 0/±12/±24 before scoring. Put this in a shared helper — Phase 6's
arbitrary-range MIDI files need exactly the same pre-pass. **Surface any applied shift to
the user** ("transposed up 1 octave to fit the harmonica's range"); it changes the pitches
against the source audio and must not be silent.

### 5b-2 · Scoring
For each of the 12 keys, run `framesToNotes` and score the resulting notes, weighting each
note by duration (long notes matter more) with a cap so one held note can't dominate:

```
score = mappedFraction − 0.35 × bendFraction − 0.6 × overblowFraction
```

Bend/overblow classification is a substring check on the tab string itself (`'` = bend,
`o` = overblow) — the same trick Phase 6 uses for highlighting. Confidence = margin between
the winner and the runner-up, which is what the UI shows.

### 5b-3 · Chromatic is a special case
A 12-hole chromatic covers every semitone in range, so coverage is nearly flat across all 12
keys and the score carries no signal. **Skip detection for chromatic** — keep the user's
selected key. Detection is a diatonic feature; say so in the UI rather than showing a
meaningless "detected" result.

### 5b-4 · Present alternates with positions
Show the top 2–3 candidates labelled by position (harp key vs. song key interval: same =
1st, +5 semitones = 2nd/cross harp, etc.). A player who wants cross harp gets one click
instead of a re-import, and it costs one small mapping table.

## 5c — Native audio decode beyond WAV (deferred, unscheduled)
No Expo SDK 55 API decodes arbitrary compressed audio to PCM. Options when it becomes
worth doing: a small Expo Module wrapping `MediaCodec`/`MediaExtractor` on Android (mirrors
how `audiocapture` already wraps Oboe), or a WASM/JS mp3 decoder. Explicitly not blocking
5a/5b.

## Verification
- **Round-trip test (the good one):** `synthesizeWav.ts` already renders `TabNote[]` → WAV.
  Generate a WAV from a known note sequence, run it back through decode → analyze → detect,
  and assert the recovered tabs/timings match. This is an automated harness for 5a *and* a
  ground-truth harness for 5b (known key in, assert the detector picks it) — build it in
  5a-4, before 5b, and 5b's scoring weights become tunable against data instead of taste.
- Real-world files: a handful of mp3/m4a/wav harmonica recordings with hand-checked expected
  output; confirm mono/stereo and 44.1/48 kHz all behave.
- Open Frame Inspector on an uploaded session — this is what finally closes Phase 2's
  deferred "either creation path" acceptance bar.
- Free-tier gate: verify a cancelled pick and a failed decode both leave
  `totalRecordingsUsed` unchanged, and a successful import increments it exactly once.
- Per project convention, restart the web dev server with `--clear` and confirm the served
  bundle reflects the change before browser-testing.

## Suggested build order
1. `framesToNotes` + round-trip test harness (no UI — proves the pipeline shape first).
2. Decode module (web `decodeAudioData`, native WAV) + `expo-document-picker` + guard rails.
3. `analyzeSamples` with silence gate, yields, progress, cancel.
4. Entry point + `startImportedSession()` + `/import` screen + gate/counter wiring → `/edit`.
5. Frame decimation at save (5a-6).
6. 5b: octave fold → scoring → import-screen key confirmation with alternates.

## Phase 6 — MIDI upload → tab conversion
Lower-risk than Phase 5 (deterministic parsing, no DSP/codec uncertainty) and shares only `expo-document-picker` with it — can be built before or in parallel with Phase 5 rather than strictly after.
- New dependency: a pure-JS MIDI parser (e.g. `@tonejs/midi` or `midi-file`).
- Transposition uses `noteToTab(note, key, harmonicaType)` — confirmed the correct function (not `frequencyToTab`, which is for raw detected frequencies). `HarmonicaMapper`'s per-key tables are sparse (gaps exist, e.g. no entry for MIDI 85 in `C_DIATONIC`) and scoped to roughly the harmonica's native octave range — arbitrary uploaded MIDI will span wider octaves than the tables cover. Needs an explicit octave-folding/best-fit pre-pass plus a defined fallback for unmappable notes (drop / snap-to-nearest / flag-as-impossible) — a real design decision, not a drop-in call.
- Overblow/bend highlighting is nearly free: tab strings already self-encode this (`"1o"` = overblow, `"-1'"`/`"-3''"`/`"-3'''"` = single/double/triple bend) — a substring check is sufficient for the UI.
- Accessibility: real "browse files" button alongside any drag-and-drop zone, not drag-and-drop-only (same commitment as Phase 5's upload UI).

---

# Phase 6 — Detailed implementation plan (written 2026-08-01)

Expands the summary above now that Phase 5 has shipped and left most of the plumbing in
place. Written against the code as it stands, not against the roadmap description.

## The organizing idea: same pipeline, minus the DSP

Audio import is `decode → frames → notes → tabs`, where only the last step depends on the
harmonica key. MIDI is the same shape with the expensive half deleted:

```
file → [parse] → timed pitches → [reduce] → monophonic line → [map] → TabNote[]
        SMF       (already        to one      (harmonica is     key-      tab: '' where
        bytes      explicit)      voice        monophonic)      dependent  unplayable
```

Because the key-dependent step is the same seam `framesToNotes` occupies for audio, almost
everything Phase 5 built above and below it transfers unchanged: `pendingImport`, the
session gate, `startImportedSession()`, the `/import` route and its confirm step, filename-
as-title, frame decimation, and the candidate-scoring shape from `keyDetection.ts`. What is
genuinely new is monophonic reduction, target-key *selection* (rather than detection), and
what happens to notes the harmonica can't play.

## Decisions taken

### Unplayable notes keep their pitch as `tab: ''` — never dropped, never snapped
The app already answers this question and Phase 6 should not invent a second answer.
`changeHarmonicaType` (`useAppStore.ts:258-267`) already re-matches pitches against a new
layout and sets `tab: ''` for those with no position, keeping `note` intact. Everything
downstream understands that state already:
- `PianoRoll.tsx:76` classifies it as `unplayable`, renders it neutral grey labelled "Not
  reachable on this harmonica", and keeps unplayable *rows* on the grid so the note has a
  real place to sit.
- `generators.ts:26` exports it as `[G#6]` — a bracketed pitch, in every format.
- `edit.tsx:1100-1109` already counts them and warns before export.

So MIDI import needs **no new UI for this at all**; it inherits a rendering, an export
representation and a pre-flight warning that are already consistent with the type-switch
flow. Snapping to the nearest playable pitch is rejected because it silently rewrites the
music into something the user can't detect without checking the source, and is
unrecoverable once done; dropping is worse, since it also changes what lines up against the
timeline.

### Separate the two failure modes before applying that policy
A note *outside* the harp's range (a bass line two octaves down) is a register problem —
fixed by the octave fold, applied to the whole piece. A note *inside* the range but absent
from the layout (no diatonic position produces C#6 or G#6 at all) is an accidental problem,
and that's what `tab: ''` is for. Fold first; only what's still unmapped afterwards is
genuinely unplayable. Conflating them makes the fold look broken and the unplayable count
look catastrophic.

### Make it a key-choice problem
Most unplayable-note complaints are really wrong-harp complaints. Scoring all 12 keys costs
nothing here — `noteToTab` over a few hundred MIDI notes, no DSP whatsoever — so the target-
key picker should show playability per key ("C: 14 unplayable · G: 2 unplayable"), turning
the problem into a one-tap fix before the user ever reaches the editor. This is where the
effort belongs, not in a cleverer fallback.

### The user picks the track — it is not inferred
**Decided by the user, 2026-08-01.** A multi-track MIDI file is an arrangement, and which
part someone wants on a harmonica is a musical choice the file itself doesn't encode. The
app asks.

The rejected alternative was merging every track and flattening to the highest sounding
note. It reads as clever and fails badly: the resulting line hops between instruments
whenever the melody isn't the top voice, and nothing about the output tells the user that's
what happened. An explicit choice is predictable, explainable, and correctable in one tap.

Concretely:
- **List every note-bearing track**, each with the name from its track-name meta event
  (falling back to its program/instrument name, then "Track 3"), its note count, its pitch
  range as note names, and its duration. Those four facts are what let someone recognise
  "that's the melody" without playing anything.
- **Pre-select the most melody-like track** (highest median pitch among tracks with ≥8
  notes) so the common case stays one tap — a default, not a decision made for them.
- **Skip the question when there's exactly one** note-bearing track, including this app's
  own exports. Asking a question with one possible answer is friction, not control. The
  chosen track still appears on the confirm step as a stated fact.
- **Exclude channel 10** (percussion — pitch is meaningless there) from the list entirely;
  if a file has nothing else, fail with a clear message rather than an empty picker.
- **Keep "All tracks merged" as an explicit last option**, clearly labelled. It's
  occasionally the right answer for a two-hand piano part, and as an opt-in it carries none
  of the silent-failure risk it has as a default.
- Chords *within* the chosen track still need flattening to the top voice — monophonic
  reduction doesn't go away, it just stops spanning unrelated instruments.

**Structural consequence:** track choice must precede key scoring, since the scores depend
on which notes are in play. Re-scoring is cheap (no DSP — `noteToTab` over a few hundred
notes), so the confirm step is one screen with the track list above the key list, where
changing the track live-updates the key scores. Two sequential screens would be worse: the
key list is the main evidence that the track choice was right.

### Take the tempo from the file
MIDI carries a real tempo map, so the session's `bpm` can be set from it via the existing
`setBpm`. This is a free win audio import can never have, and it makes the piano-roll's bar
ruler and metronome correct on arrival instead of defaulting to 100.

## 6-1 · Shared byte reading — `src/audio/readFileBytes.ts` (+ `.web.ts`)
MIDI needs raw bytes on both platforms and, unlike audio, needs no codec — so the
platform-split reading logic currently inlined in the two `decodeAudio` modules should be
lifted out: web `file.arrayBuffer()` (falling back to `fetch(uri)`), native
`new File(uri).bytes()`. Refactor both `decodeAudio` halves onto it in the same change so
there's one place that knows how a picked file becomes bytes.

## 6-2 · Parse + reduce — `src/audio/midiToNotes.ts`
- **New dependency: `@tonejs/midi`.** Preferred over raw `midi-file` because it resolves the
  tempo map and PPQ into absolute seconds per note, which is real work with real edge cases
  (mid-file tempo changes, running status) that shouldn't be reimplemented here.
- Produce, per track, everything the picker needs to describe it without re-parsing:
  `{ id, name, channel, instrument, noteCount, lowestNote, highestNote, durationMs,
  notes: { midi, timeMs, durationMs }[] }`.
- Reduce a *selected* track to one voice: sort by onset; where notes overlap, keep the
  highest pitch and truncate the earlier note at the later one's onset (no zero or negative
  durations). Reduction runs per chosen track, not across the file.
- Drop notes shorter than the detector's own `minDurationMs` floor (110ms) so imported
  grace notes don't produce tabs a player can't articulate — matching what the audio path
  discards.
- Pure and platform-free, so the harness can drive it directly.

## 6-3 · Shared octave fold — `src/audio/pitchRange.ts`
Phase 5's `octaveShiftForRange` in `keyDetection.ts` works on `RawFrame[]` (frequencies),
so MIDI can't reuse it as-is. The *logic* transfers exactly — median pitch vs. the layout's
centre (~MIDI 78), shift in whole octaves only, threshold before shifting at all. Extract
the core to take an array of MIDI numbers; `keyDetection`'s frame version becomes a thin
wrapper that converts frequencies first. Budget for this refactor rather than assuming a
free import.

## 6-4 · Mapping + scoring — `src/audio/notesToTabs.ts`
- `notesToTabs(notes, key, harmonicaType)` → `Omit<TabNote,'id'>[]` via `noteToTab` (**not**
  `frequencyToTab`, which is for raw detected frequencies), applying the `tab: ''` policy.
- `scoreTabbedNotes(notes)` → the mapped/bend/overblow fractions `keyDetection.ts` already
  computes. Extract that scoring out of `scoreKey` so both entry points share one
  definition of "how playable is this", and MIDI's key picker renders the same
  `KeyCandidate` shape the audio confirm step already renders.
- Bend/overblow classification stays the existing substring check on the tab string.

## 6-5 · Entry point
Enable Home's "Upload MIDI" button (currently the last `comingSoon` badge, `index.tsx:370`)
and the sidebar/hero equivalents, mirroring `handleUploadAudio` exactly: gate first, pick
inside the press handler (browser user-activation), stash via `setPendingImport`, navigate.
A `pickMidiFile` sibling of `pickAudioFile` filtering `audio/midi`, `audio/x-midi` and
`.mid`/`.midi` — Android's MIME reporting for MIDI is as inconsistent as it is for WAV, so
match on extension as well as MIME.

## 6-6 · `/import` gains a MIDI mode
The route already handles decode → analyze → confirm → commit; MIDI swaps the first two
stages for a parse and reuses the rest. The confirm step becomes, top to bottom:

1. **Track list** (skipped when the file has one note-bearing track) — name, note count,
   pitch range, duration; most melody-like pre-selected; "All tracks merged" last.
2. **Target-key list** — per-key playability for the currently selected track, re-scored
   whenever that selection changes.
3. **Unplayable-note count** for the chosen track/key combination, and the octave-shift
   notice (same component as Phase 5).

Progress reporting is near-instant — parsing is milliseconds, so the working phase will
usually flash past; don't fabricate a fake progress animation for it.

Accessibility: both lists are `radiogroup`s of real focusable rows, same pattern as the
audio confirm step's candidate list, so the whole flow is keyboard-operable end to end.

Optional, worth considering once the rest works: a preview-play button per track using the
existing `usePlayback`, which already plays a note sequence without touching the editing
session (`index.tsx` previews library recordings the same way). Hearing four bars is a
faster way to recognise the melody than reading a pitch range — but it's polish, not a
prerequisite.

## 6-7 · Frame Inspector's empty state
A MIDI-imported session has no frames at all, and the current empty state
(`frame-inspector.tsx:448-455`) explains that as "this recording was saved before Frame
Inspector data was kept" — which will be wrong and confusing. Add a `source:
'recording' | 'audioUpload' | 'midiUpload'` field to `TabRecording` (optional, absent means
legacy) and branch the copy: a MIDI import has no audio to inspect *by nature*, not because
data was lost. The field is also what the library list needs to badge how each tab was made.

## Verification
- **Round-trip harness, same trick as Phase 5.** `generators.ts:96`'s `generateMidi` already
  emits a real format-0 SMF (tempo meta event, PPQ 480, base64) — so a known `TabNote[]`
  can be exported to MIDI, parsed back, mapped, and compared. Extend
  `scripts/verify-audio-import.ts` (or a sibling script) with: exact tab/timing recovery on
  our own export, chord flattening to the top voice *within* a track, overlapping-note
  truncation, a mid-file tempo change, a two-octaves-low melody exercising the fold, a
  percussion track being excluded from the track list, and track enumeration reporting the
  right note counts and pitch ranges for a multi-track file.
- Assert the unplayable path explicitly: import a chromatic line onto a diatonic harp and
  confirm the notes arrive with `tab: ''` and the correct pitch, rather than being dropped.
- Confirm per-key scoring ranks the obvious key first for a simple diatonic melody.
- Real-world files: a single-track melody export, a full multi-track arrangement, and a
  file whose melody sits outside the harp's range.

## Suggested build order
1. `readFileBytes` extraction + `decodeAudio` refactor onto it (no behaviour change).
2. `pitchRange` extraction from `keyDetection` (no behaviour change; harness still green).
3. `midiToNotes` + round-trip harness — headless, before any UI.
4. `notesToTabs` + shared `scoreTabbedNotes`, with the `tab: ''` policy asserted by tests.
5. Home entry point + `/import` MIDI mode: track picker and key picker together, since the
   key scores are what make a track choice verifiable.
6. `source` field on `TabRecording` + the Frame Inspector copy fix.

## Phase 7 — User accounts (Firebase Auth)
- Greenfield sign-in: Google Sign-In + email link first (per the already-locked web version plan), Sign in with Apple once iOS ships.
- Ties `useRecordingsStore` to cloud sync so the library built in Phase 1 becomes portable across devices/platforms.

---

# Phase 7 — Detailed implementation plan (written 2026-08-12)

Expands the two lines above against the code as it stands after Phases 0–6 and 11. The
summary describes this phase as sign-in plus sync, which is right, but it hides three
quarters of the work. This phase is really five things:

1. **Sign-in** — Google plus email/password. The smallest part.
2. **Everything email/password drags in** — a confirmation email, a verification state, a
   password reset flow, one shared action-handler route, and branded email delivery. This
   is bigger than the sign-in itself and is the part that gets underestimated.
3. **`/profile` and the signup trigger** — new product surface, not plumbing.
4. **The sync engine** — the riskiest code in the phase, the only place a bug silently
   destroys a user's work, and **the part that now ships after Phase 8** (see the staging
   decision below).
5. **Account deletion, the privacy policy and the Play Data safety re-declaration** —
   store-policy obligations, not follow-ups.

**Seven decisions were taken by the user on 2026-08-12** and are settled below rather than
left open: local-first storage with a cloud mirror; Google + email/password as the sign-in
methods; **accounts created at subscribe and offered voluntarily anywhere**; **free accounts
get sync**; a full **`/profile` route**; and **the phase splits into 7a (accounts, now) and
7b (sync, after Phase 8)**. Three of them overturn what was previously written down — see
the decision notes.

## What is actually live, and what is not

Checked against `main` on 2026-08-12, because most of this plan's risk assessment depends on
what real users already have. **`web_version` is 22 commits ahead of `main` and `main` is
fully contained in it** — a clean fast-forward when it merges.

The live Android app is much smaller than this branch:

- **It has `useAppStore` and `useSettingsStore`. That is all.** No `useRecordingsStore`, no
  `sessionSnapshot`, no `recordingsMigration`. The library, import, Studio, Frame Inspector
  and piano roll are all web_version-only.
- **There is no saved library on the live app.** A session is ephemeral: record → edit →
  export, then it is gone. So there is no shipped library to grandfather, migrate or
  reconcile — a real simplification, and the opposite of what this plan first assumed.
- **`handleSave` on the live app means "write the export file to Downloads"**
  (`main:src/app/export.tsx:54`), not "save to library". On Android today, save *is* export
  — it is the app's only output.
- **The free tier is genuinely active on `main`** (commit `fa3c542`), where
  `FREE_TIER_ENABLED` does not exist at all. It is `false` only on `web_version`, for
  development (`useSettingsStore.ts:24`). **Real users hit the 3-session paywall today** —
  which is what makes the subscribe-time signup decision below land on an existing moment
  rather than a new one.
- The only signals available in a shipped install's persisted `harp2tab-settings` blob are
  `micSensitivity`, `totalRecordingsUsed`, `isPurchased`, `hasCompletedOnboarding` and
  `ratingStatus`. Any "is this an existing user" test has to be built from those five.

## The organizing idea: identity is additive, and the cloud is a mirror

```
   signed out — today's app, and still a complete one
   ┌──────────────────────────────┐
   │ local stores                 │──────────────────────────►  every screen
   │ localStorage / AsyncStorage  │
   └──────────────────────────────┘

   signed in
   ┌──────────────────────────────┐        ┌───────────────┐        ┌──────────────┐
   │ local stores                 │◄──────►│  sync engine  │◄──────►│  Firestore   │
   │ still what every screen reads│ merge  │  (one module) │  net   │ /users/{uid} │
   └──────────────────────────────┘        └───────────────┘        └──────────────┘
```

**The rule that keeps this cheap: no screen ever reads Firestore.** Not one component,
hook or selector gains a network dependency, a loading state or an error state. The sync
engine writes into the same three zustand stores everything already reads, so `index.tsx`,
`edit.tsx` and `studio.tsx` are untouched by this phase. If a component ends up needing
`await`, the boundary has been drawn in the wrong place.

The corollary is that the local store stays the source of truth *for the running app*, and
the cloud is a mirror that is reconciled at known moments. This is not a hedge — it is the
only model that keeps the app working offline, which it does today for free and would
otherwise lose.

## What already exists (and what genuinely doesn't)

- **A Firebase project already exists, and native already points at it.**
  `@react-native-firebase/app` and `/crashlytics` v24 are in `package.json`,
  `android/app/google-services.json` is checked in, and `android/app/build.gradle:5`
  applies the Crashlytics gradle plugin.
- **Nothing in `src/` imports Firebase.** Zero hits across the tree — Crashlytics runs
  entirely through the native plugin. So on the JS side this is greenfield, exactly as the
  summary says.
- **`app.json` has no `@react-native-firebase/app` config plugin** (plugins are
  `expo-router`, `expo-splash-screen`, `expo-audio`). Native Firebase is configured through
  the checked-in `android/` project, so adding a native auth module is native-project work,
  not a plugin line. iOS has no `GoogleService-Info.plist` at all — Phase 9's problem, but
  worth knowing it is not half-done.
- **Three persisted stores to sync**, and one of them already solves the hard half of the
  wire format: `useMidiProjectsStore` serialises to base64 SMF in `partialize` and decodes
  in `merge`, dropping unreadable entries individually rather than failing the load
  (`useMidiProjectsStore.ts:66-83`). That is the shape the sync layer wants too.
- **`recordingsMigration.ts` is already a pure, harness-driven migration** at version 2,
  split out of the store precisely so it can be tested with hand-authored old payloads. The
  `updatedAt` addition below is a v3 that costs almost nothing because of that.
- **No identity anywhere.** `isPurchased` is a local boolean (`useSettingsStore.ts:35`),
  `totalRecordingsUsed` a local counter (`:34`), and `resolveSessionGate` reads both from
  local state (`sessionGate.ts:15-27`).

## Decisions taken

### Two SDKs behind one module, web first

Web uses the `firebase` JS SDK; native uses `@react-native-firebase/auth`. This is not a
preference, it is what each platform supports properly — RNFirebase is native-only, and the
JS SDK's React Native persistence story is the worse of the two on device.

The seam is the one this codebase already uses three times: `src/lib/auth.ts` +
`src/lib/auth.web.ts`, exactly like `storage.ts`/`storage.native.ts`,
`useIAP.ts`/`useIAP.web.ts` and `AudioCapture`. The interface is small enough to be worth
writing down before either implementation:

```ts
signInWithGoogle(): Promise<AuthUser>
sendSignInLink(email: string): Promise<void>
completeSignInLink(url: string, email: string): Promise<AuthUser>
signOut(): Promise<void>
onAuthChange(cb: (user: AuthUser | null) => void): () => void
deleteAccount(): Promise<void>
```

`AuthUser` is ours (`uid`, `email`, `displayName`, `photoURL`, `providerId`), not the
SDK's — nothing outside `src/lib/` should import a Firebase type, or the platform split
leaks into every consumer.

**Web ships first and native follows** (`feedback_web_first_no_mobile_hedging`). The native
half is scoped in 7-14 rather than deferred silently, but nothing in the web work waits on
it, and the native stub returning "not available on this platform" is a legitimate
intermediate state.

### No anonymous auth

Firebase anonymous auth would give every visitor a UID and make sync uniform, at the price
of: an account row for every bounce on the landing page, a permanent link/upgrade step when
they later sign in for real, and — the actual disqualifier — an entitlement record keyed to
a UID nobody can ever recover, which is precisely the mess Phase 8's grandfathering is
already trying to avoid. Signed-out is a real, first-class, fully functional state.

### Google and email/password — and this overturns the locked email-link decision

**User decision, 2026-08-12.** `project_web_version_plan` (2026-07-29) and the Phase 7
summary both say "Google Sign-In + email link (passwordless) first". That is superseded:
the methods are **Google and email + password with a confirmation email**. Recording it
explicitly because it was a locked decision and the memory needs updating with it, not
quietly contradicting.

The trade is deliberate and worth naming, because it is the source of most of items 2 above:
email link needs no password, no reset flow and no confirmation email — the link *is* the
verification. Email/password is the flow every user already understands, and it is the one
that works when someone's mail client mangles a magic link. Choosing it buys familiarity
and pays for it with a verification state machine, a reset flow, a shared action-handler
route and email deliverability. All of that is scoped in 7-4 rather than discovered later.

**Apple is still forced in Phase 9.** Not selected here, and it does not need to be:
shipping Google on iOS obliges Sign in with Apple by App Store rule. The only Phase 7
obligation is that the sign-in modal's button column is laid out to take a third provider
without redesign.

Deliberately excluded: Facebook, GitHub, Microsoft, phone auth, and anonymous auth.

### Accounts are created at subscribe, and offered voluntarily anywhere. No save/export wall.

**User decision, 2026-08-12**, replacing an earlier same-day decision to wall save/export.
That wall is dropped entirely. There are exactly two ways to get an account:

- **Required at subscribe.** You cannot pay without an identity to attach the entitlement to.
- **Offered voluntarily, always** — the TopBar avatar and `/profile`, pitched on sync.

Recording, transcribing, editing, playing, saving to the library and exporting all stay free
and fully available signed out, exactly as they are today.

**Why this beats the wall, on three counts:**

1. **It is the only moment where the account serves the user's own goal.** Paying requires an
   identity; nobody resents signing up to buy. A save/export wall asks for an account so
   *we* get an email address, and the user can feel the difference.
2. **Nothing is taken away from anyone.** The live app's users already hit a 3-session
   paywall — that gate exists and is active on `main` today. Adding "create an account" to a
   screen they already see removes no capability. A wall on export would have removed the
   app's only output (see the live-state section: on Android, save *is* export).
3. **It collapses the two-gate sequencing problem.** The previous design had a signup wall at
   session end and a paywall at session start, with an explicit note that a user must never
   hit both in a row. One gate, one moment, no sequencing rule to get wrong.

**The catch it must not create, and the reason the voluntary door is mandatory:** an existing
Play Store lifetime buyer never hits the paywall again. Under subscribe-only signup they
would never create an account, never get a UID, and arrive on the web version as a brand-new
free user asked to pay for what they already own — precisely the promise-break Phase 8
already flags. **The people who most need an account are the ones who will never see the
gate**, so the voluntary entry point is not a nicety, it is the claim path.

**What this does to the grandfathering work:** almost all of it disappears. There is no
capability being removed, so there is no `preAccountUser` flag, no seeding migration, and no
negative test to write. The live-state check above also showed the flag as originally
specified could not have worked — it keyed on a non-empty recordings library, and the
shipped app has no library at all.

**What survives from the wall's design** is part 3, now attached to the paywall instead:
**the in-progress take must survive the sign-in round trip.** Google is a popup and returns
to the same page, but email sign-up ends in a confirmation link that may be opened in another
browser entirely. The session must be persisted locally *before* the subscribe flow opens.
This is the detail most likely to be skipped, and it is now the only thing standing between
"I signed up to keep playing" and "I lost the take I was working on".

**One consequence to accept:** the three free sessions stay per-device, because there is no
account until payment. `totalRecordingsUsed` remains local and remains trivially resettable
by clearing storage. This closes an open question the previous design had to leave open, and
it is the correct trade — server-enforcing a free tier costs a Cloud Function on every
session start, to protect a limit whose whole purpose is to be hit.

### Free accounts get sync

**User decision, 2026-08-12.** Sync is not part of the subscription; the subscription sells
unlimited sessions.

This is what makes the voluntary door worth walking through. If sync were paid, a free
account would confer nothing, nobody would create one, and the model would collapse back to
accounts-only-at-payment — losing both the email capture and the lifetime buyers' claim path.
The storage cost is a few hundred KB per user against the sizes measured below.

### The phase splits: 7a now, 7b after Phase 8

**User decision, 2026-08-12**, and a direct consequence of the two above. Same convention as
Phase 5's 5a/5b split.

| | contents | when |
|---|---|---|
| **7a — accounts** | 7-1…7-9, 7-12, 7-13 — bootstrap, auth store, Google, email/password, linking, the subscribe gate, `/profile`, the modal, the `updatedAt` schema, rules, deletion | now |
| **7b — sync** | 7-10, 7-11 — the merge engine, orchestration, first-sign-in adoption | after Phase 8 |
| **7-14 — native** | the platform half of everything above | after both |

The reasoning: under this model an account exists mainly to hold a subscription, so until
Phase 8 ships there is nobody with an account to sync. Building the riskiest code in the
roadmap for zero users means it sits unexercised until billing lands — the worst possible
soak conditions for a module whose failure mode is silent data loss.

**7-9 (the `updatedAt` schema migration) stays in 7a anyway**, even though only 7b consumes
it. It is a one-field migration over persisted user data, it is the only step here that
touches real libraries, and landing it early is what lets it soak for a whole phase before
anything depends on it being right.

**What this does to Phase 8:** accounts and billing are now close to one feature. Phase 8
should be planned assuming 7a is done and 7b is not — its entitlement writer lands against
the read path built in 7a, and the sync engine follows both.

### Last-write-wins per document, on an explicit `updatedAt`

No field-level merge, no CRDT. A tab or a project is edited as a unit by one person at a
time; the realistic conflict is "I edited this on my phone this morning and my laptop still
has last night's copy", which whole-document LWW resolves correctly. Field-level merge
would let two devices produce a note list neither user ever saw.

The cost is that a genuine simultaneous edit loses one side silently. Mitigation is
disclosure, not machinery: the sync status line on `/profile` names what was replaced (7-7).

### Documents sync as opaque payloads, not expanded Firestore maps

Measured worst cases for one `TabRecording` as JSON (synthetic, at the persisted frame cap
of 2000 — `frameBuffer.ts:59`):

| recording | total | without `frames` | `frames` alone |
|---|---|---|---|
| 200 notes | 144 KB | 32 KB | 112 KB |
| 1,000 notes | 271 KB | 159 KB | 112 KB |
| 3,000 notes | 591 KB | 479 KB | 112 KB |

Against Firestore's 1 MiB document limit that looks survivable — but Firestore does not
count JSON bytes. It charges every field *name* in every array element. A `tabNotes` array
of 3,000 maps repeats `velocitySource` (14 B), `start_time` (10 B), `confidence` (10 B) and
five more names 3,000 times: roughly 50 KB of nothing but keys, plus per-value overhead,
on every read and every write, forever.

So the payload goes in **one string field**, JSON for tabs and the existing base64 SMF for
projects, with only the fields the client needs to list or reconcile kept as real columns:
`id`, `title`, `updatedAt`, `createdAt`, `duration`, `source`, `favorite`. That gives cheap
listing without downloading bodies, keeps `updatedAt` queryable for incremental pulls, and
follows the precedent `useMidiProjectsStore` already set for exactly this reason
(the Phase 11 spike measured 64 KB SMF against 309 KB of expanded JSON).

### `frames` do not sync

They are 112 KB per recording — 78% of a typical document — and they exist for one screen,
Frame Inspector, as a decimated debug lens over a take. Syncing them would make the
dominant cost of the entire feature a diagnostic view.

`TabRecording.frames` is already optional and already documented as absent on older
recordings (`types/index.ts:92-94`), and Frame Inspector already distinguishes "no frames
retained" from "never had audio" via `source` (`:117-120`). So a recording pulled onto a
second device shows the same empty state a pre-retention recording does today — a state
that exists, is handled, and has copy written for it. **The empty state's copy still needs
a third case** ("this take's frames are on the device it was recorded on"), or the screen
will tell a lie it currently only tells accidentally.

Reversible later by putting frames in Cloud Storage under `users/{uid}/frames/{id}.json`
and fetching on demand — the one place in the app where a network read at open time would
be acceptable, because it is already a secondary inspection screen.

### Deletes need tombstones

Without them, delete-on-A followed by sync-from-B silently resurrects the recording, and
it looks like a bug in the delete button. `/users/{uid}/deleted/{docId}` holding
`{ deletedAt }`, checked before applying any remote document.

Tombstones are garbage-collected after 90 days. A device offline longer than that can
resurrect a deleted item — accepted, because the alternative is a collection that only ever
grows, and 90 days offline is not a case worth carrying that cost for.

### Entitlement is server state the client can only read

`isPurchased` stops being truth and becomes a cache of `/entitlements/{uid}`, written only
by the Cloud Function behind the RevenueCat webhook. The local boolean stays as the offline
fallback and as the only value on a signed-out device, so `resolveSessionGate` keeps working
unchanged — it reads `isPurchased` either way.

**This is the joint Phase 7/8 deliverable already flagged at Phase 8**: an existing Play
Store lifetime buyer has no UID until their first sign-in, so the reconciliation hook has to
exist in the sign-in flow that this phase builds, even though the billing that fills it in
lands in Phase 8. Build the read path and the entitlement document here; Phase 8 supplies
the writer.

**`totalRecordingsUsed` deliberately stays local.** Making it server state to stop
counter-resetting means enforcing the free tier server-side, which means a Cloud Function
on every session start. The counter is currently trivially resettable anyway (clear
`localStorage`), and `FREE_TIER_ENABLED` is `false` (`useSettingsStore.ts:24`), so nothing
is being lost today. Revisit with Phase 8, not here.

### Account deletion ships in this phase, not after it

Google Play requires apps that allow account creation to offer in-app account deletion plus
a publicly reachable deletion URL declared in the Data safety form. **Harp2Tab is live in
production.** Shipping sign-up without deletion is a policy violation on a shipped app, not
a gap in a not-yet-released feature — which is why it is 7-13 and not Phase 10 polish.

The same applies to `PRIVACY_POLICY.md`, which currently states that tab data is "stored
locally on your device", that audio is "never transmitted to any server", and has a "Data We
Do NOT Collect" section. Phase 7 makes at least the first of those false. The policy update
is part of this phase's definition of done.

---

# 7a-UI — the UI-only first pass (planned 2026-08-12)

**Build every screen in 7a against mock state, before any Firebase exists.** Requested by the
user as the first slice of Phase 7. Four design decisions were taken the same day and are
applied throughout: a **single centred column** for `/profile`, **initials in a circle and no
photos**, **URL-param mock states**, and **the full surface scope** — nothing held back.

## Why this slice is worth doing separately

Not just "design before wiring". Three specific dividends:

- **The states outnumber the logic.** `/profile` alone has signed-out, resolving,
  signed-in-verified, signed-in-unverified, plus five sync-row variants. Every one is
  reachable in a mock in seconds and awkward to reach against a real Firebase project.
- **It front-loads the copy.** Most of what makes these screens right is wording — the
  enumeration-protection error string (7-4), the "sync is coming soon" placeholder (7-7),
  the delete dialog's "the copies on this device stay where they are". None of it needs auth
  to write, and all of it is easier to judge on screen than in a plan.
- **It makes the Firebase step small.** By the time 7-1 starts, the only open question is
  whether the SDK calls work — not what happens after they return.

## The seam: `AuthUser` is real, the source is fake

```
   src/auth/types.ts      ← the real contract. Survives into 7-1 unchanged.
   src/auth/useAuth.ts    ← 7a-UI: reads the URL mock. 7-1: swapped for the store.
        │
        └──► every screen and component below imports ONLY from here
```

The rule that makes the swap cheap: **no component may branch on "is this mocked".** They
consume `{ user, status, emailVerified, … }` and render. `useAuth` is the only file that
knows a mock exists, and replacing its body is the whole of the wiring work.

`status` carries the tri-state from 7-2 (`'resolving' | 'signedOut' | 'signedIn'`) even
though a mock resolves instantly — otherwise the loading skeleton never gets built and 7-2
inherits it as a surprise.

## The mock harness

`?mock=` on any route, read once in `useAuth`. Not persisted, not in a store, nothing
rendered in the real UI — the whole mechanism deletes in one commit.

| value | what it renders |
|---|---|
| *(absent)* | signed out — the real default |
| `resolving` | the bootstrap skeleton, held indefinitely so it can actually be looked at |
| `google` | signed in, verified, Google provider |
| `email` | signed in, verified, email provider, both methods linked |
| `unverified` | signed in, email unverified — banner state |
| `syncing` / `offline` / `syncError` / `syncDiscard` | signed in, with that sync-row variant |
| `newUser` | signed in, empty library — the zero state the stats row otherwise never shows |

Library counts come from the **real** `useRecordingsStore` and `useMidiProjectsStore`, not
from the mock. The stats row is genuinely computed local data (7-7 says so), so faking it
would be faking the one part that is already true.

## Files

**New — `src/auth/`**
- `types.ts` — `AuthUser`, `AuthStatus`, `SyncStatus`, `AuthProvider`. The 7-1 contract.
- `useAuth.ts` — mock now, store later.
- `mockStates.ts` — the table above, one object per key. Deleted at 7-1.

**New — `src/components/`**
- `AvatarCircle.tsx` — initials, sized prop. Fill is **`accentDeep`, not `accent`**: the
  theme's own comment says plain `accent` is ~2.2:1 on white and "can't carry white text"
  (`theme/index.ts:8-10`). This is exactly that case.
- `AuthModal.tsx` — one component, four internal states (`chooser`, `signUp`, `signIn`,
  `forgot`) plus a `sent` confirmation panel. Three hosts per 7-8.
- `PasswordField.tsx` — reveal toggle, and a strength meter driven by length only (7-4:
  length beats character-class theatre).
- `VerifyBanner.tsx` — warning banner, "I've confirmed", resend with a visible countdown.
- `SyncStatusRow.tsx` — the five states from 7-7 as a pure presentational component.
- `ConfirmDeleteModal.tsx` — typed-DELETE confirmation.
- `ReauthModal.tsx` — password re-entry. Shared by delete, change-password and change-email
  per 7-4, so it is built once here.

**New — routes**
- `src/app/profile.tsx`
- `src/app/auth/action.tsx` — `/auth/action`, first nested route in the app (every existing
  route is flat in `src/app/`). Renders all four outcomes off a `?mode=` param, matching what
  Firebase will really send: `verifyEmail` success, `resetPassword` form, `recoverEmail`, and
  the expired/already-used state every branch needs.

**Touched**
- `TopBar.web.tsx` — avatar when signed in, "Sign in" text button when signed out, in the
  right-hand group beside `headerActions` (`:44`).
- `settings.tsx` — an Account row linking to `/profile`. **Required, not optional:** `TopBar`
  is `null` on native (`TopBar.tsx`), so without this `/profile` is unreachable there.
- `paywall.tsx` — the 7-6 subscribe step, rendered but inert.
- `_layout.tsx` — nothing, deliberately. The mock resolves synchronously; 7-2 adds the real
  bootstrap gate.

## Reuse, not reinvention

- **`CandidateList` / `CandidateRow`** (`CandidateRow.tsx:20-40`) for the sign-in-methods
  list and the provider chooser — already a wired `radiogroup` with `accessibilityRole`, and
  already the app's answer to "a list of selectable options with a title and a subtitle".
- **Settings' `sectionLabel` + `card` + `cardRow`** language for every `/profile` section, so
  the two per-user screens read as siblings. Only the identity header and the stats row are
  new shapes.
- **`NameRecordingModal`'s shell** (`Modal` + `backdrop` + `card`, `transparent`,
  `animationType="fade"`, `onRequestClose`) for all four new modals.
- **`webMaxWidth(WEB_CONTENT_WIDTH.standard)`** — 720px (`constants/layout.ts:8`) for
  `/profile`, and `.narrow` (480) for `/auth/action`, which is a single-CTA flow exactly like
  the paywall and onboarding it shares that bucket with. **Do not invent a 640.**

## What must not be faked

One rule, and it is the only thing in this slice that could cost a user real work:

**The sync row ships the 7a placeholder — "Sync is coming soon; your tabs are saved on this
device" — and the mock's `synced` variant is for review only.** No build that a user can
reach may show `✓ Synced` while no sync engine exists. A green tick that invites someone to
trust a backup that is not there is worse than no row at all.

The same honesty applies to the plan block (Phase 8) and to every button in this slice: an
inert control must look inert or say what it is waiting for. Nothing here silently no-ops.

## Accessibility, built in rather than retrofitted

Per `project_app_architecture`, the commitment is that new surfaces get this from the start:

- Every modal traps focus, closes on Escape, and returns focus to whatever opened it.
- The provider chooser and sign-in-methods list are radiogroups — free via `CandidateList`.
- Form fields carry real labels, and errors are associated with their field rather than
  floating as loose text.
- The password reveal toggle is a button with state, not an icon.
- Everything reachable and operable by keyboard on web, since the whole slice is web-first.

## Verification

- **Every `?mock=` value, in both themes.** Light and dark are one prop away
  (`useTheme`), so there is no excuse for a state that only works in one.
- **Both `/profile` layouts by width** — 1440 and 720 — since it is a single centred column
  and the failure mode is a stats row that wraps badly.
- **The zero state** (`?mock=newUser`) with an empty library, which is what every real first
  sign-in will actually look like.
- **Keyboard-only pass** through the modal's four states and the delete confirmation.
- **Nothing regresses signed out.** With no `?mock=`, the app must be exactly what it is
  today — that is the same no-regression check 7a's verification section leads with.

## Build order

1. `src/auth/types.ts` + `useAuth.ts` + `mockStates.ts`. Nothing to look at, and everything
   else depends on the shape.
2. `AvatarCircle`, `SyncStatusRow`, `VerifyBanner` — the three presentational pieces.
3. `/profile`, all states. The biggest surface, and the one the design decisions were taken
   for.
4. `AuthModal` + `PasswordField`. Second biggest, and reviewable in isolation before it has
   three hosts.
5. `TopBar` entry + the Settings Account row. `/profile` becomes reachable.
6. `ConfirmDeleteModal` + `ReauthModal`.
7. `/auth/action`.
8. `paywall.tsx`'s subscribe step. Last, because it is the only touched file that a real user
   can already reach.

## 7-1 · Firebase bootstrap, platform-split

`src/lib/firebase.ts` (native, RNFirebase — reads the checked-in `google-services.json`)
and `src/lib/firebase.web.ts` (JS SDK `initializeApp` with an explicit config object).

- Web config values are public by design, but they should still come from
  `app.config.ts`/`expo-constants` rather than being inlined, so staging and production can
  differ. **`app.json` has to become `app.config.ts` for that** — flag it, it is a
  file-format change that touches the build.
- **Set `authDomain` to the app's own custom domain, not `harp2tab.firebaseapp.com`.** This
  matters more than it looks: browsers that partition third-party storage (Safari ITP,
  Firefox ETP, Chrome's third-party-cookie work) break Firebase's redirect sign-in when the
  flow round-trips through a `*.firebaseapp.com` origin. Serving the auth helper from the
  app's own domain via Firebase Hosting's `__/auth` rewrite fixes that class of failure and
  makes the popup show the app's name instead of a Firebase subdomain. The domain purchase
  is already planned in `project_web_version_plan` and needed by 12-3 — **that is a
  scheduling dependency between 12-3 and this phase**, not a nice-to-have.
- Lazy-load the Firestore chunk: nothing signed-out should pay for it. Whether Metro's
  static export produces a separate async chunk under Expo 55 needs checking against
  `https://docs.expo.dev/versions/v55.0.0/` per project convention — if it does not, the
  fallback is to measure the added bundle weight and decide with a real number.

## 7-2 · `useAuthStore` and the tri-state bootstrap

```ts
user: AuthUser | null | 'unknown'   // 'unknown' until the first onAuthChange fires
```

The tri-state is the whole point. Firebase resolves persisted sessions asynchronously, so a
naive `user === null` renders the signed-out UI for a frame or two and then swaps —
returning users watch their account flicker into existence on every load.

`_layout.tsx` subscribes once, next to the existing font gate. It already holds render on
`if (!fontsLoaded) return null` (`_layout.tsx:51`), so the auth bootstrap joins that
condition rather than adding a second gate — but **only for the initial resolution**, and
the splash overlay must not be extended to cover a slow network. Signed-out is the correct
render for a failed resolution, not a spinner.

`AuthUser` carries **`emailVerified`**, and it is not cosmetic — 7-4 gates on it, and it
changes after the user acts *outside the app*, so `onAuthChange` alone will not report it.
See the reload note in 7-4.

Persisted alongside: `lastUid`, `adoptedUids: string[]` (both used by 7-11).

## 7-3 · Google sign-in

`signInWithPopup` on web. Popups are blocked only when not user-gesture-driven, which a
button click is; redirect carries the storage-partitioning problem described in 7-1 and is
the worse default even with the custom domain in place.

**Native (7-14)** — `@react-native-google-signin/google-signin` +
`@react-native-firebase/auth`, and the SHA-1 fingerprint registered in the Firebase project
must be **the Play App Signing certificate's, taken from the Play Console — not the local
upload keystore's** (`project_release_setup` has the keystore). Google sign-in fails only in
release builds when this is wrong, which is the most expensive time to find out.

## 7-4 · Email + password: the whole surface

The decision to take email/password over a magic link buys familiarity and pays for it
here. All of the following is load-bearing; none of it is optional once the method ships.

### The state machine

```
   sign up ──► account exists, emailVerified = false ──► verification email sent
                            │                                      │
              app fully usable, sync withheld              user clicks link
                            │                                      │
                            └──────── verified ◄──────────  /auth/action
                                          │
                                    sync begins
```

**Unverified users are not locked out — sync is what waits.** Firebase happily signs in an
unverified user, so the enforcement point is ours to choose, and the honest one is the thing
the account is *for*. Blocking the app would strand someone whose confirmation email is
slow, at the exact moment they were trying to save a take. Withholding sync costs them
nothing they had a minute ago and makes the reason to verify immediate and legible.

Phase 8 should additionally require verification before purchase — an entitlement attached
to an unverified address is an entitlement attached to nobody.

**`emailVerified` does not update on its own.** The user verifies in another tab or on their
phone; the SDK's cached token still says false. `onAuthChange` will not fire for it. The app
needs an explicit `reload()` of the current user — on window focus, and on a "I've verified"
button in the banner. Skipping this produces the single most common complaint about this
flow: "I verified and it still says I haven't."

### One route handles three actions

Firebase sends verification, password reset and email-change-revocation to **one action
handler URL**, distinguished by a `mode` query parameter. So the app needs exactly one new
auth route, not three:

`/auth/action?mode=verifyEmail|resetPassword|recoverEmail&oobCode=…`

- `verifyEmail` → `applyActionCode`, then a success state with a route back into the app.
- `resetPassword` → `verifyPasswordResetCode` to get the email, show a new-password form,
  `confirmPasswordReset`.
- `recoverEmail` → the "someone changed your email, undo it" path. Cheap to include once the
  route exists; conspicuous if a user ever lands on it and gets a blank screen.
- Every branch needs an expired/already-used state. These links expire, and users click them
  from an inbox days later.

**It must be a real exported route.** With `web.output: "static"` (`app.json:28`) there is no
server to rewrite unknown paths, so a client-only target does not exist as HTML and a cold
load 404s. Add the Firebase Hosting rewrite too.

### Error copy, under email enumeration protection

Firebase now defaults to email enumeration protection **on**, which deliberately collapses
`auth/user-not-found` and `auth/wrong-password` into a single `auth/invalid-credential`.
The UI therefore **cannot** say "no account with that email" or "wrong password" — it does
not know which, by design. Copy has to be "That email and password don't match an account",
with the reset link offered alongside. Write it that way from the start; retrofitting error
copy after someone reports the vagueness as a bug is how the protection gets switched off.

### Password rules

Firebase's floor is 6 characters, which is too low to ship as the product's answer. Enforce
our own client-side minimum (8, with a strength meter, no composition rules — length beats
character-class theatre) and mirror it in the Identity Platform password policy if that is
enabled, so the server agrees with the form.

Also needed: change password and change email, both of which throw
`auth/requires-recent-login` on a stale session — the same re-authentication step 7-13's
deletion needs, so build it once as a shared `reauthenticate()` prompt.

### The confirmation email itself

Firebase's default template sends from `noreply@<project>.firebaseapp.com` with Firebase's
own wording. For a paid product that is a bad first impression and a real deliverability
risk — it is the first email the user ever gets from Harp2Tab, and it arrives looking like
it came from someone else's infrastructure.

- **Launch:** customize the templates in the Firebase console and **verify a custom sender
  domain** (SPF/DKIM DNS records). Free, and it makes the mail come from Harp2Tab.
- **Later, if the emails start mattering to conversion:** generate links with the Admin
  SDK's `generateEmailVerificationLink` / `generatePasswordResetLink` in a Cloud Function and
  send them through a real sender (Resend, Postmark) with the app's own design. Full control,
  costs a service.

**This is the third thing in the phase blocked on the custom domain** (with 7-1's
`authDomain` and 12-3's landing page). It is now the strongest argument for buying the
domain before Phase 7 starts rather than during it.

## 7-5 · Account linking, and the one-account-per-email setting

The profile page offers "+ Add email sign-in" (7-7), which is `linkWithCredential`. The
reverse — someone who signed up with a password later pressing "Continue with Google" on the
same address — is the one that goes wrong on its own.

**Keep Firebase's "one account per email address" setting ON.** With it off, the same human
signing in two ways gets two UIDs, two Firestore subtrees and two libraries, and neither
looks broken from the inside. That is an unrecoverable data-partition bug caused by a console
checkbox, which is exactly the kind that ships.

With it on, the second method throws `auth/account-exists-with-different-credential`, and the
app must handle it rather than surfacing the raw code: tell the user the address is already
registered, sign them in with the original method, then link the new credential. That flow is
a required piece of work, not an edge case.

## 7-6 · The subscribe gate

Per the decision above: no wall on save or export. The only required signup is at payment,
and it lands on a screen that already exists.

**Where it goes.** `src/app/paywall.tsx`, between "I want this" and the purchase call. The
free-tier gate that routes users there is untouched — `resolveSessionGate`
(`sessionGate.ts:15`) keeps returning `'showPaywall'` exactly as it does today, and every
entry point keeps calling it. This phase adds a step *inside* the paywall, not a new gate
around the app.

**The order within the paywall matters.** Sign in *before* the purchase call, never after:
an entitlement that arrives before the identity it belongs to is the reconciliation problem
Phase 8 is already trying to avoid, recreated on purpose. The paywall becomes:

```
   see the plans  →  choose one  →  sign in / create account  →  pay  →  entitlement
                                              │
                                    already signed in? skip
```

**Persist the session first.** Before the paywall opens, snapshot the in-progress take to the
local library. Email signup ends in a confirmation link that may open in a different browser,
and a user who loses their take on the way to paying will not come back. This is the one part
of the abandoned wall's design that carries over intact, and it is a hard requirement.

**Existing users are unaffected.** `isPurchased` is already true for them, so
`resolveSessionGate` returns `'allow'` and they never reach the paywall. Nothing about their
app changes.

### The voluntary door

The other half of the decision, and the one that is easy to under-build because nothing
forces it. Two entry points, both leading to the same modal from 7-8:

- **TopBar avatar** — a "Sign in" text button when signed out (`TopBar.web.tsx:44`'s
  right-hand group).
- **`/profile`'s signed-out state** — the pitch page in 7-7.

Its copy is about sync, not about payment, because that is what a free account actually
gives. And it carries the lifetime buyers' claim path: **"Bought Harp2Tab on Google Play?
Sign in to keep your lifetime access on the web."** That sentence is the entire reason this
door is mandatory rather than optional — see the decision note. The mechanism behind it is
Phase 8's RevenueCat import; the doorway is here.

## 7-7 · `/profile` — the page

**This resolves 12-4's open question**, which asks route-or-Settings-section and recommends
the section. The user chose the route on 2026-08-12, and the choice is better than 12-4's
reasoning assumed: 12-4 judged a route would hold three rows, but with sync status, the
plan block, connected sign-in methods, the verification banner and the danger zone, it holds
six sections — and it gives 12-2's displaced home-sidebar stats the home that section
already says they want.

**The split with Settings follows 7-10's sync rule exactly: `/profile` is what belongs to
the user, Settings is what belongs to the device.** Account, plan, stats and sync go to
`/profile`; mic sensitivity, calibration, theme and engine defaults stay in Settings. That is
the same line the sync engine draws, so there is one rule to remember, not two.

**Entry point:** the avatar in `TopBar.web.tsx`'s right-hand group, beside the existing
`headerActions` slot (`TopBar.web.tsx:44`) — signed out it is a "Sign in" text button.
Native has no persistent bar at all (`TopBar.tsx` returns `null`), so on native `/profile` is
reached from Settings; that asymmetry is already how the app works, not a new one.

### Signed in, verified

```
 ┌──────────────────────────────────────────────────────┐
 │  ◐   Theo Gaspe                                      │
 │      theodorogtc@gmail.com · Google                  │
 │      Member since August 2026                        │
 │                                     [ Sign out ]     │
 ├──────────────────────────────────────────────────────┤
 │  47 tabs   ·   6 projects   ·   3h 12m of playing    │
 │  ✓ Synced 2 minutes ago                [ Sync now ]  │
 ├──────────────────────────────────────────────────────┤
 │  PLAN                                                │
 │  Free — 3 of 3 sessions used                         │
 │                                     [ Upgrade ]      │
 ├──────────────────────────────────────────────────────┤
 │  SIGN-IN METHODS                                     │
 │  ✓ Google          theodorogtc@gmail.com             │
 │  + Add email and password                            │
 ├──────────────────────────────────────────────────────┤
 │  Export all my tabs                                  │
 │  Delete account                                      │
 └──────────────────────────────────────────────────────┘
```

- **Stats are computed locally** from `useRecordingsStore` and `useMidiProjectsStore` — no
  query, no aggregation document, no loading state. "Playing time" is the sum of
  `TabRecording.duration`, which already exists on every record.
- **The plan block is a placeholder until Phase 8** and should say so honestly rather than
  render a fake subscription. Until then it reads from local `isPurchased` and links to the
  existing `/paywall`.
- **So is the sync row, until 7b.** In 7a it reads `Sync is coming soon — your tabs are saved
  on this device`, which is true, rather than a green tick that means nothing. A fake
  `✓ Synced` on a build with no sync engine is the one thing on this page that could cost a
  user real work, because it invites them to trust a backup that does not exist.
- **Sign-in methods is a list, not a static row** — it is what makes 7-5's linking reachable.

### Signed in, not yet verified

```
 ┌──────────────────────────────────────────────────────┐
 │  ⚠  Confirm your email to turn on sync               │
 │     We sent a link to theo@example.com.              │
 │     [ Resend email ]   [ I've confirmed ]            │
 ├──────────────────────────────────────────────────────┤
 │  ◐   theo@example.com · Email                        │
 │      Member since August 2026        [ Sign out ]    │
 ├──────────────────────────────────────────────────────┤
 │  47 tabs  ·  6 projects  ·  Sync paused until        │
 │                            you confirm your email    │
 └──────────────────────────────────────────────────────┘
```

`[ I've confirmed ]` is the explicit `reload()` from 7-4. Resend needs a visible cooldown —
Firebase rate-limits these and will start failing, and a button that silently stops working
is worse than one that says "wait 60 seconds".

### Signed out

`/profile` is a real URL people will reach signed out — bookmarks, the avatar button, a
shared link. It must be a pitch, not an error:

```
 ┌──────────────────────────────────────────────────────┐
 │              Your tabs, everywhere                   │
 │                                                      │
 │   Create a free account to keep your tabs and open   │
 │   them on any device you play on.                    │
 │                                                      │
 │        [ Continue with Google ]                      │
 │        [ Sign up with email   ]                      │
 │          Already have an account?  Sign in           │
 │                                                      │
 │   You have 14 tabs and 2 projects on this device.    │
 │   They'll come with you.                             │
 └──────────────────────────────────────────────────────┘
```

The last two lines are 7-11's adoption promise, stated with the real local counts *before*
sign-in. It is the only honest place to say it, because afterwards it has already happened.

### Sync row states

One line, five states, never a dashboard:

| state | copy |
|---|---|
| idle | `✓ Synced 2 minutes ago` |
| syncing | `⟳ Syncing…` |
| offline | `⚡ Offline — 3 changes waiting` |
| error | `⚠ Sync failed — Retry` |
| LWW discard | `Replaced this device's copy of "Blues in G" with a newer version from 11:42.` |

The last one earns its place: the failure mode of silent last-write-wins is a user who
believes the app ate their edit. Naming it turns a data-loss bug report into understood
behaviour.

### Delete account

A typed confirmation, and it must state what is *not* deleted:

```
 ╔════════════════════════════════════════════════════╗
 ║  Delete your account?                              ║
 ║                                                    ║
 ║  This permanently deletes your account and the 47  ║
 ║  tabs and 6 projects synced to it. It cannot be    ║
 ║  undone.                                           ║
 ║                                                    ║
 ║  The copies on this device stay where they are.    ║
 ║  Export them first if you want them elsewhere.     ║
 ║                                                    ║
 ║  Type DELETE to confirm:  [            ]           ║
 ║                                                    ║
 ║  [ Cancel ]                    [ Delete account ]  ║
 ╚════════════════════════════════════════════════════╝
```

## 7-8 · The sign-in modal

One component, three hosts — the subscribe gate (7-6), the profile page signed-out state
(7-7), and the TopBar button. The `ConvertTrackModal` precedent from Phase 11 applies: a bounded
decision belongs in a modal, and being a modal is what lets three surfaces share it.

It has four internal states — `chooser`, `signUpEmail`, `signInEmail`, `forgotPassword` —
and they are states of one modal, not four routes. Only `/auth/action` is a route, because
only it is arrived at from outside the app.

```
  ╔══════════════════════════════════════════════╗
  ║  Create your account                    [×]  ║
  ║                                              ║
  ║  ┌────────────────────────────────────────┐  ║
  ║  │  Continue with Google                  │  ║
  ║  └────────────────────────────────────────┘  ║
  ║  ────────────────  or  ───────────────────   ║
  ║  Email                                       ║
  ║  ┌────────────────────────────────────────┐  ║
  ║  │  you@example.com                       │  ║
  ║  └────────────────────────────────────────┘  ║
  ║  Password                                    ║
  ║  ┌────────────────────────────────────────┐  ║
  ║  │  ••••••••                          👁  │  ║
  ║  └────────────────────────────────────────┘  ║
  ║  ▪▪▪▪▪▪░░░░  Strong enough                   ║
  ║                                              ║
  ║  ┌────────────────────────────────────────┐  ║
  ║  │  Create account                        │  ║
  ║  └────────────────────────────────────────┘  ║
  ║                                              ║
  ║  Already have an account?  Sign in           ║
  ╚══════════════════════════════════════════════╝
```

- **The provider column takes a third button without redesign** — that is the Phase 9 Apple
  obligation, prepaid.
- The post-submit state is not a spinner and then a dismissal. It is a "check your inbox"
  panel naming the address, because the next thing the user must do happens in another app.
- Dismissing is always allowed, from every host including the subscribe gate — backing out
  of the gate returns to the paywall, which is itself dismissible today. Nothing in this
  phase makes any screen inescapable.

## 7-9 · Schema: `updatedAt` and `deletedAt` — 7a, though only 7b consumes it

`TabRecording` has `createdAt` and no `updatedAt` (`types/index.ts:82-94`) — there is no
field to conflict-resolve on. `MidiProject` already has one, stamped centrally by `touch()`
(`useMidiProjectsStore.ts:36-42`), which is the pattern to copy rather than asking every
call site to remember.

- Add `updatedAt: number` to `TabRecording`, stamped inside `saveRecording`,
  `renameRecording` and `toggleFavorite` in `useRecordingsStore.ts` — all three mutate, all
  three currently leave the record's timestamps alone.
- **Schema v3 in `recordingsMigration.ts`**, seeding `updatedAt` from `createdAt`. Cheap,
  and the harness can drive it because the migration is already a pure function
  (`recordingsMigration.ts:1-8` says why it was split out).
- Do *not* add `deletedAt` to the record — deletion removes it locally; the tombstone lives
  in its own collection.
- **`favorite` and the two filter lenses (`noiseGate`, `durationFloorMs`) sync with the
  document.** They are per-user state, not per-device, and the type comments already treat
  them as part of the record.

## 7-10 · The sync engine — **7b, after Phase 8**

```
src/sync/
  types.ts          — wire shape, tombstones, SyncStatus
  merge.ts          — pure: (local[], remote[], tombstones[]) → { toApply, toPush, toDelete }
  syncEngine.ts     — orchestration; the only file that awaits the network
  useSyncStore.ts   — status: 'idle' | 'syncing' | 'offline' | 'error', lastSyncedAt, lastError
```

**`merge.ts` is pure and is the harness target.** Same reasoning as `recordingsMigration.ts`
and `convertTrack.ts`: a merge that only runs inside a live store against a real Firestore is
a merge nobody can test before it ships, and this is the one module in the phase where a
silent bug destroys user data.

Per document id:

| local | remote | tombstone | result |
|---|---|---|---|
| present | absent | none | push |
| absent | present | none | apply |
| present | present | none | higher `updatedAt` wins, whole document |
| present | present | tie | remote wins — deterministic, and in practice a re-push of identical content |
| present | any | newer than doc | delete locally |
| absent | present | older than doc | remote was re-created after the delete; apply |

**When it runs:** on sign-in, on app foreground/load, after a local write (debounced ~2s),
and on an explicit "Sync now". Not a live Firestore listener — a listener means the cloud can
change the library out from under an open editor, which is exactly the "no screen reads
Firestore" rule broken by the back door.

**And only when `emailVerified`** (7-4). The engine's entry condition is a signed-in *and*
verified user; everyone else is `offline`-equivalent and keeps writing locally. Putting the
check here, at the single entry point, is what keeps the verification decision from
scattering into every call site — and it is why withholding sync costs nothing to implement
while blocking the app would have cost a gate on every screen.

**Offline:** local writes always succeed; the push is retried on the next trigger. No queue
of operations is needed because the unit is the whole document and LWW makes a replayed push
idempotent — that is a real dividend of the LWW choice, worth stating so nobody builds the
queue.

**Reading local state:** the engine reads and writes through the stores' own actions
(`saveRecording`, `deleteRecording`, `saveProject`), never by patching persisted storage
underneath them. Patching storage directly leaves the in-memory store stale until reload,
which on web is "my tabs came back after I refreshed".

**Settings are a special case — sync a subset, not the object.** `micSensitivity` and
`hasCalibratedMic` (12-5) are properties of a *device's microphone*, not of a user; syncing
them means a laptop inheriting a phone's calibration. Sync `themeOverride`,
`defaultAlgorithm`, `transcriptionParams`, `maxTakeMinutes`; leave the mic and onboarding
flags local. `isPurchased` and `totalRecordingsUsed` are governed by the entitlement
decision above, not by this list.

## 7-11 · First sign-in: adopt, never replace — and the second-account trap — **7b, after Phase 8**

The obvious case is easy: user has a local library, signs in, cloud is empty → upload
everything. Ids are `rec-${Date.now()}-${random}` (`sessionSnapshot.ts:38`), so cross-device
collision is not a realistic risk and the union is safe.

**The case that corrupts data is the second account on the same device.** Sign in as A
(local library adopted into A), sign out, sign in as B — a naive adoption pushes A's entire
library into B's account. On a shared laptop that is a privacy incident, not a bug.

The rule, using `lastUid` / `adoptedUids` from 7-2:

- Local library has never been adopted by anyone, and `uid === lastUid` or `lastUid` is
  unset → **adopt** (union into the cloud).
- `uid !== lastUid` and there are local documents not already adopted into *this* uid →
  **do not adopt.** Ask, once, with counts: keep this device's N tabs as B's, or clear the
  device and pull B's library. Default to clearing.
- Signing out leaves the local library in place — it is the signed-out library, and wiping
  it on sign-out would delete work from anyone who signed in to look and signed back out.

## 7-12 · Firestore security rules

```
/users/{uid}/tabs/{id}          read, write: request.auth.uid == uid
/users/{uid}/projects/{id}      read, write: request.auth.uid == uid
/users/{uid}/settings/current   read, write: request.auth.uid == uid
/users/{uid}/deleted/{id}       read, write: request.auth.uid == uid
/entitlements/{uid}             read: request.auth.uid == uid; write: never (server only)
```

**Entitlement lives at the top level, deliberately not under `/users/{uid}/`.** Firestore
rules are permissive-union: if any matching rule allows an operation, it is allowed. A
`match /users/{uid}/{document=**}` that grants write would grant write to an entitlement
document nested beneath it *no matter what a more specific rule says* — a
`allow write: if false` underneath it does nothing. Keeping the paths disjoint is what makes
the deny real. This is the single most commonly botched rule in this shape, and it is a
paywall bypass if it is wrong.

**If any rule gates on verification, it must not use `email_verified` alone** — found while
testing 7-5 on 2026-08-13. Firebase clears `emailVerified` when an email/password credential
is linked to an account, *including a Google account where the address was already verified*,
and sends no confirmation email when it does. The app therefore treats a Google identity as a
confirmed address regardless of the flag (`auth.web.ts`'s `toAuthUser`, decided by the user
the same day). A rule written as `request.auth.token.email_verified == true` would reject
exactly those users, producing a UI that says confirmed beside a backend that refuses to
sync. The rule has to read:

```
request.auth.token.email_verified == true
  || 'google.com' in request.auth.token.firebase.identities
```

Rules get their own test run (`@firebase/rules-unit-testing` against the emulator), because
"nobody else can read my tabs" is not a property that should be verified by inspection —
and the case above deserves a test of its own, since it is invisible to inspection twice
over.

## 7-13 · Account deletion and data export

- **In-app:** Settings → Delete account, with a typed confirmation. Deletes the Firestore
  subtree, the entitlement document, and the Auth user.
- The client cannot reliably delete a subtree, so a Cloud Function does it — triggered by a
  callable, or by the Auth `onDelete` trigger with the client calling `deleteUser()`.
- **Handle `auth/requires-recent-login`.** Firebase refuses deletion on a stale session, so
  the flow needs a re-authenticate step or it fails for exactly the users most likely to be
  deleting (long-dormant ones).
- **Local data is not deleted with the account** — the tabs on the device are the user's
  work and predate the account. Say so in the confirmation.
- ~~**A publicly reachable deletion URL** on the marketing site (12-3), declared in the Play
  Console Data safety form.~~ **Deferred to Phase 15 (15-A) by the user, 2026-08-13** — it is
  a Play requirement, and Play has no accounts until native does.
- **Data export** — GDPR-adjacent and nearly free here, since export already exists: a
  "download all my tabs" action reusing `src/export/generators.ts` over the whole library.
  Include it; it is a paragraph of code and it closes the request that otherwise arrives by
  email.
- **`PRIVACY_POLICY.md` update** — **done 2026-08-13.** Accounts, Firebase Authentication as
  a processor, self-service deletion and export under GDPR, and an explicit statement that the
  Android app has no accounts.
- ~~**The Play Data safety re-declaration**~~ — **deferred to Phase 15 (15-A).** It describes
  the Android app, which collects no account data (`isFirebaseConfigured()` is `false` on
  native), so there is nothing yet to declare. It becomes a blocker the moment 7-14 ships, and
  15-A says so.

## 7-14 · Native parity — **deferred to Phase 15**

**Not scheduled here.** Whether native gets accounts at all is one of the questions Phase 15
holds; building the native auth half before that is decided is porting by default.

What it would take, recorded so the estimate exists when the decision is taken:
`@react-native-firebase/auth` + `@react-native-google-signin/google-signin`, the Play App
Signing SHA-1 from 7-3, and the `@react-native-firebase/app` config plugin question from the
existing-state section. The sync engine, `merge.ts`, the stores and every screen are shared
and unchanged — the only native-specific code is `src/lib/auth.ts` and the native project
config. That is the payoff for the platform-split seam, and it is why this is cheap to defer:
deferring it costs nothing that has to be redone.

## What Phase 7 does not do

Payments and entitlement *writing* (Phase 8) · **the sync engine itself, which is 7b and
follows Phase 8** · Sign in with Apple (Phase 9, where it becomes mandatory) ·
email-link/passwordless sign-in (superseded) · Facebook, GitHub, Microsoft, phone and
anonymous auth · **any gate on save or export** (dropped 2026-08-12 — signed-out users keep
every capability they have today) · sharing, public tab links or collaboration (not on the
roadmap) · realtime multi-device editing (LWW is the decision) · syncing `frames` (decided
above) · server-side free-tier enforcement (moot — the free tier is per-device because there
is no account until payment).

## Verification

- **`scripts/verify-sync.ts`** — the harness, following `verify-midi-studio.ts` /
  `verify-audio-import.ts`. Drives `merge.ts` with hand-authored device states: clean push,
  clean pull, both-edited conflict both directions, tie, delete-then-sync, delete-then-
  recreate, tombstone expiry, empty cloud, empty local, second-account refusal. No network,
  no emulator — it is a pure function.
- **The no-regression check, which is now the cheapest and most important one:** signed out,
  every existing capability still works — record, edit, save to library, export, share. The
  subscribe-gate decision means the correct diff for a signed-out user is *nothing*, and that
  is easy to verify and easy to break accidentally.
- **Rules tests** against the emulator: another user's uid cannot read `/users/{uid}/tabs`,
  and no client can write `/entitlements/{uid}`.
- **Two-browser manual pass:** sign in on both, edit in one, foreground the other, confirm
  the merge and the status line. Then the same with one browser offline (DevTools) to
  confirm local writes survive and push on reconnect.
- **The email round trip, on a real inbox, twice** — once opening the confirmation link in
  the same browser, once in a different one. The second is where `/auth/action` and the
  `reload()` from 7-4 either work or produce "I verified and it still says I haven't".
- **The subscribe-gate survival test:** exhaust the free tier signed out, reach the paywall,
  sign up with email, open the confirmation link in a *different browser*, come back. The
  take must still be there. This is 7-6's hard requirement and it has no unit test.
- **The flicker check:** hard-reload signed in and confirm `/profile` and the TopBar avatar
  never render their signed-out state first. This is the bug the tri-state exists to
  prevent, so it needs an actual look.
- **Size check:** after syncing a 3,000-note recording, read the document's actual stored
  size and confirm the opaque-payload decision held.

## Suggested build order

### 7a-UI — every screen, mock state, no Firebase (first)

0. **The whole of `7a-UI` above**, in its own build order. Ends with all of 7a's UI
   reviewable at `?mock=` URLs and nothing wired. Chosen as the first slice by the user on
   2026-08-12.

### 7a — accounts (now)

1. **7-9 schema + v3 migration.** The only step that touches persisted user data, and 7b
   cannot reconcile anything without `updatedAt`. First, so it soaks for an entire phase
   before anything depends on it being right.
2. **7-1 / 7-2 bootstrap + `useAuthStore`,** web only. Ends with a UID in the console.
3. **7-3 Google + 7-8 the modal.** The short path to a real sign-in, and the one that proves
   the platform seam before the email surface is built on top of it.
4. **7-12 rules,** before the first real write — including the entitlement read path.
   Writing under permissive rules and tightening later means a window where the emulator and
   production disagree.
5. **7-4 email/password + 7-5 linking.** Deliberately after Google: it is the largest single
   sub-step, and everything before it works without it.
6. **7-7 `/profile`.** By now it has real states to render rather than mockups to guess at.
   Its sync row ships as a placeholder until 7b, and should say so rather than lie.
7. **7-13 deletion, privacy policy, Data safety.** The moment accounts exist, these are
   obligations. Before any of this reaches a Play build.
8. **7-6 the subscribe gate + the voluntary door.** Last of 7a, because it is the step that
   sends people into the account flow — it should land when that flow is finished and worth
   arriving at.

### 7b — sync (after Phase 8)

9. **7-10 `merge.ts` + `verify-sync.ts`, with no network at all.** The riskiest logic in the
   roadmap, built where it is cheapest to get wrong.
10. **7-10 orchestration + 7-11 adoption.** First actual sync, against accounts that by now
    really exist.
11. **7-7's sync row and LWW disclosure**, replacing the 7a placeholder.

### Then

12. **7-14 native.**

## Open questions

1. ~~**Custom domain timing — the phase's biggest scheduling risk.**~~ **Closed by user
   decision, 2026-08-13: the domain is deferred, and everything else gets built first.**
   This reverses the recommendation that stood here (buy before the phase starts). Three
   things still need it — 7-1's `authDomain`, 7-4's email sender domain, and 12-3's landing
   page — but they become a single fix-up pass after the purchase rather than a gate on
   starting. The tree is marked for that pass: **`grep -rn "TODO(domain)" src/`**, with the
   canonical explanation in `src/auth/useAuth.ts`.

   What the deferral costs, accepted knowingly: sign-in must stay on `signInWithPopup` (7-3's
   choice anyway — redirect through `*.firebaseapp.com` is the combination that storage
   partitioning actually breaks); the eventual switch invalidates in-flight links and may
   force re-verification, **so real signups stay off this build until the domain lands** —
   dev and internal testing only; and deliverability measured against the default sender says
   nothing about the branded one.
2. **Firestore or Realtime Database.** Firestore is assumed throughout (better rules, better
   querying). RTDB is a smaller web bundle and this sync model is a flat key-value mirror
   that would fit it. Worth a bundle measurement in 7-1 before committing — and 7b's deferral
   means there is time to make the measurement properly.
3. **Settings sync subset** — is the device/user split in 7-10 right, specifically
   `defaultAlgorithm` and `transcriptionParams`? They are arguably tuned against a particular
   microphone.
4. **Does `/profile` ship on native at all?** ~~Open here~~ — **moved to Phase 15**, which
   holds every native-scope question in one place. It is a genuine question rather than a
   default: native is where the paying users currently are, but the subscribe gate only
   fires at purchase, which on Android already goes through Play Billing.

**Closed by the 2026-08-12 decisions:** whether the free tier attaches to the account (no —
there is no account until payment, so `totalRecordingsUsed` stays per-device); and whether
the wall applies to native (there is no wall).

## Phase 8 — Better monetization + remaining web billing
- RevenueCat + Stripe integration per the already-locked pricing/architecture decisions (see `project_web_version_plan` memory).
- **Plan it against 7a done and 7b not** (see the 2026-08-12 staging decision in Phase 7). The account exists by then, `/profile` has a plan block waiting for real data, `/entitlements/{uid}` exists with its read path and rules, and 7-6 already routes users into sign-in *before* the purchase call — so Phase 8 supplies the entitlement **writer**, not the identity. The sync engine (7b) follows Phase 8, not the other way round.
- **The lifetime buyers' claim path is a Phase 8 mechanism behind a Phase 7 door.** 7-6's voluntary sign-in carries the copy ("Bought Harp2Tab on Google Play? Sign in to keep your lifetime access on the web"); this phase makes it true.
- **Joint Phase 7/8 deliverable, not solely Phase 8's**: grandfathering existing `react-native-iap` Play Store lifetime buyers is an identity-linking problem — an existing anonymous Android purchaser has no Firebase UID until their first login. Needs an explicit reconciliation step (RevenueCat's Play-Store-purchase import tied to first sign-in, or a manual backfill), not something that falls out of the RevenueCat SDK integration by itself. **Settled 2026-08-13: there is exactly one existing buyer, known personally, so this is a manual grant — see 8-7.**

---

# Phase 8 — Detailed implementation plan (written 2026-08-13)

Expands the summary above against the code as it stands after 7a. **Five decisions were taken
by the user on 2026-08-13** and are settled below: Stripe Managed Payments behind RevenueCat,
making **Stripe the merchant of record**; the July prices stand, lifetime included; **web
only** — Android is untouched; **grandfathering is manual**, because there is exactly one
existing buyer; and the free tier does not change.

Two of those delete work the summary above assumed was necessary. One finding in the shipped
code adds work nothing had planned for.

## What the July decision has to be re-read as

"RevenueCat + Stripe" was locked on 2026-07-29 (`project_web_version_plan`). That phrase has
since split into three different products, and they differ in the one thing that matters:
**who is legally the seller** — whose name is on the receipt, and who owes each buyer's
government their sales tax. Digital goods are taxed where the buyer is, not where the seller
is, which is what makes this a decision rather than a checkbox.

| route | seller of record | $3.49/mo | $27.99/yr | $44.99 lifetime |
|---|---|---|---|---|
| RC Billing on our own Stripe + Stripe Tax | **us** | 12.7% | 5.0% | 4.6% |
| **Stripe Billing + Stripe Managed Payments** | **Stripe** | 15.0% | 8.5% | 8.1% |
| Paddle Billing | Paddle | 20.3% | 7.8% | 7.1% |

Stripe is 2.9% + $0.30; Managed Payments adds 3.5% **stacked on top of that**, not as a
replacement rate; Paddle is 5% + $0.50, which is why it is worst on a small monthly charge and
competitive on the annual one. RevenueCat's 1% is included throughout, though it only applies
above $2,500/month tracked revenue.

**RevenueCat is not one of the three.** It is the entitlement layer — it remembers who paid
for what across web/Play/App Store and tells the app. It never touches the money. That part
was never in question and stays in every option; the table is only about what sits underneath.

### What self-MoR would actually cost a **Belgian** seller

*Corrected 2026-08-13, after the seller's country was established. The first version of this
section said the EU sets no registration threshold, which is true for a **non-EU** seller and
false for this one. The decision below survives the correction; its reasoning changes.*

| where the buyer is | obligation as a Belgian seller | bites at |
|---|---|---|
| Belgium | small-business exemption ("franchise") up to **€25,000** turnover — no VAT charged, no returns, no input VAT reclaimed. Approved to rise to €30,000, pending legislation | €25k |
| Rest of EU | below **€10,000/yr** of cross-border B2C sales, charge Belgian VAT (21%) and report at home. Above it, each buyer's national rate and an **OSS** registration — one registration and a quarterly return, not 27 | €10k |
| **UK** | **nil threshold.** A non-UK-established seller of digital services to UK consumers registers from the **first B2C sale**, at 20% | **sale #1** |
| Norway / Australia / Canada / Switzerland | NOK 50k / A$75k / C$30k / CHF 100k | far away |
| US | state economic nexus, typically $100k or 200 transactions per state | far away |

So the honest version: **the EU is not the problem at this revenue — the UK is.** An
English-language harmonica app sells to the UK on day one, and that is a registration and four
returns a year from the first £3 charge. Everything else is comfortably over the horizon until
the product works.

### Decision: Stripe is the merchant of record — reasoning, restated

At €10,000/year of revenue, 3.5 points is about **€350/year**. A UK VAT registration and its
quarterly returns cost more than that in accountant time alone, before the EU threshold is
ever approached — and crossing €10k EU-wide is a thing that happens on a good month, not a
scheduled event you prepare for.

**The counterfactual, stated so it is not pretended away:** if this sold only to Belgium and
the EU and stayed under €10k, self-MoR would be cheaper *and* fully legal. That is not the
product being built.

**MoR is not zero Belgian paperwork.** With Stripe as seller, the payout is an intra-EU B2B
supply from a Belgian business to a Stripe entity in Ireland — reverse-charge, with its own
declaration, and possibly incompatible with staying inside the franchise scheme. **This is the
one question in the phase worth an accountant's hour**, and it is a bookkeeping question, not
a blocker on any of the work below.

This is also the one decision in the phase that is expensive to reverse — **but only after the
first real charge.** Changing merchant of record with live subscribers means migrating them
between processors, and card details do not move: real customers get asked to re-enter payment
or their subscription lapses. **Before the first real charge it costs a product re-import and
nothing else**, because RevenueCat's Web SDK is the same API over RC Billing, Stripe Billing
and Paddle alike. The billing engine is a dashboard configuration, not an architecture, and no
client code in this phase knows which one is underneath.

That is what makes the staging below possible, and it is the reason this decision does not
have to be *acted on* before the code that depends on it exists.

**Two consequences that are not obvious and are now locked in:**

- **Products live in Stripe Billing, not RevenueCat Billing.** Managed Payments is not offered
  through RC's own billing engine. RC imports the Stripe products and sells them through the
  Web SDK; the setup is a few steps longer and the client code is identical.
- **No free trials, no coupons, no promo codes — ever, on this path.** RC's Stripe Billing
  integration does not support them, and only flat-rate pricing is supported. The 3-session
  free tier is the trial and always was, so the trial is not the loss; **launch discounts,
  "50% off the first year" and influencer codes are.** Recorded as a knowing trade, because it
  will be noticed later as an absence rather than a decision.

### The prices stand: $3.49 / $27.99 / $44.99, lifetime still sold on web

Confirmed against the fee table rather than re-derived. What the table adds is one number
worth having in front of the paywall design: **monthly nets $2.97 of $3.49, annual nets
$25.90 of $27.99.** Fixed per-transaction cost is what does it — 15% on the monthly charge
against 8.5% on the annual one, for the same customer.

That does not make monthly wrong; it makes monthly a conversion instrument rather than a
revenue one. Which plan the paywall pre-selects is therefore a deliberate choice (annual), not
a layout accident.

### Web only — Android is not touched by this phase

Android keeps `react-native-iap` and its one-time `harp2tab_premium` SKU; native entitlement
stays the local `isPurchased` flag exactly as it works in production today. No
`react-native-purchases` migration, no Play subscription SKUs, no native release in this
phase. Consistent with `feedback_web_first_no_mobile_hedging`, and native billing stays a
Phase 15 question.

The platform seam already makes this free: `useIAP.web.ts` is the only file that changes,
`useIAP.ts` is untouched, and that is precisely what the seam was built for.

### Grandfathering is a conversation, not a mechanism

**There is one existing Play Store lifetime buyer, and the user knows him personally.** That
single fact deletes a sub-project: no order-ID claim form, no Play Developer Orders API
integration, no server-side receipt import, no `react-native-purchases` on Android, no
first-sign-in reconciliation hook. The grant is made by hand in the RevenueCat dashboard once
he signs in on web (8-7).

**What survives is the promise, not the machinery.** 7-6's voluntary door carries the copy
"Bought Harp2Tab on Google Play? Sign in to keep your lifetime access on the web"
(`profile.tsx:302` and the sign-in modal). That sentence is the reason the voluntary door is
mandatory at all, and it stays — backed by a support address and a written runbook rather than
by code. Deleting it because there is currently only one buyer would remove the door's
justification along with its cost.

### The free tier does not change

Three sessions per device, counted in local storage, trivially resettable — unchanged from
Phase 7's decision, which parked "revisit with Phase 8" and is hereby revisited and left
alone. Server-enforcing it still costs a Cloud Function on every session start, and the free
tier's job is to demonstrate the app, not to defend a boundary.

## The staging: 8a / 8b / 8c — and where money actually enters

**User decision, 2026-08-13**, on the same reasoning as 7a-UI: build everything that does not
require a commitment first, and let the commitment land against finished code. The phase
splits three ways, and **only the third one costs anything or is hard to undo.**

| | contents | what it commits |
|---|---|---|
| **8a — no money anywhere** | 8-3 revocable entitlement · 8-2 the writer, on the emulator · 8-5 the three-plan paywall on mock offerings · 8-6 `/profile` · `verify-entitlement.ts` | **nothing.** No accounts, no cards, no vendor. Firebase emulator only |
| **8b — test mode** | 8-1 setup · 8-4 the Web SDK · real purchases with Stripe test cards · the real webhook round trip | **nothing.** A Stripe account with no business details and no bank account can *only* do test mode |
| **8c — go live** | Stripe activation · Managed Payments on · the domain · 8-9 legal pages · Blaze · 8-8 the free-tier flip | identity, a Belgian bank account, the MoR decision, and the domain |

**8a is most of the phase's code and none of its risk.** The largest single change — making
`isPurchased` revocable, below — has nothing to do with who processes payments; it would be
identical under Paddle, under RC Billing, or under a hand-rolled Stripe integration. It is
driven entirely by entitlement documents, which can be written by hand into the Firestore
emulator. The paywall's three-plan layout is the same work whether the prices come from Stripe
or from a mock, and `src/auth/mockStates.ts` already set the pattern for exactly this during
7a-UI.

**8b costs nothing either, and this is the part that is easy to disbelieve.** A Stripe account
created today, with no legal name, no tax details and no bank account, runs in test mode
immediately — and RevenueCat automatically routes sandbox purchases to Stripe's test mode. An
un-activated Stripe account is *incapable* of taking a real payment, which makes it the safest
possible place to build a purchase flow. Test card `4242 4242 4242 4242` produces a real
purchase, a real webhook, and a real entitlement document.

So **8b is also where 8-1.6 gets answered for free**: whether the $44.99 lifetime sells through
Stripe Billing is a test-mode purchase, not a commitment.

**Managed Payments is switched on in 8c, not 8b.** It requires an activated account, and it
changes nothing in the code — which is the whole point of the paragraph above. Everything is
built and proven against plain Stripe Billing test mode first; the merchant-of-record decision
is executed as a dashboard setting at the end, against a purchase flow that already works.

## The finding that reshapes the code: `isPurchased` is a one-way latch

```ts
setPurchased: () => set({ isPurchased: true }),   // useSettingsStore.ts:83
```

There is no `setUnpurchased`, and nothing anywhere sets it back to `false`. That is exactly
right for a one-time Play unlock — a lifetime purchase never stops being true — and it is
wrong for everything this phase sells. **Subscriptions lapse, cards fail, people cancel, and
refunds happen.** Under Phase 8, paid access becomes a value with an expiry that can go from
true to false while the user does nothing on this device.

Nothing in the roadmap had planned for that, and it is the largest code change in the phase.
The model:

```
  precedence, highest first
  1. RC Web SDK customerInfo    live truth on web, requires network, authoritative at purchase
  2. /entitlements/{uid}        the cross-platform mirror — 7a's reader, 8-2's writer
  3. local cached entitlement   survives offline and cold start, carries its own expiry
  4. legacy local isPurchased   native's Play unlock. true means lifetime, forever, unrevoked
```

Rules that fall out of it, each one a bug if missed:

- **`resolveSessionGate` does not change.** It takes a boolean (`sessionGate.ts:15-27`); the
  boolean simply stops being a latch. No entry point, no screen and no gate call site moves.
- **Never revoke on a network error.** "Could not find out" and "definitely not paid" are
  different answers, and `entitlement.web.ts` already documents that distinction. Conflating
  them shows the paywall to a paying customer over a dropped connection.
- **Grace, not a cliff.** A cached subscription is honoured until `expiresAt` plus a 3-day
  grace, which covers Stripe's billing retries. `BILLING_ISSUE` is not expiry.
- **Sign-out clears the cached entitlement — and must not touch `isPurchased`.** They are two
  different flags with two different owners: one belongs to the account, one to the device's
  Play purchase. Merging them either strips the native buyer on sign-out or leaves a
  signed-out browser permanently premium. Both directions have shipped in other apps.

## 8-1 · Accounts, products, and the setup that is not code

Sequential; each step blocks the next.

1. **Confirm Stripe Managed Payments eligibility for a Belgian account, before anything
   else.** It is a rollout product built from Stripe's Lemon Squeezy acquisition and is not
   universally available. Stripe's own availability list appears to include Belgium, but that
   was read off a marketing page and **is not confirmation** — confirm it in the dashboard
   during onboarding, as step one. If it is unavailable, the fallback is **Paddle**: the
   decision is re-taken between MoR providers, *not* silently downgraded to self-MoR, because
   self-MoR carries the UK obligation from the first sale either way.
2. Stripe account (Belgium) + business identity verification — a sole trader with a KBO/BCE
   number is sufficient; this does not require a company. Create three flat-rate
   products/prices.
3. Install RevenueCat's app from the Stripe Marketplace; create the Stripe configuration in
   RC; import the products into RC's product catalog; group them into one Offering.
4. **One entitlement identifier — `premium` — granted by all three products.** One identifier
   is what keeps the client from ever branching on a product id, which is how paywall bypasses
   and "the annual plan doesn't unlock export" bugs happen.
5. Register payment domains so Apple Pay / Google Pay appear in checkout.
6. **Verify that the one-time lifetime product actually sells through this path.** RC Billing
   documents one-time purchase support; the Stripe Billing integration documents that *repeat
   consumable* purchases are unavailable, which implies a non-consumable one-time product is
   fine but does not say so. **Resolve with a test-mode purchase before the paywall is built
   around three plans.** Fallbacks in order of preference: keep lifetime as a Stripe one-time
   price if it imports; otherwise drop lifetime from the web paywall and leave it a legacy
   grant; otherwise run lifetime alone through RC Billing and accept being MoR for that one
   product — the worst option, and a conscious choice if it happens, not a default.
7. **`TODO(domain)` — the fourth thing blocked on the custom domain.** Stripe's onboarding
   wants a public business URL describing the product, its prices, a refund policy and a
   contact. This does not reverse the 2026-08-13 deferral: everything in this phase can be
   built and tested in Stripe test mode against nothing, and the domain gates **go-live**, not
   the build. Add it to the fix-up checklist (`grep -rn "TODO(domain)" src/`).

### The database is real, and it is in the US

*Recorded 2026-08-13. Established by asking, after 8a-1 became the first code in the app that
actually calls Firestore — 7a's reader existed but was deliberately unwired, so until then the
question had never come up in practice.*

- **The Firestore database exists and `firestore.rules` is deployed to it.** Everything before
  today — 7a's rules, 7a's reader, 8-2's writer — had only ever run against the emulator.
- **Its location is `nam5` (US multi-region), and that is permanent.** A Firestore database's
  location cannot be changed after creation; the only "change" is a second database and a
  migration.

Two consequences, one technical and one legal:

- **Cloud Functions go in `us-central1`, not Europe.** The writer's Firestore access is a
  transaction — a read and then a write — so a function in `europe-west1` would cross the
  Atlantic twice per webhook. Co-locate with the data. (This corrects an `europe-west1` that
  was written into `functions/src/index.ts` on the assumption of an EU database.)
- **The privacy policy has to say data is stored in the United States**, and 8-9 owns that
  sentence. Lawful — Google is certified under the EU–US Data Privacy Framework, so the
  transfer has an adequacy basis — but it is a disclosure obligation, not a silent detail, and
  it is the second thing about this project that is EU-facing while the infrastructure is not.

**Not worth undoing.** The read path is one cached document fetched on sign-in and on
foreground, and Phase 7's rule that no screen ever awaits Firestore means the extra ~150ms of
transatlantic latency is invisible by construction. This architecture is the best possible one
for a distant database. The real cost is the privacy-policy line, not the milliseconds.

## 8-2 · The entitlement writer — RevenueCat webhook → Cloud Function → `/entitlements/{uid}`

The one piece Phase 7 explicitly left for this phase. The document shape is already fixed by
7a's reader (`entitlement.web.ts`: `{plan, since, source, expiresAt}`), the rules already deny
every client write, and `verify-firestore-rules.ts` already tests that they do. The Admin SDK
bypasses rules, so `allow write: if false` stays exactly as written.

- **Firebase Functions v2**, which requires the Blaze plan — a new billing dependency for the
  project, small at this volume but not zero.
- **Verify the shared secret.** RC sends a configurable `Authorization` header; hold it in
  Secret Manager and reject anything else. This endpoint grants paid access to whoever can
  POST to it.
- **Make the write a projection of current state, not an application of an event.** RC retries
  on failure and events can arrive out of order; an out-of-order `RENEWAL` landing after an
  `EXPIRATION` would resurrect a dead subscription. Compare `event_timestamp_ms` against the
  document's stored `updatedAt` and drop anything older.
- **Event mapping, with the one that is always got wrong called out:**
  `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE` → write/extend. `NON_RENEWING_PURCHASE` →
  `plan: 'lifetime'`, no `expiresAt`. `EXPIRATION` → revoke. `BILLING_ISSUE` → **do not
  revoke**, grace applies. **`CANCELLATION` → do not revoke** — a cancelled subscription is
  paid through the end of its period, and revoking on cancellation takes away time someone
  paid for. `REFUND`/`TRANSFER` → revoke.
- **Events for an anonymous app user id (`$RCAnonymousID:…`) have no uid to write to.** Log
  loudly and drop. This case existing at all means 8-4's "never configure the SDK signed out"
  rule was violated.
- **Known gap, carried deliberately into 8b (2026-08-13): the function has never been
  executed.** Its decisions are covered by 47 harness cases, and both type-check and build are
  clean, but the transport around them — the 401 on a bad `Authorization` header, the write
  landing in the shape `fetchEntitlement` reads, the revoke deleting rather than half-writing,
  and the transaction holding under concurrent delivery — is unproven. Blocked twice over: the
  Firestore emulator now requires JDK 21 (this machine has 18, which also means 7a's
  `verify-firestore-rules.ts` has never run here), and the alternative of running against the
  real project is unsafe on a machine whose `GOOGLE_APPLICATION_CREDENTIALS` points at a
  *different* Firebase project. **8b's first test-mode purchase exercises all four**, so this
  is a sequencing choice, not an accepted risk — but if it is still unproven when 8b's webhook
  misbehaves, this is the first place to look.
- **Alternative considered and rejected: RevenueCat's official Firebase Extension**
  (`firestore-revenuecat-purchases`). It stores RC's own customer and event shapes in
  collections of its choosing and can set Auth custom claims. Adopting it means either
  rewriting 7a's reader, rules and rules-tests around a foreign document shape, or writing a
  second function to project its output into ours. Custom claims also go stale until the token
  refreshes. Our own ~100-line function against a document we designed is smaller than the
  adapter would be.

## 8-3 · Entitlement becomes revocable client state

A new persisted store — `useEntitlementStore` — holding `{plan, expiresAt, source, fetchedAt}`
and exposing the derived `hasPremium` that implements the precedence order and the grace
window above. It is the only consumer of `fetchEntitlement`.

- **Refresh points:** sign-in, cold start, window focus, post-purchase, and the RC SDK's
  customerInfo listener. Not on a timer.
- **It is the only module that reads Firestore**, which keeps Phase 7's rule intact — no
  screen, hook or selector gains a network dependency. It is the same shape 7b's sync engine
  will take, deliberately: one module owns the network, everything else reads a store.
- **`setPurchased()` stops being called on web.** It remains for native's Play path only, and
  its docstring should say so, because a future reader will otherwise assume it is dead code.

## 8-4 · The RevenueCat Web SDK on the client

`@revenuecat/purchases-js`, web only, dropped into `src/hooks/useIAP.web.ts` — the file that
currently returns "Purchases on the web are coming soon." Native `useIAP.ts` does not change.

- **Configure with `appUserId` = the Firebase UID. Never configure anonymously.** An anonymous
  purchase produces an entitlement with no identity to attach it to, which is the exact
  reconciliation problem this phase exists to end — recreating it on purpose, on the one code
  path that could.
- Prices render from the Offering, per plan, the way `paywall.tsx:54` already renders
  `product?.displayPrice ?? '...'`. **No price string is hardcoded in the app**, or the
  paywall and Stripe drift the first time either changes.
- On success the SDK returns customerInfo synchronously; that is the truth for the seconds
  before the webhook lands. Set the entitlement store from it and never block the UI on
  Firestore catching up.
- Sign-out must tear down the SDK's configured user as well as clearing the store.

## 8-5 · The paywall, rewritten

`paywall.tsx` today sells one thing. It becomes a three-plan screen on web while staying
exactly as it is on native.

- **`"one-time purchase · no subscription"` (`paywall.tsx:79`) is now false on web** and must
  go there. **On native it stays true and stays put** — Android still sells the one-time
  unlock, and that line is the promise made to the buyer who already has one. Split the price
  block by platform rather than editing it in place.
- **Verified email is required before purchase.** 7-4 flagged this and this is where it lands:
  an entitlement attached to an unverified address is attached to nobody. The account step
  (`paywall.tsx:113-127`) gains a third state between signed-out and signed-in — signed in but
  unverified, purchase disabled, with `VerifyBanner`'s resend affordance inline.
- **"Restore Purchase" means different things per platform.** On native it is Play's
  `getAvailablePurchases`. On web it is "re-read my entitlement" — the same button, a
  different verb, and on web it is also the button the manual lifetime grant is collected by.
- The take-preservation effect (`paywall.tsx:46`) is untouched and now also covers the
  checkout redirect, which is a second way to leave the page mid-flow.
- Error states to write copy for: declined card, checkout window closed without paying,
  network failure mid-purchase, and already-entitled.

## 8-6 · `/profile` — the plan block, for real

Replaces the placeholders at `profile.tsx:410-427`, including the `Billing` row whose copy
currently reads "Subscriptions and web billing arrive with the next release" (`:419-423`) —
this is the release. Real plan name, renewal or expiry date, a manage-billing link into
Stripe's customer portal, cancel, and the lifetime badge.

7-7's honest-placeholder rule inverts here: the reason that row was allowed to be a
placeholder was that rendering a fake subscription would be a lie, and now there is a real one
to render.

**Say what lapsing costs, on the page, before it happens.** A lapsed subscriber keeps their
entire library — storage is local-first, nothing is deleted — and loses the ability to start
new sessions. That is already what `resolveSessionGate` does; the only failure would be
letting them discover it.

## 8-7 · The lifetime buyer, by hand

One person, known personally. He signs in on web; his `premium` entitlement is granted against
his Firebase UID in the RevenueCat dashboard. The code that has to exist is only the door 7-6
already built.

What this phase adds is **a support email address behind the promise and a runbook in
`DEV_NOTES.md`**, so that the second such grant — if there is ever one — is executed rather
than re-derived. That is the whole of the grandfathering deliverable that Phase 7 and the
summary above both budgeted a reconciliation subsystem for.

## 8-8 · Turning the free tier back on

`FREE_TIER_ENABLED = false` (`useSettingsStore.ts:24`) is development-only and has been since
Phase 0. **While it is false no web user can reach the paywall at all**, so every purchase
path in this phase is unreachable in a real session until it flips.

Flip it locally to exercise the gate throughout the phase; flip it for real as the phase's
last commit, after a test-mode purchase of all three plans has round-tripped through the
webhook. It is the switch that turns billing on, and it should be its own commit.

## 8-9 · The legal surface, which Stripe will actually check

Merchant of record moves the tax liability, not the disclosure obligations:

- A **public pricing page** (12-3's landing page becomes it), a **refund and cancellation
  policy**, a contact route, and **terms of service — which do not exist in this repo at all**.
- `PRIVACY_POLICY.md` was rewritten in 7-13 for accounts and now needs its payment paragraph:
  what Stripe and RevenueCat hold, and that the app never sees or stores card data.
- All of these are public URLs, which is the same dependency as 8-1.7.

## What Phase 8 does not do

7b's sync engine — it still follows this phase · any change to Android billing, and no native
release · Play subscription SKUs · promo codes, coupons and free trials (unsupported on this
path — see the decision) · RC's paywall builder, web-to-app funnels and paywall A/B testing
(a separate body of work, and premature at one buyer) · server-side free-tier enforcement
(decision unchanged) · self-service refunds · family or team plans · anything on iOS.

## Verification

- **Test-mode purchase of each of the three plans**, end to end, including the lifetime one —
  which is also how 8-1.6's open question gets answered.
- **Replay every webhook event type** from RC's dashboard against the deployed function and
  assert the resulting document. **`CANCELLATION` must not revoke; `EXPIRATION` must.** Replay
  one of them twice, and one of them out of order, to prove the projection is idempotent.
- **The revocation pass, which has no unit test:** subscribe in test mode, cancel, force
  expiry, confirm the app returns to the free gate on next focus and that **the library is
  fully intact**.
- **Offline:** entitled, go offline, hard-reload — still premium. Advance past
  `expiresAt` + grace — free. Kill the network mid-refresh — still premium, never revoked on
  an error.
- **Sign out on a paid browser → free. Sign back in → paid.** Then the native check: the
  device's `isPurchased` is untouched by either.
- **An unverified account cannot reach the purchase call**, and **a signed-out user cannot
  configure the SDK** — the two invariants that keep entitlements attached to identities.
- **Fee reconciliation, once:** put a real $3.49 charge through and compare the payout against
  the table at the top of this phase. Numbers taken from vendor docs are worth confirming once
  against a bank statement.
- The 7a no-regression check still stands: **signed out, everything except starting a session
  past the limit works exactly as it does today.**

## Suggested build order

### 8a — no accounts, no cards, no vendor (now)

1. **8-3 the entitlement store and revocation.** The biggest change in the phase and the one
   least connected to billing. Driven by entitlement documents written by hand into the
   Firestore emulator. Ends with paid access that can expire, revoke, survive offline and
   clear on sign-out — with no way to buy anything.
2. **8-2 the writer**, against the Functions + Firestore emulators, driven by hand-authored
   RevenueCat webhook payloads. It is the only component that can silently grant or strip paid
   access, so it gets built where it is cheapest to be wrong. Paired with
   **`verify-entitlement.ts`** — a pure harness over the event→document mapping, following
   `verify-sync.ts`'s intent: `CANCELLATION` does not revoke, `EXPIRATION` does, replays are
   idempotent, out-of-order events are dropped, grace is honoured.
3. **8-5 the paywall and 8-6 `/profile`, on mock offerings.** Three plans, the
   signed-in-but-unverified state, every error state, the lapsed-subscriber copy — reviewable
   at `?mock=` URLs exactly as 7a-UI's screens were, with no SDK present.

### 8b — Stripe test mode (still free, still reversible)

4. **8-1 setup**: a Stripe account with nothing filled in, products created in test mode, the
   RevenueCat app installed from the Stripe Marketplace, products imported, one `premium`
   entitlement, one Offering. **8-1.6's lifetime question is answered here**, by trying it.
5. **8-4 the Web SDK** wired into `useIAP.web.ts`, replacing 8a's mock. Real test-card
   purchases of all three plans, through the real webhook, into the real document, read by the
   store built in step 1.

### 8c — the commitments (only when the rest works)

6. **Stripe activation** (identity, Belgian bank account) and **Managed Payments switched on**
   — a dashboard setting against a purchase flow that already works end to end.
7. **The domain**, then **8-9 legal pages** + **8-7 the manual-grant runbook**.
8. **Blaze plan** and the function deployed for real.
9. **8-8 flip `FREE_TIER_ENABLED`.** Last, deliberately, and on its own commit.

## Open questions

1. **Does the $44.99 lifetime sell through Stripe Billing?** (8-1.6) Blocking, cheap to
   answer, three fallbacks ranked.
2. **Is Stripe Managed Payments available to a Belgian account?** (8-1.1) Blocking, and
   answered in the dashboard rather than by reading marketing pages. If not, the choice is
   Paddle, not self-MoR.
   **Adjacent, and not a code question:** whether Stripe's reverse-charge payouts are
   compatible with staying inside the Belgian franchise scheme. One accountant's hour.
3. **The custom domain** — now four items on the deferred fix-up pass. Gates go-live, not the
   build, so the 2026-08-13 deferral holds.
4. **Which side is authoritative, the RC SDK or the Firestore document?** Settled above as
   "SDK live, document as the cross-platform mirror" — but 7b's sync engine has to answer the
   same question for its own state, and the two answers should be the same shape.
5. **Monthly's role at these fees.** Not a decision for now; revisit against real conversion
   data rather than against the fee table.

## Phase 9 — iOS version
- **Scope now depends on Phase 15.** This phase answers "does iOS exist at all" (a capture-bridge spike plus store setup); Phase 15 answers "what does any native platform contain". Settle 15 first, or iOS gets built by porting one screen at a time, which is how a second platform quietly doubles the maintenance cost of every phase after it.
- The JS `pitchDetector.ts` port is already proven platform-agnostic (it's what web uses) — reuse it rather than porting the C++/Oboe MPM math to Swift.
- What's still needed: a small native audio-capture surface, since neither `expo-audio` nor `expo-av`'s recording APIs expose live raw-PCM frame callbacks *during* recording on iOS (they're file/segment-oriented). Spike a small bridge — a Swift `AVAudioEngine` tap, or a small Expo Module — that emits `{frequency, rms}` in the same shape Android's Kotlin module does, then feed that into the existing JS pipeline unchanged.

## Phase 10 — Improve web UI polish
- Lowest risk, can slot in anywhere; sequenced last as cleanup. Deferred hover states on `TabCard` fields, `KeyGrid` cells, `ExportOption` rows, segmented toggles.
- Optional tech-debt note to address here or separately: the web capture module uses `ScriptProcessorNode`, while the README's own "Web Version Plan" describes an `AudioWorklet` approach — the shipped code and the documented plan disagree; worth reconciling or updating the doc.

### 10-1 · Modals that are phone sheets on a desktop viewport
*Added 2026-08-13, found while wiring 7-7's name editor.*

`NameRecordingModal` and `RatingModal` / `RatingModal.web` have **no `maxWidth` on the card**,
which is `width: '100%'`. On a wide window they stretch to within a screen-edge padding of
both sides. They also carry the rest of the phone-sheet language: centred titles, `flex: 1`
full-width buttons sized for a thumb, and 24px radii against the 16px the web surfaces use.

Those are the right choices where they came from and the wrong ones on a 1440px page. Every
other modal already caps its width, so this is two files, not a sweep.

- `NameRecordingModal` — reached on web from `export.tsx`, `edit.tsx` and `RecordingCard.tsx`.
- `RatingModal.web` — reached from `index.tsx`, `export.tsx`, `studio.tsx`, `edit.tsx`,
  `AppSidebar.tsx`.

`EditNameModal` is the worked example of the target shape (built for `/profile` at 7-7,
alongside `SetPasswordModal`): capped card, left-aligned heading, content-sized actions on the
right, hover states, `cursor: pointer`.

**Do not simply widen `NameRecordingModal` in place** — it has native callers whose current
shape is correct. Either split by platform extension or gate the sizing on `Platform.OS`.

### 10-2 · Modal accessibility: Escape, focus trap, focus restore
*Added 2026-08-13, same discovery.*

7a-UI committed to "every modal traps focus, closes on Escape, and returns focus to whatever
opened it" (see that section's accessibility list, and `project_app_architecture`). Against
the code as it stands that is **unmet almost everywhere**:

- **Escape closes**: only `EditNameModal`. React Native's `Modal` maps `onRequestClose` to the
  Android back button and to nothing at all on web, so every other dialog can only be left via
  its Cancel button — including `AuthModal`, `SetPasswordModal`, `ConfirmDeleteModal`,
  `ConvertTrackModal`, `ActionSheetModal` and `NameRecordingModal`.
- **Focus trapping**: nowhere. `accessibilityViewIsModal` is set on several cards, which
  addresses screen readers but does not stop Tab escaping to the page behind on web.
- **Focus restoration** on close: nowhere.

Worth doing as **one shared helper applied across every modal** rather than per-dialog — the
Escape listener is ~6 lines and identical each time, and doing it piecemeal is how three of
them end up subtly different. Sequenced here rather than in Phase 7 because it is a
pre-existing gap across the whole app, not something the auth work introduced.

## Phase 11 — MIDI Studio (multi-track DAW)
Port Signal's editor surface into the app as a second editing stage, so a user can open a MIDI file in a real multi-track editor, work on it, and convert any track (or tracks) into harmonica tabs. Decided with the user 2026-08-01 after establishing that the existing piano roll is already explicitly modelled on Signal (`PianoRoll.tsx:419` "matches Signal's mouseMode split", `:562`, `:395`) and already carries most of a MIDI editor's interaction surface.

---

# Phase 11 — Detailed implementation plan (written 2026-08-01)

## The organizing idea: two stages, one conversion boundary

Phases 0–6 built a single-line editor where every note is already a harmonica tab. Phase 11 adds a stage *before* that one, where music exists as it actually is — many tracks, full pitch range, no instrument constraints — and makes tab generation an explicit conversion out of it:

```
.mid ──▶ [MIDI Studio]  ──convert track──▶ [Tab Editor]  ──▶ export
  or      multi-track      per-track key     TabRecording
 blank    full range       + octave fit      (Phases 0–6,
 project  MidiProject                         unchanged)
```

The boundary is the whole design. Everything harmonica-specific — key, `tab` strings, playability, bends — lives on the right of it. The Studio never knows what a harmonica is. That is what lets the Studio be a general MIDI editor without every feature growing a harmonica special case, and what keeps the shipping tab editor untouched.

## What already exists (do not rebuild)

Measured against the code, not the roadmap. `PianoRoll.tsx` is 3111 lines and already has:
- **Pencil/selection mouse modes** (`:417-427`), marquee multi-select with shift-union (`:589-611`)
- **Note create / move / resize / group move**, live drag tooltips
- **Snap on/off held separately from subdivision** 4/8/16 (`:390-400`), grid drawn regardless
- **Copy/paste** (`clipboardRef`, `:788-800`), transpose, zoom, fit
- **Playhead, click-to-seek, autoscroll**; transport with loop bounds, 0.5–2× rate, metronome, mid-note seek resume (`usePlayback.ts`)
- **Undo/redo with Cmd+Z / Cmd+Y** spanning list and piano-roll views (`edit.tsx:110-135`)
- **Viewport culling** — `visibleNotes` filters to the visible time window (`:537-545`)
- **A chromatic row model already.** `getGridRows` returns the *full gapless chromatic ladder* and marks harmonica-unreachable rows `playable: false` / `tab: ''` (`HarmonicaMapper.ts:213-219`). Harmonica-ness is a per-row flag, not a different shape.

So the Studio is a widening of an existing component plus a track layer — not a new editor.

## Signal feature scope (decided with the user, against Signal's actual component tree)

**In scope:** piano roll · track list (`TrackList`) · tempo + time-signature graph (`TempoGraph`) · control lanes (`ControlPane` — velocity, pitch bend) · per-track instrument (`InstrumentBrowser`) · transport (`TransportPanel`) · arrange view (`ArrangeView`) · quantize · WAV export.

**In scope, revised:** **SoundFont sound module.** Initially deferred here on the grounds that native pre-renders WAV in JS with no live scheduler (`Playback.ts:8-10`) and couldn't match it — **reversed by the user 2026-08-01** as exactly the kind of native-driven downscoping this project doesn't do. On web it is straightforward: sample buffers through `AudioBufferSourceNode`, pitch-shifted by `playbackRate`, shaped by a gain envelope, on the live Web Audio scheduling path that already exists. Build it at full ambition for web; native either catches up later behind its own audio module or loses the feature in the port.

**Out:** raw MIDI event editor (`EventEditor` — users don't think in CCs and meta events) · Web MIDI API hardware I/O (real but low value — the input device for this app is a harmonica and a mic) · cloud save / publish / auth (`CloudFileDialog`, `PublishDialog`, `FirebaseAuth` — that is Phase 7, not the editor port).

Signal has no VST hosting and no audio tracks, so neither is a scope question.

## Decisions taken

### `MidiProject` is a new entity — `TabRecording` is not migrated
`TabRecording` is live in production with real user data in AsyncStorage. Making it multi-track means a schema migration on a paid shipping app for zero user benefit, since a tab is still one player's single line. A separate `MidiProject` (tracks, tempo map, time-signature map) costs no migration and matches the two-stage architecture. Home's library holds both types with distinct cards, reusing the `source` field pattern from 6-7.

### Conversion is one-way, with an explicit re-convert
Live-linking the tabs to their source track sounds better than it is: the moment someone hand-edits the generated tab, it needs merge/conflict semantics, and Signal has no such problem to copy a solution from. Conversion produces a snapshot. Stamp `sourceProjectId` + `sourceTrackId` on the generated `TabRecording` and offer "re-convert from source" — most of the value, none of the merge design.

### Harmonica constraints apply per track, at conversion time
`rankKeysForMidi` and `octaveShiftForMidiRange` already do exactly the right work; they just run per-file today and need to run per-track. This also resolves the melody-handoff case that motivated the whole feature: when a melody passes from a flute to a cello, the two sections can be converted with their own octave fit rather than sharing one global shift computed from a median that fits neither (`pitchRange.ts:26-36`).

### Non-selected tracks must never be interactive
The culling comment at `:537` names the real cost: *real gesture-handler instances per note*. Signal renders its piano roll on the GPU (`GLNodes`, `DrawCanvas` — WebGL) and can brute-force thousands of notes; RN-Web Views cannot. So background tracks and arrange view render as plain non-interactive primitives (or one SVG path per track), and only the selected track mounts gesture-attached note components. Culling also has to extend to **rows**, since full MIDI range is ~128 rows against the harmonica's ~36. If that still isn't enough, a canvas layer for background tracks is the fallback — decide on measurements.

### Web is the target; native is a later port that may drop features
**User directive, 2026-08-01.** This phase is designed and verified for web. Native constraints — the JS WAV pre-render, the absence of a live scheduler, mobile screen size for a track panel and arrange view — are *porting notes*, never reasons to scope a web feature down or defer it. The mobile port happens after the web product is complete and is expected to shed features rather than hold the web version back. Design at full ambition.

### Undo stacks stay separate per stage
Studio edits and tab edits are different documents. A shared stack would let Cmd+Z step across the conversion boundary.

### Persist projects as SMF bytes, not expanded JSON
5a-6 already hit AsyncStorage limits with `RawFrame[]` and needed decimation (`sessionSnapshot.ts:49`). A multi-track project is larger, and unlike frames it cannot be decimated — it is the document. Re-serialize to compact SMF on save and parse on open. `generators.ts:96` already emits a real format-0 SMF, so the writer is partly in hand.

### Velocity is breath force, and pitch bend is the bend
Not a rename — a reason this app should have control lanes at all. `RawFrame.rms` is already captured per frame and rendered as a loudness curve (`frame-inspector.tsx:813`), so recordings already measure breath energy; it just dies at note segmentation and never reaches `TabNote`. MIDI import supplies velocity directly. **Caveat:** mic RMS conflates breath with mic distance and input gain, so it must be normalized against the onboarding calibration (`onboarding.tsx:130-161`) or the lane will display "how close was the mic". Pitch bend maps to harmonica bend depth, which the tab notation already encodes (`isOverblow`, apostrophes — `notesToTabs.ts:41-44`) — design the lane system generically so bend depth is just another lane.

### Tempo map and time-signature map ship together
`parseMidiFile` currently takes `midi.header.tempos[0].bpm` and discards the rest (`midiToNotes.ts:116`), so any file with a tempo change progressively drifts its bar lines out of alignment with the music — and since snap quantizes to those bars, editing degrades the further in you go. Separately, `tempo.ts:1` hardcodes 4/4 with a comment to revisit. Both come out of `midi.header` in the same parse and touch the same call sites (`beatDurationMs`, `barDurationMs`, `msToBar`, `snapDivisionMs`, `snapMsToGrid`, plus the web metronome's constant `beatSec` stepping). Doing them separately means paying that refactor twice.

### The Studio does not replace Phase 6's quick import path
Someone importing a single-track melody should not be handed a DAW. Keep `/import`'s existing track-picker → key-picker → editor flow as the default, and add "Open in Studio" for files that warrant it. Phase 6's picker stays the fast path; the Studio is the powerful one.

### Blank projects are in scope (user decision)
Compose-from-scratch means harp2tab stops being purely a transcription tool. Concretely: a "New MIDI project" entry point on Home, a blank-project state, and raised value for quantize and the instrument browser. Sequenced late, since import is the path that already has users.

## 11-1 · Data model + store
- `MidiProject`, `MidiTrackData` (id, name, GM program, channel, color, mute, solo, notes), tempo map, time-signature map in `src/types/index.ts`.
- `useMidiProjectsStore` following the `useSettingsStore` / `useRecordingsStore` persisted-Zustand pattern; SMF-bytes serialization per the decision above.
- `MidiNote` gains `velocity`; `TabNote` gains an optional `breathForce` (optional, absent = legacy, same convention as `bpm?` / `favorite?` / `source?`).

## 11-2 · Tempo + time-signature map
Widest-reaching refactor in the phase, and the reason it comes early: bar lines underpin every alignment the track layer draws. `tempo.ts` is only 40 lines but every function takes a scalar bpm and becomes a piecewise lookup. Parse the full map in `parseMidiFile` instead of `tempos[0]`. Ship the `TempoGraph` editing UI after the data model is correct — the drift fix is valuable on its own.

## 11-3 · Row-model parameterization
Make the row provider injectable rather than calling `getGridRows` directly. A full-range chromatic provider returns the same `GridRow` shape with `playable: true` throughout. **Additive — do not big-bang extract the chassis out of a 3111-line shipping component.** Extend culling to rows in the same change.

## 11-4 · Track layer
`TrackList` panel (name, instrument, mute, solo, color), multi-lane rendering, selected track interactive and non-selected greyed and inert. Per-track GM instrument selection, and GM-family → timbre mapping on the web scheduler so tracks are audibly distinguishable. Richer oscillators (summed harmonics + a real ADSR envelope) are the cheap first step here and worth doing even with SoundFont coming in 11-6 — they're what the fallback path sounds like.

## 11-5 · Conversion boundary
Per-track key ranking and octave fit; generate one `TabRecording` per selected track with `sourceProjectId`/`sourceTrackId`; "re-convert from source" on the tab side. This is the milestone that makes the Studio *useful* — end-to-end MIDI → Studio → tabs. Ship here, before the remaining polish.

## 11-6 · Control lanes
Generic lane system, then velocity/breath force (with RMS normalization against mic calibration for recorded sessions) and pitch bend. Per-note gain is a parameter change, not new architecture — web already builds a per-note GainNode and pins it to a constant `AMPLITUDE` (`Playback.web.ts:65-76`).

**SoundFont sound module belongs here too**, on the same lane/voice work: sample buffers via `AudioBufferSourceNode`, pitch-shifted by `playbackRate`, with the gain envelope the velocity lane already drives. Ship samples on demand rather than bundling a full GM set. This is what makes the Studio sound like an instrument instead of a test tone, and it's the single biggest perceived-quality item in the phase.

## 11-7 · Arrange view
Whole-song overview, all tracks as lanes, notes as inert blocks. Directly serves the motivating use case: seeing that one track goes empty at bar 16 while another picks up is a one-glance observation here and a scrolling chore in the piano roll.

## 11-8 · Quantize
Batch-snap selected notes to the grid. High value beyond the Studio — the *audio* import path produces rhythmically messy onsets with no cleanup tool today.

## 11-9 · Blank projects
"New MIDI project" entry point on Home, blank-project state, session-gate wiring via the shared helper (Phase 0) like every other entry point.

## 11-10 · Multi-track export
Formats decided with the user 2026-08-01; no longer open.

### The signature change comes first
`generateForFormat(notes, key, harmonicaType, format)` becomes `generateForFormat(parts, format)`, where a part is `{ name, key, harmonicaType, notes }` and today's single-track callers pass exactly one. Every format below needs this, so land it before touching any individual generator. **Per-track key is why the shape is `parts` and not `(tracks, key)`** — the 11-5 decision means different tracks legitimately land on different harps, and each part has to carry its own.

### MIDI and MusicXML — native multi-part
- `generateMidi` hardcodes format 0 with `1 track` (`generators.ts:126-131`); becomes format 1 with one `MTrk` per part and the tempo meta event in a leading conductor track.
- `generateMusicXml` hardcodes a single `P1` "Harmonica" part (`:236`); becomes one `<score-part>` per part in `<part-list>` plus one `<part>` each. The measure-building loop is already per-part — it just runs N times.

### CSV — appended columns, globally time-sorted
Schema: `tab,note,start_time_ms,duration_ms,track_index,track_name,key,harmonica_type`

- **Append, never prepend.** Positional consumers keep working (`row[0]` is still `tab`), which is what allows *one* schema for both single- and multi-track output instead of two.
- **`track_index` and `track_name` both.** The index is stable, numeric and escaping-free — the join key for scripts. The name is for humans, and survives being missing or duplicated.
- **`key` / `harmonica_type` per row are load-bearing, not decoration.** A `tab` of `"4"` is a different pitch on a C harp than on an A harp, so with per-track keys a multi-track CSV is uninterpretable without them. (`note` still keeps pitch unambiguous either way.)
- **Sort globally by `start_time_ms`, tie-breaking on `track_index`.** Timeline analysis is what the format is for; grouping by track is one sort away in any tool. Single-track output keeps today's row order exactly.
- **This forces real CSV escaping, which the file has never had.** `generateCsv` (`:46`) joins raw fields with commas — safe only because tabs and note names cannot contain one. Track names can (`"Lead, Alto"`), and an unescaped one silently corrupts the row rather than failing. Add an RFC-4180 field escaper in the same change; do not defer it.

### TXT — sequential sections
```
Harp2Tab -- 3 tracks
========================================

Melody -- Key of C -- 42 notes
----------------------------------------
2  3  -3'  4  ...

Bass Line -- Key of G -- 30 notes
----------------------------------------
...
```
- **Parallel staves were rejected for a structural reason, not a stylistic one:** the format has no time axis. `generateTxt` packs 12 notes per line (`NOTES_PER_LINE = 12`, `:33`) with no relationship to timing, so column-aligning tracks with different note counts and rhythms would require inventing a temporal grid this format doesn't have — a rewrite of TXT, and what MusicXML already does properly.
- Sequential sections also match the artifact's actual use: a player prints it and plays one part.
- Per-section headers carry their own key, since keys differ per track.
- **Single-track output must stay byte-identical to today's.**

### Optional follow-on, explicitly not in scope here
Once 11-2's tempo map exists, TXT could break lines at bar boundaries instead of every 12 notes. Better format on its own merits, and it is the prerequisite that would make parallel staves possible if they're ever wanted.

### WAV
Nearly free once multi-voice mixing exists (11-4) — `synthesizeWav` is already additive (`mix[idx] +=`, `synthesizeWav.ts:108`).

## Risks
- **Perf is the top risk and the one to measure first.** Spike an orchestral multi-track file through the culled renderer *before* committing to 11-4. If inert background tracks plus row culling don't hold, the fallback is a canvas/Skia layer for background tracks only — decide that on measurements, not in advance.
- **`PianoRoll.tsx` is large and shipping.** Every change here is additive parameterization. A chassis extraction, if it ever happens, is its own change with the harness green on both sides.
- **This is the largest phase in the plan** — larger than 5 and 6 combined. 11-1 through 11-5 form the shippable core; 11-6 through 11-10 are independently sequenceable after it.

## Verification
- Extend the `scripts/verify-midi-import.ts` harness (22 cases) rather than starting a new one: multi-track round-trip (project → SMF → parse → compare), tempo-map and time-signature-map fidelity across a file with mid-piece changes, per-track octave fit producing *different* shifts for a high and a low track, and conversion stamping the right `sourceTrackId`.
- Assert the drift fix explicitly: a file with a mid-piece tempo change should keep bar N aligned to the music at the end of the file, which is exactly what `tempos[0]` cannot do today.
- Perf: a real orchestral MIDI (10+ tracks, several thousand notes) scrolled and zoomed **in a browser** — that is the acceptance bar. Native perf is a porting concern, not a gate on this phase.
- Export (11-10): assert single-track output is **byte-identical** to today's for TXT and unchanged in row order for CSV — this is the regression that would otherwise go unnoticed. Assert a track named `Lead, Alto` round-trips through CSV without splitting a row, and that a two-track export with different keys per track reproduces both keys.
- Per project convention, restart the web dev server with `--clear` and confirm the served bundle reflects the change before browser-testing.

## Suggested build order
1. `MidiProject` type + store + SMF serialization (11-1) — headless, harness-driven.
2. Tempo + time-signature map data model and the `tempo.ts` piecewise refactor (11-2), harness green before any UI.
3. Row-model injection + row culling (11-3) — no behaviour change to the tab editor.
4. **Perf spike** on a real orchestral file before building the track layer.
5. Track layer + per-track instruments (11-4).
6. Conversion boundary (11-5) — first end-to-end shippable milestone.
7. Control lanes (11-6), arrange view (11-7), quantize (11-8), blank projects (11-9), multi-track export (11-10).

## Phase 12 — UX pass: naming, first-run, landing page, Studio fixes
Not a feature phase — a list of things that are built but wrong, plus the two surfaces the
product still has no version of at all (a landing page and a profile page). Collected from
the user's todo list of 2026-08-09. Ordered below by screen, not by dependency; the
dependency-ordered build order is at the end of the phase.

Every claim below was checked against the code on `web_version` at commit `335f332`.

---

# Phase 12 — Detailed implementation plan (written 2026-08-09)

## 12-1 · Home — section naming and organization

**What's there now.** Three different label conventions for two kinds of content
(`src/app/index.tsx`):
- `MIDI STUDIO · N PROJECTS` (`:790`) — named after the *editor*, not the content.
- `YOUR LIBRARY · N RECORDINGS` (`:828`) — named after the *container*, and "recordings"
  is wrong for two of the three ways a tab gets created (audio upload, MIDI import).
- `RECENT RECORDINGS` (`:658`, `:927`) — the empty-state and native variants, a third name
  for the same list.

Nothing on the screen says the two sections hold different *kinds* of thing: one is
unconstrained multi-track source material, the other is a finished harmonica line. That
distinction is the whole point of Phase 11's conversion boundary, and the home screen is
where it's least visible.

**Change.** Name them by content and by stage:
- `MIDI PROJECTS · N` with a one-line subtitle ("Multi-track source — convert a track to
  tabs"), replacing `MIDI STUDIO · N PROJECTS`.
- `HARMONICA TABS · N` replacing `YOUR LIBRARY · N RECORDINGS`, and the same word used in
  the two empty states and the native `RECENT RECORDINGS` header, so the list has one name
  everywhere.
- Keep projects above tabs — the ordering rationale at `index.tsx:785-787` (source sits
  upstream of result) still holds and is what the new names make legible.

**Open question, not blocking:** the search / key-filter / sort / grid-list toolbar
(`:827-883`) serves the tabs list only; projects render as a bare grid. Recommend leaving
it that way until a realistic library has >12 projects — a second toolbar doubles the
chrome for a section most users will have three rows of.

## 12-2 · Home — the left sidebar

### Stats get cut off at the bottom
`fullSidebar` (`index.tsx:1299`) is a plain `View` inside `dashboardShell`
(`flexDirection:'row', flex:1`, `:1293`). Only the library side scrolls
(`dashboardMainScroll`, `:1312`) — this was deliberate, so the panel reads as a persistent
app-shell rail. But the rail's own content is: section label + 4 action rows + the
type/key picker + the free-tier counter + a divider + `YOUR STATS`. On a short viewport
that overflows the panel's fixed height with no way to reach the overflow, and `YOUR
STATS` is last, so it is exactly what disappears.

**Fix.** Make the rail's content a `ScrollView` (the panel itself keeps its full-height
background and right-edge hairline — scroll the contents, not the chrome). Two variants
worth deciding between:
- Whole rail scrolls. Simplest; stats reachable by scrolling.
- Actions scroll, stats pinned to the bottom via a `flexGrow:1` spacer. Better if stats are
  meant to be glanceable rather than sought out.

Recommend the second: after the rewrite below, the stats are the panel's only
non-actionable content, and a stat you have to scroll to isn't a dashboard.

### The stats themselves are not worth the space
Today: `Recordings` = `recordings.length` and `Notes Transcribed` = `totalNotes`
(`:771-773`). The first number is already printed in the section header two feet to the
right; the second is a number with no scale to read it against.

**Change** to stats that answer a question, all computable from data `TabRecording`
already carries (no new plumbing — `duration`, `key`, `createdAt`, `tabNotes` all exist):
- Total time transcribed (sum of `duration`) — the honest "how much have I done" number.
- Most-used key (mode of `key`) — actually useful; tells you which harp you reach for.
- This week (count where `createdAt` is within 7 days) — the only number on the panel that
  can change today, which is what makes a dashboard stat worth reading.

Drop the raw recording count. Keep `StatTile`'s `layout="row" onAccent` shape (`:771`) —
it's the styling, not the content, that works.

### "New Project" button — name and icon
`index.tsx:717-730` (sidebar) and `:433` (empty-state hero). Two problems: the label
"New Project" doesn't say a project of *what*, sitting directly beneath "Upload Audio" and
"Upload MIDI" which both say exactly what they take; and the icon is `options-outline`, a
sliders/settings glyph that reads as "preferences", not "new multi-track document".

**Change.** Label to **"New MIDI Project"** (matches the section rename in 12-1, and the
existing `accessibilityLabel="New MIDI Studio project"` at `:724`, which should stay in
sync). Icon to something that reads as layered tracks — `layers-outline` or
`albums-outline`; `add-circle-outline` if the emphasis should be on *new* rather than on
*multi-track*. Note `options-outline` is also the project card's icon (`:802`) and the
Studio's identity elsewhere — change both or neither, so a project's glyph is the same in
the button that creates it and the card that opens it.

**Keep:** the button is deliberately not gated on a selected harmonica key (`:714-716`) —
a blank project has no harp until conversion. Don't "fix" that while renaming.

## 12-3 · Landing page — a surface that does not exist yet

**Current state, verified.** There is no landing page and no marketing route: `/` is
`KeySelectionScreen`, the app itself. `src/app/+html.tsx` is the only HTML shell and it
sets *no* `<title>`, no meta description, no canonical, no Open Graph or Twitter tags — it
exists purely to force non-overlay scrollbars. `public/` contains only `models/`. So
there is no SEO surface to improve; this is a from-scratch build.

### Routing decision (do this first — 12-5 depends on it)
Recommend `/` becomes the landing page and the app moves to `/app`, because the SEO value
belongs on the root URL and a marketing page behind a redirect earns nothing. Consequences
to handle in the same change:
- The first-launch `router.replace('/onboarding')` at `index.tsx:142-143` — being removed
  in 12-5 anyway, so sequence these together.
- `HIDDEN_ROUTES` in `src/components/TopBar.web.tsx:22` — the landing page needs its own
  header (marketing nav, "Open the app" CTA), not the in-app `TopBar`.
- Native must not get the landing page: on Android/iOS the app is the app. Gate by
  `Platform.OS === 'web'`, or keep the landing at a web-only route file.
- Every internal `router.push('/')` / `replace('/')` (onboarding's `finish`/`skip`,
  `onboarding.tsx:219-228`; the logo's back-to-library affordance in the Studio) has to
  point at the new app root.

### Harmonica image
No usable photo exists — `assets/images/` holds icons, logos, a splash, `tabIcons/`, and an
unused `tutorial-web.png`. Needs a licensed photograph or a commissioned/rendered
illustration. Ship it with explicit `width`/`height` (CLS is a ranking input, and this is
the largest element above the fold), and export a `@2x`; a hero photo at full-bleed width
is the heaviest asset on the page.

### SEO
All of this is new work:
- Per-page `<title>`, meta description, canonical, OG + Twitter card tags. `+html.tsx` is
  static and shared, so per-route metadata needs Expo Router's `Head` (or a post-export
  step over `dist/`). **Check `https://docs.expo.dev/versions/v55.0.0/` before writing
  any of it** — per project convention, and this specific API has moved between versions.
- `public/robots.txt` and a `sitemap.xml` (`public/` is copied into the export).
- JSON-LD `SoftwareApplication` with `offers` — the pricing table below is what makes it
  eligible for rich results.
- Real copy targeting real queries: "harmonica tabs from audio", "convert MIDI to
  harmonica tab", "harmonica tab maker", "harmonica tab notation". Each entry point on the
  home screen (record / upload audio / upload MIDI) is one of these queries — the landing
  page's sections should mirror them rather than being generic feature bullets.
- Static export means content is in the HTML at crawl time only if it renders without
  interaction — keep the landing page free of client-only gating.

### Subscription plans section
Prices are already locked (`project_web_version_plan` memory, 2026-07-29): **$3.49/mo,
$27.99/yr, $44.99 lifetime**. Nothing in code carries them — `src/app/paywall.tsx:36`
reads `product.displayPrice` from the Play SKU, and `:60-61` says "one-time purchase · no
subscription".

**The conflict to resolve before writing the pricing table:** publishing subscription
tiers on the landing page announces a model that Phase 8's billing (RevenueCat + Stripe)
doesn't yet implement, while the live Android paywall promises the opposite. Options:
1. Ship a static pricing table now with web plans marked "Coming soon" (+ email capture).
   Recommended — the landing page needs a price to be a landing page, and JSON-LD `offers`
   needs one too.
2. Ship the landing page without pricing until Phase 8 lands. Safer, weaker page.

Either way the table must state the grandfathering promise plainly ("bought Harp2Tab on
Google Play? You keep lifetime access") — that promise was made to real paying users and
the landing page is now the most public place it can be broken.

**Dependency:** the actual purchase flow is Phase 8. The landing page can ship before it;
the pricing *buttons* cannot do anything real until then.

## 12-4 · Profile page — carried forward, still gated on Phase 7

No profile route exists. `src/app/settings.tsx` is the only per-user surface (mic
sensitivity, theme, recalibrate, rate, purchase state) and there is no identity in the app
at all — no auth, no account, `isPurchased` is a local boolean in `harp2tab-settings`.

A profile page is therefore **not buildable before Phase 7 (Firebase Auth)** in any form
worth building: with no account it would be Settings with a different title.

Once Phase 7 lands, the profile page is where these belong: account (email, provider,
sign out), entitlement/subscription status and manage-billing link (Phase 8), and the
per-user stats displaced from the home sidebar in 12-2 — they suit a profile page better
than a rail.

**Decided 2026-08-12 — a separate `/profile` route.** Designed in full in **7-7**, which
supersedes the recommendation this section previously made. The reasoning here (a route
would hold three rows) turned out to understate it: with sync status, the plan block,
connected sign-in methods, the verification banner and the danger zone it holds six
sections. The split is `/profile` for what belongs to the *user*, Settings for what belongs
to the *device* — the same line 7-10's sync engine draws.

**What 12-2 should know:** the displaced home-sidebar stats now have a designed home in
7-7's stats row, so 12-2 does not need to find one.

## 12-5 · Calibration only before the first recording

**What happens now.** `index.tsx:142-143` redirects to `/onboarding` on first launch,
before the user has done anything. Consequences:
- A user who only ever uploads a MIDI file is forced through microphone calibration.
- On web it fires a **microphone permission prompt on first page load** — the single worst
  time to ask, and something browsers actively penalize. It also collides with 12-3: an
  SEO landing page whose first interaction is a mic prompt is not a landing page.
- Calibration is the app's first impression instead of the library.

**Change.** Delete the redirect; run calibration at the point of need — inside
`handleStart` (`index.tsx:189-196`), after the free-tier gate and before
`startRecording()`, and only when it hasn't been done. Same for any other route into
`/recording`.

**Ordering matters:** the gate check (`resolveSessionGate` → rating modal / paywall) must
stay first. Calibrating and *then* being told the session is paywalled is worse than the
current behaviour.

**State.** Add `hasCalibratedMic: boolean` to `useSettingsStore`
(`src/store/useSettingsStore.ts:11-23`) — **alongside** `hasCompletedOnboarding`, not
renamed over it. The persisted key `harp2tab-settings` already holds the old flag for every
shipped Android user; reusing the name would be fine, but shipped users who completed the
old onboarding did calibrate, so the migration is "seed `hasCalibratedMic` from
`hasCompletedOnboarding`" — write that explicitly rather than letting it fall out of a
rename. Zustand's default shallow merge means a key absent from persisted state keeps its
initializer value, so new users default to `false` with no migration code.

**`/onboarding` needs a return destination.** `finish()` and `skip()` both hardcode
`router.replace('/')` (`onboarding.tsx:219-228`). Add a `returnTo` param so entering from
Start Recording lands in `/recording`, not back at the library. The existing
`?skipPermission=true` entry from Settings (`settings.tsx:107`) must keep working
unchanged.

**Don't lose the welcome.** Removing the first-launch screen removes the app's only
introduction. On web the landing page (12-3) replaces it; on native, the first-run tour
(12-6) does. Sequence 12-7 so native isn't left with no first-run anything in between.

## 12-6 · MIDI Studio

### a) Footer tooltips render below the button and get clipped
`IconButton`'s tooltip is `position:'absolute', top:'100%', marginTop:6`
(`src/app/editStyles.ts:594-605`). Correct in the top toolbar, wrong in `WebTransportBar`,
which sits on the bottom edge of the screen in both hosts (`studio.tsx:703`,
`edit.tsx:777`) — the label is drawn below the viewport edge and is cut off.

**Fix.** Add a `tooltipPlacement?: 'above' | 'below'` prop to `IconButton`
(`src/components/EditControls.tsx:26-73`), defaulting to `'below'` so the toolbar is
untouched, with a `tooltipAbove` style (`bottom:'100%'`, `marginBottom:6`). Pass `'above'`
from every `IconButton` in `WebTransportBar` (loop, metronome, skip back/forward, stop,
undo, redo — `TransportBar.tsx:84-160`).

Two things to check in the same pass:
- **Horizontal clipping.** Tooltips are `left: 0` with `whiteSpace: nowrap`; the rightmost
  buttons in `webTransportSideRight` (`TransportBar.tsx:138`) can run off the right edge.
  A `'right'` alignment variant may be needed, as `PianoRoll`'s `ToolButton` already has
  (`toolTooltipRight`, `PianoRoll.tsx:3699-3701`).
- **The speed button** (`TransportBar.tsx:163-171`) and the BPM steppers (`:96-102`) are
  bare `Pressable`s with no tooltip at all — worth giving them the same treatment while the
  component is open.

`PianoRoll`'s own `toolTooltip` (`PianoRoll.tsx:3684-3697`) has the identical `top:'100%'`
assumption but lives in the top tool row, so it's correct today. Leave it; note it here so
it isn't rediscovered if that row ever moves.

### b) Project title should be editable
`studio.tsx:683` renders `project.title` as a static `<Text>` inside `headerLeft`. The tab
editor already solves this: `ChartTitle` (`edit.tsx:1125-1156`) is a `TextInput` styled as
a heading, with a hover-revealed input box on web precisely because a heading-styled field
gives no sign it's editable.

**Fix.** Port that pattern into the Studio's `headerLeft`, wired to the store's existing
`renameProject(id, title)` (`useMidiProjectsStore.ts:58-62`). Keep the track-count subtitle
underneath (`studio.tsx:684-687`).

**Watch:** `renameProject` bumps `updatedAt`, and the home screen orders projects by it —
committing on every keystroke would churn `updatedAt` and re-sort the grid mid-type.
Commit on blur (or debounce), holding the typed value in local state meanwhile.

### c) Help modal doesn't describe this page
`HelpModal` + `TOOL_HELP` live in `PianoRoll.tsx:2426-2474` and are titled **"Piano Roll
Help"**. Both hosts render the same content, so in the Studio it: describes a
"Key & Type (sidebar)" control and the whole Transpose-vs-Translate distinction
(`TOOL_HELP`'s last entry) for a sidebar the Studio does not have; and says nothing about
the track panel (select / colour rail / collapse), per-track instrument, **Convert to
tabs** — the screen's entire purpose — the per-track velocity and duration floors
(`studio.tsx:660-680`), Export, or tempo/time-signature editing.

**Fix.** Parameterize the modal by host: keep the genuinely shared piano-roll entries
(tools, snap, grid, quantize, zoom, loop pin, semitone/octave shift) in one array, and pass
host-specific entries plus a title in from the caller — a `helpSections` prop, or a
`variant: 'tab' | 'studio'` if the entries stay colocated. The Studio drops the key/type
entry and adds its own; the tab editor's content is unchanged.

Its content is also the reference for 12-7 — write the Studio entries before the tour, so
the tour can point at Help rather than restate it.

### d) Convert-track modal should list every key
`ConvertTrackModal.tsx:28` caps the list at `ALTERNATES_SHOWN = 3` (`:49`). The three
best-scoring keys are usually the right answer, but the user who owns exactly one harmonica
needs *their* key, and if it ranked fourth the modal simply doesn't offer it.

**Fix.** Render all 12 in the existing `ScrollView` (`:61`), keeping ranked order and
marking the top three as recommended — the ranking is the value; hiding the rest isn't.
`ranking.unplayableByKey` is already keyed by every key (`:50`, `:89`), so the evidence
line needs no new computation.

Check while doing it:
- `KeyCandidateList` (`src/components/KeyCandidateList.tsx`) for any fixed-height or
  no-scroll assumption from when the list was always three rows.
- The card is `maxHeight:'100%'` with `scroll: { flexShrink: 1 }` (`:158`, `:171`), so a
  12-row list should scroll inside the card rather than overflow — verify at a short
  viewport, since the type row, the two note paragraphs, Convert and Cancel are all outside
  the scroll area.
- **Same convention on the import screen** (`src/app/import.tsx`, which shares
  `KeyCandidateList` and the same 3-candidate cut). Decide deliberately whether both
  change; recommend yes — a user hitting the same wall in two places for the same reason.

## 12-7 · First-run tutorial on the important pages

**Scope — which pages.** Three: **Home** (the library and its three entry points),
**Tab Editor** (`/edit`), **MIDI Studio** (`/studio`). Deliberately excluded: `/recording`
(calibration is its first-run experience after 12-5), `/import` (already a stepped flow
that explains itself), `/settings`, `/export`.

**Shape.** A short step-through overlay pointing at real controls, dismissible at any
step, with a "Replay tutorials" row in Settings. Not a text modal: the editor and Studio
toolbars are dense enough that a paragraph won't attach to anything. 3–5 steps per surface,
maximum.

**State.** One key in `useSettingsStore`, not one boolean per surface:
`toursSeen: Partial<Record<'home' | 'edit' | 'studio', boolean>>`. Adding a fourth surface
later then needs no store migration — the default shallow merge replaces the whole object
with the persisted one, so an unknown surface reads `undefined` → falsy → not seen, which
is the behaviour wanted. Settings' replay row clears the object.

**Don't duplicate Help.** The help modal (12-6c) is the reference documentation; each tour
should end by pointing at it.

**Existing asset:** `assets/images/tutorial-web.png` exists and is referenced nowhere in
`src/`. Look at it before commissioning anything — it may be an earlier attempt at this.

**Interaction with 12-5:** on native, removing the forced onboarding leaves no first-run
introduction at all until this ships. Either build 12-7's Home tour in the same change as
12-5, or keep the onboarding redirect on native until it lands.

## Decisions still needed (blocking the items they sit under)
1. **Landing route** — `/` = landing with the app at `/app`, or a separate marketing
   route? Everything else in 12-3 and the removal in 12-5 hangs off this.
2. **Pricing on the landing page before Phase 8 billing exists** — publish with "Coming
   soon", or hold the section back?
3. **Profile page** — its own route, or a section inside Settings (and confirm it waits
   for Phase 7)?
4. **All-12-keys in the convert modal** — Studio only, or the import screen too?

## Verification
- 12-2 stats/scroll: check the sidebar at 1440×720 and 1280×640 — the two heights where the
  panel currently overflows — not just a full-height desktop window.
- 12-5 is the highest-risk item here because it touches persisted state that shipped users
  already have. Test three cases explicitly: a fresh install (calibrates at first record,
  not at launch), an existing user with `hasCompletedOnboarding: true` (never re-calibrates),
  and a user who only uploads MIDI (never sees a mic prompt at all — verify on web, where
  the permission dialog is the observable).
- 12-6a: hover every transport button at a viewport short enough that the bar sits at the
  screen edge; the failure mode is invisible in a tall window.
- 12-6d: a 12-row key list in the convert modal at a 640px-tall viewport, confirming the
  card scrolls internally and Convert/Cancel stay reachable.
- 12-3 SEO: `curl` the exported HTML from `dist/` and confirm the title/description/OG tags
  are in the served markup — not just present in the React tree.
- Per project convention, restart the web dev server with `--clear` and confirm the served
  bundle reflects the change before browser-testing.

## Suggested build order
1. **12-6 (Studio fixes)** — self-contained, no decisions pending, and the tooltip fix
   (12-6a) also fixes the tab editor. Order within: (a) tooltips, (d) key list, (b) title,
   (c) help content.
2. **12-1 + 12-2 (home naming, sidebar scroll, stats, button)** — pure UI, no new state.
3. **12-5 (calibration timing)** — after the naming work so the home screen it lands on is
   already correct; before the landing page, which depends on the redirect being gone.
4. **12-7 (tours)** — needs 12-6c's help content as its reference, and covers the
   first-run gap 12-5 opens on native.
5. **12-3 (landing page)** — largest item, needs decisions 1 and 2, and wants Phase 8's
   pricing story settled to be fully honest.
6. **12-4 (profile)** — after Phase 7. Not startable before it.

## Phase 13 — Record → transcribe → Studio (neural transcription for live takes)

Basic Pitch currently reaches only the file-import path. Recording is pMPM-only, and its
audio is thrown away the moment it is analysed. This phase retains the take, lets the user
choose an engine and tune its parameters after hearing themselves play, and lands the
result in the Studio as a draft — the same destination file import already uses.

```
Record  →  live pMPM HUD (unchanged, notes marked provisional)  →  Finish
                                    ↓
                      retained PCM  →  /import (audio lane)
                                    ↓
                        ENGINE PICKER          ← no compute yet
                                    ↓
                   run chosen engine's expensive half  ← once
                                    ↓
                        TUNE STEP (params)     ← re-runs cheap half only
                                    ↓
                          Open in Studio
```

### The invariant that holds it together

Both engines have the same two-phase shape: an expensive pass over audio, then a cheap
re-segmentation of its output.

| | Expensive (once) | Cheap (per param change) |
|---|---|---|
| Basic Pitch | `runInference` — CNN over the audio | `segment` — pure over 3 matrices |
| pMPM | `transcribe` — NSDF DSP → `RawFrame[]` | `framesToNotes` — no DSP at all |

**Rule for the param schema: a declared param re-runs only the cheap half.** Anything
needing a fresh inference, or a fresh capture, is a Settings-level decision and does not
belong on the tune screen. That is what rules out sample rate, retention format and
frame/hop-at-capture as engine params, and what makes the engine picker free to change
your mind about.

## 13-1 · Retain PCM during capture

`src/native/AudioCapture.web.ts` is the blocker: `onaudioprocess` (`:49`) computes rms and
pitch per 2048-block and discards `samples`. Basic Pitch needs a whole `DecodedAudio`.

- Add `setRetaining(on: boolean)` and `takeRetainedPcm(): DecodedAudio | null`.
- The block must be copied regardless — `getChannelData(0)` returns a reused view, so a
  `.slice()` was always mandatory.
- **Capture stays at the device rate.** No resampling and no `NoteDetector` recalibration:
  every threshold in `DEFAULT_NOTE_DETECTOR_CONFIG` is calibrated against 2048-sample
  frames at that rate (~42.7ms at 48kHz), and `basicPitch.web.ts:12-14` warns specifically
  against a global rate change for this reason. `resampleToModelRate`
  (`basicPitch.web.ts:122`) converts to the model's 22050 later, properly, via
  `OfflineAudioContext`.
- **Float32 is the default retention format**; Int16 is opt-in (13-8). Latch the choice at
  `startCapture()` — the format cannot change mid-take — and have `takeRetainedPcm()`
  widen back to Float32 only when the Int16 path was used. At the 5-minute cap: ~58MB
  Float32, ~29MB Int16.
- Cap retention at `MAX_DURATION_MS` (5 min, `audioImport.ts:50`) and set a `truncated`
  flag rather than silently keeping a partial take.
- `stopCapture()` must **not** clear the buffer — Finish reads it after teardown.
- Mirror both exports in `src/native/AudioCapture.ts` as no-ops returning `null`. Native's
  Basic Pitch is already `available: false` (`basicPitch.ts:18`) and `getAlgorithm` falls
  back to pMPM, so nothing on native changes.

**Pause must gate retention.** `useAudioCapture.ts:106-109` already fires an effect on
every pause transition — call `setRetaining(!isPaused)` there. Dropping paused audio keeps
the retained timeline aligned with the live one, which already discounts pauses.

## 13-2 · Split `runAudioImport` at the decode seam

`runAudioImport.ts` owns `decodeAudioFile` (`:73`), but a recording arrives already
decoded. Extract `runTranscription({ audio, harmonicaType, algorithm, params?, … })` —
everything from `:77` down, unchanged — leaving `runAudioImport` as decode + call so
`scripts/verify-audio-import.ts` keeps its entry point.

## 13-3 · Widen the hand-off slot

`pendingImport.ts` holds a `PickedAudioFile` because a DOM `File` cannot travel through
router params. A retained take has the same problem, so the slot becomes a union:

```ts
type PendingImport =
  | { kind: 'file';    picked: PickedAudioFile }
  | { kind: 'decoded'; audio: DecodedAudio; title: string; truncated: boolean;
      algorithm: TranscriptionAlgorithmId; params: ParamValues }
```

The `decoded` variant carries the engine choice because the recording path asks for it
before navigating (13-7), so `/import` must not ask again. `kind: 'file'` carries no
choice and lands in the `choosing` phase instead. The guard at `import.tsx:186` branches
on the variant.

## 13-4 · Per-engine param schema

Extend `TranscriptionAlgorithm` (`algorithms/index.ts:54`), which already carries
`producesFrames` / `polyphonic` / `available` as per-engine capability flags the UI reads
instead of hardcoding. Add a declared param list — id, label, type, range, default,
`advanced?` — plus a two-phase pair so the tune screen never needs to know which engine it
is driving:

```ts
prepare(audio, options): Promise<Prepared>                 // expensive, once
resegment(prepared, params): Promise<TranscriptionOutput>  // cheap, per change
```

This also retires the hardcoded `DEFAULT_ALGORITHM_ID` at `import.tsx:278` — there has
never been a picker, despite the registry comment promising one.

**Basic Pitch** maps straight onto the existing `runInference` / `segment` split. Declared
params: onset threshold, frame threshold, minimum note length, Melodia trick. Deliberately
**not** min/max frequency — `basicPitch.web.ts:47-56` documents that constraining there
zeroes posteriogram bins before onset inference and the Melodia trick have run, and
measured worse against a reference Python run on the same recording.

**pMPM** declares the currently-frozen `DEFAULT_NOTE_DETECTOR_CONFIG` (`NoteDetector.ts:26`):
grace, confirm, min duration, min gap, envelope ratios. Plus hop as advanced —
`analyzeSamples.ts:22` pins `HOP = PITCH_WINDOW_SIZE` by choice, and its comment (`:18-19`)
says why: matching the offline hop to the live frame rate is what makes an uploaded file
segment into notes the same way a recording does.

**Asymmetry to design around:** pMPM's cheap half is key-dependent — it segments on tab
identity, which is exactly what makes trying all 12 candidate keys cheap
(`algorithms/index.ts:9`). Its tune preview therefore needs a key. The recording flow has
one; file import defers the key to conversion and does not. Recording gets full pMPM
tuning; import either uses the provisional key or hides those params. Basic Pitch has no
such constraint.

## 13-5 · Engine picker and tune step

**Neither of these is a new route.** The picker is a modal component with two hosts; the
tune step is a `Phase` variant of `/import`, exactly as `midiConfirm` already is. Net new
routes for the phase: zero.

`import.tsx`'s `Phase` union (`:73`) gains two variants, and the comment above it ("audio
has no confirm phase") must be rewritten rather than left to contradict the code:

```ts
| { kind: 'choosing' }   // renders the shared modal over a quiet backdrop
| { kind: 'tune'; prepared: Prepared; params: ParamValues; notes: MidiNote[] }
```

`choosing` exists only for the **file-import** path, which has no earlier moment to ask.
The recording path arrives with the choice already made (13-7) and skips straight to
`working`.

- On confirm, run `prepare` once with the existing progress/cancel wiring — the
  `loadingModel` stage already exists for Basic Pitch's first run per session.
- Param changes call `resegment` only, debounced ~150ms. Not free for Basic Pitch:
  `segment` defensively copies the frame and onset matrices on every call (`:239-241`,
  mandatory, since `outputToNotesPoly` → `constrainFrequency` zeroes bins in place), which
  is ~36MB transient on a 5-minute take.
- Preview with note count plus the piano roll. `previewNotes` (`import.tsx:126`) already
  builds `TabNote[]` with no harmonica mapping, so it works before any key is settled.
- **Release `prepared` when the step closes.** The Basic Pitch matrices are ~90MB at the
  5-minute cap (88 + 88 + 264 bins at ~86 frames/sec), which dwarfs the retained PCM in
  either format. This is the single biggest memory lever in the phase.

Two escapes, both free because pMPM ran live throughout:

- **"Use the live transcription"** → `router.replace('/edit')` with the `tabNotes` already
  in the session. This is today's behaviour preserved as a fast path, and the fallback when
  the model fetch fails — `runInference` already throws an actionable error for that
  (`:174-181`).
- **"Open with defaults"** → skip tuning entirely, releasing the matrices immediately for
  everyone who does not care.

### Screen A — engine picker (a modal, not a screen)

A bounded decision — two rows and two buttons — so it is a modal, not a phase layout.
`ConvertTrackModal` is the precedent: a real decision taken in a modal, with a scrolling
list and `maxHeight` + internal scroll so the actions stay reachable (`:157-159`).

**Two hosts, one component.** Being a modal is what makes that possible; a phase would
belong to whichever screen owned it.

- **Recording** — opens on Finish, before any navigation (13-7). The user stays with the
  take they just played instead of being bounced to a screen that immediately asks a
  question.
- **File import** — opens on mount during the `choosing` phase, over the header block with
  no progress bar, since there is no earlier moment to ask.

Inside, it reuses the `CandidateList` / `CandidateRow` pair the MIDI track chooser already
uses, which is correct semantically as well as visually: it is a radiogroup with
`accessibilityRole` already wired (`CandidateRow.tsx:30,67-69`).

```
  ╔══════════════════════════════════════════════╗
  ║  How should this be transcribed?             ║
  ║  Take 3 · 1:47                               ║
  ║                                              ║
  ║  ┌────────────────────────────────────────┐  ║
  ║  │ ● Neural transcription (Basic Pitch)   │  ║
  ║  │   Reads real recordings far more       │  ║
  ║  │   accurately, and hears chords and     │  ║
  ║  │   double-stops.                        │  ║
  ║  │   hears chords · slower · loads a model│  ║
  ║  ├────────────────────────────────────────┤  ║
  ║  │ ○ Classic pitch tracker                │  ║
  ║  │   One note at a time. Instant.         │  ║
  ║  │   single voice · instant · inspectable │  ║
  ║  └────────────────────────────────────────┘  ║
  ║                                              ║
  ║  The live pass already found 47 notes.       ║
  ║                                              ║
  ║  [ Transcribe ]   [ Use the live version ]   ║
  ╚══════════════════════════════════════════════╝
```

- One row per `availableAlgorithms()`. `title` is the engine's existing `label`, `subtitle`
  its existing `description` — both already written as user-facing copy, so no new strings.
- The third line is derived from the capability flags, not hand-written per engine:
  `polyphonic` and `producesFrames` become chips. Adding an engine later gets its chips for
  free.
- **The live-pass note count is the frame for the decision** and costs nothing — pMPM
  already ran. It is what tells a user whether the neural pass is worth waiting for. Shown
  only on the recording host; a file import has no live pass to report.
- No compute happens here, so moving between rows is instant and reversible.
- Dismissing the modal is not a third answer. On the recording host it returns to the take
  (nothing is lost — the PCM is retained and Finish can be pressed again); on the import
  host it returns to Home, matching what cancelling an import already does.

### Screen B — tune step (a phase, deliberately not a modal)

The substantial new UI, and the one place a modal would be wrong. This is a workspace, not
a decision: two columns, a piano roll that wants every pixel, minutes of continuous slider
work, and a recompute state whose whole requirement is that the preview stays stable while
you drag. A modal sized to hold that is a screen with a scrim over a screen you cannot see
— it pays the chrome and loses the space, and on the eventual native port a two-column
modal is not viable at all.

**The version that deletes this screen, and why it is rejected.** Transcribe on defaults
straight to the Studio, and put the params in a Studio side panel: one less surface, the
real editor as the preview, re-tunable any time. But re-segmenting replaces the note set
wholesale, and by the time that panel is reachable the user may have moved, trimmed or
deleted notes. Re-tuning would then silently destroy their edits, and the fix is a "this
discards your changes" confirmation on a slider drag. Tuning *before* the project exists
has nothing to destroy, which is exactly what makes the step cheap to interact with.

Two columns on web, stacked on native — same split the recording screen uses, and the
params rail takes the same 320px as its notes column (`recording.tsx:398`) so the two
screens agree.

```
   Transcribing Take 3 — 112 notes            [ ⟳ updating ]
  ┌────────────────────────────────┬──────────────────────┐
  │                                │ ONSET SENSITIVITY    │
  │                                │ ──────●─────  0.50   │
  │      piano-roll preview        │                      │
  │      (updates live)            │ NOTE CONFIDENCE      │
  │                                │ ────●───────  0.30   │
  │                                │                      │
  │                                │ SHORTEST NOTE        │
  │                                │ ──●─────────  58 ms  │
  │                                │                      │
  │                                │ [x] Follow melodic   │
  │                                │     lines            │
  │                                │                      │
  │                                │ › Advanced           │
  │                                │                      │
  │                                │ Reset to defaults    │
  └────────────────────────────────┴──────────────────────┘
   [ Open in Studio ]   [ Back ]   [ Use the live transcription ]
```

- Controls are `SliderInput` (`value`/`min`/`max`/`step`/`onChange`/`formatLabel` — already
  exactly the shape a declared param needs) plus switches for booleans. The schema from
  13-4 drives the rail; the screen renders whatever the chosen engine declares and knows
  nothing about either engine.
- **Labels are in the user's language, not the library's.** `onsetThreshold` is "onset
  sensitivity", `frameThreshold` is "note confidence", `minNoteLengthMs` is "shortest
  note", `melodiaTrick` is "follow melodic lines". The schema carries the label; the param
  id stays internal.
- Params marked `advanced` sit behind a collapsed disclosure — that is where hop lives for
  pMPM, with its recalibration caveat as helper text.
- Preview is the existing `PianoRoll`, fed by `previewNotes` (`import.tsx:126`), which
  already builds `TabNote[]` with no harmonica mapping and therefore works before any key
  is settled.

### States

The debounce makes this a four-state screen, and getting the recomputing state wrong is
what would make it feel broken:

1. **preparing** — the existing progress bar and `stageLabel`, unchanged.
2. **idle** — preview and note count current.
3. **recomputing** — **keep the previous preview on screen** and show a small inline
   indicator next to the count. Blanking the roll on every slider tick would strobe the
   whole screen while dragging.
4. **empty result** — params so strict that nothing survives. This must be an *inline*
   state with the reset affordance right there, never the error screen: the user is one
   slider-drag from a good result.

⚠️ **Code implication:** `runAudioImport` currently throws `AudioImportError('noAudio')`
when the output is empty (`runAudioImport.ts:80`). That is right for a one-shot import and
wrong for interactive tuning, where empty is an ordinary intermediate state. `resegment`
must return an empty result rather than throw; only the initial `prepare` keeps the throw.

### Component work this needs

**`SliderInput` has no accessibility props at all** — it is a pure `Gesture.Pan` control
with no `accessibilityRole="adjustable"`, no `accessibilityValue`, and no keyboard
handling. A rail built from it would be entirely keyboard-inaccessible on web, which is not
acceptable for the screen where the transcription is actually decided. It needs
`accessibilityRole="adjustable"`, `accessibilityValue`, `accessibilityLabel`, and
arrow-key increment/decrement by `step` when focused. This also fixes the existing
mic-sensitivity slider in Settings, so it is a general win rather than Phase 13 overhead.

## 13-6 · Land in the Studio

`openStudioFromAudio` (`import.tsx:322`) already does all of it: tempo estimate,
`projectFromMidiNotes`, frame parking under the project id, `saveProject`, and
`router.replace('/studio')`. One change is needed — the resulting project must carry
`source: 'recording'` rather than `'audioUpload'` (`RecordingSource`, `types/index.ts:117`),
so Frame Inspector reports the right origin.

## 13-7 · Recording screen

- **`handleStop` opens the engine modal instead of navigating.** Sequence: stop capture,
  flush the detector, read `takeRetainedPcm()`, show the modal. Only on confirm does it
  write the `decoded` hand-off (with the chosen engine) and push `/import`. "Use the live
  version" routes to `/edit` from here and never touches the import screen at all — which
  is today's behaviour exactly, so the fast path costs one extra tap and no new code path.
- `incrementRecordingCount()` moves out of `handleStop` (see Decisions below).
- The modal must open *after* the capture teardown, not before: the flush at
  `useAudioCapture.ts:97` is what commits the last note played, and the live-pass count
  shown in the modal would otherwise be short by one.
- Keep every `LiveAnalysisPanel` track. Reducing the live view to loudness would make
  recording worse in exchange for nothing: pMPM's cost is one NSDF pass over blocks that
  were captured anyway, and keeping it running is what provides the fallback above. Mark
  the NOTES track provisional, since Finish replaces it.
- Surface remaining time against the 5-minute cap, and a clear state when retention stops.

UI, concretely:

- **Elapsed becomes elapsed-against-cap.** `recording.tsx:141` renders a bare `0:00`; it
  becomes `2:14 / 5:00`, switching to `theme.warning` in the final minute. The take length
  now matters to the user because it bounds what can be transcribed, so it has to be
  visible before they hit the wall rather than after.
- **The NOTES header gets a "live" chip** next to its count (`recording.tsx:197-198`), with
  the empty-state copy extended to say the live read is provisional. Finish replaces these
  notes, and a user who spent the take watching them appear needs to know that before it
  happens, not after.
- **Retention-stopped notice** when the cap is reached: the `noticeRow` + warning-icon
  pattern the import screen already uses for the octave-shift notice. Recording continues
  and the live HUD keeps working — only retention stops — so the copy must say exactly
  that, or it reads as "recording stopped".
- Everything else on the screen is unchanged. In particular the four `LiveAnalysisPanel`
  tracks all stay.

## 13-8 · Settings

`useSettingsStore` gains: default engine, last-used params **per engine** (so the tune step
opens where the user left it), and the Int16 retention toggle from 13-1 — off by default,
described in terms of longer takes rather than bit depth.

Sample rate stays out. It looks like a storage control but is a transcription-quality
control: lowering it halves the live frame rate, which pushes `confirmMs: 40` and
`minDipMs: 50` below a single frame and silently degrades onset timing with nothing on
screen connecting the two. If a user-facing storage knob is wanted, the honest one is
**maximum take length**, which is the linear lever on both the PCM and the matrices.

UI: a new **Transcription** section on `settings.tsx`, matching the existing card/row
layout the mic-sensitivity control sits in.

- **Default engine** — the segmented-control idiom already there for theme
  (`THEME_SEGMENTS`, `settings.tsx:14`), or `CandidateList` if the descriptions are worth
  showing twice. Segmented is probably right; the picker screen is where descriptions
  belong.
- **Maximum take length** — `SliderInput` with `formatLabel` in minutes.
- **Smaller recordings in memory** (the Int16 toggle) — a switch, off by default, described
  as what it does for the user ("keeps longer takes without using as much memory") and not
  as a bit depth. This is the one control here where the honest framing is the whole point:
  it must not read as a quality setting, because it is not one.
- **Reset transcription settings** — clears the per-engine saved params. Necessary because
  those persist silently across sessions, so a user who tuned themselves into a corner
  three takes ago has no other way back.

## 13-9 · Verification

Extend `scripts/verify-audio-import.ts` to drive `runTranscription` from a synthesized
`DecodedAudio` (`scripts/make-test-wav.ts` already exists), asserting:

- Re-segmenting one `prepare` at several param sets gives stable, monotonic note counts.
  This is the property the whole tune step rests on, and the in-place-zeroing hazard is
  exactly the kind of bug that would break it silently.
- Int16 round-trip through `takeRetainedPcm` does not move detected pitches.
- Any hop change is measured, not assumed.

UI checks, in the spirit of the per-viewport testing Phase 12 uses:

- The tune step at 1280×640 — the params rail must scroll internally while the footer
  actions stay reachable, the same failure the convert modal hit at that height.
- Drag a slider continuously and confirm the preview never blanks between updates. This is
  the state-3 requirement above and is invisible in a screenshot.
- Drive the whole tune step by keyboard alone, after the `SliderInput` accessibility work.
- Park every param at its extreme to reach the empty-result state and confirm it renders
  inline with a reset, rather than falling through to the error screen.
- Per project convention, restart the web dev server with `--clear` and confirm the served
  bundle reflects the change before browser-testing.

## Decisions still needed

1. **Where the free-tier session is consumed.** Today `handleStop` calls
   `incrementRecordingCount()` (`recording.tsx:117`), so a take costs a session the moment
   the user stops playing. The Studio path deliberately does not: `import.tsx:313` states
   the gate belongs at conversion, "where a tab is actually produced", and `commitMidi`
   spends it there (`:419`). Matching import makes **recording free until conversion**, and
   a user could record, tune and export MIDI from the Studio without spending a session.
   Recommendation: match import — consistency wins and conversion is the honest moment —
   but this is a monetization call, not a refactor.
2. **Whether pMPM stays a user-visible choice** once Basic Pitch is the default and the
   live HUD covers the "am I being heard" job, or becomes an invisible fallback only.
3. **Whether the retained take should persist.** As planned above it is memory-only: held
   in the capture module, handed through `pendingImport`, released after the tune step. A
   browser reload between Finish and Open loses it, and "re-transcribe this recording with
   different settings" from the library is not possible later. Persisting it needs a new
   IndexedDB store keyed by recording id — `storage.ts` is localStorage and caps around
   5MB, which a take of any length blows past immediately. Recommendation: ship
   memory-only, and treat persistence as its own item once the flow has proven itself.

## Suggested build order

1. **13-1** — the blocker; nothing else is testable until the take is retained.
2. **13-2 + 13-3** — pure seams, no UI, independently verifiable.
3. **13-4** — the schema, with Basic Pitch's params implemented first (its split already
   exists) and pMPM's after.
4. **`SliderInput` accessibility** — small, self-contained, and a hard prerequisite for
   Screen B being usable. Also fixes the existing Settings slider, so it stands alone even
   if the rest of the phase slips.
5. **Screen A (the engine modal)** — a `CandidateList` in a `Modal`, no new pipeline
   behind it. Ship it on the import host first, where it replaces the hardcoded
   `DEFAULT_ALGORITHM_ID`: that is a complete, user-visible improvement to file import on
   its own, independent of anything in 13-1.
6. **Screen B (the tune phase)** — the substantial UI, once the schema and the modal exist.
7. **13-6 + 13-7** — Studio routing and the recording screen, which is where the modal
   gains its second host.
8. **13-8 + 13-9** — settings persistence and the harness.

Note that steps 4–5 deliver value without 13-1: an engine picker and accessible sliders
improve file import whether or not take retention ever lands. If the phase has to be cut
short, cut from the front of the pipeline work, not from these.

One copy item that falls between steps: the progress screen's hint
(`import.tsx:807-810`) currently asserts "Pitch detection doesn't need the key — the
harmonica key is worked out afterwards." That stays true for Basic Pitch but not for a
pMPM tune preview launched from a recording, where the key drives segmentation. The string
becomes engine-dependent when 13-4 lands.

## Phase 14 — Spectral polyphonic transcription (FFT), a third engine

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

---

# Phase 15 — Native port scope (decision deferred, added 2026-08-12)

**This phase exists to hold a decision, not to schedule work.** Every phase above is planned
web-first per `feedback_web_first_no_mobile_hedging`, and several of them ended with a
native question parked at the bottom (Phase 7's 7-14, Phase 11's "native is a later port
that may drop features", Phase 5c, Phase 13's native no-ops). Those questions are collected
here rather than answered one at a time inside phases that are really about something else.

**The decision itself is Theo's and is explicitly not being taken now**: which features get
ported to native at all. Nothing below should be read as a commitment to port anything. The
inventory and the suggestions are raw material for that decision.

**Do not let this phase become a reason to hedge web work.** The rule stands: build the web
product properly, decide the native subset afterwards. A feature being hard to port is not
an argument against building it on web.

## 15-A · The two Play Store obligations that accounts create — deferred here
*Added 2026-08-13, by the user's decision, while finishing 7-13.*

Both were originally scoped as Phase 7 release blockers. **Neither is due until native gets
accounts**, because both describe the *Android app*, and the Android app collects no account
data: `isFirebaseConfigured()` returns `false` in `src/auth/firebase.ts`, so the auth listener
never starts on native and every auth function throws. Accounts are web-only until 7-14, which
is this phase's decision to make.

They are recorded here so that deciding "native gets accounts" cannot happen without them
coming with it. **Shipping native auth without both is a policy violation on a live app.**

1. **Play Console Data safety re-declaration.** The form must then declare collection of email
   addresses and user IDs, linked to identity. Today declaring them would be *inaccurate in
   the other direction* — the app would be claiming to collect what it does not, which is its
   own kind of wrong answer on a compliance form.
2. **A publicly reachable account-deletion URL**, required by Play's data-deletion policy for
   any app offering accounts. Needs a stable public origin, so it is also gated on the domain
   purchase (`TODO(domain)`) — the two deferrals overlap and should be resolved together.

**Already done and not deferred:** `PRIVACY_POLICY.md` was updated on 2026-08-13 for web
accounts (account information collected, Firebase Authentication as a processor, self-service
deletion and export under GDPR, and an explicit statement that the Android app has no
accounts). The policy covering more than the Android app does is normal and needs no Play
change by itself.

## The state of native today — measured, not assumed

Checked against the code on 2026-08-12, because the plan text above understates native in
several places. Native is in better shape than "unported" and worse shape than "works".

| area | native today | evidence |
|---|---|---|
| Live recording + pitch detection | **Real, and better than web** — Oboe + C++ MPM at 50Hz | `src/native/AudioCapture.ts` |
| Playback + metronome | **Real, different design** — pre-renders the whole sequence to a WAV via `synthesizeWav` and plays the file, since there is no `OscillatorNode` | `src/native/Playback.ts:8-10` |
| MIDI import | **Real** — `expo-file-system` reads the bytes, and the rest of the pipeline is pure TS | `src/audio/readFileBytes.ts` |
| Audio import | **WAV only** — Expo 55 exposes no compressed-audio decoder | `src/audio/decodeAudio.ts:1-8` (Phase 5c) |
| Neural transcription | **Unavailable** — `available: false`, registry hides it and falls back to pMPM | `src/audio/algorithms/basicPitch.ts:18` |
| In-app purchase | **Real on native, stubbed on web** — the one inversion | `src/hooks/useIAP.web.ts` |
| Persistent top bar | **Does not exist** — returns `null` | `src/components/TopBar.tsx` |
| Everything else (Home, Edit, Piano Roll, Studio, Import, Frame Inspector) | **Renders, unverified** — the `Platform.OS` branches in these screens are layout and hover concerns, not feature gates, so the screens do mount on native. Nobody has driven them on a phone. | `edit.tsx:391`, `studio.tsx:773`, `frame-inspector.tsx:979` |

**The one concrete functional break already visible:** the Studio parks its Export action in
the global `TopBar` through `useHeaderActionStore`, and uses the Harp2Tab logo as the way
back to the library (Phase 11's notes say so explicitly). `TopBar` is `null` on native. So
**the MIDI Studio on native currently has no Export button and no way back** — not a layout
problem, a dead end. Whatever this phase decides, that is the shape of the work: the web
build made reasonable use of a chrome that native does not have.

## What this phase must decide

For each feature: **port as-is · port redesigned · drop on native · defer**. The useful unit
is the feature, not the file — several features are already 90% portable TypeScript sitting
behind one platform-specific edge.

## Feature inventory, with suggestions

Suggestions only. Each is a starting position to argue with, not a recommendation to adopt.

### Likely ports cleanly — the pipeline is pure TypeScript
- **Tab editing (list view)** — already the native app's main screen today. Ports as-is.
- **Export, all five formats** — `generators.ts` is pure; `expo-sharing` and `expo-file-system` are already dependencies and already used. Ports as-is.
- **MIDI import → tab** — the whole Phase 6 path is platform-agnostic once bytes are read, and reading them already works.
- **Home-as-library** — `useRecordingsStore` uses the AsyncStorage shim; nothing web-specific in the data.
- **Phase 14's spectral engine, if it ships** — pure TypeScript by design, no model download, no TensorFlow. **It would be the first polyphonic engine native could run**, which is a real argument for Phase 14 that has nothing to do with accuracy.

### Need a native answer before they can be ported
- **The MIDI Studio's chrome** — the `TopBar` problem above. Either give native a real header, or give the Studio its own (which Phase 11 explicitly decided against on web). This is the single largest unresolved native question in the app.
- **Piano roll on a phone screen** — drag-to-move/resize at finger precision, on a pitch ladder that is already tight on a laptop. The arrow-key nudge accessibility path (Phase 4) has no touch equivalent. Suggestion: a tap-to-select + numeric-inspector model rather than a scaled-down drag surface, reusing the list view's precision editing for the fiddly parts.
- **Two-column layouts** — recording, import's tune step, edit's sidebar (`edit.tsx:391` is web-only already). All specified as "stacked on native" in the plans above; none built or tried.
- **Audio import beyond WAV** — Phase 5c, a MediaCodec/AVFoundation Expo module. Suggestion: worth it only if audio import is judged a core native feature; if native is mostly a recording companion, WAV-only plus a clear message is a defensible permanent answer.
- **Neural transcription** — `tfjs-react-native`, or a native Core ML / TFLite path, or accept that native transcribes with pMPM and the spectral engine. Suggestion: do not port Basic Pitch. The download, the memory and the second stack are a poor trade on a phone, and Phase 14 may make the point moot.
- **Frame Inspector** — the zoomable multi-track visualisation is a wide-screen tool. Suggestion: defer, or ship a cut-down single-track version.

### Probably drop, or web-only by nature
- **The landing page and SEO** (12-3) — web-only by definition.
- **`/profile` and accounts** (Phase 7) — genuinely open, and Phase 7's own open question 4. Native is where the paying users currently are, but Play Billing already owns the purchase flow, so the subscribe-time gate has a different shape there.
- **Cloud sync** (7b) — no technical blocker at all (the merge engine is pure), purely a question of whether native accounts exist.
- **Hover-dependent affordances** — tooltips, hover states, the drag handles that appear on hover. These need touch equivalents or removal; they cannot simply be ported.

### Things native could do that web cannot — worth considering as native's reason to exist
- **Receive files from the system share sheet** — "Open with Harp2Tab" on an audio or MIDI file from Files, Voice Memos, WhatsApp. `expo-linking` is already a dependency; this is intent filters on Android and a document type on iOS. Arguably the strongest native-only feature available, and it turns the app into a destination rather than a place you go.
- **Keep the screen awake while recording** — `expo-keep-awake` is already installed.
- **Haptic feedback on note detection or metronome beats** — `expo-haptics` is already installed. Cheap, and it is the kind of thing that makes a mobile app feel native rather than wrapped.
- **Background or lock-screen recording** — real work, and the honest question is whether anyone records a harmonica with their phone in their pocket.
- **Better microphone access** — native already has the superior capture path (Oboe, low latency, real C++ MPM). If native's positioning is "the recording device", that is the feature to lead with.

## Relationship to Phase 9 (iOS)

They are different questions and should stay separate. **Phase 9 asks whether iOS exists at
all** — it is a capture-bridge spike (`AVAudioEngine` tap emitting the same `{frequency,
rms}` shape) plus store setup. **Phase 15 asks what any native platform contains.** Phase 15's
answer applies to Android too, where the app is already live.

Sequencing suggestion: settle Phase 15 first. Building iOS before deciding what native *is*
means porting by default, one screen at a time, which is how a second platform quietly
doubles the maintenance surface of every future phase.

## Open questions — the ones the decision turns on

1. **What is native for?** Three coherent answers, and they imply very different subsets: a
   full peer of the web app; a *recording companion* that captures takes and hands them to
   the web app to edit; or a *viewer* for a library built elsewhere. The companion answer is
   the one the code is already closest to, and the one that plays to native's genuine
   advantage — it has the better microphone path.
2. **Does the existing live Android app get upgraded to the web feature set, or does it stay
   as it is?** It currently has none of the library, import or Studio work
   (`project_live_app_vs_web_branch`). "Leave it be and put new work on web" is a legitimate
   answer for a solo developer, and it should be considered explicitly rather than by
   default.
3. **Does native get accounts?** Phase 7's open question 4, restated. Everything downstream
   of it — sync, entitlement portability, `/profile` — follows from the answer.
4. **Who maintains parity?** Every phase after this one gains a "and on native?" cost. If the
   answer to (1) is "full peer", that cost is permanent and should be priced in before
   agreeing to it.

## Cross-cutting technical risks (apply across phases, not phase-specific)
- **`nsdf`/clarity is typed but never populated.** `AudioFrame.nsdf` exists in the type but Android's Kotlin module never sets it and web hardcodes `0`. Frame Inspector (Phase 2) only has real `frequency`/`rms`/post-hoc `confidence` to show — a genuine pitch-clarity track would need new native + JS work, not just wiring up an existing value.
- **No native PCM-decode-from-file API exists** — a real gap for Phase 5a, not a config detail.
- **Monetization migration (Phase 7/8) carries real user-facing risk** (existing paying customers) — treat the grandfathering step as a first-class deliverable with its own testing, not a footnote.

## Verification approach (per phase, not a single end-of-plan step)
- Phases 0–2: unit-test the new `NoteDetector` timestamp-parameterized `process()` against the existing synthetic sine-wave harness already used to validate `pitchDetector.ts`, to confirm behavior is unchanged for the live-recording path after the refactor.
- Phase 1: manually verify a full record → edit → "New Recording" cycle produces a `TabRecording` in the library before state resets, on both native and web.
- Phase 2: cross-check Frame Inspector's rendered tracks against a live recording's actual committed `TabNote`s for the same session.
- Phase 3–4: playback correctness verified by ear against known recordings; piano-roll pitch-snap verified against `HarmonicaMapper` for at least one diatonic and one chromatic key.
- Phase 5–6: verify against a handful of known-good sample audio/MIDI files with hand-checked expected tab output.
- Web-affecting phases: always start the dev server with `--clear` and confirm via `curl` that the served bundle reflects the change before browser-testing (per existing project convention).
