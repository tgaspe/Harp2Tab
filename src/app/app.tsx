import { ActionSheetModal } from '@/components/ActionSheetModal';
import { AppSidebar } from '@/components/AppSidebar';
import { KeyGrid } from '@/components/KeyGrid';
import { RatingModal } from '@/components/RatingModal';
import { RecordingCard } from '@/components/RecordingCard';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT, HARMONICA_KEYS } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import { usePlayback } from '@/hooks/usePlayback';
import { usePremium } from '@/hooks/usePremium';
import { selectHarmonicaType, selectKey, useAppStore } from '@/store/useAppStore';
import { FREE_TIER_ENABLED, useSettingsStore } from '@/store/useSettingsStore';
import { computeEffectiveLimit, resolveSessionGate } from '@/store/sessionGate';
import { AudioImportError } from '@/audio/audioImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { pickMidiFile } from '@/audio/pickMidiFile';
import { setPendingImport } from '@/audio/pendingImport';
import { selectRecordings, useRecordingsStore } from '@/store/useRecordingsStore';
import { selectMidiProjects, useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { createProject } from '@/audio/midiProject';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, MidiProject, TabRecording } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import { GROUP_LABEL, RADIUS, SECTION_HEADING } from '@/constants/ui';

type SortOption = 'recent' | 'oldest' | 'title' | 'longest';
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'recent',  label: 'Most recent' },
  { value: 'oldest',  label: 'Oldest first' },
  { value: 'title',   label: 'Title (A–Z)' },
  { value: 'longest', label: 'Longest' },
];

/**
 * The projects section's own sort, deliberately not `SortOption`.
 *
 * Three of the four options carry over, but 'Longest' does not: a project's length is a
 * property of whichever track you end up converting, not of the project, so ordering by it
 * would rank the list on a number the card never shows. 'Most tracks' replaces it — it
 * sorts on the figure the card *does* print, and it's the one that separates a real
 * arrangement from a one-track import.
 *
 * 'Most recent'/'Oldest' also resolve on `updatedAt` here, where the tabs list uses
 * `createdAt`. Same reason: the project card's timestamp line says "Updated", and a sort
 * that disagreed with the stamp beside it would look broken.
 */
type ProjectSortOption = 'recent' | 'oldest' | 'title' | 'tracks';
const PROJECT_SORT_OPTIONS: { value: ProjectSortOption; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title',  label: 'Title (A–Z)' },
  { value: 'tracks', label: 'Most tracks' },
];

// Shared by the key filter and sort pills — a small pill that opens an absolute-positioned
// option list below it, same interaction as the split button's key/type dropdown elsewhere
// on this screen.
function FilterDropdown({ pillPrefix = '', value, options, onSelect, theme, styles }: {
  pillPrefix?: string;
  value: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
  theme: Theme;
  styles: ReturnType<typeof createStyles>;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <View style={styles.filterDropdownAnchor}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed, hovered }: any) => [
          styles.filterPill,
          (pressed || hovered) && styles.filterPillHovered,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${pillPrefix}${selectedLabel}`}
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.filterPillText} numberOfLines={1}>{pillPrefix}{selectedLabel}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color={theme.textSub} />
      </Pressable>

      {open && (
        <View style={styles.filterDropdownPanel}>
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => { onSelect(opt.value); setOpen(false); }}
                style={({ hovered }: any) => [
                  styles.filterOption,
                  active && styles.filterOptionActive,
                  hovered && !active && styles.filterOptionHovered,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.filterOptionText, active && styles.filterOptionTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * "2 minutes ago" / "3 days ago" / a date once it stops being recent.
 *
 * Coarse on purpose: the question this answers is "is this the thing I was just doing",
 * and past about a week the answer is no and the exact figure stops mattering.
 */
function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60)    return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60)    return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24)   return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7)    return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * One MIDI project, as a card in the dashboard's projects grid.
 *
 * A component rather than inline markup for one reason: deleting a project used to fire the
 * instant the trash icon was hit, while deleting a *recording* — the less valuable of the
 * two — went through a confirmation sheet. That needed local `confirming` state, and the
 * grid is a `.map()`.
 */
function ProjectCard({ project, onOpen, onDelete, theme, styles }: {
  project: MidiProject;
  onOpen: () => void;
  onDelete: () => void;
  theme: Theme;
  styles: ReturnType<typeof createStyles>;
}) {
  const [confirming, setConfirming] = useState(false);
  // Whole-card hover, for the same reason as RecordingCard's — see the note there.
  const [hovered, setHovered] = useState(false);

  return (
    <View
      style={[styles.projectCard, hovered && styles.projectCardHovered]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Pressable
        style={styles.projectCardMain}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${project.title} in the MIDI Studio`}
      >
        <View style={styles.projectCardIconWrap}>
          <Ionicons name="layers-outline" size={28} color={theme.accent} />
        </View>
        <View style={styles.projectCardText}>
          <Text style={styles.projectCardTitle} numberOfLines={1}>{project.title}</Text>
          <Text style={styles.projectCardMeta} numberOfLines={1}>
            {project.tracks.length} track{project.tracks.length === 1 ? '' : 's'}
            {' · '}
            {project.tracks.reduce((n, t) => n + t.notes.length, 0)} notes
          </Text>
          {/* The line that tells two same-shaped projects apart. Title collisions are
              prevented at save time now, but "which of these did I touch last" is a
              different question and only a timestamp answers it. */}
          <Text style={styles.projectCardStamp} numberOfLines={1}>
            Updated {timeAgo(project.updatedAt)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => setConfirming(true)}
        style={styles.projectCardDelete}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Delete project ${project.title}`}
      >
        <Ionicons name="trash-outline" size={14} color={theme.textMuted} />
      </Pressable>

      {/* Same sheet, same wording shape as RecordingCard's delete — the two destructive
          actions on this page should cost the same. */}
      <ActionSheetModal
        visible={confirming}
        title={`Delete "${project.title}"? This can't be undone.`}
        options={[
          { label: 'Delete', style: 'destructive', onPress: onDelete },
        ]}
        onClose={() => setConfirming(false)}
      />
    </View>
  );
}

