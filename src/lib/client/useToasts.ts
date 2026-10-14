"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiveEvent } from "@/lib/types";

export type ToastItem = { id: number; emoji: string; title: string; body?: string };

/**
 * Turns realtime events into short-lived toasts.
 *
 * The list is derived from the events the server already sent, so nothing has to
 * be copied into state while rendering; a single timer dismisses the oldest one.
 */
export function useToasts(
  events: LiveEvent[],
  map: (event: LiveEvent) => ToastItem | null,
  lifetime = 8000,
): ToastItem[] {
  const [dismissed, setDismissed] = useState<number[]>([]);

  const toasts = useMemo(
    () =>
      events
        .map(map)
        .filter((toast): toast is ToastItem => toast !== null)
        .filter((toast) => !dismissed.includes(toast.id)),
    [events, map, dismissed],
  );

  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[0];
    const timer = setTimeout(() => {
      setDismissed((prev) => (prev.includes(oldest.id) ? prev : [...prev, oldest.id]));
    }, lifetime);
    return () => clearTimeout(timer);
  }, [toasts, lifetime]);

  return toasts;
}
