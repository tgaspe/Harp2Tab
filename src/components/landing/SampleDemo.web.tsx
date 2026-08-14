/**
 * The landing page's live demo (12-3): play a bundled harmonica clip and watch it become tab.
 *
 * This runs the **real** pipeline — the same `decodeAudioFile` → `runTranscription` →
 * `notesToTabs` path the app itself uses, with Basic Pitch as the engine — rather than
 * replaying a pre-baked result. That is the whole point: it proves the product works.
 *
 * ## Every import of `@/audio` here must stay dynamic
 *
 * `@spotify/basic-pitch` pulls in TensorFlow.js, and the model is another 900 KB from
 * `public/models/basic-pitch`. Neither is in the initial bundle today — `basicPitch.web.ts`
 * already imports the library dynamically in both places it needs it, and nothing in `src/`
 * imports it statically. A static `import { runTranscription } from '@/audio/transcription'`
 * at the top of this file would pull that whole graph onto the landing page's critical path
 * and regress its LCP, which is the single easiest thing to break here. Type-only imports are
 * erased at compile time and are fine.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { TabNote } from '@/types';
import { DEMO_WAVEFORM } from './demoWaveform';
import { LANDING_COLORS } from './tokens';

/**
 * The bundled clip — 10.8s of Ode to Joy on a C harp, mono MP3 (168 KB). `public/` is copied
 * to the site root by `expo export -p web`.
 *
 * Chosen because of what it transcribes to: `5 5 -5 6 6 -5 5 -4 4 4 -4 5 -4 4 4`, which is
 * E E F G G F E D C C D E D C C — the melody, exactly, in first position with no bends and no
 * unplayable notes. A visitor who knows the tune can read the tab and check the tool's work,
 * which is worth more on this page than a harder phrase transcribed almost right.
 *
 * MP3 rather than Ogg deliberately: Safari's `decodeAudioData` support for Vorbis is
 * unreliable, and this clip is the one asset the page's whole argument rests on.
 */
const SAMPLE_URL = '/demo/sample.mp3';

/** The clip's real amplitude envelope, measured by `scripts/build-demo-waveform.py`. */
const WAVE = DEMO_WAVEFORM;

type Stage = 'idle' | 'working' | 'playing' | 'done' | 'error';

