# Phase 12 — UX pass: naming, first-run, landing page, Studio fixes

*Part of the [Harp2Tab implementation plan](README.md).*

Not a feature phase — a list of things that are built but wrong, plus the two surfaces the
product still has no version of at all (a landing page and a profile page). Collected from
the user's todo list of 2026-08-09. Ordered below by screen, not by dependency; the
dependency-ordered build order is at the end of the phase.

Every claim below was checked against the code on `web_version` at commit `335f332`.

---

## Phase 12 — Detailed implementation plan (written 2026-08-09)

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
No usable photo exists — `assets/images/` holds only icons, logos and a splash. Needs a
licensed photograph or a commissioned/rendered
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

**No existing asset.** `assets/images/tutorial-web.png` was checked and was *not* an earlier
attempt at this — it was an unused `create-expo-app` template screenshot ("Welcome to Expo"
at `localhost:8081`), and has been deleted. There is nothing to build on here.

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
