/**
 * Turning the engraved score into files.
 *
 * The rule this module exists to keep is that the file and the preview are the *same score*.
 * Both are made from one `ScoreDocument` at the same rhythm mode and tab setting, and the
 * PNG is a rasterisation of the very SVG that gets exported — never a screenshot of the
 * editor, which would carry the app's chrome, the selection highlight and the playhead into
 * what is supposed to be sheet music.
 *
 * Engraving happens in an offscreen host rather than in the view: the view is a continuous
 * scrolling page, and an export is paginated to paper. Rendering the export from the view's
 * own DOM would mean either exporting one impossibly tall page or re-laying-out the thing the
 * user is looking at.
 */

import { createScoreRenderer, type ScorePageFormat } from '@/notation/render/osmd.web';
import type { ScoreDocument } from '@/notation/scoreDocument';
import { SCORE_FORMAT_FILE, type PngScale, type ScoreExportFormat } from '@/export/scoreFormats';

export interface ScoreExportOptions {
  showTabs:    boolean;
  pageFormat:  ScorePageFormat;
  /** PNG only. */
  scale?:      PngScale;
  /** PNG only: a white page rather than a transparent one, which is what sheet music is. */
  background?: string;
}

export interface ScoreExportFile {
  blob:     Blob;
  /** Without the dot. */
  ext:      string;
  mimeType: string;
  /** 1-based, for the filename. Absent when the score came out as a single page. */
  page?:    number;
}

export type ScoreExportStage = 'engraving' | 'rasterising' | 'packaging';

/**
 * Engrave off-screen and hand the pages back as SVG markup.
 *
 * The host is attached to the document rather than detached: OSMD measures what it draws, and
 * an element outside the document tree has no measurements to give. It is positioned away
 * from the viewport instead, and removed in a `finally` so a throw mid-engrave cannot leave a
 * stray page behind.
 */
async function engravePages(
  doc: ScoreDocument,
  options: ScoreExportOptions,
): Promise<string[]> {
  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.left     = '-10000px';
  host.style.top      = '0';
  host.style.width    = '1000px';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);

  try {
    const renderer = await createScoreRenderer(host);
    try {
      await renderer.render(doc, {
        showTabs:   options.showTabs,
        pageFormat: options.pageFormat,
      });
      const pages = renderer.svgPages();
      if (pages.length === 0) throw new Error('The score engraved to nothing.');
      return pages;
    } finally {
      renderer.dispose();
    }
  } finally {
    host.remove();
  }
}

/**
 * One SVG page as a PNG.
 *
 * The SVG is handed to the browser as a data URL rather than a blob URL because an `<img>`
 * loading an SVG is a hard sandbox: it will not fetch anything the markup refers to. That is
 * survivable here only because OSMD draws its glyphs as outlines — there is no music font to
 * go missing. See `scripts/spike-osmd.ts`, which asserts exactly that.
 */
function rasterise(svg: string, scale: number, background: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      // Fall back to the natural size when the markup carries no explicit dimensions.
      const width  = image.naturalWidth  || 1000;
      const height = image.naturalHeight || 1400;
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(width * scale);
      canvas.height = Math.round(height * scale);

      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('This browser would not give us a canvas to draw on.')); return; }
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The page could not be turned into an image.'));
      }, 'image/png');
    };
    image.onerror = () => reject(new Error('The engraved page could not be rasterised.'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * A standalone SVG document.
 *
 * OSMD's `outerHTML` comes out of an HTML tree, so it carries no XML declaration and may be
 * missing the namespace a standalone file needs to be opened by anything but a browser.
 */
function standaloneSvg(svg: string): string {
  const namespaced = svg.includes('xmlns=')
    ? svg
    : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${namespaced}`;
}

/**
 * SVG and PNG, as one file per engraved page.
 *
 * PDF is not here: it is not a file this can build without a PDF library, and it goes through
 * the browser's own print pipeline instead — see `printScore`.
 */
export async function exportScore(
  doc: ScoreDocument,
  format: Exclude<ScoreExportFormat, 'PDF'>,
  options: ScoreExportOptions,
  onStage?: (stage: ScoreExportStage) => void,
): Promise<ScoreExportFile[]> {
  onStage?.('engraving');
  const pages = await engravePages(doc, options);
  const { ext, mimeType } = SCORE_FORMAT_FILE[format];
  const multiple = pages.length > 1;

  if (format === 'SVG') {
    return pages.map((svg, i) => ({
      blob:     new Blob([standaloneSvg(svg)], { type: mimeType }),
      ext,
      mimeType,
      ...(multiple ? { page: i + 1 } : {}),
    }));
  }

  onStage?.('rasterising');
  const scale      = options.scale ?? 2;
  const background = options.background ?? '#ffffff';
  const files: ScoreExportFile[] = [];
  for (const [i, svg] of pages.entries()) {
    files.push({
      blob:     await rasterise(standaloneSvg(svg), scale, background),
      ext,
      mimeType,
      ...(multiple ? { page: i + 1 } : {}),
    });
  }
  return files;
}

/**
 * PDF, through the browser's print dialog.
 *
 * Deliberately not a generated file. Producing a real PDF here would mean adding a PDF
 * library to draw an SVG that the browser can already lay out and print perfectly — and the
 * print path gets page size, margins and the user's own paper choice for free. The cost is
 * honest and has to be said in the UI: this opens a print dialog where the user chooses
 * "Save as PDF", it does not drop a file in Downloads.
 *
 * A same-origin iframe rather than a popup window: popups are blocked by default and would
 * make the export fail for reasons that have nothing to do with the score.
 */
export async function printScore(
  doc: ScoreDocument,
  options: ScoreExportOptions,
  onStage?: (stage: ScoreExportStage) => void,
): Promise<void> {
  onStage?.('engraving');
  const pages = await engravePages(doc, options);

  onStage?.('packaging');
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right    = '0';
  frame.style.bottom   = '0';
  frame.style.width    = '0';
  frame.style.height   = '0';
  frame.style.border   = '0';
  document.body.appendChild(frame);

  const win = frame.contentWindow;
  const frameDoc = frame.contentDocument;
  if (!win || !frameDoc) {
    frame.remove();
    throw new Error('This browser would not open a print view.');
  }

  frameDoc.open();
  frameDoc.write(`<!doctype html><html><head><title>${doc.title}</title><style>
    @page { margin: 12mm; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .page { page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    svg { width: 100%; height: auto; }
  </style></head><body>${
    pages.map((svg) => `<div class="page">${svg}</div>`).join('')
  }</body></html>`);
  frameDoc.close();

  // One frame for layout before printing, or Safari prints a blank sheet.
  await new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
  win.focus();
  win.print();

  // The print dialog is modal but `print()` returns immediately in some browsers, so the
  // frame is kept alive briefly rather than pulled out from under the dialog.
  setTimeout(() => frame.remove(), 60_000);
}
