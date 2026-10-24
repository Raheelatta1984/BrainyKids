import { hashForStorage } from "./auth";
import { requestClientKey } from "./client-identity";
import { ConnectionLimiter, RateLimiter, RequestProtectionError, type RatePolicy } from "./rate-limit";

export const MAX_BODY_BYTES = 64_000;
const MINUTE = 60_000;
const policy = (name: string, limit: number, windowMs = MINUTE, critical = false): RatePolicy => ({ name, limit, windowMs, critical });

export const REQUEST_POLICIES = {
  network: policy("network", 300),
  login: policy("parent-login", 20, 15 * MINUTE, true),
  kidLogin: policy("kid-login", 20, 15 * MINUTE, true),
  signup: policy("signup", 10, 15 * MINUTE, true),
  recovery: policy("recovery", 5, 15 * MINUTE, true),
  passkey: policy("passkey", 30, 15 * MINUTE, true),
  security: policy("security", 10, 15 * MINUTE, true),
  pairingStart: policy("pairing-start", 10, 10 * MINUTE, true),
  pairingLookup: policy("pairing-lookup", 30, MINUTE, true),
  pairingPoll: policy("pairing-poll", 60),
  events: policy("events", 30),
  heartbeat: policy("heartbeat", 60),
  diagnostics: policy("diagnostics", 20),
  storage: policy("storage", 6),
  read: policy("read", 120),
  write: policy("write", 90),
} as const;

export const IDENTITY_POLICIES = {
  parent: policy("identity-parent", 10, 15 * MINUTE, true),
  kid: policy("identity-kid", 6, 15 * MINUTE, true),
  recovery: policy("identity-recovery", 5, 15 * MINUTE, true),
} as const;

// Survives module reloads in development; counters/leases must be process-wide.
const globalState = globalThis as typeof globalThis & {
  __brainyKidsProtection?: { rate: RateLimiter; active: ConnectionLimiter; slow: ConnectionLimiter };
};
const state = globalState.__brainyKidsProtection ??= {
  rate: new RateLimiter(), active: new ConnectionLimiter(), slow: new ConnectionLimiter(64, 6),
};

function requestPath(req: Request): string {
  const raw = new URL(req.url).pathname;
  // Next routes decoded segments; encoded static names/trailing slashes must
  // not downgrade a sensitive endpoint to the generic write budget.
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* Next rejects malformed encodings. */ }
  return decoded.replace(/\/+$/, "").toLowerCase() || "/";
}

export function requestPolicy(req: Request): RatePolicy {
  const path = requestPath(req);
  if (path === "/api/auth/login") return REQUEST_POLICIES.login;
  if (path === "/api/kid-session/login") return REQUEST_POLICIES.kidLogin;
  if (path === "/api/auth/signup") return REQUEST_POLICIES.signup;
  if (path === "/api/auth/recovery") return REQUEST_POLICIES.recovery;
  if (path.startsWith("/api/auth/passkey/") && req.method !== "GET") return REQUEST_POLICIES.passkey;
  if (path.startsWith("/api/auth/") && req.method !== "GET") return REQUEST_POLICIES.security;
  if (path === "/api/pairing/start") return REQUEST_POLICIES.pairingStart;
  if (path === "/api/pairing/lookup" || path === "/api/pairing/approve") return REQUEST_POLICIES.pairingLookup;
  if (path === "/api/pairing/status") return REQUEST_POLICIES.pairingPoll;
  if (path === "/api/events") return REQUEST_POLICIES.events;
  if (path === "/api/kid-session/heartbeat") return REQUEST_POLICIES.heartbeat;
  if (path === "/api/diagnostics") return REQUEST_POLICIES.diagnostics;
  if (path === "/api/storage") return REQUEST_POLICIES.storage;
  return req.method === "GET" || req.method === "HEAD" ? REQUEST_POLICIES.read : REQUEST_POLICIES.write;
}

async function enforce(subject: string, selected: RatePolicy): Promise<void> {
  const result = await state.rate.consume(subject, selected);
  if (!result.allowed) throw new RequestProtectionError(result.status, result.retryAfterSeconds, result.limit);
}

/** Run before parsing JSON, hashing passwords, logging, or accessing storage. */
export async function protectRequest(req: Request): Promise<() => void> {
  const key = requestClientKey(req);
  // Acquire before ANY remote counter I/O, otherwise a slow cache could build
  // an unbounded queue before the database/stream guard is ever reached.
  const release = state.active.acquire(key);
  let releaseSlow: (() => void) | undefined;
  try {
    const url = new URL(req.url);
    const path = requestPath(req);
    if (path === "/api/events" || (path === "/api/pairing/status" && url.searchParams.get("wait") === "1")) {
      releaseSlow = state.slow.acquire(key, 25_000);
    }
    await enforce(key, REQUEST_POLICIES.network);
    await enforce(key, requestPolicy(req));
    return () => { releaseSlow?.(); release(); };
  } catch (error) {
    releaseSlow?.();
    release();
    throw error;
  }
}

/** Also limit a target account across source addresses; never key on the secret. */
export async function protectIdentity(kind: keyof typeof IDENTITY_POLICIES, identity: string): Promise<void> {
  await enforce(hashForStorage(`rate-identity-${kind}`, identity), IDENTITY_POLICIES[kind]);
}

/** Keep a stream's lease until completion/cancellation, not merely until headers. */
export function holdStreamLease(response: Response, signal: AbortSignal, release: () => void): Response {
  if (!response.body) { release(); return response; }
  const reader = response.body.getReader();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    signal.removeEventListener("abort", abort);
    release();
  };
  const abort = () => {
    finish();
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { finish(); controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
