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

export type CurrencyInfo = {
  code: string;
  label: string;
  symbol: string;
  /** Digits after the decimal point in this currency (JPY has 0, KWD has 3, most have 2). */
  decimals: number;
};

/**
 * Currencies a parent can pick: the ones families ask for first, then every
 * other currency in the world.
 *
 * The full list comes from the runtime's own ISO 4217 catalogue
 * (`Intl.supportedValuesOf("currency")`), with a static fallback for older
 * browsers, so “all other currency in the world” keeps up with the standard
 * instead of a hand-written list going stale.
 *
 * Cryptocurrency is deliberately never offered. BrainyKids pays children in
 * money a family can actually hand over, or in Robux — not in a coin whose
 * price moves by the minute — so a crypto code is refused even if it is typed
 * straight into the API.
 */
const COMMON_CODES = [
  "AUD",
  "NZD",
  "USD",
  "CAD",
  "GBP",
  "EUR",
  "CHF",
  "JPY",
  "CNY",
  "HKD",
  "SGD",
  "INR",
  "PKR",
  "BDT",
  "LKR",
  "NPR",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
  "ZAR",
  "NGN",
  "KES",
  "EGP",
  "TRY",
  "BRL",
  "MXN",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "ILS",
  "KRW",
  "THB",
  "MYR",
  "IDR",
  "PHP",
  "VND",
  "TWD",
];

/** ISO 4217 codes that are units of account, not money a child can hold. */
const NOT_MONEY_CODES = new Set([
  "XAU",
  "XAG",
  "XPT",
  "XPD",
  "XBA",
  "XBB",
  "XBC",
  "XBD",
  "XDR",
  "XSU",
  "XTS",
  "XUA",
  "XXX",
  "XFO",
  "XFU",
]);

/**
 * Cryptocurrencies, refused by name. The ISO catalogue above contains none of
 * them; this list is what stops one being stored anyway (an old setting, a hand
 * written API call), because “no crypto” has to hold on the server too.
 */
export const CRYPTO_CODES = new Set([
  "BTC", "ETH", "USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "PYUSD", "USDE", "USDS", "DAI", "GUSD", "PAXG",
  "WBTC", "WETH", "STETH", "RETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "LTC", "DOT", "TRX", "AVAX", "SHIB",
  "MATIC", "POL", "LINK", "ATOM", "XLM", "XMR", "BCH", "ETC", "FIL", "NEAR", "APT", "ARB", "OP", "HBAR", "ALGO",
  "VET", "ICP", "FTM", "SAND", "MANA", "AXS", "GALA", "EGLD", "THETA", "XTZ", "EOS", "AAVE", "UNI", "MKR", "CRV",
  "SNX", "COMP", "SUSHI", "YFI", "BAT", "ENJ", "CHZ", "ZEC", "DASH", "NEO", "QTUM", "IOTA", "ONE", "ROSE", "KSM",
  "GLMR", "CELO", "KAVA", "RUNE", "CAKE", "WAVES", "TON", "OKB", "KAS", "WIF", "BONK", "PEPE", "FLOKI", "FET",
  "RNDR", "IMX", "STX", "INJ", "TIA", "SUI", "SEI", "BLUR", "JUP", "PYTH", "DYDX", "GRT", "LDO", "ENS", "XDC",
  "XRD", "FLOW", "CSPR", "IOTX", "MINA", "KDA", "ASTR", "CFX", "KLAY", "MNT", "ZIL", "ICX", "ZEN", "XVG", "DGB",
  "RVN", "NANO", "WAXP", "CRO", "NEXO",
]);

/** Written out so a browser without `Intl.supportedValuesOf` still has every currency. */
const ISO_FALLBACK =
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG ZWL";

/** Currencies whose smallest unit is not 1/100 (the rest of the world uses cents). */
const DECIMALS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0,
  XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
};

let isoCache: string[] | null = null;

function isoCodes(): string[] {
  if (isoCache) return isoCache;
  let codes: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf?.("currency");
    if (supported && supported.length > 0) codes = supported;
  } catch {
    /* an older runtime: the static list below is the whole catalogue */
  }
  if (codes.length === 0) codes = ISO_FALLBACK.split(" ");
  isoCache = [...new Set(codes.map((code) => code.toUpperCase()))]
    .filter((code) => /^[A-Z]{3}$/.test(code) && !NOT_MONEY_CODES.has(code) && !CRYPTO_CODES.has(code))
    .sort();
  return isoCache;
}

