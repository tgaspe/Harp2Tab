/**
 * `/auth/action` — the one route arrived at from *outside* the app.
 *
 * Firebase sends email verification, password reset and email-change-revocation to a single
 * action handler URL, distinguished by a `mode` query parameter. So this is one route with
 * three jobs, not three routes:
 *
 *   ?mode=verifyEmail   &oobCode=…   → confirm the address
 *   ?mode=resetPassword &oobCode=…   → set a new password
 *   ?mode=recoverEmail  &oobCode=…   → undo an email change someone else made
 *
 * Every branch needs an expired/already-used state. These links are clicked out of an inbox,
 * sometimes days later, and a blank screen at that moment is indistinguishable from a broken
 * product.
 *
 * **It must be a real exported route.** `web.output: "static"` (app.json) means no server
 * rewrites unknown paths, so a client-only redirect target does not exist as HTML and a cold
 * load 404s. A Firebase Hosting rewrite is needed alongside it.
 *
 * UI-only pass: nothing is verified and no code is consumed. `?mode=` drives the branch and
 * `?state=` forces the outcome so every screen can be reviewed.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MIN_PASSWORD_LENGTH, PasswordField } from '@/components/PasswordField';
import { useTheme } from '@/hooks/useTheme';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { webMaxWidth, WEB_CONTENT_WIDTH } from '@/constants/layout';
import type { Theme } from '@/theme';

type Mode = 'verifyEmail' | 'resetPassword' | 'recoverEmail';
/** `invalid` covers expired and already-used alike — Firebase does not reliably distinguish
 *  them, and for the user the remedy is identical: start the flow again. */
type Outcome = 'working' | 'success' | 'invalid';

export default function AuthActionScreen() {
  const router = useRouter();
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const params = useLocalSearchParams<{ mode?: string; state?: string }>();
  const mode = (params.mode as Mode) || 'verifyEmail';

  // UI-only: `?state=` forces the branch. With real auth this comes from applyActionCode /
  // verifyPasswordResetCode.
  const forced = params.state as Outcome | undefined;
  const [outcome, setOutcome] = useState<Outcome>(forced ?? (mode === 'resetPassword' ? 'working' : 'success'));

  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSetPassword() {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      console.warn('[7a-UI] confirmPasswordReset is not wired yet — this pass is UI only.');
      setOutcome('success');
    } finally { setBusy(false); }
  }

  const goHome = () => router.replace('/');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {outcome === 'invalid' ? (
          <Panel
            theme={theme}
            icon="time-outline"
            tint={theme.warning}
            title="This link has expired"
            body={
              mode === 'resetPassword'
                ? 'Password links are only good for a short while. Request a new one and we will send another.'
                : 'Confirmation links are only good for a short while. Sign in and we will send you a fresh one.'
            }
            primary={{ label: 'Back to Harp2Tab', onPress: goHome }}
          />
        ) : mode === 'resetPassword' && outcome === 'working' ? (
          <View style={styles.form}>
            <View style={[styles.iconWrap, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="key-outline" size={26} color={theme.accent} />
            </View>
            <Text style={styles.title}>Set a new password</Text>
            <Text style={styles.body}>
              Choose something you have not used elsewhere. Length matters more than symbols.
            </Text>

            <View style={styles.field}>
              <PasswordField
                label="New password"
                value={password}
                onChangeText={setPassword}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                showStrength
                autoFocus
                error={error ?? undefined}
                onSubmitEditing={handleSetPassword}
              />
            </View>

            <Pressable
              onPress={handleSetPassword}
              disabled={busy}
              style={({ pressed, hovered }: any) => [
                styles.primaryBtn,
                Platform.OS === 'web' && hovered && !busy && { opacity: 0.9 },
                pressed && { opacity: 0.85 },
                busy && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save new password"
              accessibilityState={{ busy }}
            >
              {busy
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.primaryBtnText}>Save new password</Text>}
            </Pressable>
          </View>
        ) : mode === 'resetPassword' ? (
          <Panel
            theme={theme}
            icon="checkmark-circle-outline"
            tint={theme.success}
            title="Password updated"
            body="You can sign in with your new password now."
            primary={{ label: 'Back to Harp2Tab', onPress: goHome }}
          />
        ) : mode === 'recoverEmail' ? (
          <Panel
            theme={theme}
            icon="shield-checkmark-outline"
            tint={theme.success}
            title="Email change undone"
            body="Your account is back on its original address. If you did not make that change, set a new password as well — someone may have had access."
            primary={{ label: 'Back to Harp2Tab', onPress: goHome }}
          />
        ) : (
          <Panel
            theme={theme}
            icon="checkmark-circle-outline"
            tint={theme.success}
            title="Email confirmed"
            body="That is everything. Your tabs will sync across your devices from here on."
            primary={{ label: 'Back to Harp2Tab', onPress: goHome }}
          />
        )}

        <Text style={styles.mockNotice}>
          UI preview — no code is being verified. Try{' '}
          <Text style={styles.mockCode}>?mode=resetPassword</Text>,{' '}
          <Text style={styles.mockCode}>?mode=recoverEmail</Text>,{' '}
          <Text style={styles.mockCode}>?state=invalid</Text>.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function Panel({
  theme, icon, tint, title, body, primary,
}: {
  theme:   Theme;
  icon:    React.ComponentProps<typeof Ionicons>['name'];
  tint:    string;
  title:   string;
  body:    string;
  primary: { label: string; onPress: () => void };
}) {
  const styles = createStyles(theme);
  return (
    <View style={styles.panel}>
      <View style={[styles.iconWrap, { backgroundColor: `${tint}22` }]}>
        <Ionicons name={icon} size={28} color={tint} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <Pressable
        onPress={primary.onPress}
        style={({ pressed, hovered }: any) => [
          styles.primaryBtn,
          styles.primaryBtnWide,
          Platform.OS === 'web' && hovered && { opacity: 0.9 },
          pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={primary.label}
      >
        <Text style={styles.primaryBtnText}>{primary.label}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    container: {
      flex:              1,
      // `narrow` — the same bucket as the paywall and onboarding, which is exactly what this
      // is: a single-CTA flow with nothing else on the page.
      ...webMaxWidth(WEB_CONTENT_WIDTH.narrow),
      paddingHorizontal: 24,
      justifyContent:    'center',
      gap:               24,
    },
    panel: { alignItems: 'center', gap: 12 },
    form:  { gap: 14 },
    iconWrap: {
      alignSelf:      'center',
      width:          56,
      height:         56,
      borderRadius:   28,
      alignItems:     'center',
      justifyContent: 'center',
    },
    title: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      textAlign:     'center',
      letterSpacing: -0.5,
    },
    body: {
      fontSize:   FONT.base,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      textAlign:  'center',
      lineHeight: 22,
    },
    field: { marginTop: 4 },
    primaryBtn: {
      backgroundColor: t.accent,
      borderRadius:    14,
      paddingVertical: 14,
      alignItems:      'center',
      justifyContent:  'center',
      minHeight:       48,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    primaryBtnWide:  { alignSelf: 'stretch', marginTop: 8 },
    primaryBtnText:  { fontSize: FONT.base, fontFamily: Poppins.bold, color: '#fff' },
    mockNotice: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
      lineHeight: 18,
    },
    mockCode: { fontFamily: SpaceGrotesk.medium, color: t.textSub },
  });
}
