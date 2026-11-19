// Group Hike, Phase 2 (#23): the session that starts or joins a Group Hike for the running
// Hike and plugs Nearby into the Alerts store; the Android permissions and manifest entries;
// the QR code drawing; and the transport that keeps the simulated member beside Nearby.
// All over an in-memory Nearby: this proves the wiring, not two real phones or radios.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

import {
  alertsStore,
  attachGroupTransport,
  detachGroupTransport,
  removeMember,
  SELF_ID,
  sendAlert,
  sendPosition,
  SIMULATED_MEMBER_ID,
  simulatedPeerTransport,
} from '../src/modules/alerts/alertsStore.ts';
import { decodeJoinCode } from '../src/modules/alerts/groupMessage.ts';
import {
  cleanMemberName,
  createGroupSession,
  nearbyStatusCode,
  POSITION_SHARE_MS,
  shouldSharePosition,
  startErrorOf,
  type GroupSessionDeps,
} from '../src/modules/alerts/groupSession.ts';
import { memberDot, memberStatus } from '../src/modules/alerts/memberState.ts';
import { NEARBY_PERMISSION, nearbyPermissionsGranted, nearbyRuntimePermissions } from '../src/modules/alerts/nearbyPermissions.ts';
import { isDarkAt, qrMatrix } from '../src/modules/alerts/qrMatrix.ts';
import { createLoopbackPair, GroupTransport, type AlertTransport } from '../src/modules/alerts/transport.ts';
import type { Alert, MemberPosition } from '../src/modules/alerts/types.ts';
import hikeStrings from '../src/modules/hike/strings.ts';
import { FakeAir, type FakeLink } from './fixtures/fakeNearby.ts';

const require = createRequire(import.meta.url);
const HERE = { latitude: 14.0483, longitude: 120.8021 };
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

/** One phone's Alerts store, as the session sees it through its seam. */
function phoneStore() {
  const members = new Map<string, { name: string; position: MemberPosition['position'] | null; alerts: Alert[] }>();
  let stops: (() => void)[] = [];
  let attached: AlertTransport | null = null;
  const calls: string[] = [];
  const touch = (id: string, name: string) => {
    const member = members.get(id) ?? { name, position: null, alerts: [] };
    members.set(id, member);
    return member;
  };
  return {
    members,
    calls,
    get attached() {
      return attached;
    },
    attach(remote: AlertTransport) {
      calls.push('attach');
      attached = remote;
      stops = [
        remote.onPosition((u) => (touch(u.memberId, u.memberName).position = u.position)),
        remote.onReceive((a) => touch(a.memberId, a.memberName).alerts.push(a)),
      ];
    },
    detach() {
      calls.push('detach');
      stops.forEach((stop) => stop());
      stops = [];
      attached = null;
    },
    removeMember(id: string) {
      members.delete(id);
    },
  };
}

function groupPhone(air: FakeAir, id: string, seed: number, extra: Partial<GroupSessionDeps> = {}) {
  const link = air.add(`ep-${id}`);
  const store = phoneStore();
  const session = createGroupSession({
    link,
    requestPermissions: async () => true,
    attach: (remote) => store.attach(remote),
    detach: () => store.detach(),
    removeMember: (memberId) => store.removeMember(memberId),
    random: seeded(seed),
    log: () => {},
    ...extra,
  });
  return { link, store, session };
}

