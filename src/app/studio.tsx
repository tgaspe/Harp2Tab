import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActionSheetModal } from '@/components/ActionSheetModal';
import { TrackList } from '@/components/TrackList';
import { PianoRoll } from '@/components/PianoRoll';
// The editor's own transport and its style sheet, imported rather than reimplemented.
// Rebuilding these was the mistake the first version of this screen made: the Studio ended
// up with a single "Play" text button while the editor next door had loop, tempo,
// metronome, skip, stop, play/pause, rate and a time readout.
import { WebTransportBar } from '@/components/TransportBar';
import { createStyles as createEditStyles } from '@/app/editStyles';
import { audibleTracks, instrumentName } from '@/audio/studioTracks';
import { getChromaticRows } from '@/audio/HarmonicaMapper';
import { audibleProject, createTrack, projectToSmfBytes, tempoMapOf } from '@/audio/midiProject';
import { mostMelodicTrack } from '@/audio/midiToNotes';
import {
  appendTabNote,
  applyTabNoteChange,
  removeTabNote,
  removeTabNotes,
  trackToTabNotes,
  visibleTrackNotes,
} from '@/audio/studioNotes';
import { convertTrackToRecording, rankKeysForTrack } from '@/audio/convertTrack';
import { decimateFrames, getFrames } from '@/audio/frameBuffer';
import type { MidiKeyRanking } from '@/audio/notesToTabs';
import { ConvertTrackModal } from '@/components/ConvertTrackModal';
import { RatingModal } from '@/components/RatingModal';
import { resolveSessionGate } from '@/store/sessionGate';
import { useSettingsStore } from '@/store/useSettingsStore';
import { triggerWebDownload } from '@/export/webDownload';
import { useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { useRecordingsStore } from '@/store/useRecordingsStore';
import { selectHarmonicaType, useAppStore } from '@/store/useAppStore';
import { useRollTransport, formatElapsed } from '@/hooks/useRollTransport';
import { useEditHistory, useUndoRedoShortcuts } from '@/hooks/useEditHistory';
import { useSaveShortcut } from '@/hooks/keyboardShortcuts';
import { useHeaderActionStore } from '@/store/useHeaderActionStore';
import { useTheme } from '@/hooks/useTheme';
import { getPremium } from '@/hooks/usePremium';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, MidiProject, MidiTrackData, TabNote } from '@/types';

/**
 * The MIDI Studio — the stage *before* the tab editor.
 *
 * Music here is many tracks at full pitch range with no instrument attached; the harmonica
 * only enters at the conversion boundary (`convertTrackToRecording`).
 *
 * Structurally this is the *editor's* screen with the track panel swapped in for the
 * key/actions sidebar. That's deliberate and was learned the hard way: the first version
 * treated the Studio as a new screen that merely embedded `PianoRoll`, so it inherited none
 * of the editor's chrome and re-solved problems already solved next door — including a
 * second control-lane strip stacked under the roll's own Velocity / Duration /
 * Confidence / Pitch Bend panel. The roll already has that panel; the Studio adds tracks
 * and conversion. Nothing else.
 *
 * It deliberately has **no chrome row of its own**. The project title rides in the piano
 * roll's tool row (`headerLeft`, same as the editor puts its chart title there), Save and
 * Download MIDI are parked in the global `TopBar` via `useHeaderActionStore`, and getting
 * back to the library is the Harp2Tab logo — which already does that on every other screen.
 *
 * Edits are **not** autosaved. They accumulate in a draft that Save commits (see `mutate`);
 * this screen is a MIDI editor, and downloading or converting is what it produces, so
 * "try something and walk away" has to be possible. Download MIDI writes the project
 * itself — no harmonica has been chosen here, so there is no tab to export.
 */

/** Pitch-row height in the Studio. Roughly two-thirds the editor's, which puts about five
 *  octaves on screen instead of two while still leaving a note block clickable. */
const STUDIO_ROW_HEIGHT = 18;

/** Which track to open on. `tracks[0]` is a bad default and was: real files routinely lead
 *  with a conductor or marker track carrying no notes, so the editor opened blank, scrolled
 *  to the top of a 128-row ladder. `mostMelodicTrack` already answers this for import. */
function defaultTrackFor(project: MidiProject): MidiTrackData | null {
  const withNotes = project.tracks.filter((t) => t.notes.length > 0);
  if (withNotes.length === 0) return project.tracks[0] ?? null;

  // `mostMelodicTrack` works on the import pipeline's own track shape; it only reads
  // `notes` and `noteCount`, so the project's tracks map onto it directly.
  const best = mostMelodicTrack(withNotes.map((t, i) => ({
    id: i, name: t.name, program: t.program, channel: t.channel, noteCount: t.notes.length,
    lowestNote: 0, highestNote: 0, durationMs: 0, notes: t.notes,
  })));
  return withNotes[best.id] ?? withNotes[0];
}

