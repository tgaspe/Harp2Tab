/**
 * Hand-off slot between the entry point that picks a file and the `/import` screen that
 * processes it. A picked file can't travel through router params — on web it's a live DOM
 * `File` object, not a serializable value.
 *
 * The pick deliberately happens at the button press, not on the import screen: browsers
 * only open a file dialog during a real user gesture, so opening it from a screen's mount
 * effect would be blocked.
 */

import type { PickedAudioFile } from './audioImport';

let pending: PickedAudioFile | null = null;

export function setPendingImport(file: PickedAudioFile): void {
  pending = file;
}

/** Non-consuming read — the import screen may mount its effect more than once (React
 *  strict mode), and a read that cleared the slot would lose the file on the second run. */
export function getPendingImport(): PickedAudioFile | null {
  return pending;
}

export function clearPendingImport(): void {
  pending = null;
}
