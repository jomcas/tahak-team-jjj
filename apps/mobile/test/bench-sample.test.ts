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

test('background links are explicit and bounded', async () => {
  const { parseHikeLink } = await import('../src/modules/hike/simulate/simLink.ts');
  assert.equal((parseHikeLink('tahak://hike/simulate?background=1') as any).backgroundDelay, 360);
  assert.equal((parseHikeLink('tahak://hike/simulate?background=1&delay=9999') as any).backgroundDelay, 3600);
  assert.equal((parseHikeLink('tahak://hike/simulate?background=0') as any).backgroundDelay, undefined);
});

test('a sampled Trail produces a Deviation after the requested delay', async () => {
  const { prepareTrail } = await import('../src/modules/hike/trail/geometry.ts');
  const { buildBenchTimeline } = await import('../src/modules/hike/simulate/benchSample.ts');
  const { createBackgroundStateProcessor } = await import('../src/modules/hike/location/backgroundState.ts');
  const trail = prepareTrail([[120, 14], [120.001, 14]])!;
  let stored: string | null = null;
  const processor = createBackgroundStateProcessor({ getItem: async () => stored, setItem: async (_key, value) => { stored = value; }, removeItem: async () => { stored = null; } });
  const delay = 360;
  await processor.open('bench', 1000, trail.coordinates, undefined, buildBenchTimeline(trail, 1000, delay));
  let startedAt: number | null = null;
  for (let seconds = 0; seconds < delay + 100; seconds++) {
    const result = await processor.process('bench', [{ latitude: 0, longitude: 0, timestamp: 1000 + seconds * 1000 }]);
    if (result.transitions.some((transition) => transition.event === 'started')) { startedAt = seconds; break; }
  }
  assert.ok(startedAt !== null && startedAt > delay);
});
