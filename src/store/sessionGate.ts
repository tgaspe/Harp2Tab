import { RATING_BONUS, RECORDING_LIMIT, type RatingStatus } from './useSettingsStore';

/**
 * Shared free-tier gate for every "start a new session" entry point (record,
 * and later upload audio / upload MIDI) — keeps the limit check and rating/
 * paywall branching in one place so new entry points can't accidentally
 * bypass it.
 */
export type SessionGateResult = 'allow' | 'showRating' | 'showPaywall';

export function computeEffectiveLimit(ratingStatus: RatingStatus): number {
  return RECORDING_LIMIT + (ratingStatus === 'rated' ? RATING_BONUS : 0);
}

export function resolveSessionGate(params: {
  isPurchased:        boolean;
  totalRecordingsUsed: number;
  ratingStatus:        RatingStatus;
}): SessionGateResult {
  const effectiveLimit = computeEffectiveLimit(params.ratingStatus);
  if (params.isPurchased || params.totalRecordingsUsed < effectiveLimit) return 'allow';
  return params.ratingStatus === 'notShown' ? 'showRating' : 'showPaywall';
}
