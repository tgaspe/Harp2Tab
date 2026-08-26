import { noteNameToMidi } from '@/audio/HarmonicaMapper';
import {
  cachedBuffer, cachedDrumBuffer, cachedDrumKit, cachedManifest,
  drumZoneForKey, DRUM_PROGRAM, loopSecondsFor, playbackRateFor, sampleOffsetSecFor, zoneForKey,
} from '@/audio/soundfont';
import { noteNameToFrequency } from '@/audio/synthesizeWav';
import { constantTempoMap, gridLines, type PlaybackOptions } from '@/audio/tempo';
import { velocityGain, voiceForProgram } from '@/audio/timbre';
import { noteVelocity } from '@/audio/velocity';
import type { TabNote } from '@/types';

// Web gets real-time OscillatorNode scheduling — no pre-render/file-write round-trip
// needed like the native path, since Web Audio can schedule tones directly.
const AMPLITUDE = 0.3;
/** Samples are recorded well below full scale, where the oscillators were trimmed to 0.3
 *  against a bare destination. Set by ear against the fallback (Task 4 Step 8) so that a
 *  sampled track and an oscillator track in the same project sit level with each other. */
const AMPLITUDE_SAMPLED = 0.5;

let audioContext: AudioContext | null = null;
/** Oscillators and buffer sources both, under their common supertype — `stopPlayback` only
 *  needs `stop()`, and keeping one list means a sampled voice can never be left running by a
 *  code path that forgot about it. */
let activeVoices: AudioScheduledSourceNode[] = [];

function scheduleMetronome(
  ctx: AudioContext,
  now: number,
  totalMs: number,
  options: PlaybackOptions,
  rate: number,
  startAtMs: number,
): void {
  // Beats come from the tempo map rather than a fixed step, so a click still lands on the
  // beat after a tempo change and the accent still lands on beat 1 of the bar — including
  // when the bar length itself changes. `options.tempoMap` is absent for a tab session,
  // which has one tempo by construction.
  const map = options.tempoMap ?? constantTempoMap(options.bpm);
  const beats = gridLines(map, 0, totalMs, 4).filter((l) => l.isBeat);

  // Positions stay in nominal (unscaled) units — only the actual schedule time is
  // compressed/stretched by rate, otherwise the loop would run ~rate× too many iterations
  // past the (now shorter/longer) note audio itself.
  const startAtSec = startAtMs / 1000;
  for (const beat of beats) {
    const t = beat.ms / 1000;
    if (t < startAtSec) continue;
    const accented = beat.isBar;
    const startSec = now + (t - startAtSec) / rate;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = accented ? 1800 : 1200;
    // Short percussive decay — a click, not a tone. exponentialRamp can't target
    // exactly 0, hence the tiny epsilon floor.
    gain.gain.setValueAtTime(accented ? 0.5 : 0.35, startSec);
    gain.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startSec);
    osc.stop(startSec + 0.04);
    activeVoices.push(osc);
  }
}

/**
 * One buffer source, or two panned hard apart when the zone came from an SF2 stereo pair.
 *
 * A pair is two mono samples, so playing only the left — which is what happens if you treat
 * `fileRight` as optional decoration — gives a thin, slightly-off instrument rather than an
 * obvious defect. If the right channel isn't in the cache the left plays alone, which is
 * still better than silence.
 */
function buildSources(
  ctx: AudioContext,
  left: AudioBuffer,
  right: AudioBuffer | null,
  destination: AudioNode,
  playbackRate: number,
): AudioBufferSourceNode[] {
  const make = (buffer: AudioBuffer, pan: number | null): AudioBufferSourceNode => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    if (pan === null) {
      source.connect(destination);
    } else {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      source.connect(panner);
      panner.connect(destination);
    }
    return source;
  };
  return right ? [make(left, -1), make(right, 1)] : [make(left, null)];
}

/** Gain → optional low-pass → optional pan → output.
 *
 *  The filter is SF2's `initialFilterFc`, and it is not optional polish: for a lot of
 *  MuseScore General that filter is most of the timbre, and omitting it is what makes a
 *  sampled GM set sound bright and synthetic in a way that is hard to diagnose later. */
