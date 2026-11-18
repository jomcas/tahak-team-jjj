// Group Hike over Nearby (#23, Phase 1): the versioned message format, the QR join code, the
// member list, and the NearbyTransport joining, relaying and dissolving the group, all over an
// in-memory stand-in for Google Nearby Connections. No phone or radio here: this proves the
// logic, not two real phones.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  admitMember,
  applyRoster,
  dissolve,
  memberList,
  removeGroupMember,
  startJoining,
  startLeading,
} from '../src/modules/alerts/groupHike.ts';
import {
  decodeGroupMessage,
  decodeJoinCode,
  encodeGroupMessage,
  encodeJoinCode,
  isJoinSecret,
  MAX_MEMBERS,
  MAX_MESSAGE_BYTES,
  newJoinSecret,
  utf8Length,
  type GroupMessage,
} from '../src/modules/alerts/groupMessage.ts';
import { NearbyTransport, type NearbyLink, type NearbyLinkEvents } from '../src/modules/alerts/nearbyTransport.ts';
import { createLoopbackPair } from '../src/modules/alerts/transport.ts';
import type { Alert, MemberPosition } from '../src/modules/alerts/types.ts';

const T0 = 1_700_000_000_000;
const HERE = { latitude: 14.0483, longitude: 120.8021 };
// Every stand-in Nearby event is a setTimeout(0); timers of equal delay fire in order, so
// draining this many turns lets any chain of events finish, however busy the machine is.
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function alertOf(memberId: string, memberName: string, extra: Partial<Alert> = {}): Alert {
  return { id: `${memberId}:1`, type: 'deviation', memberId, memberName, position: HERE, time: T0, offTrailM: 55, ...extra };
}

// --- the message format ---

describe('Group Hike messages', () => {
  const messages: GroupMessage[] = [
    { v: 1, kind: 'hello', hikeId: 'gh-abcd1234', secret: 'K7PM3Q', member: { id: 'm-ana', name: 'Ana' } },
    {
      v: 1,
      kind: 'roster',
      hikeId: 'gh-abcd1234',
      leaderId: 'm-ben',
      members: [
        { id: 'm-ben', name: 'Ben' },
        { id: 'm-ana', name: 'Ana' },
      ],
    },
    {
      v: 1,
      kind: 'position',
      hikeId: 'gh-abcd1234',
      update: { memberId: 'm-ana', memberName: 'Ana', position: HERE, time: T0 },
    },
    { v: 1, kind: 'alert', hikeId: 'gh-abcd1234', alert: alertOf('m-ana', 'Ana') },
    { v: 1, kind: 'leave', hikeId: 'gh-abcd1234', memberId: 'm-ana' },
    { v: 1, kind: 'end', hikeId: 'gh-abcd1234' },
  ];

  for (const message of messages) {
    test(`a ${message.kind} message survives encoding`, () => {
      const text = encodeGroupMessage(message);
      assert.ok(text);
      assert.deepEqual(decodeGroupMessage(text), message);
    });
  }

  test('every Alert type round-trips, and a Flare carries no distance', () => {
    for (const type of ['deviation', 'deviation-cleared', 'flare', 'flare-stopped'] as const) {
      const alert = alertOf('m-ana', 'Ana', { type, offTrailM: undefined });
      const decoded = decodeGroupMessage(encodeGroupMessage({ v: 1, kind: 'alert', hikeId: 'gh-1234', alert })!);
      assert.equal(decoded?.kind, 'alert');
      assert.equal(decoded?.kind === 'alert' && decoded.alert.type, type);
      assert.equal(decoded?.kind === 'alert' && 'offTrailM' in decoded.alert, false);
    }
  });

  test('a real member is never labelled simulated, even if a payload says so', () => {
    const text = JSON.stringify({ v: 1, kind: 'alert', hikeId: 'gh-1234', alert: { ...alertOf('m-ana', 'Ana'), simulated: true } });
    const decoded = decodeGroupMessage(text);
    assert.equal(decoded?.kind === 'alert' && decoded.alert.simulated, undefined);
  });

  test('drops what it cannot trust, without throwing', () => {
    const base = { v: 1, kind: 'position', hikeId: 'gh-1234' };
    const update = { memberId: 'm-ana', memberName: 'Ana', position: HERE, time: T0 };
    const bad: unknown[] = [
      'not json',
      '[]',
      'null',
      { ...base, v: 2, update }, // a newer version
      { ...base, v: '1', update },
      { ...base, kind: 'party', update },
      { ...base, hikeId: '', update },
      { ...base, update: { ...update, position: { latitude: 91, longitude: 120 } } },
      { ...base, update: { ...update, position: { latitude: 14, longitude: -181 } } },
      { ...base, update: { ...update, position: { latitude: 'x', longitude: 120 } } },
      { ...base, update: { ...update, time: null } },
      { ...base, update: { ...update, memberName: '   ' } },
      { ...base, update: { ...update, memberName: 'A'.repeat(41) } },
      { ...base, update: { ...update, memberId: 'x'.repeat(65) } },
      { v: 1, kind: 'alert', hikeId: 'gh-1234', alert: { ...alertOf('m', 'M'), type: 'party' } },
      { v: 1, kind: 'alert', hikeId: 'gh-1234', alert: { ...alertOf('m', 'M'), offTrailM: -3 } },
      { v: 1, kind: 'hello', hikeId: 'gh-1234', secret: 'OOOOOO', member: { id: 'm', name: 'M' } },
      { v: 1, kind: 'roster', hikeId: 'gh-1234', leaderId: 'm-x', members: [{ id: 'm-a', name: 'A' }] },
      {
        v: 1,
        kind: 'roster',
        hikeId: 'gh-1234',
        leaderId: 'm-0',
        members: Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => ({ id: `m-${i}`, name: `M${i}` })),
      },
      { v: 1, kind: 'leave', hikeId: 'gh-1234' },
    ];
    for (const entry of bad) {
      const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
      assert.equal(decodeGroupMessage(text), null, text.slice(0, 120));
    }
  });

  test('is bounded: nothing over 4 KB is sent or read', () => {
    const huge = { v: 1, kind: 'leave', hikeId: 'gh-1234', memberId: 'm', pad: 'x'.repeat(MAX_MESSAGE_BYTES) } as const;
    assert.equal(decodeGroupMessage(JSON.stringify(huge)), null);
    const tooBig = { v: 1, kind: 'leave', hikeId: 'gh-1234', memberId: 'm', pad: 'x'.repeat(MAX_MESSAGE_BYTES) };
    assert.equal(encodeGroupMessage(tooBig as unknown as GroupMessage), null);
  });

  test('measures UTF-8 bytes as Nearby sends them', () => {
    for (const text of ['Ana', 'Niño', 'Bundok ⛰', '🥾 trail', '']) {
      assert.equal(utf8Length(text), Buffer.byteLength(text, 'utf8'), text);
    }
  });
});

