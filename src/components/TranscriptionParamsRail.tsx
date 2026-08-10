/**
 * The tune step's right-hand column: whatever the chosen engine declares, as controls.
 *
 * Knows nothing about either engine. It reads `TranscriptionAlgorithm.params` and renders a
 * slider or a switch per entry, which is what lets the same screen drive the neural model
 * and the classic tracker — and lets an engine added later arrive with its own rail already
 * built. The labels and help text come from the schema too, in the user's language rather
 * than the library's, so no string here names a parameter.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SliderInput } from './SliderInput';
import { Toggle } from './Toggle';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { ParamValues, TranscriptionParam } from '@/audio/algorithms';
import type { Theme } from '@/theme';

interface Props {
  params:   readonly TranscriptionParam[];
  values:   ParamValues;
  onChange: (id: string, value: number | boolean) => void;
  onReset:  () => void;
  /** True while a re-segmentation is in flight. The controls stay live throughout — a rail
   *  that disabled itself mid-drag would fight the very gesture that triggered the work. */
  recomputing?: boolean;
  /**
   * Parameters whose value isn't in the preview yet, marked with a dot beside their label.
   *
   * Needed because nothing recomputes until Apply: without it, a rail full of numbers that
   * don't describe the picture beside them is indistinguishable from one that does. The
   * Apply button says *that* something is staged; these say *what*.
   */
  pendingIds?: readonly string[];
  /**
   * The button that puts the staged values on screen, rendered directly above Reset.
   *
   * A node rather than an `onApply` callback because what it says depends on state only the
   * host has — how many parameters are staged, and whether a pass is already running.
   */
  applyAction?: React.ReactNode;
  /**
   * What to do next, pinned below the scrolling parameters.
   *
   * Here rather than in a row under the piano roll because these are decisions *about* what
   * the rail is showing — take this into the Studio, try another engine, throw it away — and
   * because the roll beside it is worth every pixel of height it can get. Pinned rather than
   * scrolled with the params, since an engine with a long advanced section would otherwise
   * hide the way forward below the fold.
   */
  footer?: React.ReactNode;
}

