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

export function getFrames(recordingId: string): RawFrame[] {
  return buffers.get(recordingId) ?? [];
}

export function clearFrames(recordingId: string): void {
  buffers.delete(recordingId);
  const i = order.indexOf(recordingId);
  if (i !== -1) order.splice(i, 1);
}
