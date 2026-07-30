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
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { getPlayablePositions, type PlayablePosition } from '@/audio/HarmonicaMapper';
import { getFrames } from '@/audio/frameBuffer';
import { selectRecordingId, useAppStore } from '@/store/useAppStore';
import { selectRecordings, useRecordingsStore } from '@/store/useRecordingsStore';
import { barDurationMs, beatDurationMs, BEATS_PER_BAR, msToBar, snapDivisionMs, snapMsToGrid, type SnapDivision } from '@/audio/tempo';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

const ROW_HEIGHT       = 28;
const LABEL_WIDTH       = 88;
const DEFAULT_PX_PER_SECOND = 90;
const MIN_PX_PER_SECOND     = 20;
const MAX_PX_PER_SECOND     = 400;
const MIN_DURATION_MS   = 60;
const NUDGE_TIME_MS     = 50;
const BLOCK_MARGIN      = 4;
const RESIZE_HANDLE_W   = 10;
const RULER_HEIGHT      = 30;
const DATA_BAR_HEIGHT   = 64;
const DATA_PANEL_TABS_HEIGHT = 34;
const DATA_PANEL_COLLAPSED_HEIGHT = DATA_PANEL_TABS_HEIGHT;
const DATA_PANEL_EXPANDED_HEIGHT  = DATA_BAR_HEIGHT + DATA_PANEL_TABS_HEIGHT;

const SNAP_CYCLE: SnapDivision[] = ['off', 4, 8, 16];
const SNAP_LABELS: Record<SnapDivision, string> = { off: 'Off', 4: '1/4', 8: '1/8', 16: '1/16' };

// Theme-invariant like accent/record/success/warning (same hex in both light and dark) —
// the quiet "nothing to flag" state for a note block, so it doesn't need its own Theme
// token when nothing else in the app reuses it. Zinc-500, sits between the app's zinc
// surface family and gives decent white-text contrast in both themes.
const NEUTRAL_NOTE_COLOR = '#71717A';

// Matches the existing "Add Note" toolbar button's default (edit.tsx) — the pencil tool's
// click-to-create uses the same baseline duration for consistency.
const DEFAULT_NEW_NOTE_DURATION_MS = 300;

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
  onCreate:       (note: Omit<TabNote, 'id'>) => void;
  onUpdate:       (id: string, changes: NoteUpdate) => void;
  onDelete:       (id: string) => void;
  isPlaying:      boolean;
  currentTimeMs:  number;
  onSeek:         (ms: number) => void;
}

