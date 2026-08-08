/**
 * The editor's velocity filter: hides notes quieter than the threshold, live.
 *
 * Lives as its own tab in the piano roll's data panel, after Pitch Bend, rather than as
 * an inline accessory in the tab strip — a slider has no plot of its own, so parking it
 * on a tab hands it the plot's full width instead of a cramped sliver next to the tabs.
 * What it filters on is exactly `breathForce`, which is what the Breath Force lane draws.
 *
 * The reading that matters is the note count, not the number: `breathForce` means different
 * things depending on what produced the tab (the classic tracker derives it from signal RMS,
 * the neural engine from its own per-note activation, a MIDI file states it outright), so
 * the same threshold bites differently per source. Tuning by "how many notes are left" is
 * the only thing that transfers, hence the count leads, sitting above the slider rather
 * than trailing after it.
 *
 * Nothing here deletes. The filter is a lens over the session's notes; every hidden note is
 * still in the store, still saved to the library, and comes straight back when the slider
 * moves down.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SliderInput } from './SliderInput';
import { Poppins } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

interface Props {
  value:        number;
  onChange:     (v: number) => void;
  audibleCount: number;
  totalCount:   number;
}

export function NoiseGateControl({ value, onChange, audibleCount, totalCount }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const active = value > 0;

  return (
    <View style={styles.wrap}>
      {/* Visible at every position, including 0 — reading "165 of 165" is what says the
          control is idle rather than broken. Phrased as a count of what's *shown*, never
          as notes removed, because not removing them is the whole point. Leads the section
          since it's the number that actually matters day to day, not the raw threshold. */}
      <Text
        style={[styles.count, active && styles.countActive]}
        numberOfLines={1}
        accessibilityLabel={`${audibleCount} of ${totalCount} notes shown`}
      >
        {audibleCount} / {totalCount} notes shown
      </Text>

      {/* The slider (plus its value label and Reset) as one centered block, so it sits in
          the true middle of whatever room the tab has rather than huddled under the count. */}
      <View style={styles.sliderBlock}>
        <SliderInput
          value={value}
          min={0}
          max={127}
          step={1}
          onChange={onChange}
          formatLabel={(v) => (v === 0 ? 'Off' : String(v))}
          labelAlign="center"
        />

        {active && (
          <Pressable
            onPress={() => onChange(0)}
            hitSlop={8}
            style={({ pressed, hovered }: any) => [
              styles.reset,
              (pressed || hovered) && styles.resetHovered,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Reset velocity filter, showing all ${totalCount} notes again`}
          >
            <Ionicons name="close" size={11} color={theme.textSub} />
            <Text style={styles.resetText}>Reset</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    wrap: {
      flex:              1,
      paddingHorizontal: 32,
      paddingVertical:   12,
    },
    count: {
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      theme.textMuted,
      textAlign:  'center',
    },
    countActive: { color: theme.accent },
    // `flex: 1` + `justifyContent: 'center'` centers this block (slider, its value label,
    // Reset) in whatever height remains below the count line — the actual "middle of the
    // section" the count above it isn't part of.
    sliderBlock: {
      flex:           1,
      justifyContent: 'center',
      gap:            10,
    },
    reset: {
      flexDirection:     'row',
      alignItems:        'center',
      alignSelf:         'center',
      gap:               4,
      paddingHorizontal: 8,
      paddingVertical:   4,
      borderRadius:      6,
    },
    resetText: {
      fontFamily: Poppins.medium,
      fontSize:   FONT.xs,
      color:      theme.textSub,
    },
    resetHovered: { backgroundColor: theme.surfaceAlt },
  });
}
