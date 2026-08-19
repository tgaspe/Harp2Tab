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
 *  - **Audio** asks which engine (`choosing`, file uploads only — a take was asked on
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
import { ActionSheetModal } from '@/components/ActionSheetModal';
import { CandidateList, CandidateRow } from '@/components/CandidateRow';
import { KeyCandidateList, positionLabel, techniqueSuffix } from '@/components/KeyCandidateList';
import { PianoRoll } from '@/components/PianoRoll';
import { TranscriptionEngineModal } from '@/components/TranscriptionEngineModal';
import { TranscriptionParamsRail } from '@/components/TranscriptionParamsRail';
import {
  availableAlgorithms, getAlgorithm, withDefaults,
  type ParamValues, type Prepared, type TranscriptionAlgorithmId, type TranscriptionOutput,
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
import {
  MIN_NOTE_MS,
  mergeTracks,
  mostMelodicTrack,
  pitchRangeLabel,
  reduceToMonophonic,
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
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Which track the user is transcribing — a track's own id, or the explicit merge-all
 *  option. Never inferred: which part belongs on a harmonica is a musical choice the file
 *  doesn't encode. */
type TrackSelection = number | 'all';

/**
 * Neither of the two audio phases is a new route: `choosing` renders the shared engine modal
 * over a quiet backdrop, and `tune` is a phase for the same reason `midiConfirm` is — the
 * screen already owns the transcription it is about.
 *
 * `tune` deliberately carries no data. Its inputs (the prepared matrices, the parameter
 * values, the current result) live in refs and state beside it, because a phase object
 * replaced on every slider tick would re-render the piano roll through the phase switch on
 * each one.
 */
type Phase =
  | { kind: 'choosing' }
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
  const tabNotes                = useAppStore((s) => s.tabNotes);
  const defaultAlgorithm        = useSettingsStore((s) => s.defaultAlgorithm);
  const savedParams             = useSettingsStore((s) => s.transcriptionParams);
  const setDefaultAlgorithm     = useSettingsStore((s) => s.setDefaultAlgorithm);
  const setTranscriptionParams  = useSettingsStore((s) => s.setTranscriptionParams);

  const [phase, setPhase] = useState<Phase>({ kind: 'working', stage: 'decoding', fraction: 0 });
  const [fileName, setFileName] = useState(() => pendingImportName(getPendingImport()));

  // ── Audio tuning state ──────────────────────────────────────────────────────
  const [algorithmId, setAlgorithmId] = useState<TranscriptionAlgorithmId>(defaultAlgorithm);
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
  /**
   * True when the picker was reached by "Change engine" rather than by arriving here.
   *
   * The difference is what backing out costs. On the way in nothing has been spent, so
   * cancelling is free; from the tune step a decode and a full expensive pass are already
   * behind the user — and `handleBackToChoosing` has released both — so the same gesture
   * ends the import for good and is worth asking about.
   */
  const [reChoosingEngine, setReChoosingEngine] = useState(false);
  /** The "are you sure" over the picker. Not a phase: the picker is still the screen, and
   *  answering no returns to it exactly as it was. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const engines = useMemo(() => availableAlgorithms(), []);
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

  /**
   * Entry point for whatever landed in the hand-off slot.
   *
   * The two audio variants differ in exactly one thing — whether the engine has already been
   * chosen. A take was asked on Finish, while it was still the thing in front of the user, so
   * asking again here would be asking twice; a file has had no earlier moment, so it opens
   * on the picker.
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

    // No compute yet, which is the whole point of asking first: picking the engine late
    // would mean throwing away a pass that had already run.
    setAlgorithmId(defaultAlgorithm);
    setPhase({ kind: 'choosing' });
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
   * The engine picker's confirm.
   *
   * Serves both ways in: a file still has to be decoded, while a take (or a second pass
   * after "Back") already has its audio in hand and goes straight to the expensive pass.
   */
  async function handleChooseEngine() {
    if (!selectedKey) return;
    // Whatever brought the user to the picker, going forward from it spends a fresh pass —
    // so the next time they back out, there is again something to lose.
    setReChoosingEngine(false);
    setDefaultAlgorithm(algorithmId);
    const initial = withDefaults(engine, savedParams[algorithmId]);

    if (audioRef.current) {
      await prepare(audioRef.current, algorithmId, initial, title());
      return;
    }

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
      await prepare(audio, algorithmId, initial, title());
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
  function handleParamChange(id: string, value: number | boolean) {
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

  /** Back to the picker. Releases the matrices immediately rather than holding them while
   *  the user reconsiders — the audio is still here, so changing your mind costs one pass,
   *  and holding both engines' output at once would be the worst moment to be carrying
   *  90MB. */
  function handleBackToChoosing() {
    releasePrepared();
    setResult(null);
    setRecomputing(false);
    setReChoosingEngine(true);
    setPhase({ kind: 'choosing' });
  }

  /**
   * Backing out of the picker — the button, the backdrop and Escape all land here.
   *
   * Free on the way in, and a dead end on the way back: the matrices are gone, so there is
   * no tune step left to return to and the only thing "no" can mean is the picker itself.
   * Asked rather than assumed, because the gesture that gets here is the same small one
   * either way while what it costs is not.
   */
  function handlePickerClose() {
    if (reChoosingEngine) { setConfirmDiscard(true); return; }
    handleCancel();
  }

  /** One place that turns a thrown import failure into either a bounce back to Home (the
   *  user cancelled) or the error phase, so both pipelines report failures the same way. */
  function showImportError(err: unknown, name: string, fallbackMessage: string) {
    const isImportError = err instanceof AudioImportError;
    const code    = isImportError ? err.code : 'decodeFailed';
    const message = isImportError ? err.message : fallbackMessage;

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
      setPhase({ kind: 'choosing' });
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
                candidates={ranking.ranked}
                recommendedCount={RECOMMENDED_KEYS}
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
              <Ionicons name="layers-outline" size={16} color={theme.accent} />
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

  if (phase.kind === 'choosing') {
    return (
      <SafeAreaView style={styles.safe}>
        {/* A quiet backdrop rather than a blank one: dismissing the modal returns here, and
            a screen with nothing on it would read as a failure rather than as a question
            waiting to be answered. */}
        <View style={styles.container}>
          <View style={styles.iconCircle}>
            <Ionicons name="musical-notes-outline" size={30} color={theme.accent} />
          </View>
          <Text style={styles.title}>Ready to transcribe</Text>
          <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
        </View>

        <TranscriptionEngineModal
          visible
          algorithms={engines}
          selectedId={algorithmId}
          onSelect={setAlgorithmId}
          onConfirm={() => void handleChooseEngine()}
          // Backing out of the picker is not a third answer about how to transcribe — it is
          // leaving, which is exactly what cancelling an import already does.
          onClose={handlePickerClose}
          subtitle={fileName}
          liveNoteCount={isFromRecording ? tabNotes.length : undefined}
          secondaryLabel={isFromRecording ? 'Use the live version' : undefined}
          onSecondary={isFromRecording ? handleUseLiveTranscription : undefined}
          // The backdrop behind this modal is deliberately bare, so without this the only
          // ways out are Escape and a backdrop tap — neither of them drawn anywhere.
          cancelLabel="Cancel"
        />

        {/* Rendered after the picker so it stacks above it, and only ever over it — the
            question is about the press the user just made there. Says what going ahead
            costs, since from here the file has to be uploaded and analysed again. */}
        <ActionSheetModal
          visible={confirmDiscard}
          // Short enough to survive the sheet's two-line clamp at this font size.
          title="Discard this import? You'd have to upload the file again."
          options={[
            { label: 'Discard import', style: 'destructive', onPress: handleCancel },
            // Named rather than left to the sheet's own "Cancel" row, which over a modal
            // about cancelling could only be read as cancelling that.
            { label: 'Keep choosing an engine' },
          ]}
          onClose={() => setConfirmDiscard(false)}
        />
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
          {/* The one thing the screen can't show by itself. What it *is* is already visible
              — a preview, a filename, a column of controls — but not that those controls
              re-detect the notes live, nor that the Studio is where this ends up. A heading
              here would only name what the workspace already says, at the cost of a row the
              preview wants. */}
          <Text style={styles.tuneInstruction}>
            Tune what counts as a note, then take it into the Studio to edit.
          </Text>

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

                  {/* What "Back" always did — it returns to the engine picker with the audio
                      still decoded — said as the thing it does rather than as a direction. */}
                  <Pressable
                    onPress={handleBackToChoosing}
                    style={({ pressed, hovered }: any) => [
                      styles.railSecondaryBtn,
                      (pressed || hovered) && styles.secondaryBtnPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Go back and choose a different transcription engine"
                  >
                    <Ionicons name="swap-horizontal-outline" size={15} color={theme.textSub} />
                    <Text style={styles.secondaryBtnText}>Change engine</Text>
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
    tuneInstruction: {
      fontFamily: Poppins.regular,
      fontSize:   FONT.sm,
      color:      theme.textSub,
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