export function PianoRoll({
  notes, harmonicaKey, harmonicaType, bpm, selectedId, onSelect, onCreate, onUpdate, onDelete, isPlaying, currentTimeMs, onSeek,
}: PianoRollProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [snapDivision, setSnapDivision] = useState<SnapDivision>(8);
  const [metricTab, setMetricTab] = useState<'breath' | 'duration' | 'confidence' | 'pitchBend'>('breath');
  const [scrollX, setScrollX] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const panelHeight = useSharedValue(DATA_PANEL_EXPANDED_HEIGHT);
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);

  // Pencil = click empty grid to create a note, drag existing notes to move/resize them
  // (today's behavior). Selection = marquee-drag to multi-select, individual notes aren't
  // directly draggable — matches Signal's mouseMode split. `selectedIds` (marquee, local
  // to this component) is intentionally separate from the `selectedId` prop (single,
  // shared with the parent/list view) rather than trying to unify them.
  const [mouseMode, setMouseMode] = useState<'pencil' | 'selection'>('pencil');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const mouseModeRef   = useRef(mouseMode);   mouseModeRef.current   = mouseMode;
  const selectedIdsRef = useRef(selectedIds); selectedIdsRef.current = selectedIds;

  function handleSetMouseMode(mode: 'pencil' | 'selection') {
    setMouseMode(mode);
    setSelectedIds([]);
  }

  // Marquee drag preview — driven entirely on the UI thread via shared values (like the
  // note-block drag previews below) rather than React state, since onUpdate fires at
  // gesture-frame frequency; only the final onEnd commits into real state (setSelectedIds).
  const marqueeAnchorX = useSharedValue(0);
  const marqueeAnchorY = useSharedValue(0);
  const marqueeX = useSharedValue(0);
  const marqueeY = useSharedValue(0);
  const marqueeW = useSharedValue(0);
  const marqueeH = useSharedValue(0);
  const marqueeAnimatedStyle = useAnimatedStyle(() => ({
    left: marqueeX.value, top: marqueeY.value, width: marqueeW.value, height: marqueeH.value,
  }));

  const hScrollRef = useRef<ScrollView>(null);
  const snapBtnRef = useRef<View>(null);
  // Mirrors read inside the wheel handler below — that handler is registered once (empty
  // effect deps) via a raw DOM listener, so it can't close over fresh state each render
  // the way a normal event prop could; refs kept in sync on every render instead.
  const scrollXRef      = useRef(scrollX);      scrollXRef.current      = scrollX;
  const pxPerSecondRef  = useRef(pxPerSecond);  pxPerSecondRef.current  = pxPerSecond;
  // Set right before any programmatic scrollTo (zoom recentering, playhead autoscroll) so
  // the resulting onScroll callback doesn't mistake it for the user manually scrolling.
  const isProgrammaticScrollRef = useRef(false);
  const autoScrollEnabledRef    = useRef(true);

  function togglePanelCollapsed() {
    const next = !panelCollapsed;
    setPanelCollapsed(next);
    panelHeight.value = withTiming(next ? DATA_PANEL_COLLAPSED_HEIGHT : DATA_PANEL_EXPANDED_HEIGHT, { duration: 200 });
  }
  const panelAnimatedStyle = useAnimatedStyle(() => ({ height: panelHeight.value }));

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
  const dataWidth  = (totalMs / 1000) * pxPerSecond + 120;
  const gridWidth  = Math.max(viewportWidth || 600, dataWidth);
  const gridHeight = positions.length * ROW_HEIGHT;

  // Only mount note blocks (and their gesture detectors) for notes actually near the
  // visible time window — with real gesture-handler instances per note, mounting all of
  // them regardless of scroll position is the thing most likely to make a long recording
  // feel sluggish. The margin keeps notes from popping in/out abruptly right at the edge.
  const CULL_MARGIN_MS = 2000;
  const visibleStartMs = (scrollX / pxPerSecond) * 1000 - CULL_MARGIN_MS;
  const visibleEndMs   = ((scrollX + (viewportWidth || gridWidth)) / pxPerSecond) * 1000 + CULL_MARGIN_MS;
  const visibleNotes = useMemo(
    () => notes.filter((n) => n.start_time + n.duration >= visibleStartMs && n.start_time <= visibleEndMs),
    [notes, visibleStartMs, visibleEndMs],
  );

  // Shared by the marquee hit-test and the group-selection bounding box — content-space
  // {left, top, width, height} for a note, or null if its tab doesn't match a playable
  // row (shouldn't normally happen, but positions can lag a stale note during a key change).
  function noteBounds(note: TabNote): { left: number; top: number; width: number; height: number } | null {
    const rowIndex = positions.findIndex((p) => p.tab === note.tab);
    if (rowIndex === -1) return null;
    const left = (note.start_time / 1000) * pxPerSecond;
    const width = Math.max(14, (note.duration / 1000) * pxPerSecond);
    return { left, top: rowIndex * ROW_HEIGHT, width, height: ROW_HEIGHT };
  }

  // Pencil tool: tapping empty grid background creates a note at the tapped time/row,
  // quantized to the active snap grid, and selects it — mirrors Signal's "click to place
  // a note" but without chaining straight into a drag (kept as a separate follow-up
  // gesture, simpler and less error-prone than reusing the same mousedown for both).
  function handleCreateNoteAt(x: number, y: number) {
    if (positions.length === 0) return;
    const rowIndex = Math.min(positions.length - 1, Math.max(0, Math.floor(y / ROW_HEIGHT)));
    const pos = positions[rowIndex];
    const rawStart = Math.max(0, (x / pxPerSecond) * 1000);
    const start = snapMsToGrid(Math.round(rawStart), snapDivision, bpm);
    onCreate({ tab: pos.tab, note: pos.note, start_time: start, duration: DEFAULT_NEW_NOTE_DURATION_MS, confidence: 100 });
    const updated = useAppStore.getState().tabNotes;
    const created = updated[updated.length - 1];
    if (created) onSelect(created.id);
  }

  // Selection tool: commits a completed marquee drag (content-space corners) into a set
  // of selected note ids — any note whose rect overlaps the marquee rect at all.
  function commitMarquee(x0: number, y0: number, x1: number, y1: number) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const matched = notes.filter((n) => {
      const b = noteBounds(n);
      return b !== null && b.left < right && b.left + b.width > left && b.top < bottom && b.top + b.height > top;
    });
    setSelectedIds(matched.map((n) => n.id));
  }

  function handleGridScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setScrollX(e.nativeEvent.contentOffset.x);
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
    } else {
      // A genuine user-driven scroll relinquishes autoscroll until the next playback start.
      autoScrollEnabledRef.current = false;
    }
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
      // Tool shortcuts, matching Signal's [1]/[2] — work regardless of selection.
      if (e.key === '1') { setMouseMode('pencil'); setSelectedIds([]); return; }
      if (e.key === '2') { setMouseMode('selection'); return; }

      // Selection-mode delete operates on the marquee set, not the single selectedId —
      // the two selection models are mode-scoped, not merged (see mouseMode state above).
      if (mouseModeRef.current === 'selection') {
        if ((e.key === 'Backspace' || e.key === 'Delete') && selectedIdsRef.current.length > 0) {
          e.preventDefault();
          selectedIdsRef.current.forEach((sid) => onDelete(sid));
          setSelectedIds([]);
        }
        return;
      }

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

  // Option/Alt + scroll to zoom, cursor-anchored so the timestamp under the pointer stays
  // fixed on screen as the scale changes (the same technique used by Signal/most DAWs) —
  // a flat zoom-from-the-left-edge feels wrong the moment you're zoomed into the middle of
  // a long recording. Registered once as a raw DOM listener (not the `onWheel` prop) since
  // React attaches wheel/touch listeners as passive by default, which silently ignores
  // `preventDefault()` — needed here to stop the browser's native scroll-on-wheel.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = (hScrollRef.current as unknown as { getScrollableNode?: () => HTMLElement })
      ?.getScrollableNode?.();
    if (!node) return;

    // Real mouse wheels report deltas as whole multiples of 120 ("notches"); trackpads
    // send many smaller, non-multiple-of-120 deltas for the same physical gesture — used
    // to scale the zoom-per-event so it feels similarly paced on either input device.
    function isMouseWheelNotch(e: WheelEvent): boolean {
      const legacyDelta = (e as unknown as { wheelDeltaY?: number }).wheelDeltaY;
      return typeof legacyDelta === 'number' && Number.isInteger(e.deltaY) && legacyDelta % 120 === 0;
    }

    function onWheel(e: WheelEvent) {
      if (!e.altKey) return;
      e.preventDefault();

      const rect = node!.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const oldPx = pxPerSecondRef.current;
      const oldScrollX = scrollXRef.current;

      const scaleFactor = isMouseWheelNotch(e) ? 0.01 : -0.01;
      // Clamped per-event so a fast trackpad flick can't make zoom feel like it's
      // accelerating out of control — the clamp alone gives a smooth feel, no easing needed.
      const rawDelta = Math.max(-0.15, Math.min(0.15, e.deltaY * scaleFactor));
      const newPx = Math.max(MIN_PX_PER_SECOND, Math.min(MAX_PX_PER_SECOND, oldPx * (1 + rawDelta)));
      if (newPx === oldPx) return;

      const cursorTimeMs = ((oldScrollX + cursorX) / oldPx) * 1000;
      const newScrollX = Math.max(0, (cursorTimeMs / 1000) * newPx - cursorX);

      setPxPerSecond(newPx);
      setScrollX(newScrollX);
      isProgrammaticScrollRef.current = true;
      hScrollRef.current?.scrollTo({ x: newScrollX, animated: false });
    }

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  // Auto-scroll to keep the playhead in view during playback — jump-scrolls once the
  // playhead nears the right edge rather than continuously chasing it, and backs off the
  // moment the user manually scrolls (handleGridScroll clears autoScrollEnabledRef),
  // re-arming only when a new playback starts.
  const wasPlayingRef = useRef(isPlaying);
  useEffect(() => {
    if (isPlaying && !wasPlayingRef.current) autoScrollEnabledRef.current = true;
    wasPlayingRef.current = isPlaying;

    if (Platform.OS !== 'web' || !isPlaying || !autoScrollEnabledRef.current || viewportWidth === 0) return;

    const playheadLeftNow = (currentTimeMs / 1000) * pxPerSecond;
    const playheadViewportX = playheadLeftNow - scrollX;
    const scrollZone = viewportWidth * 0.7;
    if (playheadViewportX < 0 || playheadViewportX > scrollZone) {
      const newScrollX = Math.max(0, playheadLeftNow - viewportWidth * 0.1);
      isProgrammaticScrollRef.current = true;
      setScrollX(newScrollX);
      hScrollRef.current?.scrollTo({ x: newScrollX, animated: false });
    }
  }, [currentTimeMs, isPlaying, pxPerSecond, scrollX, viewportWidth]);

  // Hover the Snap button + scroll to step through divisions — a lower-chrome way to
  // change a stepped value than clicking repeatedly, without adding a dropdown.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = snapBtnRef.current as unknown as HTMLElement | null;
    if (!node) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      setSnapDivision((prev) => {
        const i = SNAP_CYCLE.indexOf(prev);
        return SNAP_CYCLE[(i + dir + SNAP_CYCLE.length) % SNAP_CYCLE.length];
      });
    }

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  if (!harmonicaKey || positions.length === 0) return null;

  const playheadLeft = (currentTimeMs / 1000) * pxPerSecond;
  const showPlayhead = isPlaying || currentTimeMs > 0;

  // Click the ruler to move the playhead there (no-op while actively playing — see the
  // comment on usePlayback's seek). Attached directly to rulerContent, which is sized to
  // gridWidth and only visually shifted via a transform for scroll-sync, so the gesture's
  // local x is already in the same content-space coordinates as bar/note positions —
  // no manual scrollX offset needed, same reasoning as the grid's own background gesture.
  const rulerTapGesture = Gesture.Tap().onEnd((e, success) => {
    if (success) runOnJS(onSeek)(Math.max(0, (e.x / pxPerSecond) * 1000));
  });

  // Bounding box of the current marquee selection, for the draggable group-move overlay
  // below — shown for 1+ selected notes (matching Signal, which shows the selection
  // overlay/handles even for a lone selected note, not just 2+).
  const selectedGroupBounds = (() => {
    if (selectedIds.length === 0) return null;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const id of selectedIds) {
      const note = notes.find((n) => n.id === id);
      const b = note && noteBounds(note);
      if (!b) continue;
      left = Math.min(left, b.left); right = Math.max(right, b.left + b.width);
      top = Math.min(top, b.top);   bottom = Math.max(bottom, b.top + b.height);
    }
    return left === Infinity ? null : { left, top, width: right - left, height: bottom - top };
  })();

  // Grid-background gesture — rebuilt each render (same convention as the note-block
  // gestures below) so it always closes over the current pxPerSecond/snapDivision/etc.
  // Pencil: tap empty background to create a note. Selection: drag to marquee-select —
  // individual notes have no gesture of their own in this mode (see `interactive` below),
  // so a drag starting on top of a note still reaches this handler, matching Signal.
  const backgroundGesture = mouseMode === 'pencil'
    ? Gesture.Tap().onEnd((e, success) => {
        if (success) runOnJS(handleCreateNoteAt)(e.x, e.y);
      })
    : Gesture.Pan()
        .onStart((e) => {
          marqueeAnchorX.value = e.x;
          marqueeAnchorY.value = e.y;
          marqueeX.value = e.x;
          marqueeY.value = e.y;
          marqueeW.value = 0;
          marqueeH.value = 0;
        })
        .onUpdate((e) => {
          marqueeX.value = Math.min(marqueeAnchorX.value, marqueeAnchorX.value + e.translationX);
          marqueeY.value = Math.min(marqueeAnchorY.value, marqueeAnchorY.value + e.translationY);
          marqueeW.value = Math.abs(e.translationX);
          marqueeH.value = Math.abs(e.translationY);
        })
        .onEnd((e) => {
          const x0 = marqueeAnchorX.value;
          const y0 = marqueeAnchorY.value;
          runOnJS(commitMarquee)(x0, y0, x0 + e.translationX, y0 + e.translationY);
        })
        .onFinalize(() => {
          marqueeW.value = 0;
          marqueeH.value = 0;
        });

  return (
    <View style={styles.outer} onLayout={handleViewportLayout}>
      {/* Tool + snap controls */}
      <View style={styles.toolbarRow}>
        <View style={styles.toolToggle}>
          <Pressable
            onPress={() => handleSetMouseMode('pencil')}
            style={[styles.toolToggleSeg, mouseMode === 'pencil' && styles.toolToggleSegActive]}
            accessibilityRole="radio"
            accessibilityState={{ checked: mouseMode === 'pencil' }}
            accessibilityLabel="Pencil tool — click to create notes, drag to move or resize [1]"
          >
            <Ionicons name="pencil" size={13} color={mouseMode === 'pencil' ? '#fff' : theme.textSub} />
            <Text style={[styles.toolToggleText, mouseMode === 'pencil' && styles.toolToggleTextActive]}>Pencil</Text>
          </Pressable>
          <Pressable
            onPress={() => handleSetMouseMode('selection')}
            style={[styles.toolToggleSeg, mouseMode === 'selection' && styles.toolToggleSegActive]}
            accessibilityRole="radio"
            accessibilityState={{ checked: mouseMode === 'selection' }}
            accessibilityLabel="Selection tool — drag to select multiple notes [2]"
          >
            <Ionicons name="scan-outline" size={13} color={mouseMode === 'selection' ? '#fff' : theme.textSub} />
            <Text style={[styles.toolToggleText, mouseMode === 'selection' && styles.toolToggleTextActive]}>Select</Text>
          </Pressable>
        </View>

        <Pressable
          ref={snapBtnRef}
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
        <GestureDetector gesture={rulerTapGesture}>
          <View style={[styles.rulerContent, { width: gridWidth, transform: [{ translateX: -scrollX }] }]}>
            <BarRuler bpm={bpm} durationMs={totalMs} pxPerSecond={pxPerSecond} theme={theme} />
            {showPlayhead && (
              <View pointerEvents="none" style={[styles.playheadWrap, { left: playheadLeft - 4 }]}>
                <View style={styles.playheadFlag} />
                <View style={[styles.playheadRulerLine, { height: RULER_HEIGHT - 10 }]} />
              </View>
            )}
          </View>
        </GestureDetector>
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
            ref={hScrollRef}
            horizontal
            showsHorizontalScrollIndicator={Platform.OS === 'web'}
            onScroll={handleGridScroll}
            scrollEventThrottle={16}
          >
            <GestureDetector gesture={backgroundGesture}>
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

                <BeatGridLines
                  bpm={bpm}
                  durationMs={totalMs}
                  pxPerSecond={pxPerSecond}
                  height={gridHeight}
                  theme={theme}
                  snapDivision={snapDivision}
                />

                {visibleNotes.map((note) => {
                  // Marquee-selected notes render as live-following ghosts inside
                  // GroupSelectionOverlay instead, so they visually move with the drag in
                  // real time rather than staying frozen until the gesture commits.
                  if (mouseMode === 'selection' && selectedIds.includes(note.id)) return null;
                  const rowIndex = positions.findIndex((p) => p.tab === note.tab);
                  if (rowIndex === -1) return null;
                  return (
                    <PianoRollNoteBlock
                      key={note.id}
                      note={note}
                      rowIndex={rowIndex}
                      positions={positions}
                      bpm={bpm}
                      pxPerSecond={pxPerSecond}
                      snapDivision={snapDivision}
                      interactive={mouseMode === 'pencil'}
                      isSelected={mouseMode === 'pencil' ? selectedId === note.id : selectedIds.includes(note.id)}
                      onSelect={onSelect}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      theme={theme}
                      styles={styles}
                    />
                  );
                })}

                {showPlayhead && (
                  <View pointerEvents="none" style={[styles.playheadGlow, { left: playheadLeft - 4, height: gridHeight }]} />
                )}
                {showPlayhead && (
                  <View pointerEvents="none" style={[styles.playheadLine, { left: playheadLeft, height: gridHeight }]} />
                )}

                {mouseMode === 'selection' && (
                  <Animated.View pointerEvents="none" style={[styles.marqueeRect, marqueeAnimatedStyle]} />
                )}

                {mouseMode === 'selection' && selectedGroupBounds && (
                  <GroupSelectionOverlay
                    bounds={selectedGroupBounds}
                    selectedNotes={notes.filter((n) => selectedIds.includes(n.id))}
                    positions={positions}
                    bpm={bpm}
                    pxPerSecond={pxPerSecond}
                    snapDivision={snapDivision}
                    onUpdate={onUpdate}
                    theme={theme}
                    styles={styles}
                  />
                )}
              </View>
            </GestureDetector>
          </ScrollView>
        </View>
      </ScrollView>

      {/* Data panel — Breath Force / Duration / Confidence / Pitch Bend, x-synced with the
          grid above. Collapsible so it doesn't permanently eat vertical space when the
          user just wants the note grid. */}
      <Animated.View style={[styles.dataPanel, panelAnimatedStyle]}>
        <View style={styles.dataPanelTabs}>
          {(['breath', 'duration', 'confidence', 'pitchBend'] as const).map((tab) => (
            <Pressable key={tab} onPress={() => setMetricTab(tab)} style={styles.dataTab}>
              <Text style={[styles.dataTabText, metricTab === tab && styles.dataTabTextActive]}>
                {METRIC_LABELS[tab]}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={togglePanelCollapsed}
            style={styles.dataPanelCollapseBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={panelCollapsed ? 'Expand analysis panel' : 'Collapse analysis panel'}
          >
            <Ionicons name={panelCollapsed ? 'chevron-up' : 'chevron-down'} size={14} color={theme.textSub} />
          </Pressable>
        </View>
        <View style={styles.dataBarClip}>
          <View style={[styles.dataBarContent, { width: gridWidth, transform: [{ translateX: -scrollX }] }]}>
            <DataPanelBars
              metric={metricTab}
              notes={notes}
              frames={frames}
              positions={positions}
              pxPerSecond={pxPerSecond}
              theme={theme}
            />
          </View>
        </View>
      </Animated.View>
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
          <Text style={{ fontSize: 12, fontFamily: Poppins.bold, color: theme.textSub, marginBottom: 3 }}>
            {msToBar(bar * barMs, bpm).toFixed(0)}
          </Text>
          <View style={{ width: 1.5, height: 10, backgroundColor: theme.textSub }} />
        </View>
      ))}
    </>
  );
}

