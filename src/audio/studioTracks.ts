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
