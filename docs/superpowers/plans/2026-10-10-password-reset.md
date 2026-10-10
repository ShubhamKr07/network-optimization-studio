# Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship self-serve forgot-password for Network Optimization Studio — a student requests a reset by email, follows a one-hour single-use link, and sets a new password.

**Architecture:** Two new `/auth/*` endpoints on the existing Express router. Reset-token state is two nullable columns on `users`; the token itself is 32 random bytes, stored only as a SHA-256 hash. Email goes out through Resend's REST API via native `fetch` — no SDK, no mailer abstraction. Two new unauthenticated `wouter` routes in the Studio reuse the existing `AuthShell`.

**Tech Stack:** Express 5 + Drizzle (Postgres, `drizzle-kit push`, no migration files), argon2, `node:crypto`, Orval-generated Zod + React Query client from `lib/api-spec/openapi.yaml`, React + Vite + wouter, vitest/RTL, Playwright.

**Design doc:** `docs/superpowers/specs/2026-10-10-password-reset-design.md` — read it before Task 1. Every decision below traces to it.

## Global Constraints

- Worktree is `/Users/shubhamkr/nos-password-reset`, branch `password-reset`. **Every task's first Bash command is `cd /Users/shubhamkr/nos-password-reset` followed by `git rev-parse --abbrev-ref HEAD`, which must print `password-reset`. If it prints anything else, STOP.**
- Before any `git commit`: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`
- Commit with an explicit pathspec (`git commit <paths> -m …`), never a bare `git commit`.
- **A pathspec commit cannot name an untracked file** — `git commit new-file.ts` fails with "pathspec did not match". For a task that creates files, `git add <those exact paths>` first, then `git commit <the same paths>`. Staging exactly the paths you are about to commit keeps the explicit-pathspec protection intact; `git add -A` does not and is forbidden.
- One task = one commit. Message format `[PWR-N] <imperative summary>`.
- **Never edit generated code.** `lib/api-zod/src/generated/**` and `lib/api-client-react/src/generated/**` come from Orval. Change `lib/api-spec/openapi.yaml`, re-run codegen, commit spec + regenerated output together.
- Local DB: no `DATABASE_URL` in the environment. Pass it inline per command: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`.
- **`api-server`'s `pretest` hook (`artifacts/api-server/package.json:11`) runs `scripts/preflight-db-url.mjs` and refuses to start vitest without `DATABASE_URL`** — so *every* api-server test command carries it, including the ones that only exercise mocked modules. A command without it fails before a single test runs.
- Token TTL is exactly `60 * 60 * 1000` ms. Rate limits are exactly 10 per 60_000 ms per IP and 3 per 3_600_000 ms per email address.
- Reset link format is exactly `${APP_BASE_URL}/reset-password#token=<token>` — a URL **fragment**, never a query string.
- The invalid-token and expired-token error string is exactly `This reset link is invalid or has expired.` — one string for both cases.
- `/auth/forgot-password` returns `200 {"success":true}` for every well-formed and malformed body alike; the only other status it may return is `429`.
- Password bounds come from the generated `resetPasswordBodyPasswordMin` / `resetPasswordBodyPasswordMax` constants. Never hardcode 8 or 128 in application code.
- Routes are mounted under `/api` (`app.ts:68`), so tests and the client call `/api/auth/forgot-password`.
- Code-writing tasks must invoke `andrej-karpathy-skills:karpathy-guidelines` **and** `ponytail:ponytail` before writing code. The QA task (Task 8) is exempt from both.

---

## Pre-flight: production row count (do this first, needs the user)

The design doc requires counting production `users` rows with a non-null `email` and a null `password_hash` before the reset path refuses them. This is a read-only production query and needs explicit user approval under the `render-ops` rules.

- [ ] **Step 1: Ask the user for approval** to run one read-only count against `nos-postgres`. Do not proceed without a yes.
- [ ] **Step 2: Run the count**

```sql
SELECT count(*) AS no_password_rows
FROM users
WHERE email IS NOT NULL AND password_hash IS NULL;
```

- [ ] **Step 3: Record the number** in the changelog entry written in Task 9. If it is **non-zero**, STOP and report: those accounts are locked out of login and whether they may convert via reset is a product decision, not an implementation detail. Do not assume zero — an unverified probe returning `0` is the null-measurement trap in CLAUDE.md's Gotchas.

---

## File Structure

**Created:**
- `artifacts/api-server/src/lib/email.ts` — Resend transport. One exported function, no knowledge of password reset.
- `artifacts/api-server/src/lib/rateLimit.ts` — a rate-limiter factory with key eviction. Used twice by the forgot-password route.
- `artifacts/api-server/src/lib/resetTokens.ts` — token generation, hashing, and the reset email body. Pure functions, no DB and no HTTP.
- `artifacts/api-server/src/__tests__/passwordReset.test.ts` — mocked-DB unit tests for both routes, matching `auth.test.ts`'s existing style.
- `artifacts/api-server/src/__tests__/passwordResetIntegration.test.ts` — real-Postgres tests for the things a mocked DB structurally cannot prove (the conditional `UPDATE`, single-use, the concurrent-confirm race).
- `artifacts/studio/src/pages/auth/ForgotPassword.tsx`
- `artifacts/studio/src/pages/auth/ResetPassword.tsx`
- `artifacts/studio/src/__tests__/ForgotPassword.test.tsx`
- `artifacts/studio/src/__tests__/ResetPassword.test.tsx`
- `artifacts/studio/e2e/password-reset.spec.ts`

**Modified:**
- `lib/db/src/schema/auth.ts` — two columns on `usersTable`.
- `lib/api-spec/openapi.yaml` — two paths, three schemas.
- `artifacts/api-server/src/routes/auth.ts` — two route handlers plus their helpers.
- `artifacts/studio/src/pages/auth/Login.tsx:51-55` — the `Forgot?` link.
- `artifacts/studio/src/App.tsx:60-61` — two new unauthenticated routes.
- `artifacts/studio/src/__tests__/Login.test.tsx` — assert the new link.
- `artifacts/studio/src/__tests__/mutationErrorSurface.test.ts` — widen from one file to three.
- `docs/CHANGELOG-implementation.md` — one entry (Task 9).

Why `resetTokens.ts` is separate from the route: the token helpers are pure and are the only part worth unit-testing in isolation, and keeping the email body out of `routes/auth.ts` stops that already-dense file from growing a second responsibility.

---

### Task 1: Schema columns

**Files:**
- Modify: `lib/db/src/schema/auth.ts:17-27`

**Interfaces:**
- Consumes: nothing.
- Produces: `usersTable.resetTokenHash` (`varchar`, nullable, column `reset_token_hash`) and `usersTable.resetTokenExpiresAt` (`timestamp` with timezone, nullable, column `reset_token_expires_at`). Every later task reads these names off `usersTable`.

- [ ] **Step 1: Add the columns**

In `lib/db/src/schema/auth.ts`, inside `usersTable`, after the `passwordHash` line:

```ts
  passwordHash: varchar("password_hash"),
  // Password reset (PWR). Both nullable: a row has a live token or it does
  // not, and nulling the pair is what makes a token single-use. Nullable also
  // means `drizzle-kit push` needs no two-step NOT NULL protocol.
  resetTokenHash: varchar("reset_token_hash"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
```

- [ ] **Step 2: Typecheck the libs**

Run: `pnpm run typecheck:libs`
Expected: PASS, no output beyond tsc's normal build lines.

- [ ] **Step 3: Push the schema to the local dev DB**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter @workspace/db push`
Expected: drizzle-kit reports two added columns and exits 0.

- [ ] **Step 4: Prove the columns exist**

Run:
```bash
psql "postgresql://shubhamkr@localhost:5432/nos_dev" -c "\d users" | grep reset_token
```
Expected: two rows, `reset_token_hash | character varying` and `reset_token_expires_at | timestamp with time zone`.

- [ ] **Step 5: Commit**

```bash
git commit lib/db/src/schema/auth.ts -m "[PWR-1] add reset token columns to users"
```

---

### Task 2: API contract

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (paths after `/auth/user`, schemas after `LoginRequest`)
- Regenerated (do not hand-edit): `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`

**Interfaces:**
- Consumes: `AuthUserEnvelope`, `ErrorEnvelope` (already in the spec).
- Produces, from `@workspace/api-zod`: `ForgotPasswordBody`, `ForgotPasswordResponse`, `ResetPasswordBody`, `ResetPasswordResponse`, `resetPasswordBodyPasswordMin`, `resetPasswordBodyPasswordMax`. From `@workspace/api-client-react`: `useForgotPassword`, `useResetPassword`. Tasks 4–7 import exactly these names.

- [ ] **Step 1: Add the two paths**

In `lib/api-spec/openapi.yaml`, immediately after the `/auth/user` block (ends around line 705) and before `/feedback`:

```yaml
  /auth/forgot-password:
    post:
      tags: [Auth]
      operationId: forgotPassword
      summary: Request a password reset link
      description: >-
        Always answers 200, whether or not an account exists for the address,
        and answers before any lookup or send happens — a real lookup plus a
        Resend call is measurable against an instant miss, which would leak
        account existence even with an identical body. A failed send is
        therefore invisible to the caller and is reported to Sentry instead.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ForgotPasswordRequest'
      responses:
        '200':
          description: Request accepted. Reveals nothing about whether the account exists.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ForgotPasswordAccepted'
        '429':
          description: Rate limit tripped (per IP or per address). Returned regardless of whether the account exists.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
  /auth/reset-password:
    post:
      tags: [Auth]
      operationId: resetPassword
      summary: Set a new password using a reset token
      description: >-
        On success the caller is logged in, so a student lands straight in the
        app. The token is consumed by the same statement that writes the new
        hash, which is what makes it single-use.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ResetPasswordRequest'
      responses:
        '200':
          description: Password changed; caller is logged in.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuthUserEnvelope'
        '400':
          description: >-
            Token unknown or expired (one message for both — distinct messages
            would tell a caller holding a guessed token whether it ever
            existed), or the password is outside the length bounds.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
```

- [ ] **Step 2: Add the three schemas**

In `components.schemas`, immediately after the `LoginRequest` block (ends around line 811):

```yaml
    ForgotPasswordRequest:
      type: object
      required: [email]
      properties:
        email:
          type: string
          format: email
          description: >-
            Normalized (trimmed + lowercased) by the server before lookup, the
            same as login.
    ForgotPasswordAccepted:
      type: object
      required: [success]
      properties:
        success:
          type: boolean
          const: true
    ResetPasswordRequest:
      type: object
      required: [token, password]
      properties:
        token:
          type: string
          minLength: 1
          description: >-
            The raw token from the reset link's URL fragment. Only its SHA-256
            hash is ever stored.
        password:
          type: string
          minLength: 8
          maxLength: 128
          description: >-
            Same bounds as registration — deliberately one password standard,
            not two. The upper bound is the same argon2 cost guard described on
            RegisterRequest.password.
```

- [ ] **Step 3: Regenerate the client and validators**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval writes files, then `typecheck:libs` passes. Exit 0.

- [ ] **Step 4: Prove the expected names were generated**

Orval's casing is mixed and the difference matters: **schemas are PascalCase** (`export const RegisterUserBody = zod.object({…})`, `generated/api.ts:822`) while **the bound constants are camelCase** (`registerUserBodyPasswordMin`). Assert each symbol separately, so one hit cannot mask four misses:

```bash
cd /Users/shubhamkr/nos-password-reset
for sym in "export const ForgotPasswordBody" "export const ForgotPasswordResponse" \
           "export const ResetPasswordBody" "export const ResetPasswordResponse" \
           "export const resetPasswordBodyPasswordMin" "export const resetPasswordBodyPasswordMax"; do
  grep -q "$sym" lib/api-zod/src/generated/api.ts && echo "OK   $sym" || echo "MISS $sym"
done
for hook in useForgotPassword useResetPassword; do
  grep -rq "$hook" lib/api-client-react/src/generated/ && echo "OK   $hook" || echo "MISS $hook"
done
```
Expected: eight `OK` lines and no `MISS`. A single `grep -n "a\|b\|c"` is NOT acceptable here — it exits 0 on any one match, so it would report success while two schemas were absent, which is the can't-fail check class CLAUDE.md records under Gotchas. If a generated name differs from what this plan predicts, use the generated name and note the deviation in the commit body — the generated output is authoritative.

- [ ] **Step 5: Commit spec and generated output together**

```bash
git commit lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react \
  -m "[PWR-2] add forgot-password and reset-password to the API contract"
```

---

### Task 3: Resend transport and the rate-limiter factory

**Files:**
- Create: `artifacts/api-server/src/lib/email.ts`
- Create: `artifacts/api-server/src/lib/rateLimit.ts`
- Create: `artifacts/api-server/src/__tests__/emailTransport.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sendEmail(to: string, subject: string, html: string): Promise<void>` — resolves on a 2xx, throws otherwise.
  - `makeRateLimiter(limit: number, windowMs: number)` returning `{ check(key: string): boolean; reset(): void; size(): number }`. `check` returns `true` when the caller is **over** the limit.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/__tests__/emailTransport.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail } from "../lib/email.js";
import { makeRateLimiter } from "../lib/rateLimit.js";

describe("sendEmail", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "noreply@app.networkdesignbook.com";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("posts to Resend with the bearer key and the configured sender", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail("student@example.test", "Subject", "<p>Body</p>");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "noreply@app.networkdesignbook.com",
      to: "student@example.test",
      subject: "Subject",
      html: "<p>Body</p>",
    });
  });

  it("throws with the status and body when Resend refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad domain" }));
    await expect(sendEmail("a@b.test", "S", "<p>B</p>")).rejects.toThrow(/422.*bad domain/);
  });

  it("throws without calling fetch when the API key is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmail("a@b.test", "S", "<p>B</p>")).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("makeRateLimiter", () => {
  it("allows up to the limit and trips after it", () => {
    const limiter = makeRateLimiter(3, 60_000);
    expect(limiter.check("k")).toBe(false);
    expect(limiter.check("k")).toBe(false);
    expect(limiter.check("k")).toBe(false);
    expect(limiter.check("k")).toBe(true);
  });

  it("keys are independent", () => {
    const limiter = makeRateLimiter(1, 60_000);
    expect(limiter.check("a")).toBe(false);
    expect(limiter.check("b")).toBe(false);
    expect(limiter.check("a")).toBe(true);
  });

  // The reason this factory exists rather than a second inline copy of
  // login's Map: this limiter is keyed by caller-supplied email, so without
  // eviction the Map is a memory leak any unauthenticated caller can drive.
  it("evicts keys whose window has elapsed, so the map does not grow without bound", () => {
    vi.useFakeTimers();
    try {
      const limiter = makeRateLimiter(5, 1_000);
      for (let i = 0; i < 50; i++) limiter.check(`caller-${i}@example.test`);
      expect(limiter.size()).toBe(50);

      vi.advanceTimersByTime(1_500);
      limiter.check("someone-else@example.test");

      expect(limiter.size()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset() clears everything", () => {
    const limiter = makeRateLimiter(1, 60_000);
    limiter.check("a");
    limiter.reset();
    expect(limiter.size()).toBe(0);
    expect(limiter.check("a")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- emailTransport`
Expected: FAIL — cannot resolve `../lib/email.js` and `../lib/rateLimit.js`.

- [ ] **Step 3: Write `lib/email.ts`**

```ts
// Resend's REST API, called with native fetch (Node 26). No SDK: this is one
// POST, and the SDK's retries/idempotency/templates buy nothing for a single
// transactional send. If email needs grow, the SDK drops in behind this exact
// signature.
const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "noreply@app.networkdesignbook.com";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? DEFAULT_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 4: Write `lib/rateLimit.ts`**

```ts
type Entry = { count: number; windowStart: number };

/**
 * Fixed-window counter, per process. Deliberately NOT a refactor of login's
 * inline limiter in routes/auth.ts — that one is load-bearing with its own
 * documented tuning history, and this one needs something it does not: key
 * eviction, because the forgot-password limiter is keyed by caller-supplied
 * email rather than by IP.
 *
 * Per-process and restart-resettable, which is acceptable only while nos-api
 * runs a single instance. Scaled out, each limit loosens per instance and this
 * needs to move to shared storage.
 */
