/**
 * Renders a known tab sequence to a WAV, for exercising the audio-upload path by hand.
 *
 * Reuses `synthesizeWav` — the same renderer native playback uses — so the file's pitches
 * are exactly what the tabs it was built from are supposed to sound like. That makes what
 * comes back out of an import checkable against a stated ground truth rather than a guess.
 *
 * Run: npx tsx scripts/make-test-wav.ts [outPath]
 */

import { writeFileSync } from 'fs';
import { synthesizeWav } from '../src/audio/synthesizeWav';
import { tabToNote } from '../src/audio/HarmonicaMapper';
import type { TabNote } from '../src/types';

const KEY = 'C' as const;
const TABS = ['4', '-4', '5', '-5', '6', '-6', '6', '-5', '5', '-4', '4'];
const NOTE_MS = 400;
const GAP_MS  = 100;

const notes: TabNote[] = TABS.map((tab, i) => ({
  id:         `n${i}`,
  tab,
  note:       tabToNote(tab, KEY, 'diatonic') ?? '',
  duration:   NOTE_MS,
  start_time: i * (NOTE_MS + GAP_MS),
  confidence: 100,
}));

const outPath = process.argv[2] ?? 'harp2tab-test-scale.wav';
writeFileSync(outPath, synthesizeWav(notes, 44100));

console.log(`Wrote ${outPath}`);
console.log(`Key:      ${KEY} diatonic`);
console.log(`Expected: ${TABS.join(' ')}`);
console.log(`Pitches:  ${notes.map((n) => n.note).join(' ')}`);