export default function StudioScreen() {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const editStyles = useMemo(() => createEditStyles(theme), [theme]);

  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const projects      = useMidiProjectsStore((s) => s.projects);
  const saveProject   = useMidiProjectsStore((s) => s.saveProject);
  const deleteProject = useMidiProjectsStore((s) => s.deleteProject);
  const saveRecording = useRecordingsStore((s) => s.saveRecording);
  const loadRecording = useAppStore((s) => s.loadRecording);
  // The Studio has no harp of its own — a project is unconstrained music. This is only the
  // picker's starting point: whatever the user last chose on Home is the likeliest answer,
  // and the picker is where it actually gets decided.
  const harmonicaType = useAppStore(selectHarmonicaType);
  const incrementRecordingCount = useSettingsStore((s) => s.incrementRecordingCount);

  const stored = useMemo(
    () => projects.find((p) => p.id === projectId) ?? projects[0] ?? null,
    [projects, projectId],
  );

  /**
   * Edits are held here until Save, rather than written straight to the store.
   *
   * Keyed on the project's *id*, deliberately: committing a Save gives `stored` a new
   * identity but the same id, so the effect doesn't fire and immediately overwrite the
   * draft with what was just written. Opening a different project does change the id, and
   * that should reset.
   */
  const [draft, setDraft] = useState<MidiProject | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDraft(stored);
    setDirty(false);
  }, [stored?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const project = draft ?? stored;

  /** Every edit on this screen goes through here — one place that marks work uncommitted. */
  const mutate = useCallback((next: MidiProject) => {
    setDraft(next);
    setDirty(true);
  }, []);

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId]   = useState<string | null>(null);
  // Toned, because this banner reports both "that didn't work" and "that worked" — a
  // successful save in the warning palette reads as a failure.
  const [notice, setNotice] = useState<{ text: string; tone: 'warning' | 'success' } | null>(null);
  const [tracksCollapsed, setTracksCollapsed] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  /** The open harp picker, or null. Holds the ranking so the list doesn't re-score on every
   *  render, and the in-progress choice, which isn't committed to anything until Convert. */
  const [converting, setConverting] = useState<{
    trackId:       string;
    ranking:       MidiKeyRanking;
    chosenKey:     HarmonicaKey;
    harmonicaType: HarmonicaType;
  } | null>(null);
  // Session-local, unlike the tab editor's (which persists per-recording in useAppStore) —
  // a project has no metronome setting of its own to save it into.
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);

  const tracks = project?.tracks ?? [];
  const selectedTrack = useMemo(() => {
    if (!project) return null;
    return tracks.find((t) => t.id === selectedTrackId) ?? defaultTrackFor(project);
  }, [project, tracks, selectedTrackId]);

  // Full MIDI range — the Studio has no instrument, so nothing narrows it.
  const rows = useMemo(() => getChromaticRows(), []);
  const tempoMap = useMemo(() => (project ? tempoMapOf(project) : undefined), [project]);
  const bpm = Math.round(project?.tempos[0]?.bpm ?? 120);

  /**
   * The selected track's notes, filtered by nothing — what the Velocity chart draws, and
   * the set the filter line is dragged against.
   *
   * Adapted *before* filtering, deliberately: a note's id is its index in the track's array
   * (see `studioNotes.ts`), so ids have to be minted against the full array or every edit
   * made while the filter is up would land on the wrong note.
   */
  const editableNotes: TabNote[] = useMemo(
    () => (selectedTrack ? trackToTabNotes(selectedTrack) : []),
    [selectedTrack],
  );

  /** The track's velocity floor — 0 when it has none, which is the off position. */
  const velocityFloor = selectedTrack?.velocityFloor ?? 0;
  /** Its duration floor, in ms. Same convention: absent reads as 0/off. */
  const durationFloorMs = selectedTrack?.durationFloorMs ?? 0;

  /** What the roll actually draws and lets you edit. */
  const visibleNotes = useMemo(
    () => (selectedTrack ? visibleTrackNotes(selectedTrack) : []),
    [selectedTrack],
  );

  /**
   * Whether the filter can do anything on this track.
   *
   * A track whose notes state no velocity at all — hand-drawn in the Studio, or imported
   * from a file that left the byte off — gets no line, for the same reason the tab editor
   * omits it: a control that provably does nothing at any position is worse than none.
   */
  const velocityFilterSupported = useMemo(
    () => editableNotes.some((n) => n.velocity !== undefined),
    [editableNotes],
  );

  // Every audible track except the one being edited, so mute/solo governs what's drawn as
  // well as what sounds — a silenced track showing through would misrepresent playback.
  // Each lane is cut by *its own* floor, not the selected track's: the threshold is a
  // property of how that part was played, and a lane drawing notes that don't sound would
  // put the roll and the playback out of step.
  const backgroundLanes = useMemo(() => {
    if (!project || !selectedTrack) return [];
    return audibleTracks(tracks)
      .filter((t) => t.id !== selectedTrack.id)
      .map((t) => ({ id: t.id, color: t.color, notes: visibleTrackNotes(t) }));
  }, [project, tracks, selectedTrack]);

  /** Everything audible, merged and time-ordered — `usePlayback` schedules one flat list.
   *  Filtered per track, so a note under a track's line is silent as well as hidden. */
  const audibleNotes = useMemo(
    () => audibleTracks(tracks)
      .flatMap((t) => visibleTrackNotes(t))
      .sort((a, b) => a.start_time - b.start_time),
    [tracks],
  );

  // Every rule about *when* playback restarts lives in the hook, shared with the tab
  // editor — see `useRollTransport` for the three behaviours this screen was missing while
  // it wired the transport up by hand. `durationMs` covers every track in the project, not
  // just the one on screen, so it's passed rather than derived from the visible notes.
  const transport = useRollTransport({
    notes: audibleNotes,
    bpm,
    tempoMap,
    totalTimeMs: project?.durationMs ?? 0,
    metronomeEnabled,
    setMetronomeEnabled,
  });
  const { loopRegion, setLoopRegion } = transport;

  const updateTrack = useCallback((trackId: string, changes: Partial<MidiTrackData>) => {
    if (!project) return;
    mutate({
      ...project,
      tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, ...changes } : t)),
    });
  }, [project, mutate]);

  /**
   * Undo/redo for the Studio, over the generic stack in `useEditHistory` — see there for
   * why the tab editor keeps its own history in `useAppStore` while this one is screen-
   * local. A snapshot is the project's track array, the only thing this screen edits.
   *
   * Only *note* edits are recorded — see `commitNotes`. Mute/solo/program and add/delete
   * track go through `updateTrack`/`mutate` untracked, matching what the tab editor's
   * history does and doesn't cover (musical content, not the state around it). Undo edits
   * the draft like anything else, so it marks the project unsaved rather than reverting to
   * what's on disk.
   */
  const readTracks = useCallback(() => project?.tracks ?? null, [project]);
  const writeTracks = useCallback((tracks: MidiTrackData[]) => {
    if (!project) return;
    mutate({ ...project, tracks });
  }, [project, mutate]);
  // A note's id is its index in the track's array (see `studioNotes.ts`), so it doesn't
  // survive a jump that may have added or removed notes — dropping the selection is
  // honest, where keeping it would leave it pointing at some unrelated note.
  const clearSelection = useCallback(() => setSelectedNoteId(null), []);
  const historyState = useEditHistory(readTracks, writeTracks, clearSelection);
  const { record } = historyState;

  useUndoRedoShortcuts(historyState);

  const commitNotes = useCallback((trackId: string, notes: MidiTrackData['notes']) => {
    if (!project) return;
    record();
    mutate({
      ...project,
      tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, notes } : t)),
    });
  }, [project, mutate, record]);

  const handleCreate = useCallback((created: Omit<TabNote, 'id'>) => {
    if (!selectedTrack) return;
    commitNotes(selectedTrack.id, appendTabNote(selectedTrack, created));
  }, [selectedTrack, commitNotes]);

  const handleUpdate = useCallback((id: string, changes: Partial<TabNote>) => {
    if (!selectedTrack) return;
    const notes = applyTabNoteChange(selectedTrack, id, changes);
    if (notes === selectedTrack.notes) return;
    commitNotes(selectedTrack.id, notes);
  }, [selectedTrack, commitNotes]);

  /**
   * Bulk edits — quantize, duplicate, paste, group move, arrow-key nudge.
   *
   * Applied in one pass rather than by looping the single-note path, because each
   * `applyTabNoteChange` returns a fresh array: looping would write the store N times and
   * discard all but the last change.
   */
  const handleUpdateMany = useCallback((updates: { id: string; changes: Partial<TabNote> }[]) => {
    if (!selectedTrack) return;
    let working = selectedTrack;
    for (const update of updates) {
      const notes = applyTabNoteChange(working, update.id, update.changes);
      if (notes !== working.notes) working = { ...working, notes };
    }
    if (working.notes !== selectedTrack.notes) {
      commitNotes(selectedTrack.id, working.notes);
    }
  }, [selectedTrack, commitNotes]);

  const handleCreateMany = useCallback((created: Omit<TabNote, 'id'>[]) => {
    if (!selectedTrack) return;
    let notes = selectedTrack.notes;
    for (const note of created) notes = appendTabNote({ ...selectedTrack, notes }, note);
    commitNotes(selectedTrack.id, notes);
  }, [selectedTrack, commitNotes]);

  const handleDelete = useCallback((id: string) => {
    if (!selectedTrack) return;
    // Deleting shifts every later note's positional id, so the current selection can't
    // survive it — see the identity note in `studioNotes.ts`.
    setSelectedNoteId(null);
    commitNotes(selectedTrack.id, removeTabNote(selectedTrack, id));
  }, [selectedTrack, commitNotes]);

  /**
   * Bulk delete — marquee selection + Backspace, or right-click inside one.
   *
   * Same reason `handleUpdateMany` exists, plus a second one specific to deletion: ids are
   * positional, so each removal invalidates the ids of every note after it. Looping the
   * single-note path would resolve later ids against an array they no longer describe and
   * delete the wrong notes — `removeTabNotes` resolves them all up front instead.
   */
  const handleDeleteMany = useCallback((ids: string[]) => {
    if (!selectedTrack) return;
    const notes = removeTabNotes(selectedTrack, ids);
    if (notes === selectedTrack.notes) return;
    setSelectedNoteId(null);
    commitNotes(selectedTrack.id, notes);
  }, [selectedTrack, commitNotes]);

  const handleSave = useCallback(() => {
    if (!project || !dirty) return;
    saveProject(project);
    setDirty(false);
    setNotice({ text: 'Saved to library.', tone: 'success' });
  }, [project, dirty, saveProject]);

  // Ctrl/Cmd+S, the same handler the header's Save button uses — including its `!dirty`
  // no-op, so pressing it twice doesn't rewrite an unchanged project. Bound here rather than
  // beside `useUndoRedoShortcuts` above only because `handleSave` is a `const`: a call
  // placed earlier would read it in its temporal dead zone.
  useSaveShortcut(handleSave);

  /**
   * Delete the whole project and go home.
   *
   * Deliberately the project, not the unsaved edits: undo already covers "take that back",
   * and the gap this fills is the imported file that turned out to be wrong, which the user
   * could previously only get rid of by navigating back to Home and finding its card. The
   * confirm is non-negotiable — `deleteProject` is persisted immediately and there is no
   * trash to recover from.
   */
  const handleDiscard = useCallback(() => {
    if (!project) return;
    deleteProject(project.id);
    // replace, not push: the project this screen is looking at no longer exists, so leaving
    // it on the back stack would return the user to a "No project open" husk.
    router.replace('/app');
  }, [project, deleteProject]);

  /**
   * Open the harp picker for a track.
   *
   * The gate is checked *here*, before the picker, rather than after the user has chosen a
   * key — being told the free tier is exhausted is a reasonable thing to hear, but hearing
   * it only after making a choice that then gets thrown away is not.
   */
  const handleConvert = useCallback((trackId: string) => {
    if (!project) return;
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;

    const { totalRecordingsUsed, ratingStatus } = useSettingsStore.getState();
    const gate = resolveSessionGate({ isPurchased: getPremium().premium, totalRecordingsUsed, ratingStatus });
    if (gate === 'showRating')  { setShowRatingModal(true); return; }
    if (gate === 'showPaywall') { router.push('/paywall'); return; }

    const ranking = rankKeysForTrack(track, harmonicaType);
    if (!ranking) {
      setNotice({ text: `"${track.name}" has no notes to convert — check its velocity and length filters.`, tone: 'warning' });
      return;
    }

    setConverting({ trackId, ranking, chosenKey: ranking.ranked[0].key, harmonicaType });
  }, [project, harmonicaType]);

  /** Re-score when the harp type changes — a chromatic harp reaches pitches a diatonic one
   *  can't, so the ranking under the type toggle is a different ranking. */
  const handleConvertTypeChange = useCallback((type: HarmonicaType) => {
    setConverting((current) => {
      if (!current || !project) return current;
      const track = project.tracks.find((t) => t.id === current.trackId);
      const ranking = track ? rankKeysForTrack(track, type) : null;
      if (!ranking) return { ...current, harmonicaType: type };
      // Keep the user's key if it's still on offer; otherwise fall back to the new best.
      const stillRanked = ranking.ranked.some((c) => c.key === current.chosenKey);
      return {
        ...current,
        harmonicaType: type,
        ranking,
        chosenKey: stillRanked ? current.chosenKey : ranking.ranked[0].key,
      };
    });
  }, [project]);

  const confirmConvert = useCallback(() => {
    if (!project || !converting) return;
    const track = project.tracks.find((t) => t.id === converting.trackId);
    if (!track) return;

    const result = convertTrackToRecording(project, track, {
      key:           converting.chosenKey,
      harmonicaType: converting.harmonicaType,
    });
    if (!result) {
      setConverting(null);
      setNotice({ text: `"${track.name}" has no notes to convert — check its velocity and length filters.`, tone: 'warning' });
      return;
    }

    // Commit the draft, but only now that we know we're leaving. Conversion stamps
    // `sourceProjectId` on the new recording, so the project that id points at has to be
    // the one that was converted — not a draft the user might still discard. A failed
    // conversion isn't a reason to silently save on their behalf.
    if (dirty) {
      saveProject(project);
      setDirty(false);
    }

    // Frames follow the music across the Studio hop. An audio import parks them under the
    // project id (it has no recording id yet — this call is what mints one), so this is the
    // only point at which they can be attached to the tab they belong to. Decimated for the
    // same reason a recorded session is: the persisted copy has a size ceiling.
    const frames = getFrames(project.id);
    const recording = frames.length > 0
      ? { ...result.recording, frames: decimateFrames(frames) }
      : result.recording;

    // The free-tier session is consumed here, at the one point in the app where a project
    // actually becomes a tab. Both Studio entry points (MIDI "Open in Studio" and an audio
    // upload) reach the editor only through here, so this is what makes the gate the Home
    // screen advertises real for them.
    incrementRecordingCount();

    saveRecording(recording);
    // Straight into the tab editor with it — conversion producing a library entry the user
    // then has to go and find would bury the result of the thing they just asked for.
    loadRecording(recording);
    setConverting(null);
    router.push('/edit');
  }, [project, converting, dirty, saveProject, saveRecording, loadRecording, incrementRecordingCount]);

  /**
   * Download the project as a standard MIDI file.
   *
   * The draft, not the stored copy — what's on screen is what downloads, whether or not
   * it's been saved. Deliberately *not* a tab export: nothing here has been fitted to a
   * harmonica, and converting on the way out would make the downloaded file a lossy
   * rendering of the project rather than the project.
   *
   * "What's on screen" includes the velocity floors, hence `audibleProject` — a note the
   * user has filtered out of the roll and out of playback shouldn't turn up in the file they
   * just downloaded. This is a view for export only; `saveProject` writes the unfiltered
   * project, so nothing is lost by filtering here.
   */
  const handleDownloadMidi = useCallback(() => {
    if (!project) return;
    const safeTitle = project.title.replace(/[^\w-]+/g, '_').slice(0, 60) || 'harp2tab_project';
    // `writeSmf` returns a freshly allocated view, so its buffer is exactly these bytes —
    // the cast is only to satisfy BlobPart's ArrayBuffer/SharedArrayBuffer distinction.
    const buffer = projectToSmfBytes(audibleProject(project)).buffer as ArrayBuffer;
    triggerWebDownload(new Blob([buffer], { type: 'audio/midi' }), `${safeTitle}.mid`);
  }, [project]);

  /** Tempo lives on the project's map, so the transport's BPM stepper edits the map's
   *  opening tempo rather than a scalar the Studio doesn't have. */
  function setProjectBpm(next: number) {
    if (!project) return;
    const clamped = Math.max(20, Math.min(400, Math.round(next)));
    const tempos = project.tempos.length > 0
      ? project.tempos.map((t, i) => (i === 0 ? { ...t, bpm: clamped } : t))
      : [{ timeMs: 0, bpm: clamped }];
    mutate({ ...project, tempos });
  }

  const setHeaderActions   = useHeaderActionStore((s) => s.setHeaderActions);
  const clearHeaderActions = useHeaderActionStore((s) => s.clearHeaderActionsFor);
  // useFocusEffect, not useEffect: converting a track pushes /edit, which leaves this
  // screen mounted, so an unmount-time cleanup never runs and these buttons used to
  // follow the user into the tab editor. Blur is the event that actually happens.
  useFocusEffect(
    useCallback(() => {
      setHeaderActions('/studio', [
        {
          key:      'save',
          icon:     'save-outline',
          label:    dirty ? 'Save' : 'Saved',
          onPress:  handleSave,
          disabled: !project || !dirty,
        },
        {
          key:      'download-midi',
          icon:     'download-outline',
          label:    'Download MIDI',
          onPress:  handleDownloadMidi,
          disabled: !project,
        },
        {
          key:      'discard',
          icon:     'trash-outline',
          label:    'Discard',
          // Opens the confirm; the deletion itself is behind it. The pill is red, but red
          // alone isn't consent for something this irreversible.
          onPress:  () => setConfirmingDiscard(true),
          disabled: !project,
          variant:  'destructive',
        },
      ]);
      return () => clearHeaderActions('/studio');
    }, [setHeaderActions, clearHeaderActions, handleSave, handleDownloadMidi, dirty, project]),
  );

  /** Autosave is gone, so a reload with uncommitted edits would lose them silently. */
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!project) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No project open</Text>
          <Text style={styles.emptyBody}>Import a MIDI file to start a Studio project.</Text>
          <Pressable style={styles.emptyBtn} onPress={() => router.replace('/app')}>
            <Text style={styles.emptyBtnText}>Back to library</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {/* Same two-line phrasing the library's delete uses, so the same action reads the same
          way wherever it's reached from. `onPress` does the work, never `onClose` — the
          modal fires `onClose` first, so deleting there would run on Cancel too. */}
      <ActionSheetModal
        visible={confirmingDiscard}
        title={`Discard "${project.title}"? This can't be undone.`}
        options={[{ label: 'Discard project', style: 'destructive', onPress: handleDiscard }]}
        onClose={() => setConfirmingDiscard(false)}
      />

      {converting && (
        <ConvertTrackModal
          visible
          trackName={tracks.find((t) => t.id === converting.trackId)?.name ?? 'this track'}
          ranking={converting.ranking}
          chosenKey={converting.chosenKey}
          harmonicaType={converting.harmonicaType}
          onSelectKey={(key) => setConverting((c) => (c ? { ...c, chosenKey: key } : c))}
          onSelectType={handleConvertTypeChange}
          onConfirm={confirmConvert}
          onClose={() => setConverting(null)}
        />
      )}

      <RatingModal
        visible={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        onUpgrade={() => router.push('/paywall')}
      />

      {/* The banner used to be one big Pressable that dismissed on a click anywhere, with
          nothing on it saying so — an affordance you can only find by accident is not one.
          It also put `accessibilityRole="button"` around the message, so a screen reader
          announced "Saved to library." as the *name of a button*. Now the banner is text and
          the dismiss is a real control beside it. */}
      {notice && (
        <View
          style={[styles.notice, notice.tone === 'success' && styles.noticeSuccess]}
          accessibilityRole="alert"
        >
          <Text style={styles.noticeText}>{notice.text}</Text>
          <Pressable
            onPress={() => setNotice(null)}
            style={({ pressed, hovered }: any) => [
              styles.noticeClose,
              Platform.OS === 'web' && hovered && styles.noticeCloseHovered,
              pressed && { opacity: 0.6 },
            ]}
            // The banner is only 10px tall inside its padding; without this the X is a
            // 16px target sitting in the corner of a toolbar.
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss message"
          >
            <Ionicons name="close" size={16} color={theme.textSub} />
          </Pressable>
        </View>
      )}

      <View style={styles.body}>
        <TrackList
          tracks={tracks}
          selectedTrackId={selectedTrack?.id ?? null}
          onSelectTrack={(id) => { setSelectedTrackId(id); setSelectedNoteId(null); }}
          onToggleMute={(id) => {
            const t = tracks.find((x) => x.id === id);
            if (t) updateTrack(id, { muted: !t.muted });
          }}
          onToggleSolo={(id) => {
            const t = tracks.find((x) => x.id === id);
            if (t) updateTrack(id, { soloed: !t.soloed });
          }}
          onSetProgram={(id, program) => updateTrack(id, { program })}
          onRenameTrack={(id, name) => updateTrack(id, { name })}
          onSetTrackColor={(id, color) => updateTrack(id, { color })}
          onAddTrack={() => {
            const track = createTrack(project.tracks.length);
            mutate({ ...project, tracks: [...project.tracks, track] });
            setSelectedTrackId(track.id);
          }}
          onDeleteTrack={(id) => {
            if (project.tracks.length <= 1) return;
            mutate({ ...project, tracks: project.tracks.filter((t) => t.id !== id) });
            if (selectedTrackId === id) setSelectedTrackId(null);
          }}
          collapsed={tracksCollapsed}
          onToggleCollapsed={() => setTracksCollapsed((v) => !v)}
          onConvert={handleConvert}
        />

        <View style={styles.rollWrap}>
          {selectedTrack ? (
            <PianoRoll
              notes={visibleNotes}
              // No harmonica at this stage — `rows` supplies the pitch axis instead, and
              // these two only exist because the tab editor derives its rows from them.
              harmonicaKey="C"
              harmonicaType="chromatic"
              rows={rows}
              // Shorter than the editor's 28px: that ladder is ~40 harmonica rows, this
              // one is all 128 semitones, where tall rows mean barely two octaves fit.
              rowHeight={STUDIO_ROW_HEIGHT}
              // Colour by track, not by technique. Technique is a harmonica idea and no
              // harp has been chosen yet, so every note's tab is empty — which the roll
              // otherwise paints as "unreachable on this harmonica" grey.
              noteColor={selectedTrack?.color}
              backgroundLanes={backgroundLanes}
              bpm={bpm}
              tempoMap={tempoMap}
              selectedId={selectedNoteId}
              onSelect={setSelectedNoteId}
              onCreate={handleCreate}
              onUpdate={handleUpdate}
              onUpdateMany={handleUpdateMany}
              onCreateMany={handleCreateMany}
              // The freshly-adapted notes, so "select what was just created" resolves
              // against the project rather than the tab session's store.
              readNotesAfterWrite={() => (selectedTrack ? trackToTabNotes(selectedTrack) : [])}
              onDelete={handleDelete}
              onDeleteMany={handleDeleteMany}
              isPlaying={transport.isPlaying}
              currentTimeMs={transport.currentTimeMs}
              onSeek={transport.onSeek}
              loopRegion={loopRegion}
              onLoopRegionChange={setLoopRegion}
              // The draggable line in the data panel's Velocity chart. Per track, saved with
              // it, so switching tracks moves the line to that track's own threshold.
              // Untracked by undo, matching mute/solo/program — history covers musical
              // content, not the state around it.
              velocityFilter={velocityFilterSupported ? {
                value:    velocityFloor,
                onChange: (v) => updateTrack(selectedTrack.id, { velocityFloor: v }),
                // Unfiltered, so the chart keeps drawing (in grey) what the roll has hidden.
                allNotes:     editableNotes,
                audibleCount: visibleNotes.length,
                totalCount:   editableNotes.length,
                source:       selectedTrack.velocitySource,
              } : undefined}
              // The Duration chart's line, thresholding note length. Per track and saved with
              // it, exactly like the velocity floor, and equally outside undo.
              //
              // No `supported` gate: velocity is optional on a MIDI note, duration never is,
              // so this control always has something to act on. `audibleCount` is the count
              // after both lines — `visibleTrackNotes` applies them together.
              durationFilter={{
                value:    durationFloorMs,
                onChange: (v) => updateTrack(selectedTrack.id, { durationFloorMs: v }),
                allNotes:     editableNotes,
                audibleCount: visibleNotes.length,
                totalCount:   editableNotes.length,
              }}
              headerLeft={
                <ProjectTitle
                  // Remount on a project switch so the field re-seeds from the new title
                  // instead of carrying the previous project's text across.
                  key={project.id}
                  title={project.title}
                  onRename={(title) => mutate({ ...project, title })}
                  subtitle={
                    `${tracks.length} track${tracks.length === 1 ? '' : 's'}`
                    + (selectedTrack ? ` · ${selectedTrack.name} (${instrumentName(selectedTrack.program)})` : '')
                  }
                  styles={styles}
                />
              }
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>This project has no tracks</Text>
            </View>
          )}
        </View>
      </View>

      {/* The editor's transport, not a second one — but without `glued`, and with the
          margins reset: those exist to cancel edit.tsx's container padding and gap, which
          this screen doesn't have. Left in place they drag the bar out of its own box and
          the controls stop looking vertically centred. */}
      <WebTransportBar
          instrumentsLoading={transport.instrumentsLoading}
        tabNotesLength={audibleNotes.length}
        isPlaying={transport.isPlaying}
        isPaused={transport.isPaused}
        onPlayToggle={transport.onPlayToggle}
        onStop={transport.onStop}
        onSkipBack={() => transport.onSkipBar(-1)}
        onSkipForward={() => transport.onSkipBar(1)}
        currentTimeMs={transport.currentTimeMs}
        totalTimeMs={transport.totalTimeMs}
        formatElapsed={formatElapsed}
        loopEnabled={transport.loopEnabled}
        onToggleLoop={() => transport.setLoopEnabled(!transport.loopEnabled)}
        playbackRate={transport.playbackRate}
        onCycleRate={transport.onCycleRate}
        bpm={bpm}
        setBpm={setProjectBpm}
        metronomeEnabled={metronomeEnabled}
        onToggleMetronome={transport.onToggleMetronome}
        history={historyState}
        containerStyle={styles.transportBar}
        compact
        theme={theme}
        styles={editStyles}
      />
    </SafeAreaView>
  );
}

