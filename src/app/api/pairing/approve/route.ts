import type { NextRequest } from "next/server";
import { newToken, normaliseCode, tokenHash } from "@/lib/server/auth";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { parentAuth } from "@/lib/server/session";
import { newId, pushEvent, store, type DeviceRecord } from "@/lib/server/store";
import { isId, kidView } from "@/lib/server/views";

export const runtime = "nodejs";

/**
 * A parent links a kid device to one of their children. The device is waiting on
 * /api/pairing/status and picks up its session as soon as this returns.
 */
export const POST = route(async (req: NextRequest) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);

  const body = await readBody(req);
  const code = normaliseCode(str(body.code));
  const kidId = str(body.kidId);
  if (!code) return error("Enter the code shown on your child's device.");
  if (!isId(kidId)) return error("Choose which child this device belongs to.");

  const token = newToken();
  const outcome = await store.mutate((doc) => {
    const pairing = doc.pairings.find((p) => p.code === code);
    if (!pairing) return { ok: false as const, reason: "unknown" as const };
    if (pairing.status === "approved") return { ok: false as const, reason: "used" as const };
    if (pairing.status === "expired" || pairing.expiresAt <= Date.now()) {
      pairing.status = "expired";
      return { ok: false as const, reason: "expired" as const };
    }
    const kid = doc.kids.find((k) => k.id === kidId && k.parentId === auth.parent.id);
    if (!kid) return { ok: false as const, reason: "kid" as const };

    const device: DeviceRecord = {
      id: newId(),
      parentId: auth.parent.id,
      kidId: kid.id,
      tokenHash: tokenHash(token),
      label: pairing.deviceLabel || "Kid device",
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    doc.devices.push(device);
    pairing.status = "approved";
    pairing.parentId = auth.parent.id;
    pairing.kidId = kid.id;
    pairing.deviceId = device.id;
    pairing.handoffToken = token;
    kid.lastSeenAt = Date.now();
    pushEvent(doc, {
      type: "device.linked",
      parentId: auth.parent.id,
      kidId: kid.id,
      payload: { kidName: kid.name, label: device.label, deviceId: device.id },
    });
    return { ok: true as const, kid, device };
  });

  if (!outcome.ok) {
    const messages: Record<string, string> = {
      unknown: "That code was not found. Check the code and try again.",
      used: "That code has already been used.",
      expired: "That code has expired. Ask for a new code on the child's device.",
      kid: "Choose a child on your account.",
    };
    return error(messages[outcome.reason] ?? "Could not link the device.", outcome.reason === "kid" ? 400 : 410);
  }

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === outcome.kid.id);
  return json({
    ok: true,
    device: { id: outcome.device.id, label: outcome.device.label },
    kid: kid ? kidView(doc, kid) : null,
  });
});
