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
  assert.deepEqual(result.transitions, ['started']);
  assert.equal(await second.close('old'), false);
  assert.equal(await second.close('one'), true);
  assert.equal((await second.process('one', [sample(30_102)])).state, null);
});
