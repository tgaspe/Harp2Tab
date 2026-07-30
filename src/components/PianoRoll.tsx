import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { getPlayablePositions, type PlayablePosition } from '@/audio/HarmonicaMapper';
import { getFrames } from '@/audio/frameBuffer';
import { selectRecordingId, useAppStore } from '@/store/useAppStore';
import { selectRecordings, useRecordingsStore } from '@/store/useRecordingsStore';
import { barDurationMs, beatDurationMs, BEATS_PER_BAR, msToBar, snapMsToGrid, type SnapDivision } from '@/audio/tempo';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

const ROW_HEIGHT       = 20;
const LABEL_WIDTH       = 84;
const PX_PER_SECOND     = 90;
const MIN_DURATION_MS   = 60;
const NUDGE_TIME_MS     = 50;
const BLOCK_MARGIN      = 3;
const RESIZE_HANDLE_W   = 10;
const RULER_HEIGHT      = 26;
const DATA_BAR_HEIGHT   = 64;

const SNAP_CYCLE: SnapDivision[] = ['off', 4, 8, 16];
const SNAP_LABELS: Record<SnapDivision, string> = { off: 'Off', 4: '1/4', 8: '1/8', 16: '1/16' };

function maxOf(nums: number[], floor: number): number {
  return nums.reduce((m, n) => (n > m ? n : m), floor);
}

// Splits a tab string into sign / hole number / modifier so each piece can sit in its
// own fixed-width column — right-aligning the tab as a single string doesn't work,
// since e.g. "3" ends in a digit but "-3'" ends in a bend mark, so the digits themselves
// never line up. e.g. "-3'''" -> { sign: "-", number: "3", modifier: "'''" }.
function parseTab(tab: string): { sign: string; number: string; modifier: string } {
  const m = tab.match(/^(-)?(\d+)(.*)$/);
  if (!m) return { sign: '', number: tab, modifier: '' };
  return { sign: m[1] ?? '', number: m[2], modifier: m[3] ?? '' };
}

