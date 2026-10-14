// Shared types used by both the server (API routes) and the browser components.

export type Gender = "boy" | "girl" | "prefer-not-to-say";
export type Theme = "space" | "jungle" | "robots" | "dinos";
export type Level = 1 | 2 | 3;

export const LEVELS: Level[] = [1, 2, 3];

export type ParentAccount = {
  id: string;
  name: string;
  email: string;
  createdAt: number;
};

export type ActivityEntry = {
  id: string;
  at: number;
  kind: "answer" | "screen-time" | "cheer" | "device" | "level";
  text: string;
  correct?: boolean;
};

export type DeviceView = {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  online: boolean;
};

export type KidView = {
  id: string;
  parentId: string;
  name: string;
  username: string;
  age: number;
  gender: Gender;
  theme: Theme;
  level: Level;
  unlockedLevel: Level;
  usedByLevel: Record<string, string[]>;
  points: number;
  attempted: number;
  correct: number;
  requestedMinutes: number;
  approvedMinutes: number;
  createdAt: number;
  lastSeenAt: number | null;
  online: boolean;
  activity: ActivityEntry[];
  devices: DeviceView[];
};

export type PairingStatus = "pending" | "approved" | "expired";

export type PairingView = {
  code: string;
  status: PairingStatus;
  createdAt: number;
  expiresAt: number;
  kidId?: string;
  kidName?: string;
};

export type LiveEvent = {
  id: number;
  type: LiveEventType;
  ts: number;
  kidId?: string;
  payload: Record<string, unknown>;
};

export type LiveEventType =
  | "kid.created"
  | "kid.updated"
  | "kid.deleted"
  | "device.linked"
  | "device.unlinked"
  | "device.online"
  | "answer.recorded"
  | "level.unlocked"
  | "screen_time.requested"
  | "screen_time.approved"
  | "screen_time.declined"
  | "screen_time.granted"
  | "cheer.sent"
  | "pairing.started"
  | "pairing.approved";

/** Everything a signed-in browser needs, in one round trip. */
export type Snapshot =
  | { role: "guest"; hasAccounts: boolean }
  | {
      role: "parent";
      parent: ParentAccount;
      kids: KidView[];
      pairings: PairingView[];
    }
  | {
      role: "kid";
      kid: KidView;
      parent: { name: string; email: string };
    };

export const ONLINE_WINDOW_MS = 75_000;

export function isOnline(lastSeenAt: number | null | undefined, now = Date.now()): boolean {
  return typeof lastSeenAt === "number" && now - lastSeenAt < ONLINE_WINDOW_MS;
}
