import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { TrackList } from '@/components/TrackList';
import { PianoRoll } from '@/components/PianoRoll';
// The editor's own transport and its style sheet, imported rather than reimplemented.
// Rebuilding these was the mistake the first version of this screen made: the Studio ended
// up with a single "Play" text button while the editor next door had loop, tempo,
// metronome, skip, stop, play/pause, rate and a time readout.
import { WebTransportBar, createStyles as createEditStyles } from '@/app/edit';
import { audibleTracks, instrumentName } from '@/audio/studioTracks';
import { getChromaticRows } from '@/audio/HarmonicaMapper';
import { createTrack, tempoMapOf } from '@/audio/midiProject';
import { mostMelodicTrack } from '@/audio/midiToNotes';
import {
  appendTabNote,
  applyTabNoteChange,
  removeTabNote,
  trackToTabNotes,
} from '@/audio/studioNotes';
import { convertAllTracks, convertTrackToRecording } from '@/audio/convertTrack';
import { generateForFormat } from '@/export/generators';
import { contentToBlob, triggerWebDownload } from '@/export/webDownload';
import { useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { useRecordingsStore } from '@/store/useRecordingsStore';
import { selectExportFmt, useAppStore } from '@/store/useAppStore';
import { usePlayback } from '@/hooks/usePlayback';
import { useHeaderActionStore } from '@/store/useHeaderActionStore';
import { useTheme } from '@/hooks/useTheme';
import { barDurationMs, PLAYBACK_RATES } from '@/audio/tempo';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { MidiProject, MidiTrackData, TabNote } from '@/types';

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
 * second control-lane strip stacked under the roll's own Breath Force / Duration /
 * Confidence / Pitch Bend panel. The roll already has that panel; the Studio adds tracks
 * and conversion. Nothing else.
 *
 * It deliberately has **no chrome row of its own**. The project title rides in the piano
 * roll's tool row (`headerLeft`, same as the editor puts its chart title there), Export is
 * parked in the global `TopBar` via `useHeaderActionStore`, and getting back to the library
 * is the Harp2Tab logo — which already does exactly that on every other screen.
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
    id: i, name: t.name, channel: t.channel, noteCount: t.notes.length,
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
  const saveRecording = useRecordingsStore((s) => s.saveRecording);
  const loadRecording = useAppStore((s) => s.loadRecording);
  const exportFormat  = useAppStore(selectExportFmt);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? projects[0] ?? null,
    [projects, projectId],
  );

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId]   = useState<string | null>(null);
  const [loopRegion, setLoopRegion] = useState<{ startMs: number; endMs: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tracksCollapsed, setTracksCollapsed] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);

  const playback = usePlayback();

  const tracks = project?.tracks ?? [];
  const selectedTrack = useMemo(() => {
    if (!project) return null;
    return tracks.find((t) => t.id === selectedTrackId) ?? defaultTrackFor(project);
  }, [project, tracks, selectedTrackId]);

  // Full MIDI range — the Studio has no instrument, so nothing narrows it.
  const rows = useMemo(() => getChromaticRows(), []);
  const tempoMap = useMemo(() => (project ? tempoMapOf(project) : undefined), [project]);
  const bpm = Math.round(project?.tempos[0]?.bpm ?? 120);

  const editableNotes: TabNote[] = useMemo(
    () => (selectedTrack ? trackToTabNotes(selectedTrack) : []),
    [selectedTrack],
  );

  // Every audible track except the one being edited, so mute/solo governs what's drawn as
  // well as what sounds — a silenced track showing through would misrepresent playback.
  const backgroundLanes = useMemo(() => {
    if (!project || !selectedTrack) return [];
    return audibleTracks(tracks)
      .filter((t) => t.id !== selectedTrack.id)
      .map((t) => ({ id: t.id, color: t.color, notes: trackToTabNotes(t) }));
  }, [project, tracks, selectedTrack]);

  /** Everything audible, merged and time-ordered — `usePlayback` schedules one flat list. */
  const audibleNotes = useMemo(
    () => audibleTracks(tracks)
      .flatMap((t) => trackToTabNotes(t))
      .sort((a, b) => a.start_time - b.start_time),
    [tracks],
  );

  const totalTimeMs = project?.durationMs ?? 0;

  const updateTrack = useCallback((trackId: string, changes: Partial<MidiTrackData>) => {
    if (!project) return;
    saveProject({
      ...project,
      tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, ...changes } : t)),
    });
  }, [project, saveProject]);

  const handleCreate = useCallback((created: Omit<TabNote, 'id'>) => {
    if (!selectedTrack) return;
    updateTrack(selectedTrack.id, { notes: appendTabNote(selectedTrack, created) });
  }, [selectedTrack, updateTrack]);

  const handleUpdate = useCallback((id: string, changes: Partial<TabNote>) => {
    if (!selectedTrack) return;
    const notes = applyTabNoteChange(selectedTrack, id, changes);
    if (notes === selectedTrack.notes) return;
    updateTrack(selectedTrack.id, { notes });
  }, [selectedTrack, updateTrack]);

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
      updateTrack(selectedTrack.id, { notes: working.notes });
    }
  }, [selectedTrack, updateTrack]);

  const handleCreateMany = useCallback((created: Omit<TabNote, 'id'>[]) => {
    if (!selectedTrack) return;
    let notes = selectedTrack.notes;
    for (const note of created) notes = appendTabNote({ ...selectedTrack, notes }, note);
    updateTrack(selectedTrack.id, { notes });
  }, [selectedTrack, updateTrack]);

  const handleDelete = useCallback((id: string) => {
    if (!selectedTrack) return;
    // Deleting shifts every later note's positional id, so the current selection can't
    // survive it — see the identity note in `studioNotes.ts`.
    setSelectedNoteId(null);
    updateTrack(selectedTrack.id, { notes: removeTabNote(selectedTrack, id) });
  }, [selectedTrack, updateTrack]);

  const handleConvert = useCallback((trackId: string) => {
    if (!project) return;
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return;

    const result = convertTrackToRecording(project, track);
    if (!result) {
      setNotice(`"${track.name}" has no notes long enough to play on a harmonica.`);
      return;
    }

    saveRecording(result.recording);
    // Straight into the tab editor with it — conversion producing a library entry the user
    // then has to go and find would bury the result of the thing they just asked for.
    loadRecording(result.recording);
    router.push('/edit');
  }, [project, saveRecording, loadRecording]);

  const handleExportAll = useCallback(() => {
    if (!project) return;
    const converted = convertAllTracks(project);
    if (converted.length === 0) {
      setNotice('No track in this project has notes a harmonica could play.');
      return;
    }

    const { content, encoding, ext, mimeType } = generateForFormat(
      converted.map((c) => ({
        name:          c.recording.title,
        key:           c.key,
        harmonicaType: c.recording.harmonicaType,
        notes:         c.recording.tabNotes,
      })),
      exportFormat,
    );

    const safeTitle = project.title.replace(/[^\w-]+/g, '_').slice(0, 60) || 'harp2tab_project';
    triggerWebDownload(contentToBlob(content, encoding, mimeType), `${safeTitle}.${ext}`);
    setNotice(`Exported ${converted.length} track${converted.length === 1 ? '' : 's'} as ${exportFormat}.`);
  }, [project, exportFormat]);

  // ── Transport, matching the editor's semantics exactly ──────────────────────

  const playOptions = useCallback(
    () => ({ bpm, metronomeEnabled, rate: playback.playbackRate, tempoMap }),
    [bpm, metronomeEnabled, playback.playbackRate, tempoMap],
  );

  function handlePlayToggle() {
    if (playback.isPlaying && !playback.isPaused) { playback.pause(); return; }
    if (playback.isPaused) { playback.resume(); return; }
    playback.play(audibleNotes, playOptions(), playback.currentTimeMs, loopRegion ?? undefined);
  }

  function handleSeek(ms: number) {
    playback.seek(ms);
  }

  function handleSkipBar(direction: 1 | -1) {
    const barMs = barDurationMs(bpm);
    playback.seek(Math.max(0, Math.min(totalTimeMs, playback.currentTimeMs + direction * barMs)));
  }

  function handleCycleRate() {
    const i = PLAYBACK_RATES.indexOf(playback.playbackRate as (typeof PLAYBACK_RATES)[number]);
    playback.setPlaybackRate(PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length]);
  }

  function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
  }

  /** Tempo lives on the project's map, so the transport's BPM stepper edits the map's
   *  opening tempo rather than a scalar the Studio doesn't have. */
  function setProjectBpm(next: number) {
    if (!project) return;
    const clamped = Math.max(20, Math.min(400, Math.round(next)));
    const tempos = project.tempos.length > 0
      ? project.tempos.map((t, i) => (i === 0 ? { ...t, bpm: clamped } : t))
      : [{ timeMs: 0, bpm: clamped }];
    saveProject({ ...project, tempos });
  }

  const setHeaderAction   = useHeaderActionStore((s) => s.setHeaderAction);
  const clearHeaderAction = useHeaderActionStore((s) => s.clearHeaderAction);
  useEffect(() => {
    setHeaderAction({
      icon:    'share-outline',
      label:   `Export ${exportFormat}`,
      onPress: handleExportAll,
      disabled: !project,
    });
    // Cleared on unmount so the button doesn't linger on whatever screen comes next.
    return clearHeaderAction;
  }, [setHeaderAction, clearHeaderAction, handleExportAll, exportFormat, project]);

  if (!project) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No project open</Text>
          <Text style={styles.emptyBody}>Import a MIDI file to start a Studio project.</Text>
          <Pressable style={styles.emptyBtn} onPress={() => router.replace('/')}>
            <Text style={styles.emptyBtnText}>Back to library</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {notice && (
        <Pressable style={styles.notice} onPress={() => setNotice(null)} accessibilityRole="button">
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
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
          onAddTrack={() => {
            const track = createTrack(project.tracks.length);
            saveProject({ ...project, tracks: [...project.tracks, track] });
            setSelectedTrackId(track.id);
          }}
          onDeleteTrack={(id) => {
            if (project.tracks.length <= 1) return;
            saveProject({ ...project, tracks: project.tracks.filter((t) => t.id !== id) });
            if (selectedTrackId === id) setSelectedTrackId(null);
          }}
          collapsed={tracksCollapsed}
          onToggleCollapsed={() => setTracksCollapsed((v) => !v)}
          onConvert={handleConvert}
        />

        <View style={styles.rollWrap}>
          {selectedTrack ? (
            <PianoRoll
              notes={editableNotes}
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
              isPlaying={playback.isPlaying}
              currentTimeMs={playback.currentTimeMs}
              onSeek={handleSeek}
              loopRegion={loopRegion}
              onLoopRegionChange={setLoopRegion}
              headerLeft={
                <View style={styles.rollHeader}>
                  <Text style={styles.rollTitle} numberOfLines={1}>{project.title}</Text>
                  <Text style={styles.rollSubtitle} numberOfLines={1}>
                    {tracks.length} track{tracks.length === 1 ? '' : 's'}
                    {selectedTrack ? ` · ${selectedTrack.name} (${instrumentName(selectedTrack.program)})` : ''}
                  </Text>
                </View>
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
        tabNotesLength={audibleNotes.length}
        isPlaying={playback.isPlaying}
        isPaused={playback.isPaused}
        onPlayToggle={handlePlayToggle}
        onStop={playback.stop}
        onSkipBack={() => handleSkipBar(-1)}
        onSkipForward={() => handleSkipBar(1)}
        currentTimeMs={playback.currentTimeMs}
        totalTimeMs={totalTimeMs}
        formatElapsed={formatElapsed}
        loopEnabled={playback.loopEnabled}
        onToggleLoop={() => playback.setLoopEnabled(!playback.loopEnabled)}
        playbackRate={playback.playbackRate}
        onCycleRate={handleCycleRate}
        bpm={bpm}
        setBpm={setProjectBpm}
        metronomeEnabled={metronomeEnabled}
        onToggleMetronome={() => setMetronomeEnabled((v) => !v)}
        containerStyle={styles.transportBar}
        compact
        theme={theme}
        styles={editStyles}
      />
    </SafeAreaView>
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
    rollTitle:    { fontFamily: Poppins.bold, fontSize: 14, color: t.textPrimary },
    rollSubtitle: { fontFamily: SpaceGrotesk.regular, fontSize: 11, color: t.textMuted },
    notice: {
      marginHorizontal: 16,
      marginTop: 8,
      padding: 10,
      borderRadius: 8,
      backgroundColor: t.warningSoft,
      borderWidth: 1,
      borderColor: t.warning,
    },
    noticeText: { fontFamily: SpaceGrotesk.regular, fontSize: 13, color: t.textPrimary },
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
