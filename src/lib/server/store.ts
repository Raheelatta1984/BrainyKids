// Server-side persistence for BrainyKids.
//
// The whole family/account document is stored as one JSON value. Two drivers are
// provided:
//   * a JSON file on disk (default, used for local development and demos)
//   * Postgres, when DATABASE_URL is set (used for hosted deployments)
//
// Writes are serialised through a promise queue so concurrent requests cannot
// interleave a read-modify-write on the same process.
//
// Storage problems are reported as a `StorageError` carrying a message that is
// safe (and useful) to show a parent, instead of an empty 500 page. The file
// driver additionally falls back to a writable temporary directory when the
// project folder is read-only — which is what happens on hosters with an
// ephemeral, read-only filesystem and no DATABASE_URL configured.

import fsSync, { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Gender, Level, Theme } from "@/lib/types";

/** A storage failure with a message that can be shown to the person using the app. */
export class StorageError extends Error {
  readonly userMessage: string;
  readonly status: number;

  constructor(userMessage: string, options: { status?: number; detail?: string; cause?: unknown } = {}) {
    super(options.detail ?? userMessage, { cause: options.cause });
    this.name = "StorageError";
    this.userMessage = userMessage;
    this.status = options.status ?? 503;
  }
}

export type ParentRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  /** Salted hash of the parent's recovery code, used by “Forgot password?”. */
  recoveryHash?: string;
  recoveryCreatedAt?: number;
  /** Set after too many wrong recovery codes; unix ms. */
  recoveryLockedUntil?: number;
  recoveryFailures?: number;
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

/**
 * A fingerprint / face unlock credential (a WebAuthn “passkey”) that belongs to
 * a parent account or to one child on one device.
 */
export type PasskeyRecord = {
  id: string;
  /** base64url credential id from the authenticator. */
  credentialId: string;
  /** base64url COSE public key. */
  publicKey: string;
  /** Signature counter, used to spot a cloned authenticator. */
  counter: number;
  /** Which account this credential signs in. */
  parentId: string | null;
  kidId: string | null;
  /** Human label: “iPhone · Safari” and so on. */
  label: string;
  transports: string[];
  /** True when the browser says the key syncs (iCloud Keychain, Google Password Manager). */
  synced: boolean;
  createdAt: number;
  lastUsedAt: number;
};

/** A single-use WebAuthn challenge, kept server-side until the ceremony finishes. */
export type ChallengeRecord = {
  id: string;
  /** base64url challenge. */
  challenge: string;
  purpose: "register" | "login";
  parentId: string | null;
  kidId: string | null;
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
  passkeys: PasskeyRecord[];
  challenges: ChallengeRecord[];
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
    passkeys: [],
    challenges: [],
    events: [],
    nextEventId: 0,
  };
}

/** Older documents were written before passkeys/challenges existed. */
export function normaliseDoc(doc: DbDoc): DbDoc {
  doc.parents ??= [];
  doc.kids ??= [];
  doc.sessions ??= [];
  doc.devices ??= [];
  doc.pairings ??= [];
  doc.passkeys ??= [];
  doc.challenges ??= [];
  doc.events ??= [];
  doc.nextEventId ??= 0;
  return doc;
}

export function sessionExpiry(from = Date.now()): number {
  return from + SESSION_DAYS * 24 * 60 * 60 * 1000;
}

/** How long a device has to answer a fingerprint / face unlock prompt. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function newId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

/** Where the data lives, described in a way that is safe to show in the UI. */
export type StorageInfo = {
  driver: "file" | "postgres";
  /** True when the data survives a restart, a redeploy or another server instance. */
  durable: boolean;
  /** Directory or database in use. Never contains credentials. */
  location: string;
  /** A plain-language note for the parent dashboard, when something is not ideal. */
  notice: string | null;
};

type Driver = {
  name: "file" | "postgres";
  /** Milliseconds an in-memory read may be reused. File storage is written by
   *  this process only, so it can cache indefinitely; Postgres may be written by
   *  another instance, so it re-reads often. */
  cacheTtl: number;
  load: () => Promise<DbDoc | null>;
  save: (doc: DbDoc) => Promise<void>;
  info: () => StorageInfo;
};

/** Permission-style filesystem failures: the folder exists but cannot be written. */
function isUnwritable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ENOTDIR";
}

/**
 * Can this folder be written to (or created)? Walks up to the closest folder
 * that exists, so a missing `.data/` directory is not mistaken for a read-only
 * host.
 */
function canWrite(target: string): boolean {
  let probe = target;
  for (;;) {
    try {
      fsSync.accessSync(probe, fsSync.constants.W_OK);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = path.dirname(probe);
      if (code === "ENOENT" && parent !== probe) {
        probe = parent;
        continue;
      }
      return false;
    }
  }
}

const READ_ONLY_NOTICE =
  "This server's project folder is read-only, so BrainyKids is keeping accounts in a temporary folder. " +
  "They can disappear when the server restarts — set DATABASE_URL for permanent storage.";

