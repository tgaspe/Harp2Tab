/**
 * The web app shell's left rail — quick actions plus the harmonica key/type picker.
 *
 * Lifted verbatim out of `index.tsx`'s dashboard, where it was inline, so a second screen
 * can mount the same rail without a copy of its markup, its four entry-point handlers, and
 * the free-tier gate each of them has to pass through. Home and `/profile` now render this
 * one component; anything else that grows a shell gets it for free.
 *
 * It owns its own state deliberately — the host screen is never asked to interpret a gate
 * result. What it no longer owns is the *logic*: the pick-and-import handlers moved to
 * `useUploadEntry` once Home's drop target became a third caller of the same sequence, and
 * the one part that must never drift between callers is the free-tier gate. The rail still
 * renders the rating modal, because the modal is one of the gate's two UI outcomes.
 *
 * Web-only chrome: callers gate on `Platform.OS === 'web'`, matching how the rail has always
 * been used. On native the entry points live in the bottom action bar instead.
 *
 * Visually it is a plain `railBg` panel, not the accent fill it started as — see
 * `fullSidebar` below for why. `/edit`'s rail followed on 2026-08-19 and now shares these
 * values; `theme.sidebarBg`, which was the accent fill both once used, is gone with it.
 */

import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { KeyGrid } from '@/components/KeyGrid';
import { RatingModal } from '@/components/RatingModal';
import { createProject } from '@/audio/midiProject';
import { Poppins } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { GROUP_LABEL, RADIUS } from '@/constants/ui';
import { useTheme } from '@/hooks/useTheme';
import { usePremium } from '@/hooks/usePremium';
import { useUploadEntry } from '@/hooks/useUploadEntry';
import { selectHarmonicaType, selectKey, useAppStore } from '@/store/useAppStore';
import { useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { computeEffectiveLimit } from '@/store/sessionGate';
import { FREE_TIER_ENABLED, useSettingsStore } from '@/store/useSettingsStore';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType } from '@/types';

