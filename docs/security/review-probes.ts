/** Evidence probes for the 2026-10-16 review, NOT security regression gates.
 * These PASS when the reviewed insecure behaviour is present. After remediation,
 * replace them with tests asserting rejection. Uses dummy data and in-memory mocks.
 * Run: npx tsx docs/security/review-probes.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { COOKIES, signPayload, verifyPayload } from "../../src/lib/server/auth";
import { relyingParty } from "../../src/lib/server/webauthn";
import { readBody } from "../../src/lib/server/http";
import { behaviourFrom } from "../../src/lib/server/diagnostics";
import { deviceAuth, setDeviceSessionCookies } from "../../src/lib/server/session";
import { earnedSums } from "../../src/lib/server/views";
import { createKidRecord, issueNextQuestion, linkDevice, recordAnswer } from "../../src/lib/server/service";
import { appendReward, emptyDoc, MAX_REWARDS, store, type ParentRecord } from "../../src/lib/server/store";

async function main() {
  const env = { ...process.env };
  const originalInfo = store.info;
  const originalMutate = store.mutate;
  let count = 0;
  function confirmed(label: string) { count++; console.log(`CONFIRMED ${count}: ${label}`); }
  try {
    for (const name of ["BRAINYKIDS_SECRET", "DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"]) delete process.env[name];
    const body = Buffer.from(JSON.stringify({ reviewProbe: true })).toString("base64url");
    const key = crypto.createHash("sha256").update("brainykids-serverless-continuity-v1").digest();
    const signature = crypto.createHmac("sha256", key).update(body).digest("base64url");
    assert.deepEqual(verifyPayload(`${body}.${signature}`), { reviewProbe: true });
    confirmed("known fallback key accepts externally signed dummy payload");

    process.env.BRAINYKIDS_ORIGINS = "https://trusted.example";
    const rp = relyingParty(new Request("https://trusted.example", {
      headers: { host: "trusted.example", origin: "https://untrusted.example" },
    }));
    assert(rp.origins.includes("https://untrusted.example"));
    confirmed("configured WebAuthn origin list is widened by request Origin");

    const parsed = await readBody(new Request("https://trusted.example", {
      method: "POST", body: JSON.stringify({ text: "x".repeat(65000) }),
    }));
    assert.deepEqual(parsed, {});
    confirmed("oversized JSON body becomes empty object, not HTTP 413");

    const doc = emptyDoc();
    const parent: ParentRecord = {
      id: "review-parent", name: "Review fixture", email: "review@example.invalid",
      passwordHash: "dummy-parent-hash", recoveryHash: "dummy-recovery-hash", createdAt: 1,
    };
    doc.parents.push(parent);
    const kid = createKidRecord(doc, parent.id, {
      name: "Review fixture", username: "reviewfixture", pinHash: "dummy-pin-hash",
      age: 8, gender: "prefer-not-to-say", theme: "space",
    });
    const { token, device } = linkDevice(doc, kid, "Review fixture");
    device.createdAt = Date.now() - 181 * 86400000;
    const res = NextResponse.json({});
    setDeviceSessionCookies(res, token, device, kid, parent);
    const backup = res.cookies.get(COOKIES.deviceState)!.value;
    const decoded = JSON.parse(Buffer.from(backup.split(".")[0], "base64url").toString());
    assert.equal(decoded.parent.passwordHash, parent.passwordHash);
    assert.equal(decoded.parent.recoveryHash, parent.recoveryHash);
    assert.equal(decoded.kid.pinHash, kid.pinHash);
    confirmed("device backup cookie decodes to parent password/recovery hashes and kid PIN hash");

    const req = new NextRequest("https://trusted.example/api/snapshot", {
      headers: { cookie: `${COOKIES.device}=${token}; ${COOKIES.deviceState}=${backup}` },
    });
    assert(await deviceAuth(req, doc));
    confirmed("device older than 180 days authenticates without server-side expiry");

    doc.devices = [];
    store.info = () => ({ ...originalInfo(), durable: false });
    store.mutate = async (fn) => fn(doc);
    assert(await deviceAuth(req, doc));
    assert.equal(doc.devices.length, 1);
    confirmed("removed device is restored from backup in non-durable mode");

    const telemetry = emptyDoc();
    telemetry.behaviour = [{ parentId: null, code: "storage.error" }] as typeof telemetry.behaviour;
    assert.equal(behaviourFrom(telemetry, { parentId: "other-family" }).length, 1);
    confirmed("unattributed diagnostic entry is visible in another family scope");

    const quizDoc = emptyDoc();
    const quizKid = createKidRecord(quizDoc, parent.id, {
      name: "Quiz fixture", username: "quizfixture", pinHash: "dummy-pin-hash",
      age: 8, gender: "prefer-not-to-say", theme: "space",
    });
    const question = issueNextQuestion(quizDoc, quizKid, 1)!;
    const wireQuestion = JSON.parse(JSON.stringify(question));
    assert.equal(typeof wireQuestion.answer, "string");
    assert.equal(typeof wireQuestion.explain, "string");
    confirmed("next-question result contains canonical answer and explanation before submission");
    const originalNow = Date.now;
    const later = originalNow() + 3600000;
    try {
      Date.now = () => later;
      const result = recordAnswer(quizDoc, quizKid, question.id, question.answer, 1, { elapsedSeconds: 0 });
      assert.equal(result?.correct, true);
      assert.equal(result?.timedOut, false);
      confirmed("hour-old question is accepted when client reports elapsedSeconds=0");
    } finally { Date.now = originalNow; }

    assert(earnedSums(quizDoc, quizKid).today > 0);
    const earned = quizDoc.rewards.find((entry) => entry.type === "earned")!;
    for (let i = 0; i < MAX_REWARDS; i++) {
      appendReward(quizDoc, { ...earned, id: `other-${i}`, parentId: "other-family", kidId: "other-kid" });
    }
    assert.equal(earnedSums(quizDoc, quizKid).today, 0);
    confirmed("other-family ledger traffic erases daily/weekly earned totals via global truncation");

    assert.equal(verifyPayload(signPayload({ sensitive: "dummy" }))?.constructor, Object);
    console.log(`${count} evidence probes confirmed; no live service or production data used.`);
  } finally {
    store.info = originalInfo;
    store.mutate = originalMutate;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
