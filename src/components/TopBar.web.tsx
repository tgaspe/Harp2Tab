import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { AvatarCircle } from '@/components/AvatarCircle';
import { initialsFor, useAuth } from '@/auth/useAuth';
import { FONT } from '@/constants/keys';
import { SpaceGrotesk, Poppins } from '@/constants/fonts';
import { useAppStore, selectViewMode, selectSourceProjectId } from '@/store/useAppStore';
import { useAudibleNotes } from '@/hooks/useAudibleNotes';
import { selectHeaderActions, useHeaderActionStore } from '@/store/useHeaderActionStore';
import { selectMidiProjects, useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import type { Theme } from '@/theme';

// Routes that had their own gear->settings shortcut before TopBar existed.
// `/profile` is here and `/settings` deliberately is not: the two screens are each other's
// counterpart, so each shows the way to the other and neither shows the way to itself.
const GEAR_ROUTES = ['/', '/recording', '/edit', '/export', '/studio', '/profile'];
// Same rule in the other direction — the account control is pointless on the page it opens.
const ACCOUNT_HIDDEN_ROUTES = ['/profile'];
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
// A tab converted out of a Studio project is otherwise a dead end — conversion pushes
// straight to the editor, and nothing else points back at the project it came from.
const STUDIO_CRUMB_ROUTES = ['/edit'];

export function TopBar() {
  const router     = useRouter();
  const pathname   = usePathname();
  const theme      = useTheme();
  const styles     = createStyles(theme);

  const viewMode    = useAppStore(selectViewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  // Gated, so this count agrees with what the editor and the export are showing.
  const { notes: tabNotes } = useAudibleNotes();
  // Whatever the current screen has parked here — the Studio uses it for Save and
  // Download MIDI, so it doesn't need a chrome row of its own. Scoped by route, so an
  // action set by a screen that's still mounted underneath can't render here.
  const headerActions = useHeaderActionStore(selectHeaderActions(pathname));

  const auth = useAuth();

  // Set when the open tab was converted out of a Studio project. The project may since
  // have been deleted, so it's resolved rather than trusted — a miss means "source gone".
  const sourceProjectId = useAppStore(selectSourceProjectId);
  const midiProjects    = useMidiProjectsStore(selectMidiProjects);
  const sourceProject   = sourceProjectId
    ? midiProjects.find((p) => p.id === sourceProjectId) ?? null
    : null;

  if (HIDDEN_ROUTES.includes(pathname)) return null;

  const showBack = BACK_ROUTES.includes(pathname);
  const showGear = GEAR_ROUTES.includes(pathname);
  const showAccount = !ACCOUNT_HIDDEN_ROUTES.includes(pathname);
  const showViewToggle = VIEW_TOGGLE_ROUTES.includes(pathname) && tabNotes.length > 0;
  const showBackToStudio = STUDIO_CRUMB_ROUTES.includes(pathname) && sourceProject !== null;

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

        {showBackToStudio && (
          <Pressable
            onPress={() => router.push({ pathname: '/studio', params: { projectId: sourceProject!.id } })}
            style={({ pressed, hovered }: any) => [
              styles.crumb,
              (pressed || hovered) && styles.crumbHovered,
            ]}
            accessibilityRole="link"
            accessibilityLabel={`Back to Studio project ${sourceProject!.title}`}
          >
            <Ionicons name="arrow-back" size={13} color={theme.accent} />
            <Text style={styles.crumbText} numberOfLines={1}>{sourceProject!.title}</Text>
          </Pressable>
        )}

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

      <View style={styles.right}>
        {headerActions.map((action) => {
          const destructive = action.variant === 'destructive';
          return (
            <Pressable
              key={action.key}
              onPress={action.onPress}
              disabled={action.disabled}
              style={({ pressed, hovered }: any) => [
                styles.headerAction,
                destructive && styles.headerActionDestructive,
                action.disabled && styles.headerActionDisabled,
                (pressed || hovered) && !action.disabled && (
                  destructive ? styles.headerActionDestructiveHovered : styles.headerActionHovered
                ),
              ]}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ disabled: !!action.disabled }}
            >
              <Ionicons
                name={action.icon as any}
                size={16}
                color={action.disabled ? theme.textMuted : destructive ? theme.record : theme.accent}
              />
              <Text
                style={[
                  styles.headerActionText,
                  destructive && { color: theme.record },
                  action.disabled && { color: theme.textMuted },
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          );
        })}

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

        {/* Account. Signed out this is a text button rather than a placeholder avatar —
            an empty circle invites a click without saying what it does, and this is the
            app's only always-visible route into an account.
            Hidden on `/profile` itself: a control whose only job is to open the page you are
            already reading is noise, and the gear takes its place there instead. */}
        {!showAccount ? null : auth.status === 'signedIn' && auth.user ? (
          <Pressable
            onPress={() => router.push('/profile')}
            style={({ pressed, hovered }: any) => [
              styles.avatarBtn,
              (pressed || hovered) && styles.avatarBtnHovered,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Profile — signed in as ${auth.user.email}`}
          >
            <AvatarCircle initials={initialsFor(auth.user)} size={30} />
            {/* Unverified is worth surfacing here, not only on /profile: sync is withheld
                until it clears, and the top bar is the one place seen on every screen. */}
            {!auth.user.emailVerified && <View style={styles.avatarBadge} />}
          </Pressable>
        ) : auth.status === 'signedOut' ? (
          <Pressable
            onPress={() => router.push('/profile')}
            style={({ pressed, hovered }: any) => [
              styles.signInBtn,
              (pressed || hovered) && styles.signInBtnHovered,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
          >
            <Text style={styles.signInText}>Sign in</Text>
          </Pressable>
        ) : (
          // Resolving: hold the space rather than render a button that is about to be
          // replaced by an avatar. A bar that reflows on every load reads as a glitch.
          <View style={styles.avatarPlaceholder} />
        )}
      </View>
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
      // Same tone as the docked transport bar at the bottom of the editor (webTransportBar,
      // also t.surface) — the two pieces of chrome bracket the page, so they share a surface.
      backgroundColor:   t.surface,
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
    avatarBtn: {
      borderRadius: 999,
      padding:      2,
      borderWidth:  2,
      borderColor:  'transparent',
      cursor:       'pointer',
    } as any,
    avatarBtnHovered: { borderColor: t.border },
    // Warning dot for an unconfirmed email. Deliberately not a count badge — there is
    // nothing to count, only one thing to do.
    avatarBadge: {
      position:        'absolute',
      right:           0,
      top:             0,
      width:           10,
      height:          10,
      borderRadius:    5,
      backgroundColor: t.warning,
      borderWidth:     2,
      borderColor:     t.surface,
    },
    avatarPlaceholder: { width: 34, height: 34 },
    signInBtn: {
      paddingHorizontal: 14,
      paddingVertical:   7,
      borderRadius:      10,
      borderWidth:       1,
      borderColor:       t.border,
      cursor:            'pointer',
    } as any,
    signInBtnHovered: { backgroundColor: t.surfaceAlt },
    signInText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    right: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           10,
    },
    headerAction: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius:    8,
      borderWidth:     1,
      borderColor:     t.accentDim,
      backgroundColor: t.accentSoft,
    },
    headerActionHovered:  { backgroundColor: t.surfaceAlt },
    headerActionDisabled: { opacity: 0.5 },
    headerActionText: { fontFamily: Poppins.bold, fontSize: 13, color: t.accent },
    // Red, and the same red `ActionSheetModal` uses for its destructive rows — a discard
    // button and the dialog it opens should read as one gesture, not two unrelated reds.
    headerActionDestructive: {
      borderColor:     t.recordDim,
      backgroundColor: t.recordSoft,
    },
    headerActionDestructiveHovered: { backgroundColor: t.recordDim },
    // Breadcrumb back to the Studio project a tab was converted out of. Quieter than a
    // headerAction — it's a place you came from, not something to do.
    crumb: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               5,
      maxWidth:          220,
      paddingVertical:   6,
      paddingHorizontal: 10,
      borderRadius:      8,
      borderWidth:       1,
      borderColor:       t.border,
      cursor:            'pointer',
    } as any,
    crumbHovered: { backgroundColor: t.surfaceAlt },
    crumbText: { flexShrink: 1, fontFamily: Poppins.semiBold, fontSize: 12, color: t.accent },
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
