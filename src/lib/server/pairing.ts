import type { NextRequest } from "next/server";
import { findPairing, pairingCredentials } from "./session";
import { store, type KidRecord, type PairingRecord } from "./store";

export type PairingCheck =
  | { status: "none" | "unknown" | "expired" }
  | { status: "pending"; pairing: PairingRecord }
  | { status: "approved"; pairing: PairingRecord; kid: KidRecord; token?: string };

/**
 * Resolves where a kid device's "link this device" flow stands.
 * When the parent has approved, the one-time handoff token is claimed here so the
 * caller can put it in an HTTP-only cookie on the kid's device.
 */
export async function checkPairing(req: NextRequest): Promise<PairingCheck> {
  const credentials = pairingCredentials(req);
  if (!credentials) return { status: "none" };

  const found = await store.find("pairingCode", credentials.code);
  const pairing = found ? findPairing(found.doc, credentials) : null;
  if (!pairing) return { status: "unknown" };

  if (pairing.status === "pending") {
    if (pairing.expiresAt > Date.now()) return { status: "pending", pairing };
    return { status: "expired" };
  }

  if (pairing.status === "expired") return { status: "expired" };

  return store.mutate((fresh) => {
    const current = findPairing(fresh, credentials);
    if (!current || current.status !== "approved") return { status: "expired" as const };
    const kid = fresh.kids.find((k) => k.id === current.kidId);
    if (!kid) return { status: "expired" as const };
    const token = current.handoffToken ?? undefined;
    // An approval is only good while the link it created still exists. If the
    // device record is gone and there is no handoff token left to rebuild it,
    // somebody signed this device out: answer “expired” so the child's screen
    // starts a fresh code instead of flipping between “approved” and the
    // sign-in screen (the “it keeps signing out” loop).
    if (current.deviceId && !token && !fresh.devices.some((d) => d.id === current.deviceId)) {
      current.status = "expired";
      return { status: "expired" as const };
    }
    current.handoffToken = null;
    if (current.deviceId) {
      const device = fresh.devices.find((d) => d.id === current.deviceId);
      if (device) device.lastSeenAt = Date.now();
    }
    kid.lastSeenAt = Date.now();
    return { status: "approved" as const, pairing: current, kid, token };
  });
}
