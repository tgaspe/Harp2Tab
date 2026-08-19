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
   *  the shell, and the lighter of the rail/library pair. The tint moved off the rail and
   *  onto `libraryBg`: with the rail washed and the library plain, the supporting column
   *  was the coloured one and the content it supports was the neutral one, which had the
   *  emphasis backwards. Now the rail recedes by being plain and the library sits on a
   *  faint wash, so the two regions still separate without the rail claiming the colour. */
  railBg:      string;
  /** The rail's hairlines — its right edge *and* the borders of the controls sitting on it.
   *  Tinted with the accent rather than reusing `border`, which on a plain rail leaves the
   *  buttons as neutral outlines indistinguishable from the panel behind them. */
  railBorder:  string;
  /** Ground for the web library column (the scrolling half of the app shell, beside the
   *  rail). A faint accent wash — the tint the rail used to carry. Cards on this page are
   *  `cardBg`, so the wash is also what gives them an edge without a heavier border. */
  libraryBg:   string;
  /** Fill for the full-height sidebar rails (Home + Editor). Split from `accent`
   *  because those rails are a large field of color carrying white text, while
   *  `accent` also has to work as small text/icons on dark surfaces — one value
   *  can't be both bright enough for the latter and calm enough for the former. */
  sidebarBg:   string;
  record:      string;
  recordDim:   string;
  recordSoft:  string;
  success:     string;
  successDim:  string;
  successSoft: string;
  warning:     string;
  warningDim:  string;
  warningSoft: string;
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
  // Deliberately *darker* than bg rather than brighter: at this page lightness a
  // bright rail is the thing that glares, so the rail recedes and the white text
  // on it does the work. Separation from bg is only ~2.4:1, which is why the rail
  // also carries a light hairline on its right edge instead of the light-mode black one.
  sidebarBg:   '#0A5F6D',
  // Dark mode can't use a pale wash, so the tint goes the other way: a panel at roughly
  // `surface`'s lightness, pulled toward cyan. Neutral `surface` beside a neutral top bar
  // has the same welding problem here as it does in light mode.
  // The dark counterpart of the light pair: the rail is the plain, slightly-raised
  // neutral (white's role here) and the library is the faintly cool-tinted ground it
  // sits beside — same relationship, inverted lightness.
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
  // Light mode keeps the bright rail — it already reads well against a white page.
  sidebarBg:   '#0cc0df',
  railBg:      '#FFFFFF',
  railBorder:  'rgba(12,192,223,0.28)',
  libraryBg:   '#F2F8FA',
  record:      '#EF4444',
  recordDim:   '#DC2626',
  recordSoft:  'rgba(239,68,68,0.08)',
  success:     '#22C55E',
  successDim:  '#16A34A',
  successSoft: 'rgba(34,197,94,0.08)',
  warning:     '#F59E0B',
  warningDim:  '#D97706',
  warningSoft: 'rgba(245,158,11,0.08)',
  textPrimary: '#09090B',
  textSub:     '#52525B',
  textMuted:   '#A1A1AA',
  cardBg:      '#FFFFFF',
  cardHover:   '#F4F4F5',
  separator:   'rgba(0,0,0,0.06)',
  isDark:      false,
};
