import { DeviceEventEmitter, NativeModules } from 'react-native';
import { MAX_DURATION_MS, type DecodedAudio } from '@/audio/audioImport';

const { AudioCapture } = NativeModules;

export const startCapture = () => AudioCapture.startCapture();
export const stopCapture  = () => AudioCapture.stopCapture();
export const setThreshold = (v: number) => AudioCapture.setThreshold(v);

/**
 * Take retention is web-only, and these are the no-ops that let the shared hook and the
 * recording screen call it unconditionally.
 *
 * Nothing is lost by it: the native Kotlin module emits frames, not PCM, and the only thing
 * that would consume a retained take there is the neural engine, which already reports
 * `available: false` on native (`algorithms/basicPitch.ts`). `getAlgorithm` falls back to
 * pMPM, `takeRetainedPcm()` returns null, and the recording screen keeps today's behaviour
 * of routing straight to the editor.
 */
export type RetentionFormat = 'float32' | 'int16';

export function setRetaining(_on: boolean): void {}
export function setRetentionFormat(_format: RetentionFormat): void {}
export function setMaxTakeMs(_ms: number): void {}
export function getMaxTakeMs(): number { return MAX_DURATION_MS; }
export function isRetentionTruncated(): boolean { return false; }
export function retainedDurationMs(): number { return 0; }
export function clearRetainedPcm(): void {}

export function takeRetainedPcm(): (DecodedAudio & { truncated: boolean }) | null {
  return null;
}

export interface AudioFrame {
  frequency: number;
  rms: number;
  nsdf: number;
}

export function addAudioFrameListener(cb: (frame: AudioFrame) => void) {
  return DeviceEventEmitter.addListener('onAudioFrame', cb);
}
