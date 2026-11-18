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

export function createHikeLocationLifecycle(location: LocationService) {
  // Serialize native operations so an end during a permission prompt cannot leave
  // a service running after the Hike has ended.
  let pending: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation, operation);
    pending = result.catch(() => undefined);
    return result;
  }
  return {
    start(notification: { title: string; body: string }): Promise<'started' | 'permission-denied'> {
      return enqueue(async () => {
      if (!(await location.requestForegroundPermissionsAsync()).granted ||
          !(await location.requestBackgroundPermissionsAsync()).granted) return 'permission-denied';
      if (!(await location.hasStartedLocationUpdatesAsync(HIKE_LOCATION_TASK))) {
        await location.startLocationUpdatesAsync(HIKE_LOCATION_TASK, {
          foregroundService: { notificationTitle: notification.title, notificationBody: notification.body, killServiceOnDestroy: true },
        });
      }
      return 'started';
      });
    },
    stop() {
      return enqueue(async () => {
      if (await location.hasStartedLocationUpdatesAsync(HIKE_LOCATION_TASK)) {
        await location.stopLocationUpdatesAsync(HIKE_LOCATION_TASK);
      }
      });
    },
  };
}
