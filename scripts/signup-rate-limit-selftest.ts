// Exercises the signup-abuse controls without touching the live store/database.
// Run it with `npm run signup-selftest`.

import {
  consumeSignupAttempt,
  recordSignupCreation,
  SIGNUP_ACCOUNT_LIMIT,
  SIGNUP_ACCOUNT_WINDOW_MS,
  SIGNUP_ATTEMPT_LIMIT,
  SIGNUP_ATTEMPT_WINDOW_MS,
  signupClientKey,
} from "../src/lib/server/signup-rate-limit";
import { emptyDoc, normaliseDoc, type DbDoc } from "../src/lib/server/store";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ✓ ${name}`);
    return;
  }
  failures += 1;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

const base = 1_800_000_000_000;

console.log("\nSignup attempts: bounded burst window");
{
  const doc = emptyDoc();
  const key = "test-client-one";
  const accepted = Array.from({ length: SIGNUP_ATTEMPT_LIMIT }, (_, index) =>
    consumeSignupAttempt(doc, key, base + index * 1_000).allowed,
  );
  check(`${SIGNUP_ATTEMPT_LIMIT} requests are allowed inside the window`, accepted.every(Boolean));

  const blocked = consumeSignupAttempt(doc, key, base + SIGNUP_ATTEMPT_LIMIT * 1_000);
  check("the next request is blocked with an attempts reason", !blocked.allowed && blocked.reason === "attempts");
  check("blocked requests get a positive Retry-After", !blocked.allowed && blocked.retryAfterSeconds > 0);

  const afterWindow = consumeSignupAttempt(doc, key, base + SIGNUP_ATTEMPT_WINDOW_MS);
  check("the client can try again when the oldest attempt expires", afterWindow.allowed);
  check("another client has an independent attempt bucket", consumeSignupAttempt(doc, "test-client-two", base).allowed);
}

console.log("\nNew accounts: rolling daily cap counts only successful creations");
{
  const doc = emptyDoc();
  const key = "test-client-daily";
  for (let index = 0; index < SIGNUP_ACCOUNT_LIMIT; index++) {
    const at = base + index * 1_000;
    check(`account ${index + 1} request is allowed`, consumeSignupAttempt(doc, key, at).allowed);
    check(`account ${index + 1} can be recorded`, recordSignupCreation(doc, key, at).allowed);
  }

  const nextAt = base + SIGNUP_ACCOUNT_LIMIT * 1_000;
  check("ordinary attempt budget remains separate from the daily creation cap", consumeSignupAttempt(doc, key, nextAt).allowed);
  const dailyLimit = recordSignupCreation(doc, key, nextAt);
  check("a fourth account in 24 hours is blocked", !dailyLimit.allowed && dailyLimit.reason === "accounts");
  check("daily-cap response includes a retry delay", !dailyLimit.allowed && dailyLimit.retryAfterSeconds > 0);

  const afterOldestExpires = recordSignupCreation(doc, key, base + SIGNUP_ACCOUNT_WINDOW_MS);
  check("one daily slot reopens when the oldest account creation expires", afterOldestExpires.allowed);
}

console.log("\nClient identification: stable, pseudonymous and proxy-header aware");
{
  const first = new Request("https://brainykids.example/api/auth/signup", {
    headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" },
  });
  const sameAddress = new Request("https://brainykids.example/api/auth/signup", {
    headers: { "x-forwarded-for": "203.0.113.8" },
  });
  const otherAddress = new Request("https://brainykids.example/api/auth/signup", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  const realIpFallback = new Request("https://brainykids.example/api/auth/signup", {
    headers: { "x-forwarded-for": "not-an-ip", "x-real-ip": "203.0.113.8" },
  });
  const firstKey = signupClientKey(first);
  check("the same client address maps to the same key", firstKey === signupClientKey(sameAddress));
  check("different addresses get separate keys", firstKey !== signupClientKey(otherAddress));
  check("X-Real-IP is used when X-Forwarded-For is invalid", firstKey === signupClientKey(realIpFallback));
  check("the persisted key does not contain the raw address", !firstKey.includes("203.0.113.8"));
}

console.log("\nLegacy documents: signup counters initialise safely");
{
  const legacy = emptyDoc() as unknown as Record<string, unknown>;
  delete legacy.signupRateLimits;
  const upgraded = normaliseDoc(legacy as unknown as DbDoc);
  check("older stored documents receive an empty signup-rate-limit list", Array.isArray(upgraded.signupRateLimits) && upgraded.signupRateLimits.length === 0);
}

console.log(
  failures === 0
    ? "\nAll signup rate-limit checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