export function TranscriptionParamsRail({
  params, values, onChange, onReset, recomputing, pendingIds, applyAction, footer,
}: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const basic    = params.filter((p) => !p.advanced);
  const advanced = params.filter((p) => p.advanced);

  /** A parameter's name, plus the dot when its value is ahead of the preview. Spoken as
   *  part of the control's own label, since a lone dot is nothing to a screen reader. */
  function label(param: TranscriptionParam) {
    const pending = pendingIds?.includes(param.id) ?? false;
    return (
      <View style={styles.labelRow}>
        <Text style={styles.label}>{param.label}</Text>
        {pending && <View style={styles.pendingDot} />}
      </View>
    );
  }

  function a11yLabel(param: TranscriptionParam) {
    return pendingIds?.includes(param.id)
      ? `${param.label} — changed, not applied yet`
      : param.label;
  }

  function control(param: TranscriptionParam) {
    if (param.kind === 'boolean') {
      const value = values[param.id] === true;
      return (
        <View key={param.id} style={styles.field}>
          <View style={styles.switchRow}>
            {label(param)}
            <Toggle
              value={value}
              onChange={(v) => onChange(param.id, v)}
              accessibilityLabel={a11yLabel(param)}
            />
          </View>
          {param.help && <Text style={styles.help}>{param.help}</Text>}
        </View>
      );
    }

    const value = typeof values[param.id] === 'number' ? (values[param.id] as number) : param.default;
    return (
      <View key={param.id} style={styles.field}>
        {label(param)}
        <SliderInput
          value={value}
          min={param.min}
          max={param.max}
          step={param.step}
          onChange={(v) => onChange(param.id, v)}
          formatLabel={param.format}
          labelAlign="right"
          accessibilityLabel={a11yLabel(param)}
        />
        {param.help && <Text style={styles.help}>{param.help}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.rail}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.railContent}
        showsVerticalScrollIndicator={false}
      >
        {basic.map(control)}

        {advanced.length > 0 && (
          <>
            <Pressable
              onPress={() => setAdvancedOpen((open) => !open)}
              style={({ pressed, hovered }: any) => [
                styles.disclosure,
                (pressed || hovered) && styles.disclosureHovered,
              ]}
              accessibilityRole="button"
              accessibilityState={{ expanded: advancedOpen }}
              accessibilityLabel={`${advancedOpen ? 'Hide' : 'Show'} advanced settings`}
            >
              <Ionicons
                name={advancedOpen ? 'chevron-down' : 'chevron-forward'}
                size={14}
                color={theme.textSub}
              />
              <Text style={styles.disclosureText}>Advanced</Text>
            </Pressable>
            {advancedOpen && advanced.map(control)}
          </>
        )}

        {/* Spoken, not drawn — the visible "updating" indicator lives next to the note count,
            where the number it qualifies is. This is the same fact for a screen reader, which
            has no such spatial relationship to rely on. */}
        {recomputing && (
          <Text style={styles.srOnly} accessibilityRole="alert">Updating the preview…</Text>
        )}
      </ScrollView>

      {/* Both parameter actions first, then whatever the host does next. Reset sits under
          Apply rather than at the end of the list it acts on: the two are a pair — one puts
          the staged values on screen, the other says what those values should be — and
          splitting them either side of a scroll boundary made the order read backwards. */}
      <View style={styles.footer}>
        {applyAction}

        <Pressable
          onPress={onReset}
          style={({ pressed, hovered }: any) => [
            styles.reset,
            (pressed || hovered) && styles.resetHovered,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Reset every setting to its default"
        >
          <Ionicons name="refresh-outline" size={14} color={theme.textSub} />
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>

        {footer && <View style={styles.footerNext}>{footer}</View>}
      </View>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    // 320px, matching the recording screen's notes column, so the two workspaces agree on
    // what a side rail weighs.
    rail:        { width: 320, flexShrink: 0 },
    // The params take whatever height the footer leaves, rather than the footer being
    // pushed off the bottom by a long advanced section.
    scroll:      { flex: 1 },
    railContent: { gap: 18, paddingBottom: 24, paddingRight: 4 },
    footer: {
      gap:            8,
      paddingTop:     14,
      paddingRight:   4,
      borderTopWidth: 1,
      borderTopColor: t.separator,
    },
    // Separated from the parameter actions above it, since "leave with this" is a different
    // kind of decision from "change what this is".
    footerNext: {
      gap:        8,
      marginTop:  8,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.separator,
    },
    field:       { gap: 2 },
    switchRow: {
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'space-between',
      gap:            12,
    },
    labelRow: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           6,
      flexShrink:    1,
      minWidth:      0,
    },
    label: {
      fontFamily:    SpaceGrotesk.medium,
      fontSize:      FONT.xs,
      letterSpacing: 1,
      color:         t.textMuted,
      textTransform: 'uppercase',
      flexShrink:    1,
    },
    // Small and accent-coloured rather than a word: it appears on up to six labels at once,
    // and six copies of "changed" would be louder than the parameters themselves.
    pendingDot: {
      width:           6,
      height:          6,
      borderRadius:    3,
      backgroundColor: t.accent,
      flexShrink:      0,
    },
    help: {
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      lineHeight: 16,
      color:      t.textMuted,
    },
    disclosure: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             6,
      paddingVertical: 8,
      borderTopWidth:  1,
      borderTopColor:  t.separator,
    },
    disclosureHovered: { opacity: 0.75 },
    disclosureText: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.sm,
      color:      t.textSub,
    },
    reset: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             6,
      paddingVertical: 10,
      borderRadius:    10,
      borderWidth:     1,
      borderColor:     t.border,
    },
    resetHovered: { backgroundColor: t.surface },
    resetText: {
      fontFamily: Poppins.medium,
      fontSize:   FONT.xs,
      color:      t.textSub,
    },
    srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -9999 },
  });
}
