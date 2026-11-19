// What Group Hike phones say to each other over Nearby Connections (#23), and the QR code a
// joiner scans. Pure, tested under plain Node.
//
// Every message is one small JSON object, `{ v: 1, kind, hikeId, ... }`, sent as one Nearby
// BYTES payload. Decoding is strict: anything malformed, too large, from another Hike, or from
// a newer version is dropped (null), never thrown, so one bad payload cannot break a Hike.
//
// The QR code is plain text: `TAHAK-GROUP|1|<hikeId>|<joinSecret>|<leaderEndpointName>`.
// The join secret keeps a stranger's phone that happens to be nearby from joining by accident;
// it is short so it can also be read aloud. It is not strong security.

import type { Alert, AlertPosition, AlertType, MemberPosition } from './types.ts';

export const GROUP_MESSAGE_VERSION = 1;
/** Well under Nearby's own BYTES limit (ConnectionsClient.MAX_BYTES_DATA_SIZE, 32 KB). */
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_NAME_LENGTH = 40;
export const MAX_ID_LENGTH = 64;
/** Room for a large Group Hike; more joiners are refused. */
export const MAX_MEMBERS = 20;

/** A member as the group knows them. */
export type GroupMemberInfo = { id: string; name: string };

export type GroupMessage =
  /** A joiner's first message after connecting: proves it scanned the QR code. */
  | { v: 1; kind: 'hello'; hikeId: string; secret: string; member: GroupMemberInfo }
  /** The leader's list of who is in the group (leader first), sent on every change. */
  | { v: 1; kind: 'roster'; hikeId: string; leaderId: string; members: GroupMemberInfo[] }
  | { v: 1; kind: 'position'; hikeId: string; update: MemberPosition }
  | { v: 1; kind: 'alert'; hikeId: string; alert: Alert }
  /** A member left (they ended their Hike, or the leader saw them disconnect). */
  | { v: 1; kind: 'leave'; hikeId: string; memberId: string }
  /** The leader ended the Hike: the group dissolves for everyone. */
  | { v: 1; kind: 'end'; hikeId: string }
  | { v: 1; kind: 'full'; hikeId: string };

export type GroupMessageKind = GroupMessage['kind'];

const ALERT_TYPES: readonly AlertType[] = ['deviation', 'deviation-cleared', 'flare', 'flare-stopped'];

// --- encoding ---

/** The message as text for one Nearby payload, or null if it would be too large. */
export function encodeGroupMessage(message: GroupMessage): string | null {
  const text = JSON.stringify(message);
  return utf8Length(text) <= MAX_MESSAGE_BYTES ? text : null;
}

/** UTF-8 byte length without TextEncoder (not every JS engine the app runs on has it). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

// --- decoding ---

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readPosition(value: unknown): AlertPosition | null {
  if (!isObj(value)) return null;
  const { latitude, longitude } = value;
  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) return null;
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function readMember(value: unknown): GroupMemberInfo | null {
  if (!isObj(value) || !isId(value.id) || !isName(value.name)) return null;
  return { id: value.id, name: value.name };
}

function readMemberPosition(value: unknown): MemberPosition | null {
  if (!isObj(value) || !isId(value.memberId) || !isName(value.memberName)) return null;
  const position = readPosition(value.position);
  if (!position || !isFiniteNumber(value.time)) return null;
  // `simulated` is never accepted from another phone: a real member is never labelled simulated.
  return { memberId: value.memberId, memberName: value.memberName, position, time: value.time };
}

function readAlert(value: unknown): Alert | null {
  if (!isObj(value) || !isId(value.id) || !isId(value.memberId) || !isName(value.memberName)) return null;
  if (!ALERT_TYPES.includes(value.type as AlertType)) return null;
  const position = readPosition(value.position);
  if (!position || !isFiniteNumber(value.time)) return null;
  const alert: Alert = {
    id: value.id,
    type: value.type as AlertType,
    memberId: value.memberId,
    memberName: value.memberName,
    position,
    time: value.time,
  };
  if (value.offTrailM !== undefined) {
    if (!isFiniteNumber(value.offTrailM) || value.offTrailM < 0) return null;
    alert.offTrailM = value.offTrailM;
  }
  return alert;
}

/** The message in one Nearby payload, or null if it is not a valid message this version reads. */
export function decodeGroupMessage(text: string): GroupMessage | null {
  if (typeof text !== 'string' || utf8Length(text) > MAX_MESSAGE_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.v !== GROUP_MESSAGE_VERSION || !isId(raw.hikeId)) return null;
  const hikeId = raw.hikeId;
  switch (raw.kind) {
    case 'hello': {
      const member = readMember(raw.member);
      if (!member || typeof raw.secret !== 'string' || !isJoinSecret(raw.secret)) return null;
      return { v: 1, kind: 'hello', hikeId, secret: raw.secret, member };
    }
    case 'roster': {
      if (!isId(raw.leaderId) || !Array.isArray(raw.members) || raw.members.length > MAX_MEMBERS) return null;
      const members: GroupMemberInfo[] = [];
      for (const entry of raw.members) {
        const member = readMember(entry);
        if (!member) return null;
        members.push(member);
      }
      if (!members.some((m) => m.id === raw.leaderId)) return null;
      return { v: 1, kind: 'roster', hikeId, leaderId: raw.leaderId, members };
    }
    case 'position': {
      const update = readMemberPosition(raw.update);
      return update ? { v: 1, kind: 'position', hikeId, update } : null;
    }
    case 'alert': {
      const alert = readAlert(raw.alert);
      return alert ? { v: 1, kind: 'alert', hikeId, alert } : null;
    }
    case 'leave':
      return isId(raw.memberId) ? { v: 1, kind: 'leave', hikeId, memberId: raw.memberId } : null;
    case 'full':
      return { v: 1, kind: 'full', hikeId };
    case 'end':
      return { v: 1, kind: 'end', hikeId };
    default:
      return null;
  }
}

