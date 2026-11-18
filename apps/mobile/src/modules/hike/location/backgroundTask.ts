import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { createHikeLocationLifecycle, HIKE_LOCATION_TASK, type HikeLocationTaskData } from './backgroundLifecycle';

// Consumers can subscribe while the JS process is running. Persistence and replay are future work.
let listener: ((samples: HikeLocationTaskData['locations']) => void) | undefined;
export function setHikeLocationListener(next?: typeof listener) { listener = next; }

TaskManager.defineTask<HikeLocationTaskData>(HIKE_LOCATION_TASK, async ({ data, error }) => {
  if (!error && data?.locations) listener?.(data.locations);
});

export const hikeLocationLifecycle = createHikeLocationLifecycle(Location);
