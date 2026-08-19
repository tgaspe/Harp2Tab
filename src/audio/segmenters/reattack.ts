/**
 * Re-attack detection from the amplitude envelope alone.
 *
 * This is the one thing pMPM does that no note-lane engine has ever done: hear the same note
 * played twice. `NoteDetector` has carried it since the live path was written
 * (`NoteDetector.ts:79`), and it is why the classic tracker splits a tongued repeat while
 * Basic Pitch and the old spectral engine wrote it as one long note. Pitch cannot decide
 * this — the pitch does not change — and neither can silence, since a tongued repeat's gap
 * often never reaches the voicing gate. Amplitude is the only evidence there is.
 *
 * It matters more here than it did in pMPM. At 24 bins/octave the CQT's effective window is
 * ~201ms at the bottom of the harmonica's range, so the pitch track physically cannot
 * resolve a fast repeated low note. The 1024-sample RMS envelope can.
 *
 * ## The constants, measured
 *
 * pMPM's own — `dipRatio 0.5 / riseRatio 0.65 / minDipMs 50` — are calibrated against 46.4ms
 * non-overlapping frames (`analyzeSamples.ts:26`). This engine runs at 11.61ms, where
 * `minDipMs 50` is ~4 frames instead of ~1 and vibrato ripple is fully resolved rather than
 * smeared. They were re-swept against synthesised repeats (2/4/6/8 per second × gap depths
 * from full silence to a 30% dip) and a vibrato control (4/5/6.5Hz × 40–60% depth), scoring
 * onset F1 at 50ms tolerance — `/Users/theo/audio_analysis/reattack_sweep.py`:
 *
 * | dipRatio | riseRatio | minDipMs | repeat F1 | vibrato false splits |
 * |----------|-----------|----------|-----------|----------------------|
 * | **0.35** | **0.85**  | **20**   | **0.965** | **0**                |
 * | 0.35     | 0.75      | 20       | 0.960     | 0                    |
 * | 0.35     | 0.65      | 20       | 0.903     | 0                    |
 * | 0.40     | 0.92      | 20       | 0.985     | 4                    |
 * | 0.70     | 0.85      | 20       | 1.000     | 133                  |
 * | 0.50     | 0.65      | 50       | 0.516     | 37   ← pMPM's own    |
 *
 * **pMPM's constants fail outright at this frame rate** — half the repeats missed and 37
 * fabricated splits on held vibrato notes. Copying them across would have been a guess
 * wearing a measurement's clothes.
 *
 * The objective was deliberately constrained rather than maximised: the best repeat F1
 * **subject to zero vibrato false splits**. A detector that splits a held vibrato note
 * fabricates notes the player never played, which is a worse failure than missing a fast
 * repeat — the same reasoning that made octave errors, not misses, the spectral engine's
 * objective. 0.35 is a genuine optimum rather than a grid edge: values below it do not
 * improve F1, and 0.40 already costs four false splits.
 *
 * The chosen triple sits in the middle of the clean plateau (rise 0.75–0.92 × minDip 8–20
 * are all clean at F1 0.965), not at its best corner, so real material that behaves slightly
 * differently from the synthesis has room either side.
 *
 * `noiseFloorAlpha` is the one value rescaled rather than re-measured. pMPM's 0.02 at 46.4ms
 * gives a ~2.3s time constant; 0.005 at 11.61ms gives the same. That is arithmetic, not a
 * judgement call.
 */

export interface ReattackConfig {
  /** RMS must fall to ≤ this fraction of the running peak to start a dip. */
  dipRatio:        number;
  /** ...and recover to ≥ this fraction to confirm one. Kept above `dipRatio` on purpose —
   *  the gap between them is the hysteresis that stops a wobble reading as two notes. */
  riseRatio:       number;
  /** How long the dip must last to count as real rather than frame noise. */
  minDipMs:        number;
  /** EMA factor for the ambient floor, learned from ungated frames. */
  noiseFloorAlpha: number;
  /** The envelope peak must exceed this multiple of the ambient floor before any of this is
   *  trusted. Raw RMS is device-dependent — mic gain, AGC — so a fixed cutoff is not
   *  portable between recordings. */
  noiseFloorMult:  number;
  /** Absolute fallback, used before any ambient noise has been sampled. */
  minPeakRmsFloor: number;
}

export const DEFAULT_REATTACK_CONFIG: ReattackConfig = {
  dipRatio:        0.35,
  riseRatio:       0.85,
  minDipMs:        20,
  noiseFloorAlpha: 0.005,
  noiseFloorMult:  2.5,
  minPeakRmsFloor: 0.001,
};

/**
 * Frame indices at which a re-attack was confirmed.
 *
 * Pure — same inputs, same output, no state across calls — because the cheap half runs it on
 * every slider tick.
 */
export function detectReattacks(
  rms:    Float32Array,
  voiced: Uint8Array,
  hopMs:  number,
  config: ReattackConfig = DEFAULT_REATTACK_CONFIG,
): number[] {
  const splits: number[] = [];
  let ambient  = 0;
  let peak     = 0;
  let dipping  = false;
  let dipStart = 0;

  for (let i = 0; i < rms.length; i++) {
    const level = rms[i];

    // The ambient floor is learned from frames the gate rejected — the only frames where
    // "this is the room, not the player" is known rather than assumed.
    if (!voiced[i]) {
      ambient = ambient > 0 ? ambient + config.noiseFloorAlpha * (level - ambient) : level;
    }

    if (level > peak) peak = level;
    if (peak < Math.max(config.minPeakRmsFloor, ambient * config.noiseFloorMult)) continue;

    if (!dipping) {
      if (level <= peak * config.dipRatio) {
        dipping  = true;
        dipStart = i;
      }
      continue;
    }

    if (level >= peak * config.riseRatio) {
      dipping = false;
      if ((i - dipStart) * hopMs >= config.minDipMs) {
        // Peak resets to the new attack, so a decaying take doesn't leave every later dip
        // measured against a peak set at the very start of the recording.
        peak = level;
        splits.push(i);
      }
    }
  }

  return splits;
}
