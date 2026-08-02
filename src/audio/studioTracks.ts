/**
 * Track-level questions that both the UI and playback have to answer the same way.
 *
 * Kept out of `TrackList.tsx` because the panel isn't the authority on any of this — the
 * scheduler needs the identical answer to "which tracks sound", and a harness needs to be
 * able to ask without importing React Native.
 */

import { instrumentByPatchID } from '@tonejs/midi/dist/InstrumentMaps';
import type { MidiTrackData } from '@/types';

/** GM program number → instrument name. Falls back to the number rather than a wrong name
 *  if a file declares a program outside the standard 128. */
export function instrumentName(program: number): string {
  return instrumentByPatchID[program] ?? `Program ${program}`;
}

/**
 * Which tracks should sound, resolving solo against mute the way every sequencer does:
 * any track soloed anywhere silences every track that isn't, and mute still wins over solo
 * on the same track.
 */
export function audibleTracks(tracks: readonly MidiTrackData[]): MidiTrackData[] {
  const anySoloed = tracks.some((t) => t.soloed);
  return tracks.filter((t) => !t.muted && (!anySoloed || t.soloed));
}

/** GM's sixteen families, each the first program in its block of eight. */
export const GM_FAMILIES = [
  'Piano', 'Chromatic Percussion', 'Organ', 'Guitar',
  'Bass', 'Strings', 'Ensemble', 'Brass',
  'Reed', 'Pipe', 'Synth Lead', 'Synth Pad',
  'Synth Effects', 'Ethnic', 'Percussive', 'Sound Effects',
] as const;

export function familyOf(program: number): string {
  return GM_FAMILIES[Math.floor(Math.max(0, Math.min(127, program)) / 8)];
}

/**
 * Programs offered by the instrument picker.
 *
 * All 128, grouped by family — a scrolling list of every GM program is genuinely what this
 * needs to be, since which instrument a track should sound like is the user's call and
 * abridging the list would just mean the one they want is missing.
 */
export function gmProgramOptions(): { program: number; name: string; family: string }[] {
  return Array.from({ length: 128 }, (_, program) => ({
    program,
    name:   instrumentName(program),
    family: familyOf(program),
  }));
}
