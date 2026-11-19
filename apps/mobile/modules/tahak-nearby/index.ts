import { requireOptionalNativeModule, type NativeModule } from 'expo';

import type { NearbyLink } from '../../src/modules/alerts/nearbyTransport.ts';

// Local Expo module (Android only) for the Group Hike, issue #23: Google Nearby Connections,
// strategy P2P_CLUSTER. See android/src/main/java/expo/modules/tahaknearby/TahakNearbyModule.kt.
//
// It only moves bytes and reports events. Who advertises, who connects and what the bytes
// mean is decided in src/modules/alerts/nearbyTransport.ts, which takes this module as its
// NearbyLink (the shapes match), so the transport stays testable under plain Node.

export type NearbyEndpointFound = { endpointId: string; endpointName: string; serviceId: string };
export type NearbyEndpointLost = { endpointId: string };
export type NearbyConnectionInitiated = { endpointId: string; endpointName: string; incoming: boolean };
export type NearbyConnectionResult = {
  endpointId: string;
  status: 'connected' | 'rejected' | 'error';
  /** Nearby's ConnectionsStatusCodes value. */
  statusCode: number;
};
export type NearbyDisconnected = { endpointId: string };
/** One BYTES payload, decoded from UTF-8. */
export type NearbyPayload = { endpointId: string; text: string };

export type TahakNearbyEvents = {
  onEndpointFound(event: NearbyEndpointFound): void;
  onEndpointLost(event: NearbyEndpointLost): void;
  onConnectionInitiated(event: NearbyConnectionInitiated): void;
  onConnectionResult(event: NearbyConnectionResult): void;
  onDisconnected(event: NearbyDisconnected): void;
  onPayload(event: NearbyPayload): void;
};

declare class TahakNearbyModule extends NativeModule<TahakNearbyEvents> {
  /** The largest BYTES payload Nearby carries, in bytes. */
  readonly maxBytes: number;
  /** Advertises this phone as endpointName. Rejects with Nearby's status code (e.g. a missing permission). */
  startAdvertising(endpointName: string, serviceId: string): Promise<void>;
  stopAdvertising(): void;
  /** Looks for phones advertising serviceId: each one is an onEndpointFound event. */
  startDiscovery(serviceId: string): Promise<void>;
  stopDiscovery(): void;
  requestConnection(localName: string, endpointId: string): Promise<void>;
  acceptConnection(endpointId: string): Promise<void>;
  rejectConnection(endpointId: string): Promise<void>;
  /** Sends text as one UTF-8 BYTES payload to each endpoint. */
  sendBytes(endpointIds: string[], text: string): Promise<void>;
  disconnect(endpointId: string): void;
  /** Stops advertising and discovery and drops every connection. */
  stopAll(): void;
}

// Null on a build without this module (an older APK, or iOS), so the app still runs and the
// Group Hike falls back to the loopback.
const TahakNearby = requireOptionalNativeModule<TahakNearbyModule>('TahakNearby');
export default TahakNearby;

/** The module as the Group Hike transport's link (typed, so the two shapes cannot drift apart). */
export const nearbyLink: NearbyLink | null = TahakNearby;
