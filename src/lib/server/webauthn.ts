// Fingerprint / face unlock support.
//
// Browsers never expose the fingerprint sensor directly; the only way a web app
// can offer “scan your finger” is a WebAuthn passkey, which the operating system
// backs with Face ID, Touch ID, Windows Hello, an Android fingerprint or a
// device PIN. This module implements the server half of that ceremony on top of
// Node's own crypto — no extra dependencies:
//
//   * a minimal CBOR reader (the COSE public key is CBOR encoded)
//   * COSE → SPKI conversion so Node can verify signatures
//   * verification of the registration and the sign-in (assertion) responses
//
// Attestation statements are not validated against a vendor root. That only
// proves which make of authenticator was used; the account binding comes from
// the challenge, the origin check and the signature over the authenticator data,
// all of which are checked here.

import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// base64url helpers (WebAuthn speaks ArrayBuffers; JSON speaks strings)
// ---------------------------------------------------------------------------

export function toBase64Url(input: Uint8Array | ArrayBuffer): string {
  return Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input).toString("base64url");
}

export function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function newChallenge(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// ---------------------------------------------------------------------------
// Minimal CBOR reader
// ---------------------------------------------------------------------------

export type CborValue =
  | number
  | string
  | Uint8Array
  | boolean
  | null
  | CborValue[]
  | Map<CborValue, CborValue>;

function readLength(view: DataView, offset: number, additional: number): { length: number; offset: number } {
  if (additional < 24) return { length: additional, offset };
  if (additional === 24) return { length: view.getUint8(offset), offset: offset + 1 };
  if (additional === 25) return { length: view.getUint16(offset), offset: offset + 2 };
  if (additional === 26) return { length: view.getUint32(offset), offset: offset + 4 };
  if (additional === 27) {
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    return { length: high * 2 ** 32 + low, offset: offset + 8 };
  }
  throw new Error(`Unsupported CBOR length encoding (${additional})`);
}

/**
 * Decodes the CBOR item at `start` and reports where it ended, which is how the
 * COSE key in the middle of the authenticator data is measured.
 */
export function decodeCborItem(bytes: Uint8Array, start: number): { value: CborValue; offset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const initial = view.getUint8(start);
  const major = initial >> 5;
  const additional = initial & 0x1f;
  const { length, offset } = readLength(view, start + 1, additional);

  switch (major) {
    case 0:
      return { value: length, offset };
    case 1:
      return { value: -1 - length, offset };
    case 2:
      return { value: bytes.subarray(offset, offset + length), offset: offset + length };
    case 3:
      return { value: new TextDecoder().decode(bytes.subarray(offset, offset + length)), offset: offset + length };
    case 4: {
      const items: CborValue[] = [];
      let cursor = offset;
      for (let i = 0; i < length; i++) {
        const item = decodeCborItem(bytes, cursor);
        items.push(item.value);
        cursor = item.offset;
      }
      return { value: items, offset: cursor };
    }
    case 5: {
      const map = new Map<CborValue, CborValue>();
      let cursor = offset;
      for (let i = 0; i < length; i++) {
        const key = decodeCborItem(bytes, cursor);
        const value = decodeCborItem(bytes, key.offset);
        map.set(key.value, value.value);
        cursor = value.offset;
      }
      return { value: map, offset: cursor };
    }
    case 7:
      if (additional === 20) return { value: false, offset };
      if (additional === 21) return { value: true, offset };
      if (additional === 22) return { value: null, offset };
      if (additional === 26) return { value: view.getFloat32(start + 1), offset };
      if (additional === 27) return { value: view.getFloat64(start + 1), offset };
      return { value: null, offset };
    default:
      throw new Error(`Unsupported CBOR major type ${major}`);
  }
}

export function decodeCbor(bytes: Uint8Array): CborValue {
  return decodeCborItem(bytes, 0).value;
}

/** Looks up an integer label inside a CBOR map (COSE keys are integer labelled). */
function mapGet(map: CborValue, key: number | string): CborValue | undefined {
  if (!(map instanceof Map)) return undefined;
  for (const [k, v] of map) if (k === key) return v;
  return undefined;
}

function bytesOf(value: CborValue | undefined): Uint8Array | null {
  return value instanceof Uint8Array ? value : null;
}

// ---------------------------------------------------------------------------
// DER plumbing so a COSE key can become a Node KeyObject
// ---------------------------------------------------------------------------

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Uint8Array.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = Buffer.concat(parts.map((part) => Buffer.from(part)));
  return Buffer.concat([Buffer.from([tag]), Buffer.from(derLength(body.length)), body]);
}

