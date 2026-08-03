import React, { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { audibleTracks, GM_FAMILIES, gmProgramOptions, instrumentName } from '@/audio/studioTracks';
import { useTheme } from '@/hooks/useTheme';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { WEB_CONTENT_WIDTH } from '@/constants/layout';
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
  // Which track's instrument picker is open, if any. Still one at a time, but now because
  // it's a modal rather than because the 240px panel couldn't hold two inline lists.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // Collapsed-rail hover, held here rather than per row so the tooltip can render outside
  // the scroll container that would otherwise clip it.
  const [hovered, setHovered] = useState<{ index: number } | null>(null);
  // Expanded-list hover (web) — reveals the delete X on a row you're pointing at, so it
  // stays reachable without first selecting the track, while keeping the panel free of 29
  // permanently-visible delete buttons.
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
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
            <View
              key={track.id}
              style={[styles.row, selected && styles.rowSelected]}
              {...(Platform.OS === 'web'
                ? ({
                    onMouseEnter: () => setHoveredRowId(track.id),
                    onMouseLeave: () => setHoveredRowId((id) => (id === track.id ? null : id)),
                  } as any)
                : null)}
            >
              {/* Top-right X rather than a "Delete" button down in the row's actions: it's
                  the corner every closable card in the app puts its dismiss control, and
                  at 18px it costs the row no vertical space at all. `rowMain` reserves the
                  width permanently (see its paddingRight) so a long track name never
                  reflows when the X appears. */}
              {onDeleteTrack && tracks.length > 1 && (selected || hoveredRowId === track.id) && (
                <Pressable
                  onPress={() => onDeleteTrack(track.id)}
                  style={styles.deleteTrack}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete track ${track.name}`}
                  {...(Platform.OS === 'web' ? ({ title: `Delete ${track.name}` } as any) : null)}
                >
                  <Ionicons name="close" size={13} color={theme.textMuted} />
                </Pressable>
              )}

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
                  {...(Platform.OS === 'web'
                    ? ({ title: track.muted ? 'Unmute this track' : 'Mute — silence this track' } as any)
                    : null)}
                >
                  {/* A speaker, crossed out when muted — the state is the icon, so a muted
                      track reads as silenced without having to notice the tint behind it. */}
                  <Ionicons
                    name={track.muted ? 'volume-mute' : 'volume-medium'}
                    size={14}
                    color={track.muted ? theme.record : theme.textMuted}
                  />
                </Pressable>
                <Pressable
                  style={[styles.toggle, track.soloed && styles.toggleSoloed]}
                  onPress={() => onToggleSolo(track.id)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: track.soloed }}
                  accessibilityLabel={`Solo ${track.name}`}
                  {...(Platform.OS === 'web'
                    ? ({ title: track.soloed ? 'Unsolo this track' : 'Solo — silence every track except the soloed ones' } as any)
                    : null)}
                >
                  {/* Headphones for solo — "listen to this one on its own", the same
                      shorthand every DAW's cue/solo control uses. */}
                  <Ionicons
                    name="headset"
                    size={14}
                    color={track.soloed ? theme.warning : theme.textMuted}
                  />
                </Pressable>

                <Pressable
                  style={[styles.toggle, styles.toggleWide, pickerFor === track.id && styles.toggleOpen]}
                  onPress={() => setPickerFor(track.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: pickerFor === track.id }}
                  accessibilityLabel={`Change instrument for ${track.name}, currently ${instrumentName(track.program)}`}
                  {...(Platform.OS === 'web'
                    ? ({ title: `Instrument — currently ${instrumentName(track.program)}` } as any)
                    : null)}
                >
                  <MaterialCommunityIcons
                    name="guitar-acoustic"
                    size={14}
                    color={pickerFor === track.id ? theme.accent : theme.textMuted}
                  />
                  <Text
                    style={[styles.toggleText, pickerFor === track.id && styles.toggleTextOpen]}
                    numberOfLines={1}
                  >Instrument</Text>
                </Pressable>
              </View>

              {/* Row actions only on the selected track. Repeating "Convert to tabs" down
                  all 29 rows turned the panel into a wall of buttons and buried the thing
                  it exists for — the track names. */}
              {selected && onConvert && track.notes.length > 0 && (
                <View style={styles.rowActions}>
                  <Pressable
                    style={styles.convert}
                    onPress={() => onConvert(track.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Convert ${track.name} to harmonica tabs`}
                  >
                    <Text style={styles.convertText}>Convert to tabs</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <InstrumentPickerModal
        track={tracks.find((t) => t.id === pickerFor) ?? null}
        onPick={(program) => {
          if (pickerFor) onSetProgram(pickerFor, program);
          setPickerFor(null);
        }}
        onClose={() => setPickerFor(null)}
        theme={theme}
        styles={styles}
      />
    </View>
  );
}

