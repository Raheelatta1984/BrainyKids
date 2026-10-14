import type { NextRequest } from "next/server";
import { COOKIES, cookieOptions, deviceLabel, newToken, tokenHash } from "@/lib/server/auth";
import { DEVICE_DAYS, PARENT_SESSION_DAYS } from "@/lib/server/constants";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { findPasskeyByCredentialId, takeChallenge } from "@/lib/server/passkeys";
import { linkDevice } from "@/lib/server/service";
import { pushEvent, sessionExpiry, store } from "@/lib/server/store";
import { relyingParty, verifyAssertion, WebAuthnError, type WebAuthnResponse } from "@/lib/server/webauthn";
import { kidView } from "@/lib/server/views";

export const runtime = "nodejs";

/**
 * Finishes a fingerprint / face unlock sign-in.
 *
 * A credential belonging to a parent signs this device in as that parent; one
 * belonging to a child locks the device to that child, exactly like typing the
 * child's username and PIN would.
 */
export const POST = route(async (req: NextRequest) => {
  const body = await readBody(req);
  const challengeId = str(body.id);
  const credential = body.credential as WebAuthnResponse | undefined;
  if (!challengeId || !credential) return error("That request did not include a device response.");

  const { rpId, origins } = relyingParty(req);
  const label = deviceLabel(req.headers.get("user-agent"));
  const sessionToken = newToken();
  const deviceToken = newToken();

  const outcome = await store.mutate((doc) => {
    const challenge = takeChallenge(doc, { id: challengeId, purpose: "login" });
    if (!challenge) return { failed: "That sign-in attempt expired. Please try again.", role: null as null | "parent" | "kid" };

    const rawId = credential.rawId ?? credential.id ?? "";
    const passkey = findPasskeyByCredentialId(doc.passkeys, rawId);
    if (!passkey) return { failed: "That fingerprint is not set up for BrainyKids.", role: null };

    try {
      const { counter } = verifyAssertion({
        response: credential,
        challenge: challenge.challenge,
        origins,
        rpId,
        credentialId: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
      });
      passkey.counter = counter;
      passkey.lastUsedAt = Date.now();
    } catch (cause) {
      return {
        failed: cause instanceof WebAuthnError ? cause.message : "That fingerprint could not be checked. Please try again.",
        role: null,
      };
    }

    if (passkey.kidId) {
      const kid = doc.kids.find((k) => k.id === passkey.kidId);
      if (!kid) return { failed: "That child profile no longer exists.", role: null };
      linkDevice(doc, kid, label, deviceToken);
      pushEvent(doc, {
        type: "device.linked",
        parentId: kid.parentId,
        kidId: kid.id,
        payload: { kidName: kid.name, label, method: "fingerprint" },
      });
      return { failed: null, role: "kid" as const };
    }

    const parent = doc.parents.find((p) => p.id === passkey.parentId);
    if (!parent) return { failed: "That parent account no longer exists.", role: null };
    doc.sessions.push({
      tokenHash: tokenHash(sessionToken),
      parentId: parent.id,
      createdAt: Date.now(),
      expiresAt: sessionExpiry(),
    });
    return { failed: null, role: "parent" as const };
  });

  if (outcome.failed || !outcome.role) return error(outcome.failed ?? "Fingerprint sign-in failed.", 401);

  const doc = await store.read();
  if (outcome.role === "parent") {
    const res = json({ role: "parent" as const });
    res.cookies.set(COOKIES.parent, sessionToken, cookieOptions(PARENT_SESSION_DAYS * 24 * 60 * 60));
    return res;
  }

  const device = doc.devices.find((d) => d.tokenHash === tokenHash(deviceToken));
  const kid = device ? doc.kids.find((k) => k.id === device.kidId) : undefined;
  const res = json({ role: "kid" as const, kid: kid ? kidView(doc, kid) : null });
  res.cookies.set(COOKIES.device, deviceToken, cookieOptions(DEVICE_DAYS * 24 * 60 * 60));
  return res;
});
