# BrainyKids behavioural log

Every line below was written by the running app: what happened in the child's session, in the link code, in the saved data, in chat and in the voice features. Each line says the same thing twice — once in plain words and once in technical words — so a parent and a developer can both read it.

- **Report written:** 14/10/2026 23:19:42 (Australia/Sydney)
- **Window covered:** 14/10/2026 23:14:09 (Australia/Sydney) → 14/10/2026 23:19:37 (Australia/Sydney)
- **Time zone / language used for this report:** Australia/Sydney · ur (master settings)
- **Read from:** .data/behaviour.jsonl, logs/inbox/2026-10-14-dev-server.jsonl, logs/inbox/2026-10-14-temporary-storage.jsonl
- **Storage:** file (permanent) at /home/user/BrainyKids/.data

## Summary

- 🚨 Fix me: **7**
- ⚠️ Needs a look: **5**
- ℹ️ For information: **9**

| Count | What it means | Area | Taken from | Last seen |
| --- | --- | --- | --- | --- |
| 🚨 4 | This child's device lost the sign-in, so the child was shown the sign-in screen again (this is the “keeps signing out” report). | Sign-in and sessions | `kid.session.lost` | 14/10/2026 23:19:18 (Australia/Sydney) |
| 🚨 3 | BrainyKids cannot save permanently on this server, so accounts, children and device links can disappear when the server restarts. | Saved data | `storage.temporary_folder` | 14/10/2026 23:16:46 (Australia/Sydney) |
| ⚠️ 1 | This child's device is no longer linked on the server, so the app returned to the sign-in screen. | Sign-in and sessions | `kid.session.heartbeat_unlinked` | 14/10/2026 23:14:15 (Australia/Sydney) |
| ⚠️ 1 | The kid device could not check in with the server (Failed to fetch). The child stays signed in and the app keeps trying. | Sign-in and sessions | `kid.session.heartbeat_failed` | 14/10/2026 23:14:47 (Australia/Sydney) |
| ⚠️ 1 | A link code ran out before a parent approved it (ZD41KP). The child's screen shows a fresh code. | QR code and device linking | `pairing.expired_unapproved` | 14/10/2026 23:14:47 (Australia/Sydney) |
| ⚠️ 1 | Hana was recognised again from its signed cookie, so the child stayed signed in. | Sign-in and sessions | `kid.session.restored` | 14/10/2026 23:16:46 (Australia/Sydney) |
| ⚠️ 1 | This device cannot read messages out loud, so voice over is switched off here. | Voice over | `chat.voice_missing` | 14/10/2026 23:18:31 (Australia/Sydney) |
| ℹ️ 4 | Zoya signed in on This device. | Sign-in and sessions | `kid.session.linked` | 14/10/2026 23:19:37 (Australia/Sydney) |
| ℹ️ 3 | The link code on the child's screen was about to run out, so a fresh one appeared automatically. | QR code and device linking | `pairing.renewed` | 14/10/2026 23:19:37 (Australia/Sydney) |
| ℹ️ 2 | A device asked to be linked and is showing code C2C99V for a parent to approve. | QR code and device linking | `pairing.started` | 14/10/2026 23:16:30 (Australia/Sydney) |

## What to do about it

- 🚨 **Fix me** — Attach a permanent database (DATABASE_URL on Vercel) so device links survive a restart, then link the device again. Until then, each new server instance starts from an empty temporary file. _(4× kid.session.lost)_
- 🚨 **Fix me** — Attach a Neon/Vercel Postgres database (DATABASE_URL) and redeploy. This one change fixes sign-outs and missing children together. _(3× storage.temporary_folder)_
- ⚠️ **Needs a look** — Often a parent signing the device out on purpose. If nobody did, link the device again and check the storage notice on the dashboard. _(1× kid.session.heartbeat_unlinked)_
- ⚠️ **Needs a look** — Usually a dropped connection or a cold server start. The app retries automatically; fix only if it repeats in the log. _(1× kid.session.heartbeat_failed)_
- ⚠️ **Needs a look** — Approve the next code within the time on screen, or raise the pairing window by keeping the link screen open — it now refreshes itself. _(1× pairing.expired_unapproved)_
- ⚠️ **Needs a look** — The device link was recovered, but the server storage had lost it. Attach a permanent database (DATABASE_URL) to stop this repeating. _(1× kid.session.restored, Hana)_
- ⚠️ **Needs a look** — Voice over needs a browser with speech support (Chrome, Edge, Safari). Typing still works on this device. _(1× chat.voice_missing)_

