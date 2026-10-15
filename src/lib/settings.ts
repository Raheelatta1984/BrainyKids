// Family master settings: the single place that decides the date, the time, the
// language and the voice the whole app (and the behavioural log) uses.
//
// Shared by the server and the browser, so a log line written on the server and
// a log line written in a browser are stamped the same way.

import type { DateFormat, FamilySettings, LocaleCode, TimeFormat } from "./types";

export const DEFAULT_SETTINGS: FamilySettings = {
  timeZone: "",
  locale: "en",
  dateFormat: "auto",
  timeFormat: "auto",
  kidVoiceOver: true,
  parentVoiceOver: false,
  kidDictation: true,
  // Rewards: A$0.50 for a perfect answer (40c at 90%+), A$2/day and A$10/week
  // caps until a parent changes them. Easy questions get 2 minutes, medium 5,
  // hard 10 — the maximum the timer ever allows.
  rewardKind: "money",
  currency: "AUD",
  maxRewardPerQuestionMinor: 50,
  dailyEarnLimitMinor: 200,
  weeklyEarnLimitMinor: 1000,
  earnScheduleEnabled: false,
  earnDays: [0, 1, 2, 3, 4, 5, 6],
  earnStartTime: "07:00",
  earnEndTime: "20:00",
  timerEasySeconds: 120,
  timerMediumSeconds: 300,
  timerHardSeconds: 600,
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

function validHm(value: unknown, fallback: string): string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

export type LocaleInfo = {
  code: LocaleCode;
  /** English name, for the settings list. */
  label: string;
  /** The language's own name, so a parent recognises it. */
  native: string;
  /** Right-to-left script (Arabic, Urdu). */
  rtl: boolean;
  /** BCP-47 tag used for spoken voice and speech recognition. */
  speech: string;
  /** Tag used for Intl date/number formatting. */
  intl: string;
  /** Quiz questions and tasks are translated into this language. */
  questions: boolean;
};

export const LOCALES: LocaleInfo[] = [
  { code: "en", label: "English", native: "English", rtl: false, speech: "en-AU", intl: "en-AU", questions: true },
  { code: "es", label: "Spanish", native: "Español", rtl: false, speech: "es-ES", intl: "es-ES", questions: true },
  { code: "fr", label: "French", native: "Français", rtl: false, speech: "fr-FR", intl: "fr-FR", questions: true },
  { code: "ar", label: "Arabic", native: "العربية", rtl: true, speech: "ar-SA", intl: "ar", questions: true },
  { code: "ur", label: "Urdu", native: "اردو", rtl: true, speech: "ur-PK", intl: "ur-PK", questions: true },
  { code: "hi", label: "Hindi", native: "हिन्दी", rtl: false, speech: "hi-IN", intl: "hi-IN", questions: true },
  { code: "zh", label: "Chinese (Simplified)", native: "简体中文", rtl: false, speech: "zh-CN", intl: "zh-CN", questions: true },
];

const LOCALE_CODES = new Set<string>(LOCALES.map((l) => l.code));

export function localeInfo(code: LocaleCode | string | undefined | null): LocaleInfo {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && LOCALE_CODES.has(value);
}

export function isRtl(locale: LocaleCode | string | undefined | null): boolean {
  return localeInfo(locale).rtl;
}

/** Fills in anything missing so the rest of the app can rely on a complete object. */
export function resolveSettings(input?: Partial<FamilySettings> | null): FamilySettings {
  if (!input) return { ...DEFAULT_SETTINGS };
  return {
    timeZone: typeof input.timeZone === "string" && isValidTimeZone(input.timeZone) ? input.timeZone : "",
    locale: isLocaleCode(input.locale) ? input.locale : DEFAULT_SETTINGS.locale,
    dateFormat: isDateFormat(input.dateFormat) ? input.dateFormat : DEFAULT_SETTINGS.dateFormat,
    timeFormat: isTimeFormat(input.timeFormat) ? input.timeFormat : DEFAULT_SETTINGS.timeFormat,
    kidVoiceOver: typeof input.kidVoiceOver === "boolean" ? input.kidVoiceOver : DEFAULT_SETTINGS.kidVoiceOver,
    parentVoiceOver:
      typeof input.parentVoiceOver === "boolean" ? input.parentVoiceOver : DEFAULT_SETTINGS.parentVoiceOver,
    kidDictation: typeof input.kidDictation === "boolean" ? input.kidDictation : DEFAULT_SETTINGS.kidDictation,
    rewardKind: input.rewardKind === "robux" ? "robux" : "money",
    currency:
      typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency) ? input.currency : DEFAULT_SETTINGS.currency,
    maxRewardPerQuestionMinor: clampInt(input.maxRewardPerQuestionMinor, DEFAULT_SETTINGS.maxRewardPerQuestionMinor, 0, 100_000),
    dailyEarnLimitMinor: clampInt(input.dailyEarnLimitMinor, DEFAULT_SETTINGS.dailyEarnLimitMinor, 0, 10_000_000),
    weeklyEarnLimitMinor: clampInt(input.weeklyEarnLimitMinor, DEFAULT_SETTINGS.weeklyEarnLimitMinor, 0, 10_000_000),
    earnScheduleEnabled:
      typeof input.earnScheduleEnabled === "boolean" ? input.earnScheduleEnabled : DEFAULT_SETTINGS.earnScheduleEnabled,
    earnDays: Array.isArray(input.earnDays)
      ? [...new Set(input.earnDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [...DEFAULT_SETTINGS.earnDays],
    earnStartTime: validHm(input.earnStartTime, DEFAULT_SETTINGS.earnStartTime),
    earnEndTime: validHm(input.earnEndTime, DEFAULT_SETTINGS.earnEndTime),
    timerEasySeconds: clampInt(input.timerEasySeconds, DEFAULT_SETTINGS.timerEasySeconds, 30, 600),
    timerMediumSeconds: clampInt(input.timerMediumSeconds, DEFAULT_SETTINGS.timerMediumSeconds, 30, 600),
    timerHardSeconds: clampInt(input.timerHardSeconds, DEFAULT_SETTINGS.timerHardSeconds, 30, 600),
  };
}

export function isDateFormat(value: unknown): value is DateFormat {
  return value === "auto" || value === "dmy" || value === "mdy" || value === "ymd";
}

export function isTimeFormat(value: unknown): value is TimeFormat {
  return value === "auto" || value === "12" || value === "24";
}

/** True when the browser/server understands the IANA zone (empty means “device default”). */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Common fallback list, used when `Intl.supportedValuesOf` is not available. */
const FALLBACK_TIME_ZONES = [
  "UTC",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Pacific/Auckland",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Jakarta",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Istanbul",
  "Africa/Cairo",
  "Africa/Lagos",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
];

/** Every IANA time zone the runtime knows about, with a small safe fallback. */
export function timeZoneOptions(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (supported && supported.length > 0) return supported;
  } catch {
    /* fall through to the short list */
  }
  return FALLBACK_TIME_ZONES;
}

/** How a device's own zone is described in the settings list. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type StampParts = { day: string; month: string; year: string; hour: string; minute: string; second: string };

function partsInZone(ts: number, timeZone: string): StampParts {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  if (timeZone) options.timeZone = timeZone;
  let formatted: Intl.DateTimeFormat;
  try {
    formatted = new Intl.DateTimeFormat("en-GB", options);
  } catch {
    formatted = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: undefined });
  }
  const found: Record<string, string> = {};
  for (const part of formatted.formatToParts(new Date(ts))) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  return {
    day: (found.day ?? "01").padStart(2, "0"),
    month: (found.month ?? "01").padStart(2, "0"),
    // “24” shows up at midnight in some engines.
    year: found.year ?? String(new Date(ts).getUTCFullYear()),
    hour: (found.hour === "24" ? "00" : (found.hour ?? "00")).padStart(2, "0"),
    minute: (found.minute ?? "00").padStart(2, "0"),
    second: (found.second ?? "00").padStart(2, "0"),
  };
}

function timeZoneLabel(settings: FamilySettings): string {
  const zone = settings.timeZone || deviceTimeZone();
  return zone === "UTC" ? "UTC" : zone;
}

/**
 * A log/report stamp: always unambiguous and always in the family's time zone,
 * for example `14/10/2026 18:04:11 (Australia/Sydney)`.
 */
export function formatStamp(ts: number, settings?: Partial<FamilySettings> | null, options?: { seconds?: boolean; zone?: boolean }): string {
  const resolved = resolveSettings(settings);
  const parts = partsInZone(ts, resolved.timeZone);
  const { date, time } = assemble(resolved, parts, options?.seconds !== false);
  return options?.zone === false ? `${date} ${time}` : `${date} ${time} (${timeZoneLabel(resolved)})`;
}

export function formatDate(ts: number, settings?: Partial<FamilySettings> | null): string {
  const resolved = resolveSettings(settings);
  return assemble(resolved, partsInZone(ts, resolved.timeZone), false).date;
}

export function formatTime(ts: number, settings?: Partial<FamilySettings> | null, withSeconds = false): string {
  const resolved = resolveSettings(settings);
  return assemble(resolved, partsInZone(ts, resolved.timeZone), withSeconds).time;
}

function assemble(settings: FamilySettings, parts: StampParts, withSeconds: boolean): { date: string; time: string } {
  const info = localeInfo(settings.locale);
  let date: string;
  switch (settings.dateFormat) {
    case "dmy":
      date = `${parts.day}/${parts.month}/${parts.year}`;
      break;
    case "mdy":
      date = `${parts.month}/${parts.day}/${parts.year}`;
      break;
    case "ymd":
      date = `${parts.year}-${parts.month}-${parts.day}`;
      break;
    default: {
      // “auto” follows the master language, but never loses the year.
      try {
        const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
        if (settings.timeZone) options.timeZone = settings.timeZone;
        date = new Intl.DateTimeFormat(info.intl, options).format(new Date(parts.year + "-" + parts.month + "-" + parts.day + "T12:00:00Z"));
        if (date.includes("–") || date.includes("١٤") || /[\u0660-\u0669\u06F0-\u06F9]/.test(date)) {
          // Non-ASCII digits (Arabic/Urdu/Chinese calendars) are hard to scan in a log.
          date = `${parts.day}/${parts.month}/${parts.year}`;
        }
        if (!/\d/.test(date) || !date.includes(parts.year) || date === "Invalid Date") {
          date = `${parts.day}/${parts.month}/${parts.year}`;
        }
      } catch {
        date = `${parts.day}/${parts.month}/${parts.year}`;
      }
    }
  }

  const use12 = settings.timeFormat === "12" || (settings.timeFormat === "auto" && info.code === "en");
  let time: string;
  if (use12) {
    const hour = Number(parts.hour);
    const suffix = hour < 12 ? "AM" : "PM";
    const shown = hour % 12 === 0 ? 12 : hour % 12;
    time = withSeconds
      ? `${shown}:${parts.minute}:${parts.second} ${suffix}`
      : `${shown}:${parts.minute} ${suffix}`;
  } else {
    time = withSeconds ? `${parts.hour}:${parts.minute}:${parts.second}` : `${parts.hour}:${parts.minute}`;
  }
  return { date, time };
}

/** “3 min ago” in the master language. */
export function formatTimeAgo(ts: number, settings?: Partial<FamilySettings> | null, now = Date.now()): string {
  const resolved = resolveSettings(settings);
  const seconds = Math.max(1, Math.round((now - ts) / 1000));
  const info = localeInfo(resolved.locale);
  const [value, unit] =
    seconds < 45
      ? [seconds, "second"]
      : seconds < 3600
        ? [Math.round(seconds / 60), "minute"]
        : seconds < 86_400
          ? [Math.round(seconds / 3600), "hour"]
          : [Math.round(seconds / 86_400), "day"];
  try {
    const rtf = new Intl.RelativeTimeFormat(info.intl, { numeric: "auto" });
    return rtf.format(-value, unit as Intl.RelativeTimeFormatUnit);
  } catch {
    return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
  }
}

/** Day heading used to group the behavioural log, for example “Tuesday, 14 October 2026”. */
export function formatDayHeading(ts: number, settings?: Partial<FamilySettings> | null): string {
  const resolved = resolveSettings(settings);
  const info = localeInfo(resolved.locale);
  const options: Intl.DateTimeFormatOptions = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  if (resolved.timeZone) options.timeZone = resolved.timeZone;
  try {
    return new Intl.DateTimeFormat(info.intl, options).format(new Date(ts));
  } catch {
    return formatDate(ts, resolved);
  }
}

/** Milliseconds since the start of the day in the family's time zone. */
export function dayKey(ts: number, settings?: Partial<FamilySettings> | null): string {
  const resolved = resolveSettings(settings);
  const parts = partsInZone(ts, resolved.timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
