/**
 * The screen between having some audio and landing in the editor, for all three paths that
 * produce it: an uploaded audio file, an uploaded MIDI file, and a recorded take.
 *
 * Audio and MIDI share it deliberately: the two differ only in how a file becomes timed
 * pitches (decode + transcription vs. a parse), and are identical either side of that —
 * same session gate, same filename-as-title, same progress reporting, same error handling.
 * A recording joins at the same seam as an uploaded file, one step further in: it arrives
 * already decoded, and with its engine already chosen on the recording screen.
 *
 * What each path still has to ask differs, and that is what the phases below are:
 *
 *  - **Audio** decodes and transcribes straight away (a take arrives already decoded on
 *    Finish), then offers to tune it (`tune`) before handing the result to the Studio. The
 *    harp is deliberately not asked here; it is chosen at conversion, where it decides
 *    something.
 *  - **MIDI** asks which track (`midiConfirm`), because a MIDI file is an arrangement and
 *    that answer isn't in it — and from there offers both the Studio and a direct route
 *    to tabs.
 *
 * Tuning sits *before* the project exists, and that placement is the point: re-segmenting
 * replaces the note set wholesale, so the same sliders offered inside the Studio would
 * silently destroy edits the user had already made. Here there is nothing yet to destroy,
 * which is what makes the controls cheap to play with.
 */

import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';
import { WEB_CONTENT_WIDTH, webMaxWidth } from '@/constants/layout';
import { useTheme } from '@/hooks/useTheme';
import { AudioImportError, type DecodedAudio, type ImportErrorCode } from '@/audio/audioImport';
import { CandidateList, CandidateRow } from '@/components/CandidateRow';
import { KeyCandidateList, positionLabel, techniqueSuffix } from '@/components/KeyCandidateList';
import { PianoRoll } from '@/components/PianoRoll';
import { TranscriptionParamsRail } from '@/components/TranscriptionParamsRail';
import {
  getAlgorithm, withDefaults, TRANSCRIBE_ALGORITHM_ID,
  type ParamValue, type ParamValues, type Prepared, type TranscriptionAlgorithmId,
  type TranscriptionOutput,
} from '@/audio/algorithms';
import { pushFrames } from '@/audio/frameBuffer';
import {
  clearPendingImport, getPendingImport, pendingImportName, setPendingImport,
  type PendingImport,
} from '@/audio/pendingImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { pickMidiFile } from '@/audio/pickMidiFile';
import { decodeAudioFile } from '@/audio/decodeAudio';
import { getChromaticRows, midiToNoteName } from '@/audio/HarmonicaMapper';
import { usePlayback } from '@/hooks/usePlayback';
import { warmSynth } from '@/native/Playback';
import {
  mergeTracks,
  mostMelodicTrack,
  orderTrackNotes,
  pitchRangeLabel,
  type MidiTrack,
  type MidiNote,
  type ParsedMidi,
} from '@/audio/midiToNotes';
import { detectTempo } from '@/audio/detectTempo';
import {
  notesToTabs,
  rankKeysForMidi,
  shiftMidiNotes,
  type MidiKeyRanking,
} from '@/audio/notesToTabs';
import { octaveShiftForMidiRange } from '@/audio/pitchRange';
import {
  prepareTranscription, resegmentTranscription,
  type AudioAnalysisResult, type ImportStage,
} from '@/audio/transcription';
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
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Which track the user is transcribing — a track's own id, or the explicit merge-all
 *  option. Never inferred: which part belongs on a harmonica is a musical choice the file
 *  doesn't encode. */
type TrackSelection = number | 'all';

/**
 * `tune` is a phase for the same reason `midiConfirm` is, rather than a route of its own —
 * the screen already owns the transcription it is about.
 *
 * `tune` deliberately carries no data. Its inputs (the prepared matrices, the parameter
 * values, the current result) live in refs and state beside it, because a phase object
 * replaced on every slider tick would re-render the piano roll through the phase switch on
 * each one.
 */
type Phase =
  | { kind: 'working'; stage: ImportStage; fraction: number }
  | { kind: 'tune' }
  | { kind: 'midiConfirm'; parsed: MidiImportResult; selection: TrackSelection; chosenKey: HarmonicaKey }
  | { kind: 'error';   code: ImportErrorCode; message: string };

/** How many of the confirm step's candidate keys carry the recommendation — the winner plus
 *  the two next-best, which in practice is straight harp plus the cross-harp positions
 *  around it. All 12 are offered; this is only where the heading stops. Same cut as the
 *  Studio's convert modal, since it's a user hitting the same wall for the same reason. */
const RECOMMENDED_KEYS = 3;

function durationLabel(ms: number): string {
  const total   = Math.round(ms / 1000);
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * The whole MIDI pipeline downstream of the track choice: take the track whole, fit the
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

  const ordered = orderTrackNotes(raw);
  // Fold first: a part sitting two octaves below the harp is a register problem, fixed for
  // the whole piece. Only what's still unmapped afterwards is genuinely unplayable.
  const shift = octaveShiftForMidiRange(ordered.map((n) => n.midi));
  const notes = shiftMidiNotes(ordered, shift);

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
function previewNotes(notes: MidiNote[], program = 0, timelineStart?: number): TabNote[] {
  if (notes.length === 0) return [];
  const start = timelineStart ?? Math.min(...notes.map((n) => n.timeMs));
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
    velocity:   n.velocity,
    program,
  }));
}

/** Preserve each track's authored instrument while sharing one zero point for a merged
 * preview, exactly as the Studio's flattened playback list does. */
function previewTracks(tracks: readonly MidiTrack[]): TabNote[] {
  const start = Math.min(...tracks.flatMap((track) => track.notes.map((note) => note.timeMs)));
  return tracks
    .flatMap((track) => previewNotes(track.notes, track.program, start))
    .sort((a, b) => a.start_time - b.start_time);
}

/** Decoding has no measurable progress of its own, so it holds a small non-zero bar —
 *  enough to read as "started", not enough to imply real progress it can't report. */
const DECODE_BAR_FRACTION = 0.06;

/**
 * The tune step's preview is a picture, not an editor: nothing on it may write anywhere.
 *
 * Stated rather than left undefined because `PianoRoll` falls back to `useAppStore` for any
 * bulk handler its host omits — a sensible default for the tab editor that owns that store,
 * and from here a route into editing whatever the user has open in the editor.
 */
