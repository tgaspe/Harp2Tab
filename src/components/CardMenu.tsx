/**
 * The overflow menu on a library card — an anchored dropdown, not a dialog.
 *
 * What it replaces: a two-item `ActionSheetModal`, i.e. a dimmed page and a centred 420px
 * box with its own Cancel button, spent on picking between "Rename" and "Delete". That is
 * the heaviest pattern in the app spent on its lightest interaction, and on a desktop it
 * reads as a phone sheet. Deleting then opened a *second* modal on top of the first.
 *
 * This is the ordinary desktop shape instead: a small popover beside the button that opened
 * it, dismissed by Escape, by clicking anywhere else, or by choosing something. Destructive
 * items confirm *in place* — the popover swaps its list for a question and two buttons, so
 * one action never opens two overlays.
 *
 * **The panel is portaled, not positioned inside the card.** The first version rendered it as
 * an absolute child of the card and raised the card's `zIndex`, which cannot work on this
 * page: `app.tsx` gives the projects section `zIndex: 40` and leaves the tabs section at
 * auto, so *every* descendant of the tabs section — a recording card's menu included — paints
 * below the projects section's toolbar no matter what zIndex it claims for itself. A child
 * can't out-stack its parent's siblings. So the panel goes into a `Modal`, which
 * react-native-web portals to the document body, and it is measured against the trigger's
 * viewport rect instead. Nothing in the page's stacking order can reach it there.
 *
 * **Web only, deliberately.** Native keeps `ActionSheetModal`: a bottom-anchored sheet with
 * full-width rows is the right control on a phone, and a 190px popover pinned to a 20px
 * glyph is not. Callers render one or the other on `Platform.OS`.
 *
 * The panel, its hairline, its shadow and its hover rows are the same values the library
 * toolbar's sort and key-filter popovers already use — this is the third popover in the app,
 * not a new visual language.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// The app's web button, which happens to live in the settings-surface module. Imported
// rather than restyled here: nothing about `Button` is settings-specific beyond its address,
// and a confirm's two buttons should be the same object as every other button on the site.
import { Button } from '@/components/SettingsSurface';
import { Poppins } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { RADIUS } from '@/constants/ui';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

const isWeb = Platform.OS === 'web';

/** Roughly how tall the panel gets. Only used to decide whether to open upward, so it wants
 *  to be generous rather than exact — guessing too tall flips a menu that would have fitted,
 *  guessing too short runs one off the bottom of the window. */
const PANEL_ESTIMATE = 200;

/** Gap between the trigger and the panel, in both directions. */
const OFFSET = 6;

export interface CardMenuItem {
  icon:  React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  destructive?: boolean;
  /**
   * Turns this item into a two-step action. Choosing it swaps the panel for the question
   * below instead of firing `onPress`; `onPress` runs only if the person then confirms.
   */
  confirm?: { title: string; body: string; confirmLabel: string };
  onPress: () => void;
}

interface Props {
  open:    boolean;
  onClose: () => void;
  items:   CardMenuItem[];
  /**
   * The trigger. Rendered in place, and measured to place the panel.
   *
   * Passed as children rather than left to the caller as a sibling so that this component
   * owns the one DOM node the position depends on. With the panel in a portal there is no
   * other way to find the button it belongs to.
   */
  children: React.ReactNode;
  /**
   * Opens on the first item's confirm step rather than on the list.
   *
   * For an anchor that already names the action — a trash button. Routing that through a
   * one-row menu whose only row repeats the icon you just clicked adds a step and says
   * nothing. Explicit rather than inferred from `items.length`, so a second item can be
   * added later without silently changing how the first one behaves.
   */
  straightToConfirm?: boolean;
}

/** Where the panel sits, in viewport coordinates. `null` until the trigger has been measured
 *  — rendering before then would flash it at the top-left corner for a frame. */
interface Placement { top?: number; bottom?: number; right: number }

