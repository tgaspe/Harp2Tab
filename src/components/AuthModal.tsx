/**
 * Sign in / create an account. One component, three hosts (7-8): the signed-out `/profile`,
 * the top bar, and the paywall's subscribe step.
 *
 * **Four states of one modal, not four routes.** Only `/auth/action` is a route, because
 * only it is arrived at from outside the app. Everything here is a bounded decision, which
 * is what `ConvertTrackModal` established as belonging in a modal.
 *
 * Two pieces of copy here are load-bearing and easy to get wrong later:
 *
 * - **The sign-in error cannot say "wrong password" or "no such account".** Firebase's email
 *   enumeration protection deliberately collapses both into one code, so the app genuinely
 *   does not know which it was. Guessing would be a lie; naming both is the honest form.
 * - **The post-submit panel is not a spinner.** The next thing the user has to do happens in
 *   their inbox, so the modal has to say so and name the address it went to.
 *
 * UI-only pass: the auth calls are inert (`useAuth`'s `notWired`), but every transition,
 * validation and error state below is real.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MIN_PASSWORD_LENGTH, PasswordField, strengthOf } from './PasswordField';
import { useAuth } from '@/auth/useAuth';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

type Mode = 'signUp' | 'signIn' | 'forgot' | 'sent';

interface Props {
  visible:      boolean;
  initialMode?: 'signUp' | 'signIn';
  onClose:      () => void;
  /** Shown under the heading. The paywall host uses it to say why sign-in is being asked
   *  for at that exact moment. */
  reason?:      string;
}

