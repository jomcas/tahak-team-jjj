// The real Group Hike link (#23): an AlertTransport over Google Nearby Connections, one end per
// phone. Pure, tested under plain Node with an in-memory stand-in for Nearby.
//
// It takes the native module (modules/tahak-nearby) as a NearbyLink, so nothing here imports
// native code. Offline only (ADR 0002): Nearby uses Bluetooth and Wi-Fi directly, no server.
//
// How a Group Hike forms (a star around the leader, over Nearby's P2P_CLUSTER strategy):
//
//   1. The leader calls lead(): it advertises under a random endpoint name and gets the QR
//      text (Hike id, join secret, that endpoint name).
//   2. A joiner scans it and calls join(qr): it discovers, connects to the endpoint with that
//      name, and sends a hello with the secret and its member id and name.
//   3. The leader admits a joiner whose secret matches (anyone else is disconnected, as is a
//      connection that sends no hello in time) and sends everyone the new roster.
//   4. Positions and Alerts go member → leader → every other member. A phone never receives
//      its own messages back, and the leader only accepts a member speaking for themselves.
//   5. endHike() dissolves the group: the leader tells everyone it ended, a member says it
//      left. Losing the leader dissolves the group for a member too.
//
// One NearbyTransport is one Group Hike, as in CONTEXT.md: after it dissolves, the next Hike
// makes a new one. The loopback (transport.ts) stays for the simulated member.

import {
  admitMember,
  applyRoster,
  canAdmit,
  dissolve,
  isGroupLinked,
  removeGroupMember,
  rosterOf,
  soloHike,
  startJoining,
  startLeading,
  type GroupEndReason,
  type GroupHike,
} from './groupHike.ts';
import {
  decodeGroupMessage,
  decodeJoinCode,
  encodeGroupMessage,
  encodeJoinCode,
  newEndpointName,
  newGroupId,
  newJoinSecret,
  type GroupMemberInfo,
  type GroupMessage,
} from './groupMessage.ts';
import type { AlertTransport } from './transport.ts';
import type { Alert, MemberPosition } from './types.ts';

/** Nearby service id: only Tahak Group Hikes see each other. */
export const NEARBY_SERVICE_ID = 'com.tahak.app.grouphike';
/** A connection that has not proved the join secret by then is dropped. */
export const HELLO_TIMEOUT_MS = 15_000;

type Subscription = { remove(): void };
type Unsubscribe = () => void;

/** The events modules/tahak-nearby sends. */
export type NearbyLinkEvents = {
  onEndpointFound(event: { endpointId: string; endpointName: string; serviceId: string }): void;
  onEndpointLost(event: { endpointId: string }): void;
  onConnectionInitiated(event: { endpointId: string; endpointName: string; incoming: boolean }): void;
  onConnectionResult(event: { endpointId: string; status: 'connected' | 'rejected' | 'error'; statusCode: number }): void;
  onDisconnected(event: { endpointId: string }): void;
  onPayload(event: { endpointId: string; text: string }): void;
};

/** What this transport needs from Nearby Connections. modules/tahak-nearby has this shape. */
export interface NearbyLink {
  startAdvertising(endpointName: string, serviceId: string): Promise<void>;
  stopAdvertising(): void;
  startDiscovery(serviceId: string): Promise<void>;
  stopDiscovery(): void;
  requestConnection(localName: string, endpointId: string): Promise<void>;
  acceptConnection(endpointId: string): Promise<void>;
  rejectConnection(endpointId: string): Promise<void>;
  sendBytes(endpointIds: string[], text: string): Promise<void>;
  disconnect(endpointId: string): void;
  stopAll(): void;
  addListener<K extends keyof NearbyLinkEvents>(event: K, listener: NearbyLinkEvents[K]): Subscription;
}

export type NearbyTransportOptions = {
  link: NearbyLink;
  /** This phone in the group: its member id and the name the others see. */
  self: GroupMemberInfo;
  serviceId?: string;
  helloTimeoutMs?: number;
  random?: () => number;
  log?: (line: string) => void;
};

