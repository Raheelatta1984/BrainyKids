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

export const COOKIES = {
  parent: "bk_parent",
  device: "bk_device",
  pairing: "bk_pairing",
} as const;

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
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
