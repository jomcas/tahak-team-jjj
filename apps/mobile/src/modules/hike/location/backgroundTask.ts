import { sendAlert } from '../../alerts';
import { clearDeviationAlert, startDeviationAlert } from '../deviation/alerts';
import { fill, formatDistance } from '../format';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createBackgroundStateProcessor, type BackgroundState } from './backgroundState';
import { createHikeLocationLifecycle, HIKE_LOCATION_TASK, type HikeLocationTaskData } from './backgroundLifecycle';
import { startTierTracking, stepUpdateTier, UPDATE_TIERS } from './updateTier';

export const backgroundState = createBackgroundStateProcessor(AsyncStorage);

let snapshot: BackgroundState | null = null;
const endedHikes = new Set<string>();
let pending: Promise<void> = Promise.resolve();
function enqueue(effect: () => Promise<void>): Promise<void> {
  const next = pending.then(effect);
  pending = next.catch(() => undefined);
  return next;
}
const listeners = new Set<() => void>();
// The update rate follows the hiker's movement (updateTier.ts), per Hike, in this JS context.
let tiers = { hikeId: '', tracking: startTierTracking() };
export const backgroundSnapshot = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot() { return snapshot; },
  clear(hikeId: string) {
    if (snapshot?.hikeId !== hikeId) return;
    snapshot = null;
    listeners.forEach((listener) => listener());
  },
};

export function endBackgroundHike(hikeId: string): Promise<void> {
  endedHikes.add(hikeId);
  backgroundSnapshot.clear(hikeId);
  return enqueue(async () => {
    try { await backgroundState.close(hikeId); } finally { await clearDeviationAlert(); }
  });
}

TaskManager.defineTask<HikeLocationTaskData>(HIKE_LOCATION_TASK, ({ data, error }) => enqueue(async () => {
  if (!error && data?.locations) {
    const state = await backgroundState.current();
    if (state && !endedHikes.has(state.hikeId)) {
      const result = await backgroundState.process(state.hikeId, data.locations.map(({ coords, timestamp }) => ({ latitude: coords.latitude, longitude: coords.longitude, timestamp, accuracyM: coords.accuracy ?? undefined })));
      if (endedHikes.has(state.hikeId)) return;
      for (const transition of result.transitions) {
        if (endedHikes.has(state.hikeId)) return;
        const { latitude, longitude, timestamp } = transition.position;
        if (transition.event === 'cleared') {
          sendAlert('deviation-cleared', { latitude, longitude }, { time: timestamp });
          await clearDeviationAlert();
        } else {
          sendAlert('deviation', { latitude, longitude }, { time: timestamp, offTrailM: transition.startedOffM });
          if (result.state?.alertText) await startDeviationAlert({ title: result.state.alertText.title, body: fill(result.state.alertText.body, { distance: formatDistance(transition.startedOffM) }) });
        }
      }
      if (endedHikes.has(state.hikeId)) return;
      // The simulated bench walk keeps the fixed rate: its positions come from a timeline.
      if (!state.bench) {
        if (tiers.hikeId !== state.hikeId) tiers = { hikeId: state.hikeId, tracking: startTierTracking() };
        const before = tiers.tracking.tier;
        for (const { coords, timestamp } of data.locations) {
          tiers.tracking = stepUpdateTier(tiers.tracking, { latitude: coords.latitude, longitude: coords.longitude, timestamp });
        }
        const tier = tiers.tracking.tier;
        if (tier !== before) {
          console.log(`[hike] location updates: ${tier}, every ${UPDATE_TIERS[tier].timeInterval / 1000} s`);
          void hikeLocationLifecycle.retune(UPDATE_TIERS[tier], { foreground: AppState.currentState === 'active' })
            .catch((failure: unknown) => console.warn('[hike] could not change the location update rate', failure));
        }
      }
      snapshot = result.state;
      listeners.forEach((listener) => listener());
    }
  }
}));

export const hikeLocationLifecycle = createHikeLocationLifecycle(Location, { accuracy: Location.Accuracy.High, ...UPDATE_TIERS.moving });
