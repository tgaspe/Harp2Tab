import { PulsingIndicator } from '@/components/PulsingIndicator';
import { TabCard } from '@/components/TabCard';
import { FONT } from '@/constants/keys';
import { Poppins } from '@/constants/fonts';
import { useTheme } from '@/hooks/useTheme';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { selectIsRecording, selectKey, selectTabNotes, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { Theme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RecordingScreen() {
  const router        = useRouter();
  const theme         = useTheme();
  const styles        = useMemo(() => createStyles(theme), [theme]);
  const selectedKey   = useAppStore(selectKey);
  const isRecording   = useAppStore(selectIsRecording);
  const tabNotes      = useAppStore(selectTabNotes);
  const stopRecording          = useAppStore((s) => s.stopRecording);
  const incrementRecordingCount = useSettingsStore((s) => s.incrementRecordingCount);

  const listRef       = useRef<FlatList>(null);
  const startMsRef    = useRef(0);
  const pauseStartRef = useRef<number | null>(null);
  const pausedMsRef   = useRef(0);

  const [isPaused,   setIsPaused]   = useState(false);
  const [elapsedStr, setElapsedStr] = useState('0:00');

  const { permissionDenied } = useAudioCapture();

  useEffect(() => {
    if (!permissionDenied) return;
    Alert.alert(
      'Microphone Access Required',
      'Harp2Tab needs microphone access to record. Please enable it in your device settings.',
      [
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
        { text: 'Go Back', style: 'cancel', onPress: () => router.back() },
      ],
    );
  }, [permissionDenied]);

  // Reset timing state when a new recording begins
  useEffect(() => {
    if (isRecording) {
      startMsRef.current    = Date.now();
      pausedMsRef.current   = 0;
      pauseStartRef.current = null;
      setIsPaused(false);
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

  function handlePause() {
    pauseStartRef.current = Date.now();
    setIsPaused(true);
  }

  function handleResume() {
    if (pauseStartRef.current !== null) {
      pausedMsRef.current  += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    setIsPaused(false);
  }

  function handleStop() {
    stopRecording();
    incrementRecordingCount();
    router.push('/edit');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Top bar */}
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

        {/* Indicator */}
        <View style={styles.indicatorArea}>
          <PulsingIndicator active={isRecording && !isPaused} size={160} />
          <Text style={styles.statusLabel}>
            {!isRecording ? 'READY' : isPaused ? 'PAUSED' : 'RECORDING'}
          </Text>
        </View>

        {/* Live feed */}
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

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={isPaused ? handleResume : handlePause}
            style={({ pressed }) => [styles.pauseBtn, pressed && styles.pauseBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={isPaused ? 'Resume Recording' : 'Pause Recording'}
          >
            <Ionicons name={isPaused ? 'play' : 'pause'} size={18} color={theme.textSub} />
            <Text style={styles.pauseBtnText}>{isPaused ? 'Resume' : 'Pause'}</Text>
          </Pressable>

          {isPaused && (
            <Pressable
              onPress={handleStop}
              style={({ pressed }) => [styles.stopBtn, pressed && styles.stopBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Finish Recording"
            >
              <View style={styles.stopIcon} />
              <Text style={styles.stopBtnText}>Finish</Text>
            </Pressable>
          )}
        </View>

      </View>
    </SafeAreaView>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 24,
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
    elapsed: {
      fontSize:      FONT['2xl'],
      fontFamily:    Poppins.thin,
      color:         t.textSub,
      fontVariant:   ['tabular-nums'],
      letterSpacing: 1,
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
    actions: {
      gap: 10,
    },
    pauseBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      backgroundColor: t.surface,
      borderRadius:    14,
      paddingVertical: 18,
      borderWidth:     1,
      borderColor:     t.border,
    },
    pauseBtnPressed: { opacity: 0.7 },
    pauseBtnText: {
      fontSize:   FONT.md,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    stopBtn: {
      flexDirection:   'row',
      backgroundColor: t.record,
      borderRadius:    14,
      paddingVertical: 18,
      alignItems:      'center',
      justifyContent:  'center',
      gap:             10,
    },
    stopBtnPressed: { backgroundColor: t.recordDim },
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
