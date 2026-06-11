import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsStorage } from './storage';

export type ThemeOverride = 'light' | 'dark';
export type RatingStatus = 'notShown' | 'rated' | 'declined';

export const RECORDING_LIMIT = 3;
export const RATING_BONUS    = 3;

interface SettingsState {
  micSensitivity:           number;
  themeOverride:            ThemeOverride;
  totalRecordingsUsed:      number;
  isPurchased:              boolean;
  ratingStatus:             RatingStatus;
  hasCompletedOnboarding:   boolean;
  setMicSensitivity:        (v: number) => void;
  setThemeOverride:         (v: ThemeOverride) => void;
  incrementRecordingCount:  () => void;
  setPurchased:             () => void;
  setRatingStatus:          (s: RatingStatus) => void;
  setHasCompletedOnboarding: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      micSensitivity:           0,
      themeOverride:            'light' as ThemeOverride,
      totalRecordingsUsed:      0,
      isPurchased:              false,
      ratingStatus:             'notShown' as RatingStatus,
      hasCompletedOnboarding:   false,
      setMicSensitivity:        (v) => set({ micSensitivity: v }),
      setThemeOverride:         (v) => set({ themeOverride: v }),
      incrementRecordingCount:  () =>
        set((s) => ({ totalRecordingsUsed: s.totalRecordingsUsed + 1 })),
      setPurchased:             () => set({ isPurchased: true }),
      setRatingStatus:          (s) => set({ ratingStatus: s }),
      setHasCompletedOnboarding: (v) => set({ hasCompletedOnboarding: v }),
    }),
    {
      name:    'harp2tab-settings',
      storage: settingsStorage,
    },
  ),
);
