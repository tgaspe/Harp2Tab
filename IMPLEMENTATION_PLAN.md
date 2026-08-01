# Harp2Tab — Full Roadmap Implementation Plan

> Status as of 2026-07-30: Phases 0–4 are implemented and merged into `web_version`
> (commit `cb8067a`). Phases 5+ are still just this plan — not started.
>
> - [x] Phase 0 — Recording-session foundation
> - [x] Phase 1 — Home-as-library + recording history
> - [x] Phase 2 — Frame retention plumbing + real Frame Inspector
> - [x] Phase 3 — Playback (+ metronome, added beyond the original scope below)
> - [x] Phase 4 — Piano-roll editor (+ desktop-native toolbar redesign, added beyond the original scope below)
> - [x] Phase 5 — Audio upload (5a decode/pipeline, 5b auto key detection); 5c native
>       compressed-audio decode deferred
> - [ ] Phase 6 — MIDI upload → tab conversion (detailed plan written 2026-08-01, below)
> - [ ] Phase 7 — User accounts (Firebase Auth)
> - [ ] Phase 8 — Better monetization + remaining web billing
> - [ ] Phase 9 — iOS version
> - [ ] Phase 10 — Improve web UI polish
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
