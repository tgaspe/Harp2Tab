// Live, web-only companion to Frame Inspector — same underlying frame data (the same
// buffer `pushFrame`/`getFrames` in @/audio/frameBuffer feeds and Frame Inspector reads
// post-hoc), but rendered as a fixed-width sliding window ("strip chart") instead of a
// scrubbable full-recording timeline, since the recording's total duration isn't known
// yet. New data enters on the right, old data ages off the left every poll tick.
import React, { useEffect, useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';
import { getFrames, type RawFrame } from '@/audio/frameBuffer';
import { noteColor, midiOf, maxOf, minOf, splitValidRuns, buildRawSegments, SILENCE_COLOR } from '@/audio/frameVisualization';
import { frequencyToTab } from '@/audio/HarmonicaMapper';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

const LIVE_WINDOW_MS   = 8000;
const POLL_INTERVAL_MS = 150;
const TICK_INTERVAL_MS = 2000;
const LOUDNESS_COLOR = '#f5a623'; // same amber Frame Inspector uses, for visual continuity
const LABEL_WIDTH  = 74;
const AXIS_HEIGHT  = 16;
const METER_SEGMENTS = 6;

// Notes/raw are categorical strips — extra height does nothing for them, so they stay
// fixed and all the leftover panel height goes to the two continuous curves, where
// vertical resolution is what actually makes the signal readable.
const FIXED_HEIGHTS = { notes: 32, raw: 28 };
const MIN_CURVE_HEIGHT = 48;
const CURVE_SPLIT = 0.55; // loudness gets slightly more than pitch — it's the busier trace

function curveHeights(areaHeight: number) {
  const leftover = areaHeight - FIXED_HEIGHTS.notes - FIXED_HEIGHTS.raw - AXIS_HEIGHT;
  const loudness = Math.max(MIN_CURVE_HEIGHT, Math.floor(leftover * CURVE_SPLIT));
  const pitch    = Math.max(MIN_CURVE_HEIGHT, Math.floor(leftover * (1 - CURVE_SPLIT)));
  return { ...FIXED_HEIGHTS, loudness, pitch };
}

interface Props {
  recordingId:   string | null;
  isRecording:   boolean;
  isPaused:      boolean;
  tabNotes:      TabNote[];
  harmonicaKey:  HarmonicaKey | null;
  harmonicaType: HarmonicaType;
}

export function LiveAnalysisPanel({ recordingId, isRecording, isPaused, tabNotes, harmonicaKey, harmonicaType }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Already-windowed — each tick reads the live buffer and keeps only the last
  // LIVE_WINDOW_MS worth, so this never grows unbounded across a long recording the
  // way storing the raw session-long array would.
  const [frames, setFrames]           = useState<RawFrame[]>([]);
  const [windowStart, setWindowStart] = useState(0);
  const [trackArea, setTrackArea]     = useState({ width: 0, height: 0 });

  // Polls only while there's something new to show — same lifecycle discipline as
  // usePlayback's rAF ticker (stopped, not idling, on pause/stop/unmount).
  useEffect(() => {
    if (!isRecording || isPaused || !recordingId) return;
    const id = setInterval(() => {
      const all = getFrames(recordingId);
      const latestT = all.length ? all[all.length - 1].t : 0;
      const cutoff  = Math.max(0, latestT - LIVE_WINDOW_MS);
      setFrames(all.filter((f) => f.t >= cutoff));
      setWindowStart(cutoff);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isRecording, isPaused, recordingId]);

  // A fresh session (new recordingId) starts with a clean slate, not the previous
  // take's trailing frames.
  useEffect(() => {
    setFrames([]);
    setWindowStart(0);
  }, [recordingId]);

  const pxPerSecond = trackArea.width > 0 ? trackArea.width / (LIVE_WINDOW_MS / 1000) : 0;
  const heights     = curveHeights(trackArea.height);
  const windowNotes = tabNotes.filter(
    (n) => n.start_time + n.duration >= windowStart && n.start_time <= windowStart + LIVE_WINDOW_MS,
  );

  function handleTrackAreaLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setTrackArea((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }

  const hasSignal = frames.length > 0;

  // The frame under the "playhead" — i.e. the most recent one. Frame Inspector shows
  // this for a frame you scrubbed to; live, "now" is the only frame worth showing.
  const latestFrame  = frames.length ? frames[frames.length - 1] : null;
  const maxWindowRms = maxOf(frames.map((f) => f.rms), 0.0001);

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>LIVE ANALYSIS</Text>

      <NowReadout
        frame={latestFrame}
        maxRms={maxWindowRms}
        harmonicaKey={harmonicaKey}
        harmonicaType={harmonicaType}
        theme={theme}
        styles={styles}
      />

      <View style={styles.rows}>
        <View style={styles.labelRail}>
          <LabelCell height={heights.loudness} label="LOUDNESS" styles={styles} />
          <LabelCell height={heights.pitch}    label="PITCH"    styles={styles} />
          <LabelCell height={heights.notes}    label="NOTES"    styles={styles} />
          <LabelCell height={heights.raw}      label="RAW"      styles={styles} />
          <LabelCell height={AXIS_HEIGHT} styles={styles} />
        </View>

        <View style={styles.trackArea} onLayout={handleTrackAreaLayout}>
          {pxPerSecond > 0 && (
            <>
              <LoudnessRow frames={frames} windowStart={windowStart} width={trackArea.width} height={heights.loudness} pxPerSecond={pxPerSecond} color={LOUDNESS_COLOR} />
              <PitchRow    frames={frames} windowStart={windowStart} width={trackArea.width} height={heights.pitch}    pxPerSecond={pxPerSecond} color={theme.accent} />
              <NotesRow    notes={windowNotes} windowStart={windowStart} height={heights.notes} pxPerSecond={pxPerSecond} theme={theme} />
              <RawRow      frames={frames} windowStart={windowStart} height={heights.raw} pxPerSecond={pxPerSecond} harmonicaKey={harmonicaKey} harmonicaType={harmonicaType} />
              <AxisRow     windowStart={windowStart} pxPerSecond={pxPerSecond} theme={theme} />
            </>
          )}

          {!hasSignal && (
            <View style={styles.emptyOverlay} pointerEvents="none">
              <Text style={styles.emptyOverlayText}>
                {isRecording ? 'Waiting for signal…' : 'Start recording to see live analysis'}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// Big glanceable "what am I playing right now" card — the live counterpart to Frame
// Inspector's FrameInfoPanel, reusing the same frequencyToTab mapper the RAW track uses
// so the note/tab it reports is exactly what the pipeline sees, not a second opinion.
function NowReadout({ frame, maxRms, harmonicaKey, harmonicaType, theme, styles }: {
  frame: RawFrame | null;
  maxRms: number;
  harmonicaKey: HarmonicaKey | null;
  harmonicaType: HarmonicaType;
  theme: Theme;
  styles: ReturnType<typeof createStyles>;
}) {
  const hasPitch = !!frame && isFinite(frame.frequency) && frame.frequency > 0;
  const mapped   = hasPitch && harmonicaKey
    ? frequencyToTab(frame!.frequency, harmonicaKey, harmonicaType)
    : null;
  // Level is relative to the loudest frame in the current window, not an absolute dBFS
  // scale — this is a "are you playing, and how hard" indicator, not a calibrated meter.
  const level = frame ? Math.min(1, frame.rms / maxRms) : 0;
  const litSegments = Math.round(level * METER_SEGMENTS);

  return (
    <View style={styles.nowCard}>
      <View style={styles.nowMain}>
        <Text style={[styles.nowNote, !mapped && styles.nowNoteIdle]}>
          {mapped ? mapped.note : '—'}
        </Text>
        <View style={styles.nowTabWrap}>
          <Text style={styles.nowTabLabel}>TAB</Text>
          <Text style={[styles.nowTab, !mapped && styles.nowTabIdle]}>
            {mapped ? mapped.tab : '—'}
          </Text>
        </View>
      </View>

      <View style={styles.nowMeta}>
        <Text style={styles.nowFreq}>
          {hasPitch ? `${frame!.frequency.toFixed(1)} Hz` : 'no pitch'}
        </Text>
        <View style={styles.meter} accessibilityLabel={`Input level ${Math.round(level * 100)} percent`}>
          {Array.from({ length: METER_SEGMENTS }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.meterSegment,
                i < litSegments && { backgroundColor: i >= METER_SEGMENTS - 1 ? theme.record : LOUDNESS_COLOR },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function LabelCell({ height, label, styles }: { height: number; label?: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={[styles.labelCell, { height }]}>
      {label && <Text style={styles.labelText}>{label}</Text>}
    </View>
  );
}

function LoudnessRow({ frames, windowStart, width, height, pxPerSecond, color }: {
  frames: RawFrame[]; windowStart: number; width: number; height: number; pxPerSecond: number; color: string;
}) {
  const maxRms = maxOf(frames.map((f) => f.rms), 0.0001);
  const points = frames
    .map((f) => `${((f.t - windowStart) / 1000) * pxPerSecond},${height - (f.rms / maxRms) * height}`)
    .join(' ');
  return (
    <Svg width={width} height={height}>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

function PitchRow({ frames, windowStart, width, height, pxPerSecond, color }: {
  frames: RawFrame[]; windowStart: number; width: number; height: number; pxPerSecond: number; color: string;
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
          points={run.map((f) => `${((f.t - windowStart) / 1000) * pxPerSecond},${yFor(f.frequency)}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />
      ))}
    </Svg>
  );
}

// The "clean" signal — real committed notes, the same ones the notes list on the right
// already shows — deliberately rendered right above RawRow's noisy per-frame guesses so
// the contrast between the two rows demonstrates what segmentation is actually doing.
function NotesRow({ notes, windowStart, height, pxPerSecond, theme }: {
  notes: TabNote[]; windowStart: number; height: number; pxPerSecond: number; theme: Theme;
}) {
  return (
    <View style={{ height }}>
      {notes.map((n) => {
        const left = ((n.start_time - windowStart) / 1000) * pxPerSecond;
        const w    = Math.max(2, (n.duration / 1000) * pxPerSecond);
        return (
          <View
            key={n.id}
            style={{
              position:        'absolute',
              left,
              top:              3,
              width:            w,
              height:           height - 6,
              backgroundColor:  theme.accent,
              opacity:          0.35 + (n.confidence / 100) * 0.65,
              borderRadius:     4,
              alignItems:       'center',
              justifyContent:   'center',
              overflow:         'hidden',
            }}
          >
            {w > 20 && (
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

function RawRow({ frames, windowStart, height, pxPerSecond, harmonicaKey, harmonicaType }: {
  frames: RawFrame[]; windowStart: number; height: number; pxPerSecond: number;
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
        const left = ((seg.startT - windowStart) / 1000) * pxPerSecond;
        const w    = Math.max(1, ((seg.endT - seg.startT) / 1000) * pxPerSecond);
        return (
          <View
            key={i}
            style={{
              position:        'absolute',
              left,
              top:              0,
              width:            w,
              height,
              backgroundColor:  seg.note ? noteColor(seg.note) : SILENCE_COLOR,
              opacity:          seg.note ? 0.85 : 0.12,
              alignItems:       'center',
              justifyContent:   'center',
              overflow:         'hidden',
            }}
          >
            {seg.note && w > 20 && (
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

// The window is a fixed duration (not the whole recording), so tick placement is just a
// constant grid — no need for Frame Inspector's dynamic pickTickInterval zoom logic.
function AxisRow({ windowStart, pxPerSecond, theme }: { windowStart: number; pxPerSecond: number; theme: Theme }) {
  const ticks: number[] = [];
  for (let ms = 0; ms <= LIVE_WINDOW_MS + 1; ms += TICK_INTERVAL_MS) ticks.push(ms);

  return (
    <View style={{ height: AXIS_HEIGHT }}>
      {ticks.map((ms) => {
        const secondsAgo = Math.round((LIVE_WINDOW_MS - ms) / 1000);
        return (
          <Text
            key={ms}
            style={{
              position:   'absolute',
              left:       (ms / 1000) * pxPerSecond,
              fontSize:   9,
              fontFamily: Poppins.regular,
              color:      theme.textMuted,
            }}
          >
            {secondsAgo === 0 ? 'now' : `-${secondsAgo}s`}
          </Text>
        );
      })}
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    panel: {
      flex:            1,
      backgroundColor: t.surface,
      borderRadius:    16,
      borderWidth:     1,
      borderColor:     t.border,
      padding:         16,
      gap:             14,
    },
    panelTitle: {
      fontSize:      FONT.xs,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textMuted,
      letterSpacing: 1.4,
    },
    // "Now playing" card — deliberately the loudest thing in the panel (big type on a
    // tinted surface), since it's what you glance at mid-phrase without reading tracks.
    nowCard: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'space-between',
      gap:               16,
      backgroundColor:   t.surfaceAlt,
      borderRadius:      12,
      paddingHorizontal: 18,
      paddingVertical:   14,
    },
    nowMain:  { flexDirection: 'row', alignItems: 'baseline', gap: 16 },
    nowNote: {
      fontSize:      40,
      lineHeight:    46,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.accent,
      letterSpacing: -1,
      minWidth:      74, // reserves room for "A#4" so the row doesn't jitter per frame
    },
    nowNoteIdle: { color: t.textMuted },
    nowTabWrap:  { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    nowTabLabel: {
      fontSize:      9,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1,
    },
    nowTab: {
      fontSize:   FONT.xl,
      fontFamily: Poppins.extraBold,
      color:      t.textPrimary,
      minWidth:   44,
    },
    nowTabIdle: { color: t.textMuted },
    nowMeta:    { alignItems: 'flex-end', gap: 8 },
    nowFreq: {
      fontSize:    FONT.sm,
      fontFamily:  Poppins.semiBold,
      color:       t.textSub,
      fontVariant: ['tabular-nums'],
    },
    meter: { flexDirection: 'row', gap: 3 },
    meterSegment: {
      width:           16,
      height:          8,
      borderRadius:    2,
      backgroundColor: t.border,
    },

    rows: { flexDirection: 'row', flex: 1 },
    labelRail: { width: LABEL_WIDTH },
    labelCell: { justifyContent: 'center' },
    labelText: { fontSize: 9, fontFamily: Poppins.bold, color: t.textMuted, letterSpacing: 0.8 },
    trackArea: { flex: 1 },
    emptyOverlay: {
      position:       'absolute',
      top:            0,
      left:           0,
      right:          0,
      bottom:         AXIS_HEIGHT,
      alignItems:     'center',
      justifyContent: 'center',
    },
    emptyOverlayText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
    },
  });
}
