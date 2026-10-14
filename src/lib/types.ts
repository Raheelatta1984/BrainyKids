// Shared types used by both the server (API routes) and the browser components.

export type Gender = "boy" | "girl" | "prefer-not-to-say";
export type Theme = "space" | "jungle" | "robots" | "dinos";
export type Level = 1 | 2 | 3;

export const LEVELS: Level[] = [1, 2, 3];

/** Languages a family can pick as their master language (app text, questions and voice). */
export type LocaleCode = "en" | "es" | "fr" | "ar" | "ur" | "hi" | "zh";

export type DateFormat = "auto" | "dmy" | "mdy" | "ymd";
export type TimeFormat = "auto" | "12" | "24";

/**
 * The family's master settings. Everything the app shows a date, a time, a
 * language or a spoken voice follows these values, including the behavioural
 * log, so every log line is written in the family's own date/time/language.
 */
export type FamilySettings = {
  /** IANA time zone, for example “Australia/Sydney”. Empty means “the device's zone”. */
  timeZone: string;
  /** Master language: app text, quiz questions/tasks and the spoken voice. */
  locale: LocaleCode;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  /** Read chat messages and quiz feedback aloud on the kid device. */
  kidVoiceOver: boolean;
  /** Read chat messages aloud on the parent's device. */
  parentVoiceOver: boolean;
  /** Kids can send a message by speaking instead of typing. */
  kidDictation: boolean;
};

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

/** One chat message between a parent and one child. */
export type ChatMessage = {
  id: string;
  kidId: string;
  from: "parent" | "kid";
  text: string;
  at: number;
  /** True when the receiving side has seen it. */
  seen: boolean;
  /** A dictated “voice note” (spoken by the sender, shown and read out as text). */
  kind: "text" | "voice";
};

/** One line of the behavioural log: layman wording plus the technical detail. */
export type BehaviourEntry = {
  id: number;
  code: string;
  area: BehaviourArea;
  severity: BehaviourSeverity;
  at: number;
  /** Plain-language line anybody can understand. */
  layman: string;
  /** Technical line for a developer: what happened, where, with what values. */
  technical: string;
  /** A short, plain-language suggestion of what to do about it. */
  fix: string;
  source: "server" | "client";
  role: "parent" | "kid" | "guest" | "server";
  parentId?: string | null;
  kidId?: string | null;
  kidName?: string | null;
  deviceId?: string | null;
  /** Extra machine-readable context (never contains secrets). */
  context: Record<string, unknown>;
  /** Date/time/language settings in force when the entry was written. */
  settings: {
    timeZone: string;
    locale: LocaleCode;
    dateFormat: DateFormat;
    timeFormat: TimeFormat;
  };
  client?: {
    userAgent?: string;
    platform?: string;
    url?: string;
    protocol?: string;
    online?: boolean;
    timeZone?: string;
    language?: string;
    cookies?: boolean;
  };
};

export type BehaviourArea =
  | "session"
  | "storage"
  | "pairing"
  | "chat"
  | "voice"
  | "quiz"
  | "settings"
  | "server"
  | "device";

export type BehaviourSeverity = "info" | "warning" | "critical";

/** A group of log lines sharing one behaviour code: what a review looks at first. */
export type BehaviourGroup = {
  code: string;
  area: BehaviourArea;
  severity: BehaviourSeverity;
  count: number;
  firstAt: number;
  lastAt: number;
  layman: string;
  technical: string;
  fix: string;
  affectedKids: string[];
};

export type BehaviourSummary = {
  total: number;
  critical: number;
  warning: number;
  info: number;
  groups: BehaviourGroup[];
  generatedAt: number;
};

export type DeviceView = {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  online: boolean;
  /** True when the device is held in a signed cookie backup because storage lost it. */
  restored?: boolean;
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
  /** Most recent chat messages between this child and their parent (oldest first). */
  chat: ChatMessage[];
  /** Unread chat messages for whoever asked: the parent sees the child's, the child the parent's. */
  chatUnread: number;
};

/** A fingerprint / face unlock credential (WebAuthn passkey) set up in the family. */
export type PasskeyView = {
  id: string;
  /** Device description, for example “iPhone · Safari”. */
  label: string;
  /** A parent's own credential, or one that signs a child in on their device. */
  kind: "parent" | "kid";
  kidId?: string;
  kidName?: string;
  /** The authenticator stores the key in the cloud (iCloud Keychain, Google Password Manager). */
  synced: boolean;
  createdAt: number;
  lastUsedAt: number;
};

/** Where the server keeps its data, so the UI can warn when it is temporary. */
export type StorageState = {
  driver: "file" | "postgres";
  durable: boolean;
  location: string;
  notice: string | null;
  /** Environment variable name used when connected to Postgres (e.g. DATABASE_URL, POSTGRES_URL, NEON_DATABASE_URL). */
  envVar?: string | null;
  /** True when running on an ephemeral/serverless filesystem (e.g. Vercel without Postgres attached). */
  ephemeralHost?: boolean;
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
  | "chat.message"
  | "pairing.started"
  | "pairing.approved"
  | "behaviour.logged";

/** Everything a signed-in browser needs, in one round trip. */
export type Snapshot =
  | { role: "guest"; hasAccounts: boolean; storage?: StorageState; unlinked?: boolean }
  | {
      role: "parent";
      parent: ParentAccount;
      kids: KidView[];
      pairings: PairingView[];
      passkeys: PasskeyView[];
      settings: FamilySettings;
      storage?: StorageState;
    }
  | {
      role: "kid";
      kid: KidView;
      parent: { name: string; email: string };
      settings: FamilySettings;
      storage?: StorageState;
    };

export const ONLINE_WINDOW_MS = 75_000;

export function isOnline(lastSeenAt: number | null | undefined, now = Date.now()): boolean {
  return typeof lastSeenAt === "number" && now - lastSeenAt < ONLINE_WINDOW_MS;
}
