/**
 * The native half of the auth seam — a deliberate stub until 7-14, matching `firebase.ts`
 * beside it. Metro resolves `auth.web.ts` ahead of this on web.
 *
 * `onAuthChange` is the one function here with real behaviour: it reports "signed out" and
 * unsubscribes cleanly. That is what lets the bootstrap in `useAuthStore` run identically on
 * both platforms — native resolves immediately to nobody, instead of needing a
 * `Platform.OS` branch at the call site.
 */

import type { AuthUser } from './types';

export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'SignInCancelled';
  }
}

const NOT_ON_NATIVE = 'Accounts are web-only for now — this is coming to the app in a later release.';

export async function signInWithGoogle(): Promise<AuthUser> {
  throw new Error(NOT_ON_NATIVE);
}

export async function signOut(): Promise<void> {
  // Intentionally a no-op rather than a throw: nobody can be signed in on native, so
  // "sign out" has already achieved what it was asked to do.
}

export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
  // Asynchronous on purpose, mirroring the real SDK. A synchronous callback here would let a
  // subscriber depend on ordering that only holds on native, which is the kind of difference
  // that shows up as a web-only bug much later.
  const handle = setTimeout(() => callback(null), 0);
  return () => clearTimeout(handle);
}

export async function reloadUser(): Promise<AuthUser | null> {
  return null;
}