function derOid(hex: string): Uint8Array {
  return der(0x06, Buffer.from(hex, "hex"));
}

/** Unsigned big-endian integer as a DER INTEGER. */
function derInteger(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;
  const trimmed = value.subarray(start);
  const needsPad = (trimmed[0] & 0x80) !== 0;
  return der(0x02, needsPad ? Buffer.concat([Buffer.from([0]), Buffer.from(trimmed)]) : trimmed);
}

function fixedLength(value: Uint8Array, length: number): Uint8Array {
  if (value.length === length) return value;
  if (value.length > length) return value.subarray(value.length - length);
  const out = new Uint8Array(length);
  out.set(value, length - value.length);
  return out;
}

const OID_EC_PUBLIC_KEY = "2a8648ce3d0201"; // 1.2.840.10045.2.1
const OID_PRIME256V1 = "2a8648ce3d030107"; // 1.2.840.10045.3.1.7
const OID_RSA_ENCRYPTION = "2a864886f70d010101"; // 1.2.840.113549.1.1.1

/** COSE algorithm identifiers we can verify. */
export const COSE_ALG_ES256 = -7;
export const COSE_ALG_RS256 = -257;

export type CredentialKey = { key: crypto.KeyObject; alg: number };

/** Turns the CBOR COSE key an authenticator returns into a Node public key. */
export function coseToPublicKey(coseBytes: Uint8Array): CredentialKey {
  const cose = decodeCbor(coseBytes);
  const kty = mapGet(cose, 1);
  const alg = mapGet(cose, 3);
  const algorithm = typeof alg === "number" ? alg : COSE_ALG_ES256;

  if (kty === 2) {
    // EC2 key: -1 = curve, -2 = x, -3 = y
    const curve = mapGet(cose, -1);
    const x = bytesOf(mapGet(cose, -2));
    const y = bytesOf(mapGet(cose, -3));
    if (curve !== 1 || !x || !y) throw new Error("Only P-256 EC credentials are supported.");
    const point = Buffer.concat([
      Buffer.from([0x04]),
      Buffer.from(fixedLength(x, 32)),
      Buffer.from(fixedLength(y, 32)),
    ]);
    const spki = der(
      0x30,
      der(0x30, derOid(OID_EC_PUBLIC_KEY), derOid(OID_PRIME256V1)),
      der(0x03, Buffer.concat([Buffer.from([0x00]), point])),
    );
    return { key: crypto.createPublicKey({ key: Buffer.from(spki), format: "der", type: "spki" }), alg: algorithm };
  }

  if (kty === 3) {
    // RSA key: -1 = n, -2 = e
    const n = bytesOf(mapGet(cose, -1));
    const e = bytesOf(mapGet(cose, -2));
    if (!n || !e) throw new Error("Incomplete RSA credential.");
    const rsaPublicKey = der(0x30, derInteger(n), derInteger(e));
    const spki = der(
      0x30,
      der(0x30, derOid(OID_RSA_ENCRYPTION), der(0x05)),
      der(0x03, Buffer.concat([Buffer.from([0x00]), rsaPublicKey])),
    );
    return { key: crypto.createPublicKey({ key: Buffer.from(spki), format: "der", type: "spki" }), alg: algorithm };
  }

  throw new Error(`Unsupported credential key type ${String(kty)}`);
}

// ---------------------------------------------------------------------------
// Ceremony verification
// ---------------------------------------------------------------------------

