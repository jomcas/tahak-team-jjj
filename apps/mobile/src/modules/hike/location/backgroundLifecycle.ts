import type { LocationObject, LocationTaskOptions } from 'expo-location';

export const HIKE_LOCATION_TASK = 'hike-location-updates';
export type HikeLocationSample = LocationObject;
export type HikeLocationTaskData = { locations: HikeLocationSample[] };

type LocationService = {
  requestForegroundPermissionsAsync(): Promise<{ granted: boolean }>;
  requestBackgroundPermissionsAsync(): Promise<{ granted: boolean }>;
  hasStartedLocationUpdatesAsync(name: string): Promise<boolean>;
  startLocationUpdatesAsync(name: string, options: LocationTaskOptions): Promise<void>;
  stopLocationUpdatesAsync(name: string): Promise<void>;
};

export function createHikeLocationLifecycle(location: LocationService, options: Pick<LocationTaskOptions, 'accuracy' | 'timeInterval' | 'distanceInterval'>) {
  // Serialize native operations so an end during a permission prompt cannot leave
  // a service running after the Hike has ended.
  let pending: Promise<unknown> = Promise.resolve();
  // The running service's notification, so a retune keeps the service as it is.
  let notification: { title: string; body: string } | null = null;
  const serviceOptions = (current: { title: string; body: string }) => ({
    foregroundService: { notificationTitle: current.title, notificationBody: current.body, killServiceOnDestroy: true },
  });
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation, operation);
    pending = result.catch(() => undefined);
    return result;
  }
  return {
    start(text: { title: string; body: string }): Promise<'started' | 'permission-denied'> {
      return enqueue(async () => {
      if (!(await location.requestForegroundPermissionsAsync()).granted ||
          !(await location.requestBackgroundPermissionsAsync()).granted) return 'permission-denied';
      if (!(await location.hasStartedLocationUpdatesAsync(HIKE_LOCATION_TASK))) {
        await location.startLocationUpdatesAsync(HIKE_LOCATION_TASK, { ...options, ...serviceOptions(text) });
      }
      notification = text;
      return 'started';
      });
    },
    /**
     * Changes how often the running service asks for a position (updateTier.ts). Calling start
     * again on a running task only updates its options, so the service keeps going. Does
     * nothing when this JavaScript didn't start the service (for example after a restart).
     *
     * expo-location refuses the foregroundService option while the app is in the background,
     * so it's left out then. That is safe: in the background the running service is left
     * untouched, and a later retune in the foreground puts the option back.
     */
    retune(intervals: Pick<LocationTaskOptions, 'timeInterval' | 'distanceInterval'>, { foreground }: { foreground: boolean }): Promise<boolean> {
      return enqueue(async () => {
        if (!notification || !(await location.hasStartedLocationUpdatesAsync(HIKE_LOCATION_TASK))) return false;
        await location.startLocationUpdatesAsync(HIKE_LOCATION_TASK, { ...options, ...intervals, ...(foreground ? serviceOptions(notification) : {}) });
        return true;
      });
    },
    stop() {
      return enqueue(async () => {
      notification = null;
      if (await location.hasStartedLocationUpdatesAsync(HIKE_LOCATION_TASK)) {
        await location.stopLocationUpdatesAsync(HIKE_LOCATION_TASK);
      }
      });
    },
  };
}
