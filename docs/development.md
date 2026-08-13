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

```bash
npx expo export --platform web     # → dist/
npx firebase deploy --only hosting
```

---

## Firebase

The project is `harp2tab` (see `.firebaserc`). Firestore rules live in `firestore.rules`;
Cloud Functions — currently the RevenueCat webhook entitlement writer — live in `functions/`
and are a **separate npm package** with its own `package.json` and `node_modules`.

```bash
npm --prefix functions install
npm --prefix functions run build       # tsc → functions/lib
npm --prefix functions run typecheck

npx firebase emulators:start           # firestore :8080, functions :5001, UI :4000
npx firebase deploy --only functions
```

`functions/.secret.local` holds emulator secrets and is never committed.

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
