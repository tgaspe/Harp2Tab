/**
 * `/profile` — what belongs to the *user*. Settings keeps what belongs to the *device*.
 *
 * That split is the same line the sync engine draws (7-10): mic calibration and theme are
 * properties of the machine you are sitting at, so they stay in Settings and stay local;
 * account, plan, library and sync are properties of you, so they live here and travel.
 *
 * Built on `SettingsSurface`'s primitives rather than `settings.tsx`'s mobile card/chevron
 * language — see the note at the top of that file for why the two screens deliberately
 * differ. On native the two-column sections stack, because that grid has no room on a phone.
 *
 * **One scrolling page, not a two-pane with a sub-nav.** It was built that way first and
 * rebuilt on 2026-08-12 after looking at it: twelve controls split four ways left three of
 * the four panes holding a heading and two rows above 350px of nothing. Everything is on one
 * page now, which is what makes it read as a full page rather than an empty one.
 *
 * **UI-only pass.** State comes from `useAuth`'s `?mock=` harness; every action is inert and
 * says so. The library counts are the exception — 7-7 specifies them as locally computed, so
 * they read from the real stores. Faking them would fake the one part that is already true.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { AppSidebar } from '@/components/AppSidebar';
import { AuthModal } from '@/components/AuthModal';
import { AvatarCircle } from '@/components/AvatarCircle';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { EditNameModal } from '@/components/EditNameModal';
import { ReauthModal } from '@/components/ReauthModal';
import { SetPasswordModal } from '@/components/SetPasswordModal';
import { SyncStatusRow } from '@/components/SyncStatusRow';
import { VerifyBanner } from '@/components/VerifyBanner';
import {
  Button, DangerHeading, DangerZone, FieldRow, Section,
} from '@/components/SettingsSurface';
import { initialsFor, joinedOn, memberSince, useAuth } from '@/auth/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { usePremium } from '@/hooks/usePremium';
import type { PremiumState } from '@/store/entitlementState';
import { useHeaderActionStore } from '@/store/useHeaderActionStore';
import { useRecordingsStore } from '@/store/useRecordingsStore';
import { useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { FREE_TIER_ENABLED, RECORDING_LIMIT, useSettingsStore } from '@/store/useSettingsStore';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_BOTTOM, WEB_SCREEN_PADDING_TOP } from '@/constants/layout';
import { ReauthRequired } from '@/auth/auth';
import { contentToBlob, exportFileName, triggerWebDownload } from '@/export/webDownload';
import { generateForFormat } from '@/export/generators';
import type { AuthProviderId } from '@/auth/types';
import type { Theme } from '@/theme';

const PROVIDER_LABEL: Record<AuthProviderId, string> = {
  google:   'Google',
  password: 'Email and password',
};

/**
 * Where a result message appears.
 *
 * One notice at the top of the page was the first attempt and it was wrong: `/profile` is a
 * long single column, and "Change password" sits far enough down that a confirmation at the
 * top is off-screen when it appears. A message the user has to go looking for does not do the
 * job of a message — it reads as a button that did nothing.
 *
 * So each result renders beside the control that caused it. `'top'` is still right for the
 * verification banner, which is itself at the top.
 */
type NoticeAnchor = 'top' | 'profile' | 'signin' | 'danger';

interface Notice {
  tone:   'ok' | 'warn';
  text:   string;
  anchor: NoticeAnchor;
}

/**
 * The plan, in one word (8-3).
 *
 * A subscription inside its grace window still reads as `Premium`, not as a warning: the
 * person is paid up as far as they know, and a card that a bank retried successfully must
 * never have shown them a scare on this page in between. The grace state is disclosed in the
 * Plan section's note instead, where there is room to say what it actually means.
 */
function planLabel(state: PremiumState): string {
  if (!state.premium) return 'Free';
  return state.plan === 'lifetime' ? 'Lifetime' : 'Premium';
}

