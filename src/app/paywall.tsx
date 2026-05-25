import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { useIAP } from '@/hooks/useIAP';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { RECORDING_LIMIT, useSettingsStore } from '@/store/useSettingsStore';
import type { Theme } from '@/theme';

const PERKS = [
  'Unlimited recordings',
  'Export to TXT, CSV, MIDI, MusicXML & JSON',
  'All future updates included',
];

export default function PaywallScreen() {
  const router       = useRouter();
  const theme        = useTheme();
  const styles       = useMemo(() => createStyles(theme), [theme]);
  const setPurchased = useSettingsStore((s) => s.setPurchased);

  const { product, purchasing, restoring, error, purchased, buy, restore } = useIAP();

  useEffect(() => {
    if (!purchased) return;
    setPurchased();
    router.back();
  }, [purchased]);

  const priceLabel = product?.displayPrice ?? '...';
  const busy       = purchasing || restoring;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Icon + title */}
        <View style={styles.hero}>
          <Image
            source={require('../../assets/images/harp2tab-icon.png')}
            style={styles.icon}
          />
          <Text style={styles.title}>Harp2Tab</Text>
          <Text style={styles.tagline}>
            You've used your {RECORDING_LIMIT} free recordings.
          </Text>
          <Text style={styles.sub}>
            Unlock the full app to keep recording and exporting your tabs.
          </Text>
        </View>

        {/* Price */}
        <View style={styles.priceBadge}>
          <Text style={styles.price}>{priceLabel}</Text>
          <Text style={styles.priceLabel}>one-time purchase · no subscription</Text>
        </View>

        {/* Perks */}
        <View style={styles.perks}>
          {PERKS.map((perk) => (
            <View key={perk} style={styles.perkRow}>
              <Ionicons name="checkmark-circle" size={18} color={theme.accent} />
              <Text style={styles.perkText}>{perk}</Text>
            </View>
          ))}
        </View>

        {/* Error */}
        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        {/* Purchase button */}
        <View style={styles.buttons}>
          <Pressable
            onPress={buy}
            disabled={busy || !product}
            style={({ pressed }) => [
              styles.buyBtn,
              (busy || !product) && styles.buyBtnDisabled,
              pressed && !busy && !!product && styles.buyBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Unlock Full App"
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="lock-open-outline" size={20} color="#fff" />
                <Text style={styles.buyBtnText}>Unlock Full App</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Restore */}
        <Pressable
          onPress={restore}
          disabled={busy}
          style={({ pressed }) => [styles.restoreBtn, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Restore Purchase"
        >
          {restoring
            ? <ActivityIndicator size="small" color={theme.textMuted} />
            : <Text style={styles.restoreBtnText}>Restore Purchase</Text>
          }
        </Pressable>

      </View>
    </SafeAreaView>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      paddingHorizontal: 28,
      paddingTop:        16,
      paddingBottom:     32,
      alignItems:        'center',
    },

    hero: {
      alignItems:   'center',
      gap:          10,
      marginTop:    24,
      marginBottom: 32,
    },
    icon: {
      width:        72,
      height:       72,
      marginBottom: 4,
    },
    title: {
      fontSize:      FONT['2xl'],
      fontFamily:    SpaceGrotesk.bold,
      color:         t.accent,
      letterSpacing: -0.5,
    },
    tagline: {
      fontSize:   FONT.md,
      fontFamily: SpaceGrotesk.bold,
      color:      t.textPrimary,
      textAlign:  'center',
    },
    sub: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      textAlign:  'center',
      lineHeight: 20,
    },

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
      fontFamily: Poppins.black,
      color:      t.accent,
    },
    priceLabel: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
    },

    perks: {
      alignSelf:    'stretch',
      gap:          12,
      marginBottom: 28,
    },
    perkRow: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           10,
    },
    perkText: {
      fontSize:   FONT.base,
      fontFamily: Poppins.medium,
      color:      t.textPrimary,
    },

    errorText: {
      fontSize:     FONT.xs,
      fontFamily:   Poppins.regular,
      color:        t.record,
      textAlign:    'center',
      marginBottom: 8,
    },

    buttons: {
      alignSelf: 'stretch',
      gap:       12,
    },
    buyBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             10,
      backgroundColor: t.accent,
      borderRadius:    14,
      paddingVertical: 18,
    },
    buyBtnDisabled: { backgroundColor: t.surface },
    buyBtnPressed:  { opacity: 0.85 },
    buyBtnText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.bold,
      color:      '#fff',
    },

    restoreBtn: {
      marginTop:      16,
      paddingVertical: 8,
      alignItems:      'center',
    },
    restoreBtnText: {
      fontSize:           FONT.sm,
      fontFamily:         Poppins.regular,
      color:              t.textMuted,
      textDecorationLine: 'underline',
    },
  });
}
