/**
 * Round-trip harness for the audio-import pipeline.
 *
 * synthesizeWav.ts already renders `TabNote[]` → WAV for native playback, so a known note
 * sequence can be rendered to audio and pushed back through the exact import path
 * (parseWav → analyzeSamples → framesToNotes) to check what comes out the other end. That
 * makes the pipeline verifiable without recording anything by hand, and gives automatic
 * key detection a ground truth to be tuned against later.
 *
 * Run: npx tsx scripts/verify-audio-import.ts
 */

import { analyzeSamples } from '../src/audio/analyzeSamples';
import { framesToNotes } from '../src/audio/framesToNotes';
import { tabToNote } from '../src/audio/HarmonicaMapper';
import { detectHarmonicaKey, positionOf } from '../src/audio/keyDetection';
import { synthesizeWav } from '../src/audio/synthesizeWav';
import { parseWav } from '../src/audio/wav';
import type { HarmonicaKey, TabNote } from '../src/types';

const SAMPLE_RATE = 44100; // match the live web capture path, which sets the detector's tuning

/** Builds a playable note sequence from tabs, resolving each tab's real pitch through the
 *  same mapper the app uses, so the synthesized audio is what that tab actually sounds like. */
function sequence(tabs: string[], key: HarmonicaKey, durationMs: number, gapMs: number): TabNote[] {
  return tabs.map((tab, i) => ({
    id:         `n${i}`,
    tab,
    note:       tabToNote(tab, key, 'diatonic') ?? '',
    duration:   durationMs,
    start_time: i * (durationMs + gapMs),
    confidence: 100,
  }));
}

interface CaseResult {
  name:     string;
  passed:   boolean;
  detail:   string;
}

async function runCase(
  name: string,
  key: HarmonicaKey,
  expectedTabs: string[],
  notes: TabNote[],
  timingToleranceMs: number,
): Promise<CaseResult> {
  const wav     = synthesizeWav(notes, SAMPLE_RATE);
  const decoded = parseWav(wav, `${name}.wav`);
  const frames  = await analyzeSamples(decoded);
  const found   = framesToNotes(frames, key, 'diatonic');

  const foundTabs = found.map((n) => n.tab);
  const tabsMatch = foundTabs.length === expectedTabs.length
    && foundTabs.every((tab, i) => tab === expectedTabs[i]);

  if (!tabsMatch) {
    return {
      name,
      passed: false,
      detail: `expected [${expectedTabs.join(', ')}], got [${foundTabs.join(', ')}]`,
    };
  }

  // Timings only get checked once the tabs line up, otherwise the pairing is meaningless.
  const drifts = found.map((n, i) => ({
    start:    Math.abs(n.start_time - notes[i].start_time),
    duration: Math.abs(n.duration - notes[i].duration),
  }));
  const worstStart    = Math.max(...drifts.map((d) => d.start));
  const worstDuration = Math.max(...drifts.map((d) => d.duration));
  const timingOk      = worstStart <= timingToleranceMs && worstDuration <= timingToleranceMs;

  return {
    name,
    passed: timingOk,
    detail: `${found.length} notes, worst start drift ${worstStart}ms, worst duration drift ${worstDuration}ms`
      + (timingOk ? '' : ` (tolerance ${timingToleranceMs}ms)`),
  };
}

/**
 * Writes a WAV in a format synthesizeWav never produces (it only emits mono 16-bit), so
 * the parser's other depth/channel branches get exercised against a known signal instead
 * of only against our own writer's output.
 */
function buildWav(
  channels: Float32Array[],
  sampleRate: number,
  bitsPerSample: number,
  float: boolean,
): Uint8Array {
  const channelCount  = channels.length;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount     = channels[0].length;
  const dataSize       = frameCount * channelCount * bytesPerSample;
  const buffer         = new ArrayBuffer(44 + dataSize);
  const view           = new DataView(buffer);
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  let at = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const v = Math.max(-1, Math.min(1, channels[ch][frame]));
      if (float && bitsPerSample === 32)       view.setFloat32(at, v, true);
      else if (float && bitsPerSample === 64)  view.setFloat64(at, v, true);
      else if (bitsPerSample === 8)            view.setUint8(at, Math.round(v * 127) + 128);
      else if (bitsPerSample === 16)           view.setInt16(at, Math.round(v * 0x7fff), true);
      else if (bitsPerSample === 24) {
        const n = Math.round(v * 0x7fffff) & 0xffffff;
        view.setUint8(at, n & 0xff);
        view.setUint8(at + 1, (n >> 8) & 0xff);
        view.setUint8(at + 2, (n >> 16) & 0xff);
      }
      else if (bitsPerSample === 32)           view.setInt32(at, Math.round(v * 0x7fffffff), true);
      at += bytesPerSample;
    }
  }
  return new Uint8Array(buffer);
}

/** A 440Hz sine, the reference signal every format case is checked against. */
function sine(sampleRate: number, seconds: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return samples;
}

