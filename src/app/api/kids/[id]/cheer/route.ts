import type { NextRequest } from "next/server";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { parentAuth } from "@/lib/server/session";
import { sendCheer } from "@/lib/server/service";
import { store } from "@/lib/server/store";
import { isId } from "@/lib/server/views";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Send a short encouraging message that pops up on the kid's device straight away. */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);
  const { id } = await ctx.params;
  if (!isId(id)) return error("Unknown child.", 404);

  const body = await readBody(req);
  const message = str(body.message).trim().slice(0, 120);
  if (!message) return error("Write a short message first.");

  const sent = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === id && k.parentId === auth.parent.id);
    if (!kid) return false;
    sendCheer(doc, kid, message);
    return true;
  });

  if (!sent) return error("That child is not on this account.", 404);
  return json({ ok: true, message });
});
