// How Alerts travel between the phones of a Group Hike. Pure, tested under plain Node.
//
// The alerts module only ever talks to an AlertTransport, so the link can change without
// touching the Alert UI:
//
//   - today: LoopbackTransport. Two ends linked in memory on this phone. This phone holds one
//     end; the simulated group member holds the other, as if it were a second phone. What one
//     end sends, the other receives, a tick later (never synchronously, like a real link).
//   - #23: a NearbyTransport over Google Nearby Connections, one end per phone
//     (nearbyTransport.ts). During a Group Hike, alertsStore.ts swaps in a GroupTransport: the
//     loopback (still carrying the simulated member) and Nearby side by side. Nothing else
//     changes.
//
// A transport never delivers a phone's own messages back to it.

import type { Alert, MemberPosition } from './types.ts';

type Unsubscribe = () => void;

export interface AlertTransport {
  /** Sends an Alert to every other member of the Group Hike. */
  send(alert: Alert): void;
  /** Calls cb for each Alert another member sends. */
  onReceive(cb: (alert: Alert) => void): Unsubscribe;
  /** Sends this member's position (between Alerts, so their dot moves). */
  sendPosition(update: MemberPosition): void;
  onPosition(cb: (update: MemberPosition) => void): Unsubscribe;
}

/** One end of an in-memory link. Create them in pairs with createLoopbackPair(). */
export class LoopbackTransport implements AlertTransport {
  private peer: LoopbackTransport | null = null;
  private readonly alertListeners = new Set<(alert: Alert) => void>();
  private readonly positionListeners = new Set<(update: MemberPosition) => void>();
  /** Every Alert this end sent, newest last (for logs and tests). */
  readonly sent: Alert[] = [];

  connect(peer: LoopbackTransport): void {
    this.peer = peer;
  }

  send(alert: Alert): void {
    this.sent.push(alert);
    const peer = this.peer;
    if (!peer) return;
    setTimeout(() => peer.alertListeners.forEach((cb) => cb(alert)), 0);
  }

  onReceive(cb: (alert: Alert) => void): Unsubscribe {
    this.alertListeners.add(cb);
    return () => {
      this.alertListeners.delete(cb);
    };
  }

  sendPosition(update: MemberPosition): void {
    const peer = this.peer;
    if (!peer) return;
    setTimeout(() => peer.positionListeners.forEach((cb) => cb(update)), 0);
  }

  onPosition(cb: (update: MemberPosition) => void): Unsubscribe {
    this.positionListeners.add(cb);
    return () => {
      this.positionListeners.delete(cb);
    };
  }
}

/** Two linked ends: [this phone's, the other member's]. */
export function createLoopbackPair(): [LoopbackTransport, LoopbackTransport] {
  const a = new LoopbackTransport();
  const b = new LoopbackTransport();
  a.connect(b);
  b.connect(a);
  return [a, b];
}

/**
 * A Group Hike's link (#23): the loopback, which keeps the simulated member for one-phone
 * demos, beside the real link to the other phones (Nearby). This phone's Alerts and position
 * go out on both. What arrives from the other phones is dropped when it claims an id that is
 * only ever local (this phone's own, or the simulated member's), so a phone can never show up
 * twice or pass itself off as the simulated member.
 */
export class GroupTransport implements AlertTransport {
  private readonly local: AlertTransport;
  private readonly remote: AlertTransport;
  private readonly localOnlyIds: ReadonlySet<string>;

  constructor(local: AlertTransport, remote: AlertTransport, localOnlyIds: ReadonlySet<string>) {
    this.local = local;
    this.remote = remote;
    this.localOnlyIds = localOnlyIds;
  }

  send(alert: Alert): void {
    this.local.send(alert);
    this.remote.send(alert);
  }

  onReceive(cb: (alert: Alert) => void): Unsubscribe {
    const stops = [
      this.local.onReceive(cb),
      this.remote.onReceive((alert) => {
        if (!this.localOnlyIds.has(alert.memberId)) cb(alert);
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }

  sendPosition(update: MemberPosition): void {
    this.local.sendPosition(update);
    this.remote.sendPosition(update);
  }

  onPosition(cb: (update: MemberPosition) => void): Unsubscribe {
    const stops = [
      this.local.onPosition(cb),
      this.remote.onPosition((update) => {
        if (!this.localOnlyIds.has(update.memberId)) cb(update);
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }
}
