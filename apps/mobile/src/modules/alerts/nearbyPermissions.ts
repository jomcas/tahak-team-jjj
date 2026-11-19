// The Android permissions Google Nearby Connections needs (#23), by Android API level. Pure, so
// the list is tested, and plugins/withNearbyPermissions.js declares the same ones.
//
// Source: https://developers.google.com/nearby/connections/android/get-started (checked
// 2026-11-19). If they are not all granted, advertising and discovery do not start.
//
// - API 29 to 32: ACCESS_FINE_LOCATION (Bluetooth and Wi-Fi scans were location then).
// - up to API 32: ACCESS_COARSE_LOCATION.
// - API 31 and up: BLUETOOTH_ADVERTISE, BLUETOOTH_CONNECT, BLUETOOTH_SCAN ("Nearby devices").
// - API 33 and up: NEARBY_WIFI_DEVICES.
// - API 37 (Android 17) and up: ACCESS_LOCAL_NETWORK, required only for apps that target SDK 37
//   or later. Tahak targets SDK 36 (Expo SDK 57), so it is asked for but not required.

export const NEARBY_PERMISSION = {
  fineLocation: 'android.permission.ACCESS_FINE_LOCATION',
  coarseLocation: 'android.permission.ACCESS_COARSE_LOCATION',
  bluetoothAdvertise: 'android.permission.BLUETOOTH_ADVERTISE',
  bluetoothConnect: 'android.permission.BLUETOOTH_CONNECT',
  bluetoothScan: 'android.permission.BLUETOOTH_SCAN',
  nearbyWifi: 'android.permission.NEARBY_WIFI_DEVICES',
  localNetwork: 'android.permission.ACCESS_LOCAL_NETWORK',
} as const;

/** The SDK the app targets (Expo SDK 57's React Native default). */
export const TARGET_SDK = 36;

/** The runtime permissions to ask for on this API level: `required` must all be granted. */
export function nearbyRuntimePermissions(apiLevel: number, targetSdk: number = TARGET_SDK): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  if (apiLevel <= 32) {
    required.push(NEARBY_PERMISSION.coarseLocation);
    if (apiLevel >= 29) required.push(NEARBY_PERMISSION.fineLocation);
  }
  if (apiLevel >= 31) {
    required.push(NEARBY_PERMISSION.bluetoothAdvertise, NEARBY_PERMISSION.bluetoothConnect, NEARBY_PERMISSION.bluetoothScan);
  }
  if (apiLevel >= 33) required.push(NEARBY_PERMISSION.nearbyWifi);
  if (apiLevel >= 37) (targetSdk >= 37 ? required : optional).push(NEARBY_PERMISSION.localNetwork);
  return { required, optional };
}

/** Whether every required permission came back granted (results as PermissionsAndroid gives them). */
export function nearbyPermissionsGranted(required: readonly string[], results: Readonly<Record<string, string>>): boolean {
  return required.every((permission) => results[permission] === 'granted');
}
