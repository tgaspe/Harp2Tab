# Harp2Tab — Full Roadmap Implementation Plan

Status as of 2026-08-19: Phases 0–6, 7a, 7b, 8a, 8b, 11, 13 and 14 are implemented on
`web_version`. Phases 9, 10, 12 (partly), 15, 16 and 8c are still just this plan; Phase 17 is code-complete
and awaiting browser checks.

**Phase 16 supersedes Phase 14** (planned 2026-08-19): the spectral engine is replaced
wholesale by the CQT-based HSA v2 detector, plus pMPM's amplitude-envelope re-attack
detector so repeated notes stop being written as one long note. Phase 14's write-up stays as
the design record for what it built.

**7b's `SYNC_ENABLED` is now `true`** and the web app is deployed to Firebase Hosting at
`harp2tab.web.app` and `harp2tab.com` (commit `facbc3e`). **The two manual 7b checks — the
two-browser pass and the stored-document size check — and the privacy-policy update are still
outstanding**, and sync is live regardless; see the Status section of
[`phase-07b-sync.md`](phase-07b-sync.md).

**8b is done** (2026-08-19): a sandbox subscription is bought, written, cancelled and revoked
end to end, with 8-4/8-5/8-6 shipped. Untested: the lifetime purchase (which answers 8-1.6),
declined cards and 3-D Secure. See [`../stripe-setup.md`](../stripe-setup.md) Part 4.

**Both hostnames served Firebase's "Site Not Found" on their bare root; fixed 2026-08-19 by a
redeploy.** The cause was not configuration. Each domain got that page cached in a regional
Fastly shield during its provisioning window on 2026-08-18 (apex 16:56 UTC, `www` 17:44 UTC),
under exactly one cache key apiece: the root with no query string. `/app`, `/edit` and
`/?anything=1` were served correctly the whole time — only `/` was poisoned. It outlived the
response's `max-age=0` because that header governs browsers, while Fastly follows
`Surrogate-Control`, and Firebase sets a long surrogate TTL on that page. Because the poison
sits in a *regional* shield, which hostname looked broken depended on where you were: the apex
was dead from one region while serving fine from another (the `www` root and the apex root
were poisoned at different POPs), and a first-ever visit on a new device hit it just the
same — the cache is shared per POP, not per client.

**If it recurs, the fix is `firebase deploy --only hosting`** — Firebase's release-time CDN
invalidation does reach these host-level objects (confirmed by a `x-cache: MISS` on the first
request afterwards). Deleting and re-adding the custom domain does **not**: it was tried on
`www` first, as a rehearsal precisely so the live apex was not taken down for nothing, and the
root stayed poisoned through a full delete/re-create cycle. The domain resource lifecycle and
the CDN cache are independent.

**The DNS is correct as it stands — do not "fix" it.** The records at Namecheap are `A @ →
199.36.158.100`, `CNAME www → harp2tab.web.app.` and `TXT @ → hosting-site=harp2tab`. The
`www` CNAME looks wrong next to the A-record pair Firebase's docs show, and it was written up
here as an open item on that basis. Checking rather than assuming reversed it:

- Firebase reports `requiredDnsUpdates: none` and `issues: none` for both custom domains, with
  both `HOST_ACTIVE`. That field is how Firebase asks for record changes; it is empty, so
  nothing is being asked for.
- **`199.36.158.101` resets the TLS handshake** (`tcp/443` opens, then `Connection reset by
  peer`). Adding it as a second A record would point roughly half of all clients at an
  endpoint that drops them mid-handshake — the "fix" would cause the outage.
- `www` already answers over IPv6 (`curl -6` → `301` to the apex). The AAAA that comes with
  the CNAME is a bonus, not a defect: Firebase publishes no AAAA for custom domains, so the
  apex has no IPv6 at all.

Check `requiredDnsUpdates` before changing any record here:

