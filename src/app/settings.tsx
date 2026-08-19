import React, { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AuthModal } from '@/components/AuthModal';
import { FeedbackModal } from '@/components/FeedbackModal';
import { SliderInput } from '@/components/SliderInput';
import { Toggle } from '@/components/Toggle';
import { useAuth } from '@/auth/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { usePremium } from '@/hooks/usePremium';
import { selectableAlgorithms } from '@/audio/algorithms';
import {
  FREE_TIER_ENABLED, MAX_TAKE_MINUTES, MIN_TAKE_MINUTES, useSettingsStore, type ThemeOverride,
} from '@/store/useSettingsStore';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import type { Theme } from '@/theme';

const THEME_SEGMENTS: Array<{ value: ThemeOverride; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark',  label: 'Dark' },
];

export default function SettingsScreen() {
  const router             = useRouter();
  const theme              = useTheme();
  const styles             = useMemo(() => createStyles(theme), [theme]);
  const micSensitivity     = useSettingsStore((s) => s.micSensitivity);
  const themeOverride      = useSettingsStore((s) => s.themeOverride);
  // Paid access, not the `isPurchased` latch (8-3) — a subscription can lapse.
  const { premium }         = usePremium();
  const setMicSensitivity  = useSettingsStore((s) => s.setMicSensitivity);
  const setThemeOverride   = useSettingsStore((s) => s.setThemeOverride);
  const defaultAlgorithm   = useSettingsStore((s) => s.defaultAlgorithm);
  const compactTakes       = useSettingsStore((s) => s.compactTakes);
  const maxTakeMinutes     = useSettingsStore((s) => s.maxTakeMinutes);
  const setDefaultAlgorithm = useSettingsStore((s) => s.setDefaultAlgorithm);
  const setCompactTakes     = useSettingsStore((s) => s.setCompactTakes);
  const setMaxTakeMinutes   = useSettingsStore((s) => s.setMaxTakeMinutes);
  const resetTranscriptionParams = useSettingsStore((s) => s.resetTranscriptionParams);
  const auth               = useAuth();

  const engines = useMemo(() => selectableAlgorithms(), []);

  const [showFeedback, setShowFeedback] = useState(false);
  const [showAuth,     setShowAuth]     = useState(false);

  /**
   * Signed-out users are sent to sign-in rather than shown the box.
   *
   * Not a gate for its own sake: `firestore.rules` requires the submitting uid to match the
   * caller, so a report from nobody cannot be written at all. Asking first is the honest
   * version of a write that would otherwise be refused after they had typed a paragraph.
   */
  function handleFeedback() {
    if (auth.user) setShowFeedback(true);
    else           setShowAuth(true);
  }

  async function handleRate() {
    const pkg = 'com.chewpacastudios.harp2tab';
    try {
      await Linking.openURL(`market://details?id=${pkg}`);
    } catch {
      await Linking.openURL(`https://play.google.com/store/apps/details?id=${pkg}`);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* Nav — TopBar's back chevron covers this on web */}
        {Platform.OS !== 'web' && (
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={28} color={theme.accent} />
          </Pressable>
        )}

        {/* Title */}
        <Text style={styles.title}>Settings</Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          {/* No limit is being enforced, so there is nothing to upgrade past. */}
          {FREE_TIER_ENABLED && !premium && (
            <Pressable
              onPress={() => router.push('/paywall')}
              style={({ pressed, hovered }: any) => [
                styles.premiumBanner,
                (pressed || (Platform.OS === 'web' && hovered)) && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Upgrade to Premium"
            >
              <Ionicons name="flash" size={24} color="#fff" />
              <View style={styles.premiumBody}>
                <Text style={styles.premiumTitle}>Upgrade to Premium</Text>
                <Text style={styles.premiumDesc}>Unlock unlimited recordings and every export format</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </Pressable>
          )}

          <View style={styles.sectionsGrid}>

            {/* ACCOUNT — the entry point to /profile.
                Required, not a convenience: TopBar returns null on native (TopBar.tsx), so
                without this row /profile is unreachable there. The split is deliberate —
                /profile holds what belongs to the user, this screen holds what belongs to
                the device. */}
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>ACCOUNT</Text>
              <View style={styles.card}>
                <Pressable
                  onPress={() => router.push('/profile')}
                  style={({ pressed, hovered }: any) => [
                    styles.cardRow,
                    styles.cardRowCursor,
                    Platform.OS === 'web' && hovered && styles.cardRowHover,
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={auth.user ? 'Open your profile' : 'Sign in or create an account'}
                >
                  <Ionicons
                    name={auth.user ? 'person-circle-outline' : 'log-in-outline'}
                    size={20}
                    color={theme.textSub}
                    style={styles.rowIcon}
                  />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>{auth.user ? 'Profile' : 'Sign in'}</Text>
                    <Text style={styles.rowDesc}>
                      {auth.user
                        ? auth.user.email
                        : 'Keep your tabs and open them on any device you play on.'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                </Pressable>
              </View>
            </View>

            {/* AUDIO */}
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>AUDIO</Text>
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <Ionicons name="mic-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>Mic Sensitivity</Text>
                    <Text style={styles.rowDesc}>Set how sensitive the mic is to your playing. Turn up to ignore ambient noise, turn down to catch quieter notes.</Text>
                    <View style={styles.sliderWrapper}>
                      <SliderInput
                        value={micSensitivity}
                        min={0}
                        max={100}
                        step={1}
                        onChange={setMicSensitivity}
                        formatLabel={(v) => `${v}%`}
                      />
                    </View>
                  </View>
                </View>
                <View style={styles.separator} />
                <Pressable
                  onPress={() => router.push('/onboarding?skipPermission=true')}
                  style={({ pressed, hovered }: any) => [
                    styles.cardRow,
                    styles.cardRowCursor,
                    Platform.OS === 'web' && hovered && styles.cardRowHover,
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Recalibrate microphone"
                >
                  <Ionicons name="options-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>Recalibrate Mic</Text>
                    <Text style={styles.rowDesc}>Redo the microphone setup to match your current environment.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                </Pressable>
              </View>
            </View>

            {/* TRANSCRIPTION — web only, and not as a hedge: take retention and the neural
                engine are both web-only today, so on native every control here would either
                do nothing or offer a choice of one. */}
            {Platform.OS === 'web' && (
              <View style={styles.sectionBlock}>
                <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>TRANSCRIPTION</Text>
                <View style={styles.card}>
                  {/* Only when there is a choice to make. One selectable engine means this
                      row is a radio group of one — a control that cannot change anything,
                      which reads as broken rather than as settled. It comes back on its own
                      the moment `SELECTABLE_ALGORITHM_IDS` widens. */}
                  {engines.length > 1 && (<>
                  <View style={styles.cardRow}>
                    <Ionicons name="sparkles-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowLabel}>Default Engine</Text>
                      <Text style={styles.rowDesc}>
                        Which engine the picker opens on. You are still asked every time, so
                        this is a starting point rather than a lock.
                      </Text>
                      {/* Segmented rather than the descriptive row list the picker uses —
                          the descriptions belong where the choice is actually being made. */}
                      <View style={styles.segmented}>
                        {engines.map((algorithm) => {
                          const active = defaultAlgorithm === algorithm.id;
                          return (
                            <Pressable
                              key={algorithm.id}
                              onPress={() => setDefaultAlgorithm(algorithm.id)}
                              style={[styles.segment, active && styles.segmentActive]}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: active }}
                              accessibilityLabel={`${algorithm.label} as the default engine`}
                            >
                              <Text
                                style={[styles.segmentText, active && styles.segmentTextActive]}
                                numberOfLines={1}
                              >
                                {algorithm.polyphonic ? 'Neural' : 'Classic'}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </View>

                  <View style={styles.separator} />
                  </>)}

                  <View style={styles.cardRow}>
                    <Ionicons name="timer-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowLabel}>Maximum Take Length</Text>
                      {/* The honest storage knob. Capture rate looks like one and is not:
                          halving it halves the live frame rate, which pushes the detector's
                          40ms confirm and 50ms dip windows below a single frame and degrades
                          onset timing with nothing on screen connecting the two. Length is
                          linear in both the audio and the model's output and changes no
                          timing at all. */}
                      <Text style={styles.rowDesc}>
                        How much of a recording is kept in memory for re-transcription. Longer
                        takes use more memory; recording itself is never cut short.
                      </Text>
                      <View style={styles.sliderWrapper}>
                        <SliderInput
                          value={maxTakeMinutes}
                          min={MIN_TAKE_MINUTES}
                          max={MAX_TAKE_MINUTES}
                          step={1}
                          onChange={setMaxTakeMinutes}
                          formatLabel={(v) => `${v} min`}
                          accessibilityLabel="Maximum take length in minutes"
                        />
                      </View>
                    </View>
                  </View>

                  <View style={styles.separator} />

                  <View style={styles.cardRow}>
                    <Ionicons name="save-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                    <View style={styles.rowBody}>
                      {/* Described as what it does for the user, never as a bit depth. This
                          is the one control here where the framing is the whole point: it
                          must not read as a quality setting, because it is not one — the
                          quantization floor sits far below anything either engine reads. */}
                      <Text style={styles.rowLabel}>Smaller Recordings In Memory</Text>
                      <Text style={styles.rowDesc}>
                        Keeps longer takes without using as much memory. Doesn&apos;t change
                        how a recording sounds or how it is transcribed.
                      </Text>
                    </View>
                    <Toggle
                      value={compactTakes}
                      onChange={setCompactTakes}
                      accessibilityLabel="Keep recordings in memory more compactly"
                    />
                  </View>

                  <View style={styles.separator} />

                  <Pressable
                    onPress={resetTranscriptionParams}
                    style={({ pressed, hovered }: any) => [
                      styles.cardRow,
                      styles.cardRowCursor,
                      Platform.OS === 'web' && hovered && styles.cardRowHover,
                      pressed && { opacity: 0.6 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Reset transcription settings to their defaults"
                  >
                    <Ionicons name="refresh-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowLabel}>Reset Transcription Settings</Text>
                      {/* Necessary because the tuning screen saves per engine and those
                          values persist silently across sessions — without this, someone who
                          tuned themselves into a corner three takes ago has no way back. */}
                      <Text style={styles.rowDesc}>
                        Puts every engine&apos;s tuning back to its defaults.
                      </Text>
                    </View>
                  </Pressable>
                </View>
              </View>
            )}

            {/* APPEARANCE */}
            <View style={styles.sectionBlock}>
              <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>APPEARANCE</Text>
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <Ionicons name="contrast-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>Theme</Text>
                    <Text style={styles.rowDesc}>Choose display mode or follow system</Text>
                    <View style={styles.segmented}>
                      {THEME_SEGMENTS.map(({ value, label }) => {
                        const active = themeOverride === value;
                        return (
                          <Pressable
                            key={value}
                            onPress={() => setThemeOverride(value)}
                            style={[styles.segment, active && styles.segmentActive]}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active }}
                            accessibilityLabel={`${label} theme`}
                          >
                            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {/* SUPPORT — the section shows on both platforms; each row picks its own.
                Rating is a Play Store deeplink and means nothing on web. Feedback is the
                mirror image: it writes to Firestore as a signed-in user, and native has
                neither accounts nor Firestore until Phase 15 (`sync/feedback.ts`). Neither
                row is a stub on the platform it skips — it is simply absent there. */}
            <View style={styles.sectionBlock}>
              <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>SUPPORT</Text>
              <View style={styles.card}>

                {Platform.OS === 'web' && (
                  <Pressable
                    onPress={handleFeedback}
                    style={({ pressed, hovered }: any) => [
                      styles.cardRow,
                      styles.cardRowCursor,
                      hovered && styles.cardRowHover,
                      pressed && { opacity: 0.6 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Send feedback, report a bug, or suggest a feature"
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowLabel}>Send Feedback</Text>
                      <Text style={styles.rowDesc}>Report a bug or suggest a feature — it goes straight to the developer.</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                  </Pressable>
                )}

                {Platform.OS !== 'web' && (
                  <Pressable
                    onPress={handleRate}
                    style={({ pressed }) => [styles.cardRow, pressed && { opacity: 0.6 }]}
                    accessibilityRole="link"
                    accessibilityLabel="Rate the app on the Play Store"
                  >
                    <Ionicons name="star-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowLabel}>Rate the App</Text>
                      <Text style={styles.rowDesc}>Enjoying Harp2Tab? Leave us a review on the Play Store.</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                  </Pressable>
                )}

              </View>
            </View>

            {/* LEGAL */}
            <View style={styles.sectionBlock}>
              <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>LEGAL</Text>
              <View style={styles.card}>
                <Pressable
                  onPress={() => Linking.openURL('https://tgaspe.github.io/harp2tab-privacy/')}
                  style={({ pressed, hovered }: any) => [
                    styles.cardRow,
                    styles.cardRowCursor,
                    Platform.OS === 'web' && hovered && styles.cardRowHover,
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="link"
                  accessibilityLabel="Privacy Policy"
                >
                  <Ionicons name="shield-checkmark-outline" size={20} color={theme.textSub} style={styles.rowIcon} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>Privacy Policy</Text>
                    <Text style={styles.rowDesc}>How we handle your data</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                </Pressable>
              </View>
            </View>

          </View>

        </ScrollView>
      </View>

      {/* Guarded on `auth.user` rather than mounted always: the modal takes a non-null user
          because a submission without one cannot be written. The guard is the type, not a
          defensive check. */}
      {auth.user && (
        <FeedbackModal
          visible={showFeedback}
          user={auth.user}
          onClose={() => setShowFeedback(false)}
        />
      )}

      <AuthModal
        visible={showAuth}
        initialMode="signIn"
        reason="Sign in so we can reply to your feedback and follow up on bug reports."
        onClose={() => setShowAuth(false)}
      />
    </SafeAreaView>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      ...webMaxWidth(WEB_CONTENT_WIDTH.wide),
      paddingHorizontal: 24,
      paddingTop: Platform.OS === 'web' ? WEB_SCREEN_PADDING_TOP : 16,
      paddingBottom: Platform.OS === 'web' ? WEB_SCREEN_PADDING_BOTTOM : 24,
      gap: 12,
    },
    backBtn:  { alignSelf: 'flex-start', padding: 4 },
    title: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.accent,
      letterSpacing: -0.5,
    },
    scroll:        { flex: 1 },
    scrollContent: { paddingBottom: 8, gap: 6 },

    sectionLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1.4,
    },
    sectionLabelSpaced: { marginTop: 12 },
    sectionsGrid: Platform.select({
      web: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
      default: {},
    }) as ViewStyle,
    sectionBlock: Platform.select({
      web: { flexBasis: 440, flexGrow: 1 },
      default: {},
    }) as ViewStyle,

    premiumBanner: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             14,
      backgroundColor: t.accent,
      borderRadius:    14,
      paddingVertical: 18,
      paddingHorizontal: 18,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    premiumBody:  { flex: 1, gap: 2 },
    premiumTitle: {
      fontSize:   FONT.md,
      fontFamily: Poppins.bold,
      color:      '#fff',
    },
    premiumDesc: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      'rgba(255,255,255,0.85)',
      lineHeight: 16,
    },

    card: {
      backgroundColor: t.surface,
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      overflow:        'hidden',
    },
    cardRow: {
      flexDirection:   'row',
      alignItems:      'flex-start',
      paddingVertical: 14,
      paddingHorizontal: 16,
      gap:             12,
    },
    // Only for cardRow instances that are actually Pressable (not the plain
    // View rows like Mic Sensitivity) — keeps cursor:pointer semantically
    // accurate.
    cardRowCursor: Platform.OS === 'web' ? ({ cursor: 'pointer' } as ViewStyle) : {},
    // Real hover tint on web instead of dimming with opacity — matches the edit screen's
    // toolbar language (state = color change, not fade), and reads clearly against a row
    // that otherwise looks static.
    cardRowHover: { backgroundColor: t.surfaceAlt },
    rowIcon:   { marginTop: 2 },
    rowBody:   { flex: 1, gap: 4 },
    rowLabel: {
      fontSize:   FONT.base,
      fontFamily: Poppins.semiBold,
      color:      t.textPrimary,
    },
    rowLabelMuted: {
      fontSize:   FONT.base,
      fontFamily: Poppins.semiBold,
      color:      t.textMuted,
    },
    rowDesc: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      lineHeight: 16,
    },
    sliderWrapper: { marginTop: 10 },

    segmented: {
      flexDirection:   'row',
      backgroundColor: t.surfaceAlt,
      borderRadius:    10,
      padding:         3,
      marginTop:       10,
    },
    segment: {
      flex:            1,
      paddingVertical: 8,
      alignItems:      'center',
      borderRadius:    8,
    },
    segmentActive: { backgroundColor: t.accent },
    segmentText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    segmentTextActive: { color: '#fff' },

    separator: {
      height:          1,
      backgroundColor: t.separator,
      marginLeft:      48,
    },
  });
}
