import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { useIAP } from '@/hooks/useIAP';
import { AuthModal } from '@/components/AuthModal';
import { VerifyBanner } from '@/components/VerifyBanner';
import { useAuth } from '@/auth/useAuth';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FREE_TIER_ENABLED, RATING_BONUS, RECORDING_LIMIT, useSettingsStore } from '@/store/useSettingsStore';
import { PlanPicker } from '@/components/PlanPicker';
import { DEFAULT_PLAN_ID, PLAN_PERKS, type WebPlanId } from '@/billing/plans';
import { preserveSessionForPaywall } from '@/store/sessionSnapshot';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import type { Theme } from '@/theme';

/**
 * `VerifyBanner` awaits its callbacks and has no error surface of its own — an auth call that
 * rejects (rate limit, offline) would otherwise leave its spinner running forever. Swallowing
 * is right here: both actions are idempotent and re-pressable, and the banner already tells
 * the user what to do next.
 */
function safely(action: () => Promise<void>) {
  return async () => { try { await action(); } catch { /* re-pressable */ } };
}

export default function PaywallScreen() {
  const router       = useRouter();
  const theme        = useTheme();
  const styles       = useMemo(() => createStyles(theme), [theme]);
  const setPurchased  = useSettingsStore((s) => s.setPurchased);
  const ratingStatus  = useSettingsStore((s) => s.ratingStatus);
  const effectiveLimit = RECORDING_LIMIT + (ratingStatus === 'rated' ? RATING_BONUS : 0);

  const { product, purchasing, restoring, error, purchased, plans, buy, restore } = useIAP();

  const auth     = useAuth();
  const signedIn = auth.status === 'signedIn' && !!auth.user;
  const [authOpen, setAuthOpen] = useState(false);
  const [tookPreserved, setTookPreserved] = useState(false);

  /**
   * The selected plan (8-5). Web only — `PlanPicker.tsx` on native ignores it and renders the
   * single Play Billing price, because Android still sells one product.
   *
   * Defaults to annual, which is a revenue decision rather than a layout one: see
   * `DEFAULT_PLAN_ID`.
   */
  const [planId, setPlanId] = useState<WebPlanId>(DEFAULT_PLAN_ID);

  /**
   * **Verified email is required before purchase (7-4, landed here).** An entitlement attached
   * to an unverified address is attached to nobody — the address cannot be recovered, cannot
   * be contacted, and cannot prove ownership when the same person signs in on another device.
   *
   * So the account step has three states, not two: signed out, signed in but unconfirmed, and
   * ready. The middle one is the one that gets forgotten, and it is the one that produces a
   * paid customer with no way to reach their purchase.
   */
  const unverified  = signedIn && !auth.user!.emailVerified;
  const canPurchase = signedIn && !unverified;

  /**
   * Commit the in-progress take the moment this screen opens (7-6).
   *
   * Creating an account can finish in a different browser — an email confirmation link is not
   * guaranteed to open where it was requested — so anything unsaved has to be on disk before
   * the sign-in step starts, not after it succeeds. Runs once, before the user can press
   * anything, and does nothing when there is no take in progress.
   */
  useEffect(() => { setTookPreserved(preserveSessionForPaywall()); }, []);

  /**
   * **`setPurchased()` is native-only, and this is the line that enforces it (8-3).**
   *
   * That flag is a device-local, one-way latch — correct for Play's lifetime unlock, and wrong
   * for every subscription. Setting it on web would make a cancelled subscriber permanently
   * premium on that browser, with nothing able to revoke it: the entitlement store would say
   * "revoked" and this would still say "paid". Web access lives in the entitlement store,
   * which `useIAP.web.ts` has already written by the time this runs.
   */
  useEffect(() => {
    if (!purchased) return;
    if (Platform.OS !== 'web') setPurchased();
    router.back();
  }, [purchased]);

  const priceLabel = product?.displayPrice ?? '...';
  const busy       = purchasing || restoring;
  /**
   * Is there something to buy?
   *
   * **Native asks Play Billing; web asks the plan picker.** `product` is the one-time SKU
   * fetched by `react-native-iap` and web will never have one — gating the web button on it
   * left a permanently dead "Unlock Full App" with nothing saying why. Web's equivalent is a
   * selected plan, which 8-4 turns into a RevenueCat package.
   */
  const purchasable = Platform.OS === 'web' ? !!planId : !!product;

  /** Named once: it drives the press handler, the fill and the label colour, which drifted
   *  apart while it was three copies of the same expression. */
  const purchaseDisabled = unverified || (canPurchase && (busy || !purchasable));

  /**
   * **The button has to say what the money does (8-5).** "Unlock Full App" is true of a
   * one-time unlock and misleading in front of a plan picker offering two subscriptions: the
   * last thing a customer reads before paying should tell them whether this recurs.
   *
   * Native keeps the original wording — it still sells the single one-time SKU, and that is
   * the promise made to the buyer who already has one.
   */
  const purchaseLabel =
    Platform.OS !== 'web' ? 'Unlock Full App'
    : planId === 'lifetime' ? 'Buy Lifetime'
    : planId === 'yearly'   ? 'Subscribe yearly'
    : 'Subscribe monthly';

  /**
   * "Restore" means two different things, so it says two different things.
   *
   * Play re-reads the device's purchase history. A browser has no such history — the purchase
   * belongs to the account, so restoring is asking RevenueCat what this account holds. It is
   * also how a hand-issued grant (8-7) is collected, which is why it stays visible to someone
   * who has never bought anything here.
   */
  const restoreLabel = Platform.OS === 'web' ? 'Already paid? Restore access' : 'Restore Purchase';

  /**
   * Did a limit send them here, or did they choose to come?
   *
   * With `FREE_TIER_ENABLED` off there is no limit to have used, so "you've used your 3 free
   * recordings" is simply false — and it is the first sentence someone reads on the screen
   * that asks them for money. `/profile`'s Upgrade button (8-6) is the route that made this
   * reachable without a gate.
   */
  const gatedByLimit = FREE_TIER_ENABLED;

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
            {gatedByLimit
              ? `You've used your ${effectiveLimit} free recordings.`
              : 'Unlimited transcriptions, editing and export.'}
          </Text>
          <Text style={styles.sub}>
            Unlock the full app to keep recording and exporting your tabs.
          </Text>
        </View>

        {/* Plans (web) / the one-time price badge (native) — see PlanPicker's two files. */}
        <PlanPicker
          plans={plans}
          selectedId={planId}
          onSelect={setPlanId}
          disabled={busy}
          nativePrice={priceLabel}
        />

        {/* Perks */}
        <View style={styles.perks}>
          {PLAN_PERKS.map((perk) => (
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
        {!signedIn && (
          <View style={styles.accountStep}>
            <Ionicons name="person-circle-outline" size={16} color={theme.textSub} />
            <Text style={styles.accountStepText}>
              You&apos;ll create an account next, so your purchase works on every device.
            </Text>
          </View>
        )}

        {/* The banner, not just a message about one: "confirm your email" with no way to
            resend or re-check from this screen would send the user hunting for /profile at the
            exact moment they were trying to pay. Same component /profile uses, so the resend
            cooldown and the "I've confirmed" reload behave identically in both places. */}
        {unverified && (
          <View style={styles.verifyBlock}>
            <VerifyBanner
              email={auth.user!.email ?? ''}
              onResend={safely(auth.resendVerification)}
              onIVerified={safely(auth.reloadUser)}
              title="Confirm your email before paying"
              body={'We send your receipt and your access there, and an unconfirmed address '
                  + "can't be recovered."}
            />
          </View>
        )}

        {canPurchase && (
          <View style={styles.accountStep}>
            <Ionicons name="checkmark-circle" size={16} color={theme.success} />
            <Text style={styles.accountStepText} numberOfLines={1}>
              Purchasing as {auth.user!.email}
            </Text>
          </View>
        )}

        {/* Purchase button */}
        <View style={styles.buttons}>
          <Pressable
            onPress={canPurchase ? () => buy(planId) : () => setAuthOpen(true)}
            disabled={purchaseDisabled}
            style={({ pressed, hovered }: any) => [
              styles.buyBtn,
              purchaseDisabled && styles.buyBtnDisabled,
              (pressed || (Platform.OS === 'web' && hovered))
                && !purchaseDisabled && styles.buyBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: purchaseDisabled }}
            accessibilityLabel={
              unverified   ? 'Confirm your email address before purchasing'
              : canPurchase ? 'Unlock Full App'
              : 'Continue to create your account'
            }
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons
                  name={
                    unverified   ? 'mail-outline'
                    : canPurchase ? 'lock-open-outline'
                    : 'arrow-forward-outline'
                  }
                  size={20}
                  color={purchaseDisabled ? theme.textMuted : '#fff'}
                />
                <Text style={[styles.buyBtnText, purchaseDisabled && styles.buyBtnTextDisabled]}>
                  {unverified   ? 'Confirm your email first'
                  : canPurchase ? purchaseLabel
                  : 'Continue'}
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
          accessibilityLabel={restoreLabel}
        >
          {restoring
            ? <ActivityIndicator size="small" color={theme.textMuted} />
            : <Text style={styles.restoreBtnText}>{restoreLabel}</Text>
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

    verifyBlock: { alignSelf: 'stretch', gap: 10, marginBottom: 4 },

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
    buyBtnDisabled: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
    buyBtnPressed:  { opacity: 0.85 },
    buyBtnText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.bold,
      color:      '#fff',
    },
    /* White on `surface` is invisible. Harmless while it only flashed during product load;
       "Confirm your email first" is a state the user sits in and reads. */
    buyBtnTextDisabled: { color: t.textMuted },

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
