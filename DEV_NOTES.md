# Harp2Tab — Developer Notes

## App Info
- **Package:** `com.chewpacastudios.harp2tab`
- **Privacy policy:** https://tgaspe.github.io/harp2tab-privacy/
- **Google Group (testers):** https://groups.google.com/u/4/g/chewpacastudios
- **Closed Test Link (Android):** https://play.google.com/store/apps/details?id=com.chewpacastudios.harp2tab
- **Closed Test Link (Web):** https://play.google.com/apps/testing/com.chewpacastudios.harp2tab
- **EAS Project ID:** `47dcbf95-955c-48a0-bb45-e1e6204f209f`

---

## ADB Commands

```bash
adb devices        # list connected devices
adb logcat         # stream device logs (Ctrl+C to stop)
adb logcat | grep -i harp2tab   # filter logs to your app only
```

---

## Development Build (USB testing)

```bash
npx expo run:android
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

---

## Paywall (Disabled for Closed Testing)

The recording limit is currently commented out. Search for `// re-enable for paywall` in:
- `src/app/index.tsx` — import, state reads, and the limit check in `handleStart()`

When ready to re-enable before public launch, uncomment all those sections and restore the paywall logic.

---

## Key Constraints

- **Android only** — no iOS build configured
- **Architecture:** `arm64-v8a` only (set in `build.gradle` `abiFilters`)
- **New Architecture:** `newArchEnabled: false` (Expo SDK 55 / RN 0.83.6)
- **`expo-file-system`:** import from `'expo-file-system/legacy'` (v55 breaking change)
- **Native events:** use `DeviceEventEmitter`, not `NativeEventEmitter`
- **`--no-configure-on-demand`** required for all Gradle commands (breaks kotlin-dsl metadata otherwise)
- **`externalNativeBuild`** must stay in `:audiocapture` module, NOT in `:app` (causes PlatformConstants crash)
