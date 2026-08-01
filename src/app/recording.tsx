import { PulsingIndicator } from '@/components/PulsingIndicator';
import { TabCard } from '@/components/TabCard';
import { LiveAnalysisPanel } from '@/components/LiveAnalysisPanel';
import { ActionSheetModal } from '@/components/ActionSheetModal';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import { useTheme } from '@/hooks/useTheme';
import { useAudioCapture } from '@/hooks/useAudioCapture';
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
  const pauseRecording         = useAppStore((s) => s.pauseRecording);
  const resumeRecording        = useAppStore((s) => s.resumeRecording);
  const incrementRecordingCount = useSettingsStore((s) => s.incrementRecordingCount);

  const listRef       = useRef<FlatList>(null);
  const startMsRef    = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const pausedMsRef   = useRef(0);

  const [elapsedStr, setElapsedStr] = useState('0:00');
  const [permissionModalOpen, setPermissionModalOpen] = useState(false);

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
      setElapsedStr('0:00');
    }
  }, [isRecording]);

  // Elapsed timer — pauses automatically when isPaused
  useEffect(() => {
    if (!isRecording || isPaused) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - startMsRef.current - pausedMsRef.current;
      const s = Math.floor(elapsed / 1000);
      setElapsedStr(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }, 500);
    return () => clearInterval(id);
  }, [isRecording, isPaused]);

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

  function handleStop() {
    stopRecording();
    incrementRecordingCount();
    router.push('/edit');
  }

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

            <Text style={styles.elapsed}>{elapsedStr}</Text>

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
                <Text style={styles.elapsed}>{elapsedStr}</Text>
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
                <Text style={styles.sectionLabel}>NOTES</Text>
                <Text style={styles.notesCount}>{tabNotes.length}</Text>
              </View>

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

        {/* Transport — Finish is always available now, not gated behind pausing first
            (ending a take shouldn't cost two clicks and a mode change). On web this is a
            docked full-bleed footer, matching the edit screen's transport bar. */}
        <View style={styles.actions}>
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
