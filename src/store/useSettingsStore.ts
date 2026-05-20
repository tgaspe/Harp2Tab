import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsStorage } from './storage';

export type ThemeOverride = 'light' | 'dark';

export const RECORDING_LIMIT = 5;

interface SettingsState {
  micSensitivity:        number;
  themeOverride:         ThemeOverride;
  totalRecordingsUsed:   number;
  isPurchased:           boolean;
  setMicSensitivity:     (v: number) => void;
  setThemeOverride:      (v: ThemeOverride) => void;
  incrementRecordingCount: () => void;
  setPurchased:          () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      micSensitivity:        75,
      themeOverride:         'light' as ThemeOverride,
      totalRecordingsUsed:   0,
      isPurchased:           false,
      setMicSensitivity:     (v) => set({ micSensitivity: v }),
      setThemeOverride:      (v) => set({ themeOverride: v }),
      incrementRecordingCount: () =>
        set((s) => ({ totalRecordingsUsed: s.totalRecordingsUsed + 1 })),
      setPurchased:          () => set({ isPurchased: true }),
    }),
    {
      name:    'harp2tab-settings',
      storage: settingsStorage,
    },
  ),
);
