// Passkey (fingerprint / face unlock) records: creation, lookup and pruning.

import type { ChallengeRecord, DbDoc, KidRecord, PasskeyRecord } from "./store";
import { CHALLENGE_TTL_MS, newId } from "./store";
import { newChallenge } from "./webauthn";
import type { PasskeyView } from "@/lib/types";

export function passkeyView(passkey: PasskeyRecord, kid?: KidRecord): PasskeyView {
  return {
    id: passkey.id,
    label: passkey.label,
    kind: passkey.kidId ? "kid" : "parent",
    kidId: passkey.kidId ?? undefined,
    kidName: kid?.name,
    synced: passkey.synced,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt,
  };
}

/** Every passkey a parent should see: their own, plus each of their children's. */
export function passkeysForParent(passkeys: PasskeyRecord[], parentId: string, kids: KidRecord[]): PasskeyView[] {
  const mine = kids.filter((kid) => kid.parentId === parentId);
  const kidIds = new Set(mine.map((kid) => kid.id));
  return passkeys
    .filter((p) => p.parentId === parentId || (p.kidId !== null && kidIds.has(p.kidId)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => passkeyView(p, mine.find((kid) => kid.id === p.kidId)));
}

/** Opens a short-lived, single-use challenge for the device to answer. */
export function createChallenge(
  doc: DbDoc,
  input: { purpose: ChallengeRecord["purpose"]; parentId?: string | null; kidId?: string | null },
): ChallengeRecord {
  const record: ChallengeRecord = {
    id: newId(),
    challenge: newChallenge(),
    purpose: input.purpose,
    parentId: input.parentId ?? null,
    kidId: input.kidId ?? null,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  doc.challenges.push(record);
  // Only the newest handful of prompts can still be in flight.
  if (doc.challenges.length > 50) doc.challenges.splice(0, doc.challenges.length - 50);
  return record;
}

/** Fetches and consumes a challenge. A challenge can never be replayed. */
export function takeChallenge(
  doc: DbDoc,
  input: { id: string; purpose: ChallengeRecord["purpose"]; parentId?: string | null; kidId?: string | null },
): ChallengeRecord | null {
  const index = doc.challenges.findIndex((c) => c.id === input.id && c.purpose === input.purpose);
  if (index === -1) return null;
  const [record] = doc.challenges.splice(index, 1);
  if (record.expiresAt <= Date.now()) return null;
  if (input.parentId !== undefined && record.parentId !== input.parentId) return null;
  if (input.kidId !== undefined && record.kidId !== input.kidId) return null;
  return record;
}

export function findPasskeyByCredentialId(passkeys: PasskeyRecord[], credentialId: string): PasskeyRecord | null {
  return passkeys.find((p) => p.credentialId === credentialId) ?? null;
}
