/**
 * Native. Phase 11-6 ships web only (see the plan's "Native" section); returning nulls here
 * is what makes the fallback to `voiceForProgram` automatic rather than something every
 * caller has to remember. Signatures must stay identical to the `.web.ts` twin or the
 * platform split compiles on one platform and not the other.
 */

import type { DrumKitManifest, DrumZone, InstrumentManifest } from './types';

export const SOUNDFONT_DIR = '';
export const DRUM_PROGRAM = 128;

export async function loadInstrument(_program: number): Promise<InstrumentManifest | null> { return null; }
export async function loadDrumKit(): Promise<DrumKitManifest | null> { return null; }
export async function sampleBufferFor(_program: number, _file: string): Promise<AudioBuffer | null> { return null; }
export async function ensureProgramsLoaded(_programs: number[], _includeDrums: boolean): Promise<void> { /* no-op */ }
export function cachedManifest(_program: number): InstrumentManifest | null { return null; }
export function cachedDrumKit(): DrumKitManifest | null { return null; }
export function cachedBuffer(_program: number, _file: string): AudioBuffer | null { return null; }
export function cachedDrumBuffer(_zone: DrumZone): AudioBuffer | null { return null; }
