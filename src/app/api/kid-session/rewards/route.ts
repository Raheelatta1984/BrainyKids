import type { NextRequest } from "next/server";
import { error, json, route } from "@/lib/server/http";
import { requestRealisation } from "@/lib/server/service";
import { deviceAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { kidView } from "@/lib/server/views";

export const runtime = "nodejs";

/** Kid asks a parent to realise (cash out) the wallet. The balance is only reset when a parent approves. */
export const POST = route(async (req: NextRequest) => {
  const auth = await deviceAuth(req);
  if (!auth) return error("This device is not linked to a kid profile.", 401);

  const amount = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === auth.kid.id);
    if (!kid) return 0;
    return requestRealisation(doc, kid);
  });

  if (amount === 0) return error("Earn some money first, or wait for your parent to answer your last request.", 400);

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === auth.kid.id);
  return json({ amountMinor: amount, kid: kid ? kidView(doc, kid) : null });
});
