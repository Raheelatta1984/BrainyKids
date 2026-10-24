// Uses an isolated temporary FILE store. Never connects to a configured database/cache.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST as parentLogin } from "../src/app/api/auth/login/route";
import { POST as recovery } from "../src/app/api/auth/recovery/route";
import { POST as signup } from "../src/app/api/auth/signup/route";
import { POST as passkeyOptions } from "../src/app/api/auth/passkey/login/options/route";
import { POST as passkeyVerify } from "../src/app/api/auth/passkey/login/verify/route";
import { POST as diagnostics } from "../src/app/api/diagnostics/route";
import { GET as events } from "../src/app/api/events/route";
import { POST as heartbeat } from "../src/app/api/kid-session/heartbeat/route";
import { POST as kidLogin } from "../src/app/api/kid-session/login/route";
import { POST as nextQuestion } from "../src/app/api/kid-session/questions/next/route";
import { COOKIES, hashSecret, newToken, tokenHash } from "../src/lib/server/auth";
import { createKidRecord } from "../src/lib/server/service";
import { deviceAuth, parentAuth } from "../src/lib/server/session";
import { newId, store, type KidRecord, type ParentRecord } from "../src/lib/server/store";

function req(endpoint: string, body: unknown = {}, ip = "192.0.2.10", cookie?: string, method = "POST") {
  return new NextRequest(`http://brainykids.test${endpoint}`, {
    method, headers: { host: "brainykids.test", "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
function cookieFrom(response: Response, name: string): string {
  const match = response.headers.get("set-cookie")?.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  assert.ok(match, `missing ${name} cookie`);
  return `${name}=${match[1]}`;
}

async function main() {
  for (const key of Object.keys(process.env)) {
    if (/(?:DATABASE_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|URL_NON_POOLING|URL_UNPOOLED)$/.test(key) || /^(PGHOST|PGUSER|PGPASSWORD|MEMCACHED_SERVERS)$/.test(key)) delete process.env[key];
  }
  process.env.BRAINYKIDS_SECRET = "request-routes-selftest-only";
  process.env.BRAINYKIDS_TRUST_PROXY = "true";
  const dir = await mkdtemp(path.join(os.tmpdir(), "brainykids-request-test-"));
  process.env.BRAINYKIDS_DATA_DIR = dir;
  const originalMutate = store.mutate;
  const originalRead = store.read;
  const originalFind = store.find;
  let writes = 0;
  const tracked: typeof store.mutate = (fn) => { writes++; return originalMutate(fn); };
  store.mutate = tracked;
  const password = "selftest-password-strong";
  const parent: ParentRecord = { id: newId(), name: "Test Parent", email: "parent@example.test", passwordHash: hashSecret(password), recoveryHash: hashSecret("ABCD1234EFGH5678"), createdAt: Date.now() };
  let kid!: KidRecord;
  let tests = 0;
  const test = async (name: string, run: () => Promise<void>) => { await run(); tests++; console.log(`  ✓ ${name}`); };
  // Also drains any intentionally asynchronous, authenticated behavioural logging.
  const drain = async () => { await originalMutate(() => undefined); await new Promise((done) => setTimeout(done, 10)); };
  try {
    await originalMutate((doc) => {
      doc.parents.push(parent);
      kid = createKidRecord(doc, parent.id, { name: "Test Kid", username: "kid.test", age: 7, gender: "prefer-not-to-say", theme: "space", pinHash: hashSecret("1234") });
    });
    console.log("\nAPI routes: actual handlers against an isolated store");
    await test("missing accounts, wrong passwords/PINs and unknown recovery emails produce zero writes", async () => {
      writes = 0;
      for (let index = 0; index < 3; index++) {
        assert.equal((await parentLogin(req("/api/auth/login", { email: "missing@example.test", password }), undefined)).status, 401);
        assert.equal((await kidLogin(req("/api/kid-session/login", { username: "missing.kid", pin: "1234" }), undefined)).status, 401);
        assert.equal((await recovery(req("/api/auth/recovery", { email: "missing@example.test", code: "ABCD1234", password }, "192.0.2.11"), undefined)).status, 401);
      }
      assert.equal((await parentLogin(req("/api/auth/login", { email: parent.email, password: "wrong" }), undefined)).status, 401);
      assert.equal((await kidLogin(req("/api/kid-session/login", { username: kid.username, pin: "9999" }), undefined)).status, 401);
      assert.equal(writes, 0);
    });
    let parentCookie = "";
    let kidCookie = "";
    await test("correct credentials still issue sessions/devices and HttpOnly, no-store responses", async () => {
      writes = 0;
      const signedIn = await parentLogin(req("/api/auth/login", { email: parent.email, password }), undefined);
      assert.equal(signedIn.status, 200); assert.equal(writes, 1);
      parentCookie = cookieFrom(signedIn, COOKIES.parent);
      assert.ok(signedIn.headers.get("set-cookie")?.includes("HttpOnly"));
      assert.equal(signedIn.headers.get("cache-control"), "no-store");
      const kidSignedIn = await kidLogin(req("/api/kid-session/login", { username: kid.username, pin: "1234" }), undefined);
      assert.equal(kidSignedIn.status, 200);
      kidCookie = cookieFrom(kidSignedIn, COOKIES.device);
      assert.ok(await parentAuth(req("/api/test", {}, "192.0.2.12", parentCookie)));
      assert.ok(await deviceAuth(req("/api/test", {}, "192.0.2.12", kidCookie)));
      await drain();
    });
    await test("a prior negative lookup cannot hide a newly created account", async () => {
      await originalMutate((doc) => { doc.parents.push({ ...parent, id: newId(), email: "missing@example.test" }); });
      const result = await parentLogin(req("/api/auth/login", { email: "missing@example.test", password }), undefined);
      assert.equal(result.status, 200);
    });
    await test("a password reset racing verification cannot create an old-password session", async () => {
      const before = (await originalRead()).sessions.length;
      store.mutate = async (fn) => {
        store.mutate = tracked;
        await originalMutate((doc) => { doc.parents.find((item) => item.id === parent.id)!.passwordHash = hashSecret("changed-during-request"); });
        return tracked(fn);
      };
      try {
        assert.equal((await parentLogin(req("/api/auth/login", { email: parent.email, password }), undefined)).status, 401);
        assert.equal((await originalRead()).sessions.length, before);
      } finally { store.mutate = tracked; }
    });
    await test("duplicate heartbeats and resuming an active question do not write", async () => {
      writes = 0;
      for (let index = 0; index < 2; index++) {
        assert.equal((await heartbeat(req("/api/kid-session/heartbeat", {}, "192.0.2.13", kidCookie), undefined)).status, 200);
      }
      assert.equal(writes, 0);
      const first = await nextQuestion(req("/api/kid-session/questions/next", { level: 1 }, "192.0.2.13", kidCookie), undefined);
      assert.equal(first.status, 200); assert.equal(writes, 1);
      const issued = await first.json();
      writes = 0;
      const second = await nextQuestion(req("/api/kid-session/questions/next", { level: 1 }, "192.0.2.13", kidCookie), undefined);
      const resumed = await second.json();
      assert.equal(second.status, 200); assert.equal(writes, 0);
      assert.equal(resumed.question.id, issued.question.id);
      assert.equal("answer" in resumed.question, false); assert.equal("explain" in resumed.question, false);
    });
    await test("empty passkey options and unknown challenges do not allocate or mutate records", async () => {
      writes = 0;
      const options = await passkeyOptions(req("/api/auth/passkey/login/options", {}, "192.0.2.14"), undefined);
      assert.equal(options.status, 200); assert.equal((await options.json()).available, false);
      const verify = await passkeyVerify(req("/api/auth/passkey/login/verify", { id: "unknown", credential: {} }, "192.0.2.14"), undefined);
      assert.equal(verify.status, 401); assert.equal(writes, 0);
      assert.equal((await originalRead()).challenges.length, 0);
    });
    await test("malformed signup requests are counted/throttled WITHOUT database writes or diagnostic writes", async () => {
      writes = 0;
      for (let index = 0; index < 10; index++) {
        const malformed = new NextRequest("http://brainykids.test/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.15" }, body: "{" });
        assert.equal((await signup(malformed, undefined)).status, 400);
      }
      const blocked = await signup(req("/api/auth/signup", {}, "192.0.2.15"), undefined);
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
      assert.equal(writes, 0);
    });
    await test("valid signup uses one atomic mutation; the durable daily account cap still applies", async () => {
      writes = 0;
      for (let index = 0; index < 3; index++) {
        const response = await signup(req("/api/auth/signup", { name: "New Parent", email: `new-${index}@example.test`, password }, "192.0.2.16"), undefined);
        assert.equal(response.status, 200);
        assert.ok((await response.json()).recoveryCode);
        assert.equal(writes, index + 1);
      }
      const blocked = await signup(req("/api/auth/signup", { name: "New Parent", email: "new-four@example.test", password }, "192.0.2.16"), undefined);
      assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get("retry-after")) > 80_000);
      assert.equal((await originalRead()).parents.some((item) => item.email === "new-four@example.test"), false);
    });
    await test("account recovery still persists real-account failure counters and enforces existing locks", async () => {
      writes = 0;
      assert.equal((await recovery(req("/api/auth/recovery", { email: parent.email, code: "WRONGCODE", password }, "192.0.2.17"), undefined)).status, 401);
      assert.equal(writes, 1);
      assert.equal((await originalRead()).parents.find((item) => item.id === parent.id)!.recoveryFailures, 1);
      await originalMutate((doc) => { doc.parents.find((item) => item.id === parent.id)!.recoveryLockedUntil = Date.now() + 60_000; });
      writes = 0;
      assert.equal((await recovery(req("/api/auth/recovery", { email: parent.email, code: "WRONGCODE", password }, "192.0.2.17"), undefined)).status, 401);
      assert.equal(writes, 0);
    });
    await test("malformed cookies, guest telemetry and unauthenticated streams do not touch storage", async () => {
      let accesses = 0;
      store.read = () => { accesses++; return originalRead(); };
      store.find = (kind, value) => { accesses++; return originalFind(kind, value); };
      writes = 0;
      try {
        assert.equal(await parentAuth(req("/api/test", {}, "192.0.2.18", `${COOKIES.parent}=garbage`)), null);
        assert.equal(await deviceAuth(req("/api/test", {}, "192.0.2.18", `${COOKIES.device}=garbage`)), null);
        const guest = await diagnostics(req("/api/diagnostics", { events: [{ code: "server.api_error" }] }, "192.0.2.18"), undefined);
        assert.deepEqual(await guest.json(), { ok: true, logged: 0 });
        assert.equal((await events(req("/api/events", {}, "192.0.2.18", undefined, "GET"), undefined)).status, 401);
        assert.equal(accesses, 0); assert.equal(writes, 0);
      } finally { store.read = originalRead; store.find = originalFind; }
    });
    await test("revocation and session/device expiration still win over cache hints", async () => {
      const expired = newToken();
      const oldDevice = newToken();
      await originalMutate((doc) => {
        doc.sessions.push({ tokenHash: tokenHash(expired), parentId: parent.id, createdAt: 1, expiresAt: Date.now() - 1 });
        doc.devices.push({ id: newId(), tokenHash: tokenHash(oldDevice), parentId: parent.id, kidId: kid.id, label: "Old", createdAt: 1, lastSeenAt: 1 });
      });
      assert.equal(await parentAuth(req("/api/test", {}, "192.0.2.19", `${COOKIES.parent}=${expired}`)), null);
      assert.equal(await deviceAuth(req("/api/test", {}, "192.0.2.19", `${COOKIES.device}=${oldDevice}`)), null);
      assert.ok(await parentAuth(req("/api/test", {}, "192.0.2.19", parentCookie)));
      await originalMutate((doc) => { doc.sessions = []; doc.devices = []; });
      assert.equal(await parentAuth(req("/api/test", {}, "192.0.2.19", parentCookie)), null);
      assert.equal(await deviceAuth(req("/api/test", {}, "192.0.2.19", kidCookie)), null);
    });
    console.log(`\nAll ${tests} API route checks passed.\n`);
  } finally {
    store.mutate = originalMutate; store.read = originalRead; store.find = originalFind;
    await drain();
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
