import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import type { Theme } from '@/theme';

/**
 * One row of the export picker.
 *
 * Takes its presentation already resolved rather than looking it up from
 * `EXPORT_FORMAT_META` itself. That indirection was fine while `ExportFormat` was the only
 * family of things one could export; Phase 17 added audio formats, which are a separate
 * union on purpose (they have no `generateForFormat` case), and a row that can only render
 * one of the two unions cannot serve a popup that shows both.
 */
interface ExportOptionProps {
  /** Opaque to this component — whatever the owning list uses to identify a format. */
  id: string;
  label: string;
  description: string;
  /** Ionicons name. */
  icon: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  showDivider?: boolean;
}

export function ExportOption({
  id, label, description, icon, isSelected, onSelect, showDivider,
}: ExportOptionProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <>
      <Pressable
        onPress={() => onSelect(id)}
        style={({ pressed }) => [
          styles.row,
          pressed && styles.rowPressed,
        ]}
        accessibilityRole="radio"
        accessibilityState={{ checked: isSelected }}
        accessibilityLabel={`Export as ${label}`}
      >
        <Ionicons
          name={icon as React.ComponentProps<typeof Ionicons>['name']}
          size={20}
          color={isSelected ? theme.accent : theme.textSub}
          style={styles.icon}
        />

        <View style={styles.text}>
          <Text style={[styles.label, isSelected && styles.labelSelected]}>
            {label}
          </Text>
          <Text style={styles.description}>{description}</Text>
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
