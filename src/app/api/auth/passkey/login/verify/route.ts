import type { NextRequest } from "next/server";
import { deviceLabel, newToken, tokenHash } from "@/lib/server/auth";
import { error, json, readBody, route, str } from "@/lib/server/http";
import { logBehaviour } from "@/lib/server/diagnostics";
import { findPasskeyByCredentialId, takeChallenge } from "@/lib/server/passkeys";
import { linkDevice } from "@/lib/server/service";
import { clearDeviceSessionCookies, setDeviceSessionCookies, setParentSessionCookies } from "@/lib/server/session";
import { pushEvent, sessionExpiry, store, type ParentRecord, type SessionRecord } from "@/lib/server/store";
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

  const challenge = await store.find("challengeId", challengeId);
  if (!challenge || challenge.record.purpose !== "login" || challenge.record.expiresAt <= Date.now()) {
    return error("That sign-in attempt expired. Please try again.", 401);
  }

  const { rpId, origins } = relyingParty(req);
  const label = deviceLabel(req.headers.get("user-agent"));
  const sessionToken = newToken();
  const deviceToken = newToken();

  const outcome = await store.mutate((doc) => {
    const challenge = takeChallenge(doc, { id: challengeId, purpose: "login" });
    if (!challenge) {
      return {
        failed: "That sign-in attempt expired. Please try again.",
        role: null as null | "parent" | "kid",
        parent: null as ParentRecord | null,
        session: null as SessionRecord | null,
      };
    }

    const rawId = credential.rawId ?? credential.id ?? "";
    const passkey = findPasskeyByCredentialId(doc.passkeys, rawId);
    if (!passkey) return { failed: "That fingerprint is not set up for BrainyKids.", role: null, parent: null, session: null };

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
        parent: null,
        session: null,
      };
    }

    if (passkey.kidId) {
      const kid = doc.kids.find((k) => k.id === passkey.kidId);
      if (!kid) return { failed: "That child profile no longer exists.", role: null, parent: null, session: null };
      linkDevice(doc, kid, label, deviceToken);
      pushEvent(doc, {
        type: "device.linked",
        parentId: kid.parentId,
        kidId: kid.id,
        payload: { kidName: kid.name, label, method: "fingerprint" },
      });
      return { failed: null, role: "kid" as const, parent: null, session: null };
    }

    const parent = doc.parents.find((p) => p.id === passkey.parentId);
    if (!parent) return { failed: "That parent account no longer exists.", role: null, parent: null, session: null };
    const now = Date.now();
    const session: SessionRecord = {
      tokenHash: tokenHash(sessionToken),
      parentId: parent.id,
      createdAt: now,
      expiresAt: sessionExpiry(now),
    };
    doc.sessions.push(session);
    return { failed: null, role: "parent" as const, parent, session };
  });

  if (outcome.failed || !outcome.role) return error(outcome.failed ?? "Fingerprint sign-in failed.", 401);

  const doc = await store.read();
  if (outcome.role === "parent") {
    const res = json({ role: "parent" as const });
    if (outcome.parent && outcome.session) {
      setParentSessionCookies(res, sessionToken, outcome.parent, outcome.session);
    }
    return res;
  }

  const device = doc.devices.find((d) => d.tokenHash === tokenHash(deviceToken));
  const kid = device ? doc.kids.find((k) => k.id === device.kidId) : undefined;
  const parentOfKidRecord = kid ? doc.parents.find((p) => p.id === kid.parentId) : undefined;
  const res = json({ role: "kid" as const, kid: kid ? kidView(doc, kid, Date.now(), "kid") : null });
  if (device && kid) {
    setDeviceSessionCookies(res, deviceToken, device, kid, parentOfKidRecord ?? null, req);
    void logBehaviour(
      {
        code: "kid.session.linked",
        parentId: kid.parentId,
        kidId: kid.id,
        kidName: kid.name,
        deviceId: device.id,
        role: "kid",
        vars: {
          kidName: kid.name,
          deviceLabel: device.label,
          kidId: kid.id,
          deviceId: device.id,
          driver: store.info().driver,
          durable: store.info().durable,
        },
        context: { trigger: "fingerprint", label: device.label },
      },
      { throttleKey: device.id, force: true },
    ).catch(() => undefined);
  } else {
    clearDeviceSessionCookies(res, req);
  }
  return res;
});
