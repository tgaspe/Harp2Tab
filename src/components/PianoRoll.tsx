import { getGridRows, noteNameToMidi, type GridRow } from '@/audio/HarmonicaMapper';
import { passesDurationFloor } from '@/audio/duration';
import { getFrames } from '@/audio/frameBuffer';
import { layoutBackgroundLanes } from '@/audio/studioNotes';
import {
  constantTempoMap, gridLines, msToBarInMap, snapMsToGridInMap,
  type GridLine, type SnapDivision, type TempoMap,
} from '@/audio/tempo';
import { DEFAULT_NEW_NOTE_VELOCITY, noteVelocity, passesVelocityFloor } from '@/audio/velocity';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { WEB_CONTENT_WIDTH } from '@/constants/layout';
import { useTheme } from '@/hooks/useTheme';
import { selectRecordingId, useAppStore } from '@/store/useAppStore';
import { selectRecordings, useRecordingsStore } from '@/store/useRecordingsStore';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote, VelocitySource } from '@/types';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * Default pitch-row height, and what the tab editor uses.
 *
 * Overridable per host (`rowHeight` prop) rather than fixed, because the two stages have
 * very different ladders: the editor draws ~40 harmonica rows and wants them comfortable,
 * while the Studio draws the full 128-semitone chromatic range, where 28px means only a
 * couple of octaves are ever on screen.
 */
const ROW_HEIGHT       = 28;
// Wide enough for the rail's content plus a gutter on both sides. The cells' fixed
// columns come to 85px (swatch 6+6, sign 7, number 14, modifier 20, note 28+4), so at the
// old 88 they overflowed their own 8px right padding and sat flush against the left edge
// with nothing to spare — 85 + 10 left + 8 right = 103.
const LABEL_WIDTH       = 104;
// The zoom pill reads `pxPerSecond / DEFAULT_PX_PER_SECOND`, so the default is 100% and
// the floor below is the smallest percentage reachable. 0% can't exist — it would mean
// zero pixels per second, i.e. the whole piece collapsed to no width at all.
const DEFAULT_PX_PER_SECOND = 90;
// 20px/s (22%) was fine when a session was a harmonica take of a minute or two, but it
// can't fit a Studio arrangement: a five-minute project is 6000px at that floor, so most
// of it stays off-screen no matter how far out you zoom. 3px/s (3%) fits ~7 minutes in a
// 1200px viewport. Going this low is only viable because the grid tiers now thin out with
// zoom and the lines are culled to the viewport — see BeatGridLines.
const MIN_PX_PER_SECOND     = 3;
const MAX_PX_PER_SECOND     = 400;
const ZOOM_BUTTON_STEP      = 1.3; // multiplicative step per +/- tap, matching Frame Inspector's convention
// Breathing room left to the right of the last note when fitting the chart to the
// viewport, so the final note doesn't end flush against the edge.
const FIT_PADDING_PX        = 60;
const MIN_DURATION_MS   = 60;
const NUDGE_TIME_MS     = 50;
const RESIZE_HANDLE_W   = 10;
/**
 * Floor on a note block's rendered width.
 *
 * This was 14px, which is why blocks looked like they stopped responding to zoom: at the
 * default 90px/s a 300ms note is 27px, so anywhere below ~50% zoom every short note
 * clamped to the same 14px and the grid stopped showing real durations — they only
 * "returned" once you zoomed far enough in for the true width to exceed the floor.
 * 2px is only there so a note can't vanish entirely at the 3px/s zoom floor; it never
 * takes effect at a zoom you'd actually be editing at.
 */
const MIN_NOTE_WIDTH_PX = 2;
const RULER_HEIGHT      = 30;
/**
 * The grid's own horizontal scrollbar.
 *
 * A custom one rather than the ScrollView's native indicator, because of where the native
 * one ends up: the horizontal ScrollView sits *inside* the vertical one and its content is
 * the full row ladder tall, so its scrollbar renders at the bottom of all 128 rows — you
 * had to scroll to the very bottom of the pitch range to find out you could scroll
 * sideways at all. Inverting the two ScrollViews just moves the problem onto the vertical
 * bar, so the fix is a scrollbar that isn't a ScrollView's at all: this one is a sibling of
 * the grid, pinned under it, driven from the `scrollX` state the roll already keeps.
 */
const H_SCROLLBAR_H         = 12;
const H_SCROLLBAR_MIN_THUMB = 28;
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
// Grab band around the velocity floor's 2px line. Sized to the ~24px touch-target floor
// rather than to the ink, which is the whole reason a hairline is draggable at all.
const FLOOR_LINE_HIT_HEIGHT = 24;
// The knob at the line's left end. The band above is what actually catches the drag, but a
// full-width invisible target gives the eye nothing to aim at — a hairline reads as
// decoration, and the user has to discover by experiment that it can be moved at all.
const FLOOR_LINE_KNOB = 14;
// Duration's drag/arrow granularity, in ms. The velocity line steps by 1 because its whole
// scale is 127 units tall; duration's is however long the longest note is — often thousands
// of ms — where a 1 ms step is far finer than a pointer can resolve and would leave the
// readout flickering through values nobody chose.
const DURATION_FLOOR_STEP_MS = 10;
// Emit a live drag-tooltip label every Nth onUpdate call rather than every one — bounds
// the JS-thread state-update rate without needing a wall-clock read inside a worklet.
const DRAG_LABEL_THROTTLE = 4;

// Top of the velocity scale — MIDI's, so the chart's axis and the file's byte agree.
const VELOCITY_MAX = 127;
// Quiet, not absent. MIDI reserves velocity 0 for note-off, and `smf.ts` clamps to 1 on the
// way out regardless, so a bar dragged all the way down has to bottom out here or the note
// would leave the file as a silence the roll still draws.
const VELOCITY_MIN = 1;
// A velocity bar is only as wide as its note, and a 32nd note at low zoom is a couple of
// pixels — unusable as a drag target. The bar keeps its true width; only the invisible
// grab area widens to this.
const VELOCITY_BAR_MIN_HIT_WIDTH = 10;

// Grid resolution (quarter/eighth/sixteenth notes) — always a concrete value, no 'off'
// here (see the snapEnabled/snapSubdivision comment above the state declaration for why
// this is separate from whether snapping is actually turned on).
// Ordered by how fine the grid is, so the cycle button walks steadily from coarse to fine:
// the triplet's 12 divisions per bar sit between straight eighths (8) and sixteenths (16).
const SUBDIVISION_CYCLE: Exclude<SnapDivision, 'off'>[] = [4, 8, 12, 16];
const SUBDIVISION_LABELS: Record<Exclude<SnapDivision, 'off'>, string> = {
  4: '1/4', 8: '1/8', 12: '1/8T', 16: '1/16',
};

// Playing technique, parsed from the tab string's grammar: sign ("-" = draw, none = blow)
// + hole number + optional modifier ("'" x1-3 = bend depth, "o" = overblow). An empty
// tab (getGridRows' sentinel for "this row exists on the chromatic grid but isn't a
// real position on the current instrument") is its own category, not a fallback into
// 'blow' — it used to silently fall through to 'blow' before unplayable rows existed,
// which was wrong the moment a note could actually land on one.
type NoteTechnique = 'blow' | 'draw' | 'bend1' | 'bend2' | 'bend3' | 'overblow' | 'overdraw' | 'unplayable';

