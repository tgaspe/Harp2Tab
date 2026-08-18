/**
 * Orchestration — the one module that decides *when* a library is reconciled (7b-4).
 *
 * **The rule this file exists to keep: no screen ever reads Firestore.** Not one component,
 * hook or selector gains a network dependency, a loading state or an error state. Everything
 * here writes into the same zustand stores every screen already reads, so `index.tsx`,
 * `edit.tsx` and `studio.tsx` are untouched by this phase. If a component ends up needing an
 * `await`, the boundary has been drawn in the wrong place.
 *
 * The corollary: **the local store is the source of truth for the running app**, and the cloud
 * is a mirror reconciled at known moments. That is not a hedge — it is the only model that keeps
 * the app working offline, which it does today for free and would otherwise lose.
 *
 * **Not a live Firestore listener.** A listener means the cloud can change the library out from
 * under an open editor, which is the "no screen reads Firestore" rule broken by the back door.
 * Reconciliation happens on sign-in, on foreground, a couple of seconds after a local write, and
 * when the user presses Sync now — moments where a library changing is expected.
 *
 * Nothing in this file imports a Firebase type. `firestore.ts` is the façade, split by platform
 * exactly as `auth/firebase.ts` is.
 */

import { AppState } from 'react-native';
import { isFirebaseConfigured } from '@/auth/firebase';
import { useAuthStore } from '@/auth/useAuthStore';
import { useRecordingsStore } from '@/store/useRecordingsStore';
import { useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import {
  commit,
  getSettings,
  isEmulator,
  isOfflineError,
  listDocsSince,
  listTombstones,
  setSettings,
  type RemoteDoc,
  type WriteOp,
} from './firestore';
import { mergeDocuments, pruneTombstones } from './merge';
import { useSyncStore } from './useSyncStore';
import {
  SETTINGS_WIRE_VERSION,
  type DiscardedEdit,
  type ProjectSyncDoc,
  type SettingsSyncDoc,
  type SyncKind,
  type TabSyncDoc,
  type Tombstone,
} from './types';
import {
  SYNCED_SETTINGS_KEYS,
  docToProject,
  docToSettings,
  docToTab,
  isUsableDoc,
  projectToDoc,
  settingsToDoc,
  tabToDoc,
  type SyncedSettings,
} from './wire';
import type { MidiProject, TabRecording } from '@/types';

/**
 * The feature switch, following `FREE_TIER_ENABLED`'s precedent (`useSettingsStore.ts`).
 *
 * One constant, read by the entry condition below, so every piece of this phase can land and be
 * exercised without a single real library being written to the cloud — and so turning it on is
 * one line rather than a hunt through call sites.
 *
 * **Off until the two manual checks in 7b's verification have been run: the two-browser pass and
 * the stored-document size check.** Those are the two things no harness can do, and they are the
 * two that only surface a problem once real documents exist.
 *
 * **Leave it off to develop against the emulator** — `isEmulator()` enables the engine on its
 * own (see `gate()`). Making emulator work require flipping this would mean the switch spends
 * its life in the wrong position, and the day someone unsets the emulator variable without
 * putting it back is the day a dev session writes into the real project.
 */
export const SYNC_ENABLED = true;

/** Debounce after a local write. Long enough that renaming a tab is one sync, not fifteen. */
const WRITE_DEBOUNCE_MS = 2000;

/* ------------------------------------------------------------------ single flight */

let running  = false;
/** A trigger that arrived mid-run. One more pass afterwards, never a queue of them. */
let dirty    = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

/* ---------------------------------------------------------------- entry condition */

type Gate =
  | { ready: true;  uid: string }
  | { ready: false; reason: 'signedOut' | 'unverified' | 'disabled' };

/**
 * The one place the engine decides whether it may run.
 *
 * Keeping the `emailVerified` test here — rather than at each call site — is what stops 7-4's
 * verification decision scattering through the app, and it is why withholding sync costs nothing
 * to implement while blocking the whole app would have cost a gate on every screen.
 *
 * `emailVerified` is *our* definition (`auth/types.ts`): true for any Google identity whatever
 * Firebase reports. `firestore.rules`'s `confirmed()` applies the same definition deliberately —
 * if the two ever disagree, the UI says "Synced" while every request is denied, which is
 * invisible from the client and miserable to trace.
 */
function gate(): Gate {
  // `isEmulator()` is an independent way in, not a bypass: it can only point at a database on
  // this machine, so the worst it can reach is a throwaway one.
  if ((!SYNC_ENABLED && !isEmulator()) || !isFirebaseConfigured()) {
    return { ready: false, reason: 'disabled' };
  }

  const { status, user } = useAuthStore.getState();

  // `'resolving'` is not signed-out. Reporting it as such on every cold start would flash
  // "Sign in to keep them on every device" at someone who is already signed in.
  if (status === 'resolving') return { ready: false, reason: 'disabled' };
  if (status !== 'signedIn' || !user) return { ready: false, reason: 'signedOut' };
  if (!user.emailVerified) return { ready: false, reason: 'unverified' };

  return { ready: true, uid: user.uid };
}

/* ------------------------------------------------------------------------ the run */

/**
 * One reconciliation pass.
 *
 * Exported for `/profile`'s Sync now button. Safe to call at any time: it self-gates, it
 * self-serialises, and it never throws — a failure becomes a status, because there is no caller
 * who could do anything useful with an exception and every screen renders the store either way.
 */
export async function syncNow(): Promise<void> {
  const allowed = gate();
  if (!allowed.ready) {
    useSyncStore.getState().setUnavailable(allowed.reason);
    return;
  }

  // Without this, the write debounce plus a foreground event plus a sign-in can start three
  // overlapping passes that push stale plans over each other.
  if (running) {
    dirty = true;
    return;
  }

  running = true;
  try {
    await runPass(allowed.uid);
  } finally {
    running = false;
    if (dirty) {
      dirty = false;
      void syncNow();
    }
  }
}

async function runPass(uid: string): Promise<void> {
  // A different account than the watermark belongs to: rebind before anything is compared.
  if (useSyncStore.getState().uid !== uid) useSyncStore.getState().resetFor(uid);

  // 7-11. Blocks the pass rather than guessing, and stays blocked until the user answers.
  if (decideAdoption(uid) === 'ask') {
    useSyncStore.getState().setStatus({ state: 'needsChoice' });
    return;
  }

  useSyncStore.getState().setStatus({ state: 'syncing' });

  try {
    const now = Date.now();
    const tombstones = await listTombstones(uid);

    const tabs     = await syncLibrary(uid, 'tab', tombstones, now);
    const projects = await syncLibrary(uid, 'project', tombstones, now);
    await syncSettings(uid);

    // The device now holds this account's library, whichever direction it travelled in.
    useAuthStore.getState().markAdopted(uid);

    const watermark = Math.max(tabs.watermark, projects.watermark);
    if (watermark > 0) useSyncStore.getState().advanceTo(uid, watermark);

    const skipped = tabs.skipped + projects.skipped;
    if (skipped > 0) {
      // A document this build cannot read is not a failure to retry — it is an app that needs
      // updating, and "Sync failed" would send the user to press a button that cannot help. It
      // is still an error state, because pretending everything arrived is how someone concludes
      // a tab was lost.
      console.warn(`[sync] ${skipped} document(s) written by a newer version of the app were skipped.`);
      useSyncStore.getState().setStatus({ state: 'error' });
      return;
    }

    // The most recent discard, if last-write-wins threw anything away. One line on `/profile`,
    // never a dashboard — but never silent either: quiet LWW is what makes a user conclude the
    // app ate their edit.
    const discarded = [...tabs.discarded, ...projects.discarded].pop();
    useSyncStore.getState().markSynced(Date.now(), discarded);
  } catch (error) {
    const pending = pendingCount();
    useSyncStore.getState().setStatus(
      isOfflineError(error) ? { state: 'offline', pendingCount: pending } : { state: 'error' },
    );
    console.warn('[sync] pass failed —', error);
  }
}

/* ------------------------------------------------------------------- one library */

interface LibraryResult {
  watermark: number;
  skipped:   number;
  discarded: DiscardedEdit[];
}

/**
 * Pull, merge, apply, push — for one of the two libraries.
 *
 * The two differ only in their wire mapping and which store they write, so the shape is shared
 * and the differences are three lookups. Duplicating this for tabs and projects is how the two
 * would drift into having different bugs.
 */
async function syncLibrary(
  uid: string,
  kind: SyncKind,
  allTombstones: RemoteDoc[],
  now: number,
): Promise<LibraryResult> {
  const path  = kind === 'tab' ? 'tabs' : 'projects';
  const store = kind === 'tab' ? useRecordingsStore : useMidiProjectsStore;

  const local: LocalDoc[] = kind === 'tab'
    ? useRecordingsStore.getState().recordings
    : useMidiProjectsStore.getState().projects;
  const localTombstones = store.getState().deletedIds;

  /**
   * Incremental: only documents written since the watermark.
   *
   * Documents this device pushed come back on the next pull. Harmless — same `updatedAt`, so the
   * tie rule applies and the content is identical — and cheaper than tracking which ids were
   * ours.
   */
  const watermarkIn = useSyncStore.getState().lastPulledAt;
  const pulled = await listDocsSince(uid, path, watermarkIn);

  let skipped   = 0;
  let watermark = watermarkIn;
  const remote: LocalDoc[] = [];

  for (const { id, data } of pulled) {
    if (!isUsableDoc({ id, ...data })) { skipped++; continue; }
    watermark = Math.max(watermark, data.updatedAt as number);

    const decoded = kind === 'tab'
      ? docToTab({ ...data, id } as unknown as TabSyncDoc)
      : docToProject({ ...data, id } as unknown as ProjectSyncDoc);

    // `null` is a document this build must not touch — a newer schema, or one that will not
    // parse. Never applied *and never overwritten*: leaving it out of `remote` entirely is what
    // stops the merge concluding the local copy is newer and pushing over it.
    if (!decoded) { skipped++; continue; }
    remote.push(decoded);
  }

  const remoteTombstones = readTombstones(allTombstones, kind);

  const plan = mergeDocuments<LocalDoc>({ local, remote, localTombstones, remoteTombstones, now });

  /* ---- Apply locally first. A push that then fails leaves the device correct rather than
          half-merged, and the push is idempotent so the retry costs nothing. */
  applyLocally(kind, plan.toApply);
  store.getState().deleteFromRemote(plan.toDeleteLocal);
  store.getState().dropTombstones([...plan.toDropTomb, ...expiredIds(localTombstones, now)]);

  /* ---- Then push, as one batched round trip. */
  const operations: WriteOp[] = [
    ...plan.toPush.map((document): WriteOp => ({
      op:   'set',
      path,
      id:   document.id,
      data: kind === 'tab'
        ? (tabToDoc(document as TabRecording) as unknown as Record<string, unknown>)
        : (projectToDoc(document as MidiProject) as unknown as Record<string, unknown>),
    })),
    ...plan.toPushTomb.map((tomb): WriteOp => ({
      op:   'set',
      path: 'deleted',
      id:   tomb.id,
      data: { deletedAt: tomb.deletedAt, kind: tomb.kind },
    })),
    ...plan.toDeleteRemote.map((id): WriteOp => ({ op: 'delete', path, id })),
  ];

  await commit(uid, operations);

  // Pushed documents are now the newest thing in the cloud, so the watermark has to include them
  // or the next pull re-downloads every one.
  for (const document of plan.toPush) watermark = Math.max(watermark, document.updatedAt);

  return { watermark, skipped, discarded: plan.discarded };
}

/** `TabRecording` and `MidiProject` share exactly the three fields the merge needs. */
type LocalDoc = TabRecording | MidiProject;

function applyLocally(kind: SyncKind, documents: LocalDoc[]): void {
  if (documents.length === 0) return;
  if (kind === 'tab') useRecordingsStore.getState().applyRemote(documents as TabRecording[]);
  else useMidiProjectsStore.getState().applyRemote(documents as MidiProject[]);
}

/** One `deleted` collection holds both libraries' tombstones, so `kind` is what separates them. */
function readTombstones(docs: RemoteDoc[], kind: SyncKind): Tombstone[] {
  const tombstones: Tombstone[] = [];
  for (const { id, data } of docs) {
    if (data.kind !== kind) continue;
    if (typeof data.deletedAt !== 'number' || !Number.isFinite(data.deletedAt)) continue;
    tombstones.push({ id, deletedAt: data.deletedAt, kind });
  }
  return tombstones;
}

const expiredIds = (tombstones: Tombstone[], now: number): string[] => {
  const kept = new Set(pruneTombstones(tombstones, now).map((t) => t.id));
  return tombstones.filter((t) => !kept.has(t.id)).map((t) => t.id);
};

/* -------------------------------------------------------------------- settings */

/**
 * One document, last-write-wins on the whole subset — not per field.
 *
 * A field-level merge here would be machinery for a conflict nobody has: two devices changing
 * *different* preferences inside the same window, where the loss is a theme.
 */
async function syncSettings(uid: string): Promise<void> {
  const localStamp = useSyncStore.getState().settingsUpdatedAt;
  const raw = await getSettings(uid);

  if (raw) {
    const remote  = raw as unknown as SettingsSyncDoc;
    const decoded = remote.schemaVersion <= SETTINGS_WIRE_VERSION ? docToSettings(remote) : null;
    const remoteStamp = typeof remote.updatedAt === 'number' ? remote.updatedAt : 0;

    if (decoded && remoteStamp > localStamp) {
      applySyncedSettings(decoded);
      useSyncStore.getState().setSettingsStamp(remoteStamp);
      return;
    }
    if (remoteStamp >= localStamp) return; // Nothing to say; the cloud is at least as current.
  }

  // A device that has never changed a synced setting still has an opinion — its defaults — but
  // it is not one worth overwriting another device's choices with. Stamp of 0 means "never
  // touched here", and the first real change sets a real one.
  const stamp = localStamp === 0 ? Date.now() : localStamp;
  await setSettings(uid, settingsToDoc(currentSyncedSettings(), stamp) as unknown as Record<string, unknown>);
  useSyncStore.getState().setSettingsStamp(stamp);
}

function currentSyncedSettings(): SyncedSettings {
  const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of SYNCED_SETTINGS_KEYS) {
    if (state[key] !== undefined) picked[key] = state[key];
  }
  return picked as SyncedSettings;
}