export function makeRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, Entry>();

  return {
    /** True when this key is OVER the limit. */
    check(key: string): boolean {
      const now = Date.now();
      // ponytail: O(n) sweep per call — fine at tens of keys; switch to a
      // timer or a bounded LRU if this ever serves real traffic.
      for (const [k, entry] of hits) {
        if (now - entry.windowStart > windowMs) hits.delete(k);
      }

      const entry = hits.get(key);
      if (!entry || now - entry.windowStart > windowMs) {
        hits.set(key, { count: 1, windowStart: now });
        return false;
      }
      entry.count += 1;
      return entry.count > limit;
    },
    reset(): void {
      hits.clear();
    },
    /** Live key count. Exported so the eviction test can be non-vacuous. */
    size(): number {
      return hits.size;
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- emailTransport`
Expected: PASS, 7 tests (3 for `sendEmail`, 4 for `makeRateLimiter`).

- [ ] **Step 6: Commit**

```bash
git commit artifacts/api-server/src/lib/email.ts artifacts/api-server/src/lib/rateLimit.ts \
  artifacts/api-server/src/__tests__/emailTransport.test.ts \
  -m "[PWR-3] add Resend transport and an evicting rate-limiter factory"
```

---

### Task 4: Token helpers and the reset email body

**Files:**
- Create: `artifacts/api-server/src/lib/resetTokens.ts`
- Create: `artifacts/api-server/src/__tests__/resetTokens.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RESET_TOKEN_TTL_MS: number` (3_600_000)
  - `generateResetToken(): string` — 32 random bytes, base64url
  - `hashResetToken(token: string): string` — SHA-256 hex
  - `resetEmailHtml(token: string): string` — the email body, containing the fragment link
  - `resetEmailSubject: string`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/__tests__/resetTokens.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import {
  RESET_TOKEN_TTL_MS,
  generateResetToken,
  hashResetToken,
  resetEmailHtml,
} from "../lib/resetTokens.js";

afterEach(() => {
  delete process.env.APP_BASE_URL;
});

describe("reset tokens", () => {
  it("has a one-hour TTL", () => {
    expect(RESET_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("generates URL-safe tokens with no two alike", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateResetToken()));
    expect(tokens.size).toBe(50);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes to 64 hex chars, stably, and never returns the input", () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetToken(token)).toBe(hashResetToken(token));
    expect(hashResetToken(token)).not.toBe(token);
    expect(hashResetToken(token)).not.toBe(hashResetToken(generateResetToken()));
  });

  it("puts the token in the URL fragment, never the query string", () => {
    const html = resetEmailHtml("TOKEN123");
    expect(html).toContain("https://app.networkdesignbook.com/reset-password#token=TOKEN123");
    expect(html).not.toContain("?token=");
  });

  it("honours APP_BASE_URL", () => {
    process.env.APP_BASE_URL = "http://localhost:5173";
    expect(resetEmailHtml("T")).toContain("http://localhost:5173/reset-password#token=T");
  });

  // Last-token-wins is the defined behaviour, so the copy has to say so —
  // out-of-order delivery is exactly the case this wording exists for.
  it("tells the reader that only the newest link works and that it expires", () => {
    const html = resetEmailHtml("T");
    expect(html).toMatch(/newest link/i);
    expect(html).toMatch(/hour/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- resetTokens`
Expected: FAIL — cannot resolve `../lib/resetTokens.js`.

- [ ] **Step 3: Write `lib/resetTokens.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const DEFAULT_BASE_URL = "https://app.networkdesignbook.com";

export const resetEmailSubject = "Reset your Network Design Labs password";

/** 32 bytes of CSPRNG output, base64url so it is safe in a URL fragment. */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256, not argon2. A slow KDF defends low-entropy secrets against
 * offline guessing; this secret is 32 random bytes, so there is nothing to
 * guess and the cost would land on every confirm request.
 */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function resetEmailHtml(token: string): string {
  const base = process.env.APP_BASE_URL ?? DEFAULT_BASE_URL;
  // Fragment, not query string: a fragment is never sent to the server, so
  // the token stays out of Render and Cloudflare access logs.
  const link = `${base}/reset-password#token=${token}`;
  return [
    "<p>Someone asked to reset the password for this Network Design Labs account.</p>",
    `<p><a href="${link}">Set a new password</a></p>`,
    "<p>The link works for one hour and can be used once. If you asked more than once, only the newest link works.</p>",
    "<p>If this wasn't you, ignore this email — nothing has changed.</p>",
  ].join("\n");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- resetTokens`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git commit artifacts/api-server/src/lib/resetTokens.ts artifacts/api-server/src/__tests__/resetTokens.test.ts \
  -m "[PWR-4] add reset token helpers and the reset email body"
```

---

### Task 5: The two route handlers

**Files:**
- Modify: `artifacts/api-server/src/routes/auth.ts` (imports at `:1-16`, new handlers after the `/auth/user` handler at `:197`)
- Create: `artifacts/api-server/src/__tests__/passwordReset.test.ts`

**Interfaces:**
- Consumes: Task 1's columns, Task 2's `ForgotPasswordBody` / `ForgotPasswordResponse` / `ResetPasswordBody` / `ResetPasswordResponse` / `resetPasswordBodyPasswordMin` / `resetPasswordBodyPasswordMax`, Task 3's `sendEmail` + `makeRateLimiter`, Task 4's token helpers. Also the file's own existing `findUserByEmail`, `setSessionCookie`, `toAuthUser`, and `withNormalizedEmail`.
- Produces: `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, and `resetForgotPasswordLimitersForTests(): void`.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/__tests__/passwordReset.test.ts`. Note the drizzle-orm mock must now carry `and` and `gt` as well as `eq`/`sql` — `auth.test.ts`'s mock has only the latter two, and the new handler uses all four.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: {
    id: "id",
    email: "email",
    passwordHash: "password_hash",
    resetTokenHash: "reset_token_hash",
    resetTokenExpiresAt: "reset_token_expires_at",
  },
}));

