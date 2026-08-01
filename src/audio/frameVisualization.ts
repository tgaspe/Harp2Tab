// Pure, UI-free helpers for rendering RawFrame timelines — shared between Frame
// Inspector (a finished recording, replayed) and LiveAnalysisPanel (an in-progress
// recording, polled). Neither owns these; both import from here so the frame→pixel
// math stays in one place.

import { frequencyToTab } from '@/audio/HarmonicaMapper';
import type { RawFrame } from '@/audio/frameBuffer';
import type { HarmonicaKey, HarmonicaType } from '@/types';

const NOTE_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Neutral filler color for silent/unmapped frames in the raw track.
export const SILENCE_COLOR = '#8a8a92';

export function noteColor(note: string): string {
  const name = note.replace(/\d+$/, '');
  const idx = NOTE_ORDER.indexOf(name);
  if (idx === -1) return '#8a8a92';
  const hue = Math.round((idx * 360) / 12);
  return `hsl(${hue}, 58%, 56%)`;
}

export function midiOf(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

// Math.max(...arr)/Math.min(...arr) risk a call-stack overflow once `arr` has
// thousands of elements (a long recording's frame array) — reduce instead.
export function maxOf(nums: number[], floor: number): number {
  return nums.reduce((m, n) => (n > m ? n : m), floor);
}
export function minOf(nums: number[], ceiling: number): number {
  return nums.reduce((m, n) => (n < m ? n : m), ceiling);
}

export function splitValidRuns(frames: RawFrame[]): RawFrame[][] {
  const runs: RawFrame[][] = [];
  let current: RawFrame[] = [];
  for (const f of frames) {
    if (isFinite(f.frequency) && f.frequency > 0) {
      current.push(f);
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

export interface RawSegment {
  startT: number;
  endT:   number;
  note:   string | null; // scientific pitch name, e.g. "C4" — null means no pitch detected
}

// Merge consecutive frames that resolve to the same note into one segment — matches
// the "[C4C4C4C4C4C5...]" run-length pattern this track was designed around, and gives
// each run enough width to actually show its note name instead of one sliver per frame.
export function buildRawSegments(
  frames: RawFrame[],
  harmonicaKey: HarmonicaKey,
  harmonicaType: HarmonicaType,
): RawSegment[] {
  const segments: RawSegment[] = [];
  let current: RawSegment | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f      = frames[i];
    const result = frequencyToTab(f.frequency, harmonicaKey, harmonicaType);
    const note   = result?.note ?? null;
    const nextT  = frames[i + 1]?.t ?? f.t + 40;
    if (current && current.note === note) {
      current.endT = nextT;
    } else {
      if (current) segments.push(current);
      current = { startT: f.t, endT: nextT, note };
    }
  }
  if (current) segments.push(current);
  return segments;
}
