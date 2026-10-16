// Server-side persistence for BrainyKids.
//
// The whole family/account document is stored as one JSON value. Two drivers are
// provided:
//   * a JSON file on disk (default, used for local development and demos)
//   * Postgres / Neon, when a database URL is set (used for Vercel and other
//     hosted deployments)
//
// Writes are serialised through a promise queue per process, and through a
// `SELECT ... FOR UPDATE` row lock in Postgres so concurrent serverless
// instances cannot overwrite each other.
//
// Storage problems are reported as a `StorageError` carrying a message that is
// safe (and useful) to show a parent, instead of an empty 500 page. The file
// driver additionally falls back to a writable temporary directory when the
// project folder is read-only — which is what happens on hosters with an
// ephemeral, read-only filesystem and no Postgres database configured.

import fsSync, { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BehaviourEntry, CurriculumCountry, EducationStage, FamilySettings, Gender, Level, RewardLedgerEntry, StorageState, Theme } from "@/lib/types";
import type { Question } from "@/lib/quiz-data";

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
  kind: "answer" | "screen-time" | "cheer" | "device" | "level" | "reward";
  text: string;
  correct?: boolean;
};

/** One stored wallet transaction (shared shape with the UI's RewardLedgerEntry). */
export type RewardLedgerRecord = RewardLedgerEntry & { parentId: string };

