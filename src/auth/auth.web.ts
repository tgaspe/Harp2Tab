/**
 * The web half of the auth seam — the `firebase` JS SDK behind our own vocabulary.
 *
 * Everything Firebase-shaped stops here. Callers get `AuthUser` and plain `Error`s with
 * copy that is safe to show a user; nothing above this file imports `firebase/*` or handles
 * an error code. That is what lets native swap in `@react-native-firebase/auth` later
 * (7-14) without touching a single consumer.
 *
 * 7a implements Google, sign-out and the auth subscription. The email/password half of this
 * interface lands in 7-4 — see `useAuth.ts`, which still reports those as unbuilt rather
 * than pretending.
 */

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { firebaseAuth } from './firebase.web';
import type { AuthProviderId, AuthUser } from './types';

/** Raised when the user closed the Google popup or opened a second one. Not an error in any
 *  sense the user cares about — they changed their mind — so the UI swallows it rather than
 *  showing a red banner for a deliberate action. */
export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'SignInCancelled';
  }
}

/** Firebase's provider ids are strings like `google.com`; ours are the two the app offers.
 *  Anything unrecognised is dropped rather than passed through, so a provider we never
 *  enabled cannot appear in the sign-in methods list on `/profile`. */
function toProviderId(firebaseProviderId: string): AuthProviderId | null {
  switch (firebaseProviderId) {
    case 'google.com': return 'google';
    case 'password':   return 'password';
    default:           return null;
  }
}

/**
 * Firebase `User` → our `AuthUser`.
 *
 * `email` is typed nullable by the SDK because some providers (phone, anonymous) have none.
 * Neither of ours does — Google always supplies one and a password account is created from
 * one — so an empty string here would mean something has gone genuinely wrong upstream
 * rather than a user legitimately lacking an address.
 */
export function toAuthUser(user: User): AuthUser {
  const providers = user.providerData
    .map((p) => toProviderId(p.providerId))
    .filter((p): p is AuthProviderId => p !== null);

  return {
    uid:           user.uid,
    email:         user.email ?? '',
    displayName:   user.displayName,
    emailVerified: user.emailVerified,
    providers,
    // `creationTime` is an RFC-1123 string, not epoch ms. Parsed once here so "Member since"
    // never has to know that. Falls back to now rather than NaN, which would render as
    // "Member since Invalid Date".
    createdAt:     user.metadata.creationTime
      ? Date.parse(user.metadata.creationTime)
      : Date.now(),
  };
}

/**
 * Popup rather than redirect, deliberately — see 7-1's note. A redirect that round-trips
 * through `*.firebaseapp.com` is the flow browser storage partitioning breaks, and while the
 * custom domain is deferred that makes popup the only reliable option, not merely the nicer
 * one. Popups are blocked only when not user-gesture-driven, and every caller is a button.
 */
export async function signInWithGoogle(): Promise<AuthUser> {
  const provider = new GoogleAuthProvider();
  try {
    const credential = await signInWithPopup(firebaseAuth(), provider);
    return toAuthUser(credential.user);
  } catch (error) {
    const code = (error as { code?: string }).code ?? '(no code)';

    // Always log the real thing before mapping it to user-facing copy.
    //
    // The first version of this function did not, and that was a mistake worth naming: the
    // whole point of translating Firebase codes here is that no *user* should see them, not
    // that no *developer* should. Swallowing the code turned "sign-in failed" into a report
    // with nothing in it, which is precisely the case where the code is the only clue.
    console.error('[auth] Google sign-in failed:', code, error);

    if (code === 'auth/cancelled-popup-request') throw new SignInCancelled();

    // `popup-closed-by-user` is deliberately NOT treated as a silent cancel.
    //
    // Firebase raises it both when someone genuinely dismisses the window and when the popup
    // completed but could not hand its result back to the opener — a Cross-Origin-Opener-
    // Policy mismatch being the usual cause, and one that looks identical from here. Since
    // the second case is a real failure that must not disappear, this reports rather than
    // returning silently. The cost is that a deliberate dismissal also shows a line of text,
    // which is the right way round.
    if (code === 'auth/popup-closed-by-user') {
      throw new Error(
        'The Google window closed before sign-in finished. If you did not close it ' +
        'yourself, this is usually a browser setting blocking the popup from returning — ' +
        'see the console for the underlying error.',
      );
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Your browser blocked the sign-in window. Allow popups for this site and try again.');
    }
    // Worth its own message: it means the origin is missing from the Firebase project's
    // Authorized domains list, which is a console setting rather than anything in the app.
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        `This site (${typeof window !== 'undefined' ? window.location.hostname : 'unknown'}) ` +
        'is not in the Firebase project\'s authorized domains. Add it under ' +
        'Authentication → Settings → Authorized domains.',
      );
    }
    if (code === 'auth/operation-not-allowed') {
      throw new Error('Google sign-in is not enabled for this Firebase project.');
    }

    throw new Error(`Could not sign in with Google (${code}). Please try again.`);
  }
}

export async function signOut(): Promise<void> {
  await fbSignOut(firebaseAuth());
}

/**
 * Fires once with the resolved session and again on every change. The returned function
 * unsubscribes.
 *
 * The first call is what moves the app out of `'resolving'`, and it is why that state exists:
 * it arrives asynchronously even when the answer is "nobody is signed in", read from local
 * persistence rather than the network.
 */
export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
  return onAuthStateChanged(firebaseAuth(), (user) => {
    callback(user ? toAuthUser(user) : null);
  });
}

/**
 * Re-reads the user from the server.
 *
 * Needed because `emailVerified` changes when the user clicks a link in another tab or on
 * their phone, and no auth event fires for it — the cached token keeps saying `false`. 7-4's
 * "I've confirmed" button and a focus listener both land here. Wired now, ahead of the email
 * flow that makes it matter, because the subscription plumbing it needs is being built anyway.
 */
export async function reloadUser(): Promise<AuthUser | null> {
  const current = firebaseAuth().currentUser;
  if (!current) return null;
  await current.reload();
  // `reload()` mutates in place but does not re-fire `onAuthStateChanged`, so the caller has
  // to take the refreshed value from here and push it into the store itself.
  return toAuthUser(firebaseAuth().currentUser ?? current);
}
