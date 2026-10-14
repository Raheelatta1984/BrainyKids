import type { NextRequest } from "next/server";
import { COOKIES, hashSecret, verifySecret } from "@/lib/server/auth";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { formatRecoveryCode, isValidPassword, newRecoveryCode, PASSWORD_MIN_LENGTH } from "@/lib/server/recovery";
import { parentAuth, setParentSessionCookies } from "@/lib/server/session";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

/**
 * Changes the signed-in parent's password, and hands back a brand new recovery
 * code so the old printout or screenshot stops working.
 */
export const POST = route(async (req: NextRequest) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);

  const body = await readBody(req);
  const current = str(body.currentPassword);
  const password = str(body.password);

  if (!verifySecret(current, auth.parent.passwordHash)) {
    return error("That is not the current password.", 403);
  }
  if (!isValidPassword(password)) {
    return error(`Choose a new password with at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  const recoveryCode = newRecoveryCode();
  const updated = await store.mutate((doc) => {
    const parent = doc.parents.find((p) => p.id === auth.parent.id);
    if (!parent) return null;
    parent.passwordHash = hashSecret(password);
    parent.recoveryHash = hashSecret(recoveryCode);
    parent.recoveryCreatedAt = Date.now();
    parent.recoveryFailures = 0;
    parent.recoveryLockedUntil = undefined;
    // Keep the session on this device, drop the others.
    doc.sessions = doc.sessions.filter((s) => s.parentId !== parent.id || s.tokenHash === auth.session.tokenHash);
    return parent;
  });

  if (!updated) return error("That account no longer exists.", 404);
  const res = json({ ok: true, recoveryCode: formatRecoveryCode(recoveryCode) });
  const rawToken = req.cookies.get(COOKIES.parent)?.value;
  if (rawToken) setParentSessionCookies(res, rawToken, updated, auth.session);
  return res;
});
