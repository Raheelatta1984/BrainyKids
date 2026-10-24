import type { NextRequest } from "next/server";
import { buildBehaviourReport } from "@/lib/behaviour-report";
import { isBehaviourCode, summariseBehaviour, type BehaviourInput } from "@/lib/behaviour";
import { DEFAULT_SETTINGS, resolveSettings } from "@/lib/settings";
import { behaviourFrom, behaviourJsonLine, logBehaviourBatch } from "@/lib/server/diagnostics";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { deviceAuth, parentAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { settingsForParent } from "@/lib/server/views";
import type { BehaviourEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVENTS_PER_REQUEST = 25;
const MAX_TEXT = 400;

function clean(value: unknown, limit = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
}

function cleanContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= 20) break;
    if (typeof raw === "string") out[key] = raw.slice(0, 200);
    else if (typeof raw === "number" || typeof raw === "boolean") out[key] = raw;
    count += 1;
  }
  return out;
}

function cleanClient(value: unknown): BehaviourEntry["client"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const client: BehaviourEntry["client"] = {};
  const userAgent = clean(raw.userAgent, 240);
  const platform = clean(raw.platform, 80);
  const url = clean(raw.url, 200);
  const protocol = clean(raw.protocol, 20);
  const timeZone = clean(raw.timeZone, 60);
  const language = clean(raw.language, 40);
  if (userAgent) client.userAgent = userAgent;
  if (platform) client.platform = platform;
  if (url) client.url = url;
  if (protocol) client.protocol = protocol;
  if (timeZone) client.timeZone = timeZone;
  if (language) client.language = language;
  if (typeof raw.online === "boolean") client.online = raw.online;
  if (typeof raw.cookies === "boolean") client.cookies = raw.cookies;
  return Object.keys(client).length > 0 ? client : undefined;
}

/**
 * The browser's half of the behavioural log.
 *
 * Devices report what they see (a dropped connection, a QR code that ran out of
 * time, a child whose profile came back empty, a browser that refuses cookies).
 * The server attaches who reported it and which master settings were in force,
 * then merges everything into the same log and the same review report.
 */
export const POST = route(async (req: NextRequest) => {
  const parent = await parentAuth(req);
  const device = parent ? null : await deviceAuth(req);
  // Guest telemetry remains in the browser console, not in the shared family
  // document. Acknowledge/drop it so it cannot become an anonymous write API.
  if (!parent && !device) return json({ ok: true, logged: 0 });
  const body = await readBody(req);
  const incoming = Array.isArray(body.events) ? body.events : [body];
  if (incoming.length === 0) return error("Nothing to log.");
  if (incoming.length > MAX_EVENTS_PER_REQUEST) return error("Too many events in one request.", 413);

  const doc = await store.read();
  const role: BehaviourEntry["role"] = parent ? "parent" : device ? "kid" : "guest";
  const parentId = parent?.parent.id ?? device?.kid.parentId ?? null;
  const settings = parentId ? settingsForParent(doc, parentId) : DEFAULT_SETTINGS;

  const clientUserAgent = clean(req.headers.get("user-agent"), 240);
  const inputs: BehaviourInput[] = [];
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as Record<string, unknown>;
    const code = str(event.code);
    if (!code || !isBehaviourCode(code)) continue;
    const context = cleanContext(event.context);
    const vars = cleanContext(event.vars);
    inputs.push({
      code,
      vars,
      context,
      at: typeof event.at === "number" && Number.isFinite(event.at) ? event.at : undefined,
      role,
      parentId,
      kidId: device?.kid.id ?? (typeof event.kidId === "string" ? event.kidId : null),
      kidName: device?.kid.name ?? clean(event.kidName, 60) ?? null,
      deviceId: device?.device.id ?? (typeof event.deviceId === "string" ? event.deviceId : null),
      client: cleanClient(event.client) ?? (clientUserAgent ? { userAgent: clientUserAgent } : undefined),
    });
  }

  if (inputs.length === 0) return error("None of those events are known to BrainyKids.", 400);

  const written = await logBehaviourBatch(inputs, {
    source: "client",
    role,
    settings,
  });

  return json({ ok: true, logged: written });
});

/**
 * The behavioural log as the family sees it: grouped summary, both wordings, and
 * (with `format=md`) the Markdown report that is saved in the repository.
 */
export const GET = route(async (req: NextRequest) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);

  const params = new URL(req.url).searchParams;
  const limit = Math.min(1_000, Math.max(20, Number.parseInt(params.get("limit") ?? "300", 10) || 300));
  const format = params.get("format") ?? "json";
  const download = params.get("download") === "1";

  const doc = await store.read();
  const settings = settingsForParent(doc, auth.parent.id);
  const entries = behaviourFrom(doc, { parentId: auth.parent.id, limit });
  const kids = doc.kids.filter((kid) => kid.parentId === auth.parent.id);

  if (format === "jsonl") {
    const body = entries.map((entry) => behaviourJsonLine(entry)).join("");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="brainykids-behaviour-${stamp}.jsonl"`,
        "cache-control": "no-store",
      },
    });
  }

  if (format === "md") {
    const report = buildBehaviourReport(entries, {
      settings,
      storage: store.info(),
      sources: ["stored log", ...kids.map((kid) => kid.name)],
    });
    if (download) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      return new Response(report, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="brainykids-behaviour-log-${stamp}.md"`,
          "cache-control": "no-store",
        },
      });
    }
    return new Response(report, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
  }

  const summary = summariseBehaviour(entries);
  return json({
    entries: [...entries].reverse(),
    summary,
    settings: resolveSettings(settings),
    storage: store.info(),
    kids: kids.map((kid) => ({ id: kid.id, name: kid.name })),
  });
});
