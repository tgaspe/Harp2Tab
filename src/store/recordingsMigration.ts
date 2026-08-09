/**
 * Persisted-schema migrations for the recordings library.
 *
 * Split out of the store rather than written inline for the same reason `convertTrack.ts`
 * is a seam: it's a pure function over a decoded payload, so the harness can drive it with
 * hand-authored old data. A migration that only ever runs inside a live zustand store on a
 * real user's device is a migration nobody can test before it ships.
 */

import type { RecordingSource, TabNote, TabRecording, VelocitySource } from '@/types';

/** Bumped when the persisted shape changes. v1 renamed `TabNote.breathForce` → `velocity`
 *  and added `velocitySource`. v2 re-spelled the hole 8-10 blow bends. Payloads written
 *  before versioning existed arrive as 0. */
export const RECORDINGS_SCHEMA_VERSION = 2;

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
): { recordings: TabRecording[] } {
  const state = (persisted ?? {}) as { recordings?: unknown };
  const recordings: unknown[] = Array.isArray(state.recordings) ? state.recordings : [];
  if (fromVersion >= RECORDINGS_SCHEMA_VERSION) {
    return { recordings: recordings as TabRecording[] };
  }

  return {
    recordings: recordings.map((raw) => {
      const recording = raw as TabRecording;
      const inferred = inferVelocitySource(recording.source);
      const notes: unknown[] = Array.isArray(recording.tabNotes) ? recording.tabNotes : [];
      return {
        ...recording,
        tabNotes: notes.map((rawNote) => {
          const { breathForce, ...note } = rawNote as TabNote & { breathForce?: number };
          const tab = fromVersion < 2 ? migrateBlowBendTab(note.tab) : note.tab;
          const velocity = note.velocity ?? breathForce;
          // No value means nothing to attribute — a source tag on an absent velocity would
          // claim a measurement that was never taken.
          return velocity === undefined
            ? { ...note, tab }
            : { ...note, tab, velocity, velocitySource: note.velocitySource ?? inferred };
        }),
      };
    }) as TabRecording[],
  };
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
