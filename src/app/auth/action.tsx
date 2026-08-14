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
 * TODO(domain): **this page is not what Firebase's emails currently link to.** Two separate
 * things have to change when the domain lands, and missing the second is easy:
 *
 *  1. `authDomain` in `.env`, plus the Hosting `__/auth` rewrite described above.
 *  2. **The action URL on each email template** — Firebase console → Authentication →
 *     Templates → the pencil beside "action URL". It defaults to
 *     `https://harp2tab.firebaseapp.com/__/auth/action`, which is Firebase's own generic
 *     handler page, so until it is repointed here every verification and reset link lands
 *     there instead. The flow *works* — the address really is confirmed — it just happens on
 *     a page that is not ours.
 *
 * Switching also invalidates any link already sitting in someone's inbox. To exercise this
 * page before then, take the `oobCode` out of a real email's link and open
 * `/auth/action?mode=verifyEmail&oobCode=…` here: the code is valid whichever page spends it.
 * See the block in `src/auth/useAuth.ts` for the full deferral.
 *
 * Wired at 7-4. The `oobCode` in the URL is consumed for real; `?state=` survives as a
 * dev-only override so the expired and success panels stay reviewable without having to let
 * a real link go stale.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MIN_PASSWORD_LENGTH, PasswordField } from '@/components/PasswordField';
import { applyVerificationCode, checkPasswordResetCode, confirmPasswordReset } from '@/auth/auth';
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

  const params = useLocalSearchParams<{ mode?: string; state?: string; oobCode?: string }>();
  const mode    = (params.mode as Mode) || 'verifyEmail';
  const oobCode = typeof params.oobCode === 'string' ? params.oobCode : undefined;

  // `?state=` still forces the branch, but only in development — the expired panel is
  // otherwise reachable solely by waiting for a real link to rot. Ignored in production so a
  // shared URL cannot be made to claim an address was confirmed when it was not.
  const forced = __DEV__ ? (params.state as Outcome | undefined) : undefined;

  const [outcome, setOutcome] = useState<Outcome>(forced ?? 'working');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  /**
   * Consume the code on arrival.
   *
   * `verifyEmail` and `recoverEmail` complete here with nothing more to ask the user.
   * `resetPassword` only *validates* the code at this point — the actual change waits for the
   * new password below — which is why its success path leaves the form on screen rather than
   * jumping to a confirmation.
   *
   * Runs once. Action codes are single-use, so a re-run on re-render would spend the code and
   * then report it as already used, which is the same screen a genuinely expired link gets.
   */
  const consumed = useRef(false);
  useEffect(() => {
    if (forced || consumed.current) return;
    consumed.current = true;

    if (!oobCode) {
      // Reached without a code at all — a hand-typed URL, or a mail client that mangled the
      // link. Same remedy as expiry, so the same panel.
      setOutcome('invalid');
      return;
    }

    (async () => {
      try {
        if (mode === 'resetPassword') {
          await checkPasswordResetCode(oobCode);
          setOutcome('working');
        } else {
          await applyVerificationCode(oobCode);
          setOutcome('success');
        }
      } catch {
        // Deliberately not surfacing the underlying message: every failure here — expired,
        // already used, malformed — has one remedy, and `mapErrors` has already logged the
        // real cause for us.
        setOutcome('invalid');
      }
    })();
  }, [forced, mode, oobCode]);

  async function handleSetPassword() {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!oobCode) {
      setOutcome('invalid');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await confirmPasswordReset(oobCode, password);
      setOutcome('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password. Please try again.');
    } finally { setBusy(false); }
  }

  const goHome = () => router.replace('/app');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Checking, for the two modes that complete without asking anything. Without this
            the success panel would render while `applyActionCode` was still in flight — the
            app telling the user their address was confirmed slightly before it was, and
            still saying so if the call then failed. `resetPassword` is excluded because its
            `working` state is the form itself. */}
        {outcome === 'working' && mode !== 'resetPassword' ? (
          <View style={styles.panel}>
            <ActivityIndicator size="large" color={theme.accent} />
            <Text style={styles.body}>
              {mode === 'recoverEmail' ? 'Restoring your email address…' : 'Confirming your email…'}
            </Text>
          </View>
        ) : outcome === 'invalid' ? (
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

        {/* Development only. The codes are real now, so this line would be a lie in a build a
            user can reach — and `?state=` is ignored there anyway. */}
        {__DEV__ && (
          <Text style={styles.mockNotice}>
            Dev override — force a panel with{' '}
            <Text style={styles.mockCode}>?state=invalid</Text> or{' '}
            <Text style={styles.mockCode}>?state=success</Text>. Without it, the{' '}
            <Text style={styles.mockCode}>oobCode</Text> in the URL is consumed for real.
          </Text>
        )}
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
