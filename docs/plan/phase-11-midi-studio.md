# Phase 11 — MIDI Studio (multi-track DAW)

*Part of the [Harp2Tab implementation plan](README.md).*

Port Signal's editor surface into the app as a second editing stage, so a user can open a MIDI file in a real multi-track editor, work on it, and convert any track (or tracks) into harmonica tabs. Decided with the user 2026-08-01 after establishing that the existing piano roll is already explicitly modelled on Signal (`PianoRoll.tsx:419` "matches Signal's mouseMode split", `:562`, `:395`) and already carries most of a MIDI editor's interaction surface.

---

## Phase 11 — Detailed implementation plan (written 2026-08-01)

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