// --- the QR code ---

describe('Group Hike QR code', () => {
  const code = { hikeId: 'gh-4fk2p9xa', secret: 'K7PM3Q', leaderEndpointName: 'tahak-k7pm3q' };

  test('holds the Hike id, the join secret and the leader endpoint name', () => {
    const text = encodeJoinCode(code);
    assert.equal(text, 'TAHAK-GROUP|1|gh-4fk2p9xa|K7PM3Q|tahak-k7pm3q');
    assert.deepEqual(decodeJoinCode(text), code);
    assert.deepEqual(decodeJoinCode(`  ${text}\n`), code, 'a scanner may add whitespace');
  });

  test('rejects anything that is not a Tahak Group Hike code this version reads', () => {
    for (const text of [
      '',
      'https://example.com',
      'TAHAK-GROUP|2|gh-4fk2p9xa|K7PM3Q|tahak-k7pm3q',
      'OTHER|1|gh-4fk2p9xa|K7PM3Q|tahak-k7pm3q',
      'TAHAK-GROUP|1|gh-4fk2p9xa|K7PM3|tahak-k7pm3q',
      'TAHAK-GROUP|1|gh-4fk2p9xa|K7PM0Q|tahak-k7pm3q',
      'TAHAK-GROUP|1|gh-4fk2p9xa|K7PM3Q|Ana Santos',
      'TAHAK-GROUP|1|gh 4fk2|K7PM3Q|tahak-k7pm3q',
      'TAHAK-GROUP|1|gh-4fk2p9xa|K7PM3Q|tahak-k7pm3q|extra',
      `TAHAK-GROUP|1|${'g'.repeat(300)}|K7PM3Q|tahak-k7pm3q`,
    ]) {
      assert.equal(decodeJoinCode(text), null, text.slice(0, 80));
    }
  });

  test('will not encode a code that would not scan back', () => {
    assert.throws(() => encodeJoinCode({ ...code, secret: 'abc' }));
    assert.throws(() => encodeJoinCode({ ...code, hikeId: 'a|b' }));
    assert.throws(() => encodeJoinCode({ ...code, leaderEndpointName: 'Ana' }));
  });

  test('join secrets are six easy-to-read characters', () => {
    const random = seeded(7);
    for (let i = 0; i < 200; i++) {
      const secret = newJoinSecret(random);
      assert.ok(isJoinSecret(secret), secret);
      assert.doesNotMatch(secret, /[01OIL]/);
    }
    assert.equal(newJoinSecret(() => 0.999999), '999999');
  });
});

