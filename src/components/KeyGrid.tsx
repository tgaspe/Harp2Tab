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
}

export function KeyGrid({ selected, onSelect }: KeyGridProps) {
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
}

function KeyCell({ label, isSelected, onPress, theme }: KeyCellProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        isSelected && styles.cellSelected,
        pressed && styles.cellPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Key ${label}`}
      accessibilityState={{ selected: isSelected }}
    >
      <Text style={[styles.label, isSelected && styles.labelSelected]}>
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
  });
}
