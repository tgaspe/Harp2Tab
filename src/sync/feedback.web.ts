/**
 * The suggestion box's write path (web).
 *
 * **A façade for the same reason `firestore.web.ts` is one.** `FeedbackModal` may not hold a
 * Firebase type; it collects a type and a message and hands them here. Everything else on the
 * document — who, which build, which platform — is gathered at this boundary rather than
 * passed in, because a field the modal supplies is a field a caller can forget or get wrong.
 *
 * **Firestore is imported dynamically**, as everywhere else in this directory: a signed-out
 * visitor reading the landing page must not pull the Firestore chunk. See `firebase.web.ts`.
 *
 * **Nothing here reads feedback back.** `firestore.rules` denies `get` and `list` on the
 * collection to every client including the author, so a read path would not merely be unused,
 * it would fail. Submissions are read in the Firebase console.
 */

import { firebaseApp } from '@/auth/firebase';
import type { AuthUser } from '@/auth/types';
import { isEmulator } from '@/sync/firestore';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type FeedbackType = 'bug' | 'suggestion' | 'other';

/** Mirrors the bound in `firestore.rules`. The rule is what enforces it; this is what lets the
 *  modal say so before a user loses a long message to a permission error. */
export const MESSAGE_MAX = 1000;

export interface FeedbackInput {
  type:    FeedbackType;
  message: string;
}

const api = () => import('firebase/firestore');

const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORT = 8080;

/**
 * Memoised for the same reason `firestore.web.ts` memoises its own: `connectFirestoreEmulator`
 * throws if it runs twice on one instance, and it must run before the instance is used.
 *
 * A separate instance from the sync façade's is harmless — the SDK returns the same underlying
 * client for one app, and each module connects its own handle at most once.
 */
let instance: ReturnType<Awaited<ReturnType<typeof api>>['getFirestore']> | undefined;

async function db() {
  if (instance) return instance;

  const { getFirestore, connectFirestoreEmulator } = await api();
  instance = getFirestore(firebaseApp());

  if (isEmulator()) {
    connectFirestoreEmulator(instance, EMULATOR_HOST, EMULATOR_PORT);
  }

  return instance;
}

/**
 * What build the report came from.
 *
 * Worth more than it looks: a bug report without a version is a bug report you cannot close,
 * because "fixed in 1.4.1" is unanswerable against "reported some time in the last month".
 */
function appVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

/**
 * Submit one report.
 *
 * **The uid is taken from the passed user, and the rules check it against the caller's token.**
 * Those two agreeing is not a formality: it is what stops a submission being attributed to
 * somebody else, and it is why this throws rather than falling back to an anonymous write when
 * there is no user — a silent unattributed write would look like success to the modal and be
 * denied by the rules.
 */
export async function submitFeedback(user: AuthUser, input: FeedbackInput): Promise<void> {
  const message = input.message.trim();

  if (message.length === 0)          throw new Error('Feedback message is empty.');
  if (message.length > MESSAGE_MAX)  throw new Error(`Feedback message exceeds ${MESSAGE_MAX} characters.`);

  const { addDoc, collection, serverTimestamp } = await api();

  await addDoc(collection(await db(), 'feedback'), {
    uid:        user.uid,
    email:      user.email,
    type:       input.type,
    message,
    appVersion: appVersion(),
    platform:   Platform.OS,
    locale:     typeof navigator !== 'undefined' ? navigator.language : 'unknown',
    userAgent:  typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    // Server-assigned, not client-assigned: a device with a wrong clock would otherwise sort
    // its report into the middle of last year and it would never be seen.
    createdAt:  serverTimestamp(),
  });
}
