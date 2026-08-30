/**
 * `ScoreDocument` → MusicXML 3.1.
 *
 * A serializer and nothing else. Every musical decision — what rhythm, which spelling, where
 * the ties go — was made by the quantizer, which is the point: the generator this replaced
 * quantized milliseconds inline, so the file was the only record of what it had decided, and
 * the score view would have decided differently.
 *
 * Element order inside `<note>` is fixed by the DTD (chord, pitch, duration, tie, voice,
 * type, dot, time-modification, notations, lyric). Emitting them in another order produces a
 * file that looks fine and that strict readers reject, so the order below is deliberate.
 */

import type {
  ScoreDocument, ScoreElement, ScoreMeasure, ScorePart,
} from '@/notation/scoreDocument';
import { TICKS_PER_QUARTER } from '@/notation/scoreDocument';

/** Text nodes only. Every attribute this module writes is a number or an internal id. */
function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * One `<note>` per pitch: MusicXML writes a chord as consecutive notes where every one after
 * the first carries `<chord/>` and repeats the same duration.
 *
 * No `<accidental>` is written. `<alter>` states the sounding pitch, and letting the reader
 * derive the printed symbol from that and the key signature is what keeps a piece in F from
 * showing a courtesy flat on every single B.
 */
function noteXml(element: ScoreElement): string {
  const dots = element.dots === 1 ? '<dot/>' : '';
  const timeMod = element.timeModification
    ? `<time-modification><actual-notes>${element.timeModification.actualNotes}</actual-notes>`
      + `<normal-notes>${element.timeModification.normalNotes}</normal-notes></time-modification>`
    : '';

  // `<tie>` is the sound, `<tied>` is the printed slur. A file needs both: one tells a
  // player it is a single note, the other draws the curve.
  const ties = [
    element.tieStop  ? '<tie type="stop"/>'  : '',
    element.tieStart ? '<tie type="start"/>' : '',
  ].join('');
  const tied = [
    element.tieStop  ? '<tied type="stop"/>'  : '',
    element.tieStart ? '<tied type="start"/>' : '',
  ].join('');
  const notations = tied ? `<notations>${tied}</notations>` : '';

  if (element.pitches.length === 0) {
    return `<note><rest/><duration>${element.durationTicks}</duration>`
      + `<type>${element.type}</type>${dots}${timeMod}</note>`;
  }

  const lyric = element.tab
    ? `<lyric number="1"><syllabic>single</syllabic><text>${xmlText(element.tab)}</text></lyric>`
    : '';

  return element.pitches.map((pitch, i) => {
    const alter = pitch.alter !== 0 ? `<alter>${pitch.alter}</alter>` : '';
    return `<note>${i > 0 ? '<chord/>' : ''}`
      + `<pitch><step>${pitch.step}</step>${alter}<octave>${pitch.octave}</octave></pitch>`
      + `<duration>${element.durationTicks}</duration>${ties}`
      + `<type>${element.type}</type>${dots}${timeMod}${notations}`
      // The tab belongs to the sounding event, so a chord carries it once rather than
      // printing the same token under every notehead.
      + `${i === 0 ? lyric : ''}</note>`;
  }).join('');
}

function measureXml(measure: ScoreMeasure): string {
  const attributes = measure.attributes
    ? `<attributes><divisions>${measure.attributes.divisions}</divisions>`
      + `<key><fifths>${measure.attributes.keyFifths}</fifths></key>`
      + `<time><beats>${measure.attributes.beats}</beats>`
      + `<beat-type>${measure.attributes.beatType}</beat-type></time>`
      + `<clef><sign>G</sign><line>2</line></clef></attributes>`
    : '';
  const tempo = measure.tempoBpm !== undefined
    ? `<direction placement="above"><direction-type><metronome>`
      + `<beat-unit>quarter</beat-unit><per-minute>${Math.round(measure.tempoBpm)}</per-minute>`
      + `</metronome></direction-type></direction>`
    : '';

  return `<measure number="${measure.number}">${attributes}${tempo}`
    + `${measure.elements.map(noteXml).join('')}</measure>`;
}

/**
 * The name a part goes out under.
 *
 * A single-part file says `Harmonica` and nothing else — that is what every tab a user has
 * ever exported looks like. A multi-part file names the harp each track is written for,
 * because two tracks of one arrangement legitimately sit on different harps and a reader
 * cannot pick that up from the notes.
 */
function partName(part: ScorePart, total: number): string {
  return total === 1 ? part.name : `${part.name} (${part.key} harp)`;
}

export function scoreToMusicXml(doc: ScoreDocument): string {
  const partList = doc.parts
    .map((p) => `<score-part id="${p.id}"><part-name>${xmlText(partName(p, doc.parts.length))}`
      + `</part-name></score-part>`)
    .join('');

  const bodies = doc.parts
    .map((p) => `<part id="${p.id}">${p.measures.map(measureXml).join('')}</part>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${xmlText(doc.title)}</work-title></work>
  <identification><encoding><software>Harp2Tab</software><encoding-date>${doc.encodingDate}</encoding-date></encoding></identification>
  <part-list>${partList}</part-list>
  ${bodies}
</score-partwise>`;
}

/** Exported for the harness: a measure's durations must sum to this, or the file will not open. */
export const DIVISIONS_PER_QUARTER = TICKS_PER_QUARTER;