const HEADINGS: Record<Mode, string> = {
  signUp: 'Create your account',
  signIn: 'Welcome back',
  forgot: 'Reset your password',
  sent:   'Check your inbox',
};

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function AuthModal({ visible, initialMode = 'signUp', onClose, reason }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const auth   = useAuth();

  const [mode, setMode]         = useState<Mode>(initialMode);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [emailError, setEmailError]       = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError]         = useState<string | null>(null);
  /** Which flow produced the `sent` panel — the copy differs. */
  const [sentKind, setSentKind] = useState<'verify' | 'reset'>('verify');

  // Re-seed on open rather than carrying over whatever was typed last time. Same reasoning
  // as NameRecordingModal's effect.
  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setEmail('');
    setPassword('');
    setEmailError(null);
    setPasswordError(null);
    setFormError(null);
  }, [visible, initialMode]);

  function switchTo(next: Mode) {
    setMode(next);
    setEmailError(null);
    setPasswordError(null);
    setFormError(null);
  }

  function validate(needsPassword: boolean): boolean {
    let ok = true;
    if (!looksLikeEmail(email)) {
      setEmailError('Enter a valid email address.');
      ok = false;
    } else setEmailError(null);

    if (needsPassword) {
      if (mode === 'signUp' && password.length < MIN_PASSWORD_LENGTH) {
        setPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
        ok = false;
      } else if (password.length === 0) {
        setPasswordError('Enter your password.');
        ok = false;
      } else setPasswordError(null);
    }
    return ok;
  }

  async function handleSubmit() {
    setFormError(null);
    if (mode === 'forgot') {
      if (!validate(false)) return;
      setBusy(true);
      try {
        await auth.sendPasswordReset(email);
        setSentKind('reset');
        setMode('sent');
      } finally { setBusy(false); }
      return;
    }

    if (!validate(true)) return;
    setBusy(true);
    try {
      if (mode === 'signUp') {
        await auth.signUpWithEmail(email, password);
        setSentKind('verify');
        setMode('sent');
      } else {
        await auth.signInWithEmail(email, password);
        onClose();
      }
    } finally { setBusy(false); }
  }

  async function handleGoogle() {
    setBusy(true);
    try {
      await auth.signInWithGoogle();
      onClose();
    } finally { setBusy(false); }
  }

  const submitLabel =
    mode === 'signUp' ? 'Create account'
    : mode === 'signIn' ? 'Sign in'
    : 'Send reset link';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.headerRow}>
            <Text style={styles.heading}>{HEADINGS[mode]}</Text>
            <Pressable
              onPress={onClose}
              style={({ pressed, hovered }: any) => [
                styles.close,
                Platform.OS === 'web' && hovered && { opacity: 0.7 },
                pressed && { opacity: 0.5 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={theme.textMuted} />
            </Pressable>
          </View>

          {!!reason && mode !== 'sent' && <Text style={styles.reason}>{reason}</Text>}

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {mode === 'sent' ? (
              <SentPanel theme={theme} email={email} kind={sentKind} onBack={() => switchTo('signIn')} />
            ) : (
              <>
                {mode !== 'forgot' && (
                  <>
                    <Pressable
                      onPress={handleGoogle}
                      disabled={busy}
                      style={({ pressed, hovered }: any) => [
                        styles.googleBtn,
                        Platform.OS === 'web' && hovered && styles.googleBtnHovered,
                        pressed && { opacity: 0.8 },
                        busy && { opacity: 0.6 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Continue with Google"
                    >
                      <Ionicons name="logo-google" size={18} color={theme.textPrimary} />
                      <Text style={styles.googleBtnText}>Continue with Google</Text>
                    </Pressable>

                    {/* The provider column takes a third button without redesign — that is
                        Phase 9's Sign in with Apple, prepaid. */}

                    <View style={styles.dividerRow}>
                      <View style={styles.dividerLine} />
                      <Text style={styles.dividerText}>or</Text>
                      <View style={styles.dividerLine} />
                    </View>
                  </>
                )}

                {mode === 'forgot' && (
                  <Text style={styles.forgotHint}>
                    Enter the address you signed up with and we&apos;ll send you a link to set a
                    new password.
                  </Text>
                )}

                <View style={styles.field}>
                  <Text style={styles.fieldLabel} nativeID="email-label">Email</Text>
                  <TextInput
                    style={[styles.input, !!emailError && styles.inputError]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={theme.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    accessibilityLabelledBy="email-label"
                    accessibilityLabel="Email"
                  />
                  {!!emailError && (
                    <Text style={styles.error} accessibilityRole="alert">{emailError}</Text>
                  )}
                </View>

                {mode !== 'forgot' && (
                  <PasswordField
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder={mode === 'signUp' ? `At least ${MIN_PASSWORD_LENGTH} characters` : undefined}
                    showStrength={mode === 'signUp'}
                    error={passwordError ?? undefined}
                    onSubmitEditing={handleSubmit}
                  />
                )}

                {mode === 'signIn' && (
                  <Pressable
                    onPress={() => switchTo('forgot')}
                    style={({ pressed }) => [styles.linkWrap, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Forgot your password?"
                  >
                    <Text style={styles.link}>Forgot your password?</Text>
                  </Pressable>
                )}

                {!!formError && (
                  <Text style={styles.formError} accessibilityRole="alert">{formError}</Text>
                )}

                <Pressable
                  onPress={handleSubmit}
                  disabled={busy}
                  style={({ pressed, hovered }: any) => [
                    styles.primaryBtn,
                    Platform.OS === 'web' && hovered && !busy && { opacity: 0.9 },
                    pressed && { opacity: 0.85 },
                    busy && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={submitLabel}
                  accessibilityState={{ busy }}
                >
                  {busy
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.primaryBtnText}>{submitLabel}</Text>}
                </Pressable>

                <View style={styles.switchRow}>
                  {mode === 'signUp' && (
                    <SwitchLink
                      theme={theme}
                      prompt="Already have an account?"
                      action="Sign in"
                      onPress={() => switchTo('signIn')}
                    />
                  )}
                  {mode === 'signIn' && (
                    <SwitchLink
                      theme={theme}
                      prompt="New to Harp2Tab?"
                      action="Create an account"
                      onPress={() => switchTo('signUp')}
                    />
                  )}
                  {mode === 'forgot' && (
                    <SwitchLink
                      theme={theme}
                      prompt="Remembered it?"
                      action="Back to sign in"
                      onPress={() => switchTo('signIn')}
                    />
                  )}
                </View>
              </>
            )}
          </ScrollView>

          {auth.isMock && mode !== 'sent' && (
            <Text style={styles.mockNotice}>
              UI preview — these buttons are not connected yet.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SwitchLink({
  theme, prompt, action, onPress,
}: { theme: Theme; prompt: string; action: string; onPress: () => void }) {
  const styles = createStyles(theme);
  return (
    <View style={styles.switchInner}>
      <Text style={styles.switchPrompt}>{prompt}</Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={action}
      >
        <Text style={styles.link}>{action}</Text>
      </Pressable>
    </View>
  );
}

/** The panel after submitting. Deliberately not a spinner: the next step happens in another
 *  app, so the modal has to say what to go and do. */
function SentPanel({
  theme, email, kind, onBack,
}: { theme: Theme; email: string; kind: 'verify' | 'reset'; onBack: () => void }) {
  const styles = createStyles(theme);
  return (
    <View style={styles.sent}>
      <Ionicons name="mail-outline" size={40} color={theme.accent} />
      <Text style={styles.sentTitle}>
        {kind === 'verify' ? 'Confirm your email' : 'Reset link sent'}
      </Text>
      <Text style={styles.sentBody}>
        We sent {kind === 'verify' ? 'a confirmation link' : 'a link to set a new password'} to{' '}
        <Text style={styles.sentEmail}>{email}</Text>.
      </Text>
      <Text style={styles.sentHint}>
        {kind === 'verify'
          ? 'You can keep using Harp2Tab in the meantime — your tabs are saved on this device either way.'
          : 'The link expires after a while, so open it soon.'}
      </Text>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [styles.linkWrap, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="Back to sign in"
      >
        <Text style={styles.link}>Back to sign in</Text>
      </Pressable>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    backdrop: {
      flex:              1,
      backgroundColor:   'rgba(0,0,0,0.65)',
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 24,
    },
    card: {
      backgroundColor:   t.bg,
      borderRadius:      24,
      paddingHorizontal: 24,
      paddingTop:        20,
      paddingBottom:     22,
      width:             '100%',
      maxWidth:          420,
      // Capped and internally scrollable so the actions stay reachable on a short viewport
      // — the same constraint ConvertTrackModal solved.
      maxHeight:         '88%',
      borderWidth:       1,
      borderColor:       t.border,
      gap:               6,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    heading: {
      flex:          1,
      fontSize:      FONT.lg,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.3,
    },
    close: {
      padding: 4,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    reason: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 19,
    },
    body: { gap: 14, paddingTop: 12 },

    googleBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             10,
      borderWidth:     1,
      borderColor:     t.border,
      borderRadius:    14,
      paddingVertical: 13,
      backgroundColor: t.surface,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    googleBtnHovered: { backgroundColor: t.surfaceAlt },
    googleBtnText: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.textPrimary },

    dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    dividerLine: { flex: 1, height: 1, backgroundColor: t.separator },
    dividerText: { fontSize: FONT.xs, fontFamily: Poppins.regular, color: t.textMuted },

    forgotHint: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 19,
    },

    field: { gap: 6 },
    fieldLabel: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    input: {
      borderWidth:       1,
      borderColor:       t.border,
      borderRadius:      12,
      paddingHorizontal: 14,
      paddingVertical:   12,
      fontSize:          FONT.base,
      fontFamily:        Poppins.medium,
      color:             t.textPrimary,
      backgroundColor:   t.surface,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
    },
    inputError: { borderColor: t.record },
    error: { fontSize: FONT.xs, fontFamily: Poppins.medium, color: t.record, lineHeight: 16 },
    formError: {
      fontSize:        FONT.sm,
      fontFamily:      Poppins.medium,
      color:           t.record,
      backgroundColor: t.recordSoft,
      borderRadius:    10,
      padding:         10,
      lineHeight:      18,
    },

    linkWrap: { alignSelf: 'flex-start' },
    link: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.accent },

    primaryBtn: {
      backgroundColor: t.accent,
      borderRadius:    14,
      paddingVertical: 14,
      alignItems:      'center',
      justifyContent:  'center',
      minHeight:       48,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    primaryBtnText: { fontSize: FONT.base, fontFamily: Poppins.bold, color: '#fff' },

    switchRow: { alignItems: 'center' },
    switchInner: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
    switchPrompt: { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textSub },

    sent: { alignItems: 'center', gap: 10, paddingVertical: 12 },
    sentTitle: {
      fontSize:      FONT.md,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.2,
    },
    sentBody: {
      fontSize:   FONT.base,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      textAlign:  'center',
      lineHeight: 21,
    },
    sentEmail: { fontFamily: Poppins.semiBold, color: t.textPrimary },
    sentHint: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
      lineHeight: 17,
      marginTop:  2,
    },

    mockNotice: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
      marginTop:  10,
    },
  });
}
