/**
 * Native half of the suggestion box — a stub, matching `firestore.ts` and `auth/firebase.ts`.
 *
 * **A deliberate stub, not an oversight.** The feedback row is web-only: submitting requires a
 * signed-in user, `isFirebaseConfigured()` is `false` on native until Phase 15, and there is
 * therefore no account to attribute a report to. `settings.tsx` renders the row on web only,
 * so nothing here is reachable; when native accounts land, the row un-gates and this file
 * grows the `@react-native-firebase/firestore` implementation.
 *
 * It throws rather than resolving, for the same reason the sync stub does: a submission that
 * silently does nothing would thank the user for feedback that was never sent.
 */

import type { AuthUser } from '@/auth/types';

export type FeedbackType = 'bug' | 'suggestion' | 'other';

export const MESSAGE_MAX = 1000;

export interface FeedbackInput {
  type:    FeedbackType;
  message: string;
}

/** Signature duplicated rather than imported, exactly as `firestore.ts` duplicates the sync
 *  types: TypeScript resolves this file, not the `.web.ts` one, so the two must agree by hand. */
export async function submitFeedback(_user: AuthUser, _input: FeedbackInput): Promise<void> {
  throw new Error(
    'Feedback is not available on native yet — accounts are web-first (Phase 15). ' +
    'The Settings row is web-only and should never reach this.',
  );
}
