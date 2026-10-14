import type { NextRequest } from "next/server";
import { deviceLabel } from "@/lib/server/auth";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { passkeyView, takeChallenge } from "@/lib/server/passkeys";
import { deviceAuth, parentAuth } from "@/lib/server/session";
import { newId, store, type PasskeyRecord } from "@/lib/server/store";
import { relyingParty, verifyRegistration, WebAuthnError, type WebAuthnResponse } from "@/lib/server/webauthn";

export const runtime = "nodejs";

/** Finishes “turn on fingerprint / face unlock” and stores the credential. */
export const POST = route(async (req: NextRequest) => {
  const parent = await parentAuth(req);
  const device = parent ? null : await deviceAuth(req);
  if (!parent && !device) return error("Sign in first, then turn on fingerprint unlock.", 401);

  const body = await readBody(req);
  const challengeId = str(body.id);
  const credential = body.credential as WebAuthnResponse | undefined;
  if (!challengeId || !credential) return error("That request did not include a device response.");

  const parentId = parent ? parent.parent.id : device!.kid.parentId;
  const kidId = parent ? null : device!.kid.id;
  const { rpId, origins } = relyingParty(req);
  const label = str(body.label).trim() || deviceLabel(req.headers.get("user-agent"));

  const outcome = await store.mutate((doc) => {
    const challenge = takeChallenge(doc, { id: challengeId, purpose: "register", parentId, kidId });
    if (!challenge) return { failed: "That request expired. Please start again.", passkey: null, duplicate: false };

    try {
      const registered = verifyRegistration({ response: credential, challenge: challenge.challenge, origins, rpId });
      if (doc.passkeys.some((p) => p.credentialId === registered.credentialId)) {
        return { failed: null, passkey: null, duplicate: true };
      }
      const passkey: PasskeyRecord = {
        id: newId(),
        credentialId: registered.credentialId,
        publicKey: registered.publicKey,
        counter: registered.counter,
        parentId,
        kidId,
        label,
        transports: registered.transports,
        synced: registered.synced,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      doc.passkeys.push(passkey);
      return { failed: null, passkey, duplicate: false };
    } catch (cause) {
      return {
        failed: cause instanceof WebAuthnError ? cause.message : "That fingerprint could not be saved. Please try again.",
        passkey: null,
        duplicate: false,
      };
    }
  });

  if (outcome.failed) return error(outcome.failed, 400);
  if (outcome.duplicate) return error("That fingerprint is already set up for BrainyKids.", 409);

  const kid = outcome.passkey?.kidId ? (await store.read()).kids.find((k) => k.id === outcome.passkey!.kidId) : undefined;
  return json({ passkey: passkeyView(outcome.passkey!, kid), label });
});
