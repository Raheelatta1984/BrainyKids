// The behavioural log catalogue.
//
// Every line in the log has two descriptions of the same moment:
//   * `layman`    – plain words, so a parent (or anyone) can understand it,
//   * `technical` – the machine-facing facts a developer needs (ids, codes,
//                   storage driver, timings), and
//   * `fix`       – what to do about it, in plain words.
//
// Both the server (API routes) and the browser (client reporter) use the same
// catalogue, so a line logged in a browser and a line logged on the server read
// the same way and group together in the review report.

import { fill } from "./i18n";
import type { BehaviourArea, BehaviourEntry, BehaviourGroup, BehaviourSeverity, BehaviourSummary, LocaleCode } from "./types";

export type BehaviourTemplate = {
  area: BehaviourArea;
  severity: BehaviourSeverity;
  /** Plain-language description; may contain {placeholders}. */
  layman: string;
  /** Technical description; may contain {placeholders}. */
  technical: string;
  /** Plain-language advice for the person reviewing the log. */
  fix: string;
};

/**
 * The codes the app can write. Codes are stable strings (they are stored in the
 * log and in Git), so a rename means a new group in the review report.
 */
export const BEHAVIOUR: Record<string, BehaviourTemplate> = {
  // ------------------------------------------------------------- kid session --
  "kid.session.linked": {
    area: "session",
    severity: "info",
    layman: "{kidName} signed in on {deviceLabel}.",
    technical: "device linked: kidId={kidId} deviceId={deviceId} label={deviceLabel} storage={driver} durable={durable}",
    fix: "Nothing to do. This is the normal start of a kid session.",
  },
  "kid.session.signed_out_by_parent": {
    area: "session",
    severity: "info",
    layman: "{kidName} was signed out of kid mode on {deviceLabel}.",
    technical: "device unlinked (trigger={trigger}): deviceId={deviceId} kidId={kidId} by parentId={parentId}",
    fix: "Nothing to do. A parent ended kid mode on purpose.",
  },
  "kid.session.lost": {
    area: "session",
    severity: "critical",
    layman:
      "{kidName} lost the sign-in, so the child was shown the sign-in screen again (this is the “keeps signing out” report).",
    technical:
      "device cookie present but no device record in storage (reason={reason}): cookiePresent={cookiePresent} deviceFound={deviceFound} kidFound={kidFound} storage={driver} durable={durable} location={location}",
    fix:
      "Attach a permanent database (DATABASE_URL on Vercel) so device links survive a restart, then link the device again. Until then, each new server instance starts from an empty temporary file.",
  },
  "kid.session.restored": {
    area: "session",
    severity: "warning",
    layman: "{kidName} was recognised again from its signed cookie, so the child stayed signed in.",
    technical:
      "device restored from signed backup cookie: deviceId={deviceId} kidId={kidId} storage={driver} durable={durable} reason={reason}",
    fix:
      "The device link was recovered, but the server storage had lost it. Attach a permanent database (DATABASE_URL) to stop this repeating.",
  },
  "kid.session.heartbeat_failed": {
    area: "session",
    severity: "warning",
    layman:
      "The kid device could not check in with the server ({error}). The child stays signed in and the app keeps trying.",
    technical: "POST /api/kid-session/heartbeat failed: error={error} attempt={attempt} online={online} role=kid",
    fix: "Usually a dropped connection or a cold server start. The app retries automatically; fix only if it repeats in the log.",
  },
  "kid.session.heartbeat_unlinked": {
    area: "session",
    severity: "warning",
    layman: "{kidName} is no longer linked on the server, so the app returned to the sign-in screen.",
    technical: "heartbeat answered 401 unlinked: deviceId={deviceId} kidId={kidId} durable={durable} reason={reason}",
    fix: "Often a parent signing the device out on purpose. If nobody did, link the device again and check the storage notice on the dashboard.",
  },
  "kid.session.cookie_missing": {
    area: "session",
    severity: "critical",
    layman: "The child's device sent no sign-in cookie, so the app could not tell who the child was.",
    technical:
      "kid app active but cookie {cookieName} absent on request: protocol={protocol} secureCookieRequired={secure} url={url} cookiesEnabled={cookiesEnabled}",
    fix:
      "Open the app over https (or http://localhost), and check that the browser is not blocking cookies. On a plain-http address the cookie is refused unless it is marked non-secure.",
  },
  "kid.session.insecure_cookie": {
    area: "session",
    severity: "critical",
    layman:
      "The site is not served over https, so the browser refuses to store the sign-in cookie. That makes the child look signed out again and again.",
    technical: "cookie would be secure=true on protocol={protocol} host={host}; Set-Cookie dropped by the browser",
    fix: "Serve BrainyKids over https (Vercel does this automatically). For a home server, put it behind https or reach it at http://localhost.",
  },
  "kid.session.both_roles": {
    area: "session",
    severity: "warning",
    layman: "This device has both a parent sign-in and a child sign-in, so the parent screen is shown.",
    technical: "snapshot resolved as parent while device cookie {cookieName} is valid: deviceId={deviceId} kidId={kidId}",
    fix: "Sign the parent out on this device (or use another device for the parent) if a child should use it.",
  },
  "kid.session.recovered_after_error": {
    area: "session",
    severity: "info",
    layman: "The kid app reconnected after a temporary problem. Nothing was lost.",
    technical: "snapshot role returned to kid after {failures} failed refresh(es); deviceId={deviceId}",
    fix: "Nothing to do.",
  },

  // ---------------------------------------------------------------- kid data --
  "kid.profile.created": {
    area: "session",
    severity: "info",
    layman: "A parent added {kidName} to the family.",
    technical: "kid created: kidId={kidId} age={age} theme={theme} parentId={parentId}",
    fix: "Nothing to do. This line is here so a later “where has my child gone?” review can tell a real profile from a lost one.",
  },
  "kid.profile.deleted": {
    area: "session",
    severity: "warning",
    layman: "A parent deleted {kidName}. Their linked devices were signed out at the same time.",
    technical: "kid deleted: kidId={kidId} devicesRemoved={devicesRemoved} parentId={parentId}",
    fix: "Nothing to do if the family meant it. If the profile disappeared on its own, this line would be missing — look for storage.temporary_folder or kid.info.missing instead.",
  },
  "kid.info.missing": {
    area: "session",
    severity: "critical",
    layman:
      "The profile for {kidName} could not be found ({where}), so that screen had nothing to show. This is the “kid information disappearing” report.",
    technical:
      "kid record lookup failed ({where}): kidId={kidId} parentId={parentId} deviceId={deviceId} kidsOnServer={kidsOnServer} storage={driver} durable={durable} location={location}",
    fix:
      "Nothing was deleted by the app: the server storage forgot the child, which happens on a temporary filesystem or a database that is not attached. Attach DATABASE_URL, then re-add the child.",
  },
  "kid.info.vanished_from_dashboard": {
    area: "session",
    severity: "critical",
    layman:
      "The parent dashboard suddenly showed no children (it showed {previous} a moment before). Nothing a parent did caused this.",
    technical:
      "parent snapshot kids.length fell {previous} → 0 while parentId={parentId} stayed signed in; storage={driver} durable={durable} location={location}",
    fix:
      "The server lost its stored data. Attach a permanent database (DATABASE_URL) on Vercel; a plain file inside the project folder cannot survive a redeploy or a serverless restart.",
  },
  "kid.info.restored": {
    area: "session",
    severity: "info",
    layman: "The child profiles came back after the server reconnected to its storage.",
    technical: "parent snapshot kids.length recovered 0 → {count}; storage={driver} durable={durable}",
    fix: "Nothing to do, but check the storage notice if this repeats.",
  },

  // ------------------------------------------------------------------ pairing --
  "pairing.started": {
    area: "pairing",
    severity: "info",
    layman: "A device asked to be linked and is showing code {code} for a parent to approve.",
    technical: "pairing started: code={code} label={deviceLabel} ttlSeconds={ttlSeconds} expiresAt={expiresAt}",
    fix: "Nothing to do; this is the normal start of QR linking.",
  },
  "pairing.renewed": {
    area: "pairing",
    severity: "info",
    layman: "The link code on the child's screen was about to run out, so a fresh one appeared automatically.",
    technical: "pairing rotated before expiry: oldCode={oldCode} newCode={code} reason={reason}",
    fix: "Nothing to do. Automatic renewal is what stops the “QR code keeps expiring” problem.",
  },
  "pairing.expired_unapproved": {
    area: "pairing",
    severity: "warning",
    layman: "A link code ran out before a parent approved it ({code}). The child's screen shows a fresh code.",
    technical: "pairing expired: code={code} createdAt={createdAt} expiresAt={expiresAt} approved=false rotated={rotated}",
    fix: "Approve the next code within the time on screen, or raise the pairing window by keeping the link screen open — it now refreshes itself.",
  },
  "pairing.record_missing": {
    area: "pairing",
    severity: "critical",
    layman:
      "The link code on the child's screen could not be found on the server, so the parent could not approve it. This is part of the “QR code keeps expiring” report.",
    technical:
      "pairing lookup found no record for code={code} while the device still holds the pairing cookie: secretsMatch=false storage={driver} durable={durable} location={location}",
    fix:
      "The code was lost with the server's temporary storage (or the request landed on a different instance). Attach DATABASE_URL so pairing codes are shared between instances.",
  },
  "pairing.approved": {
    area: "pairing",
    severity: "info",
    layman: "A parent approved code {code}, and the device signed in as {kidName}.",
    technical: "pairing approved: code={code} kidId={kidId} deviceId={deviceId} label={deviceLabel} by parentId={parentId}",
    fix: "Nothing to do.",
  },
  "pairing.rejected": {
    area: "pairing",
    severity: "warning",
    layman: "A parent tried to approve a code that could not be used ({reason}).",
    technical: "pairing approval refused: code={code} reason={reason} status={status} expiresAt={expiresAt}",
    fix: "Ask the child's device for a new code (the screen now refreshes the code by itself).",
  },
  "pairing.lookup_failed": {
    area: "pairing",
    severity: "warning",
    layman: "A parent typed code {code} and no matching request was found.",
    technical: "GET /api/pairing/lookup missed: code={code} found={found} status={status}",
    fix: "Check the code is read from the child's own screen and still fresh; codes are single-use and time limited.",
  },

  // ------------------------------------------------------------------ storage --
  "storage.temporary_folder": {
    area: "storage",
    severity: "critical",
    layman:
      "BrainyKids cannot save permanently on this server, so accounts, children and device links can disappear when the server restarts.",
    technical: "file driver not durable: location={location} reason={reason} driver={driver}",
    fix: "Attach a Neon/Vercel Postgres database (DATABASE_URL) and redeploy. This one change fixes sign-outs and missing children together.",
  },
  "storage.error": {
    area: "storage",
    severity: "critical",
    layman: "BrainyKids could not read or write its saved data ({error}).",
    technical: "storage failure: driver={driver} durable={durable} location={location} operation={operation} error={error}",
    fix: "Check DATABASE_URL (or write permission on BRAINYKIDS_DATA_DIR) and press “Check database connection” on the dashboard.",
  },
  "storage.recovered": {
    area: "storage",
    severity: "info",
    layman: "Storage is working again; accounts and progress are being saved.",
    technical: "storage read/write succeeded after failures: driver={driver} durable={durable} location={location}",
    fix: "Nothing to do.",
  },

  // ------------------------------------------------------------- chat & voice --
  "chat.message_sent": {
    area: "chat",
    severity: "info",
    layman: "{from} sent a message to {to}{voiceNote}.",
    technical: "chat message stored: kidId={kidId} messageId={messageId} from={from} chars={chars} kind={kind}",
    fix: "Nothing to do.",
  },
  "chat.message_failed": {
    area: "chat",
    severity: "warning",
    layman: "A chat message could not be delivered ({error}).",
    technical: "POST {path} failed: kidId={kidId} from={from} error={error}",
    fix: "Usually a short connection drop — send again. If it repeats, check the server log for the matching error.",
  },
  "chat.voice_missing": {
    area: "voice",
    severity: "warning",
    layman: "This device cannot read messages out loud, so voice over is switched off here.",
    technical: "speechSynthesis unavailable: userAgent={userAgent} platform={platform}",
    fix: "Voice over needs a browser with speech support (Chrome, Edge, Safari). Typing still works on this device.",
  },
  "chat.listen_missing": {
    area: "voice",
    severity: "warning",
    layman: "This device cannot listen to a spoken message, so the microphone button is hidden.",
    technical: "SpeechRecognition unavailable: userAgent={userAgent} platform={platform} protocol={protocol}",
    fix: "Speech-to-text needs Chrome/Edge (or Safari on iOS 14.5+) and, on a phone, a secure address (https).",
  },
  "chat.dictation_failed": {
    area: "voice",
    severity: "warning",
    layman: "A spoken message was not understood, so nothing was sent.",
    technical: "speech recognition error={error} locale={locale} kidId={kidId}",
    fix: "Try again, speak a little slower, and check the master language matches the language being spoken.",
  },
  "chat.voice_played": {
    area: "voice",
    severity: "info",
    layman: "A message was read out loud on this device.",
    technical: "speechSynthesis spoke messageId={messageId} locale={locale} chars={chars}",
    fix: "Nothing to do.",
  },

  // --------------------------------------------------------------------- quiz --
  "quiz.answer_rejected": {
    area: "quiz",
    severity: "warning",
    layman: "An answer was not accepted by the server, so no points were given.",
    technical: "POST /api/kid-session/answers refused: questionId={questionId} level={level} kidId={kidId} reason={reason}",
    fix: "A locked level or an unknown question. Refresh the child's screen if it keeps happening.",
  },
  "quiz.screen_time_requested": {
    area: "quiz",
    severity: "info",
    layman: "{kidName} asked for {minutes} minutes of screen time.",
    technical: "screen time requested: kidId={kidId} minutes={minutes} pointsSpent={minutes}",
    fix: "Nothing to do; approve or send it back from the dashboard.",
  },
  "quiz.timed_out": {
    area: "quiz",
    severity: "info",
    layman: "{kidName} ran out of time on a question, so no reward was earned for it.",
    technical: "question timed out: kidId={kidId} questionId={questionId} level={level} scorePercent={scorePercent}",
    fix: "Nothing to do. If it happens a lot, give that difficulty more seconds in Master settings (up to 10 minutes).",
  },
  "reward.blocked": {
    area: "quiz",
    severity: "info",
    layman: "{kidName} answered well but earned nothing this time ({reason}).",
    technical: "reward blocked: kidId={kidId} questionId={questionId} level={level} reason={reason} scorePercent={scorePercent}",
    fix: "Check the daily/weekly earn limits and the earning schedule in Master settings if the family expected a reward.",
  },
  "reward.realise_requested": {
    area: "quiz",
    severity: "info",
    layman: "{kidName} asked to realise {amount}.",
    technical: "realise requested: kidId={kidId} amount={amount}",
    fix: "Nothing to do; approve or send it back from the child's card on the dashboard. Approval resets the wallet to zero.",
  },
  "reward.realise_approved": {
    area: "quiz",
    severity: "info",
    layman: "A parent approved {kidName}'s realise request for {amount}; the wallet was reset.",
    technical: "realise approved: kidId={kidId} amount={amount}",
    fix: "Nothing to do. Pay the child outside the app; the transaction is in the wallet log.",
  },
  "reward.realise_declined": {
    area: "quiz",
    severity: "info",
    layman: "A parent sent back {kidName}'s realise request for {amount}; the balance was kept.",
    technical: "realise declined: kidId={kidId} amount={amount}",
    fix: "Nothing to do. The child keeps the balance and can ask again later.",
  },

  // ----------------------------------------------------------------- settings --
  "settings.updated": {
    area: "settings",
    severity: "info",
    layman: "The master settings were changed: {changed}.",
    technical: "PATCH /api/settings by parentId={parentId}: changed={changed} values={values}",
    fix: "Nothing to do. Every date, time and language in the app (and in this log) now follows the new settings.",
  },
  "settings.rejected_value": {
    area: "settings",
    severity: "warning",
    layman: "One settings value was not understood ({field}={value}), so the old value was kept.",
    technical: "settings validation failed: field={field} value={value} fallback={fallback}",
    fix: "Pick the value from the list in Settings rather than typing it by hand.",
  },

  // ------------------------------------------------------------------- server --
  "server.api_error": {
    area: "server",
    severity: "critical",
    layman: "A request to the server failed ({path}). The app showed an error message instead of a blank page.",
    technical: "unhandled API error: {method} {path} status={status} message={message}",
    fix: "Read the technical line and the server console next to it; this entry is written where the failure happened.",
  },
  "server.session_expired": {
    area: "server",
    severity: "info",
    layman: "A sign-in ran out of time ({role}), so that device was asked to sign in again.",
    technical: "session rejected: role={role} reason={reason} expiresAt={expiresAt} storage={driver}",
    fix: "Nothing to do — session cookies expire on purpose. Kid devices last 180 days, parents 30 days.",
  },
  "log.overflow": {
    area: "server",
    severity: "warning",
    layman: "The behavioural log is full, so the oldest lines were dropped.",
    technical: "behaviour log reached MAX_BEHAVIOUR={max}; dropped={dropped} lines (oldest first)",
    fix: "Export the log from Settings → Behaviour log and keep the file in the repository, then the review covers the whole history.",
  },
};

