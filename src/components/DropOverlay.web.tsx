/**
 * The "you're dragging a file over this page" state, drawn over the whole app shell.
 *
 * Purely a visual echo of a drag the user is already performing — it is not the drop target.
 * `useFileDrop` listens on `window`, so this stays `pointerEvents: none` and can never eat
 * the drop it is advertising, nor block a click if it ever outlived a drag.
 *
 * Hidden from assistive tech for the same reason: a drag is a pointer gesture no screen
 * reader user is mid-way through, and the outcome of a drop is announced by Home's existing
 * `role=alert` upload banner (or by the navigation to /import). The overlay would only be
 * noise. The upload *buttons* remain the keyboard and screen-reader path in — the commitment
 * written into `pickAudioFile` and `pickMidiFile` — and drag-and-drop is strictly additive
 * to them.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { PREFERS_REDUCED_MOTION, RADIUS } from '@/constants/ui';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

export function DropOverlay({ visible }: { visible: boolean }) {
  const theme  = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // A 120ms fade so the panel doesn't snap in over the page mid-gesture. Skipped outright
  // when the viewer has asked for less motion — there the overlay simply is or isn't.
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    const to = visible ? 1 : 0;
    if (PREFERS_REDUCED_MOTION) {
      opacity.setValue(to);
      return;
    }
    Animated.timing(opacity, { toValue: to, duration: 120, useNativeDriver: true }).start();
  }, [visible, opacity]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.overlay, { opacity }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // RNW does not derive aria-hidden from the two props above, and this is exactly the
      // kind of decorative layer the attribute exists for.
      {...{ 'aria-hidden': true }}
    >
      <View style={styles.panel}>
        <View style={styles.iconWrap}>
          <Ionicons name="cloud-upload-outline" size={30} color={theme.accentDeep} />
        </View>
        <Text style={styles.title}>Drop to import</Text>
        <Text style={styles.subtitle}>An audio or MIDI file — one at a time</Text>
      </View>
    </Animated.View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems:      'center',
      justifyContent:  'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      // Above the rail, the library column and any popover left open on the page — a drag is
      // modal in intent even though nothing here is a modal.
      zIndex:          100,
      padding:         24,
    },
    panel: {
      alignItems:      'center',
      gap:             10,
      maxWidth:        420,
      paddingVertical:   36,
      paddingHorizontal: 44,
      borderRadius:    RADIUS.lg,
      backgroundColor: theme.cardBg,
      // Dashed, because that is the one border treatment that reads as "a thing goes here"
      // rather than as a card that happens to be open.
      borderWidth:     2,
      borderStyle:     'dashed',
      borderColor:     theme.accent,
    },
    iconWrap: {
      width:           56,
      height:          56,
      borderRadius:    RADIUS.full,
      alignItems:      'center',
      justifyContent:  'center',
      backgroundColor: theme.accentSoft,
    },
    title: {
      fontSize:      FONT.lg,
      fontFamily:    SpaceGrotesk.bold,
      color:         theme.textPrimary,
      letterSpacing: -0.2,
    },
    subtitle: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      theme.textSub,
      textAlign:  'center',
    },
  });
}
