// Regression guard for the central security headers in src/middleware.ts.
// Exercises the pure policy/header builders directly and the middleware end to end.
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { buildCsp, middleware, newNonce, securityHeaderValues } from "../src/middleware";

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

async function main() {
  const savedNodeEnv = process.env.NODE_ENV;
  // `process.env.NODE_ENV` is typed read-only by Next's declarations, so assign
  // through Object.assign; the middleware reads it on every call.
  const setNodeEnv = (value: string) => {
    Object.assign(process.env, { NODE_ENV: value });
  };
  setNodeEnv("production");
  let tests = 0;
  const test = async (name: string, run: () => void | Promise<void>) => {
    await run();
    tests++;
    console.log(`  ✓ ${name}`);
  };

  try {
    console.log("\nSecurity headers: central middleware");
    await test("the CSP carries the safe baseline directives", () => {
      const csp = buildCsp(newNonce(), true);
      assert.match(csp, /^default-src 'self'/);
      assert.ok(csp.includes("object-src 'none'"), "object-src none");
      assert.ok(csp.includes("base-uri 'none'"), "base-uri none");
      assert.ok(csp.includes("frame-ancestors 'none'"), "frame-ancestors none");
      assert.ok(csp.includes("form-action 'self'"), "form-action self");
      assert.ok(csp.includes("connect-src 'self'"), "connect-src self");
      assert.ok(csp.includes("upgrade-insecure-requests"), "upgrade insecure when asked");
      assert.ok(!buildCsp(newNonce(), false).includes("upgrade-insecure-requests"), "not always");
    });
    await test("script-src never falls back to unsafe-inline or unsafe-eval", () => {
      const csp = buildCsp(newNonce(), true);
      const scriptSrc = csp.split("script-src")[1]?.split(";")[0] ?? "";
      assert.ok(!/unsafe-inline/.test(scriptSrc), "no unsafe-inline in script-src");
      assert.ok(!/unsafe-eval/.test(scriptSrc), "no unsafe-eval in script-src");
      assert.match(scriptSrc, /'nonce-[A-Za-z0-9_-]+'/, "a nonce is present");
    });
    await test("a fresh, well-formed nonce is minted per call", () => {
      const a = newNonce();
      const b = newNonce();
      assert.ok(a.length >= 16 && /^[A-Za-z0-9_-]+$/.test(a), `well-formed nonce (${a})`);
      assert.notEqual(a, b, "nonces differ");
    });
    await test("production over https enforces the CSP and adds HSTS", () => {
      const headers = securityHeaderValues(buildCsp(newNonce(), true), { production: true, secure: true });
      assert.match(headers["Content-Security-Policy"] ?? "", /script-src 'self' 'nonce-/);
      assert.equal(headers["Content-Security-Policy-Report-Only"], undefined);
      assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
    });
    await test("plain http in production gets the CSP but no HSTS", () => {
      const headers = securityHeaderValues(buildCsp(newNonce(), false), { production: true, secure: false });
      assert.ok(headers["Content-Security-Policy"] !== undefined, "CSP enforced");
      assert.equal(headers["Strict-Transport-Security"], undefined);
    });
    await test("development sends the policy as report-only so local dev is never blocked", () => {
      const headers = securityHeaderValues(buildCsp(newNonce(), false), { production: false, secure: false });
      assert.equal(headers["Content-Security-Policy"], undefined);
      assert.match(headers["Content-Security-Policy-Report-Only"] ?? "", /script-src 'self' 'nonce-/);
    });
    await test("the usual hardening headers are present on every request", () => {
      const res = middleware(req("https://brainykids.test/api/storage", { host: "brainykids.test" }));
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      assert.match(res.headers.get("content-security-policy") ?? "", /script-src 'self' 'nonce-/);
    });
    await test("Permissions-Policy denies unused device APIs but leaves microphone for speech-to-text", () => {
      const pp = securityHeaderValues(buildCsp(newNonce(), false), { production: true, secure: true })["Permissions-Policy"];
      assert.ok(/camera=\(\)/.test(pp), "camera denied");
      assert.ok(/geolocation=\(\)/.test(pp), "geolocation denied");
      assert.ok(/payment=\(\)/.test(pp), "payment denied");
      assert.ok(!/microphone/.test(pp), "microphone allowed for speech-to-text");
    });
    await test("HSTS never carries preload", () => {
      const hsts = securityHeaderValues(buildCsp(newNonce(), true), { production: true, secure: true })["Strict-Transport-Security"];
      assert.ok(hsts && !/preload/.test(hsts), "no preload");
    });
    console.log(`\nAll ${tests} security-header checks passed.`);
  } finally {
    setNodeEnv(savedNodeEnv ?? "development");
  }
}

void main();