export class NearbyTransport implements AlertTransport {
  private readonly link: NearbyLink;
  private readonly serviceId: string;
  private readonly helloTimeoutMs: number;
  private readonly random: () => number;
  private readonly log: (line: string) => void;

  private group: GroupHike;
  private secret: string | null = null;
  private leaderEndpointName: string | null = null;
  private readonly ownEndpointName: string;

  /** Leader: connected endpoints → the member id they proved, or null while awaiting hello. */
  private readonly endpoints = new Map<string, string | null>();
  private readonly helloTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Member: the leader's endpoint once found, and once connected. */
  private requestedLeader: string | null = null;
  private leaderEndpointId: string | null = null;

  private subscriptions: Subscription[] = [];
  private readonly alertListeners = new Set<(alert: Alert) => void>();
  private readonly positionListeners = new Set<(update: MemberPosition) => void>();
  private readonly groupListeners = new Set<(group: GroupHike) => void>();
  private readonly leftListeners = new Set<(memberId: string) => void>();
  private sequence = 0;

  constructor(options: NearbyTransportOptions) {
    this.link = options.link;
    this.serviceId = options.serviceId ?? NEARBY_SERVICE_ID;
    this.helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
    this.random = options.random ?? Math.random;
    this.log = options.log ?? ((line) => console.log(`[nearby] ${line}`));
    this.group = soloHike(options.self);
    this.ownEndpointName = newEndpointName(this.random);
  }

  // --- the group ---

  getGroup(): GroupHike {
    return this.group;
  }

  /** Calls cb on every change to the group (status, roster). */
  onGroupChange(cb: (group: GroupHike) => void): Unsubscribe {
    this.groupListeners.add(cb);
    return () => {
      this.groupListeners.delete(cb);
    };
  }

  /** Calls cb when another member leaves, so their dot can be removed. */
  onMemberLeft(cb: (memberId: string) => void): Unsubscribe {
    this.leftListeners.add(cb);
    return () => {
      this.leftListeners.delete(cb);
    };
  }

  /**
   * Starts a Group Hike with this phone as its leader and advertises it. Resolves to the text
   * for the QR code. Rejects (and stays a Solo Hike) if Nearby cannot advertise, for example
   * when a permission is missing.
   */
  async lead(hikeId: string = newGroupId('gh', this.random)): Promise<string> {
    this.assertFresh();
    this.secret = newJoinSecret(this.random);
    this.leaderEndpointName = this.ownEndpointName;
    const qr = encodeJoinCode({ hikeId, secret: this.secret, leaderEndpointName: this.ownEndpointName });
    this.listen();
    this.setGroup(startLeading(this.group.self, hikeId));
    try {
      await this.link.startAdvertising(this.ownEndpointName, this.serviceId);
    } catch (error) {
      this.reset();
      throw error;
    }
    this.log(`leading ${hikeId} as ${this.ownEndpointName}`);
    return qr;
  }

  /**
   * Joins the Group Hike in a scanned QR code: looks for its leader and connects. Resolves
   * false for a QR code that is not a Tahak Group Hike; rejects (and stays a Solo Hike) if
   * Nearby cannot discover. The group shows `joined` once the leader admits this phone.
   */
  async join(qrText: string): Promise<boolean> {
    this.assertFresh();
    const code = decodeJoinCode(qrText);
    if (!code) return false;
    this.secret = code.secret;
    this.leaderEndpointName = code.leaderEndpointName;
    this.listen();
    this.setGroup(startJoining(this.group.self, code.hikeId));
    try {
      await this.link.startDiscovery(this.serviceId);
    } catch (error) {
      this.reset();
      throw error;
    }
    this.log(`joining ${code.hikeId}, looking for ${code.leaderEndpointName}`);
    return true;
  }

