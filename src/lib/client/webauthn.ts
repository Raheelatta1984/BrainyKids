"use client";

import { api } from "./api";

/**
 * Browser half of fingerprint / face unlock.
 *
 * The biometric prompt itself belongs to the operating system: the page asks for
 * a WebAuthn credential and Safari (Touch ID / Face ID), Chrome on Android,
 * Windows Hello or an iPhone passkey does the scanning. Everything the server
 * needs to check is sent as base64url strings.
 */

export type PasskeyPromptResult = { ok: true; label: string } | { ok: false; error: string };

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  // An explicit ArrayBuffer keeps the DOM types happy: WebAuthn wants BufferSource.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Why a device cannot show the prompt, or null when it can. */
export function fingerprintBlockedReason(): string | null {
  if (typeof window === "undefined") return "Fingerprint unlock is only available in the browser.";
  if (!window.isSecureContext) {
    return "Fingerprint unlock needs a secure address (https://). Open BrainyKids on its https address and try again.";
  }
  if (window.top !== window.self) {
    return "Fingerprint unlock cannot run inside an embedded preview. Open BrainyKids in its own browser tab.";
  }
  if (!window.PublicKeyCredential) {
    return "This browser does not support fingerprint or face unlock. Use Safari, Chrome or Edge on a device with a sensor.";
  }
  return null;
}

/** True when this device has a built-in fingerprint sensor / face unlock. */
export async function hasPlatformSensor(): Promise<boolean> {
  if (fingerprintBlockedReason()) return false;
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return Boolean(available);
  } catch {
    return false;
  }
}

function describe(error: unknown): string {
  const name = (error as DOMException | undefined)?.name;
  if (name === "NotAllowedError") {
    return "The fingerprint prompt was closed or timed out. Please try again and keep your finger on the sensor.";
  }
  if (name === "InvalidStateError") return "That fingerprint is already set up for BrainyKids.";
  if (name === "SecurityError") return "The browser blocked fingerprint unlock here. Open BrainyKids in its own tab over https://.";
  if (name === "NotSupportedError") return "This device has no fingerprint sensor or face unlock available.";
  if (name === "AbortError") return "The fingerprint prompt was cancelled.";
  return "Fingerprint unlock did not finish. Please try again.";
}

function serializeCreation(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

function serializeAssertion(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

type RegisterOptions = {
  id: string;
  label: string;
  options: {
    challenge: string;
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: PublicKeyCredentialParameters[];
    timeout: number;
    attestation: AttestationConveyancePreference;
    excludeCredentials: { type: "public-key"; id: string; transports?: AuthenticatorTransport[] }[];
    authenticatorSelection: AuthenticatorSelectionCriteria;
  };
};

type LoginOptions = {
  available: boolean;
  id: string | null;
  options: {
    challenge: string;
    rpId: string;
    timeout: number;
    userVerification: UserVerificationRequirement;
    allowCredentials: { type: "public-key"; id: string; transports?: AuthenticatorTransport[] }[];
  } | null;
};

/** Set up fingerprint / face unlock for whoever is signed in on this device. */
export async function registerFingerprint(options?: { label?: string }): Promise<PasskeyPromptResult> {
  const blocked = fingerprintBlockedReason();
  if (blocked) return { ok: false, error: blocked };

  const request = await api.post<RegisterOptions>("/api/auth/passkey/register/options", { label: options?.label });
  if (!request.ok) return request;

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        ...request.data.options,
        challenge: fromBase64Url(request.data.options.challenge),
        user: { ...request.data.options.user, id: fromBase64Url(request.data.options.user.id) },
        excludeCredentials: request.data.options.excludeCredentials.map((entry) => ({
          ...entry,
          id: fromBase64Url(entry.id),
        })),
      },
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  if (!credential) return { ok: false, error: "Fingerprint setup did not finish." };

  const verify = await api.post<{ passkey: { label: string } }>("/api/auth/passkey/register/verify", {
    id: request.data.id,
    label: options?.label ?? request.data.label,
    credential: serializeCreation(credential as PublicKeyCredential),
  });
  if (!verify.ok) return verify;
  return { ok: true, label: verify.data.passkey.label };
}

/** Sign in with the fingerprint / face already set up on this device. */
export async function signInWithFingerprint(): Promise<{ ok: true; role: "parent" | "kid" } | { ok: false; error: string }> {
  const blocked = fingerprintBlockedReason();
  if (blocked) return { ok: false, error: blocked };

  const request = await api.post<LoginOptions>("/api/auth/passkey/login/options", {});
  if (!request.ok) return request;
  if (!request.data.available || !request.data.options || !request.data.id) {
    return { ok: false, error: "No fingerprint is set up yet. Sign in with your password, then turn it on." };
  }

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        ...request.data.options,
        challenge: fromBase64Url(request.data.options.challenge),
        allowCredentials: request.data.options.allowCredentials.map((entry) => ({
          ...entry,
          id: fromBase64Url(entry.id),
        })),
      },
    });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  if (!credential) return { ok: false, error: "Fingerprint sign-in did not finish." };

  const verify = await api.post<{ role: "parent" | "kid" }>("/api/auth/passkey/login/verify", {
    id: request.data.id,
    credential: serializeAssertion(credential as PublicKeyCredential),
  });
  if (!verify.ok) return verify;
  return { ok: true, role: verify.data.role };
}
