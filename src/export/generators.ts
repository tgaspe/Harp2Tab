import type { ExportFormat, HarmonicaKey, HarmonicaType, TabNote } from '@/types';

export function generateForFormat(
  notes: TabNote[],
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  format: ExportFormat,
): { content: string; encoding: 'utf8' | 'base64'; ext: string; mimeType: string } {
  switch (format) {
    case 'TXT':
      return { content: generateTxt(notes, key), encoding: 'utf8', ext: 'txt', mimeType: 'text/plain' };
    case 'CSV':
      return { content: generateCsv(notes), encoding: 'utf8', ext: 'csv', mimeType: 'text/csv' };
    case 'JSON':
      return { content: generateJson(notes, key, harmonicaType), encoding: 'utf8', ext: 'json', mimeType: 'application/json' };
    case 'MIDI':
      return { content: generateMidi(notes), encoding: 'base64', ext: 'mid', mimeType: 'audio/midi' };
    case 'MusicXML':
      return { content: generateMusicXml(notes, key), encoding: 'utf8', ext: 'musicxml', mimeType: 'application/vnd.recordare.musicxml+xml' };
  }
}

// A note with tab: '' has no real position on the current harmonica (see
// getGridRows/PianoRoll.tsx) — human-facing text formats show its pitch instead of a
// blank, bracketed so it reads as "not a real tab" rather than a malformed one.
function tabOrFallback(n: TabNote): string {
  return n.tab || `[${n.note}]`;
}

// ── TXT ───────────────────────────────────────────────────────────────────────

function generateTxt(notes: TabNote[], key: HarmonicaKey): string {
  const NOTES_PER_LINE = 12;
  const header  = `Harp2Tab -- Key of ${key} -- ${notes.length} note${notes.length !== 1 ? 's' : ''}`;
  const divider = '-'.repeat(40);
  const lines: string[] = [];
  for (let i = 0; i < notes.length; i += NOTES_PER_LINE) {
    lines.push(notes.slice(i, i + NOTES_PER_LINE).map(tabOrFallback).join('  '));
  }
  return [header, divider, ...lines].join('\n');
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function generateCsv(notes: TabNote[]): string {
  const rows = notes.map(n => `${tabOrFallback(n)},${n.note},${n.start_time},${n.duration}`);
  return ['tab,note,start_time_ms,duration_ms', ...rows].join('\n');
}

// ── JSON ──────────────────────────────────────────────────────────────────────

function generateJson(notes: TabNote[], key: HarmonicaKey, harmonicaType: HarmonicaType): string {
  return JSON.stringify(
    {
      version: 1,
      key,
      harmonicaType,
      exportedAt: new Date().toISOString(),
      notes: notes.map(({ tab, note, start_time, duration }) => ({ tab, note, start_time, duration })),
    },
    null,
    2,
  );
}

// ── MIDI ──────────────────────────────────────────────────────────────────────

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

function noteNameToMidi(name: string): number {
  const m = name.match(/^([A-G]#?)(\d+)$/);
  if (!m) return 60;
  return (parseInt(m[2]) + 1) * 12 + (NOTE_SEMITONES[m[1]] ?? 0);
}

function writeVlq(value: number): number[] {
  if (value === 0) return [0];
  const bytes: number[] = [value & 0x7f];
  value >>>= 7;
  while (value > 0) { bytes.unshift((value & 0x7f) | 0x80); value >>>= 7; }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
  }
  return btoa(binary);
}

function generateMidi(notes: TabNote[]): string {
  const TEMPO    = 500_000; // μs/beat at 120 BPM
  const DIVISION = 480;
  const MS_PER_TICK = TEMPO / DIVISION / 1000; // ~1.04ms

  const msToTicks = (ms: number) => Math.round(ms / MS_PER_TICK);

  const evts: number[] = [];
  // Tempo meta event
  evts.push(0, 0xFF, 0x51, 0x03,
    (TEMPO >> 16) & 0xFF, (TEMPO >> 8) & 0xFF, TEMPO & 0xFF);

  type MEv = { tick: number; isOn: boolean; pitch: number };
  const mevts: MEv[] = [];
  for (const n of notes) {
    const p = noteNameToMidi(n.note);
    mevts.push({ tick: msToTicks(n.start_time), isOn: true, pitch: p });
    mevts.push({ tick: msToTicks(n.start_time + n.duration), isOn: false, pitch: p });
  }
  // Note-off before note-on at same tick
  mevts.sort((a, b) => a.tick - b.tick || (a.isOn ? 1 : -1));

  let cur = 0;
  for (const e of mevts) {
    evts.push(...writeVlq(e.tick - cur));
    cur = e.tick;
    evts.push(e.isOn ? 0x90 : 0x80, e.pitch, e.isOn ? 80 : 0);
  }
  evts.push(0, 0xFF, 0x2F, 0x00); // end of track

  const header = [
    0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, // MThd, length=6
    0, 0,                                 // format 0
    0, 1,                                 // 1 track
    (DIVISION >> 8) & 0xFF, DIVISION & 0xFF,
  ];
  const tl = evts.length;
  const track = [
    0x4D, 0x54, 0x72, 0x6B,              // MTrk
    (tl >> 24) & 0xFF, (tl >> 16) & 0xFF, (tl >> 8) & 0xFF, tl & 0xFF,
    ...evts,
  ];

  return uint8ArrayToBase64(new Uint8Array([...header, ...track]));
}

// ── MusicXML ──────────────────────────────────────────────────────────────────

function generateMusicXml(notes: TabNote[], key: HarmonicaKey): string {
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

  const measures: string[] = [];
  let cur: string[] = [];
  let usedDiv = 0;
  let measNum = 1;
  let absDiv  = 0; // absolute position in the timeline

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
      absDiv  += chunk;
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

  const date = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Harp2Tab -- Key of ${key}</work-title></work>
  <identification><encoding><software>Harp2Tab</software><encoding-date>${date}</encoding-date></encoding></identification>
  <part-list><score-part id="P1"><part-name>Harmonica</part-name></score-part></part-list>
  <part id="P1">${measures.join('')}</part>
</score-partwise>`;
}
