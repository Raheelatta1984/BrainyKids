import type { NextRequest } from "next/server";
import { COOKIES, cookieOptions, tokenHash } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
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
  res.cookies.set(COOKIES.parent, "", cookieOptions(0));
  return res;
});