export function CardMenu({ open, onClose, items, children, straightToConfirm }: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const anchorRef = useRef<any>(null);
  const [pending, setPending] = useState<CardMenuItem | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  /**
   * Latest props, read by effects that must not re-run when they change.
   *
   * Both are rebuilt on every render at every call site — `items` is an array literal,
   * `onClose` an arrow. Listing them as dependencies would re-run the effects below on each
   * render, and for the reset effect that is not a waste but a bug: choosing Delete sets
   * `pending`, which re-renders, which would immediately clear `pending` again and the
   * confirm step could never appear at all.
   */
  const itemsRef   = useRef(items);
  const onCloseRef = useRef(onClose);
  itemsRef.current   = items;
  onCloseRef.current = onClose;

  const close = useCallback(() => onCloseRef.current(), []);

  // Opening resets the panel. Without this a menu that was left on its confirm step reopens
  // there, so the next click on ⋯ shows "Delete this?" instead of a list.
  useEffect(() => {
    if (!open) { setPending(null); setPlace(null); return; }
    setPending(straightToConfirm ? itemsRef.current[0] ?? null : null);
  }, [open, straightToConfirm]);

  // Measure the trigger and place the panel against it. Layout effect rather than a plain
  // one so the position is set in the same commit the panel first paints in.
  useLayoutEffect(() => {
    if (!open || !isWeb) return;
    const rect = anchorRef.current?.getBoundingClientRect?.();
    if (!rect) return;

    // Right edges aligned: a menu hanging off the right of the button it belongs to is the
    // convention, and it keeps the panel inside the page on a card near the right margin.
    const right = Math.max(OFFSET, window.innerWidth - rect.right);
    // Upward when a downward panel would run off the bottom of the window.
    const flip  = window.innerHeight - rect.bottom < PANEL_ESTIMATE;

    setPlace(flip
      ? { bottom: window.innerHeight - rect.top + OFFSET, right }
      : { top: rect.bottom + OFFSET, right });
  }, [open]);

  // Escape, and any scroll. Scroll matters because the panel is fixed to viewport
  // coordinates measured once: left open, it would detach from its card and hang in the
  // middle of the page. Closing is the honest response — the alternative is re-measuring on
  // every scroll frame for a menu that is dismissed by the next click anyway.
  useEffect(() => {
    if (!open || !isWeb) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }
    // Capture: the page scrolls inside a ScrollView, not on window, and scroll events do not
    // bubble — capture is the only phase that sees them from the document.
    function onScroll() { close(); }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close]);

  function choose(item: CardMenuItem) {
    if (item.confirm) { setPending(item); return; }
    close();
    item.onPress();
  }

  function confirmPending() {
    const item = pending;
    close();
    item?.onPress();
  }

  return (
    // The anchor: a plain View wrapping the trigger, and the node the panel is measured
    // against. Plain on purpose — the trigger inside it is a real <button> on web, and an
    // interactive wrapper would nest one button in another.
    <View ref={anchorRef} style={styles.anchor}>
      {children}

      {open && (
        <Modal
          transparent
          visible
          // No entrance animation: the panel is pinned to a button, and something that fades
          // in at a fixed point on the page reads as lag rather than as motion.
          animationType="none"
          onRequestClose={close}
        >
          {/* Click-away. Safe as a full-screen layer here in a way it would not have been
              inside the card: this lives in the modal's portal and unmounts with it, so it
              cannot outlive the menu and swallow the page's clicks. */}
          <Pressable style={styles.scrim} onPress={close}>
            {!!place && (
              <Pressable
                style={[styles.panel, place as ViewStyle]}
                onPress={(e) => e.stopPropagation()}
                accessibilityRole="menu"
              >
                {pending?.confirm ? (
                  <View style={styles.confirm}>
                    <Text style={styles.confirmTitle}>{pending.confirm.title}</Text>
                    <Text style={styles.confirmBody}>{pending.confirm.body}</Text>
                    <View style={styles.confirmActions}>
                      <Button
                        label="Cancel"
                        size="small"
                        // Back to the list rather than closing outright, unless there was no
                        // list to begin with — cancelling a step should undo that step, not
                        // the whole interaction.
                        onPress={() => (straightToConfirm ? close() : setPending(null))}
                      />
                      <Button
                        label={pending.confirm.confirmLabel}
                        size="small"
                        variant="destructive"
                        onPress={confirmPending}
                      />
                    </View>
                  </View>
                ) : (
                  items.map((item, i) => (
                    <React.Fragment key={item.label}>
                      {/* A rule above the destructive item only, and only when something
                          precedes it. It separates "change this" from "lose this"; a rule
                          between every row would make a two-item menu look like a table. */}
                      {item.destructive && i > 0 && <View style={styles.rule} />}
                      <Pressable
                        onPress={() => choose(item)}
                        style={({ pressed, hovered }: any) => [
                          styles.row,
                          (hovered || pressed) && (item.destructive ? styles.rowHoveredDestructive : styles.rowHovered),
                        ]}
                        accessibilityRole="menuitem"
                        accessibilityLabel={item.label}
                      >
                        <Ionicons
                          name={item.icon}
                          size={15}
                          color={item.destructive ? theme.record : theme.textSub}
                        />
                        <Text style={[styles.rowText, item.destructive && styles.rowTextDestructive]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    </React.Fragment>
                  ))
                )}
              </Pressable>
            )}
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    anchor: { position: 'relative' },

    // Undimmed. A menu is not a modal interaction — darkening the page for a two-item list
    // is the weight this component exists to get rid of. It is here to catch the click that
    // dismisses, nothing else.
    scrim: { flex: 1, backgroundColor: 'transparent' },

    panel: {
      position:        'absolute',
      minWidth:        190,
      backgroundColor: t.cardBg,
      borderRadius:    RADIUS.md,
      borderWidth:     1,
      borderColor:     t.railBorder,
      padding:         6,
      gap:             2,
      ...(isWeb ? { boxShadow: '0 12px 28px rgba(0,0,0,0.18)' } as any : null),
    } as ViewStyle,

    row: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               10,
      paddingVertical:   8,
      paddingHorizontal: 10,
      borderRadius:      RADIUS.sm,
      ...(isWeb ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    rowHovered:            { backgroundColor: t.surfaceAlt },
    rowHoveredDestructive: { backgroundColor: t.recordSoft },
    rowText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textPrimary,
    },
    rowTextDestructive: { color: t.record },

    rule: {
      height:           1,
      backgroundColor:  t.separator,
      marginVertical:   4,
      marginHorizontal: 4,
    },

    confirm: { padding: 6, gap: 4, maxWidth: 260 },
    confirmTitle: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textPrimary,
    },
    confirmBody: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 16,
    },
    confirmActions: {
      flexDirection:  'row',
      justifyContent: 'flex-end',
      gap:            8,
      marginTop:      8,
    },
  });
}
