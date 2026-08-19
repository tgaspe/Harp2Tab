/**
 * The app's two typefaces, and the rule for choosing between them.
 *
 * **Space Grotesk is the display face**: screen titles, modal headings, section headings,
 * the wordmark, and large numerics. **Poppins is the body face**: everything else —
 * card and list-row titles, labels, buttons, metadata, prose.
 *
 * The split is by *rank*, not by variable name. A style called `title` on a modal is
 * display rank and takes Space Grotesk; a style called `title` on a library row is content
 * inside a card and takes Poppins. Both are correct.
 *
 * Only the weights below are loaded (see `_layout.tsx`, which gates first paint on all of
 * them). Adding a weight here means adding a font file to the critical render path, so
 * prefer an existing one.
 */
export const Poppins = {
  regular:   'Poppins_400Regular',
  medium:    'Poppins_500Medium',
  semiBold:  'Poppins_600SemiBold',
  bold:      'Poppins_700Bold',
  extraBold: 'Poppins_800ExtraBold',
} as const;

export const SpaceGrotesk = {
  regular:  'SpaceGrotesk_400Regular',
  medium:   'SpaceGrotesk_500Medium',
  bold:     'SpaceGrotesk_700Bold',
} as const;
