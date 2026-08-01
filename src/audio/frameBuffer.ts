/**
 * In-memory retention of raw pitch/loudness frames, keyed by recordingId — feeds Frame
 * Inspector. Deliberately standalone (not inside useAudioCapture.ts): the live mic hook
 * is only one of the pipelines that will push into this (a future file-upload decode path
 * needs the same buffer without going through that hook at all), so any pipeline can just
 * call pushFrame(recordingId, frame) regardless of where its frames come from.
 *
 * This is only the fast-path cache for the session currently being recorded/edited —
 * bounded so it doesn't grow unbounded across a long app session. The durable copy lives
 * on `TabRecording.frames` (persisted via useRecordingsStore) once a session is saved;
 * Frame Inspector reads from here first and falls back to that persisted copy.
 */

import type { RawFrame } from '@/types';
export type { RawFrame }; // re-exported so existing `from '@/audio/frameBuffer'` imports keep working

const MAX_BUFFERED_SESSIONS = 5;

const buffers = new Map<string, RawFrame[]>();
const order: string[] = []; // insertion order, oldest first, for eviction

export function pushFrame(recordingId: string, frame: RawFrame): void {
  let arr = buffers.get(recordingId);
  if (!arr) {
    arr = [];
    buffers.set(recordingId, arr);
    order.push(recordingId);
    if (order.length > MAX_BUFFERED_SESSIONS) {
      const evictId = order.shift()!;
      buffers.delete(evictId);
    }
  }
  arr.push(frame);
}

/** Bulk sibling of pushFrame — the file-import path produces a session's entire frame
 *  stream at once rather than one frame at a time like live capture does. */
export function pushFrames(recordingId: string, frames: RawFrame[]): void {
  for (const frame of frames) pushFrame(recordingId, frame);
}

export function getFrames(recordingId: string): RawFrame[] {
  return buffers.get(recordingId) ?? [];
}

/**
 * Frames are persisted with the recording (TabRecording.frames, via AsyncStorage), and an
 * uploaded file can be minutes long — ~1,300 frames per minute at the ~46ms frame rate,
 * where a typical live take is a few hundred. Thin long sessions out with an even stride
 * so a library of imports can't blow past AsyncStorage's size ceiling. Frame Inspector
 * draws a timeline, not a sample-accurate readout, so an evenly thinned stream costs it
 * nothing at these lengths — and short sessions are untouched.
 */
const MAX_PERSISTED_FRAMES = 2000;

export function decimateFrames(frames: RawFrame[], max = MAX_PERSISTED_FRAMES): RawFrame[] {
  if (frames.length <= max) return frames;
  const stride = frames.length / max;
  const thinned: RawFrame[] = new Array(max);
  for (let i = 0; i < max; i++) thinned[i] = frames[Math.floor(i * stride)];
  return thinned;
}

export function clearFrames(recordingId: string): void {
  buffers.delete(recordingId);
  const i = order.indexOf(recordingId);
  if (i !== -1) order.splice(i, 1);
}
