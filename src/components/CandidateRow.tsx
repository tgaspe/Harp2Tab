/**
 * The selectable row the import screen's three pickers are all built from: choose a MIDI
 * track, choose a target harmonica for a MIDI file, choose one for an analyzed recording.
 *
 * All three were the same twenty lines of Pressable + hover/selected styling + checkmark,
 * copied three times, which is how the audio and MIDI key lists drifted into describing the
 * same `KeyCandidate` with differently-shaped stats. The row owns layout, selection styling
 * and the radio semantics; callers own the words, since what makes a track or a key the
 * right choice differs by screen.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

interface CandidateListProps {
  children: React.ReactNode;
}

/** Groups rows into one radio group. Separate from the row so a list can mix row kinds —
 *  the MIDI track picker ends with an "all tracks merged" row that isn't a track. */
export function CandidateList({ children }: CandidateListProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {children}
    </View>
  );
}

interface CandidateRowProps {
  /** Rendered at the row's leading edge — a key letter, or the track picker's play button. */
  leading?:  React.ReactNode;
  title:     string;
  subtitle:  string;
  selected:  boolean;
  onPress:   () => void;
  /** Spoken description of the whole row. Required rather than derived from title+subtitle,
   *  which read as fragments out loud ("2nd position (cross harp), 87% fit"). */
  accessibilityLabel: string;
}

export function CandidateRow({
  leading,
  title,
  subtitle,
  selected,
  onPress,
  accessibilityLabel,
}: CandidateRowProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        styles.row,
        selected && styles.rowActive,
        (pressed || hovered) && !selected && styles.rowHovered,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel}
    >
      {leading}
      <View style={styles.info}>
        <Text style={[styles.title, selected && styles.titleActive]}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {selected && <Ionicons name="checkmark-circle" size={18} color={theme.accent} />}
    </Pressable>
  );
}

/**
 * Divides a long list into named runs — "the ones we recommend" and "everything else".
 *
 * Inside the `radiogroup` rather than outside it, because the split is a labelling of one
 * list of choices, not two lists: the ranking is continuous and the heading only says where
 * confidence in it stops.
 */
export function CandidateGroupLabel({ label }: { label: string }) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text style={styles.groupLabel}>{label}</Text>;
}

/** The leading slot for a key row — the harmonica's letter, emphasized when selected. */
export function CandidateKeyBadge({ label, selected }: { label: string; selected: boolean }) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text style={[styles.keyBadge, selected && styles.keyBadgeActive]}>{label}</Text>;
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    list: {
      width:     '100%',
      gap:       8,
      marginTop: 14,
    },
    row: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               12,
      paddingVertical:   10,
      paddingHorizontal: 12,
      borderRadius:      10,
      borderWidth:       1,
      borderColor:       theme.border,
      backgroundColor:   theme.surface,
    },
    rowActive: {
      borderColor:     theme.accent,
      backgroundColor: theme.accentSoft,
    },
    rowHovered: {
      backgroundColor: theme.surfaceAlt,
    },
    info: { flex: 1, gap: 1 },
    title: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.sm,
      color:      theme.textPrimary,
    },
    titleActive: { color: theme.textPrimary },
    subtitle: {
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      theme.textSub,
    },
    groupLabel: {
      fontFamily:    Poppins.semiBold,
      fontSize:      FONT.xs,
      color:         theme.textMuted,
      letterSpacing: 0.8,
      marginTop:     4,
    },
    keyBadge: {
      fontFamily: SpaceGrotesk.bold,
      fontSize:   FONT.md,
      color:      theme.textSub,
      minWidth:   28,
      textAlign:  'center',
    },
    keyBadgeActive: { color: theme.accent },
  });
}
