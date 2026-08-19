import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
} from '@expo-google-fonts/poppins';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { TopBar } from '@/components/TopBar';
import { startAuthListener } from '@/auth/useAuthStore';
import { startEntitlementListener } from '@/store/useEntitlementStore';
import { startPurchasesListener } from '@/billing/purchases';
import { startSyncListener } from '@/sync/syncEngine';
import { AdoptionPrompt } from '@/sync/AdoptionPrompt';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  /**
   * The app's one auth subscription (7-2). Everything else reads the store it writes.
   *
   * **Deliberately not joined to the font gate below**, which is what the plan sketched. The
   * gate exists to stop the signed-out UI rendering for a frame before a persisted session
   * resolves — but `'resolving'` already handles that at each consumer: `TopBar` renders
   * neither the avatar nor "Sign in", and `/profile` renders its skeleton. Holding the whole
   * app instead would put Firebase's resolution on the critical path to first paint, and the
   * plan is explicit that a slow or failed resolution must render signed-out rather than
   * extend the splash. Same outcome, without the risk of a blank app if auth never answers.
   */
  useEffect(() => startAuthListener(), []);

  /**
   * Entitlement refreshes (8-3), for the same reason and with the same shape: one subscription,
   * writing a store that every screen reads synchronously.
   *
   * Started unconditionally rather than only when signed in — it watches the auth store for
   * that itself, and a signed-out app still needs it to have dropped the previous account's
   * cached entitlement.
   */
  useEffect(() => startEntitlementListener(), []);

  /**
   * Configures the RevenueCat SDK for whoever is signed in, and keeps the customer-portal link
   * current (8-6). Started here rather than in `useIAP` because `/profile` needs the link and
   * never renders the paywall — a hook that mounts on one screen cannot serve another.
   */
  useEffect(() => startPurchasesListener(), []);

  /**
   * Cloud sync (7b-4), started the same way and for the same reason: one module owns the
   * network, every screen reads a store.
   *
   * Started unconditionally rather than only when signed in — it gates on the auth store itself,
   * and a signed-out app still needs it to report *why* nothing is syncing rather than leaving
   * `/profile` showing whatever the last session ended on.
   */
  useEffect(() => startSyncListener(), []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <TopBar />
        <Stack screenOptions={{ headerShown: false }} />
        {/* Mounted at the root, not on `/profile` (7-11). Sign-in happens from the TopBar, the
            paywall and the sign-in modal, so the question can be raised from anywhere — and it
            blocks sync until it is answered, which makes it the wrong thing to hide behind a
            route the user may never visit. */}
        <AdoptionPrompt />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