// --- the member list ---

describe('Group Hike member list', () => {
  const ben = { id: 'm-ben', name: 'Ben' };
  const ana = { id: 'm-ana', name: 'Ana' };
  const cara = { id: 'm-cara', name: 'Cara' };

  test('the leader is first, then this phone, then everyone by name', () => {
    let leader = startLeading(ben, 'gh-1234');
    leader = admitMember(leader, cara);
    leader = admitMember(leader, ana);
    assert.deepEqual(
      memberList(leader).map((m) => [m.name, m.isLeader, m.isSelf]),
      [
        ['Ben', true, true],
        ['Ana', false, false],
        ['Cara', false, false],
      ],
    );
    const joiner = applyRoster(startJoining(cara, 'gh-1234'), ben.id, [ben, ana]);
    assert.equal(joiner.status, 'joined');
    assert.deepEqual(
      memberList(joiner).map((m) => m.name),
      ['Ben', 'Cara', 'Ana'],
      'the roster always includes this phone',
    );
  });

  test('admits up to the limit, and never this phone or the leader twice', () => {
    let leader = startLeading(ben, 'gh-1234');
    for (let i = 0; i < MAX_MEMBERS + 5; i++) leader = admitMember(leader, { id: `m-${i}`, name: `M${i}` });
    assert.equal(Object.keys(leader.members).length, MAX_MEMBERS);
    assert.equal(admitMember(leader, ben), leader);
    assert.equal(removeGroupMember(leader, ben.id), leader, 'the leader is never removed as a member');
    const smaller = removeGroupMember(leader, 'm-0');
    assert.equal(smaller.members['m-0'], undefined);
  });

  test('ending the Hike dissolves the group and clears every member', () => {
    const leader = admitMember(startLeading(ben, 'gh-1234'), ana);
    const ended = dissolve(leader, 'hike-ended');
    assert.equal(ended.status, 'dissolved');
    assert.equal(ended.endReason, 'hike-ended');
    assert.deepEqual(ended.members, {});
    assert.deepEqual(memberList(ended), []);
    assert.equal(admitMember(ended, ana), ended, 'a dissolved group takes no one back');
    assert.equal(dissolve(ended, 'left'), ended);
  });
});

// --- the transport, over an in-memory Nearby ---

/** A stand-in for Google Nearby Connections between phones in one room. Events arrive a tick later. */
class FakeAir {
  readonly links = new Map<string, FakeLink>();
  add(id: string): FakeLink {
    const link = new FakeLink(id, this);
    this.links.set(id, link);
    return link;
  }
}

type Pending = { a: FakeLink; b: FakeLink; accepted: Set<string>; rejected: boolean };

