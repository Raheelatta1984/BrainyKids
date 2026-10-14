"use client";

import { useSyncExternalStore } from "react";

export type Gender = "boy" | "girl" | "prefer-not-to-say";
export type Theme = "space" | "jungle" | "robots" | "dinos";

export type Kid = {
  id: string;
  name: string;
  gender: Gender;
  age: number;
  theme: Theme;
  level: 1 | 2 | 3;
  unlockedLevel: 1 | 2 | 3;
  // Question ids already asked, per level, so questions never repeat within a level.
  usedByLevel: Record<string, string[]>;
  points: number;
  attempted: number;
  correct: number;
  requestedMinutes: number;
  approvedMinutes: number;
};

export type AppState = {
  parentPin: string | null;
  kids: Kid[];
};

const KEY = "brainykids-state-v1";
const EMPTY: AppState = { parentPin: null, kids: [] };

let cache: AppState | null = null;
const listeners = new Set<() => void>();

function read(): AppState {
  if (cache) return cache;
  if (typeof window === "undefined") return EMPTY;
  try {
    cache = JSON.parse(window.localStorage.getItem(KEY) ?? "null") ?? EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache as AppState;
}

export function updateState(fn: (s: AppState) => AppState) {
  const next = fn(read());
  cache = next;
  window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = () => {
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