// Real vertical gridlines behind the notes — three tiers: heavier per-bar (aligned with
// the ruler's bar ticks above), lighter per-beat, and (when snap is on) lightest per-
// subdivision, matching the active snap grid. Previously the grid had no vertical
// structure at all.
function BeatGridLines({ bpm, durationMs, pxPerSecond, height, theme, snapDivision }: {
  bpm: number; durationMs: number; pxPerSecond: number; height: number; theme: Theme;
  snapDivision: SnapDivision;
}) {
  const beatMs    = beatDurationMs(bpm);
  const pxPerBeat = (beatMs / 1000) * pxPerSecond;
  const totalBeats = Math.ceil(durationMs / beatMs) + BEATS_PER_BAR * 2;

  const subMs = snapDivisionMs(snapDivision, bpm);
  const subdivisionLines: number[] = [];
  if (subMs) {
    const pxPerSub = (subMs / 1000) * pxPerSecond;
    const totalSubs = Math.ceil(durationMs / subMs) + BEATS_PER_BAR * 4;
    for (let s = 0; s <= totalSubs; s++) {
      // Skip ticks that land on (or effectively on) a beat line — those are drawn by the
      // stronger tier below, a subdivision line under it would just be wasted opacity.
      if (Math.abs((s * pxPerSub) % pxPerBeat) > 1) subdivisionLines.push(s * pxPerSub);
    }
  }

  const lines: { x: number; isBar: boolean }[] = [];
  for (let b = 0; b <= totalBeats; b++) {
    lines.push({ x: b * pxPerBeat, isBar: b % BEATS_PER_BAR === 0 });
  }

  return (
    <>
      {subdivisionLines.map((x, i) => (
        <View
          key={`sub-${i}`}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: x, width: 1, height, backgroundColor: theme.separator, opacity: 0.35 }}
        />
      ))}
      {lines.map((l, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: l.x,
            width: l.isBar ? 1.5 : 1,
            height,
            backgroundColor: l.isBar ? theme.textMuted : theme.separator,
            opacity: l.isBar ? 0.9 : 0.6,
          }}
        />
      ))}
    </>
  );
}

