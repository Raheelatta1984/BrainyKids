// Server-side persistence for BrainyKids.
//
// The whole family/account document is stored as one JSON value. Two drivers are
// provided:
//   * a JSON file on disk (default, used for local development and demos)
//   * Postgres, when DATABASE_URL is set (used for hosted deployments)
//
// Writes are serialised through a promise queue so concurrent requests cannot
// interleave a read-modify-write on the same process.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Gender, Level, Theme } from "@/lib/types";

export type ParentRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: number;
};

export type ActivityRecord = {
  id: string;
  at: number;
  kind: "answer" | "screen-time" | "cheer" | "device" | "level";
  text: string;
  correct?: boolean;
};

export type KidRecord = {
  id: string;
  parentId: string;
  name: string;
  username: string;
  pinHash: string;
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
  activity: ActivityRecord[];
};

export type SessionRecord = {
  tokenHash: string;
  parentId: string;
  createdAt: number;
  expiresAt: number;
};

export type DeviceRecord = {
  id: string;
  parentId: string;
  kidId: string;
  tokenHash: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
};

export type PairingRecord = {
  id: string;
  /** Short code a parent types or scans. */
  code: string;
  /** Only the device that started the pairing knows this secret. */
  secretHash: string;
  status: "pending" | "approved" | "expired";
  parentId: string | null;
  kidId: string | null;
  deviceId: string | null;
  /** One-time token the kid device collects to become a signed-in device. */
  handoffToken: string | null;
  /** Label describing the kid device, captured when the pairing started. */
  deviceLabel: string;
  createdAt: number;
  expiresAt: number;
};

export type EventRecord = {
  id: number;
  type: string;
  parentId: string;
  kidId: string | null;
  payload: Record<string, unknown>;
  ts: number;
};

export type DbDoc = {
  version: 1;
  parents: ParentRecord[];
  kids: KidRecord[];
  sessions: SessionRecord[];
  devices: DeviceRecord[];
  pairings: PairingRecord[];
  events: EventRecord[];
  nextEventId: number;
};

export const MAX_EVENTS = 500;
const SESSION_DAYS = 30;

export function emptyDoc(): DbDoc {
  return {
    version: 1,
    parents: [],
    kids: [],
    sessions: [],
    devices: [],
    pairings: [],
    events: [],
    nextEventId: 0,
  };
}

export function sessionExpiry(from = Date.now()): number {
  return from + SESSION_DAYS * 24 * 60 * 60 * 1000;
}

export function newId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

type Driver = {
  name: string;
  /** Milliseconds an in-memory read may be reused. File storage is written by
   *  this process only, so it can cache indefinitely; Postgres may be written by
   *  another instance, so it re-reads often. */
  cacheTtl: number;
  load: () => Promise<DbDoc | null>;
  save: (doc: DbDoc) => Promise<void>;
};

