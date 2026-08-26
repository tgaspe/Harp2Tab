import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { usePlayback } from '@/hooks/usePlayback';
import { ensureProgramsLoaded } from '@/audio/soundfont';
import { DEFAULT_PROGRAM } from '@/audio/timbre';
import { PLAYBACK_RATES, barDurationMs, type TempoMap } from '@/audio/tempo';
import type { TabNote } from '@/types';

/**
 * Transport *policy* for a piano-roll editor — the layer between `usePlayback` (the raw
 * engine) and a transport bar.
 *
 * `usePlayback` deliberately knows nothing about loop regions, bars, or what a seek should
 * mean while audio is running; each screen used to answer those questions for itself. Both
 * the tab editor and the MIDI Studio did, and they answered them differently — the Studio's
 * copy was missing three behaviours the editor had, none of them obviously absent until you
 * tried the control:
 *
 *   - `usePlayback.seek()` early-returns while playing (a seek can't reposition a running
 *     graph), so clicking the ruler mid-playback did nothing at all. Repositioning has to
 *     be a `play()` restart from the new spot.
 *   - Pressing play with a loop region marked started from the playhead rather than from
 *     the region's own top.
 *   - The metronome click track is baked into the audio graph at `play()` time, so toggling
 *     it mid-playback changed a flag and nothing audible.
 *   - So is every *note*, for the same reason (see the rescheduling block below), so editing
 *     the roll while it played changed the picture and not the sound until a stop/start.
 *
 * Owning the loop region here too (rather than as a `useState` in each screen) is what makes
 * that possible: every one of those rules needs it, and a hook that has to be handed the
 * region by its caller can't guarantee the caller passes it to `play()` as well.
 */

/**
 * How long note edits must settle before playback is rebuilt around them.
 *
 * Edits arrive in bursts: a note drag commits once on release, but the velocity-threshold
 * line writes on every step it crosses, and each rebuild tears the whole audio graph down
 * and re-schedules it (on native, it re-renders the entire sequence to a WAV). Long enough
 * to collapse a burst into one rebuild, short enough that an edit still reads as immediate.
 */
const RESCHEDULE_DEBOUNCE_MS = 120;

/** How long a sample load may take before the transport admits it is loading. A warm cache
 *  resolves in a microtask, and an indicator that flashes on every play press is worse than
 *  no indicator at all. */
const LOADING_INDICATOR_MS = 300;

export interface LoopRegion { startMs: number; endMs: number }

export interface RollTransportInput {
  /** Everything that should sound. The tab editor passes its one list of notes; the Studio
   *  passes every audible track merged, since a project plays as a whole. */
  notes: TabNote[];
  bpm: number;
  /** Present for a project, absent for a tab session — see `PlaybackOptions.tempoMap`. */
  tempoMap?: TempoMap;
  /**
   * Total length for the transport's readout and for clamping bar skips.
   *
   * Optional because the two hosts know it differently: a tab session's length *is* the
   * end of its last note, while a project stores its own `durationMs` covering every
   * track, including ones the roll isn't showing. Falls back to the derived value.
   */
  totalTimeMs?: number;
  /** Held by the caller, not here — the tab editor persists it per-recording in
   *  `useAppStore`, while the Studio's is session-local. Only the restart-on-toggle
   *  behaviour is shared, and that's what this hook adds. */
  metronomeEnabled: boolean;
  setMetronomeEnabled: (enabled: boolean) => void;
}