// ─── Data panel bars ───────────────────────────────────────────────────────────

function DataPanelBars({ metric, notes, frames, positions, pxPerSecond, theme }: {
  metric: 'breath' | 'duration' | 'confidence' | 'pitchBend';
  notes: TabNote[];
  frames: ReturnType<typeof getFrames>;
  positions: PlayablePosition[];
  pxPerSecond: number;
  theme: Theme;
}) {
  if (metric === 'duration' || metric === 'confidence') {
    const maxVal = metric === 'duration' ? maxOf(notes.map((n) => n.duration), 1) : 100;
    return (
      <>
        {notes.map((n) => {
          const left = (n.start_time / 1000) * pxPerSecond;
          const width = Math.max(2, (n.duration / 1000) * pxPerSecond - 2);
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
    const totalWidth = maxOf(frames.map((f) => (f.t / 1000) * pxPerSecond), 0) + BUCKET_PX;
    const bucketCount = Math.ceil(totalWidth / BUCKET_PX);
    const sums = new Array(bucketCount).fill(0);
    const counts = new Array(bucketCount).fill(0);
    for (const f of frames) {
      const x = (f.t / 1000) * pxPerSecond;
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
  const totalWidth = maxOf(frames.map((f) => (f.t / 1000) * pxPerSecond), 0) + BUCKET_PX;
  const bucketCount = Math.ceil(totalWidth / BUCKET_PX);
  const sums = new Array(bucketCount).fill(0);
  const counts = new Array(bucketCount).fill(0);
  for (const f of frames) {
    if (!isFinite(f.frequency) || f.frequency <= 0) continue;
    const midi = 69 + 12 * Math.log2(f.frequency / 440);
    const cents = (midi - Math.round(midi)) * 100;
    const x = (f.t / 1000) * pxPerSecond;
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
  pxPerSecond:  number;
  snapDivision: SnapDivision;
  isSelected:   boolean;
  // False while the Selection tool is active — the note renders as a static visual only,
  // with no gesture/handles/pill of its own, so a drag starting on top of it still reaches
  // the parent grid's marquee gesture instead. Matches Signal (per-note hit areas only
  // exist in pencil mode).
  interactive:  boolean;
  onSelect:     (id: string) => void;
  onUpdate:     (id: string, changes: NoteUpdate) => void;
  onDelete:     (id: string) => void;
  theme:        Theme;
  styles:       ReturnType<typeof createStyles>;
}

// Fill color by state — selection always wins (the active focus), otherwise banded by
// detection confidence since the app has no explicit validation flag today: high
// confidence reads as "validated," low confidence as "invalid," everything in between
// stays a quiet neutral gray so only the exceptions actually call for attention.
function noteFillColor(note: TabNote, isSelected: boolean, theme: Theme): string {
  if (isSelected) return theme.accent;
  if (note.confidence >= 85) return theme.success;
  if (note.confidence >= 60) return NEUTRAL_NOTE_COLOR;
  if (note.confidence >= 35) return theme.warning;
  return theme.record;
}

function PianoRollNoteBlock({
  note, rowIndex, positions, bpm, pxPerSecond, snapDivision, isSelected, interactive, onSelect, onUpdate, onDelete, theme, styles,
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
  const translateX      = useSharedValue(0);
  const translateY      = useSharedValue(0);
  const resizeDelta     = useSharedValue(0);
  const resizeLeftDelta = useSharedValue(0);
  const [hovered, setHovered] = useState(false);

  function commitMove(dxPx: number, dyPx: number) {
    const dtMs      = (dxPx / pxPerSecond) * 1000;
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

  // Right handle — end time follows the drag, start stays fixed.
  function commitResizeRight(dxPx: number) {
    const dMs = (dxPx / pxPerSecond) * 1000;
    const newDuration = Math.max(MIN_DURATION_MS, Math.round(note.duration + dMs));
    if (newDuration !== note.duration) onUpdate(note.id, { duration: newDuration });
  }

  // Left handle — start time follows the drag, end (start+duration) stays fixed, so the
  // note's right edge doesn't move while its left edge does.
  function commitResizeLeft(dxPx: number) {
    const dtMs = (dxPx / pxPerSecond) * 1000;
    const maxStart = note.start_time + note.duration - MIN_DURATION_MS;
    const newStart = Math.min(maxStart, Math.max(0, Math.round(note.start_time + dtMs)));
    const newDuration = note.start_time + note.duration - newStart;
    if (newStart !== note.start_time || newDuration !== note.duration) {
      onUpdate(note.id, { start_time: newStart, duration: newDuration });
    }
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

  const resizeRightGesture = Gesture.Pan()
    .onStart(() => { runOnJS(onSelect)(note.id); })
    .onUpdate((e) => { resizeDelta.value = e.translationX; })
    .onEnd((e) => { runOnJS(commitResizeRight)(e.translationX); })
    .onFinalize(() => { resizeDelta.value = 0; });

  const resizeLeftGesture = Gesture.Pan()
    .onStart(() => { runOnJS(onSelect)(note.id); })
    .onUpdate((e) => { resizeLeftDelta.value = e.translationX; })
    .onEnd((e) => { runOnJS(commitResizeLeft)(e.translationX); })
    .onFinalize(() => { resizeLeftDelta.value = 0; });

  const left   = (note.start_time / 1000) * pxPerSecond;
  const top    = rowIndex * ROW_HEIGHT + BLOCK_MARGIN / 2;
  const width  = Math.max(14, (note.duration / 1000) * pxPerSecond);
  const height = ROW_HEIGHT - BLOCK_MARGIN;
  const fillColor = noteFillColor(note, isSelected, theme);

  // Horizontal (time) follows the finger continuously; vertical (pitch) snaps to whole
  // rows during the drag itself (computed on the UI thread, inside the worklet) rather
  // than sliding smoothly between them. Computed unconditionally (even in the
  // non-interactive branch below) since hooks can't be called conditionally — harmless,
  // the values just go unused when `interactive` is false.
  const moveAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: Math.round(translateY.value / ROW_HEIGHT) * ROW_HEIGHT },
    ],
  }));
  // Combined into one style (rather than two competing `width`/`left` styles) since a
  // later style in the array fully overrides an earlier one's same-named keys in RN —
  // only one of the two deltas is ever nonzero at a time (one handle dragged at once),
  // but both need to feed the same left/width computation to compose correctly.
  const boxAnimatedStyle = useAnimatedStyle(() => ({
    left: left + resizeLeftDelta.value,
    width: Math.max(14, width - resizeLeftDelta.value + resizeDelta.value),
  }));

  // Selection tool: static visual only — no gesture/handles/pill, so a touch anywhere on
  // this note still reaches the parent grid's marquee gesture instead of moving it.
  if (!interactive) {
    return (
      <View
        style={[
          styles.noteBlock,
          { top, left, width, height, backgroundColor: fillColor, opacity: isSelected ? 1 : 0.4 + (note.confidence / 100) * 0.6 },
          isSelected && styles.noteBlockSelected,
        ]}
      >
        <View style={styles.noteBlockBody}>
          <Text style={styles.noteBlockText} numberOfLines={1} selectable={false}>{note.tab}</Text>
        </View>
      </View>
    );
  }

  return (
    <GestureDetector gesture={moveGesture}>
      <Animated.View
        {...(Platform.OS === 'web'
          ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
          : null)}
        style={[
          styles.noteBlock,
          { top, height, backgroundColor: fillColor, opacity: isSelected ? 1 : 0.4 + (note.confidence / 100) * 0.6 },
          hovered && !isSelected && styles.noteBlockHovered,
          isSelected && styles.noteBlockSelected,
          moveAnimatedStyle,
          boxAnimatedStyle,
        ]}
      >
        <View style={styles.noteBlockBody}>
          <Text style={styles.noteBlockText} numberOfLines={1} selectable={false}>{note.tab}</Text>
        </View>

        {isSelected && (
          <View style={styles.selectionPill}>
            <Text style={styles.selectionPillText} numberOfLines={1}>{note.tab}</Text>
            <Pressable
              onPress={() => onDelete(note.id)}
              style={styles.selectionPillDeleteBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Delete note"
            >
              <Ionicons name="trash-outline" size={11} color={theme.record} />
            </Pressable>
          </View>
        )}

        <GestureDetector gesture={resizeLeftGesture}>
          <View style={styles.resizeHandleLeft} />
        </GestureDetector>
        <GestureDetector gesture={resizeRightGesture}>
          <View style={styles.resizeHandle} />
        </GestureDetector>
      </Animated.View>
    </GestureDetector>
  );
}

// ─── Group selection overlay ────────────────────────────────────────────────────
// Bounding box drawn around the marquee-selected notes with its own center-drag handle —
// mirrors Signal's NoteSelection. Center-move only; group edge-resize (proportionally
// stretching every selected note) is a real chunk more math and was cut from this pass.
//
// The selected notes themselves are excluded from the normal note-rendering loop while
// selected (see the visibleNotes.map filter above) and instead rendered here, as ghost
// ""previews inside the SAME transformed wrapper as the drag handle — that's what makes
// them visually follow the drag in real time rather than jumping to their new position
// only once the gesture commits (onEnd is still what actually writes to the store).
function GroupSelectionOverlay({
  bounds, selectedNotes, positions, bpm, pxPerSecond, snapDivision, onUpdate, theme, styles,
}: {
  bounds: { left: number; top: number; width: number; height: number };
  selectedNotes: TabNote[];
  positions: PlayablePosition[];
  bpm: number;
  pxPerSecond: number;
  snapDivision: SnapDivision;
  onUpdate: (id: string, changes: NoteUpdate) => void;
  theme: Theme;
  styles: ReturnType<typeof createStyles>;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Each note clamps/snaps independently (not a shared group-wide bound) — a reasonable
  // simplification: in the rare case a drag would push part of the group past row 0/max,
  // those notes stop early while the rest keep moving, rather than the whole group being
  // held back by whichever member is closest to the edge.
  function commitGroupMove(dxPx: number, dyPx: number) {
    const dtMs = (dxPx / pxPerSecond) * 1000;
    const rowDelta = Math.round(dyPx / ROW_HEIGHT);
    for (const note of selectedNotes) {
      const rowIndex = positions.findIndex((p) => p.tab === note.tab);
      if (rowIndex === -1) continue;
      const rawStart = Math.max(0, Math.round(note.start_time + dtMs));
      const newStart = snapMsToGrid(rawStart, snapDivision, bpm);
      const newRow = Math.min(positions.length - 1, Math.max(0, rowIndex + rowDelta));
      const newPos = positions[newRow];
      const changes: NoteUpdate = {};
      if (newStart !== note.start_time) changes.start_time = newStart;
      if (newPos.tab !== note.tab) { changes.tab = newPos.tab; changes.note = newPos.note; }
      if (Object.keys(changes).length > 0) onUpdate(note.id, changes);
    }
  }

  const moveGesture = Gesture.Pan()
    .onUpdate((e) => { translateX.value = e.translationX; translateY.value = e.translationY; })
    .onEnd((e) => { runOnJS(commitGroupMove)(e.translationX, e.translationY); })
    .onFinalize(() => { translateX.value = 0; translateY.value = 0; });

  // Same "snap vertical movement to whole rows during the drag" treatment as a single
  // note's own move gesture — horizontal follows the finger continuously.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: Math.round(translateY.value / ROW_HEIGHT) * ROW_HEIGHT },
    ],
  }));

  return (
    // pointerEvents="box-none": the wrapper itself doesn't intercept touches (so clicking
    // outside the rect below still reaches the parent grid's marquee gesture to start a
    // new selection) — only the rect child, which has the actual GestureDetector, does.
    <Animated.View pointerEvents="box-none" style={[styles.groupSelectionWrap, animatedStyle]}>
      <GestureDetector gesture={moveGesture}>
        <View
          style={[
            styles.groupSelectionOverlay,
            { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
          ]}
        />
      </GestureDetector>
      {selectedNotes.map((note) => {
        const rowIndex = positions.findIndex((p) => p.tab === note.tab);
        if (rowIndex === -1) return null;
        const left  = (note.start_time / 1000) * pxPerSecond;
        const width = Math.max(14, (note.duration / 1000) * pxPerSecond);
        return (
          <View
            key={note.id}
            pointerEvents="none"
            style={[
              styles.noteBlock,
              {
                left, width,
                top: rowIndex * ROW_HEIGHT + BLOCK_MARGIN / 2,
                height: ROW_HEIGHT - BLOCK_MARGIN,
                backgroundColor: theme.accent,
              },
              styles.noteBlockSelected,
            ]}
          >
            <View style={styles.noteBlockBody}>
              <Text style={styles.noteBlockText} numberOfLines={1} selectable={false}>{note.tab}</Text>
            </View>
          </View>
        );
      })}
    </Animated.View>
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

    toolbarRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
    // Pencil/Selection segmented toggle — same visual language as the List/Piano Roll
    // toggle elsewhere in the app, placed immediately left of Snap (matches Signal, whose
    // tool selector sits directly beside its quantize control).
    toolToggle: {
      flexDirection:   'row',
      backgroundColor: t.surface,
      borderRadius:    8,
      padding:         2,
      gap:             2,
    },
    toolToggleSeg: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               5,
      paddingVertical:   6,
      paddingHorizontal: 10,
      borderRadius:      6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    toolToggleSegActive: { backgroundColor: t.accent },
    toolToggleText:       { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    toolToggleTextActive: { color: '#fff' },
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
    rulerContent: {
      height: RULER_HEIGHT,
      position: 'relative',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,

    gridRow: { flexDirection: 'row', flex: 1 },
    // Frozen-column treatment (Notion/Excel-style) — its own background distinct from the
    // grid behind it, plus a border/shadow so it visually sits above the scrolling grid
    // rather than blending into it.
    labelRail: {
      width: LABEL_WIDTH,
      backgroundColor: t.surface,
      borderRightWidth: 2,
      borderRightColor: t.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
      ...(Platform.OS === 'web' ? { boxShadow: t.isDark ? '2px 0 8px rgba(0,0,0,0.35)' : '2px 0 6px rgba(0,0,0,0.08)' } : null),
    } as any,
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
    labelNote: { width: 28, marginLeft: 4, fontSize: 10, fontFamily: Poppins.medium, color: t.textSub, textAlign: 'right' },
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

    // Wrapper carries horizontal position; flag + line are laid out inside it (regular
    // flex flow, not position:absolute) so the flag sits centered above the line without
    // needing its own separate left math.
    playheadWrap: { position: 'absolute', top: 0, width: 8, alignItems: 'center' },
    playheadFlag: {
      width: 8,
      height: 8,
      borderRadius: 2,
      backgroundColor: t.record,
      transform: [{ rotate: '45deg' }, { translateY: 4 }],
      ...(Platform.OS === 'web' ? { boxShadow: `0 0 6px ${t.record}` } : null),
    } as any,
    playheadRulerLine: { width: 1.5, backgroundColor: t.record },
    // Long vertical line spanning the note grid — a separate, absolutely-positioned usage
    // from the short in-ruler line above (that one lives inside a centering flex wrapper).
    playheadLine: {
      position: 'absolute',
      top: 0,
      width: 1.5,
      backgroundColor: t.record,
    },
    // Soft blurred band trailing the crisp line above, web-only — a plain thin line reads
    // as flat, this gives the moving playhead some visual weight without being loud.
    playheadGlow: {
      position: 'absolute',
      top: 0,
      width: 8,
      backgroundColor: t.recordSoft,
      ...(Platform.OS === 'web' ? { filter: 'blur(3px)' } : null),
    } as any,

    noteBlock: {
      position: 'absolute',
      justifyContent: 'center',
      ...(Platform.OS === 'web'
        ? {
            cursor: 'grab',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            transitionProperty: 'box-shadow, filter',
            transitionDuration: '120ms',
            transitionTimingFunction: 'ease',
          }
        : null),
    } as any,
    noteBlockHovered: {
      ...(Platform.OS === 'web' ? { filter: 'brightness(1.12)', boxShadow: '0 2px 6px rgba(0,0,0,0.28)' } : null),
    } as any,
    noteBlockSelected: {
      ...(Platform.OS === 'web' ? { boxShadow: `0 0 0 2px ${t.accent}, 0 0 10px ${t.accentDim}` } : null),
    } as any,
    noteBlockBody: { flex: 1, justifyContent: 'center', paddingLeft: 8, paddingRight: 8, overflow: 'hidden' },
    noteBlockText: { fontSize: 10, fontFamily: Poppins.bold, color: '#fff' },
    // Figma-style floating selection toolbar above the block — replaces a tiny corner
    // delete icon that crowded the block itself. Backspace/Delete remains the fast path.
    selectionPill: {
      position: 'absolute',
      top: -28,
      left: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: t.textPrimary,
      zIndex: 10,
      ...(Platform.OS === 'web' ? { boxShadow: '0 2px 8px rgba(0,0,0,0.25)', cursor: 'default' } : null),
    } as any,
    selectionPillText: { fontSize: 10, fontFamily: Poppins.bold, color: t.bg },
    selectionPillDeleteBtn: { padding: 1 },
    resizeHandle: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: RESIZE_HANDLE_W,
      ...(Platform.OS === 'web' ? { cursor: 'ew-resize' } : null),
    } as any,
    resizeHandleLeft: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: RESIZE_HANDLE_W,
      ...(Platform.OS === 'web' ? { cursor: 'ew-resize' } : null),
    } as any,

    // Selection tool — live marquee preview (width/height driven to 0 when idle, so it's
    // always mounted rather than conditionally rendered; see marqueeAnimatedStyle) and the
    // draggable bounding box around a committed multi-selection.
    marqueeRect: {
      position: 'absolute',
      backgroundColor: t.accentSoft,
      borderWidth: 1,
      borderColor: t.accent,
      borderRadius: 2,
    },
    // Positioned to match the grid's own origin (0,0) — children inside use the same
    // absolute left/top coordinates as everything else in the grid, and the transform
    // applied to this wrapper (see GroupSelectionOverlay) shifts all of them as one unit.
    groupSelectionWrap: { position: 'absolute', left: 0, top: 0 },
    groupSelectionOverlay: {
      position: 'absolute',
      borderWidth: 1.5,
      borderColor: t.accent,
      borderRadius: 4,
      backgroundColor: t.accentSoft,
      ...(Platform.OS === 'web' ? { cursor: 'grab' } : null),
    } as any,

    dataPanel: {
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingTop: 6,
      gap: 6,
      overflow: 'hidden',
    },
    dataPanelTabs: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4, height: DATA_PANEL_TABS_HEIGHT - 6 },
    dataTab: { paddingVertical: 2 },
    dataTabText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textMuted },
    dataTabTextActive: { color: t.accent },
    dataPanelCollapseBtn: { marginLeft: 'auto', padding: 4, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null) } as any,
    dataBarClip: { height: DATA_BAR_HEIGHT, marginLeft: LABEL_WIDTH, overflow: 'hidden' },
    dataBarContent: { height: DATA_BAR_HEIGHT, position: 'relative' },
  });
}
