import type { NextRequest } from "next/server";
import { COOKIES, cookieOptions, newToken, normaliseEmail, tokenHash, verifySecret } from "@/lib/server/auth";
import { PARENT_SESSION_DAYS } from "@/lib/server/constants";
import { error, json, readBody, str } from "@/lib/server/http";
import { sessionExpiry, store, trimSessions } from "@/lib/server/store";
import { parentView } from "@/lib/server/views";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const email = normaliseEmail(str(body.email));
  const password = str(body.password);

  if (!email || !password) return error("Enter your email and password.");

  const token = newToken();
  const outcome = await store.mutate((doc) => {
    trimSessions(doc);
    const parent = doc.parents.find((p) => p.email === email);
    if (!parent || !verifySecret(password, parent.passwordHash)) return { ok: false as const, parent: null };
    doc.sessions.push({
      tokenHash: tokenHash(token),
      parentId: parent.id,
      createdAt: Date.now(),
      expiresAt: sessionExpiry(),
    });
    return { ok: true as const, parent };
  });

  if (!outcome.ok || !outcome.parent) return error("That email and password combination was not found.", 401);

  const res = json({ parent: parentView(outcome.parent) });
  res.cookies.set(COOKIES.parent, token, cookieOptions(PARENT_SESSION_DAYS * 24 * 60 * 60));
  return res;
}
