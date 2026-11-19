import { distanceM } from '../trail/geometry.ts';

// How often the background location service asks for a position (#62), adapted to movement
// to save battery. While the hiker walks, every 5 s. Once they have stayed within 10 m for
// 30 s (a rest stop), every 15 s and only after a 5 m move; leaving that spot by more than
// 10 m switches straight back. A Deviation needs movement, and its 30 s rule counts by
// position timestamps, so resting longer between samples doesn't delay one.

export type UpdateTier = 'moving' | 'still';
export type TierSample = { latitude: number; longitude: number; timestamp: number };
export type TierTracking = { tier: UpdateTier; recent: readonly TierSample[]; anchor: TierSample | null };

export const UPDATE_TIERS = {
  moving: { timeInterval: 5_000, distanceInterval: 0 },
  still: { timeInterval: 15_000, distanceInterval: 5 },
} as const satisfies Record<UpdateTier, { timeInterval: number; distanceInterval: number }>;

export const STILL_AFTER_MS = 30_000;
export const STILL_RADIUS_M = 10;

export function startTierTracking(): TierTracking {
  return { tier: 'moving', recent: [], anchor: null };
}

/** Feeds one position, in time order; returns the tracking with the tier to use next. */
export function stepUpdateTier(tracking: TierTracking, sample: TierSample): TierTracking {
  const last = tracking.recent[tracking.recent.length - 1];
  if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.latitude) || !Number.isFinite(sample.longitude)) return tracking;
  if (last && sample.timestamp <= last.timestamp) return tracking;

  if (tracking.tier === 'still') {
    if (tracking.anchor && distanceM(tracking.anchor, sample) > STILL_RADIUS_M) {
      return { tier: 'moving', recent: [sample], anchor: null };
    }
    return { ...tracking, recent: [sample] };
  }

  // Keep a little more than the still window, so it can be measured from a sample before it.
  const recent = [...tracking.recent.filter((s) => sample.timestamp - s.timestamp <= 2 * STILL_AFTER_MS), sample];
  let stillSince = sample.timestamp;
  for (let i = recent.length - 2; i >= 0; i--) {
    if (distanceM(recent[i], sample) > STILL_RADIUS_M) break;
    stillSince = recent[i].timestamp;
  }
  if (sample.timestamp - stillSince >= STILL_AFTER_MS) return { tier: 'still', recent: [sample], anchor: sample };
  return { tier: 'moving', recent, anchor: null };
}
