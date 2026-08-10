/**
 * Hand-off slot between whatever produced some audio and the `/import` screen that
 * transcribes it. Neither of the two things that arrive here can travel through router
 * params: a picked file is a live DOM `File` on web, and a retained take is a multi-megabyte
 * `Float32Array`.
 *
 * The pick deliberately happens at the button press, not on the import screen: browsers
 * only open a file dialog during a real user gesture, so opening it from a screen's mount
 * effect would be blocked. The same is true in spirit of a take — it exists only in the
 * capture module's buffer, and only until something reads it.
 *
 * Two variants, and the difference between them is *when the engine was chosen*:
 *
 *  - `file` carries no choice. A file import has no earlier moment to ask, so `/import`
 *    opens on the picker.
 *  - `decoded` carries one. The recording screen asks on Finish, where the user is still
 *    with the take they just played, so `/import` must not ask a second time.
 */

import type { ParamValues, TranscriptionAlgorithmId } from './algorithms';
import type { DecodedAudio, PickedAudioFile } from './audioImport';

export type PendingImport =
  | { kind: 'file'; picked: PickedAudioFile }
  | {
      kind:      'decoded';
      audio:     DecodedAudio;
      /** Library title for whatever this becomes. A take has no filename to fall back on. */
      title:     string;
      /** The take hit the retention cap and ends early. Said, never silently swallowed. */
      truncated: boolean;
      algorithm: TranscriptionAlgorithmId;
      params:    ParamValues;
    };

let pending: PendingImport | null = null;

export function setPendingImport(file: PickedAudioFile): void {
  pending = { kind: 'file', picked: file };
}

export function setPendingDecodedImport(
  entry: Omit<Extract<PendingImport, { kind: 'decoded' }>, 'kind'>,
): void {
  pending = { kind: 'decoded', ...entry };
}

/** Non-consuming read — the import screen may mount its effect more than once (React
 *  strict mode), and a read that cleared the slot would lose the audio on the second run. */
export function getPendingImport(): PendingImport | null {
  return pending;
}

/** The name to show while this is being worked on — a filename, or a take's title. */
export function pendingImportName(entry: PendingImport | null): string {
  if (!entry) return '';
  return entry.kind === 'file' ? entry.picked.name : entry.title;
}

export function clearPendingImport(): void {
  pending = null;
}
