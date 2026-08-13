/**
 * Harness for the recordings persisted-schema migrations.
 *
 * `recordingsMigration.ts` says in its own header that it was split out of the store so it
 * could be driven with hand-authored old payloads. Until now nothing did — the migrations
 * shipped untested against real libraries. v3 is the one that makes that worth fixing: it is
 * the first migration whose output is read by something other than the UI (7b's last-write-
 * wins reconciliation), so a wrong `updatedAt` is not a cosmetic bug, it is a record that
 * loses a merge it should have won.
 *
 * The fixtures are deliberately hand-written rather than produced by the app, so they don't
 * come from the same code being tested.
 *
 * Run: npx tsx scripts/verify-recordings-migration.ts
 */

import {
  migrateRecordings,
  RECORDINGS_SCHEMA_VERSION,
  inferVelocitySource,
} from '../src/store/recordingsMigration';

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

/** A v0 payload: `breathForce` rather than `velocity`, draw-prefixed blow bends, no
 *  `updatedAt`. The oldest shape any real library can be in. */
const v0Payload = {
  recordings: [
    {
      id: 'rec-old',
      title: 'Blues in G',
      key: 'G',
      harmonicaType: 'diatonic',
      createdAt: 1_700_000_000_000,
      duration: 4200,
      source: 'recording',
      tabNotes: [
        { id: 'n0', tab: '-8\'', start_time: 0,    duration: 200, breathForce: 90 },
        { id: 'n1', tab: '4',    start_time: 220,  duration: 180, breathForce: 64 },
        { id: 'n2', tab: '-10\'\'', start_time: 420, duration: 300 },
      ],
    },
  ],
};

/** A v2 payload: notes already migrated, but no `updatedAt`. This is what every library on
 *  the current build actually looks like, and the case the old early-return skipped. */
const v2Payload = {
  recordings: [
    {
      id: 'rec-recent',
      title: 'Juke',
      key: 'A',
      harmonicaType: 'diatonic',
      createdAt: 1_750_000_000_000,
      duration: 8000,
      favorite: true,
      noiseGate: 40,
      durationFloorMs: 60,
      tabNotes: [{ id: 'n0', tab: '4', start_time: 0, duration: 200, velocity: 88 }],
    },
    // No usable `createdAt` — the unknown-age case the 0 fallback exists for.
    {
      id: 'rec-corrupt',
      title: 'Untitled',
      key: 'C',
      harmonicaType: 'diatonic',
      duration: 1000,
      tabNotes: [],
    },
  ],
};

section('v0 → v3 (the full chain)');
{
  const { recordings } = migrateRecordings(v0Payload, 0);
  const [rec] = recordings;
  const [n0, n1, n2] = rec.tabNotes;

  check('velocity renamed from breathForce', n0.velocity === 90);
  check('breathForce key is gone', !('breathForce' in n0));
  check('velocitySource inferred for a mic recording',
    n0.velocitySource === inferVelocitySource('recording'));
  check('blow bend -8\' respelled to 8\'', n0.tab === "8'");
  check('blow bend -10\'\' respelled to 10\'\'', n2.tab === "10''");
  check('a plain draw note is untouched', n1.tab === '4');
  check('a note with no velocity gets no source tag',
    n2.velocity === undefined && n2.velocitySource === undefined);

  // The point of the restructure: v3 must run for a v0 payload too, not just for v2.
  check('updatedAt seeded from createdAt', rec.updatedAt === 1_700_000_000_000);
}

section('v2 → v3 (the case the old early return skipped)');
{
  const { recordings } = migrateRecordings(v2Payload, 2);
  const [recent, corrupt] = recordings;

  check('updatedAt seeded from createdAt', recent.updatedAt === 1_750_000_000_000);
  check('unknown createdAt falls back to 0, not now',
    corrupt.updatedAt === 0,
    `got ${corrupt.updatedAt} — a "now" stamp would beat every cloud copy in 7b`);
  check('notes are left alone at v2', recent.tabNotes[0].velocity === 88);
  check('favorite survives', recent.favorite === true);
  check('both filter lenses survive',
    recent.noiseGate === 40 && recent.durationFloorMs === 60);
}

section('v3 → v3 (no-op) and idempotence');
{
  const once  = migrateRecordings(v2Payload, 2);
  const twice = migrateRecordings(once, RECORDINGS_SCHEMA_VERSION);
  check('a current payload is returned unchanged',
    twice.recordings[0].updatedAt === once.recordings[0].updatedAt);

  // Re-running the seeding step must not overwrite a real edit timestamp with createdAt.
  const edited = { recordings: [{ ...v2Payload.recordings[0], updatedAt: 1_760_000_000_000 }] };
  const { recordings } = migrateRecordings(edited, 2);
  check('an existing updatedAt is preserved, not reseeded',
    recordings[0].updatedAt === 1_760_000_000_000);
}

section('degenerate payloads');
{
  check('undefined payload yields an empty library',
    migrateRecordings(undefined, 0).recordings.length === 0);
  check('missing recordings array yields an empty library',
    migrateRecordings({}, 0).recordings.length === 0);
  check('a recording with no tabNotes array survives v0',
    migrateRecordings({ recordings: [{ id: 'x', createdAt: 1 }] }, 0)
      .recordings[0].tabNotes.length === 0);
}

console.log(
  failures === 0
    ? '\nAll checks passed.'
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
