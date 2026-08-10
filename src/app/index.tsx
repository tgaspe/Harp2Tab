import { KeyGrid } from '@/components/KeyGrid';
import { RatingModal } from '@/components/RatingModal';
import { RecordingCard } from '@/components/RecordingCard';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT, HARMONICA_KEYS } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import { usePlayback } from '@/hooks/usePlayback';
import { selectHarmonicaType, selectKey, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { computeEffectiveLimit, resolveSessionGate } from '@/store/sessionGate';
import { AudioImportError } from '@/audio/audioImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { pickMidiFile } from '@/audio/pickMidiFile';
import { setPendingImport } from '@/audio/pendingImport';
import { selectRecordings, useRecordingsStore } from '@/store/useRecordingsStore';
import { selectMidiProjects, useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { createProject } from '@/audio/midiProject';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabRecording } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';

type SortOption = 'recent' | 'oldest' | 'title' | 'longest';
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'recent',  label: 'Most recent' },
  { value: 'oldest',  label: 'Oldest first' },
  { value: 'title',   label: 'Title (A–Z)' },
  { value: 'longest', label: 'Longest' },
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

// `layout="row"` is the sidebar's compact icon-and-two-line-stack form — used for the
// dashboard's secondary/glanceable stats, which shouldn't be as visually loud as the
// primary "column" tile form (kept around in case a future full-width band needs it).
/**
 * One library stat, as a chip in the dashboard header's stat strip.
 *
 * Replaced a two-layout `StatTile` that existed to sit in the left rail. The rail was the
 * wrong home for these: it is otherwise entirely actions, and a stat wedged under them was
 * both the least glanceable thing on the panel and the first thing a short viewport cut
 * off. Up beside the greeting they're read on arrival, which is when a "here's where you
 * left off" number is worth anything.
 *
 * Value and label sit on one line rather than stacked, so the strip stays one row tall and
 * reads as a sentence fragment ("3h 42m transcribed") instead of a card.
 */
