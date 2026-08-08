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
}

function snap(ratio: number, min: number, max: number, step: number): number {
  'worklet';
  const raw     = ratio * (max - min) + min;
  const snapped = Math.round(raw / step) * step;
  return Math.max(min, Math.min(max, snapped));
}

export function SliderInput({ value, min, max, step = 1, onChange, formatLabel, labelAlign = 'right' }: SliderInputProps) {
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

  return (
    <View style={styles.wrapper}>
      <GestureDetector gesture={pan}>
        <View style={styles.hitArea} onLayout={handleLayout}>
          <View style={[styles.track, { backgroundColor: theme.border }]} />
          <Animated.View style={[styles.fill, { backgroundColor: theme.accent }, fillStyle]} />
          {/* A plain white thumb reads fine on native, where `thumbShadow` gives it an edge,
              but on web the light theme's panel background is near-white too and the thumb
              vanished into it entirely. The accent ring is theme-aware and always contrasts,
              on both platforms and both themes. */}
          <Animated.View style={[styles.thumb, thumbShadow, { borderColor: theme.accent }, thumbStyle]} />
        </View>
      </GestureDetector>
      <Text style={[styles.label, { color: theme.textSub, textAlign: labelAlign }]}>
        {formatLabel ? formatLabel(value) : String(value)}
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
