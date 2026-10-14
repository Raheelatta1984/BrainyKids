import type { NextRequest, NextResponse } from "next/server";
import { COOKIES, cookieOptions, normaliseCode, signPayload, tokenHash, verifyPayload } from "./auth";
import { PARENT_SESSION_DAYS } from "./constants";
import { store, type DbDoc, type DeviceRecord, type KidRecord, type ParentRecord, type PairingRecord, type SessionRecord } from "./store";

export type ParentAuth = { parent: ParentRecord; session: SessionRecord };
export type DeviceAuth = { device: DeviceRecord; kid: KidRecord };

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
