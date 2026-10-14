import type { NextRequest } from "next/server";
import { hashSecret } from "@/lib/server/auth";
import { error, json, route } from "@/lib/server/http";
import { formatRecoveryCode, newRecoveryCode } from "@/lib/server/recovery";
import { parentAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

/**
 * Issues a new recovery code for the signed-in parent. The code is returned once
 * and only its hash is stored, so an old code (or a leaked data file) is useless
 * the moment a new one is created.
 */
export const POST = route(async (req: NextRequest) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);

  const recoveryCode = newRecoveryCode();
  const updated = await store.mutate((doc) => {
    const parent = doc.parents.find((p) => p.id === auth.parent.id);
    if (!parent) return null;
    parent.recoveryHash = hashSecret(recoveryCode);
    parent.recoveryCreatedAt = Date.now();
    parent.recoveryFailures = 0;
    parent.recoveryLockedUntil = undefined;
    return parent;
  });

  if (!updated) return error("That account no longer exists.", 404);
  return json({ recoveryCode: formatRecoveryCode(recoveryCode), createdAt: updated.recoveryCreatedAt });
});
