import { DeviceEventEmitter, NativeModules } from 'react-native';

const { AudioCapture } = NativeModules;

export const startCapture = () => AudioCapture.startCapture();
export const stopCapture  = () => AudioCapture.stopCapture();
export const setThreshold = (v: number) => AudioCapture.setThreshold(v);

export interface AudioFrame {
  frequency: number;
  rms: number;
  nsdf: number;
}

export function addAudioFrameListener(cb: (frame: AudioFrame) => void) {
  return DeviceEventEmitter.addListener('onAudioFrame', cb);
}
