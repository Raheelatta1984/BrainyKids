/**
 * Behavioural log review report.
 *
 * Reads the log lines the app wrote while it was running and builds
 * `logs/behaviour-log.md` — the file that is kept in the repository and read
 * every time the app is reviewed.
 *
 *     npm run behaviour:report
 *     npm run behaviour:report -- path/to/export.jsonl
 *
 * Where lines come from:
 *   * `.data/behaviour.jsonl` (+ `.1`, `.2` rotations) — what the server wrote,
 *   * `logs/inbox/*.jsonl` / `*.json` — exports downloaded from
 *     Parent dashboard → Behaviour log → Download (JSON lines),
 *   * `logs/seed/*.json` — the written-up review items (reported symptoms),
 *   * any path given on the command line.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBehaviourReport } from "../src/lib/behaviour-report";
import { summariseBehaviour } from "../src/lib/behaviour";
import { formatStamp, resolveSettings } from "../src/lib/settings";
import type { BehaviourEntry, FamilySettings, StorageState } from "../src/lib/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_MARKDOWN = path.join(ROOT, "logs", "behaviour-log.md");
const OUT_SUMMARY = path.join(ROOT, "logs", "behaviour-summary.json");

type RawRow = Record<string, unknown>;

function coerceEntry(raw: RawRow): BehaviourEntry | null {
  const code = typeof raw.code === "string" ? raw.code : null;
  if (!code) return null;
  const at =
    typeof raw.atMs === "number"
      ? raw.atMs
      : typeof raw.at === "number"
        ? raw.at
        : typeof raw.at === "string"
          ? Date.parse(raw.at)
          : NaN;
  if (!Number.isFinite(at)) return null;
  const settings = (raw.settings ?? {}) as Partial<FamilySettings>;
  return {
    id: typeof raw.id === "number" ? raw.id : 0,
    code,
    area: (typeof raw.area === "string" ? raw.area : "server") as BehaviourEntry["area"],
    severity: (raw.severity === "critical" || raw.severity === "warning" ? raw.severity : "info") as BehaviourEntry["severity"],
    at,
    layman: typeof raw.layman === "string" ? raw.layman : code,
    technical: typeof raw.technical === "string" ? raw.technical : code,
    fix: typeof raw.fix === "string" ? raw.fix : "Review the code that writes this line.",
    source: raw.source === "client" ? "client" : "server",
    role: (typeof raw.role === "string" ? raw.role : "server") as BehaviourEntry["role"],
    parentId: typeof raw.parentId === "string" ? raw.parentId : null,
    kidId: typeof raw.kidId === "string" ? raw.kidId : null,
    kidName: typeof raw.kid === "string" ? raw.kid : typeof raw.kidName === "string" ? raw.kidName : null,
    deviceId: typeof raw.deviceId === "string" ? raw.deviceId : null,
    context: (raw.context ?? {}) as Record<string, unknown>,
    settings: {
      timeZone: settings.timeZone ?? "",
      locale: settings.locale ?? "en",
      dateFormat: settings.dateFormat ?? "auto",
      timeFormat: settings.timeFormat ?? "auto",
    },
    client: raw.client as BehaviourEntry["client"],
  };
}

async function readJsonl(file: string): Promise<BehaviourEntry[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: BehaviourEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = coerceEntry(JSON.parse(trimmed) as RawRow);
      if (entry) out.push(entry);
    } catch {
      /* skip a half-written line */
    }
  }
  return out;
}

async function readJsonFile(file: string): Promise<BehaviourEntry[]> {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    const rows = Array.isArray(raw)
      ? raw
      : typeof raw === "object" && raw !== null && Array.isArray((raw as { entries?: unknown }).entries)
        ? ((raw as { entries: unknown[] }).entries as unknown[])
        : [];
    return rows.map((row) => coerceEntry(row as RawRow)).filter((entry): entry is BehaviourEntry => entry !== null);
  } catch {
    return [];
  }
}

