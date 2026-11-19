// A stand-in for Google Nearby Connections, shared by the Group Hike tests. No radio: it
// proves the logic, not two real phones.
import type { NearbyLink, NearbyLinkEvents } from '../../src/modules/alerts/nearbyTransport.ts';

/** A stand-in for Google Nearby Connections between phones in one room. Events arrive a tick later. */
export class FakeAir {
  readonly links = new Map<string, FakeLink>();
  add(id: string): FakeLink {
    const link = new FakeLink(id, this);
    this.links.set(id, link);
    return link;
  }
}

type Pending = { a: FakeLink; b: FakeLink; accepted: Set<string>; rejected: boolean };

export class FakeLink implements NearbyLink {
  advertisingAs: string | null = null;
  discovering = false;
  readonly connected = new Set<string>();
  readonly sentTexts: string[] = [];
  failAdvertising = false;
  private readonly listeners = new Map<string, Set<(e: unknown) => void>>();
  private readonly pending = new Map<string, Pending>();

  readonly id: string;
  private readonly air: FakeAir;

  constructor(id: string, air: FakeAir) {
    this.id = id;
    this.air = air;
  }

  addListener<K extends keyof NearbyLinkEvents>(event: K, listener: NearbyLinkEvents[K]) {
    const set = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, set);
    set.add(listener as (e: unknown) => void);
    return { remove: () => set.delete(listener as (e: unknown) => void) };
  }

  listenerCount() {
    let n = 0;
    this.listeners.forEach((set) => (n += set.size));
    return n;
  }

  emit<K extends keyof NearbyLinkEvents>(event: K, payload: Parameters<NearbyLinkEvents[K]>[0]) {
    setTimeout(() => this.listeners.get(event)?.forEach((cb) => cb(payload)), 0);
  }

  async startAdvertising(endpointName: string) {
    if (this.failAdvertising) throw new Error('ERR_NEARBY_8034: missing permission');
    this.advertisingAs = endpointName;
    for (const other of this.air.links.values()) {
      if (other.discovering && other !== this) other.emit('onEndpointFound', { endpointId: this.id, endpointName, serviceId: 's' });
    }
  }
  stopAdvertising() {
    this.advertisingAs = null;
  }
  async startDiscovery() {
    this.discovering = true;
    for (const other of this.air.links.values()) {
      if (other.advertisingAs && other !== this) {
        this.emit('onEndpointFound', { endpointId: other.id, endpointName: other.advertisingAs, serviceId: 's' });
      }
    }
  }
  stopDiscovery() {
    this.discovering = false;
  }
  async requestConnection(localName: string, endpointId: string) {
    const target = this.air.links.get(endpointId);
    if (!target?.advertisingAs) throw new Error('not advertising');
    const pending: Pending = { a: this, b: target, accepted: new Set(), rejected: false };
    this.pending.set(target.id, pending);
    target.pending.set(this.id, pending);
    this.emit('onConnectionInitiated', { endpointId: target.id, endpointName: target.advertisingAs, incoming: false });
    target.emit('onConnectionInitiated', { endpointId: this.id, endpointName: localName, incoming: true });
  }
  private resolve(endpointId: string, accept: boolean) {
    const p = this.pending.get(endpointId);
    if (!p) return;
    if (!accept) p.rejected = true;
    else p.accepted.add(this.id);
    if (!p.rejected && p.accepted.size < 2) return;
    p.a.pending.delete(p.b.id);
    p.b.pending.delete(p.a.id);
    const status = p.rejected ? 'rejected' : 'connected';
    if (!p.rejected) {
      p.a.connected.add(p.b.id);
      p.b.connected.add(p.a.id);
    }
    p.a.emit('onConnectionResult', { endpointId: p.b.id, status, statusCode: p.rejected ? 8004 : 0 });
    p.b.emit('onConnectionResult', { endpointId: p.a.id, status, statusCode: p.rejected ? 8004 : 0 });
  }
  async acceptConnection(endpointId: string) {
    this.resolve(endpointId, true);
  }
  async rejectConnection(endpointId: string) {
    this.resolve(endpointId, false);
  }
  async sendBytes(endpointIds: string[], text: string) {
    for (const id of endpointIds) {
      if (!this.connected.has(id)) throw new Error(`not connected to ${id}`);
      this.sentTexts.push(text);
      this.air.links.get(id)!.emit('onPayload', { endpointId: this.id, text });
    }
  }
  /** As in Nearby: only the other side hears onDisconnected. */
  disconnect(endpointId: string) {
    if (!this.connected.delete(endpointId)) return;
    const other = this.air.links.get(endpointId)!;
    other.connected.delete(this.id);
    other.emit('onDisconnected', { endpointId: this.id });
  }
  stopAll() {
    this.stopAdvertising();
    this.stopDiscovery();
    [...this.connected].forEach((id) => this.disconnect(id));
  }
  /** The phone walks out of range: both sides lose the connection. */
  outOfRange(endpointId: string) {
    const other = this.air.links.get(endpointId)!;
    this.connected.delete(endpointId);
    other.connected.delete(this.id);
    this.emit('onDisconnected', { endpointId });
    other.emit('onDisconnected', { endpointId: this.id });
  }
}

