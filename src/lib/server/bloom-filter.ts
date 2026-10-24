import { createHash } from "node:crypto";

/**
 * An expendable membership hint, never proof that a record exists or is allowed.
 * An inserted value cannot be a false negative. Positives need an exact lookup.
 */
export class BloomFilter {
  private readonly bits: Uint8Array;
  private readonly bitCount: number;
  private readonly hashes: number;

  constructor(expectedEntries: number, falsePositiveRate = 0.01) {
    if (!Number.isFinite(expectedEntries) || expectedEntries < 0) throw new Error("Invalid Bloom capacity.");
    if (!(falsePositiveRate > 0 && falsePositiveRate < 1)) throw new Error("Invalid Bloom error rate.");
    const entries = Math.max(1, expectedEntries);
    // At most 8 MiB per snapshot, even for unexpectedly large documents.
    this.bitCount = Math.min(64 * 1024 * 1024, Math.max(64, Math.ceil(-entries * Math.log(falsePositiveRate) / Math.LN2 ** 2)));
    this.hashes = Math.max(1, Math.min(16, Math.round(this.bitCount / entries * Math.LN2)));
    this.bits = new Uint8Array(Math.ceil(this.bitCount / 8));
  }

  private positions(value: string): number[] {
    const digest = createHash("sha256").update(value).digest();
    const first = digest.readUInt32BE(0);
    const step = digest.readUInt32BE(4) | 1;
    return Array.from({ length: this.hashes }, (_, index) => ((first + index * (step >>> 0)) >>> 0) % this.bitCount);
  }

  add(value: string): void {
    for (const bit of this.positions(value)) this.bits[bit >>> 3] |= 1 << (bit & 7);
  }

  mightContain(value: string): boolean {
    return this.positions(value).every((bit) => (this.bits[bit >>> 3] & (1 << (bit & 7))) !== 0);
  }
}
