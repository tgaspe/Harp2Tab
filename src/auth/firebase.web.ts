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
import type { Firestore } from 'firebase/firestore';

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

/**
 * **The one Firestore handle, and the one place the emulator is connected.**
 *
 * `getFirestore(app)` returns a *singleton per app*, not a fresh handle per caller — so three
 * modules each memoising "their own" instance were all memoising the same object, and the
 * second `connectFirestoreEmulator` on it threw *"Firestore has already been started and its
 * settings can no longer be changed"*. Whichever module happened to touch Firestore first
 * decided whether the others worked, which made the failure look like a race (it was one) and
 * land on whichever feature lost.
 *
 * The worse half was silent: `entitlement.web.ts` never connected the emulator at all, so with
 * `EXPO_PUBLIC_FIREBASE_EMULATOR=1` every entitlement read went to the **real project** while
 * sync talked to `127.0.0.1`. A dev session reading production is not a bug you notice — it
 * looks like everything working.
 *
 * So: every consumer of Firestore in this app goes through here. Adding a fourth means calling
 * this function, never `getFirestore` directly.
 *
 * Firestore stays a dynamic import for the reason given in `sync/firestore.web.ts`: keeping it
 * out of the static graph is what stops a signed-out visitor downloading the Firestore chunk to
 * read the landing page.
 */
let firestoreInstance: Firestore | undefined;

export async function firestoreDb(): Promise<Firestore> {
  if (firestoreInstance) return firestoreInstance;

  const { getFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  firestoreInstance = getFirestore(firebaseApp());

  if (isEmulator()) {
    connectFirestoreEmulator(firestoreInstance, EMULATOR_HOST, EMULATOR_PORT);
    // Loud on purpose. A build silently talking to an emulator looks exactly like a build whose
    // sync is broken — no documents appear in the console and nothing errors.
    console.info(`[firebase] Firestore → emulator ${EMULATOR_HOST}:${EMULATOR_PORT} (not the real project)`);
  }

  return firestoreInstance;
}

/**
 * Point the SDK at the local emulator instead of the real project.
 *
 * Set `EXPO_PUBLIC_FIREBASE_EMULATOR=1` in `.env` and start it with
 * `npx firebase emulators:start --only firestore`. **Auth is deliberately left pointing at the
 * real project**, so Google sign-in still works — the Firestore emulator decodes a genuine ID
 * token without verifying it, which is enough for `request.auth` and therefore for the rules to
 * be exercised properly.
 *
 * Written as a complete `process.env.X` member expression, not a lookup through a variable.
 * Expo 55 rewrites these to a virtual env module at build time, and that rewrite is a syntactic
 * match on the full expression — `process.env[key]` is not a form it can see.
 */
export const isEmulator = (): boolean =>
  process.env.EXPO_PUBLIC_FIREBASE_EMULATOR === '1';

const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORT = 8080;
