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
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, selectTabNotes, selectKey, selectHarmonicaType, selectCanUndo, selectCanRedo, selectBpm, selectMetronomeEnabled } from '@/store/useAppStore';
import { saveCurrentSessionToLibrary } from '@/store/sessionSnapshot';
import { usePlayback } from '@/hooks/usePlayback';
import { PLAYBACK_RATES } from '@/audio/tempo';
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
  const reset        = useAppStore((s) => s.reset);
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
  const [viewMode, setViewMode] = useState<'list' | 'pianoRoll'>('list');
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

  function handleSelect(id: string) {
    setSelectedId(prev => prev === id ? null : id);
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

  function handleNewRecording() {
    saveCurrentSessionToLibrary();
    reset();
    router.dismissAll();
  }

  function handleSaveToLibrary() {
    saveCurrentSessionToLibrary();
    setJustSaved(true);
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setJustSaved(false), 1500);
  }

  function handlePlayToggle() {
    if (!isPlaying) { play(tabNotes, { bpm, metronomeEnabled, rate: playbackRate }); return; }
    if (isPaused) { resume(); return; }
    pause();
  }

  function handleCycleRate() {
    const i = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number]);
    setPlaybackRate(PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length]);
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
            harmonicaType={harmonicaType}
            bpm={bpm}
            setBpm={setBpm}
            metronomeEnabled={metronomeEnabled}
            setMetronomeEnabled={setMetronomeEnabled}
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
                  onPress={() => setMetronomeEnabled(!metronomeEnabled)}
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
              onSeek={seek}
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
            currentTimeMs={currentTimeMs}
            totalTimeMs={totalTimeMs}
            formatElapsed={formatElapsed}
            loopEnabled={loopEnabled}
            onToggleLoop={() => setLoopEnabled(!loopEnabled)}
            playbackRate={playbackRate}
            onCycleRate={handleCycleRate}
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

function WebToolbar({
  tabNotesLength, viewMode, setViewMode, harmonicaKey, harmonicaType,
  bpm, setBpm, metronomeEnabled, setMetronomeEnabled,
  canUndo, onUndo, canRedo, onRedo, justSaved, onSave, onInspectFrames, onNew, onAdd, onExport, theme, styles,
}: {
  tabNotesLength: number;
  viewMode: 'list' | 'pianoRoll';
  setViewMode: (m: 'list' | 'pianoRoll') => void;
  harmonicaKey: HarmonicaKey | null;
  harmonicaType: HarmonicaType;
  bpm: number;
  setBpm: (bpm: number) => void;
  metronomeEnabled: boolean;
  setMetronomeEnabled: (v: boolean) => void;
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
    <View style={styles.webToolbar}>
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

        {tabNotesLength > 0 && harmonicaKey && (
          <View style={styles.webKeyBadge}>
            <Text style={styles.webKeyBadgeText}>
              {harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'} · Key {harmonicaKey}
            </Text>
          </View>
        )}

        {tabNotesLength > 0 && viewMode === 'pianoRoll' && (
          <>
            <Divider styles={styles} />
            <View style={styles.webBpmControl}>
              <Pressable onPress={() => setBpm(bpm - 5)} style={styles.webMiniStepBtn} accessibilityRole="button" accessibilityLabel="Decrease tempo">
                <Ionicons name="remove" size={12} color={theme.textSub} />
              </Pressable>
              <Text style={styles.webBpmValue}>{bpm} BPM</Text>
              <Pressable onPress={() => setBpm(bpm + 5)} style={styles.webMiniStepBtn} accessibilityRole="button" accessibilityLabel="Increase tempo">
                <Ionicons name="add" size={12} color={theme.textSub} />
              </Pressable>
            </View>
            <IconButton
              icon="musical-notes"
              label={metronomeEnabled ? 'Disable metronome' : 'Enable metronome'}
              onPress={() => setMetronomeEnabled(!metronomeEnabled)}
              variant={metronomeEnabled ? 'active' : 'ghost'}
              selected={metronomeEnabled}
              theme={theme}
              styles={styles}
            />
          </>
        )}
      </View>

      {/* Edit + Actions + Export cluster */}
      <View style={styles.webToolbarGroup}>
        <IconButton icon="arrow-undo" label="Undo" onPress={onUndo} disabled={!canUndo} theme={theme} styles={styles} />
        <IconButton icon="arrow-redo" label="Redo" onPress={onRedo} disabled={!canRedo} theme={theme} styles={styles} />

        <Divider styles={styles} />

        <IconButton icon="mic-outline" label="New Recording" onPress={onNew} theme={theme} styles={styles} />
        <IconButton icon="add" label="Add Note" onPress={onAdd} theme={theme} styles={styles} />
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
  tabNotesLength, isPlaying, isPaused, onPlayToggle, onStop, currentTimeMs, totalTimeMs, formatElapsed,
  loopEnabled, onToggleLoop, playbackRate, onCycleRate, theme, styles,
}: {
  tabNotesLength: number;
  isPlaying: boolean;
  isPaused: boolean;
  onPlayToggle: () => void;
  onStop: () => void;
  currentTimeMs: number;
  totalTimeMs: number;
  formatElapsed: (ms: number) => string;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  playbackRate: number;
  onCycleRate: () => void;
  theme: Theme;
  styles: EditStyles;
}) {
  // A real transport: Loop / Stop / Play-Pause / Speed / elapsed-of-total time. Undo,
  // New, Add, Export, Save, Inspect all live in the top toolbar now — this bar is only
  // about hearing the tab. Three-column layout (side / controls / side), both sides
  // flex:1, so the center controls stay dead-centered regardless of what either side's
  // content weighs — space-between would instead push them off-center.
  const disabled = tabNotesLength === 0;
  return (
    <View style={styles.webTransportBar}>
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
      </View>

      <View style={styles.webTransportCenter}>
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
    },
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

    webKeyBadge: {
      backgroundColor:   t.surface,
      borderRadius:      6,
      borderWidth:       1,
      borderColor:       t.border,
      paddingHorizontal: 8,
      paddingVertical:   4,
    },
    webKeyBadgeText: { fontSize: 11, fontFamily: Poppins.semiBold, color: t.textSub },

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
