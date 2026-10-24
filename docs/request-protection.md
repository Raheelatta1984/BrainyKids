# Request and database load protection

All existing API handlers use `route()` in `src/lib/server/http.ts`. The guard
runs **before JSON parsing, password/PIN hashing, logging or database access**.
Static assets and Next.js's own 404/405 handling are not an application-level
DDoS protection boundary: keep a platform/WAF limit in front of a public site.

## Request budgets

Every source network has a **300-request burst budget**, refilling over one
minute, plus one of these category budgets. Local budgets are token buckets:
these numbers are **burst/refill settings**, not strict rolling-window totals.
Resource IDs, query strings, cookies and user agents cannot mint new network
budgets. Only server-normalised paths select the category.

| Category | Burst | Refill period |
| --- | ---: | --- |
| Parent login | 20 | 15 minutes |
| Kid username/PIN login | 20 | 15 minutes |
| Signup | 10 | 15 minutes |
| Account recovery | 5 | 15 minutes |
| Passkey mutations | 30 | 15 minutes |
| Other account security mutations | 10 | 15 minutes |
| Pairing creation/rotation | 10 | 10 minutes |
| Pairing lookup/approval | 30 | 1 minute |
| Pairing polling | 60 | 1 minute |
| Event-stream connections | 30 | 1 minute |
| Heartbeats | 60 | 1 minute |
| Diagnostics | 20 | 1 minute |
| Storage health checks | 6 | 1 minute |
| Other reads | 120 | 1 minute |
| Other writes | 90 | 1 minute |

The normalised target account also has a separate budget across client
addresses: parent login **10**, kid PIN login **6**, and recovery **5**, each
refilling over 15 minutes. Wrong and successful attempts both consume it. These
are abuse controls, not permanent account locks. Existing recovery lockouts
remain, and signup still atomically enforces **10 valid-form attempts / rolling
15 minutes** and **3 actual creations / rolling 24 hours** in durable storage.
Malformed signup forms consume the front-door budget but do not write counters
to the database. A valid signup now needs one transaction rather than two.

Rejections use JSON, `Cache-Control: no-store`, and `Retry-After`. Rate-budget
rejections also expose `RateLimit-Limit`, `RateLimit-Remaining` and
`RateLimit-Reset`. `429` means wait for a budget/connection slot; `503` means
capacity or a required protection backend is temporarily unavailable. Expected
validation and guard errors do **not** create diagnostic database writes.

### Source IP trust and privacy

- On Vercel (`VERCEL=1`), sanitised platform forwarding headers are accepted.
- Elsewhere set **`BRAINYKIDS_TRUST_PROXY=true` only behind a trusted reverse
  proxy that overwrites `X-Forwarded-For` / `X-Real-IP`**, and block direct access
  to the application origin. An attacker-supplied forwarding header must not be
  treated as a trusted IP. Set `false` to override automatic trust on Vercel.
- Without trusted IP information, all unknown sources share one conservative
  bucket. Request does not expose a trustworthy socket address; falling back to
  a changeable cookie/UA would bypass the controls.
- IPv6 representations are canonicalised; addresses in a /64 share a budget.
  IPv4-mapped IPv6 is normalised to IPv4. This limits privacy-address rotation.
- Counter/target keys are purpose-scoped HMACs using `BRAINYKIDS_SECRET`.
  Raw addresses, passwords, PINs, recovery codes and bearer tokens are not put
  into quota keys. A shared NAT may need more generous budgets; tune the central
  policy table deliberately rather than disabling the guard.

### Multi-instance deployment and failure policy

Local limits and connection caps are per process and reset on cold starts.
For aggregate request quotas, configure the existing **`MEMCACHED_SERVERS`**
(and optional SASL credentials). No new runtime dependency or database counter
query is needed: Memcached's atomic increment-with-initial-value maintains
short-lived, epoch-keyed **fixed-window counters** across app instances. Keep
`BRAINYKIDS_SECRET` and optional `BRAINYKIDS_RATE_LIMIT_NAMESPACE` consistent on
all instances for one deployment. Use a different namespace for staging if it
shares the cache and signing secret with production.

Local rejection happens before a cache call. Shared denials are briefly cached
locally until the shared window ends. Operations are bounded to 400 ms, with a
five-second cache-outage cooldown. State-cache items above 900,000 bytes are
bypassed, and oversized-item errors do not open the quota-backend circuit.
When a configured shared cache fails:

- Authentication, credential changes and pairing creation/lookup/approval fail
  closed with `503` and `Retry-After: 5`, before accessing the database.
