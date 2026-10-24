import assert from "node:assert/strict";
import { request, retryAfterSeconds } from "../src/lib/client/request";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const reply = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers });

async function main() {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  let tests = 0;
  const test = async (name: string, run: () => void | Promise<void>) => { await run(); tests++; console.log(`  ✓ ${name}`); };
  try {
    console.log("\nBrowser request load reduction");
    await test("identical concurrent GETs share one network request, but successes are never retained", async () => {
      let calls = 0;
      const gate = deferred<Response>();
      globalThis.fetch = async (_input, init) => {
        calls++;
        assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store");
        return gate.promise;
      };
      const one = request<{ count: number }>("/api/get-singleflight");
      const two = request<{ count: number }>("/api/get-singleflight");
      assert.equal(calls, 1);
      gate.resolve(reply({ count: 1 }));
      assert.deepEqual(await one, await two);
      globalThis.fetch = async () => { calls++; return reply({ count: calls }); };
      const next = await request<{ count: number }>("/api/get-singleflight");
      assert.ok(next.ok && next.data.count === 2);
    });
    await test("mutations are not coalesced or replayed", async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return reply({ ok: true }); };
      await Promise.all([request("/api/write", { method: "POST", body: "{}" }), request("/api/write", { method: "POST", body: "{}" })]);
      assert.equal(calls, 2);
    });
    await test("an auth mutation invalidates pre-mutation GET flights", async () => {
      let reads = 0;
      const old = deferred<Response>();
      globalThis.fetch = async (_input, init) => {
        if (init?.method === "POST") return reply({ ok: true });
        reads++;
        return reads === 1 ? old.promise : reply({ role: "parent" });
      };
      const before = request("/api/auth-snapshot-test");
      await request("/api/auth-change-test", { method: "POST" });
      const after = await request<{ role: string }>("/api/auth-snapshot-test");
      assert.ok(after.ok && after.data.role === "parent"); assert.equal(reads, 2);
      old.resolve(reply({ role: "guest" })); await before;
    });
    await test("429 cooldown suppresses retries even when query parameters change, then expires", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return calls === 1 ? reply({ error: "Please wait" }, 429, { "Retry-After": "10" }) : reply({ ok: true });
      };
      const first = await request("/api/backoff?cursor=1");
      assert.ok(!first.ok && first.retryAfterSeconds === 10);
      now += 1_000;
      const held = await request("/api/backoff?cursor=2");
      assert.ok(!held.ok && held.status === 429 && held.retryAfterSeconds === 9);
      assert.equal(calls, 1);
      now += 9_001;
      assert.ok((await request("/api/backoff?cursor=3")).ok); assert.equal(calls, 2);
    });
    await test("503/date Retry-After is respected, and POSTs are not automatically retried", async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return reply({ error: "Busy" }, 503, { "Retry-After": new Date(now + 5_000).toUTCString() }); };
      await request("/api/post-cooldown", { method: "POST", body: "{}" });
      const second = await request("/api/post-cooldown", { method: "POST", body: "{}" });
      assert.ok(!second.ok && second.status === 503 && second.retryAfterSeconds === 5); assert.equal(calls, 1);
      assert.equal(retryAfterSeconds("not-a-date", now), undefined);
      assert.equal(retryAfterSeconds("999999999", now), 86_400);
      assert.equal(retryAfterSeconds("0", now), 1);
    });
    await test("401 and network failures are not cached as authentication state", async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return reply({ error: "Not signed in" }, 401); };
      await request("/api/not-authenticated"); await request("/api/not-authenticated");
      assert.equal(calls, 2);
      globalThis.fetch = async () => { calls++; throw new Error("offline"); };
      const result = await request("/api/network-test");
      assert.ok(!result.ok && result.status === -1);
      await request("/api/network-test"); assert.equal(calls, 4);
    });
    await test("GETs with independent abort signals are not shared", async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return reply({ ok: true }); };
      await Promise.all([
        request("/api/abort-test", undefined, { signal: new AbortController().signal }),
        request("/api/abort-test", undefined, { signal: new AbortController().signal }),
      ]);
      assert.equal(calls, 2);
      globalThis.fetch = async (_input, init) => {
        calls++;
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("x-test"), "custom");
        return reply({ ok: true });
      };
      await Promise.all([
        request("/api/custom-context", { headers: new Headers({ "x-test": "custom" }) }),
        request("/api/custom-context", { headers: { "x-test": "custom" } }),
      ]);
      assert.equal(calls, 4);
    });
    console.log(`\nAll ${tests} browser request checks passed.\n`);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
