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
| `POST /auth/reset-password` | `{ token, password }` | `200 { user }`, session cookie set | `400 { error }` |

Both go into `lib/api-spec/openapi.yaml`; Orval regenerates the Zod validators
and the React Query client. Spec, generated output, and implementation land in
one commit per task (hard rules #1 and #4).

## Flows

### Request — `POST /auth/forgot-password`

1. Normalize the address with the existing `withNormalizedEmail`.
2. Apply both rate limits (see Security). On trip, `429`.
3. **Respond `200 { success: true }` immediately**, before any lookup or send.
4. Off the response path: `findUserByEmail`. If a user exists, generate 32 bytes
   via `crypto.randomBytes`, store `sha256(token)` and `now + 1h`, and send the
   email. Any failure is logged via pino and reported to Sentry.

Responding first does two jobs. It removes a timing side-channel — a real lookup
plus a ~200 ms Resend call is measurable against an instant miss, which leaks
account existence even though the response body is identical. And it keeps the
endpoint fast. The cost is that a user whose email fails to send still sees
success; that is the correct trade for an anti-enumeration endpoint, and the
failure is visible in Sentry.

### Confirm — `POST /auth/reset-password`

1. Validate the password against the existing `registerUserBodyPasswordMin` /
   `registerUserBodyPasswordMax` bounds — the same rules as registration, so
   there is no second password standard to drift.
2. `SELECT` by `reset_token_hash = sha256(token)`. Reject when no row matches or
   `resetTokenExpiresAt <= now`.
3. `argon2.hash` the new password. In one `UPDATE`, write `passwordHash` and set
   **both** token columns to null — that nulling is what makes the token
   single-use.
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
<Route path="/reset-password">{user ? <Redirect to="/" /> : <ResetPassword />}</Route>
```

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

**`ResetPassword`.** Reads `?token=` from the URL, then calls
`history.replaceState` to strip it, keeping the token out of browser history and
out of any later `Referer`. One new-password field.

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
- The request endpoint's identical-response guarantee mirrors the existing
  anti-enumeration pattern at `routes/auth.ts:147-154` and the repo's
  404-never-403 rule.

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
- rate limit: the 11th request in a minute from one IP → `429`; the 4th in an
  hour for one address → `429`

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
class catalogued under `## Gotchas` in `CLAUDE.md`. A first-run red needs the
re-run-twice discipline before being treated as a regression, and a new sighting
is added to that list rather than noted only in a changelog entry. (A dedicated
`docs/superpowers/flake-registry.md` is in flight on the `docs/claude-md-trim`
branch; retarget this reference once that lands.)

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
