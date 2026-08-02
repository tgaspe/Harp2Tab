/**
 * Standard MIDI File read/write for whole multi-track projects.
 *
 * This is the persistence format for a `MidiProject`, not just an export target. A project
 * re-serialized to SMF is a few KB where the same content as expanded JSON note arrays is
 * tens to hundreds — and unlike `RawFrame[]`, which Phase 5 could decimate on save
 * (`sessionSnapshot.ts`), a project's notes *are* the document and can't be thinned.
 *
 * Reading goes through `@tonejs/midi` (already a dependency) because resolving a tempo map
 * and PPQ into absolute times has real edge cases. Writing is by hand: `@tonejs/midi`'s
 * writer would make the round-trip test tautological, since it would be the same library
 * checking itself.
 */

import { Midi } from '@tonejs/midi';
import {
  compileTempoMap,
  msToBeat,
  type TempoEvent,
  type TempoMap,
  type TimeSignatureEvent,
} from './tempo';

export const DEFAULT_PPQ = 480;

/** Default velocity for a note that doesn't state one — matches the value the app's own
 *  single-track MIDI export has always written (`generators.ts`). */
export const DEFAULT_VELOCITY = 80;

export interface SmfNote {
  midi:       number;
  timeMs:     number;
  durationMs: number;
  /** 0–127, MIDI's own scale (note that `@tonejs/midi` normalises to 0–1 — converted on
   *  the way in and out so nothing downstream has to remember which convention applies). */
  velocity?:  number;
}

export interface SmfTrack {
  name?:    string;
  /** General MIDI program number, 0–127. */
  program?: number;
  /** 0-based MIDI channel. 9 is percussion. */
  channel?: number;
  notes:    readonly SmfNote[];
}

export interface SmfData {
  tracks:         SmfTrack[];
  tempos:         TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  durationMs:     number;
}

// ── Writing ───────────────────────────────────────────────────────────────────

