/**
 * The sampled-instrument sound bank (Phase 11-6).
 *
 * Two halves, split by what they need to run: `resolver` is pure and decides *which* sample
 * plays and how, `sampleCache` fetches and decodes and exists only on web. The rest of the
 * app imports from here and never learns where samples are hosted.
 */

export type {
  Catalog, CatalogEntry, DrumKitManifest, DrumZone, InstrumentManifest, SampleZone,
} from './types';
export {
  drumZoneForKey, keysToEvict, loopSecondsFor, playbackRateFor, sampleOffsetSecFor, zoneForKey,
} from './resolver';
export {
  cachedBuffer, cachedDrumBuffer, cachedDrumKit, cachedManifest,
  DRUM_PROGRAM, ensureNotesLoaded, ensureProgramsLoaded, loadDrumKit, loadInstrument,
  sampleBufferFor,
  SOUNDFONT_DIR,
} from './sampleCache';
