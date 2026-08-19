// react-native-web's Alert.alert is a complete no-op stub (see
// node_modules/react-native-web/src/exports/Alert/index.js — `static alert() {}`), so any
// confirm/menu flow that needs to work on web has to be a real modal, not Alert.alert. This
// is a small reusable stand-in with the same "list of options" shape Alert.alert has.

import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { Theme } from '@/theme';

export interface ActionSheetOption {
  label:    string;
  /** A second line under the label, for a choice whose consequence the label can't carry on
   *  its own. Optional because most sheets here are confirmations, where a description would
   *  only repeat the title. */
  description?: string;
  style?:   'default' | 'destructive';
  onPress?: () => void;
}

interface Props {
  visible: boolean;
  title?:   string;
  options: ActionSheetOption[];
  onClose: () => void;
}

export function ActionSheetModal({ visible, title, options, onClose }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  function handleSelect(opt: ActionSheetOption) {
    onClose();
    opt.onPress?.();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* No accessibilityRole="button" on the backdrop/card wrappers below — that's what
          makes react-native-web render a real <button>, and nesting one inside another
          (for the option rows, which do need the role) is invalid HTML. These two are
          just tap targets, not semantic buttons. */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          {title && (
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
          )}

          {options.map((opt, i) => (
            <Pressable
              key={i}
              onPress={() => handleSelect(opt)}
              style={({ pressed }) => [
                styles.option,
                i > 0 && styles.optionBorder,
                pressed && styles.optionPressed,
              ]}
              accessibilityRole="button"
              // The description is part of what the row means, so it belongs in the label
              // rather than being left for a screen reader to find as separate text.
              accessibilityLabel={opt.description ? `${opt.label}. ${opt.description}` : opt.label}
            >
              <Text style={[styles.optionText, opt.style === 'destructive' && styles.optionTextDestructive]}>
                {opt.label}
              </Text>
              {opt.description && (
                <Text style={styles.optionDescription}>{opt.description}</Text>
              )}
            </Pressable>
          ))}

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.option, styles.cancelOption, pressed && styles.optionPressed]}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
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
      backgroundColor: t.bg,
      borderRadius:    20,
      paddingTop:      18,
      width:           '100%',
      maxWidth:        360,
      borderWidth:     1,
      borderColor:     t.border,
      overflow:        'hidden',
    },
    title: {
      fontSize:          FONT.md,
      fontFamily:        SpaceGrotesk.bold,
      color:             t.textPrimary,
      textAlign:         'center',
      paddingHorizontal: 20,
      paddingBottom:     14,
    },
    option: {
      paddingVertical: 14,
      alignItems:      'center',
    },
    optionBorder: {
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    optionPressed: { backgroundColor: t.surface },
    optionText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.semiBold,
      color:      t.accent,
    },
    optionTextDestructive: { color: t.record },
    optionDescription: {
      fontSize:          FONT.sm,
      fontFamily:        Poppins.regular,
      color:             t.textSub,
      textAlign:         'center',
      marginTop:         3,
      paddingHorizontal: 20,
    },
    cancelOption: {
      borderTopWidth: 8,
      borderTopColor: t.surfaceAlt,
    },
    cancelText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
  });
}
