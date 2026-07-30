import React, { useMemo } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { TabRecording } from '@/types';

interface RecordingCardProps {
  recording: TabRecording;
  onPress: (recording: TabRecording) => void;
  onDelete: (id: string) => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function RecordingCard({ recording, onPress, onDelete }: RecordingCardProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  function handleLongPress() {
    Alert.alert(
      'Delete Recording',
      `Delete "${recording.title}"? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(recording.id) },
      ],
    );
  }

  return (
    <Pressable
      onPress={() => onPress(recording)}
      onLongPress={handleLongPress}
      style={({ pressed, hovered }: any) => [
        styles.card,
        (pressed || (Platform.OS === 'web' && hovered)) && styles.cardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open recording ${recording.title}`}
    >
      <View style={styles.keyBadge}>
        <Text style={styles.keyBadgeText}>{recording.key}</Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{recording.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {recording.harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
          {' · '}{recording.tabNotes.length} note{recording.tabNotes.length !== 1 ? 's' : ''}
          {' · '}{formatDuration(recording.duration)}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             12,
      backgroundColor: t.surface,
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    cardPressed: { opacity: 0.7 },
    keyBadge: {
      width:           40,
      height:          40,
      borderRadius:    10,
      backgroundColor: t.accentSoft,
      alignItems:      'center',
      justifyContent:  'center',
    },
    keyBadgeText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.extraBold,
      color:      t.accent,
    },
    info:  { flex: 1, gap: 2 },
    title: {
      fontSize:   FONT.base,
      fontFamily: Poppins.semiBold,
      color:      t.textPrimary,
    },
    meta: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
    },
  });
}
