import { createHash } from "node:crypto";
import { BloomFilter } from "./bloom-filter";
import { TtlCache } from "./ttl-cache";
import type { ChallengeRecord, DbDoc, DeviceRecord, KidRecord, PairingRecord, ParentRecord, SessionRecord } from "./store";

export type LookupRecords = {
  parentEmail: ParentRecord;
  kidUsername: KidRecord;
  parentSession: SessionRecord;
  deviceToken: DeviceRecord;
  pairingCode: PairingRecord;
  challengeId: ChallengeRecord;
};
export type LookupKind = keyof LookupRecords;

function keyFor(kind: LookupKind, value: string): string {
  return createHash("sha256").update(kind).update("\0").update(value).digest("hex");
}

function values(doc: DbDoc, kind: LookupKind): string[] {
  switch (kind) {
    case "parentEmail": return doc.parents.map((record) => record.email);
    case "kidUsername": return doc.kids.map((record) => record.username);
    case "parentSession": return doc.sessions.map((record) => record.tokenHash);
    case "deviceToken": return doc.devices.map((record) => record.tokenHash);
    case "pairingCode": return doc.pairings.map((record) => record.code);
    case "challengeId": return doc.challenges.map((record) => record.id);
  }
}

function exact<K extends LookupKind>(doc: DbDoc, kind: K, value: string): LookupRecords[K] | null {
  let record: LookupRecords[LookupKind] | undefined;
  switch (kind) {
    case "parentEmail": record = doc.parents.find((item) => item.email === value); break;
    case "kidUsername": record = doc.kids.find((item) => item.username === value); break;
    case "parentSession": record = doc.sessions.find((item) => item.tokenHash === value); break;
    case "deviceToken": record = doc.devices.find((item) => item.tokenHash === value); break;
    case "pairingCode": record = doc.pairings.find((item) => item.code === value); break;
    case "challengeId": record = doc.challenges.find((item) => item.id === value); break;
  }
  return (record as LookupRecords[K] | undefined) ?? null;
}

/**
 * Hints belong to ONE document snapshot. Store discards them on refresh/commit,
 * so misses never extend the underlying read cache's staleness. No password,
 * PIN, successful authentication or HTTP response is cached here. A Bloom
 * positive always gets an exact lookup and the caller still authorises it.
 */
export class SnapshotLookup {
  private readonly filters = new Map<LookupKind, BloomFilter>();
  private readonly misses = new TtlCache<true>(5_000);

  constructor(private readonly doc: DbDoc) {}

  find<K extends LookupKind>(kind: K, value: string): LookupRecords[K] | null {
    const key = keyFor(kind, value);
    if (this.misses.get(key)) return null;
    let filter = this.filters.get(kind);
    if (!filter) {
      const identifiers = values(this.doc, kind);
      filter = new BloomFilter(identifiers.length);
      for (const identifier of identifiers) filter.add(keyFor(kind, identifier));
      this.filters.set(kind, filter);
    }
    const record = filter.mightContain(key) ? exact(this.doc, kind, value) : null;
    if (!record) this.misses.set(key, true, 1_000);
    return record;
  }
}
