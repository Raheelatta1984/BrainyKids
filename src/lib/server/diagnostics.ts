// Server-side behavioural logging.
//
// Every interesting thing the app notices about itself is written here:
//   * into the stored document, so the parent dashboard can show it live, and
//   * into `.data/behaviour.jsonl` (one JSON object per line), so a copy can be
//     kept in the repository and reviewed after each release.
//
// Writing a log line must never break a request: every failure in this module is
// swallowed (after a console warning) and the caller carries on.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildBehaviourEntry,
  isBehaviourCode,
  type BehaviourInput,
} from "@/lib/behaviour";
import { DEFAULT_SETTINGS, resolveSettings } from "@/lib/settings";
import type { BehaviourEntry, FamilySettings } from "@/lib/types";
import { appendBehaviour, pushEvent, settingsFor, store, writableDataDir, type DbDoc, type StorageInfo } from "./store";

const LOG_FILE = "behaviour.jsonl";
const LOG_MAX_BYTES = 4 * 1024 * 1024;
const ARCHIVES_KEPT = 2;

/** Repeated identical events (a flaky connection, say) are collapsed to one line per window. */
const THROTTLE_MS = 30_000;
const recent = new Map<string, number>();

function throttled(code: string, key: string, windowMs = THROTTLE_MS): boolean {
  const id = `${code}:${key}`;
  const now = Date.now();
  const last = recent.get(id);
  if (last && now - last < windowMs) return true;
  recent.set(id, now);
  if (recent.size > 500) {
    for (const [id, at] of recent) if (now - at > 10 * 60_000) recent.delete(id);
  }
  return false;
}

export type LogOptions = {
  /** Who reported it. Defaults to the server. */
  source?: "server" | "client";
  role?: BehaviourEntry["role"];
  settings?: Partial<FamilySettings> | null;
  /** Skip the throttle check (used for one-off, high-value lines). */
  force?: boolean;
  /** Extra facts to widen the throttle key. */
  throttleKey?: string;
};

export function behaviourEntryFor(
  doc: DbDoc,
  input: BehaviourInput,
  options: LogOptions = {},
): BehaviourEntry {
  const settings = resolveSettings(options.settings ?? settingsFor(doc, input.parentId ?? undefined));
  return buildBehaviourEntry(input, {
    settings: {
      timeZone: settings.timeZone,
      locale: settings.locale,
      dateFormat: settings.dateFormat,
      timeFormat: settings.timeFormat,
    },
    source: options.source ?? "server",
    role: options.role,
  });
}

/** Adds a line to the stored log (inside a caller's `store.mutate`). */
export function recordBehaviour(doc: DbDoc, input: BehaviourInput, options: LogOptions = {}): BehaviourEntry | null {
  if (!isBehaviourCode(input.code)) return null;
  if (options.source !== "client" && !options.force && throttled(input.code, options.throttleKey ?? "server")) return null;
  const entry = appendBehaviour(doc, behaviourEntryFor(doc, input, options));
  announce(doc, entry);
  return entry;
}

/**
 * Tells a signed-in parent that something worth knowing was logged, so the
 * dashboard can show it while it happens instead of on the next review.
 */
function announce(doc: DbDoc, entry: BehaviourEntry): void {
  if (entry.severity === "info") return;
  if (!entry.parentId || entry.parentId === "unclaimed") return;
  const events = doc.events ?? [];
  const last = events[events.length - 1];
  if (last && last.type === "behaviour.logged" && last.payload?.code === entry.code && entry.at - last.ts < 60_000) return;
  pushEvent(doc, {
    type: "behaviour.logged",
    parentId: entry.parentId,
    kidId: entry.kidId ?? null,
    payload: {
      code: entry.code,
      severity: entry.severity,
      layman: entry.layman,
      technical: entry.technical,
    },
  });
}

/**
 * Notes, once per server process, whether storage can actually keep data.
 *
 * Temporary storage (a serverless /tmp folder, a read-only mount) is the single
 * biggest cause of the reported “it keeps signing out” and “my child's
 * information disappeared” problems, so it is written to the log as soon as any
 * request notices it — and again, as good news, if permanent storage appears.
 */
let storageWasTemporary: boolean | null = null;

export function noteStorageState(info: StorageInfo): void {
  if (storageWasTemporary === null) {
    storageWasTemporary = info.durable;
    if (!info.durable) {
      void logBehaviour(
        {
          code: "storage.temporary_folder",
          role: "server",
          vars: {
            location: info.location,
            reason: "the folder this server can write to is temporary",
            driver: info.driver,
            durable: info.durable,
            envVar: info.envVar ?? "-",
            ephemeralHost: info.ephemeralHost,
          },
          context: {
            driver: info.driver,
            location: info.location,
            envVar: info.envVar ?? null,
            notice: info.notice ? info.notice.slice(0, 160) : null,
          },
        },
        { throttleKey: info.driver },
      ).catch(() => undefined);
    }
    return;
  }
  if (storageWasTemporary === false && info.durable) {
    storageWasTemporary = true;
    void logBehaviour(
      {
        code: "storage.recovered",
        role: "server",
        vars: { driver: info.driver, durable: info.durable, location: info.location },
        context: { driver: info.driver, location: info.location },
      },
      { force: true },
    ).catch(() => undefined);
  }
}

