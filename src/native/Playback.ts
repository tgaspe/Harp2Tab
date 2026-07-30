import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { synthesizeWav } from '@/audio/synthesizeWav';
import { bytesToBase64 } from '@/audio/base64';
import type { PlaybackOptions } from '@/audio/tempo';
import type { TabNote } from '@/types';

// Native has no OscillatorNode equivalent, so unlike the web path (which schedules tones
// live), this pre-renders the whole sequence (notes + metronome clicks, if enabled) to a
// WAV file once and plays that file.
let player: AudioPlayer | null = null;

export async function playNotes(notes: TabNote[], options?: PlaybackOptions): Promise<void> {
  stopPlayback();
  const wavBytes = synthesizeWav(notes, undefined, options?.metronomeEnabled ? {
    bpm: options.bpm, enabled: true,
  } : undefined);
  const base64   = bytesToBase64(wavBytes);
  const uri      = FileSystem.cacheDirectory + 'harp2tab_playback.wav';
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
  player = createAudioPlayer(uri);
  player.play();
}

export function pausePlayback(): void {
  player?.pause();
}

export function resumePlayback(): void {
  player?.play();
}

export function stopPlayback(): void {
  player?.remove();
  player = null;
}