function vlq(value: number): number[] {
  const clamped = Math.max(0, Math.round(value));
  if (clamped === 0) return [0];
  const bytes: number[] = [clamped & 0x7f];
  let rest = clamped >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

function bigEndian(value: number, width: number): number[] {
  return Array.from({ length: width }, (_, i) => (value >> (8 * (width - 1 - i))) & 0xff);
}

function chunk(type: string, body: number[]): number[] {
  return [
    ...Array.from(type, (c) => c.charCodeAt(0)),
    ...bigEndian(body.length, 4),
    ...body,
  ];
}

function textMeta(type: number, text: string): number[] {
  // Non-ASCII would need a multi-byte length, and a track name isn't worth a UTF-8 encoder
  // here — anything outside ASCII is dropped rather than corrupting the byte count.
  const bytes = Array.from(text)
    .map((c) => c.charCodeAt(0))
    .filter((c) => c > 0 && c < 128)
    .slice(0, 127);
  return [0xff, type, ...vlq(bytes.length), ...bytes];
}

/** Absolute-tick event, flattened before delta encoding. */
interface TickEvent {
  tick:  number;
  /** Meta before note-off before note-on at the same tick, so a note ending exactly where
   *  the next begins doesn't read back as an overlap. */
  order: number;
  bytes: number[];
}

const ORDER_META = 0;
const ORDER_OFF  = 1;
const ORDER_ON   = 2;

function toDeltaEncoded(events: TickEvent[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out: number[] = [];
  let cursor = 0;
  for (const e of events) {
    out.push(...vlq(e.tick - cursor), ...e.bytes);
    cursor = e.tick;
  }
  out.push(0, 0xff, 0x2f, 0x00); // end of track
  return out;
}

/** log2 of the denominator, which is how SMF encodes it: 4 → 2, 8 → 3. */
function denominatorPower(denominator: number): number {
  return Math.max(0, Math.round(Math.log2(Math.max(1, denominator))));
}

export function writeSmf(
  tracks: readonly SmfTrack[],
  tempos: readonly TempoEvent[] = [],
  timeSignatures: readonly TimeSignatureEvent[] = [],
  ppq: number = DEFAULT_PPQ,
): Uint8Array {
  const map = compileTempoMap(tempos, timeSignatures);
  const msToTicks = (ms: number) => Math.round(msToBeat(map, ms) * ppq);

  // Conductor track — tempo and meter only, per SMF format 1 convention. Compiled segments
  // rather than the raw arrays, so the normalisation `compileTempoMap` applies (an implied
  // event at 0, duplicates collapsed) is what actually gets written.
  const conductor: TickEvent[] = [];
  for (const seg of map.tempos) {
    const microsPerQuarter = Math.round(60_000_000 / seg.bpm);
    conductor.push({
      tick:  msToTicks(seg.startMs),
      order: ORDER_META,
      bytes: [0xff, 0x51, 0x03, ...bigEndian(microsPerQuarter, 3)],
    });
  }
  for (const seg of map.meters) {
    conductor.push({
      tick:  Math.round(seg.startBeat * ppq),
      order: ORDER_META,
      // cc = MIDI clocks per metronome click, bb = 32nds per quarter; 24 and 8 are the
      // universal defaults and nothing in this app varies them.
      bytes: [0xff, 0x58, 0x04, seg.numerator, denominatorPower(seg.denominator), 24, 8],
    });
  }

  const trackChunks: number[][] = [chunk('MTrk', toDeltaEncoded(conductor))];

  for (const track of tracks) {
    const channel = Math.max(0, Math.min(15, track.channel ?? 0));
    const events: TickEvent[] = [];

    if (track.name) events.push({ tick: 0, order: ORDER_META, bytes: textMeta(0x03, track.name) });
    if (track.program !== undefined) {
      events.push({
        tick:  0,
        order: ORDER_META,
        bytes: [0xc0 | channel, Math.max(0, Math.min(127, Math.round(track.program)))],
      });
    }

    for (const note of track.notes) {
      const pitch    = Math.max(0, Math.min(127, Math.round(note.midi)));
      const velocity = Math.max(1, Math.min(127, Math.round(note.velocity ?? DEFAULT_VELOCITY)));
      const onTick   = msToTicks(note.timeMs);
      // A note that rounds to zero ticks would emit note-on and note-off at the same tick
      // and vanish on read-back; one tick is the shortest thing that survives.
      const offTick  = Math.max(onTick + 1, msToTicks(note.timeMs + note.durationMs));
      events.push({ tick: onTick,  order: ORDER_ON,  bytes: [0x90 | channel, pitch, velocity] });
      events.push({ tick: offTick, order: ORDER_OFF, bytes: [0x80 | channel, pitch, 0] });
    }

    trackChunks.push(chunk('MTrk', toDeltaEncoded(events)));
  }

  const header = chunk('MThd', [
    ...bigEndian(1, 2),                    // format 1 — multi-track, shared timeline
    ...bigEndian(trackChunks.length, 2),
    ...bigEndian(ppq, 2),
  ]);

  return new Uint8Array([...header, ...trackChunks.flat()]);
}

// ── Reading ───────────────────────────────────────────────────────────────────

/**
 * Parse SMF bytes faithfully — every track, including empty and percussion ones.
 *
 * Deliberately *not* `parseMidiFile`, which filters and reshapes for tab import (drops
 * percussion, drops note-less tracks, derives melody hints). A project round-trip has to
 * return what it was given.
 */
export function readSmf(bytes: Uint8Array): SmfData {
  const midi = new Midi(bytes);
  const header = midi.header;

  const tempos: TempoEvent[] = header.tempos.map((t) => ({
    timeMs: header.ticksToSeconds(t.ticks) * 1000,
    bpm:    t.bpm,
  }));

  const timeSignatures: TimeSignatureEvent[] = header.timeSignatures.map((s) => ({
    timeMs:      header.ticksToSeconds(s.ticks) * 1000,
    numerator:   s.timeSignature[0],
    denominator: s.timeSignature[1],
  }));

  const tracks: SmfTrack[] = midi.tracks.map((track) => ({
    name:    track.name?.trim() || undefined,
    program: track.instrument?.number,
    channel: track.channel,
    notes:   track.notes.map((note) => ({
      midi:       note.midi,
      timeMs:     note.time * 1000,
      durationMs: note.duration * 1000,
      velocity:   Math.round(note.velocity * 127),
    })),
  }));

  return { tracks, tempos, timeSignatures, durationMs: midi.duration * 1000 };
}

/** Whether bytes plausibly start a Standard MIDI File. Same four-byte check
 *  `parseMidiFile` uses, lifted here so both paths agree on what "is a MIDI file" means. */
export function hasSmfHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64;
}

/** Re-exported so callers building a map for `writeSmf` don't need a second import. */
export type { TempoMap };
