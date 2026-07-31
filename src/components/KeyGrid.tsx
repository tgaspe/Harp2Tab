import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { HARMONICA_KEYS, FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { HarmonicaKey } from '@/types';

interface KeyGridProps {
  selected: HarmonicaKey | null;
  onSelect: (key: HarmonicaKey) => void;
  /** Outlined-on-transparent cells with a solid-white selected state, instead of the
   *  normal filled-white cells — for placement directly on a colored background (the
   *  sidebar) where a light cell fill would read as a stray white box. */
  onAccent?: boolean;
}

export function KeyGrid({ selected, onSelect, onAccent = false }: KeyGridProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <FlatList
      data={HARMONICA_KEYS}
      keyExtractor={(item) => item}
      numColumns={4}
      scrollEnabled={false}
      contentContainerStyle={styles.grid}
      columnWrapperStyle={styles.row}
      renderItem={({ item }) => (
        <KeyCell
          label={item}
          isSelected={selected === item}
          onPress={() => onSelect(item)}
          theme={theme}
          onAccent={onAccent}
        />
      )}
    />
  );
}

interface KeyCellProps {
  label: HarmonicaKey;
  isSelected: boolean;
  onPress: () => void;
  theme: Theme;
  onAccent?: boolean;
}

function KeyCell({ label, isSelected, onPress, theme, onAccent = false }: KeyCellProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        onAccent && styles.cellOnAccent,
        isSelected && (onAccent ? styles.cellSelectedOnAccent : styles.cellSelected),
        pressed && styles.cellPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Key ${label}`}
      accessibilityState={{ selected: isSelected }}
    >
      <Text style={[
        styles.label,
        onAccent && styles.labelOnAccent,
        isSelected && (onAccent ? styles.labelSelectedOnAccent : styles.labelSelected),
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    grid: { gap: 8 },
    row:  { gap: 8, justifyContent: 'center' },
    cell: {
      flex: 1,
      aspectRatio: 1,
      maxWidth: 80,
      borderRadius: 14,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellSelected: {
      backgroundColor: t.accent,
      borderColor: t.accent,
    },
    cellOnAccent: {
      backgroundColor: 'transparent',
      borderColor: 'rgba(255,255,255,0.35)',
    },
    cellSelectedOnAccent: {
      backgroundColor: '#fff',
      borderColor: '#fff',
    },
    cellPressed: { opacity: 0.65 },
    label: {
      fontSize:      FONT.md,
      fontFamily:    Poppins.semiBold,
      color:         t.textSub,
      letterSpacing: 0.2,
    },
    labelSelected: {
      fontFamily: Poppins.bold,
      color:      '#fff',
    },
    labelOnAccent: {
      color: 'rgba(255,255,255,0.9)',
    },
    labelSelectedOnAccent: {
      fontFamily: Poppins.bold,
      color:      t.accent,
    },
  });
}