/**
 * The project's name, editable in place, in the piano roll's tool row.
 *
 * The same affordance the tab editor's `ChartTitle` uses and for the same reason: a field
 * styled as a heading gives no sign it is a field, so on web the pointer paints its box in.
 * Sized for the tool row rather than the editor's page title, which is the slot it occupies.
 *
 * The typed value is held here and committed on blur, for two reasons. `PianoRoll` is the
 * heaviest component on the screen and lifting every keystroke into the project would
 * re-render it per character. And the rename goes through the screen's `mutate` — the draft,
 * like every other edit here — *not* the store's `renameProject`: with edits held in a draft
 * until Save, a direct store write would be overwritten by the next `saveProject`, which
 * replaces the whole project with the draft it holds.
 */
function ProjectTitle({
  title, subtitle, onRename, styles,
}: {
  title:    string;
  subtitle: string;
  onRename: (title: string) => void;
  styles:   ReturnType<typeof createStyles>;
}) {
  const [value, setValue]     = useState(title);
  const [hovered, setHovered] = useState(false);

  function commit() {
    const next = value.trim();
    // An emptied title is a slip, not an instruction — a project with no name is
    // unfindable on Home. Snap back rather than commit it.
    if (!next) { setValue(title); return; }
    if (next !== title) onRename(next);
  }

  return (
    <View
      style={styles.rollHeader}
      {...(Platform.OS === 'web'
        ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
        : null)}
    >
      <TextInput
        value={value}
        onChangeText={setValue}
        onBlur={commit}
        onSubmitEditing={commit}
        returnKeyType="done"
        style={[styles.rollTitleInput, hovered && styles.rollTitleInputHovered]}
        accessibilityLabel="Project name"
      />
      <Text style={styles.rollSubtitle} numberOfLines={1}>{subtitle}</Text>
    </View>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    transportBar: {
      marginHorizontal: 0,
      marginBottom:     0,
      marginTop:        0,
      borderTopWidth:   1,
      borderTopColor:   t.separator,
    },
    rollHeader: { minWidth: 0, maxWidth: 320 },
    // Was a static <Text> at these metrics; the input keeps them so the row's height and
    // rhythm are unchanged, with negative horizontal margin cancelling the padding that
    // gives the hover box its inset — the title still starts flush with the row.
    rollTitleInput: {
      fontFamily:        Poppins.bold,
      fontSize:          14,
      color:             t.textPrimary,
      paddingVertical:   2,
      paddingHorizontal: 4,
      marginHorizontal:  -4,
      borderRadius:      6,
      backgroundColor:   'transparent',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none', cursor: 'text' } as any : null),
    } as any,
    rollTitleInputHovered: { backgroundColor: t.surfaceAlt },
    rollSubtitle: { fontFamily: SpaceGrotesk.regular, fontSize: 11, color: t.textMuted },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 16,
      marginTop: 8,
      padding: 10,
      // Was a flat 10 all round. The right side gives the X its own room so the message
      // doesn't run into it on a narrow roll.
      paddingRight: 8,
      borderRadius: 8,
      backgroundColor: t.warningSoft,
      borderWidth: 1,
      borderColor: t.warning,
    },
    noticeSuccess: { backgroundColor: t.successSoft, borderColor: t.success },
    // `flex: 1` so a long warning ("... has no notes to convert — check its filters.")
    // wraps against the X rather than pushing it off the end of the banner.
    noticeText: { flex: 1, minWidth: 0, fontFamily: SpaceGrotesk.regular, fontSize: 13, color: t.textPrimary },
    noticeClose: {
      padding: 4,
      borderRadius: 6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    // Tinted rather than faded: the banner already carries a colour, and an X that dims on
    // hover reads as disabled against it.
    noticeCloseHovered: { backgroundColor: t.surfaceAlt },
    body: { flex: 1, flexDirection: 'row', minHeight: 0 },
    rollWrap: { flex: 1, minWidth: 0 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
    emptyTitle: { fontFamily: Poppins.bold, fontSize: 16, color: t.textPrimary },
    emptyBody:  { fontFamily: SpaceGrotesk.regular, fontSize: 13, color: t.textMuted, textAlign: 'center' },
    emptyBtn: {
      marginTop: 8,
      paddingHorizontal: 14, paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: t.accentSoft,
      borderWidth: 1, borderColor: t.accentDim,
    },
    emptyBtnText: { fontFamily: Poppins.bold, fontSize: 13, color: t.accent },
  });
}
