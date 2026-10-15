// Rewards: real money (in the family's chosen currency) or Robux, earned for
// answering questions — not big abstract points.
//
// Amounts are always stored as integers in the currency's smallest unit
// (cents for AUD/USD/…, whole Robux for Robux), so A$0.50 is stored as 50 and
// never as a floating-point 0.499999. Formatting happens only at display time.

import type { Question } from "./quiz-data";
import type { FamilySettings } from "./types";

export type RewardKind = "money" | "robux";
export type Difficulty = "easy" | "medium" | "hard";

export type CurrencyInfo = { code: string; label: string; symbol: string };

/** Local currencies a parent can pick in Master settings. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "AUD", label: "Australian dollar", symbol: "A$" },
  { code: "NZD", label: "New Zealand dollar", symbol: "NZ$" },
  { code: "USD", label: "US dollar", symbol: "US$" },
  { code: "GBP", label: "British pound", symbol: "£" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "CAD", label: "Canadian dollar", symbol: "C$" },
  { code: "SGD", label: "Singapore dollar", symbol: "S$" },
  { code: "AED", label: "UAE dirham", symbol: "د.إ" },
  { code: "INR", label: "Indian rupee", symbol: "₹" },
  { code: "PKR", label: "Pakistani rupee", symbol: "₨" },
];

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && CURRENCIES.some((c) => c.code === value);
}

export function isRewardKind(value: unknown): value is RewardKind {
  return value === "money" || value === "robux";
}

/** Formats a stored minor-unit amount, e.g. 50 → “A$0.50”, or 50 → “50 Robux”. */
export function formatReward(amountMinor: number, kind: RewardKind, currency: string): string {
  const amount = Math.max(0, Math.round(amountMinor));
  if (kind === "robux") return `${amount} Robux`;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
}

/**
 * How much of the maximum reward a score earns. A perfect answer earns the
 * full amount the parent set (50c by default); a 90%+ near miss earns 80%
 * (40c of 50c); closer-but-not-close earns less, and under 50% earns nothing.
 */
export function rewardForScore(scorePercent: number, maxRewardMinor: number): number {
  const score = Math.max(0, Math.min(100, scorePercent));
  const max = Math.max(0, Math.round(maxRewardMinor));
  if (score >= 100) return max;
  if (score >= 90) return Math.round(max * 0.8);
  if (score >= 75) return Math.round(max * 0.5);
  if (score >= 50) return Math.round(max * 0.25);
  return 0;
}

/** Question difficulty drives the per-question timer. */
export function difficultyForQuestion(question: Pick<Question, "level" | "track">): Difficulty {
  if (question.track === "early" || question.level === 1) return "easy";
  if (question.level === 2) return "medium";
  return "hard";
}

/** Seconds allowed for a question of this difficulty, from Master settings (never over 10 minutes). */
export function timeLimitSeconds(settings: FamilySettings, difficulty: Difficulty): number {
  const raw =
    difficulty === "easy" ? settings.timerEasySeconds : difficulty === "medium" ? settings.timerMediumSeconds : settings.timerHardSeconds;
  return Math.max(30, Math.min(600, Math.round(raw) || 120));
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Weekday (0=Sunday … 6=Saturday) and HH:mm wall-clock in the family's time zone. */
function zonedWeekdayAndTime(ts: number, timeZone: string): { weekday: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      ...(timeZone ? { timeZone } : {}),
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ts));
    const found: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") found[p.type] = p.value;
    const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(found.weekday ?? "Sun");
    const hour = (found.hour === "24" ? 0 : Number(found.hour)) || 0;
    return { weekday: Math.max(0, dayIndex), minutes: hour * 60 + (Number(found.minute) || 0) };
  } catch {
    const d = new Date(ts);
    return { weekday: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}

function parseHm(value: string): number {
  const [h, m] = value.split(":").map((n) => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** True when earning is allowed right now under the parent's weekly schedule. */
export function earningAllowedAt(settings: FamilySettings, ts = Date.now()): boolean {
  if (!settings.earnScheduleEnabled) return true;
  const { weekday, minutes } = zonedWeekdayAndTime(ts, settings.timeZone);
  if (!settings.earnDays.includes(weekday)) return false;
  const start = parseHm(settings.earnStartTime);
  const end = parseHm(settings.earnEndTime);
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
