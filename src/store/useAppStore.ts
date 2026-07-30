import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { HarmonicaKey, HarmonicaType, TabNote, TabRecording, ExportFormat } from '@/types';

const MAX_HISTORY = 50; // bounded for hygiene; snapshots are cheap (array of refs) so this is generous

interface AppState {
  harmonicaType:      HarmonicaType;
  selectedKey:        HarmonicaKey | null;
  isRecording:        boolean;
  isPaused:           boolean;
  recordingStartTime: number | null;
  recordingId:        string | null;
  tabNotes:           TabNote[];
  history:            TabNote[][];
  future:             TabNote[][];
  exportFormat:       ExportFormat;
  /** Beats per minute — a property of the song being edited (persisted per-recording),
   *  drives the piano-roll's bar ruler, its snap-to-grid dragging, and the metronome. */
  bpm:                number;
  metronomeEnabled:   boolean;
}

function pushHistory(s: { tabNotes: TabNote[]; history: TabNote[][]; future: TabNote[][] }) {
  // Copy each note object, not just the array — updateNote mutates a note's
  // fields in place via Object.assign, and since that happens on the same
  // draft within the same producer call, a shallow array copy would still
  // share the exact object reference that's about to be mutated.
  s.history.push(s.tabNotes.map((n) => ({ ...n })));
  if (s.history.length > MAX_HISTORY) s.history.shift();
  // A fresh edit invalidates whatever was available to redo.
  s.future = [];
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
  undo:           () => void;
  redo:           () => void;
  setExportFormat:(format: ExportFormat) => void;
  setBpm:              (bpm: number) => void;
  setMetronomeEnabled: (enabled: boolean) => void;
  loadRecording:  (recording: TabRecording) => void;
  reset:          () => void;
}

export const DEFAULT_BPM = 100;

const initialState: AppState = {
  harmonicaType:      'diatonic',
  selectedKey:        null,
  isRecording:        false,
  isPaused:           false,
  recordingStartTime: null,
  recordingId:        null,
  tabNotes:           [],
  history:            [],
  future:             [],
  exportFormat:       'TXT',
  bpm:                DEFAULT_BPM,
  metronomeEnabled:   false,
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
        s.recordingId        = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        s.tabNotes           = [];
        s.history            = [];
        s.future             = [];
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
        pushHistory(s);
        const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        s.tabNotes.push({ ...note, id });
      }),

    reorderNotes: (notes) =>
      set((s) => {
        pushHistory(s);
        s.tabNotes = notes;
      }),

    deleteNote: (id) =>
      set((s) => {
        pushHistory(s);
        s.tabNotes = s.tabNotes.filter((n) => n.id !== id);
      }),

    updateNote: (id, changes) =>
      set((s) => {
        const note = s.tabNotes.find((n) => n.id === id);
        if (!note) return;
        // TextInput's onBlur and onSubmitEditing can both fire for a single
        // edit (e.g. tapping away to select another card on Android), calling
        // this twice with identical changes — skip the no-op so it doesn't
        // push a redundant history snapshot that'd need an extra Undo click.
        const keys = Object.keys(changes) as (keyof typeof changes)[];
        const isNoop = keys.every((k) => note[k] === changes[k]);
        if (isNoop) return;
        pushHistory(s);
        Object.assign(note, changes);
      }),

    undo: () =>
      set((s) => {
        const prev = s.history.pop();
        if (prev === undefined) return;
        s.future.push(s.tabNotes.map((n) => ({ ...n })));
        s.tabNotes = prev;
      }),

    redo: () =>
      set((s) => {
        const next = s.future.pop();
        if (next === undefined) return;
        s.history.push(s.tabNotes.map((n) => ({ ...n })));
        s.tabNotes = next;
      }),

    setExportFormat: (format) =>
      set((s) => { s.exportFormat = format; }),

    setBpm: (bpm) =>
      set((s) => { s.bpm = Math.max(20, Math.min(400, Math.round(bpm))); }),

    setMetronomeEnabled: (enabled) =>
      set((s) => { s.metronomeEnabled = enabled; }),

    // Reopens a saved recording for editing — distinct from startRecording()
    // since it's not a new session (no gate check, no fresh recordingStartTime
    // for elapsed-time purposes), just loading past notes back into the working state.
    loadRecording: (recording) =>
      set((s) => {
        s.harmonicaType      = recording.harmonicaType;
        s.selectedKey        = recording.key;
        s.recordingId        = recording.id;
        s.recordingStartTime = recording.createdAt;
        s.tabNotes           = recording.tabNotes.map((n) => ({ ...n }));
        s.history            = [];
        s.future             = [];
        s.isRecording         = false;
        s.isPaused            = false;
        s.bpm                 = recording.bpm ?? DEFAULT_BPM;
      }),

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
export const selectRecordingId = (s: AppState & AppActions) => s.recordingId;
export const selectCanUndo    = (s: AppState & AppActions) => s.history.length > 0;
export const selectCanRedo    = (s: AppState & AppActions) => s.future.length > 0;
export const selectExportFmt  = (s: AppState & AppActions) => s.exportFormat;
export const selectBpm              = (s: AppState & AppActions) => s.bpm;
export const selectMetronomeEnabled = (s: AppState & AppActions) => s.metronomeEnabled;
