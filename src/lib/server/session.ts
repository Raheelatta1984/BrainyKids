import type { NextRequest, NextResponse } from "next/server";
import { COOKIES, cookieOptions, normaliseCode, tokenHash } from "./auth";
import { DEVICE_DAYS, PARENT_SESSION_DAYS } from "./constants";
import { store, type DbDoc, type DeviceRecord, type KidRecord, type ParentRecord, type PairingRecord, type SessionRecord } from "./store";

export type ParentAuth = { parent: ParentRecord; session: SessionRecord };
export type DeviceAuth = {
  device: DeviceRecord;
  kid: KidRecord;
};

/** Sets the opaque parent bearer cookie; authentication always checks the store. */
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
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const hash = tokenHash(raw);
  const found = doc ? null : await store.find("parentSession", hash);
  const current = doc ?? found?.doc;
  if (!current) return null;
  const now = Date.now();
  const session = doc ? current.sessions.find((s) => s.tokenHash === hash) : found?.record;
  if (session && session.expiresAt > now) {
    const parent = current.parents.find((p) => p.id === session.parentId);
    if (parent) return { parent, session };
  }

  return null;
}

/** Sets the opaque device bearer cookie; no client-side identity backup is trusted. */
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
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const hash = tokenHash(raw);
  const found = doc ? null : await store.find("deviceToken", hash);
  const current = doc ?? found?.doc;
  if (!current) return null;
  const now = Date.now();
  const maxAgeMs = DEVICE_DAYS * 24 * 60 * 60 * 1000;
  
  const device = doc ? current.devices.find((d) => d.tokenHash === hash) : found?.record;
  if (!device || now - device.createdAt > maxAgeMs) return null;
  const kid = device ? current.kids.find((k) => k.id === device.kidId) : undefined;
  if (device && kid) return { device, kid };

  return null;
}

/** Pairing credentials left on a device that has started "link this device". */
export function pairingCredentials(req: NextRequest): { code: string; secret: string } | null {
  const raw = req.cookies.get(COOKIES.pairing)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  const code = normaliseCode(parts[0] ?? "");
  const secret = parts[1];
  if (parts.length !== 2 || !/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(code) || !/^[A-Za-z0-9_-]{43}$/.test(secret ?? "")) return null;
  return { code, secret };
}

export function findPairing(doc: DbDoc, credentials: { code: string; secret: string }): PairingRecord | null {
  const pairing = doc.pairings.find((p) => p.code === credentials.code);
  if (!pairing) return null;
  if (pairing.secretHash !== tokenHash(credentials.secret)) return null;
  return pairing;
}
