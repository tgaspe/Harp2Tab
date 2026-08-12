// Shared by the (native) export screen and the web toolbar's inline export dropdown —
// both need to turn generated file content into a browser download on web.
export function contentToBlob(content: string, encoding: 'utf8' | 'base64', mimeType: string): Blob {
  return encoding === 'base64'
    ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: mimeType })
    : new Blob([content], { type: mimeType });
}

export function triggerWebDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fallback stem for a tab that hasn't been named — the old hard-coded filename, kept so an
 *  unnamed export lands where users are used to finding it. */
const UNTITLED_EXPORT_STEM = 'harp2tab_export';

/**
 * The file an export should be written as, named after the tab the user named.
 *
 * Sanitising is aggressive on purpose — one rule that produces a filename safe for the
 * Storage Access Framework, a `download` attribute and a share sheet alike, rather than
 * three platform-specific rules that would let a title with a slash in it fail on exactly
 * one of them. `.slice(60)` matches the Studio's MIDI download for the same reason.
 */
export function exportFileName(title: string, ext: string): string {
  const stem = title.trim().replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `${stem || UNTITLED_EXPORT_STEM}.${ext}`;
}

/**
 * Can this browser actually hand a file to a share sheet?
 *
 * Desktop Chrome and Firefox expose `navigator.share` but refuse files, so a Share button
 * there silently degrades into a second Download button — which is what it did until this
 * check existed. Probes with a real (empty) `File`, because `canShare({ files })` inspects
 * the array's contents; there is no way to ask the question in the abstract.
 *
 * Safe to call during render: unlike `share()`, `canShare()` needs no user activation.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([], 'probe.txt', { type: 'text/plain' })] });
  } catch {
    return false;
  }
}
