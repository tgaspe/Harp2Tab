/**
 * The format lists each export surface offers, in one place so the editor's dropdown, the
 * native export page and the Studio's popup cannot drift apart.
 *
 * Audio is appended only on web (`Platform.OS === 'web'`): the renderer is an
 * `OfflineAudioContext`, which native has no equivalent of, so offering the option there
 * would be a button that can only fail.
 */

import { Platform } from 'react-native';

import type { ExportFormatSection } from '@/components/ExportFormatSections';
import { EXPORT_FORMATS, EXPORT_FORMAT_META } from '@/constants/keys';
import { AUDIO_EXPORT_FORMATS, AUDIO_FORMAT_META, type AudioExportFormat } from './audioFormats';

export const audioExportSupported = Platform.OS === 'web';

const TAB_OPTIONS = EXPORT_FORMATS.map((id) => ({ id, ...EXPORT_FORMAT_META[id] }));
const AUDIO_OPTIONS = AUDIO_EXPORT_FORMATS.map((id) => ({ id, ...AUDIO_FORMAT_META[id] }));

export function isAudioFormat(id: string): id is AudioExportFormat {
  return (AUDIO_EXPORT_FORMATS as string[]).includes(id);
}

/** The editor: every text format, plus audio on web. */
export function tabExportSections(): ExportFormatSection[] {
  const sections: ExportFormatSection[] = [{ title: 'TAB & DATA', options: TAB_OPTIONS }];
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
