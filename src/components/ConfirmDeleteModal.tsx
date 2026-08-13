/**
 * Account deletion confirmation.
 *
 * Two things this has to do that a generic "are you sure" does not:
 *
 * 1. **Say what is not deleted.** The tabs on this device are the user's work and they
 *    predate the account. Deleting the account leaves them alone, and someone about to press
 *    a red button deserves to know that before rather than after.
 * 2. **Cost more than a click.** Typing DELETE is friction on purpose — this is the one
 *    irreversible action in the app, and an accidental tap on a phone is a real way to lose
 *    an account.
 *
 * Deletion itself is a Play Store obligation, not a nicety: apps that let users create an
 * account must offer in-app deletion. Harp2Tab is already live, so this ships with accounts,
 * not after them.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

const CONFIRM_WORD = 'DELETE';

interface Props {
  visible:       boolean;
  tabCount:      number;
  projectCount:  number;
  onConfirm:     () => Promise<void>;
  onCancel:      () => void;
}

export function ConfirmDeleteModal({ visible, tabCount, projectCount, onConfirm, onCancel }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [typed, setTyped] = useState('');
  const [busy, setBusy]   = useState(false);

  useEffect(() => { if (visible) { setTyped(''); setBusy(false); } }, [visible]);

  const armed = typed.trim().toUpperCase() === CONFIRM_WORD && !busy;

  async function handleConfirm() {
    if (!armed) return;
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
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
            <Ionicons name="warning-outline" size={26} color={theme.record} />
          </View>

          <Text style={styles.title}>Delete your account?</Text>

          <Text style={styles.body}>
            This permanently deletes your account
            {tabCount + projectCount > 0 && (
              <>
                {' '}and the {tabCount} tab{tabCount === 1 ? '' : 's'}
                {projectCount > 0 && ` and ${projectCount} project${projectCount === 1 ? '' : 's'}`}
                {' '}synced to it
              </>
            )}
            . It cannot be undone.
          </Text>

          <View style={styles.keepNotice}>
            {/* See SyncStatusRow: `phone-portrait-outline` is tofu on web. */}
            <Ionicons name="save-outline" size={16} color={theme.textSub} />
            <Text style={styles.keepText}>
              The copies on this device stay where they are. Export them first if you want them
              somewhere else.
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel} nativeID="confirm-label">
              Type {CONFIRM_WORD} to confirm
            </Text>
            <TextInput
              style={styles.input}
              value={typed}
              onChangeText={setTyped}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={theme.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabelledBy="confirm-label"
              accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
              onSubmitEditing={handleConfirm}
            />
          </View>

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
              disabled={!armed}
              style={({ pressed, hovered }: any) => [
                styles.deleteBtn,
                !armed && styles.deleteBtnDisabled,
                Platform.OS === 'web' && hovered && armed && { opacity: 0.9 },
                pressed && armed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Delete account permanently"
              accessibilityState={{ disabled: !armed, busy }}
            >
              {busy
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.deleteBtnText}>Delete account</Text>}
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
      backgroundColor:   'rgba(0,0,0,0.7)',
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
      maxWidth:          420,
      borderWidth:       1,
      borderColor:       t.border,
      gap:               12,
    },
    iconWrap: {
      alignSelf:       'center',
      width:           48,
      height:          48,
      borderRadius:    24,
      backgroundColor: t.recordSoft,
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
      fontSize:   FONT.base,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      textAlign:  'center',
      lineHeight: 21,
    },
    keepNotice: {
      flexDirection:   'row',
      gap:             10,
      backgroundColor: t.surface,
      borderRadius:    12,
      borderWidth:     1,
      borderColor:     t.border,
      padding:         12,
    },
    keepText: {
      flex:       1,
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 17,
    },
    field: { gap: 6, marginTop: 2 },
    fieldLabel: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    input: {
      borderWidth:       1,
      borderColor:       t.border,
      borderRadius:      12,
      paddingHorizontal: 14,
      paddingVertical:   12,
      fontSize:          FONT.base,
      fontFamily:        SpaceGrotesk.medium,
      letterSpacing:     2,
      color:             t.textPrimary,
      backgroundColor:   t.surface,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
    },
    actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
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
    deleteBtn: {
      flex:            1,
      borderRadius:    14,
      backgroundColor: t.record,
      paddingVertical: 14,
      alignItems:      'center',
      justifyContent:  'center',
      minHeight:       48,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    deleteBtnDisabled: { backgroundColor: t.surfaceAlt },
    deleteBtnText: { fontSize: FONT.sm, fontFamily: Poppins.bold, color: '#fff' },
  });
}
