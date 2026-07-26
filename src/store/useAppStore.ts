import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { HarmonicaKey, HarmonicaType, TabNote, ExportFormat } from '@/types';

interface AppState {
  harmonicaType:      HarmonicaType;
  selectedKey:        HarmonicaKey | null;
  isRecording:        boolean;
  isPaused:           boolean;
  recordingStartTime: number | null;
  tabNotes:           TabNote[];
  exportFormat:       ExportFormat;
}

interface AppActions {
  setHarmonicaType: (type: HarmonicaType) => void;
  selectKey:        (key: HarmonicaKey) => void;
  startRecording: () => void;
  stopRecording:  () => void;
  pauseRecording: () => void;
  resumeRecording:() => void;
  addTabNote:     (note: Omit<TabNote, 'id'>) => void;
  reorderNotes:   (notes: TabNote[]) => void;
  deleteNote:     (id: string) => void;
  updateNote:     (id: string, changes: Partial<Pick<TabNote, 'tab' | 'note' | 'start_time' | 'duration'>>) => void;
  setExportFormat:(format: ExportFormat) => void;
  reset:          () => void;
}

const initialState: AppState = {
  harmonicaType:      'diatonic',
  selectedKey:        null,
  isRecording:        false,
  isPaused:           false,
  recordingStartTime: null,
  tabNotes:           [],
  exportFormat:       'TXT',
};

export const useAppStore = create<AppState & AppActions>()(
  immer((set) => ({
    ...initialState,

    setHarmonicaType: (type) =>
      set((s) => { s.harmonicaType = type; }),

    selectKey: (key) =>
      set((s) => { s.selectedKey = key; }),

    startRecording: () =>
      set((s) => {
        s.isRecording        = true;
        s.isPaused           = false;
        s.recordingStartTime = Date.now();
        s.tabNotes           = [];
      }),

    stopRecording: () =>
      set((s) => { s.isRecording = false; s.isPaused = false; }),

    pauseRecording: () =>
      set((s) => { s.isPaused = true; }),

    resumeRecording: () =>
      set((s) => { s.isPaused = false; }),

    addTabNote: (note) =>
      set((s) => {
        if (s.isPaused) return;
        const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        s.tabNotes.push({ ...note, id });
      }),

    reorderNotes: (notes) =>
      set((s) => { s.tabNotes = notes; }),

    deleteNote: (id) =>
      set((s) => { s.tabNotes = s.tabNotes.filter((n) => n.id !== id); }),

    updateNote: (id, changes) =>
      set((s) => {
        const note = s.tabNotes.find((n) => n.id === id);
        if (note) Object.assign(note, changes);
      }),

    setExportFormat: (format) =>
      set((s) => { s.exportFormat = format; }),

    reset: () =>
      set(() => ({ ...initialState })),
  }))
);

// Granular selectors — use these to prevent over-rendering
export const selectHarmonicaType = (s: AppState & AppActions) => s.harmonicaType;
export const selectKey           = (s: AppState & AppActions) => s.selectedKey;
export const selectIsRecording= (s: AppState & AppActions) => s.isRecording;
export const selectIsPaused   = (s: AppState & AppActions) => s.isPaused;
export const selectTabNotes   = (s: AppState & AppActions) => s.tabNotes;
export const selectExportFmt  = (s: AppState & AppActions) => s.exportFormat;
