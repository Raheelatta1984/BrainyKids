import type { NextRequest } from "next/server";
import { json, route } from "@/lib/server/http";
import { createChallenge } from "@/lib/server/passkeys";
import { store } from "@/lib/server/store";
import { relyingParty } from "@/lib/server/webauthn";

export const runtime = "nodejs";

/**
 * Starts a fingerprint / face unlock sign-in: the browser is handed the list of
 * credentials set up on this server and asks the device to unlock one of them.
 */
export const POST = route(async (req: NextRequest) => {
  const { rpId } = relyingParty(req);
  const result = await store.mutate((doc) => {
    const challenge = createChallenge(doc, { purpose: "login" });
    return {
      id: challenge.id,
      challenge: challenge.challenge,
      credentials: doc.passkeys.map((p) => ({
        type: "public-key" as const,
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransport[],
      })),
    };
  });

  if (result.credentials.length === 0) {
    return json({ available: false, id: null, options: null });
  }

  return json({
    available: true,
    id: result.id,
    options: {
      challenge: result.challenge,
      rpId,
      timeout: 120_000,
      userVerification: "preferred",
      allowCredentials: result.credentials,
    },
  });
});
