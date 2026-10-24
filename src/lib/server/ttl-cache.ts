/** Small, bounded LRU cache. Expiry is checked on every read, not by a timer. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Cache capacity must be positive.");
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number, now = Date.now()): void {
    this.entries.delete(key);
    if (ttlMs <= 0) return;
    // Constant-time eviction, even under a flood of distinct misses. Scanning
    // the entire full cache on every insertion would itself be a CPU DoS.
    if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expiresAt: now + ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}
