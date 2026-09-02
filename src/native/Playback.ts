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

/**
 * Where the transport is *before* the player exists, so the playhead cannot run ahead of a
 * WAV that is still being synthesized, base64'd and written to disk. Null once `play()` has
 * been reached and `player.currentTime` can answer for itself.
 *
 * The transport used to time its playhead with `Date.now()` from the moment play was
 * pressed, which on this backend meant the red line set off while the render had not
 * started — see `playbackClockMs` in `Playback.web.ts` for the same split on the web side.
 */
let pendingStartMs: number | null = null;

/** Where the sound actually is, in nominal note-timeline units (matching `note.start_time`),
 *  or null when nothing is loaded. The WAV is rendered at nominal tempo and `playbackRate`
 *  varies how fast it is traversed, so the file's own position *is* the score position. */
export function playbackClockMs(): number | null {
  if (pendingStartMs !== null) return pendingStartMs;
  return player ? player.currentTime * 1000 : null;
}

/** Web reports the gap between scheduling a sample and hearing it; a file player has no
 *  equivalent to expose, and `currentTime` already tracks what is being heard. */
export function playbackLatencyMs(): number { return 0; }

export async function playNotes(notes: TabNote[], options?: PlaybackOptions, startAtMs = 0): Promise<void> {
  stopPlayback();
  pendingStartMs = startAtMs;
  const wavBytes = synthesizeWav(notes, undefined, options?.metronomeEnabled ? {
    bpm: options.bpm, enabled: true,
  } : undefined);
  const base64   = bytesToBase64(wavBytes);
  const uri      = FileSystem.cacheDirectory + 'harp2tab_playback.wav';
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
  player = createAudioPlayer(uri);
  // Expo Audio v55 applies playbackRate to the active player. The native backend still
  // pre-renders one WAV, but changing transport speed can now rebuild at the current
  // position and play that WAV at the requested rate, just like the web schedule.
  player.playbackRate = options?.rate ?? 1;
  // The WAV is always rendered in full — seek into it rather than re-rendering a trimmed
  // clip, since re-synthesizing per seek would be far more work for the same result.
  if (startAtMs > 0) await player.seekTo(startAtMs / 1000);
  player.play();
  pendingStartMs = null;
}

// Single-tone preview (e.g. clicking a note in the piano-roll editor to hear it) — its
// own AudioPlayer instance and cache file, entirely separate from the transport `player`
// above, so it can't be paused/stopped by playback controls and doesn't touch
// isPlaying/isPaused state. Reuses the same synthesizeWav pipeline as full playback for a
// single short note; the file-write + decode round trip means this has more latency than
// the web path's live oscillator, a known tradeoff of not adding a second native audio
// backend just for this.
let previewPlayer: AudioPlayer | null = null;

// `program` is accepted so the two platforms' signatures match, and ignored: native renders
// through `synthesizeWav`, which has no sample path (see the plan's "Native" section).
export async function previewNote(noteName: string, durationMs = 180, _program?: number): Promise<void> {
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
  pendingStartMs = null;
}

/** Native has no worklet and no synth — `synthesizeWav` renders its own oscillator voices.
 *  Present so the two platforms' modules export the same surface. */
export async function warmSynth(): Promise<void> { /* no-op */ }
