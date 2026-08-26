/**
 * Native half of the drop hook — see `useFileDrop.web.ts` for the real one.
 *
 * Split by filename rather than branched on `Platform.OS` for the same reason as
 * `TopBar`/`TopBar.web`: the web version reaches for `window` and `DragEvent` at module
 * scope, and neither exists in the native bundle. There is no OS-level drop target for a
 * React Native screen to attach to, so this reports "never dragging" and costs nothing.
 */

export interface FileDropOptions {
  onFiles:  (files: File[]) => void;
  enabled?: boolean;
}

export function useFileDrop(_options: FileDropOptions): { dragging: boolean } {
  return { dragging: false };
}