function labelFor(code: string): string {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "currency" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

function symbolFor(code: string): string {
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    const symbol = parts.find((part) => part.type === "currency")?.value;
    if (symbol && symbol !== code) return symbol;
  } catch {
    /* an unknown-to-the-runtime code falls back to the code itself */
  }
  return code;
}

const infoCache = new Map<string, CurrencyInfo>();

/** Everything known about one currency code, ready to display. */
export function currencyInfo(code: string): CurrencyInfo {
  const upper = (code || "AUD").toUpperCase();
  const cached = infoCache.get(upper);
  if (cached) return cached;
  const info: CurrencyInfo = {
    code: upper,
    label: labelFor(upper),
    symbol: symbolFor(upper),
    decimals: DECIMALS[upper] ?? 2,
  };
  infoCache.set(upper, info);
  return info;
}

function optionsFor(codes: string[]): CurrencyInfo[] {
  return codes.map((code) => currencyInfo(code));
}

/** The currencies families reach for most often, shown first in the picker. */
export function commonCurrencyOptions(): CurrencyInfo[] {
  const known = new Set(isoCodes());
  return optionsFor(COMMON_CODES.filter((code) => known.has(code)));
}

/** Every other currency in the world (ISO 4217). Never a cryptocurrency. */
export function otherCurrencyOptions(): CurrencyInfo[] {
  const common = new Set(COMMON_CODES);
  return optionsFor(isoCodes().filter((code) => !common.has(code)));
}

/** Every currency, common ones first — for validation, tests and search. */
export function currencyOptions(): CurrencyInfo[] {
  return [...commonCurrencyOptions(), ...otherCurrencyOptions()];
}

export function isKnownCurrency(code: string): boolean {
  if (!/^[A-Za-z]{3}$/.test(code)) return false;
  const upper = code.toUpperCase();
  if (CRYPTO_CODES.has(upper) || NOT_MONEY_CODES.has(upper)) return false;
  return isoCodes().includes(upper);
}

/** True for a cryptocurrency (or a metal/unit-of-account code) — never allowed. */
export function isCryptoCode(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const upper = value.trim().toUpperCase();
  return CRYPTO_CODES.has(upper) || NOT_MONEY_CODES.has(upper);
}

/** The API's gate: a real ISO currency, and never a cryptocurrency. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && isKnownCurrency(value.trim());
}

/**
 * Reading a stored setting: keep any well-formed currency code the runtime did
 * not list, but never keep a cryptocurrency. This is the lenient half of
 * `isCurrencyCode`, so a currency chosen on one device is not silently reset to
 * the default by another device with an older browser.
 */
export function sanitiseCurrency(value: unknown, fallback = "AUD"): string {
  if (typeof value !== "string") return fallback;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || isCryptoCode(code)) return fallback;
  return code;
}

export function isRewardKind(value: unknown): value is RewardKind {
  return value === "money" || value === "robux";
}

/** How a reward kind reads on screen: real money in the family's currency, or Robux. */
export function rewardKindLabel(kind: RewardKind, currency: string): string {
  return kind === "robux" ? "Robux" : currencyInfo(currency).code;
}

/**
 * Formats a stored amount in the currency's smallest unit.
 * 50 → “A$0.50”, 50 → “¥50” (Japan has no cents), 50 → “50 Robux”.
 */
export function formatReward(amountMinor: number, kind: RewardKind, currency: string): string {
  const amount = Math.max(0, Math.round(amountMinor));
  if (kind === "robux") return `${amount} Robux`;
  const info = currencyInfo(currency);
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: info.code,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(amount / 10 ** info.decimals);
  } catch {
    return `${info.code} ${(amount / 10 ** info.decimals).toFixed(info.decimals)}`;
  }
}

/** “A$0.50” for 50 cents: one amount shown in the currency a parent just chose. */
export function currencyExample(code: string): string {
  return formatReward(50, "money", code);
}

/**
 * What a correct answer earns: the flat per-question amount the parent set
 * (5 cents / 5 Robux by default, i.e. A$0.05). Every correct answer earns the
 * same amount, so a child always knows what one right answer is worth.
 */
export function correctAnswerRewardMinor(maxRewardMinor: number): number {
  return Math.max(0, Math.round(maxRewardMinor));
}

/**
 * What a wrong (or timed-out) answer takes off the wallet: 50% of the
 * per-question amount. 5 cents → 2 cents. Half a cent cannot be stored, so the
 * amount rounds down, which keeps the penalty small and the child motivated.
 */
export function wrongAnswerDeductionMinor(maxRewardMinor: number): number {
  return Math.floor(Math.max(0, Math.round(maxRewardMinor)) * 0.5);
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
