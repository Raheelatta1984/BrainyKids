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
import { error, json, readBody, str } from "@/lib/server/http";
import { newId, sessionExpiry, store, trimSessions, type ParentRecord } from "@/lib/server/store";
import { parentView } from "@/lib/server/views";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const name = str(body.name).trim();
  const email = normaliseEmail(str(body.email));
  const password = str(body.password);

  if (name.length < 2) return error("Please enter the parent's name.");
  if (!isValidEmail(email)) return error("Please enter a valid email address.");
  if (password.length < 8) return error("Use a password with at least 8 characters.");

  const token = newToken();
  const emailHash = email;
  const result = await store.mutate((doc) => {
    if (doc.parents.some((p) => p.email === emailHash)) return { taken: true, parent: null };
    const parent: ParentRecord = {
      id: newId(),
      name,
      email: emailHash,
      passwordHash: hashSecret(password),
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

  const res = json({ parent: parentView(result.parent) });
  res.cookies.set(COOKIES.parent, token, cookieOptions(PARENT_SESSION_DAYS * 24 * 60 * 60));
  return res;
}
