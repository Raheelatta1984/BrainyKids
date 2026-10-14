import type { NextRequest } from "next/server";
import { COOKIES, normaliseCode, tokenHash } from "./auth";
import { store, type DbDoc, type DeviceRecord, type KidRecord, type ParentRecord, type PairingRecord, type SessionRecord } from "./store";

export type ParentAuth = { parent: ParentRecord; session: SessionRecord };
export type DeviceAuth = { device: DeviceRecord; kid: KidRecord };

export async function parentAuth(req: NextRequest, doc?: DbDoc): Promise<ParentAuth | null> {
  const raw = req.cookies.get(COOKIES.parent)?.value;
  if (!raw) return null;
  const hash = tokenHash(raw);
  const current = doc ?? (await store.read());
  const session = current.sessions.find((s) => s.tokenHash === hash && s.expiresAt > Date.now());
  if (!session) return null;
  const parent = current.parents.find((p) => p.id === session.parentId);
  if (!parent) return null;
  return { parent, session };
}

export async function deviceAuth(req: NextRequest, doc?: DbDoc): Promise<DeviceAuth | null> {
  const raw = req.cookies.get(COOKIES.device)?.value;
  if (!raw) return null;
  const hash = tokenHash(raw);
  const current = doc ?? (await store.read());
  const device = current.devices.find((d) => d.tokenHash === hash);
  if (!device) return null;
  const kid = current.kids.find((k) => k.id === device.kidId);
  if (!kid) return null;
  return { device, kid };
}

/** Pairing credentials left on a device that has started "link this device". */
export function pairingCredentials(req: NextRequest): { code: string; secret: string } | null {
  const raw = req.cookies.get(COOKIES.pairing)?.value;
  if (!raw) return null;
  const [code, secret] = raw.split(".");
  if (!code || !secret) return null;
  return { code: normaliseCode(code), secret };
}

export function findPairing(doc: DbDoc, credentials: { code: string; secret: string }): PairingRecord | null {
  const pairing = doc.pairings.find((p) => p.code === credentials.code);
  if (!pairing) return null;
  if (pairing.secretHash !== tokenHash(credentials.secret)) return null;
  return pairing;
}
