import type { NextRequest } from "next/server";
import { COOKIES, cookieOptions, deviceLabel, newPairingCode, newToken, normaliseCode, tokenHash } from "@/lib/server/auth";
import { PAIRING_TTL_MS } from "@/lib/server/constants";
import { json } from "@/lib/server/http";
import { checkPairing } from "@/lib/server/pairing";
import { findPairing, pairingCredentials } from "@/lib/server/session";
import { newId, pushEvent, store, UNCLAIMED, type PairingRecord } from "@/lib/server/store";

export const runtime = "nodejs";

const PAIRING_COOKIE_SECONDS = 60 * 60;

/**
 * Called by a kid device that wants to be linked. Returns a short code (shown as
 * a QR code and as text) that a parent approves from their own phone.
 */
export async function POST(req: NextRequest) {
  const rotate = new URL(req.url).searchParams.get("rotate") === "1";

  // Already approved on a previous poll? Hand the device its session immediately.
  const existing = await checkPairing(req);
  if (existing.status === "approved") return json({ status: "approved" });

  const credentials = pairingCredentials(req);
  const label = deviceLabel(req.headers.get("user-agent"));
  const code = newPairingCode();
  const secret = newToken();

  const outcome = await store.mutate((doc) => {
    if (!rotate && credentials) {
      const current = findPairing(doc, credentials);
      if (current && current.status === "pending" && current.expiresAt - Date.now() > 60_000) {
        return { reuse: true as const, code: current.code, expiresAt: current.expiresAt };
      }
    }
    const now = Date.now();
    const pairing: PairingRecord = {
      id: newId(),
      code: normaliseCode(code),
      secretHash: tokenHash(secret),
      status: "pending",
      parentId: null,
      kidId: null,
      deviceId: null,
      handoffToken: null,
      deviceLabel: label,
      createdAt: now,
      expiresAt: now + PAIRING_TTL_MS,
    };
    // Keep the list tidy: drop attempts older than an hour.
    doc.pairings = doc.pairings.filter((p) => p.expiresAt > now - 60 * 60 * 1000);
    doc.pairings.push(pairing);
    // Not attributed to an account yet: a signed-in parent is told a device is
    // waiting (see eventsSince for how "unclaimed" events are shown).
    pushEvent(doc, {
      type: "pairing.started",
      parentId: UNCLAIMED,
      payload: { code: pairing.code, label: pairing.deviceLabel },
    });
    return { reuse: false as const, code: pairing.code, expiresAt: pairing.expiresAt, secret };
  });

  const res = json({ status: "pending", code: outcome.code, expiresAt: outcome.expiresAt });
  if (!outcome.reuse) {
    res.cookies.set(COOKIES.pairing, `${outcome.code}.${secret}`, cookieOptions(PAIRING_COOKIE_SECONDS));
  }
  return res;
}
