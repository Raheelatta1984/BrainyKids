"use client";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; retryAfterSeconds?: number };
export type RequestOptions = { keepalive?: boolean; signal?: AbortSignal };
type Failure = Extract<ApiResult<never>, { ok: false }>;

const flights = new Map<string, Promise<ApiResult<unknown>>>();
const cooldowns = new Map<string, { result: Failure; until: number }>();
let generation = 0;

export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(86_400, Math.max(1, Math.ceil(seconds))) : undefined;
}

async function perform<T>(path: string, init: RequestInit | undefined, options: RequestOptions, cooldownKey: string): Promise<ApiResult<T>> {
  try {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const res = await fetch(path, {
      credentials: "same-origin", cache: "no-store", keepalive: options.keepalive, signal: options.signal,
      ...init,
      headers,
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* proxy error page */ }
    if (!res.ok) {
      const retry = retryAfterSeconds(res.headers.get("retry-after"));
      const result: Failure = {
        ok: false, status: res.status,
        error: typeof data?.error === "string" ? data.error : res.status >= 500
          ? "BrainyKids could not finish that request. Please try again in a moment."
          : `Something went wrong (${res.status}).`,
        ...(retry ? { retryAfterSeconds: retry } : {}),
      };
      if ((res.status === 429 || res.status === 503) && retry) {
        // Bound memory; never retain successful/private responses or credentials.
        cooldowns.delete(cooldownKey);
        if (cooldowns.size >= 100) cooldowns.delete(cooldowns.keys().next().value!);
        cooldowns.set(cooldownKey, { result, until: Date.now() + retry * 1000 });
      }
      return result;
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again.", status: -1 };
  }
}

/** Coalesce identical GETs only while in flight; mutations are never replayed. */
export function request<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const cooldownKey = `${method}:${path.split("?", 1)[0]}`;
  const cooldown = cooldowns.get(cooldownKey);
  if (cooldown && cooldown.until > Date.now()) {
    return Promise.resolve({ ...cooldown.result, retryAfterSeconds: Math.max(1, Math.ceil((cooldown.until - Date.now()) / 1000)) });
  }
  cooldowns.delete(cooldownKey);
  const get = method === "GET";
  // Custom headers/credentials/signals can change the response or cancellation
  // owner. Only the plain same-origin GET used by api.get is safe to share.
  const canShare = get && !init && !options.signal;
  if (!get) { generation += 1; flights.clear(); }
  const key = `${generation}:${path}`;
  const existing = canShare ? flights.get(key) : undefined;
  if (existing) return existing as Promise<ApiResult<T>>;
  const pending = perform<T>(path, init, options, cooldownKey).finally(() => {
    if (flights.get(key) === pending) flights.delete(key);
    if (!get) { generation += 1; flights.clear(); }
  });
  if (canShare && flights.size < 100) flights.set(key, pending);
  return pending;
}
