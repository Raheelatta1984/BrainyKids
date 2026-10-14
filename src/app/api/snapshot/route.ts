import type { NextRequest } from "next/server";
import { json } from "@/lib/server/http";
import { store } from "@/lib/server/store";
import { deviceAuth, parentAuth } from "@/lib/server/session";
import { kidView, parentView, pendingPairings } from "@/lib/server/views";
import type { Snapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A single call that tells the app who is signed in on this device and returns
 * everything that screen needs. Realtime updates arrive from /api/events.
 */
export async function GET(req: NextRequest) {
  const doc = await store.read();
  const now = Date.now();

  const parent = await parentAuth(req, doc);
  if (parent) {
    const kids = doc.kids.filter((k) => k.parentId === parent.parent.id);
    const snapshot: Snapshot = {
      role: "parent",
      parent: parentView(parent.parent),
      kids: kids.map((k) => kidView(doc, k, now)),
      pairings: pendingPairings(doc, parent.parent.id, now),
    };
    return json(snapshot);
  }

  const device = await deviceAuth(req, doc);
  if (device) {
    const owner = doc.parents.find((p) => p.id === device.kid.parentId);
    const snapshot: Snapshot = {
      role: "kid",
      kid: kidView(doc, device.kid, now),
      parent: owner ? { name: owner.name, email: owner.email } : { name: "Parent", email: "" },
    };
    return json(snapshot);
  }

  const snapshot: Snapshot = { role: "guest", hasAccounts: doc.parents.length > 0 };
  return json(snapshot);
}
