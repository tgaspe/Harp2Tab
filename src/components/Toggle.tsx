/**
 * A two-state switch.
 *
 * React Native's own `Switch` renders as the platform control, which on web means a checkbox
 * that ignores the app's theme entirely — visibly foreign next to `SliderInput` and the
 * segmented controls it sits beside. This is the same shape drawn from theme tokens, with
 * the switch role and state wired so it still announces as a switch.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

const TRACK_W = 40;
const TRACK_H = 22;
const KNOB    = 16;

interface Props {
  value:    boolean;
  onChange: (v: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}

export function Toggle({ value, onChange, accessibilityLabel, disabled }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={() => { if (!disabled) onChange(!value); }}
      style={({ pressed, hovered }: any) => [
        styles.track,
        value && styles.trackOn,
        disabled && styles.trackDisabled,
        (pressed || hovered) && !disabled && styles.trackHovered,
      ]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.knob, value && styles.knobOn]} />
    </Pressable>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    track: {
      width:           TRACK_W,
      height:          TRACK_H,
      borderRadius:    TRACK_H / 2,
      backgroundColor: t.surfaceAlt,
      borderWidth:     1,
      borderColor:     t.border,
      justifyContent:  'center',
      paddingHorizontal: 2,
    },
    trackOn:       { backgroundColor: t.accentSoft, borderColor: t.accent },
    trackHovered:  { borderColor: t.accentDim },
    trackDisabled: { opacity: 0.5 },
    knob: {
      width:           KNOB,
      height:          KNOB,
      borderRadius:    KNOB / 2,
      backgroundColor: t.textMuted,
    },
    knobOn: {
      backgroundColor: t.accent,
      // No animation: the control is small enough that a transform tween reads as lag
      // rather than as motion, and the colour change already carries the state.
      alignSelf:       'flex-end',
    },
  });
}
