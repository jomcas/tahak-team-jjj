// The Group Hike as this phone knows it (#23): who leads, who is in it, and when it ends.
// Pure, tested under plain Node.
//
// CONTEXT.md: a Group Hike links several hikers' devices for one Hike only. So the group has
// no life outside its Hike: ending the Hike dissolves it, and a dissolved group is never
// reused (the next Hike starts a new one, with a new id and secret).
//
// Shape: a star around the leader. The leader advertises and accepts joiners; each joiner
// connects only to the leader, which relays positions and Alerts between members.

import { MAX_MEMBERS, type GroupMemberInfo } from './groupMessage.ts';

export type GroupRole = 'leader' | 'member';

/**
 * - `none`: Solo Hike, or no Hike.
 * - `leading`: this phone started the Group Hike and shows its QR code.
 * - `joining`: this phone scanned a QR code and is looking for the leader.
 * - `joined`: the leader accepted this phone.
 * - `dissolved`: the group ended. See `endReason`.
 */
export type GroupStatus = 'none' | 'leading' | 'joining' | 'joined' | 'dissolved';

/** Why a group dissolved. */
export type GroupEndReason = 'hike-ended' | 'left' | 'leader-ended' | 'leader-lost';

export type GroupHike = {
  status: GroupStatus;
  role: GroupRole | null;
  hikeId: string | null;
  self: GroupMemberInfo;
  leaderId: string | null;
  /** Everyone in the group, this phone included, by member id. */
  members: Readonly<Record<string, GroupMemberInfo>>;
  endReason: GroupEndReason | null;
};

export function soloHike(self: GroupMemberInfo): GroupHike {
  return { status: 'none', role: null, hikeId: null, self, leaderId: null, members: {}, endReason: null };
}

/** This phone starts a Group Hike as its leader. */
export function startLeading(self: GroupMemberInfo, hikeId: string): GroupHike {
  return {
    status: 'leading',
    role: 'leader',
    hikeId,
    self,
    leaderId: self.id,
    members: { [self.id]: self },
    endReason: null,
  };
}

/** This phone scanned a leader's QR code and is joining. */
export function startJoining(self: GroupMemberInfo, hikeId: string): GroupHike {
  return { status: 'joining', role: 'member', hikeId, self, leaderId: null, members: {}, endReason: null };
}

const isActive = (group: GroupHike) => group.status === 'leading' || group.status === 'joining' || group.status === 'joined';

/** Leader: may this member join? Not when full, not a duplicate of this phone. */
export function canAdmit(group: GroupHike, member: GroupMemberInfo): boolean {
  if (group.role !== 'leader' || group.status !== 'leading') return false;
  if (member.id === group.self.id) return false;
  if (group.members[member.id]) return true; // a reconnect of someone already in
  return Object.keys(group.members).length < MAX_MEMBERS;
}

/** Leader: a joiner proved the secret. */
export function admitMember(group: GroupHike, member: GroupMemberInfo): GroupHike {
  if (!canAdmit(group, member)) return group;
  return { ...group, members: { ...group.members, [member.id]: member } };
}

/** Member: the leader's roster arrived. The first one means this phone has joined. */
export function applyRoster(group: GroupHike, leaderId: string, members: readonly GroupMemberInfo[]): GroupHike {
  if (group.role !== 'member' || (group.status !== 'joining' && group.status !== 'joined')) return group;
  const next: Record<string, GroupMemberInfo> = {};
  for (const member of members) next[member.id] = member;
  // This phone is always in its own group, as itself.
  next[group.self.id] = group.self;
  return { ...group, status: 'joined', leaderId, members: next };
}

/** A member left, or the leader lost them. This phone and the leader are never removed this way. */
export function removeGroupMember(group: GroupHike, memberId: string): GroupHike {
  if (!isActive(group) || memberId === group.self.id || memberId === group.leaderId) return group;
  if (!group.members[memberId]) return group;
  const members = { ...group.members };
  delete members[memberId];
  return { ...group, members };
}

/** The group ends for this phone: no members, nothing more to send. */
export function dissolve(group: GroupHike, reason: GroupEndReason): GroupHike {
  if (!isActive(group)) return group;
  return { ...group, status: 'dissolved', leaderId: null, members: {}, endReason: reason };
}

/** True while positions and Alerts should flow. */
export function isGroupLinked(group: GroupHike): boolean {
  return group.status === 'leading' || group.status === 'joined';
}

export type GroupMemberRow = GroupMemberInfo & { isLeader: boolean; isSelf: boolean };

/** The members for display: the leader first, then this phone, then the rest by name. */
export function memberList(group: GroupHike): GroupMemberRow[] {
  return Object.values(group.members)
    .map((m) => ({ ...m, isLeader: m.id === group.leaderId, isSelf: m.id === group.self.id }))
    .sort((a, b) => {
      if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
}

/** Everyone in the group, as the leader's roster message carries them: the leader first. */
export function rosterOf(group: GroupHike): GroupMemberInfo[] {
  return memberList(group).map(({ id, name }) => ({ id, name }));
}
