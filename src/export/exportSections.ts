/**
 * The format lists each export surface offers, in one place so the editor's dropdown, the
 * native export page and the Studio's popup cannot drift apart.
 *
 * Audio is appended only on web (`Platform.OS === 'web'`): the renderer is an
 * `OfflineAudioContext`, which native has no equivalent of, so offering the option there
 * would be a button that can only fail.
 *
 * Sheet music (Phase 18) is web-only for the same shape of reason — its renderer is
 * OpenSheetMusicDisplay, a DOM library — and is a third family beside the text formats for
 * the same reason audio is: a paginated score is binary and can be several files, which
 * `generateForFormat`'s single `content` string cannot express.
 */

import { Platform } from 'react-native';

import type { ExportFormatSection } from '@/components/ExportFormatSections';
import { EXPORT_FORMATS, EXPORT_FORMAT_META } from '@/constants/keys';
import { AUDIO_EXPORT_FORMATS, AUDIO_FORMAT_META, type AudioExportFormat } from './audioFormats';
import { SCORE_EXPORT_FORMATS, SCORE_FORMAT_META } from './scoreFormats';

export const audioExportSupported = Platform.OS === 'web';
export const scoreExportSupported = Platform.OS === 'web';

const TAB_OPTIONS = EXPORT_FORMATS.map((id) => ({ id, ...EXPORT_FORMAT_META[id] }));
const AUDIO_OPTIONS = AUDIO_EXPORT_FORMATS.map((id) => ({ id, ...AUDIO_FORMAT_META[id] }));
const SCORE_OPTIONS = SCORE_EXPORT_FORMATS.map((id) => ({ id, ...SCORE_FORMAT_META[id] }));

export function isAudioFormat(id: string): id is AudioExportFormat {
  return (AUDIO_EXPORT_FORMATS as string[]).includes(id);
}

/** The editor: every text format, plus sheet music and audio on web. */
export function tabExportSections(): ExportFormatSection[] {
  const sections: ExportFormatSection[] = [{ title: 'TAB & DATA', options: TAB_OPTIONS }];
  // Above audio: it is a rendering of the notes, like the formats it sits under, where audio
  // is a performance of them.
  if (scoreExportSupported) sections.push({ title: 'SHEET MUSIC', options: SCORE_OPTIONS });
  if (audioExportSupported) sections.push({ title: 'AUDIO', options: AUDIO_OPTIONS });
  return sections;
}

/**
 * The Studio: MIDI plus audio, and deliberately not the tab formats.
 *
 * Nothing in a Studio project has been fitted to a harmonica, so a tab export would be a
 * lossy rendering of the project rather than the project — the same reasoning that made
 * Download MIDI a MIDI download in Phase 11.
 */
export function projectExportSections(): ExportFormatSection[] {
  const midi = { id: 'MIDI', ...EXPORT_FORMAT_META.MIDI };
  const sections: ExportFormatSection[] = [{ title: 'PROJECT', options: [midi] }];
  if (audioExportSupported) sections.push({ title: 'AUDIO', options: AUDIO_OPTIONS });
  return sections;
}