// The handler uses and()/gt() for the conditional UPDATE's WHERE, which
// auth.test.ts's drizzle mock does not provide.
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ op: "gt", col, val })),
  and: vi.fn((...parts: unknown[]) => ({ op: "and", parts })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

// vi.hoisted is mandatory, not stylistic: vitest hoists `vi.mock` and the
// `import app from "../app.js"` below ABOVE a plain `const mockSendEmail =
// vi.fn()`, so the factory would dereference it before initialization and
// throw. This is why auth.test.ts's own mockDb uses vi.hoisted.
const mockSendEmail = vi.hoisted(() => vi.fn());
vi.mock("../lib/email.js", () => ({ sendEmail: mockSendEmail }));

import app from "../app.js";
import { resetForgotPasswordLimitersForTests } from "../routes/auth.js";
import { hashResetToken } from "../lib/resetTokens.js";

type Chain = Record<string, ReturnType<typeof vi.fn>>;

function makeChain(returnValue: unknown): Chain {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "update", "set", "returning"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve);
  return chain as Chain;
}

const USER = { id: "u1", email: "student@example.test", role: "student", passwordHash: "argon2-hash" };

/** The route answers before it sends, so tests must let the tail run. */
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.clearAllMocks();
  resetForgotPasswordLimitersForTests();
  mockSendEmail.mockResolvedValue(undefined);
  process.env.RESEND_API_KEY = "re_test";
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

