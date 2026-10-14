import type { NextRequest } from "next/server";
import { isDateFormat, isLocaleCode, isTimeFormat, isValidTimeZone, localeInfo, resolveSettings } from "@/lib/settings";
import { error, json, readBody, route } from "@/lib/server/http";
import { recordBehaviour } from "@/lib/server/diagnostics";
import { parentAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { settingsForParent } from "@/lib/server/views";
import type { FamilySettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOLEAN_KEYS = ["kidVoiceOver", "parentVoiceOver", "kidDictation"] as const;

/** The family's master settings: date, time, language and voice. */
export const GET = route(async (req: NextRequest) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);

  const doc = await store.read();
  return json({ settings: settingsForParent(doc, auth.parent.id), locales: undefined });
});

/**
 * Updates one or more master settings. Every date, time and language in the app
 * (including the behavioural log and the quiz questions) follows these values.
 */
export const PATCH = route(async (req: NextRequest) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);

  const body = await readBody(req);
  const rejected: { field: string; value: unknown; fallback: unknown }[] = [];
  const patch: Partial<FamilySettings> = {};
  const changed: string[] = [];

  const provided = (key: keyof FamilySettings) => Object.prototype.hasOwnProperty.call(body, key);

  if (provided("timeZone")) {
    const value = typeof body.timeZone === "string" ? body.timeZone.trim() : String(body.timeZone ?? "");
    if (isValidTimeZone(value)) patch.timeZone = value;
    else rejected.push({ field: "timeZone", value: body.timeZone, fallback: "" });
  }
  if (provided("locale")) {
    if (isLocaleCode(body.locale)) patch.locale = body.locale;
    else rejected.push({ field: "locale", value: body.locale, fallback: "en" });
  }
  if (provided("dateFormat")) {
    if (isDateFormat(body.dateFormat)) patch.dateFormat = body.dateFormat;
    else rejected.push({ field: "dateFormat", value: body.dateFormat, fallback: "auto" });
  }
  if (provided("timeFormat")) {
    if (isTimeFormat(body.timeFormat)) patch.timeFormat = body.timeFormat;
    else rejected.push({ field: "timeFormat", value: body.timeFormat, fallback: "auto" });
  }
  for (const key of BOOLEAN_KEYS) {
    if (!provided(key)) continue;
    if (typeof body[key] === "boolean") patch[key] = body[key] as boolean;
    else rejected.push({ field: key, value: body[key], fallback: true });
  }

  const outcome = await store.mutate((doc) => {
    const current = settingsForParent(doc, auth.parent.id);
    for (const key of Object.keys(patch) as (keyof FamilySettings)[]) {
      if (current[key] !== patch[key]) changed.push(`${key}=${String(patch[key])}`);
    }
    const next = resolveSettings({ ...current, ...patch });
    doc.settings = { ...(doc.settings ?? {}), [auth.parent.id]: next };

    for (const item of rejected) {
      recordBehaviour(doc, {
        code: "settings.rejected_value",
        parentId: auth.parent.id,
        vars: { field: item.field, value: item.value, fallback: item.fallback },
        context: { field: item.field },
      });
    }
    if (changed.length > 0) {
      recordBehaviour(
        doc,
        {
          code: "settings.updated",
          parentId: auth.parent.id,
          vars: {
            changed: changed.join(", "),
            values: changed.join(", "),
            parentName: auth.parent.name,
            locale: next.locale,
            timeZone: next.timeZone || "device",
          },
          context: { changed: changed.join(", "), locale: next.locale, timeZone: next.timeZone || "device" },
        },
        { force: true },
      );
    }
    return { settings: next, rejected: rejected.length };
  });

  return json({
    settings: outcome.settings,
    changed,
    rejected: outcome.rejected,
    language: localeInfo(outcome.settings.locale).label,
    message:
      changed.length === 0
        ? "Nothing changed."
        : `Saved. Dates, times and questions now follow ${localeInfo(outcome.settings.locale).label}.`,
  });
});
