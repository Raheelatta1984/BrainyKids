# BrainyKids

BrainyKids Challenge Mode — a Next.js quiz app for kids with a parent dashboard,
parent and kid sign-in, QR device linking and realtime progress updates.

## How it works

1. **Parent signs up first** (`/` → *Parent sign up*, or *Parent sign in* with an
   email and password). The parent account owns the children, their progress and
   every device linked to the family.
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

### Question rules

Children aged 4 and under get early questions. Older children get a mix of
selective-style and NAPLAN-style questions. A question is never repeated within
the same level for the same child. Answers are marked **on the server** from the
question bank (with a 90%-similarity match for typed or spoken answers), so a
browser cannot award itself points, and questions in locked levels are refused.

The questions in `src/lib/quiz-data.ts` are original practice questions written in
selective and NAPLAN style. They are not copies of official tests.

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
| `GET /api/snapshot` | Everything this device is allowed to see |
| `GET /api/events` | Server-Sent Events stream (realtime) |
| `POST /api/kids`, `PATCH|DELETE /api/kids/<id>` | Child profiles |
| `POST /api/kids/<id>/screen-time`, `/cheer` | Approve/decline/gift minutes, send a message |
| `DELETE /api/devices/<id>` | Sign a kid device out remotely |
| `POST /api/pairing/start`, `GET /api/pairing/status` | Kid device asks for a code and waits |
| `GET /api/pairing/lookup`, `POST /api/pairing/approve` | Parent checks the code and links the device |
| `POST /api/kid-session/login`, `/logout`, `/heartbeat`, `/answers`, `/screen-time`, `/level` | Kid device session and quiz traffic |

Sessions are HTTP-only cookies: `bk_parent` (parent account), `bk_device` (a
linked kid device), `bk_pairing` (a device waiting to be linked). Kid PINs and
parent passwords are stored as salted `scrypt` hashes; pairing secrets are stored
as SHA-256 hashes and only the device that asked for a code can claim it.

## Deploy on Vercel

Import this repository with these project settings:

- **Framework Preset:** Next.js
- **Root Directory:** the repository root (leave the field empty/default)
- **Build Command:** `npm run build` (the Next.js default)
- **Output Directory:** leave at the Next.js default; do not set it to `out`
- **Environment variables:** set `DATABASE_URL` to a Postgres connection string

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
