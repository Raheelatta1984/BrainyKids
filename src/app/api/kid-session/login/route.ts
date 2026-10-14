import type { NextRequest } from "next/server";
import { COOKIES, cookieOptions, deviceLabel, isValidPin, normaliseUsername, verifySecret } from "@/lib/server/auth";
import { DEVICE_DAYS } from "@/lib/server/constants";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { findKidByUsername, linkDevice } from "@/lib/server/service";
import { pushEvent, store } from "@/lib/server/store";
import { kidView } from "@/lib/server/views";

export const runtime = "nodejs";

/**
 * Kid sign-in on a device: username + PIN. Signing in locks this device to that
 * child profile until a parent signs it out.
 */
export const POST = route(async (req: NextRequest) => {
  const body = await readBody(req);
  const username = normaliseUsername(str(body.username));
  const pin = str(body.pin).trim();
  if (!username) return error("Enter the kid username.");
  if (!isValidPin(pin)) return error("Enter the 4–6 digit kid PIN.");

  const label = deviceLabel(req.headers.get("user-agent"));
  const outcome = await store.mutate((doc) => {
    const kid = findKidByUsername(doc, username);
    if (!kid || !verifySecret(pin, kid.pinHash)) return { ok: false as const, token: null, kid: null };
    const { token } = linkDevice(doc, kid, label);
    pushEvent(doc, {
      type: "device.linked",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name, label },
    });
    return { ok: true as const, token, kid };
  });

  if (!outcome.ok || !outcome.kid || !outcome.token) {
    return error("That username and PIN did not match. Ask a parent to check the kid login.", 401);
  }

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === outcome.kid!.id);
  const res = json({ kid: kid ? kidView(doc, kid) : null });
  res.cookies.set(COOKIES.device, outcome.token, cookieOptions(DEVICE_DAYS * 24 * 60 * 60));
  return res;
});
