import type { NextRequest } from "next/server";
import { error } from "@/lib/server/http";
import { deviceAuth, parentAuth } from "@/lib/server/session";
import { eventsSince, store, type EventRecord } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 1_200;
const KEEPALIVE_MS = 15_000;

/**
 * Realtime updates over Server-Sent Events.
 *
 * Parent screens receive everything for their children (new answers, screen-time
 * requests, devices coming online). Kid screens receive the events addressed to
 * the child that is signed in on the device. If a stream cannot be opened the
 * browser client falls back to polling /api/snapshot.
 */
export async function GET(req: NextRequest) {
  const doc = await store.read();
  const parent = await parentAuth(req, doc);
  const device = parent ? null : await deviceAuth(req, doc);

  if (!parent && !device) return error("Not signed in.", 401);
  const scope = parent
    ? { parentId: parent.parent.id, includeUnclaimed: doc.parents.length <= 1 }
    : { parentId: device!.kid.parentId, kidId: device!.kid.id };

  const cursorParam = Number.parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);
  let cursor = Number.isFinite(cursorParam) && cursorParam > 0 ? cursorParam : 0;

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const cleanup = () => {
        if (interval) clearInterval(interval);
        if (keepalive) clearInterval(keepalive);
        interval = null;
        keepalive = null;
      };

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
          cleanup();
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const pump = async () => {
        try {
          const current = await store.read();
          const stillParent = await parentAuth(req, current);
          const stillDevice = stillParent ? null : await deviceAuth(req, current);
          if (!stillParent && !stillDevice) {
            send("signed-out", {});
            close();
            return;
          }

          const page = eventsSince(current, cursor, {
            ...scope,
            includeUnclaimed: scope.includeUnclaimed && current.parents.length <= 1,
          });
          if (page.reset) {
            cursor = page.latestId;
            send("resync", { latestId: page.latestId });
            return;
          }
          for (const event of page.events as EventRecord[]) {
            cursor = event.id;
            send("change", {
              id: event.id,
              type: event.type,
              ts: event.ts,
              kidId: event.kidId,
              payload: event.payload,
            });
          }
        } catch {
          send("ping", {});
        }
      };

      send("hello", { cursor, scope: scope.kidId ? "kid" : "parent" });
      void pump();

      interval = setInterval(() => void pump(), POLL_MS);
      keepalive = setInterval(() => send("ping", {}), KEEPALIVE_MS);

      req.signal.addEventListener("abort", () => {
        closed = true;
        cleanup();
      });
    },
    cancel() {
      if (interval) clearInterval(interval);
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
