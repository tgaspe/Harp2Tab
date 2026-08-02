import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { TrackList } from '@/components/TrackList';
import { audibleTracks, instrumentName } from '@/audio/studioTracks';
import { PianoRoll } from '@/components/PianoRoll';
import { getChromaticRows } from '@/audio/HarmonicaMapper';
import { tempoMapOf } from '@/audio/midiProject';
import {
  appendTabNote,
  applyTabNoteChange,
  removeTabNote,
  trackToTabNotes,
} from '@/audio/studioNotes';
import { convertTrackToRecording } from '@/audio/convertTrack';
import { useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { useRecordingsStore } from '@/store/useRecordingsStore';
import { useAppStore } from '@/store/useAppStore';
import { usePlayback } from '@/hooks/usePlayback';
import { useTheme } from '@/hooks/useTheme';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import type { Theme } from '@/theme';
import type { MidiTrackData, TabNote } from '@/types';

/**
 * The MIDI Studio — the stage *before* the tab editor.
 *
 * Music here is many tracks at full pitch range with no instrument attached; the harmonica
 * only enters at the conversion boundary (`convertTrackToRecording`). That separation is
 * what lets this screen reuse `PianoRoll` wholesale: the roll indexes rows positionally and
 * knows nothing about what a row means, so handing it a chromatic ladder and a project's
 * notes needs no harmonica-aware branch anywhere in it.
 */
export default function StudioScreen() {
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const projects    = useMidiProjectsStore((s) => s.projects);
  const saveProject = useMidiProjectsStore((s) => s.saveProject);
  const saveRecording = useRecordingsStore((s) => s.saveRecording);
  const loadRecording = useAppStore((s) => s.loadRecording);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? projects[0] ?? null,
    [projects, projectId],
  );

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId]   = useState<string | null>(null);
  const [loopRegion, setLoopRegion] = useState<{ startMs: number; endMs: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const playback = usePlayback();

  const tracks = project?.tracks ?? [];
  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? tracks[0] ?? null;

  // Full MIDI range — the Studio has no instrument, so nothing narrows it.
  const rows = useMemo(() => getChromaticRows(), []);
  const tempoMap = useMemo(
    () => (project ? tempoMapOf(project) : undefined),
    [project],
  );

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

  const handleSeek = useCallback((ms: number) => {
    playback.seek(ms);
  }, [playback]);

  /**
   * Everything audible, merged into one sequence.
   *
   * Merged rather than one scheduler per track because `usePlayback` schedules a flat note
   * list and reads the last element to know when the sequence ends — so the tracks have to
   * be interleaved by time, not concatenated. Mute and solo are resolved here, which is the
   * point of having them: auditioning one part against the rest is how you find the melody.
   */
  const audibleNotes = useMemo(() => {
    const merged = audibleTracks(tracks).flatMap((t) => trackToTabNotes(t));
    return merged.sort((a, b) => a.start_time - b.start_time);
  }, [tracks]);

  const handleTogglePlay = useCallback(() => {
    if (playback.isPlaying) {
      playback.stop();
      return;
    }
    playback.play(audibleNotes, {
      bpm: project?.tempos[0]?.bpm ?? 120,
      metronomeEnabled: false,
      // The map, not just the opening BPM — a metronome or any tempo-aware scheduling has
      // to follow the file's changes rather than assume the first tempo holds throughout.
      tempoMap,
    });
  }, [playback, audibleNotes, project, tempoMap]);

  if (!project) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No project open</Text>
          <Text style={styles.emptyBody}>
            Import a MIDI file to start a Studio project.
          </Text>
          <Pressable style={styles.emptyBtn} onPress={() => router.replace('/')}>
            <Text style={styles.emptyBtnText}>Back to library</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.replace('/')}
          accessibilityRole="button"
          accessibilityLabel="Back to library"
          style={styles.backBtn}
        >
          <Text style={styles.backText}>‹ Library</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{project.title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {tracks.length} track{tracks.length === 1 ? '' : 's'}
            {selectedTrack ? ` · editing ${selectedTrack.name} (${instrumentName(selectedTrack.program)})` : ''}
          </Text>
        </View>

        <Pressable
          onPress={handleTogglePlay}
          disabled={audibleNotes.length === 0}
          style={[styles.transportBtn, audibleNotes.length === 0 && styles.transportBtnDisabled]}
          accessibilityRole="button"
          accessibilityState={{ disabled: audibleNotes.length === 0 }}
          accessibilityLabel={playback.isPlaying ? 'Stop playback' : 'Play all audible tracks'}
        >
          <Text style={styles.transportText}>{playback.isPlaying ? '■ Stop' : '▶ Play'}</Text>
        </Pressable>
      </View>

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
              backgroundLanes={backgroundLanes}
              bpm={project.tempos[0]?.bpm ?? 120}
              tempoMap={tempoMap}
              selectedId={selectedNoteId}
              onSelect={setSelectedNoteId}
              onCreate={handleCreate}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              isPlaying={playback.isPlaying}
              currentTimeMs={playback.currentTimeMs}
              onSeek={handleSeek}
              loopRegion={loopRegion}
              onLoopRegionChange={setLoopRegion}
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>This project has no tracks</Text>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    backBtn: { paddingVertical: 4, paddingHorizontal: 6 },
    backText: { fontFamily: Poppins.bold, fontSize: 13, color: t.accent },
    headerText: { flex: 1, minWidth: 0 },
    title:    { fontFamily: Poppins.bold, fontSize: 16, color: t.textPrimary },
    subtitle: { fontFamily: SpaceGrotesk.regular, fontSize: 12, color: t.textMuted },
    transportBtn: {
      paddingHorizontal: 14, paddingVertical: 7,
      borderRadius: 8,
      backgroundColor: t.accentSoft,
      borderWidth: 1, borderColor: t.accentDim,
    },
    transportBtnDisabled: { opacity: 0.4 },
    transportText: { fontFamily: Poppins.bold, fontSize: 13, color: t.accent },
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
    body: { flex: 1, flexDirection: 'row' },
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