/** "12 September 2026" — a date someone can check against their bank statement. */
function renewalDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** Total playing time across the library, as "3h 12m" / "12m". */
function formatPlayingTime(totalMs: number): string {
  const minutes = Math.round(totalMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function ProfileScreen() {
  const router = useRouter();
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const auth = useAuth();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signUp' | 'signIn'>('signUp');
  const [deleteOpen, setDeleteOpen]       = useState(false);
  const [notice, setNotice]               = useState<Notice | null>(null);
  const [nameOpen, setNameOpen]           = useState(false);
  const [linkOpen, setLinkOpen]           = useState(false);
  const [reauthOpen, setReauthOpen]       = useState(false);

  /**
   * Wraps an auth action so its outcome lands on screen — both outcomes.
   *
   * Failure reporting came first (7-3): these actions used to `console.warn` and resolve, so
   * call sites could ignore the result, and they now throw instead.
   *
   * **`success` matters just as much, and its absence was a real bug.** Several of these
   * actions do their whole job somewhere the user cannot see — "Change password" sends an
   * email and changes nothing on the page. With no confirmation, a working button is
   * indistinguishable from a dead one, and the honest reading of a screen that does nothing
   * is that nothing happened. Any action whose effect is invisible here must pass a message.
   */
  const run = useCallback(
    (action: () => Promise<unknown>, success?: string, anchor: NoticeAnchor = 'top') => async () => {
      setNotice(null);
      try {
        await action();
        if (success) setNotice({ tone: 'ok', text: success, anchor });
      } catch (error) {
        setNotice({
          tone: 'warn',
          anchor,
          text: error instanceof Error && error.message
            ? error.message
            : 'Something went wrong. Please try again.',
        });
      }
    },
    [],
  );

  /** Renders the notice only where it belongs, so each call site can drop one in place. */
  const noticeAt = useCallback(
    (anchor: NoticeAnchor) => (notice && notice.anchor === anchor ? (
      <Text
        style={[styles.notice, notice.tone === 'ok' ? styles.noticeOk : styles.noticeWarn]}
        accessibilityRole="alert"
      >
        {notice.text}
      </Text>
    ) : null),
    [notice, styles],
  );

  // Real local data, not mocked — see the note at the top of the file.
  const recordings          = useRecordingsStore((s) => s.recordings);
  const projects            = useMidiProjectsStore((s) => s.projects);
  // 8-3: paid access, resolved from the account entitlement and the device unlock. The
  // full plan block (renewal date, manage billing, cancel) is 8-6; this is the honest
  // rendering of what the resolver already knows.
  const premiumState        = usePremium();
  const totalRecordingsUsed = useSettingsStore((s) => s.totalRecordingsUsed);

  /**
   * "Export all my tabs" — the data-portability half of 7-13.
   *
   * JSON over the whole library, because this is the "give me my data" action rather than a
   * "give me sheet music" one: it is the only format that survives a round trip with every
   * note, velocity and filter intact. Per-tab exports in the other formats already exist on
   * the export screen and are not what this button is for.
   *
   * Reuses `generators.ts` exactly as the plan says, so there is no second definition of what
   * a tab is on disk.
   *
   * Web-only, and that is not a gap: native has no auth at all until 7-14, so no signed-in
   * `/profile` exists there to press this from.
   */
  const exportLibrary = useCallback(async () => {
    if (recordings.length === 0) throw new Error('There is nothing to export yet.');
    if (Platform.OS !== 'web') throw new Error('Exporting the whole library is web-only for now.');

    const file = generateForFormat(
      recordings.map((r) => ({
        name:          r.title,
        key:           r.key,
        harmonicaType: r.harmonicaType,
        notes:         r.tabNotes,
      })),
      'JSON',
    );
    const stamp = new Date().toISOString().slice(0, 10);
    triggerWebDownload(
      contentToBlob(file.content, file.encoding, file.mimeType),
      exportFileName(`harp2tab_library_${stamp}`, file.ext),
    );
  }, [recordings]);

  /**
   * Deletion, with the re-authentication step it needs.
   *
   * `auth/requires-recent-login` is not an edge case here: Firebase refuses to delete on a
   * stale sign-in, and the people most likely to be deleting are long-dormant ones whose
   * session is exactly that old. So `ReauthRequired` is caught rather than shown — it is a
   * step in the flow, not a failure — and the delete is retried once the modal confirms.
   */
  const [pendingDelete, setPendingDelete] = useState(false);

  const attemptDelete = useCallback(async () => {
    try {
      await auth.deleteAccount();
      setDeleteOpen(false);
      setPendingDelete(false);
    } catch (error) {
      if (error instanceof ReauthRequired) {
        setDeleteOpen(false);
        setPendingDelete(true);
        setReauthOpen(true);
        return;
      }
      throw error;
    }
  }, [auth]);


  const playingTime = useMemo(
    () => formatPlayingTime(recordings.reduce((sum, r) => sum + (r.duration ?? 0), 0)),
    [recordings],
  );

  function openAuth(mode: 'signUp' | 'signIn') {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  }

  /**
   * Sign out lives in the global header rather than on the page, beside the gear.
   *
   * `useFocusEffect` and `clearHeaderActionsFor`, not `useEffect` and an unconditional
   * clear — both for the reasons the Studio documents at `studio.tsx:492`. Screens are
   * pushed rather than replaced, so navigating onward from here leaves this one mounted and
   * an unmount cleanup would never run; and an unconditional clear racing another screen's
   * focus can wipe the incoming screen's buttons instead of this screen's.
   *
   * Registered only while signed in — there is nothing to sign out of otherwise, and the
   * signed-out page has its own call to action.
   */
  const signedIn           = auth.status === 'signedIn' && !!auth.user;
  const setHeaderActions   = useHeaderActionStore((s) => s.setHeaderActions);
  const clearHeaderActions = useHeaderActionStore((s) => s.clearHeaderActionsFor);
  const signOut            = auth.signOut;

  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return;
      setHeaderActions('/profile', [
        { key: 'sign-out', icon: 'log-out-outline', label: 'Sign out', onPress: run(signOut) },
      ]);
      return () => clearHeaderActions('/profile');
    }, [signedIn, signOut, run, setHeaderActions, clearHeaderActions]),
  );

  /* ── Resolving ──────────────────────────────────────────────────────────────────────
     The skeleton exists so a returning user never watches their account flicker into
     being. The mock holds this state indefinitely so it can actually be reviewed. */
  if (auth.status === 'resolving') {
    return (
      <Shell styles={styles}>
        <View style={styles.container}>
          <View style={styles.skeletonHeader}>
            <View style={[styles.skeleton, styles.skeletonAvatar]} />
            <View style={styles.skeletonLines}>
              <View style={[styles.skeleton, { width: 180, height: 18 }]} />
              <View style={[styles.skeleton, { width: 260, height: 13 }]} />
            </View>
          </View>
          <View style={[styles.skeleton, { height: 1, marginVertical: 20 }]} />
          <View style={[styles.skeleton, { height: 120, borderRadius: 12 }]} />
        </View>
      </Shell>
    );
  }

  /* ── Signed out ─────────────────────────────────────────────────────────────────────
     A real URL people reach from a bookmark or the top bar, so it has to be a pitch
     rather than an error. The local counts are the adoption promise (7-11) stated
     *before* signing in — the only honest moment, since afterwards it has happened. */
  if (auth.status === 'signedOut' || !auth.user) {
    const hasLocalWork = recordings.length > 0 || projects.length > 0;

    return (
      <Shell styles={styles}>
        <ScrollView contentContainerStyle={styles.pitchScroll}>
          <View style={styles.pitchCard}>
            <Ionicons name="cloud-outline" size={40} color={theme.accent} />
            <Text style={styles.pitchTitle}>Your tabs, everywhere</Text>
            <Text style={styles.pitchDesc}>
              Create a free account to keep your tabs and open them on any device you play on.
              Recording, editing and exporting stay free either way.
            </Text>

            <View style={styles.pitchActions}>
              <Button label="Create a free account" onPress={() => openAuth('signUp')} variant="primary" fullWidth />
              <Button label="I already have an account" onPress={() => openAuth('signIn')} fullWidth />
            </View>

            {hasLocalWork && (
              <Text style={styles.pitchFootnote}>
                You have {recordings.length} tab{recordings.length === 1 ? '' : 's'}
                {projects.length > 0 && ` and ${projects.length} project${projects.length === 1 ? '' : 's'}`}
                {' '}on this device. They will come with you.
              </Text>
            )}
          </View>

          {/* The lifetime buyers' claim path. Mandatory, not decorative: someone who already
              bought on Google Play never hits the paywall again, so this is the only door
              through which they can ever reach an account. */}
          <View style={styles.claimNote}>
            <Text style={styles.claimTitle}>Bought Harp2Tab on Google Play?</Text>
            <Text style={styles.claimDesc}>
              Sign in with the same email to keep your lifetime access here.
            </Text>
          </View>
        </ScrollView>

        <AuthModal
          visible={authModalOpen}
          initialMode={authModalMode}
          onClose={() => setAuthModalOpen(false)}
        />
      </Shell>
    );
  }

  /* ── Signed in ──────────────────────────────────────────────────────────────────────── */
  const user     = auth.user;
  const verified = user.emailVerified;
  const name     = user.displayName?.trim() || user.email.split('@')[0];

  return (
    <Shell styles={styles}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.container}>

          {/* Page header. Sign out is deliberately not here — it rides in the global header
              beside the gear (see the `useFocusEffect` above), which keeps this block purely
              about identity. */}
          <View style={styles.pageHeader}>
            <AvatarCircle initials={initialsFor(user)} size={56} />
            <View style={styles.pageHeaderBody}>
              <Text style={styles.pageHeaderName} numberOfLines={1}>{name}</Text>
              <Text style={styles.pageHeaderMeta} numberOfLines={1}>
                {user.email} · {PROVIDER_LABEL[user.providers[0]]} · Joined {memberSince(user)}
              </Text>
            </View>
          </View>

          {/* Whatever the last action reported. Placed under the identity header rather than
              beside each control: several of these actions are triggered from the global
              header or from inside a modal that closes, so a message anchored to the button
              would appear somewhere the user is no longer looking. */}
          {noticeAt('top')}

          {!verified && (
            <View style={styles.bannerWrap}>
              <VerifyBanner
                email={user.email}
                onResend={run(auth.resendVerification)}
                onIVerified={run(auth.reloadUser)}
              />
            </View>
          )}
          {/* A stat band directly under the header. Two jobs: it is the first thing an
              account page should answer ("what do I have here?"), and it gives the top of
              the page density that a run of label/value rows cannot. */}
          <View style={styles.statBand}>
            <Stat theme={theme} value={String(recordings.length)} label={recordings.length === 1 ? 'tab' : 'tabs'} />
            <View style={styles.statRule} />
            <Stat theme={theme} value={String(projects.length)} label={projects.length === 1 ? 'project' : 'projects'} />
            <View style={styles.statRule} />
            <Stat theme={theme} value={playingTime} label="of playing" />
            <View style={styles.statRule} />
            <Stat theme={theme} value={planLabel(premiumState)} label="plan" />
          </View>

          <Section
            first
            title="Profile"
            description="Who you are inside Harp2Tab. Your name is only ever shown to you — it is not published anywhere."
          >
            <FieldRow
              first
              label="Name"
              value={user.displayName ?? 'Not set'}
              action={{ label: 'Edit', onPress: () => setNameOpen(true) }}
            />
            <FieldRow label="Email" value={user.email} />
            <FieldRow label="Joined" value={joinedOn(user)} />
            <FieldRow
              label="Status"
              action={verified ? undefined : {
                label: 'Resend',
                onPress: run(auth.resendVerification, 'Confirmation email sent again — check your inbox.', 'profile'),
              }}
            >
              <View style={styles.inlineStatus}>
                <Ionicons
                  name={verified ? 'checkmark-circle' : 'alert-circle'}
                  size={15}
                  color={verified ? theme.success : theme.warning}
                />
                <Text style={[styles.inlineStatusText, { color: verified ? theme.success : theme.warning }]}>
                  {verified ? 'Email confirmed' : 'Email not confirmed'}
                </Text>
              </View>
            </FieldRow>
            {noticeAt('profile')}
          </Section>

          <Section
            title="Plan"
            description="Recording, editing and exporting are free. Paying lifts the session limit."
          >
            <FieldRow first label="Plan" value={planLabel(premiumState)} />
            {/* Only for a plan that actually has a date. A lifetime row saying "Renews —"
                invites the question of whether it might stop. */}
            {premiumState.expiresAt !== undefined && premiumState.plan === 'subscription' && (
              <FieldRow
                label={premiumState.inGrace ? 'Payment due' : 'Renews'}
                value={renewalDate(premiumState.expiresAt)}
              />
            )}
            <FieldRow
              label="Sessions"
              value={
                premiumState.premium ? 'Unlimited'
                : FREE_TIER_ENABLED ? `${Math.min(totalRecordingsUsed, RECORDING_LIMIT)} of ${RECORDING_LIMIT} used`
                : 'Unlimited while in development'
              }
            />
            <FieldRow label="Billing">
              <Text style={styles.note}>
                {premiumState.inGrace
                  ? 'We could not take your last payment. Your access continues for a few days '
                    + 'while your bank retries — update your card to avoid losing it.'
                  : 'Subscriptions and web billing arrive with the next release. Existing Google '
                    + 'Play purchases carry over.'}
              </Text>
            </FieldRow>
            {!premiumState.premium && (
              <View style={styles.sectionAction}>
                <Button label="See upgrade options" onPress={() => router.push('/paywall')} variant="primary" />
              </View>
            )}
          </Section>

          <Section
            title="Sign-in methods"
            description="The ways you can get into this account. You can have more than one — any of them reaches the same place."
          >
            {user.providers.map((provider, i) => (
              <FieldRow key={provider} first={i === 0} label={PROVIDER_LABEL[provider]}>
                <View style={styles.inlineStatus}>
                  <Text style={styles.fieldStrong} numberOfLines={1}>{user.email}</Text>
                  <Ionicons name="checkmark-circle" size={15} color={theme.success} />
                </View>
              </FieldRow>
            ))}
            <View style={styles.sectionAction}>
              {user.providers.includes('password')
                ? <Button label="Change password" onPress={run(
                    () => auth.sendPasswordReset(user.email),
                    `We've sent a link to ${user.email}. Open it to set a new password.`,
                    'signin',
                  )} />
                : <Button label="Add email and password" onPress={() => setLinkOpen(true)} />}
            </View>
            {noticeAt('signin')}
          </Section>

          <Section
            title="Sync"
            description="Keeping the same library on every device you sign in from."
          >
            {/* No `onSyncNow` in 7a — there is no engine to ask, so no button is offered
                rather than one that does nothing. */}
            <SyncStatusRow sync={auth.sync} />
          </Section>

          <Section
            title="Export"
            description="Your tabs are yours. Take them out whenever you like, in any format the app writes."
          >
            <Button
              label="Export all my tabs"
              onPress={run(
                exportLibrary,
                `Downloaded ${recordings.length} ${recordings.length === 1 ? 'tab' : 'tabs'} as JSON.`,
                'danger',
              )}
            />
            {noticeAt('danger')}
          </Section>

          <DangerHeading>Danger zone</DangerHeading>
          <DangerZone
            title="Delete this account"
            description="Removes your account and everything synced to it. This cannot be undone. The copies on this device stay where they are."
            actionLabel="Delete account"
            onPress={() => setDeleteOpen(true)}
          />
          {auth.isMock && <MockNotice theme={theme} />}
        </View>
      </ScrollView>

      <ConfirmDeleteModal
        visible={deleteOpen}
        tabCount={recordings.length}
        projectCount={projects.length}
        onConfirm={run(attemptDelete, undefined, 'danger')}
        onCancel={() => setDeleteOpen(false)}
      />

      <AuthModal
        visible={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
      />

      {/* A web-shaped dialog rather than `NameRecordingModal`'s phone sheet — see the note
          at the top of `EditNameModal`. */}
      <EditNameModal
        visible={nameOpen}
        initialName={user.displayName ?? ''}
        onConfirm={async (next) => {
          setNameOpen(false);
          await run(() => auth.updateDisplayName(next), 'Name updated.', 'profile')();
        }}
        onCancel={() => setNameOpen(false)}
      />

      {/* 7-5. Adds a password to a Google-only account — deliberately not the sign-up modal,
          which would try to create a second account for an address that already has one. */}
      <SetPasswordModal
        visible={linkOpen}
        email={user.email}
        onConfirm={async (password) => {
          await auth.linkEmailPassword(user.email, password);
          setLinkOpen(false);
        }}
        onCancel={() => setLinkOpen(false)}
      />

      {/* Only ever opened by `attemptDelete` catching `ReauthRequired` — never offered on its
          own, because re-authenticating is a step inside another action, not something a user
          would set out to do. `reason` names that action, since a bare "confirm your password"
          prompt appearing unbidden is indistinguishable from a phishing attempt. */}
      <ReauthModal
        visible={reauthOpen}
        email={user.email}
        providers={user.providers}
        reason="to delete your account"
        onConfirm={async (password) => {
          await auth.reauthenticate(password);
          setReauthOpen(false);
          // Straight back into the delete the user already confirmed. Sending them to type
          // DELETE a second time would read as the first attempt having failed.
          if (pendingDelete) await run(attemptDelete, undefined, 'danger')();
        }}
        onCancel={() => { setReauthOpen(false); setPendingDelete(false); }}
      />
    </Shell>
  );
}

