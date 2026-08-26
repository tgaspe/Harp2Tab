/**
 * Pure sample selection. No fetch, no decode, no AudioContext — that is
 * `sampleCache.web.ts`'s job, and keeping the split means every decision in this file is
 * checkable under `tsx` (`scripts/verify-soundfont.ts`) where nothing about Web Audio is.
 */

import type { DrumKitManifest, DrumZone, InstrumentManifest, SampleZone } from './types';

/** The zone covering `midiKey`, or null when the instrument doesn't reach that far — in
 *  which case the caller falls back to an oscillator rather than stretching a sample two
 *  octaves and producing a chipmunk. */
export function zoneForKey(manifest: InstrumentManifest, midiKey: number): SampleZone | null {
  for (const zone of manifest.zones) {
    if (midiKey >= zone.loKey && midiKey <= zone.hiKey) return zone;
  }
  return null;
}

/** GM percussion is a *map*, not a scale: key 36 is a kick and key 38 is a snare, and
 *  neither is the other one transposed. An unmapped key is silent rather than approximate. */
export function drumZoneForKey(kit: DrumKitManifest, midiKey: number): DrumZone | null {
  for (const zone of kit.zones) {
    if (zone.key === midiKey) return zone;
  }
  return null;
}

/** Semitone distance from the zone's root, plus the zone's fine tuning, as a rate.
 *
 *  This is pitch ONLY. The transport's `options.rate` must never be folded in here: it
 *  compresses schedule times and has never changed pitch (`Playback.web.ts:71-73`), so
 *  multiplying it in would transpose the whole project up an octave at 2x speed. */
export function playbackRateFor(zone: SampleZone, midiKey: number): number {
  return Math.pow(2, (midiKey - zone.rootKey) / 12 + zone.tuneCents / 1200);
}

/** Loop points in seconds, for `AudioBufferSourceNode.loopStart`/`loopEnd`.
 *
 *  Divided by the sample's OWN rate, not the decoded buffer's: `decodeAudioData` resamples
 *  to the context rate (usually 48000) while the SF2 offsets are frames at the recorded
 *  rate, and seconds is the one unit that survives the resample unchanged. */
export function loopSecondsFor(zone: SampleZone): { start: number; end: number } | null {
  if (zone.loopStartFrames === undefined || zone.loopEndFrames === undefined) return null;
  if (zone.loopEndFrames <= zone.loopStartFrames) return null;
  return {
    start: zone.loopStartFrames / zone.sampleRate,
    end:   zone.loopEndFrames / zone.sampleRate,
  };
}