export type BehaviourCode = keyof typeof BEHAVIOUR;

export function isBehaviourCode(value: unknown): value is string {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BEHAVIOUR, value);
}

/** Words used when a call site did not supply a placeholder value. */
const PLACEHOLDER_FALLBACKS: Record<string, string> = {
  kidName: "This child's device",
  code: "-",
  oldCode: "-",
  deviceLabel: "this device",
  label: "this device",
  changed: "nothing",
  values: "-",
  field: "-",
  value: "-",
  fallback: "-",
  error: "unknown error",
  message: "no message",
  reason: "not recorded",
  where: "on the server",
  status: "-",
  path: "-",
  method: "-",
  minutes: "0",
  questionId: "-",
  level: "-",
  locale: "-",
  chars: "0",
  kind: "-",
  driver: "unknown",
  location: "unknown",
  url: "-",
  protocol: "-",
  userAgent: "unknown browser",
  platform: "unknown device",
  cookieName: "bk_device",
  kidId: "-",
  deviceId: "-",
  parentId: "-",
  messageId: "-",
  expiresAt: "-",
  createdAt: "-",
  ttlSeconds: "-",
  rotated: "no",
  approve: "-",
  max: "0",
  dropped: "0",
};

function withFallbacks(text: string, strings: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(strings, name)) return strings[name];
    return PLACEHOLDER_FALLBACKS[name] ?? "-";
  });
}

