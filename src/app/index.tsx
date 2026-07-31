import { KeyGrid } from '@/components/KeyGrid';
import { RatingModal } from '@/components/RatingModal';
import { RecordingCard } from '@/components/RecordingCard';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import { selectHarmonicaType, selectKey, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { computeEffectiveLimit, resolveSessionGate } from '@/store/sessionGate';
import { selectRecordings, useRecordingsStore } from '@/store/useRecordingsStore';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabRecording } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';

export default function KeySelectionScreen() {
  const router         = useRouter();
  const theme          = useTheme();
  const styles         = useMemo(() => createStyles(theme), [theme]);
  const hasCompletedOnboarding = useSettingsStore((s) => s.hasCompletedOnboarding);

  useEffect(() => {
    if (!hasCompletedOnboarding) router.replace('/onboarding');
  }, [hasCompletedOnboarding]);

  const harmonicaType        = useAppStore(selectHarmonicaType);
  const setHarmonicaType     = useAppStore((s) => s.setHarmonicaType);
  const selectedKey          = useAppStore(selectKey);
  const selectKey_           = useAppStore((s) => s.selectKey);
  const startRecording       = useAppStore((s) => s.startRecording);
  const loadRecording        = useAppStore((s) => s.loadRecording);
  const totalRecordingsUsed  = useSettingsStore((s) => s.totalRecordingsUsed);
  const isPurchased          = useSettingsStore((s) => s.isPurchased);
  const ratingStatus         = useSettingsStore((s) => s.ratingStatus);
  const recordings           = useRecordingsStore(selectRecordings);
  const deleteRecording      = useRecordingsStore((s) => s.deleteRecording);
  const renameRecording      = useRecordingsStore((s) => s.renameRecording);
  const [showRatingModal, setShowRatingModal] = useState(false);

  const effectiveLimit = computeEffectiveLimit(ratingStatus);

  function handleStart() {
    if (!selectedKey) return;
    const gate = resolveSessionGate({ isPurchased, totalRecordingsUsed, ratingStatus });
    if (gate === 'showRating') { setShowRatingModal(true); return; }
    if (gate === 'showPaywall') { router.push('/paywall'); return; }
    startRecording();
    router.push('/recording');
  }

  function handleOpenRecording(recording: TabRecording) {
    loadRecording(recording);
    router.push('/edit');
  }

  if (!hasCompletedOnboarding) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <RatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onUpgrade={() => router.push('/paywall')}
      />
      <View style={styles.container}>

        {/* Header — TopBar covers logo/gear on web */}
        <View style={styles.header}>
          {Platform.OS !== 'web' && (
            <View style={styles.headerTop}>
              <View style={styles.titleRow}>
                <Image
                  source={require('../../assets/images/harp2tab-icon.png')}
                  style={styles.titleIcon}
                />
                <Text style={styles.appTitle}>Harp2Tab</Text>
              </View>
              <Pressable
                onPress={() => router.push('/settings')}
                style={({ pressed }) => [styles.gearBtn, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="Open settings"
              >
                <Ionicons name="settings-outline" size={28} color={theme.textSub} />
              </Pressable>
            </View>
          )}
          <Text style={styles.subtitle}>Pick a key to start recording.</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Recent recordings */}
          {recordings.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>RECENT RECORDINGS</Text>
              <View style={styles.recordingsList}>
                {/* Store keeps newest-first for future consumers; display oldest-to-newest
                    top-to-bottom so the most recent recording reads as "last" in the list. */}
                {[...recordings].reverse().map((recording) => (
                  <RecordingCard
                    key={recording.id}
                    recording={recording}
                    onPress={handleOpenRecording}
                    onDelete={deleteRecording}
                    onRename={renameRecording}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Harmonica type */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>HARMONICA TYPE</Text>
            <View style={styles.segmented}>
              {(['diatonic', 'chromatic'] as HarmonicaType[]).map((type) => {
                const active = harmonicaType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => setHarmonicaType(type)}
                    style={[styles.segment, active && styles.segmentActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {type === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Key section */}
          <View style={[styles.section, { marginTop: 16 }]}>
            <Text style={styles.sectionLabel}>HARMONICA KEY</Text>
            <KeyGrid
              selected={selectedKey}
              onSelect={(k: HarmonicaKey) => selectKey_(k)}
            />
          </View>

          {/* Tip */}
          <View style={styles.tip}>
            <Ionicons name="information-circle-outline" size={15} color={theme.textMuted} />
            <Text style={styles.tipText}>
              Tip: quiet environments give the best results. Mic sensitivity can be tuned in{' '}
              <Text style={styles.tipLink} onPress={() => router.push('/settings')}>Settings</Text>.
            </Text>
          </View>
        </ScrollView>

        {/* Entry points */}
        <View style={styles.bottomActions}>
          <Pressable
            onPress={handleStart}
            disabled={!selectedKey}
            style={({ pressed, hovered }: any) => [
              styles.startBtn,
              !selectedKey && styles.startBtnDisabled,
              (pressed || (Platform.OS === 'web' && hovered)) && !!selectedKey && styles.startBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Start Recording"
            accessibilityState={{ disabled: !selectedKey }}
          >
            <Text style={[styles.startBtnText, !selectedKey && styles.startBtnTextDisabled]}>
              Start Recording
            </Text>
            {!isPurchased && (
              <View style={styles.btnCounter}>
                <Text style={[styles.btnCounterText, !selectedKey && styles.btnCounterTextDisabled]}>
                  {Math.min(totalRecordingsUsed, effectiveLimit)} / {effectiveLimit} free recordings used
                </Text>
              </View>
            )}
          </Pressable>

          <View style={styles.uploadRow}>
            <Pressable
              disabled
              style={styles.uploadBtn}
              accessibilityRole="button"
              accessibilityLabel="Upload Audio — coming soon"
              accessibilityState={{ disabled: true }}
            >
              <Ionicons name="cloud-upload-outline" size={18} color={theme.textMuted} />
              <Text style={styles.uploadBtnText}>Upload Audio</Text>
              <Text style={styles.comingSoon}>Soon</Text>
            </Pressable>
            <Pressable
              disabled
              style={styles.uploadBtn}
              accessibilityRole="button"
              accessibilityLabel="Upload MIDI — coming soon"
              accessibilityState={{ disabled: true }}
            >
              <Ionicons name="musical-note-outline" size={18} color={theme.textMuted} />
              <Text style={styles.uploadBtnText}>Upload MIDI</Text>
              <Text style={styles.comingSoon}>Soon</Text>
            </Pressable>
          </View>
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
      ...webMaxWidth(WEB_CONTENT_WIDTH.compact),
      paddingHorizontal: 24,
      paddingTop: Platform.OS === 'web' ? WEB_SCREEN_PADDING_TOP : 36,
      paddingBottom: Platform.OS === 'web' ? WEB_SCREEN_PADDING_BOTTOM : 24,
    },
    header:    { marginBottom: 24 },
    headerTop: {
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'space-between',
    },
    gearBtn: { padding: 4 },
    titleRow: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           8,
    },
    titleIcon: {
      width:  50,
      height: 50,
    },
    appTitle: {
      fontSize:      FONT['2xl'],
      fontFamily:    SpaceGrotesk.bold,
      color:         t.accent,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize:   FONT.base,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      marginTop:  Platform.OS === 'web' ? 0 : 40,
    },
    scroll:        { flex: 1 },
    scrollContent: { gap: 24, paddingBottom: 16 },
    section: { gap: 12 },
    recordingsList: { gap: 10 },
    segmented: {
      flexDirection:   'row',
      backgroundColor: t.surface,
      borderRadius:    12,
      padding:         3,
    },
    segment: {
      flex:            1,
      paddingVertical: 10,
      alignItems:      'center',
      borderRadius:    10,
    },
    segmentActive:    { backgroundColor: t.accent },
    segmentText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    segmentTextActive: { color: '#fff' },
    sectionLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1.4,
    },
    tip: {
      flexDirection: 'row',
      alignItems:    'flex-start',
      gap:           6,
    },
    tipText: {
      flex:       1,
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      lineHeight: 18,
    },
    tipLink: {
      fontFamily: Poppins.semiBold,
      color:      t.accent,
    },
    bottomActions: { gap: 10, paddingTop: 10 },
    startBtn: {
      backgroundColor: t.accent,
      borderRadius: 14,
      paddingVertical: 18,
      alignItems: 'center',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    startBtnDisabled: { backgroundColor: t.surface },
    startBtnPressed:  { backgroundColor: t.accentDim },
    startBtnText: {
      fontSize:      FONT.lg,
      fontFamily:    Poppins.bold,
      color:         '#fff',
      letterSpacing: 0.2,
    },
    startBtnTextDisabled: { color: t.textMuted },

    btnCounter: {
      marginTop: 6,
    },
    btnCounterText: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      'rgba(255,255,255,0.7)',
      textAlign:  'center',
    },
    btnCounterTextDisabled: { color: t.textMuted },

    uploadRow: { flexDirection: 'row', gap: 10 },
    uploadBtn: {
      flex:              1,
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'center',
      gap:               6,
      backgroundColor:   t.surface,
      borderRadius:      12,
      paddingVertical:   12,
      borderWidth:       1,
      borderColor:       t.border,
      opacity:           0.6,
    },
    uploadBtnText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textMuted,
    },
    comingSoon: {
      fontSize:          9,
      fontFamily:        Poppins.bold,
      color:             t.textMuted,
      letterSpacing:     0.6,
      backgroundColor:   t.surfaceAlt,
      borderRadius:      6,
      paddingHorizontal: 5,
      paddingVertical:   2,
    },
  });
}
