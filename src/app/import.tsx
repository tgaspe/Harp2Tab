/**
 * The screen between picking a file and landing in the editor, for both upload paths.
 *
 * Audio and MIDI share it deliberately: the two differ only in how a file becomes timed
 * pitches (decode + pitch detection vs. a parse), and are identical either side of that —
 * same session gate, same filename-as-title, same progress reporting, same error handling.
 *
 * What differs now is whether there's anything left to ask. Audio has nothing: it hands the
 * transcription to the Studio, where the user reviews the notes and picks a harp at the
 * moment of conversion. MIDI still asks which track to transcribe, because a MIDI file is an
 * arrangement and that answer isn't in it — and from there offers both the Studio and a
 * direct route to tabs.
 */

import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { WEB_CONTENT_WIDTH, webMaxWidth } from '@/constants/layout';
import { useTheme } from '@/hooks/useTheme';
import { AudioImportError, type ImportErrorCode } from '@/audio/audioImport';
import { CandidateKeyBadge, CandidateList, CandidateRow } from '@/components/CandidateRow';
import { KeyCandidateList, positionLabel, techniqueSuffix } from '@/components/KeyCandidateList';
import { DEFAULT_ALGORITHM_ID } from '@/audio/algorithms';
import type { TranscriptionOutput } from '@/audio/algorithms';
import { pushFrames } from '@/audio/frameBuffer';
import { clearPendingImport, getPendingImport, setPendingImport } from '@/audio/pendingImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { pickMidiFile } from '@/audio/pickMidiFile';
import { framesToNotes } from '@/audio/framesToNotes';
import { midiToNoteName, noteNameToMidi } from '@/audio/HarmonicaMapper';
import { usePlayback } from '@/hooks/usePlayback';
import {
  MIN_NOTE_MS,
  mergeTracks,
  mostMelodicTrack,
  pitchRangeLabel,
  reduceToMonophonic,
  type MidiNote,
  type ParsedMidi,
} from '@/audio/midiToNotes';
import {
  notesToTabs,
  rankKeysForMidi,
  shiftMidiNotes,
  type MidiKeyRanking,
} from '@/audio/notesToTabs';
import { octaveShiftForMidiRange } from '@/audio/pitchRange';
import { runAudioImport, type ImportStage } from '@/audio/runAudioImport';
import { runMidiImport, type MidiImportResult } from '@/audio/runMidiImport';
import { projectFromMidiNotes, projectFromSmfBytes } from '@/audio/midiProject';
import { useMidiProjectsStore } from '@/store/useMidiProjectsStore';
import { selectHarmonicaType, selectKey, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Which track the user is transcribing — a track's own id, or the explicit merge-all
 *  option. Never inferred: which part belongs on a harmonica is a musical choice the file
 *  doesn't encode. */
type TrackSelection = number | 'all';

/**
 * Audio has no confirm phase: it transcribes and goes straight to the Studio, because the
 * only question it used to ask here — which harp — is now asked at conversion, where it
 * decides something. MIDI still confirms, since which track to transcribe is a question the
 * file genuinely doesn't answer.
 */
type Phase =
  | { kind: 'working'; stage: ImportStage; fraction: number }
  | { kind: 'midiConfirm'; parsed: MidiImportResult; selection: TrackSelection; chosenKey: HarmonicaKey }
  | { kind: 'error';   code: ImportErrorCode; message: string };

/** How many candidate keys the confirm step offers. The winner plus the two next-best,
 *  which in practice is straight harp plus the cross-harp positions around it. */
const ALTERNATES_SHOWN = 3;

function durationLabel(ms: number): string {
  const total   = Math.round(ms / 1000);
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * The whole MIDI pipeline downstream of the track choice: reduce to one voice, fit the
 * register, score every harp. Pure and cheap — no DSP is involved, just `noteToTab` over a
 * few hundred notes — which is what lets the key scores re-compute live as the user moves
 * between tracks, and why the two lists can sit on one screen rather than two.
 */
function analyzeSelection(
  parsed: ParsedMidi,
  selection: TrackSelection,
  harmonicaType: HarmonicaType,
): { notes: MidiNote[]; ranking: MidiKeyRanking } {
  const raw = selection === 'all'
    ? mergeTracks(parsed.tracks)
    : parsed.tracks.find((t) => t.id === selection)?.notes ?? [];

  const reduced = reduceToMonophonic(raw);
  // Fold first: a part sitting two octaves below the harp is a register problem, fixed for
  // the whole piece. Only what's still unmapped afterwards is genuinely unplayable.
  const shift = octaveShiftForMidiRange(reduced.map((n) => n.midi));
  const notes = shiftMidiNotes(reduced, shift);

  return { notes, ranking: rankKeysForMidi(notes, harmonicaType, shift) };
}

/**
 * A whole track as playable notes, for the audition button.
 *
 * Plays in full rather than as a clip: which part belongs on a harmonica is a judgement
 * about the part, and a melody that only distinguishes itself in the second half would be
 * indistinguishable from the countermelody in a fixed-length excerpt. Pressing the button
 * again stops it, so length costs nothing.
 *
 * Deliberately the track *as the file has it* — chords intact, at its own pitch, before
 * monophonic reduction or the octave fold. The question this answers is "which part is
 * this?", and a part is easiest to recognise as it was written; what the import will
 * actually produce is what the key list below it describes. Timed from the track's first
 * note so a part that enters late doesn't open with silence.
 */
function previewNotes(notes: MidiNote[]): TabNote[] {
  if (notes.length === 0) return [];
  const start = Math.min(...notes.map((n) => n.timeMs));
  // Sorted because the merged option flat-maps whole tracks together: playback reads the
  // last element to know when the sequence ends, which would otherwise be whichever note
  // happened to close the final track rather than the latest note in the file.
  return [...notes].sort((a, b) => a.timeMs - b.timeMs).map((n, i) => ({
    id:         `preview-${i}`,
    // Playback resolves pitch from `note`, never from `tab`, so this needs no harmonica
    // mapping at all — which is the point, since the harp isn't chosen yet.
    tab:        '',
    note:       midiToNoteName(n.midi),
    start_time: Math.round(n.timeMs - start),
    duration:   Math.max(1, Math.round(n.durationMs)),
    confidence: 100,
  }));
}

/** Decoding has no measurable progress of its own, so it holds a small non-zero bar —
 *  enough to read as "started", not enough to imply real progress it can't report. */
const DECODE_BAR_FRACTION = 0.06;

export default function ImportScreen() {
  const router = useRouter();
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Set by whichever Home button opened this screen; absent means the audio path.
  const isMidi = useLocalSearchParams<{ kind?: string }>().kind === 'midi';

  const selectedKey    = useAppStore(selectKey);
  const harmonicaType  = useAppStore(selectHarmonicaType);
  const startImportedSession = useAppStore((s) => s.startImportedSession);
  const selectKey_           = useAppStore((s) => s.selectKey);
  const addTabNotes          = useAppStore((s) => s.addTabNotes);
  const setBpm               = useAppStore((s) => s.setBpm);
  const incrementRecordingCount = useSettingsStore((s) => s.incrementRecordingCount);
  const saveProject             = useMidiProjectsStore((s) => s.saveProject);

  const [phase, setPhase] = useState<Phase>({ kind: 'working', stage: 'decoding', fraction: 0 });
  const [fileName, setFileName] = useState(getPendingImport()?.name ?? '');

  // Self-contained playback for the track previews — this hook instance takes its notes as
  // an argument, so auditioning a track can't touch the session being imported into.
  const preview = usePlayback();
  const [previewTrack, setPreviewTrack] = useState<TrackSelection | null>(null);

  const cancelledRef = useRef(false);
  // Guards against a second run in React strict mode's double-invoked effect — the import
  // is expensive and would otherwise be started twice for one file.
  const startedRef   = useRef(false);

  useEffect(() => {
    // Re-armed on every mount, not just the first: React strict mode mounts, unmounts and
    // remounts, and the unmount cleanup below sets the cancel flag. Without re-arming here
    // the already-running import would see that flag and abort itself.
    cancelledRef.current = false;

    if (!startedRef.current) {
      startedRef.current = true;

      const picked = getPendingImport();
      if (!picked || !selectedKey) {
        router.replace('/');
        return;
      }
      void transcribe();
    }

    // Leaving the screen (browser back, or any other navigation) abandons the import
    // rather than letting it finish and yank the user into the editor — and silences any
    // track preview still running, which would otherwise outlive the screen.
    return () => {
      cancelledRef.current = true;
      preview.stop();
    };
  }, []);

  // A track that runs to its end stops itself; clearing the highlight when it does keeps
  // the button from staying stuck on "stop" for a track that's no longer sounding.
  useEffect(() => {
    if (!preview.isPlaying) setPreviewTrack(null);
  }, [preview.isPlaying]);

  // Everything downstream of the current track choice. Recomputed on every selection
  // change, which is what makes the key list live evidence that the track was the right
  // one rather than a stale score from whatever was picked first.
  const midiAnalysis = useMemo(
    () => (phase.kind === 'midiConfirm'
      ? analyzeSelection(phase.parsed, phase.selection, harmonicaType)
      : null),
    [phase, harmonicaType],
  );

  async function transcribe() {
    if (isMidi) { await parseMidi(); return; }
    await transcribeAudio();
  }

  /** MIDI's whole "working" stage: read the bytes, parse them. Milliseconds, so the
   *  progress screen flashes past rather than reporting a fraction it doesn't have. */
  async function parseMidi() {
    const picked = getPendingImport();
    if (!picked || !selectedKey) return;

    cancelledRef.current = false;
    setFileName(picked.name);
    setPhase({ kind: 'working', stage: 'decoding', fraction: 0 });

    const title = picked.name.replace(/\.[^.]+$/, '');
    startImportedSession(title, 'midiUpload');

    try {
      const parsed = await runMidiImport(picked);
      if (cancelledRef.current) return;

      const selection = mostMelodicTrack(parsed.tracks).id;
      const { ranking } = analyzeSelection(parsed, selection, harmonicaType);
      setPhase({
        kind:      'midiConfirm',
        parsed,
        selection,
        // Diatonic gets the best-scoring harp pre-selected; chromatic covers every semitone
        // anyway, so the key the user already chose stands and no list is shown.
        chosenKey: harmonicaType === 'chromatic' ? selectedKey : ranking.ranked[0].key,
      });
    } catch (err) {
      showImportError(err, picked.name, `"${picked.name}" couldn't be imported.`);
    }
  }

  async function transcribeAudio() {
    const picked = getPendingImport();
    if (!picked || !selectedKey) return;

    cancelledRef.current = false;
    setFileName(picked.name);
    setPhase({ kind: 'working', stage: 'decoding', fraction: 0 });

    // The filename makes a far better default library title than the timestamp fallback.
    const title = picked.name.replace(/\.[^.]+$/, '');
    // Deliberately *not* `startImportedSession` here, unlike the MIDI path. That clears
    // `tabNotes`/`history`, which was harmless while an audio import went on to replace them
    // — but this one lands in the Studio and never touches the tab session, so starting one
    // would destroy whatever the user had open in the editor and put nothing in its place.
    // Conversion calls `loadRecording`, which establishes the session properly.

    try {
      const result = await runAudioImport({
        picked,
        harmonicaType,
        algorithm:     DEFAULT_ALGORITHM_ID,
        onProgress:    (p) => setPhase({ kind: 'working', stage: p.stage as ImportStage, fraction: p.fraction }),
        shouldCancel:  () => cancelledRef.current,
      });

      // Straight into the Studio. There is no key step here any more: the key is chosen at
      // conversion, where it actually decides something, so confirming one before the user
      // has seen a single note would be asking about a decision that hasn't arrived yet.
      openStudioFromAudio(result.output, result.detection?.best.key ?? selectedKey, title);
    } catch (err) {
      showImportError(err, picked.name, `"${picked.name}" couldn't be transcribed.`);
    }
  }

  /** One place that turns a thrown import failure into either a bounce back to Home (the
   *  user cancelled) or the error phase, so both pipelines report failures the same way. */
  function showImportError(err: unknown, name: string, fallbackMessage: string) {
    const isImportError = err instanceof AudioImportError;
    const code    = isImportError ? err.code : 'decodeFailed';
    const message = isImportError ? err.message : fallbackMessage;

    if (code === 'cancelled') {
      clearPendingImport();
      router.replace('/');
      return;
    }
    setPhase({ kind: 'error', code, message });
  }

  /**
   * Hand a finished transcription to the Studio.
   *
   * Audio lands in the Studio rather than the tab editor because a transcription is a draft,
   * not a finished tab: the user should be able to see and fix what the engine heard before
   * it is fitted onto a harmonica. This is `openInStudio`'s counterpart for audio, and like
   * it consumes no free-tier session — nothing has been converted yet, and the gate applies
   * at conversion, where a tab is actually produced.
   *
   * `segmentationKey` matters only to the frame lane. NoteDetector segments on *tab
   * identity*, so frames cannot become notes without some key; the auto-detected one is used
   * as a provisional choice and the real decision still happens at conversion. Re-keying
   * there re-maps pitches but does not re-segment, which is a real if minor cost, and it is
   * paid on native only — the neural engine is web-only and its lane is already pitched.
   */
  function openStudioFromAudio(
    output: TranscriptionOutput,
    segmentationKey: HarmonicaKey,
    title: string,
  ) {
    const notes: MidiNote[] = output.kind === 'notes'
      ? output.notes
      : framesToNotes(output.frames, segmentationKey, harmonicaType).flatMap((n) => {
          const midi = noteNameToMidi(n.note);
          // A pitch that doesn't parse is dropped rather than written as middle C, the same
          // rule MIDI export applies — silently altering the music is the worse failure.
          return midi === null ? [] : [{
            midi,
            timeMs:     n.start_time,
            durationMs: n.duration,
            velocity:   n.velocity,
          }];
        });

    if (notes.length === 0) {
      setPhase({
        kind:    'error',
        code:    'noAudio',
        message: `No notes were found in "${title}". Try a recording with a clearer melody line.`,
      });
      return;
    }

    const project = projectFromMidiNotes(notes, title || 'Untitled project', {
      velocitySource: output.kind === 'frames' ? 'takeRelativeRms' : 'modelActivation',
    });

    // Parked under the *project* id, because this session has no recording id yet —
    // conversion mints one and copies these onto the tab it produces. The neural engine
    // produces no frames at all, so a web import has nothing to inspect and Frame Inspector
    // says so from the session's source rather than drawing an empty timeline.
    if (output.kind === 'frames') pushFrames(project.id, output.frames);

    saveProject(project);
    clearPendingImport();
    router.replace({ pathname: '/studio', params: { projectId: project.id } });
  }

  /** MIDI's sibling of `commit`. No frames are retained — a MIDI import has no audio to
   *  inspect at all, which Frame Inspector reports via the session's `source`. */
  /**
   * Take the file into the Studio instead of straight to tabs.
   *
   * Built from the original bytes rather than from `parsed`, because the two answer
   * different questions: `parseMidiFile` drops percussion and note-less tracks since they
   * can't become a harmonica part, while the Studio is an editor and has to show every
   * track the file declares.
   *
   * Deliberately doesn't consume a free-tier session or touch the tab session — nothing has
   * been transcribed yet. The gate applies at conversion, where a tab is actually produced.
   */
  function openInStudio() {
    if (phase.kind !== 'midiConfirm') return;
    preview.stop();

    const project = projectFromSmfBytes(
      phase.parsed.bytes,
      fileName.replace(/\.[^.]+$/, '') || 'Untitled project',
    );
    saveProject(project);
    clearPendingImport();
    router.replace({ pathname: '/studio', params: { projectId: project.id } });
  }

  function commitMidi(notes: MidiNote[], key: HarmonicaKey, bpm: number | null) {
    preview.stop();
    const tabbed = notesToTabs(notes, key, harmonicaType, 'midiVelocity');
    if (tabbed.length === 0) {
      setPhase({
        kind:    'error',
        code:    'noAudio',
        message: 'That track has no notes long enough to play. Try another track, or the merged option.',
      });
      return;
    }

    selectKey_(key);
    // Set before the notes land: setBpm re-times whatever is already in the session to keep
    // its bar positions, which would drag these notes off the timings the file states.
    if (bpm) setBpm(Math.round(bpm));
    addTabNotes(tabbed);

    // The free-tier session is consumed here, on success — not when the file was picked.
    incrementRecordingCount();

    clearPendingImport();
    router.replace('/edit');
  }

  /** Audition a track without committing to it. Pressing the same one again stops it. */
  function handleTogglePreview(id: TrackSelection, notes: MidiNote[]) {
    if (previewTrack === id && preview.isPlaying) {
      preview.stop();
      setPreviewTrack(null);
      return;
    }
    const audible = previewNotes(notes);
    if (audible.length === 0) return;
    setPreviewTrack(id);
    preview.play(audible, { bpm: 100, metronomeEnabled: false, rate: 1 });
  }

  function handleCancel() {
    cancelledRef.current = true;
    preview.stop();
    clearPendingImport();
    router.replace('/');
  }

  async function handleTryAnotherFile() {
    // Opened from a real press, so the browser's file dialog is allowed here.
    try {
      const picked = await (isMidi ? pickMidiFile() : pickAudioFile());
      if (!picked) return;
      setPendingImport(picked);
      void transcribe();
    } catch (err) {
      const isImportError = err instanceof AudioImportError;
      setPhase({
        kind:    'error',
        code:    isImportError ? err.code : 'decodeFailed',
        message: isImportError ? err.message : "That file couldn't be opened.",
      });
    }
  }

  if (phase.kind === 'midiConfirm') {
    const { parsed, selection, chosenKey } = phase;
    // The memo is always populated in this phase; the fallback only exists so the branch
    // doesn't have to be conditional on it and leave the working phase unreachable to TS.
    const { notes, ranking } = midiAnalysis ?? analyzeSelection(parsed, selection, harmonicaType);

    // One note-bearing track means the question has one possible answer — that's friction,
    // not control. The chosen track still appears below as a stated fact.
    const showTracks     = parsed.tracks.length > 1;
    // Chromatic covers every semitone in its range, so all 12 keys score identically and a
    // key list would carry no information — the key picked on Home stands.
    const showKeys       = harmonicaType === 'diatonic';
    const candidates     = ranking.ranked.slice(0, ALTERNATES_SHOWN);
    const unplayable     = ranking.unplayableByKey[chosenKey] ?? 0;
    const selectedTrack  = selection === 'all'
      ? null
      : parsed.tracks.find((t) => t.id === selection);

    // Two distinct dead ends, worth separating because the fix differs. Nothing survived
    // reduction at all (every note too short to articulate) — a different track is the only
    // way forward. Or notes survived but none of them sits anywhere on this harp, in which
    // case the key list above is the fix and continuing would land an editor full of tabs
    // the user can't play.
    const nothingToPlay  = notes.length === 0;
    const nothingMapped  = !nothingToPlay && unplayable === notes.length;
    const bestKeyMaps    = showKeys
      ? ranking.ranked.find((c) => (ranking.unplayableByKey[c.key] ?? 0) < notes.length)?.key
      : undefined;

    /** Play/stop control for one row. Auditioning a part is not the same as choosing it,
     *  so the press is kept from reaching the row's own selection handler. */
    function previewButton(id: TrackSelection, trackNotes: MidiNote[], label: string) {
      const playing = previewTrack === id && preview.isPlaying;
      return (
        <Pressable
          onPress={(e) => { e.stopPropagation(); handleTogglePreview(id, trackNotes); }}
          style={({ pressed, hovered }: any) => [
            styles.previewBtn,
            playing && styles.previewBtnActive,
            (pressed || hovered) && styles.previewBtnHovered,
          ]}
          accessibilityRole="button"
          accessibilityLabel={playing ? `Stop preview of ${label}` : `Preview ${label}`}
        >
          <Ionicons
            name={playing ? 'stop' : 'play'}
            size={13}
            color={playing ? theme.accent : theme.textSub}
          />
        </Pressable>
      );
    }

    function chooseTrack(next: TrackSelection) {
      // A preview of the part you just moved away from would only be confusing.
      preview.stop();
      setPreviewTrack(null);
      // Re-scored for the new track, and the best harp for it becomes the pre-selection —
      // the key list is evidence about the track, so it can't be left showing the old one's.
      const rescored = analyzeSelection(parsed, next, harmonicaType);
      setPhase({
        kind:      'midiConfirm',
        parsed,
        selection: next,
        chosenKey: harmonicaType === 'chromatic' ? chosenKey : rescored.ranking.ranked[0].key,
      });
    }

    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.iconCircle}>
            <Ionicons name="musical-note-outline" size={30} color={theme.accent} />
          </View>

          <Text style={styles.title}>
            {showTracks ? 'Choose what to transcribe' : 'Ready to import'}
          </Text>
          <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
          <Text style={styles.message}>
            {selectedTrack
              ? `${selectedTrack.name} — ${notes.length} note${notes.length === 1 ? '' : 's'} after collapsing chords to a single line.`
              : `All tracks merged — ${notes.length} note${notes.length === 1 ? '' : 's'} after collapsing to a single line.`}
          </Text>

          {showTracks && (
            <>
              <Text style={styles.sectionLabel}>TRACK</Text>
              <CandidateList>
                {parsed.tracks.map((track) => {
                  // Playing in full means a row can be sounding for minutes; the elapsed
                  // readout is what tells the user it's progressing rather than stuck.
                  const playing = previewTrack === track.id && preview.isPlaying;
                  return (
                    <CandidateRow
                      key={track.id}
                      leading={previewButton(track.id, track.notes, track.name)}
                      title={track.name}
                      subtitle={
                        `${track.noteCount} notes · ${pitchRangeLabel(track)} · `
                        + (playing
                          ? `${durationLabel(preview.currentTimeMs)} / ${durationLabel(track.durationMs)}`
                          : durationLabel(track.durationMs))
                      }
                      selected={selection === track.id}
                      onPress={() => chooseTrack(track.id)}
                      accessibilityLabel={`${track.name}, ${track.noteCount} notes, ${pitchRangeLabel(track)}, ${durationLabel(track.durationMs)}`}
                    />
                  );
                })}

                <CandidateRow
                  leading={previewButton('all', mergeTracks(parsed.tracks), 'all tracks merged')}
                  title="All tracks merged"
                  subtitle={
                    previewTrack === 'all' && preview.isPlaying
                      ? `${durationLabel(preview.currentTimeMs)} / ${durationLabel(parsed.durationMs)}`
                      : 'Keeps the highest note wherever parts overlap'
                  }
                  selected={selection === 'all'}
                  onPress={() => chooseTrack('all')}
                  accessibilityLabel="All tracks merged — keeps the highest note wherever parts overlap"
                />
              </CandidateList>
              <Text style={styles.listHint}>
                Press ▶ to hear a part in full before choosing it — press again to stop.
              </Text>
            </>
          )}

          {/* With nothing left after reduction there is no material to score, and every key
              would claim a perfect fit for zero notes. */}
          {showKeys && !nothingToPlay && (
            <>
              <Text style={styles.sectionLabel}>TARGET HARMONICA</Text>
              <KeyCandidateList
                candidates={candidates}
                selectedKey={chosenKey}
                onSelect={(key) => setPhase({ ...phase, chosenKey: key })}
                describe={(candidate) => {
                  const unreachable = ranking.unplayableByKey[candidate.key] ?? 0;
                  return {
                    stats: (unreachable === 0 ? 'every note reachable' : `${unreachable} not reachable`)
                      + techniqueSuffix(candidate),
                    accessibilityLabel: `${candidate.key} harmonica, ${positionLabel(candidate.position)}, ${unreachable} note${unreachable === 1 ? '' : 's'} not reachable`,
                  };
                }}
              />
            </>
          )}

          {ranking.octaveShiftSemitones !== 0 && (
            <View style={styles.noticeRow}>
              <Ionicons name="swap-vertical-outline" size={14} color={theme.warning} />
              <Text style={styles.noticeText}>
                Transposed {ranking.octaveShiftSemitones > 0 ? 'up' : 'down'}{' '}
                {Math.abs(ranking.octaveShiftSemitones) / 12} octave
                {Math.abs(ranking.octaveShiftSemitones) === 12 ? '' : 's'} to fit the harmonica&apos;s range.
              </Text>
            </View>
          )}

          {nothingToPlay && (
            <View style={styles.alertRow} accessibilityRole="alert">
              <Ionicons name="alert-circle" size={14} color={theme.warning} />
              <Text style={styles.noticeText}>
                Nothing in {selectedTrack ? `“${selectedTrack.name}”` : 'this file'} is long enough
                to play — every note is under {MIN_NOTE_MS}ms.
                {showTracks ? ' Try another track above.' : ''}
              </Text>
            </View>
          )}

          {nothingMapped && (
            <View style={styles.alertRow} accessibilityRole="alert">
              <Ionicons name="alert-circle" size={14} color={theme.warning} />
              <Text style={styles.noticeText}>
                None of these {notes.length} notes can be played on a {chosenKey} harp
                {bestKeyMaps && bestKeyMaps !== chosenKey
                  ? ` — try ${bestKeyMaps} instead.`
                  : showTracks
                    ? ', on any key. This part is probably outside a harmonica\'s range — try another track above.'
                    : ', on any key. This part is probably outside a harmonica\'s range.'}
                {' '}Continuing gives you the pitches without tabs, to edit by hand.
              </Text>
            </View>
          )}

          {unplayable > 0 && !nothingMapped && (
            <View style={styles.noticeRow}>
              <Ionicons name="alert-circle-outline" size={14} color={theme.warning} />
              <Text style={styles.noticeText}>
                {unplayable} note{unplayable === 1 ? '' : 's'} can&apos;t be played on a {chosenKey}{' '}
                harp. {unplayable === 1 ? 'It keeps its' : 'They keep their'} pitch and{' '}
                {unplayable === 1 ? 'arrives' : 'arrive'} in the editor without a tab, so you can
                replace or remove {unplayable === 1 ? 'it' : 'them'}.
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={() => commitMidi(notes, chosenKey, parsed.bpm)}
              // Nothing playable at all is the one state where continuing has no possible
              // outcome — an empty editor. An unmappable-but-present part still commits,
              // since the pitches are real and editable.
              disabled={nothingToPlay}
              style={({ pressed, hovered }: any) => [
                styles.primaryBtn,
                nothingToPlay && styles.primaryBtnDisabled,
                (pressed || hovered) && !nothingToPlay && styles.primaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: nothingToPlay }}
              accessibilityLabel={`Continue with ${chosenKey} harmonica`}
            >
              <Text style={styles.primaryBtnText}>Continue with {chosenKey}</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </Pressable>

            {/* The Studio is the powerful path, not the default one: someone importing a
                single-track melody shouldn't have to get through a multi-track editor to
                reach their tabs. Offered alongside the direct route, never in place of it.
                Enabled even when nothing maps to a harp — the Studio has no harmonica, so
                "no key fits" says nothing about whether the file is worth opening there. */}
            <Pressable
              onPress={openInStudio}
              style={({ pressed, hovered }: any) => [
                styles.studioBtn,
                (pressed || hovered) && styles.studioBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open this file in the MIDI Studio"
            >
              <Ionicons name="options-outline" size={16} color={theme.accent} />
              <Text style={styles.studioBtnText}>Open in Studio</Text>
            </Pressable>

            <Pressable
              onPress={handleCancel}
              style={({ pressed, hovered }: any) => [
                styles.secondaryBtn,
                (pressed || hovered) && styles.secondaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Discard this import"
            >
              <Text style={styles.secondaryBtnText}>Discard</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (phase.kind === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={styles.iconCircleError}>
            <Ionicons name="alert-circle-outline" size={30} color={theme.warning} />
          </View>
          <Text style={styles.title}>Couldn&apos;t transcribe that file</Text>
          <Text style={styles.message}>{phase.message}</Text>

          <View style={styles.actions}>
            <Pressable
              onPress={handleTryAnotherFile}
              style={({ pressed, hovered }: any) => [
                styles.primaryBtn,
                (pressed || hovered) && styles.primaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Choose another file"
            >
              <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Choose another file</Text>
            </Pressable>

            <Pressable
              onPress={() => { clearPendingImport(); router.replace('/'); }}
              style={({ pressed, hovered }: any) => [
                styles.secondaryBtn,
                (pressed || hovered) && styles.secondaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Back to home"
            >
              <Text style={styles.secondaryBtnText}>Back to home</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const barFraction = phase.stage === 'decoding'
    ? DECODE_BAR_FRACTION
    : Math.max(DECODE_BAR_FRACTION, phase.fraction);
  const percent = Math.round(barFraction * 100);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconCircle}>
          <Ionicons name="musical-notes-outline" size={30} color={theme.accent} />
        </View>

        <Text style={styles.title}>{isMidi ? 'Reading MIDI' : 'Transcribing'}</Text>
        <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>

        {/* Parsing is milliseconds, so MIDI gets no progress bar — a bar that only ever
            flashes past at 100% reports nothing the user can act on. */}
        {!isMidi && (
          <>
            <View
              style={styles.progressTrack}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: percent }}
            >
              <View style={[styles.progressFill, { width: `${percent}%` }]} />
            </View>

            <Text style={styles.stageLabel}>
              {phase.stage === 'decoding'
                ? 'Reading the audio file…'
                : phase.stage === 'loadingModel'
                  // Only the neural engine has this stage, and only on its first run per
                  // session — the model is cached from then on.
                  ? 'Loading the transcription model…'
                  : `Detecting notes — ${percent}%`}
            </Text>
          </>
        )}

        <Text style={styles.hint}>
          {isMidi
            // MIDI states its pitches and timings outright — there is nothing to detect,
            // only a part to choose and a harp to map it onto.
            ? 'Reading the tracks in this file…'
            : harmonicaType === 'chromatic'
              // Detection is skipped for chromatic, so the chosen key is what's used.
              ? `Transcribing for a ${selectedKey} 12-hole chromatic harmonica.`
              : "Pitch detection doesn't need the key — the harmonica key is worked out afterwards."}
        </Text>

        <Pressable
          onPress={handleCancel}
          style={({ pressed, hovered }: any) => [
            styles.secondaryBtn,
            (pressed || hovered) && styles.secondaryBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Cancel transcription"
        >
          <Text style={styles.secondaryBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    safe: {
      flex:            1,
      backgroundColor: theme.bg,
    },
    container: {
      flex:           1,
      alignItems:     'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap:            12,
      ...webMaxWidth(WEB_CONTENT_WIDTH.narrow),
    },
    // The MIDI confirm step can carry two lists at once (tracks, then keys), so unlike the
    // other phases it scrolls rather than centring in the viewport.
    scrollContent: {
      alignItems:        'center',
      paddingHorizontal: 24,
      paddingVertical:   32,
      gap:               10,
      flexGrow:          1,
      justifyContent:    'center',
      ...webMaxWidth(WEB_CONTENT_WIDTH.narrow),
    },
    sectionLabel: {
      alignSelf:     'flex-start',
      fontFamily:    SpaceGrotesk.medium,
      fontSize:      FONT.xs,
      letterSpacing: 1,
      color:         theme.textMuted,
      marginTop:     10,
    },
    iconCircle: {
      width:           64,
      height:          64,
      borderRadius:    32,
      alignItems:      'center',
      justifyContent:  'center',
      backgroundColor: theme.accentSoft,
      marginBottom:    4,
    },
    iconCircleError: {
      width:           64,
      height:          64,
      borderRadius:    32,
      alignItems:      'center',
      justifyContent:  'center',
      backgroundColor: theme.warningSoft,
      marginBottom:    4,
    },
    title: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.lg,
      color:      theme.textPrimary,
    },
    fileName: {
      fontFamily: SpaceGrotesk.regular,
      fontSize:   13,
      color:      theme.textSub,
      maxWidth:   '100%',
    },
    message: {
      fontFamily: Poppins.regular,
      fontSize:   14,
      lineHeight: 21,
      color:      theme.textSub,
      textAlign:  'center',
      marginTop:  2,
    },
    progressTrack: {
      width:           '100%',
      height:          6,
      borderRadius:    3,
      backgroundColor: theme.surfaceAlt,
      overflow:        'hidden',
      marginTop:       14,
    },
    progressFill: {
      height:          '100%',
      borderRadius:    3,
      backgroundColor: theme.accent,
    },
    stageLabel: {
      fontFamily: SpaceGrotesk.medium,
      fontSize:   13,
      color:      theme.textPrimary,
      marginTop:  4,
    },
    hint: {
      fontFamily: Poppins.regular,
      fontSize:   12,
      color:      theme.textMuted,
      textAlign:  'center',
    },
    noticeRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingHorizontal: 10,
      paddingVertical:   8,
      borderRadius:      10,
      backgroundColor:   theme.warningSoft,
      marginTop:         4,
    },
    noticeText: {
      flex:       1,
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      theme.textSub,
    },
    // A louder sibling of noticeRow, for the states where continuing produces nothing
    // usable — same colour family, but bordered so it doesn't read as an aside.
    alertRow: {
      flexDirection:     'row',
      alignItems:        'flex-start',
      gap:               6,
      paddingHorizontal: 10,
      paddingVertical:   9,
      borderRadius:      10,
      borderWidth:       1,
      borderColor:       theme.warning,
      backgroundColor:   theme.warningSoft,
      marginTop:         6,
      width:             '100%',
    },
    listHint: {
      alignSelf:  'flex-start',
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      theme.textMuted,
      marginTop:  6,
    },
    previewBtn: {
      width:           28,
      height:          28,
      borderRadius:    14,
      alignItems:      'center',
      justifyContent:  'center',
      borderWidth:     1,
      borderColor:     theme.border,
      backgroundColor: theme.bg,
    },
    previewBtnActive: {
      borderColor:     theme.accent,
      backgroundColor: theme.accentSoft,
    },
    previewBtnHovered: {
      backgroundColor: theme.surfaceAlt,
    },
    actions: {
      marginTop:  18,
      width:      '100%',
      gap:        10,
      alignItems: 'center',
    },
    primaryBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      width:           '100%',
      paddingVertical: 13,
      borderRadius:    10,
      backgroundColor: theme.accent,
    },
    primaryBtnPressed: {
      backgroundColor: theme.accentDim,
    },
    studioBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      width:           '100%',
      paddingVertical: 12,
      borderRadius:    10,
      backgroundColor: theme.accentSoft,
      borderWidth:     1,
      borderColor:     theme.accentDim,
    },
    studioBtnPressed: {
      backgroundColor: theme.surfaceAlt,
    },
    studioBtnText: {
      fontFamily: Poppins.bold,
      fontSize:   14,
      color:      theme.accent,
    },
    primaryBtnDisabled: {
      backgroundColor: theme.surfaceAlt,
      opacity:         0.7,
    },
    primaryBtnText: {
      fontFamily: Poppins.semiBold,
      fontSize:   14,
      color:      '#fff',
    },
    secondaryBtn: {
      paddingVertical:   11,
      paddingHorizontal: 18,
      borderRadius:      10,
      borderWidth:       1,
      borderColor:       theme.border,
      marginTop:         10,
    },
    secondaryBtnPressed: {
      backgroundColor: theme.surface,
    },
    secondaryBtnText: {
      fontFamily: Poppins.medium,
      fontSize:   13,
      color:      theme.textSub,
    },
  });
}
