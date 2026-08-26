/**
 * The shapes `scripts/build-soundfont.ts` writes and the runtime reads. Deliberately flat
 * and free of behaviour: this file is the contract between an offline build and a browser,
 * so anything clever here becomes a version-skew bug later.
 *
 * Source and provenance for the data these describe: `docs/plan/soundfont-source.md`.
 */

/** One sample plus the SF2 generators that decide how it is played back. */
export interface SampleZone {
  /** File name, relative to the instrument's own directory. */
  file: string;
  /** The right channel, when this zone came from an SF2 stereo pair — two mono samples
   *  sharing a key range, which MuseScore General names `... (L)` and `... (R)`.
   *
   *  A pair is one zone rather than two because `zoneForKey` returns a single zone per key:
   *  modelling it as two would make every stereo instrument's zones overlap and the
   *  no-gaps/no-overlaps validation meaningless. The scheduler plays both, panned hard
   *  apart. Absent for the mono samples that are most of this soundfont. */
  fileRight?: string;
  bytesRight?: number;
  sha256Right?: string;
  /** MIDI key at which the sample plays untransposed. */
  rootKey: number;
  /** Inclusive key range this zone covers. */
  loKey: number;
  hiKey: number;
  /** The sample's ORIGINAL rate. `decodeAudioData` resamples to the context rate, so loop
   *  offsets below are only meaningful against this number — see `loopSecondsFor`. */
  sampleRate: number;
  /** SF2 loop offsets in frames of *decoded* audio (verified against the pinned file:
   *  a sample occupying 11,524 compressed bytes loops 8→24,343). Absent means the sample is
   *  one-shot — a struck instrument decaying to silence — rather than sustained. */
  loopStartFrames?: number;
  loopEndFrames?: number;
  /** Fine tuning, cents. Folded into the playback rate. */
  tuneCents: number;
  /** Linear gain multiplier for this zone, so families sit together in a mix. */
  gain: number;
  /** -1 (hard left) … 1 (hard right). */
  pan: number;
  /** SF2 `initialFilterFc` in Hz. Absent means the zone is unfiltered. Omitting this at
   *  playback is what makes a sampled GM set sound synthetic — see the plan's
   *  "Decisions taken". */
  filterHz?: number;
  filterQ?: number;
  /** Volume-envelope release, seconds. Attack and decay are already in the audio. */
  releaseSec: number;
  bytes: number;
  sha256: string;
}

export interface InstrumentManifest {
  /** GM program, 0–127. */
  program: number;
  name: string;
  zones: SampleZone[];
  source: { soundfont: string; version: string; license: string };
}

/** A drum zone is selected by key rather than transposed by it, so it pins its own key and
 *  the name of the sound sitting there in the GM percussion map. */
export interface DrumZone extends SampleZone {
  key: number;
  drumName: string;
}

export interface DrumKitManifest {
  name: string;
  zones: DrumZone[];
  source: { soundfont: string; version: string; license: string };
}

export interface CatalogEntry {
  program: number;
  name: string;
  /** Directory name under the catalog's own directory, e.g. `000-acoustic-grand-piano`. */
  dir: string;
  bytes: number;
}

export interface Catalog {
  /** Pinned soundfont version. Also the asset directory name, so a new build can never mix
   *  old manifests with new samples. */
  version: string;
  instruments: CatalogEntry[];
  drums: { dir: string; bytes: number };
}
