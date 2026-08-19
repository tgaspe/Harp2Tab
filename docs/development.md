# Development

Running, building, releasing and debugging Harp2Tab. For how the code is put together see
[architecture.md](architecture.md); for the verification harnesses see [testing.md](testing.md).

## First-time setup

```bash
npm install
cp .env.example .env      # then fill in the six Firebase web values
```

`.env.example` documents where each value comes from. The Firebase web config is public by
design — it identifies the project rather than authorising anything — but it lives in `.env`
so staging and production can differ per machine. Firestore rules are what protect the data.

## App Info
- **Package:** `com.chewpacastudios.harp2tab`
- **Privacy policy:** https://tgaspe.github.io/harp2tab-privacy/
- **Google Group (testers):** https://groups.google.com/u/4/g/chewpacastudios
- **Status:** LIVE on Google Play (production)
- **Play Store listing:** https://play.google.com/store/apps/details?id=com.chewpacastudios.harp2tab
- **Testing opt-in link (legacy, pre-launch):** https://play.google.com/apps/testing/com.chewpacastudios.harp2tab
- **EAS Project ID:** `47dcbf95-955c-48a0-bb45-e1e6204f209f`

---

## ADB Commands

```bash
adb devices        # list connected devices
adb logcat         # stream device logs (Ctrl+C to stop)
adb logcat | grep -i harp2tab   # filter logs to your app only
```

---

## Web (the primary target)

```bash
npx expo start --web
```

Serves at `localhost:8081`.

> **The dev server can serve stale code.** If a fix doesn't appear to apply, restart with
> `npx expo start --web --clear` and confirm the served bundle actually changed before
> concluding the fix failed. A per-module `curl` against
> `.bundle?modulesOnly=true` will compile-check a single file without opening a browser.

### Static web build

`npx expo export --platform web` writes `dist/`. **Do not run it bare to produce a deploy** —
see [Deploying](#deploying) for the env prefix that keeps the emulator out of the bundle.

---

## Deploying

Live at <https://harp2tab.com> (attached 2026-08-18; `harp2tab.web.app` still works and is the
same site). `www.harp2tab.com` redirects to the apex.

> **A new hostname needs adding to Firebase Auth's authorized domains, or Google sign-in
> breaks on it.** `harp2tab.com` shipped without this and sign-in failed there for a day
> while working fine on `harp2tab.web.app`, because only the `web.app` and `firebaseapp.com`
> defaults were on the list. The app reports it clearly — `src/auth/auth.web.ts:246` turns
> `auth/unauthorized-domain` into a message naming the console page — so trust that error
> rather than debugging the sign-in code. Read the list with:
>
> ```bash
> curl -sS -H "Authorization: Bearer $(gcloud auth print-access-token)" \
>   -H 'x-goog-user-project: harp2tab' \
>   https://identitytoolkit.googleapis.com/admin/v2/projects/harp2tab/config
> ```
>
> A `PATCH` to the same URL with `?updateMask=authorizedDomains` writes it; the body
> replaces the whole list, so include the existing entries.

### The web app

```bash
rm -rf dist                                                   # stale routes survive otherwise
EXPO_PUBLIC_FIREBASE_EMULATOR=0 npx expo export --platform web
grep -rl "localhost:8080" dist/ || echo "clean"               # MUST print: clean
npx firebase deploy --only hosting
```

> **The `EXPO_PUBLIC_FIREBASE_EMULATOR=0` prefix is not optional.** `EXPO_PUBLIC_*` values are
> inlined into the bundle at export time, so a `.env` left at `=1` from a dev session ships a
> production site that talks to `localhost:8080`. It loads perfectly on the machine that built
> it — the emulator is right there — and fails for every real visitor. A real process env var
> takes precedence over the `.env` file, so the prefix overrides without editing `.env` and
> without breaking your emulator loop. The `grep` is the proof; run it before every deploy.

**Verify a deploy with an asset, never only a route.** Every HTML route can return 200 while the
site renders unstyled with no icons:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://harp2tab.web.app/settings          # cleanUrls
curl -s -o /dev/null -w '%{http_code}\n' "https://harp2tab.web.app$(cd dist && \
  find assets -name 'Ionicons.*.ttf' | head -1 | sed 's|^|/|')"                     # fonts
