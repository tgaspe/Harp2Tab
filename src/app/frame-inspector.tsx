import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';
import { selectHarmonicaType, selectKey, selectRecordingId, selectTabNotes, useAppStore } from '@/store/useAppStore';
import { selectRecordings, useRecordingsStore } from '@/store/useRecordingsStore';
import { getFrames, type RawFrame } from '@/audio/frameBuffer';
import { frequencyToTab } from '@/audio/HarmonicaMapper';
import { createNoteDetector, DEFAULT_NOTE_DETECTOR_CONFIG, type NoteDetectorConfig } from '@/audio/NoteDetector';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

const TRACK_HEIGHTS = { loudness: 96, pitch: 64, notes: 44, raw: 34 };
const TRACKS_TOTAL_HEIGHT =
  TRACK_HEIGHTS.loudness + TRACK_HEIGHTS.pitch + TRACK_HEIGHTS.notes + TRACK_HEIGHTS.raw;
const TIME_AXIS_HEIGHT = 22;
const LOUDNESS_COLOR = '#f5a623'; // warm amber — distinct from the cyan accent used for Pitch
const LABEL_WIDTH = 88;
const MINIMAP_HEIGHT = 40;
const MINIMAP_BUCKETS = 80;

// Continuous zoom: 1 = exactly fit the viewport (fitPxPerSecond), higher = zoomed in.
// Zooming out below 1 would just show empty space past the end of the recording.
const MIN_ZOOM = 1;
const MAX_ZOOM = 200;
const ZOOM_BUTTON_STEP = 1.4;    // multiplicative step per +/- button tap
const ZOOM_WHEEL_SENSITIVITY = 0.0018; // tuned so a normal mouse-wheel notch (~100 deltaY) feels like one button step

const NOTE_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteColor(note: string): string {
  const name = note.replace(/\d+$/, '');
  const idx = NOTE_ORDER.indexOf(name);
  if (idx === -1) return '#8a8a92';
  const hue = Math.round((idx * 360) / 12);
  return `hsl(${hue}, 58%, 56%)`;
}

