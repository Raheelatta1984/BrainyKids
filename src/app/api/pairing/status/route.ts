import type { NextRequest } from "next/server";
import { COOKIES, cookieOptions } from "@/lib/server/auth";
import { DEVICE_DAYS } from "@/lib/server/constants";
import { json, route } from "@/lib/server/http";
import { checkPairing } from "@/lib/server/pairing";
import { store } from "@/lib/server/store";
import { kidView } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polled by the kid device while it waits for a parent to approve the link.
 * Pass `wait=1` for a short long-poll (capped at 8 seconds so serverless hosts
 * like Vercel Hobby never time out the function) so the sign-in happens the
 * moment a parent taps Approve, without hammering the server.
 */
export const GET = route(async (req: NextRequest) => {
  const wait = new URL(req.url).searchParams.get("wait") === "1";
  const deadline = Date.now() + (wait ? 8_000 : 0);

  let check = await checkPairing(req);
  while (check.status === "pending" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    check = await checkPairing(req);
  }

  if (check.status !== "approved") return json({ status: check.status });

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === check.kid.id);
  const res = json({
    status: "approved",
    kidId: check.kid.id,
    kid: kid ? kidView(doc, kid) : null,
  });
  if (check.token) {
    res.cookies.set(COOKIES.device, check.token, cookieOptions(DEVICE_DAYS * 24 * 60 * 60));
  }
  return res;
});
