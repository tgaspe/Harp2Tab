import { useCallback, useEffect, useRef, useState } from 'react';
import { pausePlayback, playNotes, resumePlayback, stopPlayback } from '@/native/Playback';
import type { PlaybackOptions } from '@/audio/tempo';
import type { TabNote } from '@/types';

/**
 * Shared playback control — meant to be reused by the list edit screen, the piano-roll
 * editor, and a pre-export preview, not wired up ad hoc in each place. `isPlaying` flips
 * back automatically once the sequence's total duration has elapsed, since neither the
 * native (file-based) nor web (OscillatorNode) backends emit a "finished" event.
 *
 * `currentTimeMs` is a UI-side estimate (a rAF loop timed against `Date.now()`), not read
 * back from the audio engine — good enough for a transport readout/playhead, not meant
 * for sample-accurate sync.
 *
 * `loopEnabled`/`playbackRate` only take effect on the *next* `play()` call — neither is
 * changeable mid-playback, keeping the timing math (and the pause/resume interaction)
 * tractable. `playbackRate` is web-only in practice: the native backend pre-renders a WAV
 * and ignores the option entirely, so it only ever plays at 1x there.
 */
export function usePlayback() {
  const [isPlaying, setIsPlaying]     = useState(false);
  const [isPaused, setIsPaused]       = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const endTimeoutRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef          = useRef<number | null>(null);
  const startedAtRef    = useRef(0);
  const pausedTotalRef  = useRef(0);
  const pauseStartRef   = useRef<number | null>(null);
  const playbackRateRef = useRef(1);
  const loopEnabledRef  = useRef(false);
  const lastNotesRef    = useRef<TabNote[]>([]);
  const lastOptionsRef  = useRef<PlaybackOptions | undefined>(undefined);
  // Absolute wall-clock timestamp the current end/loop timer is scheduled to fire at.
  const endAtRef        = useRef(0);
  // Snapshot of time-left-until-endAtRef, captured the instant pause() runs — resume()
  // must re-arm for exactly this much, not recompute from endAtRef at resume time (by
  // then, wall-clock time has passed *during* the pause itself, which would wrongly eat
  // into the remaining duration).
  const remainingMsRef  = useRef(0);

  useEffect(() => { loopEnabledRef.current = loopEnabled; }, [loopEnabled]);

  const clearEndTimeout = useCallback(() => {
    if (endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current);
      endTimeoutRef.current = null;
    }
  }, []);

  const clearTicker = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    if (pauseStartRef.current === null) {
      const elapsedWallMs = Date.now() - startedAtRef.current - pausedTotalRef.current;
      // Report position in nominal note-timeline units (matching note.start_time) so the
      // piano-roll playhead stays aligned with notes regardless of playback rate — e.g. at
      // 2x, half as much wall-clock time passes for the same nominal position.
      setCurrentTimeMs(elapsedWallMs * playbackRateRef.current);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const armEndTimeout = useCallback((delayMs: number) => {
    endAtRef.current = Date.now() + delayMs;
    endTimeoutRef.current = setTimeout(() => {
      clearTicker();
      if (loopEnabledRef.current) {
        play(lastNotesRef.current, lastOptionsRef.current);
        return;
      }
      setIsPlaying(false);
      setIsPaused(false);
    }, delayMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTicker]);

  const play = useCallback((notes: TabNote[], options?: PlaybackOptions) => {
    if (notes.length === 0) return;
    clearEndTimeout();
    clearTicker();
    const last = notes[notes.length - 1];
    const totalMs = last.start_time + last.duration;
    const rate = options?.rate ?? 1;

    lastNotesRef.current    = notes;
    lastOptionsRef.current  = options;
    playbackRateRef.current = rate;

    startedAtRef.current   = Date.now();
    pausedTotalRef.current = 0;
    pauseStartRef.current  = null;
    setCurrentTimeMs(0);

    playNotes(notes, options);
    setIsPlaying(true);
    setIsPaused(false);
    rafRef.current = requestAnimationFrame(tick);

    armEndTimeout(totalMs / rate + 150);
  }, [clearEndTimeout, clearTicker, tick, armEndTimeout]);

  const pause = useCallback(() => {
    pausePlayback();
    pauseStartRef.current = Date.now();
    setIsPaused(true);
    // Freeze the end/loop timer — otherwise it keeps counting down in the background
    // while audio is suspended and can fire (stopping or restarting playback) before the
    // user resumes.
    remainingMsRef.current = Math.max(0, endAtRef.current - Date.now());
    clearEndTimeout();
  }, [clearEndTimeout]);

  const resume = useCallback(() => {
    resumePlayback();
    if (pauseStartRef.current !== null) {
      pausedTotalRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    setIsPaused(false);
    armEndTimeout(remainingMsRef.current);
  }, [armEndTimeout]);

  // Moves the playhead marker without starting playback — e.g. clicking the piano-roll
  // ruler. Only while not actively playing (matches Signal's own click-to-position
  // behavior); resuming playback still starts from 0, not the seeked position — wiring a
  // real "play from here" would mean threading a start offset through the native/web audio
  // scheduling, a bigger change than this visual seek.
  const seek = useCallback((ms: number) => {
    if (isPlaying) return;
    setCurrentTimeMs(Math.max(0, ms));
  }, [isPlaying]);

  const stop = useCallback(() => {
    clearEndTimeout();
    clearTicker();
    stopPlayback();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentTimeMs(0);
  }, [clearEndTimeout, clearTicker]);

  useEffect(() => () => {
    clearEndTimeout();
    clearTicker();
    stopPlayback();
  }, [clearEndTimeout, clearTicker]);

  return {
    isPlaying, isPaused, currentTimeMs, play, pause, resume, stop, seek,
    loopEnabled, setLoopEnabled, playbackRate, setPlaybackRate,
  };
}