## Timeline

### Wednesday 14 October 2026

ℹ️ **14/10/2026 12:14:09 PM (UTC)** · A device asked to be linked and is showing code RF2WZN for a parent to approve.

> **Technical:** pairing started: code=RF2WZN label=This device ttlSeconds=900 expiresAt=2026-10-14T12:29:09.249Z
> **What to do:** Nothing to do; this is the normal start of QR linking.
> **Details:** code=RF2WZN · oldCode=RF2WZN · deviceLabel=This device · ttlSeconds=900 · expiresAt=2026-10-14T12:29:09.249Z · reason=a parent had not approved the previous code yet · driver=file · durable=true · storage=file · label=This device

### بدھ، 14 اکتوبر، 2026

ℹ️ **14/10/2026 23:14:09 (Australia/Sydney)** · Zoya signed in on This device.

> **Technical:** device linked: kidId=68938aab-f980-4432-b397-e296d4ec96cc deviceId=b7650577-f3b1-48a5-ad92-e915f8d390b2 label=This device storage=file durable=true
> **What to do:** Nothing to do. This is the normal start of a kid session.
> **Details:** kidName=Zoya · deviceLabel=This device · kidId=68938aab-f980-4432-b397-e296d4ec96cc · deviceId=b7650577-f3b1-48a5-ad92-e915f8d390b2 · driver=file · durable=true · trigger=qr · storage=file

### Wednesday 14 October 2026

⚠️ **14/10/2026 12:14:15 PM (UTC)** · This child's device is no longer linked on the server, so the app returned to the sign-in screen.

> **Technical:** heartbeat answered 401 unlinked: deviceId=- kidId=- durable=true reason=unlinked
> **What to do:** Often a parent signing the device out on purpose. If nobody did, link the device again and check the storage notice on the dashboard.
> **Details:** kidName=This child's device · deviceId=- · kidId=- · durable=true · reason=unlinked · storage=file · location=/home/user/BrainyKids/.data

🚨 **14/10/2026 12:14:21 PM (UTC)** · This child's device lost the sign-in, so the child was shown the sign-in screen again (this is the “keeps signing out” report).

> **Technical:** device cookie present but no device record in storage (reason=no matching device record for the cookie that was sent): cookiePresent=true deviceFound=false kidFound=false storage=unknown durable=true location=/home/user/BrainyKids/.data
> **What to do:** Attach a permanent database (DATABASE_URL on Vercel) so device links survive a restart, then link the device again. Until then, each new server instance starts from an empty temporary file.
> **Details:** reason=no matching device record for the cookie that was sent · cookiePresent=true · deviceFound=false · kidFound=false · storage=file · durable=true · location=/home/user/BrainyKids/.data · cookieName=bk_device · protocol=http · secure=false · url=/api/snapshot · cookiesEnabled=true

ℹ️ **14/10/2026 12:14:43 PM (UTC)** · The link code on the child's screen was about to run out, so a fresh one appeared automatically.

> **Technical:** pairing rotated before expiry: oldCode=RF2WZN newCode=CVVCCE reason=the previous code had expired
> **What to do:** Nothing to do. Automatic renewal is what stops the “QR code keeps expiring” problem.
> **Details:** code=CVVCCE · oldCode=RF2WZN · deviceLabel=This device · ttlSeconds=900 · expiresAt=2026-10-14T12:29:43.448Z · reason=the previous code had expired · driver=file · durable=true · storage=file · label=This device

