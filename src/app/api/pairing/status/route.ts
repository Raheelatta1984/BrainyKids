import { setTimeout as delay } from "node:timers/promises";
import type { NextRequest } from "next/server";
import { COOKIES, tokenHash } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { logBehaviour } from "@/lib/server/diagnostics";
import { checkPairing } from "@/lib/server/pairing";
import { setDeviceSessionCookies } from "@/lib/server/session";
import { newId, store, type DeviceRecord } from "@/lib/server/store";
import { kidView } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polled by the kid device while it waits for a parent to approve the link.
 * Pass `wait=1` for a short long-poll (capped at 8 seconds so serverless hosts
 * like Vercel Hobby never time out the function) so the sign-in happens the
 * moment a parent taps Approve, without hammering the server.
 *
 * The reply always says how long the current code is still good for, and an
 * `unknown`/`expired` answer is logged, because “the QR code keeps expiring” was
 * reported even when the code had simply been forgotten by a temporary server.
 */
export const GET = route(async (req: NextRequest) => {
  const wait = new URL(req.url).searchParams.get("wait") === "1";
  const deadline = Date.now() + (wait ? 8_000 : 0);
  const storage = store.info();

  let check = await checkPairing(req);
  while (check.status === "pending" && Date.now() < deadline && !req.signal.aborted) {
    try {
      await delay(Math.min(1_200, Math.max(0, deadline - Date.now())), undefined, { signal: req.signal });
    } catch {
      break; // An abandoned tab must not keep polling the database.
    }
    if (!req.signal.aborted) check = await checkPairing(req);
  }

  if (check.status !== "approved") {
    if (check.status === "pending") {
      return json({
        status: "pending",
        code: check.pairing.code,
        expiresAt: check.pairing.expiresAt,
        secondsLeft: Math.max(0, Math.round((check.pairing.expiresAt - Date.now()) / 1000)),
      });
    }

    if (check.status === "expired") {
      void logBehaviour(
        {
          code: "pairing.expired_unapproved",
          role: "kid",
          vars: {
            code: req.cookies.get(COOKIES.pairing)?.value?.split(".")[0] ?? "-",
            createdAt: "-",
            expiresAt: "-",
            rotated: false,
          },
          context: { storage: storage.driver, durable: storage.durable },
        },
        { throttleKey: "pairing-expired" },
      ).catch(() => undefined);
      return json({ status: "expired", secondsLeft: 0 });
    }

    const code = req.cookies.get(COOKIES.pairing)?.value?.split(".")[0];
    if (code) {
      void logBehaviour(
        {
          code: "pairing.record_missing",
          role: "kid",
          vars: {
            code,
            driver: storage.driver,
            durable: storage.durable,
            location: storage.location,
          },
          context: { code, storage: storage.driver, durable: storage.durable, location: storage.location },
        },
        { throttleKey: "pairing-missing" },
      ).catch(() => undefined);
    }
    return json({ status: check.status, secondsLeft: 0 });
  }

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === check.kid.id);
  const parent = doc.parents.find((p) => p.id === check.kid.parentId);
  const token = check.token;

  // The device record is normally created when the parent approves. If the
  // request landed on a server instance that never saw that write, rebuild it
  // from the claimed handoff token so the child is not signed out immediately.
  let device = check.pairing.deviceId ? doc.devices.find((d) => d.id === check.pairing.deviceId) : undefined;
  if (!device && token && kid) {
    device = await store.mutate((fresh) => {
      const existing = fresh.devices.find((d) => d.id === check.pairing.deviceId);
      if (existing) return existing;
      const created: DeviceRecord = {
        id: check.pairing.deviceId ?? newId(),
        parentId: kid.parentId,
        kidId: kid.id,
        tokenHash: tokenHash(token),
        label: check.pairing.deviceLabel || "Kid device",
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      fresh.devices.push(created);
      return created;
    });
  }

  const res = json({
    status: "approved",
    kidId: check.kid.id,
    kid: kid ? kidView(doc, kid, Date.now(), "kid") : null,
    secondsLeft: null,
  });
  if (token && device) {
    setDeviceSessionCookies(res, token, device, check.kid, parent ?? null, req);
    void logBehaviour(
      {
        code: "kid.session.linked",
        parentId: check.kid.parentId,
        kidId: check.kid.id,
        kidName: check.kid.name,
        deviceId: device.id,
        role: "kid",
        vars: {
          kidName: check.kid.name,
          deviceLabel: device.label,
          kidId: check.kid.id,
          deviceId: device.id,
          driver: storage.driver,
          durable: storage.durable,
        },
        context: { trigger: "qr", storage: storage.driver, durable: storage.durable },
      },
      { throttleKey: device.id, force: true },
    ).catch(() => undefined);
  }
  return res;
});
