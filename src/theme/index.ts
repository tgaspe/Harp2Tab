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
  cardBg:      string;
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
  cardBg:      '#232329',
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
  cardBg:      '#FAFAFA',
  separator:   'rgba(0,0,0,0.06)',
  isDark:      false,
};
