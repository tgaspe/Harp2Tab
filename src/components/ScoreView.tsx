/**
 * Native stand-in for the Score view.
 *
 * The renderer is OpenSheetMusicDisplay, a DOM library that writes SVG, and native has no
 * DOM to write into — the same reason Phase 17 shipped audio export web-only. The Score
 * segment is not offered on native at all, so this is never reached in practice; it exists
 * because `edit.tsx` imports the component unconditionally and Metro needs something to
 * resolve for a native build.
 *
 * When native gains a score view it will not be by making this file wrap a WebView. The
 * option worth pricing first is rendering `ScoreDocument` straight to `react-native-svg`,
 * which is already a dependency and would give both platforms one renderer.
 */

import type { RhythmMode } from '@/notation/scoreDocument';
import type { Theme } from '@/theme';
import type { HarmonicaKey, HarmonicaType, TabNote } from '@/types';

export interface ScoreViewProps {
  notes:          TabNote[];
  harmonicaKey:   HarmonicaKey | null;
  harmonicaType:  HarmonicaType;
  bpm:            number;
  /** The tab's own name, engraved as the score's title. Empty falls back to the generated
   *  `Harp2Tab -- Key of C`, which is what an unnamed tab exports under too. */
  title:          string;
  selectedId:     string | null;
  /** Only ever called with a real id — a click either lands on a notehead or on the page. */
  onSelect:       (id: string) => void;
  playingNoteId:  string | null;
  onSeek:         (ms: number) => void;
  theme:          Theme;
  rhythmMode:     RhythmMode;
  onRhythmMode:   (mode: RhythmMode) => void;
  showTabs:       boolean;
  onShowTabs:     (show: boolean) => void;
}

export function ScoreView(_props: ScoreViewProps) {
  return null;
}
