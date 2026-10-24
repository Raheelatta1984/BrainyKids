import type { NextRequest } from "next/server";
import { normaliseCode } from "@/lib/server/auth";
import { error, json, route } from "@/lib/server/http";
import { logBehaviour } from "@/lib/server/diagnostics";
import { parentAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { pairingView } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets a parent check a code (typed in or opened from a QR link) before approving. */
export const GET = route(async (req: NextRequest) => {
  const code = normaliseCode(new URL(req.url).searchParams.get("code") ?? "");
  if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(code)) return error("Enter the six-character code shown on your child's device.");
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);

  const found = await store.find("pairingCode", code);
  const pairing = found?.record;
  if (!pairing) {
    const storage = store.info();
    void logBehaviour(
      {
        code: "pairing.lookup_failed",
        parentId: auth.parent.id,
        role: "parent",
        vars: { code, found: false, status: "unknown", driver: storage.driver, durable: storage.durable },
        context: { code, storage: storage.driver, durable: storage.durable, location: storage.location },
      },
      { throttleKey: `lookup-${auth.parent.id}` },
    ).catch(() => undefined);
    return json({ found: false, status: "unknown" });
  }

  const view = pairingView(found!.doc, pairing);
  if (view.status !== "pending") {
    return json({ found: true, status: view.status, code: view.code, label: pairing.deviceLabel });
  }
  if (pairing.parentId && pairing.parentId !== auth.parent.id) {
    return error("That code belongs to another account.", 403);
  }
  return json({
    found: true,
    status: view.status,
    code: view.code,
    label: pairing.deviceLabel,
    expiresAt: view.expiresAt,
  });
});