function connectVoiceTail(
  ctx: AudioContext,
  gain: GainNode,
  pan: number,
  filterHz: number | undefined,
  filterQ: number | undefined,
  output: AudioNode,
): void {
  let tail: AudioNode = gain;
  if (filterHz !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterHz;
    filter.Q.value = filterQ ?? 1;
    tail.connect(filter);
    tail = filter;
  }
  if (pan !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    tail.connect(panner);
    tail = panner;
  }
  tail.connect(output);
}

export async function playNotes(notes: TabNote[], options?: PlaybackOptions, startAtMs = 0): Promise<void> {
  stopPlayback();
  if (notes.length === 0) return;

  const ctx = new AudioContext();
  audioContext = ctx;
  const now = ctx.currentTime;
  const rate = options?.rate ?? 1;

  // One output stage for both paths. A dozen sampled tracks clip where a dozen sine waves
  // did not, and compressing only the sampled path would make the *fallback* audibly louder
  // than the real thing, which is precisely backwards. The metronome deliberately bypasses
  // it (see `scheduleMetronome`): a reference click should not duck under a loud bar.
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.ratio.value = 4;
  compressor.connect(ctx.destination);

  for (const n of notes) {
    const noteEnd = n.start_time + n.duration;
    if (noteEnd <= startAtMs) continue; // fully before the seek point

    const freq = noteNameToFrequency(n.note);
    if (freq <= 0) continue;

    // Notes straddling the seek point start partway through rather than jumping to
    // wherever they'd naturally begin, so playback picks up exactly at the seek point.
    const effectiveStart = Math.max(n.start_time, startAtMs);
    const startSec = now + (effectiveStart - startAtMs) / 1000 / rate;
    const durSec    = (noteEnd - effectiveStart) / 1000 / rate;
    const fadeSec   = Math.min(0.01, durSec / 4);

    const midiKey = noteNameToMidi(n.note);

    // ── Percussion ────────────────────────────────────────────────────────────
    // Ahead of the melodic branch because a drum note's `program` is meaningless: channel 9
    // names a drum by pitch, so resolving it as an instrument would play a room full of
    // pianos for a drum part.
    if (n.percussion) {
      const kit = cachedDrumKit();
      const drum = kit && midiKey !== null ? drumZoneForKey(kit, midiKey) : null;
      const drumBuffer = drum ? cachedDrumBuffer(drum) : null;

      if (drum && drumBuffer) {
        const gain = ctx.createGain();
        const peak = AMPLITUDE_SAMPLED * drum.gain * velocityGain(noteVelocity(n));
        gain.gain.setValueAtTime(0, startSec);
        gain.gain.linearRampToValueAtTime(peak, startSec + 0.002);
        connectVoiceTail(ctx, gain, drum.pan, undefined, undefined, compressor);

        // Selected, never transposed, and never stopped at `startSec + durSec`: a drum
        // sample is a one-shot whose length is a property of the sound, so cutting a crash
        // off at its notated duration is the most obvious way to make a kit sound wrong.
        // `stopPlayback` still kills it, because it goes into `activeVoices`.
        for (const source of buildSources(ctx, drumBuffer, drum.fileRight ? cachedBuffer(DRUM_PROGRAM, drum.fileRight) : null, gain, 1)) {
          source.start(startSec);
          activeVoices.push(source);
        }
        continue;
      }
      // No kit loaded — fall through to the oscillator, which is what a drum note does today.
    }

    // ── Sampled melodic voice ─────────────────────────────────────────────────
    const manifest = n.program === undefined ? null : cachedManifest(n.program);
    const zone = manifest && midiKey !== null ? zoneForKey(manifest, midiKey) : null;
    const buffer = zone && n.program !== undefined ? cachedBuffer(n.program, zone.file) : null;

    if (zone && buffer && midiKey !== null && n.program !== undefined) {
      // Pitch and tuning ONLY. `rate` divides the scheduled times above exactly as it does
      // for the oscillator path; folding it in here would transpose the project up an
      // octave at 2x speed, which the oscillator path has never done.
      const pitchRate = playbackRateFor(zone, midiKey);

      const gain = ctx.createGain();
      const peak = AMPLITUDE_SAMPLED * zone.gain * velocityGain(noteVelocity(n));
      // No ADSR here: the attack and decay are already in the recording, and re-applying the
      // oscillator envelope on top of them would blunt exactly what makes a sample sound
      // real. Only a 2 ms declick in and the zone's own release out.
      const attack  = Math.min(0.002, durSec / 4);
      const release = Math.min(zone.releaseSec, Math.max(0.002, durSec - attack));
      gain.gain.setValueAtTime(0, startSec);
      gain.gain.linearRampToValueAtTime(peak, startSec + attack);
      gain.gain.setValueAtTime(peak, startSec + Math.max(attack, durSec - release));
      gain.gain.linearRampToValueAtTime(0, startSec + durSec);

      connectVoiceTail(ctx, gain, zone.pan, zone.filterHz, zone.filterQ, compressor);

      const right = zone.fileRight ? cachedBuffer(n.program, zone.fileRight) : null;
      const loop = loopSecondsFor(zone);
      // A sample seeked into mid-note starts partway through itself, matching what the
      // oscillator path already does with `effectiveStart`.
      const offsetSec = sampleOffsetSecFor(effectiveStart - n.start_time, rate, pitchRate);
      for (const source of buildSources(ctx, buffer, right, gain, pitchRate)) {
        if (loop) {
          source.loop = true;
          source.loopStart = loop.start;
          source.loopEnd = loop.end;
        }
        source.start(startSec, offsetSec);
        source.stop(startSec + durSec + 0.02);
        activeVoices.push(source);
      }
      continue;
    }

    const voice = voiceForProgram(n.program);
    // Velocity is the note's dynamics — a tab session leaves it unset and every note plays
    // at full level, exactly as before.
    const peak  = AMPLITUDE * voice.gain * velocityGain(noteVelocity(n));

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = voice.type;
    osc.frequency.value = freq;

    // ADSR, clamped so a short note still gets a complete envelope rather than an attack
    // that outlasts it. The trailing ramp to zero doubles as the click-free fade the plain
    // sine used to do by hand.
    const attack  = Math.min(voice.attackSec, durSec * 0.4);
    const decay   = Math.min(voice.decaySec, Math.max(0, durSec - attack) * 0.6);
    const release = Math.min(voice.releaseSec, Math.max(fadeSec, durSec - attack - decay));
    const sustainPeak = peak * voice.sustainLevel;

    gain.gain.setValueAtTime(0, startSec);
    gain.gain.linearRampToValueAtTime(peak, startSec + attack);
    if (decay > 0) gain.gain.linearRampToValueAtTime(sustainPeak, startSec + attack + decay);
    gain.gain.setValueAtTime(sustainPeak, startSec + Math.max(attack + decay, durSec - release));
    gain.gain.linearRampToValueAtTime(0, startSec + durSec);

    osc.connect(gain);
    gain.connect(compressor);
    osc.start(startSec);
    osc.stop(startSec + durSec + 0.02);
    activeVoices.push(osc);
  }

  if (options?.metronomeEnabled) {
    const totalMs = notes.reduce((max, n) => Math.max(max, n.start_time + n.duration), 0);
    scheduleMetronome(ctx, now, totalMs, options, rate, startAtMs);
  }
}

