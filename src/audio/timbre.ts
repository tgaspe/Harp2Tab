/**
 * General MIDI program → an oscillator voice.
 *
 * Not an attempt at realism — it's an attempt at *distinguishability*. The Studio's track
 * panel is only useful if you can tell the flute from the cello when you play them
 * together, and a single sine for all twelve tracks makes an orchestral file an
 * undifferentiated wash. Waveform plus envelope is enough to separate families by ear,
 * costs nothing, and is what the SoundFont path (11-6) falls back to when samples aren't
 * loaded.
 *
 * GM organises programs into sixteen families of eight, which is what the switch below
 * keys off — the family is the part that determines how an instrument speaks.
 */

export type OscillatorKind = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface Voice {
  type: OscillatorKind;
  /** Seconds to reach full level. A struck instrument is near-instant; a bowed or blown
   *  one takes real time, and that difference is most of what identifies it. */
  attackSec:  number;
  /** Seconds to fall from full level to `sustainLevel`. */
  decaySec:   number;
  /** 0–1. Below 1 the note keeps fading while held — a piano decays, an organ doesn't. */
  sustainLevel: number;
  releaseSec: number;
  /** Scales the note's overall loudness. A sawtooth at the same amplitude as a sine is
   *  perceptually much louder, so families are trimmed to sit together in a mix. */
  gain: number;
}

const PLUCKED: Voice   = { type: 'triangle', attackSec: 0.005, decaySec: 0.28, sustainLevel: 0.25, releaseSec: 0.16, gain: 0.9 };
const STRUCK: Voice    = { type: 'triangle', attackSec: 0.004, decaySec: 0.5,  sustainLevel: 0.1,  releaseSec: 0.2,  gain: 0.95 };
const SUSTAINED: Voice = { type: 'sine',     attackSec: 0.02,  decaySec: 0.05, sustainLevel: 1,    releaseSec: 0.08, gain: 1 };
const BOWED: Voice     = { type: 'sawtooth', attackSec: 0.09,  decaySec: 0.1,  sustainLevel: 0.85, releaseSec: 0.14, gain: 0.5 };
const BRASS: Voice     = { type: 'sawtooth', attackSec: 0.05,  decaySec: 0.08, sustainLevel: 0.9,  releaseSec: 0.1,  gain: 0.45 };
const REED: Voice      = { type: 'square',   attackSec: 0.03,  decaySec: 0.06, sustainLevel: 0.9,  releaseSec: 0.09, gain: 0.4 };
const PIPE: Voice      = { type: 'triangle', attackSec: 0.04,  decaySec: 0.06, sustainLevel: 0.95, releaseSec: 0.1,  gain: 0.85 };
const BASS: Voice      = { type: 'sine',     attackSec: 0.008, decaySec: 0.2,  sustainLevel: 0.6,  releaseSec: 0.12, gain: 1.1 };
const PAD: Voice       = { type: 'sawtooth', attackSec: 0.25,  decaySec: 0.2,  sustainLevel: 0.8,  releaseSec: 0.4,  gain: 0.35 };
const PERCUSSIVE: Voice = { type: 'square',  attackSec: 0.002, decaySec: 0.12, sustainLevel: 0,    releaseSec: 0.05, gain: 0.7 };

/** The default when no program is stated — the plain tone every tab session has always
 *  played, so the tab editor's sound doesn't change. */
export const DEFAULT_VOICE: Voice = SUSTAINED;

export function voiceForProgram(program: number | undefined): Voice {
  if (program === undefined || !Number.isFinite(program)) return DEFAULT_VOICE;

  switch (Math.floor(Math.max(0, Math.min(127, program)) / 8)) {
    case 0:  return STRUCK;      // piano
    case 1:  return PERCUSSIVE;  // chromatic percussion
    case 2:  return SUSTAINED;   // organ
    case 3:  return PLUCKED;     // guitar
    case 4:  return BASS;        // bass
    case 5:  return BOWED;       // strings
    case 6:  return BOWED;       // ensemble
    case 7:  return BRASS;       // brass
    case 8:  return REED;        // reed
    case 9:  return PIPE;        // pipe
    case 10: return BRASS;       // synth lead
    case 11: return PAD;         // synth pad
    case 12: return PAD;         // synth effects
    case 13: return PLUCKED;     // ethnic
    case 14: return PERCUSSIVE;  // percussive
    default: return PERCUSSIVE;  // sound effects
  }
}

/** MIDI velocity (0–127) → a gain multiplier. Squared rather than linear because loudness
 *  is perceived roughly that way — a linear map makes soft notes sound louder than they
 *  should and flattens the dynamic range the breath-force lane is there to shape. */
export function velocityGain(velocity: number | undefined): number {
  if (velocity === undefined || !Number.isFinite(velocity)) return 1;
  const normalized = Math.max(0, Math.min(127, velocity)) / 127;
  return normalized * normalized;
}
