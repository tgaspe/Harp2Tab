import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { noteToTab, tabToNote } from '@/audio/HarmonicaMapper';
import type { HarmonicaKey, HarmonicaType, TabNote, TabRecording, ExportFormat } from '@/types';

const MAX_HISTORY = 50; // bounded for hygiene; snapshots are cheap (array of refs) so this is generous

// Snapshot carries selectedKey/harmonicaType alongside tabNotes — a key/type change
// (transposeToKey/changeHarmonicaType below) is now a real undoable edit, not just a
// note mutation, so undo/redo need to restore all three together, not just the notes.
interface HistorySnapshot {
  tabNotes:     TabNote[];
  selectedKey:  HarmonicaKey | null;
  harmonicaType: HarmonicaType;
  bpm:          number;
}

interface AppState {
  harmonicaType:      HarmonicaType;
  selectedKey:        HarmonicaKey | null;
  isRecording:        boolean;
  isPaused:           boolean;
  recordingStartTime: number | null;
  recordingId:        string | null;
  tabNotes:           TabNote[];
  history:            HistorySnapshot[];
  future:             HistorySnapshot[];
  exportFormat:       ExportFormat;
  /** Beats per minute — a property of the song being edited (persisted per-recording),
   *  drives the piano-roll's bar ruler, its snap-to-grid dragging, and the metronome. */
  bpm:                number;
  metronomeEnabled:   boolean;
}

function pushHistory(s: {
  tabNotes: TabNote[]; selectedKey: HarmonicaKey | null; harmonicaType: HarmonicaType; bpm: number;
  history: HistorySnapshot[]; future: HistorySnapshot[];
}) {
  // Copy each note object, not just the array — updateNote mutates a note's
  // fields in place via Object.assign, and since that happens on the same
  // draft within the same producer call, a shallow array copy would still
  // share the exact object reference that's about to be mutated.
  s.history.push({
    tabNotes: s.tabNotes.map((n) => ({ ...n })),
    selectedKey: s.selectedKey,
    harmonicaType: s.harmonicaType,
    bpm: s.bpm,
  });
  if (s.history.length > MAX_HISTORY) s.history.shift();
  // A fresh edit invalidates whatever was available to redo.
  s.future = [];
}

interface AppActions {
  setHarmonicaType: (type: HarmonicaType) => void;
  selectKey:        (key: HarmonicaKey) => void;
  transposeToKey:      (key: HarmonicaKey) => void;
  changeHarmonicaType: (type: HarmonicaType) => void;
  startRecording: () => void;
  stopRecording:  () => void;
  pauseRecording: () => void;
  resumeRecording:() => void;
  addTabNote:     (note: Omit<TabNote, 'id'>) => void;
  addTabNotes:    (notes: Omit<TabNote, 'id'>[]) => void;
  reorderNotes:   (notes: TabNote[]) => void;
  deleteNote:     (id: string) => void;
  updateNote:     (id: string, changes: Partial<Pick<TabNote, 'tab' | 'note' | 'start_time' | 'duration'>>) => void;
  updateNotes:    (updates: { id: string; changes: Partial<Pick<TabNote, 'tab' | 'note' | 'start_time' | 'duration'>> }[]) => void;
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

    // Bulk sibling of addTabNote — one pushHistory for the whole batch (duplicate/paste
    // in the piano-roll editor), not one per note, so undoing a multi-note paste is a
    // single Ctrl+Z instead of one per note.
    addTabNotes: (notes) =>
      set((s) => {
        if (s.isPaused || notes.length === 0) return;
        pushHistory(s);
        for (const note of notes) {
          const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          s.tabNotes.push({ ...note, id });
        }
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

    // Bulk sibling of updateNote — one pushHistory for the whole batch (group move/
    // resize, quantize), matching addTabNotes' reasoning above.
    updateNotes: (updates) =>
      set((s) => {
        if (updates.length === 0) return;
        const isNoop = updates.every(({ id, changes }) => {
          const note = s.tabNotes.find((n) => n.id === id);
          if (!note) return true;
          const keys = Object.keys(changes) as (keyof typeof changes)[];
          return keys.every((k) => note[k] === changes[k]);
        });
        if (isNoop) return;
        pushHistory(s);
        for (const { id, changes } of updates) {
          const note = s.tabNotes.find((n) => n.id === id);
          if (note) Object.assign(note, changes);
        }
      }),

    undo: () =>
      set((s) => {
        const prev = s.history.pop();
        if (prev === undefined) return;
        s.future.push({
          tabNotes: s.tabNotes.map((n) => ({ ...n })),
          selectedKey: s.selectedKey,
          harmonicaType: s.harmonicaType,
          bpm: s.bpm,
        });
        s.tabNotes     = prev.tabNotes;
        s.selectedKey  = prev.selectedKey;
        s.harmonicaType = prev.harmonicaType;
        s.bpm           = prev.bpm;
      }),

    redo: () =>
      set((s) => {
        const next = s.future.pop();
        if (next === undefined) return;
        s.history.push({
          tabNotes: s.tabNotes.map((n) => ({ ...n })),
          selectedKey: s.selectedKey,
          harmonicaType: s.harmonicaType,
          bpm: s.bpm,
        });
        s.tabNotes     = next.tabNotes;
        s.selectedKey  = next.selectedKey;
        s.harmonicaType = next.harmonicaType;
        s.bpm           = next.bpm;
      }),

    // Whole-piece transpose via re-keying — every existing tab position is real
    // regardless of key (tab notation is key-independent), so this can never make a
    // note unplayable, unlike changeHarmonicaType below. Only the notes' resolved
    // pitch needs recomputing; `tab` itself never changes.
    transposeToKey: (newKey) =>
      set((s) => {
        if (newKey === s.selectedKey) return;
        pushHistory(s);
        for (const note of s.tabNotes) {
          const resolved = tabToNote(note.tab, newKey, s.harmonicaType);
          if (resolved) note.note = resolved;
        }
        s.selectedKey = newKey;
      }),

    // Unlike transposeToKey, diatonic and chromatic don't share a tab vocabulary, so
    // this re-matches each note's *pitch* against the new type's layout instead of
    // preserving `tab` directly. A note with no match in the new type keeps its pitch
    // but becomes unplayable (tab: '') — the caller (edit.tsx) is expected to have
    // already warned the user about how many notes that'll affect before calling this.
    changeHarmonicaType: (newType) =>
      set((s) => {
        if (newType === s.harmonicaType || !s.selectedKey) return;
        pushHistory(s);
        for (const note of s.tabNotes) {
          const tab = noteToTab(note.note, s.selectedKey, newType);
          note.tab = tab ?? '';
        }
        s.harmonicaType = newType;
      }),

    setExportFormat: (format) =>
      set((s) => { s.exportFormat = format; }),

    // A tempo change re-times the notes to keep their bar/beat position fixed (what
    // "changing the tempo" of a piece of music means) — without this, only the bar
    // ruler's spacing would move while notes stayed pinned to their old absolute
    // millisecond, visibly drifting off the grid.
    setBpm: (bpm) =>
      set((s) => {
        const clamped = Math.max(20, Math.min(400, Math.round(bpm)));
        if (clamped === s.bpm) return;
        pushHistory(s);
        const ratio = s.bpm / clamped;
        for (const note of s.tabNotes) {
          note.start_time = Math.max(0, Math.round(note.start_time * ratio));
          note.duration    = Math.max(1, Math.round(note.duration * ratio));
        }
        s.bpm = clamped;
      }),

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
