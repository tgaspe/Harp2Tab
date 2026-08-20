import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import { PREFERS_REDUCED_MOTION, RADIUS } from '@/constants/ui';
import { NameRecordingModal } from '@/components/NameRecordingModal';
import { ActionSheetModal } from '@/components/ActionSheetModal';
import { CardMenu } from '@/components/CardMenu';
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
  /**
   * Whole-card hover.
   *
   * It used to live on `touchArea` — the middle Pressable — as `opacity: 0.7`, which lit
   * only the strip of text under the cursor and dimmed it rather than raising it. The card
   * is a single click target for the user, so the whole card is what should respond. Pointer
   * events rather than Pressable's `hovered` because the container has to stay a plain View:
   * the children are real <button>s and nesting buttons is invalid HTML (see below).
   */
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** The in-progress title while renaming on web. Seeded from the recording each time the
   *  field opens, so abandoning an edit and reopening starts from the saved name. */
  const [draft, setDraft] = useState(recording.title);

  /** Web renames in place on the card; native opens `NameRecordingModal`. */
  const inlineRename = isWeb && renaming;

  function beginRename() {
    setDraft(recording.title);
    setRenaming(true);
  }

  /** Empty or unchanged is a no-op rather than an error — there is nothing to tell someone
   *  who tabbed out of a field they did not mean to open. */
  function commitRename() {
    const next = draft.trim();
    if (next && next !== recording.title) onRename(recording.id, next);
    setRenaming(false);
  }

  const menuItems = [
    { icon: 'create-outline' as const, label: 'Rename', onPress: beginRename },
    {
      icon: 'trash-outline' as const,
      label: 'Delete',
      destructive: true,
      confirm: {
        title:        'Delete this recording?',
        body:         `"${recording.title}" and its tab will be removed. This can't be undone.`,
        confirmLabel: 'Delete',
      },
      onPress: () => onDelete(recording.id),
    },
  ];

  const moreButton = (
    <Pressable
      onPress={() => setMenuOpen((o) => !o)}
      style={styles.moreBtn}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`More options for ${recording.title}`}
      accessibilityState={{ expanded: menuOpen }}
    >
      <Ionicons name="ellipsis-horizontal" size={20} color={theme.textMuted} />
    </Pressable>
  );

  return (
    <>
      {/* Every interactive piece here (thumbnail play button, open-recording area, favorite
          star, more-options) is a sibling Pressable, not nested inside one another —
          react-native-web renders accessibilityRole="button" as a real <button>, and
          nesting <button> elements is invalid HTML (React warns/errors on it). */}
      <View
        style={[styles.card, hovered && styles.cardHovered]}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
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
        </Pressable>

        {/* Two shapes for the same block. While renaming it is a plain View: the field has
            to sit *outside* the open-recording Pressable, because that Pressable is a real
            <button> on web and an <input> inside a <button> is invalid HTML — the same
            constraint the note at the top of this component describes. Dropping the wrapper
            also stops a click meant for the text field from opening the recording. */}
        {inlineRename ? (
          <View style={styles.touchArea}>
            <View style={styles.info}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                autoFocus
                selectTextOnFocus
                style={styles.titleInput}
                onSubmitEditing={commitRename}
                onBlur={commitRename}
                // Escape abandons the edit. `onKeyPress` is the only place react-native-web
                // surfaces it — `onSubmitEditing` covers Enter and nothing else.
                onKeyPress={(e: any) => {
                  if (e.nativeEvent?.key === 'Escape') setRenaming(false);
                }}
                accessibilityLabel={`Rename ${recording.title}`}
                maxLength={80}
                returnKeyType="done"
              />
              <Text style={styles.meta} numberOfLines={1}>
                {recording.harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
                {' · '}{formatDuration(recording.duration)}
                {' · '}{recording.tabNotes.length} note{recording.tabNotes.length !== 1 ? 's' : ''} detected
              </Text>
              <Text style={styles.date} numberOfLines={1}>Enter saves · Esc cancels</Text>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => onPress(recording)}
            style={({ pressed }: any) => [
              styles.touchArea,
              pressed && styles.cardPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open recording ${recording.title}`}
          >
            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={1}>{recording.title}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {recording.harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
                {' · '}{formatDuration(recording.duration)}
                {' · '}{recording.tabNotes.length} note{recording.tabNotes.length !== 1 ? 's' : ''} detected
              </Text>
              <Text style={styles.date} numberOfLines={1}>{formatDate(recording.createdAt)}</Text>
            </View>
          </Pressable>
        )}

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

        {/* The trigger goes *inside* CardMenu on web so the menu owns the node it measures
            itself against — the panel renders in a portal and has no other way to find the
            button it belongs to. The button itself is unchanged either way. */}
        {isWeb ? (
          <CardMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            items={menuItems}
          >
            {moreButton}
          </CardMenu>
        ) : moreButton}
      </View>

      {/* Native keeps all three overlays. A bottom sheet with full-width rows and a centred
          rename dialog are the right controls on a phone; a 190px popover pinned to a 20px
          glyph is not. Web renders none of these — see `CardMenu` and the inline field. */}
      {!isWeb && (<>
        <ActionSheetModal
          visible={menuOpen}
          title={recording.title}
          options={[
            { label: 'Rename', onPress: beginRename },
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
      </>)}
    </>
  );
}

const isWeb = Platform.OS === 'web';

function createStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             12,
      backgroundColor: t.cardBg,
      borderRadius:    RADIUS.md,
      borderWidth:     1,
      borderColor:     t.border,
      paddingVertical: 10,
      paddingHorizontal: 14,
      // On the base style, not on `cardHovered` — a transition declared only in the hover
      // state animates the way in and snaps on the way out.
      ...(isWeb && !PREFERS_REDUCED_MOTION
        ? {
            transitionProperty:       'transform',
            transitionDuration:       '140ms',
            transitionTimingFunction: 'ease-out',
          } as any
        : null),
    },
    /**
     * The play control, and only that.
     *
     * It used to also carry the duration as an absolutely-positioned badge in its
     * bottom-right corner, which failed three ways at once: the badge was 27px wide inside
     * a 56px tile, it overlapped the 30px play glyph, and its square corner sat inside the
     * tile's 8px radius at a 4px inset, so the two curves fought. The badge-over-thumbnail
     * convention it was borrowing needs *artwork* to sit on top of — over a flat tint with
     * a play button, there is nothing for it to label but the button it is covering.
     *
     * The duration is in the meta line now, where it reads at 11px instead of 9px and costs
     * no layout at all.
     */
    thumb: {
      width:            56,
      height:           56,
      borderRadius:     RADIUS.sm,
      backgroundColor:  t.accentSoft,
      alignItems:       'center',
      justifyContent:   'center',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    thumbPressed: { opacity: 0.75 },
    touchArea: {
      flex:          1,
      minWidth:      0,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    /**
     * Hover grows the card instead of tinting it.
     *
     * 1.5% rather than the 2–3% a small tile could take: in list view this card is the full
     * width of the library column, so a percentage is a much bigger number of pixels here
     * than it looks — at 3% a 700px row would jump 20px and shoulder its neighbours.
     *
     * `zIndex` so the card that grew paints over the ones it now overlaps; the transition
     * itself lives on `card`, so the card eases back down on the way out as well as up.
     *
     * Reduced motion keeps the old colour hover rather than losing hover feedback
     * altogether — the point is to answer the cursor, and a tint answers it without moving.
     */
    cardHovered: PREFERS_REDUCED_MOTION
      ? { backgroundColor: t.cardHover, borderColor: t.border }
      : ({ transform: [{ scale: 1.015 }], zIndex: 1 } as ViewStyle),
    cardPressed: { opacity: 0.7 },
    info:  { gap: 3 },
    title: {
      fontSize:   FONT.base,
      fontFamily: Poppins.semiBold,
      color:      t.textPrimary,
    },
    // Sized and weighted exactly like `title`, so the row does not jump when the text
    // becomes a field. The accent border is the only thing that changes, and it is what
    // says "this is editable now".
    titleInput: {
      fontSize:          FONT.base,
      fontFamily:        Poppins.semiBold,
      color:             t.textPrimary,
      backgroundColor:   t.bg,
      borderWidth:       1,
      borderColor:       t.accent,
      borderRadius:      RADIUS.sm,
      paddingVertical:   3,
      paddingHorizontal: 7,
      // Negative to cancel the padding above: without it the field is visibly wider and
      // taller than the text it replaced and the whole card shifts on every rename.
      marginVertical:    -4,
      marginLeft:        -7,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
    } as any,
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
      borderRadius:      RADIUS.full,
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