const noop    = () => {};
const noNotes = () => [] as TabNote[];

/** Shorter than the editor's 28px, matching the Studio: the preview draws the full
 *  chromatic ladder rather than ~40 harmonica rows, where tall rows fit barely two octaves. */
const PREVIEW_ROW_HEIGHT = 18;

export default function ImportScreen() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && windowWidth >= 900;
  const midiPanelHeight = Math.max(440, Math.min(620, windowHeight - 290));
  const router = useRouter();
  const theme  = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Set by whichever Home button opened this screen; absent means the audio path.
  const isMidi = useLocalSearchParams<{ kind?: string }>().kind === 'midi';

  const selectedKey    = useAppStore(selectKey);
  const harmonicaType  = useAppStore(selectHarmonicaType);
  const startImportedSession = useAppStore((s) => s.startImportedSession);
  const selectKey_           = useAppStore((s) => s.selectKey);
  const commitImportedNotes  = useAppStore((s) => s.commitImportedNotes);
  const incrementRecordingCount = useSettingsStore((s) => s.incrementRecordingCount);
  const saveProject             = useMidiProjectsStore((s) => s.saveProject);
  const tabNotes                = useAppStore((s) => s.tabNotes);
  const savedParams             = useSettingsStore((s) => s.transcriptionParams);
  const setTranscriptionParams  = useSettingsStore((s) => s.setTranscriptionParams);

  const [phase, setPhase] = useState<Phase>({ kind: 'working', stage: 'decoding', fraction: 0 });
  const [fileName, setFileName] = useState(() => pendingImportName(getPendingImport()));

  // ── Audio tuning state ──────────────────────────────────────────────────────
  const [algorithmId, setAlgorithmId] = useState<TranscriptionAlgorithmId>(TRANSCRIBE_ALGORITHM_ID);
  /** What the sliders show — staged, not necessarily in the preview. */
  const [params, setParams]           = useState<ParamValues>({});
  /**
   * What the preview was actually built from.
   *
   * The pair is what makes "apply" a real state rather than a label: everything the user
   * can see on the roll is `appliedParams`, everything they've moved since is `params`, and
   * the difference between the two is exactly what the dots and the Apply button report.
   */
  const [appliedParams, setAppliedParams] = useState<ParamValues>({});
  const [result, setResult]           = useState<AudioAnalysisResult | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  /** Whether this arrived from the recording screen. Decides the phrasing throughout, and
   *  the two things only a take has: a live transcription to fall back to, and a retention
   *  cap it may have hit. */
  const [isFromRecording, setIsFromRecording] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const engine  = useMemo(() => getAlgorithm(algorithmId), [algorithmId]);
  /** Which parameters are ahead of the preview. Derived rather than tracked, so it can't
   *  drift from the two values it's a statement about — dragging a slider back to where it
   *  started stops being a pending change, which a flag set on first edit wouldn't. */
  const pendingIds = useMemo(
    () => engine.params.filter((p) => params[p.id] !== appliedParams[p.id]).map((p) => p.id),
    [engine, params, appliedParams],
  );
  // All 128 semitones. Built once — it's a fixed ladder, and rebuilding it per re-segment
  // would re-key every row in the roll on each slider tick.
  const previewRows = useMemo(() => getChromaticRows(), []);

  /**
   * The expensive pass's output, in a ref rather than in state.
   *
   * Three matrices at ~86 frames a second come to roughly 90MB on a five-minute take, which
   * dwarfs the audio that produced them — so this is the one value on the screen that has
   * to be released deliberately rather than left for a re-render to drop.
   */
  const preparedRef = useRef<Prepared | null>(null);
  /** Kept so "Back" can change engine without re-decoding, and re-prepare from the same
   *  audio. Larger than it looks, but strictly smaller than what `preparedRef` holds. */
  const audioRef    = useRef<DecodedAudio | null>(null);
  /** Frozen at the first result so the preview's bar grid doesn't rescale under the user
   *  every time a slider changes how many onsets there are to read a tempo from. */
  const previewBpmRef = useRef<number | null>(null);
  /** Only the newest re-segmentation may write a result. Without this a second Apply
   *  pressed while the first is still running can land in either order. */
  const resegmentSeqRef = useRef(0);

  function releasePrepared() {
    preparedRef.current?.dispose();
    preparedRef.current = null;
  }

  // Self-contained playback for the track previews — this hook instance takes its notes as
  // an argument, so auditioning a track can't touch the session being imported into.
  const preview = usePlayback();
  const [previewTrack, setPreviewTrack] = useState<TrackSelection | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewGenerationRef = useRef(0);

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

      const entry = getPendingImport();
      if (!entry || !selectedKey) {
        router.replace('/app');
        return;
      }
      void begin(entry);
    }

    // Leaving the screen (browser back, or any other navigation) abandons the import
    // rather than letting it finish and yank the user into the editor — and silences any
    // track preview still running, which would otherwise outlive the screen. The prepared
    // matrices go with it: navigating away is the commonest way to leave this screen and
    // would otherwise be the commonest way to strand ~90MB.
    return () => {
      cancelledRef.current = true;
      preview.stop();
      releasePrepared();
      audioRef.current = null;
    };
  }, []);

  // A track that runs to its end stops itself; clearing the highlight when it does keeps
  // the button from staying stuck on "stop" for a track that's no longer sounding.
  useEffect(() => {
    if (!preview.isPlaying && !previewLoading) setPreviewTrack(null);
  }, [preview.isPlaying, previewLoading]);

  // Everything downstream of the current track choice. Recomputed on every selection
  // change, which is what makes the key list live evidence that the track was the right
  // one rather than a stale score from whatever was picked first.
  const midiAnalysis = useMemo(
    () => (phase.kind === 'midiConfirm'
      ? analyzeSelection(phase.parsed, phase.selection, harmonicaType)
      : null),
    [phase, harmonicaType],
  );

  /**
   * Entry point for whatever landed in the hand-off slot.
   *
   * The two audio variants now differ in one thing only — whether the samples are already in
   * hand. A take arrives decoded from the recording screen; a file has to be read off disk
   * first. Neither is asked which engine to use: there is one worth offering, so the question
   * was costing a decision and buying nothing (see `SELECTABLE_ALGORITHM_IDS`).
   */
  async function begin(entry: PendingImport) {
    if (isMidi) { await parseMidi(); return; }

    setFileName(pendingImportName(entry));

    if (entry.kind === 'decoded') {
      audioRef.current = entry.audio;
      setIsFromRecording(true);
      setTruncated(entry.truncated);
      setAlgorithmId(entry.algorithm);
      setParams(entry.params);
      await prepare(entry.audio, entry.algorithm, entry.params, entry.title);
      return;
    }

    await transcribeFile();
  }

  /** MIDI's whole "working" stage: read the bytes, parse them. Milliseconds, so the
   *  progress screen flashes past rather than reporting a fraction it doesn't have. */
  async function parseMidi() {
    const entry = getPendingImport();
    if (entry?.kind !== 'file' || !selectedKey) return;
    const picked = entry.picked;

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

  /**
   * Read an uploaded audio file off disk and transcribe it.
   *
   * The take path never comes through here — it arrives with its samples already decoded and
   * goes straight to `prepare` from `begin`.
   */
  async function transcribeFile() {
    if (!selectedKey) return;
    const algorithm = TRANSCRIBE_ALGORITHM_ID;
    const initial   = withDefaults(getAlgorithm(algorithm), savedParams[algorithm]);
    setAlgorithmId(algorithm);

    const entry = getPendingImport();
    if (entry?.kind !== 'file') return;
    const picked = entry.picked;

    cancelledRef.current = false;
    setPhase({ kind: 'working', stage: 'decoding', fraction: 0 });

    // Deliberately *not* `startImportedSession` here, unlike the MIDI path. That clears
    // `tabNotes`/`history`, which was harmless while an audio import went on to replace them
    // — but this one lands in the Studio and never touches the tab session, so starting one
    // would destroy whatever the user had open in the editor and put nothing in its place.
    // Conversion calls `loadRecording`, which establishes the session properly.
    try {
      const audio = await decodeAudioFile(picked);
      if (cancelledRef.current) return;
      audioRef.current = audio;
      await prepare(audio, algorithm, initial, title());
    } catch (err) {
      showImportError(err, picked.name, `"${picked.name}" couldn't be transcribed.`);
    }
  }

  /** The library title for whatever is being transcribed — a take's own name, or the
   *  filename without its extension, which beats the timestamp fallback. */
  function title(): string {
    return fileName.replace(/\.[^.]+$/, '') || 'Untitled';
  }

  /**
   * The expensive half, once, followed by one re-segmentation to fill the preview.
   *
   * Everything after this point is the cheap half, which is what makes the tune step
   * affordable: the CNN pass (or the NSDF pass) does not run again however long the user
   * spends on the sliders.
   */
  async function prepare(
    audio: DecodedAudio,
    algorithm: TranscriptionAlgorithmId,
    initialParams: ParamValues,
    title: string,
  ) {
    cancelledRef.current = false;
    releasePrepared();
    setPhase({ kind: 'working', stage: 'decoding', fraction: 0 });

    try {
      const prepared = await prepareTranscription(audio, algorithm, {
        harmonicaType,
        harmonicaKey: selectedKey ?? undefined,
        onProgress:   (p) => setPhase({ kind: 'working', stage: p.stage as ImportStage, fraction: p.fraction }),
        shouldCancel: () => cancelledRef.current,
      });

      if (cancelledRef.current) { prepared.dispose(); return; }
      preparedRef.current = prepared;
      // Both halves of the pair, because the pass just below builds the first preview from
      // exactly these — the screen opens with nothing pending.
      setParams(initialParams);
      setAppliedParams(initialParams);

      // The first pass keeps the throw: an import that found nothing at all on the engine's
      // own defaults is a failed import, not a parameter the user has yet to move.
      const first = await resegmentTranscription({
        prepared,
        params: initialParams,
        harmonicaType,
        segmentationKey: selectedKey ?? undefined,
        sourceName: title,
      });
      if (cancelledRef.current) { releasePrepared(); return; }

      previewBpmRef.current = detectTempo(first.notes.map((n) => ({ start_time: n.timeMs })))?.bpm ?? null;
      setResult(first);
      setPhase({ kind: 'tune' });
    } catch (err) {
      releasePrepared();
      showImportError(err, title, `"${title}" couldn't be transcribed.`);
    }
  }

  /**
   * Re-run the cheap half for the parameters the user has settled on.
   *
   * `allowEmpty` is the whole difference from the first pass. Sliding a threshold to the end
   * of its travel until nothing survives is an ordinary thing to do while tuning, and
   * throwing there would replace the screen — and the parameters that got the user to it —
   * with an error page they'd have to start over from.
   */
  async function applyParams(next: ParamValues) {
    const prepared = preparedRef.current;
    if (!prepared) return;

    setRecomputing(true);
    const seq = ++resegmentSeqRef.current;

    // The work below is one long synchronous burst on the JS thread — Basic Pitch's
    // segmentation walks the whole stored inference matrix — so without a macrotask
    // boundary here the "updating" state above is set and painted in the same frame the
    // stall begins, i.e. never seen. Yielding once lets the press visibly register.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    try {
      const updated = await resegmentTranscription({
        prepared,
        params: next,
        harmonicaType,
        segmentationKey: selectedKey ?? undefined,
        sourceName: fileName,
        allowEmpty: true,
      });
      // A slower run started earlier must not overwrite a newer one that already landed.
      if (seq !== resegmentSeqRef.current || cancelledRef.current) return;
      setResult(updated);
      // Only now do these describe the picture — and only now are they worth remembering
      // for the next take, since a value the user staged and abandoned was never a setting.
      setAppliedParams(next);
      setTranscriptionParams(algorithmId, next);
    } catch {
      // Only a disposed `prepared` can reach here — every ordinary failure mode is now an
      // empty result. Leaving the previous preview up is the honest response: nothing
      // about the transcription has changed.
    } finally {
      if (seq === resegmentSeqRef.current) setRecomputing(false);
    }
  }

  /**
   * Moving a control changes the control, and nothing else.
   *
   * Re-segmenting per tick was affordable in principle — the expensive pass never re-runs —
   * but "cheap" here still means walking every frame of the take, which on a long file is a
   * stall the drag itself is fighting. Explicit apply also makes the roll's meaning exact:
   * it is always the last thing the user asked for, never a half-finished gesture.
   */
  function handleParamChange(id: string, value: ParamValue) {
    setParams((prev) => ({ ...prev, [id]: value }));
  }

  /** Stages the defaults like any other edit — Reset says what the values should be, Apply
   *  is still what puts them on screen. */
  function handleResetParams() {
    setParams(withDefaults(engine));
  }

  /** The empty state's escape hatch, which is a recovery rather than an edit: there is
   *  nothing on screen to compare a staged value against, so it goes the whole way. */
  function handleResetAndApply() {
    const next = withDefaults(engine);
    setParams(next);
    void applyParams(next);
  }

  /** One place that turns a thrown import failure into either a bounce back to Home (the
   *  user cancelled) or the error phase, so both pipelines report failures the same way. */
  function showImportError(err: unknown, name: string, fallbackMessage: string) {
    const isImportError = err instanceof AudioImportError;
    const code    = isImportError ? err.code : 'decodeFailed';
    const message = isImportError ? err.message : fallbackMessage;

    // An `AudioImportError` is a failure this pipeline anticipated and phrased for a player.
    // Anything else is a bug, and the generic message deliberately says nothing about it —
    // so without this line the only evidence of what actually went wrong is discarded, and
    // a real exception looks identical to an unsupported file. Learned the hard way.
    if (!isImportError) console.error('[import] unexpected transcription failure', err);

    if (code === 'cancelled') {
      clearPendingImport();
      router.replace('/app');
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
   * The notes come from the analysis result rather than being re-derived here. Only that
   * result holds both halves of what the frame lane needs to produce them — the detected key
   * *and* the segmenter settings the user tuned — so segmenting a second time at this point
   * could quietly disagree with the preview they just approved.
   */
  function openStudioFromAudio(analysis: AudioAnalysisResult, name: string) {
    const { output, notes } = analysis;

    if (notes.length === 0) {
      setPhase({
        kind:    'error',
        code:    'noAudio',
        message: `No notes were found in "${name}". Try a recording with a clearer melody line.`,
      });
      return;
    }

    // Read the tempo off the transcription instead of taking the 120 default. Without this
    // every uploaded song opened the Studio at exactly 120 BPM — not a display quirk, the
    // project genuinely carried it, so the bar ruler bore no relation to the performance.
    //
    // Applied whatever the confidence, because the alternative is not a better number — it's
    // a hard-coded 120 that predates the audio. Even a loose reading of the actual onsets
    // beats a constant, and the Studio's BPM stepper is right there to correct it.
    //
    // BPM only, deliberately — `estimate.offsetMs` is not applied here as it is in the tab
    // editor. Shifting the notes would slide them out of registration with the frames parked
    // under this project id just below, which the pitch lane and Frame Inspector read at
    // their original times. So the grid gets the right spacing but keeps bar 1 at ms 0.
    const estimate = detectTempo(notes.map((n) => ({ start_time: n.timeMs })));
    const project = projectFromMidiNotes(notes, name || 'Untitled project', {
      velocitySource: output.kind === 'frames' ? 'takeRelativeRms' : 'modelActivation',
      bpm: estimate?.bpm,
      // Where this came from, which Frame Inspector reads to decide what it can show. A take
      // and an upload reach the Studio by the same road from here on, and this is the last
      // point at which the difference is still known.
      origin: isFromRecording ? 'recording' : 'audioUpload',
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
    previewGenerationRef.current++;
    preview.stop();
    setPreviewLoading(false);

    const project = projectFromSmfBytes(
      phase.parsed.bytes,
      fileName.replace(/\.[^.]+$/, '') || 'Untitled project',
    );
    saveProject(project);
    clearPendingImport();
    router.replace({ pathname: '/studio', params: { projectId: project.id } });
  }

  function commitMidi(notes: MidiNote[], key: HarmonicaKey, bpm: number | null) {
    previewGenerationRef.current++;
    preview.stop();
    setPreviewLoading(false);
    const tabbed = notesToTabs(notes, key, harmonicaType, 'midiVelocity');
    if (tabbed.length === 0) {
      setPhase({
        kind:    'error',
        code:    'noAudio',
        message: 'That track has no notes in it. Try another track, or the merged option.',
      });
      return;
    }

    selectKey_(key);
    // Tempo and notes land together, in one action that is not undo-tracked. Doing it as
    // `setBpm` + `addTabNotes` made the import two undoable edits over an empty session, so
    // Ctrl+Z in the editor could delete the whole imported tab (and `setBpm` had to run first
    // to avoid re-timing the arriving notes off the timings the file states — a constraint
    // that only existed because the two were separate steps).
    commitImportedNotes(tabbed, bpm);

    // The free-tier session is consumed here, on success — not when the file was picked.
    incrementRecordingCount();

    clearPendingImport();
    router.replace('/edit');
  }

  /** Audition a track without committing to it. Pressing the same one again stops it. */
  function handleTogglePreview(id: TrackSelection, audible: TabNote[]) {
    const generation = ++previewGenerationRef.current;
    if (previewTrack === id && (preview.isPlaying || previewLoading)) {
      preview.stop();
      setPreviewLoading(false);
      setPreviewTrack(null);
      return;
    }
    if (audible.length === 0) return;
    preview.stop();
    setPreviewTrack(id);
    setPreviewLoading(true);
    void warmSynth().then(() => {
      if (cancelledRef.current || previewGenerationRef.current !== generation) return;
      setPreviewLoading(false);
      preview.play(audible, { bpm: 100, metronomeEnabled: false, rate: 1 });
    });
  }

  function handleCancel() {
    cancelledRef.current = true;
    previewGenerationRef.current++;
    preview.stop();
    setPreviewLoading(false);
    releasePrepared();
    audioRef.current = null;
    clearPendingImport();
    router.replace('/app');
  }

  /** The escape that costs nothing, because pMPM ran live throughout the take: the notes are
   *  already in the session, so this is today's behaviour preserved as a fast path — and the
   *  fallback when the model can't be fetched at all. */
  function handleUseLiveTranscription() {
    cancelledRef.current = true;
    releasePrepared();
    audioRef.current = null;
    clearPendingImport();
    router.replace('/edit');
  }

  async function handleTryAnotherFile() {
    // Opened from a real press, so the browser's file dialog is allowed here.
    try {
      const picked = await (isMidi ? pickMidiFile() : pickAudioFile());
      if (!picked) return;
      releasePrepared();
      audioRef.current = null;
      setPendingImport(picked);
      setFileName(picked.name);
      if (isMidi) { void parseMidi(); return; }
      void transcribeFile();
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
    const unplayable     = ranking.unplayableByKey[chosenKey] ?? 0;
    const selectedTrack  = selection === 'all'
      ? null
      : parsed.tracks.find((t) => t.id === selection);

    // Two distinct dead ends, worth separating because the fix differs. The track holds no
    // notes at all — a different track is the only way forward. Or it has notes but none of
    // them sits anywhere on this harp, in which case the key list above is the fix and
    // continuing would land an editor full of tabs the user can't play.
    const nothingToPlay  = notes.length === 0;
    const nothingMapped  = !nothingToPlay && unplayable === notes.length;
    const bestKeyMaps    = showKeys
      ? ranking.ranked.find((c) => (ranking.unplayableByKey[c.key] ?? 0) < notes.length)?.key
      : undefined;

    /** Play/stop control for one row. Auditioning a part is not the same as choosing it,
     *  so the press is kept from reaching the row's own selection handler. */
    function previewButton(id: TrackSelection, getAudible: () => TabNote[], label: string) {
      const playing = previewTrack === id && (preview.isPlaying || previewLoading);
      return (
        <Pressable
          onPress={(e) => { e.stopPropagation(); handleTogglePreview(id, getAudible()); }}
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
      previewGenerationRef.current++;
      preview.stop();
      setPreviewLoading(false);
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

    const continueAction = (
      <Pressable
        key="continue"
        onPress={() => commitMidi(notes, chosenKey, parsed.bpm)}
        disabled={nothingToPlay}
        style={({ pressed, hovered }: any) => [
          styles.primaryBtn,
          isWideWeb && styles.midiPrimaryWide,
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
    );

    const studioAction = (
      <Pressable
        key="studio"
        onPress={openInStudio}
        style={({ pressed, hovered }: any) => [
          styles.studioBtn,
          isWideWeb && styles.midiSecondaryWide,
          (pressed || hovered) && styles.studioBtnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Open the full MIDI in Studio to edit tracks, notes, and timing"
      >
        <Ionicons name="layers-outline" size={16} color={theme.accent} />
        <View style={styles.studioBtnCopy}>
          <Text style={styles.studioBtnText}>Open full MIDI in Studio</Text>
          <Text style={styles.studioBtnHint}>Edit tracks, notes, and timing</Text>
        </View>
      </Pressable>
    );

    const discardAction = (
      <Pressable
        key="discard"
        onPress={handleCancel}
        style={({ pressed, hovered }: any) => [
          styles.secondaryBtn,
          isWideWeb && styles.midiDiscardWide,
          (pressed || hovered) && styles.secondaryBtnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Discard this import"
      >
        <Text style={styles.secondaryBtnText}>Discard</Text>
      </Pressable>
    );

    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, isWideWeb && styles.midiScrollContentWide]}
        >
          <View style={[styles.midiHeader, isWideWeb && styles.midiHeaderWide]}>
          <View style={[styles.iconCircle, isWideWeb && styles.midiIconWide]}>
            <Ionicons name="musical-note-outline" size={30} color={theme.accent} />
          </View>

          <View style={styles.midiHeaderCopy}>
          <Text style={[styles.title, isWideWeb && styles.midiTextWide]}>
            {showTracks ? 'Choose what to transcribe' : 'Ready to import'}
          </Text>
          <Text style={[styles.fileName, isWideWeb && styles.midiTextWide]} numberOfLines={1}>{fileName}</Text>
          <Text style={[styles.message, isWideWeb && styles.midiTextWide]}>
            {selectedTrack
              ? `${selectedTrack.name} — ${notes.length} note${notes.length === 1 ? '' : 's'} after collapsing chords to a single line.`
              : `All tracks merged — ${notes.length} note${notes.length === 1 ? '' : 's'} after collapsing to a single line.`}
          </Text>
          </View>
          </View>

          <View style={[styles.midiGuide, isWideWeb && styles.midiGuideWide]}>
            <View style={styles.midiGuideStep}>
              <Text style={styles.midiGuideNumber}>1</Text>
              <Text style={styles.midiGuideText}>
                {showTracks ? 'Choose a track. Use ▶ to preview it.' : 'The only track is selected for you.'}
              </Text>
            </View>
            <Ionicons
              name={isWideWeb ? 'arrow-forward' : 'arrow-down'}
              size={14}
              color={theme.textMuted}
            />
            <View style={styles.midiGuideStep}>
              <Text style={styles.midiGuideNumber}>2</Text>
              <Text style={styles.midiGuideText}>Choose the harmonica you want to play.</Text>
            </View>
            <Ionicons
              name={isWideWeb ? 'arrow-forward' : 'arrow-down'}
              size={14}
              color={theme.textMuted}
            />
            <View style={styles.midiGuideStep}>
              <Text style={styles.midiGuideNumber}>3</Text>
              <Text style={styles.midiGuideText}>Continue to tabs, or edit the full MIDI in Studio.</Text>
            </View>
          </View>

          <View style={[styles.midiColumns, !isWideWeb && styles.midiColumnsNarrow]}>
          <View style={[
            styles.midiPanel,
            isWideWeb && styles.midiPanelWide,
            isWideWeb && showTracks && { height: midiPanelHeight },
          ]}>
          {showTracks ? (
            <>
              <Text style={styles.sectionLabel}>TRACK</Text>
              <ScrollView
                style={isWideWeb && styles.trackListScroll}
                contentContainerStyle={isWideWeb && styles.trackListContent}
                scrollEnabled={isWideWeb}
                nestedScrollEnabled={isWideWeb}
                showsVerticalScrollIndicator={isWideWeb}
                accessibilityLabel="MIDI tracks"
              >
              <CandidateList>
                {parsed.tracks.map((track) => {
                  // Playing in full means a row can be sounding for minutes; the elapsed
                  // readout is what tells the user it's progressing rather than stuck.
                  const playing = previewTrack === track.id && preview.isPlaying;
                  return (
                    <CandidateRow
                      key={track.id}
                      leading={previewButton(
                        track.id,
                        () => previewNotes(track.notes, track.program),
                        track.name,
                      )}
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
                      backgroundColor={theme.bg}
                    />
                  );
                })}

                <CandidateRow
                  leading={previewButton(
                    'all',
                    () => previewTracks(parsed.tracks),
                    'all tracks merged',
                  )}
                  title="All tracks merged"
                  subtitle={
                    previewTrack === 'all' && preview.isPlaying
                      ? `${durationLabel(preview.currentTimeMs)} / ${durationLabel(parsed.durationMs)}`
                      : 'Keeps the highest note wherever parts overlap'
                  }
                  selected={selection === 'all'}
                  onPress={() => chooseTrack('all')}
                  accessibilityLabel="All tracks merged — keeps the highest note wherever parts overlap"
                  backgroundColor={theme.bg}
                />
              </CandidateList>
              </ScrollView>
              <Text style={styles.listHint}>
                Press ▶ to hear a part in full before choosing it — press again to stop.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>TRACK</Text>
              <View style={styles.trackFact}>
                <Ionicons name="checkmark-circle-outline" size={18} color={theme.accent} />
                <Text style={styles.trackFactText}>{selectedTrack?.name ?? 'All tracks merged'}</Text>
              </View>
            </>
          )}
          </View>

          <View style={[
            styles.midiPanel,
            isWideWeb && styles.midiPanelWide,
            isWideWeb && showTracks && { height: midiPanelHeight },
          ]}>
          {/* With nothing left after reduction there is no material to score, and every key
              would claim a perfect fit for zero notes. */}
          {showKeys && !nothingToPlay && (
            <>
              <Text style={styles.sectionLabel}>TARGET HARMONICA</Text>
              <KeyCandidateList
                candidates={ranking.ranked}
                recommendedCount={RECOMMENDED_KEYS}
                scrollOtherKeys={isWideWeb}
                rowBackgroundColor={theme.bg}
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
                There are no notes in {selectedTrack ? `“${selectedTrack.name}”` : 'this file'}.
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
          </View>
          </View>

          <View style={[styles.actions, isWideWeb && styles.midiActionsWide]}>
            {isWideWeb
              ? <>{discardAction}{studioAction}{continueAction}</>
              : <>{continueAction}{studioAction}{discardAction}</>}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (phase.kind === 'tune' && result) {
    const noteCount  = result.notes.length;
    const empty      = noteCount === 0;
    const hasPending = pendingIds.length > 0;

    /**
     * What's being transcribed, as the roll's own in-panel header rather than a band of
     * page chrome above it — the same place the editor puts its chart name, and for the
     * same reason: a preview this tall wants the row back.
     *
     * Reused above the empty state, which has no roll to carry it.
     */
    const rollHeader = (
      <View style={styles.rollHeader}>
        <Text style={styles.rollTitle} numberOfLines={1}>{title()}</Text>
        <Text style={styles.rollMeta} numberOfLines={1}>
          {engine.label} · {noteCount} note{noteCount === 1 ? '' : 's'}
        </Text>
        {/* Sits next to the count because the count is what it qualifies. The preview
            itself never blanks while this is up — see the note on `result` below. */}
        {recomputing && (
          <View style={styles.updatingPill}>
            <Ionicons name="sync-outline" size={12} color={theme.textSub} />
            <Text style={styles.updatingText}>updating</Text>
          </View>
        )}
      </View>
    );

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.tuneScreen}>
          {truncated && (
            <View style={styles.noticeRow}>
              <Ionicons name="alert-circle-outline" size={14} color={theme.warning} />
              <Text style={styles.noticeText}>
                This take reached the length limit, so only the first part of it was kept.
              </Text>
            </View>
          )}

          <View style={styles.tuneBody}>
            <View style={styles.tunePreview}>
              {/* Belongs to the picture, not to the page.
                  Spanning the workspace made it chrome attached to neither column, and no
                  amount of weight fixed that — a sentence about what the roll is, floating
                  above the roll and the rail alike, reads as a leftover caption however it
                  is set. Here it is the preview's own opening line, indented with the panel
                  and ending where the panel ends.
                  It says the two things the screen cannot: what this picture is, and that
                  there are two ways on from it — the settings, or the Studio. It states
                  neither an apology for the result nor a promise about it. A rough first
                  result is survivable because the next step is named, not because the copy
                  said so in advance. */}
              <Text style={styles.previewCaption}>
                This is what we heard. Adjust the settings to get better results, or continue
                and edit the notes in the Studio.
              </Text>

              {empty ? (
                // Inline, never the error screen. Params this strict are one drag away from
                // a good result, and replacing the screen would take the sliders that got
                // the user here away with it.
                <>
                  {rollHeader}
                  <View style={styles.emptyResult} accessibilityRole="alert">
                    <Ionicons name="remove-circle-outline" size={22} color={theme.textMuted} />
                    <Text style={styles.emptyResultTitle}>Nothing survives these settings</Text>
                    <Text style={styles.emptyResultText}>
                      Every note was filtered out. Ease the thresholds on the right and apply
                      them again, or reset them to start over.
                    </Text>
                    <Pressable
                      onPress={handleResetAndApply}
                      style={({ pressed, hovered }: any) => [
                        styles.secondaryBtn,
                        (pressed || hovered) && styles.secondaryBtnPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Reset every setting to its default and apply"
                    >
                      <Text style={styles.secondaryBtnText}>Reset to defaults</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <PianoRoll
                  notes={previewNotes(result.notes)}
                  headerLeft={rollHeader}
                  // A picture of the transcription, not an editor for it: no tools, no snap,
                  // no transpose, no note dragging. Re-segmenting replaces the note set
                  // wholesale on the next slider tick, so anything drawn here would be
                  // erased by the very controls beside it — and the project this becomes is
                  // fully editable one screen later, in the Studio.
                  viewOnly
                  // No harmonica at this stage — the key is chosen at conversion — so the
                  // pitch axis is the full chromatic ladder, as in the Studio. These two
                  // only exist because the tab editor derives its rows from them.
                  harmonicaKey="C"
                  harmonicaType="chromatic"
                  rows={previewRows}
                  rowHeight={PREVIEW_ROW_HEIGHT}
                  bpm={previewBpmRef.current ?? 120}
                  selectedId={null}
                  // Every write path is a no-op, and every one has to be stated: the roll
                  // falls back to writing into the tab session's store for any bulk handler
                  // left undefined, which from here would edit whatever the user has open in
                  // the editor.
                  onSelect={noop}
                  onCreate={noop}
                  onCreateMany={noop}
                  onUpdate={noop}
                  onUpdateMany={noop}
                  onDelete={noop}
                  onDeleteMany={noop}
                  readNotesAfterWrite={noNotes}
                  isPlaying={false}
                  currentTimeMs={0}
                  onSeek={noop}
                  loopRegion={null}
                  onLoopRegionChange={noop}
                />
              )}
            </View>

            <TranscriptionParamsRail
              // The key this import is already being read against, so switching the pitch
              // range on lands on the harp the user named a step ago rather than on C.
              pitchRangeSeed={selectedKey ?? undefined}
              params={engine.params}
              values={params}
              onChange={handleParamChange}
              onReset={handleResetParams}
              recomputing={recomputing}
              pendingIds={pendingIds}
              // Nothing the user has moved has touched the preview yet — this is what spends
              // the compute, so it sits with the controls that stage the work rather than
              // with the buttons that leave.
              applyAction={
                <Pressable
                  onPress={() => void applyParams(params)}
                  disabled={!hasPending || recomputing}
                  style={({ pressed, hovered }: any) => [
                    styles.applyBtn,
                    hasPending && !recomputing && styles.applyBtnLive,
                    (pressed || hovered) && hasPending && !recomputing && styles.applyBtnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !hasPending || recomputing }}
                  accessibilityLabel={
                    recomputing
                      ? 'Applying the changed settings'
                      : hasPending
                        ? `Apply ${pendingIds.length} changed setting${pendingIds.length === 1 ? '' : 's'} to the preview`
                        : 'Apply changes — nothing has changed since the preview was made'
                  }
                >
                  <Ionicons
                    name={recomputing ? 'sync-outline' : 'flash-outline'}
                    size={15}
                    color={hasPending && !recomputing ? theme.accent : theme.textMuted}
                  />
                  <Text style={[styles.applyBtnText, hasPending && !recomputing && styles.applyBtnTextLive]}>
                    {recomputing ? 'Applying…' : 'Apply changes'}
                  </Text>
                </Pressable>
              }
              footer={
                <>
                  {/* Deliberately the largest thing on the screen after the preview itself.
                      Everything else in this column adjusts what the preview shows; this is
                      the one control that leaves with it. */}
                  <Pressable
                    onPress={() => openStudioFromAudio(result, title())}
                    disabled={empty}
                    style={({ pressed, hovered }: any) => [
                      styles.goBtn,
                      empty && styles.primaryBtnDisabled,
                      (pressed || hovered) && !empty && styles.primaryBtnPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: empty }}
                    accessibilityLabel="Open this transcription in the Studio"
                  >
                    <Text style={styles.goBtnText}>Open in Studio</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </Pressable>

                  {isFromRecording && tabNotes.length > 0 && (
                    <Pressable
                      onPress={handleUseLiveTranscription}
                      style={({ pressed, hovered }: any) => [
                        styles.railSecondaryBtn,
                        (pressed || hovered) && styles.secondaryBtnPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Discard this and use the live transcription instead"
                    >
                      {/* Not `flash-outline` — Apply took that glyph, three buttons up in
                          this same column. */}
                      <Ionicons name="pulse-outline" size={15} color={theme.textSub} />
                      <Text style={styles.secondaryBtnText}>Use the live version</Text>
                    </Pressable>
                  )}

                  {/* Quietest of the four, and the only one that ends the import: same
                      handler the progress screen's Cancel uses, so it releases the prepared
                      matrices rather than leaving ~90MB behind on the way to Home. */}
                  <Pressable
                    onPress={handleCancel}
                    style={({ pressed, hovered }: any) => [
                      styles.discardBtn,
                      (pressed || hovered) && styles.discardBtnHovered,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Discard this import and go back to the library"
                  >
                    <Text style={styles.discardBtnText}>Discard</Text>
                  </Pressable>
                </>
              }
            />
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
              onPress={() => { clearPendingImport(); router.replace('/app'); }}
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

  // `tune` is always accompanied by a result — they are set in the same breath — so this
  // only exists to narrow the union for the progress screen below.
  if (phase.kind !== 'working') return null;

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
              // Engine-dependent, and it has to be: the neural engine emits pitches and the
              // harp really is worked out afterwards, but the classic tracker segments on
              // *tab identity*, so its notes are shaped by the key from the start. Saying
              // the key doesn't matter would be false for half the engines here.
              : engine.producesFrames
                ? `Reading this against a ${selectedKey} harp — the classic tracker needs a key to find note boundaries. You can still change it at conversion.`
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
    midiScrollContentWide: {
      maxWidth:        1080,
      justifyContent:  'flex-start',
      alignItems:      'stretch',
      paddingVertical: 24,
      gap:             18,
    },
    midiHeader: {
      width:      '100%',
      alignItems: 'center',
      gap:        6,
    },
    midiHeaderWide: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           14,
    },
    midiHeaderCopy: {
      flex:       1,
      minWidth:   0,
      alignItems: 'center',
      gap:        2,
    },
    midiIconWide: {
      width:        44,
      height:       44,
      borderRadius: 22,
      marginBottom: 0,
    },
    midiTextWide: {
      alignSelf: 'stretch',
      textAlign: 'left',
    },
    midiColumns: {
      width:         '100%',
      flexDirection: 'row',
      alignItems:    'flex-start',
      gap:           24,
    },
    midiGuide: {
      width:           '100%',
      alignItems:      'stretch',
      gap:             8,
      paddingVertical: 10,
    },
    midiGuideWide: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'center',
      gap:               12,
      paddingHorizontal: 16,
      borderWidth:       1,
      borderColor:       theme.accent,
      borderRadius:      12,
      backgroundColor:   theme.bg,
    },
    midiGuideStep: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           8,
      flexShrink:    1,
    },
    midiGuideNumber: {
      width:           22,
      height:          22,
      borderRadius:    11,
      textAlign:       'center',
      lineHeight:      22,
      fontFamily:      SpaceGrotesk.bold,
      fontSize:        FONT.xs,
      color:           theme.accent,
      backgroundColor: theme.accentSoft,
    },
    midiGuideText: {
      flexShrink: 1,
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      color:      theme.textSub,
    },
    midiColumnsNarrow: {
      flexDirection: 'column',
      gap:           10,
    },
    midiPanel: {
      flex:     1,
      minWidth: 0,
      width:    '100%',
    },
    midiPanelWide: {
      paddingHorizontal: 16,
      paddingTop:        6,
      paddingBottom:     14,
      borderWidth:       1,
      borderColor:       theme.border,
      borderRadius:      14,
      backgroundColor:   theme.bg,
      overflow:          'hidden',
    },
    trackListScroll: {
      flex:      1,
      minHeight: 0,
      marginTop: 4,
    },
    trackListContent: {
      paddingBottom: 4,
    },
    trackFact: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               9,
      marginTop:         14,
      paddingHorizontal: 12,
      paddingVertical:   12,
      borderWidth:       1,
      borderColor:       theme.border,
      borderRadius:      10,
      backgroundColor:   theme.surface,
    },
    trackFactText: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.sm,
      color:      theme.textPrimary,
    },
    // ── Tune step ────────────────────────────────────────────────────────────
    //
    // Full-bleed, unlike every other phase on this screen: it is a workspace, not a
    // question. Same reasoning as the recording screen and the editor's roll — a piano
    // roll wants every pixel a monitor offers, and a centred column throws them away.
    tuneScreen: {
      flex: 1,
      width: '100%',
      paddingHorizontal: 24,
      paddingVertical:   20,
      gap: 12,
    },
    // Deliberately quiet, and deliberately not competing with the panel below it: the roll's
    // own header carries the filename in accent bold, which is the strongest thing in this
    // column and should stay that way. Capped at a readable measure rather than run to the
    // panel's full width — on a wide window an uncapped line of 13px text crosses 1200px and
    // stops being a sentence anyone finishes.
    previewCaption: {
      fontFamily: Poppins.regular,
      fontSize:   FONT.sm,
      lineHeight: 19,
      color:      theme.textMuted,
      maxWidth:   620,
    },
    // The roll's own in-panel header, at the head of its tool row — same treatment as the
    // editor's (accent name, muted meta), so the two workspaces read as the same object.
    rollHeader: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           10,
      flexShrink:    1,
      minWidth:      0,
    },
    rollTitle: {
      fontFamily:    SpaceGrotesk.bold,
      fontSize:      FONT.base,
      color:         theme.accent,
      letterSpacing: -0.2,
      flexShrink:    1,
      maxWidth:      260,
    },
    rollMeta: {
      fontFamily:  Poppins.medium,
      fontSize:    FONT.xs,
      color:       theme.textMuted,
      flexShrink:  0,
      fontVariant: ['tabular-nums'],
    },
    updatingPill: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingHorizontal: 10,
      paddingVertical:   5,
      borderRadius:      14,
      backgroundColor:   theme.surfaceAlt,
      borderWidth:       1,
      borderColor:       theme.border,
    },
    updatingText: {
      fontFamily:    Poppins.medium,
      fontSize:      FONT.xs,
      color:         theme.textSub,
      letterSpacing: 0.6,
    },
    // Two columns on web, and the rail keeps its own 320px so this screen and the recording
    // screen agree on what a side panel weighs. Stacks on narrow viewports.
    tuneBody: {
      flex:          1,
      flexDirection: 'row',
      gap:           16,
    },
    tunePreview: { flex: 1, minWidth: 0, gap: 10 },
    emptyResult: {
      flex:            1,
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      paddingHorizontal: 32,
      borderRadius:    12,
      borderWidth:     1,
      borderStyle:     'dashed',
      borderColor:     theme.border,
    },
    emptyResultTitle: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.sm,
      color:      theme.textPrimary,
    },
    emptyResultText: {
      fontFamily: Poppins.regular,
      fontSize:   FONT.xs,
      lineHeight: 18,
      color:      theme.textMuted,
      textAlign:  'center',
      maxWidth:   360,
    },
    // ── The rail's footer actions ────────────────────────────────────────────
    //
    // Apply is grey and inert until something is actually staged — with nothing pending it
    // is a button that would do nothing, and saying so is better than running a recompute
    // that produces the picture already on screen.
    applyBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             7,
      paddingVertical: 12,
      borderRadius:    10,
      borderWidth:     1,
      borderColor:     theme.border,
    },
    applyBtnLive: {
      borderColor:     theme.accent,
      backgroundColor: theme.accentSoft,
    },
    applyBtnPressed: { backgroundColor: theme.surfaceAlt },
    applyBtnText: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.sm,
      color:      theme.textMuted,
    },
    applyBtnTextLive: { color: theme.accent },
    //
    // Taller and heavier than any other button in the app, because it is the only way
    // forward on a screen whose every other control is an adjustment.
    goBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             10,
      paddingVertical: 17,
      borderRadius:    12,
      backgroundColor: theme.accent,
    },
    goBtnText: {
      fontFamily: Poppins.semiBold,
      fontSize:   FONT.md,
      color:      '#fff',
    },
    railSecondaryBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             7,
      paddingVertical: 11,
      borderRadius:    10,
      borderWidth:     1,
      borderColor:     theme.border,
    },
    // Bordered like its neighbours would make four buttons of equal weight out of one
    // decision and three ways to back out of it.
    discardBtn: {
      alignItems:      'center',
      justifyContent:  'center',
      paddingVertical: 10,
      borderRadius:    10,
    },
    discardBtnHovered: { backgroundColor: theme.surface },
    discardBtnText: {
      fontFamily: Poppins.medium,
      fontSize:   FONT.sm,
      color:      theme.textMuted,
    },
    sectionLabel: {
      alignSelf:     'flex-start',
      fontFamily:    Poppins.bold,
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
    midiActionsWide: {
      position:          'sticky' as any,
      bottom:            0,
      zIndex:            10,
      flexDirection:     'row',
      alignItems:        'center',
      marginTop:         0,
      paddingTop:        14,
      paddingBottom:     8,
      paddingHorizontal: 12,
      borderTopWidth:    1,
      borderTopColor:    theme.border,
      backgroundColor:   theme.bg,
    },
    midiPrimaryWide: {
      flexGrow:   0,
      flexShrink: 1,
      flexBasis:  360,
      width:      'auto',
      minWidth:   220,
      height:     56,
    },
    midiSecondaryWide: {
      flexGrow:   0,
      flexShrink: 1,
      flexBasis:  330,
      width:      'auto',
      minWidth:   190,
      height:     56,
    },
    midiDiscardWide: {
      width:             'auto',
      minWidth:          100,
      height:            56,
      marginTop:         0,
      marginRight:       'auto',
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 18,
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
    studioBtnCopy: {
      alignItems: 'center',
      gap:        1,
    },
    studioBtnHint: {
      fontFamily: Poppins.regular,
      fontSize:   10,
      color:      theme.textSub,
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
