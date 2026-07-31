// Shared segment-boundary primitives for the loudness-first and hybrid segmenters
// (src/audio/segmenters/), exposed as `createEnvelopeGate` — a stateful driver both
// segmenters (and Frame Inspector's debug trace) call identically, so the boundary logic
// can never drift between what's plotted and what's actually decided.
//
// Two complementary mechanisms decide segment boundaries:
//  - An absolute threshold, anchored to a silence-gated adaptive floor, decides when a
//    whole PHRASE starts/ends (silence -> playing, and playing -> silence).
//  - A peak-relative dip/rise detector — peak tracked since the last boundary; a note ends
//    when loudness dips to a fraction of that peak, and the split is confirmed once
//    loudness recovers — decides where individual NOTES split *within* a phrase. This is
//    the same technique NoteDetector.ts's onset detector already uses for re-attacks. It's
//    the right test here because the loudness dip between two notes played back-to-back is
//    usually nowhere near true silence: it's a fraction of the phrase's own volume, not of
//    the room's noise floor.
//
// An earlier version of this file used only the absolute threshold for both jobs, which
// meant multi-note phrases with no full silence between notes collapsed into a single
// note (median pitch-labeled from whichever tab happened to have the most frames), because
// the silence-anchored low threshold never sat high enough for the phrase's own internal
// dips to cross under it.

export interface EnvelopeConfig {
  floorMs:            number; // adaptive floor EMA time constant — applied only while silent
  thresholdMult:      number; // "phrase active" threshold = floor * thresholdMult
  hysteresisLowRatio: number; // "phrase silent" threshold = active threshold * this ratio
  minFloorAbs:        number; // absolute floor fallback before any ambient floor has been learned
  hangoverMs:         number; // phrase must stay below the silent threshold this long to end
  dipRatio:           number; // within a phrase, loudness must fall to <= this fraction of the local peak to start a dip
  riseRatio:          number; // loudness must then recover to >= this fraction of the local peak to confirm a split (hysteresis above dipRatio)
  minDipMs:           number; // dip must last this long to count as a real re-attack, not frame noise
}

interface EnvelopeState {
  value:  number;        // raw per-frame RMS — no smoothing applied
  floor:  number;        // adaptive ambient noise floor
  lastMs: number | null; // timestamp of the previous step; null before the first frame
}

function emptyEnvelopeState(): EnvelopeState {
  return { value: 0, floor: 0, lastMs: null };
}

// Converts a smoothing time constant into a per-step EMA coefficient scaled by the actual
// elapsed time — keeps a given config behaving consistently regardless of frame cadence.
function smoothingCoeff(dtMs: number, timeConstantMs: number): number {
  if (timeConstantMs <= 0) return 1;
  return 1 - Math.exp(-dtMs / timeConstantMs);
}

// `isSilent` is the caller's active/inactive state *before* this frame. The floor is only
// ever updated while that's true, exactly mirroring NoteDetector.ts's ambientRms (which
// only updates during confirmed silence) — a sustained loud passage can never drag the
// floor (and therefore the phrase threshold) upward while it's playing.
function envelopeStep(state: EnvelopeState, rms: number, now: number, isSilent: boolean, cfg: EnvelopeConfig): EnvelopeState {
  const value = rms;
  if (state.lastMs === null) return { value, floor: rms, lastMs: now };

  const dtMs = Math.max(0, now - state.lastMs);
  let floor = state.floor;
  if (isSilent) {
    const floorCoeff = smoothingCoeff(dtMs, cfg.floorMs);
    floor = state.floor + floorCoeff * (value - state.floor);
  }
  return { value, floor, lastMs: now };
}

function computeThresholds(floor: number, cfg: EnvelopeConfig): { high: number; low: number } {
  const high = Math.max(floor, cfg.minFloorAbs) * cfg.thresholdMult;
  return { high, low: high * cfg.hysteresisLowRatio };
}

/** `at` is the boundary's real timestamp — backdated to when silence actually began for
 *  'end' (not when the hangover timer happened to expire), so notes aren't padded with
 *  trailing quiet frames.
 *
 *  'split' carries two *different* timestamps rather than one shared boundary: `prevEnd`
 *  is where loudness started falling (the previous note's release), `nextStart` is where
 *  the rise back past riseRatio was confirmed (the next note's attack already landed). The
 *  gap between them — the fall-then-rise transient itself — belongs to neither note. An
 *  earlier version collapsed both into a single timestamp, which made every split-produced
 *  note touch the next with zero gap ("glued together"), even though the underlying
 *  loudness clearly dips and recovers between them. */
export type GateEvent =
  | { type: 'start'; at: number }
  | { type: 'split'; prevEnd: number; nextStart: number }
  | { type: 'end'; at: number };

export interface GateStepResult {
  event: GateEvent | null;
  value: number; // for debug visualization
  floor: number;
  high:  number;
  low:   number;
}

export function createEnvelopeGate(cfg: EnvelopeConfig) {
  let env: EnvelopeState = emptyEnvelopeState();
  let active = false;
  let belowLowSinceMs: number | null = null;
  let peak = 0;
  let dipping = false;
  let dipStartMs = 0;

  function reset() {
    env = emptyEnvelopeState();
    active = false;
    belowLowSinceMs = null;
    peak = 0;
    dipping = false;
  }

  function step(rms: number, now: number): GateStepResult {
    env = envelopeStep(env, rms, now, !active, cfg);
    const { high, low } = computeThresholds(env.floor, cfg);
    const base = { value: env.value, floor: env.floor, high, low };

    if (!active) {
      if (env.value >= high) {
        active = true;
        belowLowSinceMs = null;
        peak = env.value;
        dipping = false;
        return { ...base, event: { type: 'start', at: now } };
      }
      return { ...base, event: null };
    }

    // Absolute: is the whole phrase ending?
    if (env.value < low) {
      if (belowLowSinceMs === null) belowLowSinceMs = now;
      if (now - belowLowSinceMs >= cfg.hangoverMs) {
        const at = belowLowSinceMs;
        active = false;
        belowLowSinceMs = null;
        dipping = false;
        return { ...base, event: { type: 'end', at } };
      }
      return { ...base, event: null };
    }
    belowLowSinceMs = null;

    // Relative: a dip-then-rise between two notes within the still-active phrase.
    if (env.value > peak) peak = env.value;

    if (!dipping) {
      if (env.value <= peak * cfg.dipRatio) {
        dipping = true;
        dipStartMs = now;
      }
      return { ...base, event: null };
    }

    if (env.value >= peak * cfg.riseRatio) {
      const dipDurationMs = now - dipStartMs;
      dipping = false;
      if (dipDurationMs >= cfg.minDipMs) {
        const prevEnd = dipStartMs;
        peak = env.value; // this frame starts the new note's own peak reference
        return { ...base, event: { type: 'split', prevEnd, nextStart: now } };
      }
    }
    return { ...base, event: null };
  }

  return { step, reset };
}
