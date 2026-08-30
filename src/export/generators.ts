import { bytesToBase64 } from '@/audio/base64';
import { noteNameToMidi } from '@/audio/HarmonicaMapper';
import { writeSmf, type SmfTrack } from '@/audio/smf';
import { groupIntoPhrases } from '@/export/phrasing';
import { buildScoreDocument } from '@/notation/quantize';
import { scoreToMusicXml } from '@/notation/musicXml';
import type { RhythmMode } from '@/notation/scoreDocument';
import { groupSimultaneous, tabOrFallback, voicingOf } from '@/notation/tabText';
import { DEFAULT_BPM } from '@/audio/tempo';
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
  /** Optional General MIDI program for rendered/MIDI playback. Tab-oriented formats do
   *  not serialize it, because it changes timbre rather than the written harmonica part. */
  program?:      number;
}

export interface GeneratedFile {
  content:  string;
  encoding: 'utf8' | 'base64';
  ext:      string;
  mimeType: string;
}

/**
 * What a caller knows about the session that the notes themselves do not say.
 *
 * MIDI and notation formats read this. A tab carries no tempo — `TabNote` is milliseconds —
 * so before this existed every exported score claimed 120 BPM whatever the session was
 * actually running at, and the bar lines in the file matched nothing the user had seen in
 * the piano roll.
 */
export interface ExportOptions {
  /** The session BPM. Defaults to `DEFAULT_BPM`, which is what a fresh session runs at —
   *  a two-argument call is a caller with no tempo to offer, not a caller asking for 120. */
  bpm?:        number;
  rhythmMode?: RhythmMode;
  /** User-entered chart title. An empty/whitespace-only title is treated as untitled so
   *  every format keeps its established fallback instead of serializing a blank name. */
  title?:      string;
}

export function generateForFormat(
  parts: ExportPart[],
  format: ExportFormat,
  options: ExportOptions = {},
): GeneratedFile {
  switch (format) {
    case 'TXT':
      return { content: generateTxt(parts, options), encoding: 'utf8', ext: 'txt', mimeType: 'text/plain' };
    case 'CSV':
      return { content: generateCsv(parts, options), encoding: 'utf8', ext: 'csv', mimeType: 'text/csv' };
    case 'JSON':
      return { content: generateJson(parts, options), encoding: 'utf8', ext: 'json', mimeType: 'application/json' };
    case 'MIDI':
      return { content: generateMidi(parts, options), encoding: 'base64', ext: 'mid', mimeType: 'audio/midi' };
    case 'MusicXML':
      return { content: generateMusicXml(parts, options), encoding: 'utf8', ext: 'musicxml', mimeType: 'application/vnd.recordare.musicxml+xml' };
  }
}

/** Convenience for the tab editor, which only ever exports the one session it holds. */
export function singlePart(
  notes: TabNote[],
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  name = 'Harmonica',
  program?: number,
): ExportPart[] {
  return [{ name, key, harmonicaType, notes, program }];
}

// ── TXT ───────────────────────────────────────────────────────────────────────


/**
 * Which notations a tab actually uses, so the legend can explain those and only those.
 *
 * A fixed legend would put ten lines of bend and overblow theory above a four-note blow
 * melody that uses none of it. The three file-specific inventions carry a real example from
 * the file rather than a canonical one: a reader meeting `456` wants to see `456`, not a
 * stand-in. The standard techniques keep canonical examples, since there the point is the
 * rule -- an apostrophe means a bend, wherever it appears -- rather than the instance.
 */
interface TabSymbols {
  blow:     boolean;
  draw:     boolean;
  bend:     boolean;
  overblow: boolean;
  slide:    boolean;
  breath:   boolean;
  section:  boolean;
  /** Real examples from the file, absent when the file has none. */
  chord?:   string;
  group?:   string;
  offHarp?: string;
}

function noSymbols(): TabSymbols {
  return { blow: false, draw: false, bend: false, overblow: false, slide: false, breath: false, section: false };
}

function mergeSymbols(a: TabSymbols, b: TabSymbols): TabSymbols {
  return {
    blow:     a.blow     || b.blow,
    draw:     a.draw     || b.draw,
    bend:     a.bend     || b.bend,
    overblow: a.overblow || b.overblow,
    slide:    a.slide    || b.slide,
    breath:   a.breath   || b.breath,
    section:  a.section  || b.section,
    chord:    a.chord    ?? b.chord,
    group:    a.group    ?? b.group,
    offHarp:  a.offHarp  ?? b.offHarp,
  };
}

/** Reads one note's own tab. The group-level notations are recorded by `renderTab`, which
 *  is where a chord or a slashed group is actually decided. */
