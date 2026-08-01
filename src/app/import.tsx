/**
 * Transcription progress for an uploaded audio file, between picking the file and landing
 * in the editor. A route rather than a modal on Home because every creation path has to
 * funnel into the same downstream Edit/Export experience, and because this screen is where
 * automatic key detection will present its result (and MIDI import its target-key choice)
 * without either of them growing a second entry flow.
 */

import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { WEB_CONTENT_WIDTH, webMaxWidth } from '@/constants/layout';
import { useTheme } from '@/hooks/useTheme';
import { AudioImportError, type ImportErrorCode } from '@/audio/audioImport';
import { pushFrames } from '@/audio/frameBuffer';
import { clearPendingImport, getPendingImport, setPendingImport } from '@/audio/pendingImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { framesToNotes } from '@/audio/framesToNotes';
import type { KeyDetectionResult } from '@/audio/keyDetection';
import { runAudioImport, type ImportStage } from '@/audio/runAudioImport';
import { selectHarmonicaType, selectKey, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { Theme } from '@/theme';
import type { HarmonicaKey, RawFrame } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Phase =
  | { kind: 'working'; stage: ImportStage; fraction: number }
  | { kind: 'confirm'; detection: KeyDetectionResult; frames: RawFrame[]; chosenKey: HarmonicaKey }
  | { kind: 'error';   code: ImportErrorCode; message: string };

/** How many candidate keys the confirm step offers. The winner plus the two next-best,
 *  which in practice is straight harp plus the cross-harp positions around it. */
const ALTERNATES_SHOWN = 3;

const POSITION_LABELS: Record<number, string> = {
  1: '1st position (straight harp)',
  2: '2nd position (cross harp)',
  3: '3rd position (slant harp)',
};

function positionLabel(position: number): string {
  return POSITION_LABELS[position] ?? `${position}th position`;
}

/** Decoding has no measurable progress of its own, so it holds a small non-zero bar —
 *  enough to read as "started", not enough to imply real progress it can't report. */
const DECODE_BAR_FRACTION = 0.06;

export default function ImportScreen() {
  const router = useRouter();
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const selectedKey    = useAppStore(selectKey);
  const harmonicaType  = useAppStore(selectHarmonicaType);
  const startImportedSession = useAppStore((s) => s.startImportedSession);
  const selectKey_           = useAppStore((s) => s.selectKey);
  const addTabNotes          = useAppStore((s) => s.addTabNotes);
  const incrementRecordingCount = useSettingsStore((s) => s.incrementRecordingCount);

  const [phase, setPhase] = useState<Phase>({ kind: 'working', stage: 'decoding', fraction: 0 });
  const [fileName, setFileName] = useState(getPendingImport()?.name ?? '');

  const cancelledRef = useRef(false);
  // Guards against a second run in React strict mode's double-invoked effect — the import
  // is expensive and would otherwise be started twice for one file.
  const startedRef   = useRef(false);

  useEffect(() => {
    // Re-armed on every mount, not just the first: React strict mode mounts, unmounts and
    // remounts, and the unmount cleanup below sets the cancel flag. Without re-arming here
    // the already-running import would see that flag and abort itself.
    cancelledRef.current = false;

    if (!startedRef.current) {
      startedRef.current = true;

      const picked = getPendingImport();
      if (!picked || !selectedKey) {
        router.replace('/');
        return;
      }
      void transcribe();
    }

    // Leaving the screen (browser back, or any other navigation) abandons the import
    // rather than letting it finish and yank the user into the editor.
    return () => { cancelledRef.current = true; };
  }, []);

  async function transcribe() {
    const picked = getPendingImport();
    if (!picked || !selectedKey) return;

    cancelledRef.current = false;
    setFileName(picked.name);
    setPhase({ kind: 'working', stage: 'decoding', fraction: 0 });

    // The filename makes a far better default library title than the timestamp fallback.
    const title = picked.name.replace(/\.[^.]+$/, '');
    startImportedSession(title);
    const { recordingId } = useAppStore.getState();

    try {
      const result = await runAudioImport({
        picked,
        harmonicaType,
        onProgress:    (p) => setPhase({ kind: 'working', stage: p.stage, fraction: p.fraction }),
        shouldCancel:  () => cancelledRef.current,
      });

      // Chromatic covers every semitone in its range, so key detection has nothing to tell
      // the user — go straight to the editor on the key they already chose.
      if (!result.detection) {
        commit(result.frames, selectedKey);
        return;
      }

      setPhase({
        kind:      'confirm',
        detection: result.detection,
        frames:    result.frames,
        chosenKey: result.detection.best.key,
      });
    } catch (err) {
      const isImportError = err instanceof AudioImportError;
      const code    = isImportError ? err.code : 'decodeFailed';
      const message = isImportError
        ? err.message
        : `"${picked.name}" couldn't be transcribed.`;

      if (code === 'cancelled') {
        clearPendingImport();
        router.replace('/');
        return;
      }
      setPhase({ kind: 'error', code, message });
    }
  }

  /** Turns the analyzed frames into notes for the chosen key and hands the session to the
   *  editor. Cheap enough to re-run for a different key — no audio is touched here. */
  function commit(frames: RawFrame[], key: HarmonicaKey) {
    const notes = framesToNotes(frames, key, harmonicaType);
    if (notes.length === 0) {
      setPhase({
        kind:    'error',
        code:    'noAudio',
        message: `No notes in this recording fit a ${key} ${harmonicaType === 'chromatic' ? 'chromatic' : 'diatonic'} harmonica. Try a different key.`,
      });
      return;
    }

    const { recordingId } = useAppStore.getState();
    // Frames are retained under the session's own id so Frame Inspector opens on an
    // imported session exactly like it does on a recorded one.
    if (recordingId) pushFrames(recordingId, frames);
    // The key the notes were actually detected against becomes the session's key —
    // otherwise the editor would relabel every tab against the pre-upload selection.
    selectKey_(key);
    addTabNotes(notes);

    // The free-tier session is consumed here, on success — not when the file was picked.
    // A cancelled pick or a file that fails to decode must not cost a user a recording.
    incrementRecordingCount();

    clearPendingImport();
    router.replace('/edit');
  }

  function handleCancel() {
    cancelledRef.current = true;
    clearPendingImport();
    router.replace('/');
  }

  async function handleTryAnotherFile() {
    // Opened from a real press, so the browser's file dialog is allowed here.
    try {
      const picked = await pickAudioFile();
      if (!picked) return;
      setPendingImport(picked);
      void transcribe();
    } catch (err) {
      const isImportError = err instanceof AudioImportError;
      setPhase({
        kind:    'error',
        code:    isImportError ? err.code : 'decodeFailed',
        message: isImportError ? err.message : "That file couldn't be opened.",
      });
    }
  }

  if (phase.kind === 'confirm') {
    const { detection, frames, chosenKey } = phase;
    const candidates = detection.ranked.slice(0, ALTERNATES_SHOWN);
    // A small gap between the top two keys is the normal case for a plain major melody
    // (the cross-harp key fits nearly as well), so this reads as "worth a look", not as a
    // failure — hence a hint to check the alternates rather than a warning.
    const closeCall = detection.margin < 0.06;

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={styles.iconCircle}>
            <Ionicons name="key-outline" size={30} color={theme.accent} />
          </View>

          <Text style={styles.title}>Detected {detection.best.key} harmonica</Text>
          <Text style={styles.message}>
            {Math.round(detection.best.mappedFraction * 100)}% of what you played fits a {detection.best.key} harp
            {detection.best.bendFraction > 0.05
              ? `, with ${Math.round(detection.best.bendFraction * 100)}% needing bends`
              : ' without bending'}.
            {closeCall ? ' Other keys fit almost as well — check the alternatives below.' : ''}
          </Text>

          {detection.octaveShiftSemitones !== 0 && (
            <View style={styles.noticeRow}>
              <Ionicons name="swap-vertical-outline" size={14} color={theme.warning} />
              <Text style={styles.noticeText}>
                Transposed {detection.octaveShiftSemitones > 0 ? 'up' : 'down'}{' '}
                {Math.abs(detection.octaveShiftSemitones) / 12} octave
                {Math.abs(detection.octaveShiftSemitones) === 12 ? '' : 's'} to fit the harmonica&apos;s range.
              </Text>
            </View>
          )}

          <View style={styles.candidateList} accessibilityRole="radiogroup">
            {candidates.map((candidate) => {
              const active = candidate.key === chosenKey;
              return (
                <Pressable
                  key={candidate.key}
                  onPress={() => setPhase({ ...phase, chosenKey: candidate.key })}
                  style={({ pressed, hovered }: any) => [
                    styles.candidate,
                    active && styles.candidateActive,
                    (pressed || hovered) && !active && styles.candidateHovered,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${candidate.key} harmonica, ${positionLabel(candidate.position)}, ${Math.round(candidate.mappedFraction * 100)} percent fit`}
                >
                  <Text style={[styles.candidateKey, active && styles.candidateKeyActive]}>{candidate.key}</Text>
                  <View style={styles.candidateInfo}>
                    <Text style={[styles.candidatePosition, active && styles.candidateTextActive]}>
                      {positionLabel(candidate.position)}
                    </Text>
                    <Text style={styles.candidateStats}>
                      {Math.round(candidate.mappedFraction * 100)}% fit
                      {candidate.bendFraction > 0.05 && ` · ${Math.round(candidate.bendFraction * 100)}% bends`}
                      {candidate.overblowFraction > 0.02 && ` · ${Math.round(candidate.overblowFraction * 100)}% overblows`}
                    </Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={18} color={theme.accent} />}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={() => commit(frames, chosenKey)}
              style={({ pressed, hovered }: any) => [
                styles.primaryBtn,
                (pressed || hovered) && styles.primaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Continue with ${chosenKey} harmonica`}
            >
              <Text style={styles.primaryBtnText}>Continue with {chosenKey}</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </Pressable>

            <Pressable
              onPress={handleCancel}
              style={({ pressed, hovered }: any) => [
                styles.secondaryBtn,
                (pressed || hovered) && styles.secondaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Discard this import"
            >
              <Text style={styles.secondaryBtnText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (phase.kind === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={styles.iconCircleError}>
            <Ionicons name="alert-circle-outline" size={30} color={theme.warning} />
          </View>
          <Text style={styles.title}>Couldn&apos;t transcribe that file</Text>
          <Text style={styles.message}>{phase.message}</Text>

          <View style={styles.actions}>
            <Pressable
              onPress={handleTryAnotherFile}
              style={({ pressed, hovered }: any) => [
                styles.primaryBtn,
                (pressed || hovered) && styles.primaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Choose another file"
            >
              <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Choose another file</Text>
            </Pressable>

            <Pressable
              onPress={() => { clearPendingImport(); router.replace('/'); }}
              style={({ pressed, hovered }: any) => [
                styles.secondaryBtn,
                (pressed || hovered) && styles.secondaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Back to home"
            >
              <Text style={styles.secondaryBtnText}>Back to home</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const barFraction = phase.stage === 'decoding'
    ? DECODE_BAR_FRACTION
    : Math.max(DECODE_BAR_FRACTION, phase.fraction);
  const percent = Math.round(barFraction * 100);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconCircle}>
          <Ionicons name="musical-notes-outline" size={30} color={theme.accent} />
        </View>

        <Text style={styles.title}>Transcribing</Text>
        <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>

        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
        >
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>

        <Text style={styles.stageLabel}>
          {phase.stage === 'decoding'
            ? 'Reading the audio file…'
            : `Detecting notes — ${percent}%`}
        </Text>

        <Text style={styles.hint}>
          {harmonicaType === 'chromatic'
            // Detection is skipped for chromatic, so the chosen key is what's actually used.
            ? `Transcribing for a ${selectedKey} 12-hole chromatic harmonica.`
            : "Pitch detection doesn't need the key — the harmonica key is worked out afterwards."}
        </Text>

        <Pressable
          onPress={handleCancel}
          style={({ pressed, hovered }: any) => [
            styles.secondaryBtn,
            (pressed || hovered) && styles.secondaryBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Cancel transcription"
        >
          <Text style={styles.secondaryBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    safe: {
      flex:            1,
      backgroundColor: theme.bg,
    },
    container: {
      flex:           1,
      alignItems:     'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap:            12,
      ...webMaxWidth(WEB_CONTENT_WIDTH.narrow),
    },
    iconCircle: {
      width:           64,
      height:          64,
      borderRadius:    32,
      alignItems:      'center',
      justifyContent:  'center',
      backgroundColor: theme.accentSoft,
      marginBottom:    4,
    },
    iconCircleError: {
      width:           64,
      height:          64,
      borderRadius:    32,
      alignItems:      'center',
      justifyContent:  'center',
      backgroundColor: theme.warningSoft,
      marginBottom:    4,
    },
    title: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.lg,
      color:      theme.textPrimary,
    },
    fileName: {
      fontFamily: SpaceGrotesk.regular,
      fontSize:   13,
      color:      theme.textSub,
      maxWidth:   '100%',
    },
    message: {
      fontFamily: Poppins.regular,
      fontSize:   14,
      lineHeight: 21,
      color:      theme.textSub,
      textAlign:  'center',
      marginTop:  2,
    },
    progressTrack: {
      width:           '100%',
      height:          6,
      borderRadius:    3,
      backgroundColor: theme.surfaceAlt,
      overflow:        'hidden',
      marginTop:       14,
    },
    progressFill: {
      height:          '100%',
      borderRadius:    3,
      backgroundColor: theme.accent,
    },
    stageLabel: {
      fontFamily: SpaceGrotesk.medium,
      fontSize:   13,
      color:      theme.textPrimary,
      marginTop:  4,
    },
    hint: {
      fontFamily: Poppins.regular,
      fontSize:   12,
      color:      theme.textMuted,
      textAlign:  'center',
    },
    noticeRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingHorizontal: 10,
      paddingVertical:   8,
      borderRadius:      10,
      backgroundColor:   theme.warningSoft,
      marginTop:         4,
    },
    noticeText: {
      flex:       1,
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      theme.textSub,
    },
    candidateList: {
      width:     '100%',
      gap:       8,
      marginTop: 14,
    },
    candidate: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius:    10,
      borderWidth:     1,
      borderColor:     theme.border,
      backgroundColor: theme.surface,
    },
    candidateActive: {
      borderColor:     theme.accent,
      backgroundColor: theme.accentSoft,
    },
    candidateHovered: {
      backgroundColor: theme.surfaceAlt,
    },
    candidateKey: {
      fontFamily: SpaceGrotesk.bold,
      fontSize:   FONT.md,
      color:      theme.textSub,
      minWidth:   28,
      textAlign:  'center',
    },
    candidateKeyActive: { color: theme.accent },
    candidateInfo:      { flex: 1, gap: 1 },
    candidatePosition: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.sm,
      color:      theme.textPrimary,
    },
    candidateTextActive: { color: theme.textPrimary },
    candidateStats: {
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      theme.textSub,
    },
    actions: {
      marginTop:  18,
      width:      '100%',
      gap:        10,
      alignItems: 'center',
    },
    primaryBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      width:           '100%',
      paddingVertical: 13,
      borderRadius:    10,
      backgroundColor: theme.accent,
    },
    primaryBtnPressed: {
      backgroundColor: theme.accentDim,
    },
    primaryBtnText: {
      fontFamily: Poppins.semiBold,
      fontSize:   14,
      color:      '#fff',
    },
    secondaryBtn: {
      paddingVertical:   11,
      paddingHorizontal: 18,
      borderRadius:      10,
      borderWidth:       1,
      borderColor:       theme.border,
      marginTop:         10,
    },
    secondaryBtnPressed: {
      backgroundColor: theme.surface,
    },
    secondaryBtnText: {
      fontFamily: Poppins.medium,
      fontSize:   13,
      color:      theme.textSub,
    },
  });
}