function fileDriver(): Driver {
  const dir = process.env.BRAINYKIDS_DATA_DIR ?? path.join(process.cwd(), ".data");
  const file = path.join(dir, "brainykids.json");
  return {
    name: "file",
    cacheTtl: Number.POSITIVE_INFINITY,
    async load() {
      try {
        const raw = await fs.readFile(file, "utf8");
        return JSON.parse(raw) as DbDoc;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(doc) {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
      await fs.rename(tmp, file);
    },
  };
}

function postgresDriver(connectionString: string): Driver {
  type PoolLike = {
    query: (text: string, values?: unknown[]) => Promise<{ rows: { doc: DbDoc }[] }>;
  };
  let poolPromise: Promise<PoolLike> | null = null;

  async function pool(): Promise<PoolLike> {
    if (!poolPromise) {
      poolPromise = (async () => {
        const mod = (await import("pg")) as unknown as {
          Pool: new (config: { connectionString: string; max: number }) => PoolLike;
        };
        const pgPool = new mod.Pool({ connectionString, max: 5 });
        await pgPool.query(
          `create table if not exists brainykids_state (
             id integer primary key,
             doc jsonb not null,
             updated_at timestamptz not null default now()
           )`,
        );
        return pgPool;
      })();
    }
    return poolPromise;
  }

  return {
    name: "postgres",
    cacheTtl: 400,
    async load() {
      const db = await pool();
      const result = await db.query("select doc from brainykids_state where id = 1");
      return result.rows[0]?.doc ?? null;
    },
    async save(doc) {
      const db = await pool();
      await db.query(
        `insert into brainykids_state (id, doc, updated_at) values (1, $1, now())
         on conflict (id) do update set doc = excluded.doc, updated_at = now()`,
        [JSON.stringify(doc)],
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type StoreGlobal = { __brainyKidsStore?: Store };

class Store {
  private cache: DbDoc | null = null;
  private cacheAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private driver: Driver) {}

  get driverName() {
    return this.driver.name;
  }

  /** Read the document. Safe to call on every request. */
  async read(): Promise<DbDoc> {
    const now = Date.now();
    if (this.cache && now - this.cacheAt < this.driver.cacheTtl) return this.cache;
    const loaded = await this.driver.load();
    this.cache = loaded ?? emptyDoc();
    this.cacheAt = now;
    return this.cache;
  }

  /** Read, change and persist the document. Serialised per process. */
  async mutate<T>(fn: (doc: DbDoc) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      // Mutations always start from a fresh copy so parallel writers (other
      // server instances) cannot be silently overwritten by a stale cache.
      const fresh = (await this.driver.load()) ?? emptyDoc();
      const result = await fn(fresh);
      await this.driver.save(fresh);
      this.cache = fresh;
      this.cacheAt = Date.now();
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export function getStore(): Store {
  const g = globalThis as unknown as StoreGlobal;
  if (!g.__brainyKidsStore) {
    const url = process.env.DATABASE_URL;
    g.__brainyKidsStore = new Store(url ? postgresDriver(url) : fileDriver());
  }
  return g.__brainyKidsStore;
}

export const store = {
  read: () => getStore().read(),
  mutate: <T>(fn: (doc: DbDoc) => T | Promise<T>) => getStore().mutate(fn),
  driverName: () => getStore().driverName,
};

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

export function pushEvent(
  doc: DbDoc,
  event: { type: string; parentId: string; kidId?: string | null; payload?: Record<string, unknown> },
): EventRecord {
  const record: EventRecord = {
    id: doc.nextEventId + 1,
    type: event.type,
    parentId: event.parentId,
    kidId: event.kidId ?? null,
    payload: event.payload ?? {},
    ts: Date.now(),
  };
  doc.nextEventId = record.id;
  doc.events.push(record);
  if (doc.events.length > MAX_EVENTS) doc.events.splice(0, doc.events.length - MAX_EVENTS);
  return record;
}

export type EventPage = {
  events: EventRecord[];
  /** Cursor that was too old to replay: the client should refetch its snapshot. */
  reset: boolean;
  latestId: number;
};

/** Events that are not yet tied to an account (a device showing a pairing code). */
export const UNCLAIMED = "unclaimed";

export function eventsSince(
  doc: DbDoc,
  cursor: number,
  scope: { parentId: string; kidId?: string; includeUnclaimed?: boolean },
): EventPage {
  const latestId = doc.nextEventId;
  const oldest = doc.events[0]?.id ?? latestId + 1;
  const reset = cursor > 0 && cursor < oldest - 1;
  const events = doc.events.filter((e) => {
    if (e.id <= cursor) return false;
    if (scope.kidId !== undefined && e.kidId !== scope.kidId) return false;
    if (e.parentId === scope.parentId) return true;
    return Boolean(scope.includeUnclaimed && e.parentId === UNCLAIMED);
  });
  return { events, reset, latestId };
}

export function trimSessions(doc: DbDoc, now = Date.now()) {
  doc.sessions = doc.sessions.filter((s) => s.expiresAt > now);
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  doc.pairings = doc.pairings.filter((p) => p.expiresAt > cutoff);
}
