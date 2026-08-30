import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View, type ViewToken } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { TabCard } from '@/components/TabCard';
import { PianoRoll } from '@/components/PianoRoll';
import { NameRecordingModal } from '@/components/NameRecordingModal';
import { RatingModal } from '@/components/RatingModal';
import { ActionSheetModal } from '@/components/ActionSheetModal';
import { KeyGrid } from '@/components/KeyGrid';
import { Divider, IconButton } from '@/components/EditControls';
import { WebTransportBar } from '@/components/TransportBar';
import { createStyles, type EditStyles } from '@/app/editStyles';
import { ExportFormatSections } from '@/components/ExportFormatSections';
import { ScoreView } from '@/components/ScoreView';
import { InstrumentPickerModal } from '@/components/InstrumentPickerModal';
import { TEMPO_CONFIDENCE_GOOD, detectTempo } from '@/audio/detectTempo';
import { useAudibleNotes } from '@/hooks/useAudibleNotes';
import { useTheme } from '@/hooks/useTheme';
import { getPremium } from '@/hooks/usePremium';
import { useAppStore, selectTabNotes, selectKey, selectHarmonicaType, selectCanUndo, selectCanRedo, selectBpm, selectMetronomeEnabled, selectExportFmt, selectRecordingTitle, selectViewMode, selectScoreRhythmMode, selectScoreShowTabs } from '@/store/useAppStore';
import { saveCurrentSessionToLibrary, getDefaultRecordingTitle, startNewRecordingSession } from '@/store/sessionSnapshot';
import { resolveSessionGate } from '@/store/sessionGate';
import { useHeaderActionStore } from '@/store/useHeaderActionStore';
import { useRecordingsStore } from '@/store/useRecordingsStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { AudioImportError } from '@/audio/audioImport';
import { setPendingImport } from '@/audio/pendingImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { pickMidiFile } from '@/audio/pickMidiFile';
import { useRollTransport, formatElapsed } from '@/hooks/useRollTransport';
import { useUndoRedoShortcuts } from '@/hooks/useEditHistory';
import { useSaveShortcut } from '@/hooks/keyboardShortcuts';
import { previewNote, warmSynth } from '@/native/Playback';
import { noteToTab } from '@/audio/HarmonicaMapper';
import { generateForFormat, singlePart } from '@/export/generators';
import { canShareFiles, contentToBlob, exportFileName, triggerWebDownload } from '@/export/webDownload';
import { exportAudio, type AudioExportStage } from '@/export/exportAudio';
import { tabAudioSource } from '@/export/audioSource';
import { DEFAULT_PROGRAM } from '@/audio/timbre';
import { instrumentName } from '@/audio/studioTracks';
import { isAudioFormat, tabExportSections } from '@/export/exportSections';
import { isScoreFormat, DEFAULT_PNG_SCALE, PNG_SCALES, type PngScale, type ScoreExportFormat } from '@/export/scoreFormats';
import { exportScore, printScore } from '@/export/exportScore.web';
import { buildScoreDocument } from '@/notation/quantize';
import { DEFAULT_NEW_NOTE_VELOCITY } from '@/audio/velocity';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote, ExportFormat } from '@/types';

