import type { NextRequest } from "next/server";
import { json, route } from "@/lib/server/http";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

/**
 * Lets the sign-in screens decide whether to offer “Sign in with fingerprint”.
 * It only reports how many fingerprints are set up — never who they belong to.
 */
export const GET = route(async (req: NextRequest) => {
  void req;
  const doc = await store.read();
  const now = Date.now();
  const live = doc.passkeys;
  return json({
    parent: live.filter((p) => p.kidId === null).length,
    kid: live.filter((p) => p.kidId !== null).length,
    hasAny: live.length > 0,
    checkedAt: now,
  });
});
