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
- **Signup abuse prevention.** The server allows up to 10 signup requests per
  client address in 15 minutes and up to 3 newly created accounts from that
  address in a rolling 24 hours. Client-limit responses return HTTP `429` with
  a `Retry-After` header; the endpoint fails closed with `503` if its bounded
  tracker is full. Invalid and duplicate attempts count toward the short
  burst limit; only accounts actually created count toward the daily limit.
  Client addresses are stored as keyed HMACs, not as raw IP addresses. The
  deployment proxy must set or sanitise `X-Forwarded-For` / `X-Real-IP`. On a
  multi-instance deployment, configure `DATABASE_URL` so the limits are shared
  and atomic across instances. This reduces automated signup spam; it is not a
  substitute for a WAF/edge rate limit, email verification, or malware scanning,
  and it cannot stop a distributed denial-of-service attack by itself.

### Master settings (language, curriculum, date, time, voice)

The dashboard has a **Settings** tab. Family-wide defaults are independent of
where the family lives, and each child can inherit them or use a learning-profile
override from **Edit child**:

| Setting | What it changes |
| --- | --- |
| App language | App labels, chat, voice and behavioural-log wording |
| Question language | Follow the app language or practise in English, Spanish, French, Arabic, Urdu, Hindi or Chinese |
| Question translation | Optionally show the question and choices in the app language alongside the selected question language |
| Curriculum country | Australia, United Kingdom, United States, India, Pakistan, Europe / International or New Zealand; this changes spelling, currency and measurement contexts |
| Grade / education stage | Country-specific year/class/grade choices (e.g. Pakistan Class 1–12, India Class 1–12, US Kindergarten / Grade 1–12, Australian Foundation / Year 1–12), plus age-based, Early years, Primary, Middle school, Secondary, O-Level / GCSE and A-Level |
| Time zone / date / time | Dates and times in activity, chat, the behavioural log and review report |
| Voice over | Read questions and messages aloud, and allow a child to answer by speaking |

A parent in Pakistan can, for example, set the question curriculum to the United
Kingdom or Australia, or select India / Pakistan with Cambridge O-Level or
A-Level practice. Automatic stage uses the child's age; a parent can override
the country and stage for one child without changing siblings. Arabic and Urdu
flip the app screen to right-to-left. Hindi questions are translated, and a
separate question-language choice lets a child practise Hindi while the app
stays in English (or vice versa).

Every behavioural log line records the settings that were in force when it was
written, so a review can see the world as the family saw it.

### Rewards: real money in any currency, or Robux

Alongside screen time, children now earn **actual money in the family's own
currency — or Robux** — for answering questions. All of it is set by the parent
in **Master settings**:

