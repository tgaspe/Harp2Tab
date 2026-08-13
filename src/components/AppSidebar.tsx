/**
 * The web app shell's left rail — quick actions plus the harmonica key/type picker.
 *
 * Lifted verbatim out of `index.tsx`'s dashboard, where it was inline, so a second screen
 * can mount the same rail without a copy of its markup, its four entry-point handlers, and
 * the free-tier gate each of them has to pass through. Home and `/profile` now render this
 * one component; anything else that grows a shell gets it for free.
 *
 * It owns its own state deliberately. The three "start something" actions all have to clear
 * `resolveSessionGate` first, and two of the three outcomes are UI (the rating prompt, the
 * paywall) — a version that reported gate results back to the host screen would make every
 * host re-implement the same two branches. The rating modal is rendered here for the same
 * reason.
 *
 * Web-only chrome: callers gate on `Platform.OS === 'web'`, matching how the rail has always
 * been used. On native the entry points live in the bottom action bar instead.
 */

import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { KeyGrid } from '@/components/KeyGrid';
import { RatingModal } from '@/components/RatingModal';
import { AudioImportError } from '@/audio/audioImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { pickMidiFile } from '@/audio/pickMidiFile';
import { setPendingImport } from '@/audio/pendingImport';
import { createProject } from '@/audio/midiProject';
import { Poppins } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { useTheme } from '@/hooks/useTheme';
import { usePremium } from '@/hooks/usePremium';
import { selectHarmonicaType, selectKey, useAppStore } from '@/store/useAppStore';
import { useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { computeEffectiveLimit, resolveSessionGate } from '@/store/sessionGate';
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

  const [showRatingModal, setShowRatingModal] = useState(false);
  // Only for failures that happen before the import screen exists (an oversized file
  // rejected at pick time) — everything after that is reported on /import itself.
  const [uploadError, setUploadError] = useState<string | null>(null);

  const effectiveLimit = computeEffectiveLimit(ratingStatus);

  function handleStart() {
    if (!selectedKey) return;
    const gate = resolveSessionGate({ isPurchased: premium, totalRecordingsUsed, ratingStatus });
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

          {uploadError && (
            <View style={styles.uploadError} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle-outline" size={14} color={theme.warning} />
              <Text style={styles.uploadErrorText}>{uploadError}</Text>
            </View>
          )}

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
            {/* Plain selectable rows instead of the pill-shaped segmented control the hero
                and native layouts use. Same underlying state/handler. */}
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

            {/* Same onAccent treatment as the type rows above, sitting straight on the blue
                panel instead of in a white card. */}
            <View style={[styles.section, { marginTop: 12 }]}>
              <Text style={styles.sidebarSectionLabel}>HARMONICA KEY</Text>
              <KeyGrid
                selected={selectedKey}
                onSelect={(k: HarmonicaKey) => selectKey_(k)}
                onAccent
              />
            </View>
          </View>

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
    // Accent-filled, flush to the true viewport edges (no radius, no margin) — clearly its
    // own persistent region, not a card floating in the page.
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
    // The padding sits on the scroll content, not on `fullSidebar`, so the panel's
    // background and its right-edge hairline still run the full height while only the
    // contents scroll.
    sidebarScroll:        { flex: 1 },
    sidebarScrollContent: { paddingHorizontal: 20, paddingVertical: 28 },

    // Plain row content directly on the accent panel — no card, no pill, no shadow.
    sidebarSection: { gap: 8 },
    sidebarSectionLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         '#fff',
      letterSpacing: 1,
      marginBottom:  6,
    },
    sidebarCounter: { fontSize: 10, fontFamily: Poppins.regular, color: 'rgba(255,255,255,0.65)', marginTop: 4 },

    section: { gap: 12 },

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
    // Stands in for an icon on the Start Recording row — the same red dot the hero's split
    // button carries, so the two entry points read as the same action.
    recordDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.record },

    // No card here — sits straight on the accent panel (rows use their own onAccent
    // colors) so the whole sidebar reads as one homogeneous surface, not a blue frame
    // wrapped around a white box.
    sidebarInlineDropdown: { marginTop: 10, gap: 16 },

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
