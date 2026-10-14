// Turns behavioural log entries into the Markdown report that is saved in the
// repository (`logs/behaviour-log.md`) and offered as a download in the app.
//
// The report is written for two readers at once:
//   * a parent reads the plain-language line and the “what to do” note,
//   * a developer (or an AI reviewer) reads the technical line, the counts and
//     the environment block, and then fixes the causes in the code.

import { formatDayHeading, formatStamp, resolveSettings } from "./settings";
import { describeBehaviour, BEHAVIOUR, summariseBehaviour, SEVERITY_EMOJI, SEVERITY_LABEL, AREA_LABEL } from "./behaviour";
import type { BehaviourEntry, BehaviourSummary, FamilySettings, StorageState } from "./types";

export type ReportOptions = {
  settings?: Partial<FamilySettings> | null;
  storage?: StorageState | null;
  generatedAt?: number;
  /** Where the entries came from, for example “.data/behaviour.jsonl”. */
  sources?: string[];
  /** How many entries the report covers. */
  limitNote?: string;
};

export function buildBehaviourReport(entries: BehaviourEntry[], options: ReportOptions = {}): string {
  const settings = resolveSettings(options.settings);
  const now = options.generatedAt ?? Date.now();
  // Re-render each line with the wording the code uses today, so a fixed
  // template reads the same in this report as in the app. The exact text the
  // running server wrote is kept untouched in the JSON lines the report is
  // built from (`logs/inbox/*.jsonl`).
  const sorted = [...entries].sort((a, b) => a.at - b.at).map(presentEntry);
  const summary = summariseBehaviour(sorted);
  const lines: string[] = [];

  lines.push("# BrainyKids behavioural log");
  lines.push("");
  lines.push(
    "Every line below was written by the running app: what happened in the child's session, in the link " +
      "code, in the saved data, in chat and in the voice features. Each line says the same thing twice — once " +
      "in plain words and once in technical words — so a parent and a developer can both read it.",
  );
  lines.push("");
  lines.push(`- **Report written:** ${formatStamp(now, settings)}`);
  lines.push(`- **Window covered:** ${sorted.length === 0 ? "no entries yet" : `${formatStamp(sorted[0].at, settings)} → ${formatStamp(sorted[sorted.length - 1].at, settings)}`}`);
  lines.push(`- **Time zone / language used for this report:** ${settings.timeZone || "the device zone"} · ${settings.locale} (master settings)`);
  if (options.sources && options.sources.length > 0) lines.push(`- **Read from:** ${options.sources.join(", ")}`);
  if (options.storage) {
    lines.push(
      `- **Storage:** ${options.storage.driver}${options.storage.durable ? " (permanent)" : " (temporary — data can disappear)"}` +
        `${options.storage.location ? ` at ${options.storage.location}` : ""}`,
    );
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- 🚨 Fix me: **${summary.critical}**`);
  lines.push(`- ⚠️ Needs a look: **${summary.warning}**`);
  lines.push(`- ℹ️ For information: **${summary.info}**`);
  lines.push("");
  if (summary.groups.length === 0) {
    lines.push("_No behaviour has been logged yet._");
  } else {
    lines.push("| Count | What it means | Area | Taken from | Last seen |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const group of summary.groups) {
      lines.push(
        `| ${SEVERITY_EMOJI[group.severity]} ${group.count} | ${escapeCell(group.layman)} | ${AREA_LABEL[group.area]} | \`${group.code}\` | ${formatStamp(group.lastAt, settings)} |`,
      );
    }
  }
  lines.push("");

  const actionable = summary.groups.filter((group) => group.severity !== "info");
  lines.push("## What to do about it");
  lines.push("");
  if (actionable.length === 0) {
    lines.push("_Nothing needs action right now._");
  } else {
    for (const group of actionable) {
      lines.push(`- ${SEVERITY_EMOJI[group.severity]} **${SEVERITY_LABEL[group.severity]}** — ${group.fix} _(${group.count}× ${group.code}${group.affectedKids.length ? `, ${group.affectedKids.join(", ")}` : ""})_`);
    }
  }
  lines.push("");

  lines.push("## Timeline");
  lines.push("");
  if (sorted.length === 0) {
    lines.push("_Nothing logged yet._");
  } else {
    let currentDay = "";
    for (const entry of sorted) {
      const day = formatDayHeading(entry.at, entry.settings ?? settings);
      if (day !== currentDay) {
        currentDay = day;
        lines.push(`### ${day}`);
        lines.push("");
      }
      lines.push(
        `${SEVERITY_EMOJI[entry.severity]} **${formatStamp(entry.at, entry.settings ?? settings)}** · ${entry.layman}`,
      );
      lines.push("");
      lines.push(`> **Technical:** ${entry.technical}`);
      lines.push(`> **What to do:** ${entry.fix}`);
      const extra = describeContext(entry);
      if (extra) lines.push(`> **Details:** ${extra}`);
      lines.push("");
    }
  }

  lines.push("## How to keep this log useful");
  lines.push("");
  lines.push("1. Export a fresh copy from **Parent dashboard → Behaviour log → Download report** (or press **Copy**).");
  lines.push("2. Save it in this repository (the app also keeps JSON lines in `.data/behaviour.jsonl` while it runs).");
  lines.push("3. Run `npm run behaviour:report` to rebuild this file from the saved copies.");
  lines.push("4. Review the 🚨 and ⚠️ groups first: each one names the code to fix in `src/lib/behaviour.ts` and the cause in plain words.");
  lines.push("");
  return lines.join("\n");
}

