import { DeviceEventEmitter } from 'react-native';
import { computeRms, detectPitch, PITCH_WINDOW_SIZE } from '@/audio/pitchDetector';
import { MAX_DURATION_MS, type DecodedAudio } from '@/audio/audioImport';

export interface AudioFrame {
  frequency: number;
  rms: number;
  nsdf: number; // unused everywhere downstream — always 0 on web
}

let audioContext: AudioContext | null = null;
let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let processor: ScriptProcessorNode | null = null;
let sink: GainNode | null = null;

let threshold = 0;
let starting = false;
let generation = 0;

// ── Take retention ──────────────────────────────────────────────────────────────
//
// The live HUD only ever needed one block at a time, so `onaudioprocess` computed rms and
// pitch and let the samples go. A neural pass needs the whole take, which means keeping
// every block — and keeping them at the *device* rate, deliberately. Resampling here would
// retune every NoteDetector threshold in one step (all of them are calibrated against
// 2048-sample frames at the device rate); Basic Pitch converts to its own 22050 later, in
// `resampleToModelRate`, where it can use a proper windowed-sinc resampler.

/**
 * The retained take is capped at the same ceiling an uploaded file is by default, because
 * the ceiling exists for the same reason in both cases: what the analysis pass can chew
 * through, and what the model's three output matrices cost in memory afterwards.
 *
 * Settable, because this is the one honest user-facing storage knob. Capture *rate* is not:
 * halving it would halve the live frame rate and push `confirmMs` (40) and `minDipMs` (50)
 * below a single frame, silently degrading onset timing with nothing on screen connecting
 * the two. Take length is linear in both the PCM and the matrices and changes no timing.
 */
let maxRetainedMs = MAX_DURATION_MS;

export function setMaxTakeMs(ms: number): void {
  maxRetainedMs = Math.max(1000, ms);
}

export function getMaxTakeMs(): number {
  return maxRetainedMs;
}

/**
 * Int16 halves the memory a long take costs and is the honest trade to offer — a 16-bit
 * quantization floor sits ~96dB down, far below anything a pitch detector or a CNN reads.
 * Off by default all the same: Float32 is what the pipeline speaks natively, so the
 * default path has no conversion in it at all.
 */
export type RetentionFormat = 'float32' | 'int16';

let retaining = false;
/** What the next take will use. */
let requestedFormat: RetentionFormat = 'float32';
/** Latched at `startCapture()` — the format cannot change mid-take without leaving two
 *  incompatible block types in the same buffer, so flipping the setting during a take
 *  applies to the next one. */
let retentionFormat: RetentionFormat = 'float32';
let retainedBlocks: (Float32Array | Int16Array)[] = [];
let retainedSampleCount = 0;
let retainedSampleRate = 0;
let retainedTruncated = false;
/** Samples the retention cap allows, computed once per take from the real device rate. */
let retainedLimit = 0;

function retainBlock(samples: Float32Array): void {
  if (!retaining || retainedSampleCount >= retainedLimit) return;

  // `getChannelData(0)` hands back a view onto a buffer the graph reuses for the next
  // block, so a copy was always mandatory here — the only question was whether we narrow
  // to Int16 on the way.
  const room = retainedLimit - retainedSampleCount;
  const take = Math.min(samples.length, room);

  if (retentionFormat === 'int16') {
    const block = new Int16Array(take);
    for (let i = 0; i < take; i++) {
      // Clamp before scaling: the mic path has no limiter, and a sample just past ±1.0
      // would otherwise wrap to the opposite polarity and read as a click.
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      block[i] = Math.round(clamped * 32767);
    }
    retainedBlocks.push(block);
  } else {
    retainedBlocks.push(samples.slice(0, take));
  }

  retainedSampleCount += take;
  // Set when the cap actually bit, so the UI can say "retention stopped" rather than
  // silently handing over a take that ends early for no stated reason.
  if (take < samples.length || retainedSampleCount >= retainedLimit) retainedTruncated = true;
}

/**
 * Start or stop keeping audio. Called on every pause transition, so a paused gap never
 * reaches the buffer — which is what keeps the retained timeline aligned with the live one,
 * since the live elapsed clock already discounts pauses.
 */
export function setRetaining(on: boolean): void {
  retaining = on;
}

