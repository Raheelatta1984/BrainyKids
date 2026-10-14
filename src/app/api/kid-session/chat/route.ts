import type { NextRequest } from "next/server";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { markChatRead, sendChatMessage } from "@/lib/server/service";
import { deviceAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { chatFor, chatUnreadFor, kidView } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The child's messages with their parent, newest last. */
export const GET = route(async (req: NextRequest) => {
  const auth = await deviceAuth(req);
  if (!auth) return error("This device is not linked to a child.", 401, { unlinked: true });

  const doc = await store.read();
  return json({ messages: chatFor(doc, auth.kid.id), unread: chatUnreadFor(doc, auth.kid.id, "kid") });
});

/**
 * Sends a message from the child's device, or (with `{"action":"read"}`) marks
 * the parent's messages as seen. A dictated message is stored as text so the
 * parent can read it and hear it read out.
 */
export const POST = route(async (req: NextRequest) => {
  const auth = await deviceAuth(req);
  if (!auth) return error("This device is not linked to a child.", 401, { unlinked: true });

  const body = await readBody(req);
  const action = str(body.action) || "send";

  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === auth.kid.id);
    if (!kid) return { ok: false as const, error: "That child profile is not on the server any more.", status: 409 };

    if (action === "read") {
      const changed = markChatRead(doc, kid, "kid");
      return { ok: true as const, read: changed, kid };
    }

    const kind = str(body.kind) === "voice" ? "voice" : "text";
    const sent = sendChatMessage(doc, kid, "kid", str(body.text), kind);
    if (!sent.ok) return { ok: false as const, error: sent.error, status: 400 };
    return { ok: true as const, message: sent.message, kid };
  });

  if (!outcome.ok) return error(outcome.error, outcome.status);

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === outcome.kid.id);
  if (!kid) return json({ ok: true, kid: null });
  return json({
    ok: true,
    read: "read" in outcome ? outcome.read : undefined,
    message: "message" in outcome ? outcome.message : undefined,
    kid: kidView(doc, kid, Date.now(), "kid"),
  });
});
