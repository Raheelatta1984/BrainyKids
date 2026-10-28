# BrainyKids | Credential-storage & browser-transport hardening review

**Run date:** 28 October 2026 (UTC). **Baseline commit:** `9ecd03a88882dac9211f4b33fa8edade7d5a2a20` (branch `main`, PR #15 merge).
**Work branch:** `arena/7226847b-brainykids`. **Repository:** `Raheelatta1984/BrainyKids`.
**Scope applied:** `APPLY_SCOPE=all`, `CSP_MODE=auto`, `DRY_RUN=false`.

This is an implementation run for the *credential-storage / XSS / cookies / headers / supply-chain*
vulnerability class, not a certification. It follows the same evidence-first standard as
`security-review-2026-10-16.md`; where that earlier review's findings are already resolved on this
baseline, that is recorded here rather than silently dropped.

## 1. Applicability verdict

| Tier | Verdict | Why |
|---|---|---|
| **A** — move credentials out of script-readable storage | **Not applicable** | No credentials live in `localStorage`/`sessionStorage`/IndexedDB/JS-set cookies or in URLs. Auth is already an opaque bearer token in `HttpOnly` cookies, and CSRF is defended. Details in §3. |
| **B** — defence in depth (headers / CSP / no-store / exposed tooling) | **Applicable** | No CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` or HSTS anywhere in source or `next.config.ts`; confirmed at runtime. No exposed dev tooling (all probes 404). |
| **C** — supply chain + regression guards | **Applicable** | Lockfile is committed, but there is no CI workflow, no dependency-audit step, no Dependabot/Renovate, and no regression guard that stops credentials returning to web storage. |

Tier A is recorded as *Not applicable*, so per the run rules this PR implements Tier B and Tier C in
full and does not change the auth transport. Two Tier A hardening *options* that were deliberately
**not** taken are listed under "Deferred" in §6 so the decision is explicit and reviewable.

## 2. Stack

Next.js 16.4.2 (App Router) · React 19.2.6 · TypeScript 5.9 · Tailwind CSS 4 · `pg` + Drizzle ORM
(optional Neon/Postgres) · optional Memcached (`memjs`) · Node 22. Auth is cookie-based, not JWT
(opaque 256-bit tokens). No `.github/workflows` directory and no `middleware.ts` existed at baseline.

## 3. Tier A — evidence (no change made)

| Check | Searched | Found |
|---|---|---|
| `localStorage`/`sessionStorage` credential writes/reads | `rg -ni '(localStorage|sessionStorage)\.(setItem\|getItem\|removeItem)…(token\|jwt\|auth\|session\|secret\|api[_-]?key\|credential\|refresh\|id_token\|access)' src/` | **0 matches** |
| Bracket access `storage["token"…]` | same | **0 matches** |
| AsyncStorage / IndexedDB / localforage | `rg -ni 'AsyncStorage\|indexedDB\|localforage\|idb-keyval' src/` | **0 matches** |
| `document.cookie =` / JS-cookie libs | `rg -ni 'document\.cookie\s*=…' src/` | 2 matches, both a non-credential cookie probe (§4, #7) |
| `Bearer` built from storage | `rg -ni 'Bearer…(getItem\|localStorage…)' src/` | **0 matches** |
| Tokens in URLs / HTML state / persisted-state slices | `rg -ni` patterns from the run | **0 matches** |
| Vendor auth-SDK storage config (Auth0/Firebase/Supabase/MSAL) | `rg -ni 'cacheLocation\|persistSession\|…' src/` | **0 matches** — no third-party auth SDK |

Auth transport (already correct):

- `src/lib/server/auth.ts:113-121` `cookieOptions()` → `httpOnly: true`, `sameSite: "lax"`,
  `secure: requestIsSecure(req)`, `path: "/"`, `maxAge`.
- Set on login `src/lib/server/session.ts:20`, on device link `session.ts:54`, on pairing
  `src/app/api/pairing/start/route.ts:106`. All three cookies (`bk_parent`, `bk_device`,
  `bk_pairing`) go through the same options, so none can be read by script.
- Tokens are opaque random 256-bit values (`newToken`, `auth.ts:18-20`) stored only as
  `sha256(token)` server-side (`tokenHash`, `auth.ts:22-24`); there is no JWT, so the JWT-algorithm
  allowlist checks are not applicable.
- CSRF: unsafe methods are gated by `isSafeOrigin()` (`src/lib/server/http.ts:7-21`, compares the
  `Origin` against the request host, falling back to `Sec-Fetch-Site`) inside the shared `route()`
  wrapper (`http.ts:97-101`). Cookies are `SameSite=Lax`. No credentialed CORS exists
  (`rg` for `Access-Control-Allow-Origin`/`credentials: "include"` → 0 matches).
- The client fetches with `credentials: "same-origin"` (`src/lib/client/request.ts:24`).
- `src/lib/server/auth.ts:70,73` still declare `bk_parent_state` / `bk_device_state`, but they are
  never written or read anywhere in `src/` — dead constants. The earlier review's "credential hashes
  in backup cookies" finding is **not reproducible on this baseline**.

**Verdict:** auth is already cookie-based with correct attributes and a CSRF defence, and no
credential is script-readable → Tier A not applicable. No change to the transport is proposed.

## 4. Findings

| # | Severity | Finding | Evidence (path:line) | Recommended action | Tier |
|---|---|---|---|---|---|
| 1 | **High** | No `Content-Security-Policy`. React escapes by default, but there is no structural script-injection control; a single unsafe sink would be unguarded. | runtime probe `GET /` returned only `Cache-Control`; `rg` for `content_security_policy\|Content-Security-Policy` → 0 source matches | Add a nonce-based CSP in `src/middleware.ts`; render the HTML pages per request so Next can attach the nonce to its inline scripts | B |
| 2 | **High** | No `X-Content-Type-Options: nosniff` — MIME-sniffing risk on responses. | same runtime probe | Set centrally in middleware | B |
| 3 | **Medium** | No `X-Frame-Options` / `frame-ancestors` — clickjacking exposure. | same | `frame-ancestors 'none'` in CSP + legacy `X-Frame-Options: DENY` | B |
| 4 | **Medium** | No `Referrer-Policy` — full-URL referrers can leak identifiers to third parties. | same | `Referrer-Policy: strict-origin-when-cross-origin` | B |
| 5 | **Medium** | No `Permissions-Policy` — camera/geolocation/payment are not explicitly denied. | same | `camera=(), geolocation=(), payment=(), accelerometer=(), gyroscope=(), magnetometer=(), usb=()`. **`microphone` is deliberately left open**: the app runs same-origin speech-to-text (`src/lib/voice.ts`). | B |
| 6 | **Medium** | No `Strict-Transport-Security` on HTTPS hosts. | same | HSTS only where the hostname is HTTPS-only; never on `localhost`; no `preload` | B |
| 7 | **Low** | `document.cookie` probe sets a JS-writable cookie (`bk_cookie_probe=1`). Not a credential, so it cannot be stolen for auth, but it is script-writable and sits outside the "no JS-set cookies" discipline. | `src/lib/client/diagnostics.ts:45,47` | Accepted as a deliberate, non-credential cookie-support probe. No change. | A |
| 8 | **Low** | Auth cookies are not `__Host-`-prefixed. All prerequisites hold (`Secure`, `Path=/`, no `Domain`), so the prefix is available but unused. | `src/lib/server/auth.ts:68-75, 113-121` | Deferred (§6) — renaming forces a re-login for no measurable risk reduction here. | A/B |
| 9 | **Low** | Auth cookies carry no `Partitioned` (CHIPS) attribute. | `auth.ts:113-121` | Not applicable — the app sets `frame-ancestors 'none'`, so it is not cross-site embedded. | A |
| 10 | **High** | No CI at all: no test/lint/type-check/build gate, no dependency audit, no web-storage regression guard, no Dependabot/Renovate. | `ls .github/workflows` → absent; `rg` for `dependabot\|renovate` → absent | Add `.github/workflows/ci.yml` (deterministic `npm ci`, tests, lint, typecheck, build, `npm audit --audit-level=high`) and `.github/dependabot.yml` | C |
| 11 | **Medium** | Four direct dependencies use caret ranges. The lockfile pins them, so this is not an exposure today, but the manifest alone is not reproducible. | `package.json`: `memjs ^1.3.2`, `qrcode ^1.5.4`, `@types/qrcode ^1.5.5`, `tsx ^4.21.0` | Keep `^` ranges (npm convention) and rely on the committed lockfile + `npm ci`. Documented, not changed. | C |

Audit summary: `npm audit` reports **4 moderate** vulnerabilities, all in dev tooling
(`esbuild`, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit`). None is High/Critical,
so an audit gate at `--audit-level=high` passes (exit 0).