function noteSymbols(note: TabNote, into: TabSymbols): void {
  const tab = note.tab;
  if (!tab) return;
  if (tab.startsWith('-')) into.draw = true; else into.blow = true;
  if (tab.includes("'")) into.bend     = true;
  if (tab.endsWith('o')) into.overblow = true;
  if (tab.includes('+')) into.slide    = true;
}

/**
 * The legend itself, in the order a player would learn it: the two breaths, then the
 * techniques that modify them, then the notations this format adds on top.
 *
 * `keyLabel` names the harp an off-harp pitch is off, which is only meaningful when the
 * whole file is written for one -- a multi-part export can hold several.
 */
function legendLines(symbols: TabSymbols, keyLabel: string | null): string[] {
  const entries: [string, string][] = [];
  const add = (symbol: string, meaning: string) => entries.push([symbol, meaning]);

  if (symbols.blow)     add('4', 'blow hole 4');
  if (symbols.draw)     add('-4', 'draw hole 4');
  if (symbols.bend)     add("-3'", 'bend -- one more step down per mark');
  if (symbols.overblow) add('6o', 'overblow, or overdraw on a draw hole');
  if (symbols.slide)    add('11+', 'slide pressed in');
  if (symbols.chord)    add(symbols.chord, 'these holes sound together, in one breath');
  if (symbols.group)    add(symbols.group, 'these sound together, but not in one breath');
  if (symbols.offHarp) {
    add(symbols.offHarp, `no position on ${keyLabel ? `a ${keyLabel} harp` : 'this harp'} -- the pitch is shown instead`);
  }
  if (symbols.breath)  add(',', 'end of a phrase -- breathe here');
  if (symbols.section) add('(blank)', 'a longer silence -- a new section');

  if (entries.length === 0) return [];

  // Sized to its contents, with a floor: a long chord token would otherwise leave the
  // meanings ragged, and a legend of nothing but `4` and `-4` would sit uncomfortably tight.
  const width = Math.max(6, ...entries.map(([symbol]) => symbol.length));
  return ['How to read this:', ...entries.map(([symbol, meaning]) => `  ${symbol.padEnd(width)} ${meaning}`)];
}


/**
 * One line per musical phrase, blank line between sections, trailing comma where the phrase
 * actually ends.
 *
 * This used to wrap every 12 notes, which splits a phrase down the middle as often as not —
 * and on harmonica a phrase boundary is also where the player breathes, so the arbitrary wrap
 * was actively misleading about how to play the tab. `groupIntoPhrases` still caps a line at
 * the old width, so a tab with no rests in it (a MIDI import, where notes abut exactly) comes
 * out exactly as it always did.
 *
 * The comma is what distinguishes the two reasons a line can end. A line that ran out of room
 * carries none, so it reads as running straight into the next one — otherwise a forced wrap is
 * indistinguishable from a breath mark. The last line of a part has nothing to run into, so it
 * takes no comma either.
 *
 * Phrasing runs over voicings rather than notes, so a chord occupies one slot on the line and
 * the rest after it is measured from where the whole chord ends.
 */
function renderTab(
  notes: TabNote[],
  harmonicaType: HarmonicaType,
): { lines: string[]; count: number; symbols: TabSymbols } {
  const groups   = groupSimultaneous(notes);
  const voicings = groups.map((g, i) => voicingOf(g, harmonicaType, i));
  const tokens   = new Map(voicings.map((v) => [v.lead.id, v.token]));

  const symbols = noSymbols();
  for (const note of notes) noteSymbols(note, symbols);
  for (const voicing of voicings) {
    if (voicing.kind === 'chord') symbols.chord ??= voicing.token;
    if (voicing.kind === 'group') symbols.group ??= voicing.token;
  }
  // The bracketed form is a property of the note, but only the renderer knows how it was
  // finally written -- inside a group it keeps the brackets, so either way this is the token.
  const blank = notes.find((n) => !n.tab);
  if (blank) symbols.offHarp = tabOrFallback(blank);

  const phrases = groupIntoPhrases(voicings.map((v) => v.lead));
  const lines: string[] = [];
  phrases.forEach((phrase, i) => {
    if (phrase.startsSection && lines.length > 0) { lines.push(''); symbols.section = true; }
    const breathes = !phrase.continuesNext && i < phrases.length - 1;
    if (breathes) symbols.breath = true;
    const text = phrase.notes.map((n) => tokens.get(n.id) ?? tabOrFallback(n)).join('  ');
    lines.push(text + (breathes ? ',' : ''));
  });

  return { lines, count: voicings.reduce((sum, v) => sum + v.counts, 0), symbols };
}

function sectionHeader(label: string, key: HarmonicaKey, count: number): string {
  return `${label} -- Key of ${key} -- ${count} note${count !== 1 ? 's' : ''}`;
}

