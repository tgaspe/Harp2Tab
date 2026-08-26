/**
 * A General MIDI synthesizer, as one AudioWorklet node.
 *
 * This replaces an earlier design that built `AudioBufferSourceNode`s per note from
 * offline-converted sample packages. That approach hit three walls at once, and all three
 * are properties of hand-rolling a synth rather than bugs that could be fixed:
 *
 *  - **Node count.** One dense track cost 19,200 audio nodes, committed to the graph in a
 *    single pass, and the audio thread gave up partway through. Here the graph is one node
 *    no matter how long the song is.
 *  - **Fidelity.** SF2 voices are shaped by filter *envelopes*, LFOs, velocity layers and
 *    modulators. Reproducing a static slice of that meant guessing which filters to keep and
 *    dropping every velocity layer but one. A real synth just plays them.
 *  - **Loop seams.** Loop points had to be reconstructed from `shdr` by hand, against a
 *    Vorbis-compressed sample body. spessasynth reads the file the way the format intends.
 *
 * The soundfont is the original `MuseScore_General.sf3` — provenance, licence and checksum
 * in `docs/plan/soundfont-source.md`.
 */

import { WorkletSynthesizer } from 'spessasynth_lib';
import type { Synth } from './types';

/** Served from `public/`, copied out of `spessasynth_lib/dist` — see the note in
 *  `docs/plan/soundfont-source.md` on refreshing it. Loaded by URL rather than by
 *  `new URL(..., import.meta.url)` the way spessasynth's own docs show, because Metro does
 *  not implement `import.meta.url` and silently produces a path the browser can't fetch. */
const PROCESSOR_URL = '/spessasynth_processor.min.js';
const SOUNDFONT_URL = '/soundfonts/MuseScore_General-0.2.0.sf3';

/** GM percussion lives on channel 9 and is keyed by note rather than transposed by it —
 *  the synth applies that itself, given the channel. */
export const PERCUSSION_CHANNEL = 9;

let synth: WorkletSynthesizer | null = null;
let loading: Promise<Synth | null> | null = null;

/**
 * The synth, once its worklet and soundfont are up. Null means it could not be loaded and
 * the caller should fall back — see `Playback.web.ts`, which keeps the oscillator path for
 * exactly this. Never rejects, and never loads twice.
 */
export function loadSynth(ctx: AudioContext): Promise<Synth | null> {
  if (synth) return Promise.resolve(synth);
  if (loading) return loading;

  loading = (async (): Promise<Synth | null> => {
    try {
      await ctx.audioWorklet.addModule(PROCESSOR_URL);
      const created = new WorkletSynthesizer(ctx);
      created.connect(ctx.destination);

      const response = await fetch(SOUNDFONT_URL);
      if (!response.ok) return null;
      await created.soundBankManager.addSoundBank(await response.arrayBuffer(), 'main');
      await created.isReady;

      synth = created;
      return created;
    } catch {
      return null;
    }
  })();

  return loading;
}

/** Whatever is loaded right now, without starting a load. The scheduler runs synchronously
 *  and cannot await per note. */
export function currentSynth(): Synth | null {
  return synth;
}

/** True once a load has been attempted and finished, successfully or not. */
export function synthAttempted(): boolean {
  return loading !== null;
}
