import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import { NameRecordingModal } from '@/components/NameRecordingModal';
import { ActionSheetModal } from '@/components/ActionSheetModal';
import type { Theme } from '@/theme';
import type { TabRecording } from '@/types';

interface RecordingCardProps {
  recording: TabRecording;
  onPress:   (recording: TabRecording) => void;
  onDelete:  (id: string) => void;
  onRename:  (id: string, title: string) => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function RecordingCard({ recording, onPress, onDelete, onRename }: RecordingCardProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      {/* A plain (non-interactive) row wrapping two sibling Pressables — not one nested
          inside the other. react-native-web renders accessibilityRole="button" as a real
          <button>, and nesting <button> elements is invalid HTML (React warns/errors on it),
          so the "open" touch target and the "..." menu button must not be parent/child. */}
      <View style={styles.card}>
        <Pressable
          onPress={() => onPress(recording)}
          style={({ pressed, hovered }: any) => [
            styles.touchArea,
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
        </Pressable>

        <Pressable
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.6 }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${recording.title}`}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={theme.textMuted} />
        </Pressable>
      </View>

      <ActionSheetModal
        visible={menuOpen}
        title={recording.title}
        options={[
          { label: 'Rename', onPress: () => setRenaming(true) },
          { label: 'Delete', style: 'destructive', onPress: () => setConfirmingDelete(true) },
        ]}
        onClose={() => setMenuOpen(false)}
      />

      <ActionSheetModal
        visible={confirmingDelete}
        title={`Delete "${recording.title}"? This can't be undone.`}
        options={[
          { label: 'Delete', style: 'destructive', onPress: () => onDelete(recording.id) },
        ]}
        onClose={() => setConfirmingDelete(false)}
      />

      <NameRecordingModal
        visible={renaming}
        defaultTitle={recording.title}
        heading="Rename recording"
        onSave={(title) => { onRename(recording.id, title); setRenaming(false); }}
        onCancel={() => setRenaming(false)}
      />
    </>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             4,
      backgroundColor: t.surface,
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    touchArea: {
      flex:          1,
      flexDirection: 'row',
      alignItems:    'center',
      gap:           12,
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
    moreBtn: {
      padding: 4,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
  });
}
