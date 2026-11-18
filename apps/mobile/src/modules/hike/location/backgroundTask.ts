import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBackgroundStateProcessor } from './backgroundState';
import { createHikeLocationLifecycle, HIKE_LOCATION_TASK, type HikeLocationTaskData } from './backgroundLifecycle';

export const backgroundState = createBackgroundStateProcessor(AsyncStorage);

// Consumers can subscribe while the JS process is running.
let listener: ((samples: HikeLocationTaskData['locations']) => void) | undefined;
export function setHikeLocationListener(next?: typeof listener) { listener = next; }

TaskManager.defineTask<HikeLocationTaskData>(HIKE_LOCATION_TASK, async ({ data, error }) => {
  if (!error && data?.locations) {
    const state = await backgroundState.current();
    if (state) await backgroundState.process(state.hikeId, data.locations.map(({ coords, timestamp }) => ({ latitude: coords.latitude, longitude: coords.longitude, timestamp })));
    listener?.(data.locations);
  }
});

export const hikeLocationLifecycle = createHikeLocationLifecycle(Location);
