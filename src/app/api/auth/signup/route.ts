import type { NextRequest } from "next/server";
import {
  hashSecret,
  isValidEmail,
  newToken,
  normaliseEmail,
  tokenHash,
} from "@/lib/server/auth";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { formatRecoveryCode, isValidPassword, newRecoveryCode, PASSWORD_MIN_LENGTH } from "@/lib/server/recovery";
import { setParentSessionCookies } from "@/lib/server/session";
import {
  consumeSignupAttempt,
  recordSignupCreation,
  signupClientKey,
  signupLimitMessage,
  type SignupLimitDecision,
} from "@/lib/server/signup-rate-limit";
import { newId, sessionExpiry, store, trimSessions, type ParentRecord, type SessionRecord } from "@/lib/server/store";
import { parentView } from "@/lib/server/views";

export const runtime = "nodejs";

function signupLimitError(decision: Extract<SignupLimitDecision, { allowed: false }>) {
  return json(
    { error: signupLimitMessage(decision.reason) },
    {
      status: decision.reason === "capacity" ? 503 : 429,
      headers: { "Retry-After": String(decision.retryAfterSeconds) },
    },
  );
}

export const POST = route(async (req: NextRequest) => {
  const clientKey = signupClientKey(req);
  const attemptLimit = await store.mutate((doc) => consumeSignupAttempt(doc, clientKey));
  if (!attemptLimit.allowed) return signupLimitError(attemptLimit);

  const body = await readBody(req);
  const name = str(body.name).trim();
  const email = normaliseEmail(str(body.email));
  const password = str(body.password);

  if (name.length < 2) return error("Please enter the parent's name.");
  if (!isValidEmail(email)) return error("Please enter a valid email address.");
  if (!isValidPassword(password)) return error(`Use a password with at least ${PASSWORD_MIN_LENGTH} characters.`);

  const token = newToken();
  // A code the parent can keep: it is the only way back into the account if the
  // password is forgotten, because BrainyKids does not send email.
  const recoveryCode = newRecoveryCode();
  const result = await store.mutate((doc) => {
    if (doc.parents.some((p) => p.email === email)) {
      return { taken: true, limited: null, parent: null, session: null };
    }

    const now = Date.now();
    const creationLimit = recordSignupCreation(doc, clientKey, now);
    if (!creationLimit.allowed) {
      return { taken: false, limited: creationLimit, parent: null, session: null };
    }

    const parent: ParentRecord = {
      id: newId(),
      name,
      email,
      passwordHash: hashSecret(password),
      recoveryHash: hashSecret(recoveryCode),
      recoveryCreatedAt: now,
      createdAt: now,
    };
    const session: SessionRecord = {
      tokenHash: tokenHash(token),
      parentId: parent.id,
      createdAt: now,
      expiresAt: sessionExpiry(now),
    };
    doc.parents.push(parent);
    doc.sessions.push(session);
    trimSessions(doc, now);
    return { taken: false, limited: null, parent, session };
  });

  if (result.limited) return signupLimitError(result.limited);
  if (result.taken || !result.parent || !result.session) {
    return error("An account with that email already exists. Try signing in instead.", 409);
  }

  const res = json({ parent: parentView(result.parent), recoveryCode: formatRecoveryCode(recoveryCode) });
  setParentSessionCookies(res, token, result.parent, result.session);
  return res;
});
