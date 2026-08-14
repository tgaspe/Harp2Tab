/**
 * Harness for the sync merge and the wire mapping (7b-2, 7b-1).
 *
 * `merge.ts` is the one module in Phase 7 where a bug destroys a user's work rather than
 * showing them something wrong, and it is a pure function specifically so it can be driven from
 * here — no network, no emulator, no Firebase, no account. Every row of the decision table in
 * `merge.ts`'s header has a check below, in the same order, plus the cases that only appear once
 * two devices disagree about a deletion.
 *
 * The fixtures are hand-written rather than produced by the app, so they do not come from the
 * same code being tested.
 *
 * Run: npx tsx scripts/verify-sync-merge.ts
 */

import { mergeDocuments, pruneTombstones } from '../src/sync/merge';
import { TOMBSTONE_TTL_MS, type Syncable, type Tombstone } from '../src/sync/types';
import { docToProject, docToTab, projectToDoc, tabToDoc } from '../src/sync/wire';
import { createProject, createTrack } from '../src/audio/midiProject';
import { RECORDINGS_SCHEMA_VERSION, migrateRecordings } from '../src/store/recordingsMigration';
import type { TabRecording } from '../src/types';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ fixtures */

const NOW = 1_770_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

interface Doc extends Syncable {}

const doc = (id: string, updatedAt: number, title = id): Doc => ({ id, title, updatedAt });

const tomb = (id: string, deletedAt: number): Tombstone => ({ id, deletedAt, kind: 'tab' });

/** Every list defaults to empty, so each case states only what it is about. */
function merge(input: {
  local?: Doc[];
  remote?: Doc[];
  localTombstones?: Tombstone[];
  remoteTombstones?: Tombstone[];
  now?: number;
}) {
  return mergeDocuments<Doc>({
    local:            input.local            ?? [],
    remote:           input.remote           ?? [],
    localTombstones:  input.localTombstones  ?? [],
    remoteTombstones: input.remoteTombstones ?? [],
    now:              input.now              ?? NOW,
  });
}

const ids = (docs: Doc[]) => docs.map((d) => d.id).sort().join(',');

/* --------------------------------------------------------- the decision table */

section('the decision table — no tombstone');
{
  const pushOnly = merge({ local: [doc('a', NOW - DAY)] });
  check('local only → push', ids(pushOnly.toPush) === 'a' && pushOnly.toApply.length === 0);

  const pullOnly = merge({ remote: [doc('a', NOW - DAY)] });
  check('remote only → apply', ids(pullOnly.toApply) === 'a' && pullOnly.toPush.length === 0);

  const localWins = merge({ local: [doc('a', NOW)], remote: [doc('a', NOW - DAY)] });
  check('local newer → push', ids(localWins.toPush) === 'a');
  check('local newer → nothing reported as discarded', localWins.discarded.length === 0);

  const remoteWins = merge({ local: [doc('a', NOW - DAY, 'My Take')], remote: [doc('a', NOW)] });
  check('remote newer → apply', ids(remoteWins.toApply) === 'a');
  check('remote newer → the replaced local edit is named',
    remoteWins.discarded.length === 1
    && remoteWins.discarded[0].title === 'My Take'
    && remoteWins.discarded[0].at === NOW);

  const tie = merge({ local: [doc('a', NOW, 'local')], remote: [doc('a', NOW, 'remote')] });
  check('tie → remote wins', ids(tie.toApply) === 'a' && tie.toPush.length === 0);
  check('tie → not reported as discarded', tie.discarded.length === 0);

  const untouched = merge({});
  check('empty everything → an empty plan',
    untouched.toApply.length === 0
    && untouched.toPush.length === 0
    && untouched.toDeleteLocal.length === 0
    && untouched.toPushTomb.length === 0);
}

section('the decision table — a live tombstone');
{
  const deleted = merge({
    local:           [doc('a', NOW - 2 * DAY)],
    localTombstones: [tomb('a', NOW - DAY)],
  });
  check('tombstone newer than the local doc → delete locally',
    deleted.toDeleteLocal.join(',') === 'a');
  check('...and the cloud is told', ids2(deleted.toPushTomb) === 'a');
  check('...and it is not pushed as a document', deleted.toPush.length === 0);

  const stillRemote = merge({
    remote:          [doc('a', NOW - 2 * DAY)],
    localTombstones: [tomb('a', NOW - DAY)],
  });
  check('tombstone newer than a remote doc → delete the cloud document',
    stillRemote.toDeleteRemote.join(',') === 'a');
  check('...and it is not applied locally', stillRemote.toApply.length === 0);

  const recreated = merge({
    remote:           [doc('a', NOW)],
    remoteTombstones: [tomb('a', NOW - DAY)],
  });
  check('remote recreated after the delete → apply', ids(recreated.toApply) === 'a');
  check('...and the tombstone is dropped', recreated.toDropTomb.join(',') === 'a');

  const reEdited = merge({
    local:            [doc('a', NOW)],
    remoteTombstones: [tomb('a', NOW - DAY)],
  });
  check('local edited after the delete propagated → push', ids(reEdited.toPush) === 'a');
  check('...and the tombstone is dropped', reEdited.toDropTomb.join(',') === 'a');

  const carried = merge({ localTombstones: [tomb('a', NOW - DAY)] });
  check('nobody has the document → the tombstone is carried, not dropped',
    carried.toDropTomb.length === 0);
  check('...and it is pushed once', ids2(carried.toPushTomb) === 'a');
}