function fileDriver(): Driver {
  const configuredDir = process.env.BRAINYKIDS_DATA_DIR ?? path.join(process.cwd(), ".data");
  const fallbackDir = path.join(os.tmpdir(), "brainykids-data");
  let dir = configuredDir;
  let usingFallback = false;

  async function readFrom(target: string): Promise<DbDoc | null> {
    try {
      const raw = await fs.readFile(path.join(target, "brainykids.json"), "utf8");
      return normaliseDoc(JSON.parse(raw) as DbDoc);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeTo(target: string, doc: DbDoc): Promise<void> {
    await fs.mkdir(target, { recursive: true });
    const file = path.join(target, "brainykids.json");
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
    await fs.rename(tmp, file);
  }

  /** Move to the temporary folder, once per process, after a failed write. */
  async function fallback(doc: DbDoc, cause: unknown): Promise<void> {
    if (!usingFallback) {
      usingFallback = true;
      dir = fallbackDir;
      console.warn(
        `[brainykids] Could not write to ${configuredDir} (${(cause as NodeJS.ErrnoException)?.code ?? cause}). ` +
          `Falling back to ${fallbackDir}; set DATABASE_URL for storage that survives a restart.`,
      );
    }
    try {
      await writeTo(dir, doc);
    } catch (error) {
      throw new StorageError("BrainyKids could not save to its storage. Please try again in a moment.", {
        detail: `Could not write to ${dir}`,
        cause: error,
      });
    }
  }

  return {
    name: "file",
    cacheTtl: Number.POSITIVE_INFINITY,
    async load() {
      try {
        return await readFrom(dir);
      } catch (error) {
        if (isUnwritable(error) && !usingFallback) {
          // The project folder cannot even be read: keep going with the temp copy.
          usingFallback = true;
          dir = fallbackDir;
          console.warn(`[brainykids] Could not read ${configuredDir}; using ${fallbackDir} instead.`);
          return await readFrom(dir);
        }
        throw new StorageError("BrainyKids could not read its stored data. Please try again in a moment.", {
          detail: `Could not read ${path.join(dir, "brainykids.json")}`,
          cause: error,
        });
      }
    },
    async save(doc) {
      try {
        await writeTo(dir, doc);
      } catch (error) {
        if (isUnwritable(error)) {
          await fallback(doc, error);
          return;
        }
        throw new StorageError("BrainyKids could not save to its storage. Please try again in a moment.", {
          detail: `Could not write to ${path.join(dir, "brainykids.json")}`,
          cause: error,
        });
      }
    },
    info() {
      // Say so *before* the first failing write, so a parent dashboard can warn
      // that accounts are only being kept in a temporary folder.
      const configuredWritable = !usingFallback && canWrite(configuredDir);
      return {
        driver: "file",
        durable: configuredWritable,
        location: configuredWritable ? configuredDir : fallbackDir,
        notice: configuredWritable ? null : READ_ONLY_NOTICE,
      };
    },
  };
}

const DB_UNREACHABLE =
  "BrainyKids could not reach its database, so nothing could be saved. " +
  "Check that DATABASE_URL is correct and that the database is running, then try again.";

function postgresDriver(connectionString: string): Driver {
  type PoolLike = {
    query: (text: string, values?: unknown[]) => Promise<{ rows: { doc: DbDoc }[] }>;
  };
  let poolPromise: Promise<PoolLike> | null = null;

  /** Never log the password that may be inside the connection string. */
  function safeLocation(): string {
    try {
      const url = new URL(connectionString);
      return `${url.hostname}${url.pathname}`;
    } catch {
      return "the configured database";
    }
  }

  async function pool(): Promise<PoolLike> {
    if (!poolPromise) {
      poolPromise = (async () => {
        const mod = (await import("pg")) as unknown as {
          Pool: new (config: { connectionString: string; max: number; connectionTimeoutMillis: number }) => PoolLike;
        };
        const pgPool = new mod.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000 });
        await pgPool.query(
          `create table if not exists brainykids_state (
             id integer primary key,
             doc jsonb not null,
             updated_at timestamptz not null default now()
           )`,
        );
        return pgPool;
      })().catch((error) => {
        // Let the next request try again instead of caching a dead pool.
        poolPromise = null;
        throw new StorageError(DB_UNREACHABLE, { detail: `Database ${safeLocation()} unreachable`, cause: error });
      });
    }
    return poolPromise;
  }

  return {
    name: "postgres",
    cacheTtl: 400,
    async load() {
      try {
        const db = await pool();
        const result = await db.query("select doc from brainykids_state where id = 1");
        return result.rows[0]?.doc ? normaliseDoc(result.rows[0].doc) : null;
      } catch (error) {
        throw error instanceof StorageError ? error : new StorageError(DB_UNREACHABLE, { detail: "Could not read the database", cause: error });
      }
    },
    async save(doc) {
      try {
        const db = await pool();
        await db.query(
          `insert into brainykids_state (id, doc, updated_at) values (1, $1, now())
           on conflict (id) do update set doc = excluded.doc, updated_at = now()`,
          [JSON.stringify(doc)],
        );
      } catch (error) {
        throw error instanceof StorageError ? error : new StorageError(DB_UNREACHABLE, { detail: "Could not write the database", cause: error });
      }
    },
    info() {
      return { driver: "postgres", durable: true, location: safeLocation(), notice: null };
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

  /** Says where the data is kept, so the UI can warn when it is not permanent. */
  info(): StorageInfo {
    return this.driver.info();
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
      const fresh = normaliseDoc((await this.driver.load()) ?? emptyDoc());
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
  info: () => getStore().info(),
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
  // Unanswered fingerprint / face unlock prompts must not pile up.
  doc.challenges = doc.challenges.filter((c) => c.expiresAt > now);
}