| Setting | Default | What it does |
| --- | --- | --- |
| Earn | Real money | …or **Robux** (Roblox's own currency), if the family prefers that |
| Currency | AUD | **Every currency in the world** — all 159 ISO 4217 currencies, common ones listed first (AUD, USD, GBP, EUR, INR, PKR, AED, JPY, KWD…) — with the currency's real decimals, so `A$0.50`, `¥50` (yen has no cents) and `KWD 0.050` (three decimals) all read correctly. **Cryptocurrency is never offered**, and a crypto code is refused by the server even if one is sent by hand — a reward a child cannot hold is not a reward |
| Reward for each correct answer | 5 (cents / Robux) = A$0.05 | Every correct answer earns this in full. A wrong or timed-out answer takes 50% of it off the wallet (2 cents, rounded down), never below zero |
| Daily / weekly earn limit | A$2.00 / A$10.00 (0 = no limit) | Caps how much can be earned per day and per Mon–Sun week |
| Earning schedule | Off | Optionally only earn on chosen weekdays between two times (family time zone) |
| Question timers | Easy 120s · Medium 300s · Hard 600s | Every question counts down; harder questions get more time, never more than 10 minutes. Timing out earns nothing for that question |

Rewards are **flat per correct answer**, decided on the server: every correct\nanswer earns the full amount (A$0.05 / 5 cents by default, or the equal amount in\nthe family's currency or Robux). A **wrong or timed-out answer deducts 50% of that\namount** (2 cents, rounded down, since half a cent cannot be stored) from the\nwallet, and the wallet never drops below zero. The deduction is a `deducted`\nentry in the transaction log.

The money collects in the child's **wallet**. When the child taps *Ask a parent
to realise…*, the request goes to the parent live. The wallet is **only reset
to zero when a parent approves** (sending it back keeps the balance). Every
step — each amount earned (with its question, topic, level and closeness %),
each realise request, each approval and each send-back — is written to the
child's **transaction log** on the dashboard and to the behavioural log
(`reward.*`, `quiz.timed_out`). Parents pay the child outside the app; the app
is the ledger, not a bank. A declined payout goes back to the child's ready-to-
request wallet state with the full balance intact. Screen-time requests work the
same way: points stay available while a request is pending and are deducted only
on approval; sending one back restores the child's request button and points.

**Levels never end, and no level is ever locked.** A child can open any level,
in any order — Level 1, Level 40, back to Level 3 — whether or not earlier
levels were finished. Nothing is refused for being “too high”, nothing is blocked
because an earlier level is unfinished, and no child is ever stuck one level
behind with no way forward.

On the level screen every level carries one of three buttons:

| The level | What the button says | What happens |
| --- | --- | --- |
| never opened | **▶ Start** | the level opens with a fresh question |
| half finished | **▶ Carry on** | resume the active question and then continue with unseen questions |
| finished | **↺ Play again** | a new run uses fresh questions; old questions are never reused |

A **“Carry on where you stopped”** banner sits at the top of the level screen
whenever a level is unfinished. **↺ Start again** clears that level's progress
and creates a fresh run, but the child's lifetime question history is never
cleared. A question is not repeated at a later level or after a restart. Restarts
never touch points, screen time or money and are written to the behavioural log
(`quiz.level_restarted`). The box under the level list (*Go to level …*) reaches
any level number, so a child or parent can explore ahead without being stopped.

Because levels are open, **`unlockedLevel` is a record, not a key**: it is the
child's **Best level**, and it moves on when a level is finished (the same
number the scoreboard ranks by). The dashboard can move a child to any level, or
start a chosen level again, from the child's card.

Question difficulty is generated from the child's age, selected education
stage and current level, so every child has suitable content even at high levels.
Both the kid screen and the parent dashboard show a family **scoreboard** ranked
by best level, then accuracy, then lifetime earnings.

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

Each level serves a short set of freshly generated questions from the child's
age / education stage and selected curriculum. Every question shown is recorded
in the child's lifetime history, so it cannot be repeated at another level or
after a restart. Refreshing or returning to an unfinished level resumes its
active question; restarting discards that active question and issues a new one.

The automatic stage is Early years (age 4 and under), Primary (5–10), Middle
school (11–13), Secondary (14–16) or A-Level practice (17+). A parent can select
an explicit stage, including concise O-Level / GCSE or A-Level maths, science and
English questions. Country selection changes curriculum contexts such as
Australian / British spelling, US customary units, metric units and local
currency examples. Question difficulty adapts to the stage and level.

Questions are inclusive: age and the parent's selected education stage shape
the content, while gender does not narrow subjects or rely on stereotypes.
Questions are marked **on the server** from the server-issued active item; a
browser cannot award itself points or submit an already-used item.

Question language can be selected independently of app language, and a parent
can show a second-language translation beneath the question. Hindi is available
for generated questions as well as the existing translated bank. The server
keeps canonical answers, so translation never changes progress or lets the
browser award points. Questions and practice material are original; they are not
copies of official past papers.

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

`npm run selftest` exercises fingerprint / face unlock verification without a
browser; `npm run levels-selftest` checks open-level progress and world-currency
rules; `npm run quiz-selftest` checks non-repeating questions, curricula, Hindi
translations and returned approval requests; and `npm run signup-selftest`
checks signup throttling, daily account caps and client-key privacy.
`npm run reset-password -- <email> "<new password>"` resets a parent password straight from the command line
(see *Signing in* above), and `npm run behaviour:report` rebuilds the review
report from the behavioural log (see *Behavioural log* below).

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
| `PATCH /api/kids/<id>` | Edit a child, move them to **any** level (`level`), or start one level again (`restartLevel`) |
| `DELETE /api/devices/<id>` | Sign a kid device out remotely |
| `POST /api/pairing/start`, `GET /api/pairing/status` | Kid device asks for a code and waits |
| `GET /api/pairing/lookup`, `POST /api/pairing/approve` | Parent checks the code and links the device |
| `POST /api/kid-session/login`, `/logout`, `/heartbeat`, `/answers`, `/screen-time` | Kid device session and quiz traffic |
| `POST /api/kid-session/level` | Open any level: `{ "level": 5 }` resumes, `{ "level": 5, "action": "restart" }` starts a fresh run without reusing questions |
| `POST /api/kid-session/questions/next` | Server issues or resumes the active question for a level |
| `GET|PATCH /api/settings` | Master settings: language, question language, curriculum country/stage, time zone and voice |
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
