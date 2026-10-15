import type { NextRequest } from "next/server";
import { error, json, num, readBody, route, str } from "@/lib/server/http";
import { MAX_LEVEL } from "@/lib/quiz-logic";
import { deviceAuth } from "@/lib/server/session";
import { openLevel } from "@/lib/server/service";
import { store } from "@/lib/server/store";
import { kidView } from "@/lib/server/views";
import type { Level, LevelAction } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Opens a level for the child signed in on this device.
 *
 * Every level is open, so this is never refused for being “too high”: the child
 * can go back to an unfinished level, skip forward, or come back later.
 *
 *   { "level": 5 }                     — open Level 5 and carry on where they stopped
 *   { "level": 5, "action": "start" }  — the same thing, said plainly
 *   { "level": 5, "action": "restart" } — start Level 5 again from its first question
 *
 * A restart only clears that one level's answers; points, screen time and the
 * wallet are kept, and the parent sees it in the behavioural log.
 */
export const POST = route(async (req: NextRequest) => {
  const auth = await deviceAuth(req);
  if (!auth) return error("This device is not linked to a kid profile.", 401);

  const body = await readBody(req);
  const level = num(body.level, auth.kid.level);
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    return error(`Pick a level between 1 and ${MAX_LEVEL}.`);
  }
  const action: LevelAction = str(body.action) === "restart" ? "restart" : "start";

  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === auth.kid.id);
    if (!kid) return null;
    return openLevel(doc, kid, level as Level, action);
  });

  if (!outcome) return error("That child is no longer on this device.", 404);

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === auth.kid.id);
  return json({ level: outcome, kid: kid ? kidView(doc, kid, Date.now(), "kid") : null });
});
