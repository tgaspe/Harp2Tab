/**
 * The landing page's stylesheet (12-3), injected as a single `<style>` block.
 *
 * Written as plain CSS rather than react-native-web styles on purpose. The page has to emit
 * real `<h1>`/`<h2>` elements for search engines — `Text` renders as a `<div>` — and it needs
 * `<picture>`/`srcset`, gradient scrims, `@media` and `prefers-reduced-motion`, none of which
 * the RN style system expresses. See the note at the top of `LandingPage.web.tsx`.
 *
 * Every class is prefixed `lp-` so nothing here can reach the app's own surfaces, which share
 * a document with this page whenever a visitor navigates from `/` to `/app` without a reload.
 */
import { LANDING_COLORS as C, LANDING_FONTS as F } from './tokens';

export const LANDING_CSS = `
.lp-root {
  /* The app renders inside a flex/height-constrained RN tree, so the page cannot rely on the
     document scrolling. Owning its own scroll box makes the layout independent of whatever
     the navigator wraps it in. */
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: ${C.bg};
  color: ${C.text};
  font-family: ${F.body};
  font-size: 18px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
.lp-root *, .lp-root *::before, .lp-root *::after { box-sizing: border-box; }
.lp-root h1, .lp-root h2, .lp-root h3, .lp-root p, .lp-root ul, .lp-root figure { margin: 0; }
.lp-root ul { padding: 0; list-style: none; }

.lp-root h1, .lp-root h2, .lp-root h3 {
  font-family: ${F.display};
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.lp-root a { color: ${C.accent}; text-decoration: none; }
.lp-root a:hover { text-decoration: underline; }

/* One visible focus treatment for every interactive element on the page. */
.lp-root :focus-visible {
  outline: 2px solid ${C.accent};
  outline-offset: 3px;
  border-radius: 4px;
}

.lp-wrap { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; }

/* ---------------------------------------------------------------- header */

.lp-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: 72px;
  /* Transparent over the photograph; the scrolled state is applied from JS. */
  background: transparent;
  border-bottom: 1px solid transparent;
  transition: background-color 200ms ease, border-color 200ms ease;
}
.lp-header--scrolled {
  background: ${C.surface};
  border-bottom-color: ${C.border};
}
.lp-header__inner {
  width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
}
/* These next rules are written as ".lp-root .x" rather than ".x" on purpose. The base link
   colour above is ".lp-root a", which scores 0,1,1 — a bare ".lp-logo" or ".lp-btn--primary"
   scores 0,1,0 and silently loses to it, which paints the logo cyan and the primary button
   cyan-on-cyan. Matching the class count is what makes these win. */
/* A copy of the app's own header mark, not an interpretation of it. Every value here is taken
   from "logoRow" / "logoIcon" / "logoText" in src/components/TopBar.web.tsx: 42px icon, 10px
   gap, 7px/10px padding, 8px radius, surfaceAlt on hover, and the wordmark in Space Grotesk
   Bold at FONT.lg (20px) in accent cyan with letterSpacing -0.3 — mixed case, not uppercased.
   A visitor crossing from / to /app should see the mark not change at all. */
.lp-root .lp-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  font-family: ${F.display};
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: ${C.accent};
  transition: background-color 160ms ease;
}
.lp-root .lp-logo img { display: block; width: 42px; height: 42px; }
.lp-root .lp-logo:hover { text-decoration: none; background: ${C.card}; }
.lp-nav { display: flex; align-items: center; gap: 28px; }
.lp-nav a { color: ${C.textSub}; font-size: 15px; }
.lp-nav a:hover { color: ${C.text}; text-decoration: none; }

/* ---------------------------------------------------------------- buttons */

.lp-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 8px;
  padding: 14px 26px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-family: ${F.bodyBold};
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease, transform 160ms ease;
}
.lp-btn:hover { text-decoration: none; transform: translateY(-1px); }
.lp-root .lp-btn--primary { background: ${C.accent}; color: #06232A; }
.lp-root .lp-btn--primary:hover { background: ${C.accentDim}; }
.lp-root .lp-btn--ghost {
  background: rgba(255,255,255,0.06);
  border-color: ${C.border};
  color: ${C.text};
}
.lp-root .lp-btn--ghost:hover { background: rgba(255,255,255,0.12); }
.lp-btn--sm { padding: 10px 18px; font-size: 15px; }

/* ---------------------------------------------------------------- hero */

.lp-hero {
  position: relative;
  /* svh, not vh: with vh the mobile URL bar collapsing re-lays-out the whole hero. */
  min-height: min(88svh, 860px);
  display: flex;
  flex-direction: column;
  isolation: isolate;
}
/* Stacked with positive indices rather than negative ones. A negative z-index here would put
   the photograph behind ".lp-root"'s own opaque background and hide it completely, because
   the "isolation: isolate" on ".lp-hero" makes it the stacking context's root. */
.lp-hero__media { position: absolute; inset: 0; z-index: 0; }
.lp-hero__media img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 60%; display: block; }

/* Two scrims. The horizontal one is measured against the photograph: its left third sits at
   0.003-0.028 relative luminance (white text is 12:1 there unaided), but the lit guitar face
   at ~40% across reaches 0.359, where unscrimmed white text would be 2.3:1 and fail. Holding
   70% opacity out to 55% width is what keeps sub-text at 4.6:1 rather than 3.4:1 — it is a
   contrast requirement, not a taste setting. */
.lp-hero__scrim {
  position: absolute; inset: 0; z-index: 1;
  background:
    linear-gradient(180deg, transparent 55%, ${C.bg} 100%),
    linear-gradient(90deg,
      rgba(26,26,30,0.88) 0%,
      rgba(26,26,30,0.88) 34%,
      rgba(26,26,30,0.70) 55%,
      rgba(26,26,30,0.25) 72%,
      transparent 88%);
}
.lp-hero__body {
  position: relative;
  z-index: 2;
  flex: 1;
  display: flex;
  align-items: center;
  padding: 64px 0 96px;
}
.lp-hero__content { max-width: 560px; }
.lp-hero h1 {
  font-size: clamp(38px, 6.4vw, 64px);
  margin-bottom: 20px;
}
.lp-hero__sub {
  font-size: clamp(17px, 2.1vw, 20px);
  color: ${C.textSub};
  margin-bottom: 20px !important;
  max-width: 34em;
}
.lp-hero__actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 32px; }
.lp-hero__note { margin-top: 18px !important; font-size: 14px; color: ${C.textMuted}; }

/* The page's signature: harmonica tab notation, always Space Grotesk Bold in accent cyan. */
.lp-tabline {
  display: flex; flex-wrap: wrap; gap: 14px;
  font-family: ${F.display};
  font-size: 22px;
  letter-spacing: 0.08em;
  color: ${C.accent};
}

/* ---------------------------------------------------------------- sections */

.lp-section { padding: 120px 0; }
.lp-section--alt { background: ${C.surface}; }
.lp-section__head { max-width: 720px; margin-bottom: 56px; }
.lp-section h2 { font-size: clamp(28px, 4vw, 40px); margin-bottom: 16px; }
.lp-section__lead { color: ${C.textSub}; font-size: 19px; }
.lp-eyebrow {
  display: inline-block;
  font-family: ${F.bodyBold};
  font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase;
  color: ${C.accent};
  background: ${C.accentSoft};
  padding: 6px 12px; border-radius: 999px;
  margin-bottom: 20px;
}

/* Alternating feature rows — the three entry points. */
.lp-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 64px;
  align-items: center;
  padding: 56px 0;
}
.lp-row + .lp-row { border-top: 1px solid ${C.border}; }
.lp-row--flip .lp-row__media { order: -1; }
.lp-row h3 { font-size: 26px; margin-bottom: 14px; }
.lp-row p { color: ${C.textSub}; }
.lp-row__media {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 16px;
  padding: 28px;
  min-height: 220px;
  display: flex; flex-direction: column; justify-content: center; gap: 14px;
}
.lp-row__hint { font-size: 14px; color: ${C.textMuted}; }

/* ---------------------------------------------------------------- the try-it panel */

/* One surface holding the demo and the key lab. The card chrome lives here rather than on
   each child so the two read as one instrument rather than two unrelated widgets — the lab
   works on whatever the demo just produced, and the panel is what says so. */
.lp-panel {
  position: relative;
  background:
    linear-gradient(180deg, rgba(12,192,223,0.05) 0%, transparent 220px),
    ${C.card};
  border: 1px solid ${C.border};
  border-radius: 20px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(12,192,223,0.16),
    0 28px 70px rgba(0,0,0,0.42);
}
/* A hairline of brand colour across the top edge — the one flourish on the page, and it is
   here because this panel is the thing the page most wants you to touch. */
.lp-panel::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, ${C.accent}, transparent);
  opacity: 0.65;
}
.lp-panel__rule { height: 1px; background: ${C.border}; }

/* ---------------------------------------------------------------- keys + notation */

.lp-keygrid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 48px;
}
.lp-key {
  display: flex; align-items: center; justify-content: center;
  padding: 18px 0;
  border-radius: 12px;
  background: ${C.card};
  border: 1px solid ${C.border};
  font-family: ${F.display};
  font-size: 20px;
}
/* Section sub-heading, for the groups inside the keys/notation section. Smaller and quieter
   than an .lp-row h3, which is a feature title rather than a label. */
.lp-subhead {
  font-size: 15px !important;
  font-family: ${F.bodyBold} !important;
  font-weight: 400 !important;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${C.textMuted};
  margin-bottom: 18px !important;
}
.lp-subhead + .lp-legend, .lp-subhead + .lp-keygrid { margin-bottom: 44px; }

.lp-legend { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
.lp-legend__item {
  border-left: 2px solid ${C.accent};
  padding-left: 16px;
}
.lp-legend__sym {
  font-family: ${F.display};
  font-size: 24px;
  color: ${C.accent};
  letter-spacing: 0.06em;
  display: block;
  margin-bottom: 4px;
}
.lp-legend__desc { font-size: 15px; color: ${C.textSub}; }

/* ---------------------------------------------------------------- exports */

.lp-formats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
.lp-format {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 14px;
  padding: 22px;
}
.lp-format__name {
  font-family: ${F.display};
  font-size: 18px;
  margin-bottom: 8px;
  display: block;
}
.lp-format__desc { font-size: 14px; color: ${C.textMuted}; line-height: 1.5; }

/* ---------------------------------------------------------------- pricing */

.lp-plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; align-items: start; }
.lp-plan {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 18px;
  padding: 32px;
  position: relative;
}
.lp-plan--featured {
  border-color: ${C.accent};
  box-shadow: 0 0 0 1px ${C.accent}, 0 18px 50px rgba(0,0,0,0.35);
}
.lp-plan__badge {
  position: absolute; top: -13px; left: 32px;
  background: ${C.accent}; color: #06232A;
  font-family: ${F.bodyBold}; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
  padding: 5px 12px; border-radius: 999px;
}
.lp-plan__name { font-family: ${F.display}; font-size: 20px; margin-bottom: 12px; display: block; }
.lp-plan__price { font-family: ${F.display}; font-size: 44px; line-height: 1; }
.lp-plan__cadence { color: ${C.textMuted}; font-size: 15px; margin-left: 6px; }
.lp-plan__note { color: ${C.textSub}; font-size: 15px; margin-top: 12px !important; }
.lp-perks { margin-top: 26px; display: flex; flex-direction: column; gap: 12px; }
.lp-perk { display: flex; gap: 10px; font-size: 15px; color: ${C.textSub}; }
.lp-perk::before { content: '✓'; color: ${C.accent}; font-family: ${F.bodyBold}; }
.lp-pricing__foot {
  margin-top: 40px;
  padding: 24px;
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 14px;
  font-size: 16px;
  color: ${C.textSub};
}
.lp-pricing__foot strong { color: ${C.text}; font-family: ${F.bodyBold}; font-weight: 400; }

/* ---------------------------------------------------------------- faq */

.lp-faq { display: grid; gap: 16px; max-width: 820px; }
.lp-faq details {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 14px;
  padding: 22px 26px;
}
.lp-faq summary {
  font-family: ${F.bodyBold};
  font-size: 18px;
  cursor: pointer;
  list-style: none;
}
.lp-faq summary::-webkit-details-marker { display: none; }
.lp-faq summary::after { content: '＋'; float: right; color: ${C.accent}; }
.lp-faq details[open] summary::after { content: '−'; }
.lp-faq p { margin-top: 14px !important; color: ${C.textSub}; font-size: 16px; }

/* ---------------------------------------------------------------- footer */

.lp-footer {
  background: ${C.surface};
  border-top: 1px solid ${C.border};
  padding: 56px 0 72px;
  font-size: 15px;
  color: ${C.textMuted};
}
.lp-footer__row { display: flex; flex-wrap: wrap; gap: 28px; justify-content: space-between; align-items: center; }
.lp-footer__links { display: flex; flex-wrap: wrap; gap: 24px; }
.lp-footer__links a { color: ${C.textSub}; }

/* ---------------------------------------------------------------- responsive */

@media (max-width: 900px) {
  .lp-root { font-size: 16px; }
  .lp-section { padding: 72px 0; }
  .lp-section__head { margin-bottom: 40px; }
  .lp-row { grid-template-columns: 1fr; gap: 28px; padding: 40px 0; }
  /* Keep the prose above its illustration on every row, including the flipped ones. */
  .lp-row--flip .lp-row__media { order: 0; }
  .lp-plans { grid-template-columns: 1fr; }
  .lp-formats { grid-template-columns: repeat(2, 1fr); }
  .lp-legend { grid-template-columns: repeat(2, 1fr); }
  .lp-nav { display: none; }

  /* A 3:2 landscape photograph cover-cropped into a portrait viewport loses both the dark
     left region the headline needs and the harmonicas themselves. Push the crop toward the
     bottom-right subject and carry the text on a full-surface scrim instead of a lateral one. */
  .lp-hero__media img { object-position: 70% 80%; }
  .lp-hero__scrim {
    background:
      linear-gradient(180deg, transparent 70%, ${C.bg} 100%),
      linear-gradient(180deg, rgba(26,26,30,0.80) 0%, rgba(26,26,30,0.80) 100%);
  }
  .lp-hero__body { padding: 40px 0 72px; }
}

@media (max-width: 560px) {
  .lp-keygrid { grid-template-columns: repeat(4, 1fr); }
  .lp-formats { grid-template-columns: 1fr; }
  .lp-legend { grid-template-columns: 1fr; }
  .lp-hero__actions .lp-btn { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .lp-root *, .lp-root *::before, .lp-root *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  .lp-btn:hover { transform: none; }
}
`;
