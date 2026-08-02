import type { TempoEvent, TimeSignatureEvent } from '@/audio/tempo';

export type HarmonicaType = 'diatonic' | 'chromatic';

export type HarmonicaKey =
  | 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F'
  | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';

export type ExportFormat = 'CSV' | 'MIDI' | 'TXT' | 'MusicXML' | 'JSON';

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
  /** How hard the note is blown or drawn, 0–127 on MIDI's velocity scale. Optional —
   *  absent on everything saved before the Studio's breath-force lane existed. Recorded
   *  sessions derive it from `RawFrame.rms` normalised against the mic calibration; MIDI
   *  supplies it directly. */
  breathForce?: number;
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
   *  silently becoming zero. This is the breath-force lane in the Studio. */
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
}
