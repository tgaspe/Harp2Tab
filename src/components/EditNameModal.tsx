/**
 * "What should we call you?" — the display-name editor for `/profile`.
 *
 * **Why not `NameRecordingModal`, which does the same job.** `/profile` reused it first, and
 * it read as a phone sheet dropped into a desktop page: the card is `width: '100%'` with no
 * ceiling, so it stretches to within 32px of both screen edges on a wide viewport; the title
 * is centred; and the buttons are `flex: 1`, sized for a thumb rather than a cursor. Those
 * are the right choices where it is used — a recording is named on a phone, mid-session —
 * and the wrong ones here.
 *
 * This one follows the same language as `SetPasswordModal` beside it, so the two dialogs on
 * this page are siblings: a bounded card, a left-aligned heading, and content-sized actions
 * on the right where a pointer expects them.
 *
 * `NameRecordingModal` is deliberately left alone rather than made responsive — it has its
 * own callers whose behaviour was not asked to change.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type ViewStyle,
} from 'react-native';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

interface Props {
  visible: boolean;
  /** Current name, or '' when none is set. Seeded into the field on open. */
  initialName: string;
  onConfirm:   (name: string) => Promise<void> | void;
  onCancel:    () => void;
}

export function EditNameModal({ visible, initialName, onConfirm, onCancel }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(initialName);
    setBusy(false);
  }, [visible, initialName]);

  /**
   * Escape closes it.
   *
   * React Native's `Modal` maps `onRequestClose` to the Android back button and nothing on
   * web, so without this the only way out is the Cancel button — and Escape is the first
   * thing anyone tries on a desktop dialog. Part of the accessibility commitment these
   * screens were specified with.
   */
  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onCancel]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onConfirm(trimmed);
    } finally { setBusy(false); }
  }

  const canSave = name.trim().length > 0 && !busy;

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
          <Text style={styles.title}>What should we call you?</Text>
          <Text style={styles.body}>
            Only ever shown to you — Harp2Tab does not publish your name anywhere.
          </Text>

          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={theme.textMuted}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={handleSave}
            accessibilityLabel="Your name"
          />

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={({ pressed, hovered }: any) => [
                styles.btn,
                Platform.OS === 'web' && hovered && { backgroundColor: theme.surface },
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              style={({ pressed, hovered }: any) => [
                styles.btn,
                styles.btnPrimary,
                Platform.OS === 'web' && hovered && canSave && { opacity: 0.9 },
                pressed && { opacity: 0.85 },
                !canSave && { opacity: 0.5 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save name"
              accessibilityState={{ busy, disabled: !canSave }}
            >
              {busy
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={[styles.btnText, styles.btnPrimaryText]}>Save</Text>}
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
      // The difference that matters on a desktop viewport: the phone sheet this replaced had
      // no ceiling and stretched to the window.
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
    input: {
      borderWidth:       1,
      borderColor:       t.border,
      borderRadius:      10,
      paddingHorizontal: 12,
      paddingVertical:   11,
      fontSize:          FONT.base,
      fontFamily:        Poppins.medium,
      color:             t.textPrimary,
      backgroundColor:   t.bg,
      // The browser's focus ring is deliberately left in place — it is the keyboard user's
      // only indication of where they are, and no other input in this app suppresses it.
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