describe('Group Hike session (in-memory Nearby, not real phones)', () => {
  test('the leader starts a Group Hike with its Hike and gets a QR code', async () => {
    const air = new FakeAir();
    const ben = groupPhone(air, 'ben', 1);
    assert.equal(await ben.session.lead(7, '  Ben  '), true);
    const view = ben.session.getSnapshot();
    assert.equal(view.hikeId, 7);
    assert.equal(view.group?.status, 'leading');
    assert.equal(view.group?.self.name, 'Ben');
    const code = decodeJoinCode(view.qr ?? '');
    assert.ok(code);
    assert.equal(ben.link.advertisingAs, code.leaderEndpointName);
    assert.deepEqual(ben.store.calls, ['attach']);
    assert.equal(ben.session.isLinked(), true);
    await ben.session.end();
  });

  test('a joiner scans the QR code; each phone sees the other move and gets their Alerts', async () => {
    const air = new FakeAir();
    const ben = groupPhone(air, 'ben', 1);
    const ana = groupPhone(air, 'ana', 2);
    await ben.session.lead(1, 'Ben');
    assert.equal(await ana.session.join(4, 'Ana', ben.session.getSnapshot().qr as string), true);
    assert.equal(ana.session.getSnapshot().group?.status, 'joining');
    await settle();
    assert.equal(ana.session.getSnapshot().group?.status, 'joined');
    assert.deepEqual(Object.values(ben.session.getSnapshot().group?.members ?? {}).map((m) => m.name).sort(), ['Ana', 'Ben']);

    // Both directions, through the Alerts store seam (what the map dots and banners read).
    ben.store.attached?.sendPosition({ memberId: SELF_ID, memberName: 'This phone', position: HERE, time: 1 });
    ana.store.attached?.sendPosition({ memberId: SELF_ID, memberName: 'This phone', position: { latitude: 14.05, longitude: 120.81 }, time: 2 });
    ana.store.attached?.send({ id: `${SELF_ID}:1`, type: 'deviation', memberId: SELF_ID, memberName: 'This phone', position: HERE, time: 3, offTrailM: 52 });
    await settle();
    const benOnAna = [...ana.store.members.values()];
    const anaOnBen = [...ben.store.members.values()];
    assert.deepEqual(benOnAna.map((m) => [m.name, m.position]), [['Ben', HERE]]);
    assert.equal(anaOnBen.length, 1);
    assert.equal(anaOnBen[0].name, 'Ana');
    assert.equal(anaOnBen[0].alerts[0]?.type, 'deviation');
    assert.equal(anaOnBen[0].alerts[0]?.offTrailM, 52);
    // A phone never shows itself.
    assert.ok(![...ben.store.members.keys()].includes(SELF_ID));
    await ben.session.end();
    await settle();
  });

  test('ending the Hike dissolves the group: disconnects, clears members, unplugs Nearby', async () => {
    const air = new FakeAir();
    const ben = groupPhone(air, 'ben', 1);
    const ana = groupPhone(air, 'ana', 2);
    await ben.session.lead(1, 'Ben');
    await ana.session.join(2, 'Ana', ben.session.getSnapshot().qr as string);
    await settle();
    ben.store.attached?.sendPosition({ memberId: SELF_ID, memberName: 'x', position: HERE, time: 1 });
    ana.store.attached?.sendPosition({ memberId: SELF_ID, memberName: 'x', position: HERE, time: 1 });
    await settle();
    assert.equal(ana.store.members.size, 1);
    assert.equal(ben.store.members.size, 1);

    // The same Hike still running changes nothing.
    await ben.session.hikeChanged(1);
    assert.equal(ben.session.getSnapshot().group?.status, 'leading');

    // The leader's Hike ends (hikeStore goes to no Hike).
    await ben.session.hikeChanged(null);
    await settle();
    assert.deepEqual(ben.session.getSnapshot(), { hikeId: null, group: null, qr: null, error: null, busy: false });
    assert.equal(ben.store.members.size, 0);
    assert.deepEqual(ben.store.calls, ['attach', 'detach']);
    assert.equal(ben.link.advertisingAs, null);
    assert.equal(ben.link.connected.size, 0);

    // The member's group ended with it: told why, off the map, back on the loopback.
    const anaView = ana.session.getSnapshot();
    assert.equal(anaView.hikeId, 2);
    assert.equal(anaView.group?.status, 'dissolved');
    assert.equal(anaView.group?.endReason, 'leader-ended');
    assert.equal(ana.store.members.size, 0);
    assert.deepEqual(ana.store.calls, ['attach', 'detach']);
    assert.equal(ana.session.isLinked(), false);

    // Its own Hike ending later clears the note.
    await ana.session.hikeChanged(null);
    assert.equal(ana.session.getSnapshot().group, null);
  });

  test('a member leaving takes their dot off the leader’s map; the leader goes on', async () => {
    const air = new FakeAir();
    const ben = groupPhone(air, 'ben', 1);
    const ana = groupPhone(air, 'ana', 2);
    await ben.session.lead(1, 'Ben');
    await ana.session.join(2, 'Ana', ben.session.getSnapshot().qr as string);
    await settle();
    ana.store.attached?.sendPosition({ memberId: SELF_ID, memberName: 'x', position: HERE, time: 1 });
    await settle();
    assert.equal(ben.store.members.size, 1);
    await ana.session.end();
    await settle();
    assert.equal(ben.store.members.size, 0);
    assert.equal(ben.session.getSnapshot().group?.status, 'leading');
    assert.equal(Object.keys(ben.session.getSnapshot().group?.members ?? {}).length, 1);
    await ben.session.end();
  });

  test('losing the leader’s phone ends the group on the member, with its own note', async () => {
    const air = new FakeAir();
    const ben = groupPhone(air, 'ben', 1);
    const ana = groupPhone(air, 'ana', 2);
    await ben.session.lead(1, 'Ben');
    await ana.session.join(2, 'Ana', ben.session.getSnapshot().qr as string);
    await settle();
    (ana.link as FakeLink).outOfRange(ben.link.id);
    await settle();
    assert.equal(ana.session.getSnapshot().group?.endReason, 'leader-lost');
    assert.deepEqual(ana.store.calls, ['attach', 'detach']);
    await ben.session.end();
  });

  test('without the nearby-devices permission, nothing starts and nothing is plugged in', async () => {
    const air = new FakeAir();
    let watched = 0;
    const ben = groupPhone(air, 'ben', 1, { requestPermissions: async () => false, onStart: () => watched++ });
    assert.equal(await ben.session.lead(1, 'Ben'), false);
    // The app starts watching the running Hike as soon as a Group Hike is tried.
    assert.equal(watched, 1);
    assert.equal(ben.session.getSnapshot().error, 'permission');
    assert.equal(ben.session.getSnapshot().hikeId, 1);
    assert.equal(ben.link.advertisingAs, null);
    assert.deepEqual(ben.store.calls, []);
  });

  test('a build without the Nearby module says so', async () => {
    const store = phoneStore();
    const session = createGroupSession({
      link: null,
      requestPermissions: async () => true,
      attach: (r) => store.attach(r),
      detach: () => store.detach(),
      removeMember: () => {},
    });
    assert.equal(await session.lead(1, 'Ben'), false);
    assert.equal(session.getSnapshot().error, 'unavailable');
    assert.deepEqual(store.calls, []);
  });

  test('a failed advertise says why, and Try again works once it is fixed', async () => {
    const air = new FakeAir();
    const ben = groupPhone(air, 'ben', 1);
    ben.link.failAdvertising = true;
    assert.equal(await ben.session.lead(1, 'Ben'), false);
    // The fake rejects with ERR_NEARBY_8034, a missing-permission code.
    assert.equal(ben.session.getSnapshot().error, 'permission');
    assert.deepEqual(ben.store.calls, ['attach', 'detach']);
    ben.link.failAdvertising = false;
    assert.equal(await ben.session.retry(), true);
    assert.equal(ben.session.getSnapshot().error, null);
    assert.equal(ben.session.getSnapshot().group?.status, 'leading');
    await ben.session.end();
  });

  test('maps Nearby status codes to what the hiker can fix', () => {
    assert.equal(nearbyStatusCode({ code: 'ERR_NEARBY_8037', message: 'x' }), 8037);
    assert.equal(nearbyStatusCode(new Error('start advertising failed (ERR_NEARBY_8007)')), 8007);
    assert.equal(nearbyStatusCode('nothing'), null);
    assert.equal(startErrorOf({ code: 'ERR_NEARBY_8037' }), 'permission'); // MISSING_PERMISSION_BLUETOOTH_SCAN
    assert.equal(startErrorOf({ code: 'ERR_NEARBY_8007' }), 'radio'); // STATUS_RADIO_ERROR
    assert.equal(startErrorOf(new Error('boom')), 'radio');
  });

  test('another app’s QR code does not start a join', async () => {
    const air = new FakeAir();
    const ana = groupPhone(air, 'ana', 2);
    assert.equal(await ana.session.join(1, 'Ana', 'https://example.com'), false);
    assert.equal(ana.session.getSnapshot().error, 'bad-code');
    assert.equal(ana.link.discovering, false);
    assert.deepEqual(ana.store.calls, ['attach', 'detach']);
  });

  test('needs a name; a name is one line within the limit', async () => {
    const air = new FakeAir();
    const ben = groupPhone(air, 'ben', 1);
    assert.equal(await ben.session.lead(1, '   '), false);
    assert.equal(ben.session.getSnapshot().hikeId, null);
    assert.equal(cleanMemberName('  Ana\n  Cruz '), 'Ana Cruz');
    assert.equal(cleanMemberName('x'.repeat(60)).length, 40);
  });

  test('each Group Hike is new: a second Hike gets a new group, id and QR code', async () => {
    const air = new FakeAir();
    const ben = groupPhone(air, 'ben', 1);
    await ben.session.lead(1, 'Ben');
    const first = ben.session.getSnapshot();
    await ben.session.lead(2, 'Ben');
    const second = ben.session.getSnapshot();
    assert.equal(second.hikeId, 2);
    assert.notEqual(second.group?.hikeId, first.group?.hikeId);
    assert.notEqual(second.group?.self.id, first.group?.self.id);
    assert.notEqual(second.qr, first.qr);
    assert.deepEqual(ben.store.calls, ['attach', 'detach', 'attach']);
    await ben.session.end();
  });

  test('positions go out every few seconds, sooner after a real move', () => {
    assert.equal(shouldSharePosition(null, HERE, 0), true);
    const last = { position: HERE, sentAt: 10_000 };
    assert.equal(shouldSharePosition(last, HERE, 10_000 + POSITION_SHARE_MS - 1), false);
    assert.equal(shouldSharePosition(last, HERE, 10_000 + POSITION_SHARE_MS), true);
    const moved = { latitude: HERE.latitude + 0.0005, longitude: HERE.longitude }; // ~55 m
    assert.equal(shouldSharePosition(last, moved, 10_500), false); // never more than once a second
    assert.equal(shouldSharePosition(last, moved, 11_000), true);
  });
});

