import { isIP } from "node:net";
import { hashForStorage } from "./auth";
import type { DbDoc, SignupRateLimitRecord } from "./store";

/** A burst limit for malformed, duplicate and successful signup requests alike. */
export const SIGNUP_ATTEMPT_LIMIT = 10;
export const SIGNUP_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** A separate cap specifically on newly created accounts from one client address. */
export const SIGNUP_ACCOUNT_LIMIT = 3;
export const SIGNUP_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Bound storage growth if a distributed source sends requests from many addresses. */
export const MAX_TRACKED_SIGNUP_CLIENTS = 10_000;

export type SignupLimitReason = "attempts" | "accounts" | "capacity";
export type SignupLimitDecision =
  | { allowed: true; retryAfterSeconds: 0 }
  | { allowed: false; reason: SignupLimitReason; retryAfterSeconds: number };

const ALLOWED: SignupLimitDecision = { allowed: true, retryAfterSeconds: 0 };

/**
 * Derive a stable, non-reversible storage key for the source address.
 *
 * The app must be behind a trusted proxy that sanitises these headers; do not
 * forward client-supplied X-Forwarded-For values unchanged from an untrusted
 * internet connection.
 */
export function signupClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const address = [forwarded, realIp].find((candidate) => candidate && isIP(candidate))?.toLowerCase() ?? "unknown";
  return hashForStorage("signup-rate-limit", address);
}

function ensureBuckets(doc: DbDoc): SignupRateLimitRecord[] {
  if (!Array.isArray(doc.signupRateLimits)) doc.signupRateLimits = [];
  return doc.signupRateLimits;
}

/** Remove expired/corrupt data before each decision, keeping the JSON document bounded. */
function pruneSignupRateLimits(doc: DbDoc, now: number): SignupRateLimitRecord[] {
  const buckets = ensureBuckets(doc);
  const retained: SignupRateLimitRecord[] = [];

  for (const bucket of buckets) {
    if (!bucket || typeof bucket.key !== "string") continue;
    const attempts = Array.isArray(bucket.attempts)
      ? bucket.attempts.filter((at) => Number.isFinite(at) && at > now - SIGNUP_ATTEMPT_WINDOW_MS)
      : [];
    const signups = Array.isArray(bucket.signups)
      ? bucket.signups.filter((at) => Number.isFinite(at) && at > now - SIGNUP_ACCOUNT_WINDOW_MS)
      : [];
    if (attempts.length === 0 && signups.length === 0) continue;
    retained.push({ key: bucket.key, attempts, signups });
  }

  doc.signupRateLimits = retained;
  return retained;
}

function remainingSeconds(timestamps: number[], windowMs: number, now: number): number {
  const oldest = timestamps.reduce((earliest, at) => Math.min(earliest, at), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(oldest)) return 1;
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

function blocked(
  timestamps: number[],
  limit: number,
  windowMs: number,
  now: number,
  reason: SignupLimitReason,
): SignupLimitDecision | null {
  return timestamps.length >= limit
    ? { allowed: false, reason, retryAfterSeconds: remainingSeconds(timestamps, windowMs, now) }
    : null;
}

function capacityRetryAfter(buckets: SignupRateLimitRecord[], now: number): number {
  let nextExpiry = Number.POSITIVE_INFINITY;
  for (const bucket of buckets) {
    for (const at of bucket.attempts) nextExpiry = Math.min(nextExpiry, at + SIGNUP_ATTEMPT_WINDOW_MS);
    for (const at of bucket.signups) nextExpiry = Math.min(nextExpiry, at + SIGNUP_ACCOUNT_WINDOW_MS);
  }
  return Number.isFinite(nextExpiry) ? Math.max(1, Math.ceil((nextExpiry - now) / 1000)) : 1;
}

/** Count every request (including invalid forms) so repeated bad requests are also throttled. */
export function consumeSignupAttempt(doc: DbDoc, key: string, now = Date.now()): SignupLimitDecision {
  const buckets = pruneSignupRateLimits(doc, now);
  let bucket = buckets.find((candidate) => candidate.key === key);

  if (!bucket) {
    if (buckets.length >= MAX_TRACKED_SIGNUP_CLIENTS) {
      return { allowed: false, reason: "capacity", retryAfterSeconds: capacityRetryAfter(buckets, now) };
    }
    bucket = { key, attempts: [], signups: [] };
    buckets.push(bucket);
  }

  const denial = blocked(bucket.attempts, SIGNUP_ATTEMPT_LIMIT, SIGNUP_ATTEMPT_WINDOW_MS, now, "attempts");
  if (denial) return denial;

  bucket.attempts.push(now);
  return ALLOWED;
}

/**
 * Atomically reserve one of the daily account-creation slots inside the same
 * storage mutation that creates the parent. Successful creations alone count.
 */
export function recordSignupCreation(doc: DbDoc, key: string, now = Date.now()): SignupLimitDecision {
  const buckets = pruneSignupRateLimits(doc, now);
  const bucket = buckets.find((candidate) => candidate.key === key);
  // A missing bucket means the request was not tracked (or storage was full); fail closed.
  if (!bucket) {
    return { allowed: false, reason: "capacity", retryAfterSeconds: capacityRetryAfter(buckets, now) };
  }

  const denial = blocked(bucket.signups, SIGNUP_ACCOUNT_LIMIT, SIGNUP_ACCOUNT_WINDOW_MS, now, "accounts");
  if (denial) return denial;

  bucket.signups.push(now);
  return ALLOWED;
}

export function signupLimitMessage(reason: SignupLimitReason): string {
  if (reason === "attempts") return "Too many sign-up attempts from this network. Please try again later.";
  if (reason === "accounts") return "The sign-up limit for this network has been reached. Please try again later.";
  return "Sign-up is temporarily at capacity. Please try again later.";
}
