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
> - [ ] Phase 7 — User accounts (Firebase Auth)
> - [ ] Phase 8 — Better monetization + remaining web billing
> - [ ] Phase 9 — iOS version
> - [ ] Phase 10 — Improve web UI polish
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

## Phase 8 — Better monetization + remaining web billing
- RevenueCat + Stripe integration per the already-locked pricing/architecture decisions (see `project_web_version_plan` memory).
- **Joint Phase 7/8 deliverable, not solely Phase 8's**: grandfathering existing `react-native-iap` Play Store lifetime buyers is an identity-linking problem — an existing anonymous Android purchaser has no Firebase UID until their first login. Needs an explicit reconciliation step (RevenueCat's Play-Store-purchase import tied to first sign-in, or a manual backfill), not something that falls out of the RevenueCat SDK integration by itself.

## Phase 9 — iOS version
- The JS `pitchDetector.ts` port is already proven platform-agnostic (it's what web uses) — reuse it rather than porting the C++/Oboe MPM math to Swift.
- What's still needed: a small native audio-capture surface, since neither `expo-audio` nor `expo-av`'s recording APIs expose live raw-PCM frame callbacks *during* recording on iOS (they're file/segment-oriented). Spike a small bridge — a Swift `AVAudioEngine` tap, or a small Expo Module — that emits `{frequency, rms}` in the same shape Android's Kotlin module does, then feed that into the existing JS pipeline unchanged.

## Phase 10 — Improve web UI polish
- Lowest risk, can slot in anywhere; sequenced last as cleanup. Deferred hover states on `TabCard` fields, `KeyGrid` cells, `ExportOption` rows, segmented toggles.
- Optional tech-debt note to address here or separately: the web capture module uses `ScriptProcessorNode`, while the README's own "Web Version Plan" describes an `AudioWorklet` approach — the shipped code and the documented plan disagree; worth reconciling or updating the doc.

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

**Decision needed:** a separate `/profile` route, or a section at the top of Settings.
Recommend a section in Settings until there is enough there to justify a route.

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