ℹ️ **14/10/2026 12:14:43 PM (UTC)** · The link code on the child's screen was about to run out, so a fresh one appeared automatically.

> **Technical:** pairing rotated before expiry: oldCode=CVVCCE newCode=YG4TJF reason=a parent had not approved the previous code yet
> **What to do:** Nothing to do. Automatic renewal is what stops the “QR code keeps expiring” problem.
> **Details:** code=YG4TJF · oldCode=CVVCCE · deviceLabel=This device · ttlSeconds=900 · expiresAt=2026-10-14T12:29:43.491Z · reason=a parent had not approved the previous code yet · driver=file · durable=true · storage=file · label=This device

### بدھ، 14 اکتوبر، 2026

ℹ️ **14/10/2026 23:14:43 (Australia/Sydney)** · Zoya signed in on This device.

> **Technical:** device linked: kidId=68938aab-f980-4432-b397-e296d4ec96cc deviceId=b8a380e8-5f90-4f50-9f4e-b10f1bb84425 label=This device storage=file durable=true
> **What to do:** Nothing to do. This is the normal start of a kid session.
> **Details:** kidName=Zoya · deviceLabel=This device · kidId=68938aab-f980-4432-b397-e296d4ec96cc · deviceId=b8a380e8-5f90-4f50-9f4e-b10f1bb84425 · driver=file · durable=true · trigger=qr · storage=file

### Wednesday 14 October 2026

⚠️ **14/10/2026 12:14:47 PM (UTC)** · The kid device could not check in with the server (Failed to fetch). The child stays signed in and the app keeps trying.

> **Technical:** POST /api/kid-session/heartbeat failed: error=Failed to fetch attempt=2 online=false role=kid
> **What to do:** Usually a dropped connection or a cold server start. The app retries automatically; fix only if it repeats in the log.
> **Details:** error=Failed to fetch · attempt=2 · online=false · deviceLabel=this tablet · where=the child's device · platform=Android tablet · protocol=http · deviceWasOffline

🚨 **14/10/2026 12:14:47 PM (UTC)** · Zoya lost the sign-in, so the child was shown the sign-in screen again (this is the “keeps signing out” report).

> **Technical:** device cookie present but no device record in storage (reason=the app returned to the sign-in screen without a parent signing out): cookiePresent=- deviceFound=- kidFound=- storage=unknown durable=false location=unknown
> **What to do:** Attach a permanent database (DATABASE_URL on Vercel) so device links survive a restart, then link the device again. Until then, each new server instance starts from an empty temporary file.
> **Details:** kidName=Zoya · reason=the app returned to the sign-in screen without a parent signing out · storage=file · durable=false · platform=Android tablet · protocol=http

⚠️ **14/10/2026 12:14:47 PM (UTC)** · A link code ran out before a parent approved it (ZD41KP). The child's screen shows a fresh code.

> **Technical:** pairing expired: code=ZD41KP createdAt=- expiresAt=- approved=false rotated=false
> **What to do:** Approve the next code within the time on screen, or raise the pairing window by keeping the link screen open — it now refreshes itself.
> **Details:** code=ZD41KP · minutes=15 · rotated=false · protocol=http

🚨 **14/10/2026 12:15:06 PM (UTC)** · This child's device lost the sign-in, so the child was shown the sign-in screen again (this is the “keeps signing out” report).

> **Technical:** device cookie present but no device record in storage (reason=no matching device record for the cookie that was sent): cookiePresent=true deviceFound=false kidFound=false storage=unknown durable=true location=/home/user/BrainyKids/.data
> **What to do:** Attach a permanent database (DATABASE_URL on Vercel) so device links survive a restart, then link the device again. Until then, each new server instance starts from an empty temporary file.
> **Details:** reason=no matching device record for the cookie that was sent · cookiePresent=true · deviceFound=false · kidFound=false · storage=file · durable=true · location=/home/user/BrainyKids/.data · cookieName=bk_device · protocol=http · secure=false · url=/api/snapshot · cookiesEnabled=true

