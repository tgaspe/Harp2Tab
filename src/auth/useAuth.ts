/**
 * The single source of auth state for every screen — mocked for now.
 *
 * **This is the file that gets swapped at 7-1.** Its body becomes a `useAuthStore`
 * subscription plus the platform-split `src/lib/auth` calls; its signature does not change.
 * That is the whole point of the seam: no component may branch on whether the state is
 * mocked, so nothing downstream has to be touched when the real thing lands.
 *
 * The action functions are inert here and say so — an inert control that looks live is the
 * one kind of fakery this slice does not allow.
 */

import { useLocalSearchParams } from 'expo-router';
import { resolveMockState } from './mockStates';
import type { AuthState, AuthUser } from './types';

export interface AuthActions {
  signInWithGoogle:   () => Promise<void>;
  signUpWithEmail:    (email: string, password: string) => Promise<void>;
  signInWithEmail:    (email: string, password: string) => Promise<void>;
  sendPasswordReset:  (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Re-reads the user from the server. Needed because verification happens outside the
   *  app and the cached token goes stale — see `AuthUser.emailVerified`. */
  reloadUser:         () => Promise<void>;
  signOut:            () => Promise<void>;
  deleteAccount:      () => Promise<void>;
  updateDisplayName:  (name: string) => Promise<void>;
  linkEmailPassword:  (email: string, password: string) => Promise<void>;
}

export interface UseAuthResult extends AuthState, AuthActions {
  /** True while the UI-only harness is driving state. The *only* permitted use is copy that
   *  tells a reviewer this is a mock — never to change layout or behaviour. Gone at 7-1. */
  isMock: boolean;
}

const notWired = (what: string) => async () => {
  // Deliberately loud rather than a silent no-op: a button that appears to work and does
  // nothing is worse than one that reports it is not connected yet.
  console.warn(`[7a-UI] ${what} is not wired yet — this pass is UI only.`);
};

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
 * leave anything behind in a user's storage when this harness is deleted at 7-1.
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

export function useAuth(): UseAuthResult {
  // Subscribed to so the hook re-runs on navigation, even though the value below is
  // preferred — without it, consumers inside the router tree would not re-render on a
  // route change that alters the mock.
  const { mock } = useLocalSearchParams<{ mock?: string }>();
  const fromUrl = mockFromLocation() ?? (typeof mock === 'string' ? mock : undefined);
  if (fromUrl && fromUrl.length > 0) latchedMock = fromUrl;
  const state = resolveMockState(latchedMock);

  return {
    ...state,
    isMock: true,
    signInWithGoogle:   notWired('Google sign-in'),
    signUpWithEmail:    notWired('Email sign-up'),
    signInWithEmail:    notWired('Email sign-in'),
    sendPasswordReset:  notWired('Password reset'),
    resendVerification: notWired('Resend verification'),
    reloadUser:         notWired('Reload user'),
    signOut:            notWired('Sign out'),
    deleteAccount:      notWired('Delete account'),
    updateDisplayName:  notWired('Update display name'),
    linkEmailPassword:  notWired('Link email sign-in'),
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
