/**
 * Document ⇄ payload, both directions, both libraries (7b-1).
 *
 * Kept apart from `merge.ts` so that stays pure and generic, and apart from `syncEngine.ts` so
 * the mapping can be round-trip tested without a network. Nothing here awaits anything.
 *
 * **Two rules govern every function below.**
 *
 * 1. *The body is one opaque string.* Firestore charges for every field name in every array
 *    element, so an expanded `tabNotes` array is tens of KB of repeated keys on every read and
 *    write, forever. Only the fields needed to list or reconcile are real columns.
 * 2. *Undefined is never written.* Firestore rejects `undefined` field values outright, and
 *    `TabRecording` has five optional fields. Every optional column below is spread in
 *    conditionally rather than assigned, which is why these look more verbose than an object
 *    literal would.
 */

import { migrateRecordings, RECORDINGS_SCHEMA_VERSION } from '@/store/recordingsMigration';
import { deserializeProject, serializeProject, type StoredProject } from '@/audio/midiProject';
import {
  PROJECT_WIRE_VERSION,
  SETTINGS_WIRE_VERSION,
  type ProjectSyncDoc,
  type SettingsSyncDoc,
  type TabSyncDoc,
} from './types';
import type { MidiProject, TabRecording } from '@/types';

/**
 * The settings that belong to a *person*, not to a device (7b-6).
 *
 * `micSensitivity` and `hasCompletedOnboarding` are deliberately absent: mic calibration
 * describes a microphone, and syncing it means a laptop inheriting a phone's gain. `isPurchased`
 * and `totalRecordingsUsed` are governed by the entitlement decision instead. `compactTakes`
 * selects Int16 retention to save memory, which is a fact about this device's headroom.
 */
export interface SyncedSettings {
  themeOverride?:       string;
  defaultAlgorithm?:    string;
  transcriptionParams?: unknown;
  maxTakeMinutes?:      number;
}

export const SYNCED_SETTINGS_KEYS = [
  'themeOverride',
  'defaultAlgorithm',
  'transcriptionParams',
  'maxTakeMinutes',
] as const;

/* -------------------------------------------------------------------------- tabs */

/**
 * **`frames` are stripped here, and this is the only place that decides that.**
 *
 * 112 KB per recording, 78% of a typical document, feeding one debug screen (Frame Inspector).
 * Syncing them would make a diagnostic lens the dominant cost of the entire feature. The
 * consequence is visible to users, so Frame Inspector's empty state says which device the
 * frames stayed on rather than implying the take never had audio.
 */
export function tabToDoc(recording: TabRecording): TabSyncDoc {
  const { frames: _frames, ...body } = recording;

  return {
    id:            recording.id,
    title:         recording.title,
    createdAt:     recording.createdAt,
    updatedAt:     recording.updatedAt,
    duration:      recording.duration,
    favorite:      recording.favorite ?? false,
    ...(recording.source !== undefined ? { source: recording.source } : {}),
    schemaVersion: RECORDINGS_SCHEMA_VERSION,
    payload:       JSON.stringify(body),
  };
}

/**
 * `null` for anything this client must not touch — a payload from a future schema, or one that
 * will not parse.
 *
 * Returning `null` rather than throwing is what lets one bad document be skipped while the rest
 * of the library still syncs, the same call the MIDI store's `merge()` already makes for one
 * unreadable project (`useMidiProjectsStore.ts:76-80`).
 */
export function docToTab(doc: TabSyncDoc): TabRecording | null {
  if (doc.schemaVersion > RECORDINGS_SCHEMA_VERSION) return null;

  try {
    const body = JSON.parse(doc.payload) as TabRecording;
    // Run it through the same migrations a local payload gets. A tab document *is* a
    // persisted-shape recording, so an older cloud copy is exactly an older stored copy, and
    // duplicating the migration logic here is how the two would drift apart.
    const [migrated] = migrateRecordings({ recordings: [body] }, doc.schemaVersion).recordings;
    if (!migrated) return null;

    // The columns are authoritative over the payload for the two fields the merge reasons
    // about. They cannot normally disagree — both come from the same record — but if a write
    // ever half-lands, trusting the field the query sorted on keeps the merge self-consistent.
    return { ...migrated, id: doc.id, updatedAt: doc.updatedAt };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------- projects */

export function projectToDoc(project: MidiProject): ProjectSyncDoc {
  const stored = serializeProject(project);

  return {
    id:            project.id,
    title:         project.title,
    createdAt:     project.createdAt,
    updatedAt:     project.updatedAt,
    durationMs:    project.durationMs,
    ...(project.origin !== undefined ? { origin: project.origin } : {}),
    schemaVersion: PROJECT_WIRE_VERSION,
    payload:       JSON.stringify(stored),
  };
}

export function docToProject(doc: ProjectSyncDoc): MidiProject | null {
  if (doc.schemaVersion > PROJECT_WIRE_VERSION) return null;

  try {
    const stored = JSON.parse(doc.payload) as StoredProject;
    const project = deserializeProject(stored);
    return { ...project, id: doc.id, updatedAt: doc.updatedAt };
  } catch {
    // A truncated or corrupt base64 SMF takes this project down and nothing else — the same
    // bargain `useMidiProjectsStore.merge` already strikes on load.
    return null;
  }
}

/* ---------------------------------------------------------------------- settings */

export function settingsToDoc(settings: SyncedSettings, updatedAt: number): SettingsSyncDoc {
  return {
    updatedAt,
    schemaVersion: SETTINGS_WIRE_VERSION,
    payload:       JSON.stringify(settings),
  };
}

export function docToSettings(doc: SettingsSyncDoc): SyncedSettings | null {
  if (doc.schemaVersion > SETTINGS_WIRE_VERSION) return null;
  try {
    return JSON.parse(doc.payload) as SyncedSettings;
  } catch {
    return null;
  }
}

/**
 * Whether a document read from Firestore has the two columns `merge.ts` reasons about.
 *
 * Guards the pull, so a hand-edited or half-written document is skipped rather than entering
 * the merge as `{ id: undefined, updatedAt: NaN }` — where it would compare false against
 * everything and be pushed over silently.
 */
export function isUsableDoc(value: unknown): value is { id: string; updatedAt: number } {
  const doc = value as { id?: unknown; updatedAt?: unknown } | null;
  return !!doc
    && typeof doc.id === 'string'
    && typeof doc.updatedAt === 'number'
    && Number.isFinite(doc.updatedAt);
}