export function setRetentionFormat(format: RetentionFormat): void {
  requestedFormat = format;
}

/** Whether the cap has been reached and retention has stopped. Recording itself continues. */
export function isRetentionTruncated(): boolean {
  return retainedTruncated;
}

export function retainedDurationMs(): number {
  return retainedSampleRate > 0 ? (retainedSampleCount / retainedSampleRate) * 1000 : 0;
}

/**
 * Hand over the take as one contiguous buffer, and drop the blocks.
 *
 * Deliberately readable *after* `stopCapture()` — Finish tears the graph down first, then
 * comes here, and a buffer cleared on teardown would mean the take never survived the one
 * moment it exists to survive.
 */
export function takeRetainedPcm(): (DecodedAudio & { truncated: boolean }) | null {
  if (retainedSampleCount === 0 || retainedSampleRate === 0) return null;

  const samples = new Float32Array(retainedSampleCount);
  let offset = 0;
  for (const block of retainedBlocks) {
    if (block instanceof Int16Array) {
      // Widen back on the way out, so nothing downstream has to know which format was used.
      // /32767 rather than /32768 mirrors the scale factor above, so a full-scale sample
      // round-trips to exactly ±1.0 instead of landing a fraction short.
      for (let i = 0; i < block.length; i++) samples[offset + i] = block[i] / 32767;
    } else {
      samples.set(block, offset);
    }
    offset += block.length;
  }

  const result = {
    samples,
    sampleRate: retainedSampleRate,
    durationMs: (retainedSampleCount / retainedSampleRate) * 1000,
    truncated:  retainedTruncated,
  };
  clearRetainedPcm();
  return result;
}

export function clearRetainedPcm(): void {
  retainedBlocks       = [];
  retainedSampleCount  = 0;
  retainedTruncated    = false;
}

export async function startCapture(): Promise<void> {
  if (audioContext || starting) return; // idempotent — mirrors native's start guard
  starting = true;
  const myGeneration = ++generation;

  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    if (myGeneration !== generation) {
      // stopCapture() ran while getUserMedia was in flight — discard.
      mediaStream.getTracks().forEach((t) => t.stop());
      return;
    }

    const ctx = new AudioContext();
    await ctx.resume(); // defensive — startCapture() is always called from a tap handler

    const src = ctx.createMediaStreamSource(mediaStream);
    const proc = ctx.createScriptProcessor(PITCH_WINDOW_SIZE, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0; // never feed the mic back to the speakers

    // A fresh take: latch the retention format, size the cap against the real device rate,
    // and start keeping audio. Retention defaults to on rather than waiting for the pause
    // effect to enable it, so a take is never half-kept because of effect ordering.
    retentionFormat     = requestedFormat;
    retainedSampleRate  = ctx.sampleRate;
    retainedLimit       = Math.floor((maxRetainedMs / 1000) * ctx.sampleRate);
    retaining           = true;
    clearRetainedPcm();

    proc.onaudioprocess = (e: AudioProcessingEvent) => {
      const samples = e.inputBuffer.getChannelData(0);
      const rms = computeRms(samples);
      const frequency = rms >= threshold ? detectPitch(samples, ctx.sampleRate) : NaN;
      retainBlock(samples);
      DeviceEventEmitter.emit('onAudioFrame', { frequency, rms, nsdf: 0 } as AudioFrame);
    };

    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);

    stream = mediaStream;
    audioContext = ctx;
    source = src;
    processor = proc;
    sink = mute;
  } finally {
    starting = false;
  }
}

export function stopCapture(): void {
  generation++; // invalidate any in-flight startCapture()
  starting = false;
  // Stop keeping audio, but deliberately do **not** drop what was kept: Finish tears the
  // graph down and only then reads `takeRetainedPcm()`, so clearing here would throw the
  // take away microseconds before the one call that wants it.
  retaining = false;

  processor?.disconnect();
  source?.disconnect();
  sink?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  audioContext?.close();

  processor = null;
  source = null;
  sink = null;
  stream = null;
  audioContext = null;
}

export function setThreshold(v: number): void {
  threshold = v;
}

export function addAudioFrameListener(cb: (frame: AudioFrame) => void) {
  return DeviceEventEmitter.addListener('onAudioFrame', cb);
}
