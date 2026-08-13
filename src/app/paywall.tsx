import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { useIAP } from '@/hooks/useIAP';
import { AuthModal } from '@/components/AuthModal';
import { useAuth } from '@/auth/useAuth';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { RATING_BONUS, RECORDING_LIMIT, useSettingsStore } from '@/store/useSettingsStore';
import { preserveSessionForPaywall } from '@/store/sessionSnapshot';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
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
  const setPurchased  = useSettingsStore((s) => s.setPurchased);
  const ratingStatus  = useSettingsStore((s) => s.ratingStatus);
  const effectiveLimit = RECORDING_LIMIT + (ratingStatus === 'rated' ? RATING_BONUS : 0);

  const { product, purchasing, restoring, error, purchased, buy, restore } = useIAP();

  const auth     = useAuth();
  const signedIn = auth.status === 'signedIn' && !!auth.user;
  const [authOpen, setAuthOpen] = useState(false);
  const [tookPreserved, setTookPreserved] = useState(false);

  /**
   * Commit the in-progress take the moment this screen opens (7-6).
   *
   * Creating an account can finish in a different browser — an email confirmation link is not
   * guaranteed to open where it was requested — so anything unsaved has to be on disk before
   * the sign-in step starts, not after it succeeds. Runs once, before the user can press
   * anything, and does nothing when there is no take in progress.
   */
  useEffect(() => { setTookPreserved(preserveSessionForPaywall()); }, []);

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
            You've used your {effectiveLimit} free recordings.
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

        {/* Saving is invisible otherwise, and an invisible save is one the user cannot rely
            on — which is the whole reason it happens here. */}
        {tookPreserved && (
          <View style={styles.accountStep}>
            <Ionicons name="save-outline" size={16} color={theme.success} />
            <Text style={styles.accountStepText}>
              Your current take is saved to your library — it will be here when you get back.
            </Text>
          </View>
        )}

        {/* Account step (7-6).
            Sign-in happens *before* the purchase call, never after: an entitlement that
            arrives before the identity it belongs to is precisely the reconciliation problem
            Phase 8 exists to avoid, recreated on purpose. This is also the only place in the
            app where an account is required — everything else stays free and signed out. */}
        {signedIn ? (
          <View style={styles.accountStep}>
            <Ionicons name="checkmark-circle" size={16} color={theme.success} />
            <Text style={styles.accountStepText} numberOfLines={1}>
              Purchasing as {auth.user!.email}
            </Text>
          </View>
        ) : (
          <View style={styles.accountStep}>
            <Ionicons name="person-circle-outline" size={16} color={theme.textSub} />
            <Text style={styles.accountStepText}>
              You&apos;ll create an account next, so your purchase works on every device.
            </Text>
          </View>
        )}

        {/* Purchase button */}
        <View style={styles.buttons}>
          <Pressable
            onPress={signedIn ? buy : () => setAuthOpen(true)}
            disabled={signedIn && (busy || !product)}
            style={({ pressed, hovered }: any) => [
              styles.buyBtn,
              signedIn && (busy || !product) && styles.buyBtnDisabled,
              (pressed || (Platform.OS === 'web' && hovered)) && !busy && (!signedIn || !!product) && styles.buyBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={signedIn ? 'Unlock Full App' : 'Continue to create your account'}
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons
                  name={signedIn ? 'lock-open-outline' : 'arrow-forward-outline'}
                  size={20}
                  color="#fff"
                />
                <Text style={styles.buyBtnText}>
                  {signedIn ? 'Unlock Full App' : 'Continue'}
                </Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Restore */}
        <Pressable
          onPress={restore}
          disabled={busy}
          style={({ pressed, hovered }: any) => [
            styles.restoreBtn,
            (pressed || (Platform.OS === 'web' && hovered)) && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Restore Purchase"
        >
          {restoring
            ? <ActivityIndicator size="small" color={theme.textMuted} />
            : <Text style={styles.restoreBtnText}>Restore Purchase</Text>
          }
        </Pressable>

      </View>

      <AuthModal
        visible={authOpen}
        initialMode="signUp"
        onClose={() => setAuthOpen(false)}
        reason="Your purchase is tied to your account, so it works on every device you play on — including the web version."
      />
    </SafeAreaView>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    accountStep: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               8,
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
      borderRadius:      12,
      paddingHorizontal: 14,
      paddingVertical:   10,
    },
    accountStepText: {
      flex:       1,
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 16,
    },
    container: {
      flex: 1,
      ...webMaxWidth(WEB_CONTENT_WIDTH.narrow),
      paddingHorizontal: 28,
      paddingTop:        16,
      paddingBottom:     Platform.OS === 'web' ? WEB_SCREEN_PADDING_BOTTOM : 32,
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
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
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
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    restoreBtnText: {
      fontSize:           FONT.sm,
      fontFamily:         Poppins.regular,
      color:              t.textMuted,
      textDecorationLine: 'underline',
    },
  });
}
