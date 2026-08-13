/**
 * "Confirm it's you" — password re-entry for a stale session.
 *
 * Firebase refuses account deletion, email changes and password changes on an old sign-in
 * with `auth/requires-recent-login`. Built once here because 7-4 and 7-13 both need it, and
 * because the users most likely to hit it are exactly the dormant ones who are deleting or
 * recovering — the worst audience for a raw error code.
 *
 * A Google-only account has no password to re-enter, so it re-authenticates through the
 * provider instead. Both paths land in the same modal so callers do not have to branch.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PasswordField } from './PasswordField';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { AuthProviderId } from '@/auth/types';
import type { Theme } from '@/theme';

interface Props {
  visible:  boolean;
  email:    string;
  /** Which methods the account has. Password re-entry is offered when it has one. */
  providers: AuthProviderId[];
  /** Why the app is asking, in the caller's words — "to delete your account", "to change
   *  your email". Vague re-auth prompts read as phishing. */
  reason:   string;
  onConfirm: (password?: string) => Promise<void>;
  onCancel:  () => void;
}

export function ReauthModal({ visible, email, providers, reason, onConfirm, onCancel }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const hasPassword = providers.includes('password');

  useEffect(() => {
    if (!visible) return;
    setPassword('');
    setBusy(false);
    setError(null);
  }, [visible]);

  async function handleConfirm() {
    if (hasPassword && password.length === 0) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(hasPassword ? password : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed-outline" size={22} color={theme.accent} />
          </View>

          <Text style={styles.title}>Confirm it&apos;s you</Text>
          <Text style={styles.body}>
            You signed in a while ago, so we need to check {reason}.
          </Text>
          <Text style={styles.email}>{email}</Text>

          {hasPassword ? (
            <PasswordField
              label="Password"
              value={password}
              onChangeText={setPassword}
              autoFocus
              error={error ?? undefined}
              onSubmitEditing={handleConfirm}
            />
          ) : (
            <Text style={styles.providerHint}>
              You sign in with Google, so we&apos;ll ask Google to confirm.
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed, hovered }: any) => [
                styles.cancelBtn,
                Platform.OS === 'web' && hovered && styles.cancelBtnHovered,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={handleConfirm}
              disabled={busy}
              style={({ pressed, hovered }: any) => [
                styles.confirmBtn,
                Platform.OS === 'web' && hovered && !busy && { opacity: 0.9 },
                pressed && { opacity: 0.85 },
                busy && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={hasPassword ? 'Confirm password' : 'Confirm with Google'}
              accessibilityState={{ busy }}
            >
              {busy
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.confirmBtnText}>{hasPassword ? 'Confirm' : 'Continue with Google'}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
      paddingVertical:   24,
      width:             '100%',
      maxWidth:          400,
      borderWidth:       1,
      borderColor:       t.border,
      gap:               10,
    },
    iconWrap: {
      alignSelf:       'center',
      width:           44,
      height:          44,
      borderRadius:    22,
      backgroundColor: t.accentSoft,
      alignItems:      'center',
      justifyContent:  'center',
    },
    title: {
      fontSize:      FONT.lg,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      textAlign:     'center',
      letterSpacing: -0.3,
    },
    body: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      textAlign:  'center',
      lineHeight: 19,
    },
    email: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textPrimary,
      textAlign:  'center',
      marginBottom: 4,
    },
    providerHint: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
      lineHeight: 17,
    },
    actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
    cancelBtn: {
      flex:            1,
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      paddingVertical: 14,
      alignItems:      'center',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    cancelBtnHovered: { backgroundColor: t.surface },
    cancelBtnText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub },
    confirmBtn: {
      flex:            1,
      borderRadius:    14,
      backgroundColor: t.accent,
      paddingVertical: 14,
      alignItems:      'center',
      justifyContent:  'center',
      minHeight:       48,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    confirmBtnText: { fontSize: FONT.sm, fontFamily: Poppins.bold, color: '#fff' },
  });
}
