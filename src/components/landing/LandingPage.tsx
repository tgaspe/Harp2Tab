/**
 * Native stub for the landing page.
 *
 * On Android and iOS the app is the app — `src/app/index.tsx` redirects to `/app` before this
 * ever renders. It exists so the import in that route resolves on every platform, and so the
 * marketing page's markup, hero image and demo wiring stay out of the native bundle.
 */
export function LandingPage() {
  return null;
}