// Single-tone preview (e.g. clicking a note in the piano-roll editor to hear it) — its
// own one-shot AudioContext, entirely independent from the transport's `audioContext`
// above, so it can't be paused/stopped by playback controls and doesn't touch
// isPlaying/isPaused state. Closed once the tone finishes so repeated clicks don't leak
// contexts.
export function previewNote(noteName: string, durationMs = 180): void {
  const freq = noteNameToFrequency(noteName);
  if (freq <= 0) return;

  const ctx = new AudioContext();
  const now = ctx.currentTime;
  const durSec  = durationMs / 1000;
  const fadeSec = Math.min(0.01, durSec / 4);

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(AMPLITUDE, now + fadeSec);
  gain.gain.setValueAtTime(AMPLITUDE, now + durSec - fadeSec);
  gain.gain.linearRampToValueAtTime(0, now + durSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durSec + 0.02);
  osc.onended = () => { ctx.close(); };
}

export function pausePlayback(): void {
  audioContext?.suspend();
}

export function resumePlayback(): void {
  audioContext?.resume();
}

export function stopPlayback(): void {
  activeVoices.forEach((voice) => {
    try { voice.stop(); } catch { /* already stopped */ }
  });
  activeVoices = [];
  audioContext?.close();
  audioContext = null;
}
