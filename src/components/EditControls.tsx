import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '@/theme';
import type { EditStyles } from '@/app/editStyles';

/**
 * The two primitive controls the editor's chrome is built from.
 *
 * Here rather than in `edit.tsx` for the same reason `editStyles.ts` exists: the transport
 * bar is made of these, and the transport bar is rendered by both the tab editor and the
 * MIDI Studio. Keeping them in the edit *route* module meant a second screen could only
 * reach them by importing that whole route.
 */

// Thin vertical rule separating logical clusters of controls within a toolbar row —
// used instead of just relying on `gap` so groups read as distinct at a glance.
export function Divider({ styles }: { styles: EditStyles }) {
  return <View style={styles.toolbarDivider} />;
}

// Shared icon-only control for the toolbar/transport bar — every one of these gets a
// hover tooltip (the brief specifically calls out "every icon should have a tooltip"),
// and a `variant` so secondary utility icons stay visually quiet while the handful of
// primary/active ones (Export, Metronome-on, Loop-on) stand out.
export function IconButton({
  icon, label, onPress, variant = 'ghost', disabled, selected, theme, styles, iconSize = 14,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  variant?: 'ghost' | 'primary' | 'active';
  disabled?: boolean;
  /** Exposed as accessibilityState.selected — for toggle buttons like Metronome/Loop
   *  (variant='active' drives the visual, this drives the a11y announcement). */
  selected?: boolean;
  theme: Theme;
  styles: EditStyles;
  iconSize?: number;
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const iconColor = disabled
    ? theme.textMuted
    : variant === 'ghost' ? theme.textSub : '#fff';

  return (
    <View style={styles.iconBtnWrap}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onHoverIn={() => setTooltipVisible(true)}
        onHoverOut={() => setTooltipVisible(false)}
        style={({ hovered }: any) => [
          styles.webIconBtn,
          variant === 'primary' && styles.webIconBtnAccent,
          variant === 'active' && styles.webIconBtnActive,
          variant === 'ghost' && !disabled && hovered && styles.webIconBtnHover,
          disabled && styles.webBtnDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, selected }}
      >
        <Ionicons name={icon} size={iconSize} color={iconColor} />
      </Pressable>
      {tooltipVisible && !disabled && (
        <View style={styles.tooltip} pointerEvents="none">
          <Text style={styles.tooltipText} numberOfLines={1}>{label}</Text>
        </View>
      )}
    </View>
  );
}