describe('Group Hike with the real Alerts store', () => {
  test('a Nearby member shows as an olive dot beside the simulated member, never duplicated', async () => {
    const air = new FakeAir();
    const ben = air.add('ep-ben');
    const anaPhone = groupPhone(air, 'ana', 2);
    const session = createGroupSession({
      link: ben,
      requestPermissions: async () => true,
      attach: attachGroupTransport,
      detach: detachGroupTransport,
      removeMember,
      random: seeded(1),
      log: () => {},
    });
    assert.equal(await session.lead(1, 'Ben'), true);
    await anaPhone.session.join(2, 'Ana', session.getSnapshot().qr as string);
    await settle();

    // The simulated member still walks on the loopback while the group is linked.
    simulatedPeerTransport().sendPosition({ memberId: SIMULATED_MEMBER_ID, memberName: 'Ana', position: HERE, time: 1, simulated: true });
    // The real Ana's phone, and a payload pretending to be the simulated member or this phone.
    anaPhone.store.attached?.sendPosition({ memberId: SELF_ID, memberName: 'x', position: { latitude: 14.05, longitude: 120.81 }, time: 2 });
    await settle();
    const anaId = anaPhone.session.getSnapshot().group?.self.id as string;
    const members = alertsStore.getMembers();
    assert.deepEqual(Object.keys(members).sort(), [anaId, SIMULATED_MEMBER_ID].sort());
    assert.equal(members[SIMULATED_MEMBER_ID].simulated, true);
    assert.equal(members[anaId].simulated, false);
    assert.equal(members[anaId].name, 'Ana');
    assert.deepEqual(memberDot(memberStatus(members[anaId])), { fill: 'olive', icon: null, pulse: false });

    // This phone's own Alert and position reach the real member over Nearby.
    sendAlert('flare', HERE, { time: 5 });
    sendPosition(HERE, 6);
    await settle();
    const benOnAna = [...anaPhone.store.members.values()];
    assert.equal(benOnAna.length, 1);
    assert.equal(benOnAna[0].name, 'Ben');
    assert.equal(benOnAna[0].alerts[0]?.type, 'flare');
    assert.deepEqual(benOnAna[0].position, HERE);

    // The Hike ends: the real member leaves the map; the simulated one stays until its Hike
    // cleanup removes it, and the loopback still carries it.
    await session.hikeChanged(null);
    await settle();
    assert.deepEqual(Object.keys(alertsStore.getMembers()), [SIMULATED_MEMBER_ID]);
    simulatedPeerTransport().sendPosition({ memberId: SIMULATED_MEMBER_ID, memberName: 'Ana', position: { latitude: 14.06, longitude: 120.8 }, time: 7, simulated: true });
    await settle();
    assert.equal(alertsStore.getMembers()[SIMULATED_MEMBER_ID].position?.latitude, 14.06);
    removeMember(SIMULATED_MEMBER_ID);
  });
});

