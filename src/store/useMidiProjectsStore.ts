import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { midiProjectsStorage } from './storage';
import {
  deserializeProject,
  projectDurationMs,
  serializeProject,
  type StoredProject,
} from '@/audio/midiProject';
import type { MidiProject, Tombstone } from '@/types';

/**
 * The MIDI Studio's document library — a sibling of `useRecordingsStore`, not a
 * replacement for it. Tabs and projects are different documents (see `MidiProject` in
 * `types/index.ts`), and Home lists both.
 *
 * Projects live in memory as `MidiProject` and persist as base64 SMF via
 * `serializeProject`. That conversion happens in the persist middleware rather than at
 * every call site, so the rest of the app only ever handles the decoded form.
 */
interface MidiProjectsState {
  projects: MidiProject[];
  /** Deletions this device has made (7b-3). The sibling of `useRecordingsStore.deletedIds`,
   *  written for the same reason and on the same terms — see the note there. */
  deletedIds: Tombstone[];

  saveProject:   (project: MidiProject) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, title: string) => void;

  /* ---- sync entry points (7b-3). Not for UI use. ---- */
  applyRemote:      (projects: MidiProject[]) => void;
  deleteFromRemote: (ids: string[]) => void;
  dropTombstones:   (ids: string[]) => void;
}

/** What actually reaches storage. `projects` is replaced wholesale by its stored form —
 *  `partialize` on the way out, `merge` on the way back in. */
interface PersistedShape {
  projects:    StoredProject[];
  deletedIds?: Tombstone[];
}

/** Stamps `updatedAt` and recomputes duration, so no caller has to remember to. */
function touch(project: MidiProject): MidiProject {
  return {
    ...project,
    updatedAt:  Date.now(),
    durationMs: projectDurationMs(project.tracks),
  };
}

export const useMidiProjectsStore = create<MidiProjectsState>()(
  persist(
    (set) => ({
      projects: [],
      deletedIds: [],

      saveProject: (project) =>
        set((s) => ({
          // Newest first; replace rather than duplicate if the same id is saved twice —
          // same convention as `useRecordingsStore`.
          projects: [touch(project), ...s.projects.filter((p) => p.id !== project.id)],
          deletedIds: s.deletedIds.filter((t) => t.id !== project.id),
        })),

      deleteProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          // Atomic with the deletion, for the reason spelled out in `useRecordingsStore`.
          deletedIds: [
            ...s.deletedIds.filter((t) => t.id !== id),
            { id, deletedAt: Date.now(), kind: 'project' as const },
          ],
        })),

      renameProject: (id, title) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, title, updatedAt: Date.now() } : p)),
        })),

      /** Preserves `updatedAt`; see `useRecordingsStore.applyRemote` for why that matters.
       *  Order is preserved for the same reason too. */
      applyRemote: (incoming) =>
        set((s) => {
          if (incoming.length === 0) return s;
          const arriving = new Map(incoming.map((p) => [p.id, p]));

          const updated = s.projects.map((local) => {
            const remote = arriving.get(local.id);
            if (!remote) return local;
            arriving.delete(local.id);
            return remote;
          });

          const fresh = incoming.filter((p) => arriving.has(p.id));
          const applied = new Set(incoming.map((p) => p.id));

          return {
            projects:   [...fresh, ...updated],
            deletedIds: s.deletedIds.filter((t) => !applied.has(t.id)),
          };
        }),

      deleteFromRemote: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const gone = new Set(ids);
          return { projects: s.projects.filter((p) => !gone.has(p.id)) };
        }),

      dropTombstones: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const drop = new Set(ids);
          return { deletedIds: s.deletedIds.filter((t) => !drop.has(t.id)) };
        }),
    }),
    {
      name:    'harp2tab-midi-projects',
      storage: midiProjectsStorage,

      partialize: (state) =>
        ({
          projects:   state.projects.map(serializeProject),
          deletedIds: state.deletedIds,
        } as unknown as MidiProjectsState),

      merge: (persisted, current) => {
        const stored = persisted as PersistedShape | undefined;
        const projects: MidiProject[] = [];
        for (const entry of stored?.projects ?? []) {
          // One unreadable project must not take the whole library down with it — a
          // corrupt or truncated base64 payload is dropped and the rest still load.
          try {
            projects.push(deserializeProject(entry));
          } catch {
            continue;
          }
        }
        // No `version`/`migrate` on this store, so an absent `deletedIds` is simply how every
        // payload written before 7b looks. Empty is the right answer for those: a deletion that
        // happened before the log existed left no trace to recover.
        return {
          ...current,
          projects,
          deletedIds: Array.isArray(stored?.deletedIds) ? stored.deletedIds : [],
        };
      },
    },
  ),
);

export const selectMidiProjects = (s: MidiProjectsState) => s.projects;
