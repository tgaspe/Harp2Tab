import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
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
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { getGridRows, type GridRow } from '@/audio/HarmonicaMapper';
import { getFrames } from '@/audio/frameBuffer';
import { selectRecordingId, useAppStore } from '@/store/useAppStore';
import { selectRecordings, useRecordingsStore } from '@/store/useRecordingsStore';
import {
  constantTempoMap, gridLines, msToBarInMap, snapMsToGridInMap,
  type SnapDivision, type TempoMap,
} from '@/audio/tempo';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { WEB_CONTENT_WIDTH } from '@/constants/layout';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

const ROW_HEIGHT       = 28;
// Wide enough for the rail's content plus a gutter on both sides. The cells' fixed
// columns come to 85px (swatch 6+6, sign 7, number 14, modifier 20, note 28+4), so at the
// old 88 they overflowed their own 8px right padding and sat flush against the left edge
// with nothing to spare — 85 + 10 left + 8 right = 103.
const LABEL_WIDTH       = 104;
const DEFAULT_PX_PER_SECOND = 90;
const MIN_PX_PER_SECOND     = 20;
const MAX_PX_PER_SECOND     = 400;
const ZOOM_BUTTON_STEP      = 1.3; // multiplicative step per +/- tap, matching Frame Inspector's convention
// Breathing room left to the right of the last note when fitting the chart to the
// viewport, so the final note doesn't end flush against the edge.
const FIT_PADDING_PX        = 60;
const MIN_DURATION_MS   = 60;
const NUDGE_TIME_MS     = 50;
const RESIZE_HANDLE_W   = 10;
const RULER_HEIGHT      = 30;
// One height for every toolbar control, so the row sits on a single baseline.
const CONTROL_H         = 28;
const DATA_BAR_HEIGHT   = 140;
const DATA_PANEL_TABS_HEIGHT = 34;
const DATA_PANEL_COLLAPSED_HEIGHT = DATA_PANEL_TABS_HEIGHT;
// dataPanel's own box (see its style below) needs paddingTop(6) + dataPanelTabs'
// rendered height (DATA_PANEL_TABS_HEIGHT - 6) + the 6px gap to dataPanelRow +
// DATA_BAR_HEIGHT — i.e. DATA_PANEL_TABS_HEIGHT + 6 + DATA_BAR_HEIGHT once the -6/+6
// cancel. Missing that +6 (the gap) was clipping the bottom ~6px of the axis
// labels/bars via dataPanel's own overflow:'hidden' — negligible at the old 64px bar
// height, clearly visible once it grew to 140.
const DATA_PANEL_EXPANDED_HEIGHT  = DATA_BAR_HEIGHT + DATA_PANEL_TABS_HEIGHT + 6;
// Emit a live drag-tooltip label every Nth onUpdate call rather than every one — bounds
// the JS-thread state-update rate without needing a wall-clock read inside a worklet.
const DRAG_LABEL_THROTTLE = 4;

// Grid resolution (quarter/eighth/sixteenth notes) — always a concrete value, no 'off'
// here (see the snapEnabled/snapSubdivision comment above the state declaration for why
// this is separate from whether snapping is actually turned on).
const SUBDIVISION_CYCLE: Exclude<SnapDivision, 'off'>[] = [4, 8, 16];
const SUBDIVISION_LABELS: Record<Exclude<SnapDivision, 'off'>, string> = { 4: '1/4', 8: '1/8', 16: '1/16' };

// Playing technique, parsed from the tab string's grammar: sign ("-" = draw, none = blow)
// + hole number + optional modifier ("'" x1-3 = bend depth, "o" = overblow). An empty
// tab (getGridRows' sentinel for "this row exists on the chromatic grid but isn't a
// real position on the current instrument") is its own category, not a fallback into
// 'blow' — it used to silently fall through to 'blow' before unplayable rows existed,
// which was wrong the moment a note could actually land on one.
type NoteTechnique = 'blow' | 'draw' | 'bend1' | 'bend2' | 'bend3' | 'overblow' | 'unplayable';

