import React, { useCallback } from 'react';
import { LayoutChangeEvent, Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, runOnJS } from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';

const THUMB = 22;

interface SliderInputProps {
  value:        number;
  min:          number;
  max:          number;
  step?:        number;
  onChange:     (v: number) => void;
  formatLabel?: (v: number) => string;
  /** Alignment of the value label under the track. Defaults to 'right', which lines the
   *  number up with the thumb's resting position in narrow, inline slots. 'center' suits
   *  a slider given a whole row to itself. */
  labelAlign?:  'right' | 'center';
  /**
   * Whether to draw the value under the track.
   *
   * Off for callers that show it themselves — the tune rail puts it on the parameter's
   * heading row, where it reads as the heading's answer and leaves the space under the
   * track to the end captions alone.
   */
  showValue?:   boolean;
  /**
   * What each end of the track means, drawn either side of the value.
   *
   * For sliders whose name says what the number is but not which way to drag it. Both or
   * neither: one caption alone reads as a label for the whole control rather than for an
   * end of it, so a lone one is ignored.
   */
  minLabel?:    string;
  maxLabel?:    string;
  /**
   * What this slider adjusts, spoken. Required for any new caller — without it a screen
   * reader announces a bare number with no idea what it belongs to. Optional in the type
   * only so the existing mic-sensitivity slider, whose visible heading already sits
   * directly above it, isn't broken by the addition.
   */
  accessibilityLabel?: string;
}

/** Ten steps end to end, or one step if that's already coarse — what Page Up/Down and
 *  Shift+Arrow move by, so crossing a long range doesn't take fifty presses. */
function coarseStepFor(min: number, max: number, step: number): number {
  return Math.max(step, Math.round(((max - min) / 10) / step) * step);
}

function snap(ratio: number, min: number, max: number, step: number): number {
  'worklet';
  const raw     = ratio * (max - min) + min;
  const snapped = Math.round(raw / step) * step;
  return Math.max(min, Math.min(max, snapped));
}

export function SliderInput({
  value, min, max, step = 1, onChange, formatLabel, labelAlign = 'right', accessibilityLabel,
  minLabel, maxLabel, showValue = true,
}: SliderInputProps) {
  const theme      = useTheme();
  const trackWidth = useSharedValue(0);
  const startRatio = useSharedValue(0);
  const thumbRatio = useSharedValue((value - min) / (max - min));
  const dragging   = useSharedValue(false);

  React.useEffect(() => {
    if (!dragging.value) {
      thumbRatio.value = (value - min) / (max - min);
    }
  }, [value, min, max, dragging, thumbRatio]);

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => { trackWidth.value = e.nativeEvent.layout.width; },
    [trackWidth],
  );

  const pan = Gesture.Pan()
    .onBegin((e) => {
      dragging.value   = true;
      const ratio      = Math.max(0, Math.min(1, e.x / trackWidth.value));
      const snapped    = snap(ratio, min, max, step);
      thumbRatio.value = (snapped - min) / (max - min);
      startRatio.value = ratio;
      runOnJS(onChange)(snapped);
    })
    .onUpdate((e) => {
      const ratio      = Math.max(0, Math.min(1, startRatio.value + e.translationX / trackWidth.value));
      const snapped    = snap(ratio, min, max, step);
      thumbRatio.value = (snapped - min) / (max - min);
      runOnJS(onChange)(snapped);
    })
    .onFinalize(() => {
      dragging.value = false;
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbRatio.value * Math.max(0, trackWidth.value - THUMB) }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: thumbRatio.value * trackWidth.value,
  }));

  // Keyboard and assistive-technology adjustment. Until this existed the control was a
  // pure `Gesture.Pan` — reachable only by dragging it with a pointer, which made every
  // screen built out of these entirely unusable by keyboard. Clamped and snapped through
  // the same arithmetic the drag path uses, so no route in can land on an off-step value.
  const nudge = useCallback((delta: number) => {
    const raw     = value + delta;
    const snapped = Math.round(raw / step) * step;
    const next    = Math.max(min, Math.min(max, snapped));
    if (next !== value) onChange(next);
  }, [value, min, max, step, onChange]);

  const coarseStep  = coarseStepFor(min, max, step);
  const valueText   = formatLabel ? formatLabel(value) : String(value);
  const hasCaptions = Boolean(minLabel && maxLabel);

  return (
    <View style={styles.wrapper}>
      <GestureDetector gesture={pan}>
        <View
          style={styles.hitArea}
          onLayout={handleLayout}
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          // `text` as well as `now`, so the reader says "58 milliseconds" rather than "58"
          // for a control whose number means nothing without its unit.
          accessibilityValue={{ min, max, now: value, text: valueText }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') nudge(step);
            if (e.nativeEvent.actionName === 'decrement') nudge(-step);
          }}
          focusable
          {...(Platform.OS === 'web' ? {
            onKeyDown: (e: any) => {
              // Shift for a coarse pass, plain for fine — the same two-speed convention the
              // piano roll's threshold lines and arrow-key note nudge already use.
              const delta = e.shiftKey ? coarseStep : step;
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp')  { e.preventDefault(); nudge(delta); }
              if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown'){ e.preventDefault(); nudge(-delta); }
              if (e.key === 'PageUp')   { e.preventDefault(); nudge(coarseStep); }
              if (e.key === 'PageDown') { e.preventDefault(); nudge(-coarseStep); }
              if (e.key === 'Home')     { e.preventDefault(); if (value !== min) onChange(min); }
              if (e.key === 'End')      { e.preventDefault(); if (value !== max) onChange(max); }
            },
          } : null)}
        >
          <View style={[styles.track, { backgroundColor: theme.border }]} />
          <Animated.View style={[styles.fill, { backgroundColor: theme.accent }, fillStyle]} />
          {/* A plain white thumb reads fine on native, where `thumbShadow` gives it an edge,
              but on web the light theme's panel background is near-white too and the thumb
              vanished into it entirely. The accent ring is theme-aware and always contrasts,
              on both platforms and both themes. */}
          <Animated.View style={[styles.thumb, thumbShadow, { borderColor: theme.accent }, thumbStyle]} />
        </View>
      </GestureDetector>
      {/* The value is already spoken as the control's own value, so reading it a second
          time as loose text would announce every number twice. The end captions are the
          opposite case: they are the only statement of which direction does what, now that
          the help text above says what the number is rather than where to drag it — so
          they stay readable, and a screen reader gets the same hint the eye does. */}
      <View style={hasCaptions ? styles.captionRow : undefined}>
        {hasCaptions && <Text style={[styles.caption, { color: theme.textSub }]}>{minLabel}</Text>}
        {showValue && (
          <Text
            style={[
              styles.label,
              { color: theme.textSub, textAlign: hasCaptions ? 'center' : labelAlign },
              hasCaptions && styles.labelBetweenCaptions,
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {valueText}
          </Text>
        )}
        {hasCaptions && (
          <Text style={[styles.caption, styles.captionEnd, { color: theme.textSub }]}>{maxLabel}</Text>
        )}
      </View>
    </View>
  );
}

