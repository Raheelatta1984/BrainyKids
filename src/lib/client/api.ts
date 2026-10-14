"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KidView, LiveEvent, ParentAccount, Snapshot, StorageState } from "@/lib/types";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // A response that is not JSON (a proxy error page, for example).
      data = {};
    }
    if (!res.ok) {
      if (typeof data.error === "string") return { ok: false, error: data.error };
      return {
        ok: false,
        error:
          res.status >= 500
            ? "BrainyKids could not finish that request. Please try again in a moment."
            : `Something went wrong (${res.status}).`,
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
};

export type PairingStart = { status: "pending"; code: string; expiresAt: number } | { status: "approved" };
export type PairingStatusResponse =
  | { status: "none" | "unknown" | "expired" }
  | { status: "approved"; kidId: string; kid: KidView | null };

export type AnswerResult = {
  correct: boolean;
  questionId: string;
  answer: string;
  explain: string;
  topic: string;
  points: number;
  unlockedLevel: number;
  levelFinished: boolean;
  duplicate: boolean;
};

export type PasskeyStatus = { parent: number; kid: number; hasAny: boolean };

export type StorageHealth = {
  ok: boolean;
  storage: StorageState;
  message: string;
  checkedAt: number;
};

export const actions = {
  parentSignup: (input: { name: string; email: string; password: string }) =>
    api.post<{ parent: ParentAccount; recoveryCode: string }>("/api/auth/signup", input),
  parentLogin: (input: { email: string; password: string }) => api.post<{ parent: ParentAccount }>("/api/auth/login", input),
  parentLogout: () => api.post<{ ok: true }>("/api/auth/logout"),
  /** “Forgot password?”: a new password, using the recovery code. */
  parentRecovery: (input: { email: string; code: string; password: string }) =>
    api.post<{ parent: ParentAccount; recoveryCode: string }>("/api/auth/recovery", input),
  /** Issues a fresh recovery code for the signed-in parent (shown only once). */
  parentNewRecoveryCode: () => api.post<{ recoveryCode: string; createdAt: number }>("/api/auth/recovery-code"),
  parentChangePassword: (input: { currentPassword: string; password: string }) =>
    api.post<{ ok: true; recoveryCode: string }>("/api/auth/password", input),

  passkeyStatus: () => api.get<PasskeyStatus>("/api/auth/passkey/status"),
  passkeyRemove: (id: string) => api.del<{ ok: true }>(`/api/auth/passkey/${id}`),
  storageStatus: () => api.get<StorageHealth>("/api/storage"),

  createKid: (input: {
    name: string;
    age: number;
    gender: string;
    theme: string;
    username: string;
    pin: string;
  }) => api.post<{ kid: KidView }>("/api/kids", input),
  updateKid: (id: string, input: Record<string, unknown>) => api.patch<{ kid: KidView | null }>(`/api/kids/${id}`, input),
  deleteKid: (id: string) => api.del<{ ok: true }>(`/api/kids/${id}`),
  screenTime: (id: string, action: "approve" | "decline" | "grant", minutes?: number) =>
    api.post<{ minutes: number }>(`/api/kids/${id}/screen-time`, { action, minutes }),
  cheer: (id: string, message: string) => api.post<{ ok: true }>(`/api/kids/${id}/cheer`, { message }),
  unlinkDevice: (id: string) => api.del<{ ok: true }>(`/api/devices/${id}`),

  pairingStart: (rotate = false) => api.post<PairingStart>(`/api/pairing/start${rotate ? "?rotate=1" : ""}`),
  pairingStatus: (wait = false) => api.get<PairingStatusResponse>(`/api/pairing/status${wait ? "?wait=1" : ""}`),
  pairingLookup: (code: string) =>
    api.get<{ found: boolean; status: string; code?: string; label?: string; expiresAt?: number }>(
      `/api/pairing/lookup?code=${encodeURIComponent(code)}`,
    ),
  pairingApprove: (code: string, kidId: string) =>
    api.post<{ ok: true; device: { id: string; label: string } }>("/api/pairing/approve", { code, kidId }),

  kidLogin: (username: string, pin: string) => api.post<{ kid: KidView | null }>("/api/kid-session/login", { username, pin }),
  kidLogout: (parentPassword: string) => api.post<{ ok: true }>("/api/kid-session/logout", { parentPassword }),
  heartbeat: () => api.post<{ linked: boolean; kidId?: string }>("/api/kid-session/heartbeat"),
  answer: (questionId: string, picked: string, level: number) =>
    api.post<{ result: AnswerResult; kid: KidView | null }>("/api/kid-session/answers", { questionId, picked, level }),
  requestScreenTime: () => api.post<{ minutes: number }>("/api/kid-session/screen-time"),
  setLevel: (level: number) => api.post<{ kid: KidView | null }>("/api/kid-session/level", { level }),
};

export type Live = {
  snapshot: Snapshot | null;
  loading: boolean;
  connected: boolean;
  events: LiveEvent[];
  /** Message to show on the sign-in screen (for example after a device is signed out). */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  refresh: () => Promise<void>;
  setSnapshot: (snapshot: Snapshot) => void;
};

/**
 * Keeps the current screen in step with the server:
 *  - Server-Sent Events deliver changes the moment they happen (realtime)
 *  - a slow poll runs as a safety net, and a fast poll runs if the stream drops
 */
export function useLive(): Live {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const cursor = useRef(0);
  const streamRef = useRef<EventSource | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.get<Snapshot>("/api/snapshot");
    if (res.ok) setSnapshot(res.data);
    setLoading(false);
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void refresh();
    }, 200);
  }, [refresh]);

  // First load: deferred by a tick so the fetch never sets state during render.
  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(id);
  }, [refresh]);

  const role = snapshot?.role ?? null;
  const durable = snapshot?.storage?.durable ?? true;

  useEffect(() => {
    if (!role || role === "guest") {
      streamRef.current?.close();
      streamRef.current = null;
      return;
    }

    // In temporary serverless storage (/tmp without a Postgres database), avoid
    // holding a serverless function open with SSE so all requests share the warm
    // instance; fast polling below keeps the screen fresh.
    if (!durable) {
      streamRef.current?.close();
      streamRef.current = null;
      const id = setTimeout(() => setConnected(true), 0);
      return () => clearTimeout(id);
    }

    let closed = false;
    let retries = 0;
    let source: EventSource | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      // Reconnecting with the latest cursor means no event is delivered twice.
      source = new EventSource(`/api/events?cursor=${cursor.current}`);
      streamRef.current = source;
      const markConnected = () => {
        retries = 0;
        setConnected(true);
      };

      source.addEventListener("open", markConnected);
      source.addEventListener("hello", markConnected);
      source.addEventListener("ping", markConnected);
      source.addEventListener("change", (event) => {
        markConnected();
        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as LiveEvent;
          cursor.current = Math.max(cursor.current, parsed.id);
          setEvents((prev) => (prev.some((e) => e.id === parsed.id) ? prev : [...prev.slice(-24), parsed]));
        } catch {
          /* ignore a malformed frame */
        }
        scheduleRefresh();
      });
      source.addEventListener("resync", () => {
        markConnected();
        void refresh();
      });
      source.addEventListener("signed-out", () => {
        closed = true;
        source?.close();
        streamRef.current = null;
        cursor.current = 0;
        setConnected(false);
        void refresh();
      });
      source.addEventListener("error", () => {
        setConnected(false);
        source?.close();
        if (closed) return;
        retries += 1;
        // Back off, but keep trying: the poll above covers the gap.
        reconnect = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(retries, 5)));
      });
    };

    connect();

    return () => {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      source?.close();
      streamRef.current = null;
      setConnected(false);
    };
  }, [role, durable, refresh, scheduleRefresh]);

  // Safety net: quick polls when the stream is down or in temporary storage, slow polls otherwise.
  useEffect(() => {
    if (!role || role === "guest") return;
    const period = connected && durable ? 15_000 : 4_000;
    const id = setInterval(() => void refresh(), period);
    return () => clearInterval(id);
  }, [connected, durable, role, refresh]);

  return { snapshot, loading, connected, events, notice, setNotice, refresh, setSnapshot };
}