export type WebAuthnResponse = {
  id?: string;
  rawId?: string;
  type?: string;
  response?: {
    clientDataJSON?: string;
    attestationObject?: string;
    authenticatorData?: string;
    signature?: string;
    userHandle?: string | null;
    transports?: string[];
  };
  clientExtensionResults?: Record<string, unknown>;
};

export class WebAuthnError extends Error {}

function fail(message: string): never {
  throw new WebAuthnError(message);
}

function decodeField(value: string | undefined, what: string): Uint8Array {
  if (typeof value !== "string" || !value) fail(`The device did not send its ${what}.`);
  try {
    return fromBase64Url(value);
  } catch {
    fail(`The ${what} from the device could not be read.`);
  }
}

type ClientData = { type: string; challenge: string; origin: string; crossOrigin?: boolean };

function readClientData(bytes: Uint8Array, expectedType: string, expectedChallenge: string, origins: string[]): ClientData {
  let data: ClientData;
  try {
    data = JSON.parse(Buffer.from(bytes).toString("utf8")) as ClientData;
  } catch {
    fail("The response from the device could not be read.");
  }
  if (data.type !== expectedType) fail("That response was for a different kind of request.");
  if (data.challenge !== expectedChallenge) fail("This sign-in attempt expired. Please try again.");
  if (!origins.includes(data.origin)) fail("That request came from an unexpected address.");
  return data;
}

type AuthData = {
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
  credentialId: Uint8Array | null;
  coseKey: Uint8Array | null;
};