// Octave number from a scientific pitch name, e.g. "C#5" -> 5.
function getOctave(note: string): number {
  const m = note.match(/(-?\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

// Natural (no sharp) vs accidental — used to shade rows like a real piano's white/black
// keys, rather than a plain even/odd stripe that has nothing to do with the actual pitch.
function isNaturalNote(note: string): boolean {
  return !note.includes('#');
}

type NoteUpdate = Partial<Pick<TabNote, 'tab' | 'note' | 'start_time' | 'duration'>>;

interface PianoRollProps {
  notes:          TabNote[];
  harmonicaKey:   HarmonicaKey | null;
  harmonicaType:  HarmonicaType;
  bpm:            number;
  selectedId:     string | null;
  onSelect:       (id: string) => void;
  onUpdate:       (id: string, changes: NoteUpdate) => void;
  onDelete:       (id: string) => void;
  isPlaying:      boolean;
  currentTimeMs:  number;
}

export function PianoRoll({
  notes, harmonicaKey, harmonicaType, bpm, selectedId, onSelect, onUpdate, onDelete, isPlaying, currentTimeMs,
}: PianoRollProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [snapDivision, setSnapDivision] = useState<SnapDivision>(8);
  const [metricTab, setMetricTab] = useState<'breath' | 'duration' | 'confidence' | 'pitchBend'>('breath');
  const [scrollX, setScrollX] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  const recordingId = useAppStore(selectRecordingId);
  const savedRecordings = useRecordingsStore(selectRecordings);
  const frames = useMemo(() => {
    if (!recordingId) return [];
    const live = getFrames(recordingId);
    if (live.length > 0) return live;
    return savedRecordings.find((r) => r.id === recordingId)?.frames ?? [];
  }, [recordingId, savedRecordings]);

  const positions = useMemo(
    () => (harmonicaKey ? getPlayablePositions(harmonicaKey, harmonicaType) : []),
    [harmonicaKey, harmonicaType],
  );

  const totalMs = notes.length ? notes.reduce((max, n) => Math.max(max, n.start_time + n.duration), 0) : 0;
  // Floor gridWidth to the actual available viewport, not just a fixed 600 — otherwise a
  // short recording leaves a huge blank gap (no rows, no lines) to the right on a wide
  // screen, since the scrollable content would be narrower than the screen itself.
  const dataWidth  = (totalMs / 1000) * PX_PER_SECOND + 120;
  const gridWidth  = Math.max(viewportWidth || 600, dataWidth);
  const gridHeight = positions.length * ROW_HEIGHT;

  function handleGridScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setScrollX(e.nativeEvent.contentOffset.x);
  }

  function handleViewportLayout(e: { nativeEvent: { layout: { width: number } } }) {
    setViewportWidth(Math.max(0, e.nativeEvent.layout.width - LABEL_WIDTH));
  }

  function cycleSnap() {
    const i = SNAP_CYCLE.indexOf(snapDivision);
    setSnapDivision(SNAP_CYCLE[(i + 1) % SNAP_CYCLE.length]);
  }

  // Arrow-key nudge (web/keyboard only) for the currently-selected note: Left/Right nudges
  // time, Up/Down moves to the adjacent playable row, Backspace/Delete removes it.
  const notesRef      = useRef(notes);      notesRef.current      = notes;
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;

  useEffect(() => {
    if (Platform.OS !== 'web' || positions.length === 0) return;

    function onKeyDown(e: KeyboardEvent) {
      const id = selectedIdRef.current;
      if (!id) return;
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onUpdate(id, { start_time: Math.max(0, note.start_time - NUDGE_TIME_MS) });
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        onUpdate(id, { start_time: note.start_time + NUDGE_TIME_MS });
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        onDelete(id);
        return;
      }

      const rowIndex = positions.findIndex((p) => p.tab === note.tab);
      if (rowIndex === -1) return;
      if (e.key === 'ArrowUp' && rowIndex > 0) {
        e.preventDefault();
        const p = positions[rowIndex - 1];
        onUpdate(id, { tab: p.tab, note: p.note });
      } else if (e.key === 'ArrowDown' && rowIndex < positions.length - 1) {
        e.preventDefault();
        const p = positions[rowIndex + 1];
        onUpdate(id, { tab: p.tab, note: p.note });
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [positions, onUpdate, onDelete]);

  if (!harmonicaKey || positions.length === 0) return null;

  const playheadLeft = (currentTimeMs / 1000) * PX_PER_SECOND;
  const showPlayhead = isPlaying || currentTimeMs > 0;

  return (
    <View style={styles.outer} onLayout={handleViewportLayout}>
      {/* Snap control */}
      <View style={styles.toolbarRow}>
        <Pressable
          onPress={cycleSnap}
          style={styles.snapBtn}
          accessibilityRole="button"
          accessibilityLabel={`Snap: ${SNAP_LABELS[snapDivision]}`}
        >
          <Ionicons name="magnet-outline" size={14} color={theme.textSub} />
          <Text style={styles.snapBtnText}>Snap {SNAP_LABELS[snapDivision]}</Text>
        </Pressable>
      </View>

      {/* Bar ruler — follows the grid's horizontal scroll via a transform, not its own
          independent ScrollView (simpler and more reliable than syncing two scrollables). */}
      <View style={styles.rulerClip}>
        <View style={[styles.rulerContent, { width: gridWidth, transform: [{ translateX: -scrollX }] }]}>
          <BarRuler bpm={bpm} durationMs={totalMs} pxPerSecond={PX_PER_SECOND} theme={theme} />
          {showPlayhead && <View style={[styles.playheadLine, { left: playheadLeft, height: RULER_HEIGHT }]} />}
        </View>
      </View>

      {/* Grid: pinned row-label rail + vertically+horizontally scrollable note grid.
          Label rail and grid share ONE outer vertical ScrollView (rather than each
          having its own) so vertical scrolling can't desync labels from rows. */}
      <ScrollView showsVerticalScrollIndicator={false} style={styles.gridVScroll}>
        <View style={styles.gridRow}>
          <View style={styles.labelRail}>
            {positions.map((p, i) => {
              const { sign, number, modifier } = parseTab(p.tab);
              const next = positions[i + 1];
              const isOctaveBoundary = next ? getOctave(p.note) !== getOctave(next.note) : false;
              return (
                <View
                  key={p.tab}
                  style={[
                    styles.labelCell,
                    !isNaturalNote(p.note) && styles.rowStripeAlt,
                    isOctaveBoundary && styles.octaveBoundary,
                  ]}
                >
                  <Text style={styles.labelTabSign} numberOfLines={1}>{sign}</Text>
                  <Text style={styles.labelTabNumber} numberOfLines={1}>{number}</Text>
                  <Text style={styles.labelTabModifier} numberOfLines={1}>{modifier}</Text>
                  <Text style={styles.labelNote} numberOfLines={1}>{p.note}</Text>
                </View>
              );
            })}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={Platform.OS === 'web'}
            onScroll={handleGridScroll}
            scrollEventThrottle={16}
          >
            <View style={[styles.grid, { width: gridWidth, height: gridHeight }]}>
              {positions.map((p, i) => {
                const next = positions[i + 1];
                const isOctaveBoundary = next ? getOctave(p.note) !== getOctave(next.note) : false;
                return (
                  <View
                    key={p.tab}
                    pointerEvents="none"
                    style={[
                      styles.rowStripe,
                      { top: i * ROW_HEIGHT, width: gridWidth },
                      !isNaturalNote(p.note) && styles.rowStripeAlt,
                      isOctaveBoundary && styles.octaveBoundary,
                    ]}
                  />
                );
              })}

              <BeatGridLines bpm={bpm} durationMs={totalMs} pxPerSecond={PX_PER_SECOND} height={gridHeight} theme={theme} />

              {notes.map((note) => {
                const rowIndex = positions.findIndex((p) => p.tab === note.tab);
                if (rowIndex === -1) return null;
                return (
                  <PianoRollNoteBlock
                    key={note.id}
                    note={note}
                    rowIndex={rowIndex}
                    positions={positions}
                    bpm={bpm}
                    snapDivision={snapDivision}
                    isSelected={selectedId === note.id}
                    onSelect={onSelect}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    theme={theme}
                    styles={styles}
                  />
                );
              })}

              {showPlayhead && (
                <View pointerEvents="none" style={[styles.playheadLine, { left: playheadLeft, height: gridHeight }]} />
              )}
            </View>
          </ScrollView>
        </View>
      </ScrollView>

      {/* Data panel — Breath Force / Duration / Confidence / Pitch Bend, x-synced with the grid above */}
      <View style={styles.dataPanel}>
        <View style={styles.dataPanelTabs}>
          {(['breath', 'duration', 'confidence', 'pitchBend'] as const).map((tab) => (
            <Pressable key={tab} onPress={() => setMetricTab(tab)} style={styles.dataTab}>
              <Text style={[styles.dataTabText, metricTab === tab && styles.dataTabTextActive]}>
                {METRIC_LABELS[tab]}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.dataBarClip}>
          <View style={[styles.dataBarContent, { width: gridWidth, transform: [{ translateX: -scrollX }] }]}>
            <DataPanelBars
              metric={metricTab}
              notes={notes}
              frames={frames}
              positions={positions}
              theme={theme}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const METRIC_LABELS = {
  breath:     'Breath Force',
  duration:   'Duration',
  confidence: 'Confidence',
  pitchBend:  'Pitch Bend',
} as const;

// ─── Bar ruler ─────────────────────────────────────────────────────────────────

function BarRuler({ bpm, durationMs, pxPerSecond, theme }: {
  bpm: number; durationMs: number; pxPerSecond: number; theme: Theme;
}) {
  const barMs = barDurationMs(bpm);
  const pxPerBar = (barMs / 1000) * pxPerSecond;
  const barCount = Math.ceil(durationMs / barMs) + 4;

  let tickEvery = 1;
  for (const n of [1, 2, 4, 8, 16, 32]) {
    if (n * pxPerBar >= 50) { tickEvery = n; break; }
    tickEvery = n;
  }

  const ticks: number[] = [];
  for (let bar = 0; bar <= barCount; bar += tickEvery) ticks.push(bar);

  return (
    <>
      {ticks.map((bar) => (
        <View key={bar} style={{ position: 'absolute', left: bar * pxPerBar, top: 0, bottom: 0 }}>
          <View style={{ width: 1, height: 8, backgroundColor: theme.textMuted }} />
          <Text style={{ fontSize: 10, fontFamily: Poppins.semiBold, color: theme.textMuted, marginTop: 2 }}>
            {msToBar(bar * barMs, bpm).toFixed(0)}
          </Text>
        </View>
      ))}
    </>
  );
}

// Real vertical gridlines behind the notes — thin per-beat, heavier per-bar (aligned with
// the ruler's bar ticks above). Previously the grid had no vertical structure at all.
function BeatGridLines({ bpm, durationMs, pxPerSecond, height, theme }: {
  bpm: number; durationMs: number; pxPerSecond: number; height: number; theme: Theme;
}) {
  const beatMs    = beatDurationMs(bpm);
  const pxPerBeat = (beatMs / 1000) * pxPerSecond;
  const totalBeats = Math.ceil(durationMs / beatMs) + BEATS_PER_BAR * 2;

  const lines: { x: number; isBar: boolean }[] = [];
  for (let b = 0; b <= totalBeats; b++) {
    lines.push({ x: b * pxPerBeat, isBar: b % BEATS_PER_BAR === 0 });
  }

  return (
    <>
      {lines.map((l, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: l.x,
            width: l.isBar ? 1 : 1,
            height,
            backgroundColor: l.isBar ? theme.border : theme.separator,
            opacity: l.isBar ? 1 : 0.5,
          }}
        />
      ))}
    </>
  );
}

// ─── Data panel bars ───────────────────────────────────────────────────────────

function DataPanelBars({ metric, notes, frames, positions, theme }: {
  metric: 'breath' | 'duration' | 'confidence' | 'pitchBend';
  notes: TabNote[];
  frames: ReturnType<typeof getFrames>;
  positions: PlayablePosition[];
  theme: Theme;
}) {
  if (metric === 'duration' || metric === 'confidence') {
    const maxVal = metric === 'duration' ? maxOf(notes.map((n) => n.duration), 1) : 100;
    return (
      <>
        {notes.map((n) => {
          const left = (n.start_time / 1000) * PX_PER_SECOND;
          const width = Math.max(2, (n.duration / 1000) * PX_PER_SECOND - 2);
          const value = metric === 'duration' ? n.duration : n.confidence;
          const height = Math.max(2, (value / maxVal) * DATA_BAR_HEIGHT);
          return (
            <View
              key={n.id}
              style={{
                position: 'absolute', left, bottom: 0, width,
                height, backgroundColor: theme.accent, borderRadius: 2, opacity: 0.85,
              }}
            />
          );
        })}
      </>
    );
  }

  if (frames.length === 0) return null;

  if (metric === 'breath') {
    const maxRms = maxOf(frames.map((f) => f.rms), 0.0001);
    const BUCKET_PX = 4;
    const totalWidth = maxOf(frames.map((f) => (f.t / 1000) * PX_PER_SECOND), 0) + BUCKET_PX;
    const bucketCount = Math.ceil(totalWidth / BUCKET_PX);
    const sums = new Array(bucketCount).fill(0);
    const counts = new Array(bucketCount).fill(0);
    for (const f of frames) {
      const x = (f.t / 1000) * PX_PER_SECOND;
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(x / BUCKET_PX)));
      sums[idx] += f.rms;
      counts[idx] += 1;
    }
    return (
      <>
        {sums.map((sum, i) => {
          if (!counts[i]) return null;
          const avg = sum / counts[i];
          const height = Math.max(1, (avg / maxRms) * DATA_BAR_HEIGHT);
          return (
            <View
              key={i}
              style={{
                position: 'absolute', left: i * BUCKET_PX, bottom: 0,
                width: BUCKET_PX - 0.5, height, backgroundColor: theme.accent, opacity: 0.8,
              }}
            />
          );
        })}
      </>
    );
  }

  // Pitch Bend — cents deviation from the nearest equal-tempered semitone per frame,
  // a real per-frame metric (bend/embouchure accuracy), bipolar around a center line.
  const CENTER = DATA_BAR_HEIGHT / 2;
  const BUCKET_PX = 4;
  const totalWidth = maxOf(frames.map((f) => (f.t / 1000) * PX_PER_SECOND), 0) + BUCKET_PX;
  const bucketCount = Math.ceil(totalWidth / BUCKET_PX);
  const sums = new Array(bucketCount).fill(0);
  const counts = new Array(bucketCount).fill(0);
  for (const f of frames) {
    if (!isFinite(f.frequency) || f.frequency <= 0) continue;
    const midi = 69 + 12 * Math.log2(f.frequency / 440);
    const cents = (midi - Math.round(midi)) * 100;
    const x = (f.t / 1000) * PX_PER_SECOND;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(x / BUCKET_PX)));
    sums[idx] += cents;
    counts[idx] += 1;
  }
  return (
    <>
      <View style={{ position: 'absolute', left: 0, right: 0, top: CENTER, height: 1, backgroundColor: theme.border }} />
      {sums.map((sum, i) => {
        if (!counts[i]) return null;
        const avgCents = sum / counts[i];
        const h = Math.min(CENTER, (Math.abs(avgCents) / 50) * CENTER);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: i * BUCKET_PX,
              top: avgCents >= 0 ? CENTER - h : CENTER,
              width: BUCKET_PX - 0.5,
              height: h,
              backgroundColor: avgCents >= 0 ? theme.accent : theme.record,
              opacity: 0.8,
            }}
          />
        );
      })}
    </>
  );
}

