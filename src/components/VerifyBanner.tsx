/**
 * "Confirm your email to turn on sync."
 *
 * Two details here are the difference between this working and generating support mail:
 *
 * 1. **The explicit "I've confirmed" button.** Firebase signs unverified users in happily,
 *    and the token it caches keeps saying `emailVerified: false` after the user clicks the
 *    link in another tab. No auth event fires for it. Without a manual reload, the app tells
 *    someone who just verified that they have not — the single most common complaint about
 *    this flow.
 * 2. **A visible resend cooldown.** Firebase rate-limits verification mail, so an
 *    unthrottled button eventually starts failing silently. A countdown that says "wait 47s"
 *    is honest; a button that quietly stops working is not.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

/** Long enough to stay clear of the provider's own limit, short enough not to feel punitive. */
const RESEND_COOLDOWN_SECONDS = 60;

interface Props {
  email:      string;
  onResend:   () => Promise<void>;
  onIVerified: () => Promise<void>;
}

export function VerifyBanner({ email, onResend, onIVerified }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [cooldown, setCooldown] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function handleResend() {
    if (cooldown > 0) return;
    setCooldown(RESEND_COOLDOWN_SECONDS);
    await onResend();
  }

  async function handleVerified() {
    setChecking(true);
    try {
      await onIVerified();
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="mail-unread-outline" size={22} color={theme.warningDim} style={styles.icon} />

      <View style={styles.body}>
        <Text style={styles.title}>Confirm your email to turn on sync</Text>
        <Text style={styles.desc}>
          We sent a link to <Text style={styles.email}>{email}</Text>. Everything else works in
          the meantime — your tabs are saved on this device.
        </Text>

        <View style={styles.actions}>
          <Pressable
            onPress={handleVerified}
            disabled={checking}
            style={({ pressed, hovered }: any) => [
              styles.primary,
              Platform.OS === 'web' && hovered && !checking && { opacity: 0.9 },
              pressed && { opacity: 0.85 },
              checking && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="I have confirmed my email"
            accessibilityState={{ busy: checking }}
          >
            {checking
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.primaryText}>I&apos;ve confirmed</Text>}
          </Pressable>

          <Pressable
            onPress={handleResend}
            disabled={cooldown > 0}
            style={({ pressed, hovered }: any) => [
              styles.secondary,
              Platform.OS === 'web' && hovered && cooldown === 0 && styles.secondaryHovered,
              pressed && cooldown === 0 && { opacity: 0.6 },
              cooldown > 0 && { opacity: 0.5 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              cooldown > 0 ? `Resend available in ${cooldown} seconds` : 'Resend confirmation email'
            }
            accessibilityState={{ disabled: cooldown > 0 }}
          >
            <Text style={styles.secondaryText}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    banner: {
      flexDirection:   'row',
      gap:             12,
      backgroundColor: t.warningSoft,
      borderWidth:     1,
      borderColor:     t.warning,
      borderRadius:    16,
      padding:         16,
    },
    icon: { marginTop: 2 },
    body: { flex: 1, gap: 6 },
    title: {
      fontSize:      FONT.base,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.2,
    },
    desc: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 19,
    },
    email: { fontFamily: Poppins.semiBold, color: t.textPrimary },
    actions: {
      flexDirection: 'row',
      gap:           8,
      marginTop:     6,
      flexWrap:      'wrap',
    },
    primary: {
      backgroundColor:   t.warningDim,
      borderRadius:      12,
      paddingHorizontal: 16,
      paddingVertical:   9,
      minWidth:          124,
      alignItems:        'center',
      justifyContent:    'center',
    },
    primaryText: { fontSize: FONT.sm, fontFamily: Poppins.bold, color: '#fff' },
    secondary: {
      borderRadius:      12,
      borderWidth:       1,
      borderColor:       t.warning,
      paddingHorizontal: 16,
      paddingVertical:   9,
      justifyContent:    'center',
    },
    secondaryHovered: { backgroundColor: t.warningSoft },
    secondaryText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.warningDim },
  });
}
