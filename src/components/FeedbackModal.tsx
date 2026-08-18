/**
 * The suggestion box (web).
 *
 * Collects a category and a message; everything else on the submitted document — uid, email,
 * build, platform, locale — is gathered in `sync/feedback.web.ts`, not here. A modal that asked
 * the user to describe their setup would be asking for what the app already knows.
 *
 * **Rendered on web only**, because submitting requires a signed-in user and native has no
 * accounts until Phase 15. `settings.tsx` owns that gate; see `sync/feedback.ts`.
 */

import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import { MESSAGE_MAX, submitFeedback, type FeedbackType } from '@/sync/feedback';
import type { AuthUser } from '@/auth/types';
import type { Theme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

interface Props {
  visible: boolean;
  user:    AuthUser;
  onClose: () => void;
}

/** Ordered by how often each is likely to be picked, not alphabetically — the first option is
 *  the one a frustrated user reaches for. */
const TYPES: { id: FeedbackType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'bug',        label: 'Bug',        icon: 'bug-outline' },
  { id: 'suggestion', label: 'Suggestion', icon: 'bulb-outline' },
  { id: 'other',      label: 'Other',      icon: 'chatbubble-ellipses-outline' },
];

const PLACEHOLDERS: Record<FeedbackType, string> = {
  bug:        'What happened, and what did you expect instead?',
  suggestion: 'What would you like Harp2Tab to do?',
  other:      'Tell us anything.',
};

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function FeedbackModal({ visible, user, onClose }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [type,    setType]    = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [status,  setStatus]  = useState<Status>('idle');
  const [error,   setError]   = useState('');

  // Reset on open rather than on close: clearing while the modal is still fading out shows the
  // user their message vanishing, which reads as having lost it.
  useEffect(() => {
    if (visible) {
      setType('bug');
      setMessage('');
      setStatus('idle');
      setError('');
    }
  }, [visible]);

  const trimmed  = message.trim();
  const tooLong  = trimmed.length > MESSAGE_MAX;
  const canSend  = trimmed.length > 0 && !tooLong && status !== 'sending';

  async function handleSend() {
    if (!canSend) return;

    setStatus('sending');
    setError('');

    try {
      await submitFeedback(user, { type, message: trimmed });
      setStatus('sent');
    } catch (e) {
      // The message stays in the box on failure — retyping a paragraph because a network blip
      // ate it is how someone decides not to bother reporting the next one.
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>

          {status === 'sent' ? (
            <>
              <View style={styles.sentIcon}>
                <Ionicons name="checkmark" size={30} color={theme.success} />
              </View>
              <Text style={styles.title}>Thank you</Text>
              <Text style={styles.body}>
                Your {type === 'bug' ? 'report' : 'note'} is with us. We read everything.
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.sendBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={styles.sendBtnText}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>Send Feedback</Text>
              <Text style={styles.body}>
                Found a bug or have an idea? Tell us — it goes straight to the developer.
              </Text>

              <View style={styles.typeRow} accessibilityRole="radiogroup">
                {TYPES.map((t) => {
                  const active = t.id === type;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setType(t.id)}
                      style={({ pressed }) => [
                        styles.typeBtn,
                        active && styles.typeBtnActive,
                        pressed && { opacity: 0.7 },
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t.label}
                    >
                      <Ionicons
                        name={t.icon}
                        size={16}
                        color={active ? theme.accent : theme.textMuted}
                      />
                      <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                style={styles.input}
                value={message}
                onChangeText={setMessage}
                placeholder={PLACEHOLDERS[type]}
                placeholderTextColor={theme.textMuted}
                multiline
                textAlignVertical="top"
                editable={status !== 'sending'}
                accessibilityLabel="Your feedback"
              />

              <View style={styles.metaRow}>
                <Text style={styles.hint} numberOfLines={2}>
                  {error || 'Your email and app version are attached automatically.'}
                </Text>
                <Text style={[styles.counter, tooLong && styles.counterOver]}>
                  {trimmed.length}/{MESSAGE_MAX}
                </Text>
              </View>

              <Pressable
                onPress={handleSend}
                disabled={!canSend}
                style={({ pressed }) => [
                  styles.sendBtn,
                  !canSend && styles.sendBtnDisabled,
                  pressed && canSend && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSend }}
                accessibilityLabel="Send feedback"
              >
                {status === 'sending'
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.sendBtnText}>Send</Text>}
              </Pressable>

              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
            </>
          )}

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
      paddingHorizontal: 32,
    },
    card: {
      backgroundColor:   t.bg,
      borderRadius:      24,
      paddingHorizontal: 28,
      paddingVertical:   32,
      alignItems:        'center',
      gap:               12,
      width:             '100%',
      maxWidth:          460,
      borderWidth:       1,
      borderColor:       t.border,
    },
    sentIcon: {
      width:           56,
      height:          56,
      borderRadius:    28,
      backgroundColor: t.successSoft,
      alignItems:      'center',
      justifyContent:  'center',
      marginBottom:    4,
    },
    title: {
      fontSize:      FONT['2xl'],
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      textAlign:     'center',
      letterSpacing: -0.4,
    },
    body: {
      fontSize:     FONT.sm,
      fontFamily:   Poppins.regular,
      color:        t.textSub,
      textAlign:    'center',
      lineHeight:   22,
      marginBottom: 4,
    },
    typeRow: {
      flexDirection: 'row',
      gap:           8,
      alignSelf:     'stretch',
    },
    typeBtn: {
      flex:            1,
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             6,
      paddingVertical: 10,
      borderRadius:    12,
      borderWidth:     1,
      borderColor:     t.border,
      backgroundColor: t.surface,
    },
    typeBtnActive: {
      borderColor:     t.accent,
      backgroundColor: t.accentSoft,
    },
    typeLabel: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.medium,
      color:      t.textMuted,
    },
    typeLabelActive: {
      color:      t.accent,
      fontFamily: Poppins.bold,
    },
    input: {
      alignSelf:         'stretch',
      minHeight:         120,
      borderRadius:      14,
      borderWidth:       1,
      borderColor:       t.border,
      backgroundColor:   t.surface,
      paddingHorizontal: 14,
      paddingVertical:   12,
      fontSize:          FONT.sm,
      fontFamily:        Poppins.regular,
      color:             t.textPrimary,
      lineHeight:        21,
      // The web input paints its own focus ring over the themed border.
      outlineStyle:      'none' as never,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems:    'flex-start',
      gap:           10,
      alignSelf:     'stretch',
    },
    hint: {
      flex:       1,
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      lineHeight: 16,
    },
    counter: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.medium,
      color:      t.textMuted,
    },
    counterOver: {
      color: t.record,
    },
    sendBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      backgroundColor: t.accent,
      borderRadius:    14,
      paddingVertical: 16,
      alignSelf:       'stretch',
      marginTop:       4,
    },
    sendBtnDisabled: {
      opacity: 0.45,
    },
    sendBtnText: {
      fontSize:           FONT.md,
      fontFamily:         Poppins.bold,
      color:              '#fff',
      includeFontPadding: false,
    },
    cancelBtn: {
      alignSelf:       'stretch',
      borderRadius:    14,
      paddingVertical: 12,
      alignItems:      'center',
    },
    cancelBtnText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.medium,
      color:      t.textSub,
    },
  });
}