describe("POST /api/auth/forgot-password", () => {
  it("returns 200 and writes a token for a known account", async () => {
    const selectChain = makeChain([USER]);
    const updateChain = makeChain([USER]);
    mockDb.select.mockReturnValue(selectChain);
    mockDb.update.mockReturnValue(updateChain);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "student@example.test" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    await flush();
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    const written = updateChain.set.mock.calls[0]![0] as { resetTokenHash: string; resetTokenExpiresAt: Date };
    expect(written.resetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(written.resetTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  // Non-vacuity: proves the token was hashed rather than stored raw. The
  // emailed link must contain a token that hashes TO the stored value and is
  // not itself the stored value.
  it("emails a raw token whose hash is what got stored", async () => {
    mockDb.select.mockReturnValue(makeChain([USER]));
    const updateChain = makeChain([USER]);
    mockDb.update.mockReturnValue(updateChain);

    await request(app).post("/api/auth/forgot-password").send({ email: "student@example.test" });
    await flush();

    const stored = (updateChain.set.mock.calls[0]![0] as { resetTokenHash: string }).resetTokenHash;
    const html = mockSendEmail.mock.calls[0]![2] as string;
    const emailed = /#token=([A-Za-z0-9_-]+)/.exec(html)?.[1];
    expect(emailed).toBeTruthy();
    expect(emailed).not.toBe(stored);
    expect(hashResetToken(emailed!)).toBe(stored);
  });

  it("returns the same 200 for an unknown account and writes nothing", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    const updateChain = makeChain([]);
    mockDb.update.mockReturnValue(updateChain);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.test" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    await flush();
    expect(updateChain.set).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("refuses to issue for a row with a null password_hash", async () => {
    mockDb.select.mockReturnValue(makeChain([{ ...USER, passwordHash: null }]));
    const updateChain = makeChain([]);
    mockDb.update.mockReturnValue(updateChain);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "student@example.test" });
    expect(res.status).toBe(200);

    await flush();
    expect(updateChain.set).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 for a malformed body, and sends nothing", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "not-an-email" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    await flush();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 when the send fails", async () => {
    mockDb.select.mockReturnValue(makeChain([USER]));
    mockDb.update.mockReturnValue(makeChain([USER]));
    mockSendEmail.mockRejectedValue(new Error("Resend 500: boom"));

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "student@example.test" });
    expect(res.status).toBe(200);
    await flush();
  });

  it("trips at the 11th request from one IP", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    for (let i = 0; i < 10; i++) {
      const ok = await request(app).post("/api/auth/forgot-password").send({ email: `a${i}@example.test` });
      expect(ok.status).toBe(200);
    }
    const tripped = await request(app).post("/api/auth/forgot-password").send({ email: "a10@example.test" });
    expect(tripped.status).toBe(429);
  });
});

describe("POST /api/auth/reset-password", () => {
  it("sets the new password, consumes the token, and logs the caller in", async () => {
    const updateChain = makeChain([USER]);
    mockDb.update.mockReturnValue(updateChain);

    const res = await request(app).post("/api/auth/reset-password").send({ token: "raw-token", password: "correcthorse1" });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: "u1", email: "student@example.test", role: "student" });
    expect(res.headers["set-cookie"]?.[0]).toMatch(/nos_session=/);

    const written = updateChain.set.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.resetTokenHash).toBeNull();
    expect(written.resetTokenExpiresAt).toBeNull();
    expect(typeof written.passwordHash).toBe("string");
    expect(written.passwordHash).not.toBe("correcthorse1");
  });

  it("matches on the HASH of the token, never the token itself", async () => {
    const updateChain = makeChain([USER]);
    mockDb.update.mockReturnValue(updateChain);
    await request(app).post("/api/auth/reset-password").send({ token: "raw-token", password: "correcthorse1" });

    const where = JSON.stringify(updateChain.where.mock.calls[0]![0]);
    expect(where).toContain(hashResetToken("raw-token"));
    expect(where).not.toContain("raw-token");
  });

  it("returns the generic 400 when no row matches", async () => {
    mockDb.update.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/auth/reset-password").send({ token: "stale", password: "correcthorse1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This reset link is invalid or has expired.");
  });

  it("rejects a password under the minimum", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "t", password: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects a password over the maximum before hashing", async () => {
    const updateChain = makeChain([]);
    mockDb.update.mockReturnValue(updateChain);
    const res = await request(app).post("/api/auth/reset-password").send({ token: "t", password: "a".repeat(129) });
    expect(res.status).toBe(400);
    expect(updateChain.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- passwordReset`
Expected: FAIL — `resetForgotPasswordLimitersForTests` is not exported, and both routes 404.

- [ ] **Step 3: Extend the imports in `routes/auth.ts`**

Replace the import block at `:1-16` so it also pulls what the new handlers need (keep every existing import):

```ts
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import argon2 from "argon2";
import { db, usersTable } from "@workspace/db";
import {
  RegisterUserBody,
  LoginUserBody,
  LoginUserResponse,
  LogoutUserResponse,
  GetCurrentAuthUserResponse,
  registerUserBodyPasswordMin,
  registerUserBodyPasswordMax,
  ForgotPasswordBody,
  ForgotPasswordResponse,
  ResetPasswordBody,
  ResetPasswordResponse,
  resetPasswordBodyPasswordMin,
  resetPasswordBodyPasswordMax,
} from "@workspace/api-zod";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../middlewares/auth.js";
import { posthog } from "../lib/posthog.js";
import { withNormalizedEmail } from "../lib/normalizeEmail.js";
import { sendEmail } from "../lib/email.js";
import { makeRateLimiter } from "../lib/rateLimit.js";
import {
  RESET_TOKEN_TTL_MS,
  generateResetToken,
  hashResetToken,
  resetEmailHtml,
  resetEmailSubject,
} from "../lib/resetTokens.js";
import * as Sentry from "@sentry/node";
import { logger } from "../lib/logger.js";
```

Both of those last two imports are verified present: `artifacts/api-server/src/lib/logger.ts:5` exports the shared `pino` instance as `logger`, and `import * as Sentry from "@sentry/node"` is the pattern already used in `app.ts:6`, `index.ts:2`, and `lib/sentry.ts:1`. Do not create a second logger or a second Sentry client.

- [ ] **Step 4: Append the handlers to `routes/auth.ts`**

After the `/auth/user` handler and before `export default router;`:

```ts
// Reset-request limits. Per IP, lower than login's 20 because this endpoint
// sends mail; per address, which is what stops someone mailbombing a known
// student. Both answer 429 whether or not the account exists, so neither
// becomes an existence oracle.
const forgotIpLimiter = makeRateLimiter(10, 60 * 1000);
const forgotEmailLimiter = makeRateLimiter(3, 60 * 60 * 1000);

export function resetForgotPasswordLimitersForTests(): void {
  forgotIpLimiter.reset();
  forgotEmailLimiter.reset();
}

/**
 * Everything that happens AFTER the 200 has already gone out. Issues a token
 * only for a row that can actually log in: `password_hash` is nullable, login
 * rejects a null one, and provisioning a first password here would quietly
 * turn reset into an account-conversion path nothing asked for.
 *
 * Repeat requests are last-token-wins — the newest overwrites an unexpired
 * one, and the email copy says so. Refusing while a live token exists would
 * strand a user whose first email failed to send for the rest of the hour.
 */
async function issueResetToken(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || !user.passwordHash) return;

  const token = generateResetToken();
  await db
    .update(usersTable)
    .set({
      resetTokenHash: hashResetToken(token),
      resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    })
    .where(eq(usersTable.id, user.id));

  await sendEmail(email, resetEmailSubject, resetEmailHtml(token));

  posthog?.capture({ distinctId: user.id, event: "password reset requested" });
}

router.post("/auth/forgot-password", (req: Request, res: Response) => {
  const parsed = ForgotPasswordBody.safeParse(withNormalizedEmail(req.body));
  const ip = req.ip ?? "unknown";

  // `||` short-circuits, so a request already refused on IP does not also
  // consume the address's hourly budget.
  if (forgotIpLimiter.check(ip) || (parsed.success && forgotEmailLimiter.check(parsed.data.email))) {
    res.status(429).json({ error: "Too many reset requests, try again shortly" });
    return;
  }

  // Answer BEFORE any lookup or send. A real lookup plus a ~200ms Resend call
  // is measurable against an instant miss, which leaks account existence even
  // though the body is identical either way. The cost is that a failed send is
  // invisible to the caller — it goes to Sentry instead.
  res.json(ForgotPasswordResponse.parse({ success: true }));

  if (!parsed.success) return;

  void issueResetToken(parsed.data.email).catch((err: unknown) => {
    logger.error({ err }, "password reset email failed");
    Sentry.captureException(err);
  });
});

router.post("/auth/reset-password", async (req: Request, res: Response) => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: `password must be ${resetPasswordBodyPasswordMin}-${resetPasswordBodyPasswordMax} characters`,
    });
    return;
  }
  const { token, password } = parsed.data;

  const passwordHash = await argon2.hash(password);

  // ONE conditional statement, not SELECT-then-UPDATE. The pair does not
  // enforce single use: two concurrent confirms of the same token both pass
  // the read and both write, racing to set different passwords. Here Postgres
  // arbitrates, and nulling both columns in this same statement is what makes
  // the token single-use. Hashing first means a losing racer only spent CPU.
  const [user] = await db
    .update(usersTable)
    .set({ passwordHash, resetTokenHash: null, resetTokenExpiresAt: null })
    .where(
      and(
        eq(usersTable.resetTokenHash, hashResetToken(token)),
        gt(usersTable.resetTokenExpiresAt, new Date()),
      ),
    )
    .returning();

  if (!user) {
    // One message for unknown AND expired — distinct messages would tell a
    // caller holding a guessed token whether it ever existed.
    res.status(400).json({ error: "This reset link is invalid or has expired." });
    return;
  }

  setSessionCookie(res, user.id);

  posthog?.capture({
    distinctId: user.id,
    event: "password reset completed",
    properties: { role: user.role, $set: { email: user.email, role: user.role } },
  });

  res.json(ResetPasswordResponse.parse({ user: toAuthUser(user) }));
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- passwordReset`
Expected: PASS, 12 tests.

- [ ] **Step 6: Confirm the existing auth suite still passes**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- auth`
Expected: PASS. If `auth.test.ts` now fails on a missing `and`/`gt` in its own drizzle mock, add them to that mock — that is a legitimate part of this task.

