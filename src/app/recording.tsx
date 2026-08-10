import { PulsingIndicator } from '@/components/PulsingIndicator';
import { TabCard } from '@/components/TabCard';
import { LiveAnalysisPanel } from '@/components/LiveAnalysisPanel';
import { ActionSheetModal } from '@/components/ActionSheetModal';
import { TranscriptionEngineModal } from '@/components/TranscriptionEngineModal';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import { useTheme } from '@/hooks/useTheme';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { availableAlgorithms, getAlgorithm, withDefaults, type TranscriptionAlgorithmId } from '@/audio/algorithms';
import { setPendingDecodedImport } from '@/audio/pendingImport';
import { clearFrames } from '@/audio/frameBuffer';
import { clearRetainedPcm, getMaxTakeMs, isRetentionTruncated, takeRetainedPcm } from '@/native/AudioCapture';
import { getDefaultRecordingTitle } from '@/store/sessionSnapshot';
import type { DecodedAudio } from '@/audio/audioImport';
import {
  selectHarmonicaType, selectIsPaused, selectIsRecording, selectKey, selectRecordingId, selectTabNotes, useAppStore,
} from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import type { Theme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Inside the last minute of the cap. The take's length now bounds what can be transcribed,
 *  so the warning has to arrive before the wall, not after it. */
const WARN_REMAINING_MS = 60_000;

export default function RecordingScreen() {
  const router        = useRouter();
  const theme         = useTheme();
  const styles        = useMemo(() => createStyles(theme), [theme]);
  const selectedKey   = useAppStore(selectKey);
  const harmonicaType = useAppStore(selectHarmonicaType);
  const recordingId   = useAppStore(selectRecordingId);
  const isRecording   = useAppStore(selectIsRecording);
  const isPaused      = useAppStore(selectIsPaused);
  const tabNotes      = useAppStore(selectTabNotes);
  const stopRecording          = useAppStore((s) => s.stopRecording);
  const startRecording         = useAppStore((s) => s.startRecording);
  const abortRecording         = useAppStore((s) => s.abortRecording);
  const discardSession         = useAppStore((s) => s.discardSession);
  const pauseRecording         = useAppStore((s) => s.pauseRecording);
  const resumeRecording        = useAppStore((s) => s.resumeRecording);
  const defaultAlgorithm       = useSettingsStore((s) => s.defaultAlgorithm);
  const savedParams            = useSettingsStore((s) => s.transcriptionParams);
  const setDefaultAlgorithm    = useSettingsStore((s) => s.setDefaultAlgorithm);

  const listRef       = useRef<FlatList>(null);
  const startMsRef    = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const pausedMsRef   = useRef(0);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  /** Set by Finish, read by the effect below — see `handleStop` for why the take can only
   *  be collected one commit later. */
  const [finishing, setFinishing] = useState(false);
  /** The retained take, once collected. Its presence is what puts the engine picker up. */
  /**
   * The finished take, held here from Finish until it is spent or thrown away.
   *
   * This is the *only* copy: `takeRetainedPcm` hands the buffer over and drops its own
   * blocks, so once Finish has run there is nothing left to collect a second time.
   */
  const [take, setTake] = useState<(DecodedAudio & { truncated: boolean }) | null>(null);
  /**
   * Whether the engine picker is up — deliberately not `take !== null`.
   *
   * They were the same flag until dismissing the picker was found to destroy the take: the
   * only way to close it was to clear the thing it was about, and the next Finish then found
   * an empty buffer and fell through to the editor with the live transcription. Separate,
   * "cancel" means what the picker always claimed it meant — back to the take, press Finish
   * again when ready.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [algorithmId, setAlgorithmId] = useState<TranscriptionAlgorithmId>(defaultAlgorithm);
  /** Whether retention has stopped because the cap was reached. Recording itself carries
   *  on, which is exactly what the notice has to say. */
  const [retentionStopped, setRetentionStopped] = useState(false);
  /** Set by Restart/Discard, read by the effect below — the same one-commit-later handoff
   *  `finishing` uses, and for the same reason. */
  const [abandoning, setAbandoning] = useState<'restart' | 'discard' | null>(null);
  /** Which abandon is waiting on a yes. Null when no dialog is up. */
  const [confirming, setConfirming] = useState<'restart' | 'discard' | null>(null);

  const engines  = useMemo(() => availableAlgorithms(), []);
  const maxTakeMs = useMemo(() => getMaxTakeMs(), []);

  useKeepAwake();

  const { permissionDenied } = useAudioCapture();

  // Must be a real Modal, not Alert.alert — react-native-web ships Alert.alert as a
  // literal no-op (`static alert() {}`), so the old web branch here silently showed the
  // user nothing at all and stranded them on a dead "READY" screen with no way back.
  // ActionSheetModal already exists precisely for this (see its header comment).
  useEffect(() => {
    if (permissionDenied) setPermissionModalOpen(true);
  }, [permissionDenied]);

  // Reset timing state when a new recording begins
  useEffect(() => {
    if (isRecording) {
      startMsRef.current    = Date.now();
      pausedMsRef.current   = 0;
      pauseStartRef.current = null;
      setElapsedMs(0);
      setRetentionStopped(false);
    }
  }, [isRecording]);

  // Elapsed timer — pauses automatically when isPaused. Also the poll for whether retention
  // has hit its cap: the capture module has no way to tell the screen, and this tick is
  // already the one place that cares about how long the take has run.
  useEffect(() => {
    if (!isRecording || isPaused) return;
    const id = setInterval(() => {
      setElapsedMs(Date.now() - startMsRef.current - pausedMsRef.current);
      if (isRetentionTruncated()) setRetentionStopped(true);
    }, 500);
    return () => clearInterval(id);
  }, [isRecording, isPaused]);

  /**
   * Collect the take — one commit after Finish, deliberately.
   *
   * `stopRecording()` is what tears the capture down, and the teardown is where the detector
   * flushes the note that was still sounding (`useAudioCapture`'s cleanup). Reading the take
   * inside `handleStop` would run *before* both: the PCM buffer would still be filling, and
   * the live note count shown in the picker — the whole frame for the decision — would be
   * short by exactly the last note played.
   */
  useEffect(() => {
    if (!finishing || isRecording) return;
    setFinishing(false);

    const retained = takeRetainedPcm();
    if (!retained || retained.samples.length === 0) {
      // Nothing was kept — native, or a take that produced no audio. Straight to the editor
      // with the live transcription, which is exactly what this screen did before.
      router.push('/edit');
      return;
    }
    setTake(retained);
    setPickerOpen(true);
  }, [finishing, isRecording]);

  /**
   * Throw the take away — one commit after Restart/Discard, for the mirror image of the
   * reason Finish waits.
   *
   * `abortRecording()` only flips `isRecording`; the capture teardown that follows it is
   * still pushing frames under `recordingId` and still about to flush the note that was
   * sounding. Clearing from inside the handler would wipe a buffer that then refills, and
   * leave that flushed note sitting in a session the user just discarded. By here the
   * teardown has run, `recordingId` is still the abandoned take's, and both go together.
   */
  useEffect(() => {
    if (!abandoning || isRecording) return;
    setAbandoning(null);

    clearRetainedPcm();
    if (recordingId) clearFrames(recordingId);
    // Including a take already collected by a Finish the user then backed out of — Restart
    // and Discard both mean this one is over, and leaving it in hand would let the next
    // Finish offer the take that was just thrown away.
    setTake(null);
    setPickerOpen(false);

    if (abandoning === 'restart') {
      // Straight into a new take: `startRecording()` mints a fresh recordingId and clears
      // the notes, and the timing effect above resets the clock off `isRecording`. No
      // `resolveSessionGate` call — the free tier is spent at conversion, not here, so
      // restarting a fumbled take must not cost the user a session.
      startRecording();
    } else {
      discardSession();
      router.replace('/');
    }
  }, [abandoning, isRecording]);

  useEffect(() => {
    if (isRecording) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [tabNotes, isRecording]);

  // Spacebar toggles pause/resume — the universal transport shortcut, and this screen has
  // no text input to compete with (the guard below is belt-and-braces for the permission
  // modal and anything added later). Same screen-level keydown pattern as edit.tsx's
  // Ctrl/Cmd+Z. preventDefault stops the browser scrolling the notes list on every press.
  useEffect(() => {
    if (Platform.OS !== 'web' || !isRecording) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      if (isPaused) handleResume();
      else handlePause();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRecording, isPaused]);

  function handlePause() {
    pauseStartRef.current = Date.now();
    pauseRecording();
  }

  function handleResume() {
    if (pauseStartRef.current !== null) {
      pausedMsRef.current  += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    resumeRecording();
  }

  /**
   * Finish. Stops the capture and hands off to the effect above, which collects the take
   * once the teardown has run.
   *
   * The free-tier session is deliberately *not* consumed here any more. A take now lands in
   * the Studio as a draft, exactly as a file import does, and the import path has always
   * held that the gate belongs at conversion — "where a tab is actually produced". Charging
   * for a take the moment the user stops playing, while the identical draft from a file
   * costs nothing, would be two rules for one destination.
   */
  function handleStop() {
    // Already finished once and the picker was dismissed: the take is in hand and the
    // capture is long torn down, so this is only a request to be asked again. Running the
    // collect cycle a second time would read an empty buffer — `takeRetainedPcm` kept
    // nothing — and take the user to the editor instead.
    if (take) { setPickerOpen(true); return; }
    stopRecording();
    setFinishing(true);
  }

  /**
   * Restart and Discard both destroy a take that cannot be got back, so both ask first —
   * but only once there is something to lose. Confirming an empty take would be a dialog
   * about nothing, and the commonest use of Restart is exactly that: a false start, cleared
   * in one press.
   */
  function requestAbandon(kind: 'restart' | 'discard') {
    if (tabNotes.length === 0) { beginAbandon(kind); return; }
    setConfirming(kind);
  }

  function beginAbandon(kind: 'restart' | 'discard') {
    abortRecording();
    setAbandoning(kind);
  }

  /** Transcribe the take: hand it to `/import`, with the engine already decided so that
   *  screen doesn't ask a second time. */
  function handleTranscribe() {
    if (!take) return;
    setDefaultAlgorithm(algorithmId);
    setPendingDecodedImport({
      audio:     { samples: take.samples, sampleRate: take.sampleRate, durationMs: take.durationMs },
      title:     getDefaultRecordingTitle(),
      truncated: take.truncated,
      algorithm: algorithmId,
      params:    withDefaults(getAlgorithm(algorithmId), savedParams[algorithmId]),
    });
    setTake(null);
    setPickerOpen(false);
    router.push('/import');
  }

  /** The fast path, and today's behaviour exactly: the live pass already produced these
   *  notes, so keeping them costs nothing and never touches the import screen. */
  function handleUseLive() {
    setTake(null);
    setPickerOpen(false);
    router.push('/edit');
  }

  // Elapsed against the cap rather than a bare running clock. The number matters to the user
  // now in a way it didn't: it bounds how much of the take can be transcribed at all.
  const nearingCap = maxTakeMs - elapsedMs <= WARN_REMAINING_MS;
  const elapsedNode = (
    <Text
      style={[styles.elapsed, isRecording && nearingCap && styles.elapsedWarning]}
      accessibilityLabel={`${clock(elapsedMs)} of ${clock(maxTakeMs)} recorded`}
    >
      {clock(elapsedMs)}
      <Text style={styles.elapsedCap}> / {clock(maxTakeMs)}</Text>
    </Text>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Status strip (web) — the old 160px pulsing circle's job (am I being heard?) is
            now done far better by the LOUDNESS track below, so on web it shrinks to a
            live dot in a three-column strip: status left, elapsed centered, key right.
            Native keeps the original big-indicator layout, where it's still the only
            signal feedback there is. */}
        {Platform.OS === 'web' ? (
          <View style={styles.statusBar}>
            <View style={styles.statusSide}>
              <View style={styles.statusPill}>
                <PulsingIndicator active={isRecording && !isPaused} size={12} />
                <Text style={styles.statusPillText}>
                  {!isRecording ? 'READY' : isPaused ? 'PAUSED' : 'RECORDING'}
                </Text>
              </View>
            </View>

            {elapsedNode}

            <View style={[styles.statusSide, styles.statusSideRight]}>
              <View style={styles.keyBadge}>
                <Text style={styles.keyBadgeLabel}>KEY</Text>
                <Text style={styles.keyBadgeValue}>{selectedKey ?? '—'}</Text>
                <Text style={styles.keyBadgeType}>
                  {harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.topBar}>
              <View style={styles.keyBadge}>
                <Text style={styles.keyBadgeLabel}>KEY</Text>
                <Text style={styles.keyBadgeValue}>{selectedKey ?? '—'}</Text>
              </View>
              <View style={styles.topRight}>
                {elapsedNode}
                <Pressable
                  onPress={() => router.push('/settings')}
                  style={({ pressed }) => [styles.gearBtn, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Open settings"
                >
                  <Ionicons name="settings-outline" size={28} color={theme.textSub} />
                </Pressable>
              </View>
            </View>

            <View style={styles.indicatorArea}>
              <PulsingIndicator active={isRecording && !isPaused} size={160} />
              <Text style={styles.statusLabel}>
                {!isRecording ? 'READY' : isPaused ? 'PAUSED' : 'RECORDING'}
              </Text>
            </View>
          </>
        )}

        {/* Live feed — web gets a wide analysis panel (loudness/pitch/notes/raw, updating
            as you play) next to a narrower notes list; native keeps the single column,
            there's no room for a second panel on a phone screen. */}
        {Platform.OS === 'web' ? (
          <View style={styles.liveShell}>
            <LiveAnalysisPanel
              recordingId={recordingId}
              isRecording={isRecording}
              isPaused={isPaused}
              tabNotes={tabNotes}
              harmonicaKey={selectedKey}
              harmonicaType={harmonicaType}
            />
            <View style={styles.notesColumn}>
              <View style={styles.notesHeader}>
                <View style={styles.notesHeaderLeft}>
                  <Text style={styles.sectionLabel}>NOTES</Text>
                  {/* Finish replaces these with a full transcription pass. Someone who spent
                      the take watching them appear needs to know that before it happens,
                      not after — so the chip is on the header, not in a dialog later. */}
                  <View style={styles.liveChip}>
                    <Text style={styles.liveChipText}>LIVE</Text>
                  </View>
                </View>
                <Text style={styles.notesCount}>{tabNotes.length}</Text>
              </View>

              {tabNotes.length === 0 ? (
                <View style={styles.emptyFeed}>
                  <Text style={styles.emptyText}>Play something on your harmonica…</Text>
                  <Text style={styles.emptySubText}>
                    What appears here is a live read. Finish re-transcribes the whole take.
                  </Text>
                </View>
              ) : (
                <FlatList
                  ref={listRef}
                  data={tabNotes}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item, index }) => <TabCard note={item} index={index} />}
                  style={styles.list}
                  contentContainerStyle={{ paddingBottom: 8 }}
                  showsVerticalScrollIndicator={false}
                />
              )}
            </View>
          </View>
        ) : (
          <View style={styles.feedSection}>
            <Text style={styles.sectionLabel}>NOTES</Text>

            {tabNotes.length === 0 ? (
              <View style={styles.emptyFeed}>
                <Text style={styles.emptyText}>Play something on your harmonica…</Text>
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={tabNotes}
                keyExtractor={(item) => item.id}
                renderItem={({ item, index }) => <TabCard note={item} index={index} />}
                style={styles.list}
                contentContainerStyle={{ paddingBottom: 8 }}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>
        )}

        {/* The cap has been reached. Recording and the live read both carry on — only
            retention stopped — so the copy has to say exactly that, or it reads as
            "recording stopped" and the user hits Finish in a panic. */}
        {retentionStopped && (
          <View style={styles.noticeRow} accessibilityRole="alert">
            <Ionicons name="alert-circle-outline" size={14} color={theme.warning} />
            <Text style={styles.noticeText}>
              This take has reached {clock(maxTakeMs)}, the most that can be kept for
              transcription. You can keep playing — the notes below still update — but only
              what came before this point can be re-transcribed on Finish.
            </Text>
          </View>
        )}

        {/* Transport — Finish is always available now, not gated behind pausing first
            (ending a take shouldn't cost two clicks and a mode change). On web this is a
            docked full-bleed footer, matching the edit screen's transport bar. */}
        <View style={styles.actions}>
          {/* Restart and Discard sit together, left of the transport proper: both throw the
              take away, and grouping them keeps that one irreversible idea in one place
              instead of scattering it either side of Pause. On native they share a row so
              the footer doesn't become four stacked full-width slabs. */}
          <View style={styles.secondaryRow}>
            <Pressable
              onPress={() => requestAbandon('restart')}
              style={({ pressed, hovered }: any) => [
                styles.secondaryBtn,
                (pressed || (Platform.OS === 'web' && hovered)) && styles.pauseBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Restart Recording"
              accessibilityHint="Discards this take and starts a new one"
            >
              <Ionicons name="refresh" size={18} color={theme.textSub} />
              <Text style={styles.pauseBtnText}>Restart</Text>
            </Pressable>

            <Pressable
              onPress={() => requestAbandon('discard')}
              style={({ pressed, hovered }: any) => [
                styles.secondaryBtn,
                (pressed || (Platform.OS === 'web' && hovered)) && styles.discardBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Discard Recording"
              accessibilityHint="Discards this take and returns to the home screen"
            >
              <Ionicons name="trash-outline" size={18} color={theme.record} />
              <Text style={[styles.pauseBtnText, styles.discardBtnText]}>Discard</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={isPaused ? handleResume : handlePause}
            style={({ pressed, hovered }: any) => [
              styles.pauseBtn,
              (pressed || (Platform.OS === 'web' && hovered)) && styles.pauseBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={isPaused ? 'Resume Recording' : 'Pause Recording'}
          >
            <Ionicons name={isPaused ? 'play' : 'pause'} size={18} color={theme.textSub} />
            <Text style={styles.pauseBtnText}>{isPaused ? 'Resume' : 'Pause'}</Text>
            {Platform.OS === 'web' && <Text style={styles.shortcutHint}>Space</Text>}
          </Pressable>

          <Pressable
            onPress={handleStop}
            disabled={tabNotes.length === 0}
            style={({ pressed, hovered }: any) => [
              styles.stopBtn,
              tabNotes.length === 0 && styles.stopBtnDisabled,
              (pressed || (Platform.OS === 'web' && hovered)) && tabNotes.length > 0 && styles.stopBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Finish Recording"
            accessibilityState={{ disabled: tabNotes.length === 0 }}
          >
            <View style={styles.stopIcon} />
            <Text style={styles.stopBtnText}>Finish</Text>
          </Pressable>
        </View>

      </View>

      {/* Asked here, on Finish, rather than on the screen the take is about to go to: the
          user is still with the performance they just gave, and the live note count below
          is the evidence that makes the choice answerable. Dismissing returns to the take —
          nothing is lost, the PCM is still held and Finish can be pressed again. */}
      <TranscriptionEngineModal
        visible={pickerOpen}
        algorithms={engines}
        selectedId={algorithmId}
        onSelect={setAlgorithmId}
        onConfirm={handleTranscribe}
        onClose={() => setPickerOpen(false)}
        subtitle={`${getDefaultRecordingTitle()} · ${clock(take?.durationMs ?? 0)}`}
        liveNoteCount={tabNotes.length}
        secondaryLabel="Use the live version"
        onSecondary={handleUseLive}
        // Dismissing returns to the take, which is still here — nothing is lost, so it
        // needs naming rather than confirming.
        cancelLabel="Cancel"
      />

      {/* Says what is lost, in the unit the user has been watching go up all take — a note
          count is the only honest measure of "are you sure" here. */}
      <ActionSheetModal
        visible={confirming !== null}
        title={confirming === 'restart'
          ? `Start over? The ${tabNotes.length} note${tabNotes.length === 1 ? '' : 's'} in this take will be discarded.`
          : `Discard this take? Its ${tabNotes.length} note${tabNotes.length === 1 ? '' : 's'} can't be recovered.`}
        options={[
          {
            label: confirming === 'restart' ? 'Restart' : 'Discard',
            style: 'destructive',
            onPress: () => beginAbandon(confirming ?? 'discard'),
          },
          { label: 'Keep Recording' },
        ]}
        onClose={() => setConfirming(null)}
      />

      <ActionSheetModal
        visible={permissionModalOpen}
        title={Platform.OS === 'web'
          ? 'Microphone access is blocked. Allow it from your browser’s address bar, then reload and try again.'
          : 'Harp2Tab needs microphone access to record. Please enable it in your device settings.'}
        options={[
          ...(Platform.OS !== 'web'
            ? [{ label: 'Open Settings', onPress: () => Linking.openSettings() }]
            : []),
          { label: 'Go Back', onPress: () => router.back() },
        ]}
        // Plain dismiss only — ActionSheetModal fires onClose *before* an option's own
        // onPress, so routing here too would pop twice for the "Go Back" option.
        onClose={() => setPermissionModalOpen(false)}
      />
    </SafeAreaView>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      // No webMaxWidth cap — the live analysis panel is a wide, DAW-ish readout that
      // benefits from every pixel a monitor offers, same full-bleed reasoning as Edit's
      // piano-roll/list workspace rather than the centered-column utility screens.
      width: '100%',
      paddingHorizontal: 24,
      paddingTop: Platform.OS === 'web' ? WEB_SCREEN_PADDING_TOP : 16,
      paddingBottom: Platform.OS === 'web' ? WEB_SCREEN_PADDING_BOTTOM : 24,
      gap: 20,
    },
    topBar: {
      flexDirection:  'row',
      justifyContent: 'space-between',
      alignItems:     'center',
    },
    topRight: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           12,
    },
    gearBtn: { padding: 4 },
    keyBadge: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             8,
      backgroundColor: t.surface,
      borderRadius:    10,
      paddingHorizontal: 12,
      paddingVertical:   7,
      borderWidth:     1,
      borderColor:     t.border,
    },
    keyBadgeLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1.2,
    },
    keyBadgeValue: {
      fontSize:   FONT.md,
      fontFamily: Poppins.extraBold,
      color:      t.accent,
    },
    keyBadgeType: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.semiBold,
      color:      t.textMuted,
    },
    elapsed: {
      fontSize:      FONT['2xl'],
      fontFamily:    Poppins.thin,
      color:         t.textSub,
      fontVariant:   ['tabular-nums'],
      letterSpacing: 1,
    },
    elapsedWarning: { color: t.warning },
    // Smaller and dimmer than the running figure: the cap is context for the number, not a
    // second number of equal weight.
    elapsedCap: {
      fontSize:   FONT.md,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
    },
    notesHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    liveChip: {
      paddingHorizontal: 6,
      paddingVertical:   2,
      borderRadius:      4,
      backgroundColor:   t.surfaceAlt,
      borderWidth:       1,
      borderColor:       t.border,
    },
    liveChipText: {
      fontSize:      9,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 0.8,
    },
    // Same shape the import screen uses for its octave-shift aside, so a notice reads the
    // same wherever it appears.
    noticeRow: {
      flexDirection:     'row',
      alignItems:        'flex-start',
      gap:               6,
      paddingHorizontal: 10,
      paddingVertical:   8,
      borderRadius:      10,
      backgroundColor:   t.warningSoft,
    },
    noticeText: {
      flex:       1,
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      lineHeight: 17,
      color:      t.textSub,
    },

    // Web status strip — three columns (status / elapsed / key) with both sides flex:1
    // so the elapsed timer stays dead-centered no matter what either side weighs, the
    // same trick edit.tsx's transport bar uses.
    statusBar: {
      flexDirection: 'row',
      alignItems:    'center',
    },
    statusSide:      { flex: 1, flexDirection: 'row', alignItems: 'center' },
    statusSideRight: { justifyContent: 'flex-end' },
    statusPill: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               8,
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
      borderRadius:      20,
      paddingHorizontal: 12,
      paddingVertical:   6,
    },
    statusPillText: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textSub,
      letterSpacing: 1.4,
    },

    indicatorArea: {
      alignItems:    'center',
      gap:           16,
      paddingVertical: 8,
    },
    statusLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 2,
    },
    feedSection: { flex: 1, gap: 10 },
    // Web-only two-column live feed — analysis panel takes the remaining space (the
    // "big column"), notes list stays a fixed, comfortably-readable width next to it.
    liveShell: { flex: 1, flexDirection: 'row', gap: 16 },
    notesColumn: { width: 320, flexShrink: 0, gap: 10 },
    notesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    notesCount: {
      fontSize:    FONT.xs,
      fontFamily:  Poppins.semiBold,
      color:       t.textMuted,
      fontVariant: ['tabular-nums'],
    },
    sectionLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1.4,
    },
    list: { flex: 1 },
    emptyFeed: {
      flex:            1,
      alignItems:      'center',
      justifyContent:  'center',
      gap:             6,
      paddingHorizontal: 16,
      borderRadius:    12,
      borderWidth:     1,
      borderStyle:     'dashed',
      borderColor:     t.border,
      minHeight:       80,
    },
    emptyText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
    },
    emptySubText: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
      lineHeight: 16,
      opacity:    0.8,
    },
    // Web: a docked, full-bleed footer with its own surface + upward shadow, matching
    // the edit screen's transport bar — cancels container's horizontal/bottom padding so
    // it meets the true viewport edges instead of floating in a padded box. Native keeps
    // the plain stacked full-width buttons.
    actions: Platform.OS === 'web'
      ? {
          flexDirection:     'row',
          justifyContent:    'center',
          gap:               12,
          paddingVertical:   14,
          paddingHorizontal: 24,
          marginHorizontal:  -24,
          marginBottom:      -WEB_SCREEN_PADDING_BOTTOM,
          backgroundColor:   t.surface,
          borderTopWidth:    1,
          borderTopColor:    t.separator,
          boxShadow: t.isDark ? '0 -6px 18px rgba(0,0,0,0.35)' : '0 -6px 18px rgba(0,0,0,0.06)',
        } as ViewStyle
      : { gap: 10 },
    pauseBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      backgroundColor: t.surface,
      borderRadius:    14,
      paddingVertical: Platform.OS === 'web' ? 12 : 18,
      borderWidth:     1,
      borderColor:     t.border,
      ...(Platform.OS === 'web' ? { cursor: 'pointer', paddingHorizontal: 22, minWidth: 150 } : null),
    } as ViewStyle,
    // A real hover tint (not a flat opacity dim) — same "state = color change" language
    // as the edit screen's web toolbar buttons, since this button starts on plain
    // `surface`, not a filled color, an opacity fade would barely read as a state change.
    pauseBtnPressed: Platform.OS === 'web' ? { backgroundColor: t.surfaceAlt } : { opacity: 0.7 },
    pauseBtnText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    // On web this is just a pair inside the footer row; on native it's a row of its own so
    // Restart/Discard split one line rather than adding two more full-width slabs.
    secondaryRow: {
      flexDirection: 'row',
      gap:           Platform.OS === 'web' ? 12 : 10,
    },
    // Same chrome as Pause, minus the web minWidth: these are the quieter half of the
    // footer and shouldn't be sized to match the transport buttons.
    secondaryBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      backgroundColor: t.surface,
      borderRadius:    14,
      paddingVertical: Platform.OS === 'web' ? 12 : 16,
      borderWidth:     1,
      borderColor:     t.border,
      ...(Platform.OS === 'web'
        ? { cursor: 'pointer', paddingHorizontal: 18 }
        : { flex: 1 }),
    } as ViewStyle,
    // Destructive tint only on hover/press. Sitting there permanently red would put three
    // competing reds in one footer and drown out Finish, which is the button the user
    // actually wants most of the time.
    discardBtnPressed: Platform.OS === 'web'
      ? { backgroundColor: t.surfaceAlt, borderColor: t.record }
      : { opacity: 0.7 },
    discardBtnText: { color: t.record },
    // Discoverability for the Space shortcut — a keycap-ish tag on the button itself
    // beats a shortcut nobody finds out about.
    shortcutHint: {
      fontSize:          9,
      fontFamily:        Poppins.bold,
      color:             t.textMuted,
      letterSpacing:     0.6,
      backgroundColor:   t.surfaceAlt,
      borderRadius:      4,
      paddingHorizontal: 5,
      paddingVertical:   2,
    },
    stopBtn: {
      flexDirection:   'row',
      backgroundColor: t.record,
      borderRadius:    14,
      paddingVertical: Platform.OS === 'web' ? 12 : 18,
      alignItems:      'center',
      justifyContent:  'center',
      gap:             10,
      ...(Platform.OS === 'web' ? { cursor: 'pointer', paddingHorizontal: 22, minWidth: 150 } : null),
    } as ViewStyle,
    stopBtnPressed: { backgroundColor: t.recordDim },
    // Finish is always visible now (no longer gated behind pausing first), so it needs a
    // disabled state for the "nothing captured yet" case — finishing an empty take would
    // just land the user on an empty editor.
    stopBtnDisabled: { backgroundColor: t.surfaceAlt, opacity: 0.6 },
    stopIcon: {
      width:           14,
      height:          14,
      borderRadius:    3,
      backgroundColor: '#fff',
    },
    stopBtnText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.bold,
      color:      '#fff',
    },
  });
}
