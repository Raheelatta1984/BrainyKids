import type { NextRequest } from "next/server";
import { json } from "@/lib/server/http";
import { touchKid } from "@/lib/server/service";
import { deviceAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { isOnline } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sent every ~20 seconds by a signed-in kid device so the parent dashboard can
 * show who is online, and so the app knows the device is still linked.
 */
export async function POST(req: NextRequest) {
  const auth = await deviceAuth(req);
  if (!auth) return json({ linked: false }, { status: 401 });

  const cameOnline = !isOnline(auth.kid.lastSeenAt);
  await store.mutate((doc) => {
    const device = doc.devices.find((d) => d.id === auth.device.id);
    const kid = doc.kids.find((k) => k.id === auth.kid.id);
    if (!kid) return;
    if (device) device.lastSeenAt = Date.now();
    const changed = touchKid(kid);
    if (changed && cameOnline) {
      // Small nudge for the parent dashboard (no activity entry: too chatty).
      const events = doc.events;
      const last = events[events.length - 1];
      if (!(last && last.type === "device.online" && last.kidId === kid.id && Date.now() - last.ts < 30_000)) {
        events.push({
          id: ++doc.nextEventId,
          type: "device.online",
          parentId: kid.parentId,
          kidId: kid.id,
          payload: { kidName: kid.name },
          ts: Date.now(),
        });
      }
    }
  });

  return json({ linked: true, kidId: auth.kid.id });
}