const thumbShadow = Platform.select({
  native: {
    shadowColor:   '#000',
    shadowOpacity: 0.18,
    shadowRadius:  4,
    shadowOffset:  { width: 0, height: 2 },
  },
  default: {},
});

const styles = StyleSheet.create({
  wrapper:   { gap: 6 },
  hitArea:   { height: THUMB + 16, justifyContent: 'center' },
  track:     { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  fill:      { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  thumb: {
    position:     'absolute',
    left:         0,
    width:        THUMB,
    height:       THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    borderWidth:  2,
    elevation:    4,
  },
  label:     { fontSize: FONT.sm, fontFamily: Poppins.semiBold },
  // Pulled up out of the hit area's built-in padding — a caption 23px under the track but
  // 2px above the help sentence groups with the sentence, which is the wrong control. The
  // negative margin buys back most of that padding without shrinking the touch target, and
  // the margin below re-opens the gap where it belongs.
  //
  // -13 is the floor, not a taste: the hit area reserves 8px under the thumb, and the thumb
  // reaches the far left and far right of the track at the ends of its travel — exactly
  // where the captions sit. Any tighter and dragging to either extreme runs the thumb into
  // its own caption.
  captionRow: {
    flexDirection:  'row',
    alignItems:     'baseline',
    justifyContent: 'space-between',
    gap:            8,
    marginTop:     -13,
    marginBottom:  4,
  },
  // The three cells share the row evenly rather than sizing to their text, so the value
  // stays optically centred over the track however lopsided the two captions are.
  labelBetweenCaptions: { flex: 1 },
  // Set as micro-caps rather than as prose. These are the ends of an axis, not a sentence:
  // matching the help's size, weight and colour made three stacked lines of grey that the
  // eye had to parse before it could tell which line described the control and which one
  // *was* the control.
  //
  // They take the middle of the caller's three text tiers — under the control's name and
  // its value, above the help sentence. Getting that order wrong is what made the rail read
  // flat: captions darker than the heading they belong to invert the whole block.
  caption: {
    flex:          1,
    fontSize:      10,
    lineHeight:    14,
    fontFamily:    Poppins.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    // Wrapping is better than truncating here: a caption is two or three words, and half a
    // word tells the reader nothing about which way the slider goes.
    flexShrink:    1,
  },
  captionEnd: { textAlign: 'right' },
});
