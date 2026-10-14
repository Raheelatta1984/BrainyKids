import type { NextRequest } from "next/server";
import { error, json } from "@/lib/server/http";
import { requestScreenTime } from "@/lib/server/service";
import { deviceAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { kidView } from "@/lib/server/views";

export const runtime = "nodejs";

/** Kid asks a parent to turn their points into screen time. */
export async function POST(req: NextRequest) {
  const auth = await deviceAuth(req);
  if (!auth) return error("This device is not linked to a kid profile.", 401);

  const minutes = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === auth.kid.id);
    if (!kid) return 0;
    return requestScreenTime(doc, kid);
  });

  if (minutes === 0) return error("Earn some points first.", 400);

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === auth.kid.id);
  return json({ minutes, kid: kid ? kidView(doc, kid) : null });
}
