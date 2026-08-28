import React, { useMemo } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { GM_FAMILIES, gmProgramOptions, instrumentName } from '@/audio/studioTracks';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

interface Props {
  visible: boolean;
  selectedProgram: number;
  onSelect: (program: number) => void;
  onClose: () => void;
}

/** The complete General MIDI instrument browser, shared in shape with the Studio picker. */
export function InstrumentPickerModal({ visible, selectedProgram, onSelect, onClose }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const byFamily = useMemo(() => {
    const groups = new Map<string, { program: number; name: string }[]>();
    for (const option of gmProgramOptions()) {
      const group = groups.get(option.family) ?? [];
      group.push(option);
      groups.set(option.family, group);
    }
    return groups;
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Export instrument</Text>
              <Text style={styles.subtitle}>Currently {instrumentName(selectedProgram)}</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close instrument picker"
            >
              <Ionicons name="close" size={20} color={theme.textSub} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <View style={styles.familyGrid}>
              {GM_FAMILIES.map((family) => (
                <View key={family} style={styles.familyBlock}>
                  <Text style={styles.familyHeading}>{family}</Text>
                  {(byFamily.get(family) ?? []).map((option) => {
                    const selected = option.program === selectedProgram;
                    return (
                      <Pressable
                        key={option.program}
                        onPress={() => { onSelect(option.program); onClose(); }}
                        style={({ hovered }: any) => [
                          styles.item,
                          hovered && !selected && styles.itemHovered,
                          selected && styles.itemSelected,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.itemText, selected && styles.itemTextSelected]} numberOfLines={1}>
                          {option.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    card: {
      width: '100%',
      maxWidth: 760,
      maxHeight: '82%',
      backgroundColor: theme.bg,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
      ...(Platform.OS === 'web' ? { boxShadow: '0 18px 50px rgba(0,0,0,0.35)' } : null),
    } as any,
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    headerText: { flex: 1, gap: 2 },
    title: { fontFamily: Poppins.bold, fontSize: 17, color: theme.textPrimary },
    subtitle: { fontFamily: SpaceGrotesk.regular, fontSize: 12, color: theme.textSub },
    closeButton: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    scroll: { flexShrink: 1 },
    scrollContent: { padding: 18 },
    familyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    familyBlock: { flexGrow: 1, flexBasis: 160, minWidth: 145 },
    familyHeading: {
      marginBottom: 5,
      paddingHorizontal: 7,
      fontFamily: Poppins.bold,
      fontSize: 11,
      color: theme.textMuted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    item: {
      borderRadius: 7,
      paddingHorizontal: 8,
      paddingVertical: 6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    itemHovered: { backgroundColor: theme.surfaceAlt },
    itemSelected: { backgroundColor: theme.accentSoft },
    itemText: { fontFamily: SpaceGrotesk.regular, fontSize: 12, color: theme.textSub },
    itemTextSelected: { fontFamily: Poppins.bold, color: theme.accent },
  });
}
