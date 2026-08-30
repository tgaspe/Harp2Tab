/**
 * The score-export contract, a third family beside `ExportFormat` and `AudioExportFormat`.
 *
 * It is separate for the same reason audio is. `generateForFormat` returns
 * `{ content: string; encoding }` — one string, one file. A rendered score is binary (PDF,
 * PNG) and can be *several* files, because a long piece paginates. Widening `ExportFormat`
 * to hold that would put an unwritable case in every text generator, and would change what
 * the native export screen offers to save — a screen that cannot render a score at all.
 *
 * Web-only: the renderer is OpenSheetMusicDisplay, a DOM library. Native has nothing to
 * engrave into, exactly as it has no `OfflineAudioContext` for audio export.
 */

export type ScoreExportFormat = 'SVG' | 'PDF' | 'PNG';

/** The order they appear in the export popup's Score section. */
export const SCORE_EXPORT_FORMATS: ScoreExportFormat[] = ['SVG', 'PDF', 'PNG'];

export const SCORE_FORMAT_META: Record<
  ScoreExportFormat,
  { label: string; description: string; icon: string }
> = {
  SVG: { label: 'SVG', description: 'Sheet music as vector art, scales to any size', icon: 'shapes-outline' },
  PDF: { label: 'PDF', description: 'Opens your print dialog — choose "Save as PDF"',  icon: 'document-outline' },
  PNG: { label: 'PNG', description: 'Sheet music as an image, for sharing',          icon: 'image-outline' },
};

export const SCORE_FORMAT_FILE: Record<ScoreExportFormat, { ext: string; mimeType: string }> = {
  SVG: { ext: 'svg', mimeType: 'image/svg+xml' },
  PDF: { ext: 'pdf', mimeType: 'application/pdf' },
  PNG: { ext: 'png', mimeType: 'image/png' },
};

/**
 * Pixel scale offered for PNG.
 *
 * 2× is the default rather than 1×: a score rasterised at CSS pixel size is legible on
 * screen and mushy the moment anyone prints it or opens it on a retina display, which is
 * most of what a shared image gets used for.
 */
export const PNG_SCALES = [1, 2, 3] as const;
export type PngScale = (typeof PNG_SCALES)[number];
export const DEFAULT_PNG_SCALE: PngScale = 2;

export function isScoreFormat(id: string): id is ScoreExportFormat {
  return (SCORE_EXPORT_FORMATS as string[]).includes(id);
}
