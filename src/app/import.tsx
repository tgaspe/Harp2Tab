/**
 * The screen between picking a file and landing in the editor, for both upload paths.
 *
 * Audio and MIDI share it deliberately: the two differ only in how a file becomes timed
 * pitches (decode + pitch detection vs. a parse), and are identical either side of that —
 * same session gate, same filename-as-title, same "confirm the harp before you commit"
 * step, same route into Edit. What differs is what the confirm step asks. Audio *detects*
 * a key and offers alternates; MIDI asks which track to transcribe and which harp to
 * transcribe it onto, since a MIDI file is an arrangement and neither answer is in it.
 */

import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { WEB_CONTENT_WIDTH, webMaxWidth } from '@/constants/layout';
import { useTheme } from '@/hooks/useTheme';
import { AudioImportError, type ImportErrorCode } from '@/audio/audioImport';
import { pushFrames } from '@/audio/frameBuffer';
import { clearPendingImport, getPendingImport, setPendingImport } from '@/audio/pendingImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { pickMidiFile } from '@/audio/pickMidiFile';
import { framesToNotes } from '@/audio/framesToNotes';
import { midiToNoteName } from '@/audio/HarmonicaMapper';
import type { KeyDetectionResult } from '@/audio/keyDetection';
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
import { runMidiImport } from '@/audio/runMidiImport';
import { selectHarmonicaType, selectKey, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, RawFrame, TabNote } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Which track the user is transcribing — a track's own id, or the explicit merge-all
 *  option. Never inferred: which part belongs on a harmonica is a musical choice the file
 *  doesn't encode. */
type TrackSelection = number | 'all';

type Phase =
  | { kind: 'working'; stage: ImportStage; fraction: number }
  | { kind: 'confirm'; detection: KeyDetectionResult; frames: RawFrame[]; chosenKey: HarmonicaKey }
  | { kind: 'midiConfirm'; parsed: ParsedMidi; selection: TrackSelection; chosenKey: HarmonicaKey }
  | { kind: 'error';   code: ImportErrorCode; message: string };

/** How many candidate keys the confirm step offers. The winner plus the two next-best,
 *  which in practice is straight harp plus the cross-harp positions around it. */
const ALTERNATES_SHOWN = 3;

const POSITION_LABELS: Record<number, string> = {
  1: '1st position (straight harp)',
  2: '2nd position (cross harp)',
  3: '3rd position (slant harp)',
};

