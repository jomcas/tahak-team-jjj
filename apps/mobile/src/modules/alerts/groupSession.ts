// This phone's Group Hike for the running Hike (#23): it starts one as the leader or joins one
// from a scanned QR code, plugs the Nearby link into the Alerts store beside the loopback, and
// dissolves it when the Hike ends. Pure (no React Native), tested under plain Node with an
// in-memory Nearby; groupHikeService.ts wires it to the native module and the Hike.
//
// One session holds at most one Group Hike, bound to one Hike (CONTEXT.md: the group exists
// only for that Hike). Each Group Hike gets a new NearbyTransport and a new member id for this
// phone, so nothing carries over to the next Hike.

import { isGroupLinked, type GroupHike } from './groupHike.ts';
import { MAX_NAME_LENGTH, newGroupId } from './groupMessage.ts';
import { NearbyTransport, type NearbyLink } from './nearbyTransport.ts';
import type { AlertTransport } from './transport.ts';
import type { AlertPosition } from './types.ts';

/**
 * Why a Group Hike could not start or go on:
 * - `unavailable`: this build or phone has no Nearby Connections.
 * - `permission`: the hiker did not allow the nearby-devices permissions.
 * - `radio`: Nearby could not advertise or discover (usually Bluetooth or Wi-Fi is off).
 * - `bad-code`: the scanned QR code is not a Tahak Group Hike.
 */
export type GroupSessionError = 'unavailable' | 'permission' | 'radio' | 'bad-code' | 'full';

export type GroupSessionView = {
  /** The Hike this Group Hike belongs to, or null with no Group Hike. */
  hikeId: number | null;
  /** The group as the Nearby link knows it, or null on a Solo Hike. */
  group: GroupHike | null;
  /** Leader: the text of the QR code joiners scan. */
  qr: string | null;
  error: GroupSessionError | null;
  /** A start, join or retry is under way. */
  busy: boolean;
};

const SOLO: GroupSessionView = { hikeId: null, group: null, qr: null, error: null, busy: false };

/** What the session needs from the app. Injected, so tests run without a phone. */
export type GroupSessionDeps = {
  /** Nearby Connections (modules/tahak-nearby), or null when this build has none. */
  link: NearbyLink | null;
  /** Asks for the nearby-devices permissions; true when Nearby may run. */
  requestPermissions: () => Promise<boolean>;
  /** The Alerts store seam: the Nearby link goes beside the loopback, then comes out again. */
  attach: (remote: AlertTransport) => void;
  detach: () => void;
  /** Forgets another member in the Alerts store, so their dot leaves the map. */
  removeMember: (memberId: string) => void;
  /** Called as each start begins (the app starts watching the running Hike then). */
  onStart?: () => void;
  random?: () => number;
  log?: (line: string) => void;
  helloTimeoutMs?: number;
};

type Start = { role: 'leader'; hikeId: number; name: string } | { role: 'member'; hikeId: number; name: string; qr: string };

/** The name others see: trimmed, one line, within the message limit. Empty if none was given. */
export function cleanMemberName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
}