function applySyncedSettings(settings: SyncedSettings): void {
  const patch: Record<string, unknown> = {};
  for (const key of SYNCED_SETTINGS_KEYS) {
    const value = (settings as Record<string, unknown>)[key];
    if (value !== undefined) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return;

  // Written straight into the store rather than through its setters. The setters are one per
  // field and none is wrong to call, but each would trip the write debounce below and bounce the
  // values it just received straight back at the cloud.
  useSettingsStore.setState(patch as never);
}

/** Whether a settings change is one of the four that travel. */
function syncedSettingsSignature(): string {
  return JSON.stringify(currentSyncedSettings());
}

/* -------------------------------------------------------------------- adoption */

/**
 * 7-11, in three cases.
 *
 * - Already this account's device, or one that has never belonged to anyone → **adopt**.
 * - Nothing local to lose → **adopt**; there is no question to ask about an empty library.
 * - Documents on a device that last belonged to someone else → **ask**, once, with counts.
 *   Signing out never wipes the local library, so those documents are real work belonging to
 *   whoever was here before — and pushing them into the new account is, on a shared laptop, a
 *   privacy incident rather than a bug.
 */
function decideAdoption(uid: string): 'adopt' | 'ask' {
  const { lastUid, adoptedUids } = useAuthStore.getState();
  if (adoptedUids.includes(uid)) return 'adopt';

  const tabCount     = useRecordingsStore.getState().recordings.length;
  const projectCount = useMidiProjectsStore.getState().projects.length;
  if (tabCount === 0 && projectCount === 0) return 'adopt';

  if (lastUid === null || lastUid === uid) return 'adopt';

  useSyncStore.getState().askChoice({ uid, tabCount, projectCount });
  return 'ask';
}

/** "Keep this device's tabs as mine." Unions the local library into the signed-in account. */
export function adoptLocalLibrary(uid: string): void {
  useAuthStore.getState().markAdopted(uid);
  useSyncStore.getState().askChoice(null);
  void syncNow();
}

/**
 * "Clear this device and pull my library." The default, and the safe answer on a shared laptop.
 *
 * Deletes **without tombstones**: this is not the user deleting their tabs, it is this device
 * ceasing to hold someone else's. A tombstone here would propagate the clear-out into the *other*
 * account's cloud library the next time they signed in on this machine — turning a privacy
 * safeguard into the data loss it exists to prevent.
 */
export function discardLocalLibrary(uid: string): void {
  const recordings = useRecordingsStore.getState();
  const projects   = useMidiProjectsStore.getState();

  recordings.deleteFromRemote(recordings.recordings.map((r) => r.id));
  recordings.dropTombstones(recordings.deletedIds.map((t) => t.id));
  projects.deleteFromRemote(projects.projects.map((p) => p.id));
  projects.dropTombstones(projects.deletedIds.map((t) => t.id));

  useAuthStore.getState().markAdopted(uid);
  useSyncStore.getState().askChoice(null);
  void syncNow();
}

/* -------------------------------------------------------------------- plumbing */

/** Local documents the cloud has not seen, for the offline row's count. */
function pendingCount(): number {
  const watermark = useSyncStore.getState().lastPulledAt;
  const tabs      = useRecordingsStore.getState();
  const projects  = useMidiProjectsStore.getState();
  return tabs.recordings.filter((r) => r.updatedAt > watermark).length
    + projects.projects.filter((p) => p.updatedAt > watermark).length
    + tabs.deletedIds.length
    + projects.deletedIds.length;
}

/* ------------------------------------------------------------------ the triggers */

/**
 * Starts the sync triggers. Called once from the root layout, beside `startAuthListener` and
 * `startEntitlementListener` — the same shape, for the same reason.
 *
 * Four triggers and no timer: sign-in (including a persisted session resolving on cold start),
 * foreground, a debounced local write, and the explicit Sync now on `/profile`. A polling
 * interval would add nothing — the only thing that changes the cloud copy is another device, and
 * the user has to come back to this tab before the answer can matter to them.
 */
export function startSyncListener(): () => void {
  const trigger = () => { void syncNow(); };

  const scheduleWrite = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(trigger, WRITE_DEBOUNCE_MS);
  };

  // Reflect the gate immediately, so `/profile` never renders last session's row while the first
  // pass is still in flight.
  const initial = gate();
  if (initial.ready) trigger();
  else useSyncStore.getState().setUnavailable(initial.reason);

  const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
    const uid = state.user?.uid ?? null;
    const was = previous.user?.uid ?? null;
    const verifiedChanged = state.user?.emailVerified !== previous.user?.emailVerified;
    if (uid === was && state.status === previous.status && !verifiedChanged) return;

    if (!uid) {
      // Sign-out drops the watermark but **never the local library** — those tabs are the
      // signed-out library, and wiping them would delete work from anyone who signed in to look
      // and signed back out.
      useSyncStore.getState().resetFor(null);
      const next = gate();
      if (!next.ready) useSyncStore.getState().setUnavailable(next.reason);
      return;
    }
    trigger();
  });

  const unsubscribeRecordings = useRecordingsStore.subscribe(scheduleWrite);
  const unsubscribeProjects   = useMidiProjectsStore.subscribe(scheduleWrite);

  // Settings are noisier than the libraries — a slider fires on every frame of a drag — and only
  // four of its fields travel. Comparing the synced subset means dragging mic sensitivity does
  // not schedule a sync at all.
  let lastSignature = syncedSettingsSignature();
  const unsubscribeSettings = useSettingsStore.subscribe(() => {
    const next = syncedSettingsSignature();
    if (next === lastSignature) return;
    lastSignature = next;
    useSyncStore.getState().setSettingsStamp(Date.now());
    scheduleWrite();
  });

  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') trigger();
  });

  return () => {
    if (debounce) clearTimeout(debounce);
    unsubscribeAuth();
    unsubscribeRecordings();
    unsubscribeProjects();
    unsubscribeSettings();
    appState.remove();
  };
}
