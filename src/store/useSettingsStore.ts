import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsStorage } from './storage';

export type ThemeOverride = 'light' | 'dark';
export type RatingStatus = 'notShown' | 'rated' | 'declined';

export const RECORDING_LIMIT = 5;
export const RATING_BONUS    = 5;

interface SettingsState {
  micSensitivity:        number;
  themeOverride:         ThemeOverride;
  totalRecordingsUsed:   number;
  isPurchased:           boolean;
  ratingStatus:          RatingStatus;
  setMicSensitivity:     (v: number) => void;
  setThemeOverride:      (v: ThemeOverride) => void;
  incrementRecordingCount: () => void;
  setPurchased:          () => void;
  setRatingStatus:       (s: RatingStatus) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      micSensitivity:        0,
      themeOverride:         'light' as ThemeOverride,
      totalRecordingsUsed:   0,
      isPurchased:           false,
      ratingStatus:          'notShown' as RatingStatus,
      setMicSensitivity:     (v) => set({ micSensitivity: v }),
      setThemeOverride:      (v) => set({ themeOverride: v }),
      incrementRecordingCount: () =>
        set((s) => ({ totalRecordingsUsed: s.totalRecordingsUsed + 1 })),
      setPurchased:          () => set({ isPurchased: true }),
      setRatingStatus:       (s) => set({ ratingStatus: s }),
    }),
    {
      name:    'harp2tab-settings',
      storage: settingsStorage,
    },
  ),
);