export default function EditScreen() {
  const router       = useRouter();
  const theme        = useTheme();
  const styles       = useMemo(() => createStyles(theme), [theme]);
  const tabNotes       = useAppStore(selectTabNotes);
  // What the editor shows, plays and exports. `tabNotes` above stays the full set and is
  // what every *write* goes through — store mutations are all id-based, so editing works
  // unchanged while notes are hidden.
  const {
    notes: audibleNotes, audibleCount, totalCount,
    gate: noiseGate, supported: noiseGateSupported, source: velocitySource,
    durationFloorMs,
  } = useAudibleNotes();
  const setNoiseGate       = useAppStore((s) => s.setNoiseGate);
  const setDurationFloorMs = useAppStore((s) => s.setDurationFloorMs);
  /** Either line hiding anything. The list view's drag-reorder can't run over a partial
   *  list — see the onDragEnd handler — and it doesn't care which filter made it partial. */
  const anyFilterActive = noiseGate > 0 || durationFloorMs > 0;
  const harmonicaKey   = useAppStore(selectKey);
  const harmonicaType  = useAppStore(selectHarmonicaType);
  const reorderNotes = useAppStore((s) => s.reorderNotes);
  const deleteNote   = useAppStore((s) => s.deleteNote);
  const updateNote   = useAppStore((s) => s.updateNote);
  const addTabNote   = useAppStore((s) => s.addTabNote);
  const canUndo      = useAppStore(selectCanUndo);
  const undo         = useAppStore((s) => s.undo);
  const canRedo      = useAppStore(selectCanRedo);
  const redo         = useAppStore((s) => s.redo);
  const bpm               = useAppStore(selectBpm);
  const setBpm            = useAppStore((s) => s.setBpm);
  const applyDetectedTempo = useAppStore((s) => s.applyDetectedTempo);
  const metronomeEnabled  = useAppStore(selectMetronomeEnabled);
  const setMetronomeEnabled = useAppStore((s) => s.setMetronomeEnabled);
  const recordingTitle    = useAppStore(selectRecordingTitle);
  // Plain (non-undo-tracked) setters — only used to apply the sidebar's New Recording
  // key/type popup choice at the moment we actually navigate away, never while the
  // current session is still on screen (see handleNewRecording below). transposeToKey/
  // changeHarmonicaType (used by KeyTypeControl above) are for the *current* session's
  // notes; these are for priming the *next* one, so no note remapping applies.
  const setKeyForNewSession  = useAppStore((s) => s.selectKey);
  const setTypeForNewSession = useAppStore((s) => s.setHarmonicaType);
  const resetSession     = useAppStore((s) => s.reset);
  const deleteRecording  = useRecordingsStore((s) => s.deleteRecording);
  // Every rule about when playback restarts (seek-while-playing, loop-region start,
  // metronome toggle) lives in the hook, shared with the MIDI Studio — see
  // `useRollTransport`. It owns the loop region too, since all three rules need it.
  const transport = useRollTransport({
    notes: audibleNotes, bpm, metronomeEnabled, setMetronomeEnabled,
  });
  const {
    isPlaying, isPaused, currentTimeMs, totalTimeMs, loopRegion, setLoopRegion,
    onPlayToggle: handlePlayToggle, onSeek: handleSeek, onSkipBar: handleSkipBar,
    onCycleRate: handleCycleRate, onToggleMetronome: handleToggleMetronome,
    onStop: stop, loopEnabled, setLoopEnabled, playbackRate,
  } = transport;

  // Warm the synth on arrival, so the first note click already sounds like a harmonica
  // rather than like the sine that stands in until the soundfont lands. Never rejects; a
  // failure just leaves the oscillator fallback in place.
  useEffect(() => { void warmSynth(); }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [namingAction, setNamingAction] = useState<'save' | 'new' | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  // Only for failures that happen before /import exists (an oversized file rejected at
  // pick time) — everything after that is reported on the import screen itself.
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Collapses the accent sidebar to an icon rail. Session-local rather than persisted:
  // it's a "give me room right now" gesture (the piano roll wants every pixel of width it
  // can get), not a durable preference about how the app should look.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** What the last tempo detection found, shown beside the button until the notes change. */
  const [detectResult, setDetectResult] = useState<string | null>(null);
  // Lives in the shared store (not local state) so the web TopBar — rendered in the
  // root layout, outside this screen's tree — can show and drive the same toggle next
  // to the app title.
  const viewMode    = useAppStore(selectViewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  // Score settings live in the store so the export surface renders what the reader is
  // looking at rather than its own idea of the same session.
  const scoreRhythmMode    = useAppStore(selectScoreRhythmMode);
  const setScoreRhythmMode = useAppStore((s) => s.setScoreRhythmMode);
  const scoreShowTabs      = useAppStore(selectScoreShowTabs);
  const setScoreShowTabs   = useAppStore((s) => s.setScoreShowTabs);
  const listRef      = useRef<FlatList<TabNote>>(null);
  // Web's full editor renders the filtered set; native's compact List currently renders
  // the raw session. Playback following must resolve an id against the exact array handed
  // to the mounted list or a hidden note will shift every index after it.
  const displayedListNotes = Platform.OS === 'web' ? audibleNotes : tabNotes;
  const displayedListNotesRef = useRef(displayedListNotes);
  displayedListNotesRef.current = displayedListNotes;
  const visibleListNoteIdsRef = useRef(new Set<string>());
  const followTargetIdRef = useRef<string | null>(null);
  const followRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDraggingListNote, setIsDraggingListNote] = useState(false);
  const prevLenRef   = useRef(totalCount);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    if (followRetryRef.current) clearTimeout(followRetryRef.current);
  }, []);

  // Deliberately the *total*, not the visible count: this exists to follow a note being
  // added. Keying it off the gated count would make every downward drag of the noise-gate
  // slider look like an insertion and yank the list to the bottom mid-gesture.
  useEffect(() => {
    if (totalCount > prevLenRef.current) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
    prevLenRef.current = totalCount;
  }, [totalCount]);

  // The tab session's history already lives in `useAppStore` (the list view undoes the
  // same edits the roll does); only the bindings are shared with the Studio.
  useUndoRedoShortcuts({ undo, redo });
  // Ctrl/Cmd+S, bound to the same handler as the sidebar's Save button — so it writes the
  // library entry and flashes the same "Saved" confirmation, rather than being a second,
  // quieter way to save that leaves the user unsure whether anything happened.
  useSaveShortcut(handleSaveToLibrary);

  function handleSelect(id: string) {
    setSelectedId((prev) => {
      // Only audition on the select transition, not on deselect — clicking an
      // already-selected note to deselect it shouldn't replay its tone.
      if (prev !== id) {
        const note = audibleNotes.find((n) => n.id === id);
        if (note) previewNote(note.note);
      }
      return prev === id ? null : id;
    });
  }

  // The note whose [start_time, start_time+duration) span currently contains the
  // playhead — cheap O(n) scan, fine at 60fps for a few hundred notes. Only tracked
  // while actually playing (not paused/stopped), matching what a "now playing" border
  // should mean. Deliberately NOT `currentTimeMs` itself in renderItem's deps below:
  // this only changes at note boundaries, so it doesn't force DraggableFlatList to
  // re-render every row on every animation-frame tick.
  const playingNoteId = isPlaying
    ? (audibleNotes.find((n) => currentTimeMs >= n.start_time && currentTimeMs < n.start_time + n.duration)?.id ?? null)
    : null;

  // Kept stable for VirtualizedList: changing a viewability callback after mount is not
  // supported. A ref is enough because visibility only gates an imperative scroll; it is
  // not rendered UI and should not cause another React update.
  const onListViewableItemsChanged = useRef(({
    viewableItems,
  }: { viewableItems: ViewToken<TabNote>[] }) => {
    visibleListNoteIdsRef.current = new Set(
      viewableItems.flatMap((token) => token.item?.id ? [token.item.id] : []),
    );
  }).current;
  const listViewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // `scrollToIndex` can fail when VirtualizedList has not measured a distant card yet.
  // RN 0.83 recommends moving to an estimated offset, allowing that window to render, and
  // retrying. Re-resolving by id prevents an intervening filter/edit from using a stale
  // index; the target ref prevents an old retry from chasing playback after it has moved.
  const handleListScrollToIndexFailed = useCallback((info: {
    index: number;
    highestMeasuredFrameIndex: number;
    averageItemLength: number;
  }) => {
    const targetId = followTargetIdRef.current;
    if (!targetId || !isPlaying || viewMode !== 'list') return;

    listRef.current?.scrollToOffset({
      offset: Math.max(0, info.averageItemLength * info.index),
      animated: true,
    });
    if (followRetryRef.current) clearTimeout(followRetryRef.current);
    followRetryRef.current = setTimeout(() => {
      followRetryRef.current = null;
      if (followTargetIdRef.current !== targetId) return;
      const index = displayedListNotesRef.current.findIndex((note) => note.id === targetId);
      if (index >= 0) {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.35 });
      }
    }, 100);
  }, [isPlaying, viewMode]);

  // A list remounted after Piano Roll has no relationship to the rows that were visible in
  // the previous list instance. Clear the imperative cache before the follow effect runs.
  useEffect(() => {
    visibleListNoteIdsRef.current.clear();
  }, [viewMode]);

  // Follow note boundaries, not animation frames. Rows already comfortably visible stay
  // still; otherwise the active row lands above centre, leaving upcoming notes in view.
  // Seeking and loop restarts naturally use the same path because both change the active id.
  useEffect(() => {
    followTargetIdRef.current = playingNoteId;
    if (followRetryRef.current) {
      clearTimeout(followRetryRef.current);
      followRetryRef.current = null;
    }
    if (!isPlaying || viewMode !== 'list' || isDraggingListNote || !playingNoteId) return;
    if (visibleListNoteIdsRef.current.has(playingNoteId)) return;

    const index = displayedListNotes.findIndex((note) => note.id === playingNoteId);
    if (index < 0) return;
    const frame = requestAnimationFrame(() => {
      if (followTargetIdRef.current !== playingNoteId) return;
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.35 });
    });
    return () => cancelAnimationFrame(frame);
  }, [displayedListNotes, isDraggingListNote, isPlaying, playingNoteId, viewMode]);

  const renderItem = useCallback(
    ({ item, getIndex, drag, isActive }: RenderItemParams<TabNote>) => (
      <ScaleDecorator activeScale={0.96}>
        <TabCard
          note={item}
          index={getIndex() ?? 0}
          harmonicaKey={harmonicaKey ?? undefined}
          harmonicaType={harmonicaType}
          isSelected={selectedId === item.id}
          onSelect={handleSelect}
          onDelete={deleteNote}
          onUpdate={updateNote}
          // Reordering is switched off while either filter hides anything — see the
          // onDragEnd handler below for why it can't be made to work on a partial list.
          draggable={!anyFilterActive}
          drag={drag}
          isActive={isActive}
          isPlayingNow={playingNoteId === item.id}
        />
      </ScaleDecorator>
    ),
    [deleteNote, updateNote, selectedId, playingNoteId, anyFilterActive],
  );

  /**
   * Read the tempo back off the performance.
   *
   * Runs on `audibleNotes`, not the full set: the filters exist to take the tracker's
   * spurious blips off the roll, and those land off-grid by definition — scoring them would
   * pull the confidence down on a take that is perfectly steady.
   *
   * The result is stated rather than applied silently. A tempo change moves every bar line
   * under the user's notes, and a message naming the number is what makes that legible as
   * something that just happened rather than something that broke.
   */
  function handleDetectTempo() {
    const estimate = detectTempo(audibleNotes);
    if (!estimate) {
      setDetectResult('Not enough notes to read a tempo yet.');
      return;
    }
    applyDetectedTempo(estimate.bpm, estimate.offsetMs);
    const feel = estimate.feel === 'triplet' ? ' · shuffle feel, try the 1/8T grid' : '';
    // Named as an estimate when it's a weak one, so a low-confidence guess isn't presented
    // with the same certainty as a solid read of a steady take.
    const hedge = estimate.confidence >= TEMPO_CONFIDENCE_GOOD ? '' : ' (rough — timing is loose)';
    setDetectResult(`${estimate.bpm} BPM${hedge}${feel}`);
  }

  // The message describes a specific set of notes; once those change it's describing
  // something that is no longer on screen.
  useEffect(() => { setDetectResult(null); }, [tabNotes]);

  function handleAddNote() {
    const existing = useAppStore.getState().tabNotes;
    const prev     = existing[existing.length - 1];
    const start    = prev ? prev.start_time + prev.duration : 0;
    // Velocity stated rather than left absent, for the reasons in `DEFAULT_NEW_NOTE_VELOCITY`
    // — and floored at the noise gate so the note can't be added already hidden by it. The
    // pencil tool's click-to-create does exactly the same against its own filter line.
    addTabNote({
      tab: '-1', note: 'D4', start_time: start, duration: 300, confidence: 100,
      velocity: Math.max(DEFAULT_NEW_NOTE_VELOCITY, noiseGate),
    });
    const updated = useAppStore.getState().tabNotes;
    const last    = updated[updated.length - 1];
    if (last) setSelectedId(last.id);
  }

  // "New Recording" means "drop me straight back into recording" — not back to the home
  // screen. Respects the same free-tier gate every other start-a-session entry point does.
  function goToNewRecording() {
    const gate = startNewRecordingSession();
    if (gate === 'showPaywall') { router.push('/paywall'); return; }
    if (gate === 'showRating') { setShowRatingModal(true); return; }
    router.dismissAll();
    router.push('/recording');
  }

  // Nothing to save yet — skip the naming prompt and go straight to recording, matching
  // the old silent behavior (saveCurrentSessionToLibrary was already a no-op for an empty
  // session), just landing on the recording screen instead of home.
  //
  // On web, the chart already has a name — it's typed inline in the toolbar
  // (ChartNameInput/recordingTitle) — so there's nothing left for a naming prompt to ask;
  // native has no such inline field, so it still prompts via NameRecordingModal below.
  // `keyTypeOverride` comes from the sidebar's New Recording key/type popup — applied
  // only right here, after the current session's already been saved under its own
  // key/type and we're actually about to navigate away, so the current view never
  // briefly shows notes under a key they weren't recorded in.
  function handleNewRecording(keyTypeOverride?: { key: HarmonicaKey; type: HarmonicaType }) {
    function applyOverride() {
      if (!keyTypeOverride) return;
      setKeyForNewSession(keyTypeOverride.key);
      setTypeForNewSession(keyTypeOverride.type);
    }
    if (tabNotes.length === 0) {
      applyOverride();
      goToNewRecording();
      return;
    }
    if (Platform.OS === 'web') {
      // Always write a fresh entry — see the comment in handleConfirmNaming's 'new' branch.
      saveCurrentSessionToLibrary(recordingTitle, { asNew: true });
      applyOverride();
      goToNewRecording();
      return;
    }
    setNamingAction('new');
  }

  /**
   * Upload as a *new session* started from the editor — the sibling of New Recording, and
   * gated the same way. The current chart is committed to the library first (this sidebar
   * is web-only and only renders with notes on screen, so there is always something to
   * lose), because /import replaces the session outright.
   *
   * The picker is opened directly from the press, before the save, for two reasons: a
   * browser only allows a file dialog during a real user gesture, and backing out of the
   * dialog then costs nothing — nothing has been saved, gated or navigated.
   */
  async function handleUploadFromEditor(kind: 'audio' | 'midi') {
    const { totalRecordingsUsed, ratingStatus } = useSettingsStore.getState();
    const gate = resolveSessionGate({ isPurchased: getPremium().premium, totalRecordingsUsed, ratingStatus });
    if (gate === 'showRating')  { setShowRatingModal(true); return; }
    if (gate === 'showPaywall') { router.push('/paywall'); return; }

    try {
      const picked = await (kind === 'midi' ? pickMidiFile() : pickAudioFile());
      if (!picked) return; // dismissed — nothing saved, nothing consumed

      // Always a fresh entry, for the same reason handleNewRecording gives: a session
      // reopened from the library would otherwise be overwritten rather than kept.
      if (tabNotes.length > 0) saveCurrentSessionToLibrary(recordingTitle, { asNew: true });

      setPendingImport(picked);
      setUploadError(null);
      router.dismissAll();
      router.push(kind === 'midi' ? { pathname: '/import', params: { kind: 'midi' } } : '/import');
    } catch (err) {
      // Only the pre-read size check can fail this early; everything else surfaces on the
      // import screen, which has room to explain it properly.
      setUploadError(err instanceof AudioImportError ? err.message : "That file couldn't be opened.");
    }
  }

  function handleSaveToLibrary() {
    if (tabNotes.length === 0) return;
    if (Platform.OS === 'web') {
      saveCurrentSessionToLibrary(recordingTitle);
      setJustSaved(true);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = setTimeout(() => setJustSaved(false), 1500);
      return;
    }
    setNamingAction('save');
  }

  function handleConfirmNaming(title: string) {
    if (namingAction === 'new') {
      // Always write a fresh entry — if this session came from reopening an existing
      // recording (loadRecording sets recordingId to that recording's own id), saving
      // without asNew would upsert and silently overwrite it instead of starting new.
      saveCurrentSessionToLibrary(title, { asNew: true });
      setNamingAction(null);
      goToNewRecording();
      return;
    }
    saveCurrentSessionToLibrary(title);
    setJustSaved(true);
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setJustSaved(false), 1500);
    setNamingAction(null);
  }

  /**
   * Throw this tab away and go home.
   *
   * Two states behind one button, because to the user they're one thing ("get rid of this").
   * A tab reached from the library exists as a saved `TabRecording` and has to be deleted
   * from it; a freshly imported or recorded one exists only in `useAppStore` and just needs
   * the session cleared. Resolving against the library rather than tracking a flag matches
   * how `PianoRoll` and Frame Inspector already answer "is this session saved".
   */
  const handleDiscard = useCallback(() => {
    const { recordingId } = useAppStore.getState();
    if (recordingId && useRecordingsStore.getState().recordings.some((r) => r.id === recordingId)) {
      deleteRecording(recordingId);
    }
    // Unconditional: the session is gone either way, and leaving its notes in the store
    // would let the next screen reopen a tab the user just discarded.
    resetSession();
    router.replace('/app');
  }, [deleteRecording, resetSession, router]);

  const setHeaderActions   = useHeaderActionStore((s) => s.setHeaderActions);
  const clearHeaderActions = useHeaderActionStore((s) => s.clearHeaderActionsFor);
  // useFocusEffect for the reason the Studio documents: screens are pushed, not replaced, so
  // this one stays mounted behind /export and /frame-inspector and an unmount cleanup would
  // never run. Registering under '/edit' also means the Studio's own actions can't leak here.
  useFocusEffect(
    useCallback(() => {
      setHeaderActions('/edit', [
        {
          key:      'discard',
          icon:     'trash-outline',
          label:    'Discard',
          onPress:  () => setConfirmingDiscard(true),
          disabled: totalCount === 0,
          variant:  'destructive',
        },
      ]);
      return () => clearHeaderActions('/edit');
    }, [setHeaderActions, clearHeaderActions, totalCount]),
  );

  // Both web view modes now share the one sidebar shell — previously only List did, and
  // Piano Roll carried a separate full-width toolbar, which is how the screen ended up
  // with three stacked menu bars (global TopBar + this toolbar + the piano roll's own
  // tool row). Actions live in the sidebar; the piano roll keeps only its tool row.
  // An empty session still uses the plain centered toolbar+CTA layout below — there's
  // nothing for a sidebar to organize yet.
  // Keyed off the real total, not the visible one: closing the noise gate all the way must
  // not tear down the editor shell and strand the user on an empty screen with no slider to
  // open it back up.
  const showSidebar = Platform.OS === 'web' && totalCount > 0;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Phrased as "discard", not "delete", because for an unsaved import there is nothing
          in the library to delete — but it's equally final either way, so it warns either
          way. `onPress` does the work: the modal fires `onClose` before it, so discarding
          there would also fire on Cancel. */}
      <ActionSheetModal
        visible={confirmingDiscard}
        title={`Discard "${recordingTitle || 'this tab'}"? This can't be undone.`}
        options={[{ label: 'Discard tab', style: 'destructive', onPress: handleDiscard }]}
        onClose={() => setConfirmingDiscard(false)}
      />

      <View style={[styles.container, styles.containerFullWidth]}>

        {showSidebar ? (
          <View style={styles.editShellEdgeWrap}>
            <View style={styles.editShell}>
              <EditSidebar
                // The real total: Save and New act on the whole session, so they must stay
                // enabled even when the gate is hiding every note.
                tabNotesLength={totalCount}
                justSaved={justSaved}
                onSave={handleSaveToLibrary}
                onNew={handleNewRecording}
                onUploadAudio={() => void handleUploadFromEditor('audio')}
                onUploadMidi={() => void handleUploadFromEditor('midi')}
                uploadError={uploadError}
                onInspectFrames={() => router.push('/frame-inspector')}
                canUndo={canUndo}
                onUndo={undo}
                canRedo={canRedo}
                onRedo={redo}
                collapsed={sidebarCollapsed}
                onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
                theme={theme}
                styles={styles}
              />
              <View style={[styles.editMainColumn, viewMode === 'pianoRoll' && styles.editMainColumnFlush]}>
                {/* Piano Roll carries the title inside its own tool row (see headerLeft
                    below); List has no equivalent header of its own, so it keeps the
                    standalone one above the list. */}
                {viewMode === 'list' && <ChartTitle tabNotesLength={audibleCount} theme={theme} styles={styles} />}


                {viewMode === 'list' ? (
                  <DraggableFlatList
                    ref={listRef}
                    data={audibleNotes}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                    onViewableItemsChanged={onListViewableItemsChanged}
                    viewabilityConfig={listViewabilityConfig}
                    onScrollToIndexFailed={handleListScrollToIndexFailed}
                    onDragBegin={() => setIsDraggingListNote(true)}
                    onDragEnd={({ data }) => {
                      setIsDraggingListNote(false);
                      // Refuses to run on a filtered list, and `draggable` above already
                      // keeps it from being reachable — this is the backstop.
                      //
                      // `reorderNotes` replaces the entire array, and this handler also
                      // re-times every note into one contiguous run. Handed a filtered
                      // `data`, it would delete every hidden note *and* collapse the
                      // timeline onto the survivors. It can't be fixed by merging the
                      // hidden notes back in either: contiguous re-timing has no meaning
                      // when some of the run isn't on screen — there's nowhere to put them.
                      if (anyFilterActive) return;
                      let cursor = 0;
                      reorderNotes(data.map(note => {
                        const updated = { ...note, start_time: cursor };
                        cursor += note.duration;
                        return updated;
                      }));
                    }}
                    containerStyle={styles.list}
                    contentContainerStyle={{ paddingBottom: 16 }}
                    showsVerticalScrollIndicator={false}
                    autoscrollThreshold={50}
                    autoscrollSpeed={100}
                    activationDistance={1}
                    ListFooterComponent={
                      <Pressable
                        onPress={handleAddNote}
                        style={({ pressed, hovered }: any) => [
                          styles.addNoteCard,
                          (pressed || hovered) && styles.addNoteCardHovered,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Add Note"
                      >
                        <Ionicons name="add-circle-outline" size={18} color={theme.accent} />
                        <Text style={styles.addNoteCardText}>Add Note</Text>
                      </Pressable>
                    }
                  />
                ) : viewMode === 'score' ? (
                  <ScoreView
                    notes={audibleNotes}
                    harmonicaKey={harmonicaKey}
                    harmonicaType={harmonicaType}
                    bpm={bpm}
                    title={recordingTitle}
                    selectedId={selectedId}
                    onSelect={handleSelect}
                    playingNoteId={playingNoteId}
                    onSeek={handleSeek}
                    theme={theme}
                    rhythmMode={scoreRhythmMode}
                    onRhythmMode={setScoreRhythmMode}
                    showTabs={scoreShowTabs}
                    onShowTabs={setScoreShowTabs}
                  />
                ) : (
                  <PianoRoll
                    notes={audibleNotes}
                    harmonicaKey={harmonicaKey}
                    harmonicaType={harmonicaType}
                    bpm={bpm}
                    selectedId={selectedId}
                    onSelect={handleSelect}
                    onCreate={addTabNote}
                    onUpdate={updateNote}
                    onDelete={deleteNote}
                    isPlaying={isPlaying}
                    currentTimeMs={currentTimeMs}
                    onSeek={handleSeek}
                    loopRegion={loopRegion}
                    onLoopRegionChange={setLoopRegion}
                    headerLeft={<PianoRollHeader tabNotesLength={audibleCount} theme={theme} styles={styles} />}
                    // The draggable line in the data panel's Velocity chart. Omitted when
                    // nothing in the session states a dynamic — a control that provably
                    // cannot do anything at any position is worse than none.
                    //
                    // `allNotes` is the ungated set on purpose: `notes` above is already
                    // filtered, and the chart has to keep drawing what the roll has hidden
                    // so the line has something to be dragged against.
                    velocityFilter={noiseGateSupported ? {
                      value: noiseGate,
                      onChange: setNoiseGate,
                      allNotes: tabNotes,
                      audibleCount,
                      totalCount,
                      source: velocitySource,
                    } : undefined}
                    // Its sibling in the Duration chart, hiding notes shorter than the line —
                    // the tracker's and the neural engine's spurious blips, which the gate
                    // can't reach because a ghost note inside a loud phrase is loud.
                    //
                    // Unconditional, unlike the gate: every note has a duration, so there's
                    // no "nothing to threshold" case to withhold it for. `audibleCount` is
                    // the count after *both* lines, which is what each readout reports.
                    durationFilter={{
                      value: durationFloorMs,
                      onChange: setDurationFloorMs,
                      allNotes: tabNotes,
                      audibleCount,
                      totalCount,
                    }}
                  />
                )}
              </View>
            </View>
          </View>
        ) : Platform.OS === 'web' ? (
          <WebToolbar
            tabNotesLength={tabNotes.length}
            viewMode={viewMode}
            canUndo={canUndo}
            onUndo={undo}
            canRedo={canRedo}
            onRedo={redo}
            justSaved={justSaved}
            onSave={handleSaveToLibrary}
            onInspectFrames={() => router.push('/frame-inspector')}
            onNew={handleNewRecording}
            onAdd={handleAddNote}
            theme={theme}
            styles={styles}
          />
        ) : (
          <>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerTop}>
                <Text style={styles.title}>Edit</Text>
                <View style={styles.headerIcons}>
                  <Pressable
                    onPress={handleSaveToLibrary}
                    disabled={tabNotes.length === 0}
                    style={({ pressed }) => [
                      styles.gearBtn,
                      pressed && tabNotes.length > 0 && { opacity: 0.6 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={justSaved ? 'Saved to recent recordings' : 'Save to recent recordings'}
                    accessibilityState={{ disabled: tabNotes.length === 0 }}
                  >
                    <Ionicons
                      name={justSaved ? 'checkmark-circle' : 'bookmark-outline'}
                      size={26}
                      color={tabNotes.length === 0 ? theme.textMuted : justSaved ? theme.accent : theme.textSub}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => router.push('/frame-inspector')}
                    disabled={tabNotes.length === 0}
                    style={({ pressed }) => [
                      styles.gearBtn,
                      pressed && tabNotes.length > 0 && { opacity: 0.6 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Inspect frames"
                    accessibilityState={{ disabled: tabNotes.length === 0 }}
                  >
                    <Ionicons name="analytics-outline" size={26} color={tabNotes.length === 0 ? theme.textMuted : theme.textSub} />
                  </Pressable>
                  {/* Native gets its own button: TopBar renders null here, so the header
                      action registered above reaches web only. */}
                  <Pressable
                    onPress={() => setConfirmingDiscard(true)}
                    disabled={totalCount === 0}
                    style={({ pressed }) => [
                      styles.gearBtn,
                      pressed && totalCount > 0 && { opacity: 0.6 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Discard this tab"
                    accessibilityState={{ disabled: totalCount === 0 }}
                  >
                    <Ionicons name="trash-outline" size={26} color={totalCount === 0 ? theme.textMuted : theme.record} />
                  </Pressable>
                  <Pressable
                    onPress={() => router.push('/settings')}
                    style={({ pressed }) => [styles.gearBtn, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Open settings"
                  >
                    <Ionicons name="settings-outline" size={28} color={theme.textSub} />
                  </Pressable>
                </View>
              </View>
              <Text style={styles.subtitle}>
                {tabNotes.length} note{tabNotes.length !== 1 ? 's' : ''}
                {tabNotes.length > 0 && viewMode === 'list' ? ' · hold to reorder' : ''}
                {tabNotes.length > 0 && viewMode === 'pianoRoll' ? ' · drag notes to move, edge to resize' : ''}
              </Text>
            </View>

            {/* List / Piano-roll toggle — coexisting alternate views over the same tabNotes,
                not a replacement (some edits, like precise numeric duration, are easier as
                a table than a drag interface). */}
            {tabNotes.length > 0 && (
              <View style={styles.viewModeRow}>
                <Pressable
                  onPress={() => setViewMode('list')}
                  style={[styles.viewModeSeg, viewMode === 'list' && styles.viewModeSegActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: viewMode === 'list' }}
                  accessibilityLabel="List view"
                >
                  <Ionicons name="list-outline" size={15} color={viewMode === 'list' ? '#fff' : theme.textSub} />
                  <Text style={[styles.viewModeText, viewMode === 'list' && styles.viewModeTextActive]}>List</Text>
                </Pressable>
                <Pressable
                  onPress={() => setViewMode('pianoRoll')}
                  style={[styles.viewModeSeg, viewMode === 'pianoRoll' && styles.viewModeSegActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: viewMode === 'pianoRoll' }}
                  accessibilityLabel="Piano roll view"
                >
                  <MaterialCommunityIcons name="piano" size={16} color={viewMode === 'pianoRoll' ? '#fff' : theme.textSub} />
                  <Text style={[styles.viewModeText, viewMode === 'pianoRoll' && styles.viewModeTextActive]}>Piano Roll</Text>
                </Pressable>
              </View>
            )}

            {/* Tempo toolbar — piano-roll only, drives its bar ruler/snap and the metronome
                during playback (metronome/BPM state itself is global since Play is shared). */}
            {tabNotes.length > 0 && viewMode === 'pianoRoll' && (
              <View style={styles.tempoRow}>
                <View style={styles.keyBadge}>
                  <Text style={styles.keyBadgeText}>
                    {harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'} · Key {harmonicaKey}
                  </Text>
                </View>
                <View style={styles.bpmControl}>
                  <Pressable
                    onPress={() => setBpm(bpm - 1)}
                    style={styles.bpmStepBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease tempo"
                  >
                    <Ionicons name="remove" size={14} color={theme.textSub} />
                  </Pressable>
                  <Text style={styles.bpmValue}>{bpm} BPM</Text>
                  <Pressable
                    onPress={() => setBpm(bpm + 1)}
                    style={styles.bpmStepBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Increase tempo"
                  >
                    <Ionicons name="add" size={14} color={theme.textSub} />
                  </Pressable>
                </View>

                {/* Reads the tempo back off the notes, instead of asking the user to find it
                    with the +/- buttons. Note the two do opposite things and both are right:
                    +/- re-times the tab to a tempo you choose, this moves the grid onto a
                    tempo you already played. */}
                <Pressable
                  onPress={handleDetectTempo}
                  style={styles.detectBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Detect tempo from the notes"
                >
                  <Ionicons name="speedometer-outline" size={14} color={theme.textSub} />
                  <Text style={styles.detectBtnText}>Detect</Text>
                </Pressable>

                {detectResult !== null && (
                  <Text style={styles.detectResult} numberOfLines={1}>{detectResult}</Text>
                )}
                <Pressable
                  onPress={handleToggleMetronome}
                  style={[styles.metronomeBtn, metronomeEnabled && styles.metronomeBtnActive]}
                  accessibilityRole="button"
                  accessibilityLabel={metronomeEnabled ? 'Disable metronome' : 'Enable metronome'}
                  accessibilityState={{ selected: metronomeEnabled }}
                >
                  <Ionicons name="musical-notes" size={16} color={metronomeEnabled ? '#fff' : theme.textSub} />
                </Pressable>
              </View>
            )}
          </>
        )}

        {!showSidebar && (
          tabNotes.length === 0 ? (
          Platform.OS === 'web' ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="musical-notes-outline" size={40} color={theme.accent} />
              </View>
              <Text style={styles.emptyTitle}>Nothing to edit yet</Text>
              <Text style={styles.emptyHint}>Record a tab and it will show up here, ready to fine-tune.</Text>
              <Pressable
                onPress={() => handleNewRecording()}
                style={({ pressed, hovered }: any) => [
                  styles.emptyCta,
                  (pressed || hovered) && styles.webBtnHoverFilled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Start a New Recording"
              >
                <Ionicons name="mic-outline" size={16} color="#fff" />
                <Text style={styles.emptyCtaText}>Start a New Recording</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="musical-notes-outline" size={48} color={theme.textMuted} />
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyHint}>Go back and record something first.</Text>
            </View>
          )
        ) : viewMode === 'list' ? (
          <DraggableFlatList
            ref={listRef}
            data={tabNotes}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            onViewableItemsChanged={onListViewableItemsChanged}
            viewabilityConfig={listViewabilityConfig}
            onScrollToIndexFailed={handleListScrollToIndexFailed}
            onDragBegin={() => setIsDraggingListNote(true)}
            onDragEnd={({ data }) => {
              setIsDraggingListNote(false);
              let cursor = 0;
              reorderNotes(data.map(note => {
                const updated = { ...note, start_time: cursor };
                cursor += note.duration;
                return updated;
              }));
            }}
            containerStyle={styles.list}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
            autoscrollThreshold={50}
            autoscrollSpeed={100}
            // Works around a currently-open upstream bug where drag never
            // activates on web (react-native-draggable-flatlist#612) —
            // the library defaults activationDistance to 0, which appears
            // to be part of what's broken under React 19's web gesture path.
            activationDistance={1}
          />
        ) : (
          <View style={styles.pianoRollEdgeWrap}>
            <PianoRoll
              notes={tabNotes}
              harmonicaKey={harmonicaKey}
              harmonicaType={harmonicaType}
              bpm={bpm}
              selectedId={selectedId}
              onSelect={handleSelect}
              onCreate={addTabNote}
              onUpdate={updateNote}
              onDelete={deleteNote}
              isPlaying={isPlaying}
              currentTimeMs={currentTimeMs}
              onSeek={handleSeek}
              loopRegion={loopRegion}
              onLoopRegionChange={setLoopRegion}
            />
          </View>
          )
        )}

        {Platform.OS === 'web' ? (
          <WebTransportBar
          instrumentsLoading={transport.instrumentsLoading}
            // Audible: there is nothing to play when the gate has hidden everything.
            tabNotesLength={audibleCount}
            isPlaying={isPlaying}
            isPaused={isPaused}
            onPlayToggle={handlePlayToggle}
            onStop={stop}
            onSkipBack={() => handleSkipBar(-1)}
            onSkipForward={() => handleSkipBar(1)}
            currentTimeMs={currentTimeMs}
            totalTimeMs={totalTimeMs}
            formatElapsed={formatElapsed}
            loopEnabled={loopEnabled}
            onToggleLoop={() => setLoopEnabled(!loopEnabled)}
            playbackRate={playbackRate}
            onCycleRate={handleCycleRate}
            bpm={bpm}
            setBpm={setBpm}
            metronomeEnabled={metronomeEnabled}
            onToggleMetronome={handleToggleMetronome}
            glued={viewMode === 'pianoRoll' || showSidebar}
            theme={theme}
            styles={styles}
          />
        ) : (
          <>
            {/* Playback */}
            <Pressable
              onPress={handlePlayToggle}
              disabled={tabNotes.length === 0}
              style={({ pressed }) => [
                styles.playBtn,
                tabNotes.length === 0 && styles.btnFilledDisabled,
                pressed && tabNotes.length > 0 && styles.btnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={isPlaying && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Play tab'}
              accessibilityState={{ disabled: tabNotes.length === 0 }}
            >
              <Ionicons
                name={isPlaying && !isPaused ? 'pause' : 'play'}
                size={20}
                color={tabNotes.length === 0 ? theme.textMuted : theme.accent}
              />
              <Text style={[styles.playBtnText, tabNotes.length === 0 && styles.btnTextDisabled]}>
                {isPlaying && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Play Tab'}
              </Text>
              {isPlaying && <Text style={styles.playBtnTime}>{formatElapsed(currentTimeMs)}</Text>}
            </Pressable>

            {/* Bottom actions */}
            <View style={styles.actions}>
              <Pressable
                onPress={undo}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnGhost,
                  !canUndo && styles.btnFilledDisabled,
                  pressed && styles.btnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Undo last action"
                accessibilityState={{ disabled: !canUndo }}
              >
                <Ionicons name="arrow-undo" size={20} color={canUndo ? theme.textSub : theme.textMuted} />
                <Text style={[styles.btnTextGhost, !canUndo && styles.btnTextDisabled]}>Undo</Text>
              </Pressable>

              <Pressable
                onPress={() => handleNewRecording()}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnGhost,
                  pressed && styles.btnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="New Recording"
              >
                <Ionicons name="mic-outline" size={20} color={theme.textSub} />
                <Text style={styles.btnTextGhost}>New</Text>
              </Pressable>

              <Pressable
                onPress={handleAddNote}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnOutlined,
                  pressed && styles.btnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Add Note"
              >
                <Ionicons name="add" size={20} color={theme.accent} />
                <Text style={styles.btnTextOutlined}>Add</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push('/export')}
                disabled={tabNotes.length === 0}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnFilled,
                  tabNotes.length === 0 && styles.btnFilledDisabled,
                  pressed && tabNotes.length > 0 && styles.btnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Go to Export"
                accessibilityState={{ disabled: tabNotes.length === 0 }}
              >
                <Ionicons
                  name="share-outline"
                  size={20}
                  color={tabNotes.length === 0 ? theme.textMuted : '#fff'}
                />
                <Text style={[
                  styles.btnTextFilled,
                  tabNotes.length === 0 && styles.btnTextDisabled,
                ]}>
                  Export
                </Text>
              </Pressable>
            </View>
          </>
        )}

      </View>

      <NameRecordingModal
        visible={namingAction !== null}
        defaultTitle={getDefaultRecordingTitle()}
        onSave={handleConfirmNaming}
        onCancel={() => setNamingAction(null)}
      />

      <RatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onUpgrade={() => router.push('/paywall')}
      />
    </SafeAreaView>
  );
}

// ─── Web-only chrome ────────────────────────────────────────────────────────────
// A real desktop toolbar/transport bar — compact icon buttons grouped into clusters
// with dividers between them, not the mobile-style stacked full-width touch targets
// native still uses.


// The sidebar's KEY & TYPE section: a Transpose/Translate mode toggle, a
// Diatonic/Chromatic toggle, and the same KeyGrid used at onboarding. Self-contained
// (reads key/type/notes straight from the store) so the sidebar doesn't have to thread
// any of it through as props.
//
// The mode decides what a key tap preserves, and the two answers are both correct for
// different players:
//
//   Transpose (transposeToKey) keeps the TABS and lets the music move — the same holes
//   played on a different harp, which is physically what happens when you pick one up.
//   Always safe: tab notation doesn't depend on key, so nothing can become unplayable.
//
//   Translate (translateToKey) keeps the MUSIC and rewrites the tabs — the song as
//   recorded, re-fingered for the harp you actually own. This is the "I only have a C
//   and this song wants a G" path. It can strand notes, because harps of different keys
//   sit at different heights and the piece may run past the new one's range.
//
// Type change (changeHarmonicaType) is pitch-preserving by nature — diatonic and chromatic
// don't share a tab vocabulary, so there's no tab to keep — which makes it the same shape
// as Translate, and it warns the same way.
//
// Both warning paths run the same read-only noteToTab check the store actions use
// internally, and both skip the confirmation entirely when nothing would be lost
// (diatonic → chromatic never loses anything, chromatic being a strict superset).
//
// Mode is deliberately local, session-only state, defaulting to Transpose: it's a
// modifier on the next key tap rather than a property of the instrument, so it shouldn't
// outlive the visit and shouldn't quietly change what a tap does days later.
type KeyChangeMode = 'transpose' | 'translate';

const KEY_MODE_HINT: Record<KeyChangeMode, string> = {
  transpose: 'Same tabs — the music changes key',
  translate: 'Same music — the tabs change',
};

function KeyTypeControl({ styles }: { styles: EditStyles }) {
  const harmonicaKey  = useAppStore(selectKey);
  const harmonicaType = useAppStore(selectHarmonicaType);
  const tabNotes      = useAppStore(selectTabNotes);
  const transposeToKey = useAppStore((s) => s.transposeToKey);
  const translateToKey = useAppStore((s) => s.translateToKey);
  const changeHarmonicaType = useAppStore((s) => s.changeHarmonicaType);

  const [keyMode, setKeyMode] = useState<KeyChangeMode>('transpose');
  // One pending slot for both confirmations — they render the identical sheet and differ
  // only in wording and what they apply.
  const [pending, setPending] = useState<{ title: string; confirmLabel: string; apply: () => void } | null>(null);

  if (!harmonicaKey) return null;

  /** Notes with no position on the given harp — the cost of a pitch-preserving change. */
  function strandedCount(key: HarmonicaKey, type: HarmonicaType): number {
    return tabNotes.filter((n) => noteToTab(n.note, key, type) === null).length;
  }

  function handleSelectKey(key: HarmonicaKey) {
    if (key === harmonicaKey) return;
    if (keyMode === 'transpose') {
      transposeToKey(key);
      return;
    }
    const count = strandedCount(key, harmonicaType);
    if (count === 0) {
      translateToKey(key);
      return;
    }
    setPending({
      title: `Translating to ${key} will leave ${count} note${count !== 1 ? 's' : ''} outside the harmonica’s range`,
      confirmLabel: 'Translate Anyway',
      apply: () => translateToKey(key),
    });
  }

  function handleSelectType(type: HarmonicaType) {
    if (type === harmonicaType) return;
    const count = strandedCount(harmonicaKey!, type);
    if (count === 0) {
      changeHarmonicaType(type);
      return;
    }
    setPending({
      title: `Switching to ${type === 'chromatic' ? 'Chromatic' : 'Diatonic'} will make ${count} note${count !== 1 ? 's' : ''} unplayable`,
      confirmLabel: 'Switch Anyway',
      apply: () => changeHarmonicaType(type),
    });
  }

  return (
    <View style={styles.sidebarPickerPanel}>
      <View style={styles.sidebarTypeToggle}>
        {(['transpose', 'translate'] as const).map((mode) => (
          <Pressable
            key={mode}
            onPress={() => setKeyMode(mode)}
            style={[styles.sidebarTypeSeg, keyMode === mode && styles.sidebarTypeSegActive]}
            accessibilityRole="radio"
            accessibilityState={{ checked: keyMode === mode }}
            accessibilityHint={KEY_MODE_HINT[mode]}
          >
            <Text style={[styles.sidebarTypeText, keyMode === mode && styles.sidebarTypeTextActive]}>
              {mode === 'transpose' ? 'Transpose' : 'Translate'}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* The toggle does nothing on its own — it only changes what the key grid below
          does — so the consequence is spelled out rather than left to the two verbs. */}
      <Text style={styles.sidebarKeyModeHint}>{KEY_MODE_HINT[keyMode]}</Text>

      <View style={styles.sidebarTypeToggle}>
        {(['diatonic', 'chromatic'] as const).map((type) => (
          <Pressable
            key={type}
            onPress={() => handleSelectType(type)}
            style={[styles.sidebarTypeSeg, harmonicaType === type && styles.sidebarTypeSegActive]}
            accessibilityRole="radio"
            accessibilityState={{ checked: harmonicaType === type }}
          >
            <Text style={[styles.sidebarTypeText, harmonicaType === type && styles.sidebarTypeTextActive]}>
              {type === 'diatonic' ? 'Diatonic' : 'Chromatic'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* No `onAccent`. That variant draws cells at `rgba(255,255,255,0.12)` with a white
          label — built for the cyan rail this sidebar used to be, and invisible on the plain
          panel it is now. The default variant is the one Home's rail uses. */}
      <KeyGrid selected={harmonicaKey} onSelect={handleSelectKey} />

      <ActionSheetModal
        visible={pending !== null}
        title={pending?.title}
        options={[{
          label: pending?.confirmLabel ?? 'Continue',
          onPress: () => pending?.apply(),
        }]}
        onClose={() => setPending(null)}
      />
    </View>
  );
}

// Editable chart name, inline in the toolbar — self-contained (reads/writes the store
// directly) so naming happens as you go instead of only being prompted for at save time.
// Empty is a valid state (untitled); the placeholder shows what a save would default to.
// variant='sidebar' is the same field sitting full-width on the list view's sidebar,
// carrying that rail's inset treatment (`bg` on a `railBorder` edge, matching its rows)
// instead of the compact toolbar trigger.
function ChartNameInput({ theme, styles, variant = 'toolbar' }: { theme: Theme; styles: EditStyles; variant?: 'toolbar' | 'sidebar' }) {
  const recordingTitle    = useAppStore(selectRecordingTitle);
  const setRecordingTitle = useAppStore((s) => s.setRecordingTitle);
  return (
    <TextInput
      value={recordingTitle}
      onChangeText={setRecordingTitle}
      placeholder={getDefaultRecordingTitle()}
      placeholderTextColor={variant === 'sidebar' ? 'rgba(255,255,255,0.6)' : theme.textMuted}
      style={variant === 'sidebar' ? styles.chartNameInputSidebar : styles.chartNameInput}
      accessibilityLabel="Chart name"
    />
  );
}

// The chart's identity as the piano roll's own header: editable name + note count, sitting
// at the head of the panel's tool row. The name is accent-colored and toolbar-sized rather
// than page-heading-sized — inside the panel it's a label for what you're editing, not a
// page title, and the accent is what keeps it from reading as one more grey control.
//
// The note count rides along here because it's the same fact about the same object; it
// used to have a whole "CHART" section of sidebar to itself for one short line.
function PianoRollHeader({ tabNotesLength, theme, styles }: {
  tabNotesLength: number; theme: Theme; styles: EditStyles;
}) {
  const recordingTitle    = useAppStore(selectRecordingTitle);
  const setRecordingTitle = useAppStore((s) => s.setRecordingTitle);
  const [hovered, setHovered] = useState(false);
  return (
    <View
      style={styles.pianoRollHeader}
      {...(Platform.OS === 'web'
        ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
        : null)}
    >
      <TextInput
        value={recordingTitle}
        onChangeText={setRecordingTitle}
        placeholder={getDefaultRecordingTitle()}
        placeholderTextColor={theme.textMuted}
        style={[styles.pianoRollTitleInput, hovered && styles.pianoRollTitleInputHovered]}
        accessibilityLabel="Chart name"
      />
      <Text style={styles.pianoRollHeaderMeta} numberOfLines={1}>
        {tabNotesLength} note{tabNotesLength !== 1 ? 's' : ''}
      </Text>
    </View>
  );
}

// The chart's name as an actual page title — centered above the editor, at heading size,
// still directly editable in place (it's the same store field the toolbar version wrote
// to, just presented as the thing it is rather than as one more toolbar input).
function ChartTitle({ tabNotesLength, theme, styles }: { tabNotesLength: number; theme: Theme; styles: EditStyles }) {
  const recordingTitle    = useAppStore(selectRecordingTitle);
  const setRecordingTitle = useAppStore((s) => s.setRecordingTitle);
  // Styled as a heading and centered, this field gives no sign it's editable at all —
  // it reads as the page's static title. Hover paints the input's box in (web only;
  // there's no hover on touch, where the whole screen is tap-to-edit anyway) so the
  // text field underneath becomes visible before you click it.
  const [hovered, setHovered] = useState(false);
  return (
    <View
      style={styles.chartTitleRow}
      {...(Platform.OS === 'web'
        ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
        : null)}
    >
      <TextInput
        value={recordingTitle}
        onChangeText={setRecordingTitle}
        placeholder={getDefaultRecordingTitle()}
        placeholderTextColor={theme.textMuted}
        style={[styles.chartTitleInput, hovered && styles.chartTitleInputHovered]}
        accessibilityLabel="Chart name"
      />
      {/* The note count used to be a whole "CHART" section in the sidebar for one short
          line. Piano Roll shows it beside the title in its own tool row; List shows it
          here, under the title, since it has no header of its own. */}
      <Text style={styles.chartTitleMeta}>
        {tabNotesLength} note{tabNotesLength !== 1 ? 's' : ''}
      </Text>
    </View>
  );
}

// Export as an inline dropdown instead of a separate screen — self-contained like
// KeyTypeControl above. It reads key/type/format from the store and the rendered note set
// through `useAudibleNotes`, matching the separate export screen. Web can always trigger a
// browser download in place; there's no navigation-worthy content on the /export route
// that isn't just "pick a format, then Save or Share" — the full-page version stays for
// native, where Sharing.shareAsync/StorageAccessFramework need their own screen.
function ExportMenu({ theme, styles, variant = 'toolbar', collapsed = false }: { theme: Theme; styles: EditStyles; variant?: 'toolbar' | 'sidebar'; collapsed?: boolean }) {
  const selectedKey     = useAppStore(selectKey);
  // Export is a rendered view of the current chart, not a session backup. Hidden notes
  // remain in the store/library so lowering either floor restores them, but they must not
  // reappear in a file after the editor, playback and note count have excluded them.
  const { notes: tabNotes } = useAudibleNotes();
  const harmonicaType   = useAppStore(selectHarmonicaType);
  const exportFormat    = useAppStore(selectExportFmt);
  const recordingTitle  = useAppStore(selectRecordingTitle);
  const setExportFormat = useAppStore((s) => s.setExportFormat);
  // Notation formats need the session tempo. A tab is milliseconds, so without this the
  // exported score claims a tempo the user never set and its bar lines match nothing they
  // saw in the piano roll.
  const bpm             = useAppStore(selectBpm);
  // The Score view's own settings, read rather than duplicated: the exported sheet music has
  // to be the score the reader was just looking at.
  const scoreRhythmMode = useAppStore(selectScoreRhythmMode);
  const scoreShowTabs   = useAppStore(selectScoreShowTabs);

  const [open, setOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ action: 'share' | 'save'; count: number } | null>(null);
  // Audio selection is local, while the text formats keep writing the store as they always
  // have. Persisting "MP3" as the app-wide export format would change what the native export
  // screen offers to save, and that screen cannot render audio at all.
  const [audioFormat, setAudioFormat] = useState<string | null>(null);
  // Held locally for the same reason `audioFormat` is: persisting "PNG" as the app-wide
  // export format would change what the native export screen offers to save, and native
  // cannot engrave a score at all.
  const [scoreFormat, setScoreFormat] = useState<ScoreExportFormat | null>(null);
  const [pngScale, setPngScale] = useState<PngScale>(DEFAULT_PNG_SCALE);
  const [audioProgram, setAudioProgram] = useState(DEFAULT_PROGRAM);
  const [instrumentPickerOpen, setInstrumentPickerOpen] = useState(false);
  // What the button says while an export runs. Rendering a minute of audio then encoding it
  // is several seconds of work, where every text format was instant.
  const [status, setStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const sections = useMemo(() => tabExportSections(), []);
  const selectedId = audioFormat ?? scoreFormat ?? exportFormat;

  function handleSelectFormat(id: string) {
    setExportError(null);
    if (isAudioFormat(id)) { setAudioFormat(id); setScoreFormat(null); return; }
    if (isScoreFormat(id)) { setScoreFormat(id); setAudioFormat(null); return; }
    setAudioFormat(null);
    setScoreFormat(null);
    setExportFormat(id as ExportFormat);
  }

  const stageLabel = (stage: AudioExportStage, format: string) =>
    stage === 'rendering' ? 'Rendering audio…' : `Encoding ${format}…`;

  /** Render and download audio. Separate from `doSave` because it shares nothing with the
   *  text path beyond the filename — different source, no `content`/`encoding`, and it can
   *  fail in ways the user can act on. */
  async function doSaveAudio(format: string) {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const smf = tabAudioSource(tabNotes, selectedKey, harmonicaType, audioProgram);
      const { blob, ext } = await exportAudio(
        smf, format as 'WAV' | 'MP3' | 'OGG', (stage) => setStatus(stageLabel(stage, format)),
      );
      setStatus('Downloading…');
      triggerWebDownload(blob, exportFileName(recordingTitle, ext));
      setOpen(false);
    } catch (e) {
      // Surfaced in the popup rather than only logged — a silent no-op after a ten-second
      // wait is indistinguishable from the app being broken.
      setExportError(e instanceof Error ? e.message : 'Export failed. Try again.');
    } finally {
      setIsExporting(false);
      setStatus(null);
    }
  }

  /**
   * Engrave and download sheet music.
   *
   * Built from the same `ScoreDocument` the Score view is showing — same rhythm mode, same
   * tab setting — so the file cannot disagree with the preview. PDF is the odd one out and
   * goes through the browser's print dialog rather than producing a file; the format's own
   * description says so, since a button that opens a dialog instead of downloading is
   * otherwise indistinguishable from one that failed.
   */
  async function doSaveScore(format: ScoreExportFormat) {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const doc = buildScoreDocument(
        singlePart(tabNotes, selectedKey, harmonicaType),
        { bpm, beats: 4, beatType: 4, rhythmMode: scoreRhythmMode, title: recordingTitle || undefined },
      );
      const options = {
        showTabs:   scoreShowTabs,
        pageFormat: 'A4_P' as const,
        scale:      pngScale,
        background: '#ffffff',
      };
      const stage = (s: 'engraving' | 'rasterising' | 'packaging') => setStatus(
        s === 'engraving' ? 'Engraving score…'
          : s === 'rasterising' ? 'Rendering image…'
            : 'Preparing print view…',
      );

      if (format === 'PDF') {
        await printScore(doc, options, stage);
        setOpen(false);
        return;
      }

      const files = await exportScore(doc, format, options, stage);
      setStatus('Downloading…');
      for (const file of files) {
        // Page-numbered only when there is more than one, so the common single-page score
        // keeps the plain filename every other export uses.
        const stem = file.page ? `${recordingTitle || 'score'}_p${file.page}` : recordingTitle;
        triggerWebDownload(file.blob, exportFileName(stem, file.ext));
      }
      setOpen(false);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'The score could not be exported.');
    } finally {
      setIsExporting(false);
      setStatus(null);
    }
  }

  // Most desktop browsers expose `navigator.share` but refuse files, which made this
  // dropdown's Share button a second Download button sitting next to the first. Offered
  // only where it genuinely does something else. Fixed for the page's lifetime.
  const canShare = useMemo(() => canShareFiles(), []);

  // Derived from the same array that is handed to every generator. Taking this as a prop
  // allowed callers that legitimately needed the raw session count for Save/Inspect to
  // accidentally keep Export enabled when both filters had hidden the whole chart.
  const disabled = tabNotes.length === 0;

  async function doSave() {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const { content, encoding, ext, mimeType } = generateForFormat(singlePart(tabNotes, selectedKey, harmonicaType), exportFormat, { bpm });
      // Named after the chart, which on web the user typed into the toolbar field.
      triggerWebDownload(contentToBlob(content, encoding, mimeType), exportFileName(recordingTitle, ext));
    } finally {
      setIsExporting(false);
      setOpen(false);
    }
  }

  async function doShare() {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const { content, encoding, ext, mimeType } = generateForFormat(singlePart(tabNotes, selectedKey, harmonicaType), exportFormat, { bpm });
      const filename = exportFileName(recordingTitle, ext);
      const blob = contentToBlob(content, encoding, mimeType);
      // No download fallback: `canShare` gates the button, so getting here means the sheet
      // is really available.
      const file = new File([blob], filename, { type: mimeType });
      try {
        await navigator.share({ files: [file], title: filename });
      } catch (e) {
        // Dismissing the sheet rejects with AbortError — the user saying no, not a failure.
        if ((e as Error)?.name !== 'AbortError') throw e;
      }
    } finally {
      setIsExporting(false);
      setOpen(false);
    }
  }

  // Pre-flight gate — a note with tab: '' has no real position on the current harmonica
  // (see getGridRows/PianoRoll.tsx). Skips the confirm sheet when there's nothing to warn about.
  function handleSave() {
    // The "not playable on this harmonica" warning is about *tab* files, which have no way to
    // write a note with no hole. Rendered audio can play any pitch, so audio skips the sheet.
    if (audioFormat) { doSaveAudio(audioFormat); return; }
    // Sheet music writes real notation for a note with no hole, so it skips the
    // "not playable on this harmonica" sheet exactly as audio does — the warning is about
    // tab files, which have no way to write one.
    if (scoreFormat) { doSaveScore(scoreFormat); return; }
    const count = tabNotes.filter((n) => n.tab === '').length;
    if (count > 0) { setPendingExport({ action: 'save', count }); return; }
    doSave();
  }

  function handleShare() {
    const count = tabNotes.filter((n) => n.tab === '').length;
    if (count > 0) { setPendingExport({ action: 'share', count }); return; }
    doShare();
  }

  const sidebar = variant === 'sidebar';

  // Shared between both variants — only the wrapper around it (anchored dropdown vs.
  // centered modal card) differs.
  const formatAndActions = (
    <>
      <ExportFormatSections
        sections={sections}
        selectedId={selectedId}
        onSelect={handleSelectFormat}
        titleStyle={styles.exportDropdownLabel}
        groupStyle={styles.exportFormatGroup}
      />
      {audioFormat && (
        <>
          <Text style={styles.exportDropdownLabel}>INSTRUMENT</Text>
          <Pressable
            onPress={() => setInstrumentPickerOpen(true)}
            style={({ pressed, hovered }: any) => [
              styles.exportInstrumentRow,
              (pressed || hovered) && styles.exportInstrumentRowActive,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Export instrument, currently ${instrumentName(audioProgram)}`}
          >
            <View style={styles.exportInstrumentCopy}>
              <Text style={styles.exportInstrumentName}>{instrumentName(audioProgram)}</Text>
              <Text style={styles.exportInstrumentHint}>Changes the sound of exported audio only</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
          </Pressable>
          <InstrumentPickerModal
            visible={instrumentPickerOpen}
            selectedProgram={audioProgram}
            onSelect={setAudioProgram}
            onClose={() => setInstrumentPickerOpen(false)}
          />
        </>
      )}
      {scoreFormat === 'PNG' && (
        <>
          <Text style={styles.exportDropdownLabel}>RESOLUTION</Text>
          <View style={styles.exportScaleRow}>
            {PNG_SCALES.map((scale) => (
              <Pressable
                key={scale}
                onPress={() => setPngScale(scale)}
                style={[styles.exportScaleChip, pngScale === scale && styles.exportScaleChipActive]}
                accessibilityRole="radio"
                accessibilityState={{ checked: pngScale === scale }}
                accessibilityLabel={`${scale} times resolution`}
              >
                <Text style={[styles.exportScaleText, pngScale === scale && styles.exportScaleTextActive]}>
                  {scale}x
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {exportError && <Text style={styles.exportDropdownError}>{exportError}</Text>}
      <View style={styles.exportDropdownActions}>
        <Pressable
          onPress={handleSave}
          disabled={isExporting}
          style={({ pressed, hovered }: any) => [
            styles.exportDropdownSaveBtn,
            (pressed || hovered) && !isExporting && styles.webIconBtnHover,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Download to device"
        >
          <Ionicons
            name={scoreFormat === 'PDF' ? 'print-outline' : 'download-outline'}
            size={15}
            color={theme.accent}
          />
          <Text style={styles.exportDropdownSaveBtnText}>
            {status ?? (isExporting ? '…' : scoreFormat === 'PDF' ? 'Print' : 'Download')}
          </Text>
        </Pressable>
        {canShare && !audioFormat && !scoreFormat && (
          <Pressable
            onPress={handleShare}
            disabled={isExporting}
            style={({ pressed, hovered }: any) => [
              styles.exportDropdownShareBtn,
              (pressed || hovered) && !isExporting && styles.webBtnHoverFilled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Share file"
          >
            <Ionicons name="share-outline" size={15} color="#fff" />
            <Text style={styles.exportDropdownShareBtnText}>{isExporting ? 'Exporting…' : 'Share'}</Text>
          </Pressable>
        )}
      </View>
    </>
  );

  const confirmModal = (
    <ActionSheetModal
      visible={pendingExport !== null}
      title={pendingExport ? `${pendingExport.count} note${pendingExport.count !== 1 ? 's' : ''} aren't playable on this harmonica` : undefined}
      options={[{
        label: 'Continue',
        onPress: () => {
          if (pendingExport?.action === 'share') doShare();
          else if (pendingExport?.action === 'save') doSave();
        },
      }]}
      onClose={() => setPendingExport(null)}
    />
  );

  if (sidebar) {
    return (
      <>
        {/* Trigger only — the dialog below is a centered modal either way, so the
            collapsed rail loses the label and nothing else. */}
        <Pressable
          onPress={() => setOpen(true)}
          disabled={disabled}
          style={({ pressed, hovered }: any) => [
            // Accent-filled in both states — collapsing the rail must not demote its one
            // primary action to just another outlined glyph. `sidebarRowPressed` is the
            // outlined rows' hover and would wash the fill out, so this uses its own.
            collapsed ? [styles.sidebarIconBtn, styles.sidebarIconBtnPrimary] : styles.sidebarExportBtn,
            disabled && styles.sidebarRowDisabled,
            (pressed || hovered) && !disabled && styles.sidebarExportBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Export"
          accessibilityState={{ disabled }}
          {...(Platform.OS === 'web' ? ({ title: 'Export' } as any) : null)}
        >
          {/* White on the accent fill. `sidebarRowDisabled`'s opacity does the dimming, so
              the disabled state doesn't need a second, paler white on top of it. */}
          <Ionicons name="share-outline" size={collapsed ? 18 : 16} color="#fff" />
          {!collapsed && <Text style={styles.sidebarExportText}>Export</Text>}
        </Pressable>

        {/* Centered modal, same reasoning as the New Recording key/type picker —
            exporting is a deliberate "finish" action, not a quick inline tweak. */}
        <Modal
          visible={open && !disabled}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setOpen(false)}
        >
          <Pressable style={styles.newRecordingBackdrop} onPress={() => setOpen(false)}>
            <Pressable style={styles.newRecordingCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.newRecordingTitle}>Export</Text>
              {formatAndActions}
              <Pressable
                onPress={() => setOpen(false)}
                style={({ pressed }: any) => [styles.newRecordingCancel, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.newRecordingCancelText}>Cancel</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

        {confirmModal}
      </>
    );
  }

  return (
    <View style={styles.exportAnchor}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        disabled={disabled}
        style={({ pressed, hovered }: any) => [
          styles.exportBtn,
          disabled && styles.webBtnDisabled,
          (pressed || hovered) && !disabled && styles.webBtnHoverFilled,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Export"
        accessibilityState={{ disabled }}
      >
        <Ionicons name="share-outline" size={14} color={disabled ? theme.textMuted : '#fff'} />
        <Text style={[styles.exportBtnText, disabled && { color: theme.textMuted }]}>Export</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={11} color={disabled ? theme.textMuted : '#fff'} />
      </Pressable>

      {open && !disabled && (
        <View style={styles.exportDropdown}>
          {formatAndActions}
        </View>
      )}

      {confirmModal}
    </View>
  );
}

// One sidebar action, in whichever shape the rail is currently in: a labelled full-width
// row when expanded, a bare square icon button when collapsed. Both are the same control
// with the same handler — collapsing drops the text, not the capability.
//
// `title` is passed straight through to the DOM on web for a native hover tooltip, since
// the collapsed rail is a ScrollView and anything absolutely positioned beside a button
// would be clipped by its overflow. Harmless if react-native-web declines to forward it;
// accessibilityLabel is what actually carries the name.
function SidebarAction({
  icon, label, onPress, disabled = false, collapsed, badge, styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  collapsed: boolean;
  /** Trailing tag on the expanded row (e.g. "Soon"); dropped when collapsed. */
  badge?: string;
  styles: EditStyles;
}) {
  // The rail is a plain panel now, so its glyphs are theme colours rather than white. Read
  // here rather than threaded down beside `styles` — this is a component, and one hook is
  // cheaper than a prop on every call site.
  const theme = useTheme();
  const webTitle = Platform.OS === 'web' ? ({ title: badge ? `${label} — ${badge}` : label } as any) : null;

  if (collapsed) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed, hovered }: any) => [
          styles.sidebarIconBtn,
          disabled && styles.sidebarRowDisabled,
          (pressed || hovered) && !disabled && styles.sidebarRowPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={badge ? `${label} — ${badge}` : label}
        accessibilityState={{ disabled }}
        {...webTitle}
      >
        <Ionicons name={icon} size={18} color={theme.textSub} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed, hovered }: any) => [
        styles.sidebarRow,
        disabled && styles.sidebarRowDisabled,
        (pressed || hovered) && !disabled && styles.sidebarRowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label} — ${badge}` : label}
      accessibilityState={{ disabled }}
    >
      <View style={styles.sidebarRowIconWrap}>
        <Ionicons name={icon} size={16} color={theme.textSub} />
      </View>
      <Text style={styles.sidebarRowText}>{label}</Text>
      {badge !== undefined && <Text style={styles.sidebarComingSoon}>{badge}</Text>}
    </Pressable>
  );
}

// Stand-in for the full key/type picker on the collapsed rail — the KeyGrid needs real
// width, so the rail shows just the current key and expands the sidebar when tapped
// rather than trying to cram a 12-cell grid into 40px.
function SidebarKeyBadge({ onPress, styles }: { onPress: () => void; styles: EditStyles }) {
  const harmonicaKey  = useAppStore(selectKey);
  const harmonicaType = useAppStore(selectHarmonicaType);
  if (!harmonicaKey) return null;
  const label = `Key ${harmonicaKey}, ${harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'} — expand to change`;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        styles.sidebarIconBtn,
        (pressed || hovered) && styles.sidebarRowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(Platform.OS === 'web' ? ({ title: label } as any) : null)}
    >
      <Text style={styles.sidebarKeyBadgeText}>{harmonicaKey}</Text>
    </Pressable>
  );
}

// The editor's left rail — mirrors the Home screen's sidebar (full-height, accent-filled,
// plain rows with no card chrome). Collapses to an icon-only rail: the piano roll is a
// horizontal medium and 280px of chrome is 280px of chart it doesn't get.
function EditSidebar({
  tabNotesLength, justSaved, onSave, onNew, onUploadAudio, onUploadMidi, uploadError,
  onInspectFrames, canUndo, onUndo, canRedo, onRedo,
  collapsed, onToggleCollapsed, theme, styles,
}: {
  tabNotesLength: number;
  justSaved: boolean;
  onSave: () => void;
  onNew: (keyType: { key: HarmonicaKey; type: HarmonicaType }) => void;
  onUploadAudio: () => void;
  onUploadMidi: () => void;
  /** Pick-time failure (an oversized file), shown here since /import never opened. */
  uploadError: string | null;
  onInspectFrames: () => void;
  canUndo: boolean;
  onUndo: () => void;
  canRedo: boolean;
  onRedo: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  theme: Theme;
  styles: EditStyles;
}) {
  // Priming key/type for the *next* recording, not the one currently open — local,
  // plain state (not the store's transposeToKey/changeHarmonicaType, and deliberately
  // not the store's raw selectedKey/harmonicaType either) so opening this popup and
  // poking around never touches what's currently on screen. Only committed to the
  // store at the moment New Recording is actually pressed (see handleNewRecording).
  const currentKey  = useAppStore(selectKey);
  const currentType = useAppStore(selectHarmonicaType);
  const [newPickerOpen, setNewPickerOpen] = useState(false);
  const [pendingKey, setPendingKey]   = useState<HarmonicaKey>(currentKey ?? 'C');
  const [pendingType, setPendingType] = useState<HarmonicaType>(currentType);

  function toggleNewPicker() {
    if (!newPickerOpen) {
      setPendingKey(currentKey ?? 'C');
      setPendingType(currentType);
    }
    setNewPickerOpen((v) => !v);
  }

  function confirmNewRecording() {
    setNewPickerOpen(false);
    onNew({ key: pendingKey, type: pendingType });
  }

  return (
    // Scrollable, not a plain View: the ACTIONS list is taller than the sidebar on a
    // laptop-height window, and a fixed View silently cut it off — Export ended up
    // half-visible at the bottom edge and Undo/Redo were unreachable entirely.
    <ScrollView
      style={[styles.editSidebar, collapsed && styles.editSidebarCollapsed]}
      contentContainerStyle={[styles.editSidebarContent, collapsed && styles.editSidebarContentCollapsed]}
      showsVerticalScrollIndicator={Platform.OS === 'web'}
    >
      {/* Collapse toggle. Sits at the top of the rail in both states so it doesn't move
          when the rail changes width — the one control you need to find again. */}
      <Pressable
        onPress={onToggleCollapsed}
        style={({ pressed, hovered }: any) => [
          collapsed ? styles.sidebarIconBtn : styles.sidebarCollapseRow,
          (pressed || hovered) && styles.sidebarRowPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar to icons'}
        {...(Platform.OS === 'web' ? ({ title: collapsed ? 'Expand sidebar' : 'Collapse sidebar' } as any) : null)}
      >
        <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-back'} size={16} color={theme.textSub} />
        {!collapsed && <Text style={styles.sidebarCollapseText}>Collapse</Text>}
      </Pressable>

      <View style={styles.sidebarDivider} />

      {collapsed ? (
        <SidebarKeyBadge onPress={onToggleCollapsed} styles={styles} />
      ) : (
        <View style={styles.sidebarSection}>
          <Text style={styles.sidebarSectionLabel}>KEY & TYPE</Text>
          <KeyTypeControl styles={styles} />
        </View>
      )}

      <View style={styles.sidebarDivider} />

      <View style={[styles.sidebarSection, collapsed && styles.sidebarSectionCollapsed]}>
        {!collapsed && <Text style={styles.sidebarSectionLabel}>ACTIONS</Text>}

        <SidebarAction
          icon="cloud-upload-outline"
          label="Upload Audio"
          onPress={onUploadAudio}
          collapsed={collapsed}
          styles={styles}
        />

        <SidebarAction
          icon="musical-note-outline"
          label="Upload MIDI"
          onPress={onUploadMidi}
          collapsed={collapsed}
          styles={styles}
        />

        {/* Dropped when collapsed — the rail has no room for a sentence, and the same
            message reappears the moment the sidebar is expanded again. */}
        {!!uploadError && !collapsed && (
          <View style={styles.sidebarUploadError} accessibilityRole="alert">
            <Ionicons name="alert-circle-outline" size={13} color={theme.warning} />
            <Text style={styles.sidebarUploadErrorText}>{uploadError}</Text>
          </View>
        )}

        <SidebarAction
          icon="mic-outline"
          label="New Recording"
          onPress={toggleNewPicker}
          collapsed={collapsed}
          styles={styles}
        />

        <SidebarAction
          icon={justSaved ? 'checkmark-circle' : 'bookmark-outline'}
          label={justSaved ? 'Saved' : 'Save'}
          onPress={onSave}
          disabled={tabNotesLength === 0}
          collapsed={collapsed}
          styles={styles}
        />

        <Modal
          visible={newPickerOpen}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setNewPickerOpen(false)}
        >
          {/* No accessibilityRole="button" on these two wrappers — that's what makes
              react-native-web render a real <button>, and nesting one inside another
              (the option rows below do need the role) is invalid HTML. Same pattern as
              ActionSheetModal. */}
          <Pressable style={styles.newRecordingBackdrop} onPress={() => setNewPickerOpen(false)}>
            <Pressable style={styles.newRecordingCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.newRecordingTitle}>New Recording</Text>
              <Text style={styles.sidebarPopoverLabel}>KEY & TYPE</Text>
              <View style={styles.keyDropdownTypeToggle}>
                {(['diatonic', 'chromatic'] as const).map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setPendingType(type)}
                    style={[styles.keyDropdownTypeSeg, pendingType === type && styles.keyDropdownTypeSegActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: pendingType === type }}
                  >
                    <Text style={[styles.keyDropdownTypeText, pendingType === type && styles.keyDropdownTypeTextActive]}>
                      {type === 'diatonic' ? 'Diatonic' : 'Chromatic'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.keyDropdownDivider} />
              <KeyGrid selected={pendingKey} onSelect={setPendingKey} />
              <Pressable
                onPress={confirmNewRecording}
                style={({ pressed, hovered }: any) => [
                  styles.sidebarPopoverConfirm,
                  (pressed || hovered) && styles.sidebarPopoverConfirmHover,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Start new recording — ${pendingType === 'chromatic' ? '12-Chromatic' : 'Diatonic'}, Key ${pendingKey}`}
              >
                <Ionicons name="mic-outline" size={14} color="#fff" />
                <Text style={styles.sidebarPopoverConfirmText}>Start New Recording</Text>
              </Pressable>
              <Pressable
                onPress={() => setNewPickerOpen(false)}
                style={({ pressed }: any) => [styles.newRecordingCancel, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.newRecordingCancelText}>Cancel</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

        <SidebarAction
          icon="analytics-outline"
          label="Inspect Frames"
          onPress={onInspectFrames}
          disabled={tabNotesLength === 0}
          collapsed={collapsed}
          styles={styles}
        />

        <ExportMenu
          collapsed={collapsed}
          theme={theme}
          styles={styles}
          variant="sidebar"
        />

        {collapsed ? (
          <>
            <SidebarAction
              icon="arrow-undo"
              label="Undo"
              onPress={onUndo}
              disabled={!canUndo}
              collapsed
              styles={styles}
            />
            <SidebarAction
              icon="arrow-redo"
              label="Redo"
              onPress={onRedo}
              disabled={!canRedo}
              collapsed
              styles={styles}
            />
          </>
        ) : (
        <View style={styles.sidebarRowSplit}>
          <Pressable
            onPress={onUndo}
            disabled={!canUndo}
            style={({ pressed, hovered }: any) => [
              styles.sidebarRow,
              styles.sidebarRowHalf,
              !canUndo && styles.sidebarRowDisabled,
              (pressed || hovered) && canUndo && styles.sidebarRowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Undo last action"
            accessibilityState={{ disabled: !canUndo }}
          >
            <Ionicons name="arrow-undo" size={16} color={theme.textSub} />
            <Text style={styles.sidebarRowHalfText}>Undo</Text>
          </Pressable>
          <Pressable
            onPress={onRedo}
            disabled={!canRedo}
            style={({ pressed, hovered }: any) => [
              styles.sidebarRow,
              styles.sidebarRowHalf,
              !canRedo && styles.sidebarRowDisabled,
              (pressed || hovered) && canRedo && styles.sidebarRowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Redo"
            accessibilityState={{ disabled: !canRedo }}
          >
            <Ionicons name="arrow-redo" size={16} color={theme.textSub} />
            <Text style={styles.sidebarRowHalfText}>Redo</Text>
          </Pressable>
        </View>
        )}
      </View>
    </ScrollView>
  );
}

function WebToolbar({
  tabNotesLength, viewMode,
  canUndo, onUndo, canRedo, onRedo, justSaved, onSave, onInspectFrames, onNew, onAdd, theme, styles,
}: {
  tabNotesLength: number;
  viewMode: 'list' | 'pianoRoll' | 'score';
  canUndo: boolean;
  onUndo: () => void;
  canRedo: boolean;
  onRedo: () => void;
  justSaved: boolean;
  onSave: () => void;
  onInspectFrames: () => void;
  onNew: () => void;
  onAdd: () => void;
  theme: Theme;
  styles: EditStyles;
}) {
  return (
    <View style={[styles.webToolbar, viewMode === 'pianoRoll' && styles.webToolbarGlued]}>
      {/* View + Project cluster — the List/Piano-Roll toggle itself now lives in the
          global TopBar next to the app title, since it needs to be visible/drivable
          from outside this screen too. */}
      <View style={styles.webToolbarGroup}>
        {tabNotesLength > 0 && (
          <>
            <ChartNameInput theme={theme} styles={styles} />
            <Divider styles={styles} />
            <Text style={styles.webNoteCount}>{tabNotesLength} note{tabNotesLength !== 1 ? 's' : ''}</Text>
          </>
        )}
      </View>

      {/* Edit + Actions + Export cluster */}
      <View style={styles.webToolbarGroup}>
        <IconButton icon="arrow-undo" label="Undo" onPress={onUndo} disabled={!canUndo} theme={theme} styles={styles} />
        <IconButton icon="arrow-redo" label="Redo" onPress={onRedo} disabled={!canRedo} theme={theme} styles={styles} />

        <Divider styles={styles} />

        <Pressable
          onPress={onNew}
          style={({ pressed, hovered }: any) => [styles.newBtn, (pressed || hovered) && styles.webIconBtnHover]}
          accessibilityRole="button"
          accessibilityLabel="Start a new recording"
        >
          <Ionicons name="mic-outline" size={14} color={theme.textSub} />
          <Text style={styles.newBtnText}>New</Text>
        </Pressable>
        {/* Add Note only makes sense in list view — the piano roll already lets you
            draw a note anywhere with a click, so a "+" here would just be redundant. */}
        {viewMode === 'list' && (
          <IconButton icon="add" label="Add Note" onPress={onAdd} theme={theme} styles={styles} />
        )}
        <Pressable
          onPress={onSave}
          disabled={tabNotesLength === 0}
          style={({ pressed, hovered }: any) => [
            styles.newBtn,
            justSaved && styles.webIconBtnActive,
            tabNotesLength === 0 && styles.webBtnDisabled,
            (pressed || hovered) && tabNotesLength > 0 && !justSaved && styles.webIconBtnHover,
          ]}
          accessibilityRole="button"
          accessibilityLabel={justSaved ? 'Saved to recent recordings' : 'Save to recent recordings'}
          accessibilityState={{ disabled: tabNotesLength === 0 }}
        >
          <Ionicons
            name={justSaved ? 'checkmark-circle' : 'save-outline'}
            size={14}
            color={tabNotesLength === 0 ? theme.textMuted : justSaved ? '#fff' : theme.textSub}
          />
          <Text style={[
            styles.newBtnText,
            justSaved && { color: '#fff' },
            tabNotesLength === 0 && { color: theme.textMuted },
          ]}>
            {justSaved ? 'Saved' : 'Save'}
          </Text>
        </Pressable>
        <IconButton
          icon="analytics-outline"
          label="Inspect Frames"
          onPress={onInspectFrames}
          disabled={tabNotesLength === 0}
          theme={theme}
          styles={styles}
        />

        <Divider styles={styles} />

        {/* The one labeled, filled button in the toolbar — Export is the "finish" action,
            everything else here is a neutral, icon-only utility. Opens inline instead of
            navigating to a separate page — on web there's no reason to leave the editor
            just to pick a format and download. */}
        <ExportMenu theme={theme} styles={styles} />
      </View>
    </View>
  );
}
