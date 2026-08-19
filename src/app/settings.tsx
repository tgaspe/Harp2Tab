/**
 * `/settings` — what belongs to the *device*. `/profile` keeps what belongs to the *user*.
 *
 * Built on `SettingsSurface`'s primitives, same as `/profile`. It used to run the mobile
 * grouped-card language — a rounded card per group, an icon on every row, a chevron on rows
 * with nothing to drill into — laid out on web as a `flexWrap` grid of `flexBasis: 440`
 * columns. Two things went wrong with that and both are visible at a glance on a desktop
 * display: the cards have wildly different heights, so a five-row Transcription block ends
 * up beside a one-row Legal block over a column of dead space; and the whole thing reads as
 * a phone screen someone stretched, which is exactly what the note at the top of
 * `SettingsSurface.tsx` was written about.
 *
 * Now it is one column of ruled sections, prose on the left and controls on the right, and
 * the two account pages are the same page. Native gets the stacked version of the same
 * primitives — see `SettingsSurface`.
 *
 * It also mounts `AppSidebar`, which it previously did not. Home and `/profile` both carry
 * the rail, so reaching Settings from the gear used to make it disappear and then reappear
 * one click later on Profile — chrome that comes and goes reads as the page jumping rather
 * than as a route change. Web only, same as everywhere else the rail is used.
 *
 * The controls themselves did not change. Only two things about them did: every row's
 * explanation moved from a `rowDesc` under the label into `FieldRow`'s `hint`, and the
 * rows that were Pressables ending in a chevron (Recalibrate, Reset, Privacy, Profile) are
 * now a named button on the right — the chevron was promising a sub-page that never existed.
 */

