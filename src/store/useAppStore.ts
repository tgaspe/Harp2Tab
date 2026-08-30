import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { noteToTab, tabToNote } from '@/audio/HarmonicaMapper';
import { detectTempo } from '@/audio/detectTempo';
import { DEFAULT_BPM } from '@/audio/tempo';
import type { RhythmMode } from '@/notation/scoreDocument';
import type { HarmonicaKey, HarmonicaType, RecordingSource, TabNote, TabRecording, ExportFormat } from '@/types';

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
  /** User-entered name for the in-progress session, editable inline in the editor.
   *  Empty means untitled — save falls back to a timestamp (see saveCurrentSessionToLibrary).
   *  Not undo-tracked: it's metadata, not part of the musical content being edited. */
  recordingTitle:     string;
  /**
   * Noise gate, 0–127 on the same scale as `TabNote.velocity`. Notes quieter than this
   * are hidden from the editor, playback and export.
   *
   * Deliberately **non-destructive**: `tabNotes` always holds every note regardless of this
   * value, and nothing ever writes a filtered array back. That's what lets the slider work
   * in both directions — a gate that deleted on the way up could only ever remove more.
   *
   * Not undo-tracked, for the same reason `viewMode` isn't: it's reversible by its own
   * control, and a slider drag would otherwise flood the 50-entry history. Undo still
   * behaves correctly at any gate position, since history snapshots the full note set.
   */
  noiseGate:          number;
  /**
   * The duration floor in milliseconds — notes shorter than this are hidden from the
   * editor, playback and export.
   *
   * The gate's sibling, and non-destructive on identical terms: `tabNotes` always holds
   * every note, nothing writes a filtered array back, and so this is reversible in both
   * directions. Not undo-tracked, for the reason spelled out on `noiseGate`.
   *
   * The two compose by AND — a note has to clear both to be shown. Kept as two independent
   * values rather than one combined predicate because they answer different questions
   * ("too quiet to matter" vs "too short to be real") and a user reaching for one has no
   * reason to disturb the other.
   */
  durationFloorMs:    number;
  /** Editor's List vs Piano-Roll view — lifted out of edit.tsx's own local state so the
   *  web TopBar (rendered outside the edit screen's tree, in the root layout) can show
   *  and drive the same toggle next to the app title. Not undo-tracked, same reasoning
   *  as recordingTitle. */
  viewMode:           'list' | 'pianoRoll' | 'score';
  /**
   * How fine a rhythm grid the Score view fits the performance to, and whether it prints the
   * tabs under the notes.
   *
   * In the store rather than local to the view because the score *exports* have to come out
   * looking like what the reader was just looking at. A preview that can disagree with the
   * file it produces is the thing this whole phase exists to prevent.
   *
   * Web-only in practice — the Score view is not offered on native — but kept here with the
   * rest of the session's view state rather than in a second store.
   */
  scoreRhythmMode:    RhythmMode;
  scoreShowTabs:      boolean;
  /** How the current session was created. Written into the library entry at save time so
   *  Frame Inspector can explain an empty frame buffer correctly — a MIDI import has no
   *  audio to inspect by nature, not because data was lost. */
  sessionSource:      RecordingSource;
  /** The Studio project/track this session was converted out of, when it was. Carried off
   *  the loaded recording (where `convertTrackToRecording` puts it) so the editor can offer
   *  a way back to the project. Either may dangle — the project can be deleted after the
   *  tab is made — so a lookup miss means "source gone", not an error. Cleared by both
   *  fresh-session actions, or a new recording would inherit the previous one's link. */
  sourceProjectId:    string | null;
  sourceTrackId:      string | null;
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
  translateToKey:      (key: HarmonicaKey) => void;
  changeHarmonicaType: (type: HarmonicaType) => void;
  startRecording: () => void;
  startImportedSession: (title: string | undefined, source: RecordingSource) => void;
  stopRecording:  () => void;
  abortRecording: () => void;
  discardSession: () => void;
  pauseRecording: () => void;
  resumeRecording:() => void;
  addTabNote:     (note: Omit<TabNote, 'id'>) => void;
  addTabNotes:    (notes: Omit<TabNote, 'id'>[]) => void;
  reorderNotes:   (notes: TabNote[]) => void;
  deleteNote:     (id: string) => void;
  /** `velocity` is editable (the Velocity chart's draggable bars); `velocitySource` is not,
   *  since an edit moves a note's value *along* its scale rather than onto a different one. */
  updateNote:     (id: string, changes: Partial<Pick<TabNote, 'tab' | 'note' | 'start_time' | 'duration' | 'velocity'>>) => void;
  updateNotes:    (updates: { id: string; changes: Partial<Pick<TabNote, 'tab' | 'note' | 'start_time' | 'duration' | 'velocity'>> }[]) => void;
  undo:           () => void;
  redo:           () => void;
  setExportFormat:(format: ExportFormat) => void;
  setBpm:              (bpm: number) => void;
  setMetronomeEnabled: (enabled: boolean) => void;
  setRecordingTitle:   (title: string) => void;
  setViewMode:         (mode: 'list' | 'pianoRoll' | 'score') => void;
  setScoreRhythmMode:  (mode: RhythmMode) => void;
  setScoreShowTabs:    (show: boolean) => void;
  setNoiseGate:        (value: number) => void;
  setDurationFloorMs:  (value: number) => void;
  applyDetectedTempo:  (bpm: number, offsetMs: number) => void;
  loadRecording:  (recording: TabRecording) => void;
  commitImportedNotes: (notes: Omit<TabNote, 'id'>[], bpm: number | null) => void;
  reset:          () => void;
}