section('tombstone expiry');
{
  const justInside = merge({
    local:           [doc('a', NOW - TOMBSTONE_TTL_MS - DAY)],
    localTombstones: [tomb('a', NOW - TOMBSTONE_TTL_MS + 1)],
  });
  check('one ms inside the TTL → the deletion still stands',
    justInside.toDeleteLocal.join(',') === 'a' && justInside.toPush.length === 0);

  const justOutside = merge({
    local:           [doc('a', NOW - TOMBSTONE_TTL_MS - DAY)],
    localTombstones: [tomb('a', NOW - TOMBSTONE_TTL_MS - 1)],
  });
  check('one ms outside the TTL → forgotten, and the document comes back',
    justOutside.toDropTomb.join(',') === 'a' && ids(justOutside.toPush) === 'a');
  check('...and the expired tombstone is not pushed', justOutside.toPushTomb.length === 0);

  const pruned = pruneTombstones(
    [tomb('fresh', NOW - DAY), tomb('stale', NOW - TOMBSTONE_TTL_MS - DAY)],
    NOW,
  );
  check('pruneTombstones keeps the fresh one and drops the stale one',
    pruned.length === 1 && pruned[0].id === 'fresh');
}

section('two devices disagreeing about a deletion');
{
  const alreadyKnown = merge({
    localTombstones:  [tomb('a', NOW - DAY)],
    remoteTombstones: [tomb('a', NOW - DAY)],
  });
  check('the cloud already has this tombstone → it is not pushed again',
    alreadyKnown.toPushTomb.length === 0);

  const remoteNewer = merge({
    localTombstones:  [tomb('a', NOW - 2 * DAY)],
    remoteTombstones: [tomb('a', NOW - DAY)],
  });
  check('the cloud has a newer tombstone → nothing is pushed',
    remoteNewer.toPushTomb.length === 0);

  const localNewer = merge({
    localTombstones:  [tomb('a', NOW - DAY)],
    remoteTombstones: [tomb('a', NOW - 2 * DAY)],
  });
  check('this device deleted it more recently → the newer tombstone is pushed',
    localNewer.toPushTomb.length === 1 && localNewer.toPushTomb[0].deletedAt === NOW - DAY);

  // Deleted, recreated, deleted again: only the later deletion describes where the user is.
  const twice = merge({
    local:            [doc('a', NOW - 3 * DAY)],
    localTombstones:  [tomb('a', NOW - DAY)],
    remoteTombstones: [tomb('a', NOW - 5 * DAY)],
  });
  check('two tombstones for one id → the later one governs',
    twice.toDeleteLocal.join(',') === 'a');
}

section('a whole library at once');
{
  const plan = merge({
    local: [
      doc('keep-local',   NOW),           // newer than remote → push
      doc('lose-local',   NOW - 2 * DAY), // older than remote → apply
      doc('only-local',   NOW - DAY),     // → push
      doc('deleted-here', NOW - 3 * DAY), // tombstoned → delete locally
    ],
    remote: [
      doc('keep-local',  NOW - DAY),
      doc('lose-local',  NOW),
      doc('only-remote', NOW - DAY),
    ],
    localTombstones: [tomb('deleted-here', NOW - DAY)],
  });

  check('pushes exactly the two local winners', ids(plan.toPush) === 'keep-local,only-local');
  check('applies exactly the two remote winners', ids(plan.toApply) === 'lose-local,only-remote');
  check('deletes exactly the tombstoned one', plan.toDeleteLocal.join(',') === 'deleted-here');
  check('reports exactly one discarded edit', plan.discarded.length === 1
    && plan.discarded[0].id === 'lose-local');
  check('no document is in two lists at once', (() => {
    const seen = [...plan.toPush, ...plan.toApply].map((d) => d.id)
      .concat(plan.toDeleteLocal);
    return new Set(seen).size === seen.length;
  })());
}

section('the plan is idempotent');
{
  // Re-running a merge after its own plan has been applied must produce nothing to do. This is
  // what makes a failed push safe to retry rather than something needing a queue.
  const local  = [doc('a', NOW), doc('b', NOW - DAY)];
  const remote = [doc('a', NOW), doc('b', NOW - DAY)];
  const second = merge({ local, remote });
  check('converged state → no pushes, no deletes',
    second.toPush.length === 0 && second.toDeleteLocal.length === 0);
  check('converged state → applies are echoes only (equal timestamps)',
    second.toApply.every((d) => remote.some((r) => r.id === d.id && r.updatedAt === d.updatedAt)));
}

