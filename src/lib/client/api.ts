"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Question } from "@/lib/quiz-data";
import type {
  BehaviourEntry,
  BehaviourSummary,
  FamilySettings,
  KidView,
  LevelAction,
  LiveEvent,
  ParentAccount,
  Snapshot,
  StorageState,
} from "@/lib/types";

import { request, type RequestOptions } from "./request";
export type { ApiResult, RequestOptions } from "./request";

export const api = {
  get: <T,>(path: string, options?: RequestOptions) => request<T>(path, undefined, options),
  post: <T,>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }, options),
  patch: <T,>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
};

export type PairingStart =
  | { status: "pending"; code: string; expiresAt: number; ttlSeconds: number; renewed: boolean }
  | { status: "approved" };
export type PairingStatusResponse =
  | { status: "none" | "unknown" | "expired"; secondsLeft?: number }
  | { status: "pending"; code: string; expiresAt: number; secondsLeft: number }
  | { status: "approved"; kidId: string; kid: KidView | null; secondsLeft?: null };

/** The answer from /api/kid-session/heartbeat. Only `linked: false` means signed out. */
export type HeartbeatResponse = {
  linked: boolean;
  reason?: "no-cookie" | "unlinked";
  kidId?: string;
  kidName?: string;
  restored?: boolean;
  durable?: boolean;
};

export type FamilySettingsResponse = { settings: FamilySettings; message?: string; changed?: string[]; rejected?: number };

export type DiagnosticsResponse = {
  entries: BehaviourEntry[];
  summary: BehaviourSummary;
  settings: FamilySettings;
  storage: StorageState;
  kids: { id: string; name: string }[];
};

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
  scorePercent: number;
  earnedMinor: number;
  walletBalanceMinor: number;
  rewardKind: "money" | "robux";
  currency: string;
  timedOut: boolean;
  rewardBlocked: "timeout" | "schedule" | "daily-limit" | "weekly-limit" | null;
};

/** What the server did when a level was opened on the kid device. */
export type LevelResponse = {
  level: {
    level: number;
    action: LevelAction;
    total: number;
    done: number;
    cleared: number;
    wasComplete: boolean;
    unlockedLevel: number;
  };
  kid: KidView | null;
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
  pairingStatus: (wait = false, signal?: AbortSignal) => api.get<PairingStatusResponse>(`/api/pairing/status${wait ? "?wait=1" : ""}`, { signal }),
  pairingLookup: (code: string) =>
    api.get<{ found: boolean; status: string; code?: string; label?: string; expiresAt?: number }>(
      `/api/pairing/lookup?code=${encodeURIComponent(code)}`,
    ),
  pairingApprove: (code: string, kidId: string) =>
    api.post<{ ok: true; device: { id: string; label: string } }>("/api/pairing/approve", { code, kidId }),

  kidLogin: (username: string, pin: string) => api.post<{ kid: KidView | null }>("/api/kid-session/login", { username, pin }),
  kidLogout: (parentPassword: string) => api.post<{ ok: true }>("/api/kid-session/logout", { parentPassword }),
  /** Says whether this device is still linked. A network error is NOT a sign-out. */
  heartbeat: () => api.post<HeartbeatResponse>("/api/kid-session/heartbeat"),
  nextQuestion: (level: number) =>
    api.post<{ question: Question | null; progress: { level: number; total: number; done: number; percent: number; status: "not-started" | "in-progress" | "complete" } }>(
      "/api/kid-session/questions/next",
      { level },
    ),
  answer: (questionId: string, picked: string, level: number, elapsedSeconds = 0) =>
    api.post<{ result: AnswerResult; kid: KidView | null }>("/api/kid-session/answers", { questionId, picked, level, elapsedSeconds }),
  requestScreenTime: () => api.post<{ minutes: number }>("/api/kid-session/screen-time"),
  /** Kid asks a parent to realise the wallet; approval (not the request) resets it to zero. */
  requestRealisation: () => api.post<{ amountMinor: number; kid: KidView | null }>("/api/kid-session/rewards"),
  rewardDecision: (id: string, action: "approve" | "decline") =>
    api.post<{ amountMinor: number; kid: KidView | null }>(`/api/kids/${id}/rewards`, { action }),
  /**
   * Opens a level on the kid device. Every level is open: `start` carries on
   * where the child stopped in that level, `restart` begins that one level again
   * from its first question (points and money are untouched).
   */
  setLevel: (level: number, action: LevelAction = "start") =>
    api.post<LevelResponse>("/api/kid-session/level", { level, action }),

  /** Master settings: date, time, language, voice over. */
  settings: () => api.get<{ settings: FamilySettings }>("/api/settings"),
  updateSettings: (patch: Partial<FamilySettings>) => api.patch<FamilySettingsResponse>("/api/settings", patch),

  /** The behavioural log: report from the browser, read back for the dashboard. */
  reportBehaviour: (events: ClientBehaviourEvent[], keepalive = false) =>
    api.post<{ ok: true; logged: number }>("/api/diagnostics", { events }, { keepalive }),
  diagnostics: (limit = 300) => api.get<DiagnosticsResponse>(`/api/diagnostics?limit=${limit}`),

  /** Parent ↔ child chat, with dictation (“voice notes”) and read-aloud. */
  chatSend: (kidId: string, text: string, kind: "text" | "voice") =>
    api.post<{ ok: true; kid: KidView | null }>(`/api/kids/${kidId}/chat`, { text, kind }),
  chatRead: (kidId: string) => api.post<{ ok: true; read: number }>(`/api/kids/${kidId}/chat`, { action: "read" }),
  kidChatSend: (text: string, kind: "text" | "voice") =>
    api.post<{ ok: true; kid: KidView | null }>("/api/kid-session/chat", { text, kind }),
  kidChatRead: () => api.post<{ ok: true; read: number }>("/api/kid-session/chat", { action: "read" }),
};

/** One line a browser sends to the server-side behavioural log. */
export type ClientBehaviourEvent = {
  code: string;
  vars?: Record<string, unknown>;
  context?: Record<string, unknown>;
  at?: number;
  client?: {
    userAgent?: string;
    platform?: string;
    url?: string;
    protocol?: string;
    online?: boolean;
    timeZone?: string;
    language?: string;
    cookies?: boolean;
  };
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
      if (closed || source || document.visibilityState === "hidden" || !navigator.onLine) return;
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
        source = null;
        streamRef.current = null;
        if (closed) return;
        retries += 1;
        // Back off, but keep trying: the poll above covers the gap.
        reconnect = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(retries, 5)) * (0.8 + Math.random() * 0.4));
      });
    };

    const visibilityChanged = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) {
        if (reconnect) clearTimeout(reconnect);
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        source?.close();
        source = null;
        streamRef.current = null;
        setConnected(false);
      } else {
        void refresh();
        connect();
      }
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("online", visibilityChanged);
    window.addEventListener("offline", visibilityChanged);
    connect();

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("online", visibilityChanged);
      window.removeEventListener("offline", visibilityChanged);
      if (reconnect) clearTimeout(reconnect);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      source?.close();
      streamRef.current = null;
      setConnected(false);
    };
  }, [role, durable, refresh, scheduleRefresh]);

  // Safety net: quick polls when the stream is down or in temporary storage, slow polls otherwise.
  useEffect(() => {
    if (role === "guest") return;
    const period = connected && durable ? 15_000 : 4_000;
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden" && navigator.onLine) void refresh();
    }, period);
    return () => clearInterval(id);
  }, [connected, durable, role, refresh]);

  return { snapshot, loading, connected, events, notice, setNotice, refresh, setSnapshot };
}
