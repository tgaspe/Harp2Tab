/**
 * The root route — a marketing landing page on web, and nothing at all on native (12-3).
 *
 * `/` used to be `KeySelectionScreen`, which now lives at `/app` on **both** platforms. One
 * route for the app home rather than a platform-dependent one keeps every `router.replace`
 * call site identical across web and native; the cost is that native pays a redirect hop on
 * cold start, which is cheaper than a `Platform.OS` branch at thirteen call sites.
 *
 * The page itself is split by filename rather than branched here, following the same
 * convention as `TopBar`/`TopBar.web`: `LandingPage.web.tsx` is the real page and
 * `LandingPage.tsx` is a stub, so the marketing markup never enters the native bundle.
 *
 * Deliberately *not* `index.web.tsx`. Expo Router's per-platform `require.context` globs
 * (`expo-router/_ctx.web.js` and friends) treat every file under the app directory as a
 * route, and it is not established that a `.web` suffix there is understood as a platform
 * variant rather than as a route named `index.web`. The component split sits outside the app
 * directory, where the pattern is already proven by the files listed above.
 */
import { Redirect } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { LandingPage } from '@/components/landing/LandingPage';

export default function Index() {
  if (Platform.OS !== 'web') return <Redirect href="/app" />;
  return <LandingPage />;
}
