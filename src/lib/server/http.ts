import { NextResponse, type NextRequest } from "next/server";
import { logBehaviour } from "./diagnostics";
import { StorageError, store } from "./store";
import { RequestProtectionError } from "./rate-limit";
import { holdStreamLease, MAX_BODY_BYTES, protectRequest } from "./request-protection";

function isSafeOrigin(req: Request): boolean {
  const origin = req.headers.get("origin")?.toLowerCase();
  if (!origin) {
    const fetchSite = req.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin") return false;
    return true;
  }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return NextResponse.json(data as Record<string, unknown>, { ...init, headers });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>) {
  return json({ error: message, ...(extra ?? {}) }, { status });
}

export type Body = Record<string, unknown>;

export function checkBodyLength(req: Request): void {
  const length = req.headers.get("content-length");
  if (length === null) return;
  if (!/^\d+$/.test(length)) throw new StorageError("Invalid Content-Length", { status: 400 });
  if (Number(length) > MAX_BODY_BYTES) throw new StorageError("Payload too large", { status: 413 });
}

export async function readBody(req: Request): Promise<Body> {
  checkBodyLength(req);
  const contentType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new StorageError("Content-Type must be application/json", { status: 415 });
  }
  if (!req.body) return {};
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new StorageError("Payload too large", { status: 413 });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  const raw = chunks.join("");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Body) : {};
  } catch {
    throw new StorageError("Invalid JSON", { status: 400 });
  }
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Wraps an API route so an unexpected failure still answers with JSON.
 */
export function route<R extends Request = NextRequest, C = unknown>(
  handler: (req: R, ctx: C) => Promise<Response> | Response,
) {
  return async (req: R, ctx: C): Promise<Response> => {
    const startedAt = Date.now();
    let release: (() => void) | undefined;
    try {
      if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
        if (!isSafeOrigin(req)) {
          return error("Cross-origin request rejected", 403);
        }
      }
      release = await protectRequest(req);
      checkBodyLength(req);
      const response = await handler(req, ctx);
      if (response.headers.get("content-type")?.startsWith("text/event-stream")) {
        const held = holdStreamLease(response, req.signal, release);
        release = undefined;
        return held;
      }
      return response;
    } catch (cause) {
      if (cause instanceof RequestProtectionError) {
        return json({ error: cause.message }, {
          status: cause.status,
          headers: {
            "Retry-After": String(cause.retryAfterSeconds),
            ...(cause.limit ? {
              "RateLimit-Limit": String(cause.limit), "RateLimit-Remaining": "0",
              "RateLimit-Reset": String(cause.retryAfterSeconds),
            } : {}),
          },
        });
      }
      // Expected validation failures and shed storage requests must not create
      // a database write just to log that the request was rejected.
      if (cause instanceof StorageError) {
        return json({ error: cause.userMessage }, {
          status: cause.status,
          headers: cause.retryAfterSeconds ? { "Retry-After": String(cause.retryAfterSeconds) } : undefined,
        });
      }
      const url = req.url ?? "";
      console.error(`[brainykids] ${req.method} ${url} failed:`, cause);
      const path = safePath(url);
      void logBehaviour(
        {
          code: "server.api_error",
          vars: {
            method: req.method,
            path,
            status: 500,
            message: cause instanceof Error ? cause.message : String(cause),
            error: cause instanceof Error ? cause.message : String(cause),
            operation: path,
            driver: store.info().driver,
            durable: store.info().durable,
            location: store.info().location,
            reason: "unhandled",
            elapsedMs: Date.now() - startedAt,
          },
          context: { path, method: req.method, elapsedMs: Date.now() - startedAt },
        },
        { force: false, throttleKey: path },
      ).catch(() => undefined);
      return error("Something went wrong on the server. Please try again in a moment.", 500);
    } finally {
      release?.();
    }
  };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.slice(0, 200);
  }
}
