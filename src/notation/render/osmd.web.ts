/**
 * OpenSheetMusicDisplay, wrapped so the rest of the app never imports it.
 *
 * Web only, by the same reasoning that made audio export web-only in Phase 17: OSMD is a DOM
 * library that writes SVG, and native has no DOM to write into. The Score view is not
 * rendered on native at all rather than being rendered badly there.
 *
 * Everything here was established by `scripts/spike-osmd.ts`, which is the regression gate if
 * any of it stops working:
 *
 *  - OSMD is reached through `await import()`. It is a single 1.3 MB UMD bundle, and the web
 *    app already carries Basic Pitch and a soundfont — it must not be in the entry chunk.
 *  - The link back to the editor is a *musical position* join, not an id smuggled into the
 *    MusicXML. OSMD reports where each note sits in whole notes; the score document knows
 *    what it wrote at every tick; both came from the same build, so the join is exact and the
 *    exported file stays a clean interchange file with no private attributes in it.
 *  - Tie continuations are in that map too. A tie is one note drawn as two noteheads, and a
 *    map of attacks only leaves the second half of every held note dead to the pointer.
 *  - Selection and playback highlighting are attribute writes on notes OSMD already drew.
 *    Neither re-engraves.
 */

import {
  TICKS_PER_QUARTER, type ScoreDocument,
} from '@/notation/scoreDocument';
import { scoreToMusicXml } from '@/notation/musicXml';

/** What a click on the page reports back: everything the editor needs to select and seek. */
export interface ScoreNoteHit {
  sourceIds: string[];
  tick:      number;
}

/** OSMD's page-format names. `undefined` keeps the continuous page the view scrolls. */
export type ScorePageFormat = 'A4_P' | 'A4_L' | 'Letter_P' | 'Letter_L';

export interface ScoreRenderOptions {
  showTabs?:   boolean;
  /** Paginate to a paper size. The view leaves this off and scrolls one long page; the
   *  exports set it, which is what makes a multi-page score come out as multiple pages
   *  rather than one impossibly tall one. */
  pageFormat?: ScorePageFormat;
}

export interface ScoreRenderer {
  /** Engrave a document. Safe to call repeatedly; each call replaces what was drawn. */
  render(doc: ScoreDocument, options?: ScoreRenderOptions): Promise<void>;
  /** The engraved page as standalone SVG markup, or null before the first render. */
  svgString(): string | null;
  /** Every engraved page's SVG markup. One entry unless a page format was set. */
  svgPages(): string[];
  /** Tint the notes belonging to these source ids. Passing none clears the tint. */
  highlight(sourceIds: readonly string[], color: string): void;
  /** Called when the reader clicks a notehead. */
  onNoteClick(handler: (hit: ScoreNoteHit) => void): void;
  dispose(): void;
}

/** A websafe stack for the title, tempo mark and tab lyrics — the only text OSMD draws.
 *  The notation glyphs are outlines and need no font at all, which is what lets an exported
 *  SVG stand on its own. */
const TEXT_FONT = 'Helvetica, Arial, sans-serif';

/** Elements whose colour a highlight overwrites, and which it has to restore afterwards. */
const PAINTED = 'path, rect, text, ellipse, polygon';

interface Painted { el: Element; fill: string | null; stroke: string | null }

