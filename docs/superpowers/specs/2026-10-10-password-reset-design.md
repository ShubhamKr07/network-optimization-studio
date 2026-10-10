# Password Reset — Design

**Date:** 2026-10-10
**Branch:** `password-reset`
**Status:** approved design, not yet implemented

Self-serve password reset for Network Optimization Studio: a student who cannot
log in requests a reset by email, follows a one-hour single-use link, and sets a
new password. Transport is Resend. Token state lives on `users`.

## Scope

**In scope.** Forgot-password only — two endpoints, two frontend routes, one
link on the login page, one transactional email.

**Out of scope,** deliberately, each a separate change if wanted later:

- Authenticated "change my password" for a user who is already logged in.
- Instructor-initiated reset on behalf of a student.
- Session revocation (see Accepted risks).
- Email templates, broadcasts, or Resend webhook handling.
- A `_dmarc` record for `app.networkdesignbook.com` (absent today; deliverability
  hygiene, not a blocker).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Token storage | Two nullable columns on `users` | A `password_reset_tokens` table buys concurrent tokens and an audit trail. Neither is needed at classroom scale, and it costs a table, an FK, and a cleanup job. Columns give single-use for free by nulling them. |
| Both columns nullable | Yes | `drizzle-kit push` applies cleanly; hard rule #3's two-step NOT NULL protocol does not apply. |
| Token hash | SHA-256, not argon2 | The token is 32 random bytes. A slow KDF defends against low-entropy guessing, which does not apply here, and would add latency to every confirm. |
| Email transport | `fetch` to Resend's REST API | Node v26 has native `fetch`. The `resend` SDK costs a dependency tree to send one POST; a provider-agnostic mailer interface would be an abstraction over a single committed provider. ~15 lines in one file, and the SDK remains a drop-in behind the same `sendEmail` signature. |
| Link host | `APP_BASE_URL`, default `https://app.networkdesignbook.com` | Sender domain and link host match, which helps deliverability and reads less like phishing. The env var keeps local dev links clickable. |
| Session revocation | None | See Accepted risks. |
| Response ordering on request | Respond `200` before any lookup or send | Removes a timing side-channel; see Flows. |
| Token in the link | URL **fragment**, not query string | A fragment never reaches the server, so the token stays out of Render and Cloudflare access logs. |
| Token resolution on confirm | One conditional `UPDATE … RETURNING` | `SELECT`-then-`UPDATE` lets two concurrent confirms both succeed. Also fewer statements. |
| Repeat requests | Last-token-wins, stated in the email copy | Refusing while a live token exists strands a user whose first email failed to send. |
| Reset for a null `password_hash` row | Refused | Keeps reset from becoming an unasked-for account-conversion path. |
| Rate limit on `/auth/reset-password` | 10/min per IP, checked first | The endpoint is unauthenticated and hashes with argon2 *before* validating the token, so a garbage token costs as much CPU as a real one. |

## Schema

`lib/db/src/schema/auth.ts`, added to `usersTable`:

```ts
resetTokenHash: varchar("reset_token_hash"),
resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
```

`timestamptz` matches the existing `created_at` / `updated_at` convention in that
file. No index on `reset_token_hash` — a sequential scan over tens of rows, the
same reasoning already documented for the `lower(email)` lookup at
`artifacts/api-server/src/routes/auth.ts:30-35`.

## Endpoints

Naming follows the existing flat `/auth/*` shape (`register`, `login`, `logout`,
`user`).

| Route | Body | Success | Failure |
|---|---|---|---|
| `POST /auth/forgot-password` | `{ email }` | `200 { success: true }` — always | `429` when rate-limited |
| `POST /auth/reset-password` | `{ token, password }` | `200 { user }`, session cookie set | `400 { error }`, `429` when rate-limited |