export function AppSidebar() {
  const router = useRouter();
  const theme  = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const harmonicaType    = useAppStore(selectHarmonicaType);
  const setHarmonicaType = useAppStore((s) => s.setHarmonicaType);
  const selectedKey      = useAppStore(selectKey);
  const selectKey_       = useAppStore((s) => s.selectKey);
  const startRecording   = useAppStore((s) => s.startRecording);
  const saveProject      = useMidiProjectsStore((s) => s.saveProject);

  const totalRecordingsUsed = useSettingsStore((s) => s.totalRecordingsUsed);
  // Paid access, not the `isPurchased` latch (8-3) — a subscription can lapse.
  const { premium }         = usePremium();
  const ratingStatus        = useSettingsStore((s) => s.ratingStatus);
  const hasCompletedOnboarding = useSettingsStore((s) => s.hasCompletedOnboarding);

  // Shared with Home and with Home's drop target — see `useUploadEntry`. The rail owns the
  // rating modal it returns, same as it always did.
  const {
    uploadAudio,
    uploadMidi,
    checkGate,
    uploadError,
    showRatingModal,
    setShowRatingModal,
  } = useUploadEntry();

  // Open by default, collapsible.
  //
  // Shipping it collapsed left the rail as five rows above 500px of empty panel — the
  // picker was most of what gave the sidebar its body, and hiding it made the whole column
  // read as unfinished. It stays collapsible (the summary row above it says which harmonica
  // is selected, so folding it away loses nothing), it just doesn't start that way.
  const [pickerOpen, setPickerOpen] = useState(true);
  const effectiveLimit = computeEffectiveLimit(ratingStatus);

  function handleStart() {
    if (!selectedKey || !checkGate()) return;
    // Same first-recording calibration detour as Home's Record button — this rail is the
    // other way into a session, so it has to make the same stop. See `app.tsx:handleStart`.
    if (Platform.OS === 'web' && !hasCompletedOnboarding) {
      router.push({ pathname: '/onboarding', params: { next: 'recording' } });
      return;
    }
    startRecording();
    router.push('/recording');
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

  const freeCounterLabel = FREE_TIER_ENABLED && !premium
    ? `${Math.min(totalRecordingsUsed, effectiveLimit)} / ${effectiveLimit} free recordings used`
    : null;

  return (
    <View style={styles.fullSidebar}>
      <RatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onUpgrade={() => router.push('/paywall')}
      />

      {/* The panel is the chrome and stays put; its *contents* scroll. Unscrollable,
          the rail's content (label + 4 actions + key/type picker + free-tier counter)
          overflows a short viewport with no way to reach the overflow, so whatever sits
          last is simply unreachable. */}
      <ScrollView
        style={styles.sidebarScroll}
        contentContainerStyle={styles.sidebarScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sidebarSection}>
          <Text style={styles.sidebarSectionLabel}>Quick actions</Text>

          <Pressable
            onPress={uploadAudio}
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
              <Ionicons name="cloud-upload-outline" size={16} color={theme.textSub} />
            </View>
            <Text style={styles.sidebarRowText}>Upload Audio</Text>
          </Pressable>

          <Pressable
            onPress={uploadMidi}
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
              <Ionicons name="musical-note-outline" size={16} color={theme.textSub} />
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
            {/* `add-circle-outline` — this is a create action. `options-outline` (a sliders
                glyph) stays the Studio's identity mark on the project card and on "Open in
                Studio", where it isn't creating anything. */}
            <View style={styles.sidebarRowIconWrap}>
              <Ionicons name="add-circle-outline" size={16} color={theme.textSub} />
            </View>
            <Text style={styles.sidebarRowText}>New MIDI Project</Text>
          </Pressable>

          {/* Last in the stack, directly above the harmonica picker it depends on.
              The three rows above it are self-contained — pick a file, or start blank —
              while this one is only armed once a key is chosen, so it sits closest to the
              control that arms it. Accent fill keeps it the primary action wherever in the
              order it lands. */}
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

          {uploadError && (
            <View style={styles.uploadError} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle-outline" size={14} color={theme.warning} />
              <Text style={styles.uploadErrorText}>{uploadError}</Text>
            </View>
          )}
        </View>

        {/* "Recording setup", not "Harmonica" — the label names the *job* the controls
            under it do rather than the object they configure. "Harmonica" left a user who
            had not yet connected key/type to transcription with no reason to touch it.
            Structurally it's still a summary row that expands, rather than a permanently-
            open twelve-cell grid: what the rail needs to say at rest is *which* harmonica
            the next recording will use; changing it is the rare case, so it costs a click. */}
        <View style={styles.sidebarSection}>
          <Text style={styles.sidebarSectionLabel}>Recording setup</Text>

          <Pressable
            onPress={() => setPickerOpen((v) => !v)}
            style={({ pressed, hovered }: any) => [
              styles.sidebarRow,
              (pressed || hovered) && styles.sidebarRowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={pickerOpen ? 'Hide key and type picker' : 'Change key and type'}
            accessibilityState={{ expanded: pickerOpen }}
          >
            <View style={styles.sidebarRowIconWrap}>
              <Ionicons name="musical-notes-outline" size={16} color={theme.accent} />
            </View>
            <Text style={styles.sidebarRowText} numberOfLines={1}>
              {selectedKey ? `Key of ${selectedKey}` : 'No key selected'}
              {'  ·  '}
              {harmonicaType === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
            </Text>
            <Ionicons
              name={pickerOpen ? 'chevron-up' : 'chevron-down'}
              size={13}
              color={theme.textMuted}
            />
          </Pressable>

          {pickerOpen && (
            /* Inset onto `bg` rather than sitting straight on the rail: KeyGrid's cells are
               `surface`-filled, which is the rail's own colour, so on the rail they would be
               twelve invisible squares. */
            <View style={styles.sidebarPickerPanel}>
              <View style={styles.section}>
                <Text style={styles.sidebarPickerLabel}>Type</Text>
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
                      {active && <Ionicons name="checkmark" size={14} color={theme.accent} />}
                    </Pressable>
                  );
                })}
              </View>

              <View style={[styles.section, { marginTop: 14 }]}>
                <Text style={styles.sidebarPickerLabel}>Key</Text>
                <KeyGrid
                  selected={selectedKey}
                  onSelect={(k: HarmonicaKey) => selectKey_(k)}
                />
              </View>
            </View>
          )}

          {freeCounterLabel && (
            <Text style={styles.sidebarCounter}>{freeCounterLabel}</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    // A neutral rail, flush to the true viewport edges (no radius, no margin) — clearly its
    // own persistent region, not a card floating in the page.
    //
    // Was a solid fill of `sidebarBg` (the brand cyan in light mode), then a faint wash of
    // it. `railBg` is now the plain surface and the *library* carries the tint instead:
    // 300px of colour beside the content it supports had the emphasis backwards either way,
    // and with the wash moved across, Start Recording is the only accent object left here.
    // The rows keep their edge against a same-coloured panel via `railBorder`.
    fullSidebar: {
      width:              300,
      flexShrink:         0,
      backgroundColor:    t.railBg,
      // The literal top-to-bottom division line, tinted to belong to the panel it edges.
      borderRightWidth:   1,
      borderRightColor:   t.railBorder,
    },
    // The padding sits on the scroll content, not on `fullSidebar`, so the panel's
    // background and its right-edge hairline still run the full height while only the
    // contents scroll.
    sidebarScroll:        { flex: 1 },
    sidebarScrollContent: { paddingHorizontal: 20, paddingVertical: 28, gap: 24 },

    sidebarSection: { gap: 8 },
    sidebarSectionLabel: {
      ...GROUP_LABEL,
      color:        t.textSub,
      marginBottom: 4,
    },
    sidebarCounter: { fontSize: 10, fontFamily: Poppins.regular, color: t.textMuted, marginTop: 4 },

    section: { gap: 8 },

    // Inset against the rail: one step *down* in elevation (bg, under surface) so a row
    // reads as a control cut into the panel rather than a card stacked onto it.
    sidebarRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               10,
      paddingVertical:   10,
      paddingHorizontal: 12,
      borderRadius:      RADIUS.md,
      backgroundColor:   t.bg,
      borderWidth:       1,
      // `railBorder`, not `border`. The rail is a plain panel now and these rows sit on it
      // at the same fill, so the border is the *only* thing drawing them — a neutral
      // hairline at that job reads as an accident rather than an edge. The accent tint is
      // faint enough not to compete with Start Recording's solid fill below.
      borderColor:       t.railBorder,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    // Start Recording — the only accent-filled object in the rail, which is the whole
    // point of taking the accent off the panel behind it.
    sidebarRowPrimary: {
      backgroundColor: t.accent,
      borderColor:     t.accent,
    },
    sidebarRowPrimaryPressed: { backgroundColor: t.accentDim },
    sidebarRowPressed:  { backgroundColor: t.surfaceAlt, borderColor: t.accent },
    sidebarRowDisabled: { opacity: 0.55 },
    sidebarRowIconWrap: { width: 22, alignItems: 'center', justifyContent: 'center' },
    // Row-level opacity (sidebarRowDisabled) handles the disabled dimming — no separate
    // text-color override needed on top of it.
    sidebarRowText: { flex: 1, fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textPrimary },
    // On the accent fill.
    sidebarRowTextPrimary: { color: '#fff' },
    // Stands in for an icon on the Start Recording row — a red dot on the cyan fill, the
    // same mark the recording screen uses.
    recordDot: { width: 7, height: 7, borderRadius: RADIUS.full, backgroundColor: t.record },

    // The expanded key/type picker. One step down from the rail for the same reason the
    // rows are, and because KeyGrid's cells are `surface`-filled — the rail's own colour.
    sidebarPickerPanel: {
      marginTop:       4,
      padding:         12,
      borderRadius:    RADIUS.md,
      backgroundColor: t.bg,
      borderWidth:     1,
      borderColor:     t.railBorder,
    },
    sidebarPickerLabel: {
      ...GROUP_LABEL,
      color:        t.textMuted,
      marginBottom: 2,
    },

    sidebarTypeRow: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'space-between',
      paddingVertical:   9,
      paddingHorizontal: 10,
      borderRadius:      RADIUS.sm,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    sidebarTypeRowActive:  { backgroundColor: t.accentSoft },
    sidebarTypeRowHovered: { backgroundColor: t.surfaceAlt },
    sidebarTypeRowText: {
      fontSize:   FONT.sm,
      fontFamily: Poppins.semiBold,
      color:      t.textSub,
    },
    sidebarTypeRowTextActive: { color: t.accent },

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
