import type { NextRequest } from "next/server";
import { COOKIES, cookieOptions, hashSecret, newToken, normaliseEmail, tokenHash, verifySecret } from "@/lib/server/auth";
import { PARENT_SESSION_DAYS } from "@/lib/server/constants";
import { error, json, readBody, route, str } from "@/lib/server/http";
import {
  formatRecoveryCode,
  isValidPassword,
  newRecoveryCode,
  normaliseRecoveryCode,
  PASSWORD_MIN_LENGTH,
} from "@/lib/server/recovery";
import { MAX_RECOVERY_ATTEMPTS, RECOVERY_LOCK_MS } from "@/lib/server/recovery";
import { sessionExpiry, store, trimSessions } from "@/lib/server/store";
import { parentView } from "@/lib/server/views";

export const runtime = "nodejs";

const MISMATCH = "That email and recovery code did not match. Check both and try again.";

/**
 * “Forgot password?” — sets a new parent password using the recovery code.
 *
 * The code that was used is rotated immediately, so the message shown to the
 * parent includes a fresh one to save. Nobody learns whether an email has an
 * account: a wrong email and a wrong code give exactly the same answer, and
 * repeated failures lock the form for a while.
 */
export const POST = route(async (req: NextRequest) => {
  const body = await readBody(req);
  const email = normaliseEmail(str(body.email));
  const code = normaliseRecoveryCode(str(body.code));
  const password = str(body.password);

  if (!email || !code) return error("Enter the email address and the recovery code.");
  if (!isValidPassword(password)) return error(`Choose a new password with at least ${PASSWORD_MIN_LENGTH} characters.`);

  const token = newToken();
  const nextCode = newRecoveryCode();
  const now = Date.now();

  const outcome = await store.mutate((doc) => {
    trimSessions(doc, now);
    const parent = doc.parents.find((p) => p.email === email);
    if (!parent || !parent.recoveryHash) return { ok: false as const, parent: null, locked: false };
    if (parent.recoveryLockedUntil && parent.recoveryLockedUntil > now) {
      return { ok: false as const, parent: null, locked: true };
    }

    if (!verifySecret(code, parent.recoveryHash)) {
      parent.recoveryFailures = (parent.recoveryFailures ?? 0) + 1;
      if (parent.recoveryFailures >= MAX_RECOVERY_ATTEMPTS) {
        parent.recoveryLockedUntil = now + RECOVERY_LOCK_MS;
        parent.recoveryFailures = 0;
      }
      return { ok: false as const, parent: null, locked: false };
    }

    parent.passwordHash = hashSecret(password);
    parent.recoveryHash = hashSecret(nextCode);
    parent.recoveryCreatedAt = now;
    parent.recoveryFailures = 0;
    parent.recoveryLockedUntil = undefined;
    // Anyone who was signed in with the old password is signed out; this device
    // gets a session of its own below.
    doc.sessions = doc.sessions.filter((s) => s.parentId !== parent.id);
    doc.sessions.push({
      tokenHash: tokenHash(token),
      parentId: parent.id,
      createdAt: now,
      expiresAt: sessionExpiry(now),
    });
    return { ok: true as const, parent, locked: false };
  });

  if (!outcome.ok || !outcome.parent) {
    return error(
      outcome.locked
        ? "Too many recovery attempts. Please wait 15 minutes and try again."
        : MISMATCH,
      401,
    );
  }

  const res = json({ parent: parentView(outcome.parent), recoveryCode: formatRecoveryCode(nextCode) });
  res.cookies.set(COOKIES.parent, token, cookieOptions(PARENT_SESSION_DAYS * 24 * 60 * 60));
  return res;
});
