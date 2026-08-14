/**
 * Design tokens for the marketing landing page (12-3).
 *
 * These mirror `darkTheme` in `src/theme/index.ts` by value but are deliberately a separate,
 * plain-string copy rather than an import of it. Two reasons:
 *
 * 1. `useTheme()` reads `useSettingsStore`, and any store read on this page would stop it
 *    rendering into the static HTML export — which is the entire reason the page exists.
 * 2. The landing page is **not** theme-reactive. It commits to dark in both browser themes,
 *    because `accent` is only ~2.2:1 against white (see the note on `accentDeep` in the theme
 *    file), so a light variant could not use the brand cyan for any text or small element.
 *
 * If the app's palette ever changes, this file is the one place to follow it.
 */
import { Poppins, SpaceGrotesk } from '@/constants/fonts';

export const LANDING_COLORS = {
  bg:        '#1A1A1E',
  surface:   '#232329',
  card:      '#2E2E35',
  border:    'rgba(255,255,255,0.10)',
  accent:    '#0cc0df',
  accentDim: '#09a8c4',
  accentSoft: 'rgba(12,192,223,0.14)',
  text:      '#F2F2F4',
  textSub:   '#B0B0BA',
  textMuted: '#95959F',
} as const;

/**
 * Font stacks, with real fallbacks in front of the loaded families.
 *
 * `_layout.tsx` gates the app on `useFonts`, but this page must paint before the webfonts
 * resolve — it is the LCP surface — so every stack ends in something the browser already has.
 */
export const LANDING_FONTS = {
  display: `'${SpaceGrotesk.bold}', 'Space Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`,
  body:    `'${Poppins.regular}', 'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`,
  bodyMed: `'${Poppins.medium}', 'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`,
  bodyBold: `'${Poppins.semiBold}', 'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`,
} as const;

/** Where "Get it on Google Play" points. The live listing, not a placeholder. */
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.chewpacastudios.harp2tab';

/**
 * The photographs' intrinsic sizes, used for the `width`/`height` attributes that hold
 * cumulative layout shift at zero. Regenerate the files with `scripts/build-landing-images.py`,
 * which prints each source's real ratio — these two differ by a pixel and are not swappable.
 */
export const HERO_INTRINSIC = { width: 1920, height: 1277 } as const;
export const CLOSER_INTRINSIC = { width: 1920, height: 1278 } as const;
