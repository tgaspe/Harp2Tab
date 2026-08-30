/**
 * The grouped format picker shared by every export surface.
 *
 * Phase 17 gave the app two families of export format that cannot share a type: the five
 * text formats behind `generateForFormat`, and WAV/MP3/OGG, which are rendered audio and have
 * no string form. Both appear in the same popup, under headings, so the list that draws them
 * is generic over `{ id, label, description, icon }` and neither union appears here.
 *
 * Only the list is shared. The chrome around it is genuinely different per screen — the
 * editor has an anchored dropdown *and* a centered modal variant, the export screen is a
 * full page — so wrapping styles arrive as props rather than being flattened into one
 * component with three layout modes.
 */

import React from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { ExportOption } from './ExportOption';

export interface ExportFormatDef {
  id: string;
  label: string;
  description: string;
  /** Ionicons name. */
  icon: string;
}

export interface ExportFormatSection {
  /** Rendered above the group. Omit for a single unlabelled group. */
  title?: string;
  options: ExportFormatDef[];
}

interface Props {
  sections: ExportFormatSection[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Style for a section heading, so the page and the dropdown can differ. */
  titleStyle?: StyleProp<TextStyle>;
  /** Style for the card around each group. */
  groupStyle?: StyleProp<ViewStyle>;
  /** Optional layout for each heading + group pair (used by wide desktop dialogs). */
  sectionStyle?: StyleProp<ViewStyle>;
  /** Optional layout for the collection of sections. */
  sectionsStyle?: StyleProp<ViewStyle>;
  optionVariant?: 'row' | 'tile';
}

export function ExportFormatSections({
  sections, selectedId, onSelect, titleStyle, groupStyle, sectionStyle, sectionsStyle,
  optionVariant = 'row',
}: Props) {
  const content = sections.map((section) => {
    const sectionContent = (
      <>
        {section.title ? <Text style={titleStyle}>{section.title}</Text> : null}
        <View style={groupStyle}>
          {section.options.map((option, i) => (
            <ExportOption
              key={option.id}
              id={option.id}
              label={option.label}
              description={option.description}
              icon={option.icon}
              isSelected={selectedId === option.id}
              onSelect={onSelect}
              showDivider={i < section.options.length - 1}
              variant={optionVariant}
            />
          ))}
        </View>
      </>
    );

    return sectionStyle ? (
      <View key={section.title ?? 'default'} style={sectionStyle}>{sectionContent}</View>
    ) : (
      <React.Fragment key={section.title ?? 'default'}>{sectionContent}</React.Fragment>
    );
  });

  if (sectionsStyle) return <View style={sectionsStyle}>{content}</View>;

  return (
    <>{content}</>
  );
}
