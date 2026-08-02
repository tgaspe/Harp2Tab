import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
import { ExportOption } from '@/components/ExportOption';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, selectTabNotes, selectKey, selectHarmonicaType, selectCanUndo, selectCanRedo, selectBpm, selectMetronomeEnabled, selectExportFmt, selectRecordingTitle, selectViewMode } from '@/store/useAppStore';
import { saveCurrentSessionToLibrary, getDefaultRecordingTitle, startNewRecordingSession } from '@/store/sessionSnapshot';
import { resolveSessionGate } from '@/store/sessionGate';
import { useSettingsStore } from '@/store/useSettingsStore';
import { AudioImportError } from '@/audio/audioImport';
import { setPendingImport } from '@/audio/pendingImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { pickMidiFile } from '@/audio/pickMidiFile';
import { usePlayback } from '@/hooks/usePlayback';
import { previewNote } from '@/native/Playback';
import { noteToTab } from '@/audio/HarmonicaMapper';
import { PLAYBACK_RATES, barDurationMs } from '@/audio/tempo';
import { generateForFormat, singlePart } from '@/export/generators';
import { contentToBlob, triggerWebDownload } from '@/export/webDownload';
import { FONT, EXPORT_FORMATS } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote, ExportFormat } from '@/types';

// Collapsed sidebar geometry — one square button plus its 12px gutters.
const SIDEBAR_ICON_BTN = 40;
const SIDEBAR_RAIL_W   = SIDEBAR_ICON_BTN + 24;

