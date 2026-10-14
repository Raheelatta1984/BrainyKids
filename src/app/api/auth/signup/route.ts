import type { NextRequest } from "next/server";
import {
  COOKIES,
  cookieOptions,
  hashSecret,
  isValidEmail,
  newToken,
  normaliseEmail,
  tokenHash,
} from "@/lib/server/auth";
import { PARENT_SESSION_DAYS } from "@/lib/server/constants";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { formatRecoveryCode, isValidPassword, newRecoveryCode, PASSWORD_MIN_LENGTH } from "@/lib/server/recovery";
import { newId, sessionExpiry, store, trimSessions, type ParentRecord } from "@/lib/server/store";
import { parentView } from "@/lib/server/views";

export const runtime = "nodejs";

export const POST = route(async (req: NextRequest) => {
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
    if (doc.parents.some((p) => p.email === email)) return { taken: true, parent: null };
    const parent: ParentRecord = {
      id: newId(),
      name,
      email,
      passwordHash: hashSecret(password),
      recoveryHash: hashSecret(recoveryCode),
      recoveryCreatedAt: Date.now(),
      createdAt: Date.now(),
    };
    doc.parents.push(parent);
    doc.sessions.push({
      tokenHash: tokenHash(token),
      parentId: parent.id,
      createdAt: Date.now(),
      expiresAt: sessionExpiry(),
    });
    trimSessions(doc);
    return { taken: false, parent };
  });

  if (result.taken || !result.parent) {
    return error("An account with that email already exists. Try signing in instead.", 409);
  }

  const res = json({ parent: parentView(result.parent), recoveryCode: formatRecoveryCode(recoveryCode) });
  res.cookies.set(COOKIES.parent, token, cookieOptions(PARENT_SESSION_DAYS * 24 * 60 * 60));
  return res;
});