```bash
curl -sS -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H 'x-goog-user-project: harp2tab' \
  https://firebasehosting.googleapis.com/v1beta1/projects/harp2tab/sites/harp2tab/customDomains
```

## Release sequence (decided 2026-08-13)

The phase numbers are a dependency order, not a release order. **Monetization ships last** —
the product is finished first, then it is monetized. The order to actually work in:

1. **Domain.** ~€12, instant, and it currently gates five other things. Buying it is the
   cheapest unblock on the list, which is why it stops being step 7 of Phase 8.
2. **Hosting** (below — not owned by any phase before today). SEO work is not verifiable
   until there is a live URL to verify it against, so this precedes the landing page.
3. **Landing page + SEO** (12-3), including the `/` → `/app` routing change, which is
   entangled with 12-5 and `HIDDEN_ROUTES`.
4. **Legal pages** (8-9) + the privacy-policy update accounts already made necessary.
5. **Monetization** (8b, then 8c, then the 8-8 free-tier flip).

**One exception to "monetization last":** the Stripe account creation and the Managed
Payments eligibility check (8-1.1) happen at step 1, not step 5. They are free and reversible,
and if Belgium turns out ineligible the fallback is Paddle — which changes who the seller of
record is, and therefore a sentence in the Terms and a line in the pricing table. Discovering
that after steps 3 and 4 means rewriting both. Nothing else in Phase 8 moves.

## Hosting — unowned until 2026-08-13

`firebase.json` has never contained a `hosting` block (verified against that file's full
history), there is no CI, and no Vercel/Netlify config. **The web app has never been deployed
anywhere.** `docs/development.md` documented `firebase deploy --only hosting` before the config
existed, so the command would have failed. No phase owned this; it is now step 2 above.

- [x] [Phase 0](phase-00-05-foundation.md) — Recording-session foundation
- [x] [Phase 1](phase-00-05-foundation.md) — Home-as-library + recording history
- [x] [Phase 2](phase-00-05-foundation.md) — Frame retention plumbing + real Frame Inspector
- [x] [Phase 3](phase-00-05-foundation.md) — Playback (+ metronome, added beyond the original scope)
- [x] [Phase 4](phase-00-05-foundation.md) — Piano-roll editor (+ desktop-native toolbar redesign, added beyond the original scope)
- [x] [Phase 5](phase-00-05-foundation.md) — Audio upload (5a decode/pipeline, 5b auto key detection); 5c native
      compressed-audio decode deferred
