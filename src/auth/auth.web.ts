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
  EmailAuthProvider,
  GoogleAuthProvider,
  applyActionCode,
  confirmPasswordReset as fbConfirmPasswordReset,
  createUserWithEmailAndPassword,
  deleteUser as fbDeleteUser,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  verifyPasswordResetCode,
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

/**
 * Raised when someone signs in with a method the address is not registered under — 7-5's
 * case. Carries the address so the caller can name it without re-deriving it.
 *
 * Its own type because the remedy is a flow, not a message: sign in with the original
 * method, then link the new one. A caller that cannot distinguish this from a generic
 * failure can only tell the user to try again, which is exactly what will not work.
 */
export class AccountExistsWithOtherMethod extends Error {
  constructor(readonly email: string) {
    super(`An account already exists for ${email} using a different sign-in method.`);
    this.name = 'AccountExistsWithOtherMethod';
  }
}

/** Raised when Firebase wants a fresh sign-in before a sensitive change. Callers respond by
 *  opening `ReauthModal` and retrying, rather than by showing this to the user. */
export class ReauthRequired extends Error {
  constructor() {
    super('Please confirm it is you before making this change.');
    this.name = 'ReauthRequired';
  }
}

/**
 * Firebase error code → copy that is safe to show a user.
 *
 * **The enumeration-protection cases are the ones to get right.** The project has email
 * enumeration protection enabled, which deliberately collapses "no account with that
 * address" and "wrong password" into a single `auth/invalid-credential` — the app genuinely
 * cannot tell which, by design. So the copy names both possibilities and offers the reset
 * link alongside. Writing it this way from the start matters: the tempting fix, when someone
 * reports the vagueness as a bug, is to turn the protection off.
 */
function describeAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password don\'t match an account. Check them, or reset your password.';
    case 'auth/email-already-in-use':
      // Names Google explicitly rather than saying "sign in instead". With
      // one-account-per-email linking enabled, much the most likely reason this address is
      // taken is that it was created with Google — and telling someone to sign in, when the
      // account they have has no password, sends them to a form that cannot work and then to
      // a reset email for a password that never existed.
      return 'There is already an account with that email. Sign in instead — and if you created it with Google, use Continue with Google.';
    case 'auth/invalid-email':
      return 'That does not look like an email address.';
    case 'auth/weak-password':
      return 'That password is too short. Use at least 8 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the server. Check your connection and try again.';
    case 'auth/user-disabled':
      return 'That account has been disabled.';
    case 'auth/provider-already-linked':
      return 'That sign-in method is already on your account.';
    case 'auth/credential-already-in-use':
      return 'That email is already used by another account.';
    case 'auth/operation-not-allowed':
      return 'That sign-in method is not enabled for this project.';
    default:
      // The code is included rather than hidden. These are the cases nobody anticipated, and
      // a user who can quote the code turns an unreproducible report into a fixable one.
      return `Something went wrong (${code}). Please try again.`;
  }
}

/**
 * Wraps an SDK call so every failure leaves here as a plain `Error` with user-safe copy,
 * and the original is always logged.
 *
 * Centralised because the alternative — a `try/catch` per function — is how one of them ends
 * up leaking `auth/invalid-credential` into the UI.
 */
