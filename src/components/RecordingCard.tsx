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
  recording:        TabRecording;
  onPress:          (recording: TabRecording) => void;
  onDelete:         (id: string) => void;
  onRename:         (id: string, title: string) => void;
  onToggleFavorite: (id: string) => void;
  isPlaying:        boolean;
  onTogglePlay:     (recording: TabRecording) => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(createdAt: number): string {
  const d = new Date(createdAt);
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

export function RecordingCard({
  recording, onPress, onDelete, onRename, onToggleFavorite, isPlaying, onTogglePlay,
}: RecordingCardProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      {/* Every interactive piece here (thumbnail play button, open-recording area, favorite
          star, more-options) is a sibling Pressable, not nested inside one another —
          react-native-web renders accessibilityRole="button" as a real <button>, and
          nesting <button> elements is invalid HTML (React warns/errors on it). */}
      <View style={styles.card}>
        <Pressable
          onPress={() => onTogglePlay(recording)}
          style={({ pressed, hovered }: any) => [
            styles.thumb,
            (pressed || (Platform.OS === 'web' && hovered)) && styles.thumbPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? `Pause ${recording.title}` : `Play ${recording.title}`}
        >
          <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={30} color={theme.accent} />
          <View style={styles.thumbDurationBadge}>
            <Text style={styles.thumbDurationText}>{formatDuration(recording.duration)}</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => onPress(recording)}
          style={({ pressed, hovered }: any) => [
            styles.touchArea,
            (pressed || (Platform.OS === 'web' && hovered)) && styles.cardPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Open recording ${recording.title}`}
        >
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>{recording.title}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {recording.harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
              {' · '}{recording.tabNotes.length} note{recording.tabNotes.length !== 1 ? 's' : ''} detected
            </Text>
            <Text style={styles.date} numberOfLines={1}>{formatDate(recording.createdAt)}</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => onToggleFavorite(recording.id)}
          style={styles.starBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={recording.favorite ? `Remove ${recording.title} from favorites` : `Favorite ${recording.title}`}
          accessibilityState={{ selected: !!recording.favorite }}
        >
          <Ionicons
            name={recording.favorite ? 'star' : 'star-outline'}
            size={17}
            color={recording.favorite ? theme.warning : theme.textMuted}
          />
        </Pressable>

        <View style={styles.keyBadge}>
          <Text style={styles.keyBadgeText}>Key of {recording.key}</Text>
        </View>

        <Pressable
          onPress={() => setMenuOpen(true)}
          style={styles.moreBtn}
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
      gap:             12,
      backgroundColor: t.surface,
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    thumb: {
      width:            56,
      height:           56,
      borderRadius:     12,
      backgroundColor:  t.accentSoft,
      alignItems:       'center',
      justifyContent:   'center',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    thumbPressed: { opacity: 0.75 },
    thumbDurationBadge: {
      position:          'absolute',
      right:             4,
      bottom:            4,
      backgroundColor:   'rgba(0,0,0,0.55)',
      borderRadius:      4,
      paddingHorizontal: 4,
      paddingVertical:   1,
    },
    thumbDurationText: { fontSize: 9, fontFamily: Poppins.semiBold, color: '#fff' },
    touchArea: {
      flex:          1,
      minWidth:      0,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    cardPressed: { opacity: 0.7 },
    info:  { gap: 3 },
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
    date: {
      fontSize:   10,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
    },
    starBtn: {
      padding: 4,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    keyBadge: {
      backgroundColor:   t.accentSoft,
      borderRadius:      20,
      paddingHorizontal: 10,
      paddingVertical:   5,
    },
    keyBadgeText: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.semiBold,
      color:      t.accent,
    },
    moreBtn: {
      padding: 4,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
  });
}
