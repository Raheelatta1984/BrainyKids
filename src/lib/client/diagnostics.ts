"use client";

// The browser's half of the behavioural log.
//
// Everything a child's device notices about itself is sent to the server, which
// merges it with what the server saw and stores it (see /api/diagnostics). The
// wording for each code lives in src/lib/behaviour.ts, so a line written here and
// a line written on the server read the same in the review report.

import { actions, type ClientBehaviourEvent } from "./api";

const MAX_QUEUE = 40;
const FLUSH_DELAY_MS = 1_500;

let queue: ClientBehaviourEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

/** Facts about this device, attached to every line (never anything secret). */
export function clientFacts(): ClientBehaviourEvent["client"] {
  if (typeof window === "undefined") return undefined;
  const facts: NonNullable<ClientBehaviourEvent["client"]> = {
    userAgent: navigator.userAgent.slice(0, 240),
    platform: (navigator.userAgentData?.platform ?? navigator.platform ?? "").slice(0, 80) || undefined,
    url: window.location.pathname.slice(0, 200),
    protocol: window.location.protocol.replace(":", ""),
    online: navigator.onLine,
    language: (navigator.language ?? "").slice(0, 40) || undefined,
    cookies: cookiesWork(),
  };
  try {
    facts.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 60);
  } catch {
    /* keep going without a zone */
  }
  return facts;
}

/** Can this browser store cookies at all? A “no” explains most surprise sign-outs. */
export function cookiesWork(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof navigator !== "undefined" && navigator.cookieEnabled === false) return false;
  try {
    const key = "bk_cookie_probe";
    document.cookie = `${key}=1; path=/; SameSite=Lax`;
    const ok = document.cookie.includes(key);
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`;
    return ok;
  } catch {
    return false;
  }
}

/** Queues one line for the server-side log. Never throws, never blocks the UI. */
export function reportBehaviour(code: string, vars?: Record<string, unknown>, context?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  queue.push({ code, vars, context, at: Date.now(), client: clientFacts() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (typeof console !== "undefined" && console.debug) {
    // Kept in the browser console too, so a parent can read it on the spot.
    console.debug(`[brainykids:behaviour] ${code}`, { ...vars, ...context });
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushBehaviour();
  }, FLUSH_DELAY_MS);
}

/** Sends everything queued. Failures stay queued for the next attempt. */
export async function flushBehaviour(keepalive = false): Promise<number> {
  if (typeof window === "undefined" || queue.length === 0) return 0;
  const batch = queue.slice(0, 25);
  const result = await actions.reportBehaviour(batch, keepalive);
  if (result.ok) {
    queue = queue.slice(batch.length);
    return result.data.logged;
  }
  return 0;
}

/**
 * Watches the browser for the things that explain surprise sign-outs:
 * going offline, the tab being hidden, a crashed request, refused cookies.
 */
export function installBehaviourWatchers(): () => void {
  if (typeof window === "undefined" || installed) return () => undefined;
  installed = true;

  if (!cookiesWork()) {
    reportBehaviour("kid.session.cookie_missing", {
      reason: "the browser refused a test cookie",
      cookiesEnabled: false,
      protocol: window.location.protocol.replace(":", ""),
      url: window.location.pathname,
    });
  } else if (window.location.protocol === "http:" && window.location.hostname !== "localhost") {
    reportBehaviour("kid.session.insecure_cookie", {
      protocol: "http",
      host: window.location.host,
      reason: "not a secure address",
    });
  }

  const onOffline = () => reportBehaviour("kid.session.heartbeat_failed", { error: "this device went offline", attempt: 0, online: false });
  const onOnline = () => reportBehaviour("kid.session.recovered_after_error", { failures: 1 });
  const onVisible = () => {
    if (document.visibilityState === "visible") void flushBehaviour();
  };
  const onError = (event: ErrorEvent) => {
    reportBehaviour("server.api_error", {
      method: "browser",
      path: window.location.pathname,
      status: 0,
      message: (event.message ?? "script error").slice(0, 200),
    });
  };
  const onUnhandled = (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "unhandled rejection");
    reportBehaviour("server.api_error", {
      method: "browser",
      path: window.location.pathname,
      status: 0,
      message: reason.slice(0, 200),
    });
  };

  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandled);
  window.addEventListener("pagehide", () => void flushBehaviour(true));

  return () => {
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandled);
  };
}

declare global {
  interface Navigator {
    userAgentData?: { platform?: string };
  }
}