## 5. Changes made

### Tier B — `src/middleware.ts` (new), `src/app/layout.tsx`, `scripts/security-headers-selftest.ts`

- **`src/middleware.ts`** sets, for every request:
  - `Content-Security-Policy` built with a per-request nonce: `default-src 'self'`,
    `script-src 'self' 'nonce-…'`, `style-src 'self' 'unsafe-inline'` (five React inline style
    objects exist and cannot carry a nonce), `img-src 'self' data: blob:`, `font-src 'self'`,
    `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`,
    `frame-ancestors 'none'`, plus `upgrade-insecure-requests` over HTTPS in production.
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
    `X-Frame-Options: DENY`, `Permissions-Policy` (camera/geolocation/payment/etc denied,
    microphone allowed).
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` — HTTPS + production only,
    never `localhost`, no `preload`.
  - The policy is attached to the **request** headers as well as the response, because Next.js
    extracts the nonce from the request's CSP header while it renders.
  - Production enforces the policy; development sends it as `Content-Security-Policy-Report-Only` so
    `next dev` is never blocked. **No `unsafe-inline` or `unsafe-eval` in `script-src` anywhere.**
- **`src/app/layout.tsx`** gains `export const dynamic = "force-dynamic"` so the HTML pages render per
  request and Next can tag its inline hydration scripts with the nonce. Static pages are prerendered
  at build time, when no nonce exists, so this is required for the policy to hold.
- **`scripts/security-headers-selftest.ts`** (new, wired into `npm run protection-selftest`) asserts the
  safe directives, that `script-src` never uses `unsafe-inline`/`unsafe-eval`, nonce freshness, the
  enforced-vs-report-only split, HSTS conditions, and the `Permissions-Policy` allow/deny set.

### Tier C — `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.security-storage-allowlist`

- **`.github/workflows/ci.yml`** — three jobs: `test` (`npm ci` → test, lint, typecheck, build),
  `audit` (`npm ci` → `npm audit --audit-level=high`), and `storage-guard` (fails if a
  credential-shaped value is written to `localStorage`/`sessionStorage`, or if a real `.env` file is
  tracked). All third-party actions are pinned to 40-char commit SHAs.
- **`.github/dependabot.yml`** — weekly `npm` and `github-actions` updates.
- **`.security-storage-allowlist`** — empty by default; the exact file paths any future web-storage
  exception must be added to.

## 6. Deferred / follow-ups

- **`__Host-` cookie prefix (#8).** All prerequisites (`Secure`, `Path=/`, no `Domain`) hold, so it is
  technically available. Renaming `bk_parent`/`bk_device`/`bk_pairing` would force every signed-in
  user and linked device to re-authenticate for no measurable risk reduction on a same-origin,
  `Path=/` host. Recorded as a proposal, not implemented.
- **`Partitioned`/CHIPS (#9).** Not applicable while the app sets `frame-ancestors 'none'`; CHIPS only
  matters for cross-site embedding.
- **Microphone permissions (#5).** The app uses browser speech-to-text, so `Permissions-Policy`
  denies camera/geolocation/payment but leaves `microphone` to the same-origin SpeechRecognition
  flow. Revisit only if a deployment needs an explicit consent UX.
- **HSTS.** Only added where every environment on the hostname is HTTPS. Not enabled for `localhost`;
  no `preload`. Verify HTTPS coverage per deployment before relying on it.
- **Exposed tooling.** No API docs/playground is shipped by this app (`/docs`, `/api/docs`, `/swagger`,
  `/redoc`, `/graphql` all return 404), so there is nothing to env-gate.

## 7. Verification

**Baseline vs. after** — `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build` were all
green before and after (no pre-existing failures; nothing disabled). The only addition is 9 new
header checks inside `npm run test`.

**Re-run of the 1.2 scans** — zero matches in client code (no credentials in web storage). The CI
`storage-guard` job now enforces this permanently.

**Runtime (production build, `next start`, localhost)**:

```
GET /              → CSP (nonce) · nosniff · Referrer-Policy · X-Frame-Options DENY · Permissions-Policy
GET /api/storage   → CSP (nonce) · nosniff · Referrer-Policy · X-Frame-Options DENY · no-store
```

HSTS is absent on `http://localhost` by design; a `/_next/static/*.js` asset still gets a long
`Cache-Control: public, max-age=31536000, immutable` and a CSP header (harmless on a subresource).

