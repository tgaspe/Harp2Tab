import { bytesToBase64 } from '@/audio/base64';
import { noteNameToMidi } from '@/audio/HarmonicaMapper';
import { writeSmf, type SmfTrack } from '@/audio/smf';
import { noteVelocity } from '@/audio/velocity';
import type { ExportFormat, HarmonicaKey, HarmonicaType, TabNote } from '@/types';

/**
 * One part of an export — a single player's line, with the harp it's written for.
 *
 * Multi-part exists because the MIDI Studio can convert several tracks of one arrangement,
 * and those tracks legitimately land on *different harps*. That's why key and type sit on
 * the part rather than on the call: a single key for the whole file would be wrong the
 * moment two parts differ.
 */
export interface ExportPart {
  name:          string;
  key:           HarmonicaKey;
  harmonicaType: HarmonicaType;
  notes:         TabNote[];
}

export interface GeneratedFile {
  content:  string;
  encoding: 'utf8' | 'base64';
  ext:      string;
  mimeType: string;
}

export function generateForFormat(parts: ExportPart[], format: ExportFormat): GeneratedFile {
  switch (format) {
    case 'TXT':
      return { content: generateTxt(parts), encoding: 'utf8', ext: 'txt', mimeType: 'text/plain' };
    case 'CSV':
      return { content: generateCsv(parts), encoding: 'utf8', ext: 'csv', mimeType: 'text/csv' };
    case 'JSON':
      return { content: generateJson(parts), encoding: 'utf8', ext: 'json', mimeType: 'application/json' };
    case 'MIDI':
      return { content: generateMidi(parts), encoding: 'base64', ext: 'mid', mimeType: 'audio/midi' };
    case 'MusicXML':
      return { content: generateMusicXml(parts), encoding: 'utf8', ext: 'musicxml', mimeType: 'application/vnd.recordare.musicxml+xml' };
  }
}

/** Convenience for the tab editor, which only ever exports the one session it holds. */
export function singlePart(
  notes: TabNote[],
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  name = 'Harmonica',
): ExportPart[] {
  return [{ name, key, harmonicaType, notes }];
}

// A note with tab: '' has no real position on the current harmonica (see
// getGridRows/PianoRoll.tsx) — human-facing text formats show its pitch instead of a
// blank, bracketed so it reads as "not a real tab" rather than a malformed one.
function tabOrFallback(n: TabNote): string {
  return n.tab || `[${n.note}]`;
}

// ── TXT ───────────────────────────────────────────────────────────────────────

const NOTES_PER_LINE = 12;

function tabLines(notes: TabNote[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < notes.length; i += NOTES_PER_LINE) {
    lines.push(notes.slice(i, i + NOTES_PER_LINE).map(tabOrFallback).join('  '));
  }
  return lines;
}

function sectionHeader(label: string, key: HarmonicaKey, count: number): string {
  return `${label} -- Key of ${key} -- ${count} note${count !== 1 ? 's' : ''}`;
}

/**
 * Sequential sections, one per part.
 *
 * Parallel staves were rejected for a structural reason rather than a stylistic one: this
 * format has no time axis at all — notes are packed `NOTES_PER_LINE` to a line regardless
 * of when they occur — so column-aligning parts with different rhythms would mean inventing
 * a temporal grid that isn't here. MusicXML already does that properly. Sequential sections
 * also match how the artifact gets used: a player prints it and plays one part.
 */
function generateTxt(parts: ExportPart[]): string {
  // Single-part output is byte-identical to what this always emitted — the one thing that
  // must not regress, since it's what every existing exported file looks like.
  if (parts.length === 1) {
    const { notes, key } = parts[0];
    return [sectionHeader('Harp2Tab', key, notes.length), '-'.repeat(40), ...tabLines(notes)].join('\n');
  }

  const out: string[] = [
    `Harp2Tab -- ${parts.length} tracks`,
    '='.repeat(40),
  ];
  for (const part of parts) {
    out.push('', sectionHeader(part.name, part.key, part.notes.length), '-'.repeat(40), ...tabLines(part.notes));
  }
  return out.join('\n');
}

// ── CSV ───────────────────────────────────────────────────────────────────────

