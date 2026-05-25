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
  /** Detection confidence 0–100 (60 = 3/5 frames, 80 = 4/5, 100 = 5/5) */
  confidence: number;
}