async function mapErrors<T>(what: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const code = (error as { code?: string }).code ?? '(no code)';
    console.error(`[auth] ${what} failed:`, code, error);

    if (code === 'auth/requires-recent-login') throw new ReauthRequired();
    if (code === 'auth/account-exists-with-different-credential') {
      const email = (error as { customData?: { email?: string } }).customData?.email ?? '';
      throw new AccountExistsWithOtherMethod(email);
    }
    throw new Error(describeAuthError(code));
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

  /**
   * **A Google identity counts as a confirmed address, even when Firebase's own flag says
   * otherwise.** Decided by the user, 2026-08-13, after observing the behaviour below.
   *
   * Firebase sets `emailVerified` back to `false` when an email/password credential is
   * linked to an account — including one created through Google, where the address was
   * already verified. It also sends no email when that happens. The result is an account
   * that is told to confirm an address nobody asked it to confirm, by a banner promising a
   * link that was never sent.
   *
   * Trusting Google here is sound rather than a shortcut: verification exists to prove the
   * user controls the address, and signing in through Google proves exactly that. Asking
   * again proves nothing new.
   *
   * **This obliges 7-12's Firestore rules to agree.** A rule written as
   * `request.auth.token.email_verified == true` will reject these users, and the symptom
   * would be a UI that says confirmed next to a backend that refuses to sync — worse than
   * the bug this fixes, and much harder to trace. The rule has to accept a Google identity
   * too, via `'google.com' in request.auth.token.firebase.identities`. Do not write those
   * rules without reading this comment.
   */
  const confirmedByGoogle = providers.includes('google');

  return {
    uid:           user.uid,
    email:         user.email ?? '',
    displayName:   user.displayName,
    emailVerified: user.emailVerified || confirmedByGoogle,
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

/* ── Email and password (7-4) ─────────────────────────────────────────────────────────── */

/**
 * Create the account, then send the confirmation email.
 *
 * The user is signed in immediately and `emailVerified` is false. That is deliberate and is
 * 7-4's decision: **unverified users are not locked out — sync is what waits.** Firebase
 * signs them in happily, so the enforcement point is ours to choose, and blocking the app
 * would strand someone whose confirmation mail is slow at the exact moment they were trying
 * to save a take.
 *
 * The verification send is not allowed to fail the signup. The account exists by then, so
 * throwing here would report failure for something that succeeded, and the user would be
 * unable to retry without hitting `email-already-in-use`. `VerifyBanner`'s resend button is
 * the recovery path, and it is on screen the moment this returns.
 */
export async function signUpWithEmail(email: string, password: string): Promise<AuthUser> {
  const credential = await mapErrors('Email sign-up', () =>
    createUserWithEmailAndPassword(firebaseAuth(), email, password));

  try {
    await sendEmailVerification(credential.user);
    // Logged on success too, not only on failure. Delivery is invisible from here — the SDK
    // resolves when Firebase has *accepted* the request, which says nothing about whether the
    // mail arrived. Without this line, "no email" cannot be told apart from "never sent", and
    // those have completely different causes.
    console.info('[auth] Verification email accepted by Firebase for', credential.user.email);
  } catch (error) {
    console.error('[auth] Verification email failed to send after signup:', error);
  }

  return toAuthUser(credential.user);
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const credential = await mapErrors('Email sign-in', () =>
    signInWithEmailAndPassword(firebaseAuth(), email, password));
  return toAuthUser(credential.user);
}

/**
 * Under enumeration protection this resolves whether or not the address has an account —
 * that is the point of the setting, and the UI must not imply otherwise. `AuthModal`'s
 * "check your inbox" panel is worded to be true either way.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  await mapErrors('Password reset', () => sendPasswordResetEmail(firebaseAuth(), email));
}

export async function resendVerification(): Promise<void> {
  const current = firebaseAuth().currentUser;
  if (!current) throw new Error('You are not signed in.');
  if (current.emailVerified) throw new Error('Your email is already confirmed.');
  await mapErrors('Resend verification', () => sendEmailVerification(current));
  console.info('[auth] Verification email re-sent, accepted by Firebase for', current.email);
}

export async function updateDisplayName(name: string): Promise<AuthUser> {
  const current = firebaseAuth().currentUser;
  if (!current) throw new Error('You are not signed in.');
  await mapErrors('Update display name', () => updateProfile(current, { displayName: name }));
  return toAuthUser(current);
}

/* ── Linking (7-5) ────────────────────────────────────────────────────────────────────── */

/**
 * Adds a password to an account that currently signs in with Google only.
 *
 * The address is taken from the signed-in user rather than from an argument: linking a
 * *different* address would produce an account whose password login and Google login
 * disagree about who owns it, which is the same data-partition failure 7-5 exists to prevent.
 */
export async function linkEmailPassword(email: string, password: string): Promise<AuthUser> {
  const current = firebaseAuth().currentUser;
  if (!current) throw new Error('You are not signed in.');
  if (current.email && email.toLowerCase() !== current.email.toLowerCase()) {
    throw new Error(`Your account uses ${current.email}. A password can only be added to that address.`);
  }

  const credential = EmailAuthProvider.credential(email, password);
  const linked = await mapErrors('Link email sign-in', () => linkWithCredential(current, credential));

  /**
   * Re-read from the server before reporting the result.
   *
   * Linking rewrites the account's provider list, and the `User` handed back carries the
   * token from *before* that write. `emailVerified` is the field where this shows: an account
   * created with Google is already verified, and a stale copy that says otherwise puts the
   * "Confirm your email to turn on sync" banner in front of someone who has nothing to
   * confirm — asking them to prove what Google just proved.
   *
   * Cheap, and the only way to be sure the flag reflects the account rather than the moment
   * before it changed.
   */
  await linked.user.reload();
  const fresh = firebaseAuth().currentUser ?? linked.user;
  console.info('[auth] Linked email sign-in. emailVerified before/after reload:',
    linked.user.emailVerified, '→', fresh.emailVerified);

  return toAuthUser(fresh);
}

/**
 * Re-authenticates before a sensitive change. Shared by deletion, email change and password
 * change, which is why it is one function rather than three inline blocks.
 *
 * A password account re-enters its password; a Google-only account cannot, so it goes back
 * through the provider popup. `ReauthModal` already renders both paths, and passing no
 * password is how it says "this account has no password".
 */
export async function reauthenticate(password?: string): Promise<void> {
  const current = firebaseAuth().currentUser;
  if (!current) throw new Error('You are not signed in.');

  await mapErrors('Re-authentication', async () => {
    if (password && current.email) {
      const credential = EmailAuthProvider.credential(current.email, password);
      await reauthenticateWithCredential(current, credential);
    } else {
      await reauthenticateWithPopup(current, new GoogleAuthProvider());
    }
  });
}

/* ── Deletion (7-13) ──────────────────────────────────────────────────────────────────── */

/**
 * Deletes the Auth user.
 *
 * **Deliberately does not touch local data.** The tabs on this device are the user's own work
 * and predate the account — most of them were made before they ever signed in. Deleting them
 * alongside the account would destroy work the account never owned, and the confirmation
 * dialog promises the opposite in as many words.
 *
 * **Scope today is the Auth user only.** There is no Firestore yet (7-12 / 7b), so there is
 * no subtree and no entitlement document to remove. When those exist this needs the Cloud
 * Function the plan describes — a client cannot reliably delete a subtree, and a half-deleted
 * account is worse than an undeleted one. Until then this is complete rather than partial,
 * because there is genuinely nothing else stored server-side.
 *
 * Throws `ReauthRequired` on a stale session, via `mapErrors`. That is not an edge case: the
 * users most likely to be deleting are the long-dormant ones, who are exactly the users whose
 * sign-in is old enough for Firebase to refuse.
 */
export async function deleteAccount(): Promise<void> {
  const current = firebaseAuth().currentUser;
  if (!current) throw new Error('You are not signed in.');
  await mapErrors('Account deletion', () => fbDeleteUser(current));
}

/* ── The action-handler codes (7-4's `/auth/action`) ──────────────────────────────────── */

/** `?mode=verifyEmail`. Confirms the address the code was minted for. */
export async function applyVerificationCode(oobCode: string): Promise<void> {
  await mapErrors('Email verification', () => applyActionCode(firebaseAuth(), oobCode));
}

/** `?mode=resetPassword`, step one: validate the code and recover the address it belongs to,
 *  so the form can name whose password is being set rather than asking blind. */
export async function checkPasswordResetCode(oobCode: string): Promise<string> {
  return mapErrors('Password reset check', () => verifyPasswordResetCode(firebaseAuth(), oobCode));
}

/** `?mode=resetPassword`, step two. */
export async function confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
  await mapErrors('Password reset', () => fbConfirmPasswordReset(firebaseAuth(), oobCode, newPassword));
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
