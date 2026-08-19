/**
 * The native paywall's price block (8-5) — deliberately unchanged from what ships today.
 *
 * Android sells one thing: the one-time `harp2tab_premium` unlock through Play Billing. Phase
 * 8 is web-only (see 8-1), so this file exists to keep the shared paywall screen compiling
 * against one component name while the web half grows three plans — not to eventually become
 * them.
 *
 * **"one-time purchase · no subscription" stays here, and only here.** It is true on this
 * platform and it is the promise the existing Play buyer made his purchase against; the web
 * file drops it because there it would be a lie.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Poppins } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { WebPlan, WebPlanId } from '@/billing/plans';
import type { Theme } from '@/theme';

interface Props {
  plans:      WebPlan[];
  selectedId: WebPlanId;
  onSelect:   (id: WebPlanId) => void;
  disabled?:  boolean;
  /** Play Billing's localised price for the one-time SKU. `plans` is unused on native. */
  nativePrice?: string;
}

export function PlanPicker({ nativePrice }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.priceBadge}>
      <Text style={styles.price}>{nativePrice ?? '...'}</Text>
      <Text style={styles.priceLabel}>one-time purchase · no subscription</Text>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    priceBadge: {
      alignItems:        'center',
      backgroundColor:   t.accentSoft,
      borderRadius:      14,
      borderWidth:       1,
      borderColor:       t.accent,
      paddingVertical:   12,
      paddingHorizontal: 24,
      alignSelf:         'stretch',
      marginBottom:      28,
      gap:               4,
    },
    price: {
      fontSize:   FONT['2xl'],
      fontFamily: Poppins.extraBold,
      color:      t.accent,
    },
    priceLabel: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
    },
  });
}
