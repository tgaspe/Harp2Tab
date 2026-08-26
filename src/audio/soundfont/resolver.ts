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
  // Web Audio treats a negative `loopStart` as "loop the whole buffer", so a bad offset
  // sustains by replaying the attack over and over rather than failing loudly. Refusing it
  // here means the note plays through unlooped instead, which is merely short.
  if (zone.loopStartFrames < 0) return null;
  return {
    start: zone.loopStartFrames / zone.sampleRate,
    end:   zone.loopEndFrames / zone.sampleRate,
  };
}

/**
 * How far into a sample to start, when playback begins partway through a note already
 * sounding — a seek into the middle of a held note.
 *
 * Three clocks have to be reconciled, and getting it wrong is silent. `elapsedMs` is
 * *nominal* project time since the note began. Dividing by the transport `rate` converts
 * that to wall-clock seconds, because rate compresses the schedule. Multiplying by
 * `pitchRate` converts wall-clock seconds to seconds *of buffer*, because the buffer is
 * playing at that speed.
 *
 * Omitting the `rate` division is correct at 1x and wrong by exactly a factor of `rate`
 * anywhere else, so it survives every test that doesn't seek mid-note at 0.5x or 2x.
 */
export function sampleOffsetSecFor(elapsedMs: number, rate: number, pitchRate: number): number {
  if (elapsedMs <= 0) return 0;
  return (elapsedMs / 1000 / rate) * pitchRate;
}

/**
 * Which cache entries to drop, oldest first, without ever dropping one the current project
 * needs.
 *
 * The pinned set is the whole point. A plain LRU evicts during the very load meant to warm
 * it: a Studio project with drums needs more entries than the cap on its own (the GM kit is
 * 60 files before a single melodic track), so entries are thrown away as fast as they
 * arrive and the scheduler then finds nothing resident. Pinning the working set means the
 * cache grows to whatever the project actually requires and only ever sheds what it doesn't.
 *
 * `order` is oldest-first — `Map` iteration order, given re-insertion on use.
 */
export function keysToEvict(order: string[], pinned: ReadonlySet<string>, max: number): string[] {
  const evictable = order.filter((key) => !pinned.has(key));
  const excess = order.length - max;
  if (excess <= 0) return [];
  return evictable.slice(0, Math.min(excess, evictable.length));
}