export function useRollTransport({
  notes, bpm, tempoMap, totalTimeMs, metronomeEnabled, setMetronomeEnabled,
}: RollTransportInput) {
  const {
    isPlaying, isPaused, currentTimeMs, play, pause, resume, stop, seek,
    loopEnabled, setLoopEnabled, playbackRate, setPlaybackRate,
  } = usePlayback();

  // A/B loop region marked on the piano-roll ruler — when set it takes priority over the
  // plain whole-recording `loopEnabled` toggle (see usePlayback's loopBounds handling).
  const [loopRegion, setLoopRegion] = useState<LoopRegion | null>(null);

  const derivedTotalMs = useMemo(
    () => notes.reduce((max, n) => Math.max(max, n.start_time + n.duration), 0),
    [notes],
  );
  const totalMs = totalTimeMs ?? derivedTotalMs;

  /** Set when notes change while paused. Pause only *suspends* the engine, so it is still
   *  holding the pre-edit schedule and `resume()` would unsuspend exactly that. Rebuilding
   *  right away would be wrong too — the user paused, so nothing should sound until they
   *  press play — hence a flag the next play press consumes. This can't ride on
   *  `usePlayback`'s own `pendingReseekRef`: that path rebuilds from the note list
   *  `usePlayback` captured at `play()` time, which is the stale copy being replaced. */
  const staleWhilePausedRef = useRef(false);

  /** Bumped by every `restart`, so an in-flight instrument load whose press has been
   *  superseded resolves into a no-op instead of starting stale audio. */
  const playGenerationRef = useRef(0);
  const [instrumentsLoading, setInstrumentsLoading] = useState(false);

  /** One `play()` call site, so no rule can forget the loop region or the tempo map.
   *  `metronome` is an override for the toggle below, which has to restart with the *new*
   *  value before React has re-rendered with it. */
  const restart = useCallback((atMs: number, metronome = metronomeEnabled) => {
    // Whatever was scheduled is gone; these notes are what the engine now holds.
    staleWhilePausedRef.current = false;
    const generation = ++playGenerationRef.current;

    /* Sampled instruments have to be resident *before* the clock starts. `usePlayback.play`
     * back-dates `startedAtRef` and starts the rAF ticker synchronously without awaiting
     * `playNotes` (`usePlayback.ts:140-150`), so anything awaited further down would run the
     * playhead over silence and shift the end timeout by the load time. What loads is a
     * handful of instruments, not a piece of audio — see the plan's "No streaming
     * scheduler". `ensureProgramsLoaded` never rejects: a failed load resolves and every
     * note falls back to its oscillator, silently. */
    // `?? DEFAULT_PROGRAM` rather than a filter: a note with no program still has a sound to
    // load — the harmonica a tab session is made of.
    const programs = [...new Set(notes.map((n) => n.program ?? DEFAULT_PROGRAM))];
    const ready = ensureProgramsLoaded(programs, notes.some((n) => n.percussion === true));

    const slowTimer = setTimeout(() => {
      if (playGenerationRef.current === generation) setInstrumentsLoading(true);
    }, LOADING_INDICATOR_MS);

    void ready.then(() => {
      clearTimeout(slowTimer);
      // A newer press (or a live edit) superseded this load while it was in flight. Starting
      // now would play the notes as they were before the edit, over a playhead already
      // running for the newer schedule.
      if (playGenerationRef.current !== generation) return;
      setInstrumentsLoading(false);
      play(
        notes,
        { bpm, metronomeEnabled: metronome, rate: playbackRate, tempoMap },
        atMs,
        loopRegion ?? undefined,
      );
    });
  }, [play, notes, bpm, metronomeEnabled, playbackRate, tempoMap, loopRegion]);

  /* ── Rescheduling around live edits ────────────────────────────────────────────────────
   * Both backends commit the entire sequence to the audio engine at `play()` time — web
   * schedules every OscillatorNode up front, native pre-renders a WAV — so a note added,
   * moved, resized, silenced or deleted mid-playback kept sounding the way it did when play
   * was pressed. On screens whose whole purpose is editing, that meant a stop/start round
   * trip to hear any change. Rebuilding from wherever the playhead currently is makes an
   * edit audible on the next pass instead.
   *
   * Everything the effect below reads other than `notes` goes through a ref on purpose, so
   * it stays keyed on `notes` alone: `currentTimeMs` in particular re-renders every
   * animation frame while playing, and depending on it would re-arm the debounce ~60×/sec
   * and never let it fire. */
  const restartRef     = useRef(restart);     restartRef.current     = restart;
  const isPlayingRef   = useRef(isPlaying);   isPlayingRef.current   = isPlaying;
  const isPausedRef    = useRef(isPaused);    isPausedRef.current    = isPaused;
  const currentTimeRef = useRef(currentTimeMs); currentTimeRef.current = currentTimeMs;

  const rescheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelReschedule = useCallback(() => {
    if (rescheduleTimerRef.current) {
      clearTimeout(rescheduleTimerRef.current);
      rescheduleTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isPlayingRef.current) return;  // stopped — the next play() picks up these notes anyway
    if (isPausedRef.current) { staleWhilePausedRef.current = true; return; }
    // Every note deleted mid-playback: play() refuses an empty sequence, so a rebuild would
    // leave the old audio running under a stuck transport. Nothing left to hear — stop.
    if (notes.length === 0) { stop(); return; }

    rescheduleTimerRef.current = setTimeout(() => {
      rescheduleTimerRef.current = null;
      // The transport can have moved on during the debounce window.
      if (!isPlayingRef.current) return;
      if (isPausedRef.current) { staleWhilePausedRef.current = true; return; }
      restartRef.current(currentTimeRef.current);
    }, RESCHEDULE_DEBOUNCE_MS);

    // Runs before the next edit re-arms, and on unmount — a pending rebuild never outlives
    // the state it was queued against.
    return cancelReschedule;
  }, [notes, stop, cancelReschedule]);

  const onPlayToggle = useCallback(() => {
    if (!isPlaying) {
      // A loop region always starts playback from its own top, not wherever the playhead
      // happens to be — simpler and more predictable than handling "playhead is currently
      // outside the region" as a separate case.
      restart(loopRegion ? loopRegion.startMs : currentTimeMs);
      return;
    }
    // Edited while paused — resume() would unsuspend the pre-edit schedule, so rebuild from
    // the playhead instead. Same position either way, so this is invisible apart from the
    // edit being audible.
    if (isPaused) {
      if (staleWhilePausedRef.current) restart(currentTimeMs);
      else resume();
      return;
    }
    pause();
  }, [isPlaying, isPaused, restart, loopRegion, currentTimeMs, resume, pause]);

  // While actively playing, restart playback from the new spot (a plain seek() no-ops
  // there — see usePlayback). While stopped OR paused, seek() alone is right: stopped, it's
  // a plain visual move; paused, it moves the marker but deliberately stays paused rather
  // than resuming audio — resume() picks up the new position next time it's pressed.
  const onSeek = useCallback((ms: number) => {
    if (isPlaying && !isPaused) { restart(ms); return; }
    seek(ms);
  }, [isPlaying, isPaused, restart, seek]);

  // Jumps the playhead a full bar at a time — works whether stopped, paused, or mid-
  // playback (onSeek already restarts playback from the new spot when needed).
  const onSkipBar = useCallback((direction: 1 | -1) => {
    const barMs = barDurationMs(bpm);
    onSeek(Math.max(0, Math.min(totalMs, currentTimeMs + direction * barMs)));
  }, [bpm, onSeek, totalMs, currentTimeMs]);

  // Drops any queued rebuild rather than relying on the timer's own guards to notice the
  // transport went away — stop is the one control that means "nothing further should sound."
  const onStop = useCallback(() => {
    cancelReschedule();
    staleWhilePausedRef.current = false;
    stop();
  }, [cancelReschedule, stop]);

  /**
   * Leaving the screen stops the audio.
   *
   * `usePlayback` only tears the engine down on *unmount*, and these screens are pushed
   * over rather than replaced — converting a track pushes `/edit`, the tab editor pushes
   * `/export` and `/frame-inspector` — so the roll screen stays mounted behind the new one
   * and its unmount cleanup never runs. The sequence is committed to the audio engine up
   * front (a graph of scheduled oscillators on web, a pre-rendered WAV on native), so it
   * kept playing under a screen with no transport to stop it with. Blur is the event that
   * actually happens; the header-action effects in both screens are keyed off it for the
   * same reason.
   *
   * Through a ref so the effect stays keyed on focus alone — re-running it because a
   * callback changed identity mid-playback would run this cleanup and stop the audio.
   */
  const onStopRef = useRef(onStop); onStopRef.current = onStop;
  useFocusEffect(useCallback(() => () => onStopRef.current(), []));

  const onCycleRate = useCallback(() => {
    const i = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number]);
    setPlaybackRate(PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length]);
  }, [playbackRate, setPlaybackRate]);

  // The metronome click track is baked into the audio graph at play()-time (see
  // Playback.web.ts's scheduleMetronome) — flipping the flag alone doesn't touch whatever's
  // already scheduled. Mid-playback, restart from the current spot with the new setting so
  // the click track actually starts/stops, the same trick onSeek uses for repositioning.
  const onToggleMetronome = useCallback(() => {
    const next = !metronomeEnabled;
    setMetronomeEnabled(next);
    if (isPlaying && !isPaused) restart(currentTimeMs, next);
  }, [metronomeEnabled, setMetronomeEnabled, isPlaying, isPaused, restart, currentTimeMs]);

  return {
    isPlaying, isPaused, currentTimeMs, totalTimeMs: totalMs,
    loopRegion, setLoopRegion,
    onPlayToggle, onSeek, onSkipBar, onCycleRate, onToggleMetronome,
    onStop,
    loopEnabled, setLoopEnabled, playbackRate,
    /** True only while a sample load has been running longer than `LOADING_INDICATOR_MS`.
     *  Playback is never blocked on it — the transport stays live, and a load that fails
     *  falls back to oscillators without ever setting this. */
    instrumentsLoading,
  };
}

/** mm:ss for the transport's elapsed/total readout. Floors rather than rounds — a readout
 *  that reaches 0:01 half a second early is reporting a position the playhead isn't at. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
