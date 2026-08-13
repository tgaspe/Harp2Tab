# Phase 7 — User accounts (Firebase Auth)

*Part of the [Harp2Tab implementation plan](README.md).*

- Greenfield sign-in: Google Sign-In + email link first (per the already-locked web version plan), Sign in with Apple once iOS ships.
- Ties `useRecordingsStore` to cloud sync so the library built in Phase 1 becomes portable across devices/platforms.

---

## Phase 7 — Detailed implementation plan (written 2026-08-12)

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

## 7a-UI — the UI-only first pass (planned 2026-08-12)

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
