import type { TempoEvent, TimeSignatureEvent } from '@/audio/tempo';

export type HarmonicaType = 'diatonic' | 'chromatic';

export type HarmonicaKey =
  | 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F'
  | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';

export type ExportFormat = 'CSV' | 'MIDI' | 'TXT' | 'MusicXML' | 'JSON';

/**
 * Which scale a note's `velocity` is measured on.
 *
 * The three producers put genuinely incomparable quantities on the same 0–127 range, so
 * anything that shows the number to the user — or lets them filter on it — has to be able
 * to say which one it is holding. A threshold of 60 hides half a tracked take and almost
 * nothing from a neural one.
 *
 * A *unit*, not an authorship record. The user can drag a note's velocity in the Velocity
 * chart, and doing so leaves this untouched: the edit moves the value along the scale, it
 * does not move the note onto a different scale. So a `takeRelativeRms` note whose velocity
 * the user set by hand is still an RMS-relative reading — the filter keeps thresholding it
 * against its neighbours exactly as before, which is the whole reason to know the unit.
 * This is also why there is no `'manual'` member and why `velocity` is writable while this
 * is not; see the update types in `useAppStore.ts` and `studioNotes.ts`.
 */
export type VelocitySource =
  /** Stated outright by a MIDI file, or by a Studio project derived from one. */
  | 'midiVelocity'
  /** `RawFrame.rms` normalised against the take's own 10th/95th percentiles. Relative to
   *  the performance, not an absolute loudness — see `src/audio/velocity.ts`. */
  | 'takeRelativeRms'
  /** The neural engine's per-note activation. It saturates near the top of its range, so
   *  it reads as "was this note clearly sounded" more than "how hard was it played". */
  | 'modelActivation';

export interface TabNote {
  id: string;
  /** Harmonica tab notation, e.g. "-4'" or "3" */
  tab: string;
  /** Scientific pitch name, e.g. "G4" */
  note: string;
  /** Duration in milliseconds */
  duration: number;
  /** Time from recording start in milliseconds */
  start_time: number;
  /** Detection confidence 0–100 (% of frames in the note's run that matched its tab) */
  confidence: number;
  /** How loud the note is, 0–127 on MIDI's velocity scale. Optional — absent means no
   *  dynamic was stated, which every consumer treats as "unknown" rather than as silence.
   *
   *  Read `velocitySource` before comparing two of these: the number is measured three
   *  incompatible ways, and only within one scale is it meaningful to say one note is
   *  louder than another.
   *
   *  User-editable, by dragging the note's bar in the Velocity chart. */
  velocity?: number;
  /** Which scale `velocity` is on. Optional: absent on everything saved before this
   *  existed, on audio uploads migrated from the old `breathForce` field (where the engine
   *  was never recorded and so is unknowable after the fact), and on hand-drawn notes,
   *  which were never measured against anything.
   *
   *  Never written by an edit — see `VelocitySource`. */
  velocitySource?: VelocitySource;
  /** General MIDI program, as a *playback* hint only — it never affects tabs. Set when the
   *  Studio hands a multi-track project to the scheduler, so a flute and a cello don't
   *  arrive as the same tone; absent for a tab session, which is one harmonica. */
  program?: number;
}

/** A single raw pitch/loudness sample from the capture pipeline, retained for Frame
 *  Inspector — distinct from `TabNote`, which is a committed, segmented note. */
export interface RawFrame {
  frequency: number;
  rms: number;
  /** ms since the session started (not wall-clock epoch) */
  t: number;
}

/** A saved, identified recording session — the library/history unit (as opposed to
 *  `TabNote[]`, which is just the in-progress editing state for the current session). */
export interface TabRecording {
  id: string;
  title: string;
  key: HarmonicaKey;
  harmonicaType: HarmonicaType;
  tabNotes: TabNote[];
  /** Epoch ms when the session started */
  createdAt: number;
  /** Epoch ms of the last mutation — title, favourite, notes, either filter lens.
   *
   *  Stamped centrally by `touch()` in `useRecordingsStore`, never by callers, for the same
   *  reason `MidiProject.updatedAt` is: a timestamp that every mutator has to remember to set
   *  is a timestamp that is eventually wrong.
   *
   *  Added ahead of the thing that consumes it. Phase 7b reconciles a local library against a
   *  cloud one by comparing this field, and there is no way to recover a value for edits that
   *  happened before it existed — so it ships a phase early, seeded from `createdAt`, and
   *  accumulates real history in the meantime. */
  updatedAt: number;
  /** Total length in ms, derived from the last note's start_time + duration */
  duration: number;
  /** Raw frames for Frame Inspector — optional since recordings saved before this
   *  existed won't have it, and older persisted-schema recordings will lack it too. */
  frames?: RawFrame[];
  /** Beats per minute — optional for the same reason (recordings saved before the
   *  piano-roll's tempo feature existed). Consumers should fall back to a default. */
  bpm?: number;
  /** Starred in the recordings list — optional, absent/false for every recording saved
   *  before this existed. */
  favorite?: boolean;
  /** Noise-gate threshold on `TabNote.velocity`'s 0–127 scale: notes below it are hidden
   *  from the editor, playback and export. Optional — absent means off, which is what every
   *  recording saved before this existed should get.
   *
   *  Stored *alongside* the full `tabNotes` rather than applied to it. The gate is a lens,
   *  not an edit, so a recording saved at gate 60 still carries every quiet note and can be
   *  slid back open later. */
  noiseGate?: number;
  /** Duration-floor threshold in milliseconds: notes shorter than it are hidden from the
   *  editor, playback and export. Optional — absent means off, like every recording saved
   *  before this existed.
   *
   *  Non-destructive on exactly the same terms as `noiseGate`, and stored beside it rather
   *  than folded into one "filters" object: they're independent lenses over the same notes,
   *  and a flat field is what keeps the session snapshot a plain diffable record. */
  durationFloorMs?: number;
  /** How this tab was created. Optional: absent means a recording saved before the field
   *  existed. Frame Inspector needs it to tell "no frames because this predates frame
   *  retention" from "no frames because a MIDI import never had audio at all". */
  source?: RecordingSource;
  /** Set when this tab was converted out of a MIDI Studio project. Conversion is a
   *  snapshot, not a live link — these exist so "re-convert from source" can find the
   *  track again, which is most of what linking would buy without any merge semantics.
   *  Either may dangle if the project was since deleted or the track removed; callers
   *  must treat a miss as "source gone", not an error. */
  sourceProjectId?: string;
  sourceTrackId?:   string;
}