/**
 * RFC 4180 field escaping.
 *
 * Never needed before multi-track: tabs and note names can't contain a comma, so raw
 * joining was safe. A *track name* can (`"Lead, Alto"`), and an unescaped one silently
 * corrupts the row rather than failing, which is the worst way for this to go wrong.
 */
function csvField(value: string | number): string {
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Columns are *appended*, never prepended, so any consumer indexing positionally
 * (`row[0]` is still the tab) keeps working — which is what allows one schema for both
 * single- and multi-track output instead of two.
 *
 * `key`/`harmonica_type` are load-bearing rather than decorative: with per-part keys, a tab
 * of "4" is a different pitch on a C harp than an A harp, so the column is what makes the
 * tab column interpretable at all.
 */
function generateCsv(parts: ExportPart[]): string {
  const header = 'tab,note,start_time_ms,duration_ms,track_index,track_name,key,harmonica_type';

  const rows = parts
    .flatMap((part, trackIndex) => part.notes.map((n) => ({ n, part, trackIndex })))
    // Global time order, tie-broken by track: the format's value is timeline analysis, and
    // grouping by track is one sort away in any tool. Single-part output keeps the order it
    // has always had, since a stable sort leaves an already-ordered list alone.
    .sort((a, b) => a.n.start_time - b.n.start_time || a.trackIndex - b.trackIndex)
    .map(({ n, part, trackIndex }) => [
      csvField(tabOrFallback(n)),
      csvField(n.note),
      n.start_time,
      n.duration,
      trackIndex,
      csvField(part.name),
      csvField(part.key),
      csvField(part.harmonicaType),
    ].join(','));

  return [header, ...rows].join('\n');
}

// ── JSON ──────────────────────────────────────────────────────────────────────

function generateJson(parts: ExportPart[]): string {
  const noteJson = (n: TabNote) => ({
    tab: n.tab, note: n.note, start_time: n.start_time, duration: n.duration,
  });

  // Version 1 shape preserved exactly for a single part, so anything reading existing
  // exports keeps working; version 2 is the multi-part shape.
  if (parts.length === 1) {
    const { key, harmonicaType, notes } = parts[0];
    return JSON.stringify(
      { version: 1, key, harmonicaType, exportedAt: new Date().toISOString(), notes: notes.map(noteJson) },
      null, 2,
    );
  }

  return JSON.stringify(
    {
      version: 2,
      exportedAt: new Date().toISOString(),
      tracks: parts.map((p) => ({
        name: p.name, key: p.key, harmonicaType: p.harmonicaType, notes: p.notes.map(noteJson),
      })),
    },
    null, 2,
  );
}

// ── MIDI ──────────────────────────────────────────────────────────────────────

/** Tempo the exporter writes. Tabs carry a BPM but the export has always been a plain
 *  120 — kept so existing files and the round-trip harness stay stable. */
const EXPORT_BPM = 120;

/**
 * Format 1, one MTrk per part.
 *
 * Uses the shared `writeSmf` rather than a second hand-rolled SMF writer — that writer was
 * built for project persistence and already handles the delta encoding, event ordering and
 * sub-tick guard this needs.
 */
function generateMidi(parts: ExportPart[]): string {
  const tracks: SmfTrack[] = parts.map((part, i) => ({
    name:    part.name,
    channel: i % 16 === 9 ? 15 : i % 16, // never land a part on the percussion channel
    notes:   part.notes.flatMap((n) => {
      const midi = noteNameToMidi(n.note);
      // A pitch that doesn't parse is dropped rather than written as middle C, which would
      // silently alter the music.
      return midi === null ? [] : [{
        midi,
        timeMs:     n.start_time,
        durationMs: n.duration,
        velocity:   noteVelocity(n),
      }];
    }),
  }));

  return bytesToBase64(writeSmf(
    tracks,
    [{ timeMs: 0, bpm: EXPORT_BPM }],
    [{ timeMs: 0, numerator: 4, denominator: 4 }],
  ));
}

// ── MusicXML ──────────────────────────────────────────────────────────────────

function generateMusicXml(parts: ExportPart[]): string {
  const DIVISIONS   = 4; // per quarter note
  const BPM         = 120;
  const QUARTER_MS  = 60_000 / BPM; // 500ms
  const MEASURE_DIV = 16; // 4 beats × 4 divisions

  const msToDiv = (ms: number) => Math.round((ms / QUARTER_MS) * DIVISIONS);

  function quantize(divs: number): { d: number; type: string } {
    const opts = [
      { d: 16, type: 'whole' }, { d: 8, type: 'half' }, { d: 4, type: 'quarter' },
      { d: 2, type: 'eighth' }, { d: 1, type: '16th' },
    ];
    return opts.reduce((best, o) => Math.abs(o.d - divs) < Math.abs(best.d - divs) ? o : best, opts[0]);
  }

  function parsePitch(name: string) {
    const m = name.match(/^([A-G])(#?)(\d+)$/);
    if (!m) return { step: 'C', alter: 0, octave: 4 };
    return { step: m[1], alter: m[2] === '#' ? 1 : 0, octave: parseInt(m[3]) };
  }

  function noteXml(n: TabNote | null, divs: number): string {
    const { d, type } = quantize(Math.max(1, divs));
    if (!n) return `<note><rest/><duration>${d}</duration><type>${type}</type></note>`;
    const { step, alter, octave } = parsePitch(n.note);
    const alt = alter ? `<alter>${alter}</alter>` : '';
    return `<note><pitch><step>${step}</step>${alt}<octave>${octave}</octave></pitch><duration>${d}</duration><type>${type}</type></note>`;
  }

  /** Measures for one part. Was inline before multi-part; the loop was already per-part,
   *  so it only needed lifting out to run N times. */
  function measuresFor(notes: TabNote[]): string {
    const measures: string[] = [];
    let cur: string[] = [];
    let usedDiv = 0;
    let measNum = 1;

    function flushMeasure() {
      const rem = MEASURE_DIV - usedDiv;
      if (rem > 0) cur.push(noteXml(null, rem));
      const attrs = measNum === 1
        ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key>` +
          `<time><beats>4</beats><beat-type>4</beat-type></time>` +
          `<clef><sign>G</sign><line>2</line></clef></attributes>` +
          `<direction placement="above"><direction-type><metronome>` +
          `<beat-unit>quarter</beat-unit><per-minute>${BPM}</per-minute>` +
          `</metronome></direction-type></direction>`
        : '';
      measures.push(`<measure number="${measNum}">${attrs}${cur.join('')}</measure>`);
      cur = []; usedDiv = 0; measNum++;
    }

    function addChunk(n: TabNote | null, divs: number) {
      let rem = divs;
      while (rem > 0) {
        const space = MEASURE_DIV - usedDiv;
        const chunk = Math.min(rem, space);
        cur.push(noteXml(n, chunk));
        usedDiv += chunk;
        rem     -= chunk;
        if (usedDiv >= MEASURE_DIV) flushMeasure();
      }
    }

    let curAbsDiv = 0;
    for (const n of notes) {
      const startDiv = msToDiv(n.start_time);
      const durDiv   = Math.max(1, msToDiv(n.duration));
      const gap      = startDiv - curAbsDiv;
      if (gap > 0) { addChunk(null, gap); curAbsDiv += gap; }
      addChunk(n, durDiv);
      curAbsDiv += durDiv;
    }

    if (usedDiv > 0) flushMeasure();

    if (measures.length === 0) {
      measures.push(
        `<measure number="1">` +
        `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key>` +
        `<time><beats>4</beats><beat-type>4</beat-type></time>` +
        `<clef><sign>G</sign><line>2</line></clef></attributes>` +
        `<note><rest/><duration>16</duration><type>whole</type></note></measure>`,
      );
    }
    return measures.join('');
  }

  function xmlText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const date = new Date().toISOString().slice(0, 10);
  const title = parts.length === 1
    ? `Harp2Tab -- Key of ${parts[0].key}`
    : `Harp2Tab -- ${parts.length} tracks`;

  const partList = parts
    .map((p, i) => `<score-part id="P${i + 1}"><part-name>${xmlText(
      parts.length === 1 ? 'Harmonica' : `${p.name} (${p.key} harp)`,
    )}</part-name></score-part>`)
    .join('');

  const bodies = parts
    .map((p, i) => `<part id="P${i + 1}">${measuresFor(p.notes)}</part>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${xmlText(title)}</work-title></work>
  <identification><encoding><software>Harp2Tab</software><encoding-date>${date}</encoding-date></encoding></identification>
  <part-list>${partList}</part-list>
  ${bodies}
</score-partwise>`;
}
