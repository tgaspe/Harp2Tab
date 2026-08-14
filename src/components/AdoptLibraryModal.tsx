/**
 * The second-account prompt (7-11).
 *
 * **This dialog exists to prevent a privacy incident, not to be polite about a merge.** Sign in
 * as A on a laptop, sign out, sign in as B: a naive adoption pushes A's entire library into B's
 * account. Signing out deliberately leaves the local library in place — those tabs are real work
 * belonging to whoever was here before — so the app cannot tell whose they are and must not
 * guess.
 *
 * Three things it therefore does that a generic confirm does not:
 *
 * 1. **States counts.** "Your 14 tabs" is a decision someone can make; "your library" is not.
 * 2. **Defaults to clearing.** The safe answer on a shared machine is the one that does not
 *    move someone else's work into a stranger's account, so it is the primary button — even
 *    though it is the destructive-looking one.
 * 3. **Cannot be dismissed.** No backdrop tap, no cancel. Sync stays blocked until it is
 *    answered, and an escape hatch would leave the user in a state whose only symptom is that
 *    nothing ever syncs.
 */

import React, { useMemo } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

interface Props {
  visible:      boolean;
  /** The address of the account just signed in to — the whole point is telling them apart. */
  email:        string;
  tabCount:     number;
  projectCount: number;
  /** "These are mine." Unions this device's library into the signed-in account. */
  onKeep:       () => void;
  /** "These are not mine." Clears the device and pulls the account's own library. */
  onClear:      () => void;
}

function countPhrase(tabCount: number, projectCount: number): string {
  const parts: string[] = [];
  if (tabCount > 0)     parts.push(`${tabCount} tab${tabCount === 1 ? '' : 's'}`);
  if (projectCount > 0) parts.push(`${projectCount} project${projectCount === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

export function AdoptLibraryModal({
  visible, email, tabCount, projectCount, onKeep, onClear,
}: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const phrase = countPhrase(tabCount, projectCount);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Deliberately inert: there is no dismissal that leaves a usable state. Android's back
      // button needs a handler regardless, so it gets one that does nothing rather than one that
      // silently picks an answer for the user.
      onRequestClose={() => {}}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.iconWrap}>
            <Ionicons name="swap-horizontal-outline" size={26} color={theme.warning} />
          </View>

          <Text style={styles.title}>Whose tabs are these?</Text>

          <Text style={styles.body}>
            This device has {phrase} saved on it, from before you signed in as{' '}
            <Text style={styles.email}>{email}</Text>. Before syncing starts, tell us what they
            are.
          </Text>

          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={16} color={theme.textSub} />
            <Text style={styles.noticeText}>
              If someone else used this device, clearing is the right answer — it leaves their
              work out of your account, and out of your cloud library.
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={onClear}
              style={({ pressed, hovered }: any) => [
                styles.primaryBtn,
                Platform.OS === 'web' && hovered && { opacity: 0.9 },
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Clear this device and download the library for ${email}`}
            >
              <Text style={styles.primaryBtnText}>Clear and download mine</Text>
            </Pressable>

            <Pressable
              onPress={onKeep}
              style={({ pressed, hovered }: any) => [
                styles.secondaryBtn,
                Platform.OS === 'web' && hovered && styles.secondaryBtnHovered,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Keep these ${phrase} and add them to this account`}
            >
              <Text style={styles.secondaryBtnText}>They&rsquo;re mine — keep them</Text>
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
      backgroundColor: t.surfaceAlt,
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
    email: { fontFamily: Poppins.semiBold, color: t.textPrimary },
    notice: {
      flexDirection:   'row',
      gap:             10,
      backgroundColor: t.surface,
      borderRadius:    12,
      borderWidth:     1,
      borderColor:     t.border,
      padding:         12,
    },
    noticeText: {
      flex:       1,
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 17,
    },
    // Stacked rather than side by side: the two answers are not symmetric, and a row of equal
    // buttons reads as a coin toss.
    actions: { gap: 10, marginTop: 4 },
    primaryBtn: {
      borderRadius:    14,
      backgroundColor: t.accent,
      paddingVertical: 14,
      alignItems:      'center',
      justifyContent:  'center',
      minHeight:       48,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    primaryBtnText: { fontSize: FONT.sm, fontFamily: Poppins.bold, color: '#fff' },
    secondaryBtn: {
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      paddingVertical: 14,
      alignItems:      'center',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    secondaryBtnHovered: { backgroundColor: t.surface },
    secondaryBtnText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub },
  });
}
