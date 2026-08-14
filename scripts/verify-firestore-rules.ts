/**
 * Security-rules harness for `firestore.rules` (7-12).
 *
 * "Nobody else can read my tabs" is not a property that should be verified by reading a
 * rules file. Nor is "the client cannot grant itself a lifetime licence" — that one is a
 * paywall bypass if it is wrong, and the way it goes wrong (a permissive parent `match`
 * silently overriding a specific `allow write: if false`) is invisible to inspection.
 *
 * Runs against the emulator, so nothing here touches the real project.
 *
 *   Terminal 1:  npx firebase emulators:start --only firestore
 *   Terminal 2:  npx tsx scripts/verify-firestore-rules.ts
 */

import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'harp2tab-rules-test';
const HOST = '127.0.0.1';
const PORT = 8080;

let failures = 0;
let checks   = 0;

async function check(name: string, promise: Promise<unknown>) {
  checks++;
  try {
    await promise;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`      ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/**
 * Token shapes.
 *
 * `email_verified` and `firebase.identities` are the two the rules read. The Google case
 * deliberately carries `email_verified: false` **with** a `google.com` identity — that is not
 * a contrived combination, it is exactly what Firebase produces after a password is linked to
 * a Google account, and it is the case that broke the app on 2026-08-13.
 */
const VERIFIED_EMAIL = { email: 'a@example.com', email_verified: true };
const UNVERIFIED     = { email: 'b@example.com', email_verified: false };
const GOOGLE_UNVERIFIED_FLAG = {
  email: 'c@example.com',
  email_verified: false,
  firebase: {
    identities: { 'google.com': ['c@example.com'] },
    sign_in_provider: 'google.com' as const,
  },
};

async function main() {
  let testEnv: RulesTestEnvironment;
  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host:  HOST,
        port:  PORT,
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
  } catch (error) {
    console.error(
      `\nCould not reach the Firestore emulator on ${HOST}:${PORT}.\n` +
      'Start it first:  npx firebase emulators:start --only firestore\n',
    );
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  await testEnv.clearFirestore();

  const alice     = testEnv.authenticatedContext('alice', VERIFIED_EMAIL).firestore();
  const mallory   = testEnv.authenticatedContext('mallory', VERIFIED_EMAIL).firestore();
  const unverified = testEnv.authenticatedContext('unver', UNVERIFIED).firestore();
  const googley   = testEnv.authenticatedContext('googley', GOOGLE_UNVERIFIED_FLAG).firestore();
  const anon      = testEnv.unauthenticatedContext().firestore();

  section('A user owns their own library');
  await check('write own tab',
    assertSucceeds(setDoc(doc(alice, 'users/alice/tabs/t1'), { title: 'Blues in G' })));
  await check('read own tab',
    assertSucceeds(getDoc(doc(alice, 'users/alice/tabs/t1'))));
  await check('write own project',
    assertSucceeds(setDoc(doc(alice, 'users/alice/projects/p1'), { title: 'Take 1' })));
  await check('write own settings',
    assertSucceeds(setDoc(doc(alice, 'users/alice/settings/current'), { gate: 40 })));
  // The shape 7b's engine actually writes, not a placeholder — a rules test that passes for a
  // document the app never sends is testing the emulator, not the app.
  await check('write own tombstone',
    assertSucceeds(setDoc(doc(alice, 'users/alice/deleted/t9'), { deletedAt: 1, kind: 'tab' })));
  await check('read own tombstone',
    assertSucceeds(getDoc(doc(alice, 'users/alice/deleted/t9'))));

  section('Nobody else can touch it — the property the whole file exists for');
  await check('another user cannot read my tab',
    assertFails(getDoc(doc(mallory, 'users/alice/tabs/t1'))));
  await check('another user cannot write my tab',
    assertFails(setDoc(doc(mallory, 'users/alice/tabs/t1'), { title: 'pwned' })));
  await check('another user cannot read my projects',
    assertFails(getDoc(doc(mallory, 'users/alice/projects/p1'))));
  await check('another user cannot read my settings',
    assertFails(getDoc(doc(mallory, 'users/alice/settings/current'))));
  // Tombstones are as sensitive as the documents they describe: the id and the time say what
  // someone had and when they got rid of it, and a writable one is a way to delete another
  // user's library from their next sync.
  await check('another user cannot read my tombstones',
    assertFails(getDoc(doc(mallory, 'users/alice/deleted/t9'))));
  await check('another user cannot plant a tombstone in my library',
    assertFails(setDoc(doc(mallory, 'users/alice/deleted/t1'), { deletedAt: 2, kind: 'tab' })));
  await check('signed-out cannot read a tab',
    assertFails(getDoc(doc(anon, 'users/alice/tabs/t1'))));
  await check('signed-out cannot write a tab',
    assertFails(setDoc(doc(anon, 'users/alice/tabs/t2'), { title: 'x' })));

  section('Sync waits for a confirmed address (7-4), enforced rather than asked politely');
  await check('unverified cannot write their own tab',
    assertFails(setDoc(doc(unverified, 'users/unver/tabs/t1'), { title: 'x' })));
  await check('unverified cannot read their own tab',
    assertFails(getDoc(doc(unverified, 'users/unver/tabs/t1'))));
  await check('unverified cannot write their own tombstone',
    assertFails(setDoc(doc(unverified, 'users/unver/deleted/t1'), { deletedAt: 1, kind: 'tab' })));

  section('A Google identity counts as confirmed even when email_verified is false');
  // The regression test for 2026-08-13. Without the `google.com` clause in `confirmed()`,
  // every one of these fails and the app says "confirmed" while sync is denied.
  await check('google user can write their own tab',
    assertSucceeds(setDoc(doc(googley, 'users/googley/tabs/t1'), { title: 'Juke' })));
  await check('google user can read their own tab',
    assertSucceeds(getDoc(doc(googley, 'users/googley/tabs/t1'))));
  await check('google user still cannot touch someone else\'s',
    assertFails(getDoc(doc(googley, 'users/alice/tabs/t1'))));

  section('Entitlement is readable by its owner and writable by nobody');
  // Seeded through the admin escape hatch, which is how the real writer (a server) reaches it.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'entitlements/alice'), { plan: 'lifetime' });
    await setDoc(doc(ctx.firestore(), 'entitlements/unver'), { plan: 'lifetime' });
  });

  await check('owner reads own entitlement',
    assertSucceeds(getDoc(doc(alice, 'entitlements/alice'))));
  await check('owner CANNOT write own entitlement — the paywall bypass',
    assertFails(setDoc(doc(alice, 'entitlements/alice'), { plan: 'lifetime' })));
  await check('another user cannot read my entitlement',
    assertFails(getDoc(doc(mallory, 'entitlements/alice'))));
  await check('another user cannot write my entitlement',
    assertFails(setDoc(doc(mallory, 'entitlements/alice'), { plan: 'lifetime' })));
  await check('signed-out cannot read an entitlement',
    assertFails(getDoc(doc(anon, 'entitlements/alice'))));
  // Deliberate asymmetry with sync: an unverified state must never cost someone access to
  // something they already paid for.
  await check('unverified owner CAN still read their entitlement',
    assertSucceeds(getDoc(doc(unverified, 'entitlements/unver'))));

  section('Unmatched paths are closed');
  await check('cannot write an arbitrary collection',
    assertFails(setDoc(doc(alice, 'whatever/x'), { a: 1 })));
  await check('cannot write directly to the user document',
    assertFails(setDoc(doc(alice, 'users/alice'), { a: 1 })));

  await testEnv.cleanup();

  console.log(
    failures === 0
      ? `\nAll ${checks} checks passed.`
      : `\n${failures} of ${checks} checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