// ─── Note block ─────────────────────────────────────────────────────────────────

interface NoteBlockProps {
  note:         TabNote;
  rowIndex:     number;
  positions:    PlayablePosition[];
  bpm:          number;
  snapDivision: SnapDivision;
  isSelected:   boolean;
  onSelect:     (id: string) => void;
  onUpdate:     (id: string, changes: NoteUpdate) => void;
  onDelete:     (id: string) => void;
  theme:        Theme;
  styles:       ReturnType<typeof createStyles>;
}

function PianoRollNoteBlock({
  note, rowIndex, positions, bpm, snapDivision, isSelected, onSelect, onUpdate, onDelete, theme, styles,
}: NoteBlockProps) {
  // react-native-gesture-handler's Gesture.Pan() instead of the old PanResponder —
  // PanResponder turned out unreliable on web for two compounding reasons: (1) it only
  // won the responder negotiation intermittently without explicit capture-phase handlers,
  // and (2) dragging over the note's own <Text> label could trigger the browser's native
  // text-selection/drag, hijacking the mouse-move mid-gesture (hence "sometimes works,
  // sometimes doesn't" — it depended on exactly where the mouse landed). RNGH is the
  // gesture system already proven in this app (it's what drives list drag-to-reorder),
  // runs its recognizer independently of native text selection, and — since the gesture
  // is rebuilt fresh every render rather than frozen once — its callbacks close over the
  // current `note`/`rowIndex`/`positions`/etc directly, no ref-juggling required.
  const translateX  = useSharedValue(0);
  const translateY  = useSharedValue(0);
  const resizeDelta = useSharedValue(0);

  function commitMove(dxPx: number, dyPx: number) {
    const dtMs      = (dxPx / PX_PER_SECOND) * 1000;
    const rawStart  = Math.max(0, Math.round(note.start_time + dtMs));
    const newStart  = snapMsToGrid(rawStart, snapDivision, bpm);
    const rowDelta  = Math.round(dyPx / ROW_HEIGHT);
    const newRow    = Math.min(positions.length - 1, Math.max(0, rowIndex + rowDelta));
    const newPos    = positions[newRow];

    const changes: NoteUpdate = {};
    if (newStart !== note.start_time) changes.start_time = newStart;
    if (newPos.tab !== note.tab) { changes.tab = newPos.tab; changes.note = newPos.note; }
    if (Object.keys(changes).length > 0) onUpdate(note.id, changes);
  }

  function commitResize(dxPx: number) {
    const dMs = (dxPx / PX_PER_SECOND) * 1000;
    const newDuration = Math.max(MIN_DURATION_MS, Math.round(note.duration + dMs));
    if (newDuration !== note.duration) onUpdate(note.id, { duration: newDuration });
  }

  const moveGesture = Gesture.Pan()
    .onStart(() => { runOnJS(onSelect)(note.id); })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd((e) => { runOnJS(commitMove)(e.translationX, e.translationY); })
    .onFinalize(() => {
      translateX.value = 0;
      translateY.value = 0;
    });

  const resizeGesture = Gesture.Pan()
    .onStart(() => { runOnJS(onSelect)(note.id); })
    .onUpdate((e) => { resizeDelta.value = e.translationX; })
    .onEnd((e) => { runOnJS(commitResize)(e.translationX); })
    .onFinalize(() => { resizeDelta.value = 0; });

  // Horizontal (time) follows the finger continuously; vertical (pitch) snaps to whole
  // rows during the drag itself (computed on the UI thread, inside the worklet) rather
  // than sliding smoothly between them.
  const moveAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: Math.round(translateY.value / ROW_HEIGHT) * ROW_HEIGHT },
    ],
  }));
  const widthAnimatedStyle = useAnimatedStyle(() => ({
    width: Math.max(14, (note.duration / 1000) * PX_PER_SECOND + resizeDelta.value),
  }));

  const left   = (note.start_time / 1000) * PX_PER_SECOND;
  const top    = rowIndex * ROW_HEIGHT + BLOCK_MARGIN / 2;
  const width  = Math.max(14, (note.duration / 1000) * PX_PER_SECOND);
  const height = ROW_HEIGHT - BLOCK_MARGIN;

  return (
    <GestureDetector gesture={moveGesture}>
      <Animated.View
        style={[
          styles.noteBlock,
          { left, top, width, height, opacity: 0.4 + (note.confidence / 100) * 0.6 },
          isSelected && styles.noteBlockSelected,
          moveAnimatedStyle,
          widthAnimatedStyle,
        ]}
      >
        <View style={styles.noteBlockBody}>
          <Text style={styles.noteBlockText} numberOfLines={1} selectable={false}>{note.tab}</Text>
        </View>

        {isSelected && (
          <Pressable
            onPress={() => onDelete(note.id)}
            style={styles.noteDeleteBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete note"
          >
            <Ionicons name="close" size={11} color="#fff" />
          </Pressable>
        )}

        <GestureDetector gesture={resizeGesture}>
          <View style={styles.resizeHandle} />
        </GestureDetector>
      </Animated.View>
    </GestureDetector>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    // Distinct panel background so the piano-roll reads as its own canvas, not just more
    // page chrome — the zebra row stripes below switch to surfaceAlt accordingly, since
    // they'd otherwise blend into a same-colored parent.
    outer: {
      flex:            1,
      gap:             8,
      backgroundColor: t.surface,
      borderRadius:    12,
      borderWidth:     1,
      borderColor:     t.border,
      padding:         10,
    },

    toolbarRow: { flexDirection: 'row', justifyContent: 'flex-end' },
    snapBtn: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingHorizontal: 10,
      paddingVertical:   6,
      borderRadius:      8,
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    snapBtnText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },

    // Clear boundary between the bar ruler and the grid below it — was just a small gap.
    rulerClip: {
      height: RULER_HEIGHT,
      marginLeft: LABEL_WIDTH,
      overflow: 'hidden',
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    rulerContent: { height: RULER_HEIGHT, position: 'relative' },

    gridRow: { flexDirection: 'row', flex: 1 },
    // Clear boundary between the row-label rail and the note grid.
    labelRail: {
      width: LABEL_WIDTH,
      borderRightWidth: 2,
      borderRightColor: t.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
    },
    labelCell: {
      height: ROW_HEIGHT,
      flexDirection:  'row',
      alignItems:     'baseline',
      justifyContent: 'flex-end',
      paddingRight:   8,
    },
    // Sign/number/modifier each get their own fixed-width column (not the tab as one
    // shrink-to-content string) so the hole number itself always lands in the same spot —
    // "3" and "-3'''" both need their digit aligned, even though one ends in a digit and
    // the other in a bend mark. Numbers are right-aligned within their column so single-
    // vs double-digit holes (e.g. "3" vs "10") line up on the ones digit too.
    labelTabSign:     { width: 7,  fontSize: 11, fontFamily: Poppins.extraBold, color: t.accent, textAlign: 'right' },
    labelTabNumber:   { width: 14, fontSize: 11, fontFamily: Poppins.extraBold, color: t.accent, textAlign: 'right' },
    labelTabModifier: { width: 20, fontSize: 11, fontFamily: Poppins.extraBold, color: t.accent, textAlign: 'left' },
    labelNote: { width: 28, marginLeft: 4, fontSize: 9, fontFamily: Poppins.regular, color: t.textMuted, textAlign: 'right' },
    gridVScroll: { flex: 1 },

    grid: { position: 'relative' },
    // No per-row border by default — the natural/sharp shading below carries the visual
    // rhythm (like a piano's white/black keys), matching the reference's near-invisible
    // row lines. Only the octave boundary gets an actual line (see below).
    rowStripe: {
      position: 'absolute',
      left: 0,
      height: ROW_HEIGHT,
      backgroundColor: 'transparent',
    },
    rowStripeAlt: { backgroundColor: t.surfaceAlt },
    // Heavier divider where the octave number actually changes (e.g. B4 -> C5) —
    // a structural landmark, distinct from the plain per-row separator line.
    octaveBoundary: {
      borderBottomWidth: 1.5,
      borderBottomColor: t.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.13)',
    },

    playheadLine: {
      position: 'absolute',
      top: 0,
      width: 1.5,
      backgroundColor: t.record,
    },

    noteBlock: {
      position: 'absolute',
      backgroundColor: t.accent,
      borderRadius: 5,
      justifyContent: 'center',
      ...(Platform.OS === 'web' ? { cursor: 'grab' } : null),
    } as any,
    noteBlockSelected: {
      borderWidth: 1.5,
      borderColor: t.textPrimary,
    },
    noteBlockBody: { flex: 1, justifyContent: 'center', paddingLeft: 6, overflow: 'hidden' },
    noteBlockText: { fontSize: 9, fontFamily: Poppins.bold, color: '#fff' },
    noteDeleteBtn: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: t.record,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resizeHandle: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: RESIZE_HANDLE_W,
      ...(Platform.OS === 'web' ? { cursor: 'ew-resize' } : null),
    } as any,

    dataPanel: {
      height: DATA_BAR_HEIGHT + 34,
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingTop: 6,
      gap: 6,
    },
    dataPanelTabs: { flexDirection: 'row', gap: 14, paddingHorizontal: 4 },
    dataTab: { paddingVertical: 2 },
    dataTabText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textMuted },
    dataTabTextActive: { color: t.accent },
    dataBarClip: { height: DATA_BAR_HEIGHT, marginLeft: LABEL_WIDTH, overflow: 'hidden' },
    dataBarContent: { height: DATA_BAR_HEIGHT, position: 'relative' },
  });
}