async function filesIn(dir: string, extensions: string[]): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    return names.filter((name) => extensions.some((ext) => name.endsWith(ext))).map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function dedupe(entries: BehaviourEntry[]): BehaviourEntry[] {
  const seen = new Set<string>();
  const out: BehaviourEntry[] = [];
  for (const entry of entries.sort((a, b) => a.at - b.at)) {
    const key = `${entry.at}|${entry.code}|${entry.layman}|${entry.technical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function familySettingsFrom(entries: BehaviourEntry[]): FamilySettings {
  const withZone = entries.filter((entry) => entry.settings?.timeZone).at(-1);
  const withLocale = entries.filter((entry) => entry.settings?.locale).at(-1);
  return resolveSettings({
    timeZone: withZone?.settings.timeZone,
    locale: withLocale?.settings.locale,
    dateFormat: withZone?.settings.dateFormat,
    timeFormat: withZone?.settings.timeFormat,
  });
}

function storageFrom(entries: BehaviourEntry[]): StorageState | null {
  const storageEntry = [...entries]
    .reverse()
    .find((entry) => entry.code.startsWith("storage.") || entry.code === "kid.session.lost");
  if (!storageEntry) return null;
  const driver = storageEntry.context?.storage === "postgres" ? "postgres" : "file";
  return {
    driver,
    durable: storageEntry.context?.durable === true,
    location: typeof storageEntry.context?.location === "string" ? (storageEntry.context.location as string) : "not recorded",
    notice: null,
  };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const sources: string[] = [];
  const entries: BehaviourEntry[] = [];

  const dataDir = process.env.BRAINYKIDS_DATA_DIR ?? path.join(ROOT, ".data");
  for (const file of [path.join(dataDir, "behaviour.jsonl"), `${path.join(dataDir, "behaviour.jsonl")}.1`, `${path.join(dataDir, "behaviour.jsonl")}.2`]) {
    const rows = await readJsonl(file);
    if (rows.length > 0) sources.push(path.relative(ROOT, file));
    entries.push(...rows);
  }

  const inboxDir = path.join(ROOT, "logs", "inbox");
  for (const file of await filesIn(inboxDir, [".jsonl"])) {
    const rows = await readJsonl(file);
    if (rows.length > 0) sources.push(path.relative(ROOT, file));
    entries.push(...rows);
  }
  for (const file of await filesIn(inboxDir, [".json"])) {
    const rows = await readJsonFile(file);
    if (rows.length > 0) sources.push(path.relative(ROOT, file));
    entries.push(...rows);
  }

  const seedDir = path.join(ROOT, "logs", "seed");
  for (const file of await filesIn(seedDir, [".json", ".jsonl"])) {
    const rows = file.endsWith(".jsonl") ? await readJsonl(file) : await readJsonFile(file);
    if (rows.length > 0) sources.push(path.relative(ROOT, file));
    entries.push(...rows);
  }

  for (const arg of args) {
    const file = path.resolve(process.cwd(), arg);
    const rows = file.endsWith(".jsonl") ? await readJsonl(file) : await readJsonFile(file);
    if (rows.length > 0) sources.push(path.relative(ROOT, file));
    entries.push(...rows);
  }

  const merged = dedupe(entries);
  const settings = familySettingsFrom(merged);
  const storage = storageFrom(merged);
  const report = buildBehaviourReport(merged, {
    settings,
    storage,
    sources,
    limitNote: `${merged.length} line(s)`,
  });
  const summary = summariseBehaviour(merged);

  await fs.mkdir(path.dirname(OUT_MARKDOWN), { recursive: true });
  await fs.writeFile(OUT_MARKDOWN, report, "utf8");
  await fs.writeFile(
    OUT_SUMMARY,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), sources, settings, summary }, null, 2)}\n`,
    "utf8",
  );

  console.log(`Read ${merged.length} behavioural log line(s) from ${sources.length} source(s).`);
  console.log(`  🚨 fix me: ${summary.critical}   ⚠️ needs a look: ${summary.warning}   ℹ️ info: ${summary.info}`);
  for (const group of summary.groups.slice(0, 8)) {
    console.log(`  ${group.severity === "critical" ? "🚨" : group.severity === "warning" ? "⚠️" : "ℹ️"} ${group.count}× ${group.code} — ${group.layman}`);
  }
  console.log(`Report written: ${path.relative(ROOT, OUT_MARKDOWN)} (generated ${formatStamp(Date.now(), settings)})`);
  console.log(`Summary written: ${path.relative(ROOT, OUT_SUMMARY)}`);
}

void main().catch((error: unknown) => {
  console.error("Could not build the behavioural report:", error);
  process.exitCode = 1;
});