/**
 * Instrument picker — a centred modal laid out as sixteen General MIDI family blocks.
 *
 * It used to be a 220px-tall scrolling list inside the track row itself, which made all
 * 128 programs reachable but organised only in the sense that they were in order: finding
 * "Overdriven Guitar" meant scrolling a narrow column past everything before it, in a panel
 * that also had to keep showing the tracks. GM's own structure is exactly eight programs
 * per family, so laying the families out side by side turns that one long scroll into
 * sixteen short, scannable groups — and the modal has the width to actually show them.
 */
function InstrumentPickerModal({ track, onPick, onClose, theme, styles }: {
  /** The track being changed, or null when the picker is closed. */
  track: MidiTrackData | null;
  onPick: (program: number) => void;
  onClose: () => void;
  theme: Theme;
  styles: ReturnType<typeof createStyles>;
}) {
  // Grouped once per render of an open picker rather than per family block, which would
  // otherwise walk all 128 programs sixteen times.
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
      visible={track !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* No accessibilityRole="button" on the backdrop/card — that's what makes
          react-native-web render a real <button>, and the rows inside genuinely need the
          role, which would nest one button in another. Same reasoning as the piano roll's
          own help modal. */}
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.modalTitle}>Instrument</Text>
              {track && (
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {track.name} · currently {instrumentName(track.program)}
                </Text>
              )}
            </View>
            <Pressable
              onPress={onClose}
              style={styles.modalCloseBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close instrument picker"
            >
              <Ionicons name="close" size={20} color={theme.textSub} />
            </Pressable>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <View style={styles.familyGrid}>
              {GM_FAMILIES.map((family) => (
                <View key={family} style={styles.familyBlock}>
                  <Text style={styles.familyHeading}>{family}</Text>
                  {(byFamily.get(family) ?? []).map((option) => {
                    const chosen = track?.program === option.program;
                    return (
                      <Pressable
                        key={option.program}
                        style={({ hovered }: any) => [
                          styles.pickerItem,
                          hovered && !chosen && styles.pickerItemHovered,
                          chosen && styles.pickerItemChosen,
                        ]}
                        onPress={() => onPick(option.program)}
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
    // Corner dismiss, matching every other closable surface in the app. Absolute so it
    // costs the row no height and can't be pushed around by a long track name.
    deleteTrack: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 18,
      height: 18,
      borderRadius: 5,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    list: { flex: 1 },
    row: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: t.separator,
      gap: 6,
      position: 'relative',
    },
    rowSelected: { backgroundColor: t.accentSoft },
    // paddingRight reserves the delete X's corner permanently, whether or not it's
    // currently shown — otherwise every track name would reflow the moment the pointer
    // entered its row.
    rowMain: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 18 },
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
    toggleText:     { fontFamily: Poppins.bold, fontSize: 11, color: t.textMuted },
    // Matches the guitar glyph beside it, which goes accent while the picker is open —
    // mute and solo carry their own state in the icon now and need no text variant.
    toggleTextOpen: { color: t.accent },
    convert: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8, paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: t.accentSoft,
      borderWidth: 1, borderColor: t.accentDim,
    },
    convertText: { fontFamily: Poppins.bold, fontSize: 11, color: t.accent },
    // Takes whatever the row has left after mute and solo, so the icon and the full word
    // fit at any panel width instead of being budgeted for the abbreviation it used to show.
    toggleWide: { flex: 1, flexDirection: 'row', gap: 5, paddingHorizontal: 6 },
    toggleOpen: { backgroundColor: t.accentSoft, borderColor: t.accentDim },

    // ─── Instrument picker modal ──────────────────────────────────────────────
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: WEB_CONTENT_WIDTH.wide,
      maxHeight: '85%',
      backgroundColor: t.bg,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      overflow: 'hidden',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    modalHeaderText: { flex: 1, minWidth: 0, gap: 2 },
    modalTitle: { fontFamily: Poppins.bold, fontSize: 16, color: t.textPrimary },
    modalSubtitle: { fontFamily: SpaceGrotesk.regular, fontSize: 12, color: t.textMuted },
    modalCloseBtn: {
      width: 30, height: 30, borderRadius: 8,
      alignItems: 'center', justifyContent: 'center',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    modalScroll: { flexGrow: 0 },
    modalScrollContent: { padding: 14 },
    // Families wrap into as many columns as the card's width allows. 160px is wide enough
    // for the longest GM name at this size ("Fretless Bass", "Synth Strings 1"), so a
    // block never has to truncate at the widths this card actually reaches.
    familyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    familyBlock: { minWidth: 160, flexGrow: 1, flexBasis: 160, gap: 1 },
    familyHeading: {
      fontFamily: Poppins.bold,
      fontSize: 10,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 8,
      paddingBottom: 4,
      marginBottom: 2,
      borderBottomWidth: 1,
      borderBottomColor: t.separator,
    },
    pickerItem: {
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    pickerItemHovered: { backgroundColor: t.surfaceAlt },
    pickerItemChosen: { backgroundColor: t.accentSoft },
    pickerItemText: { fontFamily: SpaceGrotesk.regular, fontSize: 12, color: t.textSub },
    pickerItemTextChosen: { fontFamily: Poppins.bold, color: t.accent },
  });
}