**CSP nonce injection** — fetched each page once and confirmed every inline `<script>` carries the
`nonce="…"` that matches the CSP header of the same response, with **zero** inline scripts lacking a
nonce (`/` and `/parent`: 12 script tags each; `/pair/ABCDEF`: 11). Each request mints a fresh nonce.

**Cookie attributes** (login response, simulated https):

```
set-cookie: bk_parent=<redacted>; Path=/; Expires=…; Max-Age=2592000; Secure; HttpOnly; SameSite=lax
```

`HttpOnly` ✓ · `Secure` ✓ · `SameSite=Lax` ✓ · `Path=/` ✓ · no `Domain` ✓.

**CSRF probe** — `POST /api/auth/logout` with `Origin: https://evil.example` → **403**; the same request
with `Origin: http://localhost:3000` → **200**.

**Exposed tooling** — `/docs`, `/api/docs`, `/swagger`, `/redoc`, `/graphql` → **404**.

**Audit** — `npm audit --audit-level=high` exits 0; 4 moderate advisories remain (dev-only
`esbuild`/`drizzle-kit` tooling).

**Browser harness** — none. There is no Playwright or Cypress configuration, so hydration was verified
by inspecting the served HTML for matching nonces rather than by driving a browser. A browser-driven
smoke test is the recommended follow-up.
