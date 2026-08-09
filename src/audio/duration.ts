/**
 * The duration floor — the second of the roll's two note filters.
 *
 * What it's for: pitch trackers and neural transcription both emit short spurious notes —
 * a few frames of a neighbouring pitch at an attack, a blip where the player breathed.
 * They're indistinguishable from real notes by loudness (a ghost note at the start of a
 * loud phrase is loud), so the velocity floor can't reach them. Length can.
 *
 * Deliberately a mirror of `passesVelocityFloor` in shape, so the two compose without
 * anyone having to remember which way each one points: both are floors, both hide what
 * falls below, both treat 0 as off.
 *
 * The one asymmetry worth knowing about is the *absence* of velocity's `?? 127` clause.
 * That rule exists because velocity is optional — hand-drawn notes and pre-velocity
 * recordings have none, and treating those as silent would empty the editor. Duration has
 * no such hole: every note that exists has a length, so there is no missing-data case to
 * defend against and none should be invented.
 */

/**
 * Does a note clear a duration floor?
 *
 * Lives in `@/audio` rather than in the hook that consumes it for the same reason
 * `passesVelocityFloor` does: the Studio's playback merge, its MIDI export and track
 * conversion are all non-React callers that need exactly this rule, and a second inlined
 * copy of `>= floor` is how the roll and the exporter drift apart.
 */
export function passesDurationFloor(durationMs: number, floorMs: number): boolean {
  return durationMs >= floorMs;
}
