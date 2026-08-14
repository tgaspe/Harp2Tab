# Phase 7b — The sync engine

*Part of the [Harp2Tab implementation plan](README.md). Expands 7-10 and 7-11 of
[phase-07-accounts.md](phase-07-accounts.md) against the code as it stands on `web_version`.*

Written 2026-08-14. **Built 2026-08-14 — see [Status](#status) at the foot of this file for
what shipped, what changed on contact with the code, and the two things that still gate
`SYNC_ENABLED`.**

7a shipped the account. This is the thing the account was for: a library that follows the
user to another device. Everything below is the same design 7-10 and 7-11 settled — whole-
document last-write-wins, opaque payloads, tombstones, no live listener — expanded to the
level where it can be built, plus the five details those sections left implicit and one trap
they named but did not solve.

---

## Why this is being built now rather than after Phase 8

**The rule said "7b ships after Phase 8". That rule is void, and it was void within a day of
being written.**

1. **The release sequence, decided 2026-08-13, inverted the order.** `README.md:8` —
   *"Monetization ships last — the product is finished first, then it is monetized."*
   Hold both rules at once and sync becomes one of the last things in the roadmap: after the
   domain, hosting, the landing page, the legal pages, and all three of 8b/8c. Nobody
   reconciled the two decisions because they were taken a day apart in different documents.

2. **Its stated premise was already dead when it was written.** The rationale was *"under the
   subscribe-time signup model there is nobody with an account to sync until billing exists"*
   (`README.md:48`). Two other decisions from that same 2026-08-12 session removed the
   premise: accounts are **offered voluntarily anywhere** (7-6's voluntary door) and **free
   accounts get sync** (`phase-07-accounts.md:223`). Signup does not wait for billing. Anyone
   can create an account today and receive nothing for it.

3. **The soak argument points the other way.** The real reason for caution is stated at
   `phase-07-accounts.md:930`: this is *"the one module in the phase where a silent bug
   destroys user data"*, so it wants time running against real libraries before anyone
   depends on it. That argues for building it **early**, so it soaks across Phases 9/10/12 —
   not for shipping it cold, next to a paywall, at the end.

4. **Nothing has to be waited for.** `firebase.json` already runs a Firestore emulator on
   8080, the rules for every path this phase writes are already written and already tested by
   `scripts/verify-firestore-rules.ts` (*"Runs against the emulator, so nothing here touches
   the real project"*), and `merge.ts` is specified as a pure function — no network, no
   emulator, no account, no billing.

5. **This is the cheapest moment there will ever be.** `main` is live in production and has
   no accounts at all (`isFirebaseConfigured()` is `false` on native). `web_version` has
   never been deployed anywhere (`README.md:28`). There are, right now, zero users whose
   library a merge bug could damage. That will not be true again.

> **Outstanding for the user:** `README.md:48` still reads "7b ships after Phase 8", and the
> release sequence at `README.md:8` still says monetization ships last. One of those two
> lines needs editing to match whichever order is now real. This plan assumes 7b is built
> next; it does not edit that decision text.

---

## What already exists

More than the phase file implies. 7a deliberately front-loaded the parts of 7b that were
cheap to land early, and every one of them is in place:

- **`TabRecording.updatedAt` is real and has been accumulating history.** `types/index.ts:87`
  documents it as shipped a phase early *precisely* for this; `useRecordingsStore.ts:27`
  stamps it centrally in `touch()`; `recordingsMigration.ts:85` is the v3 that seeded it from
  `createdAt`; `scripts/verify-recordings-migration.ts` drives that migration with
  hand-authored payloads.
- **`MidiProject.updatedAt`** is stamped by the equivalent `touch()`
  (`useMidiProjectsStore.ts:35`), and `renameProject` stamps it inline (`:60`).
- **The Firestore rules for every path this phase writes.** `/users/{uid}/tabs`,
  `/projects`, `/settings` and `/deleted` are owner-only and `confirmed()`-gated;
  `/entitlements/{uid}` is read-only to the client at a deliberately disjoint path. Tested.
- **`firestore.indexes.json` is empty**, and this phase keeps it empty — see 7b-4.
- **`SyncStatusRow`** exists, handles all six states including `discarded`, and is already
  mounted at `profile.tsx:498`. Its `onSyncNow` prop is optional *because* 7a had no engine
  to call.
- **`SyncState` / `SyncStatus`** (`auth/types.ts:58-80`) are the full vocabulary, including
  `discarded: { title, at }` for the LWW disclosure.
- **`useAuthStore.lastUid`** is persisted across sign-out (`useAuthStore.ts:37`), written in
  7a with an explicit note that it exists for 7-11 and *cannot be reconstructed later*.
- **The dynamic-import precedent.** `entitlement.web.ts:46` does
  `await import('firebase/firestore')` inside the call, and its header says every future
  Firestore consumer — *"7b's sync engine especially"* — should reach it the same way, so the
  chunk stays out of the initial bundle. `firebase.web.ts:13` says the same from the other
  side.
- **The project wire format, already solved.** `serializeProject`/`deserializeProject`
  (`audio/midiProject.ts:253`, `:273`) already turn a `MidiProject` into a flat
  `StoredProject` with base64 SMF and a `trackMeta` sidecar. That is the payload; this phase
  does not invent a second one.
- **The trap, already named.** `useRecordingsStore.ts:21-25` warns in prose that the engine
  **must not** write through `saveRecording`, because `touch()` would restamp a downloaded
  record to now and defeat the comparison it was downloaded for. 7b has to solve that; 7a
  made sure it would be seen.

## What genuinely does not exist

- **`src/sync/` — nothing at all.** Four of the five files below are new.
- **A store entry point that preserves `updatedAt`.** The named trap has no solution yet.
- **Any record of what was deleted.** `deleteRecording` (`useRecordingsStore.ts:43`) and
  `deleteProject` (`useMidiProjectsStore.ts:55`) filter the array and leave nothing behind, so
  there is currently no way for the engine to distinguish "deleted here" from "not yet
  pulled". Tombstones need a source.
- **`adoptedUids`** — `useAuthStore`'s `partialize` persists `lastUid` and nothing else
  (`useAuthStore.ts:78`).
- **A foreground trigger.** Nothing in the tree listens to `visibilitychange` for app
  purposes; the only mention is a comment about Firebase's own IndexedDB bug
  (`firebase.web.ts:91`).
- **A version stamp on `useSettingsStore`** — it persists with no `version` and no `migrate`
  (`useSettingsStore.ts:103-106`), which constrains how settings can start syncing.

---

## The shape

```
                          ┌───────────────────────────────────────────┐
   every screen  ────────►│  useRecordingsStore / useMidiProjectsStore │
   (unchanged, sync)      │  useSettingsStore                          │
                          └───────────────▲───────────────────────────┘
                                          │  applyRemote* / delete-from-remote
                                          │  (preserve updatedAt — never touch())
                          ┌───────────────┴──────────┐
                          │      syncEngine.ts       │  the only file that awaits the network
                          │  single-flight, triggers │
                          └───┬──────────────────┬───┘
                     plan     │                  │   wire
                    ┌─────────▼───────┐   ┌──────▼──────────┐
                    │    merge.ts     │   │    wire.ts      │
                    │  PURE. no I/O.  │   │ doc ⇄ payload   │
                    └─────────────────┘   └──────┬──────────┘
                                                 │  dynamic import('firebase/firestore')
                                          ┌──────▼──────────┐
                                          │    Firestore    │
                                          │  /users/{uid}   │
                                          └─────────────────┘
```

**The rule from 7-10 holds unchanged: no screen ever reads Firestore.** `index.tsx`,
`edit.tsx` and `studio.tsx` are untouched by this phase. If a component ends up needing an
`await`, the boundary is in the wrong place.

**`src/sync/`**

| file | what it is | tested by |
|---|---|---|
| `types.ts` | wire shapes, `Tombstone`, `MergePlan` | — |
| `merge.ts` | **pure**: `(local, remote, tombstones, now) → plan` | `verify-sync-merge.ts` (no network) |
| `wire.ts` | document ⇄ payload, both directions, both kinds | `verify-sync-merge.ts` (round-trip) |
| `syncEngine.ts` | orchestration; the only file that awaits | emulator + two-browser pass |
| `useSyncStore.ts` | `SyncStatus`, `lastPulledAt`, single-flight flag | — |

---

## 7b-1 · The wire format

Per 7-10's opaque-payload decision, and for the reason measured there: Firestore charges
every field *name* in every array element, so a 3,000-note `tabNotes` array as expanded maps
is ~50 KB of repeated keys on every read and every write, forever.

**`/users/{uid}/tabs/{id}`**

```ts
{
  id:            string,   // columns: enough to list and reconcile without downloading bodies
  title:         string,
  createdAt:     number,
  updatedAt:     number,
  duration:      number,
  favorite:      boolean,
  source?:       string,
  schemaVersion: number,   // ← new, see below
  payload:       string,   // JSON.stringify(TabRecording minus `frames`)
}
```

**`/users/{uid}/projects/{id}`**

```ts
{
  id, title, createdAt, updatedAt, durationMs, origin?, schemaVersion,
  payload: string,         // JSON.stringify(StoredProject) — base64 SMF + trackMeta, as today
}
```

**`/users/{uid}/settings/prefs`** — one document, see 7b-6.

**`/users/{uid}/deleted/{id}`**

```ts
{ deletedAt: number, kind: 'tab' | 'project' }
```

`kind` is load-bearing: the rules put tabs and projects under one `deleted` collection, and
the engine has to know which store a tombstone applies to without fetching the (now absent)
document.

### `schemaVersion` — an addition to 7-10, and the one that prevents a whole class of loss

`RECORDINGS_SCHEMA_VERSION` already exists locally and already drives `migrateRecordings`.
The cloud has no equivalent, and without one this happens: a device on a newer app version
writes a v5 payload; a device still on v4 pulls it, parses it as v4, and — because the merge
then *pushes* whatever it holds — writes the misparsed result back over the good copy. The
loss is silent and it originates on the older device, which is the one least likely to be
looked at.

The rule: **a document whose `schemaVersion` exceeds this client's is never applied and never
overwritten.** It is skipped, counted, and surfaced as `SyncStatus.state = 'error'` with copy
that says the app needs updating. Documents at or below the client's version run through
`migrateRecordings` exactly as a local payload does — which is free, because that function is
already pure and already takes a version argument.

### `frames` are stripped on the way out, and not merged back in on the way in

7-10's measurement: 112 KB per recording, 78% of a typical document, feeding one debug
screen. `wire.ts` deletes the key on serialize.

The consequence needs copy, and `phase-07-accounts.md:302` already flagged it: Frame
Inspector's empty state currently distinguishes "no frames retained" from "never had audio",
and now needs a third case — *"this take's frames are on the device it was recorded on"* —
or it will tell a lie it currently only tells by accident. **That copy is in this phase's
scope**, not a follow-up.

One subtlety the phase file does not state: when a remote document is applied over a local
one that *does* have frames, the frames are lost locally. Applying means the remote copy won,
so its body is what the user wants — but silently dropping a 112 KB debug artefact is the
kind of thing that gets rediscovered as a bug. **Keep the local `frames` when applying a
remote document with the same `id`**: they describe the same take, they are not part of what
LWW is arbitrating, and preserving them costs one line in the apply path.

---

## 7b-2 · `merge.ts` — pure, generic, and the harness target

Same reasoning as `recordingsMigration.ts` and `convertTrack.ts`: a merge that only runs
inside a live store against a real Firestore is a merge nobody can test before it ships.

```ts
export interface Syncable { id: string; updatedAt: number }

export interface Tombstone { id: string; deletedAt: number; kind: SyncKind }

export interface MergePlan<T> {
  toApply:       T[];            // remote wins → write into the store, timestamp preserved
  toPush:        T[];            // local wins → upload
  toDeleteLocal: string[];       // a tombstone beat the local copy
  toPushTomb:    Tombstone[];    // local deletions the cloud has not seen
  toDropTomb:    string[];       // tombstones that expired, or that a recreation superseded
  discarded:     { id: string; title: string; at: number }[];  // what LWW threw away
}

export function mergeDocuments<T extends Syncable>(
  local: T[], remote: T[], tombstones: Tombstone[], now: number,
): MergePlan<T>
```

**`now` is a parameter, not `Date.now()`.** Tombstone expiry is time-dependent, and a pure
function that reads the clock is not testable at the boundary — which is exactly where the
90-day rule needs testing.

**Generic over `T`, so tabs and projects share one implementation.** They differ only in
their wire mapping, which is `wire.ts`'s job. Settings are a single document, not a
collection, and do not go through this function (7b-6).

### The decision table

Extends 7-10's six rows with the four cases it left implicit — three of which are the ones
that lose data.

| local | remote | tombstone | result |
|---|---|---|---|
| present | absent | none | **push** |
| absent | present | none | **apply** |
| present | present | none | higher `updatedAt` wins, whole document; loser → `discarded` |
| present | present | tie | **remote wins** — deterministic, and in practice a re-push of identical content |
| present | any | newer than the doc | **delete locally**, keep the tombstone |
| absent | present | older than the remote doc | remote was **recreated** after the delete → apply, and drop the tombstone |
| present | absent | older than the local doc | local was **edited after** the delete propagated → push, and drop the tombstone |
| absent | absent | any | drop the tombstone if expired; otherwise carry it |
| present | absent | tombstone older than `now − 90d` | **push**, drop the tombstone — expiry means the cloud has forgotten the delete |
| any | any | `schemaVersion` > client | **skip entirely** — no apply, no push, no delete (7b-1) |

`discarded` exists to satisfy the disclosure decision at `phase-07-accounts.md:262`: LWW
resolves a genuine conflict by throwing one side away, and *"the failure mode of doing that
quietly is a user who concludes the app ate their edit"*. The engine surfaces the most recent
entry through `SyncStatus.discarded`, which `SyncStatusRow` already renders.

---

## 7b-3 · The store entry points — solving the trap 7a named

`useRecordingsStore.ts:21-25` states the problem: pushing a downloaded record through
`saveRecording` restamps it via `touch()`, making every pulled record look locally-newer.
The engine needs its own doors.

**New actions on `useRecordingsStore`:**

```ts
applyRemote: (recordings: TabRecording[]) => void;   // no touch(); preserves updatedAt and local frames
deleteFromRemote: (ids: string[]) => void;           // removes WITHOUT recording a tombstone
```

and the mirror pair on `useMidiProjectsStore`. `applyRemote` takes an array because a pull
applies many documents at once and one `set()` is one render.

**`deleteFromRemote` is separate from `deleteRecording` for a reason that is easy to miss:**
a delete driven by a remote tombstone must not write a *new* tombstone, or two devices will
echo deletions at each other forever, each refreshing `deletedAt` and keeping the tombstone
alive past its own GC.

### Where tombstones come from — decision **D1**

The engine cannot diff its way to a deletion: an id that is absent locally and present
remotely is indistinguishable from "deleted here" and "not yet pulled". Something has to
record the fact at the moment it happens.

**Recommendation: a persisted `deletedIds: Tombstone[]` inside each store, appended by that
store's existing `deleteRecording` / `deleteProject`, and cleared by the engine once pushed.**

- It is **atomic with the delete**. The alternative — a log in `useSyncStore` that the delete
  action writes to — splits one fact across two persisted blobs and two `localStorage` writes,
  and a tab closed between them resurrects the recording on the next sync. That is the exact
  bug tombstones exist to prevent, reintroduced by the plumbing.
- It keeps the **dependency direction clean**: the stores stay ignorant of sync.
- The cost is a persisted-schema change to both stores. For recordings that is
  **`RECORDINGS_SCHEMA_VERSION` v3 → v4**, seeding `deletedIds: []`, which the existing pure
  migration and its harness absorb almost for free. `useMidiProjectsStore` has no `version` at
  all, so its `merge()` handles an absent key as `[]` — it already survives partial payloads
  by design (`useMidiProjectsStore.ts:70-83`).

Signed out, the log accumulates and nothing reads it. That is correct and bounded: it is
`{ id, deletedAt, kind }` per deletion, and the same 90-day GC applies locally.

---

## 7b-4 · `syncEngine.ts` — orchestration

**Entry condition, checked in exactly one place:**

```
status === 'signedIn'  &&  user.emailVerified  &&  isFirebaseConfigured()  &&  SYNC_ENABLED
```

`emailVerified` here is *our* definition (`auth/types.ts:28`) — true for any Google identity
whatever Firebase reports — and `firestore.rules`'s `confirmed()` already applies the same
definition, deliberately, so the two cannot disagree. Anyone failing the condition is
`unavailable`-equivalent and keeps writing locally. Putting the check at the single entry
point is what stops the verification decision scattering into every call site.

**When it runs** (7-10, unchanged): on sign-in, on app load and foreground, ~2s debounced
after a local write, and on an explicit **Sync now**. **Not a live listener** — a listener
lets the cloud change the library under an open editor, which is the "no screen reads
Firestore" rule broken by the back door.

The foreground trigger is new code: a `visibilitychange` listener on web. Native's `AppState`
equivalent is 7-14's problem and is not built here.

**Single-flight.** One run at a time, with a `dirty` flag: a trigger arriving mid-run does not
queue a second run, it sets the flag, and the engine does exactly one more pass afterwards.
Without this, the debounce plus a foreground event plus a sign-in can start three overlapping
passes that push stale plans over each other.

**Incremental pull:** `where('updatedAt', '>', lastPulledAt)`. A single-field inequality on
one collection needs **no composite index**, which is why `firestore.indexes.json` stays
empty — worth stating, because adding an index later means a deploy step this phase otherwise
does not have.

**`lastPulledAt` is the maximum `updatedAt` actually observed, never `Date.now()`.** Wall-clock
would be wrong under clock skew in the direction that loses data: a device whose clock runs
fast sets a watermark into the future and never pulls the documents written in between. The
max-observed watermark cannot skip a document it has not seen.

Pushed documents come back on the next pull. Harmless — same `updatedAt`, so the tie rule
applies and the content is identical.

**Offline:** local writes always succeed; a failed push sets `state: 'offline'` with
`pendingCount` and is retried on the next trigger. **No operation queue** — the unit is the
whole document and LWW makes a replayed push idempotent. That is a real dividend of the LWW
choice and is stated here so nobody builds the queue.

**Firestore is reached by dynamic `import()` inside the call**, per `entitlement.web.ts:46`.
The engine module itself must also stay out of the static graph of any screen — it is started
from the root layout beside `startAuthListener()` (`_layout.tsx:65`), and only when the entry
condition passes.

---

## 7b-5 · First sign-in: adopt, never replace

The easy case: local library, empty cloud → upload everything. Ids are
`rec-${Date.now()}-${random}` (`sessionSnapshot.ts:38`), so a cross-device collision is not
realistic and the union is safe.

**The case that corrupts data is the second account on the same device.** Sign in as A (local
library adopted into A), sign out, sign in as B — naive adoption pushes A's entire library
into B's account. On a shared laptop that is a privacy incident, not a bug.

`adoptedUids: string[]` joins `lastUid` in `useAuthStore`'s `partialize` (currently
`useAuthStore.ts:78`, `lastUid` only). Then:

- Never adopted by anyone, and `uid === lastUid` or `lastUid` is unset → **adopt** (union into
  the cloud).
- `uid !== lastUid` and there are local documents not already adopted into *this* uid →
  **do not adopt.** Ask once, with counts: keep this device's N tabs as B's, or clear the
  device and pull B's library. **Default to clearing.**
- **Sign-out leaves the local library in place.** It is the signed-out library, and wiping it
  would delete work from anyone who signed in to look and signed back out.

The prompt is new UI — a modal with two destructive-ish choices and real counts in the copy.
It reuses the confirmation-dialog component `/profile` already uses for account deletion
(`profile.tsx:519`, `:550`) rather than introducing a second dialog idiom.

---

## 7b-6 · Settings — a subset, never the object

Per 7-10: `micSensitivity` and `hasCalibratedMic` are properties of *a device's microphone*,
not of a user. Syncing them means a laptop inheriting a phone's calibration.

| syncs | stays local |
|---|---|
| `themeOverride` | `micSensitivity` |
| `defaultAlgorithm` | `hasCompletedOnboarding` |
| `transcriptionParams` | `ratingStatus` |
| `maxTakeMinutes` | `isPurchased`, `totalRecordingsUsed` (governed by the entitlement decision, `phase-07-accounts.md:320`) |
| | `compactTakes` — **D2** |

**D2 — recommendation: `compactTakes` stays local.** It selects Int16 retention to save
memory (`useSettingsStore.ts:50`); that is a property of how much headroom *this* device has,
not a preference about music. Cheap to reverse either way.

Settings sync as one document with its own `updatedAt`, LWW on the whole subset — not per
field. A per-field merge here would be machinery for a conflict nobody has: two devices
changing different preferences in the same window, where the loss is a theme.

**`useSettingsStore` persists with no `version` and no `migrate`** (`:103-106`), so the
`updatedAt` field arrives as `undefined` on every existing install. Treat absent as `0`: the
first sync on any device pulls the cloud copy if one exists, and pushes if it does not.
Adding a version to that store is not worth it for one optional numeric field.

---

## 7b-7 · The sync row, and the disclosure

`useSyncStore` becomes the source for `SyncStatus`, replacing `NO_SYNC` in `useAuthStore`
(`useAuthStore.ts:22`). `useAuth()` keeps its shape, so `/profile` needs one change: pass
`onSyncNow`, which `SyncStatusRow` has always accepted as optional *because 7a had no engine
to call* (`SyncStatusRow.tsx:26`).

`mockStates.ts` and the `?mock=` harness are deleted at the end of this phase — 7a's own note
says so and gives the removal list (`grep -rn "isMock" src/`), gated on the sync row having
real states. This phase is that gate.

**No state may be shown that is not true.** `'idle'` — the green tick — means a pull and a
push both completed. Anything less is `offline`, `error` or `unavailable`. The reason is at
`useAuthStore.ts:18`: a green tick with nothing behind it invites someone to trust a backup
that does not exist.

---

## Verification

- **`scripts/verify-sync-merge.ts`** — the harness, following `verify-recordings-migration.ts`
  and `verify-midi-studio.ts`. Drives `merge.ts` with hand-authored device states: every row of
  the 7b-2 table, plus empty-cloud, empty-local, both-empty, tombstone expiry either side of
  the boundary, and a future `schemaVersion`. **No network, no emulator.** Fixtures written by
  hand, not produced by the app, so they do not come from the code under test.
- **Round-trip check in the same harness:** `wire.ts` serialize → deserialize is identity for a
  `TabRecording` except `frames`, and identity for a `MidiProject` through the existing
  `StoredProject` path.
- **Rules tests** — `verify-firestore-rules.ts` already covers another uid reading
  `/users/{uid}/tabs` and the client writing `/entitlements/{uid}`. Add the `deleted`
  collection, which it does not currently exercise.
- **Emulator pass:** run the engine against `firebase emulators:start --only firestore` with
  two synthetic uids; confirm the second-account refusal fires and nothing crosses accounts.
- **Two-browser manual pass:** sign in on both, edit in one, foreground the other, confirm the
  merge and the status line. Then again with one browser offline (DevTools) to confirm local
  writes survive and push on reconnect.
- **The no-regression check, which is the cheapest and most important one:** signed out, every
  existing capability still works — record, edit, save to library, export, share. The correct
  diff for a signed-out user is **nothing**.
- **Size check:** after syncing a 3,000-note recording, read the stored document size and
  confirm the opaque-payload decision held (7-10 predicts ~479 KB of payload against a 1 MiB
  limit).
- **Frames check:** pull a recording onto a second device and confirm Frame Inspector shows
  the new third empty state rather than the misleading one.

---

## Build order

Each step is independently landable, and the first two touch no network at all.

1. **`types.ts` + `wire.ts` + `merge.ts` + `verify-sync-merge.ts`.** The riskiest logic in the
   roadmap, built where it is cheapest to get wrong. Nothing else in the app changes.
2. **Store entry points, the tombstone logs, and the v4 recordings migration** — with
   `verify-recordings-migration.ts` extended to cover it. Still no network; the app behaves
   identically.
3. **`useSyncStore` + `syncEngine.ts`,** against the emulator, behind `SYNC_ENABLED = false`.
4. **7-11 adoption + the second-account dialog.** The privacy-incident case, built while the
   engine is still flag-gated.
5. **Settings subset.** Smallest blast radius, and the one whose failure is a wrong theme.
6. **The sync row + LWW disclosure**, replacing 7a's placeholder; delete `mockStates.ts` and
   the `?mock=` harness.
7. **Flip `SYNC_ENABLED`** after the two-browser pass and the size check.

**`SYNC_ENABLED` follows `FREE_TIER_ENABLED`'s precedent exactly** (`useSettingsStore.ts:23`):
one constant, read by the engine's entry condition, so steps 3–6 can land on the branch
without any account being touched — and so turning it on is one line rather than a hunt
through call sites.

---

## Open questions

1. **D1 — the tombstone log's home.** Recommended: inside each store, appended by its own
   delete action (7b-3). The alternative keeps the store schemas untouched at the cost of a
   non-atomic write.
2. **D2 — does `compactTakes` sync?** Recommended: no (7b-6).
3. ~~**Emulator or the real Firebase project during development?**~~ **Closed 2026-08-14:
   emulator**, via `connectFirestoreEmulator` behind `EXPO_PUBLIC_FIREBASE_EMULATOR=1`
   (`src/sync/firestore.web.ts`). One refinement over the recommendation: the flag **enables the
   engine on its own**, so `SYNC_ENABLED` stays `false` during development. Requiring the
   production switch to be flipped for emulator work would leave it in the wrong position most
   of the time, and the day someone unsets the emulator variable without putting it back is the
   day a dev session writes into the real project. Setup is in
   [`development.md`](../development.md#cloud-sync-7b).
4. **`README.md`'s ordering text** still says 7b ships after Phase 8, contradicting the
   2026-08-13 release sequence. Needs one of the two edited.
5. **Does the 90-day tombstone GC need a scheduled Cloud Function?** Not for correctness —
   clients drop expired tombstones locally and stop applying them — but nothing then deletes
   the Firestore documents, so the collection grows forever at ~40 bytes per deletion.
   Recommended: leave it, revisit if it ever matters. Recorded so it is a decision rather than
   an oversight.

---

## Status

**Built 2026-08-14, behind `SYNC_ENABLED = false`.** Steps 1–6 of the build order are done;
step 7 — the flip — is not, and the three things gating it are listed at the end.

### What shipped

| | file | notes |
|---|---|---|
| wire shapes, tombstone, merge plan | `src/sync/types.ts` | `TOMBSTONE_TTL_MS`, `SyncDoc`, `PROJECT_WIRE_VERSION` |
| the pure merge | `src/sync/merge.ts` | generic over the document type; tabs and projects share it |
| document ⇄ payload | `src/sync/wire.ts` | strips `frames`, stamps `schemaVersion`, migrates old payloads in |
| the Firestore façade | `src/sync/firestore.web.ts` + `firestore.ts` | platform-split like `auth/firebase.ts`; batching, the 500-write cap and the emulator switch live here |
| orchestration | `src/sync/syncEngine.ts` | entry condition, single-flight, four triggers, adoption |
| status | `src/sync/useSyncStore.ts` | watermark, settings stamp, pending choice |
| the second-account prompt | `src/components/AdoptLibraryModal.tsx`, `src/sync/AdoptionPrompt.tsx` | mounted at the root, not on `/profile` |
| tombstone log + timestamp-preserving writes | `useRecordingsStore`, `useMidiProjectsStore` | `deletedIds`, `applyRemote`, `deleteFromRemote`, `dropTombstones` |
| schema v4 | `recordingsMigration.ts` | seeds `deletedIds`, sanitises malformed entries individually |
| harness, 58 cases | `scripts/verify-sync-merge.ts` | no network, no emulator |

`Tombstone` and `SyncKind` live in `src/types/index.ts`, not `src/sync/`, so the stores that
write the log stay ignorant of the sync module entirely.

### Decisions taken while building

- **D1 — the tombstone log lives inside each store**, appended by that store's own delete
  action, as recommended. Atomic with the deletion; a log in a separate persisted store would
  be a second `localStorage` write, and a tab closed between the two resurrects the recording.
- **D2 — `compactTakes` stays local**, as recommended. The synced subset is `themeOverride`,
  `defaultAlgorithm`, `transcriptionParams`, `maxTakeMinutes`.
- **The settings timestamp lives in `useSyncStore`, not `useSettingsStore`.** That store has
  never had a `version` or a `migrate`, and adding a persisted field to it — for a value only
  the engine reads — would be a schema change to the one store with no machinery to absorb one.
- **A new `SyncState`: `'needsChoice'`.** The adoption prompt needed a row of its own.
  Deliberately not `'error'` — nothing failed, and calling it a failure pushes someone towards
  "retry" when the only way out is a decision.
- **`SyncStatus.reason`** was added for the `'unavailable'` row, which now names *why* nothing
  is syncing (signed out / unconfirmed address / switched off) instead of reading as a fault.
- **`sync` moved off `useAuthStore` onto `useSyncStore`.** 7a pinned it beside the user because
  there was no engine; leaving it there would give two modules an opinion about whether a
  backup happened.
- **Tombstones are pulled whole, not incrementally.** A tombstone carries `deletedAt`, not
  `updatedAt`, so it would never match the watermark query — and a deletion the watermark
  skipped is a deletion that silently resurrects.
- **`applyRemote` does not re-sort the library.** The list's order is the order the user built
  it in; a pull that reshuffled it whenever another device saved something would be the most
  visible thing this feature does and the least wanted.

### Changed since the plan was written

- **The Frame Inspector third empty state is out of scope**, deferred by the user 2026-08-14.
  Basic Pitch is the default engine and produces no frames at all, and the screen itself is a
  candidate for removal — so retention plumbing for it is work that may never be used. The
  copy at `frame-inspector.tsx:468` therefore still tells a synced take it "was saved before
  Frame Inspector data was kept". **Revisit if and when the screen's future is decided**, not
  before.
- **The `?mock=` harness was not deleted.** Step 6 called for it, but removing a working dev
  tool is orthogonal to whether sync works, and `mockStates.ts` still reaches states that are
  awkward to produce by hand. Its removal list is unchanged: `grep -rn "isMock" src/`.

### What still gates `SYNC_ENABLED`

1. **The two-browser pass.** Sign in on both, edit in one, foreground the other, confirm the
   merge and the status line — then again with one browser offline in DevTools.
2. **The stored-document size check.** Sync a 3,000-note recording and read the document's
   actual stored size, confirming the opaque-payload decision held (7-10 predicts ~479 KB
   against a 1 MiB limit).
3. **`PRIVACY_POLICY.md` must be updated first.** It currently states that *"creating an
   account does not upload your tabs"* and promises the policy will be updated **before sync is
   switched on**. That sentence is true today and becomes false the moment the flag flips, so
   the edit is a release blocker on the flip, not a follow-up.
