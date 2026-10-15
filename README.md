# BrainyKids

BrainyKids Challenge Mode — a Next.js quiz app for kids with a parent dashboard,
parent and kid sign-in, QR device linking and realtime progress updates.

## How it works

1. **Parent signs up first** (`/` → *Parent sign up*, or *Parent sign in* with an
   email and password). The parent account owns the children, their progress and
   every device linked to the family. Signing up hands the parent a one-time
   **recovery code** to save — it is what *Forgot password?* asks for, because
   BrainyKids does not send email.
2. **The parent adds each child** on the dashboard: name, age, gender, theme plus
   a **kid username** and a **kid PIN**. No email is needed for a child.
3. **The child's device is linked by QR code.** On the kid device tap
   *Kid sign in* → the device shows a **QR code**, a **share link** and a
   **6-character code**, and waits. The parent scans the code with their phone
   camera (which opens `/pair/<code>`), or types the code into the dashboard,
   chooses which child the device belongs to and taps **Approve**. The kid device
   signs in immediately — it polls in the background, so nobody has to press
   anything on the child's side.
4. **Kid mode locks the device.** From then on that device opens straight into
   that child's app: no profile picker, no route into the parent area. It stays
   that way **until a parent signs it out**. There are three ways a parent can end
   kid mode:
   - tap **🔒 Parent** in the kid app and enter the parent password,
   - tap **Sign out this device** on the child's card in the parent dashboard
     (works remotely from the parent's own phone, even on a different device),
   - or delete the child / the device link.
5. **Parents can sign in on any device** — their phone, a tablet, the same device
   the child uses (after signing the child out of kid mode), or several devices at
   once. Every signed-in parent device sees the same live picture.
6. **Everything mirrors in realtime.** Answers, level unlocks, screen-time
   requests, cheers and device status are pushed to the other devices as they
   happen (Server-Sent Events, with polling as a fallback).

### Realtime map

| Kid device does | Parent device shows (instantly) |
| --- | --- |
| answers a question | accuracy, points, "Correct · Maths" in Recent activity |
| finishes a level | unlocked level, 🏅 activity entry |
| asks for screen time | ⏱️ toast + Approve / Send back buttons |
| opens a device-link screen | 🔗 toast with the pairing code |
| goes offline/online | green online dot, "last seen …" |
| gets a cheer / approval | toast + spoken message on the kid device |
| sends a chat message (typed or spoken) | the message appears in the child's card, with a 🔊 button |
| receives a chat message | the tablet reads it out loud and shows “1 new” |

### Signing in

- **Password.** Email + password, as above.
- **Forgot password.** The sign-in screen has a *Forgot password?* link. The
  parent enters their email, the **recovery code** they saved and a new password;
  the old code is used up and a new one is shown. Five wrong codes lock the form
  for 15 minutes, and a wrong email and a wrong code give the same answer so the
  form cannot be used to discover who has an account.
  No code to hand? Any device still signed in as a parent can issue a new one
  under **Sign-in & security** on the dashboard, and whoever runs a self-hosted
  copy can run `npm run reset-password -- parent@example.com "new password"`.
- **Fingerprint / face unlock.** Uses WebAuthn passkeys: Safari prompts Touch ID
  or Face ID, Chrome on Android the fingerprint sensor, Edge and Windows Hello
  the device PIN or face. A parent turns it on from **Sign-in & security**;
  a child turns it on right after signing in on their device, and can then tap
  the sensor instead of typing a username and PIN. Passkeys are stored per web
  address and are removed again from the same dashboard card.
- **Changing the password** from the dashboard signs out every other device and
  replaces the recovery code.

### Master settings (date, time, language, voice)

The dashboard has a **Settings** tab. One set of choices governs the whole app:

| Setting | What it changes |
| --- | --- |
| Time zone | every date and time: activity, chat, the behavioural log, the review report |
| Date format | `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD` or “follow the language” |
| Time format | 12-hour, 24-hour or “follow the language” |
| Language | the child's screen, chat labels, spoken questions and answers |
| Voice over | whether chat and questions are read aloud, and whether children may answer by speaking |
| Read new messages aloud | whether a device speaks incoming chat as it arrives |

The languages offered are English, Spanish, French, Arabic, Urdu, Hindi and
Chinese, each with its own speech voice and its own translation of the question
bank (`src/lib/quiz-i18n.ts`). Arabic and Urdu flip the child's screen to
right-to-left. The same settings are stored on the server, so the child's tablet,
the parent's phone and the log all use the family's own date, time and language.

Every behavioural log line records the settings that were in force when it was
written, so a review can see the world as the family saw it.

### Rewards: real money or Robux, per-question timers, endless levels

Alongside screen time, children now earn **actual money in the family's local
currency — or Robux** — for answering questions. All of it is set by the parent
in **Master settings**:

| Setting | Default | What it does |
| --- | --- | --- |
| Earn | Real money | …or Robux (Roblox), if the family prefers that |
| Currency | AUD | Australian dollar, US dollar, pound, euro, rupee and more (shown with real decimals, e.g. A$0.50 — amounts are stored as integer cents, never floats) |
| Reward for a perfect answer | 50 (cents / Robux) | A 100% answer earns this in full |
| Daily / weekly earn limit | A$2.00 / A$10.00 (0 = no limit) | Caps how much can be earned per day and per Mon–Sun week |
| Earning schedule | Off | Optionally only earn on chosen weekdays between two times (family time zone) |
| Question timers | Easy 120s · Medium 300s · Hard 600s | Every question counts down; harder questions get more time, never more than 10 minutes. Timing out earns nothing for that question |

Rewards are **proportional to how close the answer is**, decided on the server:
100% earns the full amount (50c), 90%+ earns 80% of it (40c of 50c), 75%+ earns
50%, 50%+ earns 25%, and under 50% earns nothing. Numeric answers are scored by
proximity, word answers by similarity, so a near miss still earns something.

The money collects in the child's **wallet**. When the child taps *Ask a parent
to realise…*, the request goes to the parent live. The wallet is **only reset
to zero when a parent approves** (sending it back keeps the balance). Every
step — each amount earned (with its question, topic, level and closeness %),
each realise request, each approval and each send-back — is written to the
child's **transaction log** on the dashboard and to the behavioural log
(`reward.*`, `quiz.timed_out`). Parents pay the child outside the app; the app
is the ledger, not a bank.

**Levels never end.** Finishing a level always unlocks the next one — Level 4,
5, … 8 and beyond (the bank's three difficulty tiers map onto them, so higher
levels ask the hardest questions). Both the kid screen and the parent dashboard
show a family **scoreboard** ranked by level, then accuracy, then lifetime
earnings, so children can compete on “I'm on Level 8!”.

### Chat and voice over

Each child card has a chat thread that both sides can use:

- a child taps the microphone and **speaks**; the browser turns it into text
  (marked “voice note”) and the parent sees it instantly,
- a parent types or dictates a reply; the tablet **reads it out loud** as soon as
  it arrives,
- every message has a 🔊 button to hear it again, in the family's language,
- the child's screen shows quick phrases (“I finished!”, “I need help”) so a
  child who cannot type yet can still send a message,
- messages are text: no audio files are stored on the server.

If a browser has no speech engine, the app says so and the line is written to the
behavioural log (`chat.voice_missing`) instead of failing silently.

### When storage is not writable

If the project folder cannot be written to (a host with an ephemeral, read-only
filesystem and no `DATABASE_URL`), BrainyKids keeps working by saving to a
temporary folder and says so on the dashboard, instead of failing. Sign-up and
sign-in return a plain-language error — never an empty `500` page — when storage
really is unreachable, for example a `DATABASE_URL` pointing at a database that
is down.

### Question rules

Children aged 4 and under get early questions. Older children get a mix of
selective-style and NAPLAN-style questions. A question is never repeated within
the same level for the same child. Answers are marked **on the server** from the
question bank (with a 90%-similarity match for typed or spoken answers), so a
browser cannot award itself points, and questions in locked levels are refused.
Each question runs against its timer (see *Rewards* above); the server checks
the elapsed time itself, so a timed-out question cannot earn a reward.

Questions are asked in the family's language (see *Master settings*). The child's
device shows the translated wording while the server still marks against the
English canonical answer, so changing language never changes a child's progress or
lets the browser award points.

The questions in `src/lib/quiz-data.ts` are original practice questions written in
selective and NAPLAN style. They are not copies of official tests.

## Behavioural log (kept in this repository)

BrainyKids watches itself while it runs and writes down anything that might
explain the problems families keep reporting: the child's session signing out,
child information disappearing, QR codes running out, surprising sign-outs on a
kid device, chat and voice failures, storage trouble, refused answers.

Every line is written twice — once in plain words for a parent, once in technical
words for a developer — together with **what to do about it**. The words for each
code live in `src/lib/behaviour.ts`; nothing is written that the catalogue cannot
explain.

Where the log lives:

| Where | What it is |
| --- | --- |
| `.data/behaviour.jsonl` | what the running server wrote (rotated at 4 MB; git-ignored) |
| `logs/inbox/*.jsonl` | copies downloaded from the dashboard and kept in the repository |
| `logs/behaviour-log.md` | the review report: summary, actions, then the whole timeline |
| `logs/behaviour-summary.json` | the same summary in machine-readable form |
| **Parent dashboard → Behaviour log** | live view, severity counts, Download / Copy |

Rebuild the report from everything saved so far:

```sh
npm run behaviour:report                     # reads .data/ behaviour.jsonl, logs/inbox/*.jsonl
npm run behaviour:report -- export.jsonl     # or a file downloaded from the dashboard
```

The number-one finding so far is the environment itself: with no database, a
serverless host can only write to a temporary folder, so accounts, children and
device links can disappear between restarts — which is what produced “it keeps
signing out” and “my child's information disappeared”. Attaching
`DATABASE_URL` is the fix; until then BrainyKids reduces the damage by

- retrying check-ins instead of signing the child out (`kid.session.heartbeat_failed`),
- rebuilding a lost device link from the device's own signed cookie
  (`kid.session.restored`),
- refusing to restore a child a parent deleted,
- re-issuing QR codes by itself before they run out (`pairing.renewed`), and
- explaining all of it in both wordings in the report.

The behaviour-change loop is: read `logs/behaviour-log.md`, fix the 🚨 and ⚠️
groups, add the caught case to the catalogue, then commit the refreshed report
with the code change.

## Local development

Use a supported Node.js LTS version, such as Node.js 22.

```sh
npm ci
npm run dev
```

Open http://localhost:3000.

To check a production build:

```sh
npm run lint
npm run typecheck
npm run build
npm start
```

`npm run selftest` exercises the fingerprint / face unlock verification without a
browser, `npm run reset-password -- <email> "<new password>"` resets a parent
password straight from the command line (see *Signing in* above), and
`npm run behaviour:report` rebuilds the review report from the behavioural log
(see *Behavioural log* below).

Fingerprint unlock needs a secure address — `https://` or `http://localhost` —
and cannot run inside an embedded frame, so open the app in its own browser tab
to try it.

### Storage

Accounts, child profiles, device links and the realtime event log live on the
**server**, next to the API routes:

- **No configuration:** a JSON file inside `.data/` (git-ignored). Good for local
  development, a demo, or a single family running the app on their own machine.
- **`DATABASE_URL` set:** the same document is kept in a single Postgres row
  (`brainykids_state`), which is what you want on a host with more than one
  instance. See `.env.example`.

```sh
cp .env.example .env.local   # optional: add DATABASE_URL
```

Progress belongs to the parent account, so it follows the child between the kid
device, the parent's phone and any other device that signs in.

## Pages and API

| Route | Purpose |
| --- | --- |
| `/` | App shell — gateway, parent dashboard or the locked kid app |
| `/parent` | Same shell (parents land on the dashboard) |
| `/pair/<code>` | What a parent's camera opens when scanning the kid device QR code |

| API | Purpose |
| --- | --- |
| `POST /api/auth/signup`, `/login`, `/logout` | Parent account + session cookie |
| `POST /api/auth/recovery` | *Forgot password?* — email + recovery code + new password |
| `POST /api/auth/recovery-code`, `/api/auth/password` | Issue a new recovery code, or change the password |
| `GET /api/auth/passkey/status`, `POST /api/auth/passkey/register\|login/options`, `…/verify`, `DELETE /api/auth/passkey/<id>` | Fingerprint / face unlock (WebAuthn) |
| `GET /api/snapshot` | Everything this device is allowed to see |
| `GET /api/events` | Server-Sent Events stream (realtime) |
| `POST /api/kids`, `PATCH|DELETE /api/kids/<id>` | Child profiles |
| `POST /api/kids/<id>/screen-time`, `/cheer` | Approve/decline/gift minutes, send a message |
| `DELETE /api/devices/<id>` | Sign a kid device out remotely |
| `POST /api/pairing/start`, `GET /api/pairing/status` | Kid device asks for a code and waits |
| `GET /api/pairing/lookup`, `POST /api/pairing/approve` | Parent checks the code and links the device |
| `POST /api/kid-session/login`, `/logout`, `/heartbeat`, `/answers`, `/screen-time`, `/level` | Kid device session and quiz traffic |
| `GET|PATCH /api/settings` | Master settings: time zone, date/time format, language, voice |
| `POST /api/kids/<id>/chat`, `/api/kid-session/chat` | Parent ↔ child chat (send, and mark the other side's messages as read) |
| `POST /api/diagnostics` | A browser sending what it noticed to the behavioural log |
| `GET /api/diagnostics` | The log back: `?format=json` (dashboard), `?format=md` (report), `?format=jsonl` (download) |

Sessions are HTTP-only cookies: `bk_parent` (parent account), `bk_device` (a
linked kid device), `bk_device_state` (a signed backup of the device link, so a
server that lost its storage can hand the child their session back), `bk_pairing`
(a device waiting to be linked). Cookies are marked `Secure` when the site is
served over HTTPS and still work over plain HTTP on a home network, where a
“strict” cookie would silently sign everybody out. Kid PINs,
parent passwords and recovery codes are stored as salted `scrypt` hashes;
pairing secrets are stored as SHA-256 hashes and only the device that asked for a
code can claim it.

Fingerprint / face unlock is verified on the server (`src/lib/server/webauthn.ts`):
challenges are single-use and expire after five minutes, the origin and relying
party id must match the web address that asked, and the signature is checked
against the stored COSE public key. Attestation certificate chains are not
validated. Everything in that module is covered by `npm run selftest`, which
plays the part of an authenticator with Node's own crypto (no browser needed).

## Deploy on Vercel (with Neon Serverless Postgres)

Import this repository with these project settings:

- **Framework Preset:** Next.js
- **Root Directory:** the repository root (leave the field empty/default)
- **Build Command:** `npm run build` (the Next.js default)
- **Output Directory:** leave at the Next.js default; do not set it to `out`

### Attaching a Neon database on Vercel

Because Vercel's serverless filesystem is read-only and ephemeral, attach a
**Neon (Serverless Postgres)** database so parent accounts, children, passkeys
and quiz progress are saved permanently across every serverless instance:

1. **Option A — Attach Neon inside Vercel (recommended):**
   In your Vercel project open the **Storage** tab → **Create Database** →
   choose **Neon (Serverless Postgres)** → click **Connect**. Vercel injects
   `DATABASE_URL` / `POSTGRES_URL` automatically.
2. **Option B — Use an existing Neon project:**
   In the [Neon Console](https://console.neon.tech) copy your connection string
   (`postgresql://…@ep-….neon.tech/neondb?sslmode=require`), then in Vercel go
   to **Settings → Environment Variables** and add it as `DATABASE_URL`
   (BrainyKids also automatically detects `POSTGRES_URL`, `NEON_DATABASE_URL`,
   `POSTGRES_PRISMA_URL`, `DATABASE_URL_UNPOOLED` and `POSTGRES_URL_NON_POOLING`).
3. **Redeploy** the latest deployment in Vercel (**Deployments → ⋯ → Redeploy**)
   so the environment variable is active, or click **Check database connection**
   in the storage banner on the sign-in screen. BrainyKids creates its
   `brainykids_state` table automatically on first connect.

Commit the source files and deploy the branch containing them. If Vercel's
production branch is `main`, merge the changes into `main` before deploying.
Redeploying a commit that does not include `src/app` will reproduce the original
build error described below.

### Why the original build failed

Next.js needs an `app` or `pages` directory, either at the repository root or
inside `src`. The initial repository contained package/configuration files but
neither directory, so `next build` failed with:

```text
Couldn't find any `pages` or `app` directory. Please create one under the project root
```

`src/app/layout.tsx` supplies the required root layout (including `<html>` and
`<body>`), and `src/app/page.tsx` supplies the `/` route.
