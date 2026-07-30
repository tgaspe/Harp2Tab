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
}