export type KidRecord = {
  id: string;
  parentId: string;
  name: string;
  username: string;
  pinHash: string;
  age: number;
  gender: Gender;
  /** Optional per-child learning profile; null inherits the family master setting. */
  curriculumCountry?: CurriculumCountry | null;
  educationStage?: EducationStage | null;
  theme: Theme;
  /** Where the child is now. Any level may be opened; nothing is ever locked. */
  level: Level;
  /** Highest level reached by finishing one: the “Best level” record, not a gate. */
  unlockedLevel: Level;
  /**
   * The question ids already answered in each level, keyed by level number.
   * This controls level progress and can be cleared for a fresh level run.
   */
  usedByLevel: Record<string, string[]>;
  /** Every question ever shown to this child, across all levels and restarts. */
  askedQuestionIds: string[];
  /** Monotonic question number; never reset when a level is restarted. */
  nextQuestionSequence: number;
  /** An unanswered question already shown in each level, so resume never repeats it. */
  activeQuestionsByLevel: Record<string, Question>;
  points: number;
  attempted: number;
  correct: number;
  requestedMinutes: number;
  approvedMinutes: number;
  /** Wallet in cents (or whole Robux): earned, not yet realised. Reset only on parent approval. */
  walletBalanceMinor?: number;
  requestedRewardMinor?: number;
  lifetimeEarnedMinor?: number;
  totalRealisedMinor?: number;
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

/** Pseudonymous per-client signup counters; raw network addresses are never stored. */
export type SignupRateLimitRecord = {
  key: string;
  attempts: number[];
  signups: number[];
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

/** One chat message between a parent and one child. */
export type ChatRecord = {
  id: string;
  parentId: string;
  kidId: string;
  from: "parent" | "kid";
  text: string;
  kind: "text" | "voice";
  at: number;
  /** Seen by the receiving side. */
  seen: boolean;
};

/** One line of the behavioural log (see src/lib/behaviour.ts for the wording). */
export type BehaviourRecord = BehaviourEntry;

export type DbDoc = {
  version: 1;
  parents: ParentRecord[];
  kids: KidRecord[];
  sessions: SessionRecord[];
  /** Signup-attempt and account-creation windows keyed by a server-side HMAC of the client IP. */
  signupRateLimits: SignupRateLimitRecord[];
  devices: DeviceRecord[];
  pairings: PairingRecord[];
  passkeys: PasskeyRecord[];
  challenges: ChallengeRecord[];
  events: EventRecord[];
  nextEventId: number;
  /** Parent ↔ child chat threads (newest last). */
  chats: ChatRecord[];
  /** Every reward transaction for every child: earned, requested, approved, declined (newest last). */
  rewards: RewardLedgerRecord[];
  /** Master settings per parent account (time zone, date/time format, language, voice). */
  settings: Record<string, FamilySettings>;
  /** The behavioural log: everything the app noticed about itself, newest last. */
  behaviour: BehaviourRecord[];
  nextBehaviourId: number;
  /**
   * Children a parent has deleted. Kept so a device that still holds its own
   * signed cookie cannot bring the profile back to life when the server is on
   * temporary storage (the same reason a signed-out device stays signed out).
   */
  deletedKids: { id: string; at: number }[];
};

export const MAX_EVENTS = 500;
/** How many behavioural log lines are kept in storage (older ones stay in the exported file). */
export const MAX_BEHAVIOUR = 1_500;
/** How many chat messages are kept per family. */
export const MAX_CHAT = 400;
const SESSION_DAYS = 30;

export function emptyDoc(): DbDoc {
  return {
    version: 1,
    parents: [],
    kids: [],
    sessions: [],
    signupRateLimits: [],
    devices: [],
    pairings: [],
    passkeys: [],
    challenges: [],
    events: [],
    nextEventId: 0,
    chats: [],
    rewards: [],
    settings: {},
    behaviour: [],
    nextBehaviourId: 0,
    deletedKids: [],
  };
}

/** Older documents were written before passkeys/challenges/chat/settings/behaviour existed. */
export function normaliseDoc(doc: DbDoc): DbDoc {
  doc.parents ??= [];
  doc.kids ??= [];
  doc.sessions ??= [];
  doc.signupRateLimits ??= [];
  doc.devices ??= [];
  doc.pairings ??= [];
  doc.passkeys ??= [];
  doc.challenges ??= [];
  doc.events ??= [];
  doc.nextEventId ??= 0;
  doc.chats ??= [];
  doc.rewards ??= [];
  for (const kid of doc.kids) {
    kid.usedByLevel ??= {};
    kid.activeQuestionsByLevel ??= {};
    const answeredHistory = Object.values(kid.usedByLevel).flatMap((ids) => Array.isArray(ids) ? ids : []);
    const activeHistory = Object.values(kid.activeQuestionsByLevel).map((question) => question?.id).filter((id): id is string => Boolean(id));
    kid.askedQuestionIds = [...new Set([...(kid.askedQuestionIds ?? []), ...answeredHistory, ...activeHistory])];
    const highestFreshSequence = kid.askedQuestionIds.reduce((highest, id) => {
      const match = /^fresh-([0-9a-z]+)$/i.exec(id);
      return match ? Math.max(highest, Number.parseInt(match[1], 36)) : highest;
    }, 0);
    kid.nextQuestionSequence = Math.max(kid.nextQuestionSequence ?? kid.askedQuestionIds.length, highestFreshSequence);
    kid.curriculumCountry ??= null;
    kid.educationStage ??= null;
    kid.walletBalanceMinor ??= 0;
    kid.requestedRewardMinor ??= 0;
    kid.lifetimeEarnedMinor ??= 0;
    kid.totalRealisedMinor ??= 0;
  }
  doc.settings ??= {};
  doc.behaviour ??= [];
  doc.nextBehaviourId ??= doc.behaviour.reduce((max, entry) => Math.max(max, entry.id ?? 0), 0);
  doc.deletedKids ??= [];
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
// Database URL discovery & Neon / Vercel Postgres normalisation
// ---------------------------------------------------------------------------

/**
 * Environment variables commonly created when attaching Neon, Vercel Postgres,
 * or Supabase in the Vercel dashboard.
 */
const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "NEON_DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "NEON_POSTGRES_URL",
] as const;

export type ResolvedDatabaseEnv = {
  envVar: string;
  rawUrl: string;
};

/**
 * Finds a configured Postgres / Neon connection string from the environment.
 * Also supports custom prefixes chosen when linking a Neon store in Vercel
 * (for example `STORAGE_DATABASE_URL` or `BRAINYKIDS_POSTGRES_URL`).
 */
export function resolveDatabaseEnv(): ResolvedDatabaseEnv | null {
  for (const key of DATABASE_ENV_KEYS) {
    const val = process.env[key]?.trim();
    if (val) return { envVar: key, rawUrl: val };
  }

  for (const [key, val] of Object.entries(process.env)) {
    const trimmed = val?.trim();
    if (!trimmed) continue;
    if (
      (key.endsWith("_DATABASE_URL") || key.endsWith("_POSTGRES_URL") || key.endsWith("_POSTGRES_PRISMA_URL")) &&
      /^(postgres(ql)?|psql\s)/i.test(trimmed.replace(/^['"]|['"]$/g, ""))
    ) {
      return { envVar: key, rawUrl: trimmed };
    }
  }

  const host = process.env.PGHOST?.trim();
  const user = process.env.PGUSER?.trim();
  const password = process.env.PGPASSWORD?.trim();
  if (host && user && password) {
    const port = process.env.PGPORT?.trim() || "5432";
    const db = process.env.PGDATABASE?.trim() || "neondb";
    return {
      envVar: "PGHOST",
      rawUrl: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}?sslmode=require`,
    };
  }

  return null;
}

export type NormalisedDatabaseConfig = {
  connectionString: string;
  enableChannelBinding: boolean;
  safeLocation: string;
  valid: boolean;
};

/**
 * Cleans up connection strings copied from Neon, Vercel or Supabase:
 *  - strips a leading `psql ` command or `DATABASE_URL=` prefix if pasted accidentally
 *  - removes wrapping single or double quotes
 *  - enables SCRAM channel binding when `channel_binding=require` is present (Neon default)
 *  - sets `uselibpqcompat=true` with `sslmode=require` so `pg` connects cleanly to
 *    cloud Postgres poolers without Node SSL warnings or certificate chain rejections
 */
export function normaliseDatabaseConfig(rawInput: string): NormalisedDatabaseConfig {
  let cleaned = rawInput.trim();

  // Strip accidental `KEY=value` prefix if someone pasted the whole .env line into Vercel.
  cleaned = cleaned.replace(/^[A-Z0-9_]+=\s*/i, "");

  // Strip a leading `psql` command if someone copied the `psql 'postgresql://...'` snippet from Neon.
  if (/^psql\s+/i.test(cleaned)) {
    cleaned = cleaned.replace(/^psql\s+(?:-[a-zA-Z]\s+)*\s*/i, "").trim();
  }

  // Strip matching outer quotes.
  if ((cleaned.startsWith("'") && cleaned.endsWith("'")) || (cleaned.startsWith('"') && cleaned.endsWith('"'))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return {
        connectionString: cleaned,
        enableChannelBinding: false,
        safeLocation: "the configured database",
        valid: false,
      };
    }

    const channelBinding = parsed.searchParams.get("channel_binding")?.toLowerCase();
    const enableChannelBinding = channelBinding === "require" || channelBinding === "prefer";

    const host = parsed.hostname.toLowerCase();
    const isCloudHost =
      host.endsWith(".neon.tech") ||
      host.endsWith(".vercel-storage.com") ||
      host.endsWith(".supabase.co") ||
      host.endsWith(".supabase.com") ||
      host.endsWith(".railway.app") ||
      host.endsWith(".render.com") ||
      host.endsWith(".aivencloud.com");

    const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase();
    if (!sslmode && isCloudHost) {
      parsed.searchParams.set("sslmode", "require");
      parsed.searchParams.set("uselibpqcompat", "true");
    } else if (
      (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-ca") &&
      !parsed.searchParams.has("uselibpqcompat")
    ) {
      parsed.searchParams.set("uselibpqcompat", "true");
    }

    return {
      connectionString: parsed.toString(),
      enableChannelBinding,
      safeLocation: `${parsed.hostname}${parsed.pathname}`,
      valid: true,
    };
  } catch {
    return {
      connectionString: cleaned,
      enableChannelBinding: false,
      safeLocation: "the configured database",
      valid: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

/** Where the data lives, described in a way that is safe to show in the UI. */
export type StorageInfo = StorageState;

type Driver = {
  name: "file" | "postgres";
  /** Milliseconds an in-memory read may be reused. File storage is written by
   *  this process only, so it can cache indefinitely; Postgres may be written by
   *  another instance, so it re-reads often. */
  cacheTtl: number;
  load: () => Promise<DbDoc | null>;
  save: (doc: DbDoc) => Promise<void>;
  /** Optional atomic read-modify-write transaction (used by Postgres). */
  transact?: <T>(fn: (doc: DbDoc) => T | Promise<T>) => Promise<{ doc: DbDoc; result: T }>;
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
  "They can disappear when the server restarts — attach a Neon or Vercel Postgres database (DATABASE_URL) for permanent storage.";

function fileDriver(): Driver {
  const explicitDir = process.env.BRAINYKIDS_DATA_DIR?.trim();
  const isServerlessHost =
    !explicitDir && Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  const configuredDir = explicitDir || path.join(process.cwd(), ".data");
  const fallbackDir = path.join(os.tmpdir(), "brainykids-data");
  // Start in the temporary folder when the configured folder cannot be written
  // (a read-only mount, a container without the directory). Deciding once, here,
  // means reads and writes always use the same file.
  const usingFallbackDir = isServerlessHost || !canWrite(configuredDir);
  let dir = usingFallbackDir ? fallbackDir : configuredDir;
  let usingFallback = usingFallbackDir;
  if (usingFallbackDir && !isServerlessHost) {
    console.warn(
      `[brainykids] ${configuredDir} is not writable; keeping data in ${fallbackDir}. ` +
        "Set DATABASE_URL (or BRAINYKIDS_DATA_DIR) for storage that survives a restart.",
    );
  }

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
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
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
    cacheTtl: usingFallback ? 1_000 : Number.POSITIVE_INFINITY,
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
      // Check the folder before touching it: some hosts (a read-only mount, a
      // container without the directory) answer a write with a call that never
      // returns instead of an error. Checking first keeps the request fast.
      if (!usingFallback && !canWrite(dir)) {
        await fallback(doc, { code: "EACCES" } as NodeJS.ErrnoException);
        return;
      }
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
        envVar: null,
        ephemeralHost: !configuredWritable,
      };
    },
  };
}

const DB_UNREACHABLE =
  "BrainyKids could not reach its database, so nothing could be saved. " +
  "Check that DATABASE_URL is correct and that the database is running, then try again.";

function describeDatabaseError(error: unknown, envVar: string, location: string): string {
  const pgCode = (error as { code?: string } | undefined)?.code;
  if (pgCode === "28P01" || pgCode === "28000") {
    return (
      `BrainyKids could not sign in to the database at ${location} (${envVar}: password or username rejected). ` +
      "Copy a fresh connection string from Neon / Vercel Storage and redeploy."
    );
  }
  if (pgCode === "3D000") {
    return (
      `The database named in ${envVar} (${location}) does not exist yet. ` +
      "Check the database name at the end of your Neon / Postgres connection string."
    );
  }
  return DB_UNREACHABLE;
}

function isTransientDbError(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "57P01" ||
    code === "57P03" ||
    code === "08006" ||
    code === "08001" ||
    code === "08003"
  ) {
    return true;
  }
  return /Connection terminated|timeout expired|Compute time quota|waking up/i.test(msg);
}

function postgresDriver(rawConnectionString: string, envVar = "DATABASE_URL"): Driver {
  type ClientLike = {
    query: (text: string, values?: unknown[]) => Promise<{ rows: { doc: DbDoc }[] }>;
    release: (destroy?: boolean) => void;
  };
  type PoolLike = {
    query: (text: string, values?: unknown[]) => Promise<{ rows: { doc: DbDoc }[] }>;
    connect: () => Promise<ClientLike>;
  };

  const config = normaliseDatabaseConfig(rawConnectionString);
  let poolPromise: Promise<PoolLike> | null = null;

  async function pool(): Promise<PoolLike> {
    if (!config.valid) {
      throw new StorageError(
        `The ${envVar} environment variable is not a valid Postgres connection string (it should start with postgresql://).`,
        { detail: `Invalid ${envVar}` },
      );
    }
    if (!poolPromise) {
      poolPromise = (async () => {
        const mod = (await import("pg")) as unknown as {
          Pool?: new (opts: Record<string, unknown>) => PoolLike;
          default?: { Pool: new (opts: Record<string, unknown>) => PoolLike };
        };
        const PoolCtor = mod.Pool ?? mod.default?.Pool;
        if (!PoolCtor) throw new Error("pg.Pool unavailable");

        const pgPool = new PoolCtor({
          connectionString: config.connectionString,
          enableChannelBinding: config.enableChannelBinding,
          // Keep pool small per serverless instance and allow 15s for Neon scale-to-zero wake-up.
          max: 3,
          idleTimeoutMillis: 10_000,
          connectionTimeoutMillis: 15_000,
        });

        try {
          await pgPool.query(
            `create table if not exists brainykids_state (
               id integer primary key,
               doc jsonb not null,
               updated_at timestamptz not null default now()
             )`,
          );
        } catch (err) {
          const code = (err as { code?: string } | undefined)?.code;
          // Ignore concurrent `CREATE TABLE IF NOT EXISTS` race across cold lambdas.
          if (code !== "23505" && code !== "42P07") throw err;
        }
        return pgPool;
      })().catch((error) => {
        // Let the next request try again instead of caching a dead pool.
        poolPromise = null;
        if (error instanceof StorageError) throw error;
        throw new StorageError(describeDatabaseError(error, envVar, config.safeLocation), {
          detail: `Database ${config.safeLocation} unreachable`,
          cause: error,
        });
      });
    }
    return poolPromise;
  }

  async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (firstError) {
      if (firstError instanceof StorageError && !isTransientDbError(firstError.cause)) {
        throw firstError;
      }
      if (!isTransientDbError(firstError) && !(firstError instanceof StorageError)) {
        throw firstError;
      }
      // Reset the pool and wait briefly in case Neon compute just woke from suspend.
      poolPromise = null;
      await new Promise((resolve) => setTimeout(resolve, 600));
      return await operation();
    }
  }

  return {
    name: "postgres",
    cacheTtl: 400,
    async load() {
      try {
        return await withRetry(async () => {
          const db = await pool();
          const result = await db.query("select doc from brainykids_state where id = 1");
          return result.rows[0]?.doc ? normaliseDoc(result.rows[0].doc) : null;
        });
      } catch (error) {
        throw error instanceof StorageError
          ? error
          : new StorageError(describeDatabaseError(error, envVar, config.safeLocation), {
              detail: "Could not read the database",
              cause: error,
            });
      }
    },
    async save(doc) {
      try {
        await withRetry(async () => {
          const db = await pool();
          await db.query(
            `insert into brainykids_state (id, doc, updated_at) values (1, $1::jsonb, now())
             on conflict (id) do update set doc = excluded.doc, updated_at = now()`,
            [JSON.stringify(doc)],
          );
        });
      } catch (error) {
        throw error instanceof StorageError
          ? error
          : new StorageError(describeDatabaseError(error, envVar, config.safeLocation), {
              detail: "Could not write the database",
              cause: error,
            });
      }
    },
    async transact<T>(fn: (doc: DbDoc) => T | Promise<T>): Promise<{ doc: DbDoc; result: T }> {
      try {
        return await withRetry(async () => {
          const db = await pool();
          const client = await db.connect();
          let broken = false;
          try {
            await client.query("begin");
            await client.query(
              `insert into brainykids_state (id, doc, updated_at) values (1, $1::jsonb, now())
               on conflict (id) do nothing`,
              [JSON.stringify(emptyDoc())],
            );
            const locked = await client.query("select doc from brainykids_state where id = 1 for update");
            const current = normaliseDoc(locked.rows[0]?.doc ?? emptyDoc());
            const result = await fn(current);
            await client.query("update brainykids_state set doc = $1::jsonb, updated_at = now() where id = 1", [
              JSON.stringify(current),
            ]);
            await client.query("commit");
            return { doc: current, result };
          } catch (txError) {
            broken = isTransientDbError(txError);
            try {
              await client.query("rollback");
            } catch {
              broken = true;
            }
            throw txError;
          } finally {
            client.release(broken);
          }
        });
      } catch (error) {
        throw error instanceof StorageError
          ? error
          : new StorageError(describeDatabaseError(error, envVar, config.safeLocation), {
              detail: "Could not update the database",
              cause: error,
            });
      }
    },
    info() {
      return {
        driver: "postgres",
        durable: true,
        location: config.safeLocation,
        notice: null,
        envVar,
        ephemeralHost: false,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type StoreGlobal = { __brainyKidsStore?: Store; __brainyKidsStoreKey?: string };

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

  /** Read, change and persist the document. Serialised per process and locked in Postgres. */
  async mutate<T>(fn: (doc: DbDoc) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.driver.transact) {
        const { doc, result } = await this.driver.transact(fn);
        this.cache = doc;
        this.cacheAt = Date.now();
        return result;
      }
      // File driver: start from a fresh copy on disk, apply changes, and save.
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
  const resolved = resolveDatabaseEnv();
  const key = resolved ? `pg:${resolved.envVar}:${resolved.rawUrl}` : `file:${process.env.BRAINYKIDS_DATA_DIR ?? ""}`;
  if (!g.__brainyKidsStore || g.__brainyKidsStoreKey !== key) {
    g.__brainyKidsStore = new Store(
      resolved ? postgresDriver(resolved.rawUrl, resolved.envVar) : fileDriver(),
    );
    g.__brainyKidsStoreKey = key;
  }
  return g.__brainyKidsStore;
}

export const store = {
  read: () => getStore().read(),
  mutate: <T>(fn: (doc: DbDoc) => T | Promise<T>) => getStore().mutate(fn),
  driverName: () => getStore().driverName,
  info: () => getStore().info(),
};

/**
 * Actively checks whether the current storage backend can read and write.
 * Used by GET /api/storage so a parent on Vercel can click "Check database connection"
 * right after attaching Neon.
 */
export async function checkStorageHealth(): Promise<{
  ok: boolean;
  storage: StorageInfo;
  message: string;
  checkedAt: number;
}> {
  const current = getStore();
  const info = current.info();
  try {
    await current.read();
    if (info.driver === "postgres") {
      return {
        ok: true,
        storage: info,
        message: `Connected to Postgres (${info.location} via ${info.envVar ?? "DATABASE_URL"}). Accounts and progress are saved permanently.`,
        checkedAt: Date.now(),
      };
    }
    if (info.durable) {
      return {
        ok: true,
        storage: info,
        message: `Saving to local folder (${info.location}).`,
        checkedAt: Date.now(),
      };
    }
    return {
      ok: true,
      storage: info,
      message:
        "No Postgres database environment variable (DATABASE_URL, POSTGRES_URL, or NEON_DATABASE_URL) was found in this deployment yet. " +
        "After connecting Neon in Vercel Storage or adding DATABASE_URL in Vercel Settings, trigger a Redeploy so Vercel applies the variable.",
      checkedAt: Date.now(),
    };
  } catch (cause) {
    const message =
      cause instanceof StorageError
        ? cause.userMessage
        : "BrainyKids could not reach its storage. Check your database settings and try again.";
    return {
      ok: false,
      storage: { ...info, durable: false, notice: message },
      message,
      checkedAt: Date.now(),
    };
  }
}

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

/**
 * Adds a behavioural log line and returns it with its sequence number.
 * The oldest lines are dropped once the log is full (the exported file keeps them).
 */
export function appendBehaviour(doc: DbDoc, entry: BehaviourEntry): BehaviourEntry {
  const record: BehaviourEntry = { ...entry, id: (doc.nextBehaviourId ?? 0) + 1 };
  doc.nextBehaviourId = record.id;
  doc.behaviour.push(record);
  if (doc.behaviour.length > MAX_BEHAVIOUR) doc.behaviour.splice(0, doc.behaviour.length - MAX_BEHAVIOUR);
  return record;
}

/** How many deleted children are remembered (the list only ever grows slowly). */
export const MAX_TOMBSTONES = 200;

/** Remembers that a parent deleted a child, so a stale device cookie cannot undo it. */
export function tombstoneKid(doc: DbDoc, kidId: string, now = Date.now()) {
  doc.deletedKids = (doc.deletedKids ?? []).filter((row) => row.id !== kidId);
  doc.deletedKids.push({ id: kidId, at: now });
  if (doc.deletedKids.length > MAX_TOMBSTONES) doc.deletedKids.splice(0, doc.deletedKids.length - MAX_TOMBSTONES);
}

/** True when a parent deleted this child (used before restoring a device link). */
export function isKidDeleted(doc: DbDoc, kidId: string): boolean {
  return (doc.deletedKids ?? []).some((row) => row.id === kidId);
}

/** How many reward transactions are kept across all families in this store. */
export const MAX_REWARDS = 2_000;

/** Adds one wallet transaction, keeping the newest MAX_REWARDS entries. */
export function appendReward(doc: DbDoc, entry: RewardLedgerRecord): RewardLedgerRecord {
  doc.rewards = doc.rewards ?? [];
  doc.rewards.push(entry);
  if (doc.rewards.length > MAX_REWARDS) doc.rewards.splice(0, doc.rewards.length - MAX_REWARDS);
  return entry;
}

/** Adds a chat message, keeping the newest MAX_CHAT messages across the family. */
export function appendChat(doc: DbDoc, message: ChatRecord): ChatRecord {
  doc.chats.push(message);
  if (doc.chats.length > MAX_CHAT) doc.chats.splice(0, doc.chats.length - MAX_CHAT);
  return message;
}

/** The master settings for a family, with anything missing filled in by the caller. */
export function settingsFor(doc: DbDoc, parentId: string | null | undefined): Partial<FamilySettings> & { locale?: FamilySettings["locale"] } {
  if (!parentId) return {};
  return doc.settings?.[parentId] ?? {};
}

/**
 * The folder the behavioural log file is written to. Mirrors the file driver's
 * choice (configured folder, or a temporary folder when the project folder
 * cannot be written, e.g. on Vercel without a database).
 */
export function writableDataDir(): string {
  const explicit = process.env.BRAINYKIDS_DATA_DIR?.trim();
  const fallback = path.join(os.tmpdir(), "brainykids-data");
  if (explicit) return canWrite(explicit) ? explicit : fallback;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY) return fallback;
  const configured = path.join(process.cwd(), ".data");
  return canWrite(configured) ? configured : fallback;
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