class FakeLink implements NearbyLink {
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

function phone(air: FakeAir, id: string, name: string, seed: number, helloTimeoutMs = 60_000) {
  const link = air.add(`ep-${id}`);
  const transport = new NearbyTransport({ link, self: { id, name }, random: seeded(seed), log: () => {}, helloTimeoutMs });
  const alerts: Alert[] = [];
  const positions: MemberPosition[] = [];
  const left: string[] = [];
  transport.onReceive((a) => alerts.push(a));
  transport.onPosition((p) => positions.push(p));
  transport.onMemberLeft((m) => left.push(m));
  return { link, transport, alerts, positions, left };
}

async function threePhoneGroup() {
  const air = new FakeAir();
  const ben = phone(air, 'm-ben', 'Ben', 1);
  const ana = phone(air, 'm-ana', 'Ana', 2);
  const cara = phone(air, 'm-cara', 'Cara', 3);
  const qr = await ben.transport.lead('gh-4fk2p9xa');
  assert.equal(await ana.transport.join(qr), true);
  await settle();
  assert.equal(await cara.transport.join(qr), true);
  await settle();
  return { air, ben, ana, cara, qr };
}

const names = (t: NearbyTransport) => memberList(t.getGroup()).map((m) => m.name);

describe('NearbyTransport (in-memory Nearby, not real phones)', () => {
  test('the leader advertises the endpoint name in its QR code', async () => {
    const air = new FakeAir();
    const ben = phone(air, 'm-ben', 'Ben', 1);
    const qr = await ben.transport.lead('gh-4fk2p9xa');
    const code = decodeJoinCode(qr);
    assert.ok(code);
    assert.equal(code.hikeId, 'gh-4fk2p9xa');
    assert.equal(ben.link.advertisingAs, code.leaderEndpointName);
    assert.equal(ben.transport.getGroup().status, 'leading');
    await ben.transport.endHike();
  });

  test('two joiners scan the QR code and everyone sees the same members', async () => {
    const { ben, ana, cara } = await threePhoneGroup();
    assert.equal(ana.transport.getGroup().status, 'joined');
    assert.equal(cara.transport.getGroup().status, 'joined');
    assert.deepEqual(names(ben.transport), ['Ben', 'Ana', 'Cara']);
    assert.deepEqual(names(ana.transport), ['Ben', 'Ana', 'Cara']);
    assert.deepEqual(names(cara.transport), ['Ben', 'Cara', 'Ana']);
    assert.equal(ana.link.discovering, false, 'a joined member stops looking');
    await ben.transport.endHike();
    await settle();
  });

  test('positions and Alerts reach every other member, never the sender', async () => {
    const { ben, ana, cara } = await threePhoneGroup();
    ana.transport.sendPosition({ memberId: 'this-phone', memberName: 'This phone', position: HERE, time: T0 });
    ana.transport.send(alertOf('this-phone', 'This phone'));
    await settle();
    await settle();
    for (const other of [ben, cara]) {
      assert.deepEqual(other.positions, [{ memberId: 'm-ana', memberName: 'Ana', position: HERE, time: T0 }]);
      assert.equal(other.alerts.length, 1);
      assert.equal(other.alerts[0].memberId, 'm-ana', 'the transport speaks as this member');
      assert.equal(other.alerts[0].memberName, 'Ana');
      assert.equal(other.alerts[0].type, 'deviation');
      assert.equal(other.alerts[0].offTrailM, 55);
    }
    assert.equal(ana.alerts.length, 0);
    assert.equal(ana.positions.length, 0);

    ben.transport.send(alertOf('this-phone', 'This phone', { type: 'flare', offTrailM: undefined }));
    await settle();
    assert.equal(ana.alerts.at(-1)?.memberId, 'm-ben');
    assert.equal(cara.alerts.at(-1)?.type, 'flare');
    assert.equal(ben.alerts.length, 1, 'the leader does not hear itself');
    await ben.transport.endHike();
    await settle();
  });

  test('the leader drops a member speaking for someone else', async () => {
    const { ben, ana, cara } = await threePhoneGroup();
    const spoof = encodeGroupMessage({ v: 1, kind: 'alert', hikeId: 'gh-4fk2p9xa', alert: alertOf('m-cara', 'Cara') })!;
    await ana.link.sendBytes([ben.link.id], spoof);
    await settle();
    await settle();
    assert.deepEqual(ben.alerts, []);
    assert.deepEqual(cara.alerts, []);
    await ben.transport.endHike();
    await settle();
  });

  test('ignores messages from another Group Hike', async () => {
    const { ben, ana } = await threePhoneGroup();
    const other = encodeGroupMessage({ v: 1, kind: 'alert', hikeId: 'gh-otherhike', alert: alertOf('m-ana', 'Ana') })!;
    await ana.link.sendBytes([ben.link.id], other);
    await settle();
    assert.deepEqual(ben.alerts, []);
    await ben.transport.endHike();
    await settle();
  });

  test('a joiner with the wrong secret is disconnected and never listed', async () => {
    const air = new FakeAir();
    const ben = phone(air, 'm-ben', 'Ben', 1);
    const eve = phone(air, 'm-eve', 'Eve', 9);
    const qr = await ben.transport.lead('gh-4fk2p9xa');
    const forged = qr.replace(/\|[A-Z2-9]{6}\|/, '|ZZZZZZ|');
    assert.notEqual(forged, qr);
    await eve.transport.join(forged);
    await settle();
    await settle();
    assert.deepEqual(names(ben.transport), ['Ben']);
    assert.equal(ben.link.connected.size, 0);
    assert.equal(eve.transport.getGroup().status, 'dissolved');
    assert.equal(eve.transport.getGroup().endReason, 'leader-lost');
    await ben.transport.endHike();
  });

  test('a connection that never says hello is dropped', async () => {
    const air = new FakeAir();
    const ben = phone(air, 'm-ben', 'Ben', 1, 500);
    const stranger = air.add('ep-stranger');
    await ben.transport.lead('gh-4fk2p9xa');
    await stranger.requestConnection('tahak-zzzzzz', ben.link.id);
    await settle();
    await stranger.acceptConnection(ben.link.id);
    await settle();
    assert.equal(ben.link.connected.has('ep-stranger'), true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(ben.link.connected.has('ep-stranger'), false);
    assert.deepEqual(names(ben.transport), ['Ben']);
    await ben.transport.endHike();
  });

  test('a member ending their Hike leaves; the others see them go', async () => {
    const { ben, ana, cara } = await threePhoneGroup();
    await ana.transport.endHike();
    await settle();
    await settle();
    assert.equal(ana.transport.getGroup().status, 'dissolved');
    assert.equal(ana.transport.getGroup().endReason, 'hike-ended');
    assert.deepEqual(ana.left.sort(), ['m-ben', 'm-cara'], 'everyone leaves this phone’s map');
    assert.deepEqual(names(ben.transport), ['Ben', 'Cara']);
    assert.deepEqual(names(cara.transport), ['Ben', 'Cara']);
    assert.deepEqual(ben.left, ['m-ana']);
    assert.deepEqual(cara.left, ['m-ana']);
    await ben.transport.endHike();
    await settle();
  });

  test('the leader ending the Hike dissolves the group for everyone', async () => {
    const { ben, ana, cara } = await threePhoneGroup();
    await ben.transport.endHike();
    await settle();
    await settle();
    for (const p of [ben, ana, cara]) {
      const group = p.transport.getGroup();
      assert.equal(group.status, 'dissolved');
      assert.deepEqual(group.members, {});
      assert.equal(p.link.connected.size, 0);
      assert.equal(p.link.listenerCount(), 0, 'no Nearby listeners left behind');
    }
    assert.equal(ben.transport.getGroup().endReason, 'hike-ended');
    assert.equal(ana.transport.getGroup().endReason, 'leader-ended');
    assert.equal(ben.link.advertisingAs, null);

    // Nothing flows after the group dissolves, and the link is not reused for the next Hike.
    ana.transport.send(alertOf('x', 'x'));
    await settle();
    assert.deepEqual(ben.alerts, []);
    await assert.rejects(ana.transport.lead());
  });

  test('losing the leader dissolves the group for a member', async () => {
    const { ben, ana } = await threePhoneGroup();
    ana.link.outOfRange(ben.link.id);
    await settle();
    await settle();
    assert.equal(ana.transport.getGroup().status, 'dissolved');
    assert.equal(ana.transport.getGroup().endReason, 'leader-lost');
    assert.deepEqual(names(ben.transport), ['Ben', 'Cara']);
    await ben.transport.endHike();
    await settle();
  });

  test('a phone that cannot advertise stays on a Solo Hike and can try again', async () => {
    const air = new FakeAir();
    const ben = phone(air, 'm-ben', 'Ben', 1);
    ben.link.failAdvertising = true;
    await assert.rejects(ben.transport.lead('gh-4fk2p9xa'), /permission/);
    assert.equal(ben.transport.getGroup().status, 'none');
    assert.equal(ben.link.listenerCount(), 0);
    ben.link.failAdvertising = false;
    await ben.transport.lead('gh-4fk2p9xa');
    assert.equal(ben.transport.getGroup().status, 'leading');
    await ben.transport.endHike();
  });

  test('a QR code from something else does not start a join', async () => {
    const air = new FakeAir();
    const ana = phone(air, 'm-ana', 'Ana', 2);
    assert.equal(await ana.transport.join('https://example.com'), false);
    assert.equal(ana.transport.getGroup().status, 'none');
    assert.equal(ana.link.discovering, false);
  });

  test('the loopback still works beside it, for the simulated member', async () => {
    const [phoneEnd, otherEnd] = createLoopbackPair();
    const got: Alert[] = [];
    phoneEnd.onReceive((a) => got.push(a));
    otherEnd.send(alertOf('ana-sim', 'Ana', { simulated: true }));
    await settle();
    assert.equal(got.length, 1);
    assert.equal(got[0].simulated, true);
  });
});
