import type { FeatureModule } from '../types';

// Group Hike Alerts (issue #24). No tab: the Hike screen shows what it supplies (ADR 0001).
//
// An Alert (CONTEXT.md) is a message pushed to the other members of a Group Hike, such as a
// Deviation or a Flare: { id, type: 'deviation' | 'deviation-cleared' | 'flare' |
// 'flare-stopped', memberId, memberName, position, time }. Alerts travel through an
// AlertTransport (transport.ts: send / onReceive, plus positions): an in-memory
// LoopbackTransport for the simulated member, and during a Group Hike (#23) Google Nearby
// Connections beside it (attachGroupTransport in alertsStore.ts). Nothing else changes.
//
// The Group Hike (#23): the leader starts one with the Hike and shows a QR code
// (GroupHikeCard); a joiner scans it (JoinScanner) and connects over Nearby
// (modules/tahak-nearby, nearbyTransport.ts), offline. groupSession.ts holds this phone's
// group for the running Hike; ending the Hike dissolves it and clears the other members.
//
// Until then, a clearly labelled simulated member ("Ana (simulated)") walks the active Trail
// on #7's walk player, with its own #8 Deviation detector, and sends real Alerts through the
// other end of the loopback: off the Trail (a Deviation), back, then the Flare, then stop.
// This phone shows a banner with "Show on map", a "Group Alerts" notification (mirrored to
// the watch) with a vibration, and the member's dot: olive with initials, red with an icon
// only during a Deviation or a Flare (ADR 0004). This phone's own Deviation, Flare and
// position go out to the Group Hike's other phones.
//
// Public interface:
//
//   sendAlert(type, position, { offTrailM?, time? })     this phone's own Alert
//   useMembers(), useAlerts()                            what this phone has received
//   setTransport(transport)                              the transport seam
//   groupSession.lead(hikeId, name) / .join(hikeId, name, qr) / .end(), useGroupSession()
//   GroupHikeCard, JoinScanner, useGroupPositionSharing(position), useMemberName()
//   addSimulatedMember({ trail, trailId, speed, startFraction }), removeSimulatedMember(),
//   triggerSimulatedIncident(), useSimulatedMember()
//   memberStatus(member), memberDot(status), initials(name)
//   GroupAlertBanners, SimulatedMemberControls, useGroupAlertNotifications(), useSelfAlerts()

export { sendAlert, setTransport, useAlerts, useMembers, SELF_ID } from './alertsStore';
export { GroupAlertBanners } from './GroupAlertBanner';
export { GroupHikeCard } from './GroupHikeCard';
export {
  groupHikeAvailable,
  groupSession,
  requestNearbyPermissions,
  useGroupPositionSharing,
  useGroupSession,
  useMemberName,
} from './groupHikeService';
export { cleanMemberName } from './groupSession';
export { JoinScanner } from './JoinScanner';
export { initials, memberDot, memberStatus, type Member, type MemberDot, type MemberStatus } from './memberState';
export { SimulatedMemberControls } from './SimulatedMemberControls';
export {
  addSimulatedMember,
  removeSimulatedMember,
  SIMULATED_MEMBER,
  triggerSimulatedIncident,
  useSimulatedMember,
} from './simulatedMember';
export { LoopbackTransport, createLoopbackPair, type AlertTransport } from './transport';
export type { Alert, AlertPosition, AlertType, MemberPosition } from './types';
export { memberLabel, useGroupAlertNotifications, useSelfAlerts } from './useGroupAlerts';

export default {
  id: 'alerts',
  hikeModes: ['group'],
  offlineNeeds: [],
} satisfies FeatureModule;
