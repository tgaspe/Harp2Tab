import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

interface Props {
  visible:      boolean;
  defaultTitle: string;
  onSave:       (title: string) => void;
  onCancel:     () => void;
  heading?:     string;
}

export function NameRecordingModal({ visible, defaultTitle, onSave, onCancel, heading = 'Name this recording' }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [title, setTitle] = useState(defaultTitle);

  // Re-seed from the latest default each time the modal opens, rather than carrying over
  // whatever was typed (or left untouched) the previous time it was shown.
  useEffect(() => {
    if (visible) setTitle(defaultTitle);
  }, [visible, defaultTitle]);

  function handleSave() {
    onSave(title.trim() || defaultTitle);
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
        <View style={styles.card}>
          <Text style={styles.title}>{heading}</Text>

          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={defaultTitle}
            placeholderTextColor={theme.textMuted}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />

          <View style={styles.row}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel="Save recording"
            >
              <Text style={styles.saveBtnText}>Save</Text>
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
      paddingHorizontal: 32,
    },
    card: {
      backgroundColor:   t.bg,
      borderRadius:      24,
      paddingHorizontal: 28,
      paddingVertical:   28,
      gap:               16,
      width:             '100%',
      borderWidth:       1,
      borderColor:       t.border,
    },
    title: {
      fontSize:      FONT.lg,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      textAlign:     'center',
      letterSpacing: -0.3,
    },
    input: {
      borderWidth:       1,
      borderColor:       t.border,
      borderRadius:      12,
      paddingHorizontal: 14,
      paddingVertical:   12,
      fontSize:          FONT.md,
      fontFamily:        Poppins.medium,
      color:             t.textPrimary,
      backgroundColor:   t.surface,
    },
    row: { flexDirection: 'row', gap: 10 },
    cancelBtn: {
      flex:            1,
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      paddingVertical: 14,
      alignItems:      'center',
    },
    cancelBtnText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub },
    saveBtn: {
      flex:            1,
      borderRadius:    14,
      backgroundColor: t.accent,
      paddingVertical: 14,
      alignItems:      'center',
    },
    saveBtnText: { fontSize: FONT.sm, fontFamily: Poppins.bold, color: '#fff' },
  });
}
