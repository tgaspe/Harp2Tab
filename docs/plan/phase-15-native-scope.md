# Phase 15 — Native port scope (decision deferred, added 2026-08-12)

*Part of the [Harp2Tab implementation plan](README.md).*


**This phase exists to hold a decision, not to schedule work.** Every phase above is planned
web-first per `feedback_web_first_no_mobile_hedging`, and several of them ended with a
native question parked at the bottom (Phase 7's 7-14, Phase 11's "native is a later port
that may drop features", Phase 5c, Phase 13's native no-ops). Those questions are collected
here rather than answered one at a time inside phases that are really about something else.

**The decision itself is Theo's and is explicitly not being taken now**: which features get
ported to native at all. Nothing below should be read as a commitment to port anything. The
inventory and the suggestions are raw material for that decision.

**Do not let this phase become a reason to hedge web work.** The rule stands: build the web
product properly, decide the native subset afterwards. A feature being hard to port is not
an argument against building it on web.

## 15-A · The two Play Store obligations that accounts create — deferred here
*Added 2026-08-13, by the user's decision, while finishing 7-13.*

Both were originally scoped as Phase 7 release blockers. **Neither is due until native gets
accounts**, because both describe the *Android app*, and the Android app collects no account
data: `isFirebaseConfigured()` returns `false` in `src/auth/firebase.ts`, so the auth listener
never starts on native and every auth function throws. Accounts are web-only until 7-14, which
is this phase's decision to make.

They are recorded here so that deciding "native gets accounts" cannot happen without them
coming with it. **Shipping native auth without both is a policy violation on a live app.**

1. **Play Console Data safety re-declaration.** The form must then declare collection of email
   addresses and user IDs, linked to identity. Today declaring them would be *inaccurate in
   the other direction* — the app would be claiming to collect what it does not, which is its
   own kind of wrong answer on a compliance form.
2. **A publicly reachable account-deletion URL**, required by Play's data-deletion policy for
   any app offering accounts. Needs a stable public origin, so it is also gated on the domain
   purchase (`TODO(domain)`) — the two deferrals overlap and should be resolved together.

**Already done and not deferred:** `PRIVACY_POLICY.md` was updated on 2026-08-13 for web
accounts (account information collected, Firebase Authentication as a processor, self-service
deletion and export under GDPR, and an explicit statement that the Android app has no
accounts). The policy covering more than the Android app does is normal and needs no Play
change by itself.

## The state of native today — measured, not assumed

Checked against the code on 2026-08-12, because the plan text above understates native in
several places. Native is in better shape than "unported" and worse shape than "works".

| area | native today | evidence |
|---|---|---|
| Live recording + pitch detection | **Real, and better than web** — Oboe + C++ MPM at 50Hz | `src/native/AudioCapture.ts` |
| Playback + metronome | **Real, different design** — pre-renders the whole sequence to a WAV via `synthesizeWav` and plays the file, since there is no `OscillatorNode` | `src/native/Playback.ts:8-10` |
| MIDI import | **Real** — `expo-file-system` reads the bytes, and the rest of the pipeline is pure TS | `src/audio/readFileBytes.ts` |
| Audio import | **WAV only** — Expo 55 exposes no compressed-audio decoder | `src/audio/decodeAudio.ts:1-8` (Phase 5c) |
| Neural transcription | **Unavailable** — `available: false`, registry hides it and falls back to pMPM | `src/audio/algorithms/basicPitch.ts:18` |
| In-app purchase | **Real on native, stubbed on web** — the one inversion | `src/hooks/useIAP.web.ts` |
| Persistent top bar | **Does not exist** — returns `null` | `src/components/TopBar.tsx` |
| Everything else (Home, Edit, Piano Roll, Studio, Import, Frame Inspector) | **Renders, unverified** — the `Platform.OS` branches in these screens are layout and hover concerns, not feature gates, so the screens do mount on native. Nobody has driven them on a phone. | `edit.tsx:391`, `studio.tsx:773`, `frame-inspector.tsx:979` |

**The one concrete functional break already visible:** the Studio parks its Export action in
the global `TopBar` through `useHeaderActionStore`, and uses the Harp2Tab logo as the way
back to the library (Phase 11's notes say so explicitly). `TopBar` is `null` on native. So
**the MIDI Studio on native currently has no Export button and no way back** — not a layout
problem, a dead end. Whatever this phase decides, that is the shape of the work: the web
build made reasonable use of a chrome that native does not have.

## What this phase must decide

For each feature: **port as-is · port redesigned · drop on native · defer**. The useful unit
is the feature, not the file — several features are already 90% portable TypeScript sitting
behind one platform-specific edge.

## Feature inventory, with suggestions

Suggestions only. Each is a starting position to argue with, not a recommendation to adopt.

### Likely ports cleanly — the pipeline is pure TypeScript
- **Tab editing (list view)** — already the native app's main screen today. Ports as-is.
- **Export, all five formats** — `generators.ts` is pure; `expo-sharing` and `expo-file-system` are already dependencies and already used. Ports as-is.
- **MIDI import → tab** — the whole Phase 6 path is platform-agnostic once bytes are read, and reading them already works.
- **Home-as-library** — `useRecordingsStore` uses the AsyncStorage shim; nothing web-specific in the data.
- **Phase 14's spectral engine, if it ships** — pure TypeScript by design, no model download, no TensorFlow. **It would be the first polyphonic engine native could run**, which is a real argument for Phase 14 that has nothing to do with accuracy.

### Need a native answer before they can be ported
- **The MIDI Studio's chrome** — the `TopBar` problem above. Either give native a real header, or give the Studio its own (which Phase 11 explicitly decided against on web). This is the single largest unresolved native question in the app.
- **Piano roll on a phone screen** — drag-to-move/resize at finger precision, on a pitch ladder that is already tight on a laptop. The arrow-key nudge accessibility path (Phase 4) has no touch equivalent. Suggestion: a tap-to-select + numeric-inspector model rather than a scaled-down drag surface, reusing the list view's precision editing for the fiddly parts.
- **Two-column layouts** — recording, import's tune step, edit's sidebar (`edit.tsx:391` is web-only already). All specified as "stacked on native" in the plans above; none built or tried.
- **Audio import beyond WAV** — Phase 5c, a MediaCodec/AVFoundation Expo module. Suggestion: worth it only if audio import is judged a core native feature; if native is mostly a recording companion, WAV-only plus a clear message is a defensible permanent answer.
- **Neural transcription** — `tfjs-react-native`, or a native Core ML / TFLite path, or accept that native transcribes with pMPM and the spectral engine. Suggestion: do not port Basic Pitch. The download, the memory and the second stack are a poor trade on a phone, and Phase 14 may make the point moot.
- **Frame Inspector** — the zoomable multi-track visualisation is a wide-screen tool. Suggestion: defer, or ship a cut-down single-track version.

### Probably drop, or web-only by nature
- **The landing page and SEO** (12-3) — web-only by definition.
- **`/profile` and accounts** (Phase 7) — genuinely open, and Phase 7's own open question 4. Native is where the paying users currently are, but Play Billing already owns the purchase flow, so the subscribe-time gate has a different shape there.
- **Cloud sync** (7b) — no technical blocker at all (the merge engine is pure), purely a question of whether native accounts exist.
- **Hover-dependent affordances** — tooltips, hover states, the drag handles that appear on hover. These need touch equivalents or removal; they cannot simply be ported.

### Things native could do that web cannot — worth considering as native's reason to exist
- **Receive files from the system share sheet** — "Open with Harp2Tab" on an audio or MIDI file from Files, Voice Memos, WhatsApp. `expo-linking` is already a dependency; this is intent filters on Android and a document type on iOS. Arguably the strongest native-only feature available, and it turns the app into a destination rather than a place you go.
- **Keep the screen awake while recording** — `expo-keep-awake` is already installed.
- **Haptic feedback on note detection or metronome beats** — `expo-haptics` is already installed. Cheap, and it is the kind of thing that makes a mobile app feel native rather than wrapped.
- **Background or lock-screen recording** — real work, and the honest question is whether anyone records a harmonica with their phone in their pocket.
- **Better microphone access** — native already has the superior capture path (Oboe, low latency, real C++ MPM). If native's positioning is "the recording device", that is the feature to lead with.

## Relationship to Phase 9 (iOS)

They are different questions and should stay separate. **Phase 9 asks whether iOS exists at
all** — it is a capture-bridge spike (`AVAudioEngine` tap emitting the same `{frequency,
rms}` shape) plus store setup. **Phase 15 asks what any native platform contains.** Phase 15's
answer applies to Android too, where the app is already live.

Sequencing suggestion: settle Phase 15 first. Building iOS before deciding what native *is*
means porting by default, one screen at a time, which is how a second platform quietly
doubles the maintenance surface of every future phase.

## Open questions — the ones the decision turns on

1. **What is native for?** Three coherent answers, and they imply very different subsets: a
   full peer of the web app; a *recording companion* that captures takes and hands them to
   the web app to edit; or a *viewer* for a library built elsewhere. The companion answer is
   the one the code is already closest to, and the one that plays to native's genuine
   advantage — it has the better microphone path.
2. **Does the existing live Android app get upgraded to the web feature set, or does it stay
   as it is?** It currently has none of the library, import or Studio work
   (`project_live_app_vs_web_branch`). "Leave it be and put new work on web" is a legitimate
   answer for a solo developer, and it should be considered explicitly rather than by
   default.
3. **Does native get accounts?** Phase 7's open question 4, restated. Everything downstream
   of it — sync, entitlement portability, `/profile` — follows from the answer.
4. **Who maintains parity?** Every phase after this one gains a "and on native?" cost. If the
   answer to (1) is "full peer", that cost is permanent and should be priced in before
   agreeing to it.
