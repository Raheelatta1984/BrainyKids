import type { NextRequest } from "next/server";
import { COOKIES, cookieOptions, deviceLabel, newPairingCode, newToken, normaliseCode, tokenHash } from "@/lib/server/auth";
import { PAIRING_TTL_MS } from "@/lib/server/constants";
import { json, route } from "@/lib/server/http";
import { logBehaviour } from "@/lib/server/diagnostics";
import { checkPairing } from "@/lib/server/pairing";
import { findPairing, pairingCredentials } from "@/lib/server/session";
import { newId, pushEvent, store, UNCLAIMED, type PairingRecord } from "@/lib/server/store";

export const runtime = "nodejs";

const PAIRING_COOKIE_SECONDS = 60 * 60;

/**
 * Called by a kid device that wants to be linked. Returns a short code (shown as
 * a QR code and as text) that a parent approves from their own phone.
 *
 * Calling it again (`?rotate=1`) issues a fresh code — the kid screen does that
 * by itself when its code is close to running out, which is what fixes “the QR
 * code keeps expiring” from the child's point of view.
 */
export const POST = route(async (req: NextRequest) => {
  const rotate = new URL(req.url).searchParams.get("rotate") === "1";

  // Already approved on a previous poll? Hand the device its session immediately.
  const existing = await checkPairing(req);
  if (existing.status === "approved") return json({ status: "approved" });

  const credentials = pairingCredentials(req);
  const label = deviceLabel(req.headers.get("user-agent"));
  const code = newPairingCode();
  const secret = newToken();
  const storage = store.info();

  const outcome = await store.mutate((doc) => {
    const previous = credentials ? findPairing(doc, credentials) : null;
    if (!rotate && previous && previous.status === "pending" && previous.expiresAt - Date.now() > 60_000) {
      return {
        reuse: true as const,
        code: previous.code,
        expiresAt: previous.expiresAt,
        previousCode: null as string | null,
        previousExpired: false,
      };
    }

    const now = Date.now();
    const previousCode = previous?.code ?? null;
    const previousExpired = Boolean(previous && (previous.expiresAt <= now || previous.status === "expired"));
    if (previous && previous.status === "pending") previous.status = "expired";

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
    // waiting (see eventsSince for how “unclaimed” events are shown).
    pushEvent(doc, {
      type: "pairing.started",
      parentId: UNCLAIMED,
      payload: { code: pairing.code, label: pairing.deviceLabel, expiresAt: pairing.expiresAt },
    });

    logBehaviour(
      {
        code: previousExpired || (rotate && previousCode) ? "pairing.renewed" : "pairing.started",
        role: "kid",
        vars: {
          code: pairing.code,
          oldCode: previousCode ?? pairing.code,
          deviceLabel: label,
          ttlSeconds: Math.round(PAIRING_TTL_MS / 1000),
          expiresAt: new Date(pairing.expiresAt).toISOString(),
          reason: previousExpired ? "the previous code had expired" : "a parent had not approved the previous code yet",
          driver: storage.driver,
          durable: storage.durable,
        },
        context: { code: pairing.code, storage: storage.driver, durable: storage.durable, label },
      },
      { throttleKey: `pairing-${pairing.code}`, force: true },
    ).catch(() => undefined);

    return { reuse: false as const, code: pairing.code, expiresAt: pairing.expiresAt, previousCode, previousExpired, secret };
  });

  const res = json({
    status: "pending",
    code: outcome.code,
    expiresAt: outcome.expiresAt,
    ttlSeconds: Math.round(PAIRING_TTL_MS / 1000),
    renewed: !outcome.reuse && (Boolean(outcome.previousCode) || outcome.previousExpired),
  });
  if (!outcome.reuse) {
    res.cookies.set(COOKIES.pairing, `${outcome.code}.${outcome.secret}`, cookieOptions(PAIRING_COOKIE_SECONDS, req));
  }
  return res;
});