🚨 **14/10/2026 12:16:24 PM (UTC)** · BrainyKids cannot save permanently on this server, so accounts, children and device links can disappear when the server restarts.

> **Technical:** file driver not durable: location=/tmp/brainykids-data reason=This server's project folder is read-only, so BrainyKids is keeping accounts in a temporary folder. They can disappear when the server restarts — attach a Neon or Vercel Postgres database (DATABASE_UR driver=file
> **What to do:** Attach a Neon/Vercel Postgres database (DATABASE_URL) and redeploy. This one change fixes sign-outs and missing children together.
> **Details:** location=/tmp/brainykids-data · reason=This server's project folder is read-only, so BrainyKids is keeping accounts in a temporary folder. They can disappear when the server restarts — attach a Neon  · driver=file · durable=false · ephemeralHost=true

ℹ️ **14/10/2026 12:16:30 PM (UTC)** · A device asked to be linked and is showing code C2C99V for a parent to approve.

> **Technical:** pairing started: code=C2C99V label=This device ttlSeconds=900 expiresAt=2026-10-14T12:31:30.078Z
> **What to do:** Nothing to do; this is the normal start of QR linking.
> **Details:** code=C2C99V · oldCode=C2C99V · deviceLabel=This device · ttlSeconds=900 · expiresAt=2026-10-14T12:31:30.078Z · reason=a parent had not approved the previous code yet · driver=file · durable=false · storage=file · label=This device

ℹ️ **14/10/2026 12:16:30 PM (UTC)** · Hana signed in on This device.

> **Technical:** device linked: kidId=12424a8d-773e-4c6c-a885-e7dfd5099b62 deviceId=3d265606-4b84-4be9-9b50-0316df2e7dc1 label=This device storage=file durable=false
> **What to do:** Nothing to do. This is the normal start of a kid session.
> **Details:** kidName=Hana · deviceLabel=This device · kidId=12424a8d-773e-4c6c-a885-e7dfd5099b62 · deviceId=3d265606-4b84-4be9-9b50-0316df2e7dc1 · driver=file · durable=false · trigger=qr · storage=file

🚨 **14/10/2026 12:16:30 PM (UTC)** · BrainyKids cannot save permanently on this server, so accounts, children and device links can disappear when the server restarts.

> **Technical:** file driver not durable: location=/tmp/brainykids-data reason=This server's project folder is read-only, so BrainyKids is keeping accounts in a temporary folder. They can disappear when the server restarts — attach a Neon or Vercel Postgres database (DATABASE_UR driver=file
> **What to do:** Attach a Neon/Vercel Postgres database (DATABASE_URL) and redeploy. This one change fixes sign-outs and missing children together.
> **Details:** location=/tmp/brainykids-data · reason=This server's project folder is read-only, so BrainyKids is keeping accounts in a temporary folder. They can disappear when the server restarts — attach a Neon  · driver=file · durable=false · ephemeralHost=true

🚨 **14/10/2026 12:16:46 PM (UTC)** · BrainyKids cannot save permanently on this server, so accounts, children and device links can disappear when the server restarts.

> **Technical:** file driver not durable: location=/tmp/brainykids-data reason=This server's project folder is read-only, so BrainyKids is keeping accounts in a temporary folder. They can disappear when the server restarts — attach a Neon or Vercel Postgres database (DATABASE_UR driver=file
> **What to do:** Attach a Neon/Vercel Postgres database (DATABASE_URL) and redeploy. This one change fixes sign-outs and missing children together.
> **Details:** location=/tmp/brainykids-data · reason=This server's project folder is read-only, so BrainyKids is keeping accounts in a temporary folder. They can disappear when the server restarts — attach a Neon  · driver=file · durable=false · ephemeralHost=true