function classifyTechnique(tab: string): NoteTechnique {
  if (tab === '') return 'unplayable';
  if (tab.endsWith('o')) return 'overblow';
  const bendDepth = (tab.match(/'/g) ?? []).length;
  if (bendDepth === 1) return 'bend1';
  if (bendDepth === 2) return 'bend2';
  if (bendDepth >= 3) return 'bend3';
  return tab.startsWith('-') ? 'draw' : 'blow';
}

// Note-block FILL colors — bright, saturated 400/500-level steps, chosen to sit happily
// beside the app's cyan accent (#0cc0df): a blue that's its near-neighbour, purple bends
// continuing the cool side, and orange/yellow as the warm pops. The accent hue itself is
// deliberately NOT used — it's reserved for the selection ring, which has to stay legible
// on top of any of these.
//
// Theme-invariant: these are vivid enough to hold up on both a white and a near-black
// grid, and the label color adapts per block (see labelOn) rather than the fill adapting.
//
// CVD-validated as a categorical set: adjacent-pair separation ΔE 30.3 protan / 19.2
// tritan, normal-vision floor 34.0 — comfortably clear of the thresholds.
const TECHNIQUE_COLOR: Record<NoteTechnique, string> = {
  blow:       '#3B82F6', // blue-500
  draw:       '#F97316', // orange-500
  bend1:      '#C084FC', // purple-400  ─┐ one hue family, deepening with bend depth
  bend2:      '#A855F7', // purple-500   │
  bend3:      '#8B5CF6', // violet-500  ─┘
  overblow:   '#FACC15', // yellow-400 — the rarest technique, the brightest pop
  unplayable: '#A1A1AA', // zinc-400 — neutral, deliberately outside the hue set above
};

const TECHNIQUE_LABEL: Record<NoteTechnique, string> = {
  blow: 'Blow', draw: 'Draw', bend1: 'Bend ×1', bend2: 'Bend ×2', bend3: 'Bend ×3', overblow: 'Overblow',
  unplayable: 'Not on this harmonica',
};

function techniqueColor(tab: string): string {
  return TECHNIQUE_COLOR[classifyTechnique(tab)];
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const BLOCK_LABEL_DARK = '#0A0A0B';

/** Black-or-white label, whichever contrasts better with this particular fill. Fixing the
 *  label to white is what forced every previous palette to stay dark and muted — a vivid
 *  yellow under white text measures 1.5:1. Choosing per block frees the fills to actually
 *  be lively; every entry in TECHNIQUE_COLOR clears 4.5:1 against its chosen label
 *  (worst: bend3 at 4.67:1, best: overblow at 12.9:1). */
function labelOn(fill: string): string {
  const l = relativeLuminance(fill);
  const withWhite = 1.05 / (l + 0.05);
  const withDark  = (l + 0.05) / (relativeLuminance(BLOCK_LABEL_DARK) + 0.05);
  return withWhite >= withDark ? '#FFFFFF' : BLOCK_LABEL_DARK;
}

/** Opaque mix of `hex` over `base`. Used for the block's own hairline edge — a darkened
 *  step of its fill, which keeps light fills (yellow at 1.9:1 against a white grid) from
 *  dissolving into the background without resorting to a heavy outline. */
function mixHex(hex: string, base: string, alpha: number): string {
  const f = channels(hex);
  const b = channels(base);
  const m = f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)));
  return `#${m.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The edge has to work against opposite backgrounds, so it can't be one fixed mix: on
 *  the white light-mode grid it darkens the fill (a 0.78 mix left the yellow block's edge
 *  at 2.5:1 and the block dissolved into the page); on the near-black dark grid the fill
 *  is already high-contrast, so the edge only needs to lift slightly to define the shape. */
function techniqueSkin(tab: string, isDark: boolean) {
  const fill = techniqueColor(tab);
  return {
    fill,
    label: labelOn(fill),
    edge:  isDark ? mixHex(fill, '#FFFFFF', 0.72) : mixHex(fill, '#000000', 0.58),
  };
}

// A note block's own label — the tab, or (for an unplayable note, tab: '') its pitch
// name instead, so the block never renders blank.
function noteBlockLabel(note: TabNote): string {
  return note.tab || note.note;
}

// Below this, a note's detection is shaky enough to be worth flagging (dashed edge).
// Deliberately well under the 60–85% a normal clean note lands at, so the flag stays rare
// and meaningful instead of decorating the entire grid.
const LOW_CONFIDENCE_THRESHOLD = 50;

// Matches the existing "Add Note" toolbar button's default (edit.tsx) — the pencil tool's
// click-to-create uses the same baseline duration for consistency.
const DEFAULT_NEW_NOTE_DURATION_MS = 300;

function maxOf(nums: number[], floor: number): number {
  return nums.reduce((m, n) => (n > m ? n : m), floor);
}

// Sub-second durations read better as "320ms", longer ones as "1.4s" — matches how the
// rest of the app formats short clip lengths.
function formatDurationLabel(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

// mm:ss.ss — for the live drag tooltip's absolute-position readouts (move, group move's
// delta), as opposed to formatDurationLabel's relative "how long" phrasing.
function formatTimestamp(ms: number): string {
  const clamped = Math.max(0, ms);
  const m = Math.floor(clamped / 60000);
  const s = (clamped % 60000) / 1000;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// Signed duration — for a group move's drag tooltip, which has no single "start" to show
// (every selected note shifts by the same amount, but from different starting points).
function formatDeltaLabel(ms: number): string {
  return `${ms >= 0 ? '+' : '-'}${formatDurationLabel(Math.abs(ms))}`;
}

// Axis labels for the data panel's y-axis rail — top/bottom (and, for the bipolar
// Pitch Bend metric, a center "0¢" tick) describing the scale each metric's bars are
// actually drawn against, so a bar's height means something without cross-referencing code.
function getDataAxisLabels(
  metric: 'breath' | 'duration' | 'confidence' | 'pitchBend',
  notes: TabNote[],
): { top: string; mid?: string; bottom: string } {
  switch (metric) {
    case 'duration':
      return { top: formatDurationLabel(maxOf(notes.map((n) => n.duration), 1)), bottom: '0' };
    case 'confidence':
      return { top: '100%', bottom: '0%' };
    case 'breath':
      // Bars are normalized against the loudest frame in the recording, not an absolute
      // loudness unit — "peak" is the honest label, not a fabricated number.
      return { top: 'Peak', bottom: '0' };
    case 'pitchBend':
      return { top: '+50¢', mid: '0¢', bottom: '−50¢' };
  }
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

// Plain-English reading of a tab string, for the row rail's hover tooltip — "-10'" is
// unambiguous once you know the grammar and opaque until then, and the rail's technique
// swatch has no legend of its own outside the help modal.
function describePosition(tab: string): string {
  if (tab === '') return 'Not reachable on this harmonica';
  const { sign, number, modifier } = parseTab(tab);
  const breath = sign === '-' ? 'Draw' : 'Blow';
  const bends = (modifier.match(/'/g) ?? []).length;
  const extra = modifier.endsWith('o') ? ', overblow' : bends > 0 ? `, bend ×${bends}` : '';
  return `${breath} hole ${number}${extra}`;
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

// Icon-only toolbar button with a hover tooltip (web). Every glyph-only control in the
// tool row goes through this — zoom, fit, transpose — because a bare chevron or
// circled-arrow icon says nothing about what it does, and the transpose ones additionally
// need to explain *why* they're greyed out (nothing selected) rather than just looking
// broken. Same tooltip treatment as the ruler's loop-pin dock.
function ToolButton({
  icon, label, hint, onPress, disabled = false, align = 'left', theme, styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Second tooltip line — a shortcut, or the reason the button is disabled. */
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Which edge of the button the tooltip hangs from, so it can't run off the panel. */
  align?: 'left' | 'right';
  theme: Theme;
  styles: ReturnType<typeof createStyles>;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <View
      style={styles.toolBtnAnchor}
      {...(Platform.OS === 'web'
        ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
        : null)}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={[styles.zoomBtn, disabled && styles.zoomBtnDisabled]}
        accessibilityRole="button"
        accessibilityLabel={hint ? `${label} — ${hint}` : label}
        accessibilityState={{ disabled }}
      >
        <Ionicons name={icon} size={14} color={disabled ? theme.textMuted : theme.textSub} />
      </Pressable>
      {hovered && (
        <View
          pointerEvents="none"
          style={[styles.toolTooltip, align === 'right' ? styles.toolTooltipRight : styles.toolTooltipLeft]}
        >
          <Text style={styles.toolTooltipText}>{label}</Text>
          {hint !== undefined && <Text style={styles.toolTooltipHint}>{hint}</Text>}
        </View>
      )}
    </View>
  );
}

// One row of the frozen left rail: technique swatch + tab + note name, with a hover
// tooltip spelling out what the tab notation actually means. The rail is neutral ink,
// with a small technique swatch instead of colored text — the note fills are vivid on
// purpose, and a vivid hue used as small text fails contrast badly (yellow on white
// measures ~1.5:1); a swatch is a graphical mark, so it carries the same legend role
// safely, and the tooltip is what names the color.
function LabelRailCell({ row, top, isOctaveBoundary, styles }: {
  row: GridRow;
  /** Absolute offset in the rail — the cell's own row index times ROW_HEIGHT. Positioned
   *  rather than laid out in flow so off-screen cells can be culled. */
  top: number;
  isOctaveBoundary: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const [hovered, setHovered] = useState(false);
  const { sign, number, modifier } = parseTab(row.tab);
  return (
    <View
      style={[
        styles.labelCell,
        { position: 'absolute', top, left: 0, right: 0 },
        !isNaturalNote(row.note) && styles.rowStripeAlt,
        isOctaveBoundary && styles.octaveBoundary,
        !row.playable && styles.rowUnplayable,
        hovered && styles.labelCellHovered,
      ]}
      {...(Platform.OS === 'web'
        ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
        : null)}
    >
      {row.playable ? (
        <View style={[styles.labelSwatch, { backgroundColor: techniqueColor(row.tab) }]} />
      ) : (
        // An unplayable row's tab columns are all empty strings, which left a blank cell
        // that read as a rendering gap rather than "no position for this pitch".
        <Text style={styles.labelUnplayableMark}>–</Text>
      )}
      <Text style={styles.labelTabSign} numberOfLines={1}>{sign}</Text>
      <Text style={styles.labelTabNumber} numberOfLines={1}>{number}</Text>
      <Text style={styles.labelTabModifier} numberOfLines={1}>{modifier}</Text>
      <Text style={styles.labelNote} numberOfLines={1}>{row.note}</Text>

      {hovered && (
        <View pointerEvents="none" style={styles.labelTooltip}>
          <Text style={styles.labelTooltipText}>{describePosition(row.tab)}</Text>
          <Text style={styles.labelTooltipHint}>
            {row.playable ? row.note : `${row.note} · still plays back, just has no hole here`}
          </Text>
        </View>
      )}
    </View>
  );
}

interface PianoRollProps {
  notes:          TabNote[];
  harmonicaKey:   HarmonicaKey | null;
  harmonicaType:  HarmonicaType;
  bpm:            number;
  /** Piecewise tempo/meter map. A tab session has exactly one tempo, so the editor passes
   *  nothing and gets `constantTempoMap(bpm)`; the MIDI Studio passes a real map parsed
   *  from the file. Everything below is written against the map, so both stages share one
   *  code path rather than the grid having a constant-tempo and a variable-tempo version. */
  tempoMap?:      TempoMap;
  /** Overrides the harmonica-derived pitch axis. The Studio passes `getChromaticRows()`;
   *  the tab editor passes nothing and keeps deriving rows from its key and type. */
  rows?:          GridRow[];
  /** Tracks other than the one being edited, drawn behind it and completely inert. Keeping
   *  them non-interactive is a hard requirement, not a simplification: interactivity here
   *  means a gesture-handler instance per note, which is what the note culling below exists
   *  to limit in the first place. */
  backgroundLanes?: { id: string; color: string; notes: TabNote[] }[];
  selectedId:     string | null;
  onSelect:       (id: string) => void;
  onCreate:       (note: Omit<TabNote, 'id'>) => void;
  onUpdate:       (id: string, changes: NoteUpdate) => void;
  onDelete:       (id: string) => void;
  isPlaying:      boolean;
  currentTimeMs:  number;
  onSeek:         (ms: number) => void;
  // A/B loop region marked on the ruler — controlled from the parent (edit.tsx) since it
  // needs to reach usePlayback's play() calls too, the same shape as currentTimeMs/onSeek.
  loopRegion:          { startMs: number; endMs: number } | null;
  onLoopRegionChange:  (region: { startMs: number; endMs: number } | null) => void;
  /** Rendered at the head of the tool row, left of the zoom controls — the parent puts
   *  the chart's title/meta there so the editor's own header is the panel's own header,
   *  rather than a separate band of page chrome floating above the panel. */
  headerLeft?:         React.ReactNode;
}

export function PianoRoll({
  notes, harmonicaKey, harmonicaType, bpm, tempoMap, rows, backgroundLanes, selectedId, onSelect, onCreate, onUpdate, onDelete, isPlaying, currentTimeMs, onSeek,
  loopRegion, onLoopRegionChange, headerLeft,
}: PianoRollProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Compiling is a small cost but not a free one, and this feeds every snap and every grid
  // line — memoized so a re-render for an unrelated reason doesn't rebuild it.
  const map = useMemo(() => tempoMap ?? constantTempoMap(bpm), [tempoMap, bpm]);

  // Two separate ideas that used to be crammed into one cycling control: `snapEnabled` is
  // just on/off — whether placing/moving/dragging a note quantizes to the grid at all, or
  // lands wherever you drop it. `snapSubdivision` is the grid's resolution (quarter/
  // eighth/sixteenth) — it always has a concrete value and drives the visual grid lines
  // regardless of whether snapping is currently on, same as a DAW's grid stays visible
  // even with "snap to grid" turned off. `snapDivision` below is the derived value
  // everything that actually *quantizes a position* already consumes (unchanged from
  // before) — 'off' when snapping is disabled, the subdivision otherwise.
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapSubdivision, setSnapSubdivision] = useState<Exclude<SnapDivision, 'off'>>(8);
  const snapDivision: SnapDivision = snapEnabled ? snapSubdivision : 'off';
  const [helpOpen, setHelpOpen] = useState(false);
  // Transient banner for "N note(s) couldn't move" — no app-wide toast system exists
  // yet, so this is scoped to just what this component needs.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current); }, []);
  const [metricTab, setMetricTab] = useState<'breath' | 'duration' | 'confidence' | 'pitchBend'>('breath');
  const [scrollX, setScrollX] = useState(0);
  // Vertical offset, tracked only so rows can be culled — nothing else reads it.
  const [scrollY, setScrollY] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  // Height of the scrollable grid viewport (not the full row ladder) — needed to center
  // the notes vertically on first paint, see the auto-fit effect below.
  const [gridViewportHeight, setGridViewportHeight] = useState(0);
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

  // Tracks whether Shift is currently held (web only — no keyboard on touch), read from
  // plain JS-thread handler functions below (never from inside a worklet directly), so
  // there's no cross-thread staleness concern despite it being a plain ref rather than a
  // Reanimated shared value. Drives the selection tool's additive click/drag-marquee.
  const shiftHeldRef = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Shift') shiftHeldRef.current = true; }
    function onKeyUp(e: KeyboardEvent) { if (e.key === 'Shift') shiftHeldRef.current = false; }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

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
  const vScrollRef = useRef<ScrollView>(null);
  const subdivisionBtnRef = useRef<View>(null);
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

  // Always the full chromatic row ladder, not just the current instrument's own
  // positions — see getGridRows. `positions` keeps its name since most of this file
  // still just treats it as "the row list"; `row.playable` is what's new.
  //
  // Injected wholesale by the MIDI Studio (`getChromaticRows`), which has no harmonica and
  // so no key to derive rows from. Everything below indexes rows positionally and reads
  // `note`/`midi`/`playable`, none of which are harmonica-specific — which is why one
  // component can serve both stages.
  const derivedRows = useMemo(
    () => (harmonicaKey ? getGridRows(harmonicaKey, harmonicaType) : []),
    [harmonicaKey, harmonicaType],
  );
  const positions = rows ?? derivedRows;

  const dataAxisLabels = useMemo(() => getDataAxisLabels(metricTab, notes), [metricTab, notes]);

  // Breath Force and Pitch Bend are per-frame metrics — they need the raw analysis
  // frames, which a chart that was drawn by hand (or saved before frame retention) simply
  // doesn't have. Duration/Confidence come off the notes themselves and always do.
  const metricHasData = metricTab === 'breath' || metricTab === 'pitchBend'
    ? frames.length > 0
    : notes.length > 0;

  // A chart with no frames at all opens with the panel collapsed rather than reserving
  // ~150px for a permanently empty box. One-shot: once the user has touched the collapse
  // toggle (or frames arrive later) this never re-decides for them.
  const didInitPanelRef = useRef(false);
  useEffect(() => {
    if (didInitPanelRef.current) return;
    didInitPanelRef.current = true;
    if (frames.length === 0) {
      setPanelCollapsed(true);
      panelHeight.value = DATA_PANEL_COLLAPSED_HEIGHT;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames.length]);

  // Render-time mirror of getSelectionNotes()'s count — that one reads refs (it's called
  // from keyboard handlers and worklet callbacks), which don't re-render, so the toolbar
  // can't derive its enabled/disabled state from it.
  const selectionCount = mouseMode === 'pencil' ? (selectedId ? 1 : 0) : selectedIds.length;
  const hasSelection = selectionCount > 0;

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

  // The vertical counterpart, added for the Studio: a harmonica ladder is ~40 rows and
  // could be drawn in full, but a full-range chromatic one is 128, each producing a label
  // cell (with its own hover state) and a stripe. Rows are uniform height and absolutely
  // positioned by index, so culling them is a slice — no measurement, no spacers.
  const CULL_MARGIN_ROWS = 4;
  const firstVisibleRow = Math.max(
    0,
    Math.floor(scrollY / ROW_HEIGHT) - CULL_MARGIN_ROWS,
  );
  const lastVisibleRow = Math.min(
    positions.length - 1,
    Math.ceil((scrollY + (gridViewportHeight || positions.length * ROW_HEIGHT)) / ROW_HEIGHT) + CULL_MARGIN_ROWS,
  );
  const visibleRows = useMemo(
    () => positions
      .slice(firstVisibleRow, lastVisibleRow + 1)
      // The absolute index is what every position calculation is in terms of, so it has to
      // survive the slice.
      .map((row, i) => ({ row, index: firstVisibleRow + i })),
    [positions, firstVisibleRow, lastVisibleRow],
  );

  // Pitch name → row index. Built once per row list rather than a `findIndex` per note:
  // background lanes can hold thousands of notes across a whole arrangement, where the
  // linear scan the interactive path uses would be quadratic.
  const rowIndexByNote = useMemo(() => {
    const index = new Map<string, number>();
    positions.forEach((p, i) => index.set(p.note, i));
    return index;
  }, [positions]);

  // Culled on both axes before any View is created — an orchestral file has far more
  // background notes than foreground ones, so this is the loop that has to stay cheap.
  const backgroundNoteBlocks = useMemo(() => {
    if (!backgroundLanes?.length) return [];
    const blocks: { key: string; left: number; top: number; width: number; color: string }[] = [];

    for (const lane of backgroundLanes) {
      for (const note of lane.notes) {
        if (note.start_time + note.duration < visibleStartMs || note.start_time > visibleEndMs) continue;
        const rowIndex = rowIndexByNote.get(note.note);
        if (rowIndex === undefined || rowIndex < firstVisibleRow || rowIndex > lastVisibleRow) continue;
        blocks.push({
          key:   `${lane.id}:${note.id}`,
          left:  (note.start_time / 1000) * pxPerSecond,
          top:   rowIndex * ROW_HEIGHT,
          width: Math.max(3, (note.duration / 1000) * pxPerSecond),
          color: lane.color,
        });
      }
    }
    return blocks;
  }, [backgroundLanes, rowIndexByNote, visibleStartMs, visibleEndMs, firstVisibleRow, lastVisibleRow, pxPerSecond]);

  // Shared by the marquee hit-test and the group-selection bounding box — content-space
  // {left, top, width, height} for a note, or null if its pitch doesn't match any row
  // (shouldn't normally happen, but positions can lag a stale note during a key change).
  // Matched by pitch (note), not tab — an unplayable note has tab: '', which isn't
  // unique across rows, but its pitch always is.
  function noteBounds(note: TabNote): { left: number; top: number; width: number; height: number } | null {
    const rowIndex = positions.findIndex((p) => p.note === note.note);
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

    // A plain click (no movement) on an existing note never activates that note's own
    // Pan gesture — Pan only recognizes once the touch moves past RNGH's drag threshold —
    // so this background gesture is what actually receives it. Without this hit-test,
    // that click would stack a brand-new note underneath the one being clicked instead of
    // selecting it.
    const hit = notes.find((n) => {
      const b = noteBounds(n);
      return b !== null && x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;
    });
    if (hit) { onSelect(hit.id); return; }

    const rowIndex = Math.min(positions.length - 1, Math.max(0, Math.floor(y / ROW_HEIGHT)));
    const pos = positions[rowIndex];
    const rawStart = Math.max(0, (x / pxPerSecond) * 1000);
    const start = snapMsToGridInMap(map, Math.round(rawStart), snapDivision);
    onCreate({ tab: pos.tab, note: pos.note, start_time: start, duration: DEFAULT_NEW_NOTE_DURATION_MS, confidence: 100 });
    const updated = useAppStore.getState().tabNotes;
    const created = updated[updated.length - 1];
    if (created) onSelect(created.id);
  }

  // Selection tool: commits a completed marquee drag (content-space corners) into a set
  // of selected note ids — any note whose rect overlaps the marquee rect at all. Shift
  // held at drag-end (not drag-start — simpler to just read the ref once here, and
  // releasing Shift mid-drag is a rare enough case not to special-case) unions the
  // matches into the existing selection instead of replacing it.
  function commitMarquee(x0: number, y0: number, x1: number, y1: number) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const matched = notes.filter((n) => {
      const b = noteBounds(n);
      return b !== null && b.left < right && b.left + b.width > left && b.top < bottom && b.top + b.height > top;
    });
    const matchedIds = matched.map((n) => n.id);
    if (shiftHeldRef.current) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...matchedIds])));
    } else {
      setSelectedIds(matchedIds);
    }
  }

  // Selection tool: a plain (non-drag) click — hit-tests against notes the same way the
  // marquee does. A hit replaces the selection with just that note, or (Shift held)
  // toggles it in/out of the existing selection; a miss clears the selection (Shift+miss
  // is a no-op, since there's nothing to toggle). This is what makes a stationary click
  // in selection mode do anything at all — Gesture.Pan alone (the marquee) never
  // activates for a touch with no movement, the same root cause as the pencil-tool
  // "click creates a note instead of selecting" bug fixed earlier.
  function handleSelectionTapAt(x: number, y: number) {
    const hit = notes.find((n) => {
      const b = noteBounds(n);
      return b !== null && x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;
    });
    if (shiftHeldRef.current) {
      if (hit) {
        setSelectedIds((prev) => (prev.includes(hit.id) ? prev.filter((id) => id !== hit.id) : [...prev, hit.id]));
      }
      return;
    }
    setSelectedIds(hit ? [hit.id] : []);
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

  function cycleSubdivision() {
    const i = SUBDIVISION_CYCLE.indexOf(snapSubdivision);
    setSnapSubdivision(SUBDIVISION_CYCLE[(i + 1) % SUBDIVISION_CYCLE.length]);
  }

  // Retroactively snaps existing notes' start times to the current grid — unlike snap
  // during create/move/resize (which only ever affects the edit being made right now),
  // this is for notes that came in slightly off-grid from live pitch detection. Applies
  // to the current selection if there is one, otherwise every note. Duration is left
  // untouched — same as every other place in this file, snap only ever affects position.
  // Always available, regardless of whether continuous snap-while-dragging is currently
  // toggled on — quantize is a distinct, explicit "snap these to the grid now" action, so
  // it always targets the current subdivision rather than being gated by snapEnabled.
  function handleQuantize() {
    const targets = getSelectionNotes();
    const applyTo = targets.length > 0 ? targets : notes;
    if (applyTo.length === 0) return;
    useAppStore.getState().updateNotes(applyTo.map((n) => ({
      id: n.id,
      changes: { start_time: snapMsToGridInMap(map, n.start_time, snapSubdivision) },
    })));
  }

  // Viewport-center-anchored zoom (the +/- buttons and the %-pill's reset-to-default) —
  // same math as the wheel handler below, just anchored to the middle of the visible
  // area instead of the cursor, since a button press has no cursor position of its own.
  function zoomByFactor(factor: number) {
    const oldPx = pxPerSecond;
    const newPx = Math.max(MIN_PX_PER_SECOND, Math.min(MAX_PX_PER_SECOND, oldPx * factor));
    if (newPx === oldPx) return;
    const centerTimeMs = viewportWidth > 0 ? ((scrollX + viewportWidth / 2) / oldPx) * 1000 : 0;
    const newScrollX = Math.max(0, (centerTimeMs / 1000) * newPx - viewportWidth / 2);
    setPxPerSecond(newPx);
    setScrollX(newScrollX);
    isProgrammaticScrollRef.current = true;
    hScrollRef.current?.scrollTo({ x: newScrollX, animated: false });
  }

  // Zoom + scroll so the whole chart is actually on screen: horizontally the full
  // duration fills the viewport, vertically the used pitch range is centered.
  //
  // Without this the editor looks empty even when it isn't. The row ladder is the full
  // chromatic range (40+ rows, well past a viewport) and starts scrolled to its highest
  // rows, while the default 90px/second means a two-second chart occupies the leftmost
  // sliver of a five-bar-wide grid — so a saved chart opened onto blank high rows several
  // seconds past where any of its notes were.
  function fitToContent() {
    if (positions.length === 0) return;

    if (totalMs > 0 && viewportWidth > 0) {
      const target = ((viewportWidth - FIT_PADDING_PX) / totalMs) * 1000;
      const newPx = Math.max(MIN_PX_PER_SECOND, Math.min(MAX_PX_PER_SECOND, target));
      setPxPerSecond(newPx);
      setScrollX(0);
      isProgrammaticScrollRef.current = true;
      hScrollRef.current?.scrollTo({ x: 0, animated: false });
    }

    // Renamed off `rows` once that became a prop — this is the set of row *indices* the
    // notes occupy, not the row list itself.
    const occupiedRows = notes
      .map((n) => positions.findIndex((p) => p.note === n.note))
      .filter((i) => i >= 0);
    if (occupiedRows.length === 0 || gridViewportHeight === 0) return;
    const centerPx = ((Math.min(...occupiedRows) + Math.max(...occupiedRows) + 1) / 2) * ROW_HEIGHT;
    const maxY = Math.max(0, positions.length * ROW_HEIGHT - gridViewportHeight);
    vScrollRef.current?.scrollTo({
      y: Math.max(0, Math.min(maxY, centerPx - gridViewportHeight / 2)),
      animated: false,
    });
  }

  // Runs fitToContent once, on the first render where both viewport dimensions have been
  // measured and there's something to fit. Ref-guarded rather than dependency-guarded:
  // after that first fit, the view belongs to the user, and neither editing notes nor a
  // window resize should yank their zoom/scroll back.
  const didAutoFitRef = useRef(false);
  // ...but a different chart is a different thing to look at, so loading one re-arms the
  // fit. Declared above the fit effect so that on a recording change this clears the flag
  // before the effect below gets its chance to act on it.
  useEffect(() => { didAutoFitRef.current = false; }, [recordingId]);
  useEffect(() => {
    if (didAutoFitRef.current) return;
    if (notes.length === 0 || positions.length === 0) return;
    if (viewportWidth === 0 || gridViewportHeight === 0) return;
    didAutoFitRef.current = true;
    fitToContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.length, positions.length, viewportWidth, gridViewportHeight]);

  // Arrow-key nudge (web/keyboard only) for the currently-selected note: Left/Right nudges
  // time, Up/Down moves to the adjacent playable row, Backspace/Delete removes it.
  const notesRef        = useRef(notes);        notesRef.current        = notes;
  const selectedIdRef   = useRef(selectedId);   selectedIdRef.current   = selectedId;
  const currentTimeMsRef = useRef(currentTimeMs); currentTimeMsRef.current = currentTimeMs;

  // Copy/duplicate/paste clipboard — component-local (not the store) since it's a
  // session-scoped editing convenience, not data that needs to persist or undo on its
  // own. Holds each copied note's shape plus its offset from the earliest copied note,
  // so pasting a multi-note copy preserves their relative spacing.
  const clipboardRef = useRef<{ tab: string; note: string; duration: number; offsetMs: number }[]>([]);

  // Both selection models funnel through here — pencil's single `selectedId` or
  // selection-mode's `selectedIds` — so duplicate/copy/paste work the same regardless
  // of which tool is active.
  function getSelectionNotes(): TabNote[] {
    if (mouseModeRef.current === 'pencil') {
      const id = selectedIdRef.current;
      const note = id ? notesRef.current.find((n) => n.id === id) : undefined;
      return note ? [note] : [];
    }
    return notesRef.current.filter((n) => selectedIdsRef.current.includes(n.id));
  }

  // Selects whatever addTabNotes just appended — relies on it being the tail of the
  // store's array (addTabNotes only ever pushes, never reorders) rather than matching by
  // content, so two identical duplicated notes can't be confused with each other.
  function selectNewest(count: number) {
    const updated = useAppStore.getState().tabNotes;
    const created = updated.slice(updated.length - count);
    if (mouseModeRef.current === 'pencil') {
      if (created[0]) onSelect(created[0].id);
    } else {
      setSelectedIds(created.map((n) => n.id));
    }
  }

  // Duplicate: places a copy of each selected note immediately after it ends, back-to-
  // back — no clipboard involved, distinct from copy/paste below (which anchors to the
  // playhead instead). Full confidence, matching a fresh pencil-drawn note: this is a
  // deliberate user action, not a re-run of pitch detection.
  function handleDuplicate() {
    const targets = getSelectionNotes();
    if (targets.length === 0) return;
    useAppStore.getState().addTabNotes(targets.map((n) => ({
      tab: n.tab, note: n.note, confidence: 100,
      start_time: n.start_time + n.duration, duration: n.duration,
    })));
    selectNewest(targets.length);
  }

  function handleCopy() {
    const targets = getSelectionNotes();
    if (targets.length === 0) return;
    const earliestStart = Math.min(...targets.map((n) => n.start_time));
    clipboardRef.current = targets.map((n) => ({
      tab: n.tab, note: n.note, duration: n.duration, offsetMs: n.start_time - earliestStart,
    }));
  }

  // Re-anchors the earliest copied note to the current playhead position, preserving
  // the relative spacing between copied notes for a multi-note copy.
  function handlePaste() {
    const clip = clipboardRef.current;
    if (clip.length === 0) return;
    const anchor = currentTimeMsRef.current;
    useAppStore.getState().addTabNotes(clip.map((c) => ({
      tab: c.tab, note: c.note, duration: c.duration, confidence: 100,
      start_time: Math.max(0, anchor + c.offsetMs),
    })));
    selectNewest(clip.length);
  }

  function showToast(message: string) {
    setToastMessage(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2500);
  }

  // Shared by Arrow Up/Down (rowDelta=±1), Shift+Arrow Up/Down (±12), and the semitone/
  // octave toolbar buttons below — moves every currently-selected note (via
  // getSelectionNotes, which already abstracts over pencil's single selectedId vs.
  // selection-mode's marquee set) up/down the chromatic row grid, committed as one bulk
  // updateNotes call. A note that can't move the full distance without falling off the
  // grid is skipped individually rather than blocking the rest — this is the semitone-
  // scale "clamp" policy; the octave *button* instead disables itself upfront when any
  // selected note is at the edge (see canShiftOctave below) so this function is only
  // ever called there once success is already guaranteed. Shift+Arrow has no such
  // disabled-button concept (a keyboard shortcut can't grey itself out), so it always
  // uses this same skip-and-report behavior regardless of scale.
  function shiftSelectionByRows(rowDelta: number) {
    const targets = getSelectionNotes();
    if (targets.length === 0) return;
    const updates: { id: string; changes: NoteUpdate }[] = [];
    let skipped = 0;
    for (const n of targets) {
      const rowIndex = positions.findIndex((p) => p.note === n.note);
      const newRow = rowIndex + rowDelta;
      if (rowIndex === -1 || newRow < 0 || newRow >= positions.length) { skipped++; continue; }
      const p = positions[newRow];
      updates.push({ id: n.id, changes: { tab: p.tab, note: p.note } });
    }
    if (updates.length > 0) useAppStore.getState().updateNotes(updates);
    if (skipped > 0) {
      showToast(`${skipped} note${skipped !== 1 ? 's' : ''} couldn't move — already at the edge`);
    }
  }

  // Octave-button gate: disabled if *any* selected note would fall off the grid,
  // rather than silently moving only some of the selection (see shiftSelectionByRows'
  // own comment for why that's a deliberately different policy from the keyboard path).
  function canShiftOctave(direction: 1 | -1): boolean {
    const targets = getSelectionNotes();
    if (targets.length === 0) return false;
    return targets.every((n) => {
      const rowIndex = positions.findIndex((p) => p.note === n.note);
      const newRow = rowIndex + direction * 12;
      return rowIndex !== -1 && newRow >= 0 && newRow < positions.length;
    });
  }

  useEffect(() => {
    if (Platform.OS !== 'web' || positions.length === 0) return;

    function onKeyDown(e: KeyboardEvent) {
      // Copy/duplicate/paste — work regardless of tool/selection model (see
      // getSelectionNotes above), same as the tool shortcuts just below.
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'd' || e.key === 'D') { e.preventDefault(); handleDuplicate(); return; }
        if (e.key === 'c' || e.key === 'C') { e.preventDefault(); handleCopy(); return; }
        if (e.key === 'v' || e.key === 'V') { e.preventDefault(); handlePaste(); return; }
      }

      // Tool shortcuts, matching Signal's [1]/[2] — work regardless of selection.
      if (e.key === '1') { setMouseMode('pencil'); setSelectedIds([]); return; }
      if (e.key === '2') { setMouseMode('selection'); return; }

      // Selection-mode operates on the marquee set, not the single selectedId — the two
      // selection models are mode-scoped, not merged (see mouseMode state above). Arrow
      // nudge/row-move commits as one bulk updateNotes call (same as group move/resize)
      // so undoing a multi-note nudge is a single Ctrl+Z, not one per note.
      if (mouseModeRef.current === 'selection') {
        const ids = selectedIdsRef.current;
        if (ids.length === 0) return;

        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          ids.forEach((sid) => onDelete(sid));
          setSelectedIds([]);
          return;
        }

        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const dtMs = e.key === 'ArrowLeft' ? -NUDGE_TIME_MS : NUDGE_TIME_MS;
          const updates = ids
            .map((sid) => notesRef.current.find((n) => n.id === sid))
            .filter((n): n is TabNote => n !== undefined)
            .map((n) => ({ id: n.id, changes: { start_time: Math.max(0, n.start_time + dtMs) } }));
          if (updates.length > 0) useAppStore.getState().updateNotes(updates);
          return;
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const sign = e.key === 'ArrowUp' ? -1 : 1;
          shiftSelectionByRows(sign * (e.shiftKey ? 12 : 1));
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

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const sign = e.key === 'ArrowUp' ? -1 : 1;
        shiftSelectionByRows(sign * (e.shiftKey ? 12 : 1));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [positions, onUpdate, onDelete, onSelect]);

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

  // Hover the subdivision button + scroll to step through it — a lower-chrome way to
  // change a stepped value than clicking repeatedly, without adding a dropdown. Not on
  // the plain on/off Snap toggle next to it — a 2-state toggle doesn't need this.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = subdivisionBtnRef.current as unknown as HTMLElement | null;
    if (!node) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      setSnapSubdivision((prev) => {
        const i = SUBDIVISION_CYCLE.indexOf(prev);
        return SUBDIVISION_CYCLE[(i + dir + SUBDIVISION_CYCLE.length) % SUBDIVISION_CYCLE.length];
      });
    }

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  if (!harmonicaKey || positions.length === 0) return null;

  const playheadLeft = (currentTimeMs / 1000) * pxPerSecond;
  const showPlayhead = isPlaying || currentTimeMs > 0;

  // Click the ruler to move the playhead there — the parent decides whether that's a plain
  // seek or a scrub that restarts playback from the new spot (see edit.tsx's handleSeek).
  // Attached directly to rulerContent, which is sized to gridWidth and only visually
  // shifted via a transform for scroll-sync, so the gesture's local x is already in the
  // same content-space coordinates as bar/note positions — no manual scrollX offset
  // needed, same reasoning as the grid's own background gesture.
  const rulerTapGesture = Gesture.Tap().onEnd((e, success) => {
    if (success) runOnJS(onSeek)(Math.max(0, (e.x / pxPerSecond) * 1000));
  });

  // Loop region placement — drag a pin out of the dock that sits left of the ruler (like
  // pulling a guide out of a design tool's corner ruler), drop it, then drag a second one
  // out for the other edge. Deliberately a *separate* element from the ruler itself
  // (rather than dragging on the ruler directly) so there's no ambiguity with
  // rulerTapGesture's plain-click-to-seek above — grabbing the dock is what starts this,
  // nothing about a bare ruler click/drag does.
  const pinDockX        = useSharedValue(0); // live ghost-pin content-space x, meaningful only while dragging
  const pinDockStartX   = useSharedValue(0); // scrollX captured at drag-start, so translationX composes onto a real content-space origin
  const pinDockDragging = useSharedValue(false);
  // Set by the Escape handler below and consumed by commitPinDrop — Escape hides the
  // ghost immediately (a direct shared-value write from JS, not a worklet), but the
  // gesture's onEnd will still fire whenever the pointer is eventually released, so this
  // is what tells that eventual onEnd to skip committing.
  const pinDockCanceledRef = useRef(false);
  // First pin, once dropped, while waiting for the second drag — cleared the moment the
  // second pin completes the region (see commitPinDrop) or on an Escape with no active
  // drag (see the keydown effect below). Ref mirror for commitPinDrop, which — like the
  // rest of this file's gesture-committed handlers — runs via runOnJS and needs the
  // current value, not whatever was current when the gesture object was last built.
  const [firstPinMs, setFirstPinMs] = useState<number | null>(null);
  const firstPinMsRef = useRef(firstPinMs); firstPinMsRef.current = firstPinMs;
  // Hover tooltip so the dock doesn't read as an unexplained blue blob — same
  // onMouseEnter/Leave-on-a-gesture-wrapped-View technique already used for note hover
  // below, web-only since there's no hover concept on touch.
  const [pinDockHovered, setPinDockHovered] = useState(false);

  function commitPinDrop(contentX: number) {
    if (pinDockCanceledRef.current) { pinDockCanceledRef.current = false; return; }
    const ms = Math.max(0, snapMsToGridInMap(map, Math.round((contentX / pxPerSecond) * 1000), snapDivision));
    if (firstPinMsRef.current === null) {
      setFirstPinMs(ms);
      return;
    }
    // Span between the two pins regardless of which was dropped first or second.
    const startMs = Math.min(firstPinMsRef.current, ms);
    const endMs   = Math.max(Math.max(firstPinMsRef.current, ms), startMs + 1);
    onLoopRegionChange({ startMs, endMs });
    setFirstPinMs(null);
  }

  const pinDockGesture = Gesture.Pan()
    .onStart(() => {
      pinDockStartX.value   = scrollXRef.current;
      pinDockX.value         = pinDockStartX.value;
      pinDockDragging.value = true;
    })
    .onUpdate((e) => {
      pinDockX.value = Math.max(0, pinDockStartX.value + e.translationX);
    })
    .onEnd((e) => {
      runOnJS(commitPinDrop)(Math.max(0, pinDockStartX.value + e.translationX));
    })
    .onFinalize(() => {
      pinDockDragging.value = false;
    });

  const pinDockAnimatedStyle = useAnimatedStyle(() => ({
    left: pinDockX.value,
    opacity: pinDockDragging.value ? 1 : 0,
  }));

  // Escape aborts whatever's in progress: a live drag snaps back to the dock without
  // dropping a pin; with no active drag, it clears an already-dropped first pin instead
  // of leaving the user stuck waiting to place a second one they no longer want.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (pinDockDragging.value) {
        pinDockCanceledRef.current = true;
        pinDockDragging.value = false;
      } else if (firstPinMsRef.current !== null) {
        setFirstPinMs(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // A plain Pressable nested inside a gesture-heavy ancestor is untested territory in
  // this file — every other interactive element inside one (resize handles, etc.) is
  // itself a GestureDetector, so the clear button follows that same pattern rather than
  // mixing in RN's own responder system.
  const clearLoopRegionGesture = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(onLoopRegionChange)(null);
  });

  // Live-drag deltas for adjusting an already-marked region's edges — same independent-
  // shared-value-per-handle pattern as a note's own left/right resize handles.
  const loopRegionLeftDelta  = useSharedValue(0);
  const loopRegionRightDelta = useSharedValue(0);

  function commitLoopRegionResize(dLeftPx: number, dRightPx: number) {
    if (!loopRegion) return;
    const rawStart = snapMsToGridInMap(map, Math.round(loopRegion.startMs + (dLeftPx / pxPerSecond) * 1000), snapDivision);
    const rawEnd   = snapMsToGridInMap(map, Math.round(loopRegion.endMs + (dRightPx / pxPerSecond) * 1000), snapDivision);
    const startMs = Math.max(0, Math.min(rawStart, rawEnd - 1));
    const endMs   = Math.max(startMs + 1, rawEnd);
    onLoopRegionChange({ startMs, endMs });
  }

  const loopRegionResizeRightGesture = Gesture.Pan()
    .onUpdate((e) => { loopRegionRightDelta.value = e.translationX; })
    .onEnd((e) => { runOnJS(commitLoopRegionResize)(0, e.translationX); })
    .onFinalize(() => { loopRegionRightDelta.value = 0; });

  const loopRegionResizeLeftGesture = Gesture.Pan()
    .onUpdate((e) => { loopRegionLeftDelta.value = e.translationX; })
    .onEnd((e) => { runOnJS(commitLoopRegionResize)(e.translationX, 0); })
    .onFinalize(() => { loopRegionLeftDelta.value = 0; });

  const loopRegionAnimatedStyle = useAnimatedStyle(() => {
    if (!loopRegion) return { left: 0, width: 0 };
    return {
      left:  (loopRegion.startMs / 1000) * pxPerSecond + loopRegionLeftDelta.value,
      width: Math.max(1,
        ((loopRegion.endMs - loopRegion.startMs) / 1000) * pxPerSecond - loopRegionLeftDelta.value + loopRegionRightDelta.value),
    };
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
  // Pencil: tap empty background to create a note (or select an existing one — see
  // handleCreateNoteAt's own hit-test). Selection: a Race between a plain click (select/
  // toggle a single note, or clear) and a drag (marquee) — individual notes have no
  // gesture of their own in this mode (see `interactive` below), so either one starting
  // on top of a note still reaches this handler, matching Signal.
  const marqueeGesture = Gesture.Pan()
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

  const selectionTapGesture = Gesture.Tap().onEnd((e, success) => {
    if (success) runOnJS(handleSelectionTapAt)(e.x, e.y);
  });

  const backgroundGesture = mouseMode === 'pencil'
    ? Gesture.Tap().onEnd((e, success) => {
        if (success) runOnJS(handleCreateNoteAt)(e.x, e.y);
      })
    : Gesture.Race(selectionTapGesture, marqueeGesture);

  return (
    <View style={styles.outer} onLayout={handleViewportLayout}>
      {/* Title/meta + zoom + tool + snap controls */}
      <View style={styles.toolbarRow}>
        <View style={styles.toolbarRowLeft}>
          {headerLeft}
          {headerLeft !== undefined && <View style={styles.toolbarDivider} />}
          <View style={styles.zoomRow}>
            <ToolButton
              icon="remove"
              label="Zoom out"
              onPress={() => zoomByFactor(1 / ZOOM_BUTTON_STEP)}
              theme={theme}
              styles={styles}
            />
            <Pressable
              onPress={() => zoomByFactor(DEFAULT_PX_PER_SECOND / pxPerSecond)}
              style={styles.zoomPill}
              accessibilityRole="button"
              accessibilityLabel="Reset zoom to default"
            >
              <Text style={styles.zoomPillText}>{Math.round((pxPerSecond / DEFAULT_PX_PER_SECOND) * 100)}%</Text>
            </Pressable>
            <ToolButton
              icon="add"
              label="Zoom in"
              onPress={() => zoomByFactor(ZOOM_BUTTON_STEP)}
              theme={theme}
              styles={styles}
            />
            {/* The manual counterpart to the one-shot auto-fit on open — the way back to
                "show me everything" after zooming or scrolling around. Not `scan-outline`:
                that glyph is already the Select tool's, further right in this same row. */}
            <ToolButton
              icon="contract-outline"
              label="Fit to content"
              hint="Zoom out to the whole chart"
              onPress={fitToContent}
              disabled={notes.length === 0}
              theme={theme}
              styles={styles}
            />
          </View>
        </View>

        <View style={styles.toolbarRowRight}>
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

          <View style={styles.toolbarDivider} />

          {/* On/off — whether placing, moving, or dragging a note quantizes to the grid
              at all. The grid resolution itself lives in the separate button below, and
              stays visible/settable regardless of this toggle. */}
          <Pressable
            onPress={() => setSnapEnabled((v) => !v)}
            style={[styles.snapBtn, snapEnabled && styles.snapBtnActive]}
            accessibilityRole="button"
            accessibilityState={{ checked: snapEnabled }}
            accessibilityLabel={snapEnabled ? 'Snap to grid: on' : 'Snap to grid: off'}
          >
            <Ionicons name="magnet-outline" size={14} color={snapEnabled ? '#fff' : theme.textSub} />
            <Text style={[styles.snapBtnText, snapEnabled && styles.snapBtnTextActive]}>Snap</Text>
          </Pressable>

          {/* Grid resolution — how many divisions per beat, both for the visual grid
              lines and for whatever the Snap toggle above quantizes to when it's on. */}
          <Pressable
            ref={subdivisionBtnRef}
            onPress={cycleSubdivision}
            style={styles.snapBtn}
            accessibilityRole="button"
            accessibilityLabel={`Grid: ${SUBDIVISION_LABELS[snapSubdivision]}`}
          >
            <Ionicons name="grid-outline" size={14} color={theme.textSub} />
            <Text style={styles.snapBtnText}>{SUBDIVISION_LABELS[snapSubdivision]}</Text>
          </Pressable>

          <Pressable
            onPress={handleQuantize}
            style={styles.snapBtn}
            accessibilityRole="button"
            accessibilityLabel={
              selectedId || selectedIds.length > 0
                ? 'Quantize selected notes to the grid'
                : 'Quantize all notes to the grid'
            }
          >
            <Ionicons name="return-down-forward-outline" size={14} color={theme.textSub} />
            <Text style={styles.snapBtnText}>Quantize</Text>
          </Pressable>

          {/* Semitone shift is a button-equivalent of the Arrow Up/Down shortcut
              (always attempts, clamps + toasts on partial failure); octave shift's
              equivalent is Shift+Arrow, but the button additionally disables itself
              rather than ever partially applying across a selection — see
              shiftSelectionByRows/canShiftOctave. `positions` is sorted highest-pitch-
              first (index 0 = top row), so moving to a *higher* pitch means a
              *negative* rowDelta — same convention the Arrow-key handler already uses. */}
          <View style={styles.toolbarDivider} />

          {/* All four are disabled with nothing selected — they used to stay lit and
              silently do nothing, which read as broken. The tooltip says why. */}
          <View style={styles.transposeGroup}>
            <ToolButton
              icon="chevron-down"
              label="Down a semitone"
              hint={hasSelection ? '↓' : 'Select a note first'}
              onPress={() => shiftSelectionByRows(1)}
              disabled={!hasSelection}
              theme={theme}
              styles={styles}
            />
            <ToolButton
              icon="chevron-up"
              label="Up a semitone"
              hint={hasSelection ? '↑' : 'Select a note first'}
              onPress={() => shiftSelectionByRows(-1)}
              disabled={!hasSelection}
              theme={theme}
              styles={styles}
            />
            <ToolButton
              icon="arrow-down-circle-outline"
              label="Down an octave"
              hint={
                !hasSelection ? 'Select a note first'
                  : canShiftOctave(1) ? 'Shift + ↓'
                  : 'A selected note is already at the bottom of the grid'
              }
              onPress={() => shiftSelectionByRows(12)}
              disabled={!canShiftOctave(1)}
              theme={theme}
              styles={styles}
            />
            <ToolButton
              icon="arrow-up-circle-outline"
              label="Up an octave"
              hint={
                !hasSelection ? 'Select a note first'
                  : canShiftOctave(-1) ? 'Shift + ↑'
                  : 'A selected note is already at the top of the grid'
              }
              onPress={() => shiftSelectionByRows(-12)}
              disabled={!canShiftOctave(-1)}
              align="right"
              theme={theme}
              styles={styles}
            />
          </View>

          <View style={styles.toolbarDivider} />

          <Pressable
            onPress={() => setHelpOpen(true)}
            style={[styles.snapBtn, styles.helpBtn, helpOpen && styles.toolToggleSegActive]}
            accessibilityRole="button"
            accessibilityLabel="Show help"
          >
            <Ionicons name="help" size={14} color={helpOpen ? '#fff' : theme.textSub} />
          </Pressable>
        </View>
      </View>

      {/* Bar ruler — follows the grid's horizontal scroll via a transform, not its own
          independent ScrollView (simpler and more reliable than syncing two scrollables).
          A click seeks. The dock to its left is what places an A/B loop region — see
          pinDockGesture above. */}
      <View style={styles.rulerRow}>
        <View style={styles.pinDockRail}>
          <GestureDetector gesture={pinDockGesture}>
            <View
              {...(Platform.OS === 'web'
                ? { onMouseEnter: () => setPinDockHovered(true), onMouseLeave: () => setPinDockHovered(false) }
                : null)}
              style={styles.pinDock}
              accessible
              accessibilityLabel="Drag out a loop-region pin"
            >
              <Ionicons name="flag-outline" size={9} color="#fff" />
            </View>
          </GestureDetector>
          {pinDockHovered && (
            <View style={styles.pinDockTooltip} pointerEvents="none">
              <Text style={styles.pinDockTooltipText}>
                Drag to place a loop-region pin{'\n'}Drop one, then drag another for the other end
              </Text>
            </View>
          )}
        </View>

        <View style={styles.rulerClip}>
          <GestureDetector gesture={rulerTapGesture}>
            <View style={[styles.rulerContent, { width: gridWidth, transform: [{ translateX: -scrollX }] }]}>
              <BarRuler map={map} durationMs={totalMs} pxPerSecond={pxPerSecond} theme={theme} />

              {loopRegion && (
                <Animated.View style={[styles.loopRegionBand, loopRegionAnimatedStyle]}>
                  <GestureDetector gesture={loopRegionResizeLeftGesture}>
                    <View style={styles.loopRegionHandleLeft} />
                  </GestureDetector>
                  <GestureDetector gesture={clearLoopRegionGesture}>
                    <View
                      style={styles.loopRegionClearBtn}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel="Clear loop region"
                    >
                      <Ionicons name="close" size={10} color={theme.accent} />
                    </View>
                  </GestureDetector>
                  <GestureDetector gesture={loopRegionResizeRightGesture}>
                    <View style={styles.loopRegionHandleRight} />
                  </GestureDetector>
                </Animated.View>
              )}

              {/* First pin, dropped and waiting for its partner. */}
              {firstPinMs !== null && (
                <View pointerEvents="none" style={[styles.pinLine, { left: (firstPinMs / 1000) * pxPerSecond }]} />
              )}
              {/* Live ghost pin while actively dragging one out of the dock. */}
              <Animated.View pointerEvents="none" style={[styles.pinLine, pinDockAnimatedStyle]} />

              {showPlayhead && (
                <View pointerEvents="none" style={[styles.playheadWrap, { left: playheadLeft - 4 }]}>
                  <View style={[styles.playheadRulerLine, { height: RULER_HEIGHT - 10 }]} />
                </View>
              )}
            </View>
          </GestureDetector>
        </View>
      </View>

      {/* Grid: pinned row-label rail + vertically+horizontally scrollable note grid.
          Label rail and grid share ONE outer vertical ScrollView (rather than each
          having its own) so vertical scrolling can't desync labels from rows. */}
      {/* Scrollbar shown on web, matching the horizontal ScrollView below — the grid is
          every chromatic row tall (well past a typical viewport), so hiding it left the
          off-screen rows with no affordance at all that they existed. */}
      <ScrollView
        ref={vScrollRef}
        showsVerticalScrollIndicator={Platform.OS === 'web'}
        style={styles.gridVScroll}
        onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        onLayout={(e) => setGridViewportHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.gridRow}>
          {/* Explicit height + absolutely positioned cells, so culling the off-screen ones
              doesn't collapse the rail or shift the rows that remain. */}
          <View style={[styles.labelRail, { height: gridHeight }]}>
            {visibleRows.map(({ row: p, index }) => {
              const next = positions[index + 1];
              return (
                <LabelRailCell
                  // Keyed by pitch, not tab — every unplayable row shares tab: '', which
                  // would otherwise collide as a React key.
                  key={p.note}
                  row={p}
                  top={index * ROW_HEIGHT}
                  isOctaveBoundary={next ? getOctave(p.note) !== getOctave(next.note) : false}
                  styles={styles}
                />
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
                {visibleRows.map(({ row: p, index }) => {
                  const next = positions[index + 1];
                  const isOctaveBoundary = next ? getOctave(p.note) !== getOctave(next.note) : false;
                  return (
                    <View
                      key={p.note}
                      pointerEvents="none"
                      style={[
                        styles.rowStripe,
                        { top: index * ROW_HEIGHT, width: gridWidth },
                        !isNaturalNote(p.note) && styles.rowStripeAlt,
                        isOctaveBoundary && styles.octaveBoundary,
                        !p.playable && styles.rowUnplayable,
                      ]}
                    />
                  );
                })}

                <BeatGridLines
                  map={map}
                  durationMs={totalMs}
                  pxPerSecond={pxPerSecond}
                  height={gridHeight}
                  theme={theme}
                  snapSubdivision={snapSubdivision}
                />

                {/* Non-selected tracks: plain Views, no gesture handlers, no per-note
                    state. This is the whole reason a multi-track roll is affordable here —
                    the cost that made note culling necessary in the first place is the
                    gesture-handler instance per note, and a backing lane needs none. */}
                {backgroundNoteBlocks.map((block) => (
                  <View
                    key={block.key}
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left:   block.left,
                      top:    block.top + 6,
                      width:  block.width,
                      height: ROW_HEIGHT - 12,
                      borderRadius: 3,
                      backgroundColor: block.color,
                      opacity: 0.32,
                    }}
                  />
                ))}

                {visibleNotes.map((note) => {
                  // Marquee-selected notes render as live-following ghosts inside
                  // GroupSelectionOverlay instead, so they visually move with the drag in
                  // real time rather than staying frozen until the gesture commits.
                  if (mouseMode === 'selection' && selectedIds.includes(note.id)) return null;
                  const rowIndex = positions.findIndex((p) => p.note === note.note);
                  if (rowIndex === -1) return null;
                  return (
                    <PianoRollNoteBlock
                      key={note.id}
                      note={note}
                      rowIndex={rowIndex}
                      positions={positions}
                      map={map}
                      pxPerSecond={pxPerSecond}
                      snapDivision={snapDivision}
                      interactive={mouseMode === 'pencil'}
                      isSelected={mouseMode === 'pencil' ? selectedId === note.id : selectedIds.includes(note.id)}
                      onSelect={onSelect}
                      onUpdate={onUpdate}
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
                    map={map}
                    pxPerSecond={pxPerSecond}
                    snapDivision={snapDivision}
                    styles={styles}
                  />
                )}

                {/* Onboarding nudge for a fresh key with nothing drawn yet. Only makes
                    sense in pencil mode (nothing to click-to-create in selection mode),
                    and gridWidth collapses to ~viewportWidth when there are no notes (see
                    its own computation above), so centering within the grid here also
                    centers within the visible viewport — no scroll-position math needed. */}
                {notes.length === 0 && mouseMode === 'pencil' && (
                  <View pointerEvents="none" style={[styles.emptyGridHint, { width: gridWidth, height: gridHeight }]}>
                    <Ionicons name="add-circle-outline" size={22} color={theme.textMuted} />
                    <Text style={styles.emptyGridHintText}>Click anywhere to add your first note</Text>
                  </View>
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
          {/* Active tab gets a tinted pill, not just accent-colored text — as color-only
              labels in a bare row these read as breadcrumbs rather than tabs. */}
          {(['breath', 'duration', 'confidence', 'pitchBend'] as const).map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setMetricTab(tab)}
              style={[styles.dataTab, metricTab === tab && styles.dataTabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: metricTab === tab }}
            >
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
        <View style={styles.dataPanelRow}>
          <View style={styles.dataAxisRail}>
            {/* Axis numbers describe a scale that isn't there when the metric has no
                data — hiding them keeps the empty state from looking like a chart whose
                bars failed to draw. */}
            {metricHasData && (
              <>
                <Text style={styles.dataAxisLabel} numberOfLines={1}>{dataAxisLabels.top}</Text>
                {dataAxisLabels.mid !== undefined && (
                  <Text style={[styles.dataAxisLabel, styles.dataAxisLabelMid]} numberOfLines={1}>{dataAxisLabels.mid}</Text>
                )}
                <Text style={styles.dataAxisLabel} numberOfLines={1}>{dataAxisLabels.bottom}</Text>
              </>
            )}
          </View>
          <View style={styles.dataBarClip}>
            {metricHasData ? (
              <View style={[styles.dataBarContent, { width: gridWidth, transform: [{ translateX: -scrollX }] }]}>
                <DataPanelGridLines height={DATA_BAR_HEIGHT} theme={theme} />
                <DataPanelBars
                  metric={metricTab}
                  notes={notes}
                  frames={frames}
                  positions={positions}
                  pxPerSecond={pxPerSecond}
                  theme={theme}
                />
              </View>
            ) : (
              <View style={styles.dataEmpty}>
                <Ionicons name="pulse-outline" size={18} color={theme.textMuted} />
                <Text style={styles.dataEmptyText}>
                  {notes.length === 0
                    ? 'Nothing to analyze yet — draw or record some notes.'
                    : `${METRIC_LABELS[metricTab]} comes from the recorded audio. This chart has no analysis frames.`}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Animated.View>

      {toastMessage !== null && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText} numberOfLines={2}>{toastMessage}</Text>
        </View>
      )}

      <HelpModal visible={helpOpen} onClose={() => setHelpOpen(false)} theme={theme} styles={styles} />
    </View>
  );
}

const METRIC_LABELS = {
  breath:     'Breath Force',
  duration:   'Duration',
  confidence: 'Confidence',
  pitchBend:  'Pitch Bend',
} as const;

// ─── Help modal ────────────────────────────────────────────────────────────────
// A real centered Modal (not the small anchored popover this replaced) — there's enough
// content now (every toolbar control, not just colors/shortcuts) that a glanceable corner
// card stopped being the right shape for it. Same Modal + backdrop-press-to-close shape
// as ActionSheetModal elsewhere in the app, just with a scrollable content area instead
// of a list of option rows.
interface ToolHelpEntry {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
}

const TOOL_HELP: ToolHelpEntry[] = [
  { icon: 'pencil', title: 'Pencil tool [1]',
    desc: 'Click empty grid to create a note. Click an existing note to select it. Drag a note to move it, drag its left/right edge to resize.' },
  { icon: 'scan-outline', title: 'Selection tool [2]',
    desc: 'Drag to marquee-select multiple notes. Click a note to select just it. Shift+click toggles one note in/out of the selection; Shift+drag adds a marquee to the existing selection instead of replacing it. Once notes are selected, drag the group to move it together, or its edge handles to stretch it.' },
  { icon: 'magnet-outline', title: 'Snap',
    desc: 'On/off — whether placing, moving, or dragging a note quantizes to the grid at all, or lands wherever you drop it.' },
  { icon: 'grid-outline', title: 'Grid (1/4, 1/8, 1/16)',
    desc: 'The grid’s resolution. Always visible regardless of Snap above, and what Snap quantizes to when it’s on. Hover + scroll to step through it quickly.' },
  { icon: 'return-down-forward-outline', title: 'Quantize',
    desc: 'Snaps the selected notes (or every note, if none are selected) to the current grid resolution right now — independent of whether Snap itself is on.' },
  { icon: 'remove', title: 'Zoom (− / % / +)',
    desc: 'Zooms the timeline in/out, centered on what’s currently in view. Click the percentage to reset to 100%.' },
  { icon: 'flag-outline', title: 'Loop-region pin',
    desc: 'The blue tab left of the ruler. Drag it out onto the timeline and release to drop a marker, then drag it again for the second one — the span between them (regardless of which you placed first) becomes the loop region, played back on repeat. Once placed, drag either edge of the blue band to adjust it, or its × to clear it. Esc cancels a pin mid-drag.' },
  { icon: 'chevron-up', title: 'Semitone / Octave shift',
    desc: 'Moves the selected note(s) up/down the chromatic grid — the small chevrons shift a semitone, the circled arrows a full octave. Rows greyed out and labeled with just a pitch name aren’t real positions on the current harmonica; a semitone shift that would land there simply skips that note (a message says how many), while the octave buttons disable themselves instead if any selected note is already at the very edge.' },
  { icon: 'musical-notes-outline', title: 'Key / Type ("12-Chromatic · Key C")',
    desc: 'Click the badge above the ruler to open a dropdown. Picking a key transposes every note instantly — it can never make a note unplayable, since tab positions don’t depend on key. Switching Diatonic/Chromatic can, since the two don’t share a tab vocabulary; it warns first if it would affect any notes, and applies instantly if it wouldn’t.' },
];

const SHORTCUTS: [string, string][] = [
  ['1 / 2', 'Pencil / Selection tool'],
  ['Click (pencil)', 'Create a note, or select one under the cursor'],
  ['Drag note', 'Move it'],
  ['Drag note edge', 'Resize it'],
  ['Shift+click / drag', 'Add/toggle notes in the selection'],
  ['← / →', 'Nudge the selected note(s) in time'],
  ['↑ / ↓', 'Shift the selected note(s) a semitone'],
  ['Shift+↑ / Shift+↓', 'Shift the selected note(s) an octave'],
  ['Backspace / Delete', 'Delete the selected note(s)'],
  ['Ctrl/Cmd+C / V / D', 'Copy / paste / duplicate'],
  ['Ctrl/Cmd+Z / Y', 'Undo / redo'],
  ['Drag ruler pin', 'Drop a loop-region marker, then drag another for the other end'],
];

function HelpModal({ visible, onClose, theme, styles }: {
  visible: boolean; onClose: () => void; theme: Theme; styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* No accessibilityRole="button" on the backdrop/card wrappers — matches
          ActionSheetModal's own reasoning: that's what makes react-native-web render a
          real <button>, and nesting one inside another (for rows that do need the role)
          is invalid HTML. These two are just tap targets. */}
      <Pressable style={styles.helpBackdrop} onPress={onClose}>
        <Pressable style={styles.helpModalCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.helpModalHeader}>
            <Text style={styles.helpModalTitle}>Piano Roll Help</Text>
            <Pressable
              onPress={onClose}
              style={styles.helpModalCloseBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close help"
            >
              <Ionicons name="close" size={20} color={theme.textSub} />
            </Pressable>
          </View>

          <ScrollView style={styles.helpModalScroll} contentContainerStyle={styles.helpModalScrollContent}>
            <View style={styles.helpColumns}>
              <View style={styles.helpColumn}>
                <Text style={styles.helpSectionTitle}>Tools & controls</Text>
                {TOOL_HELP.map((entry) => (
                  <View key={entry.title} style={styles.helpToolRow}>
                    <View style={styles.helpToolIcon}>
                      <Ionicons name={entry.icon} size={14} color={theme.accent} />
                    </View>
                    <View style={styles.helpToolText}>
                      <Text style={styles.helpToolTitle}>{entry.title}</Text>
                      <Text style={styles.helpRowText}>{entry.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.helpColumn}>
                <Text style={styles.helpSectionTitle}>Note colors</Text>
                {(Object.keys(TECHNIQUE_COLOR) as NoteTechnique[]).map((tech) => (
                  <View key={tech} style={styles.helpColorRow}>
                    <View style={[styles.helpColorSwatch, { backgroundColor: TECHNIQUE_COLOR[tech] }]} />
                    <Text style={styles.helpRowText}>{TECHNIQUE_LABEL[tech]}</Text>
                  </View>
                ))}

                <View style={styles.helpDivider} />
                <Text style={styles.helpSectionTitle}>Keyboard shortcuts</Text>
                {SHORTCUTS.map(([keys, desc]) => (
                  <View key={keys} style={styles.helpShortcutRow}>
                    <Text style={styles.helpShortcutKeys}>{keys}</Text>
                    <Text style={[styles.helpRowText, styles.helpShortcutDesc]}>{desc}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Bar ruler ─────────────────────────────────────────────────────────────────

function BarRuler({ map, durationMs, pxPerSecond, theme }: {
  map: TempoMap; durationMs: number; pxPerSecond: number; theme: Theme;
}) {
  // Bars are asked for rather than computed from a bar length, because with a tempo or
  // meter map there is no single bar length: each bar's width and position depend on
  // what's in force where it sits.
  const bars = useMemo(
    // A few bars past the end so the ruler doesn't stop short of the scrollable area.
    () => gridLines(map, 0, durationMs + 8000, 4).filter((l) => l.isBar),
    [map, durationMs],
  );

  // Label density is driven by the narrowest bar on screen, so a ritardando that stretches
  // later bars can't make early ones collide.
  const minBarPx = bars.reduce((min, line, i) => {
    if (i === 0) return min;
    return Math.min(min, ((line.ms - bars[i - 1].ms) / 1000) * pxPerSecond);
  }, Infinity);

  let tickEvery = 1;
  for (const n of [1, 2, 4, 8, 16, 32]) {
    tickEvery = n;
    if (n * (Number.isFinite(minBarPx) ? minBarPx : 0) >= 50) break;
  }

  return (
    <>
      {bars.map((line, i) => (
        i % tickEvery !== 0 ? null : (
          <View
            key={line.bar}
            style={{ position: 'absolute', left: (line.ms / 1000) * pxPerSecond, top: 0, bottom: 0 }}
          >
            <Text style={{ fontSize: 12, fontFamily: Poppins.bold, color: theme.textSub, marginBottom: 3 }}>
              {msToBarInMap(map, line.ms).toFixed(0)}
            </Text>
            <View style={{ width: 1.5, height: 10, backgroundColor: theme.textSub }} />
          </View>
        )
      ))}
    </>
  );
}

// Real vertical gridlines behind the notes — three tiers: heavier per-bar (aligned with
// the ruler's bar ticks above), lighter per-beat, and (when snap is on) lightest per-
// subdivision, matching the active snap grid. Previously the grid had no vertical
// structure at all.
// Draws lines for the current subdivision regardless of whether the Snap toggle is on —
// the grid is a visual reference either way, matching how DAWs keep the grid visible even
// with "snap to grid" switched off.
function BeatGridLines({ map, durationMs, pxPerSecond, height, theme, snapSubdivision }: {
  map: TempoMap; durationMs: number; pxPerSecond: number; height: number; theme: Theme;
  snapSubdivision: Exclude<SnapDivision, 'off'>;
}) {
  // One walk produces all three tiers already classified, so the "is this subdivision also
  // a beat?" test is an index check inside `gridLines` rather than the modulo-on-pixels
  // approximation this used to do (which drifted at fractional pixel spacings).
  const all = useMemo(
    () => gridLines(map, 0, durationMs + 8000, snapSubdivision),
    [map, durationMs, snapSubdivision],
  );

  const subdivisionLines = all.filter((l) => !l.isBeat).map((l) => (l.ms / 1000) * pxPerSecond);
  const lines = all
    .filter((l) => l.isBeat)
    .map((l) => ({ x: (l.ms / 1000) * pxPerSecond, isBar: l.isBar }));

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

// Reference gridlines behind the bars — without these the axis labels (top/bottom, or
// top/mid/bottom for Pitch Bend) were the only scale cue, and a bar's height was
// otherwise ungrounded to any value. Quarter-marks at 25/50/75% give enough resolution
// to read a bar's rough value without needing to label every line. left+right (no
// explicit width) stretches to fill the parent regardless of how wide the scrollable
// content currently is.
function DataPanelGridLines({ height, theme }: { height: number; theme: Theme }) {
  return (
    <>
      {[0.25, 0.5, 0.75].map((f) => (
        <View
          key={f}
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, top: height * f, height: 1, backgroundColor: theme.separator }}
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
  positions: GridRow[];
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
  positions:    GridRow[];
  map:          TempoMap;
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
  styles:       ReturnType<typeof createStyles>;
}

function PianoRollNoteBlock({
  note, rowIndex, positions, map, pxPerSecond, snapDivision, isSelected, interactive, onSelect, onUpdate, styles,
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
  const theme           = useTheme();
  const translateX      = useSharedValue(0);
  const translateY      = useSharedValue(0);
  const resizeDelta     = useSharedValue(0);
  const resizeLeftDelta = useSharedValue(0);
  const [hovered, setHovered] = useState(false);
  // Live numeric readout while dragging — null when idle. Throttled by frame count (not
  // wall-clock time, which isn't reliably available inside a worklet across platforms) so
  // this doesn't reintroduce the per-frame JS-thread churn the shared-value-driven visual
  // preview above was specifically designed to avoid; only one of the three gestures below
  // is ever active at once, so they share this one counter/state pair.
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const dragUpdateCounter = useSharedValue(0);

  function commitMove(dxPx: number, dyPx: number) {
    const dtMs      = (dxPx / pxPerSecond) * 1000;
    const rawStart  = Math.max(0, Math.round(note.start_time + dtMs));
    const newStart  = snapMsToGridInMap(map, rawStart, snapDivision);
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
      dragUpdateCounter.value += 1;
      if (dragUpdateCounter.value % DRAG_LABEL_THROTTLE === 0) {
        runOnJS(setDragLabel)(formatTimestamp(note.start_time + (e.translationX / pxPerSecond) * 1000));
      }
    })
    .onEnd((e) => { runOnJS(commitMove)(e.translationX, e.translationY); })
    .onFinalize(() => {
      translateX.value = 0;
      translateY.value = 0;
      runOnJS(setDragLabel)(null);
    });

  const resizeRightGesture = Gesture.Pan()
    .onStart(() => { runOnJS(onSelect)(note.id); })
    .onUpdate((e) => {
      resizeDelta.value = e.translationX;
      dragUpdateCounter.value += 1;
      if (dragUpdateCounter.value % DRAG_LABEL_THROTTLE === 0) {
        const newDuration = Math.max(MIN_DURATION_MS, note.duration + (e.translationX / pxPerSecond) * 1000);
        runOnJS(setDragLabel)(formatDurationLabel(newDuration));
      }
    })
    .onEnd((e) => { runOnJS(commitResizeRight)(e.translationX); })
    .onFinalize(() => { resizeDelta.value = 0; runOnJS(setDragLabel)(null); });

  const resizeLeftGesture = Gesture.Pan()
    .onStart(() => { runOnJS(onSelect)(note.id); })
    .onUpdate((e) => {
      resizeLeftDelta.value = e.translationX;
      dragUpdateCounter.value += 1;
      if (dragUpdateCounter.value % DRAG_LABEL_THROTTLE === 0) {
        const newDuration = Math.max(MIN_DURATION_MS, note.duration - (e.translationX / pxPerSecond) * 1000);
        runOnJS(setDragLabel)(formatDurationLabel(newDuration));
      }
    })
    .onEnd((e) => { runOnJS(commitResizeLeft)(e.translationX); })
    .onFinalize(() => { resizeLeftDelta.value = 0; runOnJS(setDragLabel)(null); });

  const left   = (note.start_time / 1000) * pxPerSecond;
  // Blocks fill their row edge to edge — no inset margin, no rounding (see noteBlock).
  const top    = rowIndex * ROW_HEIGHT;
  const width  = Math.max(14, (note.duration / 1000) * pxPerSecond);
  const height = ROW_HEIGHT;
  // Technique still drives the color, but as an edge accent + text on a quiet tinted
  // body rather than a solid slab — see techniqueSkin. Selection gets its own signal via
  // the noteBlockSelected ring, not by overriding the skin.
  //
  // Confidence no longer drives opacity. It used to (0.4 + confidence*0.6), which meant
  // that since confidence is matchCount/totalCount and realistically lands at 60–85%,
  // EVERY block rendered permanently translucent and the whole grid read as washed out.
  // Genuinely low-confidence notes get a dashed edge below instead — a signal that
  // applies only when it's actually informative.
  const skin = techniqueSkin(note.tab, theme.isDark);
  const lowConfidence = note.confidence < LOW_CONFIDENCE_THRESHOLD;

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
          { top, left, width, height, backgroundColor: skin.fill, borderColor: skin.edge },
          lowConfidence && styles.noteBlockLowConfidence,
          isSelected && styles.noteBlockSelected,
        ]}
      >
        <View style={styles.noteBlockBody}>
          <Text style={[styles.noteBlockText, { color: skin.label }]} numberOfLines={1} selectable={false}>
            {noteBlockLabel(note)}
          </Text>
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
          { top, height, backgroundColor: skin.fill, borderColor: skin.edge },
          lowConfidence && styles.noteBlockLowConfidence,
          hovered && !isSelected && styles.noteBlockHovered,
          isSelected && styles.noteBlockSelected,
          moveAnimatedStyle,
          boxAnimatedStyle,
        ]}
      >
        <View style={styles.noteBlockBody}>
          <Text style={[styles.noteBlockText, { color: skin.label }]} numberOfLines={1} selectable={false}>
            {noteBlockLabel(note)}
          </Text>
        </View>

        {dragLabel !== null && (
          <View pointerEvents="none" style={styles.dragTooltip}>
            <Text style={styles.dragTooltipText} numberOfLines={1}>{dragLabel}</Text>
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
// Bounding box drawn around the marquee-selected notes with move + edge-resize handles —
// mirrors Signal's NoteSelection. Resize proportionally stretches every selected note
// within the group's time window (each note keeps its normalized position/width inside
// the group as the group's own bounds change), rather than resizing only the note
// nearest the dragged edge.
//
// The selected notes themselves are excluded from the normal note-rendering loop while
// selected (see the visibleNotes.map filter above) and instead rendered here, as ghost
// previews — during a move they ride along via the wrapper's own transform (below);
// during a resize each one (GroupGhostNote) independently re-derives its left/width from
// the shared resize deltas, since different notes need different amounts of stretch.
function GroupSelectionOverlay({
  bounds, selectedNotes, positions, map, pxPerSecond, snapDivision, styles,
}: {
  bounds: { left: number; top: number; width: number; height: number };
  selectedNotes: TabNote[];
  positions: GridRow[];
  map: TempoMap;
  pxPerSecond: number;
  snapDivision: SnapDivision;
  styles: ReturnType<typeof createStyles>;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const resizeLeftDelta  = useSharedValue(0);
  const resizeRightDelta = useSharedValue(0);
  // Same throttled live-readout pattern as a single note's own drag tooltip — see there
  // for why frame-count (not wall-clock) throttling.
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const dragUpdateCounter = useSharedValue(0);

  // Each note clamps/snaps independently (not a shared group-wide bound) — a reasonable
  // simplification: in the rare case a drag would push part of the group past row 0/max,
  // those notes stop early while the rest keep moving, rather than the whole group being
  // held back by whichever member is closest to the edge. Committed as one bulk
  // updateNotes call so undoing a group move is a single Ctrl+Z, not one per note.
  function commitGroupMove(dxPx: number, dyPx: number) {
    const dtMs = (dxPx / pxPerSecond) * 1000;
    const rowDelta = Math.round(dyPx / ROW_HEIGHT);
    const updates: { id: string; changes: NoteUpdate }[] = [];
    for (const note of selectedNotes) {
      const rowIndex = positions.findIndex((p) => p.note === note.note);
      if (rowIndex === -1) continue;
      const rawStart = Math.max(0, Math.round(note.start_time + dtMs));
      const newStart = snapMsToGridInMap(map, rawStart, snapDivision);
      const newRow = Math.min(positions.length - 1, Math.max(0, rowIndex + rowDelta));
      const newPos = positions[newRow];
      const changes: NoteUpdate = {};
      if (newStart !== note.start_time) changes.start_time = newStart;
      if (newPos.tab !== note.tab) { changes.tab = newPos.tab; changes.note = newPos.note; }
      if (Object.keys(changes).length > 0) updates.push({ id: note.id, changes });
    }
    if (updates.length > 0) useAppStore.getState().updateNotes(updates);
  }

  // dLeftPx/dRightPx: how far the left/right edge of the group's bounding box moved
  // (only one is ever nonzero — one handle dragged at a time). Remaps each note from its
  // normalized position within the *old* group bounds to the same normalized position
  // within the *new* ones — matches the identical math GroupGhostNote uses for the live
  // preview, just committed to real start_time/duration instead of a shared value. No
  // grid-snapping here, matching the single-note resize handles (only move snaps).
  function commitGroupResize(dLeftPx: number, dRightPx: number) {
    const newGroupLeft  = bounds.left + dLeftPx;
    const newGroupWidth = Math.max(1, bounds.width - dLeftPx + dRightPx);
    const updates: { id: string; changes: NoteUpdate }[] = [];
    for (const note of selectedNotes) {
      const left  = (note.start_time / 1000) * pxPerSecond;
      const width = Math.max(14, (note.duration / 1000) * pxPerSecond);
      const t0 = (left - bounds.left) / bounds.width;
      const t1 = (left + width - bounds.left) / bounds.width;
      const newLeft  = newGroupLeft + t0 * newGroupWidth;
      const newRight = newGroupLeft + t1 * newGroupWidth;
      const newStart    = Math.max(0, Math.round((newLeft / pxPerSecond) * 1000));
      const newDuration = Math.max(MIN_DURATION_MS, Math.round(((newRight - newLeft) / pxPerSecond) * 1000));
      if (newStart !== note.start_time || newDuration !== note.duration) {
        updates.push({ id: note.id, changes: { start_time: newStart, duration: newDuration } });
      }
    }
    if (updates.length > 0) useAppStore.getState().updateNotes(updates);
  }

  const moveGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      dragUpdateCounter.value += 1;
      if (dragUpdateCounter.value % DRAG_LABEL_THROTTLE === 0) {
        runOnJS(setDragLabel)(formatDeltaLabel((e.translationX / pxPerSecond) * 1000));
      }
    })
    .onEnd((e) => { runOnJS(commitGroupMove)(e.translationX, e.translationY); })
    .onFinalize(() => { translateX.value = 0; translateY.value = 0; runOnJS(setDragLabel)(null); });

  const resizeRightGesture = Gesture.Pan()
    .onUpdate((e) => {
      resizeRightDelta.value = e.translationX;
      dragUpdateCounter.value += 1;
      if (dragUpdateCounter.value % DRAG_LABEL_THROTTLE === 0) {
        const newSpanMs = ((bounds.width + e.translationX) / pxPerSecond) * 1000;
        runOnJS(setDragLabel)(formatDurationLabel(Math.max(1, newSpanMs)));
      }
    })
    .onEnd((e) => { runOnJS(commitGroupResize)(0, e.translationX); })
    .onFinalize(() => { resizeRightDelta.value = 0; runOnJS(setDragLabel)(null); });

  const resizeLeftGesture = Gesture.Pan()
    .onUpdate((e) => {
      resizeLeftDelta.value = e.translationX;
      dragUpdateCounter.value += 1;
      if (dragUpdateCounter.value % DRAG_LABEL_THROTTLE === 0) {
        const newSpanMs = ((bounds.width - e.translationX) / pxPerSecond) * 1000;
        runOnJS(setDragLabel)(formatDurationLabel(Math.max(1, newSpanMs)));
      }
    })
    .onEnd((e) => { runOnJS(commitGroupResize)(e.translationX, 0); })
    .onFinalize(() => { resizeLeftDelta.value = 0; runOnJS(setDragLabel)(null); });

  // Same "snap vertical movement to whole rows during the drag" treatment as a single
  // note's own move gesture — horizontal follows the finger continuously.
  const wrapAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: Math.round(translateY.value / ROW_HEIGHT) * ROW_HEIGHT },
    ],
  }));
  const boundsAnimatedStyle = useAnimatedStyle(() => ({
    left:  bounds.left + resizeLeftDelta.value,
    width: Math.max(1, bounds.width - resizeLeftDelta.value + resizeRightDelta.value),
  }));

  return (
    // pointerEvents="box-none": the wrapper itself doesn't intercept touches (so clicking
    // outside the rect below still reaches the parent grid's marquee gesture to start a
    // new selection) — only the rect/handle children, which have actual GestureDetectors,
    // do.
    <Animated.View pointerEvents="box-none" style={[styles.groupSelectionWrap, wrapAnimatedStyle]}>
      <GestureDetector gesture={moveGesture}>
        <Animated.View
          style={[
            styles.groupSelectionOverlay,
            { top: bounds.top, height: bounds.height },
            boundsAnimatedStyle,
          ]}
        >
          <GestureDetector gesture={resizeLeftGesture}>
            <View style={styles.resizeHandleLeft} />
          </GestureDetector>
          <GestureDetector gesture={resizeRightGesture}>
            <View style={styles.resizeHandle} />
          </GestureDetector>
          {dragLabel !== null && (
            <View pointerEvents="none" style={styles.dragTooltip}>
              <Text style={styles.dragTooltipText} numberOfLines={1}>{dragLabel}</Text>
            </View>
          )}
        </Animated.View>
      </GestureDetector>
      {selectedNotes.map((note) => {
        const rowIndex = positions.findIndex((p) => p.note === note.note);
        if (rowIndex === -1) return null;
        const left  = (note.start_time / 1000) * pxPerSecond;
        const width = Math.max(14, (note.duration / 1000) * pxPerSecond);
        const t0 = (left - bounds.left) / bounds.width;
        const t1 = (left + width - bounds.left) / bounds.width;
        return (
          <GroupGhostNote
            key={note.id}
            note={note}
            rowIndex={rowIndex}
            t0={t0}
            t1={t1}
            bounds={bounds}
            resizeLeftDelta={resizeLeftDelta}
            resizeRightDelta={resizeRightDelta}
            styles={styles}
          />
        );
      })}
    </Animated.View>
  );
}

// One selected note's live preview during a group resize — its own component (not a
// plain View built inline in GroupSelectionOverlay's .map()) because it needs its own
// useAnimatedStyle call, and the number of selected notes varies render to render, which
// a hook call inside a variable-length .map() can't safely do in the parent itself.
function GroupGhostNote({ note, rowIndex, t0, t1, bounds, resizeLeftDelta, resizeRightDelta, styles }: {
  note: TabNote;
  rowIndex: number;
  t0: number;
  t1: number;
  bounds: { left: number; width: number };
  resizeLeftDelta: SharedValue<number>;
  resizeRightDelta: SharedValue<number>;
  styles: ReturnType<typeof createStyles>;
}) {
  const theme = useTheme();
  const skin  = techniqueSkin(note.tab, theme.isDark);
  const animatedStyle = useAnimatedStyle(() => {
    const newGroupLeft  = bounds.left + resizeLeftDelta.value;
    const newGroupWidth = Math.max(1, bounds.width - resizeLeftDelta.value + resizeRightDelta.value);
    return {
      left:  newGroupLeft + t0 * newGroupWidth,
      width: Math.max(4, (t1 - t0) * newGroupWidth),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.noteBlock,
        {
          top: rowIndex * ROW_HEIGHT,
          height: ROW_HEIGHT,
          backgroundColor: skin.fill,
          borderColor: skin.edge,
        },
        styles.noteBlockSelected,
        animatedStyle,
      ]}
    >
      <View style={styles.noteBlockBody}>
        <Text style={[styles.noteBlockText, { color: skin.label }]} numberOfLines={1} selectable={false}>{noteBlockLabel(note)}</Text>
      </View>
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
      // The grid reads best on the cleanest surface the theme has — plain white in light
      // mode (t.bg), not the grey `surface` it used to sit on, which muddied the row
      // shading and made the whole panel look dim. Dark mode gets the same treatment
      // against its near-black bg.
      backgroundColor: t.bg,
      // Square corners: the panel runs flush to the sidebar on the left and the window on
      // the right, and a radius against a hard edge reads as a gap rather than as a card.
      borderRadius:    0,
      borderWidth:     1,
      borderColor:     t.border,
      // Keeps the tool row and grid off the panel's own border. Not the gutter the user
      // sees between panel and window — that one lives on editMainColumn in edit.tsx and
      // is zero in piano-roll mode; this is just the panel's internal breathing room.
      padding:         10,
    },

    // Auto-dismissing banner for "N note(s) couldn't move" — bottom-centered, a late
    // sibling of everything else in `outer` so it naturally paints on top without
    // needing the zIndex trick the toolbar popover needed (that one was nested inside
    // an earlier sibling; this one already comes after every other sibling in the tree).
    toast: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 16,
      alignItems: 'center',
      zIndex: 30,
    },
    toastText: {
      backgroundColor: t.textPrimary,
      color: t.bg,
      fontSize: FONT.xs,
      fontFamily: Poppins.semiBold,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
      textAlign: 'center',
      overflow: 'hidden',
      ...(Platform.OS === 'web' ? { boxShadow: '0 4px 12px rgba(0,0,0,0.25)' } : null),
    } as any,

    // zIndex here (not just on the popover itself) is what actually matters — a nested
    // z-index only outranks siblings within its own parent's stacking context, and
    // without this, toolbarRow's un-indexed siblings (rulerClip, the grid) paint over it
    // regardless of any z-index on the popover deep inside, simply by coming later in the
    // tree. This lifts the whole toolbar (and everything nested in it) above them.
    toolbarRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, zIndex: 20 },
    // The title slot lives here, so it's the left cluster that gives up width first when
    // the row runs out of room — the tool cluster on the right is all fixed-size controls
    // that can't shrink without breaking. minWidth: 0 is what actually permits a flex
    // child to shrink below its content width.
    toolbarRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
    toolbarRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
    zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    // Every toolbar control shares CONTROL_H and radius 8 — previously zoomBtn was a
    // fixed 26px square, snapBtn was padding-derived (~28px) and the tool toggle a third
    // height, so the row visibly failed to sit on one baseline.
    zoomBtn: {
      width: CONTROL_H,
      height: CONTROL_H,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    zoomPill: {
      minWidth: 48,
      height: CONTROL_H,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
      borderRadius: 8,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    zoomPillText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    zoomBtnDisabled: { opacity: 0.5, ...(Platform.OS === 'web' ? { cursor: 'default' } : null) } as any,

    // Hover-tooltip host for icon-only toolbar buttons (see ToolButton). The anchor is a
    // plain wrapper so the tooltip can hang off the button's own box; zIndex is on the
    // tooltip rather than here so a hovered button's tooltip outranks the *later* sibling
    // buttons in the same row, which would otherwise paint over its left/right edge.
    toolBtnAnchor: { position: 'relative' },
    // Horizontal anchoring lives entirely in the Left/Right variants below — setting a
    // `left` here and cancelling it with `left: undefined` in the variant relies on how
    // style flattening treats undefined, which isn't worth depending on.
    toolTooltip: {
      position: 'absolute',
      top: '100%',
      marginTop: 6,
      maxWidth: 200,
      minWidth: 96,
      backgroundColor: t.textPrimary,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 2,
      zIndex: 40,
      ...(Platform.OS === 'web' ? { boxShadow: '0 4px 12px rgba(0,0,0,0.25)' } : null),
    } as any,
    toolTooltipLeft: { left: 0 },
    // For buttons near the panel's right edge, where a left-anchored tooltip would hang
    // off the side of the card.
    toolTooltipRight: { right: 0 },
    toolTooltipText: { fontSize: 10, fontFamily: Poppins.semiBold, color: t.bg, lineHeight: 14 },
    toolTooltipHint: { fontSize: 10, fontFamily: Poppins.regular, color: t.bg, opacity: 0.7, lineHeight: 14 },

    transposeGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    // Separates logical clusters in the toolbar (tools / grid / transpose / help) — the
    // same device edit.tsx's own toolbar uses. Without it these were ten similar-looking
    // pills in one undifferentiated run.
    toolbarDivider: { width: 1, height: 18, backgroundColor: t.separator, marginHorizontal: 2 },
    // Pencil/Selection segmented toggle — same visual language as the List/Piano Roll
    // toggle elsewhere in the app, placed immediately left of Snap (matches Signal, whose
    // tool selector sits directly beside its quantize control).
    toolToggle: {
      flexDirection:   'row',
      alignItems:      'center',
      height:          CONTROL_H,
      backgroundColor: t.surface,
      borderWidth:     1,
      borderColor:     t.border,
      borderRadius:    8,
      padding:         2,
      gap:             2,
    },
    toolToggleSeg: {
      flexDirection:     'row',
      alignItems:        'center',
      alignSelf:         'stretch',
      gap:               5,
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
      justifyContent:    'center',
      height:            CONTROL_H,
      gap:               6,
      paddingHorizontal: 10,
      borderRadius:      8,
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    snapBtnText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    // Filled-in state for the Snap on/off toggle — same visual language as the
    // Pencil/Selection tool toggle's active segment.
    snapBtnActive: { backgroundColor: t.accent, borderColor: t.accent },
    snapBtnTextActive: { color: '#fff' },

    helpBtn: { paddingHorizontal: 8 },

    // Centered modal — backdrop/card shape matches ActionSheetModal elsewhere in the app.
    helpBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    helpModalCard: {
      width: '100%',
      maxWidth: WEB_CONTENT_WIDTH.wide,
      maxHeight: '85%',
      backgroundColor: t.bg,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      overflow: 'hidden',
    },
    helpModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    helpModalTitle: { fontSize: FONT.md, fontFamily: SpaceGrotesk.bold, color: t.textPrimary },
    helpModalCloseBtn: {
      padding: 4,
      borderRadius: 6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    // flex: 1, not flexGrow: 0 — this is what actually lets the card's maxHeight (above)
    // bound this ScrollView and trigger internal scrolling, rather than the card just
    // growing to fit all content unbounded.
    helpModalScroll: { flex: 1 },
    helpModalScrollContent: { padding: 18 },
    helpColumns: { flexDirection: 'row', gap: 32 },
    helpColumn: { flex: 1, minWidth: 0, gap: 4 },

    helpSectionTitle: {
      fontSize: 11,
      fontFamily: Poppins.bold,
      color: t.accent,
      letterSpacing: 0.6,
      marginTop: 4,
      marginBottom: 6,
    },
    helpToolRow: { flexDirection: 'row', gap: 10, paddingVertical: 6, alignItems: 'flex-start' },
    helpToolIcon: {
      width: 26,
      height: 26,
      borderRadius: 8,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    helpToolText: { flex: 1, gap: 2 },
    helpToolTitle: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textPrimary },
    helpColorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
    // Hairline ring so the darkest fills (bend3 sits at 1.8:1 against the dark surface)
    // stay delineated as swatches — the note blocks themselves get that relief from their
    // own white label, but a bare swatch has nothing.
    helpColorSwatch: {
      width: 11, height: 11, borderRadius: 3,
      borderWidth: 1, borderColor: t.border,
    },
    helpRowText: { fontSize: FONT.xs, fontFamily: Poppins.medium, color: t.textSub, lineHeight: 17 },
    helpDivider: { height: 1, backgroundColor: t.border, marginVertical: 10 },
    helpShortcutRow: { gap: 1, paddingVertical: 3 },
    helpShortcutKeys: { fontSize: 11, fontFamily: Poppins.bold, color: t.textPrimary },
    helpShortcutDesc: { fontSize: 11 },

    // rulerRow/pinDockRail: the ruler now sits alongside a fixed-width rail (matching
    // LABEL_WIDTH, same as the grid's own label rail below it) holding the loop-region
    // pin dock — a plain draggable bar at rest, not part of the ruler's own gesture at
    // all (see the comment on pinDockGesture for why that separation matters).
    // zIndex here for the same reason toolbarRow needed one — the pin dock's hover
    // tooltip extends below the ruler's own 30px height, and without this, the grid
    // below (a later, un-indexed sibling within `outer`) would paint over it regardless
    // of any z-index nested inside pinDockRail alone.
    rulerRow: { flexDirection: 'row', zIndex: 10 },
    pinDockRail: {
      width: LABEL_WIDTH,
      height: RULER_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 5, // above rulerClip's own content so the hover tooltip isn't clipped/covered
    },
    pinDock: {
      width: 16,
      height: RULER_HEIGHT - 10,
      borderRadius: 3,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
      ...(Platform.OS === 'web' ? { cursor: 'grab' } : null),
    } as any,
    pinDockTooltip: {
      position: 'absolute',
      top: '100%',
      left: 0,
      marginTop: 6,
      width: 190,
      backgroundColor: t.textPrimary,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      zIndex: 30,
      ...(Platform.OS === 'web' ? { boxShadow: '0 4px 12px rgba(0,0,0,0.25)' } : null),
    } as any,
    pinDockTooltipText: { fontSize: 10, fontFamily: Poppins.medium, color: t.bg, lineHeight: 14 },
    // Clear boundary between the bar ruler and the grid below it — was just a small gap.
    rulerClip: {
      flex: 1,
      height: RULER_HEIGHT,
      overflow: 'hidden',
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    rulerContent: {
      height: RULER_HEIGHT,
      position: 'relative',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    // Ghost pin while dragging, and the static first-pin-dropped marker — same thin
    // vertical bar either way, just one animated and one not.
    pinLine: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 2,
      backgroundColor: t.accent,
    },

    // A/B loop region band — same View/style reused for both the committed region (with
    // its handles + clear button as children) and the live drag-preview (no children,
    // pointerEvents="none", width driven to 0 when idle rather than conditionally
    // rendered — same "always mounted" convention as the marquee-select preview).
    loopRegionBand: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      backgroundColor: t.accentSoft,
      borderWidth: 1,
      borderColor: t.accent,
      borderRadius: 3,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    loopRegionHandleLeft: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: RESIZE_HANDLE_W,
      ...(Platform.OS === 'web' ? { cursor: 'ew-resize' } : null),
    } as any,
    loopRegionHandleRight: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: RESIZE_HANDLE_W,
      ...(Platform.OS === 'web' ? { cursor: 'ew-resize' } : null),
    } as any,
    loopRegionClearBtn: {
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: t.bg,
      alignItems: 'center',
      justifyContent: 'center',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,

    gridRow: { flexDirection: 'row', flex: 1 },
    // Frozen-column treatment (Notion/Excel-style) — its own background distinct from the
    // grid behind it, plus a border/shadow so it visually sits above the scrolling grid
    // rather than blending into it.
    labelRail: {
      width: LABEL_WIDTH,
      // Above the scrolling grid beside it, so a row's hover tooltip (which hangs to the
      // right, over the grid) isn't painted over by that later sibling.
      zIndex: 2,
      backgroundColor: t.surface,
      borderRightWidth: 2,
      borderRightColor: t.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
      ...(Platform.OS === 'web' ? { boxShadow: t.isDark ? '2px 0 8px rgba(0,0,0,0.35)' : '2px 0 6px rgba(0,0,0,0.08)' } : null),
    } as any,
    labelCell: {
      height: ROW_HEIGHT,
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'flex-end',
      paddingLeft:    10,
      paddingRight:   8,
      // Same hairline as rowStripe, so the row separators run continuously from the rail
      // straight across the grid instead of stopping at the rail's edge.
      borderBottomWidth: 1,
      borderBottomColor: t.isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)',
    },
    // Sign/number/modifier each get their own fixed-width column (not the tab as one
    // shrink-to-content string) so the hole number itself always lands in the same spot —
    // "3" and "-3'''" both need their digit aligned, even though one ends in a digit and
    // the other in a bend mark. Numbers are right-aligned within their column so single-
    // vs double-digit holes (e.g. "3" vs "10") line up on the ones digit too.
    // Color comes from the per-row techniqueColor() inline style, not here — these just
    // set layout/typography shared by every row regardless of technique.
    // 6px technique chip — the rail's legend, replacing the colored tab text that the
    // vivid fills can't safely carry at 11px.
    labelSwatch: { width: 6, height: 6, borderRadius: 2, marginRight: 6 },
    // Occupies the swatch's exact slot on rows that have no position, so the tab columns
    // to its right stay aligned with every other row.
    labelUnplayableMark: {
      width: 6, marginRight: 6,
      fontSize: 9, lineHeight: 10, textAlign: 'center',
      fontFamily: Poppins.bold, color: t.textMuted,
    },
    labelCellHovered: {
      backgroundColor: t.accentSoft,
      ...(Platform.OS === 'web' ? { cursor: 'default' } : null),
    } as any,
    // Hangs to the right, into the grid — the rail is only 88px wide, far too narrow to
    // hold a sentence, and there's nothing but empty grid to its right.
    labelTooltip: {
      position: 'absolute',
      left: '100%',
      top: 0,
      marginLeft: 6,
      width: 220,
      backgroundColor: t.textPrimary,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 2,
      zIndex: 40,
      ...(Platform.OS === 'web' ? { boxShadow: '0 4px 12px rgba(0,0,0,0.25)' } : null),
    } as any,
    labelTooltipText: { fontSize: 10, fontFamily: Poppins.semiBold, color: t.bg, lineHeight: 14 },
    labelTooltipHint: { fontSize: 10, fontFamily: Poppins.regular, color: t.bg, opacity: 0.7, lineHeight: 14 },
    labelTabSign:     { width: 7,  fontSize: 11, fontFamily: Poppins.extraBold, color: t.textPrimary, textAlign: 'right' },
    labelTabNumber:   { width: 14, fontSize: 11, fontFamily: Poppins.extraBold, color: t.textPrimary, textAlign: 'right' },
    labelTabModifier: { width: 20, fontSize: 11, fontFamily: Poppins.extraBold, color: t.textPrimary, textAlign: 'left' },
    labelNote: { width: 28, marginLeft: 4, fontSize: 10, fontFamily: Poppins.medium, color: t.textSub, textAlign: 'right' },
    gridVScroll: { flex: 1 },

    grid: { position: 'relative' },
    emptyGridHint: {
      position: 'absolute',
      top: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    emptyGridHintText: { fontSize: FONT.sm, fontFamily: Poppins.medium, color: t.textMuted },
    // Every row carries a real separator line. This used to be borderless on the theory
    // that the natural/accidental shading alone gave enough rhythm — in practice the rows
    // read as one undifferentiated field, so each now gets a visible hairline and the
    // octave boundary (below) stays heavier as the structural landmark.
    rowStripe: {
      position: 'absolute',
      left: 0,
      height: ROW_HEIGHT,
      backgroundColor: 'transparent',
      borderBottomWidth: 1,
      borderBottomColor: t.isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)',
    },
    // Accidental (sharp) rows — the grid's equivalent of a piano's black keys. A local
    // blue rather than the theme's neutral `surfaceAlt`: this shading is a property of
    // the grid, not of the app's surface hierarchy, and the tint reads as deliberate
    // where the grey read as a rendering artifact. Picked to sit at roughly the old
    // grey's lightness so the stripe rhythm is unchanged in strength, only in hue —
    // and kept clear of the blow blocks' blue-500 fill that sits on top of it.
    rowStripeAlt: { backgroundColor: t.isDark ? '#1E2A38' : '#D9E9F7' },
    // Rows that exist on the chromatic grid but aren't real positions on the current
    // (diatonic) instrument — deliberately flatter/lower-contrast than the natural/
    // accidental striping above, so unplayable rows read as visually "further back"
    // even though they're still fully visible and still take notes.
    rowUnplayable: {
      backgroundColor: t.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
      opacity: 0.6,
    },
    // Heavier divider where the octave number actually changes (e.g. B4 -> C5) —
    // a structural landmark, distinct from the plain per-row separator line.
    octaveBoundary: {
      borderBottomWidth: 1.5,
      borderBottomColor: t.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.13)',
    },

    // Wrapper carries horizontal position; the line is centered inside it via regular flex
    // flow rather than its own separate left math.
    playheadWrap: { position: 'absolute', top: 0, width: 8, alignItems: 'center' },
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

    // Quiet tinted card + saturated left edge, not a solid slab — backgroundColor and
    // borderColor come from techniqueSkin() per note, so only the structure lives here.
    // Square corners, full row height, no inset — a block now tiles its row exactly, so
    // adjacent notes butt up against each other and a run of them reads as one continuous
    // phrase (the tracker/DAW convention) instead of a string of separate lozenges. The
    // per-block edge (borderColor from techniqueSkin) is what keeps neighbours apart.
    noteBlock: {
      position:      'absolute',
      flexDirection: 'row',
      alignItems:    'stretch',
      borderRadius:  0,
      borderWidth:   1,
      overflow:      'hidden',
      ...(Platform.OS === 'web'
        ? {
            cursor: 'grab',
            transitionProperty: 'box-shadow, filter',
            transitionDuration: '120ms',
            transitionTimingFunction: 'ease',
          }
        : null),
    } as any,
    noteBlockHovered: {
      ...(Platform.OS === 'web' ? { filter: 'brightness(1.25)' } : null),
    } as any,
    noteBlockSelected: {
      ...(Platform.OS === 'web' ? { boxShadow: `0 0 0 2px ${t.accent}, 0 0 10px ${t.accentDim}` } : null),
    } as any,
    // Only for notes the detector wasn't confident about (see LOW_CONFIDENCE_THRESHOLD) —
    // a targeted signal, replacing the old blanket opacity fade that dimmed every note.
    noteBlockLowConfidence: { borderStyle: 'dashed' },
    noteBlockBody: { flex: 1, justifyContent: 'center', paddingLeft: 6, paddingRight: 6, overflow: 'hidden' },
    // Color is per-block (skin.label) — black or white, whichever the fill needs.
    noteBlockText: { fontSize: 10, fontFamily: Poppins.bold },
    // Live numeric readout shown while dragging (move/resize) — floats above the block,
    // left-anchored so it doesn't shift around as the block's own width changes mid-resize.
    dragTooltip: {
      position: 'absolute',
      top: -22,
      left: 0,
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderRadius: 5,
      backgroundColor: t.textPrimary,
      zIndex: 10,
      ...(Platform.OS === 'web' ? { boxShadow: '0 2px 6px rgba(0,0,0,0.25)' } : null),
    } as any,
    dragTooltipText: { fontSize: 10, fontFamily: Poppins.bold, color: t.bg },
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
    dataPanelTabs: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, height: DATA_PANEL_TABS_HEIGHT - 6 },
    dataTab: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    dataTabActive: { backgroundColor: t.accentSoft },
    // textSub, not textMuted — at 11px on white, textMuted (#A1A1AA) sits near 2.3:1,
    // which isn't readable for what is effectively this panel's navigation.
    dataTabText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    dataTabTextActive: { color: t.accent, fontFamily: Poppins.bold },
    dataPanelCollapseBtn: { marginLeft: 'auto', padding: 4, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null) } as any,
    dataPanelRow: { flexDirection: 'row' },
    dataAxisRail: {
      width: LABEL_WIDTH,
      height: DATA_BAR_HEIGHT,
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingRight: 8,
      paddingVertical: 2,
    },
    dataAxisLabel: { fontSize: 9, fontFamily: Poppins.semiBold, color: t.textMuted },
    dataAxisLabelMid: { color: t.textSub },
    dataBarClip: { flex: 1, height: DATA_BAR_HEIGHT, overflow: 'hidden' },
    dataBarContent: { height: DATA_BAR_HEIGHT, position: 'relative' },
    // Says why the panel is blank instead of leaving 140px of nothing — a per-frame
    // metric on a hand-drawn chart has no data to draw, which is a fact about the chart,
    // not a failure.
    dataEmpty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 24,
    },
    dataEmptyText: {
      fontSize: FONT.xs,
      fontFamily: Poppins.medium,
      color: t.textMuted,
      textAlign: 'center',
      maxWidth: 380,
    },
  });
}
