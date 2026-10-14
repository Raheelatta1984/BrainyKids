import type { NextRequest } from "next/server";
import { error, json, route } from "@/lib/server/http";
import { parentAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Forgets a fingerprint: the parent's own, or one of their children's. */
export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);
  const { id } = await ctx.params;

  const removed = await store.mutate((doc) => {
    const passkey = doc.passkeys.find((p) => p.id === id);
    if (!passkey) return false;
    if (passkey.parentId !== auth.parent.id && !doc.kids.some((k) => k.id === passkey.kidId && k.parentId === auth.parent.id)) {
      return false;
    }
    doc.passkeys = doc.passkeys.filter((p) => p.id !== id);
    return true;
  });

  if (!removed) return error("That fingerprint is not on this account.", 404);
  return json({ ok: true });
});
