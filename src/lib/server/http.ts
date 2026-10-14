import { NextResponse, type NextRequest } from "next/server";
import { logBehaviour } from "./diagnostics";
import { StorageError, store } from "./store";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data as Record<string, unknown>, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>) {
  return json({ error: message, ...(extra ?? {}) }, { status });
}

export type Body = Record<string, unknown>;

export async function readBody(req: Request): Promise<Body> {
  try {
    const raw = await req.text();
    if (!raw) return {};
    if (raw.length > 64_000) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Body) : {};
  } catch {
    return {};
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
 *
 * Without this a thrown error (for example the storage layer refusing to write)
 * escapes the handler and the browser receives an empty 500 page, which the app
 * can only show as “Something went wrong (500)”. Here the reason is logged on
 * the server and a readable message is returned instead.
 */
export function route<R extends Request = NextRequest, C = unknown>(
  handler: (req: R, ctx: C) => Promise<Response> | Response,
) {
  return async (req: R, ctx: C): Promise<Response> => {
    const startedAt = Date.now();
    try {
      return await handler(req, ctx);
    } catch (cause) {
      const url = req.url ?? "";
      console.error(`[brainykids] ${req.method} ${url} failed:`, cause);
      const path = safePath(url);
      void logBehaviour(
        {
          code: cause instanceof StorageError ? "storage.error" : "server.api_error",
          vars: {
            method: req.method,
            path,
            status: cause instanceof StorageError ? cause.status : 500,
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
      if (cause instanceof StorageError) {
        return error(cause.userMessage, cause.status);
      }
      return error("Something went wrong on the server. Please try again in a moment.", 500);
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
