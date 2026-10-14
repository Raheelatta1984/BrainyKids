/**
 * Fingerprint / face unlock self-test.
 *
 * The server half of WebAuthn (CBOR, COSE keys, signature checks) is exercised
 * with a fake authenticator built out of Node's own crypto — no browser, no
 * dependencies, no network. Run it with:
 *
 *     npm run selftest
 *
 * It covers both supported key types (ES256 and RS256) and the checks that make
 * the ceremony safe: challenge, origin, relying party id, signature and the
 * signature counter.
 */

import crypto from "node:crypto";
import {
  COSE_ALG_ES256,
  COSE_ALG_RS256,
  relyingParty,
  verifyAssertion,
  verifyRegistration,
  WebAuthnError,
  type WebAuthnResponse,
} from "../src/lib/server/webauthn";
import { normaliseDatabaseConfig, resolveDatabaseEnv } from "../src/lib/server/store";
import { signPayload, verifyPayload } from "../src/lib/server/auth";

// ---------------------------------------------------------------- CBOR writer --

function cborLength(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  if (length < 65536) {
    const out = Buffer.alloc(3);
    out[0] = (major << 5) | 25;
    out.writeUInt16BE(length, 1);
    return out;
  }
  const out = Buffer.alloc(5);
  out[0] = (major << 5) | 26;
  out.writeUInt32BE(length, 1);
  return out;
}

