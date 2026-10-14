import type { NextRequest } from "next/server";
import { deviceLabel } from "@/lib/server/auth";
import { error, json, route } from "@/lib/server/http";
import { createChallenge } from "@/lib/server/passkeys";
import { deviceAuth, parentAuth } from "@/lib/server/session";
import { store } from "@/lib/server/store";
import { relyingParty } from "@/lib/server/webauthn";

export const runtime = "nodejs";

/**
 * Starts “turn on fingerprint / face unlock on this device”.
 *
 * A signed-in parent adds a passkey to their account; a signed-in kid device
 * adds one for that child, so the child can tap the sensor next time instead of
 * typing a username and PIN.
 */
export const POST = route(async (req: NextRequest) => {
  const parent = await parentAuth(req);
  const device = parent ? null : await deviceAuth(req);
  if (!parent && !device) return error("Sign in first, then turn on fingerprint unlock.", 401);

  const { rpId } = relyingParty(req);
  const label = deviceLabel(req.headers.get("user-agent"));

  const result = await store.mutate((doc) => {
    const account = parent
      ? { parentId: parent.parent.id, kidId: null, name: parent.parent.name, email: parent.parent.email }
      : { parentId: device!.kid.parentId, kidId: device!.kid.id, name: device!.kid.name, email: device!.kid.username };

    const challenge = createChallenge(doc, {
      purpose: "register",
      parentId: account.parentId,
      kidId: account.kidId,
    });

    const existing = doc.passkeys
      .filter((p) => (account.kidId ? p.kidId === account.kidId : p.parentId === account.parentId && p.kidId === null))
      .map((p) => ({ type: "public-key" as const, id: p.credentialId, transports: p.transports as AuthenticatorTransport[] }));

    return { challenge: challenge.challenge, id: challenge.id, account, existing };
  });

  return json({
    id: result.id,
    label,
    role: parent ? "parent" : "kid",
    options: {
      challenge: result.challenge,
      rp: { id: rpId, name: "BrainyKids" },
      user: {
        id: Buffer.from(result.account.parentId + (result.account.kidId ?? "")).toString("base64url").slice(0, 64),
        name: result.account.email,
        displayName: result.account.name,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 120_000,
      attestation: "none",
      excludeCredentials: result.existing,
      authenticatorSelection: {
        // “platform” keeps the prompt on this device's own sensor, not a USB key.
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        requireResidentKey: false,
        userVerification: "preferred",
      },
    },
  });
});
