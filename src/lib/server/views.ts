import { isOnline, type ActivityEntry, type KidView, type PairingView, type ParentAccount } from "@/lib/types";
import { MAX_ACTIVITY } from "./constants";
import type { DbDoc, KidRecord, PairingRecord, ParentRecord } from "./store";

export function parentView(parent: ParentRecord): ParentAccount {
  return { id: parent.id, name: parent.name, email: parent.email, createdAt: parent.createdAt };
}

export function kidView(doc: DbDoc, kid: KidRecord, now = Date.now()): KidView {
  return {
    id: kid.id,
    parentId: kid.parentId,
    name: kid.name,
    username: kid.username,
    age: kid.age,
    gender: kid.gender,
    theme: kid.theme,
    level: kid.level,
    unlockedLevel: kid.unlockedLevel,
    usedByLevel: kid.usedByLevel,
    points: kid.points,
    attempted: kid.attempted,
    correct: kid.correct,
    requestedMinutes: kid.requestedMinutes,
    approvedMinutes: kid.approvedMinutes,
    createdAt: kid.createdAt,
    lastSeenAt: kid.lastSeenAt,
    online: isOnline(kid.lastSeenAt, now),
    activity: kid.activity.slice(-MAX_ACTIVITY).reverse(),
    devices: doc.devices
      .filter((d) => d.kidId === kid.id)
      .map((d) => ({
        id: d.id,
        label: d.label,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        online: isOnline(d.lastSeenAt, now),
      })),
  };
}

export function pairingView(doc: DbDoc, pairing: PairingRecord, now = Date.now()): PairingView {
  const kid = pairing.kidId ? doc.kids.find((k) => k.id === pairing.kidId) : undefined;
  const status = pairing.status === "pending" && pairing.expiresAt <= now ? "expired" : pairing.status;
  return {
    code: pairing.code,
    status,
    createdAt: pairing.createdAt,
    expiresAt: pairing.expiresAt,
    kidId: pairing.kidId ?? undefined,
    kidName: kid?.name,
  };
}

/** Pending device-link requests a parent should see right now. */
export function pendingPairings(doc: DbDoc, parentId: string, now = Date.now()): PairingView[] {
  // A family install (one parent account) may see link requests as they arrive so
  // a parent can approve without retyping the code. Where several families share a
  // deployment, unclaimed codes are only usable by typing/scanning them.
  const singleFamily = doc.parents.length <= 1;
  return doc.pairings
    .filter(
      (p) =>
        p.status === "pending" &&
        p.expiresAt > now &&
        (p.parentId === parentId || (!p.parentId && singleFamily)),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => pairingView(doc, p, now));
}

export function addActivity(kid: KidRecord, entry: Omit<ActivityEntry, "id" | "at"> & { id?: string; at?: number }) {
  const record: ActivityEntry = {
    id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at ?? Date.now(),
    kind: entry.kind,
    text: entry.text,
    correct: entry.correct,
  };
  kid.activity.push(record);
  if (kid.activity.length > MAX_ACTIVITY * 2) {
    kid.activity.splice(0, kid.activity.length - MAX_ACTIVITY * 2);
  }
  return record;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
