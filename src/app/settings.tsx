import React, { useMemo } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SliderInput } from '@/components/SliderInput';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore, type ThemeOverride } from '@/store/useSettingsStore';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
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
  const isPurchased        = useSettingsStore((s) => s.isPurchased);
  const setMicSensitivity  = useSettingsStore((s) => s.setMicSensitivity);
  const setThemeOverride   = useSettingsStore((s) => s.setThemeOverride);

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

        {/* Nav */}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={28} color={theme.accent} />
        </Pressable>

        {/* Title */}
        <Text style={styles.title}>Settings</Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          {!isPurchased && (
            <Pressable
              onPress={() => router.push('/paywall')}
              style={({ pressed }) => [styles.premiumBanner, pressed && { opacity: 0.85 }]}
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

          {/* AUDIO */}
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
              style={({ pressed }) => [styles.cardRow, pressed && { opacity: 0.6 }]}
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

          {/* APPEARANCE */}
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

          {/* SUPPORT */}
          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>SUPPORT</Text>
          <View style={styles.card}>
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
          </View>

          {/* LEGAL */}
          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>LEGAL</Text>
          <View style={styles.card}>
            <Pressable
              onPress={() => Linking.openURL('https://tgaspe.github.io/harp2tab-privacy/')}
              style={({ pressed }) => [styles.cardRow, pressed && { opacity: 0.6 }]}
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

        </ScrollView>
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

    premiumBanner: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             14,
      backgroundColor: t.accent,
      borderRadius:    14,
      paddingVertical: 18,
      paddingHorizontal: 18,
    },
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
