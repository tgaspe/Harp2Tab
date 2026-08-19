/**
 * Firebase handles for native — the default resolution, with `firebase.web.ts` taking over
 * on web.
 *
 * **A deliberate stub, not an oversight.** Web ships first
 * (`feedback_web_first_no_mobile_hedging`), and the native half of auth is scoped as 7-14 /
 * Phase 15 rather than deferred silently. Nothing in the web work waits on it.
 *
 * When it is built, this file wraps `@react-native-firebase/auth` — which reads the
 * checked-in `android/app/google-services.json` (project `harp2tab`) and needs no env config
 * at all, unlike the web half. Two things bite there, both already known:
 *
 * - `google-services.json` currently has an empty `oauth_client` array, so Google Sign-In is
 *   not yet provisioned for the Android app. It needs re-downloading after the OAuth client
 *   exists.
 * - The SHA-1 registered in the Firebase project must be the **Play App Signing** certificate
 *   from the Play Console, not the local upload keystore. Getting it wrong fails only in
 *   release builds, which is the most expensive time to find out.
 */

/** Native returns `false` rather than throwing, so the auth bootstrap can render signed-out
 *  on native exactly as it does for a misconfigured web build — one code path, not two. */
export const isFirebaseConfigured = (): boolean => false;

const notOnNative = (): never => {
  throw new Error(
    'Firebase auth is not available on native yet — accounts are web-first (7-14). ' +
    'Callers should branch on `isFirebaseConfigured()` rather than reaching this.',
  );
};

export const firebaseApp  = notOnNative;
export const firebaseAuth = notOnNative;

/**
 * The Firestore handle and the emulator switch, mirroring `firebase.web.ts`.
 *
 * Native never reaches either: `isFirebaseConfigured()` is `false`, so the sync engine's entry
 * condition stops before anything asks for a database. They exist so the `.web` modules that
 * import them typecheck against this file, which is the one TypeScript resolves.
 */
export const firestoreDb: () => Promise<never> = async () => notOnNative();

/** Always false on native — there is no emulator to point at, because there is nothing to sync. */
export const isEmulator = (): boolean => false;