/**
 * Rewrites one stored line with the current catalogue wording. Falls back to the
 * stored text when the code is not in the catalogue (an older version of the app).
 */
function presentEntry(entry: BehaviourEntry): BehaviourEntry {
  if (!Object.prototype.hasOwnProperty.call(BEHAVIOUR, entry.code)) return entry;
  // A line written by an older build can still contain “{kidName}”: fill those in
  // with today's wording. A line that already reads properly is left exactly as
  // the running server wrote it.
  const unfinished = /\{\w+\}/.test(`${entry.layman} ${entry.technical} ${entry.fix}`);
  const context = { ...(entry.context ?? {}) };
  // The same fact is sometimes written under two names (“storage” in one call
  // site, “driver” in another), so both spellings are offered to the wording.
  if (context.driver === undefined && context.storage !== undefined) context.driver = context.storage;
  if (context.storage === undefined && context.driver !== undefined) context.storage = context.driver;
  if (context.label === undefined && context.deviceLabel !== undefined) context.label = context.deviceLabel;
  const vars: Record<string, unknown> = context;
  if (entry.kidName) vars.kidName = entry.kidName;
  if (entry.deviceId) vars.deviceId = entry.deviceId;
  const described = describeBehaviour(entry.code, vars);
  // Refresh a line that still has a hole in it (an older build wrote it), or one
  // where every fact the current wording needs is known — that way a fixed
  // sentence (“…'s device's device…”) reads correctly here. A line whose facts
  // we do not have is left exactly as the running server wrote it.
  if (!unfinished && described.missing.length > 0) return entry;
  return { ...entry, area: described.area, layman: described.layman, technical: described.technical, fix: described.fix };
}

function describeContext(entry: BehaviourEntry): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const add = (text: string) => {
    if (seen.has(text)) return;
    seen.add(text);
    parts.push(text);
    return;
  };
  const context = entry.context ?? {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") continue;
    add(`${key}=${String(value).slice(0, 160)}`);
  }
  if (entry.kidName) add(`kidName=${entry.kidName}`);
  if (entry.deviceId) add(`deviceId=${entry.deviceId}`);
  if (entry.source === "client" && entry.client) {
    if (entry.client.platform) add(`platform=${entry.client.platform}`);
    if (entry.client.protocol) add(`protocol=${entry.client.protocol}`);
    if (entry.client.online === false) add("deviceWasOffline");
  }
  return parts.join(" · ");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** A short, plain-language headline for a card at the top of the log screen. */
export function behaviourHeadline(summary: BehaviourSummary): string {
  if (summary.total === 0) return "Nothing has gone wrong yet — the log is empty.";
  if (summary.critical > 0) {
    return `${summary.critical} thing${summary.critical === 1 ? "" : "s"} need fixing (🚨) and ${summary.warning} need a look (⚠️).`;
  }
  if (summary.warning > 0) return `${summary.warning} thing${summary.warning === 1 ? "" : "s"} need a look (⚠️). Everything else is normal.`;
  return "Everything in the log is normal activity.";
}
