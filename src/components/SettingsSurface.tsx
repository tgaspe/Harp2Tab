/**
 * Layout primitives for account-style settings pages — the web idiom, not the mobile one.
 *
 * The distinction is deliberate and it is the whole point of this file. The language these
 * replace is the iOS grouped-table-view one: rounded cards grouping rows, an icon on every
 * row, a chevron implying a drill-down, uppercase micro-labels floating above each group.
 * That is correct on a phone and reads as a stretched phone screen on a 1440px display.
 *
 * `/profile` was built on these from the start. `/settings` was the holdout and was moved
 * over on 2026-08-19 — it had been the card language poured into a two-column `flexWrap`
 * grid, which gave a five-row Transcription card sitting beside a one-row Legal card and a
 * column of ragged whitespace between them. Both account pages now speak one language.
 *
 * What these primitives do instead, following the Tailwind UI / Stripe settings grid:
 *
 * - **A section is two columns**: a narrow left column that explains the section in prose,
 *   and a wider right column holding the actual controls. Nothing else communicates "this is
 *   a web app" as cheaply.
 * - **No chevrons and almost no icons.** There is nothing to drill into — the controls are
 *   right there. Icons survive only where they carry information (a provider logo).
 * - **Buttons are sized to their content and right-aligned**, not full-width thumb targets.
 * - **Sections are separated by rules**, not by being boxed.
 * - **Destructive actions get a bordered panel** — GitHub's danger zone, which is the
 *   clearest convention anyone has for "this one is different".
 *
 * Everything collapses to a single stacked column on native, where the two-column grid has
 * no room and the mobile idiom is the right one.
 */

import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/theme';

const isWeb = Platform.OS === 'web';

/* ── Section: description left, controls right ────────────────────────────────────────── */

interface SectionProps {
  title:        string;
  description:  string;
  children:     React.ReactNode;
  /** Suppresses the rule above. Set on the first section in a pane. */
  first?:       boolean;
}

export function Section({ title, description, children, first }: SectionProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.section, !first && styles.sectionRuled]}>
      <View style={styles.sectionAside}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
        <Text style={styles.sectionDescription}>{description}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

/* ── Field row: label / value / optional action ───────────────────────────────────────── */

interface FieldRowProps {
  label:   string;
  value?:  string;
  /** Rendered instead of `value` when the row needs more than text. */
  children?: React.ReactNode;
  /**
   * One sentence under the label saying what the control does.
   *
   * For rows that hold a *control* rather than a value. `/profile` is label/value data —
   * "Email: you@example.com" needs no gloss, and the muted label beside a primary value is
   * the right emphasis there. A slider or a toggle inverts that: the label is the thing
   * being named and the row is meaningless without a sentence of explanation. Passing a
   * hint switches the row to that reading, which is why it also restyles the label.
   *
   * Not a place to restate the label. If the sentence only expands the noun, drop it.
   */
  hint?:   string;
  /**
   * A control pinned to the right of the row — a toggle, a status chip.
   *
   * Separate from `children` (which sits in the value column, under the hint) because a
   * toggle belongs at the end of the row it governs, in the same column as `action`'s
   * button. One row never needs both.
   */
  control?: React.ReactNode;
  action?: { label: string; onPress: () => void; destructive?: boolean };
  /** Suppresses the hairline above. */
  first?:  boolean;
}

export function FieldRow({
  label, value, children, hint, control, action, first,
}: FieldRowProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // A row carrying a hint is two or three lines tall; centring it would float the label
  // and the button against the middle of a paragraph.
  const tall = !!hint;
  return (
    <View style={[
      styles.fieldRow,
      tall && styles.fieldRowTall,
      !first && styles.fieldRowRuled,
    ]}>
      <Text style={[styles.fieldLabel, tall && styles.fieldLabelLead]}>{label}</Text>
      <View style={styles.fieldValue}>
        {!!hint && <Text style={styles.fieldHint}>{hint}</Text>}
        {children ?? (value !== undefined
          ? <Text style={styles.fieldValueText} numberOfLines={1}>{value}</Text>
          : null)}
      </View>
      {control}
      {!!action && (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant={action.destructive ? 'destructive' : 'secondary'}
          size="small"
        />
      )}
    </View>
  );
}