// --- the QR code and its parts ---

const QR_PREFIX = 'TAHAK-GROUP';
/** No 0/O, 1/I/L: easy to read aloud and to tell apart on a small screen. */
const SECRET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_SECRET_LENGTH = 6;
const HIKE_ID_PATTERN = /^[A-Za-z0-9-]{4,36}$/;
const ENDPOINT_NAME_PATTERN = /^tahak-[a-z0-9]{6}$/;

export type GroupJoinCode = {
  hikeId: string;
  /** Short shared secret the joiner proves in its hello. */
  secret: string;
  /** The Nearby endpoint name the leader advertises under. Carries no personal name. */
  leaderEndpointName: string;
};

export function isJoinSecret(value: string): boolean {
  if (value.length !== JOIN_SECRET_LENGTH) return false;
  for (const ch of value) if (!SECRET_ALPHABET.includes(ch)) return false;
  return true;
}

function randomFrom(alphabet: string, length: number, random: () => number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return out;
}

/** A new join secret, e.g. "K7PM3Q". */
export function newJoinSecret(random: () => number = Math.random): string {
  return randomFrom(SECRET_ALPHABET, JOIN_SECRET_LENGTH, random);
}

/**
 * A new Nearby endpoint name, e.g. "tahak-k7pm3q". Phones advertise and connect under this,
 * not the hiker's name: a member's name is only sent once they have proved the join secret.
 */
export function newEndpointName(random: () => number = Math.random): string {
  return `tahak-${randomFrom('abcdefghijklmnopqrstuvwxyz0123456789', 6, random)}`;
}

/** A new id for a Group Hike or a member, e.g. "gh-4fk2p9xa". */
export function newGroupId(prefix: string, random: () => number = Math.random): string {
  return `${prefix}-${randomFrom('abcdefghijklmnopqrstuvwxyz0123456789', 8, random)}`;
}

/** The text the leader's QR code holds. Throws on parts that would not scan back. */
export function encodeJoinCode(code: GroupJoinCode): string {
  if (!HIKE_ID_PATTERN.test(code.hikeId)) throw new Error(`Invalid Hike id: ${code.hikeId}`);
  if (!isJoinSecret(code.secret)) throw new Error('Invalid join secret');
  if (!ENDPOINT_NAME_PATTERN.test(code.leaderEndpointName)) {
    throw new Error(`Invalid leader endpoint name: ${code.leaderEndpointName}`);
  }
  return [QR_PREFIX, GROUP_MESSAGE_VERSION, code.hikeId, code.secret, code.leaderEndpointName].join('|');
}

/**
 * The join code in a scanned QR code, or null if it is not a Tahak Group Hike code this
 * version reads (another app's QR, a newer version, a damaged scan).
 */
export function decodeJoinCode(text: string): GroupJoinCode | null {
  if (typeof text !== 'string' || text.length > 200) return null;
  const parts = text.trim().split('|');
  if (parts.length !== 5 || parts[0] !== QR_PREFIX || parts[1] !== String(GROUP_MESSAGE_VERSION)) return null;
  const [, , hikeId, secret, leaderEndpointName] = parts;
  if (!HIKE_ID_PATTERN.test(hikeId) || !isJoinSecret(secret) || !ENDPOINT_NAME_PATTERN.test(leaderEndpointName)) {
    return null;
  }
  return { hikeId, secret, leaderEndpointName };
}
