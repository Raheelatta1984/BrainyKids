import { NextResponse, type NextRequest } from "next/server";
import { StorageError } from "./store";

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
    try {
      return await handler(req, ctx);
    } catch (cause) {
      const url = req.url ?? "";
      console.error(`[brainykids] ${req.method} ${url} failed:`, cause);
      if (cause instanceof StorageError) {
        return error(cause.userMessage, cause.status);
      }
      return error("Something went wrong on the server. Please try again in a moment.", 500);
    }
  };
}
