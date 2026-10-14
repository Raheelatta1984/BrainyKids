import type { NextRequest } from "next/server";
import { hashSecret, isValidPin, isValidUsername, normaliseUsername } from "@/lib/server/auth";
import { error, json, num, readBody, route, str } from "@/lib/server/http";
import { parentAuth } from "@/lib/server/session";
import { createKidRecord, findKidByUsername } from "@/lib/server/service";
import { pushEvent, store } from "@/lib/server/store";
import { kidView } from "@/lib/server/views";
import type { Gender, Theme } from "@/lib/types";

export const runtime = "nodejs";

const GENDERS: Gender[] = ["boy", "girl", "prefer-not-to-say"];
const THEMES: Theme[] = ["space", "jungle", "robots", "dinos"];

export const POST = route(async (req: NextRequest) => {
  const auth = await parentAuth(req);
  if (!auth) return error("Sign in as a parent first.", 401);

  const body = await readBody(req);
  const name = str(body.name).trim();
  const username = normaliseUsername(str(body.username));
  const pin = str(body.pin).trim();
  const age = Math.min(18, Math.max(3, num(body.age, 6)));
  const gender = (GENDERS.includes(str(body.gender) as Gender) ? str(body.gender) : "prefer-not-to-say") as Gender;
  const theme = (THEMES.includes(str(body.theme) as Theme) ? str(body.theme) : "space") as Theme;

  if (!name) return error("Enter the child's name.");
  if (!isValidUsername(username)) return error("Kid username must be 3–20 letters, numbers, dots or underscores.");
  if (!isValidPin(pin)) return error("Kid PIN must be 4–6 digits.");

  const result = await store.mutate((doc) => {
    if (findKidByUsername(doc, username)) return { taken: true, kid: null };
    const kid = createKidRecord(doc, auth.parent.id, {
      name,
      username,
      pinHash: hashSecret(pin),
      age,
      gender,
      theme,
    });
    pushEvent(doc, {
      type: "kid.created",
      parentId: auth.parent.id,
      kidId: kid.id,
      payload: { kidName: kid.name, username: kid.username },
    });
    return { taken: false, kid };
  });

  if (result.taken || !result.kid) return error("That kid username is already taken. Try another one.", 409);
  return json({ kid: kidView(await store.read(), result.kid) });
});
