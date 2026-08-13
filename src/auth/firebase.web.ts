/**
 * Firebase app + auth handles for web. The native half is `firebase.ts` beside this.
 *
 * Placed in `src/auth/` rather than the `src/lib/` the plan named, because this repo has no
 * `src/lib/` — platform splits live next to the domain they serve (`store/storage.native.ts`,
 * `hooks/useIAP.web.ts`, `native/AudioCapture.web.ts`). Metro resolves `.web` ahead of the
 * bare file, so importing `./firebase` gets this on web and the native stub everywhere else.
 *
 * **Nothing outside `src/auth/` imports this, or anything from `firebase/*`.** That rule is
 * what keeps the platform split from leaking: consumers get `AuthUser` from `./types`, and
 * the two SDKs stay invisible to every screen.
 *
 * **Firestore is deliberately not imported here.** Auth is the only Firebase surface 7a
 * needs, and the Firestore chunk is a large thing for a signed-out visitor to download for
 * nothing. 7b adds it behind a dynamic `import()` so it stays out of the initial bundle;
 * keeping this module auth-only is what makes that possible later.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  initializeAuth,
  type Auth,
} from 'firebase/auth';

/**
 * Read from `EXPO_PUBLIC_`-prefixed env rather than hardcoded, so staging and production can
 * differ without a code change.
 *
 * These are inlined by the bundler at build time, which is why each is written out as a
 * complete `process.env.X` expression rather than looked up through a variable or a loop —
 * the inlining is a literal text substitution, and `process.env[key]` is not a form it can
 * see. This is the one place in the app where that matters.
 */
const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

/* TODO(domain): `authDomain` currently resolves to `harp2tab.firebaseapp.com` from `.env`.
 * When the custom domain is bought, change it there and add Firebase Hosting's `__/auth`
 * rewrite — no code change is needed here, which is the point of reading it from env. See
 * the deferral block in `useAuth.ts`. */

/**
 * Missing config fails loudly at the first call rather than quietly at sign-in.
 *
 * Firebase's own error for an absent `apiKey` is `auth/invalid-api-key`, thrown deep inside
 * the SDK at the moment someone presses a button — far from the cause, and easy to read as
 * "Google sign-in is broken" rather than "`.env` was never filled in". Since `.env` is
 * gitignored, a fresh clone hits this every time, so it is worth naming precisely.
 */
function checkedConfig(): Record<string, string> {
  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Firebase is not configured — missing ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill it in from the Firebase console ' +
      '(Project settings → General → Your apps → Web app → Config), then restart the dev ' +
      'server with `npx expo start --web --clear` so the new values are picked up.',
    );
  }

  return firebaseConfig as Record<string, string>;
}

/**
 * Idempotent. Metro's fast refresh re-executes modules, and `initializeApp` throws
 * `app/duplicate-app` on a second call — so a hot reload during development would break the
 * app in a way that only a full refresh clears.
 */
export function firebaseApp(): FirebaseApp {
  const config = checkedConfig();
  return getApps().length > 0 ? getApp() : initializeApp(config);
}

/**
 * **localStorage persistence, not the default IndexedDB — this is a bug fix, not a
 * preference.**
 *
 * `getAuth()` selects `indexedDBLocalPersistence` on web. That implementation listens for
 * `pagehide` and `visibilitychange`, and when the page goes hidden it sets an internal
 * `isHiding` flag and *closes the database connection*
 * (`@firebase/auth` → `indexed_db.ts`, `onPageHide`). Any subsequent `_openDb()` throws
 * `Database is closing/hidden`.
 *
 * Opening the Google popup hides this page. So the sequence is: popup opens → page hidden →
 * IndexedDB closed → user picks an account → the result comes back → Firebase tries to
 * persist the new user → the DB is still shut, because the write races the page's return to
 * `visible`. The sign-in has already *succeeded* at that point; only the session write
 * fails, which is why it presents as "nothing happened" rather than as a login error.
 *
 * `browserLocalPersistence` is localStorage-backed, has no visibility handling, and cannot
 * hit this. It is also what the rest of this app already uses for every persisted store
 * (`store/storage.ts`), so it is the consistent choice as well as the working one. Auth
 * tokens are a few KB, nowhere near a localStorage limit.
 *
 * `initializeAuth` rather than `getAuth` is what allows specifying persistence at all — and
 * it requires naming the popup/redirect resolver explicitly, since opting out of the
 * defaults opts out of all of them. Without it, `signInWithPopup` fails with
 * `auth/operation-not-supported-in-this-environment`.
 */
export function firebaseAuth(): Auth {
  const app = firebaseApp();
  try {
    return initializeAuth(app, {
      persistence:           browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // `auth/already-initialized` — this module re-executed under fast refresh while the
    // underlying app instance survived. The existing handle already has the config above.
    return getAuth(app);
  }
}

/** Whether `.env` has been filled in. Lets a caller degrade rather than throw — used by the
 *  auth bootstrap so a misconfigured build renders signed-out instead of a blank screen. */
export const isFirebaseConfigured = (): boolean =>
  Object.values(firebaseConfig).every(Boolean);
