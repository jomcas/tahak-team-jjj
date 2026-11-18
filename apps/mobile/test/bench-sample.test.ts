import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { benchSampleAt } from '../src/modules/hike/simulate/benchSample.ts';
import type { WalkSample } from '../src/modules/hike/simulate/walkScript.ts';

const samples: WalkSample[] = [0, 10].map((tS) => ({
  tS, latitude: tS, longitude: 0, phase: 'up', alongM: tS, excursion: null, intendedOffM: 0,
}));

test('callback time samples a persisted timeline and preserves real timestamps', () => {
  const timeline = JSON.parse(JSON.stringify({ startedAt: 1000, speed: 2, samples }));
  assert.deepEqual(benchSampleAt(timeline, 3500), { latitude: 5, longitude: 0, accuracyM: 5, timestamp: 3500 });
  assert.equal(benchSampleAt(timeline, 100000)?.latitude, 10);
  assert.equal(benchSampleAt(timeline, 999), null);
  assert.equal(benchSampleAt({ ...timeline, speed: 0 }, 3500), null);
});
