import type { NextRequest } from "next/server";
import { error, json, route } from "@/lib/server/http";
import { parentAuth } from "@/lib/server/session";
import { unlinkDevice } from "@/lib/server/service";
import { store } from "@/lib/server/store";
import { isId } from "@/lib/server/views";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Signs a kid device out remotely. The device returns to the login screen. */
export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);
  const { id } = await ctx.params;
  if (!isId(id)) return error("Unknown device.", 404);

  const removed = await store.mutate((doc) => {
    const device = doc.devices.find((d) => d.id === id && d.parentId === auth.parent.id);
    if (!device) return false;
    unlinkDevice(doc, device);
    return true;
  });

  if (!removed) return error("That device is not on this account.", 404);
  return json({ ok: true });
});
