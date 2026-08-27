/**
 * The "which harmonica should this become" picker, shared by both import paths.
 *
 * Both produce the same `KeyCandidate[]` from the same scoring in notesToTabs.ts, so they
 * get the same list — what differs is only the evidence each can offer. Audio knows what
 * fraction of the take landed on a hole; MIDI knows exactly how many notes can't be
 * reached, because unlike audio it keeps the ones that don't map. Hence `describe`: the
 * caller supplies the sentence, the list owns everything else.
 */

import React from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';
import { CandidateGroupLabel, CandidateKeyBadge, CandidateList, CandidateRow } from './CandidateRow';
import type { KeyCandidate } from '@/audio/notesToTabs';
import type { HarmonicaKey } from '@/types';

const POSITION_LABELS: Record<number, string> = {
  1: '1st position (straight harp)',
  2: '2nd position (cross harp)',
  3: '3rd position (slant harp)',
};

export function positionLabel(position: number): string {
  return POSITION_LABELS[position] ?? `${position}th position`;
}

/** Shared tail of both screens' stats line — the techniques a key demands, mentioned only
 *  when there's enough of them to affect the choice. */
export function techniqueSuffix(candidate: KeyCandidate): string {
  let suffix = '';
  if (candidate.bendFraction > 0.05) {
    suffix += ` · ${Math.round(candidate.bendFraction * 100)}% bends`;
  }
  if (candidate.overblowFraction > 0.02) {
    suffix += ` · ${Math.round(candidate.overblowFraction * 100)}% overblows`;
  }
  return suffix;
}

interface Props {
  candidates: readonly KeyCandidate[];
  selectedKey: HarmonicaKey;
  onSelect: (key: HarmonicaKey) => void;
  /** The row's stats line, and how the whole row reads to a screen reader. */
  describe: (candidate: KeyCandidate) => { stats: string; accessibilityLabel: string };
  /**
   * How many leading candidates the scoring actually stands behind.
   *
   * The list used to *be* this number — callers sliced to the top three and the other nine
   * keys were unreachable, so someone who owns exactly one harmonica and whose key ranked
   * fourth was offered no way to pick it. The ranking is the value; hiding the rest of the
   * list isn't. Every key renders, in ranked order, with the heading marking where the
   * recommendation ends. Omit to label nothing.
   */
  recommendedCount?: number;
  /** Keep the non-recommended run from making a desktop decision screen arbitrarily tall. */
  scrollOtherKeys?: boolean;
  rowBackgroundColor?: string;
}

export function KeyCandidateList({
  candidates, selectedKey, onSelect, describe, recommendedCount, scrollOtherKeys = false,
  rowBackgroundColor,
}: Props) {
  // Nothing to divide when the recommendation covers the whole list — a "recommended"
  // heading over every row says nothing, and an empty "other keys" run is worse.
  const grouped = recommendedCount !== undefined
    && recommendedCount > 0
    && recommendedCount < candidates.length;

  function row(candidate: KeyCandidate) {
    const selected = candidate.key === selectedKey;
    const { stats, accessibilityLabel } = describe(candidate);
    return (
      <CandidateRow
        key={candidate.key}
        leading={<CandidateKeyBadge label={candidate.key} selected={selected} />}
        title={positionLabel(candidate.position)}
        subtitle={stats}
        selected={selected}
        onPress={() => onSelect(candidate.key)}
        accessibilityLabel={accessibilityLabel}
        backgroundColor={rowBackgroundColor}
      />
    );
  }

  if (grouped && scrollOtherKeys && Platform.OS === 'web') {
    const recommended = candidates.slice(0, recommendedCount);
    const others      = candidates.slice(recommendedCount);
    return (
      <CandidateList>
        <CandidateGroupLabel label="RECOMMENDED" />
        {recommended.map(row)}
        <CandidateGroupLabel label={`ALL OTHER KEYS (${others.length})`} />
        <ScrollView
          style={styles.otherKeys}
          contentContainerStyle={styles.otherKeysContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          accessibilityLabel="All other harmonica keys"
        >
          {others.map(row)}
        </ScrollView>
      </CandidateList>
    );
  }

  return (
    <CandidateList>
      {candidates.map((candidate, index) => (
        <React.Fragment key={candidate.key}>
          {grouped && index === 0 && <CandidateGroupLabel label="RECOMMENDED" />}
          {grouped && index === recommendedCount && <CandidateGroupLabel label="ALL OTHER KEYS" />}
          {row(candidate)}
        </React.Fragment>
      ))}
    </CandidateList>
  );
}

const styles = StyleSheet.create({
  otherKeys: {
    maxHeight: 276,
  },
  otherKeysContent: {
    gap:          8,
    paddingRight: 6,
    paddingBottom: 2,
  },
});