/** The three descriptions for one moment, with {placeholders} filled in. */
/** Placeholders in a template that the caller did not supply a value for. */
function missingPlaceholders(text: string, strings: Record<string, string>): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    const name = match[1];
    if (!Object.prototype.hasOwnProperty.call(strings, name) && !out.includes(name)) out.push(name);
  }
  return out;
}

export function describeBehaviour(
  code: string,
  vars: Record<string, unknown> = {},
): {
  area: BehaviourArea;
  severity: BehaviourSeverity;
  layman: string;
  technical: string;
  fix: string;
  /** Names of placeholders no value was given for (they were filled with safe words). */
  missing: string[];
} {
  const template = BEHAVIOUR[code];
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) strings[key] = value === undefined || value === null ? "-" : String(value);
  if (!template) {
    return {
      area: "server",
      severity: "warning",
      layman: strings.layman ?? `Unknown behaviour “${code}”.`,
      technical: strings.technical ?? `behaviour code={code}`,
      fix: strings.fix ?? "Add this code to src/lib/behaviour.ts so the log explains it.",
      missing: [],
    };
  }
  const missing = [
    ...new Set([
      ...missingPlaceholders(template.layman, strings),
      ...missingPlaceholders(template.technical, strings),
      ...missingPlaceholders(template.fix, strings),
    ]),
  ];
  return {
    area: template.area,
    severity: template.severity,
    layman: withFallbacks(fill(template.layman, strings), strings),
    technical: withFallbacks(fill(template.technical, strings), strings),
    fix: withFallbacks(fill(template.fix, strings), strings),
    missing,
  };
}

