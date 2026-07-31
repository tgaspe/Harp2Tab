import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, selectTabNotes, selectKey, selectHarmonicaType, selectCanUndo, selectCanRedo, selectBpm, selectMetronomeEnabled } from '@/store/useAppStore';
import { saveCurrentSessionToLibrary, getDefaultRecordingTitle, startNewRecordingSession } from '@/store/sessionSnapshot';
import { usePlayback } from '@/hooks/usePlayback';
import { previewNote } from '@/native/Playback';
import { noteToTab } from '@/audio/HarmonicaMapper';
import { PLAYBACK_RATES, barDurationMs } from '@/audio/tempo';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

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
  const {
    isPlaying, isPaused, currentTimeMs, play, pause, resume, stop, seek,
    loopEnabled, setLoopEnabled, playbackRate, setPlaybackRate,
  } = usePlayback();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [namingAction, setNamingAction] = useState<'save' | 'new' | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'pianoRoll'>('list');
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
        />
      </ScaleDecorator>
    ),
    [deleteNote, updateNote, selectedId],
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
  function handleNewRecording() {
    if (tabNotes.length === 0) {
      goToNewRecording();
      return;
    }
    setNamingAction('new');
  }

  function handleSaveToLibrary() {
    if (tabNotes.length === 0) return;
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

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.container, viewMode === 'pianoRoll' && styles.containerFullWidth]}>

        {Platform.OS === 'web' ? (
          <WebToolbar
            tabNotesLength={tabNotes.length}
            viewMode={viewMode}
            setViewMode={setViewMode}
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
            onExport={() => router.push('/export')}
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
                  <Ionicons name="grid-outline" size={15} color={viewMode === 'pianoRoll' ? '#fff' : theme.textSub} />
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

        {tabNotes.length === 0 ? (
          Platform.OS === 'web' ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="musical-notes-outline" size={40} color={theme.accent} />
              </View>
              <Text style={styles.emptyTitle}>Nothing to edit yet</Text>
              <Text style={styles.emptyHint}>Record a tab and it will show up here, ready to fine-tune.</Text>
              <Pressable
                onPress={handleNewRecording}
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
            glued={viewMode === 'pianoRoll'}
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
                onPress={handleNewRecording}
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

type EditStyles = ReturnType<typeof createStyles>;

// Thin vertical rule separating logical clusters of controls within a toolbar row —
// used instead of just relying on `gap` so groups read as distinct at a glance.
function Divider({ styles }: { styles: EditStyles }) {
  return <View style={styles.toolbarDivider} />;
}

// Shared icon-only control for the toolbar/transport bar — every one of these gets a
// hover tooltip (the brief specifically calls out "every icon should have a tooltip"),
// and a `variant` so secondary utility icons stay visually quiet while the handful of
// primary/active ones (Export, Metronome-on, Loop-on) stand out.
function IconButton({
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
function KeyTypeControl({ theme, styles }: { theme: Theme; styles: EditStyles }) {
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
          <View style={styles.keyDropdownTypeToggle}>
            {(['diatonic', 'chromatic'] as const).map((type) => (
              <Pressable
                key={type}
                onPress={() => handleSelectType(type)}
                style={[styles.keyDropdownTypeSeg, harmonicaType === type && styles.keyDropdownTypeSegActive]}
                accessibilityRole="radio"
                accessibilityState={{ checked: harmonicaType === type }}
              >
                <Text style={[styles.keyDropdownTypeText, harmonicaType === type && styles.keyDropdownTypeTextActive]}>
                  {type === 'diatonic' ? 'Diatonic' : 'Chromatic'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.keyDropdownDivider} />
          <KeyGrid selected={harmonicaKey} onSelect={handleSelectKey} />
        </View>
      )}

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
    </View>
  );
}

function WebToolbar({
  tabNotesLength, viewMode, setViewMode, harmonicaKey,
  canUndo, onUndo, canRedo, onRedo, justSaved, onSave, onInspectFrames, onNew, onAdd, onExport, theme, styles,
}: {
  tabNotesLength: number;
  viewMode: 'list' | 'pianoRoll';
  setViewMode: (m: 'list' | 'pianoRoll') => void;
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
  onExport: () => void;
  theme: Theme;
  styles: EditStyles;
}) {
  return (
    <View style={[styles.webToolbar, viewMode === 'pianoRoll' && styles.webToolbarGlued]}>
      {/* View + Project cluster */}
      <View style={styles.webToolbarGroup}>
        <View style={styles.webToggle}>
          <Pressable
            onPress={() => setViewMode('list')}
            style={[styles.webToggleSeg, viewMode === 'list' && styles.webToggleSegActive]}
            accessibilityRole="radio"
            accessibilityState={{ checked: viewMode === 'list' }}
            accessibilityLabel="List view"
          >
            <Ionicons name="list-outline" size={13} color={viewMode === 'list' ? '#fff' : theme.textSub} />
            <Text style={[styles.webToggleText, viewMode === 'list' && styles.webToggleTextActive]}>List</Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('pianoRoll')}
            style={[styles.webToggleSeg, viewMode === 'pianoRoll' && styles.webToggleSegActive]}
            accessibilityRole="radio"
            accessibilityState={{ checked: viewMode === 'pianoRoll' }}
            accessibilityLabel="Piano roll view"
          >
            <Ionicons name="grid-outline" size={13} color={viewMode === 'pianoRoll' ? '#fff' : theme.textSub} />
            <Text style={[styles.webToggleText, viewMode === 'pianoRoll' && styles.webToggleTextActive]}>Piano Roll</Text>
          </Pressable>
        </View>

        {tabNotesLength > 0 && (
          <>
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
        <IconButton
          icon={justSaved ? 'checkmark-circle' : 'bookmark-outline'}
          label={justSaved ? 'Saved to recent recordings' : 'Save to recent recordings'}
          onPress={onSave}
          disabled={tabNotesLength === 0}
          variant={justSaved ? 'active' : 'ghost'}
          theme={theme}
          styles={styles}
        />
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
            everything else here is a neutral, icon-only utility. */}
        <Pressable
          onPress={onExport}
          disabled={tabNotesLength === 0}
          style={({ pressed, hovered }: any) => [
            styles.exportBtn,
            tabNotesLength === 0 && styles.webBtnDisabled,
            (pressed || hovered) && tabNotesLength > 0 && styles.webBtnHoverFilled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go to Export"
          accessibilityState={{ disabled: tabNotesLength === 0 }}
        >
          <Ionicons name="share-outline" size={14} color={tabNotesLength === 0 ? theme.textMuted : '#fff'} />
          <Text style={[styles.exportBtnText, tabNotesLength === 0 && { color: theme.textMuted }]}>Export</Text>
        </Pressable>
      </View>
    </View>
  );
}

function WebTransportBar({
  tabNotesLength, isPlaying, isPaused, onPlayToggle, onStop, onSkipBack, onSkipForward,
  currentTimeMs, totalTimeMs, formatElapsed,
  loopEnabled, onToggleLoop, playbackRate, onCycleRate,
  bpm, setBpm, metronomeEnabled, onToggleMetronome, glued, theme, styles,
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
    <View style={[styles.webTransportBar, glued && styles.webTransportBarGlued]}>
      <View style={styles.webTransportSide}>
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

      <View style={styles.webTransportCenter}>
        <IconButton icon="play-skip-back" label="Back one bar" onPress={onSkipBack} disabled={disabled} theme={theme} styles={styles} iconSize={13} />
        <IconButton icon="stop" label="Stop" onPress={onStop} disabled={disabled} theme={theme} styles={styles} iconSize={13} />
        <Pressable
          onPress={onPlayToggle}
          disabled={disabled}
          style={({ pressed, hovered }: any) => [
            styles.webPlayCircle,
            disabled && styles.webBtnDisabled,
            (pressed || hovered) && !disabled && styles.webBtnHoverFilled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isPlaying && !isPaused ? 'Pause' : isPaused ? 'Resume' : 'Play tab'}
          accessibilityState={{ disabled }}
        >
          <Ionicons name={isPlaying && !isPaused ? 'pause' : 'play'} size={15} color={disabled ? theme.textMuted : '#fff'} />
        </Pressable>
        <IconButton icon="play-skip-forward" label="Forward one bar" onPress={onSkipForward} disabled={disabled} theme={theme} styles={styles} iconSize={13} />
      </View>

      <View style={[styles.webTransportSide, styles.webTransportSideRight]}>
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
  );
}

function createStyles(t: Theme) {
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

    webToggle: {
      flexDirection:   'row',
      backgroundColor: t.surface,
      borderRadius:    8,
      padding:         2,
      gap:             2,
    },
    webToggleSeg: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               5,
      paddingVertical:   5,
      paddingHorizontal: 10,
      borderRadius:      6,
      cursor:            'pointer',
    } as any,
    webToggleSegActive: { backgroundColor: t.accent },
    webToggleText:       { fontSize: 12, fontFamily: Poppins.semiBold, color: t.textSub },
    webToggleTextActive: { color: '#fff' },

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

    webBpmControl: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               4,
      backgroundColor:   t.surface,
      borderRadius:      6,
      borderWidth:       1,
      borderColor:       t.border,
      paddingHorizontal: 4,
      paddingVertical:   3,
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

    webSpeedBtn: {
      minWidth:          30,
      height:            26,
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 6,
      borderRadius:      6,
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
      cursor:            'pointer',
    } as any,
    webSpeedBtnText: { fontSize: 11, fontFamily: Poppins.semiBold, color: t.textSub, fontVariant: ['tabular-nums'] },

    webTransportBar: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'space-between',
      paddingVertical: 10,
      borderTopWidth:  1,
      borderTopColor:  t.separator,
    },
    // Piano-roll mode: cancels container's own `gap` (the visible space between the
    // panel and this bar) and drops the top border, so the transport bar reads as this
    // panel's own footer row rather than a separate floating element below it.
    webTransportBarGlued: {
      marginTop: -16,
      borderTopWidth: 0,
    },
    webTransportSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    // Speed stepper + elapsed/total time need to sit side-by-side, not the View default
    // of stacking vertically — this side now holds two elements, not just the time text.
    webTransportSideRight: { justifyContent: 'flex-end', gap: 8 },
    webTransportCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    // The one circular control in this UI, deliberately — a play/pause transport button
    // reads as "the" primary action the way a small square icon button doesn't.
    webPlayCircle: {
      width:            34,
      height:           34,
      borderRadius:     17,
      alignItems:       'center',
      justifyContent:   'center',
      backgroundColor:  t.accent,
      cursor:           'pointer',
    } as any,
    webPlayTime: {
      fontSize:    12,
      fontFamily:  Poppins.regular,
      color:       t.textMuted,
      minWidth:    36,
      textAlign:   'right',
      fontVariant: ['tabular-nums'],
    },

    webBtnDisabled:     { backgroundColor: t.surface },
    webBtnHover:         { opacity: 0.7 },
    webBtnHoverFilled:   { backgroundColor: t.accentDim },
  });
}