  /**
   * The Hike ended on this phone: the group dissolves. The leader tells every member the group
   * is over; a member tells the leader it left.
   */
  async endHike(): Promise<void> {
    const group = this.group;
    if (group.status === 'none' || group.status === 'dissolved') return;
    const hikeId = group.hikeId as string;
    const farewell: GroupMessage =
      group.role === 'leader' ? { v: 1, kind: 'end', hikeId } : { v: 1, kind: 'leave', hikeId, memberId: group.self.id };
    const targets = this.targets();
    this.finish('hike-ended');
    if (targets.length > 0) await this.sendTo(targets, farewell);
    this.link.stopAll();
  }

  // --- AlertTransport ---

  /** Sends this phone's Alert, as this member, to the rest of the group. */
  send(alert: Alert): void {
    if (!isGroupLinked(this.group)) return;
    const { self } = this.group;
    const own: Alert = {
      id: `${self.id}:${++this.sequence}`,
      type: alert.type,
      memberId: self.id,
      memberName: self.name,
      position: alert.position,
      time: alert.time,
      ...(alert.offTrailM === undefined ? {} : { offTrailM: alert.offTrailM }),
    };
    void this.sendTo(this.targets(), { v: 1, kind: 'alert', hikeId: this.group.hikeId as string, alert: own });
  }

  onReceive(cb: (alert: Alert) => void): Unsubscribe {
    this.alertListeners.add(cb);
    return () => {
      this.alertListeners.delete(cb);
    };
  }

  /** Sends this phone's position, as this member, to the rest of the group. */
  sendPosition(update: MemberPosition): void {
    if (!isGroupLinked(this.group)) return;
    const { self } = this.group;
    const own: MemberPosition = { memberId: self.id, memberName: self.name, position: update.position, time: update.time };
    void this.sendTo(this.targets(), { v: 1, kind: 'position', hikeId: this.group.hikeId as string, update: own });
  }

  onPosition(cb: (update: MemberPosition) => void): Unsubscribe {
    this.positionListeners.add(cb);
    return () => {
      this.positionListeners.delete(cb);
    };
  }

  // --- Nearby events ---

  private listen() {
    const link = this.link;
    this.subscriptions = [
      link.addListener('onEndpointFound', (e) => this.endpointFound(e.endpointId, e.endpointName)),
      link.addListener('onConnectionInitiated', (e) => this.connectionInitiated(e.endpointId, e.incoming)),
      link.addListener('onConnectionResult', (e) => this.connectionResult(e.endpointId, e.status)),
      link.addListener('onDisconnected', (e) => this.disconnected(e.endpointId)),
      link.addListener('onPayload', (e) => this.payload(e.endpointId, e.text)),
    ];
  }

  private endpointFound(endpointId: string, endpointName: string) {
    if (this.group.status !== 'joining' || this.requestedLeader) return;
    if (endpointName !== this.leaderEndpointName) return;
    this.requestedLeader = endpointId;
    this.log(`found the leader ${endpointName}, connecting`);
    this.link.requestConnection(this.ownEndpointName, endpointId).catch((error) => {
      this.log(`request to the leader failed: ${String(error)}`);
      if (this.requestedLeader === endpointId) this.requestedLeader = null;
    });
  }

  private connectionInitiated(endpointId: string, incoming: boolean) {
    const g = this.group;
    // The leader takes any joiner in for its hello; a member only connects to its leader.
    const accept =
      (g.role === 'leader' && g.status === 'leading' && incoming) ||
      (g.role === 'member' && g.status === 'joining' && endpointId === this.requestedLeader);
    const step = accept ? this.link.acceptConnection(endpointId) : this.link.rejectConnection(endpointId);
    step.catch((error) => this.log(`${accept ? 'accept' : 'reject'} ${endpointId} failed: ${String(error)}`));
  }

  private connectionResult(endpointId: string, status: 'connected' | 'rejected' | 'error') {
    const g = this.group;
    if (g.role === 'leader') {
      if (status !== 'connected' || g.status !== 'leading') return;
      this.endpoints.set(endpointId, null);
      this.helloTimers.set(
        endpointId,
        setTimeout(() => {
          this.helloTimers.delete(endpointId);
          if (this.endpoints.get(endpointId) === null) this.drop(endpointId, 'no hello');
        }, this.helloTimeoutMs),
      );
      return;
    }
    if (g.role !== 'member' || endpointId !== this.requestedLeader) return;
    if (status !== 'connected') {
      this.log(`the leader's connection ${status}; still looking`);
      this.requestedLeader = null;
      return;
    }
    this.leaderEndpointId = endpointId;
    this.link.stopDiscovery();
    void this.sendTo([endpointId], {
      v: 1,
      kind: 'hello',
      hikeId: g.hikeId as string,
      secret: this.secret as string,
      member: g.self,
    });
  }

