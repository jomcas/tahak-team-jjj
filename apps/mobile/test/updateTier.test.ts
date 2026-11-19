import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STILL_AFTER_MS,
  startTierTracking,
  stepUpdateTier,
  UPDATE_TIERS,
  type TierSample,
  type TierTracking,
} from '../src/modules/hike/location/updateTier.ts';

// About 1.1 m per 0.00001° of latitude.
const at = (seconds: number, northM = 0): TierSample => ({ latitude: 14.05 + northM / 111_195, longitude: 120.82, timestamp: 1_000_000 + seconds * 1000 });
const feed = (tracking: TierTracking, samples: TierSample[]) => samples.reduce(stepUpdateTier, tracking);

test('starts moving, at the 5 s rate', () => {
  assert.equal(startTierTracking().tier, 'moving');
  assert.deepEqual(UPDATE_TIERS.moving, { timeInterval: 5000, distanceInterval: 0 });
  assert.deepEqual(UPDATE_TIERS.still, { timeInterval: 15000, distanceInterval: 5 });
});

test('a walking hiker stays moving', () => {
  // 1.2 m/s for two minutes.
  const walk = Array.from({ length: 25 }, (_, i) => at(i * 5, i * 6));
  assert.equal(feed(startTierTracking(), walk).tier, 'moving');
});

test('30 s within 10 m slows to the still rate, not before', () => {
  const jitter = [0, 3, -2, 4, 1, -3, 2];
  const rest = jitter.map((m, i) => at(i * 5, m)); // 0 … 30 s
  assert.equal(feed(startTierTracking(), rest.slice(0, 6)).tier, 'moving'); // 25 s
  const still = feed(startTierTracking(), rest);
  assert.equal(still.tier, 'still');
  assert.equal(rest[6].timestamp - rest[0].timestamp, STILL_AFTER_MS);
});

test('a rest after walking counts only from where the hiker stopped', () => {
  const walk = Array.from({ length: 10 }, (_, i) => at(i * 5, i * 6)); // to 54 m at 45 s
  const rest = Array.from({ length: 6 }, (_, i) => at(50 + i * 5, 54 + (i % 2))); // 50 … 75 s
  // The 40 s sample (48 m) is already within 10 m of the resting spot; the 35 s one (42 m) isn't.
  assert.equal(feed(startTierTracking(), [...walk, ...rest.slice(0, 4)]).tier, 'moving'); // 65 s: 25 s
  assert.equal(feed(startTierTracking(), [...walk, ...rest.slice(0, 5)]).tier, 'still'); // 70 s: 30 s
});

test('leaving the resting spot switches straight back to moving', () => {
  const still = feed(startTierTracking(), Array.from({ length: 7 }, (_, i) => at(i * 5)));
  assert.equal(still.tier, 'still');
  assert.equal(stepUpdateTier(still, at(50, 8)).tier, 'still'); // GPS drift within 10 m
  assert.equal(stepUpdateTier(still, at(50, 12)).tier, 'moving');
});

test('ignores out-of-order and broken samples', () => {
  const tracking = feed(startTierTracking(), [at(0), at(5)]);
  assert.equal(stepUpdateTier(tracking, at(5, 50)), tracking);
  assert.equal(stepUpdateTier(tracking, { ...at(10), latitude: Number.NaN }), tracking);
});
