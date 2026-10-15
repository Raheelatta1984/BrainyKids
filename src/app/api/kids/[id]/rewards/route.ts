import type { NextRequest } from "next/server";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { parentAuth } from "@/lib/server/session";
import { resolveRealisation } from "@/lib/server/service";
import { store } from "@/lib/server/store";
import { isId, kidView } from "@/lib/server/views";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Parent decision on a realise request. Approving pays the child (outside the
 * app) and resets the wallet to zero; declining keeps the balance. Both are
 * written to the child's transaction log.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);
  const { id } = await ctx.params;
  if (!isId(id)) return error("Unknown child.", 404);

  const body = await readBody(req);
  const action = str(body.action);
  if (action !== "approve" && action !== "decline") return error("Choose approve or decline.");

  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === id && k.parentId === auth.parent.id);
    if (!kid) return { ok: false as const, amount: 0 };
    return { ok: true as const, amount: resolveRealisation(doc, kid, action) };
  });

  if (!outcome.ok) return error("That child is not on this account.", 404);
  const doc = await store.read();
  const fresh = doc.kids.find((k) => k.id === id);
  return json({ amountMinor: outcome.amount, kid: fresh ? kidView(doc, fresh) : null });
});
