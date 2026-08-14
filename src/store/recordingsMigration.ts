/**
 * Persisted-schema migrations for the recordings library.
 *
 * Split out of the store rather than written inline for the same reason `convertTrack.ts`
 * is a seam: it's a pure function over a decoded payload, so the harness can drive it with
 * hand-authored old data. A migration that only ever runs inside a live zustand store on a
 * real user's device is a migration nobody can test before it ships.
 */

import type { RecordingSource, TabNote, TabRecording, Tombstone, VelocitySource } from '@/types';

/** Bumped when the persisted shape changes. v1 renamed `TabNote.breathForce` → `velocity`
 *  and added `velocitySource`. v2 re-spelled the hole 8-10 blow bends. v3 added
 *  `TabRecording.updatedAt`. v4 added the `deletedIds` tombstone log. Payloads written before
 *  versioning existed arrive as 0. */
export const RECORDINGS_SCHEMA_VERSION = 4;

/**
 * What a recording's velocities must have come from, given how the tab was made.
 *
 * `'audioUpload'` is deliberately unresolvable: it covers both the classic tracker (which
 * reports take-relative RMS) and the neural engine (which reports its own activation), and
 * which one ran was never recorded on the tab. Guessing would put a confident wrong label
 * on the filter, so these stay untagged and the filter says nothing rather than something
 * false.
 */
export function inferVelocitySource(source: RecordingSource | undefined): VelocitySource | undefined {
  switch (source ?? 'recording') {
    case 'recording':  return 'takeRelativeRms';
    case 'midiUpload':
    case 'midiStudio': return 'midiVelocity';
    default:           return undefined;
  }
}

/**
 * v0 → v1: `breathForce` → `velocity`, plus an inferred source tag.
 *
 * This has to exist rather than relying on the old field simply being absent. The stale key
 * would survive the load — it is spread through untouched — but nothing would read it, so
 * every tab already in a user's library would quietly lose its velocity filter, reopen with
 * a saved noise gate that no longer hides anything, play back at flat full level, and export
 * dynamically flat MIDI. All of that without a single error, which is what makes it worth
 * a migration rather than a fallback read.
 */
export function migrateRecordings(
  persisted: unknown,
  fromVersion: number,
): { recordings: TabRecording[]; deletedIds: Tombstone[] } {
  const state = (persisted ?? {}) as { recordings?: unknown; deletedIds?: unknown };
  let recordings: unknown[] = Array.isArray(state.recordings) ? state.recordings : [];

  // One guarded step per version rather than a single early return over the lot. The old
  // shape worked while every migration happened to end at the newest version, but it means a
  // v2 payload skips *all* subsequent work — so v3 below would never run for the libraries
  // that most need it. Each step now states the range it applies to and composes with the
  // rest, which is also what makes each one testable on its own.
  if (fromVersion < 2) recordings = migrateNotesToV2(recordings);
  if (fromVersion < 3) recordings = migrateToV3(recordings);

  return {
    recordings: recordings as TabRecording[],
    // v3 → v4 in full: the log starts empty. There is nothing to seed it from — a deletion
    // that happened before this field existed left no trace anywhere, which is precisely the
    // gap 7b-3 exists to close going forward. Returned unconditionally rather than under a
    // `fromVersion < 4` guard because zustand's `migrate` *replaces* the persisted state, so
    // an existing log has to be carried through every migration or a v3 payload would silently
    // drop the tombstones a v4 install had already accumulated.
    deletedIds: sanitizeTombstones(state.deletedIds),
  };
}

/**
 * Tombstones survive a hostile payload the same way recordings do: individually.
 *
 * One malformed entry — a hand-edited `localStorage`, a half-written value — must not take the
 * log down with it, because an empty log reads as "nothing was ever deleted" and that is the
 * input that resurrects a deleted tab on the next sync.
 */
function sanitizeTombstones(value: unknown): Tombstone[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Tombstone => {
    const tomb = entry as Partial<Tombstone> | null;
    return !!tomb
      && typeof tomb.id === 'string'
      && typeof tomb.deletedAt === 'number'
      && Number.isFinite(tomb.deletedAt)
      && (tomb.kind === 'tab' || tomb.kind === 'project');
  });
}

function migrateNotesToV2(recordings: unknown[]): unknown[] {
  return recordings.map((raw) => {
    const recording = raw as TabRecording;
    const inferred = inferVelocitySource(recording.source);
    const notes: unknown[] = Array.isArray(recording.tabNotes) ? recording.tabNotes : [];
    return {
      ...recording,
      tabNotes: notes.map((rawNote) => {
        const { breathForce, ...note } = rawNote as TabNote & { breathForce?: number };
        const tab = migrateBlowBendTab(note.tab);
        const velocity = note.velocity ?? breathForce;
        // No value means nothing to attribute — a source tag on an absent velocity would
        // claim a measurement that was never taken.
        return velocity === undefined
          ? { ...note, tab }
          : { ...note, tab, velocity, velocitySource: note.velocitySource ?? inferred };
      }),
    };
  });
}

/**
 * v2 → v3: seed `TabRecording.updatedAt` from `createdAt`.
 *
 * Every recording in an existing library was last touched at some unrecorded moment, so
 * `createdAt` is the only honest answer available — it is a lower bound on the truth, and for
 * the common case of a tab saved and never reopened it is exactly right.
 *
 * **The fallback is 0, deliberately, not `Date.now()`.** A record with no usable `createdAt`
 * has an unknown edit time, and stamping it with now would make it beat every cloud copy in
 * 7b's last-write-wins comparison — an unknown-age local record silently overwriting a known
 * newer remote one. 0 loses that comparison instead, which costs nothing real: first sign-in
 * adopts the local library wholesale (7-11), so the only way a remote copy of the same id can
 * exist is if this record was synced before, and it carried a real timestamp when it was.
 */
function migrateToV3(recordings: unknown[]): unknown[] {
  return recordings.map((raw) => {
    const recording = raw as TabRecording;
    return {
      ...recording,
      updatedAt: recording.updatedAt ?? recording.createdAt ?? 0,
    };
  });
}

/**
 * v1 → v2: the hole 8-10 blow bends were written with a draw prefix (`-8'`, `-9'`, `-10'`,
 * `-10''`) even though they are blown, not drawn.
 *
 * The pitches were always right, so nothing sounded wrong and nothing was unplayable — the
 * tab just told the player to inhale on a note they have to exhale. Left alone, a library
 * built before this fix would keep instructing that forever, and the same chart would read
 * differently depending on when it was made. Rewriting is safe because the mapping is
 * one-directional: no correctly-spelled tab collides with one of these four.
 */
const BLOW_BEND_RESPELLINGS: Record<string, string> = {
  "-8'":   "8'",
  "-9'":   "9'",
  "-10'":  "10'",
  "-10''": "10''",
};

export function migrateBlowBendTab(tab: string | undefined): string {
  if (!tab) return tab ?? '';
  return BLOW_BEND_RESPELLINGS[tab] ?? tab;
}