```

> **Never put `**/node_modules/**` in `hosting.ignore`.** It is in Firebase's `init` template
> and it is wrong here: Expo emits every bundled font and icon under `dist/assets/node_modules/`,
> so that one glob silently drops ~60 files and ships a site with no typography. The deploy log
> is the tell — compare its file count against `find dist -type f | wc -l`.

### Rules, indexes, functions

```bash
npx firebase deploy --only firestore:rules,firestore:indexes
npx firebase deploy --only functions          # requires the Blaze plan
npx firebase deploy                           # everything at once
```

`firestore:rules` is idempotent — "already up to date, skipping upload" means production already
matches the working copy, which is also the quickest way to check what is live, since the CLI has
no command to read deployed rules back.

Cloud Functions need **Blaze**; on Spark the deploy fails and Secret Manager is unreachable, so
`functions:secrets:*` errors before it can tell you anything useful.

---

## Firebase

The project is `harp2tab` (see `.firebaserc`). Firestore rules live in `firestore.rules`;
Cloud Functions — currently the RevenueCat webhook entitlement writer — live in `functions/`
and are a **separate npm package** with its own `package.json` and `node_modules`.

```bash
npm --prefix functions install
npm --prefix functions run build       # tsc → functions/lib
npm --prefix functions run typecheck

export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # the emulator needs JDK 21+
export PATH="$JAVA_HOME/bin:$PATH"                 # and resolves `java` from PATH, not JAVA_HOME
npx firebase emulators:start           # firestore :8080, functions :5001, UI :4000
npx firebase deploy --only functions
```

`functions/.secret.local` holds emulator secrets and is never committed. Deployed secrets live in
Secret Manager, and **a new secret version is not used until the function is redeployed** — the
deploy pins a version.

### The RevenueCat webhook (8-2)

Deployed and live at `https://us-central1-harp2tab.cloudfunctions.net/revenuecatWebhook`.

```bash
npx firebase deploy --only functions:revenuecatWebhook
npx firebase functions:log --only revenuecatWebhook
```

Its runtime config is `functions/.env` (`RC_LIFETIME_PRODUCT_IDS`, `RC_ACCEPT_SANDBOX`) plus the
`REVENUECAT_WEBHOOK_SECRET` secret. Set the secret without a trailing newline — the interactive
prompt captures one from a paste, and the comparison is byte-for-byte, so every delivery 401s:

```bash
S=$(openssl rand -hex 32); printf '%s' "$S" | npx firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET --data-file -; echo "$S"
```

Day-to-day operation of Stripe and RevenueCat once money is real — changing a price, refunds,
hand-granting access, and the "I paid but I don't have access" checklist — is in
[`billing-operations.md`](billing-operations.md).

Reading the logs: `Ignored event` is a normal outcome (the event names no `premium` entitlement)
and still answers 200 — a non-2xx would only make RevenueCat retry something correctly refused.
`Dropped stale event` is the staleness guard refusing an out-of-order delivery. Full runbook in
[`stripe-setup.md`](stripe-setup.md).

### Cloud sync (7b)

**On since 2026-08-18** (`SYNC_ENABLED = true`, `src/sync/syncEngine.ts`). It shipped `false`,
which meant the deployed site wrote nothing to Firestore at all: the gate at `syncEngine.ts:113`
is `(!SYNC_ENABLED && !isEmulator())`, and with the emulator off in a production build both
halves were false. An empty Firestore console looks identical to a permissions failure — check
this flag before suspecting rules. The merge logic needs neither
the flag nor the emulator to be exercised — `npx tsx scripts/verify-sync-merge.ts` drives all 58
cases as a pure function.

**To watch it actually write documents, use the emulator — not the flag:**

```bash
echo 'EXPO_PUBLIC_FIREBASE_EMULATOR=1' >> .env

export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$JAVA_HOME/bin:$PATH"
npx firebase emulators:start --only firestore    # terminal 1

npx expo start --web --clear                     # terminal 2 — --clear, or the old env is cached
```

Then sign in and save a tab. Documents appear at <http://localhost:4000/firestore> under
`users/{uid}/tabs`. The console logs `[firebase] Firestore → emulator …` on the first call,
because a build silently talking to an emulator looks exactly like a build whose sync is broken.

**One handle, one connect (fixed 2026-08-19).** `getFirestore(app)` returns a *singleton per
app*, not a handle per caller. Three modules each memoised "their own" instance and each called
`connectFirestoreEmulator` on it, so the second throws *"Firestore has already been started and
its settings can no longer be changed"* and whichever module touched Firestore first decided who
worked. Worse, `entitlement.web.ts` never connected the emulator at all, so entitlement reads
went to the **real project** while everything else talked to `127.0.0.1`. The instance and the
connect now live in `firestoreDb()` (`src/auth/firebase.web.ts`), and every consumer goes through
it. **A fourth consumer calls that function, never `getFirestore` directly.**

⚠️ **Turn the emulator flag off for any entitlement or billing testing.** The RevenueCat webhook
writes to the real project and cannot reach a local emulator, so with the flag on `/profile`
reads an empty local database and reports Free no matter what was bought.

`EXPO_PUBLIC_FIREBASE_EMULATOR=1` **enables the engine on its own**, independently of
`SYNC_ENABLED`. That is why emulator work never required flipping the production switch — and
why, now that the switch is on, the emulator variable is the only thing keeping a dev session
out of the real project. Unset it and your local writes land in production.
Auth still points at the real project, so Google sign-in works — the Firestore emulator decodes
a genuine ID token without verifying it, which is enough for the rules to be exercised properly.

Turning `SYNC_ENABLED` on means real documents: read the Status section of
[`plan/phase-07b-sync.md`](plan/phase-07b-sync.md) first, which lists what must happen before the
flip (including a privacy-policy edit that is a release blocker, not a follow-up).

Two functions are deployed:

| Function | Trigger | Does |
|---|---|---|
| `revenuecatWebhook` | HTTPS POST | Writes `/entitlements/{uid}` from RevenueCat events |
| `onAccountDeleted` | Auth user deletion | Erases the entitlement document and the user's synced subtree |

Set `RC_LIFETIME_PRODUCT_IDS` (comma-separated) once 8-1 configures the real product ids —
it is how the writer recognises a one-time purchase rather than inferring it from a missing
expiry field.

---

## Tests

There is no Jest setup — verification is a set of `scripts/verify-*.ts` harnesses run with
`tsx`:

```bash
npx tsx scripts/verify-audio-import.ts
```

See [testing.md](testing.md) for the full suite and what each harness covers.

---

## Development Build (USB testing)

```bash
npx expo run:android --device
```

Builds a debug APK and installs it directly on the connected device via USB. Use this for day-to-day development.

> **Note:** If you see Gradle metadata errors, use the manual build instead:
> ```bash
> cd android && ./gradlew app:assembleDebug \
>   -PreactNativeArchitectures=arm64-v8a \
>   -PreactNativeDevServerPort=8081 \
>   --no-configure-on-demand && \
> adb install -r app/build/outputs/apk/debug/app-debug.apk
> ```

---

## Updating the Version

Edit **`android/app/build.gradle`** (lines ~104–105):

```groovy
versionCode 7       // ← increment this for every Play Store upload
versionName "1.0.0" // ← human-readable label shown to users
```

Rules:
- `versionCode` must always increase — Play Store rejects duplicates or downgrades
- `versionName` is just a label, but keep it in sync for your own sanity
- `app.json` is **ignored** in the bare workflow — only `build.gradle` counts

---

## Release Build (Play Store)

All three commands must be run from the `android/` directory.

### Step 1 — Build the AAB
```bash
cd android && ./gradlew app:bundleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  --no-configure-on-demand
```
Output: `android/app/build/outputs/bundle/release/app-release.aab`

### Step 2 — Extract debug symbols
```bash
./gradlew app:extractReleaseNativeDebugMetadata \
  -PreactNativeArchitectures=arm64-v8a \
  --no-configure-on-demand
```
Pulls debug info from every `.so` file (including your C++ audio engine `libharp2tab-audio`).

### Step 3 — Zip the debug symbols
```bash
./gradlew app:mergeReleaseNativeDebugMetadata \
  -PreactNativeArchitectures=arm64-v8a \
  --no-configure-on-demand
```
Output: `app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip`

### What to upload to Google Play
| File | Purpose |
|------|---------|
| `android/app/build/outputs/bundle/release/app-release.aab` | The app itself |
| `android/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip` | Crashlytics readable stack traces |

---

## Cloud Build (EAS)

```bash
eas build --platform android --profile production
```

Builds on Expo's servers — multi-architecture (~76MB AAB vs ~35MB local arm64-only). Symbols are handled automatically by EAS. Use this when you want a production-grade multi-arch build.

---

## Key Files & Paths

| What | Where |
|------|-------|
| Version code | `android/app/build.gradle` → `defaultConfig.versionCode` |
| App icon (launcher) | `android/app/src/main/res/mipmap-*/ic_launcher*.webp` |
| Signing config | `android/keystore.properties` *(gitignored)* |
| Keystore file | `android/app/release.keystore` *(gitignored)* |
| Native audio C++ | `android/audiocapture/src/main/cpp/` |
| Harmonica mapping | `src/audio/HarmonicaMapper.ts` |
| App store | `src/store/useAppStore.ts` |
| Firestore rules | `firestore.rules` |
| Cloud Functions | `functions/src/` |
| Cloud sync | `src/sync/` — `SYNC_ENABLED` in `syncEngine.ts` is the on/off switch |
| Firebase web config | `.env` *(gitignored, see `.env.example`)* |

---

## Paywall

Live on Android: trial gate (3 base + 3 review-bonus recordings) and paywall are active in
`src/app/index.tsx`, wired to `harp2tab_premium` (one-time IAP via `react-native-iap`).

Web billing (Stripe Managed Payments behind RevenueCat) is a separate path — see
[plan/phase-08-monetization.md](plan/phase-08-monetization.md).

---

## Key Constraints

- **Native is Android only** — no iOS build configured
- **Architecture:** `arm64-v8a` only (set in `build.gradle` `abiFilters`)
- **New Architecture:** `newArchEnabled: false` (Expo SDK 55 / RN 0.83.6)
- **`expo-file-system`:** import from `'expo-file-system/legacy'` (v55 breaking change)
- **Native events:** use `DeviceEventEmitter`, not `NativeEventEmitter`
- **`--no-configure-on-demand`** required for all Gradle commands (breaks kotlin-dsl metadata otherwise)
- **`externalNativeBuild`** must stay in `:audiocapture` module, NOT in `:app` (causes PlatformConstants crash)
