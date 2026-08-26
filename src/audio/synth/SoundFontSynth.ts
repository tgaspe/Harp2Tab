/**
 * Native. The synth is an AudioWorklet, which native has no equivalent of, so native keeps
 * `synthesizeWav` and its oscillator voices — Phase 11-6's standing decision. Signatures
 * match the `.web.ts` twin so the platform split compiles on both.
 */

import type { Synth } from './types';

export const PERCUSSION_CHANNEL = 9;

export function loadSynth(_ctx: unknown): Promise<Synth | null> { return Promise.resolve(null); }
export function currentSynth(): Synth | null { return null; }
export function synthAttempted(): boolean { return false; }
