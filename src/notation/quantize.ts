/**
 * Milliseconds in, written music out — the only place in the app where that conversion
 * happens.
 *
 * **Derived, never applied.** Nothing here writes to a `TabNote`. Quantization is a lens over
 * the performance in exactly the way `noiseGate` and `durationFloorMs` are lenses over the
 * note list: the user can read the score at a sixteenth-note grid, decide it is wrong, and
 * switch to eighths without having lost anything. A quantizer that edited the notes would
 * make the piano roll and the score disagree about what was played, and only one of them
 * would be right.
 *
 * The other rule worth stating up front: **onsets win**. When two notes collide after
 * rounding, the earlier one is cut short rather than the later one pushed back. A reader
 * follows attacks, so a wrong note length is a smaller lie than a wrong downbeat, and pushing
 * accumulates — three collisions in a bar and the rest of the piece is off the beat.
 */

import { beatDurationMs } from '@/audio/tempo';
import { noteNameToMidi } from '@/audio/HarmonicaMapper';
import type { ExportPart } from '@/export/generators';
import { groupSimultaneous, voicingOf } from '@/notation/tabText';
import {
  GRID_TICKS, TICKS_PER_QUARTER, decomposeSpan, fifthsForKey, spellPitch,
  type QuantizationWarning, type RhythmMode, type ScoreDocument, type ScoreElement,
  type ScoreMeasure, type ScorePart,
} from '@/notation/scoreDocument';

export interface ScoreSettings {
  bpm: number;
  /**
   * Where bar 1 beat 1 sits on the recording's millisecond clock.
   *
   * Defaults to the first onset in the material, not to zero. A take keeps its leading
   * silence, and the detected beat offset is only subtracted from the notes when the user
   * presses Detect (`applyTempoEstimate`, `src/store/useAppStore.ts`) — so with an origin of
   * zero an ordinary recording opens on several bars of nothing. Silence before the first
   * note is a capture artifact, not an anacrusis. Pass `0` explicitly to keep it.
   */
  originMs?: number;
  beats:      number;
  beatType:   number;
  rhythmMode: RhythmMode;
  /** Overrides the generated `Harp2Tab -- Key of C` style title. */
  title?:     string;
}

/** One sounding event after grouping: a chord is one of these, not several. */
interface Event {
  startTick: number;
  endTick:   number;
  midis:     number[];
  tab:       string;
  sourceIds: string[];
}

function ticksPerBar(settings: ScoreSettings): number {
  return Math.round(settings.beats * (4 / settings.beatType) * TICKS_PER_QUARTER);
}

/** The first onset anywhere in the material, which is where the score starts by default. */
function firstOnset(parts: ExportPart[]): number {
  const onsets = parts.flatMap((p) => p.notes.map((n) => n.start_time));
  return onsets.length > 0 ? Math.min(...onsets) : 0;
}

/**
 * The title an untitled tab is engraved under.
 *
 * A single part says only `Harp2Tab`: the key used to be here because the title was the only
 * line on the page, and it now has its own in `harpSubtitle` — printing `Key of C` twice,
 * once above the other, is worse than either alone. A multi-part score has no subtitle, since
 * one line cannot speak for several harps, so it keeps its count.
 */
function defaultTitle(parts: ExportPart[]): string {
  return parts.length === 1 ? 'Harp2Tab' : `Harp2Tab -- ${parts.length} tracks`;
}

/**
 * The harp line under the title.
 *
 * Single-part only: a multi-part score already names each track's harp on its own part
 * (`Melody (C harp)`), and one subtitle cannot speak for several different instruments.
 */
function harpSubtitle(parts: ExportPart[]): string | undefined {
  if (parts.length !== 1) return undefined;
  return `${parts[0].key} ${parts[0].harmonicaType} harmonica`;
}

/**
 * Chord groups, in time order, with their onsets and ends fitted to the grid.
 *
 * Onsets are made strictly increasing first, then ends are trimmed to the following onset.
 * Doing it in that order is what keeps the "onsets win" rule: by the time an end is
 * considered, the onset it must not overrun is already final.
 */
