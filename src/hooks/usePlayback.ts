import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pausePlayback, playbackClockMs, playbackLatencyMs, playNotes, resumePlayback, stopPlayback,
} from '@/native/Playback';
import type { PlaybackOptions } from '@/audio/tempo';
import type { TabNote } from '@/types';

/**
 * Shared playback control — meant to be reused by the list edit screen, the piano-roll
 * editor, and a pre-export preview, not wired up ad hoc in each place. `isPlaying` flips
 * back automatically once the sequence's total duration has elapsed, since neither the
 * native (file-based) nor web (OscillatorNode) backends emit a "finished" event.
 *
 * `currentTimeMs` is read back from the audio engine each animation frame — see `tick()` for
 * why it is not the wall-clock estimate it used to be.
 *
 * `loopEnabled`/`playbackRate` take effect on the next `play()` call. Higher-level
 * transports can apply either live by restarting from the current nominal timeline
 * position; keeping that policy outside this raw engine keeps loop and pause handling in
 * the layer that owns those concepts.
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
  // Set by play()'s loopBounds argument — when present, this (not the plain loopEnabled
  // toggle below) governs both when the current play() ends and where the next loop
  // restart begins. A loop region always wins over the whole-recording loop toggle.
  const lastLoopBoundsRef = useRef<{ startMs: number; endMs: number } | null>(null);
  // Absolute wall-clock timestamp the current end/loop timer is scheduled to fire at.
  const endAtRef        = useRef(0);
  // Snapshot of time-left-until-endAtRef, captured the instant pause() runs — resume()
  // must re-arm for exactly this much, not recompute from endAtRef at resume time (by
  // then, wall-clock time has passed *during* the pause itself, which would wrongly eat
  // into the remaining duration).
  const remainingMsRef  = useRef(0);
  // Set when seek() moves the playhead while paused — the paused audio engine is still
  // sitting at the old position (pause/resume only suspend/unsuspend it, they don't
  // reposition it), so a plain resumePlayback() would audibly jump back there. Consumed
  // by resume(), which does a full play() restart from currentTimeMs instead just this once.
  const pendingReseekRef = useRef(false);
  // Mirrors currentTimeMs for resume() to read without needing it in its own dep array —
  // tick() updates currentTimeMs every animation frame during playback, and a useCallback
  // depending on it directly would be torn down/rebuilt 60x/sec.
  const currentTimeMsRef = useRef(0);
  currentTimeMsRef.current = currentTimeMs;

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

  /**
   * The playhead reads the audio engine's own clock, and only estimates when it has none.
   *
   * Both backends report in nominal note-timeline units (matching `note.start_time`), so the
   * piano-roll playhead stays aligned with the notes at any playback rate.
   *
   * It used to be the wall-clock estimate below, unconditionally — `Date.now()` counted from
   * the moment `play()` was called, against audio placed on a clock of its own that had been
   * sampled separately. Nothing reconciled the two after the origin, so every gap between
   * them was permanent and they only ever accumulated: a context part-way through an
   * asynchronous `resume()` has a frozen clock the wall runs straight through, and `resume()`
   * below credits a pause with the wall-clock time it lasted, which is not the same as the
   * time the audio device took to come back. What the user sees is a red line running ahead
   * of the music, worsening across a session and cured by a page reload.
   *
   * The estimate survives as the fallback for a backend that cannot answer (or has not
   * started yet), which is the only case where the two can still disagree.
   */
  const tick = useCallback(() => {
    if (pauseStartRef.current === null) {
      const enginePosition = playbackClockMs();
      if (enginePosition !== null) {
        setCurrentTimeMs(enginePosition);
      } else {
        const elapsedWallMs = Date.now() - startedAtRef.current - pausedTotalRef.current;
        setCurrentTimeMs(elapsedWallMs * playbackRateRef.current);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const armEndTimeout = useCallback((delayMs: number) => {
    endAtRef.current = Date.now() + delayMs;
    endTimeoutRef.current = setTimeout(() => {
      clearTicker();
      const loopBounds = lastLoopBoundsRef.current;
      if (loopBounds) {
        // A loop region always loops itself, regardless of the separate whole-recording
        // loopEnabled toggle below — marking a region implies "loop this."
        play(lastNotesRef.current, lastOptionsRef.current, loopBounds.startMs, loopBounds);
        return;
      }
      if (loopEnabledRef.current) {
        play(lastNotesRef.current, lastOptionsRef.current);
        return;
      }
      setIsPlaying(false);
      setIsPaused(false);
      // Reaching the end naturally resets the playhead to the top, same as stop() —
      // otherwise the next play() would start from startAtMs≈totalMs (wherever
      // currentTimeMs's last tick landed) instead of the beginning.
      setCurrentTimeMs(0);
    }, delayMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTicker]);

  // `startAtMs` defaults to 0 (the loop restart in armEndTimeout's timeout relies on this
  // for the whole-recording-loop case — it calls play() with just notes/options, and that
  // always restarts from the top). `loopBounds`, when given, is a *persistent* range this
  // play() call belongs to — distinct from `startAtMs`, which is just where *this*
  // invocation happens to start (e.g. a mid-region scrub): armEndTimeout stops/loops at
  // `loopBounds.endMs` rather than the sequence's natural end, and a loop restart re-uses
  // the same bounds via armEndTimeout above, not wherever this particular call started.
  const play = useCallback((
    notes: TabNote[],
    options?: PlaybackOptions,
    startAtMs = 0,
    loopBounds?: { startMs: number; endMs: number },
  ) => {
    if (notes.length === 0) return;
    clearEndTimeout();
    clearTicker();
    const last = notes[notes.length - 1];
    const totalMs = last.start_time + last.duration;
    const rate = options?.rate ?? 1;
    const clampedStart = Math.max(0, Math.min(startAtMs, totalMs));
    const effectiveEnd  = Math.min(loopBounds?.endMs ?? totalMs, totalMs);

    lastNotesRef.current      = notes;
    lastOptionsRef.current    = options;
    lastLoopBoundsRef.current = loopBounds ?? null;
    playbackRateRef.current   = rate;

    // Back-date startedAtRef by the (rate-adjusted) skipped duration so tick()'s elapsed-
    // time math reports clampedStart immediately and counts up from there, without needing
    // a separate offset threaded through every place currentTimeMs gets computed.
    startedAtRef.current   = Date.now() - clampedStart / rate;
    pausedTotalRef.current = 0;
    pauseStartRef.current  = null;
    setCurrentTimeMs(clampedStart);

    playNotes(notes, options, clampedStart);
    setIsPlaying(true);
    setIsPaused(false);
    rafRef.current = requestAnimationFrame(tick);

    /* The timer runs on the wall clock while the playhead now runs on the audio clock, which
     * trails it by the output latency — so the pad has to cover that too, or the line is
     * snapped back to the top a moment before the last note is heard. On Bluetooth the
     * latency alone can exceed the pad. */
    armEndTimeout(Math.max(0, (effectiveEnd - clampedStart) / rate) + 150 + playbackLatencyMs());
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
    if (pendingReseekRef.current) {
      // The playhead moved while paused — restart from there instead of unsuspending the
      // old (now-stale) audio position. Carries the active loop region (if any) forward
      // unchanged — pausing and reseeking mid-region shouldn't silently drop the loop.
      pendingReseekRef.current = false;
      play(lastNotesRef.current, lastOptionsRef.current, currentTimeMsRef.current, lastLoopBoundsRef.current ?? undefined);
      return;
    }
    resumePlayback();
    if (pauseStartRef.current !== null) {
      pausedTotalRef.current += Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
    }
    setIsPaused(false);
    armEndTimeout(remainingMsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armEndTimeout]);

  // Moves the playhead marker without starting playback — e.g. clicking the piano-roll
  // ruler. While stopped, this is a plain visual seek. While paused, it also stays paused
  // (the audio engine doesn't move until resume() explicitly restarts it from the new spot
  // — see pendingReseekRef above) rather than audibly jumping back on resume. No-ops while
  // actively playing: callers that want to reposition mid-playback call play() again with
  // the new offset instead (a scrub) — see edit.tsx's handleSeek.
  const seek = useCallback((ms: number) => {
    if (isPlaying && !isPaused) return;
    if (isPaused) pendingReseekRef.current = true;
    setCurrentTimeMs(Math.max(0, ms));
  }, [isPlaying, isPaused]);

  const stop = useCallback(() => {
    clearEndTimeout();
    clearTicker();
    stopPlayback();
    pendingReseekRef.current = false;
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
