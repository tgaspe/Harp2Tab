import { DeviceEventEmitter } from 'react-native';
import { computeRms, detectPitch, PITCH_WINDOW_SIZE } from '@/audio/pitchDetector';

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

    proc.onaudioprocess = (e: AudioProcessingEvent) => {
      const samples = e.inputBuffer.getChannelData(0);
      const rms = computeRms(samples);
      const frequency = rms >= threshold ? detectPitch(samples, ctx.sampleRate) : NaN;
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
