import type { NextRequest } from "next/server";
import { isDateFormat, isLocaleCode, isQuestionLanguage, isTimeFormat, isValidTimeZone, localeInfo, resolveSettings } from "@/lib/settings";
import { curriculumCountryInfo, educationGradeCountry, isCurriculumCountry, isEducationStage } from "@/lib/curriculum";
import { isCurrencyCode, isRewardKind } from "@/lib/rewards";
import { error, json, readBody, route } from "@/lib/server/http";
import { recordBehaviour } from "@/lib/server/diagnostics";
import { parentAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { settingsForParent } from "@/lib/server/views";
import type { FamilySettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOLEAN_KEYS = ["kidVoiceOver", "parentVoiceOver", "kidDictation", "showQuestionTranslation", "earnScheduleEnabled"] as const;

const NUMBER_RANGES: Partial<Record<keyof FamilySettings, [number, number]>> = {
  maxRewardPerQuestionMinor: [0, 100_000],
  dailyEarnLimitMinor: [0, 10_000_000],
  weeklyEarnLimitMinor: [0, 10_000_000],
  timerEasySeconds: [30, 600],
  timerMediumSeconds: [30, 600],
  timerHardSeconds: [30, 600],
};

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
  if (provided("questionLanguage")) {
    if (isQuestionLanguage(body.questionLanguage)) patch.questionLanguage = body.questionLanguage;
    else rejected.push({ field: "questionLanguage", value: body.questionLanguage, fallback: "same" });
  }
  if (provided("curriculumCountry")) {
    if (isCurriculumCountry(body.curriculumCountry)) patch.curriculumCountry = body.curriculumCountry;
    else rejected.push({ field: "curriculumCountry", value: body.curriculumCountry, fallback: "AU" });
  }
  if (provided("educationStage")) {
    if (isEducationStage(body.educationStage)) patch.educationStage = body.educationStage;
    else rejected.push({ field: "educationStage", value: body.educationStage, fallback: "auto" });
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
    else rejected.push({ field: key, value: body[key], fallback: key === "showQuestionTranslation" ? false : true });
  }
  // Rewards & timers (Master settings).
  if (provided("rewardKind")) {
    if (isRewardKind(body.rewardKind)) patch.rewardKind = body.rewardKind;
    else rejected.push({ field: "rewardKind", value: body.rewardKind, fallback: "money" });
  }
  if (provided("currency")) {
    if (isCurrencyCode(body.currency)) patch.currency = body.currency;
    else rejected.push({ field: "currency", value: body.currency, fallback: "AUD" });
  }
  for (const [key, [min, max]] of Object.entries(NUMBER_RANGES) as [keyof FamilySettings, [number, number]][]) {
    if (!provided(key)) continue;
    const value = body[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) {
      (patch as Record<string, unknown>)[key] = Math.round(value);
    } else rejected.push({ field: key, value, fallback: min });
  }
  if (provided("earnDays")) {
    const days = Array.isArray(body.earnDays)
      ? [...new Set(body.earnDays.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort()
      : null;
    if (days) patch.earnDays = days;
    else rejected.push({ field: "earnDays", value: body.earnDays, fallback: "all days" });
  }
  for (const key of ["earnStartTime", "earnEndTime"] as const) {
    if (!provided(key)) continue;
    if (typeof body[key] === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body[key] as string)) patch[key] = body[key] as string;
    else rejected.push({ field: key, value: body[key], fallback: "07:00" });
  }

  const outcome = await store.mutate((doc) => {
    const current = settingsForParent(doc, auth.parent.id);
    const nextValues: FamilySettings = { ...current, ...patch };
    const gradeCountry = educationGradeCountry(nextValues.educationStage);
    if (gradeCountry && gradeCountry !== nextValues.curriculumCountry) {
      if (provided("educationStage")) {
        rejected.push({ field: "educationStage", value: nextValues.educationStage, fallback: "auto" });
      }
      nextValues.educationStage = "auto";
    }
    const changedKeys = new Set(Object.keys(patch) as (keyof FamilySettings)[]);
    if (current.educationStage !== nextValues.educationStage) changedKeys.add("educationStage");
    for (const key of changedKeys) {
      if (current[key] !== nextValues[key]) changed.push(`${key}=${String(nextValues[key])}`);
    }
    const next = resolveSettings(nextValues);
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

  const questionLocale = outcome.settings.questionLanguage === "same"
    ? outcome.settings.locale
    : outcome.settings.questionLanguage;
  const curriculum = curriculumCountryInfo(outcome.settings.curriculumCountry);
  return json({
    settings: outcome.settings,
    changed,
    rejected: outcome.rejected,
    language: localeInfo(outcome.settings.locale).label,
    message:
      changed.length === 0
        ? "Nothing changed."
        : `Saved. App: ${localeInfo(outcome.settings.locale).label}; questions: ${localeInfo(questionLocale).label} · ${curriculum.label} curriculum.`,
  });
});
