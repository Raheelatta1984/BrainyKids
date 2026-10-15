import type { NextRequest } from "next/server";
import { MAX_LEVEL, levelProgress } from "@/lib/quiz-logic";
import { error, json, num, readBody, route } from "@/lib/server/http";
import { deviceAuth } from "@/lib/server/session";
import { issueNextQuestion } from "@/lib/server/service";
import { store } from "@/lib/server/store";
import type { Level } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Returns the next question for one level. The server records the issued item
 * before returning it; repeated requests resume the same active question.
 */
export const POST = route(async (req: NextRequest) => {
  const auth = await deviceAuth(req);
  if (!auth) return error("This device is not linked to a kid profile.", 401);

  const body = await readBody(req);
  const level = num(body.level, auth.kid.level);
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    return error(`Pick a level between 1 and ${MAX_LEVEL}.`);
  }

  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((item) => item.id === auth.kid.id);
    if (!kid) return null;
    const question = issueNextQuestion(doc, kid, level as Level);
    return { question, progress: levelProgress(kid, level as Level) };
  });

  if (!outcome) return error("That child is no longer on this device.", 404);
  return json(outcome);
});
