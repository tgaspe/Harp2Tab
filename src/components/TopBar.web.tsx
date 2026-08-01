import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { FONT } from '@/constants/keys';
import { SpaceGrotesk, Poppins } from '@/constants/fonts';
import { useAppStore, selectViewMode, selectTabNotes } from '@/store/useAppStore';
import type { Theme } from '@/theme';

// Routes that had their own gear->settings shortcut before TopBar existed.
const GEAR_ROUTES = ['/', '/recording', '/edit', '/export'];
// Only the two routes that already had a back arrow before TopBar existed —
// deliberately not router.canGoBack(), so we don't invent a "go back
// mid-recording" affordance that didn't exist before.
const BACK_ROUTES = ['/settings', '/export'];
// Focused conversion/setup flows — no nav chrome, matches their existing
// lack of a back button.
const HIDDEN_ROUTES = ['/paywall', '/onboarding', '/import'];
// The List/Piano-Roll toggle only makes sense on the editor — shown next to the app
// title here (rather than in edit.tsx's own toolbar) since it needs to stay visible
// and drivable from this globally-rendered bar.
const VIEW_TOGGLE_ROUTES = ['/edit'];

export function TopBar() {
  const router     = useRouter();
  const pathname   = usePathname();
  const theme      = useTheme();
  const styles     = createStyles(theme);

  const viewMode    = useAppStore(selectViewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const tabNotes    = useAppStore(selectTabNotes);

  if (HIDDEN_ROUTES.includes(pathname)) return null;

  const showBack = BACK_ROUTES.includes(pathname);
  const showGear = GEAR_ROUTES.includes(pathname);
  const showViewToggle = VIEW_TOGGLE_ROUTES.includes(pathname) && tabNotes.length > 0;

  return (
    <View style={styles.bar}>
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
            <Ionicons name="arrow-back" size={24} color={theme.textSub} />
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

        {showViewToggle && (
          <View style={styles.viewToggle}>
            <Pressable
              onPress={() => setViewMode('list')}
              style={[styles.viewToggleSeg, viewMode === 'list' && styles.viewToggleSegActive]}
              accessibilityRole="radio"
              accessibilityState={{ checked: viewMode === 'list' }}
              accessibilityLabel="List view"
            >
              <Ionicons name="list-outline" size={13} color={viewMode === 'list' ? '#fff' : theme.textSub} />
              <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>List</Text>
            </Pressable>
            <Pressable
              onPress={() => setViewMode('pianoRoll')}
              style={[styles.viewToggleSeg, viewMode === 'pianoRoll' && styles.viewToggleSegActive]}
              accessibilityRole="radio"
              accessibilityState={{ checked: viewMode === 'pianoRoll' }}
              accessibilityLabel="Piano roll view"
            >
              <MaterialCommunityIcons name="piano" size={14} color={viewMode === 'pianoRoll' ? '#fff' : theme.textSub} />
              <Text style={[styles.viewToggleText, viewMode === 'pianoRoll' && styles.viewToggleTextActive]}>Piano Roll</Text>
            </Pressable>
          </View>
        )}
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
          <Ionicons name="settings-outline" size={24} color={theme.textSub} />
        </Pressable>
      )}
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    // Full-bleed: the bar's contents pin to the actual viewport corners, not to the
    // narrower centered content column each page uses below it — a global chrome
    // element shouldn't inherit a page's content max-width.
    bar: {
      height:            64,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      backgroundColor:   t.bg,
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'space-between',
      paddingHorizontal: 28,
    },
    left: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           6,
    },
    logoRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               10,
      paddingVertical:   7,
      paddingHorizontal: 10,
      borderRadius:      8,
      cursor:            'pointer',
    } as any,
    logoRowHovered: { backgroundColor: t.surfaceAlt },
    logoIcon: { width: 42, height: 42 },
    logoText: {
      fontSize:      FONT.lg,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.accent,
      letterSpacing: -0.3,
    },
    iconBtn: {
      padding:      9,
      borderRadius: 8,
      cursor:       'pointer',
    } as any,
    iconBtnHovered: { backgroundColor: t.surfaceAlt },

    viewToggle: {
      flexDirection:   'row',
      backgroundColor: t.surfaceAlt,
      borderRadius:    8,
      padding:         2,
      gap:             2,
      marginLeft:      8,
    },
    viewToggleSeg: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               5,
      paddingVertical:   6,
      paddingHorizontal: 10,
      borderRadius:      6,
      cursor:            'pointer',
    } as any,
    viewToggleSegActive: { backgroundColor: t.accent },
    viewToggleText:       { fontSize: 12, fontFamily: Poppins.semiBold, color: t.textSub },
    viewToggleTextActive: { color: '#fff' },
  });
}