/** What a reporter (browser or server) sends: the code plus its facts. */
export type BehaviourInput = {
  code: string;
  vars?: Record<string, unknown>;
  context?: Record<string, unknown>;
  at?: number;
  role?: BehaviourEntry["role"];
  parentId?: string | null;
  kidId?: string | null;
  kidName?: string | null;
  deviceId?: string | null;
  client?: BehaviourEntry["client"];
  /** Overridable strings, used when the call site has better wording. */
  layman?: string;
  technical?: string;
  fix?: string;
};

export type BehaviourStamp = Pick<BehaviourEntry, "settings">;

/** Builds a full log entry from a report. */
export function buildBehaviourEntry(
  input: BehaviourInput,
  base: { settings: BehaviourEntry["settings"]; source: BehaviourEntry["source"]; id?: number; role?: BehaviourEntry["role"] },
): BehaviourEntry {
  const described = describeBehaviour(input.code, input.vars);
  return {
    id: input.at ?? 0, // replaced by the store's sequence when saved
    code: input.code,
    area: described.area,
    severity: described.severity,
    at: input.at ?? Date.now(),
    layman: input.layman ?? described.layman,
    technical: input.technical ?? described.technical,
    fix: input.fix ?? described.fix,
    source: base.source,
    role: input.role ?? base.role ?? "server",
    parentId: input.parentId ?? null,
    kidId: input.kidId ?? null,
    kidName: input.kidName ?? null,
    deviceId: input.deviceId ?? null,
    context: withVarsInContext(input.context, input.vars),
    settings: base.settings,
    client: input.client,
  } as BehaviourEntry;
}

