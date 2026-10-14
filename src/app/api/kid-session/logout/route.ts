import type { NextRequest } from "next/server";
import { COOKIES, cookieOptions, verifySecret } from "@/lib/server/auth";
import { error, json, readBody, str } from "@/lib/server/http";
import { parentOfKid, unlinkDevice } from "@/lib/server/service";
import { deviceAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";

/**
 * Signs a kid device out of kid mode. Only a parent can do this, so the child
 * cannot leave kid mode on their own: it needs the parent account password
 * (or a parent can use "Sign out" on a device from the parent dashboard).
 */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const password = str(body.parentPassword);
  if (!password) return error("Enter the parent password to sign out of kid mode.");

  const auth = await deviceAuth(req);
  if (!auth) {
    // Nothing linked on this device; just clear any stale cookie.
    const res = json({ ok: true });
    res.cookies.set(COOKIES.device, "", cookieOptions(0));
    return res;
  }

  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === auth.kid.id);
    if (!kid) return { ok: true as const };
    const parent = parentOfKid(doc, kid);
    if (!parent || !verifySecret(password, parent.passwordHash)) return { ok: false as const };
    const device = doc.devices.find((d) => d.id === auth.device.id);
    if (device) unlinkDevice(doc, device);
    return { ok: true as const };
  });

  if (!outcome.ok) return error("That password did not match the parent account.", 403);

  const res = json({ ok: true });
  res.cookies.set(COOKIES.device, "", cookieOptions(0));
  return res;
}
