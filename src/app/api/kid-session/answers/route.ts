import type { NextRequest } from "next/server";
import { error, json, num, readBody, route, str } from "@/lib/server/http";
import { recordAnswer } from "@/lib/server/service";
import { deviceAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { kidView } from "@/lib/server/views";
import type { Level } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Records one answer from the kid's device. The server decides whether it was
 * correct, so points cannot be faked by the browser.
 */
export const POST = route(async (req: NextRequest) => {
  const auth = await deviceAuth(req);
  if (!auth) return error("This device is not linked to a kid profile.", 401);

  const body = await readBody(req);
  const questionId = str(body.questionId);
  const picked = str(body.picked);
  const level = num(body.level, auth.kid.level);
  if (!questionId) return error("Missing question.");
  if (level < 1 || level > 999) return error("Unknown level.");
  const elapsedSeconds = num(body.elapsedSeconds, 0);

  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === auth.kid.id);
    if (!kid) return null;
    return recordAnswer(doc, kid, questionId, picked, level as Level, { elapsedSeconds });
  });

  if (!outcome) return error("That question is not part of this level.", 400);

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === auth.kid.id);
  return json({ result: outcome, kid: kid ? kidView(doc, kid) : null });
});