/** Nearby's status code in a rejected call, e.g. 8037 from "ERR_NEARBY_8037". */
export function nearbyStatusCode(error: unknown): number | null {
  const text =
    error && typeof error === 'object'
      ? `${String((error as { code?: unknown }).code ?? '')} ${String((error as { message?: unknown }).message ?? '')}`
      : String(error);
  const match = /ERR_NEARBY_(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * A failed advertise or discover, for the hiker. Nearby's MISSING_PERMISSION_* status codes are
 * 8030 to 8049; anything else is the radios (Bluetooth or Wi-Fi off, or busy).
 */
export function startErrorOf(error: unknown): GroupSessionError {
  const code = nearbyStatusCode(error);
  return code !== null && code >= 8030 && code <= 8049 ? 'permission' : 'radio';
}

/** Send this phone's position at most this often, so the dot moves without flooding the link. */
export const POSITION_SHARE_MS = 5000;
/** ...but sooner when the hiker has moved this far. */
export const POSITION_SHARE_M = 25;

/** Whether to send a new position to the group, given the last one sent. */
export function shouldSharePosition(
  last: { position: AlertPosition; sentAt: number } | null,
  next: AlertPosition,
  now: number,
): boolean {
  if (!last) return true;
  if (now - last.sentAt >= POSITION_SHARE_MS) return true;
  return now - last.sentAt >= 1000 && roughMetres(last.position, next) >= POSITION_SHARE_M;
}

function roughMetres(a: AlertPosition, b: AlertPosition): number {
  const toRad = Math.PI / 180;
  const x = (b.longitude - a.longitude) * toRad * Math.cos(((a.latitude + b.latitude) / 2) * toRad);
  const y = (b.latitude - a.latitude) * toRad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

export type GroupSession = ReturnType<typeof createGroupSession>;

export function createGroupSession(deps: GroupSessionDeps) {
  const random = deps.random ?? Math.random;
  let view: GroupSessionView = SOLO;
  const listeners = new Set<() => void>();
  let transport: NearbyTransport | null = null;
  let stops: (() => void)[] = [];
  /** Every other member this Group Hike has shown, so ending it clears them all. */
  let seen = new Set<string>();
  let lastStart: Start | null = null;
  /** Bumps on every start and end, so a slow start that was overtaken does nothing. */
  let generation = 0;

  function set(next: Partial<GroupSessionView>) {
    view = { ...view, ...next };
    listeners.forEach((listener) => listener());
  }

  /** Unplugs the Nearby link from the Alerts store and clears the other members off the map. */
  function release() {
    stops.forEach((stop) => stop());
    stops = [];
    if (transport) deps.detach();
    transport = null;
    seen.forEach((id) => deps.removeMember(id));
    seen = new Set();
  }

  async function begin(start: Start): Promise<boolean> {
    const name = cleanMemberName(start.name);
    if (!name) return false;
    deps.onStart?.();
    if (view.hikeId !== null && view.hikeId !== start.hikeId) await end();
    if (transport) await endTransport();
    const mine = ++generation;
    lastStart = start;
    set({ hikeId: start.hikeId, group: null, qr: null, error: null, busy: true });

    if (!deps.link) {
      set({ error: 'unavailable', busy: false });
      return false;
    }
    let allowed = false;
    try {
      allowed = await deps.requestPermissions();
    } catch {
      allowed = false;
    }
    if (mine !== generation) return false;
    if (!allowed) {
      set({ error: 'permission', busy: false });
      return false;
    }

    const next = new NearbyTransport({
      link: deps.link,
      self: { id: newGroupId('m', random), name },
      random,
      ...(deps.log ? { log: deps.log } : {}),
      ...(deps.helloTimeoutMs === undefined ? {} : { helloTimeoutMs: deps.helloTimeoutMs }),
    });
    transport = next;
    stops = [
      next.onGroupChange((group) => {
        if (transport !== next) return;
        if (group.status === 'dissolved') {
          // The leader ended the Hike, or this phone lost them: back to the loopback alone,
          // and the card says why until this Hike ends.
          release();
          set({ group, qr: null, busy: false, error: group.endReason === 'full' ? 'full' : null });
          return;
        }
        set({ group });
      }),
      next.onMemberLeft((memberId) => {
        seen.delete(memberId);
        deps.removeMember(memberId);
      }),
      next.onPosition((update) => {
        seen.add(update.memberId);
      }),
      next.onReceive((alert) => {
        seen.add(alert.memberId);
      }),
    ];
    // Plugged in before Nearby starts, so nothing that arrives is missed.
    deps.attach(next);

    try {
      if (start.role === 'leader') {
        const qr = await next.lead(newGroupId('gh', random));
        if (mine !== generation) return false;
        set({ group: next.getGroup(), qr, busy: false });
      } else {
        const ok = await next.join(start.qr);
        if (mine !== generation) return false;
        if (!ok) {
          release();
          set({ group: null, error: 'bad-code', busy: false });
          return false;
        }
        set({ group: next.getGroup(), busy: false });
      }
      return true;
    } catch (error) {
      if (mine !== generation) return false;
      deps.log?.(`could not start the Group Hike: ${String(error)}`);
      release();
      set({ group: null, error: startErrorOf(error), busy: false });
      return false;
    }
  }

  async function endTransport() {
    const current = transport;
    release();
    if (current) await current.endHike();
  }

  /** Ends the Group Hike, if any (the Hike ended, or this phone left): back to Solo. */
  async function end(): Promise<void> {
    generation++;
    lastStart = null;
    const current = transport;
    release();
    view = SOLO;
    listeners.forEach((listener) => listener());
    if (current) await current.endHike();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => view,

    /** Starts a Group Hike for this Hike with this phone as the leader. Resolves true once advertising. */
    lead(hikeId: number, name: string) {
      return begin({ role: 'leader', hikeId, name });
    },

    /** Joins the Group Hike in a scanned QR code for this Hike. Resolves true once looking for the leader. */
    join(hikeId: number, name: string, qr: string) {
      return begin({ role: 'member', hikeId, name, qr });
    },

    /** Tries the last start again (after the hiker turned on Bluetooth, say). */
    retry(): Promise<boolean> {
      return lastStart ? begin(lastStart) : Promise.resolve(false);
    },

    end,

    /** The running Hike changed: a Group Hike that belongs to another (or no) Hike dissolves. */
    hikeChanged(hikeId: number | null): Promise<void> {
      if (view.hikeId === null || view.hikeId === hikeId) return Promise.resolve();
      return end();
    },

    /** True while positions and Alerts flow to other phones. */
    isLinked: () => view.group !== null && isGroupLinked(view.group),
  };
}
