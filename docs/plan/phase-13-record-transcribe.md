# Phase 13 — Record → transcribe → Studio (neural transcription for live takes)

*Part of the [Harp2Tab implementation plan](README.md).*


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