- [ ] **Step 7: Commit**

```bash
git commit artifacts/api-server/src/routes/auth.ts artifacts/api-server/src/__tests__/passwordReset.test.ts artifacts/api-server/src/__tests__/auth.test.ts \
  -m "[PWR-5] add forgot-password and reset-password routes"
```

---

> **Post-execution note (PWR-5 review).** Task 5 shipped as written in commit
> `24ca45f`, and review then found two gaps in this plan's own specification of
> it, fixed in `c5adb1b`: `/auth/reset-password` had no rate limit despite being
> unauthenticated and hashing with argon2 before validating the token, and its
> parse-error `400` blamed password length even when the `token` was what failed.
> The design doc's Security section now carries both. A third limiter
> (10/min/IP) is checked first in that handler, and `openapi.yaml` declares the
> `429`.

### Task 6: Real-Postgres integration tests

**Files:**
- Create: `artifacts/api-server/src/__tests__/passwordResetIntegration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5. No new exports.

Why this task exists separately: `passwordReset.test.ts` mocks the database, so **its return values are authored by the test**. A mocked `update().returning()` cannot prove that the conditional `WHERE` actually filters on expiry, that a second confirm finds no row, or that two concurrent confirms produce exactly one winner. Those are properties of Postgres, and only a real database can witness them. This follows `jadeTransportCostsPersistence.test.ts`'s convention exactly: no `vi.mock` of `@workspace/db` anywhere in the file.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Real-DB, real-route tests for the properties the mocked passwordReset suite
 * structurally cannot cover: the conditional UPDATE's expiry filter, single
 * use, and the concurrent-confirm race. No vi.mock of db anywhere in this
 * file. Requires a live DATABASE_URL.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

// The ONLY mock in this file, and it is not the database: a real Resend call
// from a test suite is unacceptable, and `vi.doMock` cannot help here because
// app.js has already imported lib/email.js by the time it would run. Hoisted
// and static, so it is in place before the first import. Postgres stays real,
// which is the entire point of this file.
const mockSendEmail = vi.hoisted(() => vi.fn());
vi.mock("../lib/email.js", () => ({ sendEmail: mockSendEmail }));

import { db, usersTable } from "@workspace/db";
import app from "../app.js";
import { hashResetToken, generateResetToken } from "../lib/resetTokens.js";
import { resetForgotPasswordLimitersForTests } from "../routes/auth.js";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

beforeEach(() => {
  resetForgotPasswordLimitersForTests();
});

async function registerFreshUser(): Promise<{ id: string; email: string }> {
  const email = `pwr-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correcthorse1" });
  expect(res.status).toBe(201);
  const id = res.body.user.id as string;
  createdUserIds.push(id);
  return { id, email };
}

/** Plant a token directly, so these tests never depend on email delivery. */
async function plantToken(userId: string, expiresAt: Date): Promise<string> {
  const token = generateResetToken();
  await db
    .update(usersTable)
    .set({ resetTokenHash: hashResetToken(token), resetTokenExpiresAt: expiresAt })
    .where(eq(usersTable.id, userId));
  return token;
}

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