- [x] [Phase 6](phase-06-midi-import.md) — MIDI upload → tab conversion
- [x] [Phase 7](phase-07-accounts.md) — **7a shipped** (commits `07f84f9`…`a455556`): Firebase Auth with
      Google + email/password, `/profile`, the verify banner, reauth/set-password, account
      deletion (client + the `onAccountDeleted` function), Firestore rules +
      `verify-firestore-rules.ts`. **7b shipped 2026-08-14** — the sync engine, planned in full
      in [`phase-07b-sync.md`](phase-07b-sync.md): pure merge + 58-case harness, tombstone log,
      timestamp-preserving store writes, first-sign-in adoption with the second-account guard,
      synced settings subset, real sync row. Behind `SYNC_ENABLED = false` pending two manual
      checks and the privacy-policy update. This closes the "free accounts get sync" promise.
      **Built ahead of Phase 8, not after it** — the ordering note below was written 2026-08-12
      and was overtaken the next day by the release sequence above (monetization last); its
      premise, that nobody has an account until billing exists, had already been removed by the
      same day's decisions to offer accounts voluntarily and give free accounts sync.
      Original plan below. User accounts (Firebase Auth) + cloud sync. Detailed plan written
      2026-08-12. **Now split: 7a (accounts) ships here, 7b (the sync engine) ships after
      Phase 8** — under the subscribe-time signup model there is nobody with an account to
      sync until billing exists. Decisions taken by the user the same day: local-first
      storage with a cloud mirror; **Google + email/password** (superseding the locked
      email-link decision); **accounts created at subscribe, plus a voluntary sign-in
      everywhere** (an earlier same-day save/export wall was dropped — it would have
      removed the live app's only output); **free accounts get sync**; and a full
      **`/profile` route** (which answers 12-4). Sign-in is the small half — the
      email/password surface, `/profile` and the merge engine are the work. Account
      deletion + a privacy-policy/Data-safety update are release blockers the moment
      accounts exist. Three separate pieces of work block on buying the custom domain.
- [~] [Phase 8](phase-08-monetization.md) — **8a and 8b shipped.** 8b (2026-08-19): RevenueCat on
      **Stripe Billing** (not RevenueCat Billing — that fork would have made RC the merchant of
      record), the `premium` entitlement, the current offering, `revenuecatWebhook` deployed and
      authenticated, and 8-4/8-5/8-6 in code. **Two corrections to the plan text below**: trials
      and Stripe coupons *are* supported on this path, and a custom checkout domain is *not*
      (Managed Payments excludes it). 8c is untouched — `FREE_TIER_ENABLED` is still `false` and
      `RC_ACCEPT_SANDBOX` is still `true`.
      Original 8a note. **8a shipped** (commits `7e24aba`, `e8e110f`): the revocable
      entitlement store, the RevenueCat webhook → Cloud Function entitlement writer, the
      three-plan paywall on mock offerings, `/profile`'s plan block, and
      `verify-entitlement.ts`. **8b and 8c are not started** — `useIAP.web.ts` is still the
      "Purchases on the web are coming soon" stub and `FREE_TIER_ENABLED` is still `false`.
      Two corrections to the plan below, from vendor docs checked 2026-08-13: RevenueCat's
      Stripe purchase flows **do** support one-time flat-rate prices, which answers open
      question 1 in the lifetime product's favour; and 8b is **not** quite free — the webhook
      needs a public HTTPS endpoint, so either Blaze (a card, ~$0 at this volume) or a tunnel
      to the emulator. Setup runbook for 8-1 written 2026-08-13.
      Original plan below. Better monetization + remaining web billing. Detailed plan written
      2026-08-13. Five decisions taken by the user the same day: **Stripe Managed Payments
      behind RevenueCat**, making Stripe the merchant of record (the July "RevenueCat +
      Stripe" decision has since split into three products that differ in who owes each
      buyer's sales tax); **the July prices stand** — $3.49/$27.99/$44.99, lifetime still
      sold on web; **web only**, Android keeps `react-native-iap` and its one-time SKU
      untouched; **grandfathering is a manual grant**, because there is exactly one existing
      Play buyer and he is known personally — which deletes the reconciliation subsystem
      this phase was budgeted for; and **the free tier does not change**. The work that
      replaces it: the webhook→Cloud Function entitlement writer against 7a's reader, and
      **making `isPurchased` revocable** — it is a one-way latch today, correct for a
      lifetime unlock and wrong for every subscription. No promo codes or free trials are
      possible on this billing path; that is a knowing trade. **Staged 8a/8b/8c so no
      financial commitment is needed until the code works**: 8a is most of the phase's code
      against the Firebase emulator with no accounts anywhere; 8b is real purchases through
      Stripe *test mode*, which an un-activated account can do and which cannot charge real
      money; 8c is the only slice that costs anything — Stripe activation, a bank account,
      Managed Payments, the domain, and the free-tier flip.
- [ ] [Phase 9](phase-09-10-ios-and-web-polish.md) — iOS version
- [ ] [Phase 10](phase-09-10-ios-and-web-polish.md) — Improve web UI polish. Now also holds two items found during Phase 7:
      **10-1** two modals that are still phone sheets on a desktop viewport, and **10-2**
      modal Escape/focus-trap/focus-restore, which 7a-UI committed to and which is unmet
      almost everywhere in the app.
- [x] [Phase 11](phase-11-midi-studio.md) — MIDI Studio (multi-track DAW), except the SoundFont sound module
      (11-6), which is blocked on a product decision — see the note below.
      Harnesses: `verify-midi-studio.ts` (65 cases), `verify-export.ts` (16),
      `perf-studio-lanes.ts` (the 11-4 spike). Existing suites still green.
- [ ] [Phase 12](phase-12-ux-pass.md) — UX pass: home naming/sidebar, landing page + SEO, profile page,
      calibration timing, MIDI Studio fixes, first-run tutorials (added 2026-08-09).
      Not dependent on 7–10 except 12-3's pricing (Phase 8) and 12-4 (Phase 7).
- [x] [Phase 13](phase-13-record-transcribe.md) — **Shipped.** PCM retention (`takeRetainedPcm`), the engine picker
      (`TranscriptionEngineModal`, hosted by both the recording and import screens), and
      per-engine parameter tuning (`TranscriptionParamsRail`) over the two-phase
      `prepare`/`resegment` split in `src/audio/algorithms/index.ts`.
      Record → transcribe → Studio: retain the take's PCM, pick an engine and
      tune its params after Finish, land in the Studio as a draft (added 2026-08-10).
      Independent of 7–10. Carries one monetization decision (where the free-tier session
      is consumed) — see Decisions under the phase.
- [x] [Phase 14](phase-14-spectral.md) — **Shipped.** `spectralAlgorithm` is registered and `available: true`,
      backed by `src/audio/dsp/` (fft, stft, harmonicSalience) and `src/audio/segmenters/`,
      with `verify-spectral-pitch.ts` as its harness. The measurement step did not cancel it.
      Spectral polyphonic transcription (FFT): a third engine that hears chords
      offline, with no download and no TensorFlow (added 2026-08-10). **Its stated goal is
      the lowest octave-error rate of the three**, not maximum polyphony; polyphony is the
      capability, octave accuracy is the objective. Pure TypeScript, so it is also the
      first polyphonic engine native could run. Independent of every other phase — it adds
      files under `src/audio/` and one registry entry, and changes nothing in the pipeline
      it plugs into. Starts with a measurement step that can cancel the phase.
- [ ] [Phase 15](phase-15-native-scope.md) — **Native port scope — a deferred decision, not scheduled work**
      (added 2026-08-12). Holds the question of which features get ported to native at
      all, collected from every phase that parked one (7-14, 11's "may drop features",
      5c, 13's native no-ops). Native is measurably further along than the phase text
      above implies — recording, playback, MIDI import and IAP are all real there — and
      it has one known dead end: the Studio's Export lives in a `TopBar` that is `null`
      on native. **This phase does not license hedging web work**; the rule in
      `feedback_web_first_no_mobile_hedging` still stands.
- [ ] [Phase 16](phase-16-hsa-engine.md) — **HSA v2 replaces the spectral engine, with re-attack
      segmentation** (planned 2026-08-19). Ports `HSA_v2_polyphonic.ipynb` — CQT harmonic
      summation with iterative cancellation — into `src/audio/`, deletes Phase 14's engine
      and its octave machinery, and gives the result the amplitude-envelope re-attack
      detector that today only `NoteDetector` has, so a tongued repeat stops being written as
      one long note. The CQT is **vendored** (`cqt-web`, MIT) rather than written, after
      measuring that its `HybridCQT` reproduces the notebook's detected pitch sets exactly at
      ~25× the speed of its accurate variant. Two consequences to hold onto: the engine
      becomes **web-only** (WASM under Hermes), leaving native with pMPM alone, and the
      re-attack constants must be re-tuned before the port, because pMPM's were calibrated at
      46.4ms frames and HSA v2 runs at 11.61ms.
- [~] [Phase 17](phase-17-audio-export.md) — **Audio export (WAV / MP3 / OGG)** — code complete
      2026-08-28, browser verification outstanding (planned the same day). Renders the tab editor's and the Studio's MIDI through the soundfont that
      Phase 11-6 already bundles, offline, so an export sounds like playback rather than the
      oscillator fallback. Web-only, one shared pipeline for both screens, and it finally
      gives the Studio's `Download MIDI` header action a real Export popup. **Verified
      against the installed `spessasynth_lib@4.3.14`, not just its docs** — the load-bearing
      finding is that `startOfflineRender` *transfers* the soundbank `ArrayBuffer`, so a
      cached buffer is detached after one export and the cache must hold bytes and copy per
      render. **Export ignores mute and solo** (Theo, 2026-08-28) — every track is rendered, so
      audio matches the MIDI download and no existing behaviour changes; the velocity and
      duration floors still apply, because those are edits to the material rather than
      monitoring. Carries one shared-code fix that stands on its own: `triggerWebDownload` revokes its object URL synchronously, which is safe for a 3 KB
      CSV and can abort a 40 MB WAV in Firefox and Safari.

**Phase 11 — what shipped, against what was planned**
- 11-1…11-5, 11-8…11-10 complete. End-to-end: import MIDI → Open in Studio → edit →
  Convert to tabs → Edit, plus blank projects, quantize, multi-track export.
- **11-7 (arrange view) was built and then removed at the user's request** — the toggle
  was judged not to earn its place, and with it gone the view was unreachable, so
  `ArrangeView.tsx` and `arrangeGaps.ts` were deleted rather than left as dead code. The
  handoff case it addressed is still visible in the roll itself: other tracks render as
  background lanes behind the one being edited.
- **11-6 was largely already built and I missed it.** `PianoRoll` has had a
  **Breath Force / Duration / Confidence / Pitch Bend** data panel since Phase 4
  (`metricTab`, `PianoRoll.tsx:431` at the pre-Phase-11 commit). I built a second
  `ControlLane`/`LaneSpec` strip and stacked it under the existing one, so the Studio
  rendered "Breath force" three times. **`ControlLane.tsx` has been deleted.** What
  survives from 11-6 is the part that genuinely didn't exist and feeds the panel that
  does: `timbre.ts` (GM voices, so tracks are audibly distinct) and `breathForce.ts`
  (RMS → breath force, normalised against the take's own range).
  **SoundFont** still hasn't shipped, and is blocked on a decision rather than effort:
  which soundfont (they carry real and differing licences), and bundled vs. fetched on
  demand (tens of MB against a network dependency and a CSP question).
- **The Studio is the editor's screen with the track panel swapped in — not a new one.**
  The first version treated it as a fresh screen that merely embedded `PianoRoll`, so it
  inherited none of `edit.tsx`'s chrome and re-solved solved problems. Reworked to import
  the editor's own `WebTransportBar` (loop / tempo / metronome / skip / stop / play-pause
  / rate / time — it previously had a single "Play" text button) and to leave the piano
  roll's own data panel alone. Rule for anything added here later: **reuse the editor's
  components; the Studio only adds tracks and conversion.**
- **The Studio has no chrome row of its own**, by request. The project title rides in the
  piano roll's tool row via `headerLeft` (exactly where the editor puts its chart title),
  Export is parked in the global `TopBar` through `useHeaderActionStore`, and the
  Harp2Tab logo is the way back to the library — it already is on every other screen.
  `useHeaderActionStore` is a one-slot register for this: `TopBar` renders in the root
  layout, outside any screen's tree, so a screen can't hand it a callback directly. It
  generalises the trick the editor already uses to drive its List/Piano-Roll toggle from
  there. Screens must clear the slot on unmount or the button follows them.
- The track panel collapses to a 44px colour rail, mirroring the editor's icon sidebar.
- **Deviations worth recording:**
  - The arrange view must stay height-capped (`MAX_PANEL_HEIGHT`) and internally
    scrollable, and defaults to collapsed. Uncapped, a 29-track project rendered ~700px
    of lanes inside a fixed-height flex column and squeezed the piano roll to zero — the
    editor simply vanished. It is an overview above the editor, never a replacement.
  - The Studio opens on `mostMelodicTrack`, not `tracks[0]`. Real files routinely lead
    with a note-less conductor or marker track, which opened the editor blank at the top
    of a 128-row ladder.
  - `PianoRoll`'s bulk edit paths (quantize, duplicate, paste, group move, arrow nudge)
    reached into `useAppStore` directly while single-note paths went through `onUpdate`.
    Invisible while the tab editor was the only caller, wrong the moment the Studio
    appeared — a Studio quantize would have edited the tab session. Now routed through
    `onUpdateMany`/`onCreateMany` props that default to the old store calls.
  - Studio notes needed identity the data model doesn't have (SMF doesn't identify notes).
    Resolved as *positional* ids in `studioNotes.ts` rather than a per-note persisted id.
  - The perf spike ran headlessly (`perf-studio-lanes.ts`) rather than in a browser, and
    forced the lane layout out of the component into `studioNotes.layoutBackgroundLanes`.
    12 tracks / 5,400 notes: worst 1.24ms per frame against a 16.7ms budget, blocks per
    frame bounded at 581. It also confirmed the SMF-persistence decision — 64 KB against
    309 KB as raw JSON. It measures layout, not React reconciliation or paint.
  - The arrange view's gap detection was initially written as "selected idle AND another
    sounding", which the harness caught: an accompanying track's own rests shredded one
    long handoff into sub-second fragments that the length filter then discarded, so the
    handoff vanished entirely. Rewritten to define the gap by the selected track's
    silence, then test overlap exactly.

The per-phase write-ups are left as originally planned/approved (before implementation) —
they're the design record, not a changelog. Notable deviations from the original plan that came up during implementation:
- Phase 2/3/4 grew a **real BPM/tempo field + audible metronome** and a **snap-to-grid**
  piano-roll, which were not in the original scope — added per follow-up requests once the
  config-object refactor made them cheap.
- The piano-roll's `PanResponder`-based drag turned out unreliable on web (a `<Text>` inside
  the draggable area could trigger native text-selection mid-drag, plus missing capture-phase
  handlers) and was migrated to `react-native-gesture-handler`'s `Gesture.Pan()` instead —
  already proven elsewhere in this app (list drag-to-reorder).
- The piano-roll's desktop toolbar/transport bar was redesigned again mid-Phase-4 to look
  like a real desktop editing tool (compact icon toolbar + minimal transport bar) rather than
  the mobile-style stacked touch buttons the rest of the app still uses on native.
- Phase 5 landed close to its detailed plan, with two measured corrections: analysis
  is ~5% of realtime (8.5s for 3 minutes of near-continuous playing), so the contingency
  Web Worker was never needed; and the note-committing step moved *after* the key
  confirmation step, since detection can only be presented for approval if notes aren't
  already built. `scripts/verify-audio-import.ts` is the harness (17 cases: round-trip
  detection, WAV format matrix, key detection).
- Phase 6 landed as planned, with two additions requested during implementation: the
  **per-track preview button** (listed as optional polish in 6-6) shipped, since choosing a
  track by reading a pitch range is harder than hearing four bars; and the confirm step
  gained explicit **dead-end warnings** — one for a track with nothing left after the
  110ms articulation floor (Continue disabled, since it can only produce an empty editor),
  one for a part no key can map at all (Continue still enabled, since the pitches are real
  and editable). The audio confirm step got the matching "no key fits anything" warning so
  both paths say so before committing rather than after.
  `scripts/verify-midi-import.ts` is the harness (22 cases).

## The phase files

| File | Covers |
|---|---|
| [`phase-00-05-foundation.md`](phase-00-05-foundation.md) | Recording sessions, home-as-library, frame retention + Frame Inspector, playback, piano-roll editor, audio upload (5a/5b/5c) |
| [`phase-06-midi-import.md`](phase-06-midi-import.md) | MIDI upload → tab conversion |
| [`phase-07-accounts.md`](phase-07-accounts.md) | Firebase Auth, `/profile`, Firestore rules, account deletion, the 7a-UI mock-first slice, and 7-10/7-11's outline of the sync engine |
| [`phase-07b-sync.md`](phase-07b-sync.md) | 7b in full — wire format, the pure merge, tombstone sourcing, orchestration, first-sign-in adoption, settings subset |
| [`phase-08-monetization.md`](phase-08-monetization.md) | Stripe Managed Payments behind RevenueCat, the entitlement writer, revocable `isPurchased`, the free-tier flip |
| [`phase-09-10-ios-and-web-polish.md`](phase-09-10-ios-and-web-polish.md) | iOS version; web UI polish incl. modal focus management |
| [`phase-11-midi-studio.md`](phase-11-midi-studio.md) | MIDI Studio (multi-track DAW) |
| [`phase-12-ux-pass.md`](phase-12-ux-pass.md) | Home naming/sidebar, landing page + SEO, calibration timing, Studio fixes, first-run tutorials |
| [`phase-13-record-transcribe.md`](phase-13-record-transcribe.md) | Record → transcribe → Studio; PCM retention, engine picker, per-engine params |
| [`phase-14-spectral.md`](phase-14-spectral.md) | Spectral polyphonic transcription (FFT) as a third engine |
| [`phase-15-native-scope.md`](phase-15-native-scope.md) | Native port scope — a held decision, not scheduled work |
| [`phase-16-hsa-engine.md`](phase-16-hsa-engine.md) | HSA v2 (vendored CQT) replaces the spectral engine; global re-attack segmentation |
| [`phase-17-audio-export.md`](phase-17-audio-export.md) | Audio export — offline SoundFont render → WAV/MP3/OGG, shared export popup for Edit and Studio |

## Context

The app is live in production on Android; the web version's core functionality shipped 2026-07-29. The roadmap had grown to 10+ items spanning data model changes, new UI surfaces, new audio pipelines, and business infrastructure, decided incrementally over several sessions but never sequenced against each other or against the actual codebase. The goal here is a single dependency-ordered implementation sequence so features get built in an order that doesn't require redoing earlier work, with the specific technical risks in this stack (Expo/RN, no existing audio-output or file-decode capability, a wall-clock-dependent note detector) called out up front instead of discovered mid-phase.

This plan was validated against the actual code (not just the roadmap descriptions) via three research passes: current data/persistence model, the audio pipeline's frame lifecycle, and the screens/navigation structure — plus a dedicated architecture-review pass that caught several hidden dependencies (noted inline in the phase files).

## Key existing pieces to reuse (don't rebuild)
- `src/audio/pitchDetector.ts` — pure, platform-agnostic `detectPitch(samples, sampleRate)` / `computeRms(samples)`. Already proven on web; reusable for iOS and for audio-upload decoding.
- `src/audio/HarmonicaMapper.ts` — `frequencyToTab`, `tabToNote`, `noteToTab`. Covers both the live pitch→tab direction and the reverse note→tab direction needed for MIDI upload.
- `src/export/generators.ts` — tab→file format generation (txt/csv/json/midi/musicxml), pure functions over `TabNote[]`.
- `src/store/useSettingsStore.ts` + `src/store/storage.ts`/`storage.native.ts` — the persisted-Zustand-store pattern to copy for a new recordings store.
- Edit screen's own header (`src/app/edit.tsx`) — self-contained, not routed through global `TopBar`; the natural home for both a piano-roll toggle and an "Inspect frames" button.

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