  private disconnected(endpointId: string) {
    const g = this.group;
    if (g.role === 'leader') {
      const memberId = this.endpoints.get(endpointId);
      this.forget(endpointId);
      if (memberId) this.memberGone(memberId);
      return;
    }
    if (g.role === 'member' && endpointId === this.leaderEndpointId) {
      this.log('lost the leader; the group has ended');
      this.finish('leader-lost');
      this.link.stopAll();
    }
  }

  private payload(endpointId: string, text: string) {
    const message = decodeGroupMessage(text);
    if (!message || message.hikeId !== this.group.hikeId) return;
    if (this.group.role === 'leader') this.leaderReceives(endpointId, message, text);
    else if (this.group.role === 'member' && endpointId === this.leaderEndpointId) this.memberReceives(message);
  }

  private leaderReceives(endpointId: string, message: GroupMessage, text: string) {
    if (this.group.status !== 'leading' || !this.endpoints.has(endpointId)) return;
    const memberId = this.endpoints.get(endpointId) ?? null;
    if (memberId === null) {
      if (message.kind !== 'hello') return;
      if (message.secret !== this.secret || !canAdmit(this.group, message.member)) {
        this.drop(endpointId, 'wrong secret or group full');
        return;
      }
      // The same member on a new connection replaces the old one.
      for (const [other, id] of this.endpoints) {
        if (id === message.member.id && other !== endpointId) this.drop(other, 'replaced by a reconnect', false);
      }
      this.endpoints.set(endpointId, message.member.id);
      this.clearHelloTimer(endpointId);
      this.setGroup(admitMember(this.group, message.member));
      this.log(`admitted ${message.member.name} (${message.member.id})`);
      this.sendRoster();
      return;
    }
    switch (message.kind) {
      case 'position':
        if (message.update.memberId !== memberId) return;
        this.deliverPosition(message.update);
        void this.relay(endpointId, text);
        return;
      case 'alert':
        if (message.alert.memberId !== memberId) return;
        this.deliverAlert(message.alert);
        void this.relay(endpointId, text);
        return;
      case 'leave':
        if (message.memberId !== memberId) return;
        this.forget(endpointId);
        this.link.disconnect(endpointId);
        this.memberGone(memberId);
        return;
      default:
        return; // hello again, roster, end: not a member's to send
    }
  }

  private memberReceives(message: GroupMessage) {
    switch (message.kind) {
      case 'roster': {
        const before = this.group.members;
        this.setGroup(applyRoster(this.group, message.leaderId, message.members));
        for (const id of Object.keys(before)) if (!this.group.members[id]) this.emitLeft(id);
        return;
      }
      case 'position':
        if (this.group.status === 'joined') this.deliverPosition(message.update);
        return;
      case 'alert':
        if (this.group.status === 'joined') this.deliverAlert(message.alert);
        return;
      case 'leave': {
        const next = removeGroupMember(this.group, message.memberId);
        if (next !== this.group) {
          this.setGroup(next);
          this.emitLeft(message.memberId);
        }
        return;
      }
      case 'end':
        this.log('the leader ended the Hike; the group has ended');
        this.finish('leader-ended');
        this.link.stopAll();
        return;
      default:
        return;
    }
  }

  // --- helpers ---

  private deliverAlert(alert: Alert) {
    if (alert.memberId === this.group.self.id) return;
    this.alertListeners.forEach((cb) => cb(alert));
  }

  private deliverPosition(update: MemberPosition) {
    if (update.memberId === this.group.self.id) return;
    this.positionListeners.forEach((cb) => cb(update));
  }