/**
 * The page inside the web app shell — Home's left rail, then this page's own content.
 *
 * Wrapping all three states (resolving, signed out, signed in) rather than only the signed-in
 * one: the rail is chrome, and chrome that disappears while an account resolves or reappears
 * on sign-in reads as the page jumping rather than as a state change. It is also the only
 * thing on the signed-out pitch that keeps recording and uploading one click away for someone
 * who arrived here and decided not to make an account.
 *
 * Native keeps the plain page — the rail is web-only there too (see `AppSidebar`), where the
 * entry points live in the bottom action bar instead.
 */
function Shell({ styles, children }: {
  styles: ReturnType<typeof createStyles>;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.shell}>
        {Platform.OS === 'web' && <AppSidebar />}
        {/* `minWidth: 0` so the content column can actually shrink beside the fixed-width
            rail instead of pushing the row wider than the viewport. */}
        <View style={styles.shellMain}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

/** Inline stat — left-aligned in a row, not a centred three-up widget with dividers. */
function Stat({ theme, value, label }: { theme: Theme; value: string; label: string }) {
  const styles = createStyles(theme);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** Review aid for the UI-only pass. Deleted with the rest of the harness at 7-1. */
function MockNotice({ theme }: { theme: Theme }) {
  const styles = createStyles(theme);
  return (
    <Text style={styles.mockNotice}>
      UI preview — nothing here is connected yet. Try{' '}
      <Text style={styles.mockCode}>?mock=unverified</Text>,{' '}
      <Text style={styles.mockCode}>?mock=newUser</Text>,{' '}
      <Text style={styles.mockCode}>?mock=offline</Text>,{' '}
      <Text style={styles.mockCode}>?mock=syncDiscard</Text>,{' '}
      <Text style={styles.mockCode}>?mock=resolving</Text>.
      {'\n'}Plan states (8a):{' '}
      <Text style={styles.mockCode}>?plan=yearly</Text>,{' '}
      <Text style={styles.mockCode}>?plan=lifetime</Text>,{' '}
      <Text style={styles.mockCode}>?plan=grace</Text>,{' '}
      <Text style={styles.mockCode}>?plan=lapsed</Text>,{' '}
      <Text style={styles.mockCode}>?plan=device</Text>. Combine with{' '}
      <Text style={styles.mockCode}>&amp;</Text>.
    </Text>
  );
}

function createStyles(t: Theme) {
  const isWeb = Platform.OS === 'web';
  return StyleSheet.create({
    safe:   { flex: 1, backgroundColor: t.bg },
    // Rail and page content as flex-row siblings, with only the content side scrolling —
    // the same shell Home's dashboard uses, so the rail is genuinely full page height
    // rather than as tall as its own contents.
    shell:     { flex: 1, flexDirection: 'row' },
    shellMain: { flex: 1, minWidth: 0 },
    scroll: { flexGrow: 1 },
    container: {
      flex: 1,
      // `full`, not `wide` — see the note on the constant. This page nests two fixed columns
      // (nav, then each section's prose column) inside the container, so it needs more room
      // than a single-column screen to end up with the same usable width.
      ...webMaxWidth(WEB_CONTENT_WIDTH.full),
      paddingHorizontal: isWeb ? 40 : 24,
      paddingTop:    isWeb ? WEB_SCREEN_PADDING_TOP : 16,
      paddingBottom: isWeb ? WEB_SCREEN_PADDING_BOTTOM : 24,
    },

    pageHeader: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           16,
      paddingBottom: 20,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    pageHeaderBody: { flex: 1, minWidth: 0, gap: 3 },
    pageHeaderName: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.5,
    },
    pageHeaderMeta: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
    },

    bannerWrap: { paddingTop: 20 },
    notice: {
      marginTop:       16,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius:    10,
      borderWidth:     1,
      color:           t.textPrimary,
      fontFamily:      Poppins.regular,
      fontSize:        FONT.sm,
      lineHeight:      20,
    },
    noticeOk:   { backgroundColor: `${t.success}1A`, borderColor: `${t.success}44` },
    noticeWarn: { backgroundColor: `${t.warning}1A`, borderColor: `${t.warning}44` },

    // Answers "what do I have here?" before any settings row does, and gives the top of the
    // page density that a run of label/value rows cannot.
    statBand: {
      flexDirection:   'row',
      alignItems:      'center',
      marginTop:       24,
      borderWidth:     1,
      borderColor:     t.border,
      borderRadius:    14,
      backgroundColor: t.surface,
      paddingVertical: 18,
    },
    statRule: { width: 1, alignSelf: 'stretch', backgroundColor: t.separator },

    sectionAction: { paddingTop: 18 },
    note: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 20,
      // The body column is wide now, and prose is the one thing that should not use all of
      // it — past roughly 90 characters a line stops being comfortable to read. Rows and
      // tables stretch; paragraphs do not.
      maxWidth:   620,
    },
    fieldStrong: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.medium,
      color:      t.textPrimary,
      flexShrink: 1,
    },
    inlineStatus: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    inlineStatusText: { fontSize: FONT.sm, fontFamily: Poppins.medium },

    stat: { flex: 1, alignItems: 'center', gap: 2 },
    statValue: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.5,
    },
    statLabel: { fontSize: FONT.xs, fontFamily: Poppins.regular, color: t.textMuted },

    // ── Signed-out pitch: a centred card, not a full-bleed mobile screen ──
    pitchScroll: {
      flexGrow:          1,
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 24,
      paddingVertical:   48,
      gap:               16,
    },
    pitchCard: {
      alignItems:      'center',
      gap:             10,
      width:           '100%',
      maxWidth:        440,
      backgroundColor: t.surface,
      borderWidth:     1,
      borderColor:     t.border,
      borderRadius:    16,
      paddingVertical:   36,
      paddingHorizontal: 32,
    },
    pitchTitle: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.5,
      textAlign:     'center',
      marginTop:     4,
    },
    pitchDesc: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      textAlign:  'center',
      lineHeight: 20,
    },
    pitchActions: { gap: 8, marginTop: 14, alignSelf: 'stretch' },
    pitchFootnote: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
      marginTop:  8,
      lineHeight: 17,
    },
    claimNote: { width: '100%', maxWidth: 440, gap: 2, paddingHorizontal: 4 },
    claimTitle: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    claimDesc:  { fontSize: FONT.xs, fontFamily: Poppins.regular, color: t.textMuted, lineHeight: 17 },

    // ── Resolving skeleton ──
    skeletonHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 8 },
    skeletonLines:  { gap: 8 },
    skeleton:       { backgroundColor: t.surfaceAlt, borderRadius: 6 },
    skeletonAvatar: { width: 56, height: 56, borderRadius: 28 },

    mockNotice: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      marginTop:  32,
      lineHeight: 18,
    },
    mockCode: { fontFamily: SpaceGrotesk.medium, color: t.textSub },
  });
}
