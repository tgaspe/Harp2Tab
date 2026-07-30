export interface Theme {
  bg:          string;
  surface:     string;
  surfaceAlt:  string;
  border:      string;
  accent:      string;
  accentDim:   string;
  accentSoft:  string;
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

/** Zinc-950 palette — same as Linear / Vercel dark */
export const darkTheme: Theme = {
  bg:          '#09090B',
  surface:     '#18181B',
  surfaceAlt:  '#27272A',
  border:      'rgba(255,255,255,0.07)',
  accent:      '#0cc0df',
  accentDim:   '#09a8c4',
  accentSoft:  'rgba(12,192,223,0.14)',
  record:      '#EF4444',
  recordDim:   '#DC2626',
  recordSoft:  'rgba(239,68,68,0.14)',
  success:     '#22C55E',
  successDim:  '#16A34A',
  successSoft: 'rgba(34,197,94,0.14)',
  warning:     '#F59E0B',
  warningDim:  '#D97706',
  warningSoft: 'rgba(245,158,11,0.14)',
  textPrimary: '#FAFAFA',
  textSub:     '#A1A1AA',
  textMuted:   '#3F3F46',
  cardBg:      '#18181B',
  separator:   'rgba(255,255,255,0.06)',
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
