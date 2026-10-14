import type { NextRequest } from "next/server";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { logBehaviour } from "@/lib/server/diagnostics";
import { markChatRead, sendChatMessage } from "@/lib/server/service";
import { parentAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { chatFor, chatUnreadFor, isId, kidView } from "@/lib/server/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The parent's messages with one child, newest last. */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);
  const { id } = await ctx.params;
  if (!isId(id)) return error("Unknown child.");

  const doc = await store.read();
  const kid = doc.kids.find((k) => k.id === id && k.parentId === auth.parent.id);
  if (!kid) return error("That child is not on your account.", 404);

  return json({ messages: chatFor(doc, kid.id), unread: chatUnreadFor(doc, kid.id, "parent") });
});

/**
 * Sends a message to the child's device, or (with `{"action":"read"}`) marks the
 * child's messages as seen. A message typed after dictation has `kind: "voice"`,
 * and the child's device reads it out loud when voice over is on.
 */
export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);
  const { id } = await ctx.params;
  if (!isId(id)) return error("Unknown child.");

  const body = await readBody(req);
  const action = str(body.action) || "send";

  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === id && k.parentId === auth.parent.id);
    if (!kid) return { ok: false as const, error: "That child is not on your account.", status: 404 };

    if (action === "read") {
      const changed = markChatRead(doc, kid, "parent");
      return { ok: true as const, read: changed, kid };
    }

    const kind = str(body.kind) === "voice" ? "voice" : "text";
    const sent = sendChatMessage(doc, kid, "parent", str(body.text), kind);
    if (!sent.ok) return { ok: false as const, error: sent.error, status: 400 };

    if (kind === "voice") {
      logBehaviour(
        {
          code: "chat.message_sent",
          parentId: kid.parentId,
          kidId: kid.id,
          kidName: kid.name,
          vars: { from: "The parent", to: kid.name, voiceNote: " (voice note, read out on the child's device)", kidId: kid.id, messageId: sent.message.id, chars: sent.message.text.length, kind },
          context: { kidId: kid.id, messageId: sent.message.id, kind },
        },
        { throttleKey: kid.id },
      ).catch(() => undefined);
    }
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
    kid: kidView(doc, kid, Date.now(), "parent"),
  });
});
