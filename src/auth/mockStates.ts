/**
 * The `?mock=` harness for the UI-only pass (7a-UI).
 *
 * Every auth state the screens can be in, reachable as a URL rather than by getting a real
 * Firebase project into that condition. `?mock=unverified` is one keystroke; producing a
 * genuinely unverified account, on demand, repeatedly, is not.
 *
 * **This file is deleted at 7-1.** Nothing outside `useAuth.ts` may import it, and no
 * component may branch on whether a state came from here — that is what keeps the swap to
 * real auth a one-file change.
 */

import type { AuthState, AuthUser } from './types';

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

/** Fixed so screenshots and repeat visits are comparable. Roughly "a while ago". */
const MEMBER_SINCE = Date.UTC(2026, 7, 3);

/**
 * **No real addresses or names here.**
 *
 * `__DEV__` stops these *states* reaching a user, but it does not stop the *strings* being
 * bundled: this module is still in the production graph (`MOCK_KEYS` feeds the listing in
 * `/profile`'s footer), so every literal below ships and is readable in the deployed JS. A
 * developer's own address in a fixture is therefore a published address, and bundles get
 * scraped for exactly that. `example.com` is reserved by RFC 2606 for this.
 */
const googleUser: AuthUser = {
  uid:           'mock-google',
  email:         'google-user@example.com',
  displayName:   'Ada Harmon',
  emailVerified: true,
  providers:     ['google'],
  createdAt:     MEMBER_SINCE,
};

const emailUser: AuthUser = {
  uid:           'mock-email',
  email:         'theo@example.com',
  // An email signup has no name until one is typed. Kept null rather than filled in so the
  // fallback path — initials derived from the address — is the one being reviewed.
  displayName:   null,
  emailVerified: true,
  providers:     ['password', 'google'],
  createdAt:     MEMBER_SINCE,
};

const unverifiedUser: AuthUser = {
  uid:           'mock-unverified',
  email:         'theo@example.com',
  displayName:   null,
  emailVerified: false,
  providers:     ['password'],
  createdAt:     Date.now() - 4 * 60 * 1000,
};

/** What 7a actually ships: no engine, so nothing to report. */
const unavailable = { state: 'unavailable' } as const;

function signedIn(user: AuthUser, sync: AuthState['sync']): AuthState {
  return { status: 'signedIn', user, sync };
}

/**
 * Keyed by `?mock=`. Absent or unrecognised falls through to signed out, which is the real
 * default and therefore the right thing for a typo to land on.
 */
export const MOCK_STATES: Record<string, AuthState> = {
  signedOut: { status: 'signedOut', user: null, sync: unavailable },

  // Held indefinitely rather than resolving after a timeout — a skeleton that vanishes
  // before it can be looked at is a skeleton nobody reviews.
  resolving: { status: 'resolving', user: null, sync: unavailable },

  google:    signedIn(googleUser, unavailable),
  email:     signedIn(emailUser, unavailable),
  unverified: signedIn(unverifiedUser, unavailable),

  // The zero state. Every real first sign-in looks like this, and no mockup ever shows it.
  newUser:   signedIn(
    { ...googleUser, uid: 'mock-new', createdAt: Date.now() },
    unavailable,
  ),

  // ── Sync-row variants. Review-only: see the note on `SyncState`. None of these may be
  //    what a user-reachable build renders while 7b does not exist.
  synced:      signedIn(googleUser, { state: 'idle', lastSyncedAt: Date.now() - 2 * 60 * 1000 }),
  syncing:     signedIn(googleUser, { state: 'syncing' }),
  offline:     signedIn(googleUser, { state: 'offline', pendingCount: 3 }),
  syncError:   signedIn(googleUser, { state: 'error' }),
  syncDiscard: signedIn(googleUser, {
    state:        'discarded',
    lastSyncedAt: Date.now() - 6 * 60 * 1000,
    discarded:    { title: 'Blues in G', at: Date.now() - 6 * 60 * 1000 },
  }),
};

/** Signed out — the real default, and where an unknown `?mock=` value lands. */
export const DEFAULT_MOCK_STATE: AuthState = MOCK_STATES.signedOut;

export function resolveMockState(key: string | undefined): AuthState {
  if (!key) return DEFAULT_MOCK_STATE;
  return MOCK_STATES[key] ?? DEFAULT_MOCK_STATE;
}

/** Only used by the dev listing in `/profile`'s footer, so the states are discoverable
 *  without reading this file. Goes away with the rest of the harness. */
export const MOCK_KEYS = Object.keys(MOCK_STATES);

export { DAY, HOUR };
