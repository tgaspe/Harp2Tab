# Phase 6 — MIDI upload → tab conversion

*Part of the [Harp2Tab implementation plan](README.md).*

Lower-risk than Phase 5 (deterministic parsing, no DSP/codec uncertainty) and shares only `expo-document-picker` with it — can be built before or in parallel with Phase 5 rather than strictly after.
- New dependency: a pure-JS MIDI parser (e.g. `@tonejs/midi` or `midi-file`).
- Transposition uses `noteToTab(note, key, harmonicaType)` — confirmed the correct function (not `frequencyToTab`, which is for raw detected frequencies). `HarmonicaMapper`'s per-key tables are sparse (gaps exist, e.g. no entry for MIDI 85 in `C_DIATONIC`) and scoped to roughly the harmonica's native octave range — arbitrary uploaded MIDI will span wider octaves than the tables cover. Needs an explicit octave-folding/best-fit pre-pass plus a defined fallback for unmappable notes (drop / snap-to-nearest / flag-as-impossible) — a real design decision, not a drop-in call.
- Overblow/bend highlighting is nearly free: tab strings already self-encode this (`"1o"` = overblow, `"-1'"`/`"-3''"`/`"-3'''"` = single/double/triple bend) — a substring check is sufficient for the UI.
- Accessibility: real "browse files" button alongside any drag-and-drop zone, not drag-and-drop-only (same commitment as Phase 5's upload UI).

---

## Phase 6 — Detailed implementation plan (written 2026-08-01)

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