function parseAuthData(bytes: Uint8Array): AuthData {
  if (bytes.length < 37) fail("The response from the device was incomplete.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rpIdHash = bytes.subarray(0, 32);
  const flags = view.getUint8(32);
  const counter = view.getUint32(33);
  let offset = 37;
  let credentialId: Uint8Array | null = null;
  let coseKey: Uint8Array | null = null;

  if (flags & 0x40) {
    // Attested credential data: aaguid(16) | idLength(2) | id | COSE key
    if (bytes.length < offset + 18) fail("The response from the device was incomplete.");
    const idLength = view.getUint16(offset + 16);
    offset += 18;
    credentialId = bytes.subarray(offset, offset + idLength);
    offset += idLength;
    // The COSE key is a CBOR map; measure it so the rest of the blob is ignored.
    const key = decodeCborItem(bytes, offset);
    coseKey = bytes.subarray(offset, key.offset);
  }

  return { rpIdHash, flags, counter, credentialId, coseKey };
}

function clientDataHash(clientData: Uint8Array): Buffer {
  return crypto.createHash("sha256").update(clientData).digest();
}

function verifyRpId(authData: AuthData, rpId: string) {
  const expected = crypto.createHash("sha256").update(rpId).digest();
  if (!crypto.timingSafeEqual(Buffer.from(authData.rpIdHash), expected)) {
    fail("That credential was created for a different web address.");
  }
}

function verifySignature(credential: CredentialKey, data: Buffer, signature: Uint8Array) {
  const ok =
    credential.alg === COSE_ALG_RS256
      ? crypto.verify("sha256", data, credential.key, Buffer.from(signature))
      : crypto.verify("sha256", data, { key: credential.key, dsaEncoding: "der" }, Buffer.from(signature));
  if (!ok) fail("The device signature did not match.");
}

export type RegisteredCredential = {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  /** The authenticator reports the key is backed up / synced (iCloud Keychain, Google). */
  synced: boolean;
};

/** Checks a `navigator.credentials.create()` result and returns what to store. */
export function verifyRegistration(input: {
  response: WebAuthnResponse;
  challenge: string;
  origins: string[];
  rpId: string;
}): RegisteredCredential {
  const response = input.response;
  const clientDataBytes = decodeField(response.response?.clientDataJSON, "response");
  readClientData(clientDataBytes, "webauthn.create", input.challenge, input.origins);

  const attestationBytes = decodeField(response.response?.attestationObject, "attestation");
  const attestation = decodeCbor(attestationBytes);
  const authDataBytes = bytesOf(mapGet(attestation, "authData"));
  if (!authDataBytes) fail("The response from the device was incomplete.");

  const authData = parseAuthData(authDataBytes);
  verifyRpId(authData, input.rpId);
  if ((authData.flags & 0x01) === 0) fail("The device did not confirm anyone was present.");
  if (!authData.credentialId || !authData.coseKey) fail("The device did not send a credential.");

  const credentialKey = coseToPublicKey(authData.coseKey);

  // “packed” attestation signed by the credential's own key (self attestation).
  // Vendor certificate chains are not validated; see the note at the top.
  const fmt = mapGet(attestation, "fmt");
  if (fmt === "packed") {
    const attStmt: CborValue | undefined = mapGet(attestation, "attStmt");
    const sig = bytesOf(attStmt === undefined ? undefined : mapGet(attStmt, "sig"));
    if (sig && (attStmt === undefined || !mapGet(attStmt, "x5c"))) {
      const signed = Buffer.concat([Buffer.from(authDataBytes), clientDataHash(clientDataBytes)]);
      verifySignature(credentialKey, signed, sig);
    }
  }

  const rawId = response.rawId ?? response.id;
  const credentialId = toBase64Url(authData.credentialId);
  if (rawId && rawId !== credentialId) fail("The device sent an inconsistent credential id.");

  return {
    credentialId,
    publicKey: toBase64Url(authData.coseKey),
    counter: authData.counter,
    transports: response.response?.transports ?? [],
    synced: (authData.flags & 0x08) !== 0 || (authData.flags & 0x10) !== 0,
  };
}

/** Checks a `navigator.credentials.get()` result against a stored credential. */
export function verifyAssertion(input: {
  response: WebAuthnResponse;
  challenge: string;
  origins: string[];
  rpId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
}): { counter: number } {
  const response = input.response;
  const clientDataBytes = decodeField(response.response?.clientDataJSON, "response");
  readClientData(clientDataBytes, "webauthn.get", input.challenge, input.origins);

  const authDataBytes = decodeField(response.response?.authenticatorData, "response");
  const signature = decodeField(response.response?.signature, "signature");
  const authData = parseAuthData(authDataBytes);
  verifyRpId(authData, input.rpId);
  if ((authData.flags & 0x01) === 0) fail("The device did not confirm anyone was present.");

  const rawId = response.rawId ?? response.id;
  if (!rawId || rawId !== input.credentialId) fail("That fingerprint is not set up for BrainyKids.");

  const credentialKey = coseToPublicKey(fromBase64Url(input.publicKey));
  verifySignature(credentialKey, Buffer.concat([Buffer.from(authDataBytes), clientDataHash(clientDataBytes)]), signature);

  // A counter that goes backwards can mean a cloned authenticator. Many platform
  // authenticators always report 0, so only a clearly stale value is rejected.
  if (authData.counter > 0 && input.counter > 0 && authData.counter <= input.counter) {
    fail("That credential looks out of date. Please set up fingerprint unlock again.");
  }

  return { counter: authData.counter };
}

// ---------------------------------------------------------------------------
// Where the app lives (relying party and allowed origins)
// ---------------------------------------------------------------------------

export type RelyingParty = { rpId: string; origins: string[]; host: string };

/**
 * A passkey is tied to the web address (and therefore the domain) it was created
 * on, so the relying party id is taken from the request itself. Deployments
 * behind a proxy can override both with environment variables.
 */
export function relyingParty(req: Request): RelyingParty {
  const host = (req.headers.get("host") ?? "localhost").toLowerCase();
  const origin = req.headers.get("origin");
  const configuredOrigins = (process.env.BRAINYKIDS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  let hostname = host;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    /* keep the raw host */
  }

  const rpId = process.env.BRAINYKIDS_RP_ID?.trim() || hostname;
  const origins = new Set<string>(configuredOrigins);
  if (origin) origins.add(origin.replace(/\/$/, ""));
  // Older browsers omit Origin on same-origin POSTs; accept the request's own host.
  origins.add(`https://${host}`);
  origins.add(`http://${host}`);

  return { rpId, origins: [...origins], host };
}
