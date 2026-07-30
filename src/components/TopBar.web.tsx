import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { SpaceGrotesk } from '@/constants/fonts';
import { webMaxWidth, WEB_CONTENT_WIDTH } from '@/constants/layout';
import type { Theme } from '@/theme';

// Routes that had their own gear->settings shortcut before TopBar existed.
const GEAR_ROUTES = ['/', '/recording', '/edit', '/export'];
// Only the two routes that already had a back arrow before TopBar existed —
// deliberately not router.canGoBack(), so we don't invent a "go back
// mid-recording" affordance that didn't exist before.
const BACK_ROUTES = ['/settings', '/export'];
// Focused conversion/setup flows — no nav chrome, matches their existing
// lack of a back button.
const HIDDEN_ROUTES = ['/paywall', '/onboarding'];

export function TopBar() {
  const router     = useRouter();
  const pathname   = usePathname();
  const theme      = useTheme();
  const styles     = createStyles(theme);

  if (HIDDEN_ROUTES.includes(pathname)) return null;

  const showBack = BACK_ROUTES.includes(pathname);
  const showGear = GEAR_ROUTES.includes(pathname);

  return (
    <View style={styles.bar}>
      <View style={styles.inner}>
        <View style={styles.left}>
          {showBack && (
            <Pressable
              onPress={() => router.back()}
              style={({ pressed, hovered }: any) => [
                styles.iconBtn,
                (pressed || hovered) && styles.iconBtnHovered,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={22} color={theme.textSub} />
            </Pressable>
          )}
          <Pressable
            onPress={() => router.push('/')}
            style={({ pressed, hovered }: any) => [
              styles.logoRow,
              (pressed || hovered) && styles.logoRowHovered,
            ]}
            accessibilityRole="link"
            accessibilityLabel="Harp2Tab home"
          >
            <Image
              source={require('../../assets/images/harp2tab-icon.png')}
              style={styles.logoIcon}
            />
            <Text style={styles.logoText}>Harp2Tab</Text>
          </Pressable>
        </View>

        {showGear && (
          <Pressable
            onPress={() => router.push('/settings')}
            style={({ pressed, hovered }: any) => [
              styles.iconBtn,
              (pressed || hovered) && styles.iconBtnHovered,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <Ionicons name="settings-outline" size={22} color={theme.textSub} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    bar: {
      height:          56,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      backgroundColor: t.bg,
      alignItems:      'center',
    },
    inner: {
      ...webMaxWidth(WEB_CONTENT_WIDTH.wide),
      flex:              1,
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'space-between',
      paddingHorizontal: 20,
    },
    left: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           4,
    },
    logoRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               8,
      paddingVertical:   6,
      paddingHorizontal: 8,
      borderRadius:      8,
      cursor:            'pointer',
    } as any,
    logoRowHovered: { backgroundColor: t.surfaceAlt },
    logoIcon: { width: 26, height: 26 },
    logoText: {
      fontSize:      FONT.md,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.accent,
      letterSpacing: -0.3,
    },
    iconBtn: {
      padding:      8,
      borderRadius: 8,
      cursor:       'pointer',
    } as any,
    iconBtnHovered: { backgroundColor: t.surfaceAlt },
  });
}
