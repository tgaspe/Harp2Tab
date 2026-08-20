export interface Theme {
  bg:          string;
  surface:     string;
  surfaceAlt:  string;
  border:      string;
  accent:      string;
  accentDim:   string;
  accentSoft:  string;
  /** Accent dark enough to carry white text, or to read as text on a white fill.
   *  Plain `accent` is only ~2.2:1 against white, so it can't do either job. */
  accentDeep:  string;
  /** Fill for the web app shell's left rail (Home, Profile) — the *cleanest* surface in
   *  the shell, and the lighter of the rail/library pair. The rail was once the washed one
   *  and the library plain, which had the emphasis backwards: the supporting column was
   *  carrying the colour and the content it supports was neutral. The rail recedes by being
   *  plain instead, and `libraryBg` is the darker ground beside it. That separation is now
   *  purely tonal — the wash the library used to carry is gone, so neither region is
   *  tinted; see `libraryBg`. */
  railBg:      string;
  /** The rail's hairlines — its right edge *and* the borders of the controls sitting on it.
   *  Tinted with the accent rather than reusing `border`, which on a plain rail leaves the
   *  buttons as neutral outlines indistinguishable from the panel behind them. */
  railBorder:  string;
  /** Ground for the web library column (the scrolling half of the app shell, beside the
   *  rail). Cards on this page are `cardBg` — white in light mode — so this is what gives
   *  them an edge without a heavier border, and it has to stay clear of `cardHover` too or
   *  hovering a card sinks it into the page instead of lifting it.
   *
   *  A plain cool grey, not the accent wash it used to be. The old value read as a pale
   *  blue panel rather than as ground, which put a colour on the largest surface in the app
   *  and left the accent competing with its own background. This sits between `surface`
   *  (#F4F4F5) and `surfaceAlt` (#E4E4E7), so it adds no hue the palette didn't already
   *  have — the rail is white, the library is grey, and the only cyan on the page belongs
   *  to controls. */
  libraryBg:   string;
  record:      string;
  recordDim:   string;
  recordSoft:  string;
  success:     string;
  successDim:  string;
  successSoft: string;
  warning:     string;
  warningDim:  string;
  warningSoft: string;
  /** The MIDI-project mark — the glyph in a project card's tile, and `projectSoft` the tile
   *  behind it. A yellow of its own rather than `warning`, which is already spoken for twice
   *  on the library page: the favourite star (`RecordingCard`) and the import alert. Sharing
   *  the token would have put a project tile and a favourited recording's star in the same
   *  amber a few pixels apart, and left the two impossible to retune separately. Pulled
   *  toward yellow and away from `warning`'s orange for the same reason. */
  project:     string;
  projectSoft: string;
  textPrimary: string;
  textSub:     string;
  textMuted:   string;
  /** Fill for cards — library rows, project cards. A card sits *above* the page, so this is
   *  never darker than `bg`: light mode's cards used to be `surface` on a white page, which
   *  is elevation upside down and reads as a row of wells. The card's edge does the
   *  separating; the fill only has to stay out of the way. */
  cardBg:      string;
  /** A card under the cursor. The reason `cardBg` matters: with the card at page lightness
   *  there is finally somewhere for hover to *go*. The old grey-on-white cards could only
   *  fade their opacity, which reads as "disabled", not "hover". */
  cardHover:   string;
  separator:   string;
  isDark:      boolean;
}

/** Zinc-900 palette — lifted off pure black so the UI reads as a surface rather
 *  than a void, and so elevation between bg / card / surfaceAlt stays visible. */