export async function createScoreRenderer(host: HTMLElement): Promise<ScoreRenderer> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');

  const osmd = new OpenSheetMusicDisplay(host, {
    backend:           'svg',
    drawTitle:         true,
    drawLyrics:        true,
    autoResize:        false,
    defaultFontFamily: TEXT_FONT,
  });

  /** Every drawn note, by the source ids it stands for. */
  let byId = new Map<string, Element[]>();
  /** Every drawn note's SVG group, so a click can be resolved by walking up from its target. */
  let hits: { el: Element; hit: ScoreNoteHit }[] = [];
  let painted: Painted[] = [];
  let clickHandler: ((hit: ScoreNoteHit) => void) | null = null;

  /**
   * Rebuild the two lookups from what OSMD just drew.
   *
   * Rests are skipped: they have a position but nothing to select, and a click on one should
   * fall through to the page rather than select the note before it.
   */
  function index(doc: ScoreDocument): void {
    byId = new Map();
    hits = [];

    const idsAtTick = new Map<number, string[]>();
    let tick = 0;
    for (const measure of doc.parts[0]?.measures ?? []) {
      for (const element of measure.elements) {
        if (element.sourceIds.length > 0) idsAtTick.set(tick, element.sourceIds);
        tick += element.durationTicks;
      }
    }

    for (const staffMeasures of osmd.GraphicSheet?.MeasureList ?? []) {
      for (const measure of staffMeasures ?? []) {
        for (const entry of measure?.staffEntries ?? []) {
          for (const voiceEntry of entry.graphicalVoiceEntries ?? []) {
            for (const note of voiceEntry.notes ?? []) {
              const source = note.sourceNote;
              if (!source || source.isRest()) continue;

              const at = Math.round(
                source.getAbsoluteTimestamp().RealValue * 4 * TICKS_PER_QUARTER,
              );
              const sourceIds = idsAtTick.get(at);
              if (!sourceIds) continue;

              const el = (note as unknown as { getSVGGElement?: () => Element | undefined })
                .getSVGGElement?.();
              if (!el) continue;

              hits.push({ el, hit: { sourceIds, tick: at } });
              for (const id of sourceIds) {
                const list = byId.get(id);
                if (list) list.push(el);
                else byId.set(id, [el]);
              }
            }
          }
        }
      }
    }
  }

  function onClick(event: Event): void {
    if (!clickHandler) return;
    let node = event.target as Element | null;
    while (node && node !== host) {
      const found = hits.find((h) => h.el === node);
      if (found) { clickHandler(found.hit); return; }
      node = node.parentElement;
    }
  }

  host.addEventListener('click', onClick);

  return {
    async render(doc, options) {
      // A tab under every note is the default, but it is the one thing on the page a reader
      // may want out of the way — a notation-only score is what gets printed for someone who
      // doesn't play harmonica.
      osmd.setOptions({ drawLyrics: options?.showTabs !== false });
      await osmd.load(scoreToMusicXml(doc));
      // Set after load: OSMD applies the page format during layout, and setting it on an
      // instance with no sheet loaded throws.
      osmd.setPageFormat(options?.pageFormat ?? 'Endless');
      osmd.render();
      painted = [];
      index(doc);
    },

    svgString() {
      return host.querySelector('svg')?.outerHTML ?? null;
    },

    svgPages() {
      return [...host.querySelectorAll('svg')].map((el) => el.outerHTML);
    },

    highlight(sourceIds, color) {
      // Restore first: a highlight is a moving thing, and repainting over the last one
      // without putting it back leaves a trail of coloured notes behind the playhead.
      for (const { el, fill, stroke } of painted) {
        if (fill === null) el.removeAttribute('fill'); else el.setAttribute('fill', fill);
        if (stroke === null) el.removeAttribute('stroke'); else el.setAttribute('stroke', stroke);
      }
      painted = [];

      for (const id of sourceIds) {
        for (const group of byId.get(id) ?? []) {
          for (const el of group.querySelectorAll(PAINTED)) {
            painted.push({
              el,
              fill:   el.getAttribute('fill'),
              stroke: el.getAttribute('stroke'),
            });
            // Only what was already painted is repainted, so an element drawn with no fill
            // (a stem's stroke, say) doesn't gain one and turn into a blob.
            if (el.getAttribute('fill')) el.setAttribute('fill', color);
            if (el.getAttribute('stroke')) el.setAttribute('stroke', color);
          }
        }
      }
    },

    onNoteClick(handler) {
      clickHandler = handler;
    },

    dispose() {
      host.removeEventListener('click', onClick);
      clickHandler = null;
      byId = new Map();
      hits = [];
      painted = [];
      try {
        osmd.clear();
      } catch {
        // A container already torn out from under it — nothing left to clear, and throwing
        // here would take down an unmount that has otherwise succeeded.
      }
    },
  };
}