/**
 * The facts behind a line are kept with it, so a report can be rebuilt later
 * without losing the detail (the phone line said “Failed to fetch”, not just
 * “a network error”). Values given explicitly in `context` win over `vars`.
 */
function withVarsInContext(
  context: Record<string, unknown> | undefined,
  vars: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (typeof value === "string") merged[key] = value.slice(0, 200);
    else if (typeof value === "number" || typeof value === "boolean") merged[key] = value;
  }
  for (const [key, value] of Object.entries(context ?? {})) merged[key] = value;
  return merged;
}

/** Groups log lines by code: the summary a review reads first. */
export function summariseBehaviour(entries: BehaviourEntry[]): BehaviourSummary {
  const groups = new Map<string, BehaviourGroup>();
  let critical = 0;
  let warning = 0;
  let info = 0;
  for (const entry of entries) {
    if (entry.severity === "critical") critical += 1;
    else if (entry.severity === "warning") warning += 1;
    else info += 1;
    const existing = groups.get(entry.code);
    if (!existing) {
      groups.set(entry.code, {
        code: entry.code,
        area: entry.area,
        severity: entry.severity,
        count: 1,
        firstAt: entry.at,
        lastAt: entry.at,
        layman: entry.layman,
        technical: entry.technical,
        fix: entry.fix,
        affectedKids: entry.kidName ? [entry.kidName] : [],
      });
      continue;
    }
    existing.count += 1;
    existing.firstAt = Math.min(existing.firstAt, entry.at);
    existing.lastAt = Math.max(existing.lastAt, entry.at);
    if (entry.severity === "critical") existing.severity = "critical";
    else if (entry.severity === "warning" && existing.severity === "info") existing.severity = "warning";
    existing.layman = entry.layman;
    existing.technical = entry.technical;
    existing.fix = entry.fix;
    if (entry.kidName && !existing.affectedKids.includes(entry.kidName)) existing.affectedKids.push(entry.kidName);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const weight = { critical: 0, warning: 1, info: 2 } as const;
    if (weight[a.severity] !== weight[b.severity]) return weight[a.severity] - weight[b.severity];
    return b.count - a.count;
  });
  return { total: entries.length, critical, warning, info, groups: ordered, generatedAt: Date.now() };
}

export const SEVERITY_EMOJI: Record<BehaviourSeverity, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

export const SEVERITY_LABEL: Record<BehaviourSeverity, string> = {
  info: "For information",
  warning: "Needs a look",
  critical: "Fix me",
};

export const AREA_LABEL: Record<BehaviourArea, string> = {
  session: "Sign-in and sessions",
  storage: "Saved data",
  pairing: "QR code and device linking",
  chat: "Chat",
  voice: "Voice over",
  quiz: "Questions and points",
  settings: "Settings",
  server: "Server",
  device: "Devices",
};

/** Settings snapshot stored on every entry, so old lines keep their own clock. */
export function stampFor(settings?: Partial<BehaviourEntry["settings"]> | null): BehaviourEntry["settings"] {
  return {
    timeZone: settings?.timeZone ?? "",
    locale: (settings?.locale ?? "en") as LocaleCode,
    dateFormat: settings?.dateFormat ?? "auto",
    timeFormat: settings?.timeFormat ?? "auto",
  };
}