/* ── Button ───────────────────────────────────────────────────────────────────────────── */

interface ButtonProps {
  label:     string;
  onPress:   () => void;
  variant?:  'primary' | 'secondary' | 'destructive' | 'ghost';
  size?:     'small' | 'medium';
  disabled?: boolean;
  /** Web buttons hug their text. Only set this where a button really is the whole row. */
  fullWidth?: boolean;
  /**
   * A leading glyph.
   *
   * For a button whose action is a *thing you do* rather than a setting you change —
   * sending something, downloading something. The settings rows deliberately have no icons
   * (see the note at the top of this file), so an icon here is a signal that this button is
   * not one of them, and it stops meaning that if every button gets one.
   */
  icon?:      React.ComponentProps<typeof Ionicons>['name'];
}

export function Button({
  label, onPress, variant = 'secondary', size = 'medium', disabled, fullWidth, icon,
}: ButtonProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed, hovered }: any) => [
        styles.btn,
        size === 'small' ? styles.btnSmall : styles.btnMedium,
        variant === 'primary'     && styles.btnPrimary,
        variant === 'destructive' && styles.btnDestructive,
        variant === 'ghost'       && styles.btnGhost,
        fullWidth && { alignSelf: 'stretch', alignItems: 'center' },
        isWeb && hovered && !disabled && (
          variant === 'primary'     ? { opacity: 0.9 }
          : variant === 'destructive' ? styles.btnDestructiveHovered
          : styles.btnHovered
        ),
        pressed && !disabled && { opacity: 0.75 },
        disabled && { opacity: 0.5 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <View style={styles.btnInner}>
        {!!icon && (
          <Ionicons
            name={icon}
            size={size === 'small' ? 14 : 15}
            color={
              variant === 'primary'     ? '#fff'
              : variant === 'destructive' ? theme.record
              : theme.textSub
            }
          />
        )}
        <Text
          style={[
            styles.btnText,
            variant === 'primary'     && styles.btnTextPrimary,
            variant === 'destructive' && styles.btnTextDestructive,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/* ── Danger zone ──────────────────────────────────────────────────────────────────────── */

interface DangerZoneProps {
  title:       string;
  description: string;
  actionLabel: string;
  onPress:     () => void;
}

export function DangerZone({ title, description, actionLabel, onPress }: DangerZoneProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.dangerPanel}>
      <View style={styles.dangerBody}>
        <Text style={styles.dangerTitle}>{title}</Text>
        <Text style={styles.dangerDescription}>{description}</Text>
      </View>
      <Button label={actionLabel} onPress={onPress} variant="destructive" />
    </View>
  );
}

export function DangerHeading({ children }: { children: string }) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text style={styles.dangerHeading} accessibilityRole="header">{children}</Text>;
}

/* A sub-navigation lived here and was removed on 2026-08-12 after seeing it rendered. The
 * whole page holds about twelve controls; GitHub and Stripe earn a settings nav because
 * each of their panes holds twenty or thirty. Split four ways, three of the four panes were
 * a heading and two rows above 350px of nothing, and finding anything took three clicks.
 * Everything is one scrolling page now. Don't reintroduce it without the content to fill it.
 */

/* ── Styles ───────────────────────────────────────────────────────────────────────────── */

function createStyles(t: Theme) {
  return StyleSheet.create({
    // The grid. Prose left, controls right on web; stacked on native, where there is no
    // room for two columns and the phone idiom is the correct one.
    section: Platform.select({
      web: {
        flexDirection: 'row',
        gap:           56,
        paddingVertical: 32,
      },
      default: { gap: 12, paddingVertical: 18 },
    }) as ViewStyle,
    sectionRuled: { borderTopWidth: 1, borderTopColor: t.separator },
    sectionAside: Platform.select({
      web: { flexBasis: 280, flexShrink: 0, gap: 5 },
      default: { gap: 4 },
    }) as ViewStyle,
    // Capped. Width was the fix for the page occupying a third of the screen; letting the
    // *rows* inherit all of it just moves the emptiness inside them — a label, a value and
    // an Edit button spread across 1274px is a row with a hole in the middle. The container
    // stays wide, the controls stay a readable size, and the slack sits in the right margin
    // where every account page on the web puts it.
    sectionBody: { flex: 1, minWidth: 0, maxWidth: 820 },
    sectionTitle: {
      fontSize:   FONT.md,
      fontFamily: SpaceGrotesk.bold,
      color:      t.textPrimary,
      letterSpacing: -0.2,
    },
    sectionDescription: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      lineHeight: 17,
    },

    fieldRow: {
      flexDirection:  'row',
      alignItems:     'center',
      gap:            16,
      paddingVertical: 12,
    },
    fieldRowRuled: { borderTopWidth: 1, borderTopColor: t.separator },
    fieldRowTall:  { alignItems: 'flex-start', paddingVertical: 16 },
    fieldLabel: {
      // Fixed so the value column aligns down the whole pane — the alignment is most of what
      // makes this read as a data table rather than a list of rows.
      width:      Platform.OS === 'web' ? 108 : 84,
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
    },
    // See `hint` on FieldRowProps: on a control row the label is the primary text, because
    // there is no value beside it to be primary instead.
    fieldLabelLead: {
      fontFamily: Poppins.medium,
      color:      t.textPrimary,
      // Optically level with the hint's first line, which sits on a 17px leading.
      paddingTop: 1,
    },
    fieldValue: { flex: 1, minWidth: 0, gap: 12 },
    fieldValueText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.medium,
      color:      t.textPrimary,
    },
    fieldHint: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      lineHeight: 17,
      // Same reason as `/profile`'s `note`: the body column is wide, and prose is the one
      // thing that must not use all of it.
      maxWidth:   560,
    },

    btn: {
      borderRadius:    10,
      borderWidth:     1,
      borderColor:     t.border,
      backgroundColor: t.surface,
      alignSelf:       'flex-start',
      justifyContent:  'center',
      ...(isWeb ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    btnSmall:  { paddingHorizontal: 12, paddingVertical: 6 },
    btnMedium: { paddingHorizontal: 16, paddingVertical: 9 },
    btnHovered: { backgroundColor: t.surfaceAlt },
    btnPrimary: { backgroundColor: t.accent, borderColor: t.accent },
    btnDestructive: { borderColor: t.record, backgroundColor: 'transparent' },
    btnDestructiveHovered: { backgroundColor: t.recordSoft },
    btnGhost: { borderColor: 'transparent', backgroundColor: 'transparent' },
    // Wraps glyph and label so they stay together and centred when `fullWidth` stretches
    // the button past its content.
    btnInner: {
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            7,
    },
    btnText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
      textAlign:  'center',
    },
    btnTextPrimary:     { color: '#fff' },
    btnTextDestructive: { color: t.record },

    dangerHeading: {
      fontSize:   FONT.base,
      fontFamily: Poppins.semiBold,
      color:      t.record,
      marginTop:  28,
      marginBottom: 10,
    },
    dangerPanel: {
      flexDirection:   isWeb ? 'row' : 'column',
      alignItems:      isWeb ? 'center' : 'flex-start',
      gap:             16,
      borderWidth:     1,
      borderColor:     t.record,
      borderRadius:    12,
      padding:         16,
    },
    dangerBody: { flex: 1, gap: 3 },
    dangerTitle: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textPrimary,
    },
    dangerDescription: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 17,
    },

  });
}