describe('GroupTransport', () => {
  test('sends on both links and drops remote messages claiming a local-only id', async () => {
    const [local, localPeer] = createLoopbackPair();
    const [remote, remotePeer] = createLoopbackPair();
    const group = new GroupTransport(local, remote, new Set([SELF_ID, SIMULATED_MEMBER_ID]));
    const got: string[] = [];
    const stop = group.onPosition((u) => got.push(u.memberId));
    const gotAlerts: string[] = [];
    group.onReceive((a) => gotAlerts.push(a.memberId));
    localPeer.sendPosition({ memberId: SIMULATED_MEMBER_ID, memberName: 'Ana', position: HERE, time: 1 });
    remotePeer.sendPosition({ memberId: SIMULATED_MEMBER_ID, memberName: 'Ana', position: HERE, time: 1 });
    remotePeer.sendPosition({ memberId: SELF_ID, memberName: 'x', position: HERE, time: 1 });
    remotePeer.sendPosition({ memberId: 'm-ben', memberName: 'Ben', position: HERE, time: 1 });
    remotePeer.send({ id: 'a', type: 'flare', memberId: SIMULATED_MEMBER_ID, memberName: 'Ana', position: HERE, time: 1 });
    await settle();
    assert.deepEqual(got, [SIMULATED_MEMBER_ID, 'm-ben']);
    assert.deepEqual(gotAlerts, []);
    group.send({ id: 'b', type: 'flare', memberId: SELF_ID, memberName: 'x', position: HERE, time: 1 });
    assert.equal(local.sent.length, 1);
    assert.equal(remote.sent.length, 1);
    stop();
    remotePeer.sendPosition({ memberId: 'm-ben', memberName: 'Ben', position: HERE, time: 2 });
    await settle();
    assert.equal(got.length, 2);
  });
});

