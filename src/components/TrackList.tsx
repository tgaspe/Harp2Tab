import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { audibleTracks, familyOf, gmProgramOptions, instrumentName } from '@/audio/studioTracks';
import { useTheme } from '@/hooks/useTheme';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { MidiTrackData } from '@/types';

/** Collapsed-rail geometry. Fixed so the hover tooltip can be positioned from a row index
 *  and the scroll offset alone, with nothing to measure. */
const COLLAPSED_ROW_H    = 34;
const COLLAPSED_HEADER_H = 38;

// Re-exported so callers that already import the panel don't need a second import.
export { audibleTracks, instrumentName };

interface TrackListProps {
  tracks:          MidiTrackData[];
  selectedTrackId: string | null;
  onSelectTrack:   (id: string) => void;
  onToggleMute:    (id: string) => void;
  onToggleSolo:    (id: string) => void;
  onSetProgram:    (id: string, program: number) => void;
  /** Absent when the caller can't add tracks. */
  onAddTrack?:     () => void;
  onDeleteTrack?:  (id: string) => void;
  collapsed:         boolean;
  onToggleCollapsed: () => void;
  /** Absent while conversion isn't available (e.g. a track with no notes). */
  onConvert?:      (id: string) => void;
}

export function TrackList({
  tracks, selectedTrackId, onSelectTrack, onToggleMute, onToggleSolo, onSetProgram,
  onAddTrack, onDeleteTrack, collapsed, onToggleCollapsed, onConvert,
}: TrackListProps) {
  // Which track's instrument picker is open, if any. One at a time — the panel is narrow
  // and two open lists would push everything else off-screen.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // Collapsed-rail hover, held here rather than per row so the tooltip can render outside
  // the scroll container that would otherwise clip it.
  const [hovered, setHovered] = useState<{ index: number } | null>(null);
  const [railScrollY, setRailScrollY] = useState(0);
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const anySoloed = tracks.some((t) => t.soloed);

  // Collapsed, the panel keeps only what identifies a track at a glance — its colour and
  // whether it's the one being edited. Same idea as the editor's icon rail: a narrower
  // version of the same control, not a different one.
  if (collapsed) {
    const hoveredTrack = hovered ? tracks[hovered.index] : null;
    return (
      <View style={[styles.panel, styles.panelCollapsed]}>
        <View style={styles.collapsedHeader}>
          <Pressable
            onPress={onToggleCollapsed}
            style={styles.collapseBtn}
            accessibilityRole="button"
            accessibilityLabel="Expand the track panel"
          >
            <Text style={styles.collapseChevron}>›</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.collapsedList}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => setRailScrollY(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
          // Hovering out of the rail entirely (rather than off one row) still has to clear
          // the tooltip, or it sticks after the pointer leaves.
          {...(Platform.OS === 'web' ? { onMouseLeave: () => setHovered(null) } as any : null)}
        >
          {tracks.map((track, index) => (
            <Pressable
              key={track.id}
              onPress={() => onSelectTrack(track.id)}
              style={[styles.collapsedRow, track.id === selectedTrackId && styles.collapsedRowSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected: track.id === selectedTrackId }}
              accessibilityLabel={`${track.name}, ${instrumentName(track.program)}, ${track.notes.length} notes`}
              {...(Platform.OS === 'web'
                ? { onMouseEnter: () => setHovered({ index }) } as any
                : null)}
            >
              <View
                style={[
                  styles.collapsedSwatch,
                  { backgroundColor: track.color },
                  (track.muted || (anySoloed && !track.soloed)) && styles.collapsedSwatchSilenced,
                ]}
              />
            </Pressable>
          ))}
        </ScrollView>

        {/* Rendered at panel level, not inside a row.
            The rail has to scroll — 29 tracks is ~1000px of swatches — and a scroll
            container clips its children, so a tooltip living inside one would be cut off
            at the rail's 44px edge, which is exactly where it needs to escape to. Rows are
            a fixed height, so the hovered row's position is arithmetic on its index and
            the scroll offset rather than anything that needs measuring. */}
        {hoveredTrack && (
          <View
            pointerEvents="none"
            style={[
              styles.collapsedTooltip,
              { top: COLLAPSED_HEADER_H + hovered!.index * COLLAPSED_ROW_H - railScrollY },
            ]}
          >
            <Text style={styles.collapsedTooltipText} numberOfLines={1}>{hoveredTrack.name}</Text>
            <Text style={styles.collapsedTooltipHint} numberOfLines={1}>
              {instrumentName(hoveredTrack.program)} · {hoveredTrack.notes.length} notes
              {hoveredTrack.muted || (anySoloed && !hoveredTrack.soloed) ? ' · silenced' : ''}
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Pressable
          onPress={onToggleCollapsed}
          style={styles.collapseBtn}
          accessibilityRole="button"
          accessibilityLabel="Collapse the track panel"
          {...(Platform.OS === 'web' ? ({ title: 'Collapse tracks' } as any) : null)}
        >
          <Text style={styles.collapseChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerText}>Tracks</Text>
        <View style={styles.headerRight}>
          <Text style={styles.headerCount}>{tracks.length}</Text>
          {onAddTrack && (
            <Pressable
              onPress={onAddTrack}
              style={styles.addTrack}
              accessibilityRole="button"
              accessibilityLabel="Add a track"
            >
              <Text style={styles.addTrackText}>+</Text>
            </Pressable>
          )}
        </View>
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

                <Pressable
                  style={[styles.toggle, styles.toggleWide, pickerFor === track.id && styles.toggleOpen]}
                  onPress={() => setPickerFor(pickerFor === track.id ? null : track.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: pickerFor === track.id }}
                  accessibilityLabel={`Change instrument for ${track.name}, currently ${instrumentName(track.program)}`}
                >
                  <Text style={styles.toggleText}>Inst</Text>
                </Pressable>
              </View>

              {pickerFor === track.id && (
                <View style={styles.picker}>
                  <ScrollView
                    style={styles.pickerList}
                    showsVerticalScrollIndicator
                    // Nested scrolling matters on the panel's own ScrollView: without it,
                    // Android hands the gesture to the parent and the list can't move.
                    nestedScrollEnabled
                  >
                    {gmProgramOptions().map((option, i, all) => {
                      const startsFamily = i === 0 || all[i - 1].family !== option.family;
                      const chosen = option.program === track.program;
                      return (
                        <View key={option.program}>
                          {startsFamily && <Text style={styles.pickerFamily}>{option.family}</Text>}
                          <Pressable
                            style={[styles.pickerItem, chosen && styles.pickerItemChosen]}
                            onPress={() => { onSetProgram(track.id, option.program); setPickerFor(null); }}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: chosen }}
                          >
                            <Text
                              style={[styles.pickerItemText, chosen && styles.pickerItemTextChosen]}
                              numberOfLines={1}
                            >
                              {option.name}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Row actions only on the selected track. Repeating "Convert to tabs" and
                  "Delete" down all 29 rows turned the panel into a wall of buttons and
                  buried the thing it exists for — the track names. */}
              {selected && (
                <View style={styles.rowActions}>
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
                  {onDeleteTrack && tracks.length > 1 && (
                    <Pressable
                      onPress={() => onDeleteTrack(track.id)}
                      style={styles.deleteTrack}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete track ${track.name}`}
                    >
                      <Text style={styles.deleteTrackText}>Delete</Text>
                    </Pressable>
                  )}
                </View>
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
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    // `overflow: visible` and a stacking context above the piano roll beside it, so a
    // row's tooltip paints over the grid instead of being clipped at the rail's edge.
    panelCollapsed: { width: 44, overflow: 'visible', zIndex: 5 },
    collapsedList: { flex: 1 },
    collapsedHeader: {
      height: COLLAPSED_HEADER_H,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    collapseBtn: {
      width: 22, height: 22, borderRadius: 5,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.border,
    },
    collapseChevron: { fontFamily: Poppins.bold, fontSize: 15, color: t.textSub, lineHeight: 17 },
    collapsedRow: {
      height: COLLAPSED_ROW_H, alignItems: 'center', justifyContent: 'center',
      borderBottomWidth: 1, borderBottomColor: t.separator,
    },
    collapsedRowSelected: { backgroundColor: t.accentSoft },
    collapsedSwatch: { width: 12, height: 12, borderRadius: 3 },
    collapsedSwatchSilenced: { opacity: 0.3 },
    collapsedTooltip: {
      position: 'absolute',
      left: '100%',
      marginLeft: 6,
      minWidth: 150,
      maxWidth: 260,
      backgroundColor: t.textPrimary,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 2,
      zIndex: 40,
      ...(Platform.OS === 'web' ? { boxShadow: '0 4px 12px rgba(0,0,0,0.25)' } : null),
    } as any,
    collapsedTooltipText: { fontSize: 11, fontFamily: Poppins.bold, color: t.bg, lineHeight: 15 },
    collapsedTooltipHint: { fontSize: 10, fontFamily: SpaceGrotesk.regular, color: t.bg, opacity: 0.75, lineHeight: 14 },
    headerText:  { flex: 1, fontFamily: Poppins.bold, fontSize: 13, color: t.textPrimary },
    headerCount: { fontFamily: SpaceGrotesk.regular, fontSize: 12, color: t.textMuted },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    addTrack: {
      width: 22, height: 22, borderRadius: 5,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.accentDim,
    },
    addTrackText: { fontFamily: Poppins.bold, fontSize: 14, color: t.accent, lineHeight: 16 },
    rowActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    deleteTrack: {
      paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
      borderWidth: 1, borderColor: t.border,
    },
    deleteTrackText: { fontFamily: Poppins.bold, fontSize: 11, color: t.textMuted },
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
    toggleWide: { width: 38 },
    toggleOpen: { backgroundColor: t.accentSoft, borderColor: t.accentDim },
    picker: {
      marginTop: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
      overflow: 'hidden',
    },
    // Bounded so the picker can't push the rest of the track list off-screen.
    pickerList: { maxHeight: 220 },
    pickerFamily: {
      fontFamily: Poppins.bold,
      fontSize: 10,
      color: t.textMuted,
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 2,
      textTransform: 'uppercase',
    },
    pickerItem: { paddingHorizontal: 10, paddingVertical: 5 },
    pickerItemChosen: { backgroundColor: t.accentSoft },
    pickerItemText: { fontFamily: SpaceGrotesk.regular, fontSize: 12, color: t.textSub },
    pickerItemTextChosen: { fontFamily: Poppins.bold, color: t.accent },
  });
}
