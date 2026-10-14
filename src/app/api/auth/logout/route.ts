import type { NextRequest } from "next/server";
import { COOKIES, tokenHash } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { clearParentSessionCookies } from "@/lib/server/session";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

export const POST = route(async (req: NextRequest) => {
  const raw = req.cookies.get(COOKIES.parent)?.value;
  if (raw) {
    const hash = tokenHash(raw);
    await store.mutate((doc) => {
      doc.sessions = doc.sessions.filter((s) => s.tokenHash !== hash);
    });
  }
  const res = json({ ok: true });
  clearParentSessionCookies(res);
  return res;
});
