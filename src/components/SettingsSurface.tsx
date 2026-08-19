/**
 * Layout primitives for account-style settings pages — the web idiom, not the mobile one.
 *
 * The distinction is deliberate and it is the whole point of this file. `settings.tsx` uses
 * the iOS grouped-table-view language: rounded cards grouping rows, an icon on every row, a
 * chevron implying a drill-down, uppercase micro-labels floating above each group. That is
 * correct on a phone and reads as a stretched phone screen on a 1440px display.
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
  action?: { label: string; onPress: () => void; destructive?: boolean };
  /** Suppresses the hairline above. */
  first?:  boolean;
}

export function FieldRow({ label, value, children, action, first }: FieldRowProps) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.fieldRow, !first && styles.fieldRowRuled]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValue}>
        {children ?? <Text style={styles.fieldValueText} numberOfLines={1}>{value}</Text>}
      </View>
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
}

export function Button({
  label, onPress, variant = 'secondary', size = 'medium', disabled, fullWidth,
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
      <Text
        style={[
          styles.btnText,
          variant === 'primary'     && styles.btnTextPrimary,
          variant === 'destructive' && styles.btnTextDestructive,
        ]}
      >
        {label}
      </Text>
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
    fieldLabel: {
      // Fixed so the value column aligns down the whole pane — the alignment is most of what
      // makes this read as a data table rather than a list of rows.
      width:      Platform.OS === 'web' ? 108 : 84,
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
    },
    fieldValue: { flex: 1, minWidth: 0 },
    fieldValueText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.medium,
      color:      t.textPrimary,
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