  private emitLeft(memberId: string) {
    if (memberId === this.group.self.id) return;
    this.leftListeners.forEach((cb) => cb(memberId));
  }

  /** Leader: a member is gone. Tell the others and update the roster. */
  private memberGone(memberId: string) {
    const next = removeGroupMember(this.group, memberId);
    if (next === this.group) return;
    this.setGroup(next);
    this.log(`member ${memberId} left`);
    this.emitLeft(memberId);
    void this.sendTo(this.targets(), { v: 1, kind: 'leave', hikeId: this.group.hikeId as string, memberId });
    this.sendRoster();
  }

  private sendRoster() {
    const g = this.group;
    void this.sendTo(this.targets(), {
      v: 1,
      kind: 'roster',
      hikeId: g.hikeId as string,
      leaderId: g.self.id,
      members: rosterOf(g),
    });
  }

  /** Leader: passes a member's message on to every other admitted member. */
  private relay(fromEndpointId: string, text: string) {
    const others = this.targets().filter((id) => id !== fromEndpointId);
    if (others.length === 0) return Promise.resolve();
    return this.link.sendBytes(others, text).catch((error) => this.log(`relay failed: ${String(error)}`));
  }

  /** Who this phone sends to: the admitted members (leader) or the leader (member). */
  private targets(): string[] {
    if (this.group.role === 'leader') {
      return [...this.endpoints].filter(([, memberId]) => memberId !== null).map(([endpointId]) => endpointId);
    }
    return this.leaderEndpointId ? [this.leaderEndpointId] : [];
  }

  private sendTo(endpointIds: string[], message: GroupMessage): Promise<void> {
    if (endpointIds.length === 0) return Promise.resolve();
    const text = encodeGroupMessage(message);
    if (text === null) {
      this.log(`${message.kind} too large to send`);
      return Promise.resolve();
    }
    return this.link.sendBytes(endpointIds, text).catch((error) => this.log(`send ${message.kind} failed: ${String(error)}`));
  }

  private drop(endpointId: string, why: string, notify = true) {
    this.log(`dropping ${endpointId}: ${why}`);
    const memberId = this.endpoints.get(endpointId);
    this.forget(endpointId);
    this.link.disconnect(endpointId);
    if (notify && memberId) this.memberGone(memberId);
  }

  private forget(endpointId: string) {
    this.endpoints.delete(endpointId);
    this.clearHelloTimer(endpointId);
  }

  private clearHelloTimer(endpointId: string) {
    const timer = this.helloTimers.get(endpointId);
    if (timer !== undefined) clearTimeout(timer);
    this.helloTimers.delete(endpointId);
  }

  private setGroup(next: GroupHike) {
    if (next === this.group) return;
    this.group = next;
    this.groupListeners.forEach((cb) => cb(next));
  }

  private assertFresh() {
    if (this.group.status !== 'none') {
      throw new Error('This Group Hike link is already in use; start a new one for the next Hike');
    }
  }

  private stopListening() {
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
    this.helloTimers.forEach((timer) => clearTimeout(timer));
    this.helloTimers.clear();
  }

  /** The group is over: every other member leaves this phone's map. */
  private finish(reason: GroupEndReason) {
    const others = Object.keys(this.group.members).filter((id) => id !== this.group.self.id);
    this.stopListening();
    this.endpoints.clear();
    this.leaderEndpointId = null;
    this.requestedLeader = null;
    this.setGroup(dissolve(this.group, reason));
    others.forEach((id) => this.leftListeners.forEach((cb) => cb(id)));
  }

  /** Back to a Solo Hike after lead() or join() could not start. */
  private reset() {
    this.stopListening();
    this.link.stopAll();
    this.secret = null;
    this.leaderEndpointName = null;
    this.setGroup(soloHike(this.group.self));
  }
}

/** A NearbyTransport for this phone. Pass the native module from modules/tahak-nearby as link. */
export function createNearbyTransport(options: NearbyTransportOptions): NearbyTransport {
  return new NearbyTransport(options);
}
