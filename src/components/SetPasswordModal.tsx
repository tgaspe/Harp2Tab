/**
 * "Add a password to your account" — the collection step for 7-5's linking.
 *
 * Separate from `AuthModal` on purpose, even though both collect a password. `AuthModal` is
 * the *signed-out* surface: it offers a provider choice, owns the sign-up/sign-in/reset state
 * machine, and clears its email field every time it opens. This is a signed-in account
 * management step with a fixed address and one decision. Folding it in would mean every later
 * change to the sign-in flow risks breaking account management, and vice versa.
 *
 * **The address is shown but not editable, and that is the whole point.** Linking a password
 * to a different address would give one account two identities that disagree about who owns
 * it — the data partition 7-5 exists to prevent. The field is display, not input.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View, type ViewStyle,
} from 'react-native';
import { MIN_PASSWORD_LENGTH, PasswordField } from './PasswordField';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

interface Props {
  visible: boolean;
  /** The account's address. Displayed so the user can see what they are adding a password to;
   *  never editable — see the note above. */
  email:   string;
  onConfirm: (password: string) => Promise<void>;
  onCancel:  () => void;
}

export function SetPasswordModal({ visible, email, onConfirm, onCancel }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [password, setPassword] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed on open rather than carrying over a password left in the field from last time —
  // the same reasoning as `NameRecordingModal`, and rather more pointed for a credential.
  useEffect(() => {
    if (!visible) return;
    setPassword('');
    setError(null);
    setBusy(false);
  }, [visible]);

  async function handleConfirm() {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onConfirm(password);
    } catch (err) {
      setError(err instanceof Error && err.message
        ? err.message
        : 'Could not add a password. Please try again.');
    } finally { setBusy(false); }
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
          <Text style={styles.title}>Add a password</Text>
          <Text style={styles.body}>
            You will be able to sign in with either this password or Google — both reach the
            same account and the same tabs.
          </Text>

          <View style={styles.emailRow}>
            <Text style={styles.emailLabel}>Email</Text>
            <Text style={styles.emailValue} numberOfLines={1}>{email}</Text>
          </View>

          <PasswordField
            label="New password"
            value={password}
            onChangeText={setPassword}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            showStrength
            autoFocus
            error={error ?? undefined}
            onSubmitEditing={handleConfirm}
          />

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={busy}
              style={({ pressed, hovered }: any) => [
                styles.btn,
                styles.btnPrimary,
                Platform.OS === 'web' && hovered && !busy && { opacity: 0.9 },
                pressed && { opacity: 0.85 },
                busy && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add password"
              accessibilityState={{ busy }}
            >
              {busy
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={[styles.btnText, styles.btnPrimaryText]}>Add password</Text>}
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
      flex:            1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems:      'center',
      justifyContent:  'center',
      padding:         24,
    },
    card: {
      width:           '100%',
      maxWidth:        420,
      backgroundColor: t.surface,
      borderRadius:    16,
      padding:         22,
      gap:             12,
    },
    title: {
      fontSize:      FONT.lg,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.3,
    },
    body: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 20,
    },
    emailRow: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'space-between',
      gap:             12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius:    10,
      backgroundColor: t.bg,
    },
    emailLabel: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.medium,
      color:      t.textMuted,
    },
    emailValue: {
      flexShrink: 1,
      fontSize:   FONT.sm,
      fontFamily: Poppins.medium,
      color:      t.textPrimary,
    },
    actions: {
      flexDirection:  'row',
      justifyContent: 'flex-end',
      gap:            10,
      marginTop:      4,
    },
    btn: {
      paddingVertical:   11,
      paddingHorizontal: 18,
      borderRadius:      10,
      minHeight:         42,
      alignItems:        'center',
      justifyContent:    'center',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    btnPrimary:     { backgroundColor: t.accent },
    btnText:        { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub },
    btnPrimaryText: { color: '#fff' },
  });
}
