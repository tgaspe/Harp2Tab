import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

const COLUMNS = 4;

// Twelve fixed cells laid out as plain rows of Views, not a FlatList. It was never
// scrolling (scrollEnabled={false}) or virtualizing anything useful over a 12-item
// constant list, and as a VirtualizedList it triggered React Native's
// "VirtualizedLists should never be nested inside plain ScrollViews" warning the moment
// it landed inside the edit screen's now-scrollable sidebar.
export function KeyGrid({ selected, onSelect, onAccent = false }: KeyGridProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const rows = useMemo(() => {
    const out: HarmonicaKey[][] = [];
    for (let i = 0; i < HARMONICA_KEYS.length; i += COLUMNS) {
      out.push(HARMONICA_KEYS.slice(i, i + COLUMNS));
    }
    return out;
  }, []);

  return (
    <View style={styles.grid}>
      {rows.map((row) => (
        <View key={row[0]} style={styles.row}>
          {row.map((item) => (
            <KeyCell
              key={item}
              label={item}
              isSelected={selected === item}
              onPress={() => onSelect(item)}
              theme={theme}
              onAccent={onAccent}
            />
          ))}
        </View>
      ))}
    </View>
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
    row:  { flexDirection: 'row', gap: 8, justifyContent: 'center' },
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
    // A hairline at 0.35 alpha over the cyan accent is barely there, and the cells read
    // as a faint grid of ghosts. A slight fill plus a stronger border gives each cell a
    // real edge without turning it into the solid white the *selected* state owns.
    cellOnAccent: {
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderColor: 'rgba(255,255,255,0.55)',
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
      color: '#fff',
    },
    labelSelectedOnAccent: {
      fontFamily: Poppins.bold,
      color:      t.accent,
    },
  });
}
