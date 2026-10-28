import { NextResponse, type NextRequest } from "next/server";

/**
 * Central security headers + a per-request Content-Security-Policy.
 *
 * Auth here is an opaque bearer token in an `HttpOnly` cookie, so the point of a
 * CSP is not to stop a token being read by script (HttpOnly already does that) —
 * it is to stop an injected script from *running* at all, which is the control that
 * makes a single XSS bug survivable.
 *
 * Next.js emits inline `<script>` tags for hydration, so `script-src 'self'` alone
 * would block the whole app. Instead we mint a nonce per request and put it on the
 * policy; Next.js reads the policy off the request headers and tags its inline
 * scripts with the same nonce. That is why the policy is set on the request *and*
 * the response, and why the HTML pages render per request (see `dynamic` in
 * `src/app/layout.tsx`). `unsafe-inline` is never used for scripts.
 */

/** A fresh base64url nonce from Web Crypto (works on the Edge runtime). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** True when the request arrived over TLS (honours a sanitising proxy's proto). */
function requestIsSecure(req: NextRequest): boolean {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return new URL(req.url).protocol === "https:";
}

export function buildCsp(nonce: string, upgradeInsecure: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    // Five React inline style objects exist in the components; style attributes
    // cannot carry a nonce, so inline styles stay allowed (scripts do not).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export type SecurityHeaderOptions = { production: boolean; secure: boolean };

/**
 * The response headers every request gets. Enforced in production; in development
 * the policy is sent as `Content-Security-Policy-Report-Only` so local `next dev`
 * is never blocked. HSTS is only emitted where the hostname is HTTPS in production,
 * never on `localhost`, and without `preload`.
 */
export function securityHeaderValues(
  policy: string,
  { production, secure }: SecurityHeaderOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Legacy complement to `frame-ancestors`; some older browsers still need it.
    "X-Frame-Options": "DENY",
    // Deny everything the app does not use. `microphone` is deliberately left open:
    // speech-to-text runs in the same origin and needs it.
    "Permissions-Policy":
      "camera=(), geolocation=(), payment=(), accelerometer=(), gyroscope=(), magnetometer=(), usb=()",
  };
  if (production) {
    headers["Content-Security-Policy"] = policy;
  } else {
    headers["Content-Security-Policy-Report-Only"] = policy;
  }
  if (secure && production) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

export function middleware(req: NextRequest) {
  const nonce = newNonce();
  const secure = requestIsSecure(req);
  const production = process.env.NODE_ENV === "production";
  const policy = buildCsp(nonce, secure && production);

  // Next.js extracts the nonce from the CSP header on the request while it renders,
  // so the policy has to be attached to the request as well as the response.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  for (const [name, value] of Object.entries(securityHeaderValues(policy, { production, secure }))) {
    response.headers.set(name, value);
  }
  return response;
}
