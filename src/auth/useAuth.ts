/**
 * The single source of auth state for every screen.
 *
 * **Swapped at 7-1, as designed** — the body is now a `useAuthStore` subscription plus the
 * platform-split `./auth` calls, and the signature did not change. No consumer was touched:
 * that was the point of building the UI against this seam first.
 *
 * As of 7-13, **every action here is real** — Google, email and password, verification,
 * reset, linking, re-authentication and deletion. The one exception is `sync`, which is
 * pinned to `'unavailable'` in the store for the whole of 7a because there is no engine
 * behind it until 7b, and a green tick with nothing behind it is the one piece of fakery
 * this phase forbids.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * TODO(domain) — the custom domain is deferred; everything else gets built first.
 *
 * **User decision, 2026-08-13.** Phase 7's plan recommended buying the domain *before*
 * the phase started. That is reversed: build all of 7a against Firebase's default
 * `harp2tab.firebaseapp.com`, buy the domain later, then do the three fix-ups below in
 * one pass. Every `TODO(domain)` in the tree is part of that pass —
 * `grep -rn "TODO(domain)" src/` is the checklist.
 *
 * The three things that actually need it, and what to do when it lands:
 *
 * 1. **`authDomain`** (7-1, now read from `.env` by `firebase.web.ts`). Point it at the
 *    app's own domain and add Firebase Hosting's `__/auth` rewrite. Until then, browsers
 *    that partition third-party storage — Safari ITP, Firefox ETP, Chrome's
 *    third-party-cookie work — can break sign-in that round-trips through
 *    `*.firebaseapp.com`, and the Google popup shows a Firebase subdomain instead of the
 *    app's name.
 * 2. **The action-handler origin** (7-4, `src/app/auth/action.tsx`). Verification and
 *    reset links are minted against `authDomain`, so they change origin with it.
 * 3. **The email sender domain** (7-4, SPF/DKIM). Until it is verified, mail comes from
 *    `noreply@<project>.firebaseapp.com` with Firebase's own wording.
 *
 * **What this costs while deferred, so it is a known risk and not a surprise:**
 * - `signInWithPopup` (7-3's choice) is the *least* affected path — it is same-origin to
 *   the opener and is why popup beats redirect here. Do not switch to redirect while the
 *   domain is deferred; that is the combination that actually breaks.
 * - Links already in someone's inbox are invalidated by the eventual switch, and verified
 *   addresses may need re-verifying. **That is the reason to keep real signups off this
 *   build until the domain lands** — dev and internal testing only.
 * - The default sender lands in spam materially more often. Do not read anything into
 *   deliverability numbers measured before the switch.
 * ──────────────────────────────────────────────────────────────────────────── */

import { useCallback } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  SignInCancelled,
  deleteAccount,
  linkEmailPassword,
  reauthenticate,
  resendVerification,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  signUpWithEmail,
  updateDisplayName,
} from './auth';
import { resolveMockState } from './mockStates';
import { useAuthStore } from './useAuthStore';
import type { AuthState, AuthUser } from './types';

