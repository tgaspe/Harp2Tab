/**
 * Native stub — see `DropOverlay.web.tsx`. Nothing can be dragged onto a React Native
 * screen from outside the app, so there is no state for this to draw. Split by filename
 * rather than branched so the web markup never enters the native bundle, matching
 * `TopBar`/`TopBar.web` and `useFileDrop`.
 */

export function DropOverlay(_props: { visible: boolean }) {
  return null;
}