export default function EditScreen() {
  const router       = useRouter();
  const theme        = useTheme();
  const styles       = useMemo(() => createStyles(theme), [theme]);
  const tabNotes       = useAppStore(selectTabNotes);
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
  const {
    isPlaying, isPaused, currentTimeMs, play, pause, resume, stop, seek,
    loopEnabled, setLoopEnabled, playbackRate, setPlaybackRate,
  } = usePlayback();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [namingAction, setNamingAction] = useState<'save' | 'new' | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  // Only for failures that happen before /import exists (an oversized file rejected at
  // pick time) — everything after that is reported on the import screen itself.
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Collapses the accent sidebar to an icon rail. Session-local rather than persisted:
  // it's a "give me room right now" gesture (the piano roll wants every pixel of width it
  // can get), not a durable preference about how the app should look.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Lives in the shared store (not local state) so the web TopBar — rendered in the
  // root layout, outside this screen's tree — can show and drive the same toggle next
  // to the app title.
  const viewMode    = useAppStore(selectViewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  // A/B loop region marked on the piano-roll ruler — when set, it takes priority over
  // the plain whole-recording loopEnabled toggle (see handlePlayToggle/handleSeek below
  // and usePlayback's loopBounds handling).
  const [loopRegion, setLoopRegion] = useState<{ startMs: number; endMs: number } | null>(null);
  const listRef      = useRef<FlatList<TabNote>>(null);
  const prevLenRef   = useRef(tabNotes.length);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (tabNotes.length > prevLenRef.current) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
    prevLenRef.current = tabNotes.length;
  }, [tabNotes.length]);

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Y redo — screen-level (not scoped to the piano-roll editor
  // like its own Delete/arrow-key shortcuts) since undo/redo apply to the list view too.
  // Skips text inputs (e.g. the rename modal) so the browser's native field-undo still
  // works there instead of being hijacked by the tab-level history.
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    function isTextInput(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || isTextInput(e.target)) return;
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        redo();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  function handleSelect(id: string) {
    setSelectedId((prev) => {
      // Only audition on the select transition, not on deselect — clicking an
      // already-selected note to deselect it shouldn't replay its tone.
      if (prev !== id) {
        const note = tabNotes.find((n) => n.id === id);
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
    ? (tabNotes.find((n) => currentTimeMs >= n.start_time && currentTimeMs < n.start_time + n.duration)?.id ?? null)
    : null;

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
          draggable
          drag={drag}
          isActive={isActive}
          isPlayingNow={playingNoteId === item.id}
        />
      </ScaleDecorator>
    ),
    [deleteNote, updateNote, selectedId, playingNoteId],
  );

  function handleAddNote() {
    const existing = useAppStore.getState().tabNotes;
    const prev     = existing[existing.length - 1];
    const start    = prev ? prev.start_time + prev.duration : 0;
    addTabNote({ tab: '-1', note: 'D4', start_time: start, duration: 300, confidence: 100 });
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
    const { isPurchased, totalRecordingsUsed, ratingStatus } = useSettingsStore.getState();
    const gate = resolveSessionGate({ isPurchased, totalRecordingsUsed, ratingStatus });
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

  function handlePlayToggle() {
    if (!isPlaying) {
      // A loop region always starts playback from its own top, not wherever the
      // playhead happens to be — simpler and more predictable than trying to handle
      // "playhead is currently outside the region" as a separate case.
      const startAt = loopRegion ? loopRegion.startMs : currentTimeMs;
      play(tabNotes, { bpm, metronomeEnabled, rate: playbackRate }, startAt, loopRegion ?? undefined);
      return;
    }
    if (isPaused) { resume(); return; }
    pause();
  }

  // While actively playing, restart playback from the new spot (a plain seek() no-ops
  // there — see usePlayback). While stopped OR paused, seek() alone is right: stopped, it's
  // a plain visual move; paused, it moves the marker but deliberately stays paused rather
  // than resuming audio — resume() picks up the new position next time it's pressed.
  function handleSeek(ms: number) {
    if (isPlaying && !isPaused) {
      play(tabNotes, { bpm, metronomeEnabled, rate: playbackRate }, ms, loopRegion ?? undefined);
      return;
    }
    seek(ms);
  }

  function handleCycleRate() {
    const i = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number]);
    setPlaybackRate(PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length]);
  }

  // Jumps the playhead a full bar at a time — works whether stopped, paused, or mid-
  // playback (handleSeek already restarts playback from the new spot when needed).
  function handleSkipBar(direction: 1 | -1) {
    const barMs = barDurationMs(bpm);
    const target = Math.max(0, Math.min(totalTimeMs, currentTimeMs + direction * barMs));
    handleSeek(target);
  }

  // The metronome click track is baked into the audio graph at play()-time (see
  // Playback.web.ts's scheduleMetronome) — flipping the store flag alone doesn't touch
  // whatever's already scheduled. Mid-playback, restart from the current spot with the
  // new setting so the click track actually starts/stops, same trick handleSeek uses for
  // repositioning live.
  function handleToggleMetronome() {
    const next = !metronomeEnabled;
    setMetronomeEnabled(next);
    if (isPlaying && !isPaused) {
      play(tabNotes, { bpm, metronomeEnabled: next, rate: playbackRate }, currentTimeMs, loopRegion ?? undefined);
    }
  }

  function formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const totalTimeMs = tabNotes.length
    ? tabNotes.reduce((max, n) => Math.max(max, n.start_time + n.duration), 0)
    : 0;

  // Both web view modes now share the one sidebar shell — previously only List did, and
  // Piano Roll carried a separate full-width toolbar, which is how the screen ended up
  // with three stacked menu bars (global TopBar + this toolbar + the piano roll's own
  // tool row). Actions live in the sidebar; the piano roll keeps only its tool row.
  // An empty session still uses the plain centered toolbar+CTA layout below — there's
  // nothing for a sidebar to organize yet.
  const showSidebar = Platform.OS === 'web' && tabNotes.length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.container, styles.containerFullWidth]}>

        {showSidebar ? (
          <View style={styles.editShellEdgeWrap}>
            <View style={styles.editShell}>
              <EditSidebar
                tabNotesLength={tabNotes.length}
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
                {viewMode === 'list' && <ChartTitle tabNotesLength={tabNotes.length} theme={theme} styles={styles} />}

                {viewMode === 'list' ? (
                  <DraggableFlatList
                    ref={listRef}
                    data={tabNotes}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                    onDragEnd={({ data }) => {
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
                ) : (
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
                    headerLeft={<PianoRollHeader tabNotesLength={tabNotes.length} theme={theme} styles={styles} />}
                  />
                )}
              </View>
            </View>
          </View>
        ) : Platform.OS === 'web' ? (
          <WebToolbar
            tabNotesLength={tabNotes.length}
            viewMode={viewMode}
            harmonicaKey={harmonicaKey}
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
                    onPress={() => setBpm(bpm - 5)}
                    style={styles.bpmStepBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease tempo"
                  >
                    <Ionicons name="remove" size={14} color={theme.textSub} />
                  </Pressable>
                  <Text style={styles.bpmValue}>{bpm} BPM</Text>
                  <Pressable
                    onPress={() => setBpm(bpm + 5)}
                    style={styles.bpmStepBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Increase tempo"
                  >
                    <Ionicons name="add" size={14} color={theme.textSub} />
                  </Pressable>
                </View>
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
            onDragEnd={({ data }) => {
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
            tabNotesLength={tabNotes.length}
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

export type EditStyles = ReturnType<typeof createStyles>;

// Thin vertical rule separating logical clusters of controls within a toolbar row —
// used instead of just relying on `gap` so groups read as distinct at a glance.
export function Divider({ styles }: { styles: EditStyles }) {
  return <View style={styles.toolbarDivider} />;
}

// Shared icon-only control for the toolbar/transport bar — every one of these gets a
// hover tooltip (the brief specifically calls out "every icon should have a tooltip"),
// and a `variant` so secondary utility icons stay visually quiet while the handful of
// primary/active ones (Export, Metronome-on, Loop-on) stand out.
export function IconButton({
  icon, label, onPress, variant = 'ghost', disabled, selected, theme, styles, iconSize = 14,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  variant?: 'ghost' | 'primary' | 'active';
  disabled?: boolean;
  /** Exposed as accessibilityState.selected — for toggle buttons like Metronome/Loop
   *  (variant='active' drives the visual, this drives the a11y announcement). */
  selected?: boolean;
  theme: Theme;
  styles: EditStyles;
  iconSize?: number;
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const iconColor = disabled
    ? theme.textMuted
    : variant === 'ghost' ? theme.textSub : '#fff';

  return (
    <View style={styles.iconBtnWrap}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onHoverIn={() => setTooltipVisible(true)}
        onHoverOut={() => setTooltipVisible(false)}
        style={({ hovered }: any) => [
          styles.webIconBtn,
          variant === 'primary' && styles.webIconBtnAccent,
          variant === 'active' && styles.webIconBtnActive,
          variant === 'ghost' && !disabled && hovered && styles.webIconBtnHover,
          disabled && styles.webBtnDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, selected }}
      >
        <Ionicons name={icon} size={iconSize} color={iconColor} />
      </Pressable>
      {tooltipVisible && !disabled && (
        <View style={styles.tooltip} pointerEvents="none">
          <Text style={styles.tooltipText} numberOfLines={1}>{label}</Text>
        </View>
      )}
    </View>
  );
}

// The "12-Chromatic · Key C" badge, made interactive — click to open a dropdown with a
// Diatonic/Chromatic toggle and the same KeyGrid used at onboarding. Self-contained
// (reads key/type/notes straight from the store) so it can drop into the web toolbar
// without threading more props through WebToolbar than it already has.
//
// Key change (transposeToKey) is always safe — tab notation is key-independent, so no
// note can ever become unplayable from it — and applies the moment you tap a key, no
// confirmation needed. Type change (changeHarmonicaType) is the opposite: diatonic and
// chromatic don't share a tab vocabulary, so a note's *pitch* has to be re-matched
// against the new type's layout, which can leave notes unplayable. That only warns
// first when it would actually cost something (diatonic → chromatic never does, since
// chromatic is a strict superset) — computed here via the same noteToTab check
// changeHarmonicaType itself uses internally, just read-only ahead of time.
// variant='inline' is the list view sidebar's permanently-visible form — same
// selection handlers and unplayable-note confirmation as the dropdown, but rendered
// as an always-open type toggle + KeyGrid (onAccent) instead of a badge/chevron
// trigger, matching how the Home screen's own sidebar shows its key/type picker.
function KeyTypeControl({ theme, styles, variant = 'dropdown' }: { theme: Theme; styles: EditStyles; variant?: 'dropdown' | 'inline' }) {
  const harmonicaKey  = useAppStore(selectKey);
  const harmonicaType = useAppStore(selectHarmonicaType);
  const tabNotes      = useAppStore(selectTabNotes);
  const transposeToKey = useAppStore((s) => s.transposeToKey);
  const changeHarmonicaType = useAppStore((s) => s.changeHarmonicaType);

  const [open, setOpen] = useState(false);
  const [pendingType, setPendingType] = useState<{ type: HarmonicaType; count: number } | null>(null);

  if (!harmonicaKey) return null;

  function handleSelectKey(key: HarmonicaKey) {
    transposeToKey(key);
    setOpen(false);
  }

  function handleSelectType(type: HarmonicaType) {
    if (type === harmonicaType) return;
    const count = tabNotes.filter((n) => noteToTab(n.note, harmonicaKey!, type) === null).length;
    if (count === 0) {
      changeHarmonicaType(type);
      setOpen(false);
      return;
    }
    setPendingType({ type, count });
  }

  const typeToggle = (
    <View style={variant === 'inline' ? styles.sidebarTypeToggle : styles.keyDropdownTypeToggle}>
      {(['diatonic', 'chromatic'] as const).map((type) => (
        <Pressable
          key={type}
          onPress={() => handleSelectType(type)}
          style={[
            variant === 'inline' ? styles.sidebarTypeSeg : styles.keyDropdownTypeSeg,
            harmonicaType === type && (variant === 'inline' ? styles.sidebarTypeSegActive : styles.keyDropdownTypeSegActive),
          ]}
          accessibilityRole="radio"
          accessibilityState={{ checked: harmonicaType === type }}
        >
          <Text style={[
            variant === 'inline' ? styles.sidebarTypeText : styles.keyDropdownTypeText,
            harmonicaType === type && (variant === 'inline' ? styles.sidebarTypeTextActive : styles.keyDropdownTypeTextActive),
          ]}>
            {type === 'diatonic' ? 'Diatonic' : 'Chromatic'}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const confirmModal = (
    <ActionSheetModal
      visible={pendingType !== null}
      title={pendingType ? `Switching to ${pendingType.type === 'chromatic' ? 'Chromatic' : 'Diatonic'} will make ${pendingType.count} note${pendingType.count !== 1 ? 's' : ''} unplayable` : undefined}
      options={[{
        label: 'Switch Anyway',
        onPress: () => {
          if (pendingType) changeHarmonicaType(pendingType.type);
          setOpen(false);
        },
      }]}
      onClose={() => setPendingType(null)}
    />
  );

  if (variant === 'inline') {
    return (
      <View style={styles.sidebarKeyTypeGroup}>
        {typeToggle}
        <KeyGrid selected={harmonicaKey} onSelect={handleSelectKey} onAccent />
        {confirmModal}
      </View>
    );
  }

  return (
    <View style={styles.keyControlAnchor}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.webKeyBadge}
        accessibilityRole="button"
        accessibilityLabel={`${harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'}, Key ${harmonicaKey} — change key or type`}
      >
        <Text style={styles.webKeyBadgeText}>
          {harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'} · Key {harmonicaKey}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={11} color={theme.textSub} />
      </Pressable>

      {open && (
        <View style={styles.keyDropdown}>
          {typeToggle}
          <View style={styles.keyDropdownDivider} />
          <KeyGrid selected={harmonicaKey} onSelect={handleSelectKey} />
        </View>
      )}

      {confirmModal}
    </View>
  );
}

// Editable chart name, inline in the toolbar — self-contained (reads/writes the store
// directly) so naming happens as you go instead of only being prompted for at save time.
// Empty is a valid state (untitled); the placeholder shows what a save would default to.
// variant='sidebar' is the same field sitting full-width on the list view's accent
// sidebar (white-on-accent, matching the sidebar's other onAccent-styled controls)
// instead of the compact dark-on-white toolbar trigger.
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
// KeyTypeControl above, reading tabNotes/key/type/format straight from the store. Web
// can always trigger a browser download in place; there's no navigation-worthy content
// on the /export route that isn't just "pick a format, then Save or Share" — the
// full-page version stays for native, where Sharing.shareAsync/StorageAccessFramework
// need their own screen.
function ExportMenu({ tabNotesLength, theme, styles, variant = 'toolbar', collapsed = false }: { tabNotesLength: number; theme: Theme; styles: EditStyles; variant?: 'toolbar' | 'sidebar'; collapsed?: boolean }) {
  const selectedKey     = useAppStore(selectKey);
  const tabNotes        = useAppStore(selectTabNotes);
  const harmonicaType   = useAppStore(selectHarmonicaType);
  const exportFormat    = useAppStore(selectExportFmt);
  const setExportFormat = useAppStore((s) => s.setExportFormat);

  const [open, setOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ action: 'share' | 'save'; count: number } | null>(null);

  const disabled = tabNotesLength === 0;

  async function doSave() {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const { content, encoding, ext, mimeType } = generateForFormat(singlePart(tabNotes, selectedKey, harmonicaType), exportFormat);
      triggerWebDownload(contentToBlob(content, encoding, mimeType), `harp2tab_export.${ext}`);
    } finally {
      setIsExporting(false);
      setOpen(false);
    }
  }

  async function doShare() {
    if (!selectedKey || tabNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const { content, encoding, ext, mimeType } = generateForFormat(singlePart(tabNotes, selectedKey, harmonicaType), exportFormat);
      const filename = `harp2tab_export.${ext}`;
      const blob = contentToBlob(content, encoding, mimeType);
      const canUseWebShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
      if (canUseWebShare) {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          return;
        }
      }
      triggerWebDownload(blob, filename);
    } finally {
      setIsExporting(false);
      setOpen(false);
    }
  }

  // Pre-flight gate — a note with tab: '' has no real position on the current harmonica
  // (see getGridRows/PianoRoll.tsx). Skips the confirm sheet when there's nothing to warn about.
  function handleSave() {
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
      <Text style={styles.exportDropdownLabel}>FORMAT</Text>
      <View style={styles.exportFormatGroup}>
        {EXPORT_FORMATS.map((fmt: ExportFormat, i: number) => (
          <ExportOption
            key={fmt}
            format={fmt}
            isSelected={exportFormat === fmt}
            onSelect={setExportFormat}
            showDivider={i < EXPORT_FORMATS.length - 1}
          />
        ))}
      </View>
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
          <Ionicons name="download-outline" size={15} color={theme.accent} />
          <Text style={styles.exportDropdownSaveBtnText}>{isExporting ? '…' : 'Download'}</Text>
        </Pressable>
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
            collapsed ? styles.sidebarIconBtn : styles.sidebarExportBtn,
            disabled && styles.sidebarRowDisabled,
            (pressed || hovered) && !disabled && styles.sidebarRowPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Export"
          accessibilityState={{ disabled }}
          {...(Platform.OS === 'web' ? ({ title: 'Export' } as any) : null)}
        >
          <Ionicons name="share-outline" size={collapsed ? 18 : 16} color={disabled ? 'rgba(255,255,255,0.85)' : '#fff'} />
          {!collapsed && <Text style={styles.sidebarRowText}>Export</Text>}
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
        <Ionicons name={icon} size={18} color="#fff" />
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
        <Ionicons name={icon} size={16} color="#fff" />
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
        <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-back'} size={16} color="#fff" />
        {!collapsed && <Text style={styles.sidebarCollapseText}>Collapse</Text>}
      </Pressable>

      <View style={styles.sidebarDivider} />

      {collapsed ? (
        <SidebarKeyBadge onPress={onToggleCollapsed} styles={styles} />
      ) : (
        <View style={styles.sidebarSection}>
          <Text style={styles.sidebarSectionLabel}>KEY & TYPE</Text>
          <KeyTypeControl theme={theme} styles={styles} variant="inline" />
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
            <Ionicons name="alert-circle-outline" size={13} color="#fff" />
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
          tabNotesLength={tabNotesLength}
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
            <Ionicons name="arrow-undo" size={16} color="#fff" />
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
            <Ionicons name="arrow-redo" size={16} color="#fff" />
            <Text style={styles.sidebarRowHalfText}>Redo</Text>
          </Pressable>
        </View>
        )}
      </View>
    </ScrollView>
  );
}

function WebToolbar({
  tabNotesLength, viewMode, harmonicaKey,
  canUndo, onUndo, canRedo, onRedo, justSaved, onSave, onInspectFrames, onNew, onAdd, theme, styles,
}: {
  tabNotesLength: number;
  viewMode: 'list' | 'pianoRoll';
  harmonicaKey: HarmonicaKey | null;
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

        {tabNotesLength > 0 && harmonicaKey && <KeyTypeControl theme={theme} styles={styles} />}
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
        <ExportMenu tabNotesLength={tabNotesLength} theme={theme} styles={styles} />
      </View>
    </View>
  );
}

export function WebTransportBar({
  tabNotesLength, isPlaying, isPaused, onPlayToggle, onStop, onSkipBack, onSkipForward,
  currentTimeMs, totalTimeMs, formatElapsed,
  loopEnabled, onToggleLoop, playbackRate, onCycleRate,
  bpm, setBpm, metronomeEnabled, onToggleMetronome, glued, containerStyle, compact, theme, styles,
}: {
  tabNotesLength: number;
  isPlaying: boolean;
  isPaused: boolean;
  onPlayToggle: () => void;
  onStop: () => void;
  /** Jump the playhead back/forward one full bar — works while stopped, paused, or mid-playback. */
  onSkipBack: () => void;
  onSkipForward: () => void;
  currentTimeMs: number;
  totalTimeMs: number;
  formatElapsed: (ms: number) => string;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  playbackRate: number;
  onCycleRate: () => void;
  bpm: number;
  setBpm: (bpm: number) => void;
  metronomeEnabled: boolean;
  onToggleMetronome: () => void;
  /** True in piano-roll mode — sits flush against the data panel above it (no gap, no
   *  separating line) instead of floating below it like it does over the list view. */
  glued?: boolean;
  /**
   * Applied last, so a host that isn't `edit.tsx` can undo its layout compensations.
   *
   * `webTransportBar` carries three negative margins whose only job is to cancel this
   * screen's container padding (`marginHorizontal: -24`, `marginBottom:
   * -WEB_SCREEN_PADDING_BOTTOM`) and its `gap: 16` (`glued`'s `marginTop: -16`). In a host
   * without that padding they don't cancel anything — they pull the bar outside its own
   * box, which reads as the contents sitting off-centre.
   */
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * Shorter bar: tighter vertical padding and a smaller play button (48px tall instead of
   * 68px). Exists as a flag rather than something `containerStyle` could do, because the
   * height is set by the play circle as much as by the padding, and a caller can't reach
   * a nested child's style from the outside.
   */
  compact?: boolean;
  theme: Theme;
  styles: EditStyles;
}) {
  // A real transport: Loop / Tempo / Metronome / Skip / Stop / Play-Pause / Speed /
  // elapsed-of-total time. Undo, New, Add, Export, Save, Inspect all live in the top
  // toolbar now — this bar is only about hearing the tab. Three-column layout
  // (side / controls / side), both sides flex:1, so the center controls stay
  // dead-centered regardless of what either side's content weighs — space-between
  // would instead push them off-center.
  const disabled = tabNotesLength === 0;
  return (
    <View style={[styles.webTransportBar, glued && styles.webTransportBarGlued, compact && styles.webTransportBarCompact, containerStyle]}>
      <View style={styles.webTransportSide}>
        <View style={styles.webTransportGroup}>
          <IconButton
            icon="repeat"
            label={loopEnabled ? 'Disable loop' : 'Enable loop'}
            onPress={onToggleLoop}
            disabled={disabled}
            variant={loopEnabled ? 'active' : 'ghost'}
            selected={loopEnabled}
            theme={theme}
            styles={styles}
          />
          <Divider styles={styles} />
          <View style={styles.webBpmControl}>
            <Pressable onPress={() => setBpm(bpm - 5)} disabled={disabled} style={styles.webMiniStepBtn} accessibilityRole="button" accessibilityLabel="Decrease tempo">
              <Ionicons name="remove" size={12} color={disabled ? theme.textMuted : theme.textSub} />
            </Pressable>
            <Text style={[styles.webBpmValue, disabled && { color: theme.textMuted }]}>{bpm} BPM</Text>
            <Pressable onPress={() => setBpm(bpm + 5)} disabled={disabled} style={styles.webMiniStepBtn} accessibilityRole="button" accessibilityLabel="Increase tempo">
              <Ionicons name="add" size={12} color={disabled ? theme.textMuted : theme.textSub} />
            </Pressable>
          </View>
          <IconButton
            icon="musical-notes"
            label={metronomeEnabled ? 'Disable metronome' : 'Enable metronome'}
            onPress={onToggleMetronome}
            disabled={disabled}
            variant={metronomeEnabled ? 'active' : 'ghost'}
            selected={metronomeEnabled}
            theme={theme}
            styles={styles}
          />
        </View>
      </View>

      <View style={styles.webTransportCenter}>
        <IconButton icon="play-skip-back" label="Back one bar" onPress={onSkipBack} disabled={disabled} theme={theme} styles={styles} iconSize={13} />
        <IconButton icon="stop" label="Stop" onPress={onStop} disabled={disabled} theme={theme} styles={styles} iconSize={13} />
        <Pressable
          onPress={onPlayToggle}
          disabled={disabled}
          style={({ pressed, hovered }: any) => [
            styles.webPlayCircle,
            compact && styles.webPlayCircleCompact,
            disabled && styles.webPlayCircleDisabled,
            (pressed || hovered) && !disabled && styles.webPlayCircleHover,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isPlaying && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Play tab'}
          accessibilityState={{ disabled }}
        >
          <Ionicons name={isPlaying && !isPaused ? 'pause' : 'play'} size={compact ? 14 : 17} color={disabled ? theme.textMuted : '#fff'} />
        </Pressable>
        <IconButton icon="play-skip-forward" label="Forward one bar" onPress={onSkipForward} disabled={disabled} theme={theme} styles={styles} iconSize={13} />
      </View>

      <View style={[styles.webTransportSide, styles.webTransportSideRight]}>
        <View style={styles.webTransportGroup}>
          <Pressable
            onPress={onCycleRate}
            disabled={disabled}
            style={({ hovered }: any) => [styles.webSpeedBtn, !disabled && hovered && styles.webIconBtnHover]}
            accessibilityRole="button"
            accessibilityLabel={`Playback speed: ${playbackRate}x. Tap to change.`}
          >
            <Text style={[styles.webSpeedBtnText, disabled && { color: theme.textMuted }]}>{playbackRate}x</Text>
          </Pressable>
          <Text style={styles.webPlayTime}>
            {formatElapsed(currentTimeMs)} / {formatElapsed(totalTimeMs)}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      ...webMaxWidth(WEB_CONTENT_WIDTH.standard),
      paddingHorizontal: 24,
      paddingTop: Platform.OS === 'web' ? WEB_SCREEN_PADDING_TOP : 24,
      paddingBottom: Platform.OS === 'web' ? WEB_SCREEN_PADDING_BOTTOM : 24,
      gap: 16,
    },
    // The piano roll wants the full viewport width (DAW-style grid), unlike every other
    // screen's centered single-column layout — overrides webMaxWidth's cap for that mode.
    containerFullWidth: { maxWidth: '100%' } as ViewStyle,
    // Cancels the container's own paddingHorizontal so the piano-roll panel spans edge
    // to edge (DAW-style), instead of floating inset like every other centered screen.
    pianoRollEdgeWrap: { flex: 1, marginHorizontal: -24 },

    // List view's sidebar shell — same edge-to-edge trick as pianoRollEdgeWrap (cancel
    // container's own paddingHorizontal), plus cancels container's paddingTop too, so
    // the sidebar reaches the true viewport edge on the left AND touches the TopBar
    // above it, like Home's fullSidebar. The bottom edge meets WebTransportBar via that
    // bar's own `glued` variant instead (cancels container's `gap`, not padding here).
    editShellEdgeWrap: { flex: 1, marginHorizontal: -24, marginTop: -WEB_SCREEN_PADDING_TOP },
    editShell: { flexDirection: 'row', flex: 1 },
    // Mirrors Home's fullSidebar almost exactly (same width, accent fill, plain rows) —
    // deliberately reusing that visual language rather than inventing a second sidebar
    // style, so the two full-height accent rails read as the same UI pattern.
    // Box styling only — a ScrollView's own `style` can't carry padding or gap for its
    // content (those belong on contentContainerStyle below), and `flexGrow: 0` is what
    // stops the ScrollView from expanding past its 280px column.
    editSidebar: {
      width:             280,
      flexGrow:          0,
      flexShrink:        0,
      backgroundColor:   t.accent,
      borderRightWidth:  1,
      borderRightColor:  'rgba(0,0,0,0.18)',
      // The rail slides rather than snapping between its two widths. Web-only; on native
      // this is a static width change, which is fine — there's no sidebar there.
      ...(Platform.OS === 'web'
        ? { transitionProperty: 'width', transitionDuration: '160ms', transitionTimingFunction: 'ease' }
        : null),
    } as ViewStyle,
    editSidebarContent: {
      gap:               16,
      paddingHorizontal: 20,
      paddingVertical:   28,
    } as ViewStyle,
    // Collapsed rail: one square button wide plus its padding. Width is the only thing
    // that changes on the container — everything inside swaps shape via its own
    // `collapsed` branch rather than being squeezed by the parent.
    editSidebarCollapsed: { width: SIDEBAR_RAIL_W } as ViewStyle,
    editSidebarContentCollapsed: {
      gap:               10,
      paddingHorizontal: 12,
      paddingVertical:   20,
      alignItems:        'center',
    } as ViewStyle,
    // Square icon button for the collapsed rail — same translucent-pill language as
    // sidebarRow, just reduced to the glyph.
    sidebarIconBtn: {
      width:           SIDEBAR_ICON_BTN,
      height:          SIDEBAR_ICON_BTN,
      alignItems:      'center',
      justifyContent:  'center',
      borderRadius:    10,
      backgroundColor: 'rgba(255,255,255,0.14)',
      borderWidth:     1,
      borderColor:     'rgba(255,255,255,0.22)',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    sidebarKeyBadgeText: { fontSize: FONT.md, fontFamily: Poppins.bold, color: '#fff' },
    // Expanded-state collapse control — quieter than a full sidebarRow (no fill), since
    // it's chrome for the sidebar itself rather than one of the chart's actions.
    sidebarCollapseRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               8,
      alignSelf:         'flex-start',
      paddingVertical:   6,
      paddingHorizontal: 8,
      borderRadius:      8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    sidebarCollapseText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: 'rgba(255,255,255,0.9)' },
    sidebarSectionCollapsed: { gap: 10, alignItems: 'center' } as ViewStyle,
    // Tight vertical rhythm on purpose: this column already stacks a title, the piano
    // roll's own tool row and its bar ruler between the global TopBar above and the
    // transport bar below, and every band of padding here comes straight out of the
    // note grid's height.
    editMainColumn: { flex: 1, paddingHorizontal: 24, paddingTop: 0, gap: 8 },
    // Piano Roll only: no side gutters, so the panel runs from the sidebar's edge to the
    // window's. The grid is the whole point of the screen and every gutter pixel is a
    // pixel of chart; List keeps its gutters, since a full-bleed column of text rows
    // would just be hard to read.
    editMainColumnFlush: { paddingHorizontal: 0 } as ViewStyle,

    // Centered page title for the chart — heading-sized and editable in place. `width:
    // 100%` + centered text (rather than a shrink-to-fit input) keeps the caret and the
    // placeholder centered too, so it reads as a title in both the empty and filled state.
    chartTitleRow: { alignItems: 'center', paddingTop: 2, paddingBottom: 0 },
    chartTitleInput: {
      width:      '100%',
      textAlign:  'center',
      fontSize:   FONT.xl,
      fontFamily: SpaceGrotesk.bold,
      color:      t.textPrimary,
      letterSpacing: -0.4,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: 'transparent',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none', cursor: 'text' } as any : null),
    } as any,
    // Notion-style: the field's box only appears under the pointer, so the title reads as
    // a heading at rest and as an input the moment you go near it.
    chartTitleInputHovered: { backgroundColor: t.surface },
    chartTitleMeta: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.medium,
      color:      t.textMuted,
      textAlign:  'center',
    },

    // The piano roll's in-panel header: name + note count at the head of its tool row.
    // flexShrink lets the name give up width before the toolbar's fixed controls do.
    pianoRollHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
    // Accent-colored and toolbar-sized (FONT.base, down from the page title's FONT.xl) —
    // inside the panel this labels what you're editing rather than titling the page, and
    // the accent is what stops it reading as one more grey control in the row.
    pianoRollTitleInput: {
      fontSize:          FONT.base,
      fontFamily:        SpaceGrotesk.bold,
      color:             t.accent,
      letterSpacing:     -0.2,
      paddingVertical:   3,
      paddingHorizontal: 6,
      borderRadius:      6,
      minWidth:          80,
      maxWidth:          260,
      flexShrink:        1,
      backgroundColor:   'transparent',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none', cursor: 'text' } as any : null),
    } as any,
    pianoRollTitleInputHovered: { backgroundColor: t.surface },
    pianoRollHeaderMeta: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.medium,
      color:      t.textMuted,
      flexShrink: 0,
    },

    // Add Note as a trailing card in the list itself, matching TabCard's own shape
    // (same radius/vertical rhythm) but dashed/outlined and centered — reads as "the
    // next row" rather than a toolbar action once it's the flatlist's own footer.
    addNoteCard: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'center',
      gap:               8,
      marginVertical:    3,
      // TabCard's rows are two lines tall (a label over a value) plus its own
      // paddingVertical:10 — this is one centered line, so it needs an explicit
      // minHeight (not just matching paddingVertical) to read as the same row height
      // rather than a visibly shorter card.
      minHeight:         52,
      borderRadius:      10,
      borderWidth:       1.5,
      borderStyle:       'dashed',
      borderColor:       t.border,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    addNoteCardHovered: { backgroundColor: t.surface, borderColor: t.accent },
    addNoteCardText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.accent },

    sidebarSection: { gap: 8 },
    sidebarSectionLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         '#fff',
      letterSpacing: 1,
      marginBottom:  2,
    },
    // alignSelf: 'stretch' rather than relying on the container's default — the collapsed
    // rail centers its children, and a zero-width divider would just vanish there.
    sidebarDivider: { height: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.18)' },
    chartNameInputSidebar: {
      fontSize:          13,
      fontFamily:        SpaceGrotesk.bold,
      color:             '#fff',
      backgroundColor:   'rgba(255,255,255,0.14)',
      borderRadius:      8,
      borderWidth:       1,
      borderColor:       'rgba(255,255,255,0.22)',
      paddingHorizontal: 10,
      paddingVertical:   8,
      width:             '100%',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
    } as any,

    // Sidebar's always-visible key/type picker — same pattern as Home's own sidebar
    // (plain selectable rows + KeyGrid's onAccent variant) instead of the toolbar's
    // dropdown-behind-a-badge treatment, since there's no reason to hide it here.
    sidebarKeyTypeGroup: { gap: 10 },
    sidebarTypeToggle: {
      flexDirection:   'row',
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderRadius:    8,
      padding:         2,
      gap:             2,
    },
    sidebarTypeSeg: {
      flex:              1,
      alignItems:        'center',
      paddingVertical:   7,
      borderRadius:      6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    sidebarTypeSegActive: { backgroundColor: '#fff' },
    // Full white, not 0.85 — the inactive segment sits on a translucent track over the
    // cyan accent, where a faded white label all but disappears. The active segment is
    // distinguished by its solid white pill, so the inactive one doesn't need to be dim
    // as well to make the pairing read.
    sidebarTypeText:       { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: '#fff' },
    sidebarTypeTextActive: { color: t.accent },

    // Sidebar action rows (Save / New Recording / Inspect Frames / Export trigger) —
    // same translucent-pill pattern as Home's sidebarRow, so all four read as one
    // consistent "quick actions" group.
    sidebarRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               10,
      paddingVertical:   10,
      paddingHorizontal: 12,
      borderRadius:      10,
      backgroundColor:   'rgba(255,255,255,0.14)',
      borderWidth:       1,
      borderColor:       'rgba(255,255,255,0.22)',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    sidebarRowPressed:   { backgroundColor: 'rgba(255,255,255,0.22)' },
    sidebarRowDisabled:  { opacity: 0.55 },
    // On-accent like the rest of the rail — a translucent white wash rather than the
    // theme's warning colours, which are tuned for the app background, not this panel.
    sidebarUploadError: {
      flexDirection:     'row',
      alignItems:        'flex-start',
      gap:               6,
      paddingHorizontal: 10,
      paddingVertical:   8,
      borderRadius:      8,
      backgroundColor:   'rgba(255,255,255,0.16)',
    },
    sidebarUploadErrorText: {
      flex:       1,
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      '#fff',
    },
    sidebarRowIconWrap:  { width: 20, alignItems: 'center', justifyContent: 'center' },
    sidebarRowText:      { flex: 1, fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: '#fff' },

    // Undo/Redo side by side — a paired row instead of two full-width stacked rows,
    // since neither needs a trailing chevron/badge and both read fine as compact,
    // centered half-width buttons.
    sidebarRowSplit: { flexDirection: 'row', gap: 8 },
    sidebarRowHalf:  { flex: 1, justifyContent: 'center' },
    sidebarRowHalfText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: '#fff' },

    sidebarExportBtn: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               10,
      paddingVertical:   10,
      paddingHorizontal: 12,
      borderRadius:      10,
      backgroundColor:   'rgba(255,255,255,0.14)',
      borderWidth:       1,
      borderColor:       'rgba(255,255,255,0.22)',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,

    // "Soon" tag on the sidebar's disabled Upload row — same pattern as the coming-soon
    // badges on Home's own not-yet-wired upload buttons.
    sidebarComingSoon: {
      fontSize:          9,
      fontFamily:        Poppins.bold,
      color:             'rgba(255,255,255,0.85)',
      letterSpacing:     0.6,
      backgroundColor:   'rgba(255,255,255,0.18)',
      borderRadius:      6,
      paddingHorizontal: 5,
      paddingVertical:   2,
    },

    // New Recording's key/type picker — a real centered Modal (same backdrop/card
    // pattern as ActionSheetModal/NameRecordingModal) rather than an anchored dropdown,
    // since choosing where the next session starts is a deliberate, focused decision,
    // not a quick inline tweak — it deserves the whole screen's attention for a moment.
    newRecordingBackdrop: {
      flex:              1,
      backgroundColor:   'rgba(0,0,0,0.65)',
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 32,
    },
    newRecordingCard: {
      backgroundColor:   t.bg,
      borderRadius:      20,
      paddingHorizontal: 24,
      paddingVertical:   24,
      gap:               12,
      width:             '100%',
      maxWidth:          480,
      borderWidth:       1,
      borderColor:       t.border,
    },
    newRecordingTitle: {
      fontSize:      FONT.lg,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      textAlign:     'center',
      letterSpacing: -0.3,
    },
    newRecordingCancel: { alignItems: 'center', paddingVertical: 4 },
    newRecordingCancelText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub },

    sidebarPopoverLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1,
    },
    sidebarPopoverConfirm: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'center',
      gap:               6,
      paddingVertical:   10,
      borderRadius:      8,
      backgroundColor:   t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    sidebarPopoverConfirmHover: { backgroundColor: t.accentDim },
    sidebarPopoverConfirmText: { fontSize: 12, fontFamily: Poppins.bold, color: '#fff' },

    header:    { gap: 4 },
    headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    viewModeRow: {
      flexDirection:   'row',
      backgroundColor: t.surface,
      borderRadius:    12,
      padding:         3,
      gap:             3,
    },
    viewModeSeg: {
      flex:            1,
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             6,
      paddingVertical: 8,
      borderRadius:    10,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    viewModeSegActive: { backgroundColor: t.accent },
    viewModeText:       { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub },
    viewModeTextActive: { color: '#fff' },

    tempoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    keyBadge: {
      backgroundColor:   t.surface,
      borderRadius:      8,
      borderWidth:       1,
      borderColor:       t.border,
      paddingHorizontal: 10,
      paddingVertical:   7,
    },
    keyBadgeText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    bpmControl: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               8,
      backgroundColor:   t.surface,
      borderRadius:      8,
      borderWidth:       1,
      borderColor:       t.border,
      paddingHorizontal: 8,
      paddingVertical:   4,
    },
    bpmStepBtn: { padding: 2 },
    bpmValue: {
      fontSize:    FONT.xs,
      fontFamily:  Poppins.semiBold,
      color:       t.textSub,
      minWidth:    54,
      textAlign:   'center',
      fontVariant: ['tabular-nums'],
    },
    metronomeBtn: {
      width:            32,
      height:           32,
      borderRadius:     8,
      alignItems:       'center',
      justifyContent:   'center',
      backgroundColor:  t.surface,
      borderWidth:      1,
      borderColor:      t.border,
    },
    metronomeBtnActive: { backgroundColor: t.accent, borderColor: t.accent },

    gearBtn:   { padding: 4 },
    title:     { fontSize: FONT.xl, fontFamily: SpaceGrotesk.bold, color: t.accent, letterSpacing: -0.5 },
    subtitle: { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted },
    list:     { flex: 1 },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },

    emptyTitle: { fontSize: FONT.md, fontFamily: Poppins.bold,    color: t.textSub },
    emptyHint:  { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted, textAlign: 'center' },
    // Web-only empty-state extras — icon badge + a real, working CTA (no fabricated
    // import/upload buttons for features that don't exist yet).
    emptyIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accentSoft,
      marginBottom: 4,
    },
    emptyCta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    emptyCtaText: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: '#fff' },
    playBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      paddingVertical: 14,
      borderRadius:    14,
      borderWidth:     1,
      backgroundColor: t.surface,
      borderColor:     t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    playBtnText: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.accent },
    playBtnTime: {
      fontSize:    FONT.sm,
      fontFamily:  Poppins.regular,
      color:       t.textMuted,
      fontVariant: ['tabular-nums'],
    },

    actions: { flexDirection: 'row', gap: 10 },

    btn: {
      flex:            1,
      flexDirection:   'column',
      alignItems:      'center',
      justifyContent:  'center',
      paddingVertical: 16,
      borderRadius:    14,
      borderWidth:     1,
      gap:             5,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    btnGhost: {
      backgroundColor: t.surface,
      borderColor:     t.border,
    },
    btnOutlined: {
      backgroundColor: t.surface,
      borderColor:     t.accent,
    },
    btnFilled: {
      backgroundColor: t.accent,
      borderColor:     t.accent,
    },
    btnFilledDisabled: {
      backgroundColor: t.surface,
      borderColor:     t.border,
    },
    btnPressed: { opacity: 0.7 },

    btnTextGhost:    { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.textSub },
    btnTextOutlined: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.accent },
    btnTextFilled:   { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: '#fff' },
    btnTextDisabled: { color: t.textMuted },

    // ─── Web-only toolbar / transport bar — compact desktop chrome, not the mobile
    // stacked-touch-target styles above (those stay for native).
    webToolbar: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.separator,
      flexWrap:        'wrap',
      gap:             10,
      // A nested z-index (see keyDropdown below) only outranks siblings within its own
      // parent's stacking context — without this, the toolbar's own un-indexed siblings
      // (the piano roll / list view below it) would paint over the key dropdown
      // regardless of any z-index nested inside it. Same lesson as PianoRoll.tsx's
      // toolbarRow/rulerRow.
      zIndex: 20,
    },
    // Piano-roll mode: the panel below is its own bordered/rounded box (see
    // PianoRoll.tsx's `outer` style), so a second separating line here is redundant —
    // same reasoning as webTransportBarGlued at the other end of the panel. List view
    // keeps the border; it has no boxed panel of its own to make this line redundant.
    webToolbarGlued: { borderBottomWidth: 0 },
    webToolbarGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    // Separates logical clusters (View / Project / Edit / Actions / Export) within a
    // toolbar row — increased spacing plus a visible rule reads more clearly as
    // "distinct groups" than gap alone.
    toolbarDivider: { width: 1, height: 20, backgroundColor: t.separator, marginHorizontal: 2 },

    // Wraps every IconButton so its hover tooltip can be absolutely positioned relative
    // to just that button, not the whole toolbar row.
    iconBtnWrap: { position: 'relative' },
    tooltip: {
      position: 'absolute',
      top: '100%',
      left: 0,
      marginTop: 6,
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderRadius: 5,
      backgroundColor: t.textPrimary,
      zIndex: 20,
      ...(Platform.OS === 'web' ? { boxShadow: '0 2px 6px rgba(0,0,0,0.25)', whiteSpace: 'nowrap' } : null),
    } as any,
    tooltipText: { fontSize: 10, fontFamily: Poppins.semiBold, color: t.bg },

    webNoteCount: { fontSize: 12, fontFamily: Poppins.regular, color: t.textMuted },

    keyControlAnchor: { position: 'relative' },
    webKeyBadge: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               4,
      backgroundColor:   t.surface,
      borderRadius:      6,
      borderWidth:       1,
      borderColor:       t.border,
      paddingHorizontal: 8,
      paddingVertical:   4,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    webKeyBadgeText: { fontSize: 11, fontFamily: Poppins.semiBold, color: t.textSub },
    keyDropdown: {
      position: 'absolute',
      top: '100%',
      left: 0,
      marginTop: 6,
      width: 260,
      backgroundColor: t.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      padding: 10,
      gap: 10,
      zIndex: 20,
      ...(Platform.OS === 'web' ? { boxShadow: t.isDark ? '0 8px 24px rgba(0,0,0,0.4)' : '0 8px 24px rgba(0,0,0,0.15)' } : null),
    } as any,
    keyDropdownTypeToggle: {
      flexDirection: 'row',
      backgroundColor: t.surface,
      borderRadius: 8,
      padding: 2,
      gap: 2,
    },
    keyDropdownTypeSeg: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: 6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    keyDropdownTypeSegActive: { backgroundColor: t.accent },
    keyDropdownTypeText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    keyDropdownTypeTextActive: { color: '#fff' },
    keyDropdownDivider: { height: 1, backgroundColor: t.border },

    chartNameInput: {
      fontSize:          13,
      fontFamily:        SpaceGrotesk.bold,
      color:             t.textPrimary,
      backgroundColor:   t.surface,
      borderRadius:      6,
      borderWidth:       1,
      borderColor:       t.border,
      paddingHorizontal: 8,
      paddingVertical:   4,
      minWidth:          100,
      maxWidth:          220,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
    } as any,

    exportAnchor: { position: 'relative' },
    exportDropdown: {
      position: 'absolute',
      top: '100%',
      right: 0,
      marginTop: 6,
      width: 280,
      backgroundColor: t.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      padding: 10,
      gap: 8,
      zIndex: 20,
      ...(Platform.OS === 'web' ? { boxShadow: t.isDark ? '0 8px 24px rgba(0,0,0,0.4)' : '0 8px 24px rgba(0,0,0,0.15)' } : null),
    } as any,
    exportDropdownLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1.2,
      paddingHorizontal: 2,
    },
    exportFormatGroup: {
      backgroundColor: t.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      overflow: 'hidden',
    },
    exportDropdownActions: { flexDirection: 'row', gap: 8 },
    exportDropdownSaveBtn: {
      flex: 1,
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            6,
      paddingVertical: 10,
      borderRadius:    8,
      borderWidth:     1,
      borderColor:     t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    exportDropdownSaveBtnText: { fontSize: 12, fontFamily: Poppins.bold, color: t.accent },
    exportDropdownShareBtn: {
      flex: 1,
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            6,
      paddingVertical: 10,
      borderRadius:    8,
      backgroundColor: t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    exportDropdownShareBtnText: { fontSize: 12, fontFamily: Poppins.bold, color: '#fff' },

    // No background/border of its own anymore — sits inside webTransportGroup's pill,
    // which is now the only visual boundary in this cluster (a box-within-a-box read
    // busier, not more polished).
    webBpmControl: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               4,
      paddingHorizontal: 4,
    },
    webMiniStepBtn: { padding: 2, cursor: 'pointer' } as any,
    webBpmValue: {
      fontSize:    11,
      fontFamily:  Poppins.semiBold,
      color:       t.textSub,
      minWidth:    46,
      textAlign:   'center',
      fontVariant: ['tabular-nums'],
    },

    webIconBtn: {
      width:            26,
      height:           26,
      borderRadius:     6,
      alignItems:       'center',
      justifyContent:   'center',
      backgroundColor:  t.surface,
      borderWidth:      1,
      borderColor:      t.border,
      cursor:           'pointer',
    } as any,
    webIconBtnActive: { backgroundColor: t.accent, borderColor: t.accent },
    webIconBtnHover:  { backgroundColor: t.surfaceAlt },
    // Export gets the one filled/accent treatment in the toolbar — it's the "finish"
    // action, everything else is a neutral utility icon.
    webIconBtnAccent: { backgroundColor: t.accent, borderColor: t.accent },
    exportBtn: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingHorizontal: 12,
      height:            26,
      borderRadius:      6,
      backgroundColor:   t.accent,
      cursor:            'pointer',
    } as any,
    exportBtnText: { fontSize: 12, fontFamily: Poppins.semiBold, color: '#fff' },
    // "New Recording" gets a labeled button, not just an icon — a bare mic glyph reads
    // ambiguous (record? playback?) next to Export's icon+text pattern right beside it.
    newBtn: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingHorizontal: 12,
      height:            30,
      borderRadius:      6,
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
      cursor:            'pointer',
    } as any,
    newBtnText: { fontSize: 12, fontFamily: Poppins.semiBold, color: t.textSub },

    // Same reasoning as webBpmControl — no border/bg of its own, blends into the
    // enclosing pill.
    webSpeedBtn: {
      minWidth:          30,
      height:            22,
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 6,
      borderRadius:      6,
      cursor:            'pointer',
    } as any,
    webSpeedBtnText: { fontSize: 11, fontFamily: Poppins.semiBold, color: t.textSub, fontVariant: ['tabular-nums'] },

    // Docked footer — full viewport width (matches the edge-to-edge sidebar/panel it
    // sits directly against), its own surface tone + upward shadow so it reads as a
    // distinct floating dock rather than a plain strip of page background.
    webTransportBar: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'space-between',
      paddingVertical:   14,
      paddingHorizontal: 28,
      marginHorizontal:  -24,
      // Now that this bar has its own opaque surface, container's paddingBottom (below
      // this, its last child) would otherwise show through as a bare strip of page
      // background beneath it — cancel it so the bar's own padding is the real bottom
      // inset, flush to the true viewport edge like the sidebar is to the top edge.
      marginBottom:      Platform.OS === 'web' ? -WEB_SCREEN_PADDING_BOTTOM : 0,
      backgroundColor:   t.surface,
      borderTopWidth:    1,
      borderTopColor:    t.separator,
      ...(Platform.OS === 'web'
        ? { boxShadow: t.isDark ? '0 -6px 18px rgba(0,0,0,0.35)' : '0 -6px 18px rgba(0,0,0,0.06)' } as any
        : null),
    },
    // Piano-roll/list-sidebar mode: cancels container's own `gap` (the visible space
    // between the panel/sidebar and this bar) and drops the top border, so the transport
    // bar reads as their own footer row rather than a separate floating element below.
    webTransportBarGlued: {
      marginTop: -16,
      borderTopWidth: 0,
    },
    webTransportBarCompact: { paddingVertical: 8 },
    webTransportSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    // Speed stepper + elapsed/total time need to sit side-by-side, not the View default
    // of stacking vertically — this side now holds two elements, not just the time text.
    webTransportSideRight: { justifyContent: 'flex-end' },
    // Shared pill wrapper for each cluster (Loop/BPM/Metronome, and Speed/Time) — a
    // single rounded surface per group reads as "one control cluster" far more clearly
    // than each individual control carrying its own separate border/box.
    webTransportGroup: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      backgroundColor:   t.surfaceAlt,
      borderRadius:      20,
      paddingHorizontal: 10,
      paddingVertical:   5,
    },
    webTransportCenter: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               12,
      backgroundColor:   t.surfaceAlt,
      borderRadius:      24,
      paddingHorizontal: 12,
      paddingVertical:   6,
    },
    // The one circular control in this UI, deliberately — a play/pause transport button
    // reads as "the" primary action the way a small square icon button doesn't. Sized up
    // and given real depth (shadow) so it reads as the bar's obvious focal point.
    webPlayCircle: {
      width:            40,
      height:           40,
      borderRadius:      20,
      alignItems:       'center',
      justifyContent:   'center',
      backgroundColor:  t.accent,
      cursor:           'pointer',
      ...(Platform.OS === 'web'
        ? { boxShadow: `0 3px 10px ${t.accent}66` } as any
        : null),
    } as any,
    webPlayCircleCompact:  { width: 32, height: 32, borderRadius: 16 },
    webPlayCircleHover:    { backgroundColor: t.accentDim },
    webPlayCircleDisabled: { backgroundColor: t.surface, boxShadow: 'none' } as any,
    // textSub, not textMuted — this is the only readout of elapsed-of-total anywhere on
    // the screen, and at #A1A1AA on white it was sitting around 2.3:1.
    webPlayTime: {
      fontSize:    12,
      fontFamily:  Poppins.medium,
      color:       t.textSub,
      minWidth:    36,
      textAlign:   'right',
      fontVariant: ['tabular-nums'],
    },

    webBtnDisabled:     { backgroundColor: t.surface },
    webBtnHover:         { opacity: 0.7 },
    webBtnHoverFilled:   { backgroundColor: t.accentDim },
  });
}
