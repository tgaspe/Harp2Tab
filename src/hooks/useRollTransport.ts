import { useCallback, useMemo, useState } from 'react';
import { usePlayback } from '@/hooks/usePlayback';
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
 *
 * Owning the loop region here too (rather than as a `useState` in each screen) is what makes
 * that possible: every one of those rules needs it, and a hook that has to be handed the
 * region by its caller can't guarantee the caller passes it to `play()` as well.
 */

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

  /** One `play()` call site, so no rule can forget the loop region or the tempo map.
   *  `metronome` is an override for the toggle below, which has to restart with the *new*
   *  value before React has re-rendered with it. */
  const restart = useCallback((atMs: number, metronome = metronomeEnabled) => {
    play(
      notes,
      { bpm, metronomeEnabled: metronome, rate: playbackRate, tempoMap },
      atMs,
      loopRegion ?? undefined,
    );
  }, [play, notes, bpm, metronomeEnabled, playbackRate, tempoMap, loopRegion]);

  const onPlayToggle = useCallback(() => {
    if (!isPlaying) {
      // A loop region always starts playback from its own top, not wherever the playhead
      // happens to be — simpler and more predictable than handling "playhead is currently
      // outside the region" as a separate case.
      restart(loopRegion ? loopRegion.startMs : currentTimeMs);
      return;
    }
    if (isPaused) { resume(); return; }
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
    onStop: stop,
    loopEnabled, setLoopEnabled, playbackRate,
  };
}

/** mm:ss for the transport's elapsed/total readout. Floors rather than rounds — a readout
 *  that reaches 0:01 half a second early is reporting a position the playhead isn't at. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
