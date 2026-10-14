import type { NextRequest } from "next/server";
import { error, json, num, readBody, route, str } from "@/lib/server/http";
import { parentAuth } from "@/lib/server/session";
import { resolveScreenTime } from "@/lib/server/service";
import { store } from "@/lib/server/store";
import { isId, kidView } from "@/lib/server/views";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Parent decision on screen time: approve, decline, or grant bonus minutes. */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);
  const { id } = await ctx.params;
  if (!isId(id)) return error("Unknown child.", 404);

  const body = await readBody(req);
  const action = str(body.action);
  if (action !== "approve" && action !== "decline" && action !== "grant") {
    return error("Choose approve, decline or grant.");
  }

  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === id && k.parentId === auth.parent.id);
    if (!kid) return { ok: false as const };
    const minutes = resolveScreenTime(doc, kid, action, num(body.minutes, 0));
    return { ok: true as const, minutes, kid };
  });

  if (!outcome.ok) return error("That child is not on this account.", 404);
  const doc = await store.read();
  const fresh = doc.kids.find((k) => k.id === id);
  return json({ minutes: outcome.minutes, kid: fresh ? kidView(doc, fresh) : null });
});
