import type { HarmonicaKey, ExportFormat } from '@/types';

export const HARMONICA_KEYS: HarmonicaKey[] = [
  'C', 'Db', 'D', 'Eb', 'E', 'F',
  'F#', 'G', 'Ab', 'A', 'Bb', 'B',
];

export const EXPORT_FORMATS: ExportFormat[] = [
  'CSV', 'MIDI', 'TXT', 'MusicXML', 'JSON',
];

export const EXPORT_FORMAT_META: Record<
  ExportFormat,
  { label: string; description: string; icon: string }
> = {
  CSV:      { label: 'CSV',        description: 'Spreadsheet-compatible comma-separated values', icon: 'stats-chart-outline' },
  MIDI:     { label: 'MIDI',       description: 'Standard MIDI file for DAWs and notation apps',  icon: 'musical-notes-outline' },
  TXT:      { label: 'Plain Text', description: 'Human-readable tab notation',                    icon: 'document-text-outline' },
  MusicXML: { label: 'MusicXML',   description: 'Open standard for notation software',            icon: 'library-outline' },
  JSON:     { label: 'JSON',       description: 'Machine-readable structured data',               icon: 'code-slash-outline' },
};

export const DEMO_TAB_NOTES = [
  { tab: '4',   note: 'C4'  },
  { tab: '-4',  note: 'D4'  },
  { tab: '5',   note: 'E4'  },
  { tab: '-5',  note: 'F4'  },
  { tab: "4'",  note: 'C#4' },
  { tab: "-4'", note: 'Db4' },
  { tab: '6',   note: 'G4'  },
  { tab: '-6',  note: 'A4'  },
] as const;

export const FONT = {
  xs:   11,
  sm:   13,
  base: 15,
  md:   17,
  lg:   20,
  xl:   26,
  '2xl': 34,
  '3xl': 44,
} as const;
