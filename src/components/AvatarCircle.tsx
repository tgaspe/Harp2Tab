/**
 * The user's initials in a filled circle.
 *
 * No photos, by decision (2026-08-12): Google supplies a `photoURL` and an email signup does
 * not, so honouring photos would make email accounts look second-class, add a loading and a
 * broken-image state, and put an external request on a page that otherwise makes none.
 * Initials treat both providers identically.
 *
 * **Filled with `accent`** — the app's brand colour, matching every other filled element
 * (the primary buttons, the sidebar rails, the segmented actives). Chosen for that
 * consistency on 2026-08-12, over the `accentDeep` this first used.
 *
 * Noted rather than argued: white on `accent` measures 2.21:1, and `theme/index.ts:8-10`
 * says as much in its own comment. Every filled button in the app already sits at that
 * ratio, so this is the house style rather than a regression introduced here. Dark initials
 * (`textPrimary`) on the same fill would measure 8.7:1 if legibility ever needs to win.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SpaceGrotesk } from '@/constants/fonts';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

interface Props {
  initials: string;
  /** Diameter in px. 64 on the profile header, 28 in the top bar. */
  size?:    number;
}

export function AvatarCircle({ initials, size = 64 }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
      // The initials are decoration — the name and email sit next to them in every host, so
      // announcing "TG" as well would just be noise to a screen reader.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.text, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    circle: {
      backgroundColor: t.accent,
      alignItems:      'center',
      justifyContent:  'center',
    },
    text: {
      color:         '#fff',
      fontFamily:    SpaceGrotesk.bold,
      letterSpacing: 0.5,
    },
  });
}