/** Which library a document belongs to. Tabs and projects share one `deleted` collection in
 *  Firestore, so a tombstone has to say which store it applies to — the document it refers to
 *  is, by definition, no longer there to be asked. */
export type SyncKind = 'tab' | 'project';

/**
 * A record that something was deleted, kept after the thing itself is gone (7b-3).
 *
 * **Deletion is the one library change that leaves no trace to sync.** An id present in the
 * cloud and absent locally is indistinguishable from "deleted here" and "not pulled yet", and
 * guessing wrong either resurrects a deleted tab or silently drops a new one. So each store
 * appends one of these inside its own delete action, where the write is atomic with the
 * deletion — a log kept anywhere else could be lost to a tab closed in between, which is the
 * exact failure tombstones exist to prevent.
 *
 * Garbage-collected after `TOMBSTONE_TTL_MS`. A device offline longer than that can resurrect
 * a deleted item; the alternative is a log that only ever grows.
 */
export interface Tombstone {
  id:        string;
  /** Epoch ms. */
  deletedAt: number;
  kind:      SyncKind;
}

export type RecordingSource = 'recording' | 'audioUpload' | 'midiUpload' | 'midiStudio';

// ── MIDI Studio (Phase 11) ────────────────────────────────────────────────────
//
// A deliberately separate document from `TabRecording`. A tab is one player's single line
// with a harmonica key attached; a project is many tracks of unconstrained music with no
// instrument assumption at all. Keeping them apart is what lets the Studio be a general
// MIDI editor, and avoids migrating live production `TabRecording` data for a feature that
// doesn't change what a tab is.

/** A single MIDI note, in the app's own units (ms from the start of the piece). */
export interface MidiNote {
  midi:       number;
  timeMs:     number;
  durationMs: number;
  /** 0–127. Optional: absent means unstated, and is played at a default rather than
   *  silently becoming zero. This is the velocity lane in the Studio. */
  velocity?:  number;
}

export interface MidiTrackData {
  id:      string;
  name:    string;
  /** General MIDI program number, 0–127. */
  program: number;
  /** 0-based MIDI channel; 9 is percussion. */
  channel: number;
  /** Lane colour in the Studio, so tracks stay distinguishable at arrange-view scale. */
  color:   string;
  muted:   boolean;
  soloed:  boolean;
  notes:   MidiNote[];
  /** Where this track's note velocities came from, when it's known.
   *
   *  Lives on the track rather than on each note because a project persists as SMF bytes,
   *  and SMF has nowhere to put a provenance tag — the `trackMeta` JSON sidecar does.
   *  Conversion stamps it onto every `TabNote` it produces, which is where the filter and
   *  the velocity lane read it. */
  velocitySource?: VelocitySource;
  /**
   * This track's velocity floor, 0–127 on the same scale as `MidiNote.velocity`. Notes
   * below it are hidden from the roll, silent in playback, and dropped from what the
   * Studio exports — but never deleted: the track keeps them, and lowering the floor
   * brings them straight back.
   *
   * Per *track* rather than per project, because the threshold that separates a real
   * phrase from a ghost note is a property of how that part was played or programmed —
   * a lightly-sequenced pad and a hard-hit drum lane have nothing useful in common here.
   *
   * Optional, and absent means 0/off. Lives in the `trackMeta` sidecar for the same
   * reason `velocitySource` does: SMF has nowhere to put it.
   */
  velocityFloor?: number;
  /**
   * The track's duration-floor line, in milliseconds. Notes shorter than it are hidden from
   * the roll, silent in playback, and dropped from what the Studio exports — never deleted,
   * on the same terms as `velocityFloor`.
   *
   * Per track for the same reason: what counts as too short to be a real note depends on the
   * part. A 60 ms event is a ghost in a sustained pad and an ordinary hi-hat in a drum lane.
   *
   * Optional, and absent means 0/off. Rides in the `trackMeta` sidecar because SMF has
   * nowhere to put it.
   */
  durationFloorMs?: number;
}

export interface MidiProject {
  id:             string;
  title:          string;
  /** Epoch ms. */
  createdAt:      number;
  updatedAt:      number;
  tracks:         MidiTrackData[];
  /** Always non-empty after a round trip — `compileTempoMap` implies an event at 0. */
  tempos:         TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  durationMs:     number;
  /**
   * Where the music came from, carried so the tab conversion produces can say so.
   *
   * Every Studio conversion used to report `'midiStudio'`, which is true of the route but
   * not of the material: a transcribed take and an imported arrangement arrive by the same
   * road and Frame Inspector needs to tell them apart. Absent on every project saved before
   * this existed, which still reads as `'midiStudio'`.
   */
  origin?:        RecordingSource;
}
