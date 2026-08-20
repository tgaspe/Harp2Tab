import { Platform } from 'react-native';
/**
 * Cross-screen visual tokens.
 *
 * Split from `layout.ts`, which owns *page* geometry (max content widths, screen padding).
 * These are the small shared decisions that were previously re-decided per file and drifted:
 * Home alone shipped eight distinct corner radii and three near-identical section labels.
 */
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { FONT } from '@/constants/keys';

/**
 * The corner-radius scale.
 *
 * Four steps, chosen so the difference between any two is legible at a glance — the old
 * ad-hoc set (8/10/12/14/16/20/24) had buttons at three radii nobody could tell apart.
 *
 * - `sm`   — controls that sit *inside* something: rows, segments, dropdown options.
 * - `md`   — cards, inputs, buttons, popovers. The default; when unsure, this one.
 * - `lg`   — large page-level surfaces (empty states, hero-scale panels).
 * - `full` — pills, badges, anything whose ends should read as semicircles.
 */
export const RADIUS = {
  sm:   8,
  md:   12,
  lg:   20,
  full: 999,
} as const;

/**
 * Section headings in a page's main column ("Harmonica Tabs · 4").
 *
 * These were 11px Poppins-bold at 1.2 tracking, all-caps — the treatment you give a form
 * fieldset legend or a debug label, not the treatment you give the heading that names the
 * most important content on the page. At 11px muted they sat *below* the card metadata
 * underneath them in the visual order, which is backwards.
 *
 * Colour is set by the caller, but in the main column it should be `textPrimary`: a heading
 * that names real content is not de-emphasis.
 *
 * Space Grotesk, like the page title above it — see `constants/fonts.ts`. That makes the
 * main column one display-face ladder separated by size alone (page title 26 → section 17),
 * with the body face taking over at card level. `GROUP_LABEL` below stays Poppins: rail
 * labels are chrome, not structure.
 */
export const SECTION_HEADING = {
  fontSize:      FONT.md,
  fontFamily:    SpaceGrotesk.bold,
  letterSpacing: -0.1,
} as const;

/**
 * The rank below `SECTION_HEADING` — grouping labels inside chrome ("Quick actions",
 * "Type", "Key"). Still small, because a rail label is genuinely secondary, but no longer
 * caps-and-tracking: sentence case at 13px reads as product UI where 11px tracked caps
 * reads as a developer annotation.
 */
export const GROUP_LABEL = {
  fontSize:      FONT.sm,
  fontFamily:    Poppins.semiBold,
  letterSpacing: 0,
} as const;

/**
 * Whether the viewer has asked the OS for less motion.
 *
 * Read once at module load rather than subscribed to: it only picks which *kind* of hover
 * feedback a control gets, and something silently changing its behaviour mid-session because
 * a system preference flipped would be stranger than the staleness.
 */
export const PREFERS_REDUCED_MOTION =
  Platform.OS === 'web'
  && typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
