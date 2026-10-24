import type { NextRequest } from "next/server";
import { deviceLabel, isValidPin, isValidUsername, normaliseUsername, verifySecret } from "@/lib/server/auth";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { logBehaviour } from "@/lib/server/diagnostics";
import { linkDevice } from "@/lib/server/service";
import { protectIdentity } from "@/lib/server/request-protection";
import { setDeviceSessionCookies } from "@/lib/server/session";
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
  if (!isValidUsername(username)) return error("Enter a valid kid username.");
  if (!isValidPin(pin)) return error("Enter the 4–6 digit kid PIN.");

  await protectIdentity("kid", username);
  const candidate = await store.find("kidUsername", username);
  if (!candidate || !verifySecret(pin, candidate.record.pinHash)) {
    return error("That username and PIN did not match. Ask a parent to check the kid login.", 401);
  }
  const verifiedHash = candidate.record.pinHash;

  const label = deviceLabel(req.headers.get("user-agent"));
  const storage = store.info();
  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((item) => item.id === candidate.record.id && item.username === username);
    if (!kid || kid.pinHash !== verifiedHash) return { ok: false as const, token: null, kid: null, device: null };
    const { device, token } = linkDevice(doc, kid, label);
    pushEvent(doc, {
      type: "device.linked",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name, label },
    });
    return { ok: true as const, token, kid, device };
  });

  if (!outcome.ok || !outcome.kid || !outcome.token || !outcome.device) {
    return error("That username and PIN did not match. Ask a parent to check the kid login.", 401);
  }

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === outcome.kid!.id);
  void logBehaviour(
    {
      code: "kid.session.linked",
      parentId: outcome.kid.parentId,
      kidId: outcome.kid.id,
      kidName: outcome.kid.name,
      deviceId: outcome.device.id,
      role: "kid",
      vars: {
        kidName: outcome.kid.name,
        deviceLabel: label,
        kidId: outcome.kid.id,
        deviceId: outcome.device.id,
        driver: storage.driver,
        durable: storage.durable,
      },
      context: { storage: storage.driver, durable: storage.durable, label },
    },
    { throttleKey: outcome.device.id },
  ).catch(() => undefined);

  const author = doc.parents.find((p) => p.id === outcome.kid!.parentId);
  const res = json({ kid: kid ? kidView(doc, kid, Date.now(), "kid") : null });
  setDeviceSessionCookies(res, outcome.token, outcome.device, outcome.kid, author, req);
  return res;
});
