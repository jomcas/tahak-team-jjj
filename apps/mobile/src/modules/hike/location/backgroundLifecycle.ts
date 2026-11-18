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
  return {
    async start(notification: { title: string; body: string }): Promise<'started' | 'permission-denied'> {
      if (!(await location.requestForegroundPermissionsAsync()).granted ||
          !(await location.requestBackgroundPermissionsAsync()).granted) return 'permission-denied';
      if (!(await location.hasStartedLocationUpdatesAsync(HIKE_LOCATION_TASK))) {
        await location.startLocationUpdatesAsync(HIKE_LOCATION_TASK, {
          foregroundService: { notificationTitle: notification.title, notificationBody: notification.body, killServiceOnDestroy: true },
        });
      }
      return 'started';
    },
    async stop() {
      if (await location.hasStartedLocationUpdatesAsync(HIKE_LOCATION_TASK)) {
        await location.stopLocationUpdatesAsync(HIKE_LOCATION_TASK);
      }
    },
  };
}
