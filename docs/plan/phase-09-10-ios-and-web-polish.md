# Phases 9-10 - iOS version and web UI polish

*Part of the [Harp2Tab implementation plan](README.md).*

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
