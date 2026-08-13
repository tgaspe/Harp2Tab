# Phases 0-5 - Foundation, Frame Inspector, Playback, Piano Roll, Audio Upload

*Part of the [Harp2Tab implementation plan](README.md).*

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

## Phase 5 — Detailed implementation plan (written 2026-08-01)

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
