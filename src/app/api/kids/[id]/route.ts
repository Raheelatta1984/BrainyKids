import type { NextRequest } from "next/server";
import { hashSecret, isValidPin, isValidUsername, normaliseUsername } from "@/lib/server/auth";
import { error, json, num, readBody, str } from "@/lib/server/http";
import { parentAuth } from "@/lib/server/session";
import { findKidByUsername } from "@/lib/server/service";
import { pushEvent, store } from "@/lib/server/store";
import { isId, kidView } from "@/lib/server/views";
import type { Gender, Level, Theme } from "@/lib/types";

export const runtime = "nodejs";

const GENDERS: Gender[] = ["boy", "girl", "prefer-not-to-say"];
const THEMES: Theme[] = ["space", "jungle", "robots", "dinos"];

type Ctx = { params: Promise<{ id: string }> };

/** Update a child profile (name, age, gender, theme, level) or reset their PIN. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);
  const { id } = await ctx.params;
  if (!isId(id)) return error("Unknown child.", 404);

  const body = await readBody(req);
  const outcome = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === id && k.parentId === auth.parent.id);
    if (!kid) return { ok: false as const, reason: "not-found" as const };

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) return { ok: false as const, reason: "name" as const };
      kid.name = name;
    }
    if (body.age !== undefined) kid.age = Math.min(18, Math.max(3, num(body.age, kid.age)));
    if (typeof body.gender === "string" && GENDERS.includes(body.gender as Gender)) kid.gender = body.gender as Gender;
    if (typeof body.theme === "string" && THEMES.includes(body.theme as Theme)) kid.theme = body.theme as Theme;
    if (body.level !== undefined) {
      const level = num(body.level, kid.level);
      if (level >= 1 && level <= kid.unlockedLevel) kid.level = level as Level;
    }
    if (typeof body.username === "string") {
      const username = normaliseUsername(body.username);
      if (!isValidUsername(username)) return { ok: false as const, reason: "username" as const };
      const clash = findKidByUsername(doc, username);
      if (clash && clash.id !== kid.id) return { ok: false as const, reason: "taken" as const };
      kid.username = username;
    }
    if (typeof body.pin === "string" && body.pin.length > 0) {
      if (!isValidPin(body.pin)) return { ok: false as const, reason: "pin" as const };
      kid.pinHash = hashSecret(body.pin.trim());
    }
    if (typeof body.unlockedLevel !== "undefined") {
      const unlocked = num(body.unlockedLevel, kid.unlockedLevel);
      if (unlocked >= 1 && unlocked <= 3 && unlocked >= kid.level) kid.unlockedLevel = unlocked as Level;
    }

    pushEvent(doc, {
      type: "kid.updated",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name },
    });
    return { ok: true as const, kid };
  });

  if (!outcome.ok) {
    const messages: Record<string, string> = {
      "not-found": "That child is not on this account.",
      name: "Enter the child's name.",
      username: "Kid username must be 3–20 letters, numbers, dots or underscores.",
      taken: "That kid username is already taken.",
      pin: "Kid PIN must be 4–6 digits.",
    };
    return error(messages[outcome.reason] ?? "Could not update the profile.", outcome.reason === "not-found" ? 404 : 400);
  }

  const doc = await store.read();
  const fresh = doc.kids.find((k) => k.id === id);
  return json({ kid: fresh ? kidView(doc, fresh) : null });
}

/** Remove a child profile, its device links and any pending link requests. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);
  const { id } = await ctx.params;
  if (!isId(id)) return error("Unknown child.", 404);

  const removed = await store.mutate((doc) => {
    const kid = doc.kids.find((k) => k.id === id && k.parentId === auth.parent.id);
    if (!kid) return false;
    doc.kids = doc.kids.filter((k) => k.id !== kid.id);
    doc.devices = doc.devices.filter((d) => d.kidId !== kid.id);
    doc.pairings = doc.pairings.filter((p) => p.kidId !== kid.id);
    pushEvent(doc, {
      type: "kid.deleted",
      parentId: kid.parentId,
      kidId: kid.id,
      payload: { kidName: kid.name },
    });
    return true;
  });

  if (!removed) return error("That child is not on this account.", 404);
  return json({ ok: true });
}