⚠️ **14/10/2026 12:16:46 PM (UTC)** · Hana was recognised again from its signed cookie, so the child stayed signed in.

> **Technical:** device restored from signed backup cookie: deviceId=3d265606-4b84-4be9-9b50-0316df2e7dc1 kidId=12424a8d-773e-4c6c-a885-e7dfd5099b62 storage=file durable=false reason=storage had lost the device record
> **What to do:** The device link was recovered, but the server storage had lost it. Attach a permanent database (DATABASE_URL) to stop this repeating.
> **Details:** deviceId=3d265606-4b84-4be9-9b50-0316df2e7dc1 · kidId=12424a8d-773e-4c6c-a885-e7dfd5099b62 · storage=file · durable=false · reason=storage had lost the device record · kidName=Hana

⚠️ **14/10/2026 12:18:31 PM (UTC)** · This device cannot read messages out loud, so voice over is switched off here.

> **Technical:** speechSynthesis unavailable: userAgent=unknown browser platform=unknown device
> **What to do:** Voice over needs a browser with speech support (Chrome, Edge, Safari). Typing still works on this device.
> **Details:** browser=this tablet · platform=Android tablet

🚨 **14/10/2026 12:19:18 PM (UTC)** · This child's device lost the sign-in, so the child was shown the sign-in screen again (this is the “keeps signing out” report).

> **Technical:** device cookie present but no device record in storage (reason=no matching device record for the cookie that was sent): cookiePresent=true deviceFound=false kidFound=false storage=unknown durable=true location=/home/user/BrainyKids/.data
> **What to do:** Attach a permanent database (DATABASE_URL on Vercel) so device links survive a restart, then link the device again. Until then, each new server instance starts from an empty temporary file.
> **Details:** reason=no matching device record for the cookie that was sent · cookiePresent=true · deviceFound=false · kidFound=false · storage=file · durable=true · location=/home/user/BrainyKids/.data · cookieName=bk_device · protocol=http · secure=false · url=/api/snapshot · cookiesEnabled=true

ℹ️ **14/10/2026 12:19:37 PM (UTC)** · The link code on the child's screen was about to run out, so a fresh one appeared automatically.

> **Technical:** pairing rotated before expiry: oldCode=YG4TJF newCode=73D6ZK reason=the previous code had expired
> **What to do:** Nothing to do. Automatic renewal is what stops the “QR code keeps expiring” problem.
> **Details:** code=73D6ZK · oldCode=YG4TJF · deviceLabel=This device · ttlSeconds=900 · expiresAt=2026-10-14T12:34:37.045Z · reason=the previous code had expired · driver=file · durable=true · storage=file · label=This device

### بدھ، 14 اکتوبر، 2026

ℹ️ **14/10/2026 23:19:37 (Australia/Sydney)** · Zoya signed in on This device.

> **Technical:** device linked: kidId=68938aab-f980-4432-b397-e296d4ec96cc deviceId=6aa2f391-80da-4c35-8741-6d4f1d6e4c81 label=This device storage=file durable=true
> **What to do:** Nothing to do. This is the normal start of a kid session.
> **Details:** kidName=Zoya · deviceLabel=This device · kidId=68938aab-f980-4432-b397-e296d4ec96cc · deviceId=6aa2f391-80da-4c35-8741-6d4f1d6e4c81 · driver=file · durable=true · trigger=qr · storage=file

## How to keep this log useful

1. Export a fresh copy from **Parent dashboard → Behaviour log → Download report** (or press **Copy**).
2. Save it in this repository (the app also keeps JSON lines in `.data/behaviour.jsonl` while it runs).
3. Run `npm run behaviour:report` to rebuild this file from the saved copies.
4. Review the 🚨 and ⚠️ groups first: each one names the code to fix in `src/lib/behaviour.ts` and the cause in plain words.
