/**
 * "Which harmonica should this track become?" — asked at the moment of conversion.
 *
 * The Studio has no harp of its own, deliberately: a project is unconstrained music and a
 * tab is one player's line on one instrument, so the instrument is chosen exactly where the
 * one becomes the other. Before this existed conversion picked the best-scoring key silently,
 * which meant the single decision that determines every tab in the result was the one
 * decision the user never saw.
 *
 * Same `KeyCandidateList` the import screen uses, and the same evidence MIDI import shows
 * (an exact count of notes that can't be reached), because a Studio track and an imported
 * MIDI track are the same kind of thing — `rankKeysForTrack` keeps the numbers here
 * identical to the ones the conversion will actually use.
 */

import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyCandidateList, positionLabel, techniqueSuffix } from './KeyCandidateList';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { MidiKeyRanking } from '@/audio/notesToTabs';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType } from '@/types';

/** The winner plus the two next-best — in practice straight harp and the cross-harp
 *  positions around it. Matches what the import screen offers. */
const ALTERNATES_SHOWN = 3;

interface Props {
  visible:       boolean;
  trackName:     string;
  ranking:       MidiKeyRanking;
  chosenKey:     HarmonicaKey;
  harmonicaType: HarmonicaType;
  onSelectKey:   (key: HarmonicaKey) => void;
  onSelectType:  (type: HarmonicaType) => void;
  onConfirm:     () => void;
  onClose:       () => void;
}

export function ConvertTrackModal({
  visible, trackName, ranking, chosenKey, harmonicaType,
  onSelectKey, onSelectType, onConfirm, onClose,
}: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const candidates = ranking.ranked.slice(0, ALTERNATES_SHOWN);
  const unplayable = ranking.unplayableByKey[chosenKey] ?? 0;
  const shift      = ranking.octaveShiftSemitones;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* No accessibilityRole on these wrappers — on web that renders a real <button>, and
          the rows inside genuinely need the role, which would nest one button in another. */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title} numberOfLines={2}>Convert &ldquo;{trackName}&rdquo;</Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {/* Type first: it changes the scores below it, so choosing it afterwards would
                silently re-rank a list the user had already read. */}
            <View style={styles.typeRow}>
              {(['diatonic', 'chromatic'] as const).map((type) => {
                const selected = harmonicaType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => onSelectType(type)}
                    style={[styles.typeBtn, selected && styles.typeBtnActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${type} harmonica`}
                  >
                    <Text style={[styles.typeText, selected && styles.typeTextActive]}>
                      {type === 'diatonic' ? 'Diatonic' : 'Chromatic'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <KeyCandidateList
              candidates={candidates}
              selectedKey={chosenKey}
              onSelect={onSelectKey}
              describe={(candidate) => {
                const notReachable = ranking.unplayableByKey[candidate.key] ?? 0;
                const stats = notReachable === 0
                  ? 'every note reachable'
                  : `${notReachable} not reachable`;
                return {
                  stats: stats + techniqueSuffix(candidate),
                  accessibilityLabel:
                    `${candidate.key} harmonica, ${positionLabel(candidate.position)}, `
                    + `${notReachable} note${notReachable === 1 ? '' : 's'} not reachable`,
                };
              }}
            />

            {/* Stated before converting, not after. The shift changes the pitches relative to
                the source, and unreachable notes arrive as blank tabs — both are things the
                user would otherwise discover by noticing the result looked wrong. */}
            {shift !== 0 && (
              <Text style={styles.note}>
                Transposed {shift > 0 ? 'up' : 'down'} {Math.abs(shift) / 12}{' '}
                octave{Math.abs(shift) === 12 ? '' : 's'} to fit the harmonica&apos;s range.
              </Text>
            )}
            {unplayable > 0 && (
              <Text style={styles.note}>
                {unplayable} note{unplayable === 1 ? '' : 's'} can&apos;t be played on a {chosenKey}{' '}
                harp. {unplayable === 1 ? 'It keeps its' : 'They keep their'} pitch, with a blank tab.
              </Text>
            )}
          </ScrollView>

          <Pressable
            onPress={onConfirm}
            style={({ pressed }) => [styles.confirm, pressed && styles.confirmPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Convert to a ${chosenKey} ${harmonicaType} harmonica tab`}
          >
            <Text style={styles.confirmText}>Convert to {chosenKey} tab</Text>
          </Pressable>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && styles.confirmPressed]}
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
      paddingVertical:   40,
    },
    card: {
      backgroundColor: t.bg,
      borderRadius:    20,
      paddingTop:      18,
      width:           '100%',
      maxWidth:        420,
      maxHeight:       '100%',
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
    scroll:        { flexShrink: 1 },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
    typeRow: {
      flexDirection: 'row',
      gap:           8,
    },
    typeBtn: {
      flex:            1,
      paddingVertical: 9,
      borderRadius:    8,
      borderWidth:     1,
      borderColor:     t.border,
      alignItems:      'center',
    },
    typeBtnActive: { borderColor: t.accentDim, backgroundColor: t.accentSoft },
    typeText: {
      fontFamily: Poppins.medium,
      fontSize:   FONT.sm,
      color:      t.textSub,
    },
    typeTextActive: { color: t.accent, fontFamily: Poppins.bold },
    note: {
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      t.textMuted,
      lineHeight: 16,
    },
    confirm: {
      marginTop:       4,
      paddingVertical: 14,
      alignItems:      'center',
      borderTopWidth:  1,
      borderTopColor:  t.border,
    },
    confirmPressed: { backgroundColor: t.surface },
    confirmText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.semiBold,
      color:      t.accent,
    },
    cancel: {
      paddingVertical: 14,
      alignItems:      'center',
      borderTopWidth:  8,
      borderTopColor:  t.surfaceAlt,
    },
    cancelText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
  });
}
