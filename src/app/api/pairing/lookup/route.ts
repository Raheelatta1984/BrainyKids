import type { NextRequest } from "next/server";
import { normaliseCode } from "@/lib/server/auth";
import { error, json } from "@/lib/server/http";
import { parentAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { pairingView } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets a parent check a code (typed in or opened from a QR link) before approving. */
export async function GET(req: NextRequest) {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);

  const code = normaliseCode(new URL(req.url).searchParams.get("code") ?? "");
  if (!code) return error("Enter the code shown on your child's device.");

  const doc = await store.read();
  const pairing = doc.pairings.find((p) => p.code === code);
  if (!pairing) return json({ found: false, status: "unknown" });

  const view = pairingView(doc, pairing);
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
}
