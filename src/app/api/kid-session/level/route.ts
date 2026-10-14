import type { NextRequest } from "next/server";
import { error, json, num, readBody } from "@/lib/server/http";
import { deviceAuth } from "@/lib/server/session";
import { pushEvent, store } from "@/lib/server/store";
import { kidView } from "@/lib/server/views";
import type { Level } from "@/lib/types";

export const runtime = "nodejs";

/** Remembers which level the child is working through, so the parent dashboard can show it. */
export async function POST(req: NextRequest) {
  const auth = await deviceAuth(req);
  if (!auth) return error("This device is not linked to a kid profile.", 401);

  const body = await readBody(req);
  const level = num(body.level, 0);
  if (level < 1 || level > 3) return error("Unknown level.");

  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === auth.kid.id);
    if (!kid) return { ok: false as const };
    if (level > kid.unlockedLevel) return { ok: false as const };
    kid.level = level as Level;
    pushEvent(doc, {
      type: "kid.updated",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name, level },
    });
    return { ok: true as const };
  });

  if (!outcome.ok) return error("That level is still locked.", 403);

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === auth.kid.id);
  return json({ kid: kid ? kidView(doc, kid) : null });
}
