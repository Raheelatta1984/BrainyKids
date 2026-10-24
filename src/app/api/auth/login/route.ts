import type { NextRequest } from "next/server";
import { newToken, normaliseEmail, tokenHash, verifySecret } from "@/lib/server/auth";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { protectIdentity } from "@/lib/server/request-protection";
import { setParentSessionCookies } from "@/lib/server/session";
import { sessionExpiry, store, trimSessions, type SessionRecord } from "@/lib/server/store";
import { parentView } from "@/lib/server/views";

export const runtime = "nodejs";

export const POST = route(async (req: NextRequest) => {
  const body = await readBody(req);
  const email = normaliseEmail(str(body.email));
  const password = str(body.password);

  if (!email || !password || email.length > 254 || password.length > 1024) return error("Enter your email and password.");
  await protectIdentity("parent", email);
  const candidate = await store.find("parentEmail", email);
  if (!candidate || !verifySecret(password, candidate.record.passwordHash)) {
    return error("That email and password combination was not found.", 401);
  }
  const verifiedHash = candidate.record.passwordHash;

  const token = newToken();
  const outcome = await store.mutate((doc) => {
    const now = Date.now();
    trimSessions(doc, now);
    const parent = doc.parents.find((p) => p.id === candidate.record.id && p.email === email);
    // Verification is outside the row lock. Re-check the verified hash inside
    // it so a concurrent password reset cannot create an old-password session.
    if (!parent || parent.passwordHash !== verifiedHash) {
      return { ok: false as const, parent: null, session: null };
    }
    const session: SessionRecord = {
      tokenHash: tokenHash(token),
      parentId: parent.id,
      createdAt: now,
      expiresAt: sessionExpiry(now),
    };
    doc.sessions.push(session);
    return { ok: true as const, parent, session };
  });

  if (!outcome.ok || !outcome.parent || !outcome.session) {
    return error("That email and password combination was not found.", 401);
  }

  const res = json({ parent: parentView(outcome.parent) });
  setParentSessionCookies(res, token, outcome.parent, outcome.session);
  return res;
});
