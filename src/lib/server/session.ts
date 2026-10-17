import type { NextRequest, NextResponse } from "next/server";
import { COOKIES, cookieOptions, normaliseCode, signPayload, tokenHash, verifyPayload } from "./auth";
import { DEVICE_DAYS, PARENT_SESSION_DAYS } from "./constants";
import { isKidDeleted, store, type DbDoc, type DeviceRecord, type KidRecord, type ParentRecord, type PairingRecord, type SessionRecord } from "./store";

export type ParentAuth = { parent: ParentRecord; session: SessionRecord };
export type DeviceAuth = {
  device: DeviceRecord;
  kid: KidRecord;
};

/**
 * Sets both the parent session cookie and a signed backup cookie so that on a
 * read-only serverless host without a database attached yet, a fresh lambda
 * instance can still recognise the signed-in parent instead of returning 401.
 */
export function setParentSessionCookies(
  res: NextResponse,
  token: string,
  parent: ParentRecord,
  session?: SessionRecord,
) {
  const maxAge = PARENT_SESSION_DAYS * 24 * 60 * 60;
  res.cookies.set(COOKIES.parent, token, cookieOptions(maxAge));
}

export function clearParentSessionCookies(res: NextResponse) {
  res.cookies.set(COOKIES.parent, "", cookieOptions(0));
}

export async function parentAuth(req: NextRequest, doc?: DbDoc): Promise<ParentAuth | null> {
  const raw = req.cookies.get(COOKIES.parent)?.value;
  if (!raw) return null;
  const hash = tokenHash(raw);
  const current = doc ?? (await store.read());
  const now = Date.now();
  const session = current.sessions.find((s) => s.tokenHash === hash && s.expiresAt > now);
  if (session) {
    const parent = current.parents.find((p) => p.id === session.parentId);
    if (parent) return { parent, session };
  }

  return null;
}



/** Sets the device cookie *and* the signed backup, so a wiped server can recover the link. */
export function setDeviceSessionCookies(
  res: NextResponse,
  token: string,
  device: DeviceRecord,
  kid: KidRecord,
  parent?: ParentRecord | null,
  req?: Request | null,
) {
  const maxAge = DEVICE_DAYS * 24 * 60 * 60;
  res.cookies.set(COOKIES.device, token, cookieOptions(maxAge, req));
}

export function clearDeviceSessionCookies(res: NextResponse, req?: Request | null) {
  res.cookies.set(COOKIES.device, "", cookieOptions(0, req));
}

export async function deviceAuth(req: NextRequest, doc?: DbDoc): Promise<DeviceAuth | null> {
  const raw = req.cookies.get(COOKIES.device)?.value;
  if (!raw) return null;
  const hash = tokenHash(raw);
  const current = doc ?? (await store.read());
  const now = Date.now();
  const maxAgeMs = DEVICE_DAYS * 24 * 60 * 60 * 1000;
  
  const device = current.devices.find((d) => d.tokenHash === hash && (now - d.createdAt) <= maxAgeMs);
  const kid = device ? current.kids.find((k) => k.id === device.kidId) : undefined;
  if (device && kid) return { device, kid };

  return null;
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