function positionLabel(position: number): string {
  return POSITION_LABELS[position] ?? `${position}th position`;
}

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
    startImportedSession(title, 'audioUpload');

    try {
      const result = await runAudioImport({
        picked,
        harmonicaType,
        onProgress:    (p) => setPhase({ kind: 'working', stage: p.stage, fraction: p.fraction }),
        shouldCancel:  () => cancelledRef.current,
      });

      // Chromatic covers every semitone in its range, so key detection has nothing to tell
      // the user — go straight to the editor on the key they already chose.
      if (!result.detection) {
        commit(result.frames, selectedKey);
        return;
      }

      setPhase({
        kind:      'confirm',
        detection: result.detection,
        frames:    result.frames,
        chosenKey: result.detection.best.key,
      });
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

  /** Turns the analyzed frames into notes for the chosen key and hands the session to the
   *  editor. Cheap enough to re-run for a different key — no audio is touched here. */
  function commit(frames: RawFrame[], key: HarmonicaKey) {
    const notes = framesToNotes(frames, key, harmonicaType);
    if (notes.length === 0) {
      setPhase({
        kind:    'error',
        code:    'noAudio',
        message: `No notes in this recording fit a ${key} ${harmonicaType === 'chromatic' ? 'chromatic' : 'diatonic'} harmonica. Try a different key.`,
      });
      return;
    }

    const { recordingId } = useAppStore.getState();
    // Frames are retained under the session's own id so Frame Inspector opens on an
    // imported session exactly like it does on a recorded one.
    if (recordingId) pushFrames(recordingId, frames);
    // The key the notes were actually detected against becomes the session's key —
    // otherwise the editor would relabel every tab against the pre-upload selection.
    selectKey_(key);
    addTabNotes(notes);

    // The free-tier session is consumed here, on success — not when the file was picked.
    // A cancelled pick or a file that fails to decode must not cost a user a recording.
    incrementRecordingCount();

    clearPendingImport();
    router.replace('/edit');
  }

  /** MIDI's sibling of `commit`. No frames are retained — a MIDI import has no audio to
   *  inspect at all, which Frame Inspector reports via the session's `source`. */
  function commitMidi(notes: MidiNote[], key: HarmonicaKey, bpm: number | null) {
    preview.stop();
    const tabbed = notesToTabs(notes, key, harmonicaType);
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
              <View style={styles.candidateList} accessibilityRole="radiogroup">
                {parsed.tracks.map((track) => {
                  const active  = selection === track.id;
                  // Playing in full means a row can be sounding for minutes; the elapsed
                  // readout is what tells the user it's progressing rather than stuck.
                  const playing = previewTrack === track.id && preview.isPlaying;
                  return (
                    <Pressable
                      key={track.id}
                      onPress={() => chooseTrack(track.id)}
                      style={({ pressed, hovered }: any) => [
                        styles.candidate,
                        active && styles.candidateActive,
                        (pressed || hovered) && !active && styles.candidateHovered,
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={`${track.name}, ${track.noteCount} notes, ${pitchRangeLabel(track)}, ${durationLabel(track.durationMs)}`}
                    >
                      {previewButton(track.id, track.notes, track.name)}
                      <View style={styles.candidateInfo}>
                        <Text style={[styles.candidatePosition, active && styles.candidateTextActive]}>
                          {track.name}
                        </Text>
                        <Text style={styles.candidateStats}>
                          {track.noteCount} notes · {pitchRangeLabel(track)} ·{' '}
                          {playing
                            ? `${durationLabel(preview.currentTimeMs)} / ${durationLabel(track.durationMs)}`
                            : durationLabel(track.durationMs)}
                        </Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={18} color={theme.accent} />}
                    </Pressable>
                  );
                })}

                <Pressable
                  onPress={() => chooseTrack('all')}
                  style={({ pressed, hovered }: any) => [
                    styles.candidate,
                    selection === 'all' && styles.candidateActive,
                    (pressed || hovered) && selection !== 'all' && styles.candidateHovered,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selection === 'all' }}
                  accessibilityLabel="All tracks merged — keeps the highest note wherever parts overlap"
                >
                  {previewButton('all', mergeTracks(parsed.tracks), 'all tracks merged')}
                  <View style={styles.candidateInfo}>
                    <Text style={[styles.candidatePosition, selection === 'all' && styles.candidateTextActive]}>
                      All tracks merged
                    </Text>
                    <Text style={styles.candidateStats}>
                      {previewTrack === 'all' && preview.isPlaying
                        ? `${durationLabel(preview.currentTimeMs)} / ${durationLabel(parsed.durationMs)}`
                        : 'Keeps the highest note wherever parts overlap'}
                    </Text>
                  </View>
                  {selection === 'all' && <Ionicons name="checkmark-circle" size={18} color={theme.accent} />}
                </Pressable>
              </View>
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
              <View style={styles.candidateList} accessibilityRole="radiogroup">
                {candidates.map((candidate) => {
                  const active     = candidate.key === chosenKey;
                  const unreachable = ranking.unplayableByKey[candidate.key] ?? 0;
                  return (
                    <Pressable
                      key={candidate.key}
                      onPress={() => setPhase({ ...phase, chosenKey: candidate.key })}
                      style={({ pressed, hovered }: any) => [
                        styles.candidate,
                        active && styles.candidateActive,
                        (pressed || hovered) && !active && styles.candidateHovered,
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={`${candidate.key} harmonica, ${positionLabel(candidate.position)}, ${unreachable} note${unreachable === 1 ? '' : 's'} not reachable`}
                    >
                      <Text style={[styles.candidateKey, active && styles.candidateKeyActive]}>{candidate.key}</Text>
                      <View style={styles.candidateInfo}>
                        <Text style={[styles.candidatePosition, active && styles.candidateTextActive]}>
                          {positionLabel(candidate.position)}
                        </Text>
                        <Text style={styles.candidateStats}>
                          {unreachable === 0 ? 'every note reachable' : `${unreachable} not reachable`}
                          {candidate.bendFraction > 0.05 && ` · ${Math.round(candidate.bendFraction * 100)}% bends`}
                          {candidate.overblowFraction > 0.02 && ` · ${Math.round(candidate.overblowFraction * 100)}% overblows`}
                        </Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={18} color={theme.accent} />}
                    </Pressable>
                  );
                })}
              </View>
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

  if (phase.kind === 'confirm') {
    const { detection, frames, chosenKey } = phase;
    const candidates = detection.ranked.slice(0, ALTERNATES_SHOWN);
    // A small gap between the top two keys is the normal case for a plain major melody
    // (the cross-harp key fits nearly as well), so this reads as "worth a look", not as a
    // failure — hence a hint to check the alternates rather than a warning.
    const closeCall = detection.margin < 0.06;
    // Nothing landed on a hole for *any* key — usually audio that isn't a solo melodic
    // line at all. Said here rather than after the user commits, where `commit` would
    // otherwise be the first thing to mention it.
    const nothingMapped = detection.ranked.every((c) => c.mappedFraction === 0);

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={styles.iconCircle}>
            <Ionicons name="key-outline" size={30} color={theme.accent} />
          </View>

          <Text style={styles.title}>Detected {detection.best.key} harmonica</Text>
          <Text style={styles.message}>
            {Math.round(detection.best.mappedFraction * 100)}% of what you played fits a {detection.best.key} harp
            {detection.best.bendFraction > 0.05
              ? `, with ${Math.round(detection.best.bendFraction * 100)}% needing bends`
              : ' without bending'}.
            {closeCall ? ' Other keys fit almost as well — check the alternatives below.' : ''}
          </Text>

          {detection.octaveShiftSemitones !== 0 && (
            <View style={styles.noticeRow}>
              <Ionicons name="swap-vertical-outline" size={14} color={theme.warning} />
              <Text style={styles.noticeText}>
                Transposed {detection.octaveShiftSemitones > 0 ? 'up' : 'down'}{' '}
                {Math.abs(detection.octaveShiftSemitones) / 12} octave
                {Math.abs(detection.octaveShiftSemitones) === 12 ? '' : 's'} to fit the harmonica&apos;s range.
              </Text>
            </View>
          )}

          {nothingMapped && (
            <View style={styles.alertRow} accessibilityRole="alert">
              <Ionicons name="alert-circle" size={14} color={theme.warning} />
              <Text style={styles.noticeText}>
                None of the detected pitches fit any harmonica key. This usually means the
                recording isn&apos;t a single melodic line — try a solo take, or a different file.
              </Text>
            </View>
          )}

          <View style={styles.candidateList} accessibilityRole="radiogroup">
            {candidates.map((candidate) => {
              const active = candidate.key === chosenKey;
              return (
                <Pressable
                  key={candidate.key}
                  onPress={() => setPhase({ ...phase, chosenKey: candidate.key })}
                  style={({ pressed, hovered }: any) => [
                    styles.candidate,
                    active && styles.candidateActive,
                    (pressed || hovered) && !active && styles.candidateHovered,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${candidate.key} harmonica, ${positionLabel(candidate.position)}, ${Math.round(candidate.mappedFraction * 100)} percent fit`}
                >
                  <Text style={[styles.candidateKey, active && styles.candidateKeyActive]}>{candidate.key}</Text>
                  <View style={styles.candidateInfo}>
                    <Text style={[styles.candidatePosition, active && styles.candidateTextActive]}>
                      {positionLabel(candidate.position)}
                    </Text>
                    <Text style={styles.candidateStats}>
                      {Math.round(candidate.mappedFraction * 100)}% fit
                      {candidate.bendFraction > 0.05 && ` · ${Math.round(candidate.bendFraction * 100)}% bends`}
                      {candidate.overblowFraction > 0.02 && ` · ${Math.round(candidate.overblowFraction * 100)}% overblows`}
                    </Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={18} color={theme.accent} />}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={() => commit(frames, chosenKey)}
              style={({ pressed, hovered }: any) => [
                styles.primaryBtn,
                (pressed || hovered) && styles.primaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Continue with ${chosenKey} harmonica`}
            >
              <Text style={styles.primaryBtnText}>Continue with {chosenKey}</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
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
        </View>
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
    candidateList: {
      width:     '100%',
      gap:       8,
      marginTop: 14,
    },
    candidate: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius:    10,
      borderWidth:     1,
      borderColor:     theme.border,
      backgroundColor: theme.surface,
    },
    candidateActive: {
      borderColor:     theme.accent,
      backgroundColor: theme.accentSoft,
    },
    candidateHovered: {
      backgroundColor: theme.surfaceAlt,
    },
    candidateKey: {
      fontFamily: SpaceGrotesk.bold,
      fontSize:   FONT.md,
      color:      theme.textSub,
      minWidth:   28,
      textAlign:  'center',
    },
    candidateKeyActive: { color: theme.accent },
    candidateInfo:      { flex: 1, gap: 1 },
    candidatePosition: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.sm,
      color:      theme.textPrimary,
    },
    candidateTextActive: { color: theme.textPrimary },
    candidateStats: {
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      theme.textSub,
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
