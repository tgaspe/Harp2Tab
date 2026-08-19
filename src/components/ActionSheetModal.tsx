// react-native-web's Alert.alert is a complete no-op stub (see
// node_modules/react-native-web/src/exports/Alert/index.js — `static alert() {}`), so any
// confirm/menu flow that needs to work on web has to be a real modal, not Alert.alert. This
// is a small reusable stand-in with the same "list of options" shape Alert.alert has.
//
// **Two presentations, one component.** Native keeps the iOS action sheet it has always
// been: centred rows, hairlines between them, a thick grey band above Cancel, options in the
// accent as iOS colours its sheet actions. That is the right dialog on a phone and the wrong
// one on a desktop, where it reads as a phone sheet dropped into a web page — centred text
// nothing else on the page centres, a "link" colour on things that are buttons, a Cancel row
// as wide and as loud as Delete, and no response at all to a cursor hovering over it.
//
// On web it is a desktop dialog instead: left-aligned title over a ruled header, menu rows
// that light up under the cursor, and Cancel as a content-sized secondary button in a footer
// rather than a full-width row. Same props, same call sites, same behaviour — this is a
// styling split, not a fork.
//
// One shape still missing: a true confirmation ([Cancel] [Delete] together in the footer)
// rather than a destructive row above a Cancel button. That needs the component to be told
// which it is, since it cannot be inferred from the options without guessing at arity, so it
// waits for a `variant` prop and a pass over the call sites.

import React, { useMemo } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { Theme } from '@/theme';

const isWeb = Platform.OS === 'web';

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
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={isWeb ? 3 : 2}>{title}</Text>
            </View>
          )}

          <View style={styles.optionList}>
            {options.map((opt, i) => (
              <Pressable
                key={i}
                onPress={() => handleSelect(opt)}
                style={({ pressed, hovered }: any) => [
                  styles.option,
                  // Native rules its rows apart. Web doesn't need them: a row that lights up
                  // under the cursor is already legible as a separate control, and hairlines
                  // between two menu items are what make a menu look like a table.
                  !isWeb && i > 0 && styles.optionBorder,
                  isWeb && hovered && (
                    opt.style === 'destructive' ? styles.optionHoveredDestructive : styles.optionHovered
                  ),
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
          </View>

          {/* Cancel. On native it is one more row in the stack, set off by the grey band iOS
              uses. On web it is a button in a footer, sized to its text and pushed right —
              dismissal should not be the widest, most prominent thing in a dialog whose
              other action is usually Delete. */}
          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              style={({ pressed, hovered }: any) => [
                styles.cancelOption,
                isWeb && hovered && styles.cancelHovered,
                pressed && (isWeb ? styles.cancelHovered : styles.optionPressed),
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
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
      // 20 is the phone sheet's radius. Web pulls it back to the radius the rest of this
      // app's desktop surfaces use — cards, buttons and panels all sit at 10–14.
      borderRadius:    isWeb ? 14 : 20,
      paddingTop:      isWeb ? 0 : 18,
      width:           '100%',
      // 360 was the phone width. The rest of the web modal family runs 400–460
      // (ReauthModal 400, AuthModal/ConfirmDelete/EditName 420, Feedback 460); at 360 this
      // one was visibly the odd dialog out, and a delete title wrapped to three lines.
      maxWidth:        isWeb ? 420 : 360,
      borderWidth:     1,
      borderColor:     t.border,
      overflow:        'hidden',
    },

    // Web gives the title its own ruled band, so the question and the answers to it are
    // visibly two different regions. Native keeps it floating above the rows, as iOS does.
    header: Platform.select({
      web: {
        paddingHorizontal: 20,
        paddingTop:        18,
        paddingBottom:     14,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
      },
      default: {},
    }) as ViewStyle,
    title: {
      fontSize:   isWeb ? FONT.base : FONT.md,
      fontFamily: SpaceGrotesk.bold,
      color:      t.textPrimary,
      // Left, not centred. Centred text is the single loudest phone-ism in this dialog:
      // nothing else on a Harp2Tab web page centres its headings.
      textAlign:  isWeb ? 'left' : 'center',
      lineHeight: isWeb ? 22 : undefined,
      ...(isWeb ? null : { paddingHorizontal: 20, paddingBottom: 14 }),
    },

    optionList: isWeb ? { paddingVertical: 6 } : {},
    option: {
      paddingVertical: isWeb ? 10 : 14,
      alignItems:      isWeb ? 'flex-start' : 'center',
      ...(isWeb
        ? { paddingHorizontal: 20, cursor: 'pointer' } as ViewStyle
        : null),
    } as ViewStyle,
    optionBorder: {
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    // Hover is a colour change, matching the language the settings rows and the editor's
    // toolbar already use — a destructive row warms toward its own red rather than the
    // neutral tint, so the cursor tells you which one you are about to press.
    optionHovered:           { backgroundColor: t.surface },
    optionHoveredDestructive: { backgroundColor: t.recordSoft },
    // Web needs pressed to be distinguishable from hovered, so it goes one step darker.
    // Native has no hover and keeps the `surface` tint it always had.
    optionPressed:           { backgroundColor: isWeb ? t.surfaceAlt : t.surface },
    optionText: {
      fontSize:   isWeb ? FONT.sm : FONT.md,
      fontFamily: Poppins.semiBold,
      // Web drops the accent. Cyan on a row is iOS's sheet-action convention and on a web
      // page it reads as a hyperlink — these are buttons, and the destructive one already
      // carries the only colour this dialog needs.
      color:      isWeb ? t.textPrimary : t.accent,
    },
    optionTextDestructive: { color: t.record },
    optionDescription: {
      fontSize:          FONT.xs,
      fontFamily:        Poppins.regular,
      color:             t.textSub,
      textAlign:         isWeb ? 'left' : 'center',
      marginTop:         3,
      ...(isWeb
        ? { lineHeight: 17 }
        : { fontSize: FONT.sm, paddingHorizontal: 20 }),
    },

    footer: Platform.select({
      web: {
        flexDirection:     'row',
        justifyContent:    'flex-end',
        paddingHorizontal: 20,
        paddingVertical:   14,
        borderTopWidth:    1,
        borderTopColor:    t.border,
      },
      default: {},
    }) as ViewStyle,
    cancelOption: Platform.select({
      web: {
        borderWidth:       1,
        borderColor:       t.border,
        backgroundColor:   t.surface,
        borderRadius:      10,
        paddingHorizontal: 16,
        paddingVertical:   8,
        cursor:            'pointer',
      },
      default: {
        paddingVertical: 14,
        alignItems:      'center',
        // The grey band iOS puts between a sheet's actions and its Cancel. Unchanged.
        borderTopWidth:  8,
        borderTopColor:  t.surfaceAlt,
      },
    }) as ViewStyle,
    cancelHovered: { backgroundColor: t.surfaceAlt },
    cancelText: {
      fontSize:   isWeb ? FONT.sm : FONT.md,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
  });
}
