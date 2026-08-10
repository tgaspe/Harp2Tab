/**
 * "How should this be transcribed?" — asked once, before any compute happens.
 *
 * A modal rather than a screen because the decision is bounded: two rows and two buttons,
 * with no state to build up and nothing to lay out. `ConvertTrackModal` is the precedent —
 * a real decision taken in a modal, with the same `maxHeight` + internal scroll so the
 * actions stay reachable at short viewport heights.
 *
 * Being a modal is also what lets it have **two hosts**, which a phase belonging to one
 * screen could not:
 *
 *  - the recording screen, on Finish, so the user is asked while still with the take they
 *    just played rather than after being bounced to a screen that immediately asks;
 *  - the import screen, on mount, because a picked file has no earlier moment to ask at.
 *
 * Nothing here is expensive, so moving between rows is instant and every choice reversible.
 * Dismissing is not a third answer: the host decides what backing out means, and in both
 * cases it is "return to where you were", never "transcribe with something".
 */

import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CandidateList, CandidateRow } from './CandidateRow';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { TranscriptionAlgorithm, TranscriptionAlgorithmId } from '@/audio/algorithms';
import type { Theme } from '@/theme';

interface Props {
  visible:    boolean;
  algorithms: TranscriptionAlgorithm[];
  selectedId: TranscriptionAlgorithmId;
  onSelect:   (id: TranscriptionAlgorithmId) => void;
  onConfirm:  () => void;
  onClose:    () => void;
  /** What is about to be transcribed — a take's name and length, or a filename. */
  subtitle:   string;
  /**
   * How many notes the live pass already found. Costs nothing to show (pMPM ran throughout
   * the take anyway) and is the whole frame for the decision: it is what tells a user
   * whether a slower, more accurate pass is worth waiting for. Omitted on the import host,
   * which has no live pass to report.
   */
  liveNoteCount?: number;
  /** The escape. On the recording host this is "use the live version" and routes straight
   *  to the editor; the import host has nothing to fall back to and omits it. */
  secondaryLabel?: string;
  onSecondary?:    () => void;
  /**
   * Names `onClose` as a button, for hosts where backing out is a real answer the user
   * should be able to see rather than have to guess at.
   *
   * Opt-in because the two hosts differ in how reachable the way out already is. The
   * recording screen's modal sits over the take it came from, and its "use the live version"
   * row is a visible alternative to going forward; the import screen's opens onto a bare
   * backdrop with no other exit drawn anywhere — leaving Escape and a backdrop tap, neither
   * of which is a thing on screen.
   */
  cancelLabel?:    string;
}

/**
 * The third line on each row, built from the engine's capability flags rather than written
 * per engine — so an engine added later gets its chips for free, and no two descriptions
 * can drift apart from the behaviour they describe.
 */
function chipsFor(algorithm: TranscriptionAlgorithm): string[] {
  return [
    algorithm.polyphonic     ? 'hears chords' : 'single voice',
    algorithm.producesFrames ? 'instant · inspectable' : 'slower · loads a model',
  ];
}

export function TranscriptionEngineModal({
  visible, algorithms, selectedId, onSelect, onConfirm, onClose,
  subtitle, liveNoteCount, secondaryLabel, onSecondary, cancelLabel,
}: Props) {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* No accessibilityRole on these wrappers — on web that renders a real <button>, and
          the rows inside genuinely need the role, which would nest one button in another. */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>How should this be transcribed?</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <CandidateList>
              {algorithms.map((algorithm) => (
                <CandidateRow
                  key={algorithm.id}
                  // The engine's own `label` and `description` — both already written as
                  // user-facing copy where they are declared, so this screen adds no strings
                  // of its own and can't describe an engine differently from the picker in
                  // Settings.
                  title={algorithm.label}
                  subtitle={`${algorithm.description}\n${chipsFor(algorithm).join(' · ')}`}
                  selected={selectedId === algorithm.id}
                  onPress={() => onSelect(algorithm.id)}
                  accessibilityLabel={`${algorithm.label}. ${algorithm.description} ${chipsFor(algorithm).join(', ')}`}
                />
              ))}
            </CandidateList>

            {liveNoteCount !== undefined && (
              <View style={styles.noticeRow}>
                <Ionicons name="pulse-outline" size={14} color={theme.textMuted} />
                <Text style={styles.noticeText}>
                  The live pass already found {liveNoteCount} note{liveNoteCount === 1 ? '' : 's'}.
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={onConfirm}
              style={({ pressed, hovered }: any) => [
                styles.primaryBtn,
                (pressed || hovered) && styles.primaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Transcribe with the selected engine"
            >
              <Text style={styles.primaryBtnText}>Transcribe</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </Pressable>

            {secondaryLabel && onSecondary && (
              <Pressable
                onPress={onSecondary}
                style={({ pressed, hovered }: any) => [
                  styles.secondaryBtn,
                  (pressed || hovered) && styles.secondaryBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={secondaryLabel}
              >
                <Text style={styles.secondaryBtnText}>{secondaryLabel}</Text>
              </Pressable>
            )}

            {/* Quieter than the secondary above it: backing out is always available, but
                it is the least likely thing the user opened this to do. */}
            {cancelLabel && (
              <Pressable
                onPress={onClose}
                style={({ pressed, hovered }: any) => [
                  styles.quietBtn,
                  (pressed || hovered) && styles.secondaryBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={cancelLabel}
              >
                <Text style={styles.quietBtnText}>{cancelLabel}</Text>
              </Pressable>
            )}
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
      paddingVertical:   40,
    },
    card: {
      backgroundColor: t.bg,
      borderRadius:    20,
      paddingTop:      18,
      paddingBottom:   16,
      width:           '100%',
      maxWidth:        460,
      // With the scroll view below shrinking rather than growing, a short viewport takes
      // height out of the list instead of pushing the actions off the bottom.
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
    },
    subtitle: {
      fontSize:          FONT.xs,
      fontFamily:        Poppins.regular,
      color:             t.textMuted,
      textAlign:         'center',
      paddingHorizontal: 20,
      paddingTop:        4,
    },
    scroll:        { flexShrink: 1 },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 4 },
    noticeRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingHorizontal: 10,
      paddingVertical:   8,
      borderRadius:      10,
      backgroundColor:   t.surfaceAlt,
      marginTop:         12,
    },
    noticeText: {
      flex:       1,
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      t.textSub,
    },
    actions: {
      paddingHorizontal: 20,
      paddingTop:        14,
      gap:               8,
    },
    primaryBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      paddingVertical: 13,
      borderRadius:    10,
      backgroundColor: t.accent,
    },
    primaryBtnPressed: { backgroundColor: t.accentDim },
    primaryBtnText: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.sm,
      color:      '#fff',
    },
    secondaryBtn: {
      paddingVertical: 11,
      borderRadius:    10,
      borderWidth:     1,
      borderColor:     t.border,
      alignItems:      'center',
    },
    secondaryBtnPressed: { backgroundColor: t.surface },
    secondaryBtnText: {
      fontFamily: Poppins.medium,
      fontSize:   FONT.sm,
      color:      t.textSub,
    },
    quietBtn: {
      paddingVertical: 10,
      borderRadius:    10,
      alignItems:      'center',
    },
    quietBtnText: {
      fontFamily: Poppins.medium,
      fontSize:   FONT.sm,
      color:      t.textMuted,
    },
  });
}