- Ordinary reads/writes retain local budgets and can use Postgres directly.
- With **no** shared cache configured, all categories use local limits; this is
  useful for local/single-process installs, not a global serverless guarantee.

The counter store is expendable: eviction/restarts reset its windows. Keep
existing durable signup quotas and recovery lockouts; use an edge limiter/WAF
for a hard ingress/distributed-attack boundary. Do not expose Memcached on the
public internet.

## Negative caching and Bloom filters

`Store.find()` supports parent email, kid username, parent session token hash,
device token hash, pairing code and passkey challenge ID. For each document
snapshot it lazily builds a Bloom filter with a target 1% false-positive rate.
A bounded, hashed-key negative cache remembers missing identifiers for at most
one second. Both are discarded on **every successful mutation and every
snapshot refresh**, even if their own TTL has not elapsed.

A Bloom filter is only an optimisation over a **complete, current document
snapshot**, not an authority and not a filter of merely “requests seen so far”:

- A negative can avoid an array scan and a pointless write transaction.
- Every positive gets an exact record lookup; it never grants authentication.
- Expiry, ownership, pairing secrets, passwords/PINs and signatures still have
  to pass their existing checks. Failed passwords are not cached as missing
  accounts. Password/PIN verification happens outside the primary row lock,
  with the verified credential hash checked again inside the transaction.
- A newly created local record is visible immediately because commits discard
  all lookup hints. On another instance, hints cannot outlive that instance's
  document read cache: 400 ms for Postgres and one second for file storage.
- Shared state-cache TTL (two seconds by default) and read-replica lag still
  apply to the underlying document. These are **not** strongly consistent
  revocation caches. If immediate cross-instance revocation is required, do
  not rely on a lagging replica/shared state cache as an auth authority; a
  primary/indexed auth store is the appropriate future persistence model.

The negative cache is capped at 5,000 keys per snapshot, rate-bucket storage at
20,000 entries per process, shared-denial hints at 5,000, and diagnostic
throttling at 2,000. Rate buckets do not evict live clients to admit new ones:
a full tracker sheds new traffic with `503`. Bloom bitsets are bounded too.

## Coalescing and load shedding

- Concurrent cache misses share **one in-flight storage read**. A late read
  cannot replace a newer committed snapshot or resurrect a revoked local
  session. Empty-document reads are cached as well.
- Storage failures have a two-second negative-cache/circuit cooldown. Repeated
  reads and queued mutations do not retry the failed database during it.
  Expired data is not silently served as a successful read during an outage.
- The mutation queue accepts at most **64 pending writes** per process. Excess
  work gets `503`/`Retry-After` instead of an unbounded promise queue.
- There are at most **128 active API leases / 16 per source network** and, within
  those, **64 slow SSE/long-poll leases / 6 per network** per process. Stream
  leases remain held until the body ends, is cancelled, or the request aborts;
  they are not released as soon as response headers are returned. Leases are
  acquired before even the remote quota-cache I/O. Expiry is a
  final safety net, not the normal cleanup path.
- SSE reads every two seconds and never overlaps its own slow pumps. Pairing
  long-polls stop on disconnect and are still capped at eight seconds.
- Heartbeat retries inside 15 seconds and reloading an active quiz question
  avoid unnecessary whole-document writes. Empty passkey options and unknown
  login challenges do not allocate records. Guest diagnostic batches are
  acknowledged/dropped (still visible in the browser console), not written to
  the shared family database. Authenticated diagnostics continue to work.
- Bodies are bounded to **64,000 UTF-8 bytes while streaming**, including
  chunked requests; declared oversized bodies are rejected before the handler.
  This is not a post-allocation JavaScript string-length check.

The browser coalesces identical GETs only while they are in flight, honours
429/503 retry delays, never automatically replays writes, pauses background
polling/heartbeats/streams in hidden or offline tabs, and jitters reconnects.
Normal private responses remain `no-store`; successful response bodies are not
retained in the client request cache. A storage failure from `/api/snapshot`
is a retryable error, not an instruction to sign out the current child.

## Verification

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run protection-selftest` runs 40 checks: Bloom false positives/no false
negatives, bounded TTLs/queues, 100-to-1 read coalescing, invalidation and stale
read/write races, outage recovery, two-instance shared counters, fail-closed
protection, IPv6/proxy trust, payload bytes, connection cleanup, actual auth and
signup handlers, revocation/expiry, and browser deduplication/backoff. Route
checks use an isolated temporary file store and clear database/cache settings;
no production credentials or database are needed. Shared-cache tests use an
in-memory atomic counter/fake callback client, not a live Memcached or Postgres
integration benchmark. Exercise those services in staging before rollout.
