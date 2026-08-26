/**
 * A file that arrived by drag-and-drop: which import path it belongs to, and how to hand it
 * to the same machinery a picked file goes through.
 *
 * Kept apart from `hooks/useFileDrop.web` because none of this needs the DOM. Given a name
 * and a MIME type it decides a route, and that decision is the only part of the drop path
 * worth reasoning about without a browser in front of you.
 *
 * The pickers need nothing like this. A picked file *came from* the audio picker or the MIDI
 * picker, so which button the user pressed already is the classification. A drop has no
 * button, so the file itself has to say what it is.
 */

import { type PickedAudioFile } from './audioImport';

export type DroppedFileKind = 'audio' | 'midi' | 'unsupported';

// Extension first, MIME second — the same inconsistency `pickMidiFile` documents, seen from
// the other side. Browsers routinely report a .mid as application/octet-stream (and Safari
// as an empty string), so a MIME-led rule would send perfectly good MIDI down the audio
// decoder, where it fails as "couldn't be decoded" instead of parsing.
const MIDI_EXTENSIONS  = ['.mid', '.midi'];
// Everything `decodeAudioData` can be expected to handle. Deliberately excludes .mp4: the
// browser can often pull audio out of one, but offering a video container as a supported
// drop invites files whose failure mode we'd rather not explain.
const AUDIO_EXTENSIONS = [
  '.wav', '.wave', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.webm',
  '.aiff', '.aif',
];

const MIDI_MIME_TYPES = ['audio/midi', 'audio/x-midi', 'audio/mid', 'audio/sp-midi'];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * A dropped folder reaches `dataTransfer.files` as a single entry with no extension and no
 * MIME type, so it lands in `unsupported` on its own — no directory check needed.
 */
export function classifyDroppedFile(name: string, mimeType?: string | null): DroppedFileKind {
  const ext  = extensionOf(name);
  const mime = (mimeType ?? '').toLowerCase();

  if (MIDI_EXTENSIONS.includes(ext) || MIDI_MIME_TYPES.includes(mime)) return 'midi';
  if (AUDIO_EXTENSIONS.includes(ext) || mime.startsWith('audio/'))     return 'audio';
  return 'unsupported';
}

/** Names the file *and* the extension: "that isn't supported" leaves the user guessing which
 *  of the things they dropped was the problem, and what would have worked instead. */
export function unsupportedFileMessage(name: string): string {
  const ext = extensionOf(name);
  return ext
    ? `${ext} files can't be imported. Drop an audio file (WAV, MP3, M4A) or a MIDI file.`
    : `"${name}" isn't an audio or MIDI file.`;
}

/**
 * DOM `File` → the shape the rest of the import path already speaks.
 *
 * `uri` is empty on purpose. `readFileBytes.web` reads `picked.file` first and only falls
 * back to fetching the uri — a fallback its comment already reserved for "a future
 * drag-and-drop zone" — so a dropped file needs no blob: url invented for it.
 *
 * Typed structurally rather than as `File` to keep this module DOM-free, matching how
 * `PickedAudioFile.file` is itself typed as `unknown`.
 */
export function toPickedFile(file: { name: string; type?: string; size?: number }): PickedAudioFile {
  return {
    name:     file.name,
    uri:      '',
    mimeType: file.type || null,
    size:     file.size ?? null,
    file,
  };
}