// Lives in `tempo.ts` alongside the rest of the tempo vocabulary; re-exported here so the
// existing `useAppStore` import path keeps working.
export { DEFAULT_BPM };

const initialState: AppState = {
  harmonicaType:      'diatonic',
  selectedKey:        'C',
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
  recordingTitle:     '',
  viewMode:           'list',
  scoreRhythmMode:    'balanced',
  scoreShowTabs:      true,
  noiseGate:          0,
  durationFloorMs:    0,
  sessionSource:      'recording',
  sourceProjectId:    null,
  sourceTrackId:      null,
};

/**
 * Shared by the manual Detect button and the automatic pass at the end of a take.
 *
 * History is pushed even on the automatic path: an estimate applied without being asked is
 * exactly the case where the user most needs a way back, and undo is a way back they already
 * know about.
 */
function applyTempoEstimate(
  s: Pick<AppState, 'bpm' | 'tabNotes' | 'selectedKey' | 'harmonicaType' | 'history' | 'future'>,
  bpm: number,
  offsetMs: number,
) {
  const clamped = Math.max(20, Math.min(400, Math.round(bpm)));
  if (clamped === s.bpm && offsetMs === 0) return;
  pushHistory(s);
  s.bpm = clamped;
  // `detectTempo` guarantees this can't drive anything below 0; the clamp is a backstop for
  // callers that computed an offset some other way.
  if (offsetMs !== 0) {
    for (const note of s.tabNotes) {
      note.start_time = Math.max(0, Math.round(note.start_time - offsetMs));
    }
  }
}

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
        s.recordingTitle     = '';
        s.sessionSource      = 'recording';
        s.sourceProjectId    = null;
        s.sourceTrackId      = null;
        s.noiseGate          = 0;
        s.durationFloorMs    = 0;
      }),

    // Sibling of startRecording for the file-upload entry points: same fresh-session
    // bookkeeping (new recordingId, cleared notes/history) but `isRecording` stays false,
    // since nothing is being captured — useAudioCapture keys off that flag, and turning it
    // on here would open the mic for a file import. Keeps selectedKey/harmonicaType, which
    // the user picked on Home before choosing the file.
    startImportedSession: (title, source) =>
      set((s) => {
        s.isRecording        = false;
        s.isPaused           = false;
        s.recordingStartTime = Date.now();
        s.recordingId        = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        s.tabNotes           = [];
        s.history            = [];
        s.future             = [];
        s.recordingTitle     = title ?? '';
        s.sessionSource      = source;
        s.sourceProjectId    = null;
        s.sourceTrackId      = null;
        s.noiseGate          = 0;
        s.durationFloorMs    = 0;
      }),

    /**
     * Lands a converted MIDI track in the session `startImportedSession` just opened.
     *
     * Exists because the obvious spelling of it — `setBpm()` then `addTabNotes()` — makes the
     * *import itself* two undoable edits. Both push a snapshot of the session as it was a
     * moment earlier, which is empty, so a user who drew a few notes and pressed Ctrl+Z past
     * them fell straight through into "Nothing to edit yet" with the whole imported tab gone.
     * `useEditHistory`'s own note states the rule for MIDI projects — history must never make
     * Ctrl+Z able to un-import a file — and this is the tab session's side of it.
     *
     * Establishing the session rather than editing it, so it clears history/future outright,
     * exactly as `loadRecording` does for a library entry.
     *
     * `bpm` is assigned, not applied: `setBpm` re-times existing notes to hold their bar
     * positions, which is right for a user turning the dial and wrong here — these notes
     * arrive already carrying the timings the file states, and the tempo is a description of
     * them rather than a change to them. Landing both together is what makes that safe;
     * ordering the two calls was the old way to approximate it.
     */
    commitImportedNotes: (notes, bpm) =>
      set((s) => {
        if (bpm !== null) s.bpm = Math.max(20, Math.min(400, Math.round(bpm)));
        s.tabNotes = notes.map((note) => ({
          ...note,
          id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        }));
        s.history  = [];
        s.future   = [];
      }),

    stopRecording: () =>
      set((s) => {
        s.isRecording = false;
        s.isPaused = false;
        // The take is complete, so this is the first moment its tempo can be read — and the
        // only moment where doing so unasked is clearly right, since `bpm` is still the
        // default nobody chose. Applied at any confidence for the same reason the import path
        // does: the fallback is a constant picked before the user played a note. `pushHistory`
        // inside makes the whole thing one undo away for anyone who disagrees.
        const estimate = detectTempo(s.tabNotes);
        if (estimate) applyTempoEstimate(s, estimate.bpm, estimate.offsetMs);
      }),

    // Close the capture down without interpreting the take. `stopRecording` can't stand in
    // for this: it runs the automatic tempo pass, so aborting through it would leave the
    // *discarded* take's bpm on the session that follows.
    //
    // Notes are left alone deliberately — the capture teardown flushes the note still
    // sounding (useAudioCapture's cleanup) one commit after this, so whoever calls this is
    // expected to clear or replace them afterwards, once that flush has landed.
    abortRecording: () =>
      set((s) => {
        s.isRecording = false;
        s.isPaused    = false;
      }),

    // Abandon the take outright — the counterpart to stopRecording(), which *keeps* what was
    // captured. No tempo estimate and no history entry: there is nothing left to undo back
    // to, and pushing one would make Discard reachable by Ctrl+Z on the next session.
    //
    // Deliberately not `reset()`: selectedKey/harmonicaType/bpm and the rest of the user's
    // setup survive, same reasoning as startNewRecordingSession — discarding a take is not
    // asking to be sent back to key selection.
    discardSession: () =>
      set((s) => {
        s.isRecording        = false;
        s.isPaused           = false;
        s.recordingStartTime = null;
        s.recordingId        = null;
        s.tabNotes           = [];
        s.history            = [];
        s.future             = [];
        s.recordingTitle     = '';
        s.sourceProjectId    = null;
        s.sourceTrackId      = null;
        s.noiseGate          = 0;
        s.durationFloorMs    = 0;
      }),

    pauseRecording: () =>
      set((s) => { s.isPaused = true; }),

    resumeRecording: () =>
      set((s) => { s.isPaused = false; }),

    addTabNote: (note) =>
      set((s) => {
        if (s.isPaused) return;
        // Nothing to undo *to* while a take is being captured: each note here is the session
        // being created, not an edit to one. Snapshotting them buried the editor's real
        // history under one entry per detected note — and the deepest of those restores the
        // empty session the take started from, so holding Ctrl+Z in the editor erased the
        // whole take note by note. The editor's own additions (Add Note, the roll's pencil)
        // come through here too and stay undoable; only live capture is exempt.
        if (!s.isRecording) pushHistory(s);
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
          // An unplayable note (tab: '') has no tab to preserve, so the rule above can't
          // apply to it — `tabToNote('')` is null and it used to be skipped outright,
          // leaving it greyed out on a harp that can in fact reach its pitch. Its pitch is
          // the only thing it has, so that's what carries over: re-fit it against the new
          // key, and let it rejoin the harmonica if the new key reaches it.
          if (note.tab === '') {
            note.tab = noteToTab(note.note, newKey, s.harmonicaType) ?? '';
            continue;
          }
          // A playable note transposes: the tab is what's fixed, and the pitch moves with
          // the harp. That's why a key change can never make a playable note unplayable.
          const resolved = tabToNote(note.tab, newKey, s.harmonicaType);
          if (resolved) note.note = resolved;
        }
        s.selectedKey = newKey;
      }),

    /**
     * The other half of a key change: keep the music, rewrite the tabs.
     *
     * `transposeToKey` above fixes `tab` and lets the pitch move — the same holes on a
     * different harp, which is what physically happens when a player picks up another key.
     * This fixes `note` and lets the tab move: the same music, re-fingered for a harp the
     * player actually owns. Someone with only a C harp who wants a song written for a G
     * comes here.
     *
     * That makes it structurally identical to `changeHarmonicaType` below rather than to
     * its own namesake — pitch is the invariant, tab is derived, and a pitch the target
     * harp can't reach keeps its pitch with `tab: ''` rather than being dropped or snapped
     * to a neighbour. Since both instruments now cover their full span (see getGridRows),
     * that only happens at the range edges: harps of different keys sit at different
     * heights, so a G harp bottoms out ~5 semitones below a C. The caller warns with a
     * count first, exactly as it does for a type change.
     */
    translateToKey: (newKey) =>
      set((s) => {
        if (newKey === s.selectedKey) return;
        pushHistory(s);
        for (const note of s.tabNotes) {
          note.tab = noteToTab(note.note, newKey, s.harmonicaType) ?? '';
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

    /**
     * Move the *grid* onto the music, rather than the music onto the grid.
     *
     * The opposite of `setBpm` above in the one way that matters. `setBpm` re-times every
     * note by the tempo ratio, because a user pressing +5 BPM means "play this tab faster" —
     * the notes keep their bar positions and the milliseconds stretch. Detection means the
     * reverse: the performance's timing is the measured truth and the ruler over it was
     * wrong, so re-timing here would destroy the very evidence the tempo was read from.
     *
     * The offset shift is not re-timing — it's a uniform slide of the whole take against the
     * bar lines, which is the only way to align a grid that is nailed to ms 0.
     */
    applyDetectedTempo: (bpm, offsetMs) =>
      set((s) => { applyTempoEstimate(s, bpm, offsetMs); }),

    setMetronomeEnabled: (enabled) =>
      set((s) => { s.metronomeEnabled = enabled; }),

    setRecordingTitle: (title) =>
      set((s) => { s.recordingTitle = title; }),

    setViewMode: (mode) =>
      set((s) => { s.viewMode = mode; }),

    // Not undo-tracked, for the same reason `viewMode` isn't: they change how the session is
    // drawn, never what it contains. Quantization is derived — see `src/notation/quantize.ts`.
    setScoreRhythmMode: (mode) =>
      set((s) => { s.scoreRhythmMode = mode; }),

    setScoreShowTabs: (show) =>
      set((s) => { s.scoreShowTabs = show; }),

    // No pushHistory: see the field's own note. Clamped rather than trusted, since this is
    // driven by a drag gesture whose pixel→value maths can overshoot at the track's ends.
    setNoiseGate: (value) =>
      set((s) => { s.noiseGate = Math.max(0, Math.min(127, Math.round(value))); }),

    // Clamped low but not high: unlike the gate's fixed 0-127 scale, the duration line's
    // ceiling is the longest note in the session, which changes as notes are edited. The
    // roll clamps the drag to that; storing an unbounded value keeps a floor set against a
    // long note from being silently rewritten when that note is shortened or deleted.
    setDurationFloorMs: (value) =>
      set((s) => { s.durationFloorMs = Math.max(0, Math.round(value)); }),

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
        s.recordingTitle      = recording.title;
        // Legacy entries predate the field; they can only have come from a live recording,
        // since that was the app's one creation path at the time.
        s.sessionSource       = recording.source ?? 'recording';
        s.sourceProjectId     = recording.sourceProjectId ?? null;
        s.sourceTrackId       = recording.sourceTrackId ?? null;
        // Entries saved before the gate existed simply have it off. Because the gate never
        // deleted anything, a recording saved *with* one reopens with every note intact and
        // the slider exactly where it was left.
        s.noiseGate           = recording.noiseGate ?? 0;
        s.durationFloorMs     = recording.durationFloorMs ?? 0;
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
export const selectSourceProjectId = (s: AppState & AppActions) => s.sourceProjectId;
export const selectBpm              = (s: AppState & AppActions) => s.bpm;
export const selectMetronomeEnabled = (s: AppState & AppActions) => s.metronomeEnabled;
export const selectRecordingTitle   = (s: AppState & AppActions) => s.recordingTitle;
export const selectViewMode         = (s: AppState & AppActions) => s.viewMode;
export const selectScoreRhythmMode  = (s: AppState & AppActions) => s.scoreRhythmMode;
export const selectScoreShowTabs    = (s: AppState & AppActions) => s.scoreShowTabs;
export const selectNoiseGate        = (s: AppState & AppActions) => s.noiseGate;
export const selectDurationFloorMs  = (s: AppState & AppActions) => s.durationFloorMs;
