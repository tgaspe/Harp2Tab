/**
 * The web paywall's plan chooser (8-5) — three plans, one selected.
 *
 * **Split from the native file rather than branched inside it**, because the two are not the
 * same screen with a flag. Native sells one thing, one time, through Play Billing, and the
 * copy it carries ("one-time purchase · no subscription") is a promise made to the person who
 * already bought it. Web sells subscriptions and that sentence is false there. A `Platform.OS`
 * ternary would have put a true promise and a false one in the same expression.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { WebPlan, WebPlanId } from '@/billing/plans';
import type { Theme } from '@/theme';

interface Props {
  plans:      WebPlan[];
  selectedId: WebPlanId;
  onSelect:   (id: WebPlanId) => void;
  /** Locked while a purchase is in flight — changing plan mid-checkout buys the wrong one. */
  disabled?:  boolean;
}

export function PlanPicker({ plans, selectedId, onSelect, disabled }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View
      style={styles.list}
      accessibilityRole="radiogroup"
      accessibilityLabel="Choose a plan"
    >
      {plans.map((plan) => {
        const selected = plan.id === selectedId;
        return (
          <Pressable
            key={plan.id}
            onPress={() => onSelect(plan.id)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!disabled }}
            // The price and cadence are read out too — a radio labelled only "Yearly" tells a
            // screen-reader user the least important half of the choice.
            accessibilityLabel={`${plan.name}, ${plan.price} ${plan.cadence}${plan.note ? `. ${plan.note}` : ''}`}
            style={({ pressed, hovered }: any) => [
              styles.card,
              selected && styles.cardSelected,
              !disabled && (hovered || pressed) && !selected && styles.cardHovered,
              disabled && styles.cardDisabled,
            ]}
          >
            {/* The radio is drawn rather than native, so its selected state survives the
                card's own background change in both themes. */}
            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>

            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text style={styles.name}>{plan.name}</Text>
                {plan.badge && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{plan.badge}</Text>
                  </View>
                )}
              </View>
              {plan.note && <Text style={styles.note}>{plan.note}</Text>}
            </View>

            <View style={styles.priceCol}>
              <Text style={styles.price}>{plan.price}</Text>
              <Text style={styles.cadence}>{plan.cadence}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    list: { alignSelf: 'stretch', gap: 10, marginBottom: 20 },

    card: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               12,
      borderWidth:       1,
      borderColor:       t.border,
      backgroundColor:   t.surface,
      borderRadius:      14,
      paddingVertical:   14,
      paddingHorizontal: 16,
      cursor:            'pointer',
    } as ViewStyle,
    cardSelected: { borderColor: t.accent, backgroundColor: t.accentSoft },
    cardHovered:  { borderColor: t.textMuted },
    cardDisabled: { opacity: 0.55, cursor: 'auto' } as ViewStyle,

    radio: {
      width:           20,
      height:          20,
      borderRadius:    10,
      borderWidth:     2,
      borderColor:     t.border,
      alignItems:      'center',
      justifyContent:  'center',
    },
    radioSelected: { backgroundColor: t.accent, borderColor: t.accent },

    body:     { flex: 1, gap: 2 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    name: {
      fontSize:   FONT.base,
      fontFamily: Poppins.bold,
      color:      t.textPrimary,
    },
    note: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
    },

    badge: {
      backgroundColor:   t.accent,
      borderRadius:      6,
      paddingHorizontal: 6,
      paddingVertical:   2,
    },
    badgeText: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         '#fff',
      letterSpacing: 0.3,
    },

    priceCol: { alignItems: 'flex-end' },
    price: {
      fontSize:   FONT.md,
      fontFamily: SpaceGrotesk.bold,
      color:      t.textPrimary,
    },
    cadence: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
    },
  });
}
