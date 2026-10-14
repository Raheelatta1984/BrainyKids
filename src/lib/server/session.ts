import type { NextRequest, NextResponse } from "next/server";
import { COOKIES, cookieOptions, normaliseCode, signPayload, tokenHash, verifyPayload } from "./auth";
import { DEVICE_DAYS, PARENT_SESSION_DAYS } from "./constants";
import { isKidDeleted, store, type DbDoc, type DeviceRecord, type KidRecord, type ParentRecord, type PairingRecord, type SessionRecord } from "./store";

export type ParentAuth = { parent: ParentRecord; session: SessionRecord };
export type DeviceAuth = {
  device: DeviceRecord;
  kid: KidRecord;
  /** True when the link was rebuilt from the device's own signed cookie. */
  restored?: boolean;
};

type ParentStateBackup = {
  parent: ParentRecord;
  session: SessionRecord;
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
  const sessionRecord: SessionRecord = session ?? {
    tokenHash: tokenHash(token),
    parentId: parent.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + maxAge * 1000,
  };
  const backup: ParentStateBackup = { parent, session: sessionRecord };
  res.cookies.set(COOKIES.parentState, signPayload(backup), cookieOptions(maxAge));
}

export function clearParentSessionCookies(res: NextResponse) {
  res.cookies.set(COOKIES.parent, "", cookieOptions(0));
  res.cookies.set(COOKIES.parentState, "", cookieOptions(0));
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

  // In temporary (non-durable) serverless storage, another function instance may
  // have handled sign-up / sign-in. Restore the signed parent session if valid.
  if (!store.info().durable) {
    const backup = verifyPayload<ParentStateBackup>(req.cookies.get(COOKIES.parentState)?.value);
    if (
      backup &&
      backup.session?.tokenHash === hash &&
      backup.session.expiresAt > now &&
      backup.parent?.id === backup.session.parentId
    ) {
      // Only restore if the parent was not explicitly deleted/rotated on this instance.
      const existingParent = current.parents.find((p) => p.id === backup.parent.id);
      if (!existingParent) {
        await store.mutate((fresh) => {
          if (!fresh.parents.some((p) => p.id === backup.parent.id)) {
            fresh.parents.push(backup.parent);
          }
          if (!fresh.sessions.some((s) => s.tokenHash === backup.session.tokenHash)) {
            fresh.sessions.push(backup.session);
          }
        });
        if (doc) {
          if (!doc.parents.some((p) => p.id === backup.parent.id)) doc.parents.push(backup.parent);
          if (!doc.sessions.some((s) => s.tokenHash === backup.session.tokenHash)) doc.sessions.push(backup.session);
        }
        return { parent: backup.parent, session: backup.session };
      }
    }
  }

  return null;
}

/**
 * A slim copy of a kid device link, stored in a signed cookie on the device.
 *
 * Only the facts needed to rebuild the session are kept (no activity history, no
 * chat) so the cookie stays far inside the ~4 KB browser limit. It is the safety
 * net for hosts whose storage is temporary: the child stays signed in even when
 * the server forgot the device between two requests.
 */
type KidDeviceBackup = {
  token: string;
  device: DeviceRecord;
  kid: KidRecord;
  parent: ParentRecord | null;
};

export const DEVICE_BACKUP_VERSION = 1;

function slimKid(kid: KidRecord): KidRecord {
  return {
    ...kid,
    // Keep the last few activity lines only: this cookie must stay small.
    activity: (kid.activity ?? []).slice(-3),
  };
}

function slimParent(parent: ParentRecord | undefined | null): ParentRecord | null {
  if (!parent) return null;
  return {
    id: parent.id,
    name: parent.name,
    email: parent.email,
    passwordHash: parent.passwordHash,
    createdAt: parent.createdAt,
    recoveryHash: parent.recoveryHash,
    recoveryCreatedAt: parent.recoveryCreatedAt,
  };
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
  const backup: KidDeviceBackup = { token, device, kid: slimKid(kid), parent: slimParent(parent) };
  res.cookies.set(COOKIES.deviceState, signPayload(backup), cookieOptions(maxAge, req));
}

export function clearDeviceSessionCookies(res: NextResponse, req?: Request | null) {
  res.cookies.set(COOKIES.device, "", cookieOptions(0, req));
  res.cookies.set(COOKIES.deviceState, "", cookieOptions(0, req));
}

export async function deviceAuth(req: NextRequest, doc?: DbDoc): Promise<DeviceAuth | null> {
  const raw = req.cookies.get(COOKIES.device)?.value;
  if (!raw) return null;
  const hash = tokenHash(raw);
  const current = doc ?? (await store.read());
  const device = current.devices.find((d) => d.tokenHash === hash);
  const kid = device ? current.kids.find((k) => k.id === device.kidId) : undefined;
  if (device && kid) return { device, kid };

  // The stored link is gone. On temporary storage another instance (or a fresh
  // temporary folder) simply does not have it, so rebuild it from the device's
  // own signed cookie instead of signing the child out.
  if (store.info().durable && !device) return null;

  const backup = verifyPayload<KidDeviceBackup>(req.cookies.get(COOKIES.deviceState)?.value);
  if (!backup || backup.token !== raw || backup.device?.tokenHash !== hash) return null;
  if (backup.device.kidId && backup.kid?.id !== backup.device.kidId) return null;
  // A parent deleting a child must stay deleted, even on temporary storage.
  if (backup.kid?.id && isKidDeleted(current, backup.kid.id)) return null;

  const restore = (target: DbDoc) => {
    if (!target.devices.some((d) => d.tokenHash === hash)) target.devices.push(backup.device);
    const existingKid = target.kids.find((k) => k.id === backup.kid.id);
    if (!existingKid) target.kids.push(backup.kid);
    else existingKid.lastSeenAt = Math.max(existingKid.lastSeenAt ?? 0, backup.kid.lastSeenAt ?? 0);
    if (backup.parent) {
      const existingParent = target.parents.find((p) => p.id === backup.parent!.id);
      if (!existingParent) target.parents.push(backup.parent);
    }
    return { device: target.devices.find((d) => d.tokenHash === hash)!, kid: target.kids.find((k) => k.id === backup.kid.id)! };
  };

  // Only rebuild when the stored records really are missing (a parent who
  // signed the device out on a durable database must stay signed out).
  if (store.info().durable) {
    const liveDevice = current.devices.find((d) => d.tokenHash === hash);
    if (liveDevice) return null;
  }

  const restored = await store.mutate((fresh) => restore(fresh));
  if (doc) restore(doc);
  return { device: restored.device, kid: restored.kid, restored: true };
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
