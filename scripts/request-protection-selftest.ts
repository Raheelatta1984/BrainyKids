import assert from "node:assert/strict";
import { BloomFilter } from "../src/lib/server/bloom-filter";
import { clientAddress, normaliseClientAddress, requestClientKey } from "../src/lib/server/client-identity";
import { checkBodyLength, json, readBody, route } from "../src/lib/server/http";
import { SharedCache, type MemcachedClient } from "../src/lib/server/memcached";
import { ConnectionLimiter, RateLimiter, RequestProtectionError, TokenBuckets, type RatePolicy } from "../src/lib/server/rate-limit";
import { holdStreamLease, protectRequest, requestPolicy } from "../src/lib/server/request-protection";
import { emptyDoc, StorageError, Store, type DbDoc, type Driver } from "../src/lib/server/store";
import { TtlCache } from "../src/lib/server/ttl-cache";

process.env.BRAINYKIDS_SECRET = "request-protection-selftest-only";
process.env.BRAINYKIDS_TRUST_PROXY = "true";
delete process.env.MEMCACHED_SERVERS;

let checks = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  checks += 1;
  console.log(`  ✓ ${name}`);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const info: Driver["info"] = () => ({ driver: "file", durable: true, location: "selftest", notice: null, envVar: null, ephemeralHost: false });
function driver(initial = emptyDoc()): Driver {
  let saved = structuredClone(initial);
  return {
    name: "file", cacheTtl: 400, info,
    load: async () => structuredClone(saved),
    save: async (doc) => { saved = structuredClone(doc); },
  };
}
const parent = { id: "parent-one", name: "Test", email: "one@example.test", passwordHash: "test:hash", createdAt: 1 };
const smallPolicy: RatePolicy = { name: "selftest", limit: 2, windowMs: 10_000 };