describe('Nearby permissions (developers.google.com/nearby/connections/android/get-started)', () => {
  const P = NEARBY_PERMISSION;
  test('by Android version', () => {
    assert.deepEqual(nearbyRuntimePermissions(28), { required: [P.coarseLocation], optional: [] });
    assert.deepEqual(nearbyRuntimePermissions(30), { required: [P.coarseLocation, P.fineLocation], optional: [] });
    assert.deepEqual(nearbyRuntimePermissions(31).required, [P.coarseLocation, P.fineLocation, P.bluetoothAdvertise, P.bluetoothConnect, P.bluetoothScan]);
    const thirteen = [P.bluetoothAdvertise, P.bluetoothConnect, P.bluetoothScan, P.nearbyWifi];
    assert.deepEqual(nearbyRuntimePermissions(33), { required: thirteen, optional: [] });
    assert.deepEqual(nearbyRuntimePermissions(36), { required: thirteen, optional: [] });
  });

  test('Android 17 (API 37): local network is asked for, and required only when targeting SDK 37', () => {
    const thirteen = [P.bluetoothAdvertise, P.bluetoothConnect, P.bluetoothScan, P.nearbyWifi];
    assert.deepEqual(nearbyRuntimePermissions(37), { required: thirteen, optional: [P.localNetwork] });
    assert.deepEqual(nearbyRuntimePermissions(37, 37).required, [...thirteen, P.localNetwork]);
  });

  test('every required permission must be granted', () => {
    const { required } = nearbyRuntimePermissions(37);
    const all = Object.fromEntries(required.map((p) => [p, 'granted']));
    assert.equal(nearbyPermissionsGranted(required, { ...all, [P.localNetwork]: 'denied' }), true);
    assert.equal(nearbyPermissionsGranted(required, { ...all, [P.nearbyWifi]: 'never_ask_again' }), false);
    assert.equal(nearbyPermissionsGranted(required, {}), false);
  });

  test('the manifest plugin declares them as the docs list them, never narrowing location', () => {
    const { addNearbyPermissions } = require('../plugins/withNearbyPermissions.js');
    const manifest = {
      manifest: {
        'uses-permission': [
          { $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' } },
          { $: { 'android:name': 'android.permission.ACCESS_COARSE_LOCATION' } },
        ],
      },
    };
    const out = addNearbyPermissions(addNearbyPermissions(manifest)); // twice: no duplicates
    const byName = new Map<string, Record<string, string>>(
      out.manifest['uses-permission'].map((e: { $: Record<string, string> }) => [e.$['android:name'], e.$]),
    );
    assert.equal(out.manifest['uses-permission'].length, byName.size);
    assert.deepEqual(byName.get('android.permission.ACCESS_FINE_LOCATION'), { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' });
    assert.deepEqual(byName.get('android.permission.ACCESS_COARSE_LOCATION'), { 'android:name': 'android.permission.ACCESS_COARSE_LOCATION' });
    assert.deepEqual(byName.get(P.bluetoothScan), { 'android:name': P.bluetoothScan, 'android:minSdkVersion': '31', 'android:usesPermissionFlags': 'neverForLocation' });
    assert.deepEqual(byName.get(P.bluetoothAdvertise), { 'android:name': P.bluetoothAdvertise, 'android:minSdkVersion': '31' });
    assert.deepEqual(byName.get(P.bluetoothConnect), { 'android:name': P.bluetoothConnect, 'android:minSdkVersion': '31' });
    assert.deepEqual(byName.get(P.nearbyWifi), { 'android:name': P.nearbyWifi, 'android:minSdkVersion': '33', 'android:usesPermissionFlags': 'neverForLocation' });
    assert.deepEqual(byName.get(P.localNetwork), { 'android:name': P.localNetwork, 'android:minSdkVersion': '37' });
    assert.deepEqual(byName.get('android.permission.BLUETOOTH'), { 'android:name': 'android.permission.BLUETOOTH', 'android:maxSdkVersion': '30' });
    assert.deepEqual(byName.get('android.permission.BLUETOOTH_ADMIN'), { 'android:name': 'android.permission.BLUETOOTH_ADMIN', 'android:maxSdkVersion': '30' });
    assert.ok(byName.has('android.permission.ACCESS_WIFI_STATE'));
    assert.ok(byName.has('android.permission.CHANGE_WIFI_STATE'));
  });

  test('app.config.js keeps #62’s background location and adds the camera without the microphone', () => {
    const { expo } = require('../app.config.js');
    const plugin = (name: string) => expo.plugins.find((p: unknown) => (Array.isArray(p) ? p[0] : p) === name);
    const location = plugin('expo-location');
    assert.equal(location[1].isAndroidBackgroundLocationEnabled, true);
    assert.equal(location[1].isAndroidForegroundServiceEnabled, true);
    const camera = plugin('expo-camera');
    assert.equal(camera[1].recordAudioAndroid, false);
    assert.equal(camera[1].microphonePermission, false);
    assert.ok(plugin('./plugins/withNearbyPermissions'));
  });
});

describe('Group Hike QR code drawing', () => {
  test('draws the join code as runs of dark modules, with the three finder squares', () => {
    const text = 'TAHAK-GROUP|1|gh-4fk2p9xa|K7PM3Q|tahak-k7pm3q';
    const matrix = qrMatrix(text);
    assert.ok(matrix.size >= 21 && matrix.size <= 41, `size ${matrix.size}`);
    const n = matrix.size;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      assert.equal(isDarkAt(matrix, r, c), true);
      assert.equal(isDarkAt(matrix, r + 1, c + 1), false);
      assert.equal(isDarkAt(matrix, r + 3, c + 3), true);
    }
    assert.deepEqual(qrMatrix(text), matrix);
    for (const run of matrix.runs) assert.ok(run.length > 0 && run.col + run.length <= n);
  });
});

describe('Group Hike is no longer "coming soon"', () => {
  test('the Hike tab offers Start Group Hike and Scan to join, in both languages', () => {
    const en = hikeStrings.en as Record<string, string>;
    const fil = hikeStrings.fil as Record<string, string>;
    assert.equal(en.comingSoon, undefined);
    assert.equal(fil.comingSoon, undefined);
    assert.ok(!Object.values(en).some((text) => /coming soon/i.test(text)));
    assert.equal(en.startGroupHike, 'Start Group Hike');
    assert.equal(fil.startGroupHike, 'Simulan ang Group Hike');
  });
});

test('a full Group Hike refuses the next phone while its Hike continues', async () => {
  const air = new FakeAir();
  const leader = groupPhone(air, 'leader-full', 100);
  await leader.session.lead(7, 'Leader');
  const qr = leader.session.getSnapshot().qr!;
  const members = Array.from({ length: 19 }, (_, i) => groupPhone(air, `full-${i}`, i + 200));
  for (const member of members) await member.session.join(7, 'Member', qr);
  await settle();
  assert.equal(Object.keys(leader.session.getSnapshot().group!.members).length, 20);
  const extra = groupPhone(air, 'extra', 500);
  await extra.session.join(8, 'Extra', qr);
  await settle();
  assert.equal(extra.session.getSnapshot().error, 'full');
  assert.equal(extra.session.getSnapshot().group?.endReason, 'full');
  assert.equal(extra.session.getSnapshot().hikeId, 8);
  assert.equal(Object.keys(leader.session.getSnapshot().group!.members).length, 20);
  await leader.session.end();
});