Both go into `lib/api-spec/openapi.yaml`; Orval regenerates the Zod validators
and the React Query client. Spec, generated output, and implementation land in
one commit per task (hard rules #1 and #4).

## Flows

### Request — `POST /auth/forgot-password`

1. Normalize the address with the existing `withNormalizedEmail`.
2. Apply both rate limits (see Security). On trip, `429`.
3. **Respond `200 { success: true }` immediately**, before any lookup or send.
4. Off the response path: `findUserByEmail`. Issue a token only when the row
   exists **and** its `password_hash` is non-null (see *Accounts without a
   password*). Generate 32 bytes via `crypto.randomBytes`, store `sha256(token)`
   and `now + 1h`, and send the email. Any failure is logged via pino and
   reported to Sentry.

Responding first does two jobs. It removes a timing side-channel — a real lookup
plus a ~200 ms Resend call is measurable against an instant miss, which leaks
account existence even though the response body is identical. And it keeps the
endpoint fast. The cost is that a user whose email fails to send still sees
success; that is the correct trade for an anti-enumeration endpoint, and the
failure is visible in Sentry.

**Repeat requests are last-token-wins.** A second request overwrites an
unexpired token, so only the newest link works. The email copy says so in one
line, because out-of-order delivery is exactly the case that wording exists for.
The alternative — refusing to issue while a live token exists — was considered
and rejected: it leaves a user whose first email failed to send locked out for
the remainder of the hour, and costs a branch plus a failure-path cleanup to
undo. Concurrent requests are safe under this rule by construction: two writers
race, the last one wins, and the link in the surviving email is the one that
works.

### Confirm — `POST /auth/reset-password`

1. Validate the password against the existing `registerUserBodyPasswordMin` /
   `registerUserBodyPasswordMax` bounds — the same rules as registration, so
   there is no second password standard to drift.
2. `argon2.hash` the new password.
3. Resolve the token in **one** conditional statement:

   ```sql
   UPDATE users
      SET password_hash = $newHash,
          reset_token_hash = NULL,
          reset_token_expires_at = NULL
    WHERE reset_token_hash = $tokenHash
      AND reset_token_expires_at > now()
   RETURNING id, email, role
   ```

   The reset succeeded only if exactly one row comes back; zero rows is the
   generic `400`. A `SELECT` followed by an `UPDATE` does **not** enforce
   single use: two concurrent confirmations of the same token both pass the
   read and both write, racing to set different passwords. The conditional
   update makes Postgres the arbiter. Nulling both columns in that same
   statement is what makes the token single-use, and hashing first means a
   losing racer has only spent CPU.
4. Set the session cookie via the existing `setSessionCookie` and return the
   user, so a successful reset lands the student in the app.

### Analytics

Two PostHog events in the existing capture shape: `password reset requested`
and `password reset completed`.

## Frontend

`wouter`, two new unauthenticated routes beside `/login` and `/register` in
`artifacts/studio/src/App.tsx:60-61`:

```tsx
<Route path="/forgot-password">{user ? <Redirect to="/" /> : <ForgotPassword />}</Route>
<Route path="/reset-password"><ResetPassword /></Route>
```

The two routes deliberately differ: `/forgot-password` redirects a logged-in user (nothing is lost), but `/reset-password` renders unconditionally. Reset does not revoke sessions, so a live cookie in the browser that opens the emailed link is normal, and redirecting it would silently waste the single-use token. A successful reset overwrites the session cookie, so the visitor ends up authenticated as themselves. Do not "fix" this inconsistency.

Both wrap in the existing `AuthShell`, inheriting the tagline panel and styling.

**Login page.** A right-aligned `Forgot?` link on the password label row in
`artifacts/studio/src/pages/auth/Login.tsx:51-55`, `data-testid="link-forgot-password"`.
It sits there rather than at the foot of the card because that is where the
user's attention already is when a login fails, and the area below the `OR`
divider stays dedicated to registration. The one-word label keeps the label row
from wrapping at phone width.

**`ForgotPassword`.** One email field. After submit it shows *"If that email has
an account, a reset link is on its way"* and reveals nothing about whether the
address matched — the wording has to stay vague here or the UI undoes the
endpoint's anti-enumeration.

**`ResetPassword`.** The link carries the token in the URL **fragment** —
`/reset-password#token=…`, not `?token=…`. A fragment is never sent to the
server, so the token cannot reach Render or Cloudflare access logs; a query
string reaches them on the very first request, before any client-side code could
strip it. The page reads `location.hash`, clears it with `history.replaceState`
(keeping the token out of browser history and any later `Referer`), and holds it
in component state only. One new-password field.

Both pages surface failures through `describeWriteError`
(`artifacts/studio/src/lib/describeWriteError.ts:51`), never `err.message`.

## Error handling

| Case | Response to caller | Where the detail goes |
|---|---|---|
| `RESEND_API_KEY` unset | `200` | `throw` in `sendEmail`, caught off-path, pino `error` + Sentry |
| Resend non-2xx | `200` | same, with status and body text in the message |
| Unknown email | `200 { success: true }` | nothing — indistinguishable by design |
| Token not found | `400` "This reset link is invalid or has expired." | — |
| Token expired | `400` — **the same string** | — |
| Password outside bounds | `400` with the length rule | — |

Not-found and expired share one message deliberately: distinct messages tell an
attacker holding a guessed token whether it ever existed.

## Security

- 32 bytes from `crypto.randomBytes`, base64url in the link; SHA-256 at rest, so
  a database read cannot yield a usable token.
- Single-use, enforced by nulling both columns in the same `UPDATE` that writes
  the new password hash.
- One-hour expiry, compared in JS against the stored `timestamptz`.
- Two rate limits on `/auth/forgot-password`, reusing login's in-memory Map
  pattern (`routes/auth.ts:45-65`) and its `resetLoginRateLimiterForTests`-style
  escape hatch: **10/min per IP** — lower than login's 20 because this endpoint
  sends mail — and **3/hour per email address**, which is what prevents
  mailbombing a known student. Both return `429` whether or not the account
  exists, so neither becomes an existence oracle.
- **The email-keyed limiter must evict; login's IP-keyed one gets away without
  it.** Its keys are attacker-supplied, so an unbounded `Map` is a memory leak
  any unauthenticated caller can drive. Expired entries are swept on insert.
  Both limits also stay per-process and do not survive a restart, which is
  acceptable only while `nos-api` runs a single instance — scale it out and each
  limit silently loosens per instance, at which point they need shared storage.
- **A third limiter, 10/min per IP, on `/auth/reset-password`, checked before
  anything else in the handler.** This endpoint is unauthenticated and runs
  `argon2.hash` *before* its conditional `UPDATE` — hashing after a cheap
  lookup would reintroduce the very race the single conditional statement
  exists to prevent — so a request carrying a garbage token costs exactly as
  much CPU as a legitimate one. `openapi.yaml`'s own `RegisterRequest.password`
  description already states the underlying hazard: argon2 is deliberately
  CPU-expensive and the API runs on a 0.5-CPU instance, so one request can
  starve others. `/auth/login` has been capped at 20/min/IP for that reason
  since before this feature existed. The limit is checked ahead of the body
  parse as well, so a `429` costs neither hashing nor parsing. Found in review
  of PWR-5, which had implemented this spec faithfully — the omission was in
  the spec, not the code.
- A body that fails to parse returns the **same** generic
  `This reset link is invalid or has expired.` string whenever the failure is
  anything other than password length. An error naming the token specifically
  would make the endpoint an oracle for whether a token ever existed.
- The request endpoint's identical-response guarantee mirrors the existing
  anti-enumeration pattern at `routes/auth.ts:147-154` and the repo's
  404-never-403 rule.

## Accounts without a password

`users.password_hash` is nullable, and login rejects a row whose hash is null
(`routes/auth.ts:149-154`). Reset as first drafted would have silently given such
a row its first password, turning this flow into an account-conversion path that
nothing in scope asked for. Issuance therefore requires a non-null
`password_hash`; a row without one gets the same `200` and no email.

**Count the production rows in that state before implementing.** If it is
non-zero, those users are already locked out of login and need a deliberate
decision — instructor-assisted reset, or allowing conversion on purpose —
rather than inheriting whichever behaviour falls out of the code. Do not assume
the count is zero without running the query: an unverified probe returning `0`
is the null-measurement trap CLAUDE.md records under Gotchas.

## Accepted risks

**A reset does not revoke existing sessions.** The session is a signed cookie
carrying the raw `userId` (`artifacts/api-server/src/middlewares/auth.ts:3-22`);
there is no server-side session store, and `requireAuth` performs zero database
reads. Revoking would mean a credential-epoch column compared on every
authenticated request — turning each one into a DB read — and would invalidate
every cookie issued before the change, logging everyone out once on deploy.

Decided against, knowingly. The threat this flow serves is a student who forgot
their password; an attacker already holding a valid cookie never needed the
password. The residual exposure is a cookie stolen before the reset continuing
to work for up to its 7-day TTL. OWASP recommends otherwise, so this is a
deliberate accepted risk, not an oversight. Revisit if the app ever holds
anything more sensitive than coursework.

**Resend verification is unconfirmed from this session.** DNS shows DKIM at
`resend._domainkey.app.networkdesignbook.com` and a `send.forge.rmta.net` CNAME
on `send.app.networkdesignbook.com`, which is strong evidence the domain is set
up in Resend — but not the same as Resend reporting `verified`. The Resend key
available here is send-only (`401 restricted_api_key` on `list-domains`). Confirm
in the dashboard before relying on delivery to arbitrary recipients.

## Testing

**api-server vitest, real Postgres.** `fetch` stubbed with `vi.stubGlobal`; no
test reaches Resend.

- unknown email → `200`, and no row is mutated
- known email → `200`, the row gets a hash and an expiry, and the stored hash
  `!==` the raw token (non-vacuity: proves hashing actually happened)
- happy-path confirm → password changed, both columns null, session cookie set
- the same token replayed → `400` (single-use)
- expired token → `400`
- password below and above bounds → `400`
- rate limit on the request endpoint: the 11th request in a minute from one IP
  → `429`; the 4th in an hour for one address → `429`
- rate limit on the confirm endpoint: the 11th request in a minute from one IP
  → `429`, **and `argon2.hash` is not called on that request** — a test that
  only checks the status would pass even if the limiter ran after the hash,
  which is the whole defect
- a malformed `token` with a valid-length password → `400` carrying the generic
  invalid-or-expired string, not the password-length message
- limiter eviction: keys from an elapsed window are gone after a later insert,
  so the `Map` does not grow without bound across windows
- two concurrent confirms of the same token → exactly one `200` and one `400`,
  and the stored hash is null afterwards (the race finding 3 names)
- a second request for the same address invalidates the first token: the older
  link → `400`, the newer one → `200`
- a row with a non-null email and a null `password_hash` → `200`, no token
  written, no send attempted

**studio vitest / RTL.**

- login page renders `link-forgot-password`
- `ForgotPassword` shows the vague confirmation on success **and** on an unknown
  email
- `ResetPassword` surfaces a failure through an Alert

**Guard-test scope.** `rawErrorMessageSurface.test.ts` walks the whole `src` tree
against an allow-list, so it covers the new pages automatically, and no
allow-list entry is added for them. `mutationErrorSurface.test.ts` reads a single
file (`SRC = ../pages/Workspace.tsx`), so the new pages fall outside it by
construction. That is precisely the pattern-scoped blind spot CLAUDE.md records
costing four misses, so implementation extends that guard to a file list
including both new pages.

**Playwright.** Link presence, navigation, submit, vague confirmation. The
token-consuming half stays in the api-server tests — e2e does not reach a real
inbox. Mailosaur is configured if a true end-to-end mail assertion is wanted
later; keep it out of `e2e:gate`.

**Flake expectation.** The new real-Postgres tests join the load-induced flake
class catalogued in `docs/superpowers/flake-registry.md`. A first-run red needs
the re-run-twice discipline before being treated as a regression, and a new
sighting belongs in that registry, matched by test **name** rather than line
number, instead of being noted only in a changelog entry.

## Deployment

Three environment variables on `nos-api`:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | secret, full-send key |
| `EMAIL_FROM` | `noreply@app.networkdesignbook.com` |
| `APP_BASE_URL` | `https://app.networkdesignbook.com` |

Setting these on a live service is its own approval under branch-discipline rule
7, requested separately when implementation is ready. Merge approval is not
deploy approval.