import React, { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppSidebar } from '@/components/AppSidebar';
import { AuthModal } from '@/components/AuthModal';
import { FeedbackModal } from '@/components/FeedbackModal';
import { SliderInput } from '@/components/SliderInput';
import { Toggle } from '@/components/Toggle';
import { FieldRow, Section } from '@/components/SettingsSurface';
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
      <View style={styles.shell}>
        {Platform.OS === 'web' && <AppSidebar />}
        {/* `minWidth: 0` so the content column can actually shrink beside the fixed-width
            rail instead of pushing the row wider than the viewport. */}
        <View style={styles.shellMain}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.container}>

              {/* Nav — TopBar carries the back arrow on web (see `BACK_ROUTES`), so this is
                  native's only way out of the screen. */}
              {Platform.OS !== 'web' && (
                <Pressable
                  onPress={() => router.back()}
                  style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <Ionicons name="arrow-back" size={28} color={theme.textSub} />
                </Pressable>
              )}

              {/* Page header, matching `/profile`'s: name of the page, then the one thing a
                  person needs to know before they change anything on it. */}
              <View style={styles.pageHeader}>
                <Text style={styles.pageTitle} accessibilityRole="header">Settings</Text>
                <Text style={styles.pageMeta}>
                  Everything here applies to this device only. Your account, plan and library
                  live in your profile.
                </Text>
              </View>

              {/* No limit is being enforced, so there is nothing to upgrade past. */}
              {FREE_TIER_ENABLED && !premium && (
                <Pressable
                  onPress={() => router.push('/paywall')}
                  style={({ pressed, hovered }: any) => [
                    styles.premiumBanner,
                    (pressed || (Platform.OS === 'web' && hovered)) && styles.premiumBannerHover,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Upgrade to Premium"
                >
                  <Ionicons name="flash" size={20} color={theme.accentDeep} />
                  <View style={styles.premiumBody}>
                    <Text style={styles.premiumTitle}>Upgrade to Premium</Text>
                    <Text style={styles.premiumDesc}>
                      Unlimited recordings and every export format.
                    </Text>
                  </View>
                  <Text style={styles.premiumCta}>See plans</Text>
                </Pressable>
              )}

              {/* ACCOUNT — the entry point to /profile.
                  Required, not a convenience: TopBar returns null on native (TopBar.tsx), so
                  without this row /profile is unreachable there. The split is deliberate —
                  /profile holds what belongs to the user, this screen holds what belongs to
                  the device. */}
              <Section
                first
                title="Account"
                description="Signing in keeps your tabs on every device you play on."
              >
                <FieldRow
                  first
                  label="Signed in"
                  value={auth.user ? auth.user.email : 'Not signed in'}
                  action={{
                    label:   auth.user ? 'Open profile' : 'Sign in',
                    onPress: () => router.push('/profile'),
                  }}
                />
              </Section>

              <Section
                title="Microphone"
                description="How Harp2Tab hears you. Set these once for the room you usually play in."
              >
                <FieldRow
                  first
                  label="Sensitivity"
                  hint="Turn it up to ignore ambient noise, down to catch quieter notes."
                >
                  <View style={styles.sliderSlot}>
                    <SliderInput
                      value={micSensitivity}
                      min={0}
                      max={100}
                      step={1}
                      onChange={setMicSensitivity}
                      formatLabel={(v) => `${v}%`}
                      accessibilityLabel="Microphone sensitivity"
                    />
                  </View>
                </FieldRow>

                <FieldRow
                  label="Calibration"
                  hint="Redo the microphone setup to match your current environment."
                  action={{
                    label:   'Recalibrate',
                    onPress: () => router.push('/onboarding?skipPermission=true'),
                  }}
                />
              </Section>

              {/* TRANSCRIPTION — web only, and not as a hedge: take retention and the neural
                  engine are both web-only today, so on native every control here would either
                  do nothing or offer a choice of one. */}
              {Platform.OS === 'web' && (
                <Section
                  title="Transcription"
                  description="How much of each take is kept in memory, and what turns it into tab."
                >
                  {/* Only when there is a choice to make. One selectable engine means this
                      row is a radio group of one — a control that cannot change anything,
                      which reads as broken rather than as settled. It comes back on its own
                      the moment `SELECTABLE_ALGORITHM_IDS` widens. */}
                  {engines.length > 1 && (
                    <FieldRow
                      first
                      label="Engine"
                      hint="Which engine the picker opens on. You are still asked every time, so this is a starting point rather than a lock."
                    >
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
                    </FieldRow>
                  )}

                  {/* The honest storage knob. Capture rate looks like one and is not:
                      halving it halves the live frame rate, which pushes the detector's
                      40ms confirm and 50ms dip windows below a single frame and degrades
                      onset timing with nothing on screen connecting the two. Length is
                      linear in both the audio and the model's output and changes no
                      timing at all. */}
                  <FieldRow
                    first={engines.length <= 1}
                    label="Take length"
                    hint="How much of a recording is kept in memory for re-transcription. Longer takes use more memory; recording itself is never cut short."
                  >
                    <View style={styles.sliderSlot}>
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
                  </FieldRow>

                  {/* Described as what it does for the user, never as a bit depth. This is the
                      one control here where the framing is the whole point: it must not read as
                      a quality setting, because it is not one — the quantization floor sits far
                      below anything either engine reads. */}
                  <FieldRow
                    label="Storage"
                    hint="Keep longer takes without using as much memory. Doesn't change how a recording sounds or how it is transcribed."
                    control={
                      <Toggle
                        value={compactTakes}
                        onChange={setCompactTakes}
                        accessibilityLabel="Keep recordings in memory more compactly"
                      />
                    }
                  />

                  {/* Necessary because the tuning screen saves per engine and those values
                      persist silently across sessions — without this, someone who tuned
                      themselves into a corner three takes ago has no way back. */}
                  <FieldRow
                    label="Tuning"
                    hint="Puts every engine's tuning back to its defaults."
                    action={{ label: 'Reset', onPress: resetTranscriptionParams }}
                  />
                </Section>
              )}

              <Section
                title="Appearance"
                description="How the app looks on this device. Themes are local, so each device you play on keeps its own."
              >
                <FieldRow first label="Theme">
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
                </FieldRow>
              </Section>

              {/* SUPPORT — the section shows on both platforms; each row picks its own.
                  Rating is a Play Store deeplink and means nothing on web. Feedback is the
                  mirror image: it writes to Firestore as a signed-in user, and native has
                  neither accounts nor Firestore until Phase 15 (`sync/feedback.ts`). Neither
                  row is a stub on the platform it skips — it is simply absent there. */}
              <Section
                title="Support"
                description="Something broken, or something missing? It reaches the developer directly."
              >
                {Platform.OS === 'web' ? (
                  <FieldRow
                    first
                    label="Feedback"
                    hint="Report a bug or suggest a feature."
                    action={{ label: 'Send feedback', onPress: handleFeedback }}
                  />
                ) : (
                  <FieldRow
                    first
                    label="Rating"
                    hint="Enjoying Harp2Tab? Leave a review on the Play Store."
                    action={{ label: 'Rate the app', onPress: handleRate }}
                  />
                )}
              </Section>

              <Section
                title="Legal"
                description="What Harp2Tab collects, and what it does with it."
              >
                <FieldRow
                  first
                  label="Privacy"
                  hint="How your recordings and account data are handled."
                  action={{
                    label:   'Read policy',
                    onPress: () => Linking.openURL('https://tgaspe.github.io/harp2tab-privacy/'),
                  }}
                />
              </Section>

            </View>
          </ScrollView>
        </View>
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
  const isWeb = Platform.OS === 'web';
  return StyleSheet.create({
    safe:   { flex: 1, backgroundColor: t.bg },
    // Rail and page content as flex-row siblings, with only the content side scrolling, so
    // the rail is genuinely full page height rather than as tall as its own contents. Same
    // shell as `/profile` and Home's dashboard.
    shell:     { flex: 1, flexDirection: 'row' },
    shellMain: { flex: 1, minWidth: 0 },
    scroll: { flexGrow: 1 },
    container: {
      flex: 1,
      // `full`, not `wide` — matching `/profile`, and for the same reason: every `Section`
      // nests a fixed 280px prose column, so the container needs that much more room than
      // a single-column screen to leave the controls a usable width.
      ...webMaxWidth(WEB_CONTENT_WIDTH.full),
      paddingHorizontal: isWeb ? 40 : 24,
      paddingTop:    isWeb ? WEB_SCREEN_PADDING_TOP : 16,
      paddingBottom: isWeb ? WEB_SCREEN_PADDING_BOTTOM : 24,
    },
    backBtn: { alignSelf: 'flex-start', padding: 4, marginBottom: 4 },

    pageHeader: {
      gap:               6,
      paddingBottom:     20,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    pageTitle: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      // `textPrimary`, not `accent`. The old cyan title was the only page heading in the app
      // rendered in the accent, which made Settings look like a different product from the
      // Profile page one click away.
      color:         t.textPrimary,
      letterSpacing: -0.5,
    },
    pageMeta: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 20,
      maxWidth:   560,
    },

    // A tinted strip, not the solid accent slab it was. On a page whose only other filled
    // surfaces are hairline-bordered rows, a full-bleed cyan block with white text was the
    // loudest thing on screen by a wide margin — and it is an offer, not an alert.
    premiumBanner: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               12,
      marginTop:         20,
      backgroundColor:   t.accentSoft,
      borderWidth:       1,
      borderColor:       t.accent,
      borderRadius:      12,
      paddingVertical:   14,
      paddingHorizontal: 16,
      ...(isWeb ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    premiumBannerHover: { backgroundColor: t.surfaceAlt },
    premiumBody:  { flex: 1, gap: 2 },
    premiumTitle: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textPrimary,
    },
    premiumDesc: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 17,
    },
    premiumCta: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.accentDeep,
    },

    // Controls stop well short of the body column's full width. A slider stretched across
    // 700px moves a whole percent per pixel-ish of travel and reads as a progress bar; a
    // two-item segmented control that wide reads as a pair of buttons.
    sliderSlot: { maxWidth: 340, alignSelf: 'stretch' },
    segmented: {
      flexDirection:   'row',
      alignSelf:       'flex-start',
      minWidth:        220,
      backgroundColor: t.surfaceAlt,
      borderRadius:    10,
      padding:         3,
    },
    segment: {
      flex:              1,
      paddingVertical:   7,
      paddingHorizontal: 18,
      alignItems:        'center',
      borderRadius:      8,
      ...(isWeb ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    segmentActive: { backgroundColor: t.accent },
    segmentText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    segmentTextActive: { color: '#fff' },
  });
}