/**
 * Logs a line on its own: reads/writes the stored document and appends the JSON
 * line file. Safe to await from any route; it never throws.
 */
export async function logBehaviour(input: BehaviourInput, options: LogOptions = {}): Promise<BehaviourEntry | null> {
  if (!isBehaviourCode(input.code)) return null;
  if (!options.force && throttled(input.code, options.throttleKey ?? input.kidId ?? input.deviceId ?? "global")) return null;

  let entry: BehaviourEntry | null = null;
  try {
    entry = await store.mutate((doc) => {
      const written = appendBehaviour(doc, behaviourEntryFor(doc, input, options));
      return written;
    });
  } catch (error) {
    // Storage is down: still keep the file copy, and never throw.
    console.warn("[brainykids] behavioural log could not be saved to storage:", error);
    entry = behaviourEntryFor({ settings: {}, behaviour: [], nextBehaviourId: 0 } as unknown as DbDoc, input, options);
  }

  if (entry) await appendBehaviourFile(entry).catch(() => undefined);
  return entry;
}

/** Logs many lines in a single storage write (used by the client reporter). */
export async function logBehaviourBatch(
  inputs: BehaviourInput[],
  options: LogOptions = {},
): Promise<number> {
  const accepted = inputs.filter((input) => isBehaviourCode(input.code));
  if (accepted.length === 0) return 0;
  let written: BehaviourEntry[] = [];
  try {
    written = await store.mutate((doc) => {
      const entries: BehaviourEntry[] = [];
      for (const input of accepted) entries.push(appendBehaviour(doc, behaviourEntryFor(doc, input, options)));
      return entries;
    });
  } catch (error) {
    console.warn("[brainykids] behavioural batch could not be saved to storage:", error);
    written = accepted.map((input) =>
      behaviourEntryFor({ settings: {}, behaviour: [], nextBehaviourId: 0 } as unknown as DbDoc, input, options),
    );
  }
  for (const entry of written) await appendBehaviourFile(entry).catch(() => undefined);
  return written.length;
}

// ---------------------------------------------------------------------------
// The file copy that can be committed to the repository
// ---------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
let warned = false;

function logFilePath(): string {
  return path.join(writableDataDir(), LOG_FILE);
}

/** Seconds-resolution ISO stamp, so lines can be read without the app. */
function isoStamp(at: number): string {
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function behaviourJsonLine(entry: BehaviourEntry): string {
  const row = {
    id: entry.id,
    at: isoStamp(entry.at),
    atMs: entry.at,
    severity: entry.severity,
    area: entry.area,
    code: entry.code,
    source: entry.source,
    role: entry.role,
    kid: entry.kidName ?? undefined,
    kidId: entry.kidId ?? undefined,
    deviceId: entry.deviceId ?? undefined,
    parentId: entry.parentId ?? undefined,
    layman: entry.layman,
    technical: entry.technical,
    fix: entry.fix,
    context: entry.context,
    settings: entry.settings,
    client: entry.client,
  };
  return `${JSON.stringify(row)}\n`;
}

/** Appends one line to `.data/behaviour.jsonl`, rotating the file when it gets large. */
export async function appendBehaviourFile(entry: BehaviourEntry): Promise<void> {
  const file = logFilePath();
  queue = queue.then(async () => {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const info = await fs.stat(file).catch(() => null);
      if (info && info.size > LOG_MAX_BYTES) {
        for (let index = ARCHIVES_KEPT; index >= 1; index -= 1) {
          const from = index === 1 ? file : `${file}.${index - 1}`;
          const to = `${file}.${index}`;
          await fs.rename(from, to).catch(() => undefined);
        }
      }
      await fs.appendFile(file, behaviourJsonLine(entry), "utf8");
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn(
          `[brainykids] could not write ${file} (${(error as NodeJS.ErrnoException)?.code ?? error}). ` +
            "Behavioural log lines are still kept in storage and shown in the dashboard.",
        );
      }
    }
  });
  return queue.then(() => undefined);
}

export { DEFAULT_SETTINGS };

/** Reads the stored log, newest last, optionally limited. */
export function behaviourFrom(doc: DbDoc, options: { parentId?: string | null; limit?: number; since?: number } = {}): BehaviourEntry[] {
  const list = doc.behaviour ?? [];
  const filtered = list.filter((entry) => {
    if (options.parentId && entry.parentId !== options.parentId) return false;
    if (options.since && entry.at < options.since) return false;
    return true;
  });
  const limit = options.limit ?? 300;
  return filtered.slice(-limit);
}
