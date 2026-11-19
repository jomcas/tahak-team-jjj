// The Group Hike on this phone (#23): groupSession.ts wired to the Nearby native module,
// Android's runtime permissions, the Alerts store and the running Hike.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PermissionsAndroid, Platform, type Permission } from 'react-native';

import { nearbyLink } from '../../../modules/tahak-nearby';
import { hikeStore } from '../hike';
import { attachGroupTransport, detachGroupTransport, removeMember, sendPosition } from './alertsStore';
import { createGroupSession, shouldSharePosition, type GroupSessionView } from './groupSession';
import { nearbyPermissionsGranted, nearbyRuntimePermissions } from './nearbyPermissions';
import type { AlertPosition } from './types';

const NAME_KEY = 'tahak.group.name';

/** Asks for what Nearby needs on this phone's Android version; true when it may run. */
export async function requestNearbyPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const { required, optional } = nearbyRuntimePermissions(Number(Platform.Version));
  const all = [...required, ...optional] as Permission[];
  if (all.length === 0) return true;
  const results = await PermissionsAndroid.requestMultiple(all);
  console.log(`[nearby] permissions ${JSON.stringify(results)}`);
  return nearbyPermissionsGranted(required, results);
}

const link = Platform.OS === 'android' ? nearbyLink : null;

/** Whether this phone and build can link phones at all (Android, with modules/tahak-nearby). */
export function groupHikeAvailable(): boolean {
  return link !== null;
}

export const groupSession = createGroupSession({
  link,
  requestPermissions: requestNearbyPermissions,
  attach: attachGroupTransport,
  detach: detachGroupTransport,
  removeMember,
  onStart: watchHike,
});

// Ending the Hike (the panel, the end suggestion, a tahak://hike/end link) dissolves its group.
// Subscribed on the first Group Hike, not at import time: alerts and hike import each other.
let watchingHike = false;
function watchHike() {
  if (watchingHike) return;
  watchingHike = true;
  hikeStore.subscribe(() => {
    void groupSession.hikeChanged(hikeStore.getSnapshot().hike?.id ?? null);
  });
}

/** This phone's Group Hike, if any, for the running Hike. */
export function useGroupSession(): GroupSessionView {
  return useSyncExternalStore(groupSession.subscribe, groupSession.getSnapshot);
}

/** The name this phone shows to the group, remembered between Hikes. */
export function useMemberName(): [string, (name: string) => void] {
  const [name, setName] = useState('');
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(NAME_KEY)
      .then((saved) => {
        if (live && saved) setName((current) => current || saved);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const save = useCallback((next: string) => {
    setName(next);
    AsyncStorage.setItem(NAME_KEY, next).catch(() => undefined);
  }, []);
  return [name, save];
}

/** Sends this phone's position to the group while it is linked, every few seconds. */
export function useGroupPositionSharing(position: AlertPosition | null) {
  const view = useGroupSession();
  const linked = groupSession.isLinked();
  const last = useRef<{ position: AlertPosition; sentAt: number } | null>(null);
  // A new group (or a new member list) gets this phone's dot straight away.
  const members = view.group ? Object.keys(view.group.members).length : 0;
  useEffect(() => {
    last.current = null;
  }, [view.group?.hikeId, members]);

  const latitude = position?.latitude;
  const longitude = position?.longitude;
  useEffect(() => {
    if (!linked || latitude === undefined || longitude === undefined) return;
    const at = { latitude, longitude };
    const now = Date.now();
    if (!shouldSharePosition(last.current, at, now)) return;
    last.current = { position: at, sentAt: now };
    sendPosition(at, now);
  }, [linked, latitude, longitude, members]);
}
