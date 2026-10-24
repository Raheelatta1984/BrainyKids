import type { NextRequest } from "next/server";
import { COOKIES } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { logBehaviour } from "@/lib/server/diagnostics";
import { touchKid } from "@/lib/server/service";
import { deviceAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { isOnline } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sent every ~20 seconds by a signed-in kid device so the parent dashboard can
 * show who is online, and so the app knows the device is still linked.
 *
 * The answer is deliberately explicit:
 *   * `{ linked: true }`  – everything is fine (possibly after a recovery),
 *   * `{ linked: false, reason: "no-cookie" | "unlinked" }` – the child really is
 *     signed out, and only then does the app return to the sign-in screen.
 *
 * Any other failure (a dropped connection, a server still starting, a temporary
 * storage hiccup) is reported as a normal error, which the kid app retries
 * instead of treating it as “a parent signed you out”. That false sign-out was
 * one of the loudest complaints in the behavioural log.
 */
export const POST = route(async (req: NextRequest) => {
  const hasCookie = Boolean(req.cookies.get(COOKIES.device)?.value);
  const auth = await deviceAuth(req);
  if (!auth) {
    const reason = hasCookie ? "unlinked" : "no-cookie";
    if (hasCookie) {
      const info = store.info();
      void logBehaviour(
        {
          code: "kid.session.heartbeat_unlinked",
          role: "kid",
          vars: {
            kidName: "This child's device",
            deviceId: "-",
            kidId: "-",
            durable: info.durable,
            reason,
          },
          context: { storage: info.driver, durable: info.durable, location: info.location, reason },
        },
        { throttleKey: "heartbeat-unlinked" },
      ).catch(() => undefined);
    }
    return json({ linked: false, reason }, { status: 401 });
  }

  const now = Date.now();
  const cameOnline = !isOnline(auth.kid.lastSeenAt, now);
  // Multiple tabs/retries should not each rewrite the entire state document.
  if (now - auth.device.lastSeenAt >= 15_000 || now - (auth.kid.lastSeenAt ?? 0) >= 15_000) await store.mutate((doc) => {
    const device = doc.devices.find((d) => d.id === auth.device.id);
    const kid = doc.kids.find((k) => k.id === auth.kid.id);
    if (!kid || !device || device.tokenHash !== auth.device.tokenHash) return;
    if (device) device.lastSeenAt = now;
    const changed = touchKid(kid);
    if (changed && cameOnline) {
      // Small nudge for the parent dashboard (no activity entry: too chatty).
      const events = doc.events;
      const last = events[events.length - 1];
      if (!(last && last.type === "device.online" && last.kidId === kid.id && now - last.ts < 30_000)) {
        events.push({
          id: ++doc.nextEventId,
          type: "device.online",
          parentId: kid.parentId,
          kidId: kid.id,
          payload: { kidName: kid.name },
          ts: now,
        });
      }
    }
  });

  return json({
    linked: true,
    kidId: auth.kid.id,
    kidName: auth.kid.name,
    durable: store.info().durable,
  });
});
