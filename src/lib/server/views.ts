import { isOnline, type ActivityEntry, type ChatMessage, type FamilySettings, type KidView, type PairingView, type ParentAccount } from "@/lib/types";
import { resolveSettings } from "@/lib/settings";
import { MAX_ACTIVITY } from "./constants";
import type { ChatRecord, DbDoc, KidRecord, PairingRecord, ParentRecord } from "./store";

/** How many chat messages a screen keeps in memory / shows. */
export const MAX_CHAT_VIEW = 50;
export const MAX_CHAT_CHARS = 500;

export function parentView(parent: ParentRecord): ParentAccount {
  return { id: parent.id, name: parent.name, email: parent.email, createdAt: parent.createdAt };
}

/** The family's master settings (time zone, date/time format, language, voice). */
export function settingsForParent(doc: DbDoc, parentId: string | null | undefined): FamilySettings {
  if (!parentId) return resolveSettings(null);
  return resolveSettings(doc.settings?.[parentId] ?? null);
}

export function chatView(record: ChatRecord): ChatMessage {
  return {
    id: record.id,
    kidId: record.kidId,
    from: record.from,
    text: record.text,
    at: record.at,
    seen: record.seen,
    kind: record.kind,
  };
}

/** The most recent messages with one child, oldest first. */
export function chatFor(doc: DbDoc, kidId: string): ChatMessage[] {
  return (doc.chats ?? [])
    .filter((message) => message.kidId === kidId)
    .slice(-MAX_CHAT_VIEW)
    .map(chatView);
}

/** Messages the viewer has not seen yet: parents see the child's, the child sees the parent's. */
export function chatUnreadFor(doc: DbDoc, kidId: string, viewer: "parent" | "kid"): number {
  const from = viewer === "parent" ? "kid" : "parent";
  return (doc.chats ?? []).filter((message) => message.kidId === kidId && message.from === from && !message.seen).length;
}

/** Marks the other side's messages as seen (called when a chat panel is open on screen). */
export function markChatSeen(doc: DbDoc, kidId: string, viewer: "parent" | "kid"): number {
  const from = viewer === "parent" ? "kid" : "parent";
  let changed = 0;
  for (const message of doc.chats ?? []) {
    if (message.kidId === kidId && message.from === from && !message.seen) {
      message.seen = true;
      changed += 1;
    }
  }
  return changed;
}

export function kidView(doc: DbDoc, kid: KidRecord, now = Date.now(), viewer: "parent" | "kid" = "parent"): KidView {
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
    chat: chatFor(doc, kid.id),
    chatUnread: chatUnreadFor(doc, kid.id, viewer),
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