function cbor(value: unknown): Buffer {
  if (typeof value === "number") {
    if (value >= 0) return cborLength(0, value);
    return cborLength(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([cborLength(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([cborLength(2, value.length), Buffer.from(value)]);
  if (Array.isArray(value)) return Buffer.concat([cborLength(4, value.length), ...value.map(cbor)]);
  if (value instanceof Map) {
    const parts: Buffer[] = [];
    for (const [k, v] of value) parts.push(cbor(k), cbor(v));
    return Buffer.concat([cborLength(5, value.size), ...parts]);
  }
  throw new Error(`Cannot encode ${String(value)}`);
}

// --------------------------------------------------------- fake authenticator --

type KeyKind = "ec" | "rsa";

type FakeAuthenticator = {
  credentialId: Buffer;
  privateKey: crypto.KeyObject;
  coseKey: Buffer;
  counter: number;
};

function createAuthenticator(kind: KeyKind): FakeAuthenticator {
  const credentialId = crypto.randomBytes(32);
  if (kind === "ec") {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    return {
      credentialId,
      privateKey,
      counter: 0,
      coseKey: cbor(
        new Map<number | string, unknown>([
          [1, 2],
          [3, COSE_ALG_ES256],
          [-1, 1],
          [-2, Buffer.from(jwk.x, "base64url")],
          [-3, Buffer.from(jwk.y, "base64url")],
        ]),
      ),
    };
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  return {
    credentialId,
    privateKey,
    counter: 0,
    coseKey: cbor(
      new Map<number | string, unknown>([
        [1, 3],
        [3, COSE_ALG_RS256],
        [-1, Buffer.from(jwk.n, "base64url")],
        [-2, Buffer.from(jwk.e, "base64url")],
      ]),
    ),
  };
}

function b64url(value: Uint8Array | ArrayBuffer): string {
  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString("base64url");
}

const RP_ID = "brainykids.example";
const ORIGIN = "https://brainykids.example";

function clientData(type: string, challenge: string, origin = ORIGIN): string {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), "utf8").toString("base64url");
}

function authenticatorData(auth: FakeAuthenticator, rpId: string, options: { attested: boolean; counter?: number }): Buffer {
  const flags = 0x01 | (options.attested ? 0x40 : 0x00) | 0x04;
  const head = Buffer.concat([
    crypto.createHash("sha256").update(rpId).digest(),
    Buffer.from([flags]),
    (() => {
      const out = Buffer.alloc(4);
      out.writeUInt32BE(options.counter ?? 0);
      return out;
    })(),
  ]);
  if (!options.attested) return head;
  const length = Buffer.alloc(2);
  length.writeUInt16BE(auth.credentialId.length);
  return Buffer.concat([head, Buffer.alloc(16), length, auth.credentialId, auth.coseKey]);
}

function registrationResponse(
  auth: FakeAuthenticator,
  challenge: string,
  options: { rpId?: string; origin?: string } = {},
): WebAuthnResponse {
  const authData = authenticatorData(auth, options.rpId ?? RP_ID, { attested: true });
  const attestationObject = cbor(
    new Map<string, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map<string, unknown>()],
      ["authData", authData],
    ]),
  );
  return {
    id: b64url(auth.credentialId),
    rawId: b64url(auth.credentialId),
    type: "public-key",
    response: {
      clientDataJSON: clientData("webauthn.create", challenge, options.origin),
      attestationObject: b64url(attestationObject),
      transports: ["internal"],
    },
  };
}

function assertionResponse(auth: FakeAuthenticator, challenge: string, options: { rpId?: string; origin?: string; counter?: number } = {}): WebAuthnResponse {
  const authData = authenticatorData(auth, options.rpId ?? RP_ID, { attested: false, counter: options.counter });
  const clientDataBytes = Buffer.from(clientData("webauthn.get", challenge, options.origin), "base64url");
  const signed = Buffer.concat([authData, crypto.createHash("sha256").update(clientDataBytes).digest()]);
  const signature =
    auth.privateKey.asymmetricKeyType === "rsa"
      ? crypto.sign("sha256", signed, auth.privateKey)
      : crypto.sign("sha256", signed, { key: auth.privateKey, dsaEncoding: "der" });
  return {
    id: b64url(auth.credentialId),
    rawId: b64url(auth.credentialId),
    type: "public-key",
    response: {
      clientDataJSON: clientData("webauthn.get", challenge, options.origin),
      authenticatorData: b64url(authData),
      signature: b64url(signature),
      userHandle: null,
    },
  };
}

// ------------------------------------------------------------------ test rig --

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function expectRejection(name: string, run: () => unknown, expected?: string) {
  try {
    run();
    check(name, false, "expected a WebAuthnError");
  } catch (error) {
    const message = error instanceof WebAuthnError ? error.message : String(error);
    check(name, expected ? message.includes(expected) : true, message);
  }
}

function roundTrip(kind: KeyKind, label: string) {
  console.log(`\n${label}`);
  const auth = createAuthenticator(kind);
  const registerChallenge = "challenge-for-registration";
  const stored = verifyRegistration({
    response: registrationResponse(auth, registerChallenge),
    challenge: registerChallenge,
    origins: [ORIGIN],
    rpId: RP_ID,
  });
  check("registration is accepted", stored.credentialId === b64url(auth.credentialId));
  check("public key is stored as base64url", stored.publicKey.length > 20 && !stored.publicKey.includes("+"));
  check("transports are kept", stored.transports.includes("internal"));

  const loginChallenge = "challenge-for-sign-in";
  const ok = verifyAssertion({
    response: assertionResponse(auth, loginChallenge),
    challenge: loginChallenge,
    origins: [ORIGIN],
    rpId: RP_ID,
    credentialId: stored.credentialId,
    publicKey: stored.publicKey,
    counter: stored.counter,
  });
  check("sign-in is accepted", typeof ok.counter === "number");

  expectRejection(
    "a different challenge is refused",
    () =>
      verifyAssertion({
        response: assertionResponse(auth, "another-challenge"),
        challenge: loginChallenge,
        origins: [ORIGIN],
        rpId: RP_ID,
        credentialId: stored.credentialId,
        publicKey: stored.publicKey,
        counter: 0,
      }),
    "expired",
  );

  expectRejection(
    "another web address is refused",
    () =>
      verifyAssertion({
        response: assertionResponse(auth, loginChallenge, { origin: "https://evil.example" }),
        challenge: loginChallenge,
        origins: [ORIGIN],
        rpId: RP_ID,
        credentialId: stored.credentialId,
        publicKey: stored.publicKey,
        counter: 0,
      }),
    "unexpected address",
  );

  expectRejection(
    "another relying party is refused",
    () =>
      verifyRegistration({
        response: registrationResponse(auth, registerChallenge, { rpId: "evil.example" }),
        challenge: registerChallenge,
        origins: [ORIGIN],
        rpId: RP_ID,
      }),
    "different web address",
  );

  expectRejection(
    "a tampered signature is refused",
    () => {
      const response = assertionResponse(auth, loginChallenge);
      const signature = Buffer.from(response.response!.signature!, "base64url");
      signature[signature.length - 1] ^= 0xff;
      return verifyAssertion({
        response: { ...response, response: { ...response.response, signature: signature.toString("base64url") } },
        challenge: loginChallenge,
        origins: [ORIGIN],
        rpId: RP_ID,
        credentialId: stored.credentialId,
        publicKey: stored.publicKey,
        counter: 0,
      });
    },
    "signature",
  );

  expectRejection(
    "a credential id that does not match is refused",
    () =>
      verifyAssertion({
        response: { ...assertionResponse(auth, loginChallenge), rawId: b64url(crypto.randomBytes(32)) },
        challenge: loginChallenge,
        origins: [ORIGIN],
        rpId: RP_ID,
        credentialId: stored.credentialId,
        publicKey: stored.publicKey,
        counter: 0,
      }),
    "not set up",
  );
}

function counterRules() {
  console.log("\nSignature counter (a backwards counter can mean a cloned key)");
  const auth = createAuthenticator("ec");
  const challenge = "challenge";
  const stored = verifyRegistration({
    response: registrationResponse(auth, challenge),
    challenge,
    origins: [ORIGIN],
    rpId: RP_ID,
  });

  const assert = (counter: number, storedCounter: number) =>
    verifyAssertion({
      response: assertionResponse(auth, challenge, { counter }),
      challenge,
      origins: [ORIGIN],
      rpId: RP_ID,
      credentialId: stored.credentialId,
      publicKey: stored.publicKey,
      counter: storedCounter,
    });

  check("a counter that stays at 0 is accepted (many sensors never count)", (() => {
    try {
      assert(0, 0);
      return true;
    } catch {
      return false;
    }
  })());

  check("a counter that moves forward is accepted", (() => {
    try {
      assert(9, 4);
      return true;
    } catch {
      return false;
    }
  })());

  expectRejection("a counter that goes backwards is refused", () => assert(4, 9), "out of date");
}

function relyingPartyFromRequest() {
  console.log("\nRelying party comes from the request");
  const request = new Request("https://kids.example.com/api/auth/passkey/login/options", {
    method: "POST",
    headers: { host: "kids.example.com", origin: "https://kids.example.com" },
  });
  const party = relyingParty(request);
  check("rpId is the request host", party.rpId === "kids.example.com", party.rpId);
  check("the origin is allowed", party.origins.includes("https://kids.example.com"));

  const portRequest = new Request("http://localhost:3000/api/auth/passkey/login/options", {
    method: "POST",
    headers: { host: "localhost:3000", origin: "http://localhost:3000" },
  });
  const local = relyingParty(portRequest);
  check("the port is not part of the rpId", local.rpId === "localhost", local.rpId);
}

roundTrip("ec", "iPhone / Android style credential (ES256)");
roundTrip("rsa", "Windows Hello style credential (RS256)");
counterRules();
relyingPartyFromRequest();

function neonAndVercelDatabaseChecks() {
  console.log("\nNeon / Vercel Postgres connection string normalisation");
  const neonPsql = normaliseDatabaseConfig(
    "psql 'postgresql://neondb_owner:npg_abc123@ep-cool-frog-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'",
  );
  check("strips psql snippet wrapper and quotes", neonPsql.valid && neonPsql.safeLocation === "ep-cool-frog-123456-pooler.us-east-2.aws.neon.tech/neondb");
  check("enables SCRAM channel binding when channel_binding=require is present", neonPsql.enableChannelBinding === true);
  check("adds uselibpqcompat=true for sslmode=require", neonPsql.connectionString.includes("uselibpqcompat=true"));

  const envLine = normaliseDatabaseConfig(
    'DATABASE_URL="postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/neondb"',
  );
  check("strips accidental KEY= prefix and adds sslmode=require for Neon host", envLine.valid && envLine.connectionString.includes("sslmode=require"));

  const savedPgUrl = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = "postgresql://user:pass@ep-vercel.us-east-2.aws.neon.tech/verceldb?sslmode=require";
  const resolved = resolveDatabaseEnv();
  check("discovers POSTGRES_URL set by Vercel Storage integration", resolved?.envVar === "POSTGRES_URL");
  if (savedPgUrl === undefined) delete process.env.POSTGRES_URL;
  else process.env.POSTGRES_URL = savedPgUrl;

  const token = signPayload({ parentId: "p-1", role: "parent" });
  const verified = verifyPayload<{ parentId: string; role: string }>(token);
  check("serverless continuity HMAC round-trips", verified?.parentId === "p-1");
  check("tampered continuity HMAC is rejected", verifyPayload(`${token}x`) === null);
}

neonAndVercelDatabaseChecks();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
