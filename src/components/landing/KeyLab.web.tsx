/**
 * The interactive half of the "Diatonic and chromatic" section (12-3).
 *
 * Takes the tab the demo just produced and lets a visitor move it onto any of the twelve
 * harps, in either instrument, under the editor's own two key-change modes. It is the second
 * interactive proof on the page, and unlike the demo it costs nothing to run: translation is
 * pure arithmetic over `HarmonicaMapper`, with no model, no audio and no store.
 *
 * ## Why both rows are shown
 *
 * Transpose is *visually inert on the tab* — by definition it keeps the tab and changes the
 * music. Showing tab alone would make the Transpose button look broken. With the note row
 * beside it the pair becomes legible: Transpose holds the tab still and moves the notes,
 * Translate holds the notes still and moves the tab. That distinction is the thing this
 * section exists to teach.
 *
 * ## Where the behaviour comes from
 *
 * `KeyTypeControl` in `src/app/edit.tsx:962-1020` is the original. It routes through the
 * `transposeToKey` / `translateToKey` / `changeHarmonicaType` store actions; this page calls
 * the pure functions underneath them instead, so nothing here reads a store and the default
 * state still renders into the static HTML export. Two behaviours are copied deliberately:
 *
 * - **Switching instrument always preserves pitch**, whichever mode is selected — the same
 *   rule the editor states in `PianoRoll`'s help text.
 * - **Stranded notes are surfaced, not hidden.** The editor warns before a change that would
 *   leave notes outside the harp's range; here the count is shown after the fact, because a
 *   landing page should let you discover that A is a bad harp for this tune by trying it.
 */
import React, { useMemo, useState } from 'react';

import { noteToTab, tabToNote } from '@/audio/HarmonicaMapper';
import { HARMONICA_KEYS } from '@/constants/keys';
import type { HarmonicaKey, HarmonicaType } from '@/types';

import { LANDING_COLORS as C } from './tokens';

type KeyChangeMode = 'transpose' | 'translate';

/** Same wording as `KEY_MODE_HINT` in `edit.tsx`, so the page teaches what the app says. */
const MODE_HINT: Record<KeyChangeMode, string> = {
  transpose: 'Same tabs — the music changes key',
  translate: 'Same music — the tabs change',
};

/** "an A diatonic", not "a A diatonic" — by how the key *sounds*, not its first letter. */
const VOWEL_KEYS = new Set<HarmonicaKey>(['A', 'Ab', 'E', 'Eb', 'F', 'F#']);
const article = (key: HarmonicaKey) => (VOWEL_KEYS.has(key) ? 'an' : 'a');

export interface KeyLabProps {
  /** Note names in order, e.g. `['E5','E5','F5',…]`. The demo's output when it has run. */
  notes: readonly string[];
  /** The harp those notes were transcribed for. */
  sourceKey: HarmonicaKey;
}

