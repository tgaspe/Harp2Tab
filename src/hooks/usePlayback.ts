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
 */
export function usePlayback() {
  const [isPlaying, setIsPlaying]     = useState(false);
  const [isPaused, setIsPaused]       = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  const endTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef         = useRef<number | null>(null);
  const startedAtRef   = useRef(0);
  const pausedTotalRef = useRef(0);
  const pauseStartRef  = useRef<number | null>(null);

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
      setCurrentTimeMs(Date.now() - startedAtRef.current - pausedTotalRef.current);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const play = useCallback((notes: TabNote[], options?: PlaybackOptions) => {
    if (notes.length === 0) return;
    clearEndTimeout();
    clearTicker();
    const last = notes[notes.length - 1];
    const totalMs = last.start_time + last.duration;

    startedAtRef.current   = Date.now();
    pausedTotalRef.current = 0;
    pauseStartRef.current  = null;
    setCurrentTimeMs(0);

    playNotes(notes, options);
    setIsPlaying(true);
    setIsPaused(false);
    rafRef.current = requestAnimationFrame(tick);

    endTimeoutRef.current = setTimeout(() => {
      clearTicker();
      setIsPlaying(false);
      setIsPaused(false);
    }, totalMs + 150);
  }, [clearEndTimeout, clearTicker, tick]);

  const pause = useCallback(() => {
    pausePlayback();
    pauseStartRef.current = Date.now();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    resumePlayback();
    if (pauseStartRef.current !== null) {
      pausedTotalRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    setIsPaused(false);
  }, []);

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

  return { isPlaying, isPaused, currentTimeMs, play, pause, resume, stop };
}