export const darkTheme: Theme = {
  bg:          '#1A1A1E',
  surface:     '#232329',
  surfaceAlt:  '#2E2E35',
  border:      'rgba(255,255,255,0.10)',
  accent:      '#0cc0df',
  accentDim:   '#09a8c4',
  accentSoft:  'rgba(12,192,223,0.14)',
  accentDeep:  '#0E7180',
  // The dark counterpart of the light pair: the rail is the plain, slightly-raised neutral
  // (white's role here) and the library is the ground it sits beside — same relationship,
  // inverted lightness.
  railBg:      '#202027',
  railBorder:  'rgba(12,192,223,0.22)',
  libraryBg:   '#14191B',
  record:      '#EF4444',
  recordDim:   '#DC2626',
  recordSoft:  'rgba(239,68,68,0.14)',
  success:     '#22C55E',
  successDim:  '#16A34A',
  successSoft: 'rgba(34,197,94,0.14)',
  warning:     '#F59E0B',
  warningDim:  '#D97706',
  warningSoft: 'rgba(245,158,11,0.14)',
  // Full-strength yellow-400: on a dark tile it clears 7:1, so dark mode can afford the
  // literal yellow that light mode cannot.
  project:     '#FACC15',
  projectSoft: 'rgba(250,204,21,0.14)',
  textPrimary: '#F2F2F4',
  textSub:     '#B0B0BA',
  // Was #3F3F46 — only 1.7:1 on cardBg, i.e. effectively invisible. This is a
  // de-emphasis color, not a decorative one: it still has to clear 4.5:1 against
  // the *lightest* surface it lands on (surfaceAlt), not just against bg.
  textMuted:   '#95959F',
  // Dark mode was already right — cards lighter than the page — so this is unchanged.
  cardBg:      '#232329',
  cardHover:   '#2E2E35',
  separator:   'rgba(255,255,255,0.08)',
  isDark:      true,
};

/** Zinc-100 palette — clean white light mode */
export const lightTheme: Theme = {
  bg:          '#FFFFFF',
  surface:     '#F4F4F5',
  surfaceAlt:  '#E4E4E7',
  border:      '#E4E4E7',
  accent:      '#0cc0df',
  accentDim:   '#09a8c4',
  accentSoft:  'rgba(12,192,223,0.08)',
  accentDeep:  '#0E7180',
  railBg:      '#FFFFFF',
  railBorder:  'rgba(12,192,223,0.28)',
  // 1.08:1 against a white card. Slight, but the old '#F2F8FA' managed 1.07:1 *and* wore a
  // blue cast to get there — this is the same weight of separation done with tone alone.
  //
  // This is the floor, and it is set by `cardHover` (#F4F4F5) sitting one hair above it:
  // any lighter and a hovered card would be *darker* than the page it sits on, so pointing
  // at a card would sink it instead of lifting it. Only `prefers-reduced-motion` viewers
  // ever see that — everyone else gets the scale hover — but the fallback has to work, so
  // the limit is real. Going lighter than this means dropping `cardHover` first to keep the
  // gap; changing one without the other inverts the relationship.
  libraryBg:   '#F3F3F5',
  record:      '#EF4444',
  recordDim:   '#DC2626',
  recordSoft:  'rgba(239,68,68,0.08)',
  success:     '#22C55E',
  successDim:  '#16A34A',
  successSoft: 'rgba(34,197,94,0.08)',
  warning:     '#F59E0B',
  warningDim:  '#D97706',
  warningSoft: 'rgba(245,158,11,0.08)',
  // The same yellow-400 dark mode uses, by explicit request — the two themes render this
  // glyph identically. Note what that costs on a white page: against `projectSoft` below it
  // measures 1.4:1, so the mark reads as a shape in the tile's own colour rather than as an
  // icon drawn on it. Deepening it (yellow-700 `#A16207` gets 4.7:1) or darkening the tile
  // under it are the two ways back if the glyph turns out to be too faint to find.
  project:     '#FACC15',
  // Carried heavier than the other `*Soft` values here (0.18 vs 0.08). At light mode's usual
  // weight yellow lands on #FFFDF5, which is white with a rumour of colour — the one hue in
  // the palette that needs more of itself to register at all.
  projectSoft: 'rgba(250,204,21,0.18)',
  textPrimary: '#09090B',
  textSub:     '#52525B',
  textMuted:   '#A1A1AA',
  cardBg:      '#FFFFFF',
  cardHover:   '#F4F4F5',
  separator:   'rgba(0,0,0,0.06)',
  isDark:      false,
};