async function main() {
  console.log("\nBounded caches and probabilistic membership");
  await test("TTL cache expires entries, refreshes LRU order and stays bounded", () => {
    const cache = new TtlCache<number>(2);
    cache.set("a", 1, 100, 0);
    cache.set("b", 2, 100, 0);
    assert.equal(cache.get("a", 1), 1);
    cache.set("c", 3, 100, 1);
    assert.equal(cache.get("b", 2), undefined);
    assert.equal(cache.get("a", 100), undefined);
    for (let index = 0; index < 10_000; index++) cache.set(String(index), index, 10, 100);
    assert.equal(cache.size, 2);
    cache.clear();
    assert.equal(cache.size, 0);
  });
  await test("Bloom filter has no false negatives and a low measured false-positive rate", () => {
    const filter = new BloomFilter(2_000);
    for (let index = 0; index < 2_000; index++) filter.add(`present-${index}`);
    for (let index = 0; index < 2_000; index++) assert.ok(filter.mightContain(`present-${index}`));
    let positives = 0;
    for (let index = 0; index < 10_000; index++) if (filter.mightContain(`missing-${index}`)) positives++;
    assert.ok(positives < 300, `unexpected false-positive count ${positives}`);
    assert.throws(() => new BloomFilter(-1));
    assert.throws(() => new BloomFilter(1, 1));
  });

  console.log("\nStorage: single-flight, invalidation, races, failures and bounded queues");
  await test("100 concurrent cold reads cause exactly one backend load", async () => {
    const gate = deferred<DbDoc | null>();
    let loads = 0;
    const db = new Store({ ...driver(), load: () => { loads++; return gate.promise; } });
    const reads = Array.from({ length: 100 }, () => db.read());
    assert.equal(loads, 1);
    gate.resolve(emptyDoc());
    const results = await Promise.all(reads);
    assert.ok(results.every((doc) => doc === results[0]));
    assert.equal(loads, 1);
  });
  await test("negative hits, Bloom positives and writes never create persistent false negatives", async () => {
    let now = 1_000;
    const backend = driver();
    const db = new Store(backend, { now: () => now });
    assert.equal(await db.find("parentEmail", parent.email), null);
    assert.equal(await db.find("parentEmail", parent.email), null);
    await db.mutate((doc) => { doc.parents.push({ ...parent }); });
    assert.equal((await db.find("parentEmail", parent.email))?.record.id, parent.id);
    for (let index = 0; index < 1_000; index++) assert.equal(await db.find("parentEmail", `absent-${index}`), null);
    await db.mutate((doc) => { doc.parents = []; });
    assert.equal(await db.find("parentEmail", parent.email), null);
    // Simulate another writer. A cache refresh must also discard all misses.
    const external = emptyDoc();
    external.parents.push({ ...parent });
    await backend.save(external);
    now += 401;
    assert.equal((await db.find("parentEmail", parent.email))?.record.id, parent.id);
  });
  await test("slow pre-write reads cannot replace a committed snapshot or resurrect a session", async () => {
    const old = emptyDoc();
    old.sessions.push({ tokenHash: "revoked", parentId: parent.id, createdAt: 1, expiresAt: 1e15 });
    const gate = deferred<DbDoc | null>();
    const backend: Driver = {
      ...driver(old), load: () => gate.promise,
      transact: async (fn) => {
        const doc = structuredClone(old);
        const result = await fn(doc);
        return { doc, result };
      },
    };
    const db = new Store(backend);
    const pending = db.read();
    await db.mutate((doc) => { doc.sessions = []; doc.parents.push({ ...parent }); });
    gate.resolve(old);
    assert.equal((await pending).sessions.length, 0);
    assert.equal(await db.find("parentSession", "revoked"), null);
    assert.ok(await db.find("parentEmail", parent.email));
  });
  await test("empty-document caching also expires", async () => {
    let now = 1_000;
    let loads = 0;
    const db = new Store({ ...driver(), load: async () => { loads++; return null; } }, { now: () => now });
    await db.read(); await db.read();
    assert.equal(loads, 1);
    now += 401;
    await db.read();
    assert.equal(loads, 2);
  });
  await test("outage cooldown sheds repeated reads AND writes without touching the backend", async () => {
    let now = 1_000;
    let loads = 0;
    let saves = 0;
    let down = true;
    const db = new Store({
      ...driver(),
      load: async () => { loads++; if (down) throw new StorageError("Test database unavailable"); return emptyDoc(); },
      save: async () => { saves++; },
    }, { now: () => now });
    await assert.rejects(db.read(), (error: unknown) => error instanceof StorageError && error.retryAfterSeconds === 2);
    for (let index = 0; index < 100; index++) {
      await assert.rejects(db.read(), StorageError);
      await assert.rejects(db.mutate(() => undefined), StorageError);
    }
    assert.equal(loads, 1); assert.equal(saves, 0);
    now += 2_001; down = false;
    await db.read();
    assert.equal(loads, 2);
    await db.mutate(() => undefined);
    assert.equal(saves, 1);
  });
  await test("failed writes do not publish uncommitted records", async () => {
    let now = 1_000;
    const db = new Store({ ...driver(), save: async () => { throw new StorageError("Test write failed"); } }, { now: () => now });
    await db.read();
    await assert.rejects(db.mutate((doc) => { doc.parents.push({ ...parent }); }), StorageError);
    assert.equal((await db.read()).parents.length, 0);
    now += 3_000;
    assert.equal(await db.find("parentEmail", parent.email), null);
  });
  await test("write queue rejects overflow and recovers after draining", async () => {
    const gate = deferred<void>();
    let saves = 0;
    const db = new Store({ ...driver(), save: async () => { saves++; } }, { maxPendingWrites: 2 });
    const first = db.mutate(async () => { await gate.promise; });
    const second = db.mutate(() => undefined);
    await assert.rejects(db.mutate(() => undefined), (error: unknown) => error instanceof StorageError && error.retryAfterSeconds === 1);
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(saves, 2);
    await db.mutate(() => undefined);
    assert.equal(saves, 3);
  });

  console.log("\nRate limits, shared counters, client identification and connection leases");
  await test("token budgets allow bursts, reject excess, refill and isolate clients", () => {
    const buckets = new TokenBuckets();
    assert.ok(buckets.consume("a", smallPolicy, 0).allowed);
    assert.ok(buckets.consume("a", smallPolicy, 0).allowed);
    const blocked = buckets.consume("a", smallPolicy, 0);
    assert.ok(!blocked.allowed && blocked.status === 429 && blocked.retryAfterSeconds === 5);
    assert.ok(buckets.consume("b", smallPolicy, 0).allowed);
    assert.ok(buckets.consume("a", smallPolicy, 5_000).allowed);
  });
  await test("new-client floods cannot evict a live rate-limit bucket", () => {
    const buckets = new TokenBuckets(1);
    buckets.consume("a", smallPolicy, 0); buckets.consume("a", smallPolicy, 0);
    const full = buckets.consume("b", smallPolicy, 0);
    assert.ok(!full.allowed && full.status === 503);
    assert.equal(buckets.consume("a", smallPolicy, 0).allowed, false);
    assert.equal(buckets.size, 1);
    assert.ok(buckets.consume("b", smallPolicy, 10_001).allowed);
  });
  await test("two app instances share atomic quotas; rejected floods do not keep calling the cache", async () => {
    const counts = new Map<string, number>();
    let calls = 0;
    const counter = { increment: async (key: string) => { calls++; const count = (counts.get(key) ?? 0) + 1; counts.set(key, count); return count; } };
    const one = new RateLimiter(counter);
    const two = new RateLimiter(counter);
    assert.ok((await one.consume("shared-client", smallPolicy, 1_000)).allowed);
    assert.ok((await two.consume("shared-client", smallPolicy, 1_000)).allowed);
    const denied = await one.consume("shared-client", smallPolicy, 1_000);
    assert.ok(!denied.allowed && denied.status === 429 && denied.retryAfterSeconds === 9);
    assert.equal((await one.consume("shared-client", smallPolicy, 1_000)).allowed, false);
    assert.equal(calls, 3);
    const high: RatePolicy = { name: "denial-cache", limit: 100, windowMs: 60_000 };
    let probes = 0;
    const flooded = new RateLimiter({ increment: async () => { probes++; return 101; } });
    await flooded.consume("blocked", high, 1_000);
    const again = await flooded.consume("blocked", high, 2_000);
    assert.ok(!again.allowed && again.retryAfterSeconds === 58);
    assert.equal(probes, 1);
    assert.ok([...counts.keys()].every((key) => !key.includes("shared-client")));
  });
  await test("shared-cache failure fails closed for sensitive actions but preserves bounded ordinary reads", async () => {
    const limiter = new RateLimiter({ increment: async () => { throw new Error("cache offline"); } });
    assert.ok((await limiter.consume("read", smallPolicy, 0)).allowed);
    const sensitive = await limiter.consume("auth", { ...smallPolicy, critical: true }, 0);
    assert.ok(!sensitive.allowed && sensitive.status === 503 && sensitive.retryAfterSeconds === 5);
  });
  await test("Memcached operations have a timeout and a cooldown (no retry storm)", async () => {
    let calls = 0;
    const cache = new SharedCache({
      get: (_key, callback) => { calls++; callback(new Error("offline"), null); },
      set: () => { calls++; }, increment: () => { calls++; },
    } satisfies MemcachedClient);
    await assert.rejects(cache.get("one"));
    await assert.rejects(cache.set("two", "value", 1));
    assert.equal(calls, 1);
    const hanging = new SharedCache({ get: () => {}, set: () => {}, increment: () => {} });
    await assert.rejects(hanging.get("timeout"), /timed out/);
    const largeItem = new SharedCache({
      get: (_key, callback) => callback(null, null),
      set: (_key, _value, _options, callback) => callback(new Error("MemJS SET: Value too large")),
      increment: (_key, _amount, _options, callback) => callback(null, true, 1),
    });
    await assert.rejects(largeItem.set("doc", "oversized", 1));
    assert.equal(await largeItem.increment("quota", 1), 1);
  });
  await test("proxy headers are opt-in, keys are private and IPv6 address rotation shares a /64", () => {
    const req = new Request("https://test/api", { headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" } });
    process.env.BRAINYKIDS_TRUST_PROXY = "false";
    assert.equal(clientAddress(req), "unknown");
    process.env.BRAINYKIDS_TRUST_PROXY = "true";
    assert.equal(clientAddress(req), "203.0.113.8");
    assert.equal(requestClientKey(req).includes("203.0.113.8"), false);
    assert.equal(normaliseClientAddress("2001:db8:abcd:1::1"), normaliseClientAddress("2001:0DB8:ABCD:0001:1234::9"));
    assert.notEqual(normaliseClientAddress("2001:db8:abcd:1::1"), normaliseClientAddress("2001:db8:abcd:2::1"));
    assert.equal(normaliseClientAddress("::ffff:203.0.113.8"), "203.0.113.8");
    assert.equal(normaliseClientAddress("fe80::1%eth0"), null);
    assert.equal(normaliseClientAddress("not-an-address"), null);
    const fallback = new Request("https://test/api", { headers: { "x-forwarded-for": "invalid", "x-real-ip": "203.0.113.9" } });
    assert.equal(clientAddress(fallback), "203.0.113.9");
  });
  await test("varying resource IDs and query strings do not create fresh route budgets", () => {
    assert.equal(requestPolicy(new Request("https://test/api/kids/one?x=1")).name, requestPolicy(new Request("https://test/api/kids/two?x=2")).name);
    assert.equal(requestPolicy(new Request("https://test/api/auth/%6Cogin/")).name, "parent-login");
    assert.equal(requestPolicy(new Request("https://test/api/auth/LOGIN")).name, "parent-login");
  });
  await test("leases enforce per-client/global concurrency, expire, and release idempotently", () => {
    const limiter = new ConnectionLimiter(2, 1);
    const release = limiter.acquire("a", 100, 0);
    assert.throws(() => limiter.acquire("a", 100, 0), (error: unknown) => error instanceof RequestProtectionError && error.status === 429);
    limiter.acquire("b", 100, 0);
    assert.throws(() => limiter.acquire("c", 100, 0), (error: unknown) => error instanceof RequestProtectionError && error.status === 503);
    release(); release();
    assert.equal(limiter.size, 1);
    limiter.acquire("c", 100, 101);
    assert.equal(limiter.size, 1);
  });
  await test("concurrency is bounded before slow remote quota I/O, not after it", async () => {
    const original = RateLimiter.prototype.consume;
    const gate = deferred<{ allowed: true; remaining: number; retryAfterSeconds: 0 }>();
    let probes = 0;
    RateLimiter.prototype.consume = async () => { probes++; return gate.promise; };
    const req = () => new Request("http://test/api/test", { headers: { "x-forwarded-for": "198.51.100.203" } });
    const pending = Array.from({ length: 16 }, () => protectRequest(req()));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const rejected = await Promise.race([
        protectRequest(req()).then((release) => { release(); return null; }, (error: unknown) => error),
        new Promise((resolve) => { timeout = setTimeout(() => resolve(null), 100); }),
      ]);
      assert.ok(rejected instanceof RequestProtectionError && rejected.status === 429);
      assert.equal(probes, 16);
    } finally {
      if (timeout) clearTimeout(timeout);
      gate.resolve({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
      for (const release of await Promise.all(pending)) release();
      RateLimiter.prototype.consume = original;
    }
  });
  await test("stream leases are held until cancellation or abort, not just headers", async () => {
    const limiter = new ConnectionLimiter();
    let cancelled = 0;
    const source = () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("hello")); },
      cancel() { cancelled++; },
    }), { headers: { "content-type": "text/event-stream" } });
    const abort = new AbortController();
    const response = holdStreamLease(source(), abort.signal, limiter.acquire("a"));
    assert.equal(limiter.size, 1);
    const reader = response.body!.getReader();
    await reader.read(); await reader.cancel();
    assert.equal(limiter.size, 0); assert.equal(cancelled, 1);
    const aborted = holdStreamLease(source(), abort.signal, limiter.acquire("a"));
    abort.abort();
    assert.equal(limiter.size, 0);
    await aborted.body!.cancel();
    assert.equal(cancelled, 2);
  });

  console.log("\nHTTP: reject early, bound bytes, preserve no-store and advertise retry delays");
  await test("declared, chunked and multi-byte bodies are bounded by bytes before JSON parsing", async () => {
    assert.throws(() => checkBodyLength(new Request("http://test/api", { headers: { "content-length": "64001" } })), (error: unknown) => error instanceof StorageError && error.status === 413);
    assert.throws(() => checkBodyLength(new Request("http://test/api", { headers: { "content-length": "-1" } })), StorageError);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(64_001)); },
      cancel() { cancelled = true; },
    });
    const chunked = new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    await assert.rejects(readBody(chunked), (error: unknown) => error instanceof StorageError && error.status === 413);
    assert.equal(cancelled, true);
    const unicode = new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "🙂".repeat(17_000) }) });
    await assert.rejects(readBody(unicode), (error: unknown) => error instanceof StorageError && error.status === 413);
    assert.deepEqual(await readBody(new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: '{"ok":true}' })), { ok: true });
  });
  await test("wrapper rejects excess requests before the handler and sends Retry-After/no-store", async () => {
    let handlers = 0;
    const wrapped = route<Request>(() => { handlers++; return json({ ok: true }); });
    const req = () => new Request("http://test/api/storage", { headers: { "x-forwarded-for": "198.51.100.201" } });
    for (let index = 0; index < 6; index++) assert.equal((await wrapped(req(), undefined)).status, 200);
    const blocked = await wrapped(req(), undefined);
    assert.equal(blocked.status, 429); assert.equal(handlers, 6);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(blocked.headers.get("cache-control"), "no-store");
    assert.equal(blocked.headers.get("ratelimit-remaining"), "0");
  });
  await test("oversized bodies and cross-origin writes never reach the route handler", async () => {
    let handlers = 0;
    const wrapped = route<Request>(() => { handlers++; return json({ ok: true }); });
    const large = new Request("http://test/api/test", { method: "POST", headers: { "content-length": "999999999", "x-forwarded-for": "198.51.100.202" } });
    assert.equal((await wrapped(large, undefined)).status, 413);
    const cross = new Request("http://test/api/test", { method: "POST", headers: { origin: "https://elsewhere.test", host: "test" } });
    assert.equal((await wrapped(cross, undefined)).status, 403);
    assert.equal(handlers, 0);
    assert.equal(json({}, { headers: new Headers({ "Retry-After": "3" }) }).headers.get("retry-after"), "3");
  });
  console.log(`\nAll ${checks} request-protection checks passed.\n`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
