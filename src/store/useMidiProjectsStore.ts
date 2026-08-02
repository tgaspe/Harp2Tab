import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { midiProjectsStorage } from './storage';
import {
  deserializeProject,
  projectDurationMs,
  serializeProject,
  type StoredProject,
} from '@/audio/midiProject';
import type { MidiProject } from '@/types';

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
  saveProject:   (project: MidiProject) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, title: string) => void;
}

/** What actually reaches storage. `projects` is replaced wholesale by its stored form —
 *  `partialize` on the way out, `merge` on the way back in. */
interface PersistedShape {
  projects: StoredProject[];
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

      saveProject: (project) =>
        set((s) => ({
          // Newest first; replace rather than duplicate if the same id is saved twice —
          // same convention as `useRecordingsStore`.
          projects: [touch(project), ...s.projects.filter((p) => p.id !== project.id)],
        })),

      deleteProject: (id) =>
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

      renameProject: (id, title) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, title, updatedAt: Date.now() } : p)),
        })),
    }),
    {
      name:    'harp2tab-midi-projects',
      storage: midiProjectsStorage,

      partialize: (state) =>
        ({ projects: state.projects.map(serializeProject) } as unknown as MidiProjectsState),

      merge: (persisted, current) => {
        const stored = (persisted as PersistedShape | undefined)?.projects ?? [];
        const projects: MidiProject[] = [];
        for (const entry of stored) {
          // One unreadable project must not take the whole library down with it — a
          // corrupt or truncated base64 payload is dropped and the rest still load.
          try {
            projects.push(deserializeProject(entry));
          } catch {
            continue;
          }
        }
        return { ...current, projects };
      },
    },
  ),
);

export const selectMidiProjects = (s: MidiProjectsState) => s.projects;