describe("password reset against a real database", () => {
  it("accepts a live token, then refuses the same token a second time", async () => {
    const user = await registerFreshUser();
    const token = await plantToken(user.id, inAnHour());

    const first = await request(app).post("/api/auth/reset-password").send({ token, password: "newpassword1" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/auth/reset-password").send({ token, password: "anotherpass1" });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("This reset link is invalid or has expired.");

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row!.resetTokenHash).toBeNull();
    expect(row!.resetTokenExpiresAt).toBeNull();
  });

  it("the new password actually works at login and the old one does not", async () => {
    const user = await registerFreshUser();
    const token = await plantToken(user.id, inAnHour());
    await request(app).post("/api/auth/reset-password").send({ token, password: "brandnewpass1" });

    const good = await request(app).post("/api/auth/login").send({ email: user.email, password: "brandnewpass1" });
    expect(good.status).toBe(200);

    resetForgotPasswordLimitersForTests();
    const bad = await request(app).post("/api/auth/login").send({ email: user.email, password: "correcthorse1" });
    expect(bad.status).toBe(401);
  });

  it("refuses an expired token and leaves the password alone", async () => {
    const user = await registerFreshUser();
    const token = await plantToken(user.id, anHourAgo());

    const res = await request(app).post("/api/auth/reset-password").send({ token, password: "newpassword1" });
    expect(res.status).toBe(400);

    const stillWorks = await request(app).post("/api/auth/login").send({ email: user.email, password: "correcthorse1" });
    expect(stillWorks.status).toBe(200);
  });

  // The race the conditional UPDATE exists for. A SELECT-then-UPDATE pair
  // lets both of these win.
  it("two concurrent confirms of one token produce exactly one 200", async () => {
    const user = await registerFreshUser();
    const token = await plantToken(user.id, inAnHour());

    const [a, b] = await Promise.all([
      request(app).post("/api/auth/reset-password").send({ token, password: "racepassword1" }),
      request(app).post("/api/auth/reset-password").send({ token, password: "racepassword2" }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
  });

  it("a second request invalidates the first token", async () => {
    const user = await registerFreshUser();
    const firstToken = await plantToken(user.id, inAnHour());
    const secondToken = await plantToken(user.id, inAnHour());

    const stale = await request(app).post("/api/auth/reset-password").send({ token: firstToken, password: "newpassword1" });
    expect(stale.status).toBe(400);

    const fresh = await request(app).post("/api/auth/reset-password").send({ token: secondToken, password: "newpassword2" });
    expect(fresh.status).toBe(200);
  });

  // Closes the loop the mocked suite cannot: the token that reaches the
  // reader's inbox must be the one whose hash landed in the real column.
  it("the full request path emails a raw token whose hash is what the column holds", async () => {
    const user = await registerFreshUser();
    mockSendEmail.mockClear();
    mockSendEmail.mockResolvedValue(undefined);
    process.env.RESEND_API_KEY = "re_test";

    const res = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    expect(res.status).toBe(200);

    // The route answers before it sends, so wait for the tail to land.
    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalledTimes(1), { timeout: 5_000 });

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row!.resetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.resetTokenExpiresAt).not.toBeNull();

    const html = mockSendEmail.mock.calls[0]![2] as string;
    const emailed = /#token=([A-Za-z0-9_-]+)/.exec(html)?.[1];
    expect(emailed).toBeTruthy();
    expect(emailed).not.toBe(row!.resetTokenHash);
    expect(hashResetToken(emailed!)).toBe(row!.resetTokenHash);

    // And the emailed token actually works end to end.
    const confirm = await request(app).post("/api/auth/reset-password").send({ token: emailed, password: "fromemail1" });
    expect(confirm.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails for the right reason**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- passwordResetIntegration`
Expected: the file is new, so it should now PASS if Task 5 is correct. If any case fails, the defect is in Task 5's handler, not here — fix the handler. **Do not relax an assertion to make this file pass.**

The email transport is the one thing mocked in this file, hoisted at the top so it is installed before `app.js` imports it. Everything else — Postgres, the routes, argon2 — is real.

- [ ] **Step 3: Confirm it is not passing vacuously**

Run the suite twice in a row; both must be green. Then sabotage the expiry filter and confirm the right test — and **only** that test — goes red. Revert afterwards and prove the revert with an empty `git diff artifacts/api-server/src/routes/auth.ts`.

**Use this mutation:** replace the `gt(usersTable.resetTokenExpiresAt, new Date())` clause with `sql\`true\``, so expiry checking is switched off and nothing else changes.
Expected: exactly **1** failed — "refuses an expired token and leaves the password alone" — and 5 passed.

**Do NOT use `gt` → `eq` as the mutation**, which is what this step originally said. It is non-discriminating: `eq(expiry, now())` matches *no* row, so every token is refused, 5 of the 6 tests fail, and the expired-token test *passes for the wrong reason* — the `400` it asserts arrives because everything is broken, not because expiry was checked. Measured in PWR-6: that mutation produced 5 failed / 1 passed, with the one passing test being the very one it was supposed to prove.

**The general rule, which is why this step is written in this much detail:** a mutation test earns its keep only if it is *discriminating*. A mutation that reddens half the suite tells you the code is load-bearing in general; it tells you nothing about the specific property under test, and if the target test is among the survivors you have evidence of the opposite of what you concluded. Turn off exactly one property, expect exactly the test for that property to fail, and count the survivors.

- [ ] **Step 4: Commit**

```bash
git commit artifacts/api-server/src/__tests__/passwordResetIntegration.test.ts \
  -m "[PWR-6] add real-Postgres password reset integration tests"
```

---

### Task 7: Studio pages, routes, and the login link

**Files:**
- Create: `artifacts/studio/src/pages/auth/ForgotPassword.tsx`
- Create: `artifacts/studio/src/pages/auth/ResetPassword.tsx`
- Create: `artifacts/studio/src/__tests__/ForgotPassword.test.tsx`
- Create: `artifacts/studio/src/__tests__/ResetPassword.test.tsx`
- Modify: `artifacts/studio/src/pages/auth/Login.tsx:51-55`
- Modify: `artifacts/studio/src/App.tsx:60-61`
- Modify: `artifacts/studio/src/__tests__/Login.test.tsx`
- Modify: `artifacts/studio/src/__tests__/mutationErrorSurface.test.ts`

**Interfaces:**
- Consumes: `useForgotPassword`, `useResetPassword`, `getGetCurrentAuthUserQueryKey` from `@workspace/api-client-react`; `describeWriteError` from `@/lib/describeWriteError`; `AuthShell` from `@/components/auth/AuthShell`.
- Produces: exported components `ForgotPassword` and `ResetPassword`; testids `link-forgot-password`, `input-email`, `button-request-reset`, `text-reset-sent`, `alert-forgot-error`, `input-new-password`, `button-set-password`, `alert-reset-error`, `text-reset-link-invalid`.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/studio/src/__tests__/ForgotPassword.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const mockMutate = vi.fn();
let state: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: null };
vi.mock("@workspace/api-client-react", () => ({
  useForgotPassword: () => ({ mutate: mockMutate, ...state }),
}));

import { ForgotPassword } from "@/pages/auth/ForgotPassword";

beforeEach(() => {
  vi.clearAllMocks();
  state = { isPending: false, isError: false, error: null };
});

describe("ForgotPassword", () => {
  it("submits the email address", async () => {
    render(<ForgotPassword />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.click(screen.getByTestId("button-request-reset"));
    expect(mockMutate).toHaveBeenCalledWith(
      { data: { email: "student@example.com" } },
      expect.anything(),
    );
  });

  // The endpoint's whole anti-enumeration guarantee is undone if the UI is
  // more specific than the API.
  it("shows the same vague confirmation regardless of whether the address exists", async () => {
    mockMutate.mockImplementation((_vars, opts) => opts.onSuccess?.());
    render(<ForgotPassword />);
    await userEvent.type(screen.getByTestId("input-email"), "nobody@example.com");
    await userEvent.click(screen.getByTestId("button-request-reset"));

    const sent = screen.getByTestId("text-reset-sent");
    expect(sent).toBeInTheDocument();
    expect(sent.textContent).toMatch(/if that email has an account/i);
    expect(sent.textContent).not.toMatch(/nobody@example\.com .*(exists|not found)/i);
  });

  it("surfaces a failure instead of swallowing it", async () => {
    mockMutate.mockImplementation((_vars, opts) =>
      opts.onError?.({ status: 429, data: { error: "Too many reset requests, try again shortly" } }),
    );
    render(<ForgotPassword />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.click(screen.getByTestId("button-request-reset"));

    expect(screen.getByTestId("alert-forgot-error").textContent).toMatch(/too many reset requests/i);
    expect(screen.queryByTestId("text-reset-sent")).toBeNull();
  });
});
```

Create `artifacts/studio/src/__tests__/ResetPassword.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/reset-password", mockNavigate],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const mockSetQueryData = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mockSetQueryData }),
}));

const mockMutate = vi.fn();
let state: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: null };
vi.mock("@workspace/api-client-react", () => ({
  useResetPassword: () => ({ mutate: mockMutate, ...state }),
  getGetCurrentAuthUserQueryKey: () => ["getCurrentAuthUser"],
}));

import { ResetPassword } from "@/pages/auth/ResetPassword";

function setHash(hash: string) {
  window.history.replaceState(null, "", `/reset-password${hash}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  state = { isPending: false, isError: false, error: null };
  setHash("");
});

describe("ResetPassword", () => {
  it("reads the token from the URL fragment and submits it", async () => {
    setHash("#token=abc123");
    render(<ResetPassword />);
    await userEvent.type(screen.getByTestId("input-new-password"), "brandnewpass1");
    await userEvent.click(screen.getByTestId("button-set-password"));
    expect(mockMutate).toHaveBeenCalledWith(
      { data: { token: "abc123", password: "brandnewpass1" } },
      expect.anything(),
    );
  });

  // The token must not survive in history or leak via Referer.
  it("strips the fragment from the URL after reading it", async () => {
    setHash("#token=abc123");
    render(<ResetPassword />);
    expect(window.location.hash).toBe("");
  });

  it("tells the user the link is unusable when there is no token", () => {
    setHash("");
    render(<ResetPassword />);
    expect(screen.getByTestId("text-reset-link-invalid")).toBeInTheDocument();
    expect(screen.queryByTestId("input-new-password")).toBeNull();
  });

  it("logs the user in and redirects on success", async () => {
    setHash("#token=abc123");
    const data = { user: { id: "u1", email: "s@e.com", role: "student" } };
    mockMutate.mockImplementation((_vars, opts) => opts.onSuccess?.(data));
    render(<ResetPassword />);
    await userEvent.type(screen.getByTestId("input-new-password"), "brandnewpass1");
    await userEvent.click(screen.getByTestId("button-set-password"));

    expect(mockSetQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], data);
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("surfaces an expired-link failure", async () => {
    setHash("#token=stale");
    mockMutate.mockImplementation((_vars, opts) =>
      opts.onError?.({ status: 400, data: { error: "This reset link is invalid or has expired." } }),
    );
    render(<ResetPassword />);
    await userEvent.type(screen.getByTestId("input-new-password"), "brandnewpass1");
    await userEvent.click(screen.getByTestId("button-set-password"));

    expect(screen.getByTestId("alert-reset-error").textContent).toMatch(/invalid or has expired/i);
  });
});
```

In `artifacts/studio/src/__tests__/Login.test.tsx`, **first fix the `wouter` mock at `:6-9`** — it currently renders `<a>{children}</a>` and discards every other prop, so `data-testid` and `href` never reach the DOM and the new test below could not pass no matter how the page is written:

```tsx
vi.mock("wouter", () => ({
  useLocation: () => ["/login", mockNavigate],
  // Forward props: the forgot-password test asserts on data-testid and href,
  // and the previous mock dropped both.
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
```

Then add, inside the existing `describe("Login")`:

```tsx
  it("offers a forgot-password link pointing at /forgot-password", () => {
    render(<Login />);
    const link = screen.getByTestId("link-forgot-password");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/forgot-password");
  });
```

Use the same props-forwarding `Link` mock in `ForgotPassword.test.tsx` and `ResetPassword.test.tsx`. Neither asserts on a link today, but the lossy mock is what made this finding possible and there is no reason to plant it twice more.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter studio test -- ForgotPassword ResetPassword Login`
Expected: FAIL — the two page modules do not resolve, and `link-forgot-password` is not found.

- [ ] **Step 3: Write `ForgotPassword.tsx`**

```tsx
import { useState } from "react";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/AuthShell";
import { describeWriteError } from "@/lib/describeWriteError";

export function ForgotPassword() {
  const forgotPassword = useForgotPassword();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    forgotPassword.mutate(
      { data: { email } },
      {
        onSuccess: () => setSent(true),
        // The server answers 200 for an unknown address, so anything that
        // reaches here is a transport or rate-limit failure worth showing.
        onError: (err: unknown) =>
          setError(describeWriteError(err, "Could not send the reset email. Try again shortly.")),
      },
    );
  }

  return (
    <AuthShell tagline="Forgot your password? We'll email you a link to set a new one.">
      {sent ? (
        <div className="flex flex-col gap-3" data-testid="text-reset-sent" style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          {/* Deliberately vague: the endpoint answers identically for an
              address with no account, and a more specific UI would undo
              that. */}
          <p>If that email has an account, a reset link is on its way. The link works for one hour.</p>
          <p>Didn't get it? Check spam, then try again.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {error && (
            <Alert variant="destructive" data-testid="alert-forgot-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
          </div>
          <Button type="submit" disabled={forgotPassword.isPending} data-testid="button-request-reset" className="mt-1">
            {forgotPassword.isPending ? "Sending…" : "Email me a reset link"}
          </Button>
        </form>
      )}
      <div className="text-center mt-4" style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
        <Link href="/login" className="underline" style={{ color: "var(--link)" }}>Back to log in</Link>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 4: Write `ResetPassword.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useResetPassword, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/AuthShell";
import { describeWriteError } from "@/lib/describeWriteError";

/** The link puts the token in the fragment, which never reaches the server. */
function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "";
}

export function ResetPassword() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const resetPassword = useResetPassword();
  // Read once, on mount, before the effect below clears the hash.
  const [token] = useState(tokenFromHash);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Keep the token out of browser history and any later Referer. It lives
    // in component state from here on.
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    resetPassword.mutate(
      { data: { token, password } },
      {
        onSuccess: (data) => {
          // Same reasoning as Login.tsx's onSuccess: write the cache
          // synchronously rather than invalidating, to avoid racing Gate()'s
          // auth-gated render.
          queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), data);
          navigate("/", { replace: true });
        },
        onError: (err: unknown) =>
          setError(describeWriteError(err, "Could not set your new password. Request a fresh link.")),
      },
    );
  }

  if (!token) {
    return (
      <AuthShell tagline="Set a new password to get back into your labs.">
        <div className="flex flex-col gap-3" data-testid="text-reset-link-invalid" style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          <p>This reset link is missing its token. It may have been truncated by your email client.</p>
          <p><Link href="/forgot-password" className="underline" style={{ color: "var(--link)" }}>Request a new link</Link></p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell tagline="Set a new password to get back into your labs.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {error && (
          <Alert variant="destructive" data-testid="alert-reset-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">New password</Label>
          {/* Bounds mirror ResetPasswordRequest.password in openapi.yaml. */}
          <Input id="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-new-password" />
        </div>
        <Button type="submit" disabled={resetPassword.isPending} data-testid="button-set-password" className="mt-1">
          {resetPassword.isPending ? "Saving…" : "Set new password"}
        </Button>
      </form>
      <div className="text-center mt-4" style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
        <Link href="/login" className="underline" style={{ color: "var(--link)" }}>Back to log in</Link>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 5: Add the link to `Login.tsx`**

Replace the password block at `:51-55`:

```tsx
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            {/* One word, so the label row cannot wrap at phone width. */}
            <Link href="/forgot-password" className="underline" style={{ fontSize: "12.5px", color: "var(--link)" }} data-testid="link-forgot-password">
              Forgot?
            </Link>
          </div>
          {/* Mirrors LoginRequest.password's maxLength in openapi.yaml. */}
          <Input id="password" type="password" required maxLength={128} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" />
        </div>
```

`Link` is already imported in that file at `:2`.

- [ ] **Step 6: Register the routes in `App.tsx`**

After the `/register` route at `:61`:

```tsx
      <Route path="/forgot-password">{user ? <Redirect to="/" /> : <ForgotPassword />}</Route>
      <Route path="/reset-password">{user ? <Redirect to="/" /> : <ResetPassword />}</Route>
```

And add the imports alongside the existing `Login` / `Register` imports:

```tsx
import { ForgotPassword } from "@/pages/auth/ForgotPassword";
import { ResetPassword } from "@/pages/auth/ResetPassword";
```

- [ ] **Step 7: Widen the mutation-error guard to the new pages**

In `artifacts/studio/src/__tests__/mutationErrorSurface.test.ts`, replace the single `SRC` constant:

```ts
const SRC = resolve(__dirname, "../pages/Workspace.tsx");
```

with a list, and give each file its own non-vacuity floor:

```ts
// PWR-7: this guard read ONE file, so any new page's mutations fell outside
// it by construction — the same pattern-scoped blind spot that let
// handleSaveInputs, ImportDialog.tsx and lib/exportEntity.ts through. Adding
// a page here is cheaper than rediscovering the gap.
const SRCS: { path: string; minSites: number }[] = [
  { path: resolve(__dirname, "../pages/Workspace.tsx"), minSites: 9 },
  { path: resolve(__dirname, "../pages/auth/ForgotPassword.tsx"), minSites: 1 },
  { path: resolve(__dirname, "../pages/auth/ResetPassword.tsx"), minSites: 1 },
];
```

Then in each of the four `it(...)` blocks, wrap the existing body in `for (const { path: SRC } of SRCS) { … }`, accumulating `offenders` across all files before the single `expect(offenders).toEqual([])`. For the non-vacuity test, assert each file's own `minSites` rather than one global `>= 9`:

```ts
  it("is not vacuous — it really finds the mutate sites", () => {
    for (const { path, minSites } of SRCS) {
      const src = readFileSync(path, "utf8");
      const count = (src.match(/\.mutate(Async)?\(/g) ?? []).length;
      expect(count, path).toBeGreaterThanOrEqual(minSites);
    }
  });
```

- [ ] **Step 8: Run the frontend tests**

Run: `pnpm --filter studio test -- ForgotPassword ResetPassword Login mutationErrorSurface rawErrorMessageSurface`
Expected: PASS. If `rawErrorMessageSurface` flags either new page, fix the page to use `describeWriteError` — **do not add an allow-list entry.**

- [ ] **Step 9: Prove the widened guard actually bites**

Temporarily delete the `onError` from `ForgotPassword.tsx`'s `mutate` call and re-run `pnpm --filter studio test -- mutationErrorSurface`.
Expected: FAIL, naming `ForgotPassword.tsx`. Restore the handler and confirm green. Without this step the widening is unverified.

- [ ] **Step 10: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git commit artifacts/studio/src/pages/auth artifacts/studio/src/App.tsx artifacts/studio/src/__tests__ \
  -m "[PWR-7] add forgot/reset password pages, routes, and the login link"
```

---

### Task 8: Browser QA (qa-sdet)

**Files:**
- Create: `artifacts/studio/e2e/password-reset.spec.ts`

**This task is exempt from `ponytail` and `karpathy-guidelines`** — test code is the one place where explicitness and redundancy are the point.

**Interfaces:**
- Consumes: the testids produced by Task 7.

- [ ] **Step 1: Write the spec**

```ts
/**
 * Browser E2E — password reset (PWR).
 *
 * Covers the UI half only: the login-page entry point, the request form's
 * deliberately vague confirmation, and the no-token branch of
 * /reset-password. The token-consuming half lives in the api-server
 * integration suite — e2e does not reach a real inbox.
 *
 * Target: E2E_BASE_URL env var. Requires a local dev proxy so the browser
 * sees one origin — see artifacts/studio/e2e/CLAUDE.md.
 */
import { test, expect } from "./fixtures";

const TIMEOUT = 10_000;

test.describe("password reset (unauthenticated)", () => {
  test.use({ storageState: undefined });

  test("the login page links to the reset flow", async ({ page }) => {
    await page.goto("/login");
    const link = page.getByTestId("link-forgot-password");
    await expect(link).toBeVisible({ timeout: TIMEOUT });
    await link.click();
    await expect(page.getByTestId("input-email")).toBeVisible();
    await expect(page.getByTestId("button-request-reset")).toBeVisible();
  });

  test("requesting a reset for an address with no account shows the vague confirmation", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByTestId("input-email").fill(`e2e-pwr-${Date.now()}@example.test`);
    await page.getByTestId("button-request-reset").click();

    const sent = page.getByTestId("text-reset-sent");
    await expect(sent).toBeVisible({ timeout: TIMEOUT });
    await expect(sent).toContainText(/if that email has an account/i);
  });

  test("/reset-password with no token offers a fresh link instead of a form", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByTestId("text-reset-link-invalid")).toBeVisible({ timeout: TIMEOUT });
    await expect(page.getByTestId("input-new-password")).toHaveCount(0);
  });

  test("a token in the fragment is consumed and removed from the URL", async ({ page }) => {
    await page.goto("/reset-password#token=not-a-real-token");
    await expect(page.getByTestId("input-new-password")).toBeVisible({ timeout: TIMEOUT });
    // The page strips the fragment on mount.
    expect(new URL(page.url()).hash).toBe("");

    await page.getByTestId("input-new-password").fill("brandnewpass1");
    await page.getByTestId("button-set-password").click();
    await expect(page.getByTestId("alert-reset-error")).toContainText(/invalid or has expired/i, { timeout: TIMEOUT });
  });
});
```

- [ ] **Step 2: Start the two local servers**

Follow the two-server recipe in `artifacts/studio/e2e/CLAUDE.md`. Note the studio port it prints.

- [ ] **Step 3: Run only this spec**

Run: `E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/password-reset.spec.ts`
Expected: 4 passed. **The env var is not optional — without it the gate silently tests a remote Replit deployment instead of your local code.**

- [ ] **Step 4: Sibling-spec sweep**

This bundle changes `Login.tsx`'s password block. Confirm no existing spec depends on its old shape:

```bash
grep -rn "input-password\|button-login" artifacts/studio/e2e/*.spec.ts
```
Expected: every hit still valid — the change adds a wrapper div and a link, it removes no testid. If any spec asserts on the password label's exact DOM position, rewrite that spec now, before merge.

- [ ] **Step 5: Real-browser QA pass**

Dispatch the `qa-sdet` agent against the running local servers with this checklist, and have it report findings rather than fix them:
**The database stores only the SHA-256 hash, so there is no raw token to read out of it.** Any QA step needing a working link must *plant* a known pair instead — choose the raw token, compute its hash, and write that hash to the row:

```bash
# Pick a raw token, derive its hash, plant it with a one-hour expiry.
TOKEN="qa-$(date +%s)"
HASH=$(node -e 'console.log(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$TOKEN")
psql "postgresql://shubhamkr@localhost:5432/nos_dev" -c \
  "UPDATE users SET reset_token_hash = '$HASH', reset_token_expires_at = now() + interval '1 hour' WHERE email = '<qa-account-email>';"
echo "link: http://localhost:<studio-port>/reset-password#token=$TOKEN"
```

1. Request a reset for a **real** account that exists locally; confirm the vague message and that the row gains a `reset_token_hash` (psql). This step verifies issuance only — the token it writes is unusable by hand, which is the point.
2. Plant a known pair with the snippet above, open the printed link, set a new password, confirm you land logged in on `/`.
3. Log out, log in with the **new** password — works. With the old one — rejected.
4. Reopen the same planted link — the generic expired message (the confirm consumed it).
5. Plant a pair, then plant a second one for the same account; the first link now fails and the second works.
6. Submit the request form 11 times quickly — the 11th shows the rate-limit message, not a crash.
7. Check the browser address bar and `history.length` after step 2 — the token must not be in the URL.
8. Dark mode and phone width (390px) on all three screens.

- [ ] **Step 6: Commit**

```bash
git commit artifacts/studio/e2e/password-reset.spec.ts -m "[PWR-8] add password reset e2e spec"
```

---

### Task 9: Full gate, changelog, and branch handoff

**Files:**
- Modify: `docs/CHANGELOG-implementation.md` (append at the bottom)

- [ ] **Step 1: Check for concurrent test runs**

```bash
cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' ')
echo "concurrent vitest: $cnt"
[ "$cnt" = "0" ] || echo "WAIT — another session is running vitest; results will be unreliable"
```
Do **not** chain this with `&&` — `grep -c` exits 1 when the count is 0, so the success case is the one that short-circuits.

- [ ] **Step 2: Run the full verification gate**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" bash -c 'pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)'
```
Expected: all green. Any api-server or studio failure must be matched against CLAUDE.md's load-induced flake list by **test name** and re-run twice in isolation before being treated as a regression. A single isolated failure is inconclusive.

- [ ] **Step 3: Run the solver accuracy script**

Run: `cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py`
Expected: unchanged pass count. This bundle touches no solver code, so any change here means something is wrong.

- [ ] **Step 4: Re-gate e2e**

Run: `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`
Then read `artifacts/studio/e2e/report/results.json` and report **both** `stats.unexpected` and `stats.flaky` — the console summary folds retried failures away silently.

- [ ] **Step 5: Write the changelog entry**

Append to `docs/CHANGELOG-implementation.md`, most recent last. Include: the task list PWR-1…PWR-9 with commit SHAs, the pre-flight production row count from the top of this plan, the gate numbers, the two accepted risks, and the three environment variables production still needs. Keep durable lessons out of the entry body and lift only distilled rules into `CLAUDE.md`'s Gotchas — the entry itself is the record.

- [ ] **Step 6: Commit**

```bash
git commit docs/CHANGELOG-implementation.md -m "[PWR-9] record the password reset bundle"
```

- [ ] **Step 7: Invoke `superpowers:finishing-a-development-branch`**

Implementation is complete and the gates are green, which is exactly when this runs — not after the merge.

- [ ] **Step 8: STOP and ask for merge approval**

Do not merge. Report what landed, the gate numbers, and that production still needs `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_BASE_URL`. Merge, push, and deploy are **three separate approvals** — and note for the user that a push to `main` is deploy-adjacent, since `nos-studio` can ship on a push.

- [ ] **Step 9: After merge and whole-branch review, run `/harness-retro PWR`**

A branch is not finished until this has run.

---

## Deferred, deliberately

- **Session revocation on reset** — accepted risk, reasoning in the design doc.
- **A `_dmarc` record** for `app.networkdesignbook.com`.
- **Authenticated change-password** and **instructor-initiated reset**.
- **Shared-storage rate limiting** — needed only if `nos-api` is scaled past one instance.
- **A Mailosaur end-to-end mail assertion** — the transport is unit-tested with a stubbed `fetch`; a real-inbox check belongs outside `e2e:gate`.
