import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsStorage } from './storage';
import { DEFAULT_ALGORITHM_ID, type ParamValues, type TranscriptionAlgorithmId } from '@/audio/algorithms';

export type ThemeOverride = 'light' | 'dark';
export type RatingStatus = 'notShown' | 'rated' | 'declined';

export const RECORDING_LIMIT = 3;
export const RATING_BONUS    = 3;

/**
 * The free-tier session limit, as one switch.
 *
 * **Off while the app is being built.** Every gate, counter and upgrade prompt reads this,
 * so development isn't spent burning through three sessions and then dismissing a paywall —
 * and turning it back on is this one constant, not a hunt through six call sites.
 *
 * `totalRecordingsUsed` keeps counting while it is off. That's deliberate: the count is a
 * fact about what the user did, not about what they were charged for, so flipping this back
 * on restores the real state rather than silently granting everyone a fresh allowance.
 */
export const FREE_TIER_ENABLED = false;

/** Bounds for the take-length control. The floor is long enough to be a real take; the
 *  ceiling is where the neural engine's output matrices stop being comfortable in memory
 *  (~90MB at five minutes, which already dwarfs the retained PCM in either format). */
export const MIN_TAKE_MINUTES = 1;
export const MAX_TAKE_MINUTES = 5;

interface SettingsState {
  micSensitivity:           number;
  themeOverride:            ThemeOverride;
  totalRecordingsUsed:      number;
  isPurchased:              boolean;
  ratingStatus:             RatingStatus;
  hasCompletedOnboarding:   boolean;
  /** Which engine the picker opens on. Not a lock — the picker is still shown. */
  defaultAlgorithm:         TranscriptionAlgorithmId;
  /**
   * Last-used tuning, **per engine**, so the tune step opens where the user left it rather
   * than resetting to defaults on every take. Keyed by engine because the two share no
   * parameter at all; one merged bag would silently apply a pMPM grace time to nothing.
   *
   * Partial by design: a param the schema no longer declares is ignored on read, and one it
   * has newly declared falls back to its default, so a schema change can't strand a user on
   * a value that no longer exists.
   */
  transcriptionParams:      Partial<Record<TranscriptionAlgorithmId, ParamValues>>;
  /** Int16 take retention. Off by default — Float32 is what the pipeline speaks natively. */
  compactTakes:             boolean;
  maxTakeMinutes:           number;
  setMicSensitivity:        (v: number) => void;
  setThemeOverride:         (v: ThemeOverride) => void;
  incrementRecordingCount:  () => void;
  setPurchased:             () => void;
  setRatingStatus:          (s: RatingStatus) => void;
  setHasCompletedOnboarding: (v: boolean) => void;
  setDefaultAlgorithm:      (id: TranscriptionAlgorithmId) => void;
  setTranscriptionParams:   (id: TranscriptionAlgorithmId, params: ParamValues) => void;
  resetTranscriptionParams: () => void;
  setCompactTakes:          (v: boolean) => void;
  setMaxTakeMinutes:        (v: number) => void;
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
      defaultAlgorithm:         DEFAULT_ALGORITHM_ID,
      transcriptionParams:      {},
      compactTakes:             false,
      maxTakeMinutes:           MAX_TAKE_MINUTES,
      setMicSensitivity:        (v) => set({ micSensitivity: v }),
      setThemeOverride:         (v) => set({ themeOverride: v }),
      incrementRecordingCount:  () =>
        set((s) => ({ totalRecordingsUsed: s.totalRecordingsUsed + 1 })),
      setPurchased:             () => set({ isPurchased: true }),
      setRatingStatus:          (s) => set({ ratingStatus: s }),
      setHasCompletedOnboarding: (v) => set({ hasCompletedOnboarding: v }),
      setDefaultAlgorithm:      (id) => set({ defaultAlgorithm: id }),
      setTranscriptionParams:   (id, params) =>
        set((s) => ({ transcriptionParams: { ...s.transcriptionParams, [id]: params } })),
      // These persist silently across sessions, so someone who tuned themselves into a
      // corner three takes ago has no other way back to a known-good starting point.
      resetTranscriptionParams: () => set({ transcriptionParams: {} }),
      setCompactTakes:          (v) => set({ compactTakes: v }),
      setMaxTakeMinutes:        (v) => set({ maxTakeMinutes: v }),
    }),
    {
      name:    'harp2tab-settings',
      storage: settingsStorage,
    },
  ),
);