function wavFormatCases(): CaseResult[] {
  const sampleRate = 44100;
  const reference  = sine(sampleRate, 0.2);
  const formats: { name: string; bits: number; float: boolean; tolerance: number }[] = [
    { name: '8-bit',        bits: 8,  float: false, tolerance: 0.02  },
    { name: '16-bit',       bits: 16, float: false, tolerance: 1e-4  },
    { name: '24-bit',       bits: 24, float: false, tolerance: 1e-6  },
    { name: '32-bit int',   bits: 32, float: false, tolerance: 1e-8  },
    { name: '32-bit float', bits: 32, float: true,  tolerance: 1e-7  },
    { name: '64-bit float', bits: 64, float: true,  tolerance: 1e-12 },
  ];

  const results = formats.map(({ name, bits, float, tolerance }) => {
    const decoded = parseWav(buildWav([reference], sampleRate, bits, float), `${name}.wav`);
    let worst = 0;
    for (let i = 0; i < reference.length; i++) {
      worst = Math.max(worst, Math.abs(decoded.samples[i] - reference[i]));
    }
    return {
      name:   `WAV ${name} mono`,
      passed: decoded.sampleRate === sampleRate && worst <= tolerance,
      detail: `worst sample error ${worst.toExponential(1)} (tolerance ${tolerance.toExponential(1)})`,
    };
  });

  // Stereo downmix: a hard-panned take must survive, which taking channel 0 alone wouldn't
  // guarantee — the average of [signal, silence] is half the signal, not nothing.
  const silence = new Float32Array(reference.length);
  const stereo  = parseWav(buildWav([reference, silence], sampleRate, 16, false), 'stereo.wav');
  let worstStereo = 0;
  for (let i = 0; i < reference.length; i++) {
    worstStereo = Math.max(worstStereo, Math.abs(stereo.samples[i] - reference[i] / 2));
  }
  results.push({
    name:   'WAV 16-bit stereo (hard-panned) downmix',
    passed: worstStereo <= 1e-4,
    detail: `worst downmix error ${worstStereo.toExponential(1)}`,
  });

  return results;
}

/**
 * Key detection has a ground truth here that it can never have in the wild: the audio was
 * rendered from tabs on a known harp, so the detector is simply asked to name it back.
 */
async function keyDetectionCases(): Promise<CaseResult[]> {
  const results: CaseResult[] = [];

  // Plain blow/draw melodies on three different harps — a correctly-fitting key should win
  // outright, since every note lands on an unbent hole.
  for (const key of ['C', 'G', 'A'] as HarmonicaKey[]) {
    const tabs    = ['4', '-4', '5', '-5', '6', '-6', '5', '4'];
    const notes   = sequence(tabs, key, 420, 180);
    const decoded = parseWav(synthesizeWav(notes, SAMPLE_RATE), 'key.wav');
    const frames  = await analyzeSamples(decoded);
    const result  = detectHarmonicaKey(frames, 'diatonic');

    const runnerUp = result.ranked[1];
    results.push({
      name:   `key detection — ${key} diatonic melody`,
      passed: result.best.key === key,
      detail: `picked ${result.best.key} (score ${result.best.score.toFixed(2)}, margin ${result.margin.toFixed(2)}) `
        + `over ${runnerUp.key} (${runnerUp.score.toFixed(2)})`,
    });
  }

  // Same melody rendered two octaves below the harmonica's range: without the octave-fold
  // pre-pass nothing maps for any key, so this is what that step exists for.
  {
    const tabs  = ['4', '-4', '5', '-5', '6'];
    const notes = sequence(tabs, 'C', 420, 180).map((n) => ({
      ...n,
      note: n.note.replace(/(\d+)$/, (m) => String(Number(m) - 2)),
    }));
    const decoded = parseWav(synthesizeWav(notes, SAMPLE_RATE), 'lowoctave.wav');
    const frames  = await analyzeSamples(decoded);
    const result  = detectHarmonicaKey(frames, 'diatonic');

    results.push({
      name:   'key detection — melody two octaves below harp range',
      passed: result.best.key === 'C' && result.octaveShiftSemitones === 24,
      detail: `picked ${result.best.key} with a ${result.octaveShiftSemitones} semitone shift`,
    });
  }

  // Position labelling: on a C tune, the cross-harp (2nd position) harp is F.
  results.push({
    name:   'position labelling — cross harp',
    passed: positionOf('F', 'C') === 2 && positionOf('C', 'C') === 1 && positionOf('Bb', 'C') === 3,
    detail: `F on a C tune = position ${positionOf('F', 'C')}, Bb = position ${positionOf('Bb', 'C')}`,
  });

  return results;
}

async function main() {
  const results: CaseResult[] = [];

  // 1. Plain ascending run — the baseline every other case is measured against.
  {
    const tabs  = ['4', '-4', '5', '-5', '6'];
    const notes = sequence(tabs, 'C', 400, 200);
    results.push(await runCase('ascending run (C diatonic)', 'C', tabs, notes, 80));
  }

  // 2. Repeated identical notes — the case the RMS-envelope onset detector exists for
  //    (two 4s in a row never gate to silence between them via pitch alone).
  {
    const tabs  = ['4', '4', '-4', '-4'];
    const notes = sequence(tabs, 'C', 350, 150);
    results.push(await runCase('repeated identical notes', 'C', tabs, notes, 80));
  }

  // 3. Short notes near minDurationMs (110ms) — the segmentation floor.
  {
    const tabs  = ['4', '5', '6', '-6'];
    const notes = sequence(tabs, 'C', 200, 120);
    results.push(await runCase('short notes', 'C', tabs, notes, 80));
  }

  // 4. A non-C key, to confirm nothing in the pipeline is C-specific.
  {
    const tabs  = ['4', '-4', '5', '-5'];
    const notes = sequence(tabs, 'G', 400, 200);
    results.push(await runCase('ascending run (G diatonic)', 'G', tabs, notes, 80));
  }

  // 5. Bends and an overblow — the awkward positions key detection will later score against.
  {
    const tabs  = ["-2'", '-3', "-4'", '4o'];
    const notes = sequence(tabs, 'C', 400, 200);
    results.push(await runCase('bends and overblow', 'C', tabs, notes, 80));
  }

  results.push(...wavFormatCases());
  results.push(...(await keyDetectionCases()));

  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
  }

  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failed}/${results.length} cases passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
