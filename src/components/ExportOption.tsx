import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { EXPORT_FORMAT_META, FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { ExportFormat } from '@/types';

interface ExportOptionProps {
  format: ExportFormat;
  isSelected: boolean;
  onSelect: (format: ExportFormat) => void;
  showDivider?: boolean;
}

export function ExportOption({ format, isSelected, onSelect, showDivider }: ExportOptionProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const meta   = EXPORT_FORMAT_META[format];

  return (
    <>
      <Pressable
        onPress={() => onSelect(format)}
        style={({ pressed }) => [
          styles.row,
          pressed && styles.rowPressed,
        ]}
        accessibilityRole="radio"
        accessibilityState={{ checked: isSelected }}
        accessibilityLabel={`Export as ${meta.label}`}
      >
        <Ionicons
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          name={meta.icon as any}
          size={20}
          color={isSelected ? theme.accent : theme.textSub}
          style={styles.icon}
        />

        <View style={styles.text}>
          <Text style={[styles.label, isSelected && styles.labelSelected]}>
            {meta.label}
          </Text>
          <Text style={styles.description}>{meta.description}</Text>
        </View>

        {/* Radio dot */}
        <View style={[styles.radio, isSelected && styles.radioSelected]}>
          {isSelected && <View style={styles.radioDot} />}
        </View>
      </Pressable>

      {showDivider && <View style={styles.separator} />}
    </>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      gap: 12,
    },
    rowPressed: { opacity: 0.6 },
    icon: {
      width: 28,
      textAlign: 'center',
    },
    text:  { flex: 1, gap: 2 },
    label: {
      fontSize:   FONT.base,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    labelSelected: { color: t.textPrimary },
    description: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      lineHeight: 16,
    },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: { borderColor: t.accent },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: t.accent,
    },
    separator: {
      height: 1,
      backgroundColor: t.separator,
      marginLeft: 56,
    },
  });
}
