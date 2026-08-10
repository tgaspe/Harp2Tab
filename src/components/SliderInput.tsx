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

  const coarseStep = coarseStepFor(min, max, step);
  const valueText  = formatLabel ? formatLabel(value) : String(value);

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
      {/* Already spoken as the control's own value, so reading it a second time as loose
          text would announce every number twice. */}
      <Text
        style={[styles.label, { color: theme.textSub, textAlign: labelAlign }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {valueText}
      </Text>
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
});