function classifyTechnique(tab: string): NoteTechnique {
  if (tab === '') return 'unplayable';
  // Overblow and overdraw are the same idea mirrored across the two reed groups, but they
  // are not the same action — one is blown and one is drawn — so the leading sign splits
  // them here exactly as it splits plain blow from plain draw below.
  if (tab.endsWith('o')) return tab.startsWith('-') ? 'overdraw' : 'overblow';
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
//
// Overdraw's green was picked the same way: CIEDE2000 against every other entry under
// Viénot-Brettel-Mollon protan/deutan/tritan simulation. Green is the only free hue region
// left — blue, orange, purple and yellow are all taken — and emerald-400 measured the
// widest worst-case separation of the greens, teals, pinks and reds tried: ΔE 29.7 normal
// / 17.0 protan / 17.9 deutan / 24.7 tritan, its nearest neighbour throughout being
// overblow. It wasn't a close call between equals — green-500 collapses to 8.7 deutan
// against draw, teal-400 to 5.9 against unplayable.
const TECHNIQUE_COLOR: Record<NoteTechnique, string> = {
  blow:       '#3B82F6', // blue-500
  draw:       '#F97316', // orange-500
  bend1:      '#C084FC', // purple-400  ─┐ one hue family, deepening with bend depth
  bend2:      '#A855F7', // purple-500   │
  bend3:      '#8B5CF6', // violet-500  ─┘
  overblow:   '#FACC15', // yellow-400  ─┐ the rarest techniques, the brightest pops
  overdraw:   '#34D399', // emerald-400 ─┘ (see above — deliberately NOT one hue family,
                         //                 since these two are opposite breath directions)
  unplayable: '#A1A1AA', // zinc-400 — neutral, deliberately outside the hue set above
};

const TECHNIQUE_LABEL: Record<NoteTechnique, string> = {
  blow: 'Blow', draw: 'Draw', bend1: 'Bend ×1', bend2: 'Bend ×2', bend3: 'Bend ×3',
  overblow: 'Overblow', overdraw: 'Overdraw',
  unplayable: 'Out of this harmonica’s range',
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
/**
 * A note block's fill, edge and label colours.
 *
 * `override` exists for the MIDI Studio, where colour means something different. In the tab
 * editor a note's colour is its *technique* — blow, draw, bend depth, overblow — read off
 * the tab string. The Studio has no harmonica yet, so every note's tab is empty, which
 * classifies as 'unplayable' and paints the whole grid zinc grey: technically consistent,
 * completely uninformative. There, colour identifies the *track* instead, matching the
 * track panel and the background lanes.
 */
function techniqueSkin(tab: string, isDark: boolean, override?: string) {
  const fill = override ?? techniqueColor(tab);
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

/**
 * Horizontal inset for a note's label, tightening as the block narrows.
 *
 * A block bottoms out at 14px wide, and a fixed 6px each side left ~2px of text area —
 * so the label didn't shrink or truncate, it simply vanished, and only reappeared once
 * the zoom made blocks wide enough. Wide blocks keep the comfortable inset; narrow ones
 * give the text nearly the whole block and let it clip at the edges, which is far more
 * legible than showing nothing at all.
 */
function labelInsetFor(widthPx: number): number {
  if (widthPx >= 34) return 6;
  if (widthPx >= 22) return 3;
  return 1;
}

// Below this, a note's detection is shaky enough to be worth flagging (dashed edge).
// Deliberately well under the 60–85% a normal clean note lands at, so the flag stays rare
// and meaningful instead of decorating the entire grid.
const LOW_CONFIDENCE_THRESHOLD = 50;

// Matches the existing "Add Note" toolbar button's default (edit.tsx) — the pencil tool's
// click-to-create uses the same baseline duration for consistency.
const DEFAULT_NEW_NOTE_DURATION_MS = 300;

/** A note's rendered width. One helper rather than the same clamp written at five call
 *  sites, which is how the hit-test and the block itself could have disagreed. */
function noteWidthPx(durationMs: number, pxPerSecond: number): number {
  return Math.max(MIN_NOTE_WIDTH_PX, (durationMs / 1000) * pxPerSecond);
}

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

/** The data panel's charts. There is no longer a non-chart tab here: the velocity filter
 *  used to be one, and is now the draggable line inside the Velocity chart itself. */
type DataMetric = 'velocity' | 'duration' | 'confidence' | 'pitchBend';

// Axis labels for the data panel's y-axis rail — top/bottom (and, for the bipolar
// Pitch Bend metric, a center "0¢" tick) describing the scale each metric's bars are
// actually drawn against, so a bar's height means something without cross-referencing code.
function getDataAxisLabels(
  metric: DataMetric,
  /** The Duration chart's ceiling, measured over the unfiltered notes by the caller — the
   *  same number the bars and the duration line are scaled against, so the rail can't
   *  describe a scale the chart isn't drawn to. Ignored by every other metric, whose axes
   *  are fixed. */
  durationMax: number,
): { top: string; mid?: string; bottom: string } {
  switch (metric) {
    case 'duration':
      return { top: formatDurationLabel(durationMax), bottom: '0' };
    case 'confidence':
      return { top: '100%', bottom: '0%' };
    case 'velocity':
      // A real fixed scale now, not a relative one: bars are the note's own 0–127 value, so
      // the same bar height means the same thing in every chart.
      return { top: '127', bottom: '0' };
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
  const extra = modifier.endsWith('o')
    ? (sign === '-' ? ', overdraw' : ', overblow')
    : bends > 0 ? `, bend ×${bends}` : '';
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

// `velocity` but deliberately not `velocitySource`: the source names the *scale* a note's
// 0–127 sits on, and dragging a bar in the Velocity chart moves the value along that scale
// rather than off it. Leaving it out of the update type is what guarantees an edit can't
// silently relabel the unit — see the field's own docs in `types/index.ts`.
type NoteUpdate = Partial<Pick<TabNote, 'tab' | 'note' | 'start_time' | 'duration' | 'velocity'>>;

// Most pitches have one row, but equivalent harp positions may intentionally have their
// own rows (notably 3 blow and -2 draw). Prefer the exact tab+pitch identity, then fall
// back to pitch for legacy/unplayable notes whose stored tab does not match the ladder.
function findNoteRowIndex(positions: readonly GridRow[], note: Pick<TabNote, 'tab' | 'note'>): number {
  const exact = positions.findIndex((row) => row.note === note.note && row.tab === note.tab);
  return exact >= 0 ? exact : positions.findIndex((row) => row.note === note.note);
}

// Transpose controls move by pitch, not by the number of visible rows. Search from the
// bottom so a target pitch with alternate rows resolves to its canonical row (-2, which
// is intentionally rendered after 3); Studio and all other pitches remain unchanged.
function findCanonicalMidiRowIndex(positions: readonly GridRow[], midi: number): number {
  for (let index = positions.length - 1; index >= 0; index--) {
    if (positions[index].midi === midi) return index;
  }
  return -1;
}

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
function LabelRailCell({ row, top, height, swatchColor, isOctaveBoundary, styles }: {
  row: GridRow;
  /** Absolute offset in the rail — the cell's own row index times the row height.
   *  Positioned rather than laid out in flow so off-screen cells can be culled. */
  top: number;
  height: number;
  /** Set when note colour is overridden — see `techniqueSkin`. */
  swatchColor?: string;
  isOctaveBoundary: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const [hovered, setHovered] = useState(false);
  const { sign, number, modifier } = parseTab(row.tab);
  return (
    <View
      style={[
        styles.labelCell,
        { position: 'absolute', top, left: 0, right: 0, height },
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
        <View style={[styles.labelSwatch, { backgroundColor: swatchColor ?? techniqueColor(row.tab) }]} />
      ) : (
        // An unplayable row's tab columns are all empty strings, which left a blank cell
        // that read as a rendering gap rather than "no position for this pitch".
        <Text style={styles.labelUnplayableMark}>–</Text>
      )}
      <Text style={styles.labelTabSign} numberOfLines={1}>{sign}</Text>
      <Text style={styles.labelTabNumber} numberOfLines={1}>{number}</Text>
      <Text style={styles.labelTabModifier} numberOfLines={1}>{modifier}</Text>
      <Text
        style={[styles.labelNote, !row.playable && styles.labelNoteUnplayable]}
        numberOfLines={1}
      >{row.note}</Text>

      {hovered && (
        <View pointerEvents="none" style={styles.labelTooltip}>
          <Text style={styles.labelTooltipText}>{describePosition(row.tab)}</Text>
          <Text style={styles.labelTooltipHint}>
            {row.playable ? row.note : `${row.note} · still plays back, but no harp position reaches it`}
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
  /** Pitch-row height in px. Defaults to `ROW_HEIGHT`; the Studio passes something
   *  shorter so more of the 128-row chromatic ladder fits on screen at once. */
  rowHeight?:     number;
  /** Overrides the technique-derived note colour. The Studio passes the active track's
   *  colour, since technique is a harmonica idea and there's no harmonica at that stage. */
  noteColor?:     string;
  /**
   * Draw the notes, don't offer to change them — the import preview's mode.
   *
   * Every control that writes goes away rather than being disabled: the tool picker, snap,
   * the grid resolution, quantize, transpose, help, the loop-region pins, the ruler's
   * click-to-seek, note dragging, click-to-create, the marquee, and the keyboard shortcuts.
   * What survives is everything that only changes *what you can see* — zoom, fit to
   * content, scrolling, and the data panel's read-only charts.
   *
   * Stronger than passing no-op handlers, and deliberately so. A control that quietly does
   * nothing reads as broken, and on the import screen the writes have somewhere real to
   * land: the roll falls back to the tab session's store for any bulk handler its host
   * omits, so a quantize there would edit whatever the user has open in the editor.
   */
  viewOnly?:      boolean;
  /** Tracks other than the one being edited, drawn behind it and completely inert. Keeping
   *  them non-interactive is a hard requirement, not a simplification: interactivity here
   *  means a gesture-handler instance per note, which is what the note culling below exists
   *  to limit in the first place. */
  backgroundLanes?: { id: string; color: string; notes: TabNote[] }[];
  /**
   * Bulk edits — quantize, duplicate, paste, group move, arrow-key nudge.
   *
   * These exist as props because the bulk paths used to reach into `useAppStore` directly
   * while the single-note paths went through `onUpdate`/`onCreate`. That split was
   * invisible while the tab editor was the only caller and silently wrong the moment a
   * second one appeared: in the Studio, a quantize would have edited the tab session
   * instead of the open project. Omitted by the tab editor, which keeps the store calls.
   */
  onUpdateMany?: (updates: { id: string; changes: NoteUpdate }[]) => void;
  /** May synchronously return the created notes when the host's write is React-state
   *  backed and therefore cannot be read back until the next render (the MIDI Studio). */
  onCreateMany?: (notes: Omit<TabNote, 'id'>[]) => TabNote[] | void;
  /** Notes as they exist *after* a create — used to select what was just made. The tab
   *  editor reads this back off its store; the Studio passes its own array. */
  readNotesAfterWrite?: () => TabNote[];
  selectedId:     string | null;
  onSelect:       (id: string) => void;
  onCreate:       (note: Omit<TabNote, 'id'>) => void;
  onUpdate:       (id: string, changes: NoteUpdate) => void;
  onDelete:       (id: string) => void;
  /** Delete a whole selection in one write. Optional: the tab editor's store-backed
   *  `onDelete` reads current state per call and uses stable ids, so looping it is
   *  correct there. The Studio's isn't — its ids are positional and each call rewrites
   *  the project from a value captured before the loop began — so it passes this. */
  onDeleteMany?:  (ids: string[]) => void;
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
  /**
   * The velocity filter — a threshold line the user drags inside the **Velocity plot**,
   * rather than a slider on a tab of its own.
   *
   * It lives in the plot because that plot is already a picture of the exact quantity being
   * thresholded: the line lands among the bars it acts on, so where to put it is a thing you
   * see rather than a number you guess at. The slider it replaced could only be tuned by
   * watching a note count change one tab away from the data explaining it.
   *
   * Optional: omitted once no note in the set states a dynamic — a control that provably
   * cannot do anything at any position is worse than none.
   */
  velocityFilter?: RollFilter & {
    /** Named in the plot corner, since the same threshold bites differently per source. */
    source?: VelocitySource | 'mixed';
  };
  /**
   * The duration filter — the same control in the **Duration plot**, thresholding length
   * instead of loudness. Hides notes *shorter* than the line.
   *
   * Worth having as a second filter rather than folding into the first: the notes it exists
   * to catch are the pitch tracker's and the neural engine's spurious short blips, and those
   * aren't quiet. A ghost note at the attack of a loud phrase is loud, so no velocity
   * threshold reaches it — length is the only axis that separates it from real music.
   *
   * Unlike `velocityFilter` there is no "unsupported" case to omit it for: every note has a
   * duration, so the control always has something to act on.
   */
  durationFilter?: RollFilter;
}

/** What a threshold line needs from its host. Shared, because the two filters differ in
 *  what they measure and in nothing else about how they're driven. */
export interface RollFilter {
  /** In the metric's own units — 0–127 for velocity, milliseconds for duration. 0 is off. */
  value:        number;
  onChange:     (v: number) => void;
  /**
   * The **unfiltered** notes — everything, including what the lines currently hide.
   *
   * Separate from `notes` (which is already filtered) because the two views have to
   * disagree: the roll hides what's below the line, while the plot has to keep drawing it
   * in grey. A plot that dropped those bars as the line passed them would erase the very
   * evidence you drag the line against, and "how much am I cutting" would be invisible at
   * exactly the moment it matters. For duration it does a second job — it fixes the chart's
   * y-axis ceiling, which a filtered array would let the line rescale from under itself.
   */
  allNotes:     TabNote[];
  /** After **every** filter, not just this one — what's actually on the roll. */
  audibleCount: number;
  totalCount:   number;
}

export function PianoRoll({
  notes, harmonicaKey, harmonicaType, bpm, tempoMap, rows, rowHeight, noteColor, backgroundLanes, viewOnly,
  onUpdateMany, onCreateMany, readNotesAfterWrite, selectedId, onSelect, onCreate, onUpdate, onDelete, onDeleteMany, isPlaying, currentTimeMs, onSeek,
  loopRegion, onLoopRegionChange, headerLeft, velocityFilter, durationFilter,
}: PianoRollProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Compiling is a small cost but not a free one, and this feeds every snap and every grid
  // line — memoized so a re-render for an unrelated reason doesn't rebuild it.
  const rowH = rowHeight ?? ROW_HEIGHT;
  // Gap above and below a background-lane block, as a share of the row.
  const backgroundInset = Math.max(1, Math.round(rowH * 0.18));

  const map = useMemo(() => tempoMap ?? constantTempoMap(bpm), [tempoMap, bpm]);

  // One place each for the bulk operations, so no call site below reaches into a store
  // directly. Defaults preserve the tab editor's existing behaviour exactly.
  const applyMany = useCallback((updates: { id: string; changes: NoteUpdate }[]) => {
    if (updates.length === 0) return;
    if (onUpdateMany) onUpdateMany(updates);
    else useAppStore.getState().updateNotes(updates);
  }, [onUpdateMany]);

  const createMany = useCallback((created: Omit<TabNote, 'id'>[]): TabNote[] | undefined => {
    if (created.length === 0) return [];
    if (onCreateMany) return onCreateMany(created) ?? undefined;
    useAppStore.getState().addTabNotes(created);
    return undefined;
  }, [onCreateMany]);

  // Deleting a whole selection. Falls back to looping the single-note path only when the
  // parent hasn't supplied a bulk one — see `onDeleteMany` on the props for when looping
  // is and isn't safe.
  const deleteMany = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    if (onDeleteMany) onDeleteMany(ids);
    else ids.forEach((id) => onDelete(id));
  }, [onDeleteMany, onDelete]);

  const notesAfterWrite = useCallback(
    () => (readNotesAfterWrite ? readNotesAfterWrite() : useAppStore.getState().tabNotes),
    [readNotesAfterWrite],
  );

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
  const [metricTab, setMetricTab] = useState<DataMetric>('velocity');
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
  const [mouseModeSetting, setMouseMode] = useState<'pencil' | 'selection'>('pencil');
  // A view-only roll has no tool picker to get back out of Selection with, and selection
  // mode is not merely inert there — it routes every note through the group overlay, which
  // only a marquee can populate. Pinned to pencil so the notes draw at all; `interactive`
  // below is what actually keeps them from being draggable.
  const mouseMode = viewOnly ? 'pencil' : mouseModeSetting;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const mouseModeRef   = useRef(mouseMode);   mouseModeRef.current   = mouseMode;
  const selectedIdsRef = useRef(selectedIds); selectedIdsRef.current = selectedIds;

  // A keyboard event can follow an RNGH runOnJS selection callback before React has
  // committed the parent/local state update. Keep the mirrors current at the interaction
  // boundary as well as at render time, so Copy always snapshots the note(s) the user just
  // selected instead of the preceding selection.
  const selectSingleNote = useCallback((id: string) => {
    selectedIdRef.current = id;
    onSelect(id);
  }, [onSelect]);

  const commitSelectedIds = useCallback((next: string[]) => {
    selectedIdsRef.current = next;
    setSelectedIds(next);
  }, []);

  // Filters and Studio track changes replace `notes` without remounting the shared roll.
  // A marquee selection is a selection of what this roll can currently edit, so discard
  // ids that disappeared instead of reporting or bulk-editing hidden/previous-track notes.
  useEffect(() => {
    const available = new Set(notes.map((note) => note.id));
    setSelectedIds((previous) => {
      const next = previous.filter((id) => available.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [notes]);

  function handleSetMouseMode(mode: 'pencil' | 'selection') {
    setMouseMode(mode);
    setSelectedIds([]);
  }

  // Tracks whether Shift is currently held (web only — no keyboard on touch), read from
  // plain JS-thread handler functions below (never from inside a worklet directly), so
  // there's no cross-thread staleness concern despite it being a plain ref rather than a
  // Reanimated shared value. Drives the selection tool's additive click/drag-marquee.
  const shiftHeldRef = useRef(false);
  /**
   * All three of this file's `window` key listeners bind on **focus**, not on mount — see
   * `useUndoRedoShortcuts`, which had to learn the same lesson. Screens are pushed rather
   * than replaced, so a roll on a screen you navigated away from is still mounted and its
   * effects are still running; with a mount-scoped listener, the editor left behind kept
   * answering Delete and Ctrl+D against the same store, and a second editor in the stack
   * ran every shortcut twice. A roll that isn't on the screen you're looking at should not
   * be listening to your keyboard.
   *
   * Shift-tracking gets the same treatment despite touching nothing but its own ref, so the
   * rule holds for the whole file rather than for two of three listeners. Cleared on the way
   * out, which also fixes the ref sticking `true` when the keyup lands somewhere else.
   */
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web' || viewOnly) return;
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Shift') shiftHeldRef.current = true; }
    function onKeyUp(e: KeyboardEvent) { if (e.key === 'Shift') shiftHeldRef.current = false; }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      shiftHeldRef.current = false;
    };
  }, [viewOnly]));

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
  // Where the pointer last was over the grid, so zoom can hold that spot still instead of
  // the middle of the viewport. Stored as a raw clientX plus the grid's own DOM node
  // rather than a resolved offset: the node's bounding rect moves with every scroll, so
  // resolving on mousemove would bake in a scroll position that's stale by the time a
  // zoom actually happens. Refs, not state — this updates on every mouse move and nothing
  // renders from it.
  const pointerClientXRef = useRef<number | null>(null);
  const gridNodeRef = useRef<{ getBoundingClientRect?: () => DOMRect } | null>(null);

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
  //
  // The pitch extremes are handed to getGridRows so the ladder always covers the music,
  // even where the music sits outside the harp. Translating to a lower harp is the case
  // that needs it: without it, every note above the new harp's ceiling loses its row and
  // drops out of the grid entirely while staying in the store. Reduced to two numbers
  // rather than passed as a list so that dragging a note — which churns `notes` identity
  // constantly — only rebuilds rows when the piece's actual range changes.
  const [notesLowMidi, notesHighMidi] = useMemo(() => {
    let low = Infinity;
    let high = -Infinity;
    for (const n of notes) {
      const midi = noteNameToMidi(n.note);
      if (midi === null) continue;
      if (midi < low)  low  = midi;
      if (midi > high) high = midi;
    }
    return low <= high ? [low, high] : [null, null];
  }, [notes]);

  const derivedRows = useMemo(
    () => (harmonicaKey
      ? getGridRows(
          harmonicaKey,
          harmonicaType,
          notesLowMidi === null ? [] : [notesLowMidi, notesHighMidi!],
        )
      : []),
    [harmonicaKey, harmonicaType, notesLowMidi, notesHighMidi],
  );
  const positions = rows ?? derivedRows;

  /**
   * What the Velocity chart draws: every note, filtered ones included.
   *
   * The other charts stay on the filtered `notes`, and the asymmetry is the point rather
   * than an oversight — grey here means "below the line", a statement only the chart holding
   * the line can make. A Duration chart with grey bars would be claiming something about
   * duration that isn't true.
   */
  const velocityChartNotes = velocityFilter?.allNotes ?? notes;
  const durationChartNotes = durationFilter?.allNotes ?? notes;

  /** Whichever line the visible chart carries, if it carries one. */
  const activeFilter = metricTab === 'velocity' ? velocityFilter
    : metricTab === 'duration' ? durationFilter
    : undefined;

  /** What the visible chart draws — unfiltered for the two metrics that own a line. */
  const chartNotes = metricTab === 'velocity' ? velocityChartNotes
    : metricTab === 'duration' ? durationChartNotes
    : notes;

  /**
   * The Duration chart's y-axis ceiling.
   *
   * Over the *unfiltered* notes, always. Measured over the filtered set instead, this would
   * be a feedback loop: raising the line drops the longest note, which lowers the ceiling,
   * which rescales every bar and slides the line out from under the pointer mid-drag. It's
   * the one thing the duration filter has to get right that the velocity filter — whose axis
   * is a fixed 0–127 — never had to think about.
   */
  const durationMax = useMemo(
    () => maxOf(durationChartNotes.map((n) => n.duration), 1),
    [durationChartNotes],
  );

  const dataAxisLabels = useMemo(
    () => getDataAxisLabels(metricTab, durationMax),
    [metricTab, durationMax],
  );

  // Pitch Bend is the only per-frame metric left — it needs the raw analysis frames, which
  // a chart that was drawn by hand (or saved before frame retention) simply doesn't have.
  // Velocity/Duration/Confidence come off the notes themselves and always do; Velocity used
  // to be drawn from frame RMS, which meant it was permanently empty for the neural engine
  // and for MIDI, neither of which produces frames at all.
  //
  // The two charts that carry a line are measured against the *unfiltered* set: a line
  // dragged above the loudest (or longest) note would otherwise empty the chart and replace
  // it with the "nothing to analyze" card — taking the line, and the only means of getting
  // back, off screen with it.
  const metricHasData = metricTab === 'pitchBend' ? frames.length > 0 : chartNotes.length > 0;

  // A panel whose opening tab would be empty starts collapsed, rather than reserving ~150px
  // for an empty box. Keyed on the *default* tab's data (Velocity, which is per-note) rather
  // than on frames: a neural or MIDI import has no frames but does have velocities, and used
  // to open collapsed on the strength of a chart it was no longer showing. One-shot — once
  // the user has touched the toggle, this never re-decides for them.
  const didInitPanelRef = useRef(false);
  useEffect(() => {
    if (didInitPanelRef.current) return;
    didInitPanelRef.current = true;
    // The unfiltered set, so a project reopened with a high saved floor doesn't start
    // collapsed over an "empty" Velocity chart — hiding the line that's doing the hiding.
    if (!velocityChartNotes.some((n) => noteVelocity(n) !== undefined)) {
      setPanelCollapsed(true);
      panelHeight.value = DATA_PANEL_COLLAPSED_HEIGHT;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [velocityChartNotes.length]);

  // Render-time mirror of getSelectionNotes()'s count — that one reads refs (it's called
  // from keyboard handlers and worklet callbacks), which don't re-render, so the toolbar
  // can't derive its enabled/disabled state from it.
  const selectionCount = mouseMode === 'pencil' ? (selectedId ? 1 : 0) : selectedIds.length;
  const hasSelection = selectionCount > 0;
  const allNotesSelected = mouseMode === 'selection'
    && notes.length > 0
    && notes.every((note) => selectedIds.includes(note.id));

  /**
   * Select only this roll's editable input. In the tab editor that is the notes surviving
   * both filters; in the Studio it is the visible notes on the selected track. Background
   * lanes never enter `notes`, so this cannot silently reach into another track.
   */
  function handleSelectAllToggle() {
    if (allNotesSelected) {
      setSelectedIds([]);
      return;
    }
    setMouseMode('selection');
    setSelectedIds(notes.map((note) => note.id));
  }

  /**
   * How far the content runs — across *every* lane, not just the editable one.
   *
   * The bar ruler, the grid lines and the scrollable width are all sized from this. Taking
   * it from the selected track alone (which is what it did while the tab editor was the
   * only caller, where there is nothing else) meant that in the Studio a short selected
   * track truncated the whole grid: longer background tracks kept drawing notes past the
   * end of the content width, with no bar lines under them and the tail clipped off.
   */
  const editableTotalMs = useMemo(
    () => notes.reduce((max, n) => Math.max(max, n.start_time + n.duration), 0),
    [notes],
  );
  const totalMs = useMemo(() => {
    let end = editableTotalMs;
    for (const lane of backgroundLanes ?? []) {
      for (const n of lane.notes) end = Math.max(end, n.start_time + n.duration);
    }
    return end;
  }, [editableTotalMs, backgroundLanes]);
  // Floor gridWidth to the actual available viewport, not just a fixed 600 — otherwise a
  // short recording leaves a huge blank gap (no rows, no lines) to the right on a wide
  // screen, since the scrollable content would be narrower than the screen itself.
  const dataWidth  = (totalMs / 1000) * pxPerSecond + 120;
  const gridWidth  = Math.max(viewportWidth || 600, dataWidth);
  const gridHeight = positions.length * rowH;

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
    Math.floor(scrollY / rowH) - CULL_MARGIN_ROWS,
  );
  const lastVisibleRow = Math.min(
    positions.length - 1,
    Math.ceil((scrollY + (gridViewportHeight || positions.length * rowH)) / rowH) + CULL_MARGIN_ROWS,
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

  // Culled on both axes before any View is created. The layout itself lives in
  // `studioNotes` so it can be measured directly — it's the loop that decides whether a
  // large multi-track project is usable.
  const backgroundNoteBlocks = useMemo(
    () => layoutBackgroundLanes(backgroundLanes, rowIndexByNote, {
      visibleStartMs, visibleEndMs, firstVisibleRow, lastVisibleRow,
      pxPerSecond, rowHeight: rowH,
    }),
    [backgroundLanes, rowIndexByNote, visibleStartMs, visibleEndMs, firstVisibleRow, lastVisibleRow, pxPerSecond],
  );

  // Shared by the marquee hit-test and the group-selection bounding box — content-space
  // {left, top, width, height} for a note, or null if its pitch doesn't match any row
  // (shouldn't normally happen, but positions can lag a stale note during a key change).
  // Exact tab+pitch matching keeps equivalent harp positions on their own rows; the
  // helper falls back to pitch for stale or unplayable data.
  function noteBounds(note: TabNote): { left: number; top: number; width: number; height: number } | null {
    const rowIndex = findNoteRowIndex(positions, note);
    if (rowIndex === -1) return null;
    const left = (note.start_time / 1000) * pxPerSecond;
    const width = noteWidthPx(note.duration, pxPerSecond);
    return { left, top: rowIndex * rowH, width, height: rowH };
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
    const hit = noteAt(x, y);
    if (hit) { selectSingleNote(hit.id); return; }

    const rowIndex = Math.min(positions.length - 1, Math.max(0, Math.floor(y / rowH)));
    const pos = positions[rowIndex];
    const rawStart = Math.max(0, (x / pxPerSecond) * 1000);
    const start = snapMsToGridInMap(map, Math.round(rawStart), snapDivision);
    onCreate({
      tab: pos.tab, note: pos.note, start_time: start,
      duration: DEFAULT_NEW_NOTE_DURATION_MS, confidence: 100,
      // Stated, not left absent. An absent velocity reads as "unknown" everywhere
      // downstream: no bar in the Velocity chart, nothing for the filter to act on, and a
      // number invented at MIDI-write time instead of carried on the note. No
      // `velocitySource` though — the three sources all describe a *measurement*, and this
      // note was never measured.
      //
      // Floored at the filter line rather than flatly 80: below it the note would be
      // created already hidden, so clicking the grid would do nothing visible and the
      // pencil would look broken. The line is a viewing threshold, and nothing the user
      // draws should land on the wrong side of it at birth.
      velocity: Math.max(DEFAULT_NEW_NOTE_VELOCITY, velocityFilter?.value ?? 0),
    });
    const updated = notesAfterWrite();
    const created = updated[updated.length - 1];
    if (created) selectSingleNote(created.id);
  }

  // Content-space hit test — which note, if any, sits under this point. Shared by the
  // pencil tool's click-to-create (which has to select an existing note rather than stack
  // a new one under it), the selection tool's plain click, and right-click-to-delete.
  function noteAt(x: number, y: number): TabNote | undefined {
    return notes.find((n) => {
      const b = noteBounds(n);
      return b !== null && x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;
    });
  }

  /**
   * Right-click a note to delete it (web).
   *
   * Handled on the grid as a whole rather than per note block for two reasons: a
   * right-click on *empty* grid still has to swallow the browser's own context menu (a
   * native menu popping up over the editor is the thing that makes right-click feel
   * unsupported), and the hit test it needs already exists here — a note block has no
   * access to the notes beside it, and in selection mode the selected ones aren't even
   * rendered as their own blocks (they're ghosts inside GroupSelectionOverlay, which is
   * pointerEvents-transparent), so a per-block handler would miss exactly the notes a
   * user is most likely to aim at.
   */
  /** Feeds `zoomAnchorX` — see the refs it writes for why it stores the raw clientX. */
  function handleGridMouseMove(e: { clientX: number; currentTarget: unknown }) {
    gridNodeRef.current = e.currentTarget as { getBoundingClientRect?: () => DOMRect };
    pointerClientXRef.current = e.clientX;
  }

  /**
   * Return keyboard shortcuts to the roll when the user comes back from editing a title,
   * tempo, or other text field. React Native Web's grid Views are not focusable, so merely
   * clicking a note can leave the previous input as document.activeElement; the shortcut
   * guard then correctly treats Cmd/Ctrl+C as text copy and never refreshes our note
   * clipboard. Blurring on mouse-down happens before the following key gesture while still
   * preserving native copy/paste whenever the user is actually working in the input.
   */
  function handleGridMouseDown() {
    const active = document.activeElement;
    if (active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      active.blur();
    }
  }

  function handleGridContextMenu(e: {
    preventDefault: () => void; clientX: number; clientY: number; currentTarget: unknown;
  }) {
    // Unconditional, before the hit test: right-clicking empty grid should do nothing at
    // all, not open the browser menu.
    e.preventDefault();
    const node = e.currentTarget as { getBoundingClientRect?: () => DOMRect } | null;
    const rect = node?.getBoundingClientRect?.();
    if (!rect) return;

    const hit = noteAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;

    // Right-clicking inside a marquee selection removes the whole selection — matching
    // what Backspace does there — rather than silently picking one note out of it.
    if (mouseMode === 'selection' && selectedIds.includes(hit.id)) {
      deleteMany(selectedIds);
      setSelectedIds([]);
      return;
    }
    onDelete(hit.id);
    if (mouseMode === 'selection') setSelectedIds((prev) => prev.filter((id) => id !== hit.id));
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
      commitSelectedIds(Array.from(new Set([...selectedIdsRef.current, ...matchedIds])));
    } else {
      commitSelectedIds(matchedIds);
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
    const hit = noteAt(x, y);
    if (shiftHeldRef.current) {
      if (hit) {
        const previous = selectedIdsRef.current;
        commitSelectedIds(previous.includes(hit.id)
          ? previous.filter((id) => id !== hit.id)
          : [...previous, hit.id]);
      }
      return;
    }
    commitSelectedIds(hit ? [hit.id] : []);
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
    applyMany(applyTo.map((n) => ({
      id: n.id,
      changes: { start_time: snapMsToGridInMap(map, n.start_time, snapSubdivision) },
    })));
  }

  /**
   * The viewport-space x that zoom holds still — the timestamp under it stays put while
   * everything else scales around it.
   *
   * Wherever the pointer last was over the grid, so zooming keeps whatever you were
   * looking at under the cursor. Falls back to the middle of the viewport when there's no
   * usable pointer position: before the mouse has ever been over the grid, on touch, and —
   * the case that actually matters — when the last position has since been scrolled out of
   * view, where anchoring to it would fling the grid somewhere the user isn't looking.
   */
  function zoomAnchorX(): number {
    const center = viewportWidth / 2;
    const clientX = pointerClientXRef.current;
    const rect = gridNodeRef.current?.getBoundingClientRect?.();
    if (clientX === null || !rect || viewportWidth === 0) return center;
    // The grid element *is* the scrolling content, so its left edge moves with scrollX —
    // clientX - rect.left is a content-space offset, and the scroll has to come back out
    // of it to say where that lands on screen.
    const viewportX = clientX - rect.left - scrollX;
    return viewportX < 0 || viewportX > viewportWidth ? center : viewportX;
  }

  // Zoom for the +/- buttons and the %-pill's reset-to-default. Same anchored math as the
  // wheel handler below — a button press has no cursor position of its own, so it borrows
  // the last one over the grid (see zoomAnchorX).
  function zoomByFactor(factor: number) {
    const oldPx = pxPerSecond;
    const newPx = Math.max(MIN_PX_PER_SECOND, Math.min(MAX_PX_PER_SECOND, oldPx * factor));
    if (newPx === oldPx) return;
    const anchorX = zoomAnchorX();
    const anchorTimeMs = ((scrollX + anchorX) / oldPx) * 1000;
    const newScrollX = Math.max(0, (anchorTimeMs / 1000) * newPx - anchorX);
    setPxPerSecond(newPx);
    setScrollX(newScrollX);
    isProgrammaticScrollRef.current = true;
    hScrollRef.current?.scrollTo({ x: newScrollX, animated: false });
  }

  /**
   * Scroll the pitch axis so the notes are actually in view, without touching the zoom.
   *
   * The row ladder is the full chromatic range (40 rows in the editor, 128 in the Studio)
   * and starts scrolled to its highest rows, which for most music is empty sky — so
   * without this a saved chart opens onto blank rows well above anything it contains.
   */
  function centerOnNotes() {
    // Renamed off `rows` once that became a prop — this is the set of row *indices* the
    // notes occupy, not the row list itself.
    const occupiedRows = notes
      .map((n) => findNoteRowIndex(positions, n))
      .filter((i) => i >= 0);
    if (occupiedRows.length === 0 || gridViewportHeight === 0) return;
    const centerPx = ((Math.min(...occupiedRows) + Math.max(...occupiedRows) + 1) / 2) * rowH;
    const maxY = Math.max(0, positions.length * rowH - gridViewportHeight);
    vScrollRef.current?.scrollTo({
      y: Math.max(0, Math.min(maxY, centerPx - gridViewportHeight / 2)),
      animated: false,
    });
  }

  // Zoom + scroll so the whole chart is on screen at once: horizontally the full duration
  // fills the viewport, vertically the used pitch range is centred. The toolbar's
  // "Fit to content" button, and only that — see the open effect below for why this is no
  // longer what happens automatically.
  function fitToContent() {
    if (positions.length === 0) return;

    // Frames the track being *edited*, not the whole arrangement — otherwise selecting a
    // four-bar part in a three-minute project zooms out until that part is a sliver.
    // Falls back to the full extent when the selected track is empty, so there's still
    // something meaningful on screen. The grid itself always spans every lane (`totalMs`).
    const fitMs = editableTotalMs > 0 ? editableTotalMs : totalMs;
    if (fitMs > 0 && viewportWidth > 0) {
      const target = ((viewportWidth - FIT_PADDING_PX) / fitMs) * 1000;
      const newPx = Math.max(MIN_PX_PER_SECOND, Math.min(MAX_PX_PER_SECOND, target));
      setPxPerSecond(newPx);
      setScrollX(0);
      isProgrammaticScrollRef.current = true;
      hScrollRef.current?.scrollTo({ x: 0, animated: false });
    }

    centerOnNotes();
  }

  /**
   * What happens when a chart opens: start at the beginning, at 100% zoom, scrolled to
   * where the notes are.
   *
   * This used to run the full `fitToContent`, which meant the zoom you landed on was
   * whatever it took to fit that particular piece — a short take opened zoomed way in, a
   * long one zoomed way out, and the reading on the zoom pill was a different number every
   * time. A fixed 100% is a frame of reference: bar widths mean the same thing across every
   * chart and every session, and "Fit to content" is right there in the toolbar for when
   * the whole piece at once is what you actually want.
   *
   * Ref-guarded rather than dependency-guarded: after this first pass the view belongs to
   * the user, and neither editing notes nor resizing the window should yank it back.
   */
  const didAutoFitRef = useRef(false);
  // ...but a different chart is a different thing to look at, so loading one re-arms it.
  // Declared above the effect so that on a recording change this clears the flag before
  // the effect below gets its chance to act on it.
  useEffect(() => { didAutoFitRef.current = false; }, [recordingId]);
  useEffect(() => {
    if (didAutoFitRef.current) return;
    if (notes.length === 0 || positions.length === 0) return;
    if (viewportWidth === 0 || gridViewportHeight === 0) return;
    didAutoFitRef.current = true;
    setPxPerSecond(DEFAULT_PX_PER_SECOND);
    setScrollX(0);
    isProgrammaticScrollRef.current = true;
    hScrollRef.current?.scrollTo({ x: 0, animated: false });
    centerOnNotes();
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
  const clipboardRef = useRef<{
    tab: string; note: string; duration: number; offsetMs: number;
    velocity: number; velocitySource?: VelocitySource;
  }[]>([]);

  /**
   * Commit a velocity dragged in the Velocity chart.
   *
   * Deliberately single-note: the chart's bars are addressed by their own note, not by the
   * roll's selection, so dragging one never moves a bar the user can't see themselves
   * grabbing. Applying a delta across the whole selection is a separate gesture and a
   * separate decision.
   */
  const handleVelocityChange = useCallback((id: string, velocity: number) => {
    onUpdate(id, { velocity });
  }, [onUpdate]);

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
  function selectNewest(count: number, synchronouslyCreated?: TabNote[]) {
    const created = synchronouslyCreated ?? (() => {
      const updated = notesAfterWrite();
      return updated.slice(updated.length - count);
    })();
    if (mouseModeRef.current === 'pencil') {
      if (created[0]) selectSingleNote(created[0].id);
    } else {
      commitSelectedIds(created.map((n: TabNote) => n.id));
    }
  }

  // Duplicate: places a copy of each selected note immediately after it ends, back-to-
  // back — no clipboard involved, distinct from copy/paste below (which anchors to the
  // playhead instead). Full confidence, matching a fresh pencil-drawn note: this is a
  // deliberate user action, not a re-run of pitch detection.
  //
  // Velocity is the exception to that "it's a new note" framing: a copy of a note is the
  // same note, so it carries the original's dynamic *and* its `velocitySource` rather than
  // resetting to the hand-drawn default. Dropping them would make a duplicated phrase read
  // flat next to the phrase it was duplicated from.
  function handleDuplicate() {
    const targets = getSelectionNotes();
    if (targets.length === 0) return;
    const created = createMany(targets.map((n) => ({
      tab: n.tab, note: n.note, confidence: 100,
      start_time: n.start_time + n.duration, duration: n.duration,
      velocity: noteVelocity(n) ?? DEFAULT_NEW_NOTE_VELOCITY, velocitySource: n.velocitySource,
    })));
    selectNewest(targets.length, created);
  }

  function handleCopy() {
    const targets = getSelectionNotes();
    if (targets.length === 0) return;
    const earliestStart = Math.min(...targets.map((n) => n.start_time));
    clipboardRef.current = targets.map((n) => ({
      tab: n.tab, note: n.note, duration: n.duration, offsetMs: n.start_time - earliestStart,
      velocity: noteVelocity(n) ?? DEFAULT_NEW_NOTE_VELOCITY, velocitySource: n.velocitySource,
    }));
  }

  // Re-anchors the earliest copied note to the current playhead position, preserving
  // the relative spacing between copied notes for a multi-note copy.
  function handlePaste() {
    const clip = clipboardRef.current;
    if (clip.length === 0) return;
    const anchor = currentTimeMsRef.current;
    const created = createMany(clip.map((c) => ({
      tab: c.tab, note: c.note, duration: c.duration, confidence: 100,
      start_time: Math.max(0, anchor + c.offsetMs),
      // Copied at Copy time, same reasoning as handleDuplicate — a paste is the note again,
      // not a new note that happens to share its pitch.
      velocity: c.velocity, velocitySource: c.velocitySource,
    })));
    selectNewest(clip.length, created);
  }

  function showToast(message: string) {
    setToastMessage(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2500);
  }

  // Shared by Arrow Up/Down (±1 semitone), Shift+Arrow Up/Down (±12), and the semitone/
  // octave toolbar buttons below — moves every currently-selected note by pitch (via
  // getSelectionNotes, which already abstracts over pencil's single selectedId vs.
  // selection-mode's marquee set) up/down the chromatic row grid, committed as one bulk
  // updateNotes call. A note that can't move the full distance without falling off the
  // grid is skipped individually rather than blocking the rest — this is the semitone-
  // scale "clamp" policy; the octave *button* instead disables itself upfront when any
  // selected note is at the edge (see canShiftOctave below) so this function is only
  // ever called there once success is already guaranteed. Shift+Arrow has no such
  // disabled-button concept (a keyboard shortcut can't grey itself out), so it always
  // uses this same skip-and-report behavior regardless of scale.
  function shiftSelectionByRows(semitoneDelta: number) {
    const targets = getSelectionNotes();
    if (targets.length === 0) return;
    const updates: { id: string; changes: NoteUpdate }[] = [];
    let skipped = 0;
    for (const n of targets) {
      const rowIndex = findNoteRowIndex(positions, n);
      const newRow = rowIndex === -1
        ? -1
        : findCanonicalMidiRowIndex(positions, positions[rowIndex].midi - semitoneDelta);
      if (newRow === -1) { skipped++; continue; }
      const p = positions[newRow];
      updates.push({ id: n.id, changes: { tab: p.tab, note: p.note } });
    }
    applyMany(updates);
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
      const rowIndex = findNoteRowIndex(positions, n);
      return rowIndex !== -1 && findCanonicalMidiRowIndex(
        positions,
        positions[rowIndex].midi - direction * 12,
      ) !== -1;
    });
  }

  useFocusEffect(useCallback(() => {
    // Every shortcut below either edits or picks a tool, so a view-only roll registers
    // none of them — and being window-level, they'd otherwise be live for a screen that
    // has no visible control doing the same thing.
    if (Platform.OS !== 'web' || positions.length === 0 || viewOnly) return;

    // These are window-level listeners, so they fire while the user is typing in a field
    // somewhere else on the screen too — which meant a "1" in the recording-title box
    // silently switched tools and a Backspace deleted a note instead of a character. Same
    // guard the screen-level undo/redo handlers use.
    function isTextInput(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTextInput(e.target)) return;

      // Copy/duplicate/paste — work regardless of tool/selection model (see
      // getSelectionNotes above), same as the tool shortcuts just below.
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          setMouseMode('selection');
          setSelectedIds(notesRef.current.map((note) => note.id));
          return;
        }
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
          deleteMany(ids);
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
          applyMany(updates);
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
  }, [positions, onUpdate, onDelete, onSelect, deleteMany, viewOnly]));

  // Modifier + scroll to zoom, cursor-anchored so the timestamp under the pointer stays
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
      // Ctrl/Cmd as well as Alt, because a trackpad pinch is delivered as a wheel event
      // with ctrlKey set — so this is what makes pinch-to-zoom work at all, on top of
      // being the modifier most people reach for. Without the preventDefault below, the
      // browser would take that same gesture as a page zoom.
      if (!e.altKey && !e.ctrlKey && !e.metaKey) return;
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

  // The blurred duplicate was the source of the flashing; keep the crisp line fractional
  // so it can move continuously rather than stepping one physical pixel at a time.
  const playheadLeft = (currentTimeMs / 1000) * pxPerSecond;
  const showPlayhead = isPlaying || currentTimeMs > 0;

  // Click the ruler to move the playhead there — the parent decides whether that's a plain
  // seek or a scrub that restarts playback from the new spot (see edit.tsx's handleSeek).
  // Attached directly to rulerContent, which is sized to gridWidth and only visually
  // shifted via a transform for scroll-sync, so the gesture's local x is already in the
  // same content-space coordinates as bar/note positions — no manual scrollX offset
  // needed, same reasoning as the grid's own background gesture.
  //
  // Disabled rather than absent when view-only: there's nothing to seek to on a roll with
  // no playhead, and a ruler that silently jumped a playhead the user can't see would be
  // the one interactive thing left on a picture.
  const rulerTapGesture = Gesture.Tap().enabled(!viewOnly).onEnd((e, success) => {
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
  useFocusEffect(useCallback(() => {
    // No dock to drag a pin out of when the roll is view-only, so nothing to abort.
    if (Platform.OS !== 'web' || viewOnly) return;
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
  }, [viewOnly]));

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
  // ─── Horizontal scrollbar geometry ───────────────────────────────────────────
  // All derived from state the roll already holds (see H_SCROLLBAR_H for why this isn't a
  // native ScrollView indicator). The track spans exactly the grid's viewport, so its
  // width and the scrollable width are the same two numbers the culling already uses.
  const hTrackW    = Math.max(0, viewportWidth);
  const maxScrollX = Math.max(0, gridWidth - hTrackW);
  // A full-width thumb when the whole chart already fits, rather than hiding the bar: it
  // being always present is the point, and a bar that comes and goes shifts the layout
  // under the grid every time you zoom past the fit threshold.
  const hThumbW = hTrackW === 0 ? 0
    : maxScrollX === 0 ? hTrackW
    : Math.min(hTrackW, Math.max(H_SCROLLBAR_MIN_THUMB, (hTrackW / gridWidth) * hTrackW));
  const hThumbTravel = Math.max(0, hTrackW - hThumbW);
  const hThumbX = maxScrollX === 0 ? 0 : Math.min(hThumbTravel, (scrollX / maxScrollX) * hThumbTravel);
  const hDragStartXRef = useRef(0);

  /** The one place that moves the grid horizontally on the scrollbar's behalf — keeps the
   *  `scrollX` mirror, the real ScrollView and the autoscroll flag in agreement. */
  function scrollGridToX(x: number) {
    const clamped = Math.max(0, Math.min(maxScrollX, x));
    // Dragging the scrollbar is the user taking over the view, exactly like scrolling the
    // grid itself — playback autoscroll stands down until the next play (see
    // handleGridScroll, which can't infer it here because the scroll *is* programmatic).
    autoScrollEnabledRef.current = false;
    isProgrammaticScrollRef.current = true;
    setScrollX(clamped);
    hScrollRef.current?.scrollTo({ x: clamped, animated: false });
  }

  function beginThumbDrag() { hDragStartXRef.current = scrollXRef.current; }

  function dragThumbBy(dx: number) {
    if (hThumbTravel <= 0) return;
    scrollGridToX(hDragStartXRef.current + (dx / hThumbTravel) * maxScrollX);
  }

  /** Click the empty track to jump — lands the thumb centred on the click, the convention
   *  every native scrollbar's page-jump approximates. Clicks that land on the thumb itself
   *  are ignored so a stationary press before a drag doesn't first teleport the view. */
  function jumpThumbTo(x: number) {
    if (hThumbTravel <= 0) return;
    if (x >= hThumbX && x <= hThumbX + hThumbW) return;
    scrollGridToX(((x - hThumbW / 2) / hThumbTravel) * maxScrollX);
  }

  const hThumbGesture = Gesture.Pan()
    .onStart(() => { runOnJS(beginThumbDrag)(); })
    .onUpdate((e) => { runOnJS(dragThumbBy)(e.translationX); });

  const hTrackGesture = Gesture.Tap().onEnd((e, success) => {
    if (success) runOnJS(jumpThumbTo)(e.x);
  });

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

  // A disabled gesture rather than a missing GestureDetector, so the grid's element tree is
  // the same shape in both modes — the scroll views around it are sensitive to it.
  const backgroundGesture = viewOnly
    ? Gesture.Tap().enabled(false)
    : mouseMode === 'pencil'
      ? Gesture.Tap().onEnd((e, success) => {
          if (success) runOnJS(handleCreateNoteAt)(e.x, e.y);
        })
      : Gesture.Race(selectionTapGesture, marqueeGesture);

  /**
   * Nothing to draw without a key or a row set.
   *
   * **This guard sits below every hook deliberately.** It used to run ~250 lines earlier,
   * before the loop-pin and loop-region hooks — which meant a render with no positions called
   * fourteen fewer hooks than a render with them, and React's hook order is positional. The
   * first render that gained positions after one that lacked them would throw *"Rendered more
   * hooks than during the previous render"*, which is a white screen rather than a warning.
   * It is reachable: the Studio mounts the roll before a project's rows resolve.
   *
   * Everything between the last hook and here is local arithmetic and gesture construction —
   * none of it reads `positions` or `harmonicaKey` — so running it on the empty case costs a
   * few objects and is what keeps the hook order fixed.
   */
  if (!harmonicaKey || positions.length === 0) return null;

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

        {/* Every control in this cluster writes — tools, snap, quantize, transpose — and
            the help sheet documents exactly them. A view-only roll keeps the left cluster
            (title, zoom, fit) and shows nothing here. */}
        {!viewOnly && (
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

          {/* An action beside the tool switch, not a third segment: Pencil/Select persist
              as modes, while this applies once to the exact editable set on screen. */}
          <Pressable
            onPress={handleSelectAllToggle}
            disabled={notes.length === 0}
            style={[
              styles.selectAllBtn,
              allNotesSelected && styles.selectAllBtnActive,
              notes.length === 0 && styles.zoomBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: notes.length === 0 }}
            accessibilityLabel={allNotesSelected ? 'Clear note selection' : 'Select all visible notes'}
          >
            <MaterialCommunityIcons
              name={allNotesSelected ? 'select-off' : 'select-all'}
              size={14}
              color={allNotesSelected ? '#fff' : theme.textSub}
            />
            <Text style={[styles.selectAllBtnText, allNotesSelected && styles.selectAllBtnTextActive]}>
              {allNotesSelected ? 'Clear' : 'Select all'}
            </Text>
          </Pressable>
          {mouseMode === 'selection' && selectedIds.length > 0 && (
            <Text style={styles.selectionCountText} numberOfLines={1}>
              {selectedIds.length} selected
            </Text>
          )}

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
            style={[styles.snapBtn, styles.helpBtn]}
            accessibilityRole="button"
            accessibilityLabel="Show help"
          >
            <Ionicons name="help" size={14} color="#fff" />
          </Pressable>
        </View>
        )}
      </View>

      {/* Bar ruler — follows the grid's horizontal scroll via a transform, not its own
          independent ScrollView (simpler and more reliable than syncing two scrollables).
          A click seeks. The dock to its left is what places an A/B loop region — see
          pinDockGesture above. */}
      <View style={styles.rulerRow}>
        {/* The rail itself stays in the view-only case even with no dock in it: its width
            is what holds the ruler in register with the frozen label column below. */}
        <View style={styles.pinDockRail}>
          {!viewOnly && (
            <>
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
            </>
          )}
        </View>

        <View style={styles.rulerClip}>
          <GestureDetector gesture={rulerTapGesture}>
            <View style={[styles.rulerContent, { width: gridWidth, transform: [{ translateX: -scrollX }] }]}>
              <BarRuler
                map={map}
                durationMs={totalMs}
                pxPerSecond={pxPerSecond}
                theme={theme}
                snapSubdivision={snapSubdivision}
                visibleStartMs={visibleStartMs}
                visibleEndMs={visibleEndMs}
              />

              {loopRegion && !viewOnly && (
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
              {firstPinMs !== null && !viewOnly && (
                <View pointerEvents="none" style={[styles.pinLine, { left: (firstPinMs / 1000) * pxPerSecond }]} />
              )}
              {/* Live ghost pin while actively dragging one out of the dock. */}
              {!viewOnly && <Animated.View pointerEvents="none" style={[styles.pinLine, pinDockAnimatedStyle]} />}

              {showPlayhead && (
                <View pointerEvents="none" style={[styles.playheadWrap, { left: playheadLeft - 4 }]}>
                  <View style={styles.playheadRulerLine} />
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
                  // Pitch alone is not unique: equivalent harp positions (3 blow / -2
                  // draw) intentionally occupy separate rows. Their pitch+tab identity is.
                  key={`${p.midi}:${p.tab}`}
                  row={p}
                  top={index * rowH}
                  height={rowH}
                  swatchColor={noteColor}
                  isOctaveBoundary={next ? getOctave(p.note) !== getOctave(next.note) : false}
                  styles={styles}
                />
              );
            })}
          </View>

          <ScrollView
            ref={hScrollRef}
            horizontal
            // The native indicator would render at the bottom of the full row ladder,
            // off-screen — replaced by the pinned scrollbar below the grid.
            showsHorizontalScrollIndicator={false}
            onScroll={handleGridScroll}
            scrollEventThrottle={16}
          >
            <GestureDetector gesture={backgroundGesture}>
              {/* onMouseMove survives a view-only roll — it feeds the zoom anchor, and
                  cursor-anchored zoom is one of the things that stays. The context menu
                  doesn't: its only action is deleting the note under the pointer. */}
              <View
                style={[styles.grid, { width: gridWidth, height: gridHeight }]}
                {...(Platform.OS === 'web'
                  ? ({
                      ...(viewOnly ? null : { onContextMenu: handleGridContextMenu }),
                      ...(!viewOnly ? { onMouseDown: handleGridMouseDown } : null),
                      onMouseMove: handleGridMouseMove,
                    } as object)
                  : null)}
              >
                {visibleRows.map(({ row: p, index }) => {
                  const next = positions[index + 1];
                  const isOctaveBoundary = next ? getOctave(p.note) !== getOctave(next.note) : false;
                  return (
                    <View
                      key={`${p.midi}:${p.tab}`}
                      pointerEvents="none"
                      style={[
                        styles.rowStripe,
                        { top: index * rowH, width: gridWidth, height: rowH },
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
                  visibleStartMs={visibleStartMs}
                  visibleEndMs={visibleEndMs}
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
                      // Inset proportionally rather than by a fixed 6px, so a background
                      // note stays a readable bar at any row height instead of thinning
                      // to a hairline as the rows shorten.
                      top:    block.top + backgroundInset,
                      width:  block.width,
                      height: Math.max(3, rowH - backgroundInset * 2),
                      borderRadius: 2,
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
                  const rowIndex = findNoteRowIndex(positions, note);
                  if (rowIndex === -1) return null;
                  return (
                    <PianoRollNoteBlock
                      key={note.id}
                      note={note}
                      rowIndex={rowIndex}
                      positions={positions}
                      map={map}
                      pxPerSecond={pxPerSecond}
                      rowHeight={rowH}
                      noteColor={noteColor}
                      snapDivision={snapDivision}
                      interactive={mouseMode === 'pencil' && !viewOnly}
                      isSelected={mouseMode === 'pencil' ? selectedId === note.id : selectedIds.includes(note.id)}
                      onSelect={selectSingleNote}
                      onUpdate={onUpdate}
                      styles={styles}
                    />
                  );
                })}

                {showPlayhead && (
                  <View pointerEvents="none" style={[styles.playheadLine, { left: playheadLeft - 1, height: gridHeight }]} />
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
                    rowHeight={rowH}
                    noteColor={noteColor}
                    snapDivision={snapDivision}
                    applyMany={applyMany}
                    styles={styles}
                  />
                )}

                {/* Onboarding nudge for a fresh key with nothing drawn yet. Only makes
                    sense in pencil mode (nothing to click-to-create in selection mode),
                    and gridWidth collapses to ~viewportWidth when there are no notes (see
                    its own computation above), so centering within the grid here also
                    centers within the visible viewport — no scroll-position math needed. */}
                {notes.length === 0 && mouseMode === 'pencil' && !viewOnly && (
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

      {/* Horizontal scrollbar — pinned here, outside the vertical ScrollView, so it stays
          on screen at any scroll position (see H_SCROLLBAR_H). The left segment matches
          the label rail's width and treatment so the frozen column reads as continuing
          all the way down. */}
      <View style={styles.hScrollbarRow}>
        <View style={styles.hScrollbarRail} />
        <GestureDetector gesture={hTrackGesture}>
          <View style={styles.hScrollbarTrack}>
            <GestureDetector gesture={hThumbGesture}>
              <View style={[styles.hScrollbarThumb, { left: hThumbX, width: hThumbW }]} />
            </GestureDetector>
          </View>
        </GestureDetector>
      </View>

      {/* Data panel — Velocity / Duration / Confidence / Pitch Bend, x-synced with the grid
          above. Collapsible so it doesn't permanently eat vertical space when the user just
          wants the note grid. The velocity filter is no longer a fifth tab here; it's the
          draggable line inside the Velocity chart. */}
      <Animated.View style={[styles.dataPanel, panelAnimatedStyle]}>
        <View style={styles.dataPanelTabs}>
          {/* Active tab gets a tinted pill, not just accent-colored text — as color-only
              labels in a bare row these read as breadcrumbs rather than tabs. */}
          {(['velocity', 'duration', 'confidence', 'pitchBend'] as const).map((tab) => (
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

          {/* At rest the filter is a grey hairline lying on the chart's floor with a grey knob
              at one end — which reads as the chart's bottom border, not as a control, so the
              feature is invisible until someone drags something they had no reason to think
              was draggable. This names it. It takes Reset's slot rather than a row of its own:
              the two are mutually exclusive states of the same control (hint while idle, Reset
              once it's biting), so the strip never changes height or reflows between them —
              which a second row would have, the panel's expanded height being a constant.
              Shrinkable and clipped to one line, so a narrow viewport eats the hint rather than
              pushing the collapse chevron off the edge. Not shown while collapsed: there's no
              line on screen to drag. */}
          {activeFilter && activeFilter.value === 0 && metricHasData && !panelCollapsed && (
            <View style={styles.floorLineHint} pointerEvents="none">
              <Ionicons name="swap-vertical" size={10} color={theme.textMuted} />
              <Text style={styles.floorLineHintText} numberOfLines={1}>
                {FLOOR_HINTS[metricTab as 'velocity' | 'duration']}
              </Text>
            </View>
          )}

          {/* Reset lives up here rather than beside the line, because down in the chart it
              would have to share the right edge with the line's own readout and collide with
              it at every low threshold — exactly where a user who overshot needs it. Only
              shown once the filter is doing something: a permanent Reset next to an idle
              control is one more thing to read past for a state that's already the default. */}
          {activeFilter && activeFilter.value > 0 && (
            <Pressable
              onPress={() => activeFilter.onChange(0)}
              hitSlop={8}
              style={({ pressed, hovered }: any) => [
                styles.floorLineReset,
                (pressed || hovered) && styles.floorLineResetHovered,
              ]}
              accessibilityRole="button"
              // Names its own metric: with two lines live, an unqualified "Reset filter" in a
              // strip that looks the same on both tabs gives no way to tell which one it
              // clears — and the wrong guess silently undoes the other's work.
              accessibilityLabel={`Reset ${METRIC_LABELS[metricTab].toLowerCase()} filter, showing all ${activeFilter.totalCount} notes again`}
            >
              <Ionicons name="close" size={10} color={theme.textSub} />
              <Text style={styles.floorLineResetText}>Reset filter</Text>
            </Pressable>
          )}

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
                  notes={chartNotes}
                  // Both floors on every chart, so the greyed set matches the roll — see the
                  // prop's own note.
                  velocityFloor={velocityFilter?.value ?? 0}
                  durationFloorMs={durationFilter?.value ?? 0}
                  durationMax={durationMax}
                  frames={frames}
                  positions={positions}
                  pxPerSecond={pxPerSecond}
                  theme={theme}
                  styles={styles}
                  // Omitted on a read-only roll, which turns the bars back into plain marks.
                  onVelocityChange={viewOnly ? undefined : handleVelocityChange}
                />
              </View>
            ) : (
              <View style={styles.dataEmpty}>
                <Ionicons name="pulse-outline" size={18} color={theme.textMuted} />
                <Text style={styles.dataEmptyText}>
                  {notes.length === 0
                    ? 'Nothing to analyze yet — draw or record some notes.'
                    : `${METRIC_LABELS[metricTab]} is measured from the audio signal, which this chart doesn't have — it was imported from MIDI, transcribed by the neural engine, or drawn by hand.`}
                </Text>
              </View>
            )}

            {/* Outside `dataBarContent` on purpose: that layer is translated by -scrollX to
                stay in step with the grid, and a threshold is a property of the y axis alone.
                Riding the scroll would slide the line and its readout off the side of a
                chart whose bars it is supposed to be measuring. */}
            {metricTab === 'velocity' && metricHasData && velocityFilter && (
              <FloorLine
                value={velocityFilter.value}
                onChange={velocityFilter.onChange}
                max={127}
                step={1}
                coarseStep={10}
                format={(v) => String(v)}
                label="Velocity filter"
                caption={velocityFilter.source && VELOCITY_SOURCE_LABELS[velocityFilter.source]}
                audibleCount={velocityFilter.audibleCount}
                totalCount={velocityFilter.totalCount}
                styles={styles}
              />
            )}

            {/* The same control, scaled to the data rather than to a fixed 0–127. `durationMax`
                is the unfiltered ceiling the bars are drawn against — the two have to be the
                same number or the line would sit somewhere other than where it cuts. */}
            {metricTab === 'duration' && metricHasData && durationFilter && (
              <FloorLine
                value={durationFilter.value}
                onChange={durationFilter.onChange}
                max={durationMax}
                step={DURATION_FLOOR_STEP_MS}
                coarseStep={DURATION_FLOOR_STEP_MS * 10}
                format={formatDurationLabel}
                label="Duration filter"
                audibleCount={durationFilter.audibleCount}
                totalCount={durationFilter.totalCount}
                styles={styles}
              />
            )}
          </View>
        </View>
      </Animated.View>

      {toastMessage !== null && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText} numberOfLines={2}>{toastMessage}</Text>
        </View>
      )}

      {/* Documents the tools, shortcuts and gestures — none of which exist on a view-only
          roll, and there's no button left to open it with either. */}
      {!viewOnly && (
        <HelpModal visible={helpOpen} onClose={() => setHelpOpen(false)} noteColor={noteColor} theme={theme} styles={styles} />
      )}
    </View>
  );
}

/** Per-metric wording for the tab-strip hint. Only the two metrics that carry a line have
 *  one; the strip's condition keys off the filter's presence, so the others never index in. */
const FLOOR_HINTS: Record<'velocity' | 'duration', string> = {
  velocity: 'Drag the line at the bottom up to hide quiet notes',
  duration: 'Drag the line at the bottom up to hide short notes',
};

const METRIC_LABELS: Record<DataMetric, string> = {
  velocity:   'Velocity',
  duration:   'Duration',
  confidence: 'Confidence',
  pitchBend:  'Pitch Bend',
};

// ─── Help modal ────────────────────────────────────────────────────────────────
// A real centered Modal (not the small anchored popover this replaced) — there's enough
// content now (every toolbar control and the transport bar beneath the panel, not just
// colors/shortcuts) that a glanceable corner card stopped being the right shape for it.
// Titled "Editor Help" rather than "Piano Roll Help" for the same reason: it outgrew the
// roll once it started documenting the bar below it. Same Modal + backdrop-press-to-close shape
// as ActionSheetModal elsewhere in the app, just with a scrollable content area instead
// of a list of option rows.
interface ToolHelpEntry {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
}

/**
 * The entries, for a roll that colours its notes by harmonica technique (the tab editor) or
 * by track (the Studio).
 *
 * A list rather than a constant because one modal serves both rolls, and some of what it
 * documents only exists on one of them. Harmonica-ness is read off `noteColor`, which is
 * exactly the flag the renderer itself uses: the Studio passes a track colour precisely
 * because technique is a harmonica idea and no harp has been chosen at that stage.
 */
function toolHelp(harmonica: boolean): ToolHelpEntry[] {
  return [
  { icon: 'pencil', title: 'Pencil tool [1]',
    desc: 'Click empty grid to create a note. Click an existing note to select it. Drag a note to move it, drag its left/right edge to resize. Right-click a note to delete it.' },
  { icon: 'scan-outline', title: 'Selection tool [2]',
    desc: 'Drag to marquee-select multiple notes. Click a note to select just it. Shift+click toggles one note in/out of the selection; Shift+drag adds a marquee to the existing selection instead of replacing it. Once notes are selected, drag the group to move it together, or its edge handles to stretch it. Right-click inside the selection deletes all of it.' },
  { icon: 'scan-outline', title: 'Select all',
    desc: 'Selects every visible note in this roll — only the active track in Studio, and never notes hidden by the velocity or duration filters. Once all are selected, the same button clears the selection.' },
  { icon: 'magnet-outline', title: 'Snap',
    desc: 'On/off — whether placing, moving, or dragging a note quantizes to the grid at all, or lands wherever you drop it.' },
  { icon: 'grid-outline', title: 'Grid (1/4, 1/8, 1/16)',
    desc: 'The grid’s resolution. Always visible regardless of Snap above, and what Snap quantizes to when it’s on. Hover + scroll to step through it quickly.' },
  { icon: 'return-down-forward-outline', title: 'Quantize',
    desc: 'Snaps the selected notes (or every note, if none are selected) to the current grid resolution right now — independent of whether Snap itself is on.' },
  { icon: 'remove', title: 'Zoom (− / % / +)',
    desc: 'Zooms the timeline in/out, holding whatever is under the mouse still. Alt/Ctrl/Cmd + scroll (or a trackpad pinch) zooms straight from the grid. Click the percentage to reset to 100%.' },
  { icon: 'flag-outline', title: 'Loop-region pin',
    desc: 'The blue tab left of the ruler. Drag it out onto the timeline and release to drop a marker, then drag it again for the second one — the span between them (regardless of which you placed first) becomes the loop region, played back on repeat. Once placed, drag either edge of the blue band to adjust it, or its × to clear it. Esc cancels a pin mid-drag.' },
  { icon: 'chevron-up', title: 'Semitone / Octave shift',
    desc: harmonica
      // The greyed-row half of this is harmonica-only: the Studio's ladder is all 128
      // semitones and every row of it is a real pitch, so nothing there can be skipped.
      ? 'Moves the selected note(s) up/down the chromatic grid — the small chevrons shift a semitone, the circled arrows a full octave. Rows greyed out and labeled with just a pitch name aren’t real positions on the current harmonica; a semitone shift that would land there simply skips that note (a message says how many), while the octave buttons disable themselves instead if any selected note is already at the very edge.'
      : 'Moves the selected note(s) up/down the chromatic grid — the small chevrons shift a semitone, the circled arrows a full octave. Every row here is a real pitch, so nothing gets skipped; the octave buttons disable themselves if any selected note is already at the edge of the grid.' },
  // The tab editor's sidebar. There is no key or harmonica type in the Studio — no harp has
  // been chosen at that stage — so this would document a control that isn't on screen.
  ...(harmonica ? [{ icon: 'musical-notes-outline' as const, title: 'Key & Type (sidebar)',
    desc: 'Transpose vs Translate decides what a key change keeps. Transpose keeps the tabs and moves the music: the same holes on a new harp, so it can never make a note unplayable. Translate keeps the music and rewrites the tabs: the same pitches played on a different harp — the one to use when you own a C harp and the song wants a G. Translate can strand notes that sit outside the new harp’s range, so it warns first with a count. Switching Diatonic/Chromatic always keeps the pitches too, and warns the same way.' }] : []),
  ];
}

/**
 * The bar pinned along the bottom of both editors.
 *
 * Documented from inside the roll even though the roll does not render it: `edit.tsx` and
 * `studio.tsx` each mount `WebTransportBar` directly beneath this panel, and the `?` here is
 * the only help button on either screen. Lifting the modal up to both hosts to keep the
 * ownership tidy would move a lot of code to tell the reader nothing new.
 *
 * `harmonica` doubles as the host flag, which is exactly what the two conditional entries
 * need: the Studio is the only caller that passes `startControl` and `history` to the bar,
 * so it is the only one whose bar has a Start field or undo/redo buttons.
 *
 * Ordered as the bar itself reads, left to right, so the list can be followed against the
 * thing it describes rather than searched.
 */
function transportHelp(harmonica: boolean): ToolHelpEntry[] {
  return [
  { icon: 'repeat', title: 'Loop',
    desc: 'Repeats instead of stopping at the end. A loop region marked on the ruler overrides this — marking one already means “loop this”, so playback repeats between the markers whether or not this is on.' },
  { icon: 'remove', title: 'Tempo (− BPM +)',
    desc: harmonica
      ? 'The tab’s tempo in beats per minute — it sets how fast playback runs and where the bar lines fall.'
      : 'The project’s opening tempo in beats per minute. It writes the first entry of the tempo map rather than a single number, so an imported file that changes tempo partway through keeps every later change intact.' },
  // Studio-only: the tab editor's bar is passed no `startControl`, because a tab is one
  // voice that already begins where it begins.
  ...(harmonica ? [] : [{ icon: 'time-outline' as const, title: 'Start',
    desc: 'Where the arrangement’s first note sits. Type a new value and the whole project slides to begin there — every note on every track moves by the same amount, so nothing shifts relative to anything else. Use it to trim dead air off the front of an import, or to open a gap for a count-in. The tempo and meter maps travel with the notes, so bar lines stay glued to the music, and Ctrl/Cmd+Z puts it all back.' }]),
  { icon: 'musical-notes', title: 'Metronome',
    desc: 'A click on every beat while playing. It is a practice aid only — nothing you export contains it.' },
  { icon: 'play', title: 'Play / Pause',
    desc: 'The big circle. Plays from the playhead, or from the start of the loop region when one is set. It shows a … while sampled instruments are still loading; it stays pressable throughout, and playback falls back to simpler voices if the samples are slow.' },
  { icon: 'stop', title: 'Stop',
    desc: 'Stops and returns the playhead to the beginning.' },
  { icon: 'play-skip-forward', title: 'Back / Forward one bar',
    desc: 'Jumps the playhead a full bar either way. Works while stopped, paused, or mid-playback.' },
  // Studio-only: the tab editor keeps undo/redo in its own toolbar and sidebar, so a second
  // pair down here would be redundant rather than helpful.
  ...(harmonica ? [] : [{ icon: 'arrow-undo' as const, title: 'Undo / Redo',
    desc: 'Steps back and forward through edits — the same as Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z. They live in the bar here because the Studio has no toolbar of its own; the tab editor keeps its pair up in the top toolbar instead.' }]),
  { icon: 'speedometer-outline', title: 'Playback speed',
    desc: 'The 1x button. Cycles 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2× — slows a hard passage down without moving its pitch or rewriting the tempo.' },
  { icon: 'time-outline', title: 'Elapsed / total',
    desc: 'Where the playhead is, and how long the whole thing runs.' },
  ];
}

function shortcuts(harmonica: boolean): [string, string][] {
  return [
  ['1 / 2', 'Pencil / Selection tool'],
  ['Click (pencil)', 'Create a note, or select one under the cursor'],
  ['Drag note', 'Move it'],
  ['Drag note edge', 'Resize it'],
  ['Right-click note', 'Delete it (the whole selection, if it is in one)'],
  ['Shift+click / drag', 'Add/toggle notes in the selection'],
  ['← / →', 'Nudge the selected note(s) in time'],
  ['↑ / ↓', 'Shift the selected note(s) a semitone'],
  ['Shift+↑ / Shift+↓', 'Shift the selected note(s) an octave'],
  ['Backspace / Delete', 'Delete the selected note(s)'],
  ['Ctrl/Cmd+A', harmonica ? 'Select all visible notes' : 'Select every visible note in the active track'],
  ['Ctrl/Cmd+C / V / D', 'Copy / paste / duplicate'],
  ['Ctrl/Cmd+Z', 'Undo'],
  ['Shift+Ctrl/Cmd+Z, or Ctrl/Cmd+Y', 'Redo'],
  // Named for what it saves rather than just "Save" — and named once, for the roll you are
  // actually looking at, rather than listing both screens' answers on both screens.
  ['Ctrl/Cmd+S', harmonica ? 'Save this tab to your library' : 'Save the project'],
  ['Drag ruler pin', 'Drop a loop-region marker, then drag another for the other end'],
  // Already described in the loop-region entry opposite; listed here too because the
  // shortcut column is where someone looks for a key, not for a tool.
  ['Esc', 'Cancel a pin mid-drag, or clear one already dropped'],
  ];
}

function HelpModal({ visible, onClose, noteColor, theme, styles }: {
  visible: boolean; onClose: () => void;
  /** The roll's note colour override, or absent on a technique-coloured (harmonica) roll —
   *  see `toolHelp` for why this one prop decides what the modal documents. */
  noteColor?: string;
  theme: Theme; styles: ReturnType<typeof createStyles>;
}) {
  const harmonica = noteColor === undefined;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* No accessibilityRole="button" on the backdrop/card wrappers — matches
          ActionSheetModal's own reasoning: that's what makes react-native-web render a
          real <button>, and nesting one inside another (for rows that do need the role)
          is invalid HTML. These two are just tap targets. */}
      <Pressable style={styles.helpBackdrop} onPress={onClose}>
        <Pressable style={styles.helpModalCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.helpModalHeader}>
            <Text style={styles.helpModalTitle}>Editor Help</Text>
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
                {toolHelp(harmonica).map((entry) => (
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

                {/* The bar along the bottom of the screen, which went undocumented until now
                    — the modal covered every control in this panel and nothing below it. It
                    shares this column rather than the one opposite because it is the same
                    kind of entry (icon, name, prose) and reuses the same row; the right
                    column is the reference side, holding the colour legend and key table. */}
                <View style={styles.helpDivider} />
                <Text style={styles.helpSectionTitle}>Playback bar</Text>
                {transportHelp(harmonica).map((entry) => (
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
                {/* The technique legend is meaningless on a roll that doesn't use it: in the
                    Studio every note is the track's colour, so listing blow/draw/bend swatches
                    described nothing on screen. What that roll does say with colour is which
                    track a note belongs to, so it gets that instead. */}
                {harmonica ? (
                  (Object.keys(TECHNIQUE_COLOR) as NoteTechnique[]).map((tech) => (
                    <View key={tech} style={styles.helpColorRow}>
                      <View style={[styles.helpColorSwatch, { backgroundColor: TECHNIQUE_COLOR[tech] }]} />
                      <Text style={styles.helpRowText}>{TECHNIQUE_LABEL[tech]}</Text>
                    </View>
                  ))
                ) : (
                  <>
                    <View style={styles.helpColorRow}>
                      <View style={[styles.helpColorSwatch, { backgroundColor: noteColor }]} />
                      <Text style={styles.helpRowText}>The track you’re editing.</Text>
                    </View>
                    <View style={styles.helpColorRow}>
                      <View style={[styles.helpColorSwatch, { backgroundColor: noteColor, opacity: 0.32 }]} />
                      <Text style={styles.helpRowText}>
                        Dimmed like this: the other audible tracks, each in its own colour. They’re
                        drawn behind for reference — playback includes them, but they can’t be
                        selected or edited until you switch to that track.
                      </Text>
                    </View>
                  </>
                )}

                <View style={styles.helpDivider} />
                <Text style={styles.helpSectionTitle}>Keyboard shortcuts</Text>
                {shortcuts(harmonica).map(([keys, desc]) => (
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

/**
 * Ruler tick heights, measured up from the ruler's baseline.
 *
 * Three tiers rather than one, matching the three the grid lines below already draw: a
 * ruler where every mark is the same length reads as a comb and tells you nothing about
 * where a beat sits inside a bar. Bar ticks are also the only ones that carry a number.
 */
const BAR_TICK_H         = 10;
const BEAT_TICK_H        = 7;
const SUBDIVISION_TICK_H = 4;
/** Closest two ruler ticks may sit before the tier is dropped. Lower than the grid's own
 *  threshold (MIN_GRID_SPACING_PX) because a 4px tick at the ruler's baseline stays
 *  readable at spacings where a full-height gridline behind the notes would be a wash. */
const MIN_RULER_TICK_SPACING_PX = 5;

function BarRuler({ map, durationMs, pxPerSecond, theme, snapSubdivision, visibleStartMs, visibleEndMs }: {
  map: TempoMap; durationMs: number; pxPerSecond: number; theme: Theme;
  /** Same value the grid lines use, so a ruler tick sits above every gridline rather than
   *  the two disagreeing about where an eighth is. */
  snapSubdivision: Exclude<SnapDivision, 'off'>;
  visibleStartMs: number; visibleEndMs: number;
}) {
  // Bars are asked for rather than computed from a bar length, because with a tempo or
  // meter map there is no single bar length: each bar's width and position depend on
  // what's in force where it sits.
  //
  // Windowed for the same reason the gridlines are: at the low end of the zoom range a
  // long project has thousands of bars, and a ruler that builds all of them is paying for
  // labels nobody can see.
  const from = Math.max(0, visibleStartMs);
  const to   = Math.min(durationMs + 8000, visibleEndMs);
  const all = useMemo(
    () => gridLines(map, from, to, snapSubdivision),
    [map, from, to, snapSubdivision],
  );
  const bars = useMemo(() => all.filter((l) => l.isBar), [all]);

  // Same measured-spacing thinning as BeatGridLines — taken off what actually came back
  // rather than a nominal bar length, so it stays right across a tempo change where the
  // spacing isn't uniform.
  const minSpacing = (list: GridLine[]) => list.reduce(
    (min, line, i) => (i === 0 ? min : Math.min(min, ((line.ms - list[i - 1].ms) / 1000) * pxPerSecond)),
    Infinity,
  );
  const beats = all.filter((l) => l.isBeat);
  const showSubdivisions = minSpacing(all)   >= MIN_RULER_TICK_SPACING_PX;
  const showBeats        = minSpacing(beats) >= MIN_RULER_TICK_SPACING_PX;

  // Label density is driven by the narrowest bar on screen, so a ritardando that stretches
  // later bars can't make early ones collide.
  const minBarPx = minSpacing(bars);

  let labelEvery = 1;
  for (const n of [1, 2, 4, 8, 16, 32]) {
    labelEvery = n;
    if (n * (Number.isFinite(minBarPx) ? minBarPx : 0) >= 50) break;
  }

  return (
    <>
      {showSubdivisions && all.filter((l) => !l.isBeat).map((line) => (
        <View
          key={`sub-${line.ms}`}
          pointerEvents="none"
          style={{
            position: 'absolute', bottom: 0, left: (line.ms / 1000) * pxPerSecond,
            width: 1, height: SUBDIVISION_TICK_H, backgroundColor: theme.separator,
          }}
        />
      ))}
      {showBeats && beats.filter((l) => !l.isBar).map((line) => (
        <View
          key={`beat-${line.ms}`}
          pointerEvents="none"
          style={{
            position: 'absolute', bottom: 0, left: (line.ms / 1000) * pxPerSecond,
            width: 1, height: BEAT_TICK_H, backgroundColor: theme.textMuted,
          }}
        />
      ))}
      {bars.map((line) => {
        // Anchored to the absolute bar number, not the index within the visible slice —
        // otherwise which bars carry a label changes as you scroll, and the ruler appears
        // to shuffle itself.
        const labelled = ((line.bar ?? 1) - 1) % labelEvery === 0;
        return (
          <View
            key={line.bar}
            pointerEvents="none"
            style={{ position: 'absolute', left: (line.ms / 1000) * pxPerSecond, top: 0, bottom: 0 }}
          >
            {labelled && (
              <Text style={{ fontSize: 12, fontFamily: Poppins.bold, color: theme.textSub }}>
                {msToBarInMap(map, line.ms).toFixed(0)}
              </Text>
            )}
            {/* The tall/wide tick is reserved for bars that actually carry a number, so a
                heavy mark always means "this is the bar the number above it names". Once
                the view zooms out far enough that numbers start skipping, the bars in
                between drop to the beat tick's weight rather than staying heavy — leaving
                them heavy is what made the wide ticks look like they'd drifted off the
                numbered bars. */}
            <View style={{
              position: 'absolute', bottom: 0, left: 0,
              width:  labelled ? 1.5 : 1,
              height: labelled ? BAR_TICK_H : BEAT_TICK_H,
              backgroundColor: labelled ? theme.textSub : theme.textMuted,
            }} />
          </View>
        );
      })}
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
/** Closest two gridlines may sit before the tier is dropped. Below this they stop reading
 *  as a grid and become a grey wash — and cost a View each for the privilege. */
const MIN_GRID_SPACING_PX = 7;

function BeatGridLines({
  map, durationMs, pxPerSecond, height, theme, snapSubdivision, visibleStartMs, visibleEndMs,
}: {
  map: TempoMap; durationMs: number; pxPerSecond: number; height: number; theme: Theme;
  snapSubdivision: Exclude<SnapDivision, 'off'>;
  visibleStartMs: number; visibleEndMs: number;
}) {
  // Only the visible window, and only as far as there's content. Generating the whole
  // timeline was survivable at 20px/s and is not at 3px/s: a seven-minute project at 1/16
  // is ~6,700 subdivisions, every one of them a View, none of them on screen.
  const from = Math.max(0, visibleStartMs);
  const to   = Math.min(durationMs + 8000, visibleEndMs);

  // One walk produces all three tiers already classified, so the "is this subdivision also
  // a beat?" test is an index check inside `gridLines` rather than the modulo-on-pixels
  // approximation this used to do (which drifted at fractional pixel spacings).
  const all = useMemo(
    () => gridLines(map, from, to, snapSubdivision),
    [map, from, to, snapSubdivision],
  );

  // Thin the tiers out as the view zooms out, rather than drawing every line at every
  // zoom. Measured off what actually came back, so it stays right across a tempo change
  // where the spacing isn't uniform.
  const spacingPx = (a: GridLine, b: GridLine) => ((b.ms - a.ms) / 1000) * pxPerSecond;
  const minSpacing = (list: GridLine[]) => list.reduce(
    (min, line, i) => (i === 0 ? min : Math.min(min, spacingPx(list[i - 1], line))),
    Infinity,
  );

  const beats = all.filter((l) => l.isBeat);
  const bars  = all.filter((l) => l.isBar);

  const showSubdivisions = minSpacing(all)   >= MIN_GRID_SPACING_PX;
  const showBeats        = minSpacing(beats) >= MIN_GRID_SPACING_PX;

  const subdivisionLines = showSubdivisions
    ? all.filter((l) => !l.isBeat).map((l) => (l.ms / 1000) * pxPerSecond)
    : [];
  // Bars are the last tier standing: zoomed all the way out you still want to know where
  // you are in the piece, and they're the only thing that answers that.
  const lines = (showBeats ? beats : bars)
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

// ─── Floor line ────────────────────────────────────────────────────────────────

/** Plain-language names for where the velocities came from. The internal ids
 *  ("takeRelativeRms") describe the implementation; these describe what's on screen. */
const VELOCITY_SOURCE_LABELS: Record<VelocitySource | 'mixed', string> = {
  midiVelocity:    'from the MIDI file',
  takeRelativeRms: 'recorded loudness, relative to this take',
  modelActivation: 'model confidence',
  mixed:           'mixed sources',
};

/**
 * A filter, drawn as a threshold line across the chart of the quantity it thresholds.
 *
 * One component, two instances: the Velocity chart's line and the Duration chart's. Dragging
 * is the whole control in both cases — the bars are already a picture of the quantity being
 * thresholded, so the line is placed by eye against the data rather than dialled in as a
 * number and verified elsewhere. Bars that fall under it go grey (see `DataPanelBars`), and
 * the notes they stand for leave the roll above.
 *
 * The two differ in exactly one structural way, and it's the reason `max` is a prop rather
 * than a constant. Velocity's axis is fixed 0–127, so a value maps to a height on its own.
 * Duration's axis is the data — its top is the longest note — so the same ms value sits at
 * different heights in different sessions, and the caller has to say which scale is in force.
 * That `max` **must** be measured over the unfiltered set: taken from the filtered notes, a
 * line dragged upward would drop the longest note, shrink the axis, rescale every bar and
 * move the line out from under the pointer mid-drag.
 *
 * The readout rides the line rather than sitting in a corner because it answers the question
 * you have while dragging — "how much am I cutting" — at the place you're looking. The count
 * is phrased as what remains *shown*, never as notes removed: nothing here deletes, and the
 * saved project keeps every note whatever the line does. With two filters live it reports
 * what survives *both*, so it can never claim more is visible than actually is — the cost
 * being that dragging one line moves the other's count.
 *
 * Arrow keys move it too. This is the only control for either filter, so leaving it
 * drag-only would put it out of reach of anyone not using a pointer — the reason it also
 * carries `accessibilityRole="adjustable"` and reports its value.
 */
function FloorLine({
  value, onChange, max, step, coarseStep, format, label, caption,
  audibleCount, totalCount, styles,
}: {
  value:        number;
  onChange:     (v: number) => void;
  /** Top of the axis this line travels, in the value's own units. */
  max:          number;
  /** Drag/arrow-key granularity. Velocity moves in whole units; duration in 10 ms, since a
   *  1 ms step over the chart's height is finer than the pointer can resolve or the eye can
   *  see, and would make the readout flicker through values nobody asked for. */
  step:         number;
  /** Shift-arrow granularity. */
  coarseStep:   number;
  format:       (v: number) => string;
  /** For screen readers, e.g. "Velocity filter". */
  label:        string;
  /** Parked in the chart's top-left corner. Velocity names where its numbers came from,
   *  since the same threshold bites differently per source; duration has no equivalent. */
  caption?:     string;
  audibleCount: number;
  totalCount:   number;
  styles:       ReturnType<typeof createStyles>;
}) {
  const active = value > 0;
  // The value at the moment the drag began. Pan reports translation cumulatively from the
  // start of the gesture, so anchoring to this is what keeps a drag from compounding its own
  // committed changes and running away.
  //
  // Read only on the JS thread, never inside the gesture's worklets: Reanimated captures a
  // closed-over ref *object* by value when the worklet is built, so `.current` read in there
  // would be a snapshot from render time rather than what `beginDrag` just wrote. Only the
  // translation — a plain number — crosses the boundary.
  const dragStartValue = useRef(value);
  const beginDrag = useCallback(() => { dragStartValue.current = value; }, [value]);

  const applyDrag = useCallback((translationY: number) => {
    // Down the screen is less, hence the negated dy: the axis runs `max` at the top to 0 at
    // the bottom, matching the bars it cuts across.
    const raw = dragStartValue.current - (translationY / DATA_BAR_HEIGHT) * max;
    const next = Math.round(raw / step) * step;
    const clamped = Math.max(0, Math.min(max, next));
    // Guarded, because a pointer move that doesn't cross a whole step shouldn't write the
    // store — this fires on every frame of the drag.
    if (clamped !== value) onChange(clamped);
  }, [onChange, value, max, step]);

  const gesture = useMemo(
    () => Gesture.Pan()
      .onStart(() => { runOnJS(beginDrag)(); })
      .onUpdate((e) => { runOnJS(applyDrag)(e.translationY); }),
    [beginDrag, applyDrag],
  );

  const nudge = useCallback((delta: number) => {
    onChange(Math.max(0, Math.min(max, value + delta)));
  }, [onChange, value, max]);

  // `bottom` rather than `top`, so the line is positioned against the same edge the bars
  // grow from — at value 0 it rests exactly on the chart's floor, which is what "off" looks
  // like without needing to be said.
  //
  // Clamped at the top as well as scaled, because `max` can *fall* underneath a stored value:
  // the duration axis is the longest note, and shortening or deleting that note leaves a
  // floor above the new ceiling. Pinning the line to the top edge (rather than letting it
  // fly off) shows the true state — everything greyed — and leaves it somewhere it can be
  // grabbed and dragged back down.
  const lineBottom = Math.min(DATA_BAR_HEIGHT, (value / Math.max(1, max)) * DATA_BAR_HEIGHT);

  // The grab band is clamped to stay wholly inside the chart, while the line's ink keeps its
  // true position *within* the band. Centring the band on the line instead would put half of
  // it outside the clip at the two values that matter most — 0, where the filter is turned
  // off and back on, and 127 — and the chart's `overflow: hidden` would silently eat that
  // half, halving the target exactly where a user reaches for it.
  const bandBottom = Math.max(0, Math.min(DATA_BAR_HEIGHT - FLOOR_LINE_HIT_HEIGHT,
    lineBottom - FLOOR_LINE_HIT_HEIGHT / 2));
  const inkBottom  = lineBottom - bandBottom;

  // The knob is clamped the same way, for the same reason — a handle that is half missing at
  // the ends of its own travel is worse than no handle. At 0 and 127 that leaves it resting
  // against the line rather than centred on it, which still reads as attached (they touch)
  // and keeps the whole target on screen where it can be grabbed.
  const knobBottom = Math.max(0, Math.min(DATA_BAR_HEIGHT - FLOOR_LINE_KNOB,
    lineBottom - FLOOR_LINE_KNOB / 2)) - bandBottom;

  return (
    <>
      {/* Named rather than assumed: the same velocity threshold hides half a tracked take and
          almost nothing from a MIDI file, so without this the line reads as inconsistent
          between projects. Parked at the chart's top edge, clear of the bars and of the
          line's own travel at every value below the axis maximum. */}
      {caption !== undefined && (
        <Text pointerEvents="none" style={styles.floorLineCaption} numberOfLines={1}>
          {caption}
        </Text>
      )}

      <GestureDetector gesture={gesture}>
        <View
          // A generous hit area around a hairline: the line is 2px of ink, which is far too
          // small to grab reliably, so the touch target is the surrounding band.
          style={[styles.floorLineHit, { bottom: bandBottom }]}
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min: 0, max, now: value, text: format(value) }}
          // "shown", not "hidden by this line": with two filters live the count is what
          // survives both, so attributing it to this one line would be a lie whenever the
          // other is also up.
          accessibilityHint={`${audibleCount} of ${totalCount} notes shown. Arrow keys adjust; notes below the line are hidden.`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') nudge(1);
            if (e.nativeEvent.actionName === 'decrement') nudge(-1);
          }}
          focusable
          {...(Platform.OS === 'web' ? {
            onKeyDown: (e: any) => {
              // Shift for a coarse pass, plain for fine — the same two-speed convention the
              // roll's own arrow-key note nudge uses.
              const delta = e.shiftKey ? coarseStep : step;
              if (e.key === 'ArrowUp')   { e.preventDefault(); nudge(delta); }
              if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-delta); }
              if (e.key === 'Home')      { e.preventDefault(); onChange(0); }
            },
          } : null)}
        >
          {/* The ink, placed at the threshold's true height within the band. */}
          <View style={[styles.floorLineInk, active && styles.floorLineInkActive, { bottom: inkBottom }]} />

          {/* The knob. Inside the chart's clip, which is a flex sibling of the y-axis rail
              rather than an overlay on it — so it cannot reach the 127/0 labels no matter
              where the line sits. Left-hand end, opposite the readout, so the two never
              collide and each end of the line carries one thing. */}
          <View
            style={[
              styles.floorLineKnob,
              active && styles.floorLineKnobActive,
              { bottom: knobBottom },
            ]}
          />

          {/* Right-aligned so the readout sits over the chart's trailing edge, where bars are
              least likely to be the ones under inspection, and never covers the y-axis rail.
              Above the line rather than centred on it, so the line stays a clean edge against
              the bars and the readout never straddles the boundary it describes — flipped
              below once the line is high enough that it would otherwise leave the chart. */}
          <View
            style={[
              styles.floorLineReadout,
              active && styles.floorLineReadoutActive,
              inkBottom > FLOOR_LINE_HIT_HEIGHT - 10
                ? { top: FLOOR_LINE_HIT_HEIGHT - inkBottom + 3 }
                : { bottom: inkBottom + 3 },
            ]}
          >
            <Text style={[styles.floorLineValue, active && styles.floorLineValueActive]} numberOfLines={1}>
              {active ? format(value) : 'Off'}
            </Text>
            {/* Visible at every position, 0 included — reading "165 / 165" is what says the
                filters are idle rather than broken. */}
            <Text style={styles.floorLineCount} numberOfLines={1}>
              {audibleCount} / {totalCount}
            </Text>
          </View>
        </View>
      </GestureDetector>

    </>
  );
}

// ─── Data panel bars ───────────────────────────────────────────────────────────

/**
 * One bar in the Velocity chart, dragged up/down to set its note's dynamic.
 *
 * The chart used to be the only read-only surface in the editor: every other number on
 * screen — pitch, start, duration — could be dragged, while velocity could only be
 * *thresholded* by the filter line. So a note imported flat, or drawn by hand at the
 * default, was stuck there.
 *
 * Commits once, in `onEnd`, with a shared value carrying the live height in between. That's
 * the same shape as the note blocks' move/resize drags and for the same reason: every
 * `updateNote` pushes a history entry, so writing per frame would bury the user's previous
 * edit under a hundred identical undo steps.
 *
 * `velocitySource` is deliberately not written here. It names the *scale* the 0–127 sits on
 * — take-relative RMS, model activation, a MIDI file's own byte — and dragging moves the
 * value along that scale rather than onto a new one, so the filter goes on thresholding it
 * against its neighbours exactly as before. See `VelocitySource` in `types/index.ts`.
 */
function VelocityBar({
  note, left, width, filtered, theme, styles, onVelocityChange,
}: {
  note:   TabNote;
  left:   number;
  width:  number;
  filtered: boolean;
  theme:  Theme;
  styles: ReturnType<typeof createStyles>;
  onVelocityChange: (id: string, velocity: number) => void;
}) {
  const stated = noteVelocity(note);
  /**
   * Where the drag starts from.
   *
   * A note with no stated dynamic has no bar and no number, but it still gets a grab area
   * anchored at the hand-drawn default — dragging is how a legacy recording's notes, or a
   * MIDI import that left the byte off, acquire a velocity at all. Without this they would
   * be the one thing in the chart that can never be edited.
   */
  const startVelocity = stated ?? DEFAULT_NEW_NOTE_VELOCITY;

  const dragDy = useSharedValue(0);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const dragUpdateCounter = useSharedValue(0);

  const commit = useCallback((translationY: number) => {
    const raw = startVelocity - (translationY / DATA_BAR_HEIGHT) * VELOCITY_MAX;
    const next = Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, Math.round(raw)));
    // Guarded so a stray click — a Pan that recognized but never really moved — doesn't
    // push a history entry that undoes to an identical state.
    if (next !== stated) onVelocityChange(note.id, next);
  }, [onVelocityChange, note.id, stated, startVelocity]);

  const gesture = useMemo(() => Gesture.Pan()
    .onUpdate((e) => {
      dragDy.value = e.translationY;
      dragUpdateCounter.value += 1;
      if (dragUpdateCounter.value % DRAG_LABEL_THROTTLE === 0) {
        // Arithmetic inline rather than through a helper: this body is a worklet, and the
        // readout has to be computed on the UI thread before crossing over.
        const raw = startVelocity - (e.translationY / DATA_BAR_HEIGHT) * VELOCITY_MAX;
        const shown = Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, Math.round(raw)));
        runOnJS(setDragLabel)(String(shown));
      }
    })
    .onEnd((e) => { runOnJS(commit)(e.translationY); })
    .onFinalize(() => { dragDy.value = 0; runOnJS(setDragLabel)(null); }),
  [commit, startVelocity, dragDy, dragUpdateCounter]);

  // Height follows the pointer on the UI thread; the committed value takes over once the
  // store write lands and `note` comes back down with the new number.
  const barStyle = useAnimatedStyle(() => {
    const raw = startVelocity - (dragDy.value / DATA_BAR_HEIGHT) * VELOCITY_MAX;
    const v = Math.max(VELOCITY_MIN, Math.min(VELOCITY_MAX, Math.round(raw)));
    return {
      height: Math.max(2, (v / VELOCITY_MAX) * DATA_BAR_HEIGHT),
      // An unmeasured note draws nothing until it's actually being dragged — a zero-height
      // bar would read as "played silently" instead of "not measured" (the same distinction
      // the non-interactive branch below makes by rendering nothing at all).
      opacity: stated === undefined && dragDy.value === 0 ? 0 : (filtered ? 0.35 : 0.85),
    };
  }, [startVelocity, stated, filtered]);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[
          styles.velocityBarHit,
          { left, width: Math.max(width, VELOCITY_BAR_MIN_HIT_WIDTH) },
        ]}
        accessibilityLabel={
          `${noteBlockLabel(note)} velocity ${stated ?? 'not set'}. Drag up or down to change.`
        }
      >
        <Animated.View
          style={[
            styles.velocityBarFill,
            { width, backgroundColor: filtered ? theme.textMuted : theme.accent },
            barStyle,
          ]}
        />
        {dragLabel !== null && (
          <View pointerEvents="none" style={styles.velocityBarTooltip}>
            <Text style={styles.dragTooltipText} numberOfLines={1}>{dragLabel}</Text>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

function DataPanelBars({
  metric, notes, velocityFloor, durationFloorMs, durationMax, frames, positions, pxPerSecond, theme,
  styles, onVelocityChange,
}: {
  metric: DataMetric;
  notes: TabNote[];
  styles: ReturnType<typeof createStyles>;
  /** Makes the Velocity chart's bars draggable. Absent on a read-only roll (the import
   *  preview, `viewOnly`), where the chart stays a chart. */
  onVelocityChange?: (id: string, velocity: number) => void;
  /**
   * Both threshold lines, on every chart — not just the one this chart carries.
   *
   * A bar is greyed when the note fails *either* filter, so the two charts agree with each
   * other and with the roll about what's hidden. Greying only against a chart's own line
   * would leave the Duration chart drawing a note at full strength that the velocity line
   * had already taken off the roll — the chart would be the only thing on screen claiming
   * that note is in.
   */
  velocityFloor: number;
  durationFloorMs: number;
  /**
   * Top of the Duration chart's y axis, measured by the caller over the *unfiltered* notes.
   *
   * Passed in rather than derived from `notes` here because the line's position has to agree
   * with the bars' scale exactly, and because deriving it from a filtered array makes the
   * axis rescale as the line moves. See `FloorLine`'s note on `max`.
   */
  durationMax: number;
  frames: ReturnType<typeof getFrames>;
  positions: GridRow[];
  pxPerSecond: number;
  theme: Theme;
}) {
  // Per-note metrics: one bar per note, aligned to the note above it.
  //
  // Velocity belongs here and not with the frame metrics below, even though it *can* be
  // derived from frame RMS. Drawing it from frames meant the chart was blank for every
  // source that has no frames — MIDI imports, neural transcriptions, hand-drawn notes —
  // which is most of them, and it meant the chart and the Velocity Filter sitting one tab
  // away were reading two different numbers. Reading `note.velocity` fixes both: the bar
  // heights are exactly what the filter thresholds against.
  if (metric === 'duration' || metric === 'confidence' || metric === 'velocity') {
    const maxVal = metric === 'duration'
      ? durationMax
      : metric === 'confidence' ? 100 : VELOCITY_MAX;
    return (
      <>
        {notes.map((n) => {
          const value = metric === 'duration'
            ? n.duration
            : metric === 'confidence' ? n.confidence : noteVelocity(n);
          const left = (n.start_time / 1000) * pxPerSecond;
          const width = Math.max(2, (n.duration / 1000) * pxPerSecond - 2);
          // Below a line: drawn, but drained of colour and pushed back, so the shape of what's
          // being cut stays readable while no longer competing with what's kept. These are
          // exactly the notes the roll above has hidden — this chart is the only place
          // they're still visible, which is what makes the lines safe to drag hard.
          //
          // Checked against the note's own velocity, not `value`: on the Duration chart
          // `value` is a length, and the gate has nothing to say about it.
          const filtered = !passesVelocityFloor(noteVelocity(n), velocityFloor)
            || !passesDurationFloor(n.duration, durationFloorMs);

          // Velocity's bars are handles, not just marks, whenever the roll is editable —
          // including for a note that has no dynamic yet, which is why this comes before the
          // `value === undefined` bail below. `VelocityBar` draws nothing for those until
          // they're actually grabbed.
          if (metric === 'velocity' && onVelocityChange) {
            return (
              <VelocityBar
                key={n.id}
                note={n}
                left={left}
                width={width}
                filtered={filtered}
                theme={theme}
                styles={styles}
                onVelocityChange={onVelocityChange}
              />
            );
          }

          // A note with no stated dynamic gets no bar rather than a zero-height one, which
          // would read as "played silently" instead of "not measured".
          if (value === undefined) return null;
          const height = Math.max(2, (value / maxVal) * DATA_BAR_HEIGHT);
          return (
            <View
              key={n.id}
              style={{
                position: 'absolute', left, bottom: 0, width,
                height, borderRadius: 2,
                backgroundColor: filtered ? theme.textMuted : theme.accent,
                opacity:         filtered ? 0.35 : 0.85,
              }}
            />
          );
        })}
      </>
    );
  }

  if (frames.length === 0) return null;

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
  rowHeight:    number;
  noteColor?:   string;
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

const PianoRollNoteBlock = React.memo(function PianoRollNoteBlock({
  note, rowIndex, positions, map, pxPerSecond, rowHeight, noteColor, snapDivision, isSelected, interactive, onSelect, onUpdate, styles,
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
    const rowDelta  = Math.round(dyPx / rowHeight);
    const newRow    = Math.min(positions.length - 1, Math.max(0, rowIndex + rowDelta));
    const newPos    = positions[newRow];

    const changes: NoteUpdate = {};
    if (newStart !== note.start_time) changes.start_time = newStart;
    // Compare both fields: equivalent positions can share a pitch while occupying
    // distinct rows (3 blow / -2 draw).
    if (newPos.note !== note.note || newPos.tab !== note.tab) {
      changes.tab = newPos.tab;
      changes.note = newPos.note;
    }
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
  const top    = rowIndex * rowHeight;
  const width  = noteWidthPx(note.duration, pxPerSecond);
  const height = rowHeight;
  // Technique still drives the color, but as an edge accent + text on a quiet tinted
  // body rather than a solid slab — see techniqueSkin. Selection gets its own signal via
  // the noteBlockSelected ring, not by overriding the skin.
  //
  // Confidence no longer drives opacity. It used to (0.4 + confidence*0.6), which meant
  // that since confidence is matchCount/totalCount and realistically lands at 60–85%,
  // EVERY block rendered permanently translucent and the whole grid read as washed out.
  // Genuinely low-confidence notes get a dashed edge below instead — a signal that
  // applies only when it's actually informative.
  const skin = techniqueSkin(note.tab, theme.isDark, noteColor);
  const labelInset = labelInsetFor(width);
  const lowConfidence = note.confidence < LOW_CONFIDENCE_THRESHOLD;
  // The two edge handles can't be allowed to cover the whole block, or there's no middle
  // left to grab and the note can only ever be resized, never moved. At a fixed 10px each
  // that was already true of anything under 20px wide — which, now that blocks shrink
  // honestly with zoom, is most of them at low zoom rather than none of them.
  const handleW = Math.min(RESIZE_HANDLE_W, Math.max(1, width / 3));

  // Horizontal (time) follows the finger continuously; vertical (pitch) snaps to whole
  // rows during the drag itself (computed on the UI thread, inside the worklet) rather
  // than sliding smoothly between them. Computed unconditionally (even in the
  // non-interactive branch below) since hooks can't be called conditionally — harmless,
  // the values just go unused when `interactive` is false.
  const moveAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: Math.round(translateY.value / rowHeight) * rowHeight },
    ],
  }));
  // Combined into one style (rather than two competing `width`/`left` styles) since a
  // later style in the array fully overrides an earlier one's same-named keys in RN —
  // only one of the two deltas is ever nonzero at a time (one handle dragged at once),
  // but both need to feed the same left/width computation to compose correctly.
  const boxAnimatedStyle = useAnimatedStyle(() => ({
    left: left + resizeLeftDelta.value,
    width: Math.max(MIN_NOTE_WIDTH_PX, width - resizeLeftDelta.value + resizeDelta.value),
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
        <View style={[styles.noteBlockBody, { paddingLeft: labelInset, paddingRight: labelInset }]}>
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
        <View style={[styles.noteBlockBody, { paddingLeft: labelInset, paddingRight: labelInset }]}>
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
          <View style={[styles.resizeHandleLeft, { width: handleW }]} />
        </GestureDetector>
        <GestureDetector gesture={resizeRightGesture}>
          <View style={[styles.resizeHandle, { width: handleW }]} />
        </GestureDetector>
      </Animated.View>
    </GestureDetector>
  );
});

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
  bounds, selectedNotes, positions, map, pxPerSecond, rowHeight, noteColor, snapDivision, applyMany, styles,
}: {
  bounds: { left: number; top: number; width: number; height: number };
  selectedNotes: TabNote[];
  positions: GridRow[];
  map: TempoMap;
  pxPerSecond: number;
  rowHeight: number;
  noteColor?: string;
  snapDivision: SnapDivision;
  /** Routed from the parent rather than reaching into a store here — see the
   *  `onUpdateMany` prop on PianoRoll for why the direct store call was a latent bug. */
  applyMany: (updates: { id: string; changes: NoteUpdate }[]) => void;
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
    const rowDelta = Math.round(dyPx / rowHeight);
    const updates: { id: string; changes: NoteUpdate }[] = [];
    for (const note of selectedNotes) {
      const rowIndex = findNoteRowIndex(positions, note);
      if (rowIndex === -1) continue;
      const rawStart = Math.max(0, Math.round(note.start_time + dtMs));
      const newStart = snapMsToGridInMap(map, rawStart, snapDivision);
      const newRow = Math.min(positions.length - 1, Math.max(0, rowIndex + rowDelta));
      const newPos = positions[newRow];
      const changes: NoteUpdate = {};
      if (newStart !== note.start_time) changes.start_time = newStart;
      if (newPos.note !== note.note || newPos.tab !== note.tab) {
        changes.tab = newPos.tab;
        changes.note = newPos.note;
      }
      if (Object.keys(changes).length > 0) updates.push({ id: note.id, changes });
    }
    applyMany(updates);
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
      const width = noteWidthPx(note.duration, pxPerSecond);
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
    applyMany(updates);
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
      { translateY: Math.round(translateY.value / rowHeight) * rowHeight },
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
        const rowIndex = findNoteRowIndex(positions, note);
        if (rowIndex === -1) return null;
        const left  = (note.start_time / 1000) * pxPerSecond;
        const width = noteWidthPx(note.duration, pxPerSecond);
        const t0 = (left - bounds.left) / bounds.width;
        const t1 = (left + width - bounds.left) / bounds.width;
        return (
          <GroupGhostNote
            key={note.id}
            note={note}
            rowIndex={rowIndex}
            rowHeight={rowHeight}
            noteColor={noteColor}
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
function GroupGhostNote({ note, rowIndex, rowHeight, noteColor, t0, t1, bounds, resizeLeftDelta, resizeRightDelta, styles }: {
  note: TabNote;
  rowIndex: number;
  rowHeight: number;
  noteColor?: string;
  t0: number;
  t1: number;
  bounds: { left: number; width: number };
  resizeLeftDelta: SharedValue<number>;
  resizeRightDelta: SharedValue<number>;
  styles: ReturnType<typeof createStyles>;
}) {
  const theme = useTheme();
  const skin  = techniqueSkin(note.tab, theme.isDark, noteColor);
  const ghostInset = labelInsetFor((t1 - t0) * bounds.width);
  const animatedStyle = useAnimatedStyle(() => {
    const newGroupLeft  = bounds.left + resizeLeftDelta.value;
    const newGroupWidth = Math.max(1, bounds.width - resizeLeftDelta.value + resizeRightDelta.value);
    return {
      left:  newGroupLeft + t0 * newGroupWidth,
      width: Math.max(MIN_NOTE_WIDTH_PX, (t1 - t0) * newGroupWidth),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.noteBlock,
        {
          top: rowIndex * rowHeight,
          height: rowHeight,
          backgroundColor: skin.fill,
          borderColor: skin.edge,
        },
        styles.noteBlockSelected,
        animatedStyle,
      ]}
    >
      {/* Inset matched to the ghost's own live width so a group drag doesn't make labels
          pop in and out relative to the blocks they're copying. */}
      <View style={[styles.noteBlockBody, { paddingLeft: ghostInset, paddingRight: ghostInset }]}>
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
      // No gap and no padding: the ruler, the grid and the data panel are one continuous
      // surface, so every band has to butt directly against its neighbour. The 8px gap +
      // 10px padding this used to carry put a hairline of panel background between the
      // ruler and the rows it measures (and around all four edges), which read as a
      // rendering seam rather than as breathing room. Each band that genuinely needs
      // inset — the tool row, the data panel's tabs — now carries its own padding, and
      // the bands are separated by real borders instead of empty space.
      gap:             0,
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
      padding:         0,
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
    // Carries its own inset now that `outer` has none — the controls are the one band that
    // would otherwise sit flush against the panel border, and the bottom hairline is what
    // separates it from the ruler in place of the gap that used to.
    toolbarRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: t.separator,
      zIndex: 20,
    },
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
    selectAllBtn: {
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
    selectAllBtnActive: { backgroundColor: t.accent, borderColor: t.accent },
    selectAllBtnText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    selectAllBtnTextActive: { color: '#fff' },
    selectionCountText: {
      maxWidth:   84,
      fontSize:   FONT.xs,
      fontFamily: Poppins.semiBold,
      color:      t.textMuted,
    },
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

    helpBtn: {
      paddingHorizontal: 8,
      backgroundColor: 'rgba(124, 58, 237, 0.6)',
      borderColor: 'rgba(124,58,237,1.0)',
    },

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
      // 100% of rulerClip's *content* box, not RULER_HEIGHT — the clip's own bottom border
      // eats a pixel of it, so a fixed RULER_HEIGHT here overflowed by 1px and the bottom
      // of everything anchored to this box (the tick baseline, the playhead marker) was
      // clipped just short of the border it's supposed to meet.
      height: '100%',
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
      // Both this and `rowStripe` get their real height inline from `rowH` — the value
      // here is only the fallback for a host that doesn't override it.
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

    // Pinned horizontal scrollbar. Fixed height and always rendered, so nothing below it
    // moves as the chart's width changes — the reason it isn't hidden when the content
    // already fits.
    hScrollbarRow: {
      flexDirection: 'row',
      height: H_SCROLLBAR_H,
      borderTopWidth: 1,
      borderTopColor: t.separator,
    },
    // Continues the label rail's frozen-column treatment past the bottom of the grid, so
    // the rail's right edge runs unbroken from the ruler to the data panel.
    hScrollbarRail: {
      width: LABEL_WIDTH,
      backgroundColor: t.surface,
      borderRightWidth: 2,
      borderRightColor: t.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
    },
    hScrollbarTrack: {
      flex: 1,
      backgroundColor: t.surface,
      // The thumb's geometry is computed from `viewportWidth`, which is measured off the
      // panel rather than off this track and so can differ from it by the panel's own
      // border. Clipping keeps that couple of pixels from ever showing as overhang.
      overflow: 'hidden',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    hScrollbarThumb: {
      position: 'absolute',
      top: 2,
      bottom: 2,
      borderRadius: 4,
      backgroundColor: t.textMuted,
      ...(Platform.OS === 'web' ? { cursor: 'grab' } : null),
    } as any,

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
    //
    // Background only. This used to also carry `opacity: 0.6`, which dimmed the row's own
    // bottom border along with its fill — taking the separator hairline from rgba(...,0.09)
    // down to an effective 0.054 and, where two unplayable rows sat next to each other,
    // erasing the line between them almost entirely. The rows were always exactly `rowH`
    // tall, but a pair with no visible divider reads as one cell of double height, which
    // is why the ladder looked unevenly spaced on the tab editor specifically: it's the
    // only stage that has unplayable rows at all (the Studio's chromatic ladder is
    // entirely playable, so it never showed the effect).
    rowUnplayable: {
      backgroundColor: t.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
    },
    // The "quieter" signal the opacity used to give, done with colour instead so it can't
    // touch a border. Only the pitch name is ever visible on an unplayable row (its tab
    // columns are all empty strings, and the swatch is replaced by a muted dash), so this
    // one label is the whole of what there was to dim.
    labelNoteUnplayable: { color: t.textMuted },
    // Heavier divider where the octave number actually changes (e.g. B4 -> C5) —
    // a structural landmark, distinct from the plain per-row separator line.
    octaveBoundary: {
      borderBottomWidth: 1.5,
      borderBottomColor: t.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.13)',
    },

    // Wrapper carries horizontal position; the line is centered inside it via regular flex
    // flow rather than its own separate left math.
    // top+bottom rather than a height: the ruler marker has to reach the ruler's bottom
    // edge so it meets the grid playhead directly below it and the two read as one line.
    // It used to be `RULER_HEIGHT - 10` tall from the top, leaving a 10px gap above the
    // ruler's lower border that made the marker look like it stopped short.
    playheadWrap: { position: 'absolute', top: 0, bottom: 0, width: 8, alignItems: 'center' },
    playheadRulerLine: { width: 2, flex: 1, backgroundColor: t.record },
    // Long vertical line spanning the note grid — a separate, absolutely-positioned usage
    // from the short in-ruler line above (that one lives inside a centering flex wrapper).
    playheadLine: {
      position: 'absolute',
      top: 0,
      width: 2,
      backgroundColor: t.record,
    },
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
    // Padding is set inline per block from `labelInsetFor` — the value here is only the
    // fallback. `overflow: hidden` is deliberate: a narrow block clips its label at the
    // edges rather than spilling it across neighbouring notes.
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
    // Full-height grab area for one velocity bar. Spans the chart top to bottom rather than
    // hugging the bar, so a note at velocity 5 — a 5px sliver — is as easy to grab as one at
    // 120, and so a bar can be dragged *up* from nothing.
    velocityBarHit: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      justifyContent: 'flex-end',
      ...(Platform.OS === 'web' ? { cursor: 'ns-resize' } : null),
    } as any,
    // The visible ink, bottom-aligned inside the grab area. Width is the note's real width;
    // the parent may be wider (see VELOCITY_BAR_MIN_HIT_WIDTH), which must not show.
    velocityBarFill: { borderRadius: 2 },
    // Pinned to the top of the grab area rather than to the bar's moving edge: a readout
    // that rides the drag is a readout the pointer sits on top of.
    velocityBarTooltip: {
      position: 'absolute',
      top: 0,
      left: 0,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 5,
      backgroundColor: t.textPrimary,
      zIndex: 10,
    },
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
    // 10px matches the tool row's own inset, so the panel's tabs line up with the controls
    // at the top of the panel rather than sitting closer to the border than they do.
    dataPanelTabs: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: DATA_PANEL_TABS_HEIGHT - 6 },
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
    // `marginLeft: 'auto'` keeps the chevron pinned to the right edge regardless of how
    // many metric tabs are rendered, rather than trailing right after the last one.
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

    // ── Velocity floor line ──────────────────────────────────────────────────
    // The draggable band. Transparent and full-width: the ink is the child line, while this
    // is only the target, and it spans the chart so the line can be grabbed anywhere along
    // it rather than only at a handle the user has to go and find.
    floorLineHit: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: FLOOR_LINE_HIT_HEIGHT,
      ...(Platform.OS === 'web' ? { cursor: 'ns-resize', outlineStyle: 'none' } : null),
    } as any,
    // Dashed would read as a boundary that isn't quite real; solid states that it is one.
    floorLineInk: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 2,
      borderRadius: 1,
      backgroundColor: t.textMuted,
    },
    floorLineInkActive: { backgroundColor: t.accent },
    // Ringed in the panel's own background rather than left as a bare dot: the knob sits over
    // the bars, and without a ring a grey knob on a grey bar has no edge at all.
    floorLineKnob: {
      position: 'absolute',
      left: 3,
      width:  FLOOR_LINE_KNOB,
      height: FLOOR_LINE_KNOB,
      borderRadius: FLOOR_LINE_KNOB / 2,
      backgroundColor: t.textMuted,
      borderWidth: 2,
      borderColor: t.bg,
      ...(Platform.OS === 'web' ? { cursor: 'ns-resize' } : null),
    } as any,
    floorLineKnobActive: { backgroundColor: t.accent },
    floorLineReadout: {
      position: 'absolute',
      right: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
    },
    floorLineReadoutActive: { borderColor: t.accentDim },
    floorLineValue: {
      fontFamily: SpaceGrotesk.bold,
      fontSize: 10,
      color: t.textSub,
    },
    floorLineValueActive: { color: t.accent },
    floorLineCount: {
      fontFamily: SpaceGrotesk.regular,
      fontSize: 10,
      color: t.textMuted,
    },
    // Top-left of the chart, the one corner the line can never reach (it stops at 127, where
    // the readout is right-aligned) and where no bar is ever tall enough to collide.
    floorLineCaption: {
      position: 'absolute',
      top: 2,
      left: 6,
      fontFamily: Poppins.regular,
      fontSize: 9,
      color: t.textMuted,
      opacity: 0.8,
    },
    // Deliberately unlike the Reset chip it shares a slot with: no border, no background, no
    // pointer cursor. Same position, but it has to read as a caption rather than as a button
    // the user is being asked to press.
    floorLineHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      flexShrink: 1,
      marginLeft: 2,
    },
    floorLineHintText: {
      fontFamily: Poppins.regular,
      fontSize: 9,
      color: t.textMuted,
      flexShrink: 1,
    },
    // In the tab strip, immediately after the metric tabs — laid out in flow, so it doesn't
    // disturb the chevron's `marginLeft: 'auto'` pin at the right edge.
    floorLineReset: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    floorLineResetHovered: { borderColor: t.accentDim },
    floorLineResetText: {
      fontFamily: Poppins.medium,
      fontSize: 9,
      color: t.textSub,
    },
  });
}