export function KeyLab({ notes, sourceKey }: KeyLabProps) {
  const [mode, setMode] = useState<KeyChangeMode>('translate');
  const [key, setKey] = useState<HarmonicaKey>(sourceKey);
  const [type, setType] = useState<HarmonicaType>('diatonic');

  // The tab as it reads on the source harp — the fixed thing Transpose carries around.
  const sourceTabs = useMemo(
    () => notes.map((n) => noteToTab(n, sourceKey, 'diatonic') ?? ''),
    [notes, sourceKey],
  );

  const { tabs, shownNotes, stranded } = useMemo(() => {
    if (mode === 'transpose') {
      // Keep the tab, re-read what it sounds like on this harp. A tab that has no position on
      // the other instrument's layout simply has no pitch there, which is itself the answer.
      const played = sourceTabs.map((t) => (t ? tabToNote(t, key, type) : null));
      return {
        tabs: sourceTabs,
        shownNotes: played.map((n) => n ?? '—'),
        stranded: played.filter((n) => n === null).length,
      };
    }
    // Translate — and instrument changes are always pitch-preserving, so they land here too.
    const mapped = notes.map((n) => noteToTab(n, key, type));
    return {
      tabs: mapped.map((t) => t ?? '·'),
      shownNotes: [...notes],
      stranded: mapped.filter((t) => t === null).length,
    };
  }, [mode, key, type, notes, sourceTabs]);

  const instrument = type === 'chromatic' ? 'chromatic' : 'diatonic';

  return (
    <div className="lp-lab">
      <div className="lp-lab__controls">
        <div className="lp-lab__group">
          <span className="lp-lab__label">Harmonica</span>
          <div className="lp-seg">
            {(['diatonic', 'chromatic'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={t === type ? 'lp-seg__btn lp-seg__btn--on' : 'lp-seg__btn'}
                onClick={() => setType(t)}
                aria-pressed={t === type}
              >
                {t === 'chromatic' ? '12-Chromatic' : 'Diatonic'}
              </button>
            ))}
          </div>
        </div>

        <div className="lp-lab__group">
          <span className="lp-lab__label">Changing key</span>
          <div className="lp-seg">
            {(['transpose', 'translate'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={m === mode ? 'lp-seg__btn lp-seg__btn--on' : 'lp-seg__btn'}
                onClick={() => setMode(m)}
                aria-pressed={m === mode}
              >
                {m === 'transpose' ? 'Transpose' : 'Translate'}
              </button>
            ))}
          </div>
          <span className="lp-lab__hint">{MODE_HINT[mode]}</span>
        </div>
      </div>

      <span className="lp-lab__label">Harp</span>
      <div className="lp-keygrid lp-keygrid--live">
        {HARMONICA_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={k === key ? 'lp-key lp-key--on' : 'lp-key'}
            onClick={() => setKey(k)}
            aria-pressed={k === key}
          >
            {k}
          </button>
        ))}
      </div>

      {/* One cell per note, tab stacked over pitch, so the two always line up. Two independent
          rows would drift apart as soon as a tab widened to "-6'" — and the whole point of
          showing both is that you can read them against each other. */}
      <div className="lp-lab__out">
        <span className="lp-lab__label">Tab and pitch</span>
        <ol className="lp-lab__cells">
          {tabs.map((t, i) => (
            <li className="lp-lab__cell" key={i}>
              <span className={t === '·' ? 'lp-lab__tab lp-lab__tab--dead' : 'lp-lab__tab'}>
                {t}
              </span>
              <span className="lp-lab__note">{shownNotes[i]}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="lp-lab__verdict">
        {stranded > 0
          ? `${stranded} of ${notes.length} notes can’t be played on ${article(key)} ${key} ${instrument} — worth knowing before you practise it.`
          : `Every note is playable on ${article(key)} ${key} ${instrument}.`}
      </p>
    </div>
  );
}

export const KEY_LAB_CSS = `
/* Like .lp-demo, no chrome of its own — ".lp-panel" in landingStyles.ts owns it. */
.lp-lab { padding: 30px 32px 32px; }
.lp-lab__controls { display: flex; flex-wrap: wrap; gap: 36px; margin-bottom: 26px; }
.lp-lab__group { display: flex; flex-direction: column; gap: 10px; }
.lp-lab__label {
  font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase;
  color: ${C.textMuted};
}
.lp-lab__hint { font-size: 14px; color: ${C.textSub}; }

.lp-seg {
  display: inline-flex;
  background: ${C.bg};
  border: 1px solid ${C.border};
  border-radius: 10px;
  padding: 4px;
  gap: 4px;
}
.lp-seg__btn {
  border: none;
  background: transparent;
  color: ${C.textSub};
  font: inherit;
  font-size: 15px;
  padding: 8px 16px;
  border-radius: 7px;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.lp-seg__btn:hover { color: ${C.text}; }
.lp-seg__btn--on { background: ${C.accent}; color: #06232A; }
.lp-seg__btn--on:hover { color: #06232A; }

/* Tighter than the page's decorative key grid: this one is a control strip, not a display,
   so the cells are sized to be clicked through quickly rather than to fill the column. */
.lp-keygrid--live {
  margin-top: 10px;
  grid-template-columns: repeat(12, 1fr);
  gap: 8px;
}
.lp-root .lp-keygrid--live .lp-key {
  /* The panel behind this grid is already C.card, so the keys need the darker ground to read
     as separate controls rather than dissolving into it. */
  background: ${C.bg};
  border: 1px solid ${C.border};
  font: inherit;
  font-size: 17px;
  padding: 12px 0;
  color: ${C.textSub};
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}
.lp-root .lp-keygrid--live .lp-key:hover { border-color: ${C.accent}; color: ${C.text}; }
.lp-root .lp-keygrid--live .lp-key--on {
  background: ${C.accent};
  border-color: ${C.accent};
  color: #06232A;
}

@media (max-width: 900px) {
  .lp-keygrid--live { grid-template-columns: repeat(6, 1fr); }
}

.lp-lab__out {
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid ${C.border};
  display: flex; flex-direction: column; gap: 14px;
}
/* Centred, unlike the labels above it: this is the read-out the section is about, and a
   fifteen-cell row that starts at the left edge and stops two thirds across reads as a list
   that ran out rather than as a phrase. The label stays left-aligned with every other label
   on the page. */
.lp-lab__cells {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 6px;
  margin: 0; padding: 0; list-style: none;
}
.lp-lab__cell {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-width: 44px;
  padding: 10px 8px;
  border-radius: 8px;
  background: ${C.bg};
}
.lp-lab__tab { font-size: 22px; letter-spacing: 0.04em; color: ${C.accent}; line-height: 1.1; }
.lp-lab__tab--dead { color: ${C.textMuted}; }
.lp-lab__note { font-size: 13px; color: ${C.textMuted}; line-height: 1.1; }
.lp-lab__verdict { margin-top: 22px !important; font-size: 15px; color: ${C.textSub}; }

@media (max-width: 900px) {
  .lp-lab { padding: 20px; }
  .lp-lab__controls { gap: 24px; }
  .lp-lab__row { flex-direction: column; gap: 8px; }
}
`;
