// Passkey (fingerprint / face unlock) records: creation, lookup and pruning.

import { signPayload, verifyPayload } from "./auth";
import type { ChallengeRecord, DbDoc, KidRecord, PasskeyRecord } from "./store";
import { CHALLENGE_TTL_MS, newId, store } from "./store";
import { newChallenge } from "./webauthn";
import type { PasskeyView } from "@/lib/types";

const consumedChallenges = new Set<string>();

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
  const challenge = newChallenge();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const parentId = input.parentId ?? null;
  const kidId = input.kidId ?? null;
  const signedId = signPayload({
    nonce: newId(),
    challenge,
    purpose: input.purpose,
    parentId,
    kidId,
    expiresAt,
  });
  const record: ChallengeRecord = {
    id: signedId,
    challenge,
    purpose: input.purpose,
    parentId,
    kidId,
    expiresAt,
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
  if (consumedChallenges.has(input.id)) return null;

  const index = doc.challenges.findIndex((c) => c.id === input.id && c.purpose === input.purpose);
  if (index !== -1) {
    const [record] = doc.challenges.splice(index, 1);
    consumedChallenges.add(input.id);
    if (consumedChallenges.size > 500) {
      const first = consumedChallenges.values().next().value;
      if (first) consumedChallenges.delete(first);
    }
    if (record.expiresAt <= Date.now()) return null;
    if (input.parentId !== undefined && record.parentId !== input.parentId) return null;
    if (input.kidId !== undefined && record.kidId !== input.kidId) return null;
    return record;
  }

  // In temporary serverless storage (/tmp), /options and /verify may hit
  // different function instances. Accept the HMAC-signed challenge once.
  if (!store.info().durable) {
    const decoded = verifyPayload<ChallengeRecord & { nonce?: string }>(input.id);
    if (!decoded || decoded.purpose !== input.purpose) return null;
    consumedChallenges.add(input.id);
    if (decoded.expiresAt <= Date.now()) return null;
    if (input.parentId !== undefined && decoded.parentId !== input.parentId) return null;
    if (input.kidId !== undefined && decoded.kidId !== input.kidId) return null;
    return {
      id: input.id,
      challenge: decoded.challenge,
      purpose: decoded.purpose,
      parentId: decoded.parentId ?? null,
      kidId: decoded.kidId ?? null,
      expiresAt: decoded.expiresAt,
    };
  }

  return null;
}

export function findPasskeyByCredentialId(passkeys: PasskeyRecord[], credentialId: string): PasskeyRecord | null {
  return passkeys.find((p) => p.credentialId === credentialId) ?? null;
}
