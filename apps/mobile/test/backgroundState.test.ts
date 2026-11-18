import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createBackgroundStateProcessor } from '../src/modules/hike/location/backgroundState.ts';

test('persists ordered samples across restart and ignores late samples and stale close', async () => {
  const map = new Map<string, string>();
  const storage = { async getItem(key: string) { return map.get(key) ?? null; }, async setItem(key: string, value: string) { map.set(key, value); }, async removeItem(key: string) { map.delete(key); } };
  const first = createBackgroundStateProcessor(storage);
  await first.open('one', 100, [[0, 0], [0, 0.01]]);
  const sample = (timestamp: number) => ({ latitude: 0.001, longitude: 0.001, timestamp });
  await first.process('one', [sample(99), sample(100), sample(100)]);
  const second = createBackgroundStateProcessor(storage);
  assert.equal((await second.current())?.latestPosition?.timestamp, 100);
  const result = await second.process('one', [sample(30_101), sample(99)]);
  assert.equal(result.state?.latestPosition?.timestamp, 30_101);
  assert.equal(result.state?.deviation.detector.status, 'deviation');
  assert.equal(result.transitions[0]?.event, 'started');
  assert.equal(await second.close('old'), false);
  assert.equal(await second.close('one'), true);
  assert.equal((await second.process('one', [sample(30_102)])).state, null);
});

test('preserves both transitions and their samples in a single batch', async () => {
  const map = new Map<string, string>();
  const storage = { async getItem(k: string) { return map.get(k) ?? null; }, async setItem(k: string, v: string) { map.set(k, v); }, async removeItem(k: string) { map.delete(k); } };
  const processor = createBackgroundStateProcessor(storage);
  await processor.open('hike', 0, [[0, 0], [0, 0.01]]);
  const off = (timestamp: number) => ({ latitude: 0.001, longitude: 0.001, timestamp });
  const back = { latitude: 0.001, longitude: 0, timestamp: 31000 };
  const result = await processor.process('hike', [off(1), off(15000), off(30002), back]);
  assert.deepEqual(result.transitions.map(t => [t.event, t.position.timestamp]), [['started', 30002], ['cleared', 31000]]);
  assert.ok(result.transitions[0]?.event === 'started' && result.transitions[0].startedOffM > 40);
});
