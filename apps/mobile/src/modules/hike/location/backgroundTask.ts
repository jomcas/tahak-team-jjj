import { clearDeviationAlert, startDeviationAlert } from '../deviation/alerts';
import { fill, formatDistance } from '../format';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBackgroundStateProcessor, type BackgroundState } from './backgroundState';
import { createHikeLocationLifecycle, HIKE_LOCATION_TASK, type HikeLocationTaskData } from './backgroundLifecycle';

export const backgroundState = createBackgroundStateProcessor(AsyncStorage);

let snapshot: BackgroundState | null = null;
const listeners = new Set<() => void>();
export const backgroundSnapshot = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot() { return snapshot; },
  clear(hikeId: string) {
    if (snapshot?.hikeId !== hikeId) return;
    snapshot = null;
    listeners.forEach((listener) => listener());
  },
};

TaskManager.defineTask<HikeLocationTaskData>(HIKE_LOCATION_TASK, async ({ data, error }) => {
  if (!error && data?.locations) {
    const state = await backgroundState.current();
    if (state) {
      const result = await backgroundState.process(state.hikeId, data.locations.map(({ coords, timestamp }) => ({ latitude: coords.latitude, longitude: coords.longitude, timestamp, accuracyM: coords.accuracy ?? undefined })));
      for (const transition of result.transitions) {
        if (transition === 'cleared') await clearDeviationAlert();
        else if (result.state?.alertText && result.state.deviation.detector.status === 'deviation') {
          await startDeviationAlert({ title: result.state.alertText.title, body: fill(result.state.alertText.body, { distance: formatDistance(result.state.deviation.detector.startedOffM) }) });
        }
      }
      snapshot = result.state;
      listeners.forEach((listener) => listener());
    }
  }
});

export const hikeLocationLifecycle = createHikeLocationLifecycle(Location);