const STAGE_LABEL: Record<string, string> = {
  decoding:     'Decoding audio…',
  loadingModel: 'Loading the model…',
  analyzing:    'Listening…',
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export interface SampleDemoProps {
  /** Lifted so the key lab further down the page can move this same take onto other harps. */
  onResult?: (tabs: Omit<TabNote, 'id'>[], key: string) => void;
}

export function SampleDemo({ onResult }: SampleDemoProps) {
  const [stage,    setStage]    = useState<Stage>('idle');
  const [progress, setProgress] = useState('');
  const [error,    setError]    = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [tabs,     setTabs]     = useState<Omit<TabNote, 'id'>[]>([]);
  const [revealed, setRevealed] = useState(0);
  /** 0–1 through the clip. Drives the waveform, so the bars are a real playhead. */
  const [played,   setPlayed]   = useState(0);

  const audioRef  = useRef<HTMLAudioElement | null>(null);
  const rafRef    = useRef<number | null>(null);
  // Inference is the expensive half; a replay must not pay for it twice.
  const cacheRef  = useRef<{ tabs: Omit<TabNote, 'id'>[]; key: string } | null>(null);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
  }, []);

  /** Walk the clock, revealing each note as the audio actually reaches it. */
  const startPlayback = useCallback((notes: Omit<TabNote, 'id'>[]) => {
    const audio = audioRef.current ?? new Audio(SAMPLE_URL);
    audioRef.current = audio;
    audio.currentTime = 0;

    if (prefersReducedMotion()) {
      setRevealed(notes.length);
      setPlayed(1);
      setStage('done');
      void audio.play().catch(() => {});
      return;
    }

    setRevealed(0);
    setPlayed(0);
    setStage('playing');

    const finish = () => {
      setRevealed(notes.length);
      setPlayed(1);
      setStage('done');
      rafRef.current = null;
    };

    const tick = () => {
      const ms = audio.currentTime * 1000;
      if (audio.duration) setPlayed(Math.min(1, audio.currentTime / audio.duration));
      let count = 0;
      while (count < notes.length && notes[count].start_time <= ms) count += 1;
      setRevealed(count);

      // `ended` only. Testing `paused` as well looks like a safe extra guard and is not: it is
      // still true for the first frames after `play()` is called, so the loop would end
      // immediately and every bar would light at once. Pausing is handled by the promise
      // rejection path below, which is the only way playback fails to start here.
      if (audio.ended) return finish();
      rafRef.current = requestAnimationFrame(tick);
    };

    // Start the loop only once playback is actually running, for the same reason.
    void audio.play()
      .then(() => { rafRef.current = requestAnimationFrame(tick); })
      // Autoplay refusal only costs the animation; the tab is already computed.
      .catch(finish);
  }, []);

  const run = useCallback(async () => {
    if (stage === 'working' || stage === 'playing') return;

    if (cacheRef.current) {
      setTabs(cacheRef.current.tabs);
      setDetected(cacheRef.current.key);
      onResult?.(cacheRef.current.tabs, cacheRef.current.key);
      startPlayback(cacheRef.current.tabs);
      return;
    }

    setStage('working');
    setError('');
    setProgress(STAGE_LABEL.decoding);

    try {
      // Dynamic, deliberately — see the header note. These three are what would drag
      // TensorFlow.js onto the initial page load if they were static.
      const [{ decodeAudioFile }, { runTranscription }, { notesToTabs }] = await Promise.all([
        import('@/audio/decodeAudio'),
        import('@/audio/transcription'),
        import('@/audio/notesToTabs'),
      ]);

      // `readFileBytes.web.ts` falls back to `fetch(uri).arrayBuffer()` when there is no DOM
      // `File`, so a bundled URL is a valid picked file. Leaving `size` undefined skips the
      // 25 MB gate rather than tripping it.
      const audio = await decodeAudioFile({ name: 'sample.mp3', uri: SAMPLE_URL });

      const result = await runTranscription({
        audio,
        harmonicaType: 'diatonic',
        algorithm:     'basicPitch',
        sourceName:    'the sample clip',
        onProgress: ({ stage: s }) => setProgress(STAGE_LABEL[s] ?? 'Working…'),
      });

      // Key detection comes back inside the result — `runTranscription` ranks keys itself for
      // the note lane, so the badge costs no extra pass. It is null only for chromatic.
      const key = result.detection?.best.key ?? 'C';
      const computed = notesToTabs(result.notes, key, 'diatonic', 'modelActivation');

      cacheRef.current = { tabs: computed, key };
      setTabs(computed);
      setDetected(key);
      onResult?.(computed, key);
      startPlayback(computed);
    } catch (err) {
      // The pipeline's own messages are written for someone who just chose a file in the app
      // ("Try a WAV, MP3, or M4A file") — advice a landing-page visitor cannot act on, since
      // they did not pick anything. Show one honest sentence and keep the real error in the
      // console for whoever is debugging the page.
      console.warn('[Harp2Tab] sample demo failed:', err);
      setStage('error');
      setError('The sample could not be transcribed just now — but the app itself is fine.');
    }
  }, [stage, startPlayback, onResult]);

  const busy    = stage === 'working';
  const playing = stage === 'playing';

  return (
    <div className="lp-demo">
      <div className="lp-demo__bar">
        <button
          type="button"
          className="lp-demo__play"
          onClick={run}
          disabled={busy}
          aria-label={playing ? 'Playing the sample clip' : 'Play the sample clip and transcribe it'}
        >
          {busy ? <span className="lp-demo__spinner" aria-hidden="true" /> : playing ? '❚❚' : '▶'}
        </button>

        {/* The real envelope of the clip, lit up to the playhead — so the bars report where
            playback actually is rather than flipping on all at once. */}
        <div className="lp-demo__wave" aria-hidden="true">
          {WAVE.map((h, i) => (
            <span
              key={i}
              className={i / WAVE.length < played ? 'lp-demo__bar-lit' : undefined}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>

        {detected && (
          <span className="lp-demo__key">Key of {detected} detected</span>
        )}
      </div>

      <div className="lp-demo__stage" aria-live="polite">
        {/* The section lead already says what this does and where it runs; repeating it here
            wastes the one line the visitor reads while deciding to press play. Name the clip
            instead, so they know what they are about to hear — and can judge the result
            against a tune they already know. */}
        {stage === 'idle' && (
          <p className="lp-demo__hint">
            Ode to Joy, played on a ten-hole C harmonica.
          </p>
        )}

        {busy && <p className="lp-demo__hint">{progress}</p>}

        {stage === 'error' && (
          <p className="lp-demo__hint lp-demo__hint--error">{error}</p>
        )}

        {tabs.length > 0 && (
          <ol className="lp-demo__tabs">
            {tabs.map((note, i) => (
              <li
                key={`${note.start_time}-${i}`}
                className={i < revealed ? 'lp-demo__tab lp-demo__tab--in' : 'lp-demo__tab'}
              >
                {note.tab || '·'}
              </li>
            ))}
          </ol>
        )}
      </div>

      {stage === 'done' && (
        <a className="lp-demo__cta" href="/app">
          Now try your own →
        </a>
      )}
    </div>
  );
}

/** Styles for the demo, kept beside it rather than in `landingStyles.ts` so the one stateful
 *  component on the page owns its own appearance. Concatenated into the same `<style>` block. */
export const SAMPLE_DEMO_CSS = `
/* No card chrome of its own — it sits inside ".lp-panel", which owns the border, radius and
   shadow for both halves. See the note beside that rule in landingStyles.ts. */
.lp-demo { padding: 30px 32px; }
.lp-demo__bar { display: flex; align-items: center; gap: 20px; }
.lp-demo__play {
  flex: none;
  width: 64px; height: 64px;
  border-radius: 50%;
  border: none;
  background: ${LANDING_COLORS.accent};
  color: #06232A;
  font-size: 22px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background-color 160ms ease, transform 160ms ease;
}
.lp-demo__play:hover:not(:disabled) { background: ${LANDING_COLORS.accentDim}; transform: scale(1.04); }
.lp-demo__play:disabled { cursor: progress; opacity: 0.75; }
.lp-demo__spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid rgba(6,35,42,0.35);
  border-top-color: #06232A;
  animation: lp-spin 700ms linear infinite;
}
@keyframes lp-spin { to { transform: rotate(360deg); } }

.lp-demo__wave {
  flex: 1;
  display: flex; align-items: center; gap: 2px;
  height: 64px;
}
.lp-demo__wave span {
  flex: 1;
  /* A hairline, not a bar — the shape is carried by the count now, not the individual widths.
     1px is the floor: below it sub-pixel bars alias against the gaps and the envelope reads
     as noise. BARS in scripts/build-demo-waveform.py is the other half of this trade. */
  min-width: 1px;
  background: rgba(255,255,255,0.16);
  border-radius: 1px;
  /* Short, because each bar lights individually as the playhead reaches it — a long fade
     would smear the playhead into a gradient instead of a position. */
  transition: background-color 120ms ease;
}
.lp-demo__wave .lp-demo__bar-lit { background: ${LANDING_COLORS.accent}; opacity: 0.9; }

.lp-demo__key {
  flex: none;
  font-size: 14px;
  color: ${LANDING_COLORS.accent};
  background: ${LANDING_COLORS.accentSoft};
  border-radius: 999px;
  padding: 8px 14px;
  white-space: nowrap;
}

.lp-demo__stage {
  margin-top: 22px;
  /* Reserved so the tab landing does not shove the rest of the panel down — but only just
     enough for one row, since before playback this is empty space the visitor is looking at. */
  min-height: 58px;
  border-top: 1px solid ${LANDING_COLORS.border};
  padding-top: 22px;
}
.lp-demo__hint { color: ${LANDING_COLORS.textMuted}; font-size: 15px; }
.lp-demo__hint--error { color: #F59E0B; }

.lp-demo__tabs {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 14px;
  padding: 0; list-style: none;
}
.lp-demo__tab {
  font-size: 26px;
  letter-spacing: 0.06em;
  color: ${LANDING_COLORS.accent};
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 180ms ease, transform 180ms ease;
}
.lp-demo__tab--in { opacity: 1; transform: none; }

.lp-demo__cta { display: inline-block; margin-top: 20px; font-size: 16px; }

@media (max-width: 560px) {
  .lp-demo { padding: 20px; }
  .lp-demo__stage { min-height: 0; }
  .lp-demo__bar { flex-wrap: wrap; }
  .lp-demo__wave { height: 48px; gap: 1px; }
  /* 112 hairlines plus their gaps need ~330px, which a phone does not have left over once the
     play button has taken its share. Rather than let the browser squeeze them past 1px into a
     solid block, drop every other bar: half the resolution, but still the same envelope. */
  .lp-demo__wave span:nth-child(even) { display: none; }
  .lp-demo__key { order: 3; width: 100%; text-align: center; }
}

@media (prefers-reduced-motion: reduce) {
  .lp-demo__tab { opacity: 1; transform: none; transition: none; }
  .lp-demo__spinner { animation-duration: 1.4s; }
}
`;
