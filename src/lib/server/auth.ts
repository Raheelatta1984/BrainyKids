import crypto from "node:crypto";

/** scrypt hash of a password or PIN, stored as `salt:hash`. */
export function hashSecret(value: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(value, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

export function verifySecret(value: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const derived = crypto.scryptSync(value, salt, 32);
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hmacKey(): Buffer {
  const seed =
    process.env.BRAINYKIDS_SECRET ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL ||
    "brainykids-serverless-continuity-v1";
  return crypto.createHash("sha256").update(seed).digest();
}

/**
 * Signs a small JSON payload with HMAC-SHA256 so another serverless instance
 * in temporary-storage mode can verify it without a shared disk.
 */
export function signPayload(payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", hmacKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T>(token: string | undefined | null): T | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const expected = crypto.createHmac("sha256", hmacKey()).update(body).digest();
    const actual = Buffer.from(sig, "base64url");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export const COOKIES = {
  parent: "bk_parent",
  parentState: "bk_parent_state",
  device: "bk_device",
  /** Signed copy of a kid device link, so a temporary server can recognise it again. */
  deviceState: "bk_device_state",
  pairing: "bk_pairing",
} as const;

/**
 * True when this request arrived over https.
 *
 * This matters a lot: a cookie marked `secure` is thrown away by the browser on
 * a plain-http address, which looks exactly like “the kid keeps being signed
 * out” and “the QR code keeps expiring”. Behind a proxy (Vercel, Nginx) the
 * original protocol is in `x-forwarded-proto`.
 */
export function requestIsSecure(req?: Request | null): boolean {
  if (!req) return process.env.NODE_ENV === "production";
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

/** Where the request thinks it is, used in diagnostics (never a secret). */
export function requestProtocol(req?: Request | null): string {
  if (!req) return "unknown";
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded;
  try {
    return new URL(req.url).protocol.replace(":", "");
  } catch {
    return "unknown";
  }
}

export function requestHost(req?: Request | null): string {
  if (!req) return "unknown";
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "unknown";
}

export function cookieOptions(maxAgeSeconds: number, req?: Request | null) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: requestIsSecure(req),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Six-character pairing code with no easily confused characters. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newPairingCode(length = 6): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(input: string): boolean {
  return EMAIL_RE.test(input.trim());
}

export function normaliseUsername(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "");
}

export function isValidUsername(input: string): boolean {
  return /^[a-z0-9._]{3,20}$/.test(normaliseUsername(input));
}

export function isValidPin(input: string): boolean {
  return /^\d{4,6}$/.test(input.trim());
}

/** Human-friendly label for a signing-in device, taken from the user agent. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const platform = /ipad/i.test(ua)
    ? "iPad"
    : /iphone/i.test(ua)
      ? "iPhone"
      : /android/i.test(ua)
        ? /mobile/i.test(ua)
          ? "Android phone"
          : "Android tablet"
        : /macintosh|mac os x/i.test(ua)
          ? "Mac"
          : /windows/i.test(ua)
            ? "Windows PC"
            : /linux/i.test(ua)
              ? "Linux device"
              : "This device";
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
      ? "Chrome"
      : /safari/i.test(ua)
        ? "Safari"
        : /firefox/i.test(ua)
          ? "Firefox"
          : null;
  return browser ? `${platform} · ${browser}` : platform;
}
