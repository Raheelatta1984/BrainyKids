import { hashForStorage } from "./auth";
import { getSharedCache } from "./memcached";
import { TtlCache } from "./ttl-cache";

export type RatePolicy = { name: string; limit: number; windowMs: number; critical?: boolean };
export type RateDecision =
  | { allowed: true; remaining: number; retryAfterSeconds: 0 }
  | { allowed: false; status: 429 | 503; retryAfterSeconds: number; limit: number };
export type SharedCounter = { increment(key: string, ttlSeconds: number): Promise<number> };

/** Continuous-refill burst budgets. Live buckets are NEVER evicted to admit new clients. */
export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number; windowMs: number; limit: number }>();
  private sweepAt = 0;

  constructor(private readonly capacity = 20_000) {}

  get size(): number {
    return this.buckets.size;
  }

  consume(key: string, policy: RatePolicy, now = Date.now()): RateDecision {
    if (now >= this.sweepAt) {
      for (const [id, bucket] of this.buckets) if (now - bucket.at >= bucket.windowMs) this.buckets.delete(id);
      this.sweepAt = now + 10_000;
    }
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.capacity) {
        return { allowed: false, status: 503, retryAfterSeconds: Math.max(1, Math.ceil((this.sweepAt - now) / 1000)), limit: policy.limit };
      }
      bucket = { tokens: policy.limit, at: now, windowMs: policy.windowMs, limit: policy.limit };
      this.buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(policy.limit, bucket.tokens + Math.max(0, now - bucket.at) * policy.limit / policy.windowMs);
    bucket.at = now;
    if (bucket.tokens < 1) {
      return { allowed: false, status: 429, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) * policy.windowMs / policy.limit / 1000)), limit: policy.limit };
    }
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
  }
}

/**
 * Local smoothing is always first, so a rejected flood does not hit any backend.
 * When Memcached is configured, atomic, epoch-scoped counters also bound the
 * aggregate across app instances. These are fixed windows, not rolling quotas.
 */
export class RateLimiter {
  private readonly local: TokenBuckets;
  private readonly denials = new TtlCache<{ decision: Extract<RateDecision, { allowed: false }>; until: number }>(5_000);

  constructor(private readonly counter?: SharedCounter | null, capacity = 20_000) {
    this.local = new TokenBuckets(capacity);
  }

  async consume(subject: string, policy: RatePolicy, now = Date.now()): Promise<RateDecision> {
    const namespace = process.env.BRAINYKIDS_RATE_LIMIT_NAMESPACE || "brainykids:v1";
    const key = hashForStorage("request-rate-limit", `${namespace}\0${policy.name}\0${subject}`);
    const local = this.local.consume(key, policy, now);
    if (!local.allowed) return local;
    const denied = this.denials.get(key, now);
    if (denied) return { ...denied.decision, retryAfterSeconds: Math.max(1, Math.ceil((denied.until - now) / 1000)) };

    try {
      const counter = this.counter === undefined ? await getSharedCache() : this.counter;
      if (!counter) return local;
      const epoch = Math.floor(now / policy.windowMs);
      const until = (epoch + 1) * policy.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((until - now) / 1000));
      const count = await counter.increment(`bk:rate:${key}:${epoch}`, retryAfterSeconds + 1);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid shared quota counter.");
      if (count <= policy.limit) return { ...local, remaining: Math.min(local.remaining, policy.limit - count) };
      const denial = { allowed: false as const, status: 429 as const, retryAfterSeconds, limit: policy.limit };
      this.denials.set(key, { decision: denial, until }, until - now, now);
      return denial;
    } catch {
      // Cache failure must not remove auth/creation abuse controls. Ordinary
      // reads/writes retain the local budget for availability during an outage.
      return policy.critical
        ? { allowed: false, status: 503, retryAfterSeconds: 5, limit: policy.limit }
        : local;
    }
  }
}

export class RequestProtectionError extends Error {
  constructor(
    readonly status: 429 | 503,
    readonly retryAfterSeconds: number,
    readonly limit?: number,
  ) {
    super(status === 429 ? "Too many requests. Please wait and try again." : "The server is temporarily busy. Please try again shortly.");
    this.name = "RequestProtectionError";
  }
}

/** Bounded leases for slow requests/streams; idempotent release on every exit. */
export class ConnectionLimiter {
  private readonly leases = new Map<symbol, { key: string; expiresAt: number }>();

  constructor(private readonly total = 128, private readonly perClient = 16) {}

  get size(): number {
    return this.leases.size;
  }

  acquire(key: string, ttlMs = 60_000, now = Date.now()): () => void {
    let clientCount = 0;
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(id);
      else if (lease.key === key) clientCount += 1;
    }
    if (clientCount >= this.perClient) throw new RequestProtectionError(429, 2);
    if (this.leases.size >= this.total) throw new RequestProtectionError(503, 2);
    const id = Symbol();
    this.leases.set(id, { key, expiresAt: now + ttlMs });
    return () => { this.leases.delete(id); };
  }
}