function midiOf(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

// Math.max(...arr)/Math.min(...arr) risk a call-stack overflow once `arr` has
// thousands of elements (a long recording's frame array) — reduce instead.
function maxOf(nums: number[], floor: number): number {
  return nums.reduce((m, n) => (n > m ? n : m), floor);
}
function minOf(nums: number[], ceiling: number): number {
  return nums.reduce((m, n) => (n < m ? n : m), ceiling);
}

function splitValidRuns(frames: RawFrame[]): RawFrame[][] {
  const runs: RawFrame[][] = [];
  let current: RawFrame[] = [];
  for (const f of frames) {
    if (isFinite(f.frequency) && f.frequency > 0) {
      current.push(f);
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

function runDetectorOverFrames(
  frames: RawFrame[],
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  config: NoteDetectorConfig,
): TabNote[] {
  const notes: Omit<TabNote, 'id'>[] = [];
  const detector = createNoteDetector((n) => notes.push(n), key, harmonicaType, config);
  for (const f of frames) {
    detector.process({ frequency: f.frequency, rms: f.rms }, f.t, 0);
  }
  detector.flush(0);
  return notes.map((n, i) => ({ ...n, id: `preview-${i}` }));
}

function buildMinimapBars(frames: RawFrame[], durationMs: number): number[] {
  const sums   = new Array(MINIMAP_BUCKETS).fill(0);
  const counts = new Array(MINIMAP_BUCKETS).fill(0);
  for (const f of frames) {
    const idx = Math.min(MINIMAP_BUCKETS - 1, Math.floor((f.t / durationMs) * MINIMAP_BUCKETS));
    sums[idx]   += f.rms;
    counts[idx] += 1;
  }
  const avgs   = sums.map((v, i) => (counts[i] ? v / counts[i] : 0));
  const maxAvg = maxOf(avgs, 0.0001);
  return avgs.map((v) => v / maxAvg);
}

interface TunableField {
  key:    keyof NoteDetectorConfig;
  label:  string;
  step:   number;
  min:    number;
  max:    number;
  format: (v: number) => string;
}

const TUNABLE_FIELDS: TunableField[] = [
  { key: 'graceMs',        label: 'Silence Hold',      step: 10,  min: 20, max: 500, format: (v) => `${Math.round(v)}ms` },
  { key: 'confirmMs',      label: 'Confirm Hold',      step: 5,   min: 5,  max: 200, format: (v) => `${Math.round(v)}ms` },
  { key: 'minDurationMs',  label: 'Min Note Duration', step: 10,  min: 20, max: 500, format: (v) => `${Math.round(v)}ms` },
  { key: 'noiseFloorMult', label: 'Noise Floor ×',     step: 0.1, min: 1,  max: 6,   format: (v) => `${v.toFixed(1)}×` },
];

export default function FrameInspectorScreen() {
  const router        = useRouter();
  const theme         = useTheme();
  const styles        = useMemo(() => createStyles(theme), [theme]);

  const selectedKey    = useAppStore(selectKey);
  const harmonicaType  = useAppStore(selectHarmonicaType);
  const tabNotes       = useAppStore(selectTabNotes);
  const recordingId    = useAppStore(selectRecordingId);
  const savedRecordings = useRecordingsStore(selectRecordings);

  // Fast path: the in-memory buffer (populated live while recording/just after). Falls
  // back to the persisted copy on the saved TabRecording — needed once the in-memory
  // buffer has been evicted (bounded to the last few sessions) or after a reload.
  const frames = useMemo(() => {
    if (!recordingId) return [];
    const live = getFrames(recordingId);
    if (live.length > 0) return live;
    return savedRecordings.find((r) => r.id === recordingId)?.frames ?? [];
  }, [recordingId, savedRecordings]);

  const [zoomMultiplier, setZoomMultiplier] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [config, setConfig]         = useState<NoteDetectorConfig>(DEFAULT_NOTE_DETECTOR_CONFIG);
  const [scrollX, setScrollX]       = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [minimapWidth, setMinimapWidth]   = useState(0);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);

  const scrollRef          = useRef<ScrollView>(null);
  const wheelContainerRef  = useRef<View>(null);
  const minimapContainerRef = useRef<View>(null);
  const minimapPageXRef     = useRef(0);

  const isDirty = TUNABLE_FIELDS.some((f) => config[f.key] !== DEFAULT_NOTE_DETECTOR_CONFIG[f.key]);

  const noteEnd  = tabNotes.length ? tabNotes[tabNotes.length - 1].start_time + tabNotes[tabNotes.length - 1].duration : 0;
  const frameEnd = frames.length ? frames[frames.length - 1].t : 0;
  const durationMs = Math.max(noteEnd, frameEnd, 1000);

  const fitPxPerSecond = viewportWidth > 0 ? viewportWidth / (durationMs / 1000) : 60;
  const pxPerSecond    = fitPxPerSecond * zoomMultiplier;
  const trackWidth     = Math.max(viewportWidth, pxPerSecond * (durationMs / 1000));

  // Live refs so the wheel listener (registered once) always reads current values
  // without needing to be re-subscribed on every scroll/zoom/layout change.
  const pxPerSecondRef    = useRef(pxPerSecond);    pxPerSecondRef.current    = pxPerSecond;
  const scrollXRef        = useRef(scrollX);        scrollXRef.current        = scrollX;
  const fitPxPerSecondRef = useRef(fitPxPerSecond); fitPxPerSecondRef.current = fitPxPerSecond;

  // Same pattern for the minimap's PanResponder, created once below.
  const minimapWidthRef = useRef(minimapWidth); minimapWidthRef.current = minimapWidth;
  const trackWidthRef   = useRef(trackWidth);   trackWidthRef.current   = trackWidth;
  const viewportWidthRef = useRef(viewportWidth); viewportWidthRef.current = viewportWidth;
  const framesRef        = useRef(frames);      framesRef.current        = frames;

  const displayedNotes: TabNote[] = useMemo(() => {
    if (!isDirty || frames.length === 0 || !selectedKey) return tabNotes;
    return runDetectorOverFrames(frames, selectedKey, harmonicaType, config);
  }, [isDirty, frames, selectedKey, harmonicaType, config, tabNotes]);

  const minimapBars = useMemo(
    () => (frames.length ? buildMinimapBars(frames, durationMs) : []),
    [frames, durationMs],
  );

  const selectedFrame = selectedFrameIndex !== null ? frames[selectedFrameIndex] ?? null : null;

  const selectedFrameNote = selectedFrame && selectedKey
    ? frequencyToTab(selectedFrame.frequency, selectedKey, harmonicaType)
    : null;

  const selectedFrameCommittedNote = selectedFrame
    ? displayedNotes.find(
        (n) => selectedFrame.t >= n.start_time && selectedFrame.t < n.start_time + n.duration,
      ) ?? null
    : null;

  // Same story as the minimap: a plain Pressable's `locationX` isn't reliable here (it came
  // back as always-0/NaN, which — since NaN never compares less than the running minimum —
  // left the "nearest frame" search stuck on its initial index 0, always the leftmost frame).
  // PanResponder + `measure()` gives a real page-absolute position instead.
  function selectFrameAtLocalX(localX: number) {
    const currentFrames = framesRef.current;
    if (currentFrames.length === 0) return;
    const timeMs = (localX / pxPerSecondRef.current) * 1000;
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < currentFrames.length; i++) {
      const d = Math.abs(currentFrames[i].t - timeMs);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }
    setSelectedFrameIndex(nearestIdx);
  }

  const trackOverlayRef     = useRef<View>(null);
  const trackOverlayPageXRef = useRef(0);

  // Press-and-hold-drag scrubs continuously across frames (like a DAW timeline) — this
  // means a drag over the tracks no longer pans the ScrollView; panning to a distant
  // section still works via the minimap, mouse-wheel zoom, or a trackpad's horizontal
  // swipe (shift+wheel), which the wheel handler below already lets through untouched.
  // Lazily created once, same pattern as the minimap's PanResponder.
  const trackPanResponderRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (trackPanResponderRef.current === null) {
    trackPanResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        trackOverlayRef.current?.measure((_x, _y, _w, _h, pageX) => {
          trackOverlayPageXRef.current = pageX;
          selectFrameAtLocalX(evt.nativeEvent.pageX - pageX);
        });
      },
      onPanResponderMove: (evt) => {
        selectFrameAtLocalX(evt.nativeEvent.pageX - trackOverlayPageXRef.current);
      },
    });
  }
  const trackPanResponder = trackPanResponderRef.current;

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setScrollX(e.nativeEvent.contentOffset.x);
  }

  function handleViewportLayout(e: LayoutChangeEvent) {
    setViewportWidth(e.nativeEvent.layout.width);
  }

  function handleMinimapLayout(e: LayoutChangeEvent) {
    setMinimapWidth(e.nativeEvent.layout.width);
  }

  // `nativeEvent.locationX` on a plain Pressable is unreliable for this on web (it's
  // relative to whatever child DOM element the event actually landed on, not the
  // minimap as a whole) — PanResponder + `measure()` gives a real page-absolute
  // position instead, and doubles as the tap-and-drag-to-scrub interaction.
  function jumpMinimapToPageX(pageX: number) {
    const width = minimapWidthRef.current;
    if (width === 0) return;
    const localX   = pageX - minimapPageXRef.current;
    const fraction = Math.max(0, Math.min(1, localX / width));
    const targetX  = Math.max(0, fraction * trackWidthRef.current - viewportWidthRef.current / 2);
    scrollRef.current?.scrollTo({ x: targetX, animated: false });
  }

  // Lazily-initialized once (not `useRef(PanResponder.create(...))`, which would
  // construct-and-discard a new instance every render) — safe because its handlers
  // only ever read live values through refs, never through closure-captured state.
  const minimapPanResponderRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (minimapPanResponderRef.current === null) {
    minimapPanResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        minimapContainerRef.current?.measure((_x, _y, _w, _h, pageX) => {
          minimapPageXRef.current = pageX;
          jumpMinimapToPageX(evt.nativeEvent.pageX);
        });
      },
      onPanResponderMove: (evt) => {
        jumpMinimapToPageX(evt.nativeEvent.pageX);
      },
    });
  }
  const minimapPanResponder = minimapPanResponderRef.current;

  // Zoom around the viewport's center (used by the +/- buttons and the reset pill).
  function zoomByFactor(factor: number) {
    const centerT = viewportWidth > 0 ? ((scrollX + viewportWidth / 2) / pxPerSecond) * 1000 : 0;
    setZoomMultiplier((m) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, m * factor));
      requestAnimationFrame(() => {
        const newPxPerSecond = fitPxPerSecond * next;
        const newX = Math.max(0, (centerT / 1000) * newPxPerSecond - viewportWidth / 2);
        scrollRef.current?.scrollTo({ x: newX, animated: false });
      });
      return next;
    });
  }

  // Mouse-wheel zoom (web only — "mouse scroll" isn't a native-app concept), anchored to
  // the cursor position so the point under it stays put, like a map or design-tool zoom.
  // Registered once via refs (not re-subscribed per scroll/zoom) to avoid listener churn.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = wheelContainerRef.current as unknown as HTMLElement | null;
    if (!node) return;

    function onWheel(e: WheelEvent) {
      // Let horizontal wheel motion (shift+wheel / trackpad swipe) pan normally.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();

      const rect   = node!.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const timeAtCursorMs = ((scrollXRef.current + localX) / pxPerSecondRef.current) * 1000;
      const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY);

      setZoomMultiplier((m) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, m * factor));
        requestAnimationFrame(() => {
          const newPxPerSecond = fitPxPerSecondRef.current * next;
          const newScrollX = Math.max(0, (timeAtCursorMs / 1000) * newPxPerSecond - localX);
          scrollRef.current?.scrollTo({ x: newScrollX, animated: false });
        });
        return next;
      });
    }

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  function updateConfigField(key: keyof NoteDetectorConfig, delta: number, field: TunableField) {
    setConfig((c) => {
      const next = Math.min(field.max, Math.max(field.min, +(c[key] + delta).toFixed(4)));
      return { ...c, [key]: next };
    });
  }

  const viewportRectLeft  = minimapWidth > 0 && trackWidth > 0 ? (scrollX / trackWidth) * minimapWidth : 0;
  const viewportRectWidth = minimapWidth > 0 && trackWidth > 0
    ? Math.min(minimapWidth, Math.max(4, (viewportWidth / trackWidth) * minimapWidth))
    : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color={theme.accent} />
            </Pressable>
            <Text style={styles.title}>Frame Inspector</Text>
            <View style={styles.backBtn} />
          </View>
          <Text style={styles.subtitle}>
            Key of {selectedKey ?? '—'} · {harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
            {' · '}{tabNotes.length} note{tabNotes.length !== 1 ? 's' : ''}
            {' · '}{frames.length} frame{frames.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {frames.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="analytics-outline" size={44} color={theme.textMuted} />
            <Text style={styles.emptyTitle}>No raw frame data for this session</Text>
            <Text style={styles.emptyHint}>
              This recording was saved before Frame Inspector data was kept, so there's
              nothing to show here.
            </Text>
          </View>
        ) : (
          <>
            {/* Minimap — tap to jump, or press-and-drag to scrub continuously */}
            <View
              ref={minimapContainerRef}
              onLayout={handleMinimapLayout}
              style={styles.minimap}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Jump to position in recording"
              {...minimapPanResponder.panHandlers}
            >
              <View style={styles.minimapBars} pointerEvents="none">
                {minimapBars.map((h, i) => (
                  <View
                    key={i}
                    style={[styles.minimapBar, { height: Math.max(2, h * (MINIMAP_HEIGHT - 8)) }]}
                  />
                ))}
              </View>
              {minimapWidth > 0 && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.minimapViewport,
                    { left: viewportRectLeft, width: viewportRectWidth },
                  ]}
                />
              )}
            </View>

            {/* Zoom control — continuous, not discrete steps. +/- buttons for touch/keyboard,
                mouse-wheel over the tracks below for anyone with a mouse (web only). */}
            <View style={styles.zoomRow}>
              <Pressable
                onPress={() => zoomByFactor(1 / ZOOM_BUTTON_STEP)}
                style={styles.zoomBtn}
                accessibilityRole="button"
                accessibilityLabel="Zoom out"
              >
                <Ionicons name="remove" size={16} color={theme.textSub} />
              </Pressable>
              <Pressable
                onPress={() => zoomByFactor(1 / zoomMultiplier)}
                style={styles.zoomPill}
                accessibilityRole="button"
                accessibilityLabel="Reset zoom to fit"
              >
                <Text style={styles.zoomPillText}>{Math.round(zoomMultiplier * 100)}%</Text>
              </Pressable>
              <Pressable
                onPress={() => zoomByFactor(ZOOM_BUTTON_STEP)}
                style={styles.zoomBtn}
                accessibilityRole="button"
                accessibilityLabel="Zoom in"
              >
                <Ionicons name="add" size={16} color={theme.textSub} />
              </Pressable>
              {isDirty && <Text style={styles.previewBadge}>PREVIEW</Text>}
            </View>

            {/* Tracks: pinned label rail + horizontally scrollable content */}
            <View style={styles.tracksRow}>
              <View style={styles.labelRail}>
                <View style={[styles.labelCell, { height: TRACK_HEIGHTS.loudness }]}>
                  <Text style={styles.labelText}>LOUDNESS</Text>
                </View>
                <View style={[styles.labelCell, { height: TRACK_HEIGHTS.pitch }]}>
                  <Text style={styles.labelText}>PITCH</Text>
                </View>
                <View style={[styles.labelCell, { height: TRACK_HEIGHTS.notes }]}>
                  <Text style={styles.labelText}>NOTES</Text>
                </View>
                <View style={[styles.labelCell, { height: TRACK_HEIGHTS.raw }]}>
                  <Text style={styles.labelText}>RAW</Text>
                </View>
                <View style={[styles.labelCell, { height: TIME_AXIS_HEIGHT }]} />
              </View>

              <View ref={wheelContainerRef} style={styles.wheelArea} onLayout={handleViewportLayout}>
                <ScrollView
                  ref={scrollRef}
                  horizontal
                  onScroll={handleScroll}
                  scrollEventThrottle={16}
                  showsHorizontalScrollIndicator={Platform.OS === 'web'}
                >
                  <View style={{ width: trackWidth }}>
                    <LoudnessTrack frames={frames} width={trackWidth} height={TRACK_HEIGHTS.loudness} pxPerSecond={pxPerSecond} color={LOUDNESS_COLOR} />
                    <PitchTrack    frames={frames} width={trackWidth} height={TRACK_HEIGHTS.pitch}    pxPerSecond={pxPerSecond} color={theme.accent} />
                    <NotesTrack    notes={displayedNotes} height={TRACK_HEIGHTS.notes} pxPerSecond={pxPerSecond} theme={theme} />
                    <RawNotesTrack frames={frames} height={TRACK_HEIGHTS.raw} pxPerSecond={pxPerSecond} harmonicaKey={selectedKey} harmonicaType={harmonicaType} />

                    {/* Tap-to-inspect overlay — sits on top of all four tracks (rendered last,
                        absolutely positioned) so it always receives the tap regardless of
                        which track's own content is underneath. */}
                    <View
                      ref={trackOverlayRef}
                      style={{ position: 'absolute', top: 0, left: 0, width: trackWidth, height: TRACKS_TOTAL_HEIGHT }}
                      accessible
                      accessibilityRole="adjustable"
                      accessibilityLabel="Inspect a frame"
                      {...trackPanResponder.panHandlers}
                    />

                    {selectedFrame && (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.selectionLine,
                          { left: (selectedFrame.t / 1000) * pxPerSecond, height: TRACKS_TOTAL_HEIGHT + TIME_AXIS_HEIGHT },
                        ]}
                      />
                    )}

                    <TimeAxis durationMs={durationMs} width={trackWidth} pxPerSecond={pxPerSecond} color={theme.textMuted} />
                  </View>
                </ScrollView>
              </View>
            </View>

            {/* Selected-frame detail */}
            <FrameInfoPanel
              frame={selectedFrame}
              frameIndex={selectedFrameIndex}
              totalFrames={frames.length}
              note={selectedFrameNote}
              committedNote={selectedFrameCommittedNote}
              theme={theme}
              styles={styles}
            />

            {/* Advanced disclosure */}
            <Pressable
              onPress={() => setAdvancedOpen((v) => !v)}
              style={styles.advancedToggle}
              accessibilityRole="button"
              accessibilityLabel="Toggle advanced tuning"
            >
              <Ionicons name={advancedOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={theme.textSub} />
              <Text style={styles.advancedToggleText}>Advanced tuning</Text>
            </Pressable>

            {advancedOpen && (
              <View style={styles.advancedPanel}>
                <Text style={styles.advancedHint}>
                  Preview only — adjusts the Notes track above without changing your saved recording.
                </Text>
                {TUNABLE_FIELDS.map((field) => (
                  <View key={field.key} style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <View style={styles.fieldControls}>
                      <Pressable
                        onPress={() => updateConfigField(field.key, -field.step, field)}
                        style={styles.stepperBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Decrease ${field.label}`}
                      >
                        <Ionicons name="remove" size={16} color={theme.textSub} />
                      </Pressable>
                      <Text style={styles.fieldValue}>{field.format(config[field.key])}</Text>
                      <Pressable
                        onPress={() => updateConfigField(field.key, field.step, field)}
                        style={styles.stepperBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Increase ${field.label}`}
                      >
                        <Ionicons name="add" size={16} color={theme.textSub} />
                      </Pressable>
                    </View>
                  </View>
                ))}
                {isDirty && (
                  <Pressable
                    onPress={() => setConfig(DEFAULT_NOTE_DETECTOR_CONFIG)}
                    style={styles.resetBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Reset to defaults"
                  >
                    <Text style={styles.resetBtnText}>Reset to defaults</Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}

      </View>
    </SafeAreaView>
  );
}

// "Nice" tick spacings to choose from so labels never crowd together as pxPerSecond changes.
const TICK_INTERVALS_SEC = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MIN_TICK_SPACING_PX = 64;

function pickTickInterval(pxPerSecond: number): number {
  for (const interval of TICK_INTERVALS_SEC) {
    if (interval * pxPerSecond >= MIN_TICK_SPACING_PX) return interval;
  }
  return TICK_INTERVALS_SEC[TICK_INTERVALS_SEC.length - 1];
}

function formatTick(seconds: number, interval: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const sStr = interval < 1 ? s.toFixed(1) : String(Math.round(s));
  return m > 0 ? `${m}:${sStr.padStart(interval < 1 ? 4 : 2, '0')}` : `${sStr}s`;
}

function TimeAxis({ durationMs, width, pxPerSecond, color }: {
  durationMs: number; width: number; pxPerSecond: number; color: string;
}) {
  const interval = pickTickInterval(pxPerSecond);
  const totalSeconds = durationMs / 1000;
  const ticks: number[] = [];
  for (let t = 0; t <= totalSeconds + 1e-6; t += interval) ticks.push(t);

  return (
    <View style={{ width, height: TIME_AXIS_HEIGHT }}>
      {ticks.map((t, i) => (
        <View key={i} style={{ position: 'absolute', left: t * pxPerSecond, top: 0 }}>
          <View style={{ width: 1, height: 5, backgroundColor: color }} />
          <Text style={{ fontSize: 9, fontFamily: Poppins.regular, color, marginTop: 2 }}>
            {formatTick(t, interval)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function formatFrameTimestamp(ms: number): string {
  const totalSeconds = ms / 1000;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : `${s.toFixed(3)}s`;
}

function FrameInfoField({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.frameInfoField}>
      <Text style={styles.frameInfoLabel}>{label}</Text>
      <Text style={styles.frameInfoValue}>{value}</Text>
    </View>
  );
}

function FrameInfoPanel({ frame, frameIndex, totalFrames, note, committedNote, theme, styles }: {
  frame: RawFrame | null;
  frameIndex: number | null;
  totalFrames: number;
  note: { tab: string; note: string } | null;
  committedNote: TabNote | null;
  theme: Theme;
  styles: ReturnType<typeof createStyles>;
}) {
  if (!frame || frameIndex === null) {
    return (
      <View style={styles.frameInfoEmpty}>
        <Ionicons name="locate-outline" size={16} color={theme.textMuted} />
        <Text style={styles.frameInfoEmptyText}>Tap anywhere in the tracks above to inspect that frame.</Text>
      </View>
    );
  }

  const hasPitch = isFinite(frame.frequency) && frame.frequency > 0;

  return (
    <View style={styles.frameInfoPanel}>
      <Text style={styles.frameInfoTitle}>Selected Frame</Text>
      <View style={styles.frameInfoGrid}>
        <FrameInfoField styles={styles} label="Frame #"        value={`${frameIndex + 1} / ${totalFrames}`} />
        <FrameInfoField styles={styles} label="Timestamp"      value={formatFrameTimestamp(frame.t)} />
        <FrameInfoField styles={styles} label="Loudness (RMS)" value={frame.rms.toFixed(4)} />
        <FrameInfoField styles={styles} label="Pitch"          value={hasPitch ? `${frame.frequency.toFixed(1)} Hz` : '—'} />
        <FrameInfoField styles={styles} label="Note"           value={note ? note.note : '—'} />
        <FrameInfoField styles={styles} label="Tab"            value={note ? note.tab : '—'} />
        <FrameInfoField
          styles={styles}
          label="Committed note"
          value={committedNote ? `${committedNote.tab} (${committedNote.note})` : 'None'}
        />
      </View>
    </View>
  );
}

function LoudnessTrack({ frames, width, height, pxPerSecond, color }: {
  frames: RawFrame[]; width: number; height: number; pxPerSecond: number; color: string;
}) {
  const maxRms = maxOf(frames.map((f) => f.rms), 0.0001);
  const points = frames.map((f) => `${(f.t / 1000) * pxPerSecond},${height - (f.rms / maxRms) * height}`).join(' ');
  return (
    <Svg width={width} height={height}>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

function PitchTrack({ frames, width, height, pxPerSecond, color }: {
  frames: RawFrame[]; width: number; height: number; pxPerSecond: number; color: string;
}) {
  const validMidis = frames
    .filter((f) => isFinite(f.frequency) && f.frequency > 0)
    .map((f) => midiOf(f.frequency));
  if (validMidis.length === 0) return <View style={{ width, height }} />;

  const minMidi = minOf(validMidis, validMidis[0]) - 2;
  const maxMidi = maxOf(validMidis, validMidis[0]) + 2;
  const span    = Math.max(1, maxMidi - minMidi);
  const yFor    = (freq: number) => height - ((midiOf(freq) - minMidi) / span) * height;
  const runs    = splitValidRuns(frames);

  return (
    <Svg width={width} height={height}>
      {runs.map((run, i) => (
        <Polyline
          key={i}
          points={run.map((f) => `${(f.t / 1000) * pxPerSecond},${yFor(f.frequency)}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />
      ))}
    </Svg>
  );
}

function NotesTrack({ notes, height, pxPerSecond, theme }: {
  notes: TabNote[]; height: number; pxPerSecond: number; theme: Theme;
}) {
  return (
    <View style={{ height }}>
      {notes.map((n) => {
        const left = (n.start_time / 1000) * pxPerSecond;
        const w    = Math.max(2, (n.duration / 1000) * pxPerSecond);
        return (
          <View
            key={n.id}
            style={{
              position: 'absolute',
              left,
              top: 4,
              width: w,
              height: height - 8,
              backgroundColor: theme.accent,
              opacity: 0.35 + (n.confidence / 100) * 0.65,
              borderRadius: 4,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {w > 22 && (
              <Text style={{ fontSize: 9, color: '#fff', fontFamily: Poppins.semiBold }} numberOfLines={1}>
                {n.tab}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

interface RawSegment {
  startT: number;
  endT:   number;
  note:   string | null; // scientific pitch name, e.g. "C4" — null means no pitch detected
}

// Merge consecutive frames that resolve to the same note into one segment — matches
// the "[C4C4C4C4C4C5...]" run-length pattern this track was designed around, and gives
// each run enough width to actually show its note name instead of one sliver per frame.
function buildRawSegments(
  frames: RawFrame[],
  harmonicaKey: HarmonicaKey,
  harmonicaType: HarmonicaType,
): RawSegment[] {
  const segments: RawSegment[] = [];
  let current: RawSegment | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f      = frames[i];
    const result = frequencyToTab(f.frequency, harmonicaKey, harmonicaType);
    const note   = result?.note ?? null;
    const nextT  = frames[i + 1]?.t ?? f.t + 40;
    if (current && current.note === note) {
      current.endT = nextT;
    } else {
      if (current) segments.push(current);
      current = { startT: f.t, endT: nextT, note };
    }
  }
  if (current) segments.push(current);
  return segments;
}

function RawNotesTrack({ frames, height, pxPerSecond, harmonicaKey, harmonicaType }: {
  frames: RawFrame[]; height: number; pxPerSecond: number;
  harmonicaKey: HarmonicaKey | null; harmonicaType: HarmonicaType;
}) {
  const segments = useMemo(
    () => (harmonicaKey ? buildRawSegments(frames, harmonicaKey, harmonicaType) : []),
    [frames, harmonicaKey, harmonicaType],
  );
  if (!harmonicaKey) return <View style={{ height }} />;

  return (
    <View style={{ height }}>
      {segments.map((seg, i) => {
        const left = (seg.startT / 1000) * pxPerSecond;
        const w    = Math.max(1, ((seg.endT - seg.startT) / 1000) * pxPerSecond);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left,
              top: 0,
              width: w,
              height,
              backgroundColor: seg.note ? noteColor(seg.note) : SILENCE_COLOR,
              opacity: seg.note ? 0.85 : 0.12,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {seg.note && w > 22 && (
              <Text style={{ fontSize: 9, color: '#fff', fontFamily: Poppins.semiBold }} numberOfLines={1}>
                {seg.note}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

// Neutral filler color for silent/unmapped frames in the raw track.
const SILENCE_COLOR = '#8a8a92';

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      ...webMaxWidth(WEB_CONTENT_WIDTH.wide),
      paddingHorizontal: 24,
      paddingTop: Platform.OS === 'web' ? WEB_SCREEN_PADDING_TOP : 16,
      paddingBottom: Platform.OS === 'web' ? WEB_SCREEN_PADDING_BOTTOM : 24,
      gap: 14,
    },
    header:    { gap: 4 },
    headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    backBtn:   { padding: 4, width: 32 },
    title:     { fontSize: FONT.xl, fontFamily: SpaceGrotesk.bold, color: t.accent, letterSpacing: -0.5 },
    subtitle:  { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted },

    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
    emptyTitle: { fontSize: FONT.md, fontFamily: Poppins.bold, color: t.textSub, textAlign: 'center' },
    emptyHint:  { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted, textAlign: 'center', lineHeight: 20 },

    minimap: {
      height: MINIMAP_HEIGHT,
      backgroundColor: t.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      overflow: 'hidden',
      justifyContent: 'flex-end',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    minimapBars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%', width: '100%' },
    minimapBar:  { flex: 1, backgroundColor: t.accent, opacity: 0.6, marginHorizontal: 0.5 },
    minimapViewport: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderWidth: 1,
      borderColor: t.accent,
    },

    zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    zoomBtn: {
      width: 30,
      height: 30,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
    },
    zoomPill: {
      minWidth: 52,
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
    },
    zoomPillText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    previewBadge: {
      marginLeft: 'auto',
      fontSize: 9,
      fontFamily: Poppins.bold,
      letterSpacing: 0.8,
      color: t.accent,
      backgroundColor: t.accentSoft,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 3,
    } as any,

    tracksRow: { flexDirection: 'row', flex: 1 },
    wheelArea: { flex: 1 },
    labelRail: { width: LABEL_WIDTH },
    labelCell: { justifyContent: 'center' },
    labelText: { fontSize: 9, fontFamily: Poppins.bold, color: t.textMuted, letterSpacing: 0.8 },

    selectionLine: {
      position: 'absolute',
      top: 0,
      width: 1.5,
      backgroundColor: t.textPrimary,
    },

    frameInfoEmpty: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      borderStyle: 'dashed',
      paddingVertical: 14,
      paddingHorizontal: 14,
    },
    frameInfoEmptyText: { fontSize: FONT.xs, fontFamily: Poppins.regular, color: t.textMuted },

    frameInfoPanel: {
      gap: 10,
      backgroundColor: t.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.accent,
      padding: 14,
    },
    frameInfoTitle: { fontSize: FONT.sm, fontFamily: Poppins.bold, color: t.accent, letterSpacing: 0.4 },
    frameInfoGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 16,
    },
    frameInfoField: { minWidth: 110, gap: 2 },
    frameInfoLabel: {
      fontSize: 9,
      fontFamily: Poppins.bold,
      color: t.textMuted,
      letterSpacing: 0.6,
    },
    frameInfoValue: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textPrimary },

    advancedToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    advancedToggleText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub },
    advancedPanel: {
      gap: 10,
      backgroundColor: t.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
    },
    advancedHint: { fontSize: FONT.xs, fontFamily: Poppins.regular, color: t.textMuted, lineHeight: 16 },
    fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    fieldLabel: { fontSize: FONT.sm, fontFamily: Poppins.medium, color: t.textSub },
    fieldControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepperBtn: {
      width: 28, height: 28, borderRadius: 8,
      backgroundColor: t.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },
    fieldValue: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textPrimary, minWidth: 48, textAlign: 'center' },
    resetBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
    resetBtnText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.accent },
  });
}