/* --------------------------------------------------------------- the wire map */

const recording: TabRecording = {
  id:            'rec-1',
  title:         'Blues in G',
  key:           'G',
  harmonicaType: 'diatonic',
  tabNotes:      [{ tab: '4', start_time: 0, duration: 500, velocity: 90 }],
  createdAt:     NOW - DAY,
  updatedAt:     NOW,
  duration:      500,
  frames:        [{ frequency: 440, rms: 0.5, t: 0 }],
  favorite:      true,
  source:        'recording',
} as TabRecording;

section('wire — tabs');
{
  const encoded = tabToDoc(recording);
  check('frames are stripped from the payload', !JSON.parse(encoded.payload).frames);
  check('the columns the merge needs are real fields',
    encoded.id === 'rec-1' && encoded.updatedAt === NOW && encoded.title === 'Blues in G');
  check('the payload is one string, not a map', typeof encoded.payload === 'string');
  check('no undefined reaches Firestore',
    Object.values(encoded).every((v) => v !== undefined));
  check('the schema version is stamped', encoded.schemaVersion === RECORDINGS_SCHEMA_VERSION);

  const decoded = docToTab(encoded);
  check('round trip preserves updatedAt', decoded?.updatedAt === NOW);
  check('round trip preserves the notes',
    decoded?.tabNotes.length === 1 && decoded.tabNotes[0].tab === '4');
  check('round trip preserves favorite and source',
    decoded?.favorite === true && decoded.source === 'recording');
  check('round trip does not bring frames back', decoded?.frames === undefined);

  const fromFuture = docToTab({ ...encoded, schemaVersion: RECORDINGS_SCHEMA_VERSION + 1 });
  check('a payload from a newer client is refused, not guessed at', fromFuture === null);

  const corrupt = docToTab({ ...encoded, payload: '{not json' });
  check('a corrupt payload is skipped, not thrown', corrupt === null);

  // An old cloud document has to come back through the same migrations a local one does.
  const legacy = docToTab({
    ...encoded,
    schemaVersion: 0,
    payload: JSON.stringify({
      id: 'rec-old', title: 'Old', key: 'C', harmonicaType: 'diatonic',
      createdAt: 111, duration: 10,
      tabNotes: [{ tab: "-8'", start_time: 0, duration: 10, breathForce: 70 }],
    }),
  });
  check('a v0 cloud payload is migrated on the way in',
    legacy?.tabNotes[0].tab === "8'" && legacy.tabNotes[0].velocity === 70);
}

section('wire — projects');
{
  const project = createProject({
    id:    'proj-1',
    title: 'Arrangement',
    tracks: [createTrack(0, {
      notes: [{ midi: 60, timeMs: 0, durationMs: 500, velocity: 90 }],
    })],
  });
  const stamped = { ...project, createdAt: NOW - DAY, updatedAt: NOW };

  const encoded = projectToDoc(stamped);
  check('the payload is one string', typeof encoded.payload === 'string');
  check('no undefined reaches Firestore',
    Object.values(encoded).every((v) => v !== undefined));

  const decoded = docToProject(encoded);
  check('round trip preserves updatedAt', decoded?.updatedAt === NOW);
  check('round trip preserves the title', decoded?.title === 'Arrangement');
  check('round trip preserves one track with one note',
    decoded?.tracks.length === 1 && decoded.tracks[0].notes.length === 1);

  const fromFuture = docToProject({ ...encoded, schemaVersion: 99 });
  check('a payload from a newer client is refused', fromFuture === null);
  check('a corrupt payload is skipped',
    docToProject({ ...encoded, payload: '{' }) === null);
}

section('the v4 migration');
{
  const migrated = migrateRecordings({ recordings: [] }, 3);
  check('v3 → v4 seeds an empty tombstone log',
    Array.isArray(migrated.deletedIds) && migrated.deletedIds.length === 0);

  const carried = migrateRecordings(
    { recordings: [], deletedIds: [{ id: 'a', deletedAt: 1, kind: 'tab' }] },
    4,
  );
  check('an existing log survives the migration', carried.deletedIds.length === 1);

  const hostile = migrateRecordings(
    { recordings: [], deletedIds: [{ id: 'a', deletedAt: 1, kind: 'tab' }, null, { id: 5 }, { id: 'b' }] },
    4,
  );
  check('malformed entries are dropped individually, not the whole log',
    hostile.deletedIds.length === 1 && hostile.deletedIds[0].id === 'a');

  check('a non-array log is not trusted',
    migrateRecordings({ recordings: [], deletedIds: 'nope' }, 4).deletedIds.length === 0);
}

function ids2(tombstones: Tombstone[]): string {
  return tombstones.map((t) => t.id).sort().join(',');
}

console.log(
  failures === 0
    ? '\nAll checks passed.'
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