function eventsFor(
  part: ExportPart,
  settings: ScoreSettings,
  originMs: number,
  warnings: QuantizationWarning[],
): Event[] {
  const grid       = GRID_TICKS[settings.rhythmMode];
  const perMs      = TICKS_PER_QUARTER / beatDurationMs(settings.bpm);
  const gridMs     = grid / perMs;
  // Far enough off the grid that the written score is an approximation rather than a record.
  // Below this the rounding is inside the resolution the user asked for, and saying so on
  // every note would make the warning meaningless.
  const movedMs    = gridMs * 0.4;
  const toTicks    = (ms: number) => Math.round(((ms - originMs) * perMs) / grid) * grid;

  const groups = groupSimultaneous(part.notes);
  const events: Event[] = [];
  let previousStart = -Infinity;

  groups.forEach((group, index) => {
    const startMs = Math.min(...group.map((n) => n.start_time));
    const endMs   = Math.max(...group.map((n) => n.start_time + n.duration));

    let startTick = Math.max(0, toTicks(startMs));
    if (startTick <= previousStart) {
      // Two attacks landed on the same grid point. The later one has to move — dropping it
      // would silently lose a note the user can see in the piano roll.
      startTick = previousStart + grid;
      for (const note of group) {
        warnings.push({ sourceId: note.id, kind: 'overlapTruncated', deltaMs: gridMs });
      }
    } else if (Math.abs(startTick / perMs + originMs - startMs) > movedMs) {
      for (const note of group) {
        warnings.push({
          sourceId: note.id,
          kind:     'onsetMoved',
          deltaMs:  startTick / perMs + originMs - startMs,
        });
      }
    }
    previousStart = startTick;

    let endTick = Math.max(0, toTicks(endMs));
    if (endTick <= startTick) {
      // Shorter than the grid can express. A note is never written as nothing, so it takes
      // the smallest value the mode has.
      endTick = startTick + grid;
      for (const note of group) {
        warnings.push({ sourceId: note.id, kind: 'durationClamped', deltaMs: gridMs });
      }
    }

    // De-duplicated by sounding pitch: two sources on the same pitch are one notehead,
    // however the tab spelled them.
    const midis = [...new Set(
      group.map((n) => noteNameToMidi(n.note)).filter((m): m is number => m !== null),
    )].sort((a, b) => a - b);

    events.push({
      startTick,
      endTick,
      midis,
      tab:       voicingOf(group, part.harmonicaType, index).token,
      sourceIds: group.map((n) => n.id),
    });
  });

  // Ends, now that every onset is final.
  for (let i = 0; i < events.length; i++) {
    const next = events[i + 1];
    if (next && events[i].endTick > next.startTick) {
      for (const id of events[i].sourceIds) {
        warnings.push({
          sourceId: id,
          kind:     'overlapTruncated',
          deltaMs:  (events[i].endTick - next.startTick) / perMs,
        });
      }
      events[i].endTick = next.startTick;
    }
  }

  return events;
}

/**
 * Lay events and the silence between them onto bars.
 *
 * A span is cut at every bar line it crosses and the pieces tied, because a measure that does
 * not add up is a file no notation program will open — and because a note written across a
 * bar line without a tie is a different note.
 */
function measuresFor(
  part: ExportPart,
  events: Event[],
  settings: ScoreSettings,
): ScoreMeasure[] {
  const barTicks = ticksPerBar(settings);
  const fifths   = fifthsForKey(part.key);
  const bars: ScoreElement[][] = [];

  function barAt(index: number): ScoreElement[] {
    while (bars.length <= index) bars.push([]);
    return bars[index];
  }

  /** Write `ticks` of one thing from `start`, splitting at bar lines and tying the pieces. */
  function place(start: number, ticks: number, event: Event | null): void {
    let position = start;
    let left     = ticks;
    let first    = true;

    while (left > 0) {
      const barIndex   = Math.floor(position / barTicks);
      const inBar      = position - barIndex * barTicks;
      const chunk      = Math.min(left, barTicks - inBar);
      const written    = decomposeSpan(inBar, chunk, settings.rhythmMode);
      const lastOfSpan = left - chunk === 0;

      written.forEach((value, i) => {
        const isFirstPiece = first && i === 0;
        const isLastPiece  = lastOfSpan && i === written.length - 1;
        barAt(barIndex).push({
          pitches:       event ? event.midis.map((m) => spellPitch(m, fifths)) : [],
          durationTicks: value.ticks,
          type:          value.type,
          dots:          value.dots,
          ...(value.timeModification ? { timeModification: value.timeModification } : {}),
          // Rests are never tied — a rest is silence, and silence does not sustain.
          tieStart:      event !== null && !isLastPiece,
          tieStop:       event !== null && !isFirstPiece,
          // Only the attack carries the tab: repeated under a tied continuation it would
          // read as a second breath.
          tab:           event && isFirstPiece ? event.tab : '',
          sourceIds:     event ? event.sourceIds : [],
        });
      });

      position += chunk;
      left     -= chunk;
      first     = false;
    }
  }

  let cursor = 0;
  for (const event of events) {
    if (event.startTick > cursor) place(cursor, event.startTick - cursor, null);
    place(event.startTick, event.endTick - event.startTick, event);
    cursor = event.endTick;
  }

  // Pad the last bar, so it adds up like every other one.
  const tail = cursor % barTicks;
  if (tail !== 0) place(cursor, barTicks - tail, null);

  // A part with nothing in it is still a part: one bar of silence reads as "no notes here",
  // where an empty stave reads as a broken file.
  if (bars.length === 0) place(0, barTicks, null);

  return bars.map((elements, i) => ({
    number:   i + 1,
    elements,
    ...(i === 0
      ? {
          attributes: {
            divisions: TICKS_PER_QUARTER,
            keyFifths: fifths,
            beats:     settings.beats,
            beatType:  settings.beatType,
          },
          tempoBpm: settings.bpm,
        }
      : {}),
  }));
}

export function buildScoreDocument(parts: ExportPart[], settings: ScoreSettings): ScoreDocument {
  const originMs = settings.originMs ?? firstOnset(parts);
  const warnings: QuantizationWarning[] = [];

  const scoreParts: ScorePart[] = parts.map((part, i) => ({
    id:            `P${i + 1}`,
    name:          part.name,
    key:           part.key,
    harmonicaType: part.harmonicaType,
    measures:      measuresFor(part, eventsFor(part, settings, originMs, warnings), settings),
  }));

  return {
    title:        settings.title ?? defaultTitle(parts),
    subtitle:     harpSubtitle(parts),
    encodingDate: new Date().toISOString().slice(0, 10),
    parts:        scoreParts,
    warnings,
    bpm:          settings.bpm,
    originMs,
  };
}