function exportTitle(options: ExportOptions): string | undefined {
  return options.title?.trim() || undefined;
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
function generateTxt(parts: ExportPart[], options: ExportOptions): string {
  // Single-part output is byte-identical to what this always emitted — the one thing that
  // must not regress, since it's what every existing exported file looks like. A tab with no
  // simultaneous notes in it produces one voicing per note, so nothing about it changes.
  const rendered = parts.map((part) => renderTab(part.notes, part.harmonicaType));

  // One legend for the file, covering every part -- a reader learns the notation once, and
  // a per-section legend would repeat itself for every track of an arrangement.
  const symbols = rendered.map((r) => r.symbols).reduce(mergeSymbols, noSymbols());
  const keys    = new Set(parts.map((p) => p.key));
  const legend  = legendLines(symbols, keys.size === 1 ? parts[0].key : null);

  if (parts.length === 1) {
    const { key } = parts[0];
    const { lines, count } = rendered[0];
    return [
      sectionHeader(exportTitle(options) ?? 'Harp2Tab', key, count),
      '-'.repeat(40),
      ...(legend.length > 0 ? [...legend, '-'.repeat(40)] : []),
      ...lines,
    ].join('\n');
  }

  const out: string[] = [
    `${exportTitle(options) ?? 'Harp2Tab'} -- ${parts.length} tracks`,
    '='.repeat(40),
  ];
  if (legend.length > 0) out.push(...legend, '='.repeat(40));
  parts.forEach((part, i) => {
    out.push('', sectionHeader(part.name, part.key, rendered[i].count), '-'.repeat(40), ...rendered[i].lines);
  });
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
function generateCsv(parts: ExportPart[], options: ExportOptions): string {
  const title = exportTitle(options);
  const header = 'tab,note,start_time_ms,duration_ms,track_index,track_name,key,harmonica_type'
    + (title ? ',chart_title' : '');

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
      ...(title ? [csvField(title)] : []),
    ].join(','));

  return [header, ...rows].join('\n');
}

// ── JSON ──────────────────────────────────────────────────────────────────────

function generateJson(parts: ExportPart[], options: ExportOptions): string {
  const title = exportTitle(options);
  const noteJson = (n: TabNote) => ({
    tab: n.tab, note: n.note, start_time: n.start_time, duration: n.duration,
  });

  // Version 1 shape preserved exactly for a single part, so anything reading existing
  // exports keeps working; version 2 is the multi-part shape.
  if (parts.length === 1) {
    const { key, harmonicaType, notes } = parts[0];
    return JSON.stringify(
      { version: 1, ...(title ? { title } : {}), key, harmonicaType, exportedAt: new Date().toISOString(), notes: notes.map(noteJson) },
      null, 2,
    );
  }

  return JSON.stringify(
    {
      version: 2,
      ...(title ? { title } : {}),
      exportedAt: new Date().toISOString(),
      tracks: parts.map((p) => ({
        name: p.name, key: p.key, harmonicaType: p.harmonicaType, notes: p.notes.map(noteJson),
      })),
    },
    null, 2,
  );
}

// ── MIDI ──────────────────────────────────────────────────────────────────────

/**
 * Format 1, one MTrk per part.
 *
 * Uses the shared `writeSmf` rather than a second hand-rolled SMF writer — that writer was
 * built for project persistence and already handles the delta encoding, event ordering and
 * sub-tick guard this needs.
 */
function generateMidi(parts: ExportPart[], options: ExportOptions): string {
  const title = exportTitle(options);
  const tracks: SmfTrack[] = parts.map((part, i) => ({
    // A tab export has one part, so its track-name event is the standard place for the
    // chart title. Multi-part callers retain their individual track names.
    name:    parts.length === 1 && title ? title : part.name,
    channel: i % 16 === 9 ? 15 : i % 16, // never land a part on the percussion channel
    program: part.program,
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
    [{ timeMs: 0, bpm: options.bpm ?? DEFAULT_BPM }],
    [{ timeMs: 0, numerator: 4, denominator: 4 }],
  ));
}

// ── MusicXML ──────────────────────────────────────────────────────────────────

/**
 * A thin adapter now. Everything musical — rhythm, chords, ties, rests, spelling — belongs to
 * the score document in `src/notation/`, so that the Score view and this file cannot reach
 * different conclusions about the same performance. See `quantize.ts` for why the origin is
 * the first onset rather than zero.
 */
function generateMusicXml(parts: ExportPart[], options: ExportOptions): string {
  return scoreToMusicXml(buildScoreDocument(parts, {
    bpm:        options.bpm ?? DEFAULT_BPM,
    beats:      4,
    beatType:   4,
    rhythmMode: options.rhythmMode ?? 'balanced',
    title:      exportTitle(options),
  }));
}