export default function KeySelectionScreen() {
  const router         = useRouter();
  const theme          = useTheme();
  const styles         = useMemo(() => createStyles(theme), [theme]);
  const hasCompletedOnboarding = useSettingsStore((s) => s.hasCompletedOnboarding);

  // Native only. On the web, mic calibration is the first step of the first *recording*
  // rather than a wall in front of the app: most of what Home offers — the library, audio
  // and MIDI upload, a blank Studio project — never touches a microphone, and demanding
  // one from a visitor who has not asked to record yet is both a worse first impression
  // and a browser prompt with no context behind it. `handleStart` sends them through
  // calibration at the moment it actually means something.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!hasCompletedOnboarding) router.replace('/onboarding');
  }, [hasCompletedOnboarding]);

  const harmonicaType        = useAppStore(selectHarmonicaType);
  const setHarmonicaType     = useAppStore((s) => s.setHarmonicaType);
  const selectedKey          = useAppStore(selectKey);
  const selectKey_           = useAppStore((s) => s.selectKey);
  const startRecording       = useAppStore((s) => s.startRecording);
  const loadRecording        = useAppStore((s) => s.loadRecording);
  const totalRecordingsUsed  = useSettingsStore((s) => s.totalRecordingsUsed);
  const ratingStatus         = useSettingsStore((s) => s.ratingStatus);
  // Not `isPurchased` (8-3): a subscription can lapse, so paid access is resolved from the
  // account entitlement and the device unlock together rather than read off a latch.
  const { premium }          = usePremium();
  const recordings           = useRecordingsStore(selectRecordings);
  const midiProjects         = useMidiProjectsStore(selectMidiProjects);
  const saveProject          = useMidiProjectsStore((s) => s.saveProject);
  const deleteProject        = useMidiProjectsStore((s) => s.deleteProject);
  const deleteRecording      = useRecordingsStore((s) => s.deleteRecording);
  const renameRecording      = useRecordingsStore((s) => s.renameRecording);
  const toggleFavorite       = useRecordingsStore((s) => s.toggleFavorite);
  const [showRatingModal, setShowRatingModal] = useState(false);
  // Only for failures that happen before the import screen exists (an oversized file
  // rejected at pick time) — everything after that is reported on /import itself.
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Web-only: lets a recording row's play button preview it without leaving Home or
  // touching the shared editing session in useAppStore — this hook instance is fully
  // self-contained (play() takes notes as an argument), so previewing here can't clobber
  // whatever's currently loaded for editing.
  const preview = usePlayback();
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Web-only: library toolbar state — search/filter/sort operate on `recordings` directly
  // (not the display-ordered `orderedRecordings` below), since an explicit sort control
  // replaces the old fixed "oldest to newest" convention once it's in play.
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryKeyFilter, setLibraryKeyFilter] = useState<'all' | HarmonicaKey>('all');
  const [librarySort, setLibrarySort] = useState<SortOption>('recent');
  const [libraryView, setLibraryView] = useState<'list' | 'grid'>('list');
  // The projects section's toolbar is its own, not a second view onto the tabs one. The two
  // libraries hold different objects and get scanned for different reasons — sorting tabs by
  // key while browsing projects by track count is a normal thing to want, and one shared
  // pair of controls would make each section's setting a side effect of the other's.
  // Defaults to `grid` because the projects section has always been a wrapping card grid;
  // the toggle adds a list option, it doesn't change what you get on arrival.
  const [projectSort, setProjectSort] = useState<ProjectSortOption>('recent');
  const [projectView, setProjectView] = useState<'list' | 'grid'>('grid');

  /**
   * How many project cards go across, and therefore how wide one is.
   *
   * Three of them span exactly the width of one tab card below — the two libraries are the
   * same page-width object, one just subdivided — which is why the count is fixed rather
   * than a `flexBasis` the cards negotiate among themselves. That was the old behaviour and
   * it left a ragged right edge wherever the column width wasn't a clean multiple of 300.
   *
   * Fixed at three it would keep dividing a column that has already run out of room: the
   * rail takes a flat 300px, so a 1024px window leaves each card about 200px for a 62px
   * icon plus three lines of text. Dropping a column is better than truncating every card
   * in the section, so the count steps down instead. Measured on the *window* rather than
   * on the column because the rail's width is a constant — the two differ by a fixed amount
   * and window width is the number that doesn't need a layout pass to read.
   */
  const { width: windowWidth } = useWindowDimensions();
  const projectColumns = windowWidth >= 1200 ? 3 : windowWidth >= 900 ? 2 : 1;
  // The gutter is padding *inside* each item (see `projectGrid`'s negative margin), so the
  // basis is a clean fraction of the row with nothing to subtract from it.
  const projectColumnBasis = `${100 / projectColumns}%` as ViewStyle['flexBasis'];

  const effectiveLimit = computeEffectiveLimit(ratingStatus);

  function handleStart() {
    if (!selectedKey) return;
    const gate = resolveSessionGate({ isPurchased: premium, totalRecordingsUsed, ratingStatus });
    if (gate === 'showRating') { setShowRatingModal(true); return; }
    if (gate === 'showPaywall') { router.push('/paywall'); return; }
    // Web: first recording ever, so calibrate first. The gate is resolved before this on
    // purpose — someone who is about to hit the paywall should see it rather than spend
    // eight seconds blowing into a microphone for a session they can't start. Onboarding
    // calls `startRecording()` itself and lands on /recording when it's done.
    if (Platform.OS === 'web' && !hasCompletedOnboarding) {
      router.push({ pathname: '/onboarding', params: { next: 'recording' } });
      return;
    }
    startRecording();
    router.push('/recording');
  }

  // Same shape as handleStart — the free-tier gate has to come first for every "start a
  // new session" entry point, not just recording. The file dialog is opened here (inside
  // the press handler) rather than on the import screen because browsers only allow it
  // during a real user gesture.
  async function handleUploadAudio() {
    if (!selectedKey) return;
    const gate = resolveSessionGate({ isPurchased: premium, totalRecordingsUsed, ratingStatus });
    if (gate === 'showRating') { setShowRatingModal(true); return; }
    if (gate === 'showPaywall') { router.push('/paywall'); return; }

    try {
      const picked = await pickAudioFile();
      if (!picked) return; // dismissed the picker — nothing started, nothing consumed
      setPendingImport(picked);
      setUploadError(null);
      router.push('/import');
    } catch (err) {
      // Only the pre-read size check can fail this early; everything else surfaces on the
      // import screen, which has room to explain it properly.
      setUploadError(err instanceof AudioImportError ? err.message : "That file couldn't be opened.");
    }
  }

  /**
   * A blank Studio project.
   *
   * Deliberately *not* behind the free-tier gate: nothing has been transcribed, and no tab
   * exists yet. The gate applies at conversion, which is where a tab is actually produced —
   * same reasoning as "Open in Studio" on the import screen.
   */
  function handleNewProject() {
    const project = createProject({ title: 'Untitled project' });
    saveProject(project);
    router.push({ pathname: '/studio', params: { projectId: project.id } });
  }

  // Same shape again for the third entry point. The `kind` param is what tells /import to
  // parse rather than transcribe — everything either side of that step is shared.
  async function handleUploadMidi() {
    if (!selectedKey) return;
    const gate = resolveSessionGate({ isPurchased: premium, totalRecordingsUsed, ratingStatus });
    if (gate === 'showRating') { setShowRatingModal(true); return; }
    if (gate === 'showPaywall') { router.push('/paywall'); return; }

    try {
      const picked = await pickMidiFile();
      if (!picked) return; // dismissed the picker — nothing started, nothing consumed
      setPendingImport(picked);
      setUploadError(null);
      router.push({ pathname: '/import', params: { kind: 'midi' } });
    } catch (err) {
      setUploadError(err instanceof AudioImportError ? err.message : "That file couldn't be opened.");
    }
  }

  function handleOpenRecording(recording: TabRecording) {
    loadRecording(recording);
    router.push('/edit');
  }

  function handleTogglePreview(recording: TabRecording) {
    if (previewId === recording.id && preview.isPlaying) {
      preview.stop();
      return;
    }
    setPreviewId(recording.id);
    preview.play(recording.tabNotes, { bpm: recording.bpm ?? 100, metronomeEnabled: false, rate: 1 });
  }

  if (Platform.OS !== 'web' && !hasCompletedOnboarding) return null;

  // Shared across the web hero dropdown and the native single-column layout below — the
  // markup is identical, only where each piece lands in the page differs per platform.
  const harmonicaTypeSection = (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Harmonica type</Text>
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
  );

  const keySection = (
    <View style={[styles.section, Platform.OS !== 'web' && { marginTop: 16 }]}>
      <Text style={styles.sectionLabel}>Harmonica key</Text>
      <KeyGrid
        selected={selectedKey}
        onSelect={(k: HarmonicaKey) => selectKey_(k)}
      />
    </View>
  );

  const tipSection = (
    <View style={styles.tip}>
      <Ionicons name="information-circle-outline" size={15} color={theme.textMuted} />
      <Text style={styles.tipText}>
        Tip: quiet environments give the best results. Mic sensitivity can be tuned in{' '}
        <Text style={styles.tipLink} onPress={() => router.push('/settings')}>Settings</Text>.
      </Text>
    </View>
  );

  // Failures that happen at pick time (before /import exists to report them). Shared by
  // all three layouts' upload buttons so none of them can fail silently.
  const uploadErrorBanner = uploadError ? (
    <View style={styles.uploadError} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle-outline" size={14} color={theme.warning} />
      <Text style={styles.uploadErrorText}>{uploadError}</Text>
    </View>
  ) : null;

  const startAndUpload = (
    <View style={styles.startAndUpload}>
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
        {/* Nothing counts down while the free tier is off, so nothing advertises a count. */}
        {FREE_TIER_ENABLED && !premium && (
          <View style={styles.btnCounter}>
            <Text style={[styles.btnCounterText, !selectedKey && styles.btnCounterTextDisabled]}>
              {Math.min(totalRecordingsUsed, effectiveLimit)} / {effectiveLimit} free recordings used
            </Text>
          </View>
        )}
      </Pressable>

      <View style={styles.uploadRow}>
        <Pressable
          onPress={handleUploadAudio}
          disabled={!selectedKey}
          style={({ pressed, hovered }: any) => [
            styles.uploadBtn,
            !selectedKey && styles.uploadBtnDisabled,
            (pressed || hovered) && !!selectedKey && styles.uploadBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Upload Audio"
          accessibilityState={{ disabled: !selectedKey }}
        >
          <Ionicons name="cloud-upload-outline" size={18} color={selectedKey ? theme.textSub : theme.textMuted} />
          <Text style={[styles.uploadBtnText, !!selectedKey && styles.uploadBtnTextEnabled]}>Upload Audio</Text>
        </Pressable>
        <Pressable
          onPress={handleUploadMidi}
          disabled={!selectedKey}
          style={({ pressed, hovered }: any) => [
            styles.uploadBtn,
            !selectedKey && styles.uploadBtnDisabled,
            (pressed || hovered) && !!selectedKey && styles.uploadBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Upload MIDI"
          accessibilityState={{ disabled: !selectedKey }}
        >
          <Ionicons name="musical-note-outline" size={18} color={selectedKey ? theme.textSub : theme.textMuted} />
          <Text style={[styles.uploadBtnText, !!selectedKey && styles.uploadBtnTextEnabled]}>Upload MIDI</Text>
        </Pressable>
        <Pressable
          onPress={handleNewProject}
          style={({ pressed, hovered }: any) => [
            styles.uploadBtn,
            (pressed || hovered) && styles.uploadBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="New MIDI Studio project"
        >
          <Ionicons name="add-circle-outline" size={18} color={theme.textSub} />
          <Text style={[styles.uploadBtnText, styles.uploadBtnTextEnabled]}>New MIDI Project</Text>
        </Pressable>
      </View>

      {uploadErrorBanner}
    </View>
  );

  // Store keeps newest-first for future consumers; display oldest-to-newest so the most
  // recent recording reads as "last".
  const orderedRecordings = [...recordings].reverse();

  // Only offer keys that actually have a recording, in the harmonica's canonical (circle-
  // of-fifths-ish) order rather than alphabetical — matches how the key is presented
  // everywhere else in the app (KeyGrid, the key/type picker, etc).
  const presentKeys = HARMONICA_KEYS.filter((k) => recordings.some((r) => r.key === k));
  const keyFilterOptions = [
    { value: 'all', label: 'All Keys' },
    ...presentKeys.map((k) => ({ value: k, label: `Key ${k}` })),
  ];

  /**
   * Search is *page*-scoped; the key filter and sort are *section*-scoped.
   *
   * That asymmetry is deliberate and is why the input moved up into the page header. A
   * control's position is a claim about its reach, and this one used to sit inside the
   * Harmonica Tabs toolbar — which is exactly why it only ever searched tabs. Level with
   * the page title it can honestly span both libraries. Key and sort stay in the toolbar
   * because a MIDI project has no key and no duration to order by.
   */
  const searchQuery   = librarySearch.trim().toLowerCase();
  const searching     = searchQuery !== '';

  /** Projects match on title *or* any track name — "bass", "lead". A project otherwise has
   *  almost no searchable surface, and the track list is the part the user named. */
  const matchedProjects = (searching
    ? midiProjects.filter((p) =>
        p.title.toLowerCase().includes(searchQuery) ||
        p.tracks.some((t) => (t.name ?? '').toLowerCase().includes(searchQuery)))
    : midiProjects
  ).slice().sort((a, b) => {
    switch (projectSort) {
      case 'recent': return b.updatedAt - a.updatedAt;
      case 'oldest': return a.updatedAt - b.updatedAt;
      case 'title':  return a.title.localeCompare(b.title);
      case 'tracks': return b.tracks.length - a.tracks.length;
    }
  });

  const filteredRecordings = recordings
    .filter((r) => libraryKeyFilter === 'all' || r.key === libraryKeyFilter)
    .filter((r) => !searching || r.title.toLowerCase().includes(searchQuery))
    .sort((a, b) => {
      switch (librarySort) {
        case 'recent':  return b.createdAt - a.createdAt;
        case 'oldest':  return a.createdAt - b.createdAt;
        case 'title':   return a.title.localeCompare(b.title);
        case 'longest': return b.duration - a.duration;
      }
    });
  const libraryFiltersActive = libraryKeyFilter !== 'all' || searching;

  // A section with no hits is noise while searching, so it goes away entirely; with nothing
  // matching anywhere, one page-level empty state stands in for both.
  const projectsVisible  = matchedProjects.length > 0;
  const tabsVisible      = searching ? filteredRecordings.length > 0 : true;
  const noResultsAtAll   = searching && !projectsVisible && filteredRecordings.length === 0;
  const hasAnyDocuments  = recordings.length > 0 || midiProjects.length > 0;

  /**
   * The one line under the page title.
   *
   * Replaced a "Welcome back / Here's where you left off." greeting *and* a strip of three
   * stat pills (total duration, most-used key, count this week). None of the three was
   * actionable, none changed what the user did next, and together they pushed the library
   * itself below the fold on a laptop. A count of what's in the library is the only number
   * that earns a place directly under a heading that says "Library".
   */
  /**
   * The one document to offer back — whichever of the two libraries was touched last.
   *
   * Deliberately across *both* types rather than per-section: "where was I" has one answer,
   * and making the user compare a tab's timestamp against a project's to find it is the work
   * this is supposed to save. Resolved on `updatedAt`, not `createdAt` — the list below
   * already sorts by creation, so keying this off the same field would just restate row one.
   */
  const resumeTarget: { kind: 'tab'; rec: TabRecording } | { kind: 'project'; project: MidiProject } | null = (() => {
    const newestRec  = recordings.reduce<TabRecording | null>((best, r) => (!best || r.updatedAt > best.updatedAt ? r : best), null);
    const newestProj = midiProjects.reduce<MidiProject | null>((best, p) => (!best || p.updatedAt > best.updatedAt ? p : best), null);
    if (newestProj && (!newestRec || newestProj.updatedAt > newestRec.updatedAt)) return { kind: 'project', project: newestProj };
    if (newestRec) return { kind: 'tab', rec: newestRec };
    return null;
  })();

  const resultCount = matchedProjects.length + filteredRecordings.length;
  const librarySummary = searching
    ? `${resultCount} result${resultCount === 1 ? '' : 's'} for “${librarySearch.trim()}”`
    : recordings.length === 0 && midiProjects.length === 0
    ? 'Nothing saved yet.'
    : [
        `${recordings.length} tab${recordings.length === 1 ? '' : 's'}`,
        midiProjects.length > 0
          ? `${midiProjects.length} MIDI project${midiProjects.length === 1 ? '' : 's'}`
          : null,
      ].filter(Boolean).join('  ·  ');


  return (
    <SafeAreaView style={styles.safe}>
      <RatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onUpgrade={() => router.push('/paywall')}
      />
      <View style={[
        styles.container,
        Platform.OS === 'web' && styles.containerFlush,
      ]}>

        {/* Header — TopBar covers logo/gear on web; on web the hero banner below carries
            the headline instead of a plain subtitle line. */}
        {Platform.OS !== 'web' && (
          <View style={styles.header}>
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
            <Text style={styles.subtitle}>Pick a key to start recording.</Text>
          </View>
        )}

        {Platform.OS === 'web' ? (
          /**
           * One shell, always — sidebar plus a scrolling library column, whether or not
           * anything is saved yet.
           *
           * This used to branch on `recordings.length === 0` into two entirely different
           * pages: a full-bleed marketing hero with three 240px action cards, or this
           * dashboard. The cost was that saving a first recording silently reorganised the
           * whole screen — every entry point changed position, shape, size and colour at
           * exactly the moment a new user was least able to absorb it. One layout is worth
           * more than a better first-visit page, so the hero is gone and the empty library
           * is just this column with nothing in it.
           */
          <View style={styles.dashboardShell}>
            <AppSidebar />
            <ScrollView
              style={styles.dashboardMainScroll}
              contentContainerStyle={styles.dashboardMainScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* The library *is* the page, so it gets the page title. What was here before
                  was "Welcome back / Here's where you left off." at 26px — the largest text
                  on the screen, carrying no information — over an 11px muted label that was
                  the only thing naming the actual content. */}
              <View style={styles.pageHeader}>
                <View style={styles.pageHeaderText}>
                  <Text style={styles.pageTitle}>Library</Text>
                  <Text style={styles.pageSubtitle}>{librarySummary}</Text>
                </View>

                {hasAnyDocuments && (
                  <View style={styles.searchBox}>
                    <Ionicons name="search" size={15} color={theme.textMuted} />
                    <TextInput
                      value={librarySearch}
                      onChangeText={setLibrarySearch}
                      placeholder="Search library..."
                      placeholderTextColor={theme.textMuted}
                      style={styles.searchInput}
                      accessibilityLabel="Search tabs and MIDI projects"
                    />
                    {/* A page-level search you can't get out of in one click is a trap —
                        clearing it by selecting and deleting is fine for a toolbar filter,
                        not for the control that governs the whole page. */}
                    {searching && (
                      <Pressable
                        onPress={() => setLibrarySearch('')}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                      >
                        <Ionicons name="close-circle" size={15} color={theme.textMuted} />
                      </Pressable>
                    )}
                  </View>
                )}
              </View>

              {/* Where you were, offered back.
                  Top of the column rather than filling the empty space at the bottom: this
                  is the first thing worth acting on, and a "continue" affordance below a
                  list you've already had to scan is a "continue" affordance that arrives
                  too late to save anyone anything. */}
              {resumeTarget && !searching && (
                <Pressable
                  onPress={() => {
                    if (resumeTarget.kind === 'tab') handleOpenRecording(resumeTarget.rec);
                    else router.push({ pathname: '/studio', params: { projectId: resumeTarget.project.id } });
                  }}
                  style={({ hovered }: any) => [styles.resumeBand, hovered && styles.resumeBandHovered]}
                  accessibilityRole="button"
                  accessibilityLabel={`Resume ${resumeTarget.kind === 'tab' ? resumeTarget.rec.title : resumeTarget.project.title}`}
                >
                  <View style={styles.resumeIconWrap}>
                    <Ionicons
                      name={resumeTarget.kind === 'tab' ? 'musical-notes-outline' : 'layers-outline'}
                      size={18}
                      color={theme.accent}
                    />
                  </View>
                  <View style={styles.resumeText}>
                    <Text style={styles.resumeLabel}>Continue working</Text>
                    <Text style={styles.resumeTitle} numberOfLines={1}>
                      {resumeTarget.kind === 'tab' ? resumeTarget.rec.title : resumeTarget.project.title}
                      <Text style={styles.resumeStamp}>
                        {'   '}edited {timeAgo(resumeTarget.kind === 'tab' ? resumeTarget.rec.updatedAt : resumeTarget.project.updatedAt)}
                      </Text>
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward" size={16} color={theme.accent} />
                </Pressable>
              )}

              {/* Projects sit above recordings because they're upstream of them: a
                  project is what a tab gets converted *out of*, so finding one is how you
                  get back to editing the source rather than the result. */}
              {projectsVisible && (
                <View style={[styles.section, styles.sectionElevated]}>
                  {/* Same toolbar shape as Harmonica Tabs below — label left, controls
                      right. The projects list stopped being a handful of cards you take in
                      at a glance, and a section you have to scan needs the same ordering
                      and density controls as the one under it. No key filter: a project
                      has no harmonica key until a track is converted. */}
                  <View style={styles.libraryToolbar}>
                    {/* Named for what the section holds, not for the editor that opens it. */}
                    <Text style={styles.sectionLabel}>
                      MIDI Projects · {matchedProjects.length}
                    </Text>

                    <View style={styles.libraryToolbarRight}>
                      <FilterDropdown
                        pillPrefix="Sort: "
                        value={projectSort}
                        options={PROJECT_SORT_OPTIONS}
                        onSelect={(v) => setProjectSort(v as ProjectSortOption)}
                        theme={theme}
                        styles={styles}
                      />

                      <View style={styles.viewToggle}>
                        <Pressable
                          onPress={() => setProjectView('list')}
                          style={[styles.viewToggleSeg, projectView === 'list' && styles.viewToggleSegActive]}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: projectView === 'list' }}
                          accessibilityLabel="Project list view"
                        >
                          <Ionicons name="list-outline" size={14} color={projectView === 'list' ? '#fff' : theme.textSub} />
                        </Pressable>
                        <Pressable
                          onPress={() => setProjectView('grid')}
                          style={[styles.viewToggleSeg, projectView === 'grid' && styles.viewToggleSegActive]}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: projectView === 'grid' }}
                          accessibilityLabel="Project grid view"
                        >
                          <Ionicons name="grid-outline" size={14} color={projectView === 'grid' ? '#fff' : theme.textSub} />
                        </Pressable>
                      </View>
                    </View>
                  </View>

                  {/* The only place on this screen that says what makes a project a
                      different kind of thing from a tab. */}
                  <Text style={styles.sectionSubtitle}>
                    Multi-track source — convert a track to tabs
                  </Text>
                  <View style={projectView === 'grid' ? styles.projectGrid : styles.projectList}>
                    {matchedProjects.map((project) => (
                      <View
                        key={project.id}
                        style={projectView === 'grid'
                          ? [styles.projectGridItem, { flexBasis: projectColumnBasis }]
                          : undefined}
                      >
                        <ProjectCard
                          project={project}
                          onOpen={() => router.push({ pathname: '/studio', params: { projectId: project.id } })}
                          onDelete={() => deleteProject(project.id)}
                          theme={theme}
                          styles={styles}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {tabsVisible && (
              <View style={[styles.section, styles.dashboardLibrary]}>
                {/* Search/filter/sort/view over an empty library is four controls that can
                    only ever return nothing — so the toolbar arrives with the content. */}
                {recordings.length > 0 ? (
                  <View style={styles.libraryToolbar}>
                    <Text style={styles.sectionLabel}>
                      Harmonica Tabs · {filteredRecordings.length}
                    </Text>

                    <View style={styles.libraryToolbarRight}>
                      <FilterDropdown
                        value={libraryKeyFilter}
                        options={keyFilterOptions}
                        onSelect={(v) => setLibraryKeyFilter(v as 'all' | HarmonicaKey)}
                        theme={theme}
                        styles={styles}
                      />

                      <FilterDropdown
                        pillPrefix="Sort: "
                        value={librarySort}
                        options={SORT_OPTIONS}
                        onSelect={(v) => setLibrarySort(v as SortOption)}
                        theme={theme}
                        styles={styles}
                      />

                      <View style={styles.viewToggle}>
                        <Pressable
                          onPress={() => setLibraryView('list')}
                          style={[styles.viewToggleSeg, libraryView === 'list' && styles.viewToggleSegActive]}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: libraryView === 'list' }}
                          accessibilityLabel="List view"
                        >
                          <Ionicons name="list-outline" size={14} color={libraryView === 'list' ? '#fff' : theme.textSub} />
                        </Pressable>
                        <Pressable
                          onPress={() => setLibraryView('grid')}
                          style={[styles.viewToggleSeg, libraryView === 'grid' && styles.viewToggleSegActive]}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: libraryView === 'grid' }}
                          accessibilityLabel="Grid view"
                        >
                          <Ionicons name="grid-outline" size={14} color={libraryView === 'grid' ? '#fff' : theme.textSub} />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.sectionLabel}>Harmonica Tabs</Text>
                )}

                {filteredRecordings.length > 0 ? (
                  <View style={libraryView === 'grid' ? styles.recordingsGrid : styles.recordingsList}>
                    {filteredRecordings.map((recording) => (
                      <View key={recording.id} style={libraryView === 'grid' ? styles.recordingsGridItem : undefined}>
                        <RecordingCard
                          recording={recording}
                          onPress={handleOpenRecording}
                          onDelete={deleteRecording}
                          onRename={renameRecording}
                          onToggleFavorite={toggleFavorite}
                          isPlaying={previewId === recording.id && preview.isPlaying}
                          onTogglePlay={handleTogglePreview}
                        />
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.recordingsEmpty}>
                    <Ionicons
                      name={libraryFiltersActive ? 'search-outline' : 'file-tray-outline'}
                      size={26}
                      color={theme.textMuted}
                    />
                    <Text style={styles.recordingsEmptyTitle}>
                      {libraryFiltersActive ? 'No matching tabs' : 'No tabs yet'}
                    </Text>
                    {/* Points at the rail rather than repeating its buttons. The rail is
                        now always on screen, which is the reason the empty state no longer
                        has to carry its own copy of the entry points. */}
                    <Text style={styles.recordingsEmptyText}>
                      {libraryFiltersActive
                        ? 'Try a different search term or key filter.'
                        : 'Start a recording, or upload an audio or MIDI file — the actions are in the panel on the left.'}
                    </Text>
                  </View>
                )}
              </View>
              )}

              {/* One empty state for the whole page, standing in for the two section-level
                  ones that were hidden. */}
              {noResultsAtAll && (
                <View style={styles.recordingsEmpty}>
                  <Ionicons name="search-outline" size={26} color={theme.textMuted} />
                  <Text style={styles.recordingsEmptyTitle}>No results</Text>
                  <Text style={styles.recordingsEmptyText}>
                    Nothing in your tabs or MIDI projects matches “{librarySearch.trim()}”.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        ) : (
          <>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {orderedRecordings.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Harmonica Tabs</Text>
                  <View style={styles.recordingsList}>
                    {orderedRecordings.map((recording) => (
                      <RecordingCard
                        key={recording.id}
                        recording={recording}
                        onPress={handleOpenRecording}
                        onDelete={deleteRecording}
                        onRename={renameRecording}
                        onToggleFavorite={toggleFavorite}
                        isPlaying={previewId === recording.id && preview.isPlaying}
                        onTogglePlay={handleTogglePreview}
                      />
                    ))}
                  </View>
                </View>
              )}
              {harmonicaTypeSection}
              {keySection}
              {tipSection}
            </ScrollView>

            {/* Entry points */}
            <View style={styles.bottomActions}>
              {startAndUpload}
            </View>
          </>
        )}

      </View>
    </SafeAreaView>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    // No webMaxWidth cap here on purpose — Home is the one full-bleed, marketing-style
    // page (hero banner + library), not a readable-column utility screen like Settings/
    // Edit/Export, so it should actually use the width of a wide monitor instead of
    // floating in a centered 960px column with dead space on both sides.
    container: {
      flex:              1,
      width:             '100%',
      paddingHorizontal: Platform.OS === 'web' ? 40 : 24,
      paddingTop:        Platform.OS === 'web' ? WEB_SCREEN_PADDING_TOP : 36,
      paddingBottom:     Platform.OS === 'web' ? WEB_SCREEN_PADDING_BOTTOM : 24,
    },
    // The dashboard shell supplies its own padding per-side (flush sidebar, padded main
    // content) — the page-level padding above would just add unwanted margins around it.
    containerFlush: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
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
    // The projects section carries a `position:absolute` sort popover and is followed in
    // document order by the tabs section, so without its own stacking context the popover
    // opens *underneath* the tab cards. `libraryToolbar`'s zIndex can't fix that on its own:
    // it only orders things within this section's context, not between the two sections.
    // Higher than `libraryToolbar`'s 30 so the intent (projects above tabs) reads at a glance.
    sectionElevated: { zIndex: 40 } as ViewStyle,
    recordingsList: { gap: 10 },
    // Gutters as item padding plus a negative outer margin, not `gap`.
    //
    // `gap` and "three cards span exactly one tab card" can't both hold: with a 12px gap
    // the row is 3 × basis + 24px, so the basis has to be a third of the column *minus*
    // 8px — a calc() the style layer can't express. Pulling the row 6px wider than the
    // column and giving each item 6px of inner padding puts the outer card edges back on
    // the column edges, and leaves the basis a clean 1/3.
    projectGrid: {
      flexDirection:   'row',
      flexWrap:        'wrap',
      marginHorizontal: -6,
      rowGap:           12,
    },
    // `flexBasis` is supplied per-item (see `projectColumnBasis`) — it's the one part of
    // this that depends on the window width. Neither grow nor shrink: the basis *is* the
    // width, and letting the last row's items grow would stretch two cards across a row
    // sized for three.
    projectGridItem: {
      paddingHorizontal: 6,
      flexGrow:          0,
      flexShrink:        0,
      minWidth:          0,
    },
    // List view: the same cards, stacked full-width. Gap matches `recordingsList` (10, not
    // the grid's 12) so a project list and a tab list under it read as one rhythm.
    projectList: { gap: 10 },
    // Matched to RecordingCard — same surface, same radius, same border, same font sizes.
    // Projects are upstream of tabs, so a project card reading as the lesser object (it was
    // on `cardBg` at radius 10 with 12px type against the tab card's `surface`/14/15px) had
    // the relationship backwards.
    projectCard: {
      flexDirection: 'row',
      alignItems: 'center',
      // Fills whatever it's put in — a third of the row in grid view, the whole column in
      // list view. The card used to carry its own 300/240/360 basis-min-max, which is what
      // stopped a row of them from lining up with the full-width tab cards underneath.
      width: '100%',
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.cardBg,
      paddingRight: 6,
    },
    projectCardHovered: { backgroundColor: t.cardHover },
    projectCardMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
      minWidth: 0,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    // The tinted square RecordingCard puts its play control in, at the same radius —
    // so a row of the two reads as one grid rather than two conventions. Sized against the
    // card rather than against the glyph: at 34px it sat in an 88px card looking like a
    // bullet point, while the *shorter* recording card carried a 56px tile. At 62 it is now
    // the larger of the two, which suits a project being the upstream object; the glyph went
    // 22 → 28 with it, since scaling the tile alone just adds padding around the same mark.
    projectCardIconWrap: {
      width: 62,
      height: 62,
      borderRadius: RADIUS.sm,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    projectCardText: { flex: 1, minWidth: 0, gap: 3 },
    projectCardTitle: { fontFamily: Poppins.semiBold, fontSize: FONT.base, color: t.textPrimary },
    projectCardMeta: { fontFamily: Poppins.regular, fontSize: FONT.sm, color: t.textSub },
    projectCardStamp: { fontFamily: Poppins.regular, fontSize: FONT.xs, color: t.textMuted },
    projectCardDelete: {
      padding: 8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    recordingsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    recordingsGridItem: { flexBasis: 320, flexGrow: 1, minWidth: 280 },
    startAndUpload: { gap: 10 },

    // Library toolbar — label on the left, search/filter/sort/view-toggle cluster on the
    // right. Wraps onto its own row under the label on a narrower sidebar-shrunk viewport
    // rather than squeezing every control down to illegibility.
    libraryToolbar: {
      flexDirection:  'row',
      flexWrap:       'wrap',
      alignItems:     'center',
      justifyContent: 'space-between',
      gap:            12,
      // The key-filter/sort popovers are position:absolute descendants of this row —
      // as a flex item, this row needs its own explicit z-index (above the recordings
      // list/grid flex item that follows it) or the popovers stack under the cards
      // despite their own zIndex, since that only applies within this row's own context.
      zIndex:         30,
    } as ViewStyle,
    // Sits under a section label to say what the section's contents *are*, where the label
    // alone can only say what they're called.
    sectionSubtitle: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      // Negative, against the section's own 12px gap: this line belongs to the label
      // above it, not to the content below, and should sit tight under it.
      marginTop:  -6,
    },
    libraryToolbarRight: {
      flexDirection: 'row',
      alignItems:    'center',
      flexWrap:      'nowrap',
      flexShrink:    1,
      gap:           8,
    },
    searchBox: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               8,
      // `cardBg` + `railBorder`, like every other control on this page and on the rail.
      //
      // These were `surface` (#F4F4F5, a *warm* grey) on what is now a cool #F2F8FA ground:
      // near-identical in lightness, opposite in hue, so the field read as a smudge on the
      // page rather than as something you could type into. White gives it back its edge and
      // the accent hairline is what draws it.
      backgroundColor:   t.cardBg,
      borderWidth:       1,
      borderColor:       t.railBorder,
      borderRadius:      RADIUS.md,
      paddingHorizontal: 12,
      paddingVertical:   8,
      // Wider than it was in the toolbar — it governs the page now, not one section —
      // but still shrinkable and never growing, so it gives way on a narrow window
      // instead of pushing the title block around.
      width:             300,
      flexGrow:          0,
      flexShrink:        1,
      minWidth:          180,
    },
    searchInput: {
      flex:       1,
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textPrimary,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
    },

    filterDropdownAnchor: { position: 'relative' } as any,
    filterPill: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      backgroundColor:   t.cardBg,
      borderWidth:       1,
      borderColor:       t.railBorder,
      borderRadius:      RADIUS.md,
      paddingHorizontal: 12,
      paddingVertical:   8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    filterPillHovered: { borderColor: t.accent },
    filterPillText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub, maxWidth: 120 },
    filterDropdownPanel: {
      position:        'absolute',
      top:             '100%',
      left:            0,
      marginTop:       6,
      minWidth:        160,
      backgroundColor: t.cardBg,
      borderRadius:    RADIUS.md,
      borderWidth:     1,
      borderColor:     t.railBorder,
      padding:         6,
      gap:             2,
      zIndex:          20,
      ...(Platform.OS === 'web' ? { boxShadow: '0 12px 28px rgba(0,0,0,0.18)' } as any : null),
    } as any,
    filterOption: {
      paddingVertical:   8,
      paddingHorizontal: 10,
      borderRadius:      RADIUS.sm,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    filterOptionHovered: { backgroundColor: t.surfaceAlt },
    filterOptionActive:  { backgroundColor: t.accentSoft },
    filterOptionText:       { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textSub },
    filterOptionTextActive: { fontFamily: Poppins.semiBold, color: t.accent },

    viewToggle: {
      flexDirection:   'row',
      backgroundColor: t.cardBg,
      borderWidth:     1,
      borderColor:     t.railBorder,
      borderRadius:    RADIUS.md,
      padding:         3,
      gap:             2,
    },
    viewToggleSeg: {
      width:            30,
      height:           28,
      alignItems:       'center',
      justifyContent:   'center',
      borderRadius:     RADIUS.sm,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    viewToggleSegActive: { backgroundColor: t.accent },

    // Dashboard shell — sidebar (`AppSidebar`) and main content as direct flex-row
    // siblings, neither one wrapped in the page ScrollView. That's what makes the sidebar
    // genuinely full page height (it stretches to match dashboardShell's own height, which
    // is the full viewport height via the flex:1 chain from `safe`/`container`) instead of
    // just being as tall as its own content — only dashboardMainScroll scrolls internally.
    dashboardShell: { flexDirection: 'row', flex: 1 },
    // The tinted half of the shell. The rail is plain and the library is washed, which is
    // the inverse of how it started — see `railBg` in the theme. Practically it also gives
    // the white `cardBg` rows something to sit on: on a white page they were held by their
    // border alone.
    dashboardMainScroll: { flex: 1, backgroundColor: t.libraryBg },
    dashboardMainScrollContent: {
      paddingHorizontal: 40,
      paddingTop:        WEB_SCREEN_PADDING_TOP,
      paddingBottom:     WEB_SCREEN_PADDING_BOTTOM,
      gap:               24,
    },
    dashboardLibrary: { marginTop: 0 },
    // Title block and the page-scoped search on one line. Wraps rather than crushing the
    // field on a narrow window.
    pageHeader: {
      flexDirection:  'row',
      flexWrap:       'wrap',
      alignItems:     'center',
      justifyContent: 'space-between',
      gap:            16,
    },
    pageHeaderText: { gap: 2, flexShrink: 1, minWidth: 0 },
    // Accent-tinted rather than another neutral card: this is the one row on the page that
    // is a shortcut rather than a listing, and it should not read as the first item of the
    // library underneath it.
    resumeBand: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               14,
      paddingVertical:   14,
      paddingHorizontal: 16,
      borderRadius:      RADIUS.md,
      backgroundColor:   t.accentSoft,
      borderWidth:       1,
      borderColor:       t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    resumeBandHovered: { borderColor: t.accentDim, backgroundColor: t.cardHover },
    resumeIconWrap: {
      width: 38, height: 38, borderRadius: RADIUS.sm,
      backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center',
    },
    resumeText:  { flex: 1, minWidth: 0, gap: 2 },
    resumeLabel: { ...GROUP_LABEL, color: t.accentDeep },
    resumeTitle: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.textPrimary },
    resumeStamp: { fontSize: FONT.xs, fontFamily: Poppins.regular, color: t.textMuted },
    pageTitle: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.3,
    },
    pageSubtitle: { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted },

    recordingsEmpty: {
      alignItems:        'center',
      justifyContent:    'center',
      gap:               8,
      borderRadius:      RADIUS.lg,
      borderWidth:       1,
      borderStyle:       'dashed',
      borderColor:       t.border,
      paddingVertical:   56,
      paddingHorizontal: 24,
    },
    recordingsEmptyTitle: { fontSize: FONT.md, fontFamily: Poppins.bold, color: t.textPrimary },
    recordingsEmptyText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
      maxWidth:   320,
    },
    segmented: {
      flexDirection:   'row',
      backgroundColor: t.surfaceAlt,
      borderRadius:    RADIUS.md,
      padding:         3,
    },
    segment: {
      flex:            1,
      paddingVertical: 10,
      alignItems:      'center',
      borderRadius:    RADIUS.sm,
    },
    segmentActive:    { backgroundColor: t.accent },
    segmentText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    segmentTextActive: { color: '#fff' },

    // One treatment, one rank. There used to be three of these — `sectionLabel` (ls 1.4),
    // `libraryToolbarLabel` (ls 1.2) and the sidebar's own (ls 1.0) — differing by amounts
    // too small to be deliberate and too visible to be nothing.
    sectionLabel: {
      ...SECTION_HEADING,
      color: t.textPrimary,
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
      borderRadius: RADIUS.md,
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
      borderRadius:      RADIUS.md,
      paddingVertical:   12,
      borderWidth:       1,
      borderColor:       t.border,
    },
    // Only the MIDI button is inert now, so the dimming that used to be baked into
    // uploadBtn moved here.
    uploadBtnDisabled: { opacity: 0.6 },
    uploadBtnPressed:  { backgroundColor: t.surfaceAlt, borderColor: t.accent },
    uploadBtnText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textMuted,
    },
    uploadBtnTextEnabled: { color: t.textPrimary },
    uploadError: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           6,
      paddingHorizontal: 10,
      paddingVertical:   8,
      borderRadius:      RADIUS.md,
      backgroundColor:   t.warningSoft,
    },
    uploadErrorText: {
      flex:       1,
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textSub,
    },
  });
}
