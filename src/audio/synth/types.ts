/**
 * The slice of a General MIDI synthesizer the scheduler uses.
 *
 * Declared here rather than taken from `spessasynth_lib` so the native stub can satisfy the
 * same shape: TypeScript resolves `SoundFontSynth` to the native `.ts` file, while Metro
 * gives web the `.web.ts` one, and the two must agree or the code type-checks against a
 * synth that is always null.
 */
export interface Synth {
  noteOn(channel: number, key: number, velocity: number, options?: { time: number }): void;
  noteOff(channel: number, key: number, options?: { time: number }): void;
  programChange(channel: number, program: number, options?: { time: number }): void;
  stopAll(force?: boolean): void;
}
