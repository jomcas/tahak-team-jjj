// Declares the Android permissions Google Nearby Connections needs for the Group Hike (#23),
// exactly as https://developers.google.com/nearby/connections/android/get-started lists them
// (checked 2026-11-19), with their SDK bounds and flags. app.config.js `android.permissions`
// cannot carry maxSdkVersion or usesPermissionFlags, hence a plugin.
//
// Two deliberate differences from that list, both broader, never narrower:
// - ACCESS_FINE_LOCATION and ACCESS_COARSE_LOCATION are not added here. expo-location already
//   declares them with no SDK bound for the Hike map and #62's background tracking; capping
//   them at SDK 32 would break both.
// - ACCESS_WIFI_STATE and CHANGE_WIFI_STATE get no maxSdkVersion. They are normal (install-time)
//   permissions, a library already declares ACCESS_WIFI_STATE unbounded, and a bound on the
//   app's copy would conflict with it in the manifest merge.
// A permission that is already declared is left as it is.
// The runtime side is src/modules/alerts/nearbyPermissions.ts.
const { withAndroidManifest } = require('expo/config-plugins');

const NEARBY_PERMISSIONS = [
  { name: 'android.permission.ACCESS_WIFI_STATE' },
  { name: 'android.permission.CHANGE_WIFI_STATE' },
  { name: 'android.permission.BLUETOOTH', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_ADMIN', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_ADVERTISE', minSdkVersion: '31' },
  { name: 'android.permission.BLUETOOTH_CONNECT', minSdkVersion: '31' },
  { name: 'android.permission.BLUETOOTH_SCAN', minSdkVersion: '31', usesPermissionFlags: 'neverForLocation' },
  { name: 'android.permission.NEARBY_WIFI_DEVICES', minSdkVersion: '33', usesPermissionFlags: 'neverForLocation' },
  { name: 'android.permission.ACCESS_LOCAL_NETWORK', minSdkVersion: '37' },
];

/** Adds the Nearby permissions to a parsed AndroidManifest (exported for the test). */
function addNearbyPermissions(manifest) {
  const root = manifest.manifest;
  const list = (root['uses-permission'] = root['uses-permission'] ?? []);
  for (const permission of NEARBY_PERMISSIONS) {
    if (list.some((entry) => entry.$?.['android:name'] === permission.name)) continue;
    const attributes = { 'android:name': permission.name };
    if (permission.minSdkVersion) attributes['android:minSdkVersion'] = permission.minSdkVersion;
    if (permission.maxSdkVersion) attributes['android:maxSdkVersion'] = permission.maxSdkVersion;
    if (permission.usesPermissionFlags) attributes['android:usesPermissionFlags'] = permission.usesPermissionFlags;
    list.push({ $: attributes });
  }
  return manifest;
}

function withNearbyPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = addNearbyPermissions(cfg.modResults);
    return cfg;
  });
}

module.exports = withNearbyPermissions;
module.exports.addNearbyPermissions = addNearbyPermissions;
module.exports.NEARBY_PERMISSIONS = NEARBY_PERMISSIONS;
