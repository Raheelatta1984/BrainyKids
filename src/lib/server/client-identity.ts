import { isIP } from "node:net";
import { hashForStorage } from "./auth";

/** Canonicalise IPv6 and group privacy addresses by /64 to prevent cheap rotation. */
export function normaliseClientAddress(value: string): string | null {
  if (value.includes("%")) return null; // Zone identifiers are not public client addresses.
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  // URL uses a canonical IPv6 representation, including IPv4-mapped addresses.
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const [left, right = ""] = canonical.split("::");
  const start = left ? left.split(":") : [];
  const end = right ? right.split(":") : [];
  const words = canonical.includes("::")
    ? [...start, ...Array<string>(8 - start.length - end.length).fill("0"), ...end]
    : start;
  const numbers = words.map((word) => Number.parseInt(word, 16));
  if (numbers.slice(0, 5).every((word) => word === 0) && numbers[5] === 0xffff) {
    return `${numbers[6] >>> 8}.${numbers[6] & 255}.${numbers[7] >>> 8}.${numbers[7] & 255}`;
  }
  return `${numbers.slice(0, 4).map((word) => word.toString(16)).join(":")}::/64`;
}

/**
 * Request has no trustworthy socket IP. Only accept forwarding headers behind
 * an explicitly trusted, sanitising proxy (automatic on Vercel). Otherwise all
 * unknown sources share a bucket; cookies/UA must not let an attacker evade it.
 */
export function clientAddress(req: Request): string {
  const trust = process.env.BRAINYKIDS_TRUST_PROXY;
  const trusted = trust === undefined ? process.env.VERCEL === "1" : /^(1|true|yes)$/i.test(trust);
  if (!trusted) return "unknown";
  const forwarded = (process.env.VERCEL === "1" ? req.headers.get("x-vercel-forwarded-for") : null)
    ?? req.headers.get("x-forwarded-for");
  for (const candidate of [forwarded?.split(",", 1)[0]?.trim(), req.headers.get("x-real-ip")?.trim()]) {
    if (!candidate) continue;
    const address = normaliseClientAddress(candidate);
    if (address) return address;
  }
  return "unknown";
}

export function requestClientKey(req: Request): string {
  return hashForStorage("request-client", clientAddress(req));
}