function StatPill({ icon, value, label, styles, theme }: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
}) {
  return (
    <View style={styles.statPill}>
      <Ionicons name={icon} size={14} color={theme.accent} />
      <Text style={styles.statPillValue}>{value}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
    </View>
  );
}

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
  // Web-only: the key/type picker lives behind the "New Recording" action's chevron
  // instead of always being on-screen. Shared between the hero (empty-library / first
  // visit) and the compact dashboard header (returning user) below — only one of those
  // two ever renders at a time, so one flag covers both.
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const effectiveLimit = computeEffectiveLimit(ratingStatus);

  function handleStart() {
    if (!selectedKey) return;
    const gate = resolveSessionGate({ isPurchased, totalRecordingsUsed, ratingStatus });
    if (gate === 'showRating') { setShowRatingModal(true); return; }
    if (gate === 'showPaywall') { router.push('/paywall'); return; }
    startRecording();
    router.push('/recording');
  }

  // Same shape as handleStart — the free-tier gate has to come first for every "start a
  // new session" entry point, not just recording. The file dialog is opened here (inside
  // the press handler) rather than on the import screen because browsers only allow it
  // during a real user gesture.
  async function handleUploadAudio() {
    if (!selectedKey) return;
    const gate = resolveSessionGate({ isPurchased, totalRecordingsUsed, ratingStatus });
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
    const gate = resolveSessionGate({ isPurchased, totalRecordingsUsed, ratingStatus });
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

  if (!hasCompletedOnboarding) return null;

  // Shared across the web hero dropdown and the native single-column layout below — the
  // markup is identical, only where each piece lands in the page differs per platform.
  const harmonicaTypeSection = (
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
  );

  const keySection = (
    <View style={[styles.section, Platform.OS !== 'web' && { marginTop: 16 }]}>
      <Text style={styles.sectionLabel}>HARMONICA KEY</Text>
      <KeyGrid
        selected={selectedKey}
        onSelect={(k: HarmonicaKey) => selectKey_(k)}
      />
    </View>
  );

  // Sidebar-only — plain selectable rows instead of the pill-shaped segmented control
  // `harmonicaTypeSection` uses elsewhere (hero, native). Same underlying state/handler.
  const sidebarTypeSection = (
    <View style={styles.section}>
      <Text style={styles.sidebarSectionLabel}>HARMONICA TYPE</Text>
      {(['diatonic', 'chromatic'] as HarmonicaType[]).map((type) => {
        const active = harmonicaType === type;
        return (
          <Pressable
            key={type}
            onPress={() => setHarmonicaType(type)}
            style={({ hovered }: any) => [
              styles.sidebarTypeRow,
              active && styles.sidebarTypeRowActive,
              hovered && !active && styles.sidebarTypeRowHovered,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
          >
            <Text style={[styles.sidebarTypeRowText, active && styles.sidebarTypeRowTextActive]}>
              {type === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
            </Text>
            {active && <Ionicons name="checkmark" size={14} color="#fff" />}
          </Pressable>
        );
      })}
    </View>
  );

  // Sidebar-only key grid — same onAccent treatment as the type rows above, sitting
  // straight on the blue panel instead of in a white card.
  const sidebarKeySection = (
    <View style={[styles.section, { marginTop: 12 }]}>
      <Text style={styles.sidebarSectionLabel}>HARMONICA KEY</Text>
      <KeyGrid
        selected={selectedKey}
        onSelect={(k: HarmonicaKey) => selectKey_(k)}
        onAccent
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

  const freeCounterLabel = !isPurchased
    ? `${Math.min(totalRecordingsUsed, effectiveLimit)} / ${effectiveLimit} free recordings used`
    : null;

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

  const librarySearchTrimmed = librarySearch.trim().toLowerCase();
  const filteredRecordings = recordings
    .filter((r) => libraryKeyFilter === 'all' || r.key === libraryKeyFilter)
    .filter((r) => librarySearchTrimmed === '' || r.title.toLowerCase().includes(librarySearchTrimmed))
    .sort((a, b) => {
      switch (librarySort) {
        case 'recent':  return b.createdAt - a.createdAt;
        case 'oldest':  return a.createdAt - b.createdAt;
        case 'title':   return a.title.localeCompare(b.title);
        case 'longest': return b.duration - a.duration;
      }
    });
  const libraryFiltersActive = libraryKeyFilter !== 'all' || librarySearchTrimmed !== '';

  // Sidebar stats (web, returning users only) — computed from the same recordings array as
  // the list, not tracked separately.
  //
  // These replaced a raw recording count (already printed in the section header a few inches
  // to the right) and a total note count (a number with no scale to read it against). Each
  // one here answers a question instead: how much have I done, which harp do I actually
  // reach for, and — the only figure on the panel that can change today — what have I done
  // this week. All three come out of fields `TabRecording` already carries.
  const libraryStats = useMemo(() => {
    const totalMs = recordings.reduce((sum, r) => sum + r.duration, 0);

    const keyCounts = new Map<HarmonicaKey, number>();
    for (const r of recordings) keyCounts.set(r.key, (keyCounts.get(r.key) ?? 0) + 1);
    // Ties break on whichever key was seen first, which is insertion order — arbitrary but
    // stable, and a tie means there is no most-used key to be wrong about.
    let topKey: HarmonicaKey | null = null;
    let topCount = 0;
    for (const [key, count] of keyCounts) {
      if (count > topCount) { topKey = key; topCount = count; }
    }

    const weekAgo   = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeek  = recordings.filter((r) => r.createdAt >= weekAgo).length;

    return { totalMs, topKey, topCount, thisWeek };
  }, [recordings]);

  /** Sidebar-width duration: "3h 42m" / "42m" / "48s". Never zero-padded — this is a
   *  headline figure, not a timecode. */
  function totalDurationLabel(ms: number): string {
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 1) return `${Math.round(ms / 1000)}s`;
    const hours   = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  // Split button (main = start with current selection, chevron = open the key/type
  // dropdown) — shared markup between the hero's larger card version and the dashboard
  // header's compact version below, just with different wrapping styles per caller.
  // Hero-only now — the sidebar shows the key/type picker permanently instead of behind
  // this chevron (see the sidebar's own inline picker below).
  const splitButton = (mainStyle: object, chevronStyle: object, textStyle: object, dotSize: number) => (
    <View style={styles.splitBtnAnchor}>
      <View style={styles.splitBtnRow}>
        <Pressable
          onPress={handleStart}
          disabled={!selectedKey}
          style={({ pressed, hovered }: any) => [
            mainStyle,
            !selectedKey && styles.splitBtnMainDisabled,
            (pressed || hovered) && !!selectedKey && styles.splitBtnMainPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Start Recording"
          accessibilityState={{ disabled: !selectedKey }}
        >
          <View style={[styles.recordDot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2 }]} />
          <Text style={[textStyle, !selectedKey && styles.splitBtnMainTextDisabled]}>
            Start Recording
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setPickerOpen((v) => !v)}
          style={({ pressed, hovered }: any) => [
            chevronStyle,
            (pressed || hovered) && styles.splitBtnChevronPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={pickerOpen ? 'Hide key & type picker' : 'Choose key & type'}
          accessibilityState={{ expanded: pickerOpen }}
        >
          <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={13} color="#fff" />
        </Pressable>
      </View>

      {pickerOpen && (
        <View style={styles.splitDropdown}>
          {harmonicaTypeSection}
          {keySection}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <RatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onUpgrade={() => router.push('/paywall')}
      />
      <View style={[
        styles.container,
        Platform.OS === 'web' && orderedRecordings.length > 0 && styles.containerFlush,
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
          orderedRecordings.length === 0 ? (
            // The marketing hero only earns its space for a genuinely new user with
            // nothing saved yet — a one-time activation pitch, not something a returning
            // user with a library should see on every visit.
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.webScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.hero}>
                <View style={styles.heroRow}>
                  <View style={styles.heroLeft}>
                    <View style={styles.heroBadge}>
                      <Ionicons name="sparkles-outline" size={12} color={theme.accent} />
                      <Text style={styles.heroBadgeText}>Your music. Transcribed.</Text>
                    </View>
                    <Text style={styles.heroTitle}>
                      Turn your harmonica into tabs, <Text style={styles.heroTitleAccent}>instantly.</Text>
                    </Text>
                    <Text style={styles.heroSubtitle}>
                      Record, upload, and let Harp2Tab detect the notes so you can focus on playing.
                    </Text>
                  </View>

                  <View style={styles.heroRight}>
                    <View style={styles.heroCard}>
                      <View style={styles.heroCardIconWrap}>
                        <Ionicons name="mic-outline" size={20} color={theme.accent} />
                      </View>
                      <Text style={styles.heroCardTitle}>New Recording</Text>
                      <Text style={styles.heroCardDesc}>Record audio from your microphone</Text>

                      {splitButton(styles.splitBtnMain, styles.splitBtnChevron, styles.splitBtnMainText, 7)}

                      {freeCounterLabel && (
                        <Text style={styles.heroCardCounter}>{freeCounterLabel}</Text>
                      )}
                    </View>

                    <View style={styles.heroCardOutlined}>
                      <View style={styles.heroCardIconWrapMuted}>
                        <Ionicons name="cloud-upload-outline" size={20} color={theme.textSub} />
                      </View>
                      <Text style={styles.heroCardTitle}>Upload Audio</Text>
                      <Text style={styles.heroCardDesc}>Upload a file and get your tabs in seconds</Text>
                      <Pressable
                        onPress={handleUploadAudio}
                        disabled={!selectedKey}
                        style={({ pressed, hovered }: any) => [
                          styles.chooseFileBtn,
                          !selectedKey && styles.chooseFileBtnDisabled,
                          (pressed || hovered) && !!selectedKey && styles.chooseFileBtnPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Choose audio file"
                        accessibilityState={{ disabled: !selectedKey }}
                      >
                        <Text style={styles.chooseFileBtnText}>Choose File</Text>
                      </Pressable>
                      <Text style={styles.uploadHint}>Supports .wav, .mp3, .m4a</Text>
                    </View>

                    {/* Third entry point: MIDI already states its pitches and timings, so
                        this one converts rather than transcribes — a different promise from
                        the audio card, and worth its own card rather than a second button. */}
                    <View style={styles.heroCardOutlined}>
                      <View style={styles.heroCardIconWrapMuted}>
                        <Ionicons name="musical-note-outline" size={20} color={theme.textSub} />
                      </View>
                      <Text style={styles.heroCardTitle}>Upload MIDI</Text>
                      <Text style={styles.heroCardDesc}>Convert a MIDI part into harmonica tabs</Text>
                      <Pressable
                        onPress={handleUploadMidi}
                        disabled={!selectedKey}
                        style={({ pressed, hovered }: any) => [
                          styles.chooseFileBtn,
                          !selectedKey && styles.chooseFileBtnDisabled,
                          (pressed || hovered) && !!selectedKey && styles.chooseFileBtnPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Choose MIDI file"
                        accessibilityState={{ disabled: !selectedKey }}
                      >
                        <Text style={styles.chooseFileBtnText}>Choose File</Text>
                      </Pressable>
                      <Text style={styles.uploadHint}>Supports .mid, .midi</Text>
                    </View>

                    {uploadErrorBanner}
                  </View>
                </View>
              </View>

              {/* Empty-state: nothing to manage yet, so no sidebar — just the hero above
                  and the empty-library prompt below, single column throughout. */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>HARMONICA TABS</Text>
                <View style={styles.recordingsEmpty}>
                  <Ionicons name="file-tray-outline" size={26} color={theme.textMuted} />
                  <Text style={styles.recordingsEmptyTitle}>No tabs yet</Text>
                  <Text style={styles.recordingsEmptyText}>
                    Record a new song or upload an audio/MIDI file to get started.
                  </Text>
                </View>
              </View>
            </ScrollView>
          ) : (
            // Left panel for quick actions + stats, full page height (not just as tall as
            // its own content) so it reads as a persistent panel rather than a card that
            // happens to sit next to the library — sits outside the ScrollView entirely;
            // only the library side scrolls, same app-shell pattern as GitHub/Linear/etc.
            <View style={styles.dashboardShell}>
              {/* The panel is the chrome and stays put; its *contents* scroll. Unscrollable,
                  the rail's content (label + 4 actions + key/type picker + free-tier
                  counter) overflows a short viewport with no way to reach the overflow, so
                  whatever sits last is simply unreachable. */}
              <View style={styles.fullSidebar}>
                <ScrollView
                  style={styles.sidebarScroll}
                  contentContainerStyle={styles.sidebarScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.sidebarSection}>
                    <Text style={styles.sidebarSectionLabel}>QUICK ACTIONS</Text>

                    <Pressable
                      onPress={handleUploadAudio}
                      disabled={!selectedKey}
                      style={({ pressed, hovered }: any) => [
                        styles.sidebarRow,
                        !selectedKey && styles.sidebarRowDisabled,
                        (pressed || hovered) && !!selectedKey && styles.sidebarRowPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Upload audio file"
                      accessibilityState={{ disabled: !selectedKey }}
                    >
                      <View style={styles.sidebarRowIconWrap}>
                        <Ionicons name="cloud-upload-outline" size={16} color="rgba(255,255,255,0.85)" />
                      </View>
                      <Text style={styles.sidebarRowText}>Upload Audio</Text>
                    </Pressable>

                    <Pressable
                      onPress={handleUploadMidi}
                      disabled={!selectedKey}
                      style={({ pressed, hovered }: any) => [
                        styles.sidebarRow,
                        !selectedKey && styles.sidebarRowDisabled,
                        (pressed || hovered) && !!selectedKey && styles.sidebarRowPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Upload MIDI file"
                      accessibilityState={{ disabled: !selectedKey }}
                    >
                      <View style={styles.sidebarRowIconWrap}>
                        <Ionicons name="musical-note-outline" size={16} color="rgba(255,255,255,0.85)" />
                      </View>
                      <Text style={styles.sidebarRowText}>Upload MIDI</Text>
                    </Pressable>

                    {/* Not gated on a harmonica key, unlike the three above it: a blank
                        Studio project has no harmonica yet — the key is chosen at
                        conversion, which is where a tab actually gets produced. */}
                    <Pressable
                      onPress={handleNewProject}
                      style={({ pressed, hovered }: any) => [
                        styles.sidebarRow,
                        (pressed || hovered) && styles.sidebarRowPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="New MIDI Studio project"
                    >
                      {/* `add-circle-outline`, matching the empty-state hero's version of this
                          same button. `options-outline` — a sliders glyph — read as
                          "preferences" here; it stays the Studio's *identity* mark on the
                          project card and on "Open in Studio", where it isn't a create action. */}
                      <View style={styles.sidebarRowIconWrap}>
                        <Ionicons name="add-circle-outline" size={16} color="rgba(255,255,255,0.85)" />
                      </View>
                      <Text style={styles.sidebarRowText}>New MIDI Project</Text>
                    </Pressable>

                    {uploadErrorBanner}

                    <Pressable
                      onPress={handleStart}
                      disabled={!selectedKey}
                      style={({ pressed, hovered }: any) => [
                        styles.sidebarRow,
                        styles.sidebarRowPrimary,
                        !selectedKey && styles.sidebarRowDisabled,
                        (pressed || hovered) && !!selectedKey && styles.sidebarRowPrimaryPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Start Recording"
                      accessibilityState={{ disabled: !selectedKey }}
                    >
                      <View style={styles.sidebarRowIconWrap}>
                        <View style={styles.recordDot} />
                      </View>
                      <Text style={[styles.sidebarRowText, styles.sidebarRowTextPrimary]}>Start Recording</Text>
                    </Pressable>

                    {/* Permanent, not behind a chevron — the key/type picker is part of the
                        panel's normal flow so it's always visible, not a toggle to discover.
                        No card wrapper — sits straight on the panel so the sidebar reads as
                        one homogeneous blue surface, not a blue frame around a white box. */}
                    <View style={styles.sidebarInlineDropdown}>
                      {sidebarTypeSection}
                      {sidebarKeySection}
                    </View>

                    {freeCounterLabel && (
                      <Text style={styles.dashboardCounter}>{freeCounterLabel}</Text>
                    )}
                  </View>
                </ScrollView>
              </View>

              <ScrollView
                style={styles.dashboardMainScroll}
                contentContainerStyle={styles.dashboardMainScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.dashboardTitle}>Welcome back</Text>
                <Text style={styles.dashboardSubtitle}>Here's where you left off.</Text>

                {/* Scrolls away with the greeting it belongs to — this is page header, read
                    on arrival, not a persistent readout to browse the library against. */}
                {recordings.length > 0 && (
                  <View style={styles.statStrip}>
                    <StatPill
                      icon="time-outline"
                      value={totalDurationLabel(libraryStats.totalMs)}
                      label="transcribed"
                      styles={styles} theme={theme}
                    />
                    {/* Only meaningful once there's something to be most-used: with one
                        recording every key is the top key, which says nothing. */}
                    {libraryStats.topKey && recordings.length > 1 && (
                      <StatPill
                        icon="musical-note-outline"
                        value={libraryStats.topKey}
                        label="most-used key"
                        styles={styles} theme={theme}
                      />
                    )}
                    <StatPill
                      icon="calendar-outline"
                      value={String(libraryStats.thisWeek)}
                      label="this week"
                      styles={styles} theme={theme}
                    />
                  </View>
                )}

                {/* Projects sit above recordings because they're upstream of them: a
                    project is what a tab gets converted *out of*, so finding one is how you
                    get back to editing the source rather than the result. */}
                {midiProjects.length > 0 && (
                  <View style={styles.section}>
                    {/* Named for what the section holds, not for the editor that opens it —
                        and the subtitle is the only place on this screen that says what
                        makes a project a different kind of thing from a tab. */}
                    <Text style={styles.libraryToolbarLabel}>
                      MIDI PROJECTS · {midiProjects.length}
                    </Text>
                    <Text style={styles.sectionSubtitle}>
                      Multi-track source — convert a track to tabs
                    </Text>
                    <View style={styles.projectGrid}>
                      {midiProjects.map((project) => (
                        <View key={project.id} style={styles.projectCard}>
                          <Pressable
                            style={styles.projectCardMain}
                            onPress={() => router.push({ pathname: '/studio', params: { projectId: project.id } })}
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${project.title} in the MIDI Studio`}
                          >
                            <Ionicons name="options-outline" size={16} color={theme.accent} />
                            <View style={styles.projectCardText}>
                              <Text style={styles.projectCardTitle} numberOfLines={1}>{project.title}</Text>
                              <Text style={styles.projectCardMeta} numberOfLines={1}>
                                {project.tracks.length} track{project.tracks.length === 1 ? '' : 's'}
                                {' · '}
                                {project.tracks.reduce((n, t) => n + t.notes.length, 0)} notes
                              </Text>
                            </View>
                          </Pressable>
                          <Pressable
                            onPress={() => deleteProject(project.id)}
                            style={styles.projectCardDelete}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete project ${project.title}`}
                          >
                            <Ionicons name="trash-outline" size={14} color={theme.textMuted} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                <View style={[styles.section, styles.dashboardLibrary]}>
                  <View style={styles.libraryToolbar}>
                      <Text style={styles.libraryToolbarLabel}>
                        HARMONICA TABS · {recordings.length}
                      </Text>

                      <View style={styles.libraryToolbarRight}>
                        <View style={styles.searchBox}>
                          <Ionicons name="search" size={14} color={theme.textMuted} />
                          <TextInput
                            value={librarySearch}
                            onChangeText={setLibrarySearch}
                            placeholder="Search tabs..."
                            placeholderTextColor={theme.textMuted}
                            style={styles.searchInput}
                            accessibilityLabel="Search recordings"
                          />
                        </View>

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
                        <Ionicons name="search-outline" size={26} color={theme.textMuted} />
                        <Text style={styles.recordingsEmptyTitle}>
                          {libraryFiltersActive ? 'No matching tabs' : 'No tabs yet'}
                        </Text>
                        <Text style={styles.recordingsEmptyText}>
                          {libraryFiltersActive
                            ? 'Try a different search term or key filter.'
                            : 'Record a new song or upload an audio/MIDI file to get started.'}
                        </Text>
                      </View>
                    )}
                  </View>
              </ScrollView>
            </View>
          )
        ) : (
          <>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {orderedRecordings.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>HARMONICA TABS</Text>
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
    recordingsList: { gap: 10 },
    projectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    projectCard: {
      flexDirection: 'row',
      alignItems: 'center',
      flexBasis: 280,
      flexGrow: 1,
      minWidth: 240,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.cardBg,
      paddingRight: 4,
    },
    projectCardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minWidth: 0 },
    projectCardText: { flex: 1, minWidth: 0 },
    projectCardTitle: { fontFamily: Poppins.bold, fontSize: 14, color: t.textPrimary },
    projectCardMeta: { fontFamily: SpaceGrotesk.regular, fontSize: 12, color: t.textMuted },
    projectCardDelete: { padding: 8 },
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
    libraryToolbarLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1.2,
    },
    // Sits under a section label to say what the section's contents *are*, where the label
    // alone can only say what they're called.
    sectionSubtitle: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      marginTop:  4,
    },
    libraryToolbarRight: {
      flexDirection: 'row',
      alignItems:    'center',
      flexWrap:      'wrap',
      gap:           8,
    },
    searchBox: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               8,
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
      borderRadius:      10,
      paddingHorizontal: 12,
      paddingVertical:   8,
      width:             200,
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
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
      borderRadius:      10,
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
      backgroundColor: t.surface,
      borderRadius:    12,
      borderWidth:     1,
      borderColor:     t.border,
      padding:         6,
      gap:             2,
      zIndex:          20,
      ...(Platform.OS === 'web' ? { boxShadow: '0 12px 28px rgba(0,0,0,0.18)' } as any : null),
    } as any,
    filterOption: {
      paddingVertical:   8,
      paddingHorizontal: 10,
      borderRadius:      8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    filterOptionHovered: { backgroundColor: t.surfaceAlt },
    filterOptionActive:  { backgroundColor: t.accentSoft },
    filterOptionText:       { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textSub },
    filterOptionTextActive: { fontFamily: Poppins.semiBold, color: t.accent },

    viewToggle: {
      flexDirection:   'row',
      backgroundColor: t.surface,
      borderWidth:     1,
      borderColor:     t.border,
      borderRadius:    10,
      padding:         3,
      gap:             2,
    },
    viewToggleSeg: {
      width:            30,
      height:           28,
      alignItems:       'center',
      justifyContent:   'center',
      borderRadius:     8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    viewToggleSegActive: { backgroundColor: t.accent },

    webScrollContent: { paddingBottom: 16, gap: 28 },

    // Hero banner — a soft accent-tinted gradient (web supports arbitrary CSS through
    // style, unlike native) fading into the page background, framing the headline and the
    // two entry-point cards.
    hero: {
      borderRadius: 24,
      padding:      32,
      borderWidth:  1,
      borderColor:  t.border,
      overflow:     'visible',
      ...(Platform.OS === 'web'
        ? { backgroundImage: `linear-gradient(135deg, ${t.accentSoft} 0%, ${t.bg} 75%)` } as any
        : { backgroundColor: t.surface }),
    },
    heroRow: {
      flexDirection: 'row',
      flexWrap:      'wrap',
      alignItems:    'center',
      gap:           32,
    },
    heroLeft: { flex: 1, minWidth: 280, gap: 16 },
    heroBadge: {
      flexDirection:     'row',
      alignItems:        'center',
      alignSelf:         'flex-start',
      gap:               6,
      backgroundColor:   t.accentSoft,
      borderRadius:      20,
      borderWidth:        1,
      borderColor:       t.accent,
      paddingHorizontal: 12,
      paddingVertical:   6,
    },
    heroBadgeText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.accent },
    heroTitle: {
      fontSize:      36,
      lineHeight:    42,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.5,
    },
    heroTitleAccent: { color: t.accent },
    heroSubtitle: {
      fontSize:   FONT.base,
      fontFamily: Poppins.regular,
      color:      t.textSub,
      lineHeight: 22,
      maxWidth:   420,
    },

    heroRight: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
    heroCard: {
      width:           240,
      borderRadius:    16,
      padding:         18,
      gap:             10,
      backgroundColor: t.accentSoft,
      borderWidth:     1,
      borderColor:     t.accent,
    },
    heroCardOutlined: {
      width:              240,
      borderRadius:       16,
      padding:            18,
      gap:                10,
      backgroundColor:    t.bg,
      borderWidth:        1.5,
      borderStyle:        'dashed',
      borderColor:        t.border,
    },
    heroCardIconWrap: {
      width:            40,
      height:           40,
      borderRadius:     20,
      backgroundColor:  t.bg,
      alignItems:       'center',
      justifyContent:   'center',
    },
    heroCardIconWrapMuted: {
      width:            40,
      height:           40,
      borderRadius:     20,
      backgroundColor:  t.surfaceAlt,
      alignItems:       'center',
      justifyContent:   'center',
    },
    heroCardTitle: { fontSize: FONT.md, fontFamily: Poppins.bold, color: t.textPrimary },
    heroCardDesc: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      lineHeight: 16,
    },
    heroCardCounter: {
      fontSize:   10,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
    },

    // Split button — main half starts recording with whatever's already selected, the
    // chevron half opens the picker dropdown below it without navigating away.
    splitBtnAnchor: { position: 'relative' } as any,
    splitBtnRow: { flexDirection: 'row', borderRadius: 10, overflow: 'hidden' },
    splitBtnMain: {
      flex:            1,
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      backgroundColor: t.accent,
      paddingVertical: 11,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    splitBtnMainDisabled: { backgroundColor: t.surfaceAlt },
    splitBtnMainPressed:  { backgroundColor: t.accentDim },
    splitBtnMainText:  { fontSize: FONT.sm, fontFamily: Poppins.bold, color: '#fff' },
    splitBtnMainTextDisabled: { color: t.textMuted },
    recordDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.record },
    splitBtnChevron: {
      width:            34,
      alignItems:       'center',
      justifyContent:   'center',
      backgroundColor:  t.accentDim,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    splitBtnChevronPressed: { opacity: 0.85 },

    splitDropdown: {
      position:        'absolute',
      top:             '100%',
      left:            0,
      right:           0,
      marginTop:       10,
      backgroundColor: t.surface,
      borderRadius:    14,
      borderWidth:     1,
      borderColor:     t.border,
      padding:         16,
      gap:             16,
      zIndex:          20,
      ...(Platform.OS === 'web' ? { boxShadow: '0 12px 28px rgba(0,0,0,0.18)' } as any : null),
    } as any,
    // No card here — sits straight on the accent panel (rows use their own onAccent
    // colors) so the whole sidebar reads as one homogeneous surface, not a blue frame
    // wrapped around a white box.
    sidebarInlineDropdown: { marginTop: 10, gap: 16 },

    // Dashboard shell — sidebar and main content as direct flex-row siblings, neither one
    // wrapped in the page ScrollView. That's what makes the sidebar genuinely full page
    // height (it stretches to match dashboardShell's own height, which is the full
    // viewport height via the flex:1 chain from `safe`/`container`) instead of just being
    // as tall as its own content — only dashboardMainScroll scrolls internally.
    dashboardShell: { flexDirection: 'row', flex: 1 },
    // Accent-filled, flush to the true viewport edges (no radius, no margin) — clearly its
    // own persistent region, not a card floating in the page. The white/near-black widget
    // cards inside (Reddit-sidebar-style: distinct titled blocks, no border, just a soft
    // shadow lifting them off the colored background) are what read as "division" from the
    // rest of the page, not a hairline.
    fullSidebar: {
      width:              300,
      flexShrink:         0,
      backgroundColor:    t.sidebarBg,
      // The literal top-to-bottom division line the color contrast alone wasn't enough of.
      // Dark mode inverts it: the rail is darker than the page there, so a black hairline
      // would blend into both sides instead of dividing them.
      borderRightWidth:   1,
      borderRightColor:   t.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)',
    },
    // The padding moved off `fullSidebar` and onto the scroll content so the panel's
    // background and its right-edge hairline still run the full height while only the
    // contents scroll. Still needed with the stats gone: the label, four action rows, the
    // key/type picker and the free-tier counter overflow a short viewport on their own.
    sidebarScroll:        { flex: 1 },
    sidebarScrollContent: { paddingHorizontal: 20, paddingVertical: 28 },
    dashboardMainScroll: { flex: 1 },
    dashboardMainScrollContent: {
      paddingHorizontal: 40,
      paddingTop:        WEB_SCREEN_PADDING_TOP,
      paddingBottom:     WEB_SCREEN_PADDING_BOTTOM,
      gap:               16,
    },
    dashboardLibrary: { marginTop: 8 },
    dashboardTitle: {
      fontSize:      FONT.xl,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      letterSpacing: -0.3,
    },
    dashboardSubtitle: { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted },

    // Plain row content directly on the accent panel — no card, no pill, no shadow.
    sidebarSection: { gap: 8 },
    sidebarSectionLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         '#fff',
      letterSpacing: 1,
      marginBottom:  6,
    },
    dashboardCounter: { fontSize: 10, fontFamily: Poppins.regular, color: 'rgba(255,255,255,0.65)', marginTop: 4 },

    sidebarRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               10,
      paddingVertical:   10,
      paddingHorizontal: 12,
      borderRadius:      10,
      backgroundColor:   'rgba(255,255,255,0.14)',
      borderWidth:       1,
      borderColor:       'rgba(255,255,255,0.22)',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    // Start Recording — the primary action, so it gets a solid white pill that pops off
    // the accent panel instead of the translucent chrome every other row uses.
    sidebarRowPrimary: {
      backgroundColor: '#fff',
      borderColor:     '#fff',
    },
    sidebarRowPrimaryPressed: { backgroundColor: t.accentSoft },
    sidebarRowPressed:  { backgroundColor: 'rgba(255,255,255,0.22)' },
    sidebarRowDisabled: { opacity: 0.55 },
    sidebarRowIconWrap: { width: 22, alignItems: 'center', justifyContent: 'center' },
    // Row-level opacity (sidebarRowDisabled) handles the disabled dimming — no separate
    // text-color override needed on top of it.
    sidebarRowText: { flex: 1, fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: '#fff' },
    // On the solid white pill (sidebarRowPrimary) — needs accentDeep, see editStyles.
    sidebarRowTextPrimary: { color: t.accentDeep },

    // The header's stat strip. `flexWrap` rather than a fixed row: three pills fit any
    // desktop width the dashboard layout appears at, but the strip shouldn't be the thing
    // that decides how narrow the window is allowed to get. No vertical margin — the
    // scroll container's own `gap: 16` spaces it off the greeting like every other block
    // in this column.
    statStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statPill: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingVertical:   7,
      paddingHorizontal: 12,
      borderRadius:      999,
      borderWidth:       1,
      borderColor:       t.border,
      backgroundColor:   t.surface,
    },
    statPillValue: { fontSize: FONT.sm, fontFamily: SpaceGrotesk.bold, color: t.textPrimary },
    statPillLabel: { fontSize: FONT.xs, fontFamily: Poppins.regular, color: t.textMuted },

    chooseFileBtn: {
      borderWidth:     1.5,
      borderColor:     t.accent,
      borderRadius:    10,
      paddingVertical: 10,
      alignItems:      'center',
    },
    chooseFileBtnPressed:  { backgroundColor: t.accentSoft },
    chooseFileBtnDisabled: { opacity: 0.6 },
    chooseFileBtnText: { fontSize: FONT.sm, fontFamily: Poppins.bold, color: t.accent },
    uploadHint: {
      fontSize:   10,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      textAlign:  'center',
    },

    recordingsEmpty: {
      alignItems:        'center',
      justifyContent:    'center',
      gap:               8,
      borderRadius:      14,
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

    // Sidebar-only alternative to the segmented pill above — plain selectable rows on the
    // inline dropdown's white card background.
    sidebarTypeRow: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'space-between',
      paddingVertical:   10,
      paddingHorizontal: 10,
      borderRadius:      8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    sidebarTypeRowActive:  { backgroundColor: 'rgba(255,255,255,0.18)' },
    sidebarTypeRowHovered: { backgroundColor: 'rgba(255,255,255,0.08)' },
    sidebarTypeRowText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      'rgba(255,255,255,0.85)',
    },
    sidebarTypeRowTextActive: { color: '#fff' },

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
      borderRadius:      10,
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