export interface AuthActions {
  /** Resolves `true` when a user is signed in, `false` when they closed the popup.
   *
   *  Not `void`: cancelling is neither success nor an error, and a caller that cannot tell
   *  the difference either dismisses its modal on a cancelled sign-in or shows an error for
   *  a deliberate action. Both are wrong, and the `void` version silently did the first. */
  signInWithGoogle:   () => Promise<boolean>;
  signUpWithEmail:    (email: string, password: string) => Promise<void>;
  signInWithEmail:    (email: string, password: string) => Promise<void>;
  sendPasswordReset:  (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Re-reads the user from the server. Needed because verification happens outside the
   *  app and the cached token goes stale — see `AuthUser.emailVerified`. */
  reloadUser:         () => Promise<void>;
  signOut:            () => Promise<void>;
  deleteAccount:      () => Promise<void>;
  /** Re-signs-in before a sensitive change. `password` is omitted for a Google-only account,
   *  which has none to re-enter and goes back through the provider popup instead. */
  reauthenticate:     (password?: string) => Promise<void>;
  updateDisplayName:  (name: string) => Promise<void>;
  linkEmailPassword:  (email: string, password: string) => Promise<void>;
}

export interface UseAuthResult extends AuthState, AuthActions {
  /** True only when a `?mock=` override is driving state, which `__DEV__` gates below. The
   *  *only* permitted use is copy that tells a reviewer this is a mock — never to change
   *  layout or behaviour. Goes away with the harness at 7-7. */
  isMock: boolean;
}

/**
 * The active mock, latched for the page session.
 *
 * `?mock=` is scoped to the route it appears on, so without this, navigating *within* the
 * app — `/profile` → Upgrade → `/paywall` — would drop the param and silently sign you out
 * halfway through the flow being reviewed. Latching means you set the state once and it
 * survives navigation, which is what makes multi-screen flows testable at all.
 *
 * Reset by reloading with a different `?mock=`, or with `?mock=signedOut`. Module-level
 * rather than in a store on purpose: it must not persist across reloads, and it must not
 * leave anything behind in a user's storage when this harness is deleted.
 *
 * **Kept past 7-1, against the plan, and `__DEV__`-gated instead — deliberate.** The plan
 * deletes this file at 7-1, and the risk it was guarding against is that a mock signed-in
 * state reaches a real user. `__DEV__` is false in every production bundle, so that cannot
 * happen; the gate buys the same safety without the loss.
 *
 * **Re-examined at 7-7 and kept again**, now that most states are genuinely reachable
 * (sign out, Google, an email signup for `unverified`, an empty library for `newUser`). Two
 * are still not, and they are the reason:
 *
 * - `?mock=resolving` holds the bootstrap skeleton indefinitely. Real resolution takes a few
 *   milliseconds, so without this the skeleton cannot be looked at at all.
 * - The five sync-row variants cannot exist until 7b — `sync` is pinned to `'unavailable'`
 *   in the store for the whole of 7a.
 *
 * So it goes at the end of 7b, when the sync row has real states and the skeleton is the only
 * thing left. Delete `mockStates.ts`, this block, `useMockOverride` and `isMock` together —
 * `grep -rn "isMock" src/` is the full list of call sites.
 */
let latchedMock: string | undefined;

/**
 * `useLocalSearchParams` only sees params for the route it is called from, and `TopBar`
 * renders in the root layout — *outside* any route — so it received nothing and rendered
 * "Sign in" next to a signed-in profile page. Reading the query string directly fixes every
 * consumer at once, inside or outside the router tree.
 *
 * This asymmetry is an artefact of the harness, not of the design: at 7-1 the state comes
 * from a store that every consumer subscribes to equally, and the problem cannot recur.
 */
function mockFromLocation(): string | undefined {
  if (typeof window === 'undefined' || !window.location?.search) return undefined;
  return new URLSearchParams(window.location.search).get('mock') ?? undefined;
}

/** The `?mock=` override, or undefined when none is latched. Always undefined outside dev. */
function useMockOverride(): AuthState | undefined {
  // Subscribed to so the hook re-runs on navigation — without it, consumers inside the router
  // tree would not re-render on a route change that alters the mock. Called unconditionally
  // because it is a hook; the `__DEV__` test is applied to the result, not the call.
  const { mock } = useLocalSearchParams<{ mock?: string }>();
  if (!__DEV__) return undefined;

  const fromUrl = mockFromLocation() ?? (typeof mock === 'string' ? mock : undefined);
  if (fromUrl && fromUrl.length > 0) latchedMock = fromUrl;
  return latchedMock ? resolveMockState(latchedMock) : undefined;
}

export function useAuth(): UseAuthResult {
  const mocked = useMockOverride();

  // Three separate selectors rather than one object: zustand compares the selected value by
  // reference, so returning `{status, user, sync}` would allocate a new object every call and
  // re-render every consumer on every unrelated store write.
  const status = useAuthStore((s) => s.status);
  const user   = useAuthStore((s) => s.user);
  const sync   = useAuthStore((s) => s.sync);
  const reload = useAuthStore((s) => s.reload);

  const doSignInWithGoogle = useCallback(async () => {
    try {
      await signInWithGoogle();
      // No state to set: `onAuthChange` fires and the store updates itself. Assigning here
      // as well would give the app two writers for one fact.
      return true;
    } catch (error) {
      // Closing the popup is a decision, not a failure — reported as `false` rather than
      // thrown, so callers can stay put without treating it as an error. Everything else
      // propagates with copy that is already safe to show.
      if (error instanceof SignInCancelled) return false;
      throw error;
    }
  }, []);

  const doSignOut = useCallback(async () => { await signOut(); }, []);

  /**
   * The email actions need no local state handling for the same reason Google does not:
   * `onAuthChange` fires and the store updates itself. The exceptions are the two that change
   * the *current* user without producing an auth event — `updateDisplayName` and
   * `linkEmailPassword` both mutate the signed-in user in place — so those push the returned
   * user into the store by hand, exactly as `reload` does.
   */
  const setUser = useAuthStore((s) => s.setUser);

  const doSignUpWithEmail = useCallback(async (email: string, password: string) => {
    await signUpWithEmail(email, password);
  }, []);

  const doSignInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmail(email, password);
  }, []);

  const doUpdateDisplayName = useCallback(async (name: string) => {
    setUser(await updateDisplayName(name));
  }, [setUser]);

  const doLinkEmailPassword = useCallback(async (email: string, password: string) => {
    setUser(await linkEmailPassword(email, password));
  }, [setUser]);

  const state: AuthState = mocked ?? { status, user, sync };

  return {
    ...state,
    isMock: mocked !== undefined,
    signInWithGoogle:   doSignInWithGoogle,
    signOut:            doSignOut,
    reloadUser:         reload,
    signUpWithEmail:    doSignUpWithEmail,
    signInWithEmail:    doSignInWithEmail,
    sendPasswordReset,
    resendVerification,
    linkEmailPassword:  doLinkEmailPassword,
    updateDisplayName:  doUpdateDisplayName,
    deleteAccount,
    reauthenticate,
  };
}

/**
 * Initials for the avatar.
 *
 * Falls back to the email's local part when there is no display name, which is the normal
 * case for an email signup — so `theo@example.com` reads as "TH" rather than as a blank
 * circle. Two characters, because one is ambiguous at 64px and three stops being initials.
 */
export function initialsFor(user: AuthUser): string {
  const source = user.displayName?.trim() || user.email.split('@')[0] || '?';
  const words  = source.split(/[\s._-]+/).filter(Boolean);

  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/** "Member since August 2026". */
export function memberSince(user: AuthUser): string {
  return new Date(user.createdAt).toLocaleDateString(undefined, {
    month: 'long',
    year:  'numeric',
  });
}

/**
 * The full join date — "13 August 2026" — for `/profile`'s Joined row, whose whole job is to
 * state the fact precisely. The header summary keeps `memberSince` instead, where the day
 * would add noise to a line that already carries the address and the provider.
 *
 * Locale-dependent like `memberSince`, so this reads "August 13, 2026" in en-US. Passing
 * `undefined` rather than a fixed locale is deliberate: the date belongs to the reader, not
 * to the app.
 */
export function joinedOn(user: AuthUser): string {
  return new Date(user.createdAt).toLocaleDateString(undefined, {
    day:   'numeric',
    month: 'long',
    year:  'numeric',
  });
}
