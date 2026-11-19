import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHikeLocationLifecycle, HIKE_LOCATION_TASK } from '../src/modules/hike/location/backgroundLifecycle.ts';

const requestOptions = { accuracy: 4, timeInterval: 5000, distanceInterval: 0 };

test('starts and stops the service with notification text', async () => {
  let started = false;
  const service = createHikeLocationLifecycle({
    requestForegroundPermissionsAsync: async () => ({ granted: true }),
    requestBackgroundPermissionsAsync: async () => ({ granted: true }),
    hasStartedLocationUpdatesAsync: async () => started,
    startLocationUpdatesAsync: async (name, options) => {
      assert.equal(name, HIKE_LOCATION_TASK);
      assert.deepEqual(options, { ...requestOptions, foregroundService: { notificationTitle: 'Trail', notificationBody: 'Tracking', killServiceOnDestroy: true } });
      assert.equal(options.foregroundService?.notificationTitle, 'Trail');
      assert.equal(options.foregroundService?.killServiceOnDestroy, true);
      started = true;
    },
    stopLocationUpdatesAsync: async () => { started = false; },
  }, requestOptions);
  assert.equal(await service.start({ title: 'Trail', body: 'Tracking' }), 'started');
  assert.equal(started, true);
  await service.stop();
  assert.equal(started, false);
});

test('denied permission does not start tracking', async () => {
  const service = createHikeLocationLifecycle({
    requestForegroundPermissionsAsync: async () => ({ granted: false }),
    requestBackgroundPermissionsAsync: async () => { throw Error('unexpected'); },
    hasStartedLocationUpdatesAsync: async () => false,
    startLocationUpdatesAsync: async () => { throw Error('unexpected'); },
    stopLocationUpdatesAsync: async () => {},
  }, requestOptions);
  assert.equal(await service.start({ title: 'Trail', body: 'Tracking' }), 'permission-denied');
});

test('stop waits for a pending start', async () => {
  let release!: () => void;
  const permission = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  const service = createHikeLocationLifecycle({
    requestForegroundPermissionsAsync: async () => { await permission; return { granted: true }; },
    requestBackgroundPermissionsAsync: async () => ({ granted: true }),
    hasStartedLocationUpdatesAsync: async () => started,
    startLocationUpdatesAsync: async () => { started = true; },
    stopLocationUpdatesAsync: async () => { started = false; },
  }, requestOptions);
  const start = service.start({ title: 'Trail', body: 'Tracking' });
  const stop = service.stop();
  release();
  await Promise.all([start, stop]);
  assert.equal(started, false);
});
