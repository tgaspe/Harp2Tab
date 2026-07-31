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

export async function playNotes(notes: TabNote[], options?: PlaybackOptions, startAtMs = 0): Promise<void> {
  stopPlayback();
  const wavBytes = synthesizeWav(notes, undefined, options?.metronomeEnabled ? {
    bpm: options.bpm, enabled: true,
  } : undefined);
  const base64   = bytesToBase64(wavBytes);
  const uri      = FileSystem.cacheDirectory + 'harp2tab_playback.wav';
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
  player = createAudioPlayer(uri);
  // The WAV is always rendered in full — seek into it rather than re-rendering a trimmed
  // clip, since re-synthesizing per seek would be far more work for the same result.
  if (startAtMs > 0) await player.seekTo(startAtMs / 1000);
  player.play();
}

// Single-tone preview (e.g. clicking a note in the piano-roll editor to hear it) — its
// own AudioPlayer instance and cache file, entirely separate from the transport `player`
// above, so it can't be paused/stopped by playback controls and doesn't touch
// isPlaying/isPaused state. Reuses the same synthesizeWav pipeline as full playback for a
// single short note; the file-write + decode round trip means this has more latency than
// the web path's live oscillator, a known tradeoff of not adding a second native audio
// backend just for this.
let previewPlayer: AudioPlayer | null = null;

export async function previewNote(noteName: string, durationMs = 180): Promise<void> {
  const wavBytes = synthesizeWav([
    { id: 'preview', tab: '', note: noteName, start_time: 0, duration: durationMs, confidence: 100 },
  ]);
  const base64 = bytesToBase64(wavBytes);
  const uri    = FileSystem.cacheDirectory + 'harp2tab_preview.wav';
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
  previewPlayer?.remove();
  previewPlayer = createAudioPlayer(uri);
  previewPlayer.play();
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
