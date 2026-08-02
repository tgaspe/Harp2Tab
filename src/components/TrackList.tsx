import React, { useMemo } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { audibleTracks, instrumentName } from '@/audio/studioTracks';
import { useTheme } from '@/hooks/useTheme';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { MidiTrackData } from '@/types';

// Re-exported so callers that already import the panel don't need a second import.
export { audibleTracks, instrumentName };

interface TrackListProps {
  tracks:          MidiTrackData[];
  selectedTrackId: string | null;
  onSelectTrack:   (id: string) => void;
  onToggleMute:    (id: string) => void;
  onToggleSolo:    (id: string) => void;
  /** Absent while conversion isn't available (e.g. a track with no notes). */
  onConvert?:      (id: string) => void;
}

export function TrackList({
  tracks, selectedTrackId, onSelectTrack, onToggleMute, onToggleSolo, onConvert,
}: TrackListProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const anySoloed = tracks.some((t) => t.soloed);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Tracks</Text>
        <Text style={styles.headerCount}>{tracks.length}</Text>
      </View>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={Platform.OS === 'web'}>
        {tracks.map((track) => {
          const selected = track.id === selectedTrackId;
          // Shown as dimmed for the same reason playback silences it — a soloed sibling,
          // not anything about this track — so the panel explains its own state.
          const silenced = track.muted || (anySoloed && !track.soloed);

          return (
            <View key={track.id} style={[styles.row, selected && styles.rowSelected]}>
              <Pressable
                style={styles.rowMain}
                onPress={() => onSelectTrack(track.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${track.name}, ${instrumentName(track.program)}, ${track.notes.length} notes`}
              >
                <View style={[styles.swatch, { backgroundColor: track.color }]} />
                <View style={styles.rowText}>
                  <Text
                    style={[styles.trackName, silenced && styles.trackNameSilenced]}
                    numberOfLines={1}
                  >
                    {track.name}
                  </Text>
                  <Text style={styles.trackMeta} numberOfLines={1}>
                    {instrumentName(track.program)} · {track.notes.length} notes
                  </Text>
                </View>
              </Pressable>

              <View style={styles.controls}>
                <Pressable
                  style={[styles.toggle, track.muted && styles.toggleMuted]}
                  onPress={() => onToggleMute(track.id)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: track.muted }}
                  accessibilityLabel={`Mute ${track.name}`}
                >
                  <Text style={[styles.toggleText, track.muted && styles.toggleTextActive]}>M</Text>
                </Pressable>
                <Pressable
                  style={[styles.toggle, track.soloed && styles.toggleSoloed]}
                  onPress={() => onToggleSolo(track.id)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: track.soloed }}
                  accessibilityLabel={`Solo ${track.name}`}
                >
                  <Text style={[styles.toggleText, track.soloed && styles.toggleTextActive]}>S</Text>
                </Pressable>
              </View>

              {onConvert && track.notes.length > 0 && (
                <Pressable
                  style={styles.convert}
                  onPress={() => onConvert(track.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Convert ${track.name} to harmonica tabs`}
                >
                  <Text style={styles.convertText}>Convert to tabs</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    panel: {
      width: 240,
      backgroundColor: t.surface,
      borderRightWidth: 1,
      borderRightColor: t.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    headerText:  { fontFamily: Poppins.bold, fontSize: 13, color: t.textPrimary },
    headerCount: { fontFamily: SpaceGrotesk.regular, fontSize: 12, color: t.textMuted },
    list: { flex: 1 },
    row: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: t.separator,
      gap: 6,
    },
    rowSelected: { backgroundColor: t.accentSoft },
    rowMain: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    swatch: { width: 10, height: 10, borderRadius: 3 },
    rowText: { flex: 1, minWidth: 0 },
    trackName: { fontFamily: Poppins.bold, fontSize: 13, color: t.textPrimary },
    // Dimmed rather than hidden — a silenced track is still selectable and editable.
    trackNameSilenced: { color: t.textMuted },
    trackMeta: { fontFamily: SpaceGrotesk.regular, fontSize: 11, color: t.textMuted },
    controls: { flexDirection: 'row', gap: 6 },
    toggle: {
      width: 24, height: 22, borderRadius: 5,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.surfaceAlt,
      borderWidth: 1, borderColor: t.border,
    },
    toggleMuted:  { backgroundColor: t.recordSoft,  borderColor: t.record },
    toggleSoloed: { backgroundColor: t.warningSoft, borderColor: t.warning },
    toggleText:       { fontFamily: Poppins.bold, fontSize: 11, color: t.textMuted },
    toggleTextActive: { color: t.textPrimary },
    convert: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8, paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: t.accentSoft,
      borderWidth: 1, borderColor: t.accentDim,
    },
    convertText: { fontFamily: Poppins.bold, fontSize: 11, color: t.accent },
  });
}
