# WQF Part B — Terms Consent, One-Time Log-Out, Account Deletion — Implementation Plan

> **Execution:** this repo executes plans by **agent-team dispatch per `AGENTS.md`**, not `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> - **Worktrees:** the lead pre-creates one locked worktree per task: `git worktree add --lock /Users/shubhamkr/nos-wqfb-N -b wqfb-N-work <wqf-b tip>`, and dispatches **without** `isolation` (root `CLAUDE.md` Gotchas: `isolation: "worktree"` is racy). Each agent's **first** Bash command is `cd /Users/shubhamkr/nos-wqfb-N && git rev-parse --abbrev-ref HEAD`, which must print `wqfb-N-work`; anything else means STOP and report. Base guard before work: `git merge-base --is-ancestor <wqf-b tip given in the prompt> HEAD || { echo "BASE MISMATCH"; exit 1; }`. The lead cherry-picks each task's commit onto the bundle branch `wqf-b` and re-gates.
> - **Bundle branch:** `wqf-b` is created from the `watbot-qf-spec` commit that carries this plan, so the spec and this plan travel with Part B. Parts A and C branch from the same commits, so those identical commits merge cleanly.
> - **Order:** tasks run sequentially in listed order (B2 may run in parallel with B1: no shared files). Every task's commit is green on its own.
> - **Roles and review (AGENTS.md):** `backend-engineer` (B1, B4, B5, B6), `frontend-engineer` (B2, B3, B7, B9), and `qa-sdet` (B8). Every engineering task **starts by invoking the `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` skills (hard rule #12)**, before reading or writing code. Engineering tasks are reviewed by the lead on Opus with `ponytail:ponytail-review`. B8 is reviewed by a separate `fable`-model reviewer agent. qa-sdet is exempt from both skills; if it receives an injected ponytail ruleset anyway, it ignores it and says so in its report.
> - **No work in `/Users/shubhamkr/network-optimization-studio`** (the shared checkout other sessions use). **Never delegate to GLM** (hard rule #10).
> - **Background docs to cite in each dispatch (AGENTS.md rule 7):** this plan's task; the spec `docs/superpowers/specs/2026-11-25-watbot-qf-bundle-design.md` Part B; `docs/CHANGELOG-implementation.md` (grep `PWR`, `SEC-2`, `HND-A`, `COSM-4`); `docs/ops/schema-push-before-deploy.md` (B4, B12); `artifacts/api-server/CLAUDE.md` (drizzle error leak, login rate limiter); `artifacts/studio/CLAUDE.md` (single `<Switch>`, `describeWriteError`, jsdom cannot see CSS); `artifacts/studio/e2e/CLAUDE.md` (local two-server recipe, `E2E_BASE_URL`, bounded `{ timeout }`).

**Goal:** Students must tick one "I agree to the Terms of Service and the Privacy Notice" box to register or log in. The acceptance is recorded per user. Every existing session is signed out once, at the deploy. Students can delete their own account and the app's data about them from the home page.

**Architecture:** Two nullable columns on `users` (`terms_version`, `terms_accepted_at`) and one server constant `CURRENT_TERMS_VERSION`. Register and log-in record acceptance. `sessionUser` treats a user whose stored version is not current as signed out; that one comparison produces both the one-time log-out and every future re-acceptance. Reset-password sets the cookie only for a current user. `DELETE /api/auth/account` runs one locked transaction scoped to the caller's id. The studio gains one shared consent checkbox, two public legal pages in the single `<Switch>`, and footer links with a password-confirmed delete dialog.

**Tech Stack:** Express + drizzle-orm 0.45 + Postgres (`drizzle-kit push`), argon2, OpenAPI 3 + Orval (zod + React Query), React + Vite + wouter 3 + Radix (`Checkbox`, `Dialog`), vitest + supertest + RTL, Playwright.

## Global Constraints

Copied from the spec (Part B) and the repo's hard rules. Every task implicitly includes all of these.

- **Checkbox text, verbatim:** `I agree to the Terms of Service and the Privacy Notice (FERPA, GDPR)`. Each name links to its page in a **new tab**. The box is **unticked by default**, and the submit button **stays disabled until it is ticked**. It appears on Log in and Register only; Forgot-password is unchanged.
- **Columns:** `users.terms_version text` and `users.terms_accepted_at timestamptz`, **both nullable, no backfill** (hard rule #3). Every timestamp is `{ withTimezone: true }` (`lib/db/CLAUDE.md`).
- **`CURRENT_TERMS_VERSION`** is a server constant in the format `YYYY-MM-DD`: the date the owner approves the terms text. It is provisional (`2026-11-25`) until Task B9 sets the approval date.
- **Log-in refusal, verbatim:** status 403 with body `{ "error": "terms_required" }` and **no cookie**, when the stored version is not current and `acceptTerms` is not `true`. The password is checked first.
- **Reset-password:** sets the cookie only when the user's accepted version is current. Otherwise it succeeds without a cookie. **The response contract is unchanged** (`AuthUserEnvelope`).
- **Deletion:** `DELETE /api/auth/account` requires auth and the current password. It runs in **one transaction, in this order:** lock the user's row (`SELECT … FOR UPDATE`); refuse with **409** if any of the user's solve jobs is `queued` or `running`; delete the user's `solve_jobs`, then `scenarios`, then the `users` row. `watbot_*` rows go by their existing `ON DELETE CASCADE`. The cookie is cleared. **`result_cache` and `feedback` are never touched, and `feedback` must never gain a user column** (`schema/feedback.ts:3-7`).
- **Footer:** the home-page footer (`AppShell.tsx:114`, `homepage-credit-footer`) gains `Terms · Privacy · Delete my account`, kept away from the header's Log out buttons (`AppShell.tsx:82,97`).
- **Legal pages:** public routes `/terms` and `/privacy` in the **single `<Switch>`** of `App.tsx` (studio `CLAUDE.md`). They show a visible **"Draft — pending review"** banner until Task B9. **Part B does not deploy before the owner confirms a qualified review** (spec B1).
- **Deploy order (B6):** (1) production schema push, (2) nos-studio, (3) nos-api, each with its own owner approval. The approval request states that **every signed-in user will be logged out**.
- **Hard rule #1:** `openapi.yaml` edit + `pnpm --filter @workspace/api-spec run codegen` (config `lib/api-spec/orval.config.ts`) + the regenerated `lib/api-zod/src/generated/**` and `lib/api-client-react/src/generated/**` go in **one commit**. Never hand-edit generated files.
- **A closed-union error code is one change in three places:** the OpenAPI enum (`TermsRequiredError`), the regenerated types, and the server's typed literal (`const body: TermsRequiredError = { error: "terms_required" }`). That is one task (B4).
- **Drizzle error leak (`artifacts/api-server/CLAUDE.md`):** every new `try` around a drizzle call that carries user data ends in `catch {` **with no error binding**, then logs a fixed `{ step }` and answers the route's own sentence.
- **Rule #5:** ownership is the caller's own id. Deletion is scoped by `req.userId` and never takes a user id from the request.
- **Root gotcha (destructive helpers):** `deleteAccountData(userId)` deletes only rows of the id it is given. Its tests pass **only their own fixture ids**, and cleanup is scoped by collected ids. No test calls anything unscoped.
- **Commit:** one task = one commit, message `[WQF-B<n>] <imperative summary>`, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Guard first: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`. Stage an explicit path list `P`, check that `git diff --cached --name-only` equals `P`, then `git commit --only ${=P} -m "…"`. Never pipe a state-changing git command.
- **Changelog:** every commit appends `### WQF-B<n> — <title>` to `docs/CHANGELOG-implementation.md` under the `## WQF-B — Terms consent, one-time log-out, account deletion` heading (created by B1). The entry records what landed, the tests, the **measured** gate counts (never estimated; an underivable value is `unknown`), and any deviation. No history goes into any `CLAUDE.md` (hard rule #9).
- **Per-task gate** (no concurrent vitest; never `pkill`):
  ```bash
  cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ] || { echo "concurrent vitest: $cnt — wait"; exit 1; }
  pnpm run typecheck
  DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
  pnpm --filter studio test
  pnpm --filter studio run typecheck:e2e
  ```
  A failure is checked against `docs/superpowers/flake-registry.md` by test **name**, and the failing file is re-run twice in isolation before anything is concluded.
- **Local DB only:** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline per command. **Never** a production connection string in any task except B12, and there only by the owner. `nos_dev` is shared with other sessions. After B4's push, a `drizzle-kit push` that another session runs from an older `main` would try to drop the two columns. Tell other sessions when B4 lands, and re-run B4's push if `\d users` no longer shows them.
- **Public repo (PRIV-1):** no production ids, user emails, IP addresses or credentials in any commit or doc. The one exception is the owner-supplied public contact address, which appears on the Privacy Notice by design. Test emails use `@example.test` (api-server) or the `e2e-…@test.com` shape that `scripts/src/purge-test-users.ts` already collects.

## Decisions (spec ambiguities resolved by this plan)

| ID | Decision | Task |
|---|---|---|
| D1 | `acceptTerms` is an **optional** boolean in both `RegisterRequest` and `LoginRequest`. The server owns the refusal: register answers its own 400 sentence when it is not `true`, and log-in answers `terms_required`. Making it `required` would turn a missing box into the generic "email and password are required" message. | B1, B4 |
| D2 | Log-in **writes acceptance only when the stored version is not current**. `terms_accepted_at` is therefore the time the user first accepted *that* version, and a normal log-in does not write the users row. | B4 |
| D3 | `terms_accepted_at` is written DB-side (`sql\`now()\``) on both writers (register insert, log-in update), so the column never has mixed writers (`lib/db/CLAUDE.md` trap 3). | B4 |
| D4 | After a reset, the studio asks `GET /auth/user` who is signed in (`queryClient.fetchQuery`) and goes to `/` or to `/login?reset=done`. It does this because the body is identical either way. Log in shows "Your password was changed. Log in to continue." for `reset=done`. | B5 |
| D5 | `terms_required` is unreachable from the new studio, because the button is disabled until the box is ticked and the studio always sends `true`. The studio does not special-case it. The browser test of that path ages a real user's row through `psql` (D13). | B3, B8 |
| D6 | The legal pages are standalone, outside `AppShell`, and the same for signed-in and signed-out visitors. Form links open a new tab (plain `<a target="_blank">`, so wouter's click handler cannot swallow it). Footer links use the same tab. | B2, B7 |
| D7 | The pages show the version date from a studio mirror (`TERMS_VERSION`). `termsVersionDrift.test.ts` fails if it differs from the server constant (the `lockedChapterDrift.test.ts` pattern). | B2 |
| D8 | A wrong password on delete answers **403** "That password is not correct." It is not 401, so it cannot read as "signed out". Delete shares log-in's per-IP limiter (20/min), because a stolen cookie must not become an unlimited password oracle. | B6 |
| D9 | The FK-race test uses a **deterministic stand-in**: a solve job owned by another user that points at the victim's scenario. It makes the scenario delete fail on the same `solve_jobs.scenario_id` foreign key that a late job would hit, and proves the whole transaction rolls back. The live race cannot be scheduled deterministically. `enqueueScenarioSolve` takes `FOR NO KEY UPDATE` on the users row (`jobRunner.ts:390`), and any `solve_jobs` insert takes `FOR KEY SHARE` on it through its FK. Both conflict with the delete's `FOR UPDATE`, so a concurrent enqueue either waits and then fails its own FK, or Postgres aborts one side as a deadlock. Both outcomes are covered by this rollback path. | B6 |
| D10 | Delete sends **no** PostHog event, because a `distinctId` capture would recreate the person the user just deleted. | B6 |
| D11 | A "user already gone" outcome inside the transaction (a double-click race) answers 204 and clears the cookie. | B6 |
| D12 | Pipeline order follows root `CLAUDE.md` (the governing rule): gates → `finishing-a-development-branch` → **merge approval** → local merge → whole-branch review **on the merged state** → `/harness-retro WQF-B` → push. The brief listed review before finishing; the repo rule wins. | B10–B11 |
| D13 | e2e reaches the database only through `psql` with psql-bound variables (`e2e/helpers/termsDb.ts`). The studio gains no DB driver, the same reasoning as `global.teardown.ts`. Those tests `test.skip` without `DATABASE_URL`, and the e2e gate step requires **0 skipped** in `terms-consent.spec.ts`. | B8 |
| D14 | The production schema push happens **before** the push to `origin/main`, because a push can arm a deploy of either service (root `CLAUDE.md`, Branch discipline). | B12 |

## Owner inputs (the lead obtains these; tasks block on them)

1. **Privacy contact address** (public, shown on the Privacy Notice). **Needed before B2 is dispatched**: the lead passes it in B2's prompt.
2. **Legal review confirmation** and **the approval date**, which becomes `CURRENT_TERMS_VERSION` and `TERMS_VERSION`, plus any reviewer text edits. **Needed for B9.** B9 is before the merge request, so the branch waits there.
3. **Approvals:** merge (B11), push (B12), production schema push (B12, run or approved by the owner), nos-studio deploy and nos-api deploy (B12, separately).

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `lib/api-spec/openapi.yaml` | `acceptTerms` on both auth requests; login 403 + `TermsRequiredError`; register 400; reset description; `/auth/account` + `DeleteAccountRequest` | B1, B4, B5, B6 |
| `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**` | regenerated only | B1, B4, B5, B6 |
| `lib/db/src/schema/auth.ts` | two nullable columns | B4 |
| `artifacts/api-server/src/lib/terms.ts` (new) | `CURRENT_TERMS_VERSION` | B2 |
| `artifacts/api-server/src/routes/auth.ts` | register/login enforcement; reset cookie gate; `clearSessionCookie`; `DELETE /auth/account` | B4, B5, B6 |
| `artifacts/api-server/src/middlewares/auth.ts` | `sessionUser` version check | B5 |
| `artifacts/api-server/src/services/deleteAccount.ts` (new) | `deleteAccountData(userId)` transaction | B6 |
| `artifacts/studio/src/pages/legal/{legalMeta.ts,legalText.ts,LegalPage.tsx}` (new) | version/contact/draft flag; both documents' text; the page | B2, B9 |
| `artifacts/studio/src/components/auth/TermsConsent.tsx` (new) | the one checkbox, used by both forms | B3 |
| `artifacts/studio/src/pages/auth/{Login,Register,ResetPassword}.tsx` | consent; reset landing | B3, B5 |
| `artifacts/studio/src/components/{AccountLinks,DeleteAccountDialog}.tsx` (new) | footer links; delete dialog | B7 |
| `artifacts/studio/src/{App.tsx,components/AppShell.tsx}` | two routes; footer mount | B2, B7 |
| `artifacts/studio/e2e/{terms-consent.spec.ts,helpers/termsDb.ts}` (new) | real-browser coverage | B8 |

---

### Task B1: `acceptTerms` in the auth contract, sent by every programmatic caller

**Role:** backend-engineer. **Commit:** `[WQF-B1] add acceptTerms to the auth contract and send it from every caller`. This task hands the e2e specs' **API** register calls and the scripts to backend-engineer, because these are mechanical contract edits. UI-login spec rewrites belong to B8.

Why this comes first: the server starts refusing a missing `acceptTerms` in B4. Every caller (tests, e2e specs, scripts, the deploy smoke check, `e2e_journey.py`) adopts the field here while the server still ignores it. As a result, each commit stays green.

**Files:**
- Modify: `lib/api-spec/openapi.yaml:1527-1564` (`RegisterRequest`, `LoginRequest`), plus regenerated `lib/api-zod/src/generated/**` and `lib/api-client-react/src/generated/**`
- Create: `artifacts/api-server/src/__tests__/termsContract.test.ts`
- Modify (add `acceptTerms: true` to every register/login body): every `artifacts/api-server/src/**/*.test.ts` that posts to `/api/auth/register` or `/api/auth/login` (29 files, listed by Step 5's grep); `artifacts/studio/e2e/*.spec.ts` API register calls (38 specs, listed by Step 6's grep; `labs.spec.ts` is excluded from every lane and is left alone); `artifacts/studio/e2e/scripts/capture-solved-results.ts:46`; `artifacts/api-server/src/migrations/watbotTestSet.ts:39`; `artifacts/api-server/src/solver/tests/e2e_journey.py:202,217,221,236,240,778`; `scripts/measurement/seed-cohort.mjs:99,104`; `scripts/measurement/prepare-cache.mjs:60,62`; `scripts/measurement/solve-burst.mjs:33,35`; `scripts/src/deploy/checks/cookieAttributes.ts:21`
- Modify: `docs/CHANGELOG-implementation.md` (append the `## WQF-B` heading + `### WQF-B1`)

**Interfaces:**
- Produces: `RegisterRequest.acceptTerms?: boolean` and `LoginRequest.acceptTerms?: boolean` in the generated TS types; `RegisterUserBody` and `LoginUserBody` zod schemas that keep `acceptTerms` instead of stripping it.

- [ ] **Step 1: Invoke skills.** `Skill andrej-karpathy-skills:karpathy-guidelines`, then `Skill ponytail:ponytail`.

- [ ] **Step 2: Write the failing contract test** at `artifacts/api-server/src/__tests__/termsContract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RegisterUserBody, LoginUserBody } from "@workspace/api-zod";

// WQF-B1 — acceptTerms is part of the auth contract. Before the OpenAPI change
// zod's default object mode silently STRIPS the key, so the server would never
// see the student's tick: the toEqual below is what catches that.
describe("WQF-B1 — acceptTerms in the auth request schemas", () => {
  it("RegisterUserBody keeps acceptTerms", () => {
    const body = { email: "a@example.test", password: "correcthorse1", acceptTerms: true };
    expect(RegisterUserBody.parse(body)).toEqual(body);
  });

  it("LoginUserBody keeps acceptTerms", () => {
    const body = { email: "a@example.test", password: "correcthorse1", acceptTerms: true };
    expect(LoginUserBody.parse(body)).toEqual(body);
  });

  it("acceptTerms must be a boolean, not a truthy string", () => {
    expect(RegisterUserBody.safeParse({ email: "a@example.test", password: "correcthorse1", acceptTerms: "true" }).success).toBe(false);
    expect(LoginUserBody.safeParse({ email: "a@example.test", password: "correcthorse1", acceptTerms: "true" }).success).toBe(false);
  });

  it("stays optional (the server, not the validator, owns the refusal — D1)", () => {
    expect(RegisterUserBody.safeParse({ email: "a@example.test", password: "correcthorse1" }).success).toBe(true);
    expect(LoginUserBody.safeParse({ email: "a@example.test", password: "x" }).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and watch it fail.**
  Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/termsContract.test.ts`
  Expected: FAIL. The first two tests fail with `expected { email, password } to deeply equal { …, acceptTerms: true }`, and the third fails because the stripped key parses.

- [ ] **Step 4: Edit the contract and regenerate.** In `lib/api-spec/openapi.yaml`, append to `RegisterRequest.properties` (after `password`, line ~1545):

```yaml
        acceptTerms:
          type: boolean
          description: >-
            Whether the student ticked "I agree to the Terms of Service and the
            Privacy Notice". Optional in the schema so the server, not the
            validator, owns the refusal sentence.
```

  Append the same property to `LoginRequest.properties` (after `password`, line ~1564), with this description: `Whether the student ticked the terms box on the log-in form.` Then run:
  ```bash
  pnpm --filter @workspace/api-spec run codegen
  ```
  Expected: Orval writes both packages, and `typecheck:libs` passes. `git diff --stat lib/` shows `openapi.yaml` plus generated files only.

- [ ] **Step 5: Add `acceptTerms: true` to every api-server test call.**
  ```bash
  cd /Users/shubhamkr/nos-wqfb-1
  FILES=$(grep -rlE '/api/auth/(register|login)"' artifacts/api-server/src --include='*.test.ts')
  perl -0pi -e 's{(/api/auth/(?:register|login)"\)\s*\.send\(\{)([^{}]*?)(\s*\}\))}{$1$2, acceptTerms: true$3}g' ${=FILES}
  grep -rnE -A2 '/api/auth/(register|login)"' artifacts/api-server/src --include='*.test.ts' | grep -E '\.send\(\{' | grep -v acceptTerms
  ```
  Expected: the last grep prints nothing. Then look for helper calls that build the request in one place and send in another (e.g. `return r.send({ email, password: "wrong-password-123" });`):
  ```bash
  grep -rnE '\b[a-z]\.send\(\{ ?email' artifacts/api-server/src --include='*.test.ts' | grep -v acceptTerms
  ```
  Add `, acceptTerms: true` by hand to each hit that posts to register or log-in. The server ignores the field until B4, so this changes no test outcome.

- [ ] **Step 6: Add it to every e2e spec's API register call.**
  ```bash
  SPECS=$(grep -lE '/api/auth/(register|login)"' artifacts/studio/e2e/*.spec.ts | grep -v '/labs.spec.ts')
  perl -0pi -e 's{(/api/auth/(?:register|login)",\s*\{\s*data:\s*\{)([^{}]*?)(\s*\})}{$1$2, acceptTerms: true$3}g' ${=SPECS}
  grep -nE -A2 '/api/auth/(register|login)"' ${=SPECS} | grep -E 'data:' | grep -v acceptTerms
  ```
  Expected: the last grep prints nothing.

- [ ] **Step 7: Hand-edit the remaining callers** (each body gains `acceptTerms: true`, or `"acceptTerms": True` in Python):
  - `artifacts/studio/e2e/scripts/capture-solved-results.ts:46`: `{ email, password: "correcthorse1", acceptTerms: true }`
  - `artifacts/api-server/src/migrations/watbotTestSet.ts:39`: `JSON.stringify({ email, password: randomUUID(), acceptTerms: true })`
  - `artifacts/api-server/src/solver/tests/e2e_journey.py:202,217,221,236,240,778`: add `"acceptTerms": True` to each dict
  - `scripts/measurement/seed-cohort.mjs:99,104`, `prepare-cache.mjs:60,62`, `solve-burst.mjs:33,35`: `{ …, acceptTerms: true }`
  - `scripts/src/deploy/checks/cookieAttributes.ts:21`: `body: JSON.stringify({ email, password: "smoke-password-123", acceptTerms: true }),`

  Verify:
  ```bash
  python3 -m py_compile artifacts/api-server/src/solver/tests/e2e_journey.py && echo PY-OK
  grep -cE '"acceptTerms": True' artifacts/api-server/src/solver/tests/e2e_journey.py
  ```
  Expected: `PY-OK` and a count of `6`.

- [ ] **Step 8: Run the contract test again.** It must PASS, 4/4.

- [ ] **Step 9: Per-task gate** (Global Constraints). Expected: typecheck clean; api-server, studio and e2e typecheck all green with counts equal to the pre-task baseline plus 4 new tests.

- [ ] **Step 10: Changelog.** Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
## WQF-B — Terms consent, one-time log-out, account deletion (2026-11-25)

Branch `wqf-b`. Spec: `docs/superpowers/specs/2026-11-25-watbot-qf-bundle-design.md` Part B. Plan: `docs/superpowers/plans/2026-11-25-wqf-b-terms-consent.md`.

### WQF-B1 — acceptTerms in the auth contract
- `RegisterRequest`/`LoginRequest` gain optional `acceptTerms` (D1); codegen regenerated. The server ignores it until WQF-B4.
- Every programmatic caller now sends `acceptTerms: true`: api-server tests (<n> files), e2e API register calls (<n> specs), `e2e_journey.py`, `watbotTestSet.ts`, `capture-solved-results.ts`, the three measurement scripts, and the deploy smoke's `cookie_attributes` check.
- Test: `termsContract.test.ts` (4), red before codegen (key stripped).
- Gate: <measured counts>.
```
  Replace each `<n>`/`<measured counts>` with the number this task measured.

- [ ] **Step 11: Commit** with path list `P` = `lib/api-spec/openapi.yaml`, the `lib/api-zod/src/generated` and `lib/api-client-react/src/generated` changes, the new test, every edited caller, and the changelog. Use the guard and `git commit --only ${=P} -m "[WQF-B1] add acceptTerms to the auth contract and send it from every caller"` with the attribution line.

---

### Task B2: Terms of Service and Privacy Notice pages (draft)

**Role:** frontend-engineer. The 7-line server constant file is handed to this task. **Commit:** `[WQF-B2] add the draft Terms of Service and Privacy Notice pages`.

**Blocked until the lead has the owner's contact address** (Owner input 1). It arrives in the dispatch prompt.

**Files:**
- Create: `artifacts/api-server/src/lib/terms.ts`
- Create: `artifacts/studio/src/pages/legal/legalMeta.ts`, `artifacts/studio/src/pages/legal/legalText.ts`, `artifacts/studio/src/pages/legal/LegalPage.tsx`
- Create: `artifacts/studio/src/__tests__/LegalPage.test.tsx`, `artifacts/studio/src/__tests__/termsVersionDrift.test.ts`
- Modify: `artifacts/studio/src/App.tsx:61-64` (two routes), `artifacts/studio/src/__tests__/App.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces (server): `export const CURRENT_TERMS_VERSION: string` from `artifacts/api-server/src/lib/terms.ts`.
- Produces (studio): `TERMS_VERSION: string`, `PRIVACY_CONTACT_EMAIL: string` and `LEGAL_DRAFT: boolean` from `@/pages/legal/legalMeta` (no `import.meta.env`, so e2e can import it); `TERMS_OF_SERVICE: LegalDoc` and `PRIVACY_NOTICE: LegalDoc` from `@/pages/legal/legalText`; `LegalPage({ doc }: { doc: LegalDoc })` from `@/pages/legal/LegalPage`. Test ids: `page-terms`, `page-privacy`, `legal-draft-banner`, `legal-version`, `link-legal-contact`.

- [ ] **Step 1: Invoke skills.** `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 2: Write the failing tests.** Create `artifacts/studio/src/__tests__/termsVersionDrift.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TERMS_VERSION, PRIVACY_CONTACT_EMAIL } from "@/pages/legal/legalMeta";

// WQF-B — the terms version is declared twice by necessity: the server's
// CURRENT_TERMS_VERSION decides who holds a session; the studio's TERMS_VERSION
// is only the date printed on the pages. Two declarations of one fact drift;
// this fails the moment they do (same pattern as lockedChapterDrift.test.ts).
const HERE = dirname(fileURLToPath(import.meta.url));
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repo root (pnpm-workspace.yaml) not found above " + start);
}
const SERVER_FILE = join(findRepoRoot(HERE), "artifacts/api-server/src/lib/terms.ts");

describe("terms version drift", () => {
  it("the studio's TERMS_VERSION equals the server's CURRENT_TERMS_VERSION", () => {
    const m = readFileSync(SERVER_FILE, "utf8").match(/export const CURRENT_TERMS_VERSION = "([^"]+)";/);
    expect(m, "CURRENT_TERMS_VERSION not found in artifacts/api-server/src/lib/terms.ts").not.toBeNull();
    expect(TERMS_VERSION).toBe(m![1]);
  });

  it("is a YYYY-MM-DD date", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the contact address is a real, owner-supplied address", () => {
    expect(PRIVACY_CONTACT_EMAIL).toMatch(/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i);
    expect(PRIVACY_CONTACT_EMAIL).not.toMatch(/example\.|\.test$|owner|placeholder/i);
  });
});
```

  Create `artifacts/studio/src/__tests__/LegalPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { LegalPage } from "@/pages/legal/LegalPage";
import { TERMS_OF_SERVICE, PRIVACY_NOTICE } from "@/pages/legal/legalText";
import { LEGAL_DRAFT, PRIVACY_CONTACT_EMAIL, TERMS_VERSION } from "@/pages/legal/legalMeta";

describe("LegalPage", () => {
  it("renders the Terms of Service with its version and the contact link", () => {
    render(<LegalPage doc={TERMS_OF_SERVICE} />);
    expect(screen.getByTestId("page-terms")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Terms of Service");
    expect(screen.getByTestId("legal-version")).toHaveTextContent(TERMS_VERSION);
    expect(screen.getByTestId("link-legal-contact")).toHaveAttribute("href", `mailto:${PRIVACY_CONTACT_EMAIL}`);
  });

  it("shows the draft banner while the text is pending review", () => {
    expect(LEGAL_DRAFT).toBe(true); // B9 deletes the flag and flips this test
    render(<LegalPage doc={PRIVACY_NOTICE} />);
    expect(screen.getByTestId("legal-draft-banner")).toHaveTextContent("Draft — pending review");
  });

  it("the Privacy Notice names every outside service that receives student data (spec B1)", () => {
    render(<LegalPage doc={PRIVACY_NOTICE} />);
    const text = screen.getByTestId("page-privacy").textContent ?? "";
    for (const service of ["Anthropic", "PostHog", "Sentry", "Resend", "OpenRouteService", "Render"]) {
      expect(text, service).toContain(service);
    }
  });

  it("the Privacy Notice covers storage, rights, FERPA and anonymous feedback (spec B1, B5)", () => {
    render(<LegalPage doc={PRIVACY_NOTICE} />);
    const text = screen.getByTestId("page-privacy").textContent ?? "";
    for (const phrase of ["password", "scenarios", "WatBot", "which version you accepted", "Delete my account", "FERPA", "cannot be traced back to you", "backups", "GDPR"]) {
      expect(text, phrase).toContain(phrase);
    }
  });
});
```

  Append to `artifacts/studio/src/__tests__/App.test.tsx`. Add this mock at the top with the other page mocks (`App.test.tsx:12-17`):

```tsx
vi.mock("@/pages/legal/LegalPage", () => ({ LegalPage: ({ doc }: { doc: { slug: string } }) => <div>LegalPage:{doc.slug}</div> }));
```

  Then add this block (reuse the file's existing render helper for a path and an auth state; it is the function around `App.test.tsx:36` that builds `memoryLocation({ path })`; call it the same way the "shows Login at /login when unauthenticated" case does):

```tsx
describe("Gate routing — WQF-B public legal pages", () => {
  for (const [path, slug] of [["/terms", "terms"], ["/privacy", "privacy"]] as const) {
    it(`shows ${path} when unauthenticated`, () => {
      renderAt(path, null);
      expect(screen.getByText(`LegalPage:${slug}`)).toBeInTheDocument();
    });
    it(`shows ${path} when authenticated (no redirect away)`, () => {
      renderAt(path, { id: "u1", email: "s@example.test", role: "student" });
      expect(screen.getByText(`LegalPage:${slug}`)).toBeInTheDocument();
    });
  }
});
```
  (`renderAt(path, user)` stands for the file's existing helper. Use its real name and signature as found at `App.test.tsx:34-45`.)

- [ ] **Step 3: Run the tests and watch them fail.**
  Run: `pnpm --filter studio exec vitest run src/__tests__/termsVersionDrift.test.ts src/__tests__/LegalPage.test.tsx src/__tests__/App.test.tsx`
  Expected: FAIL with `Failed to resolve import "@/pages/legal/legalMeta"`, and the App cases render NotFound or a redirect.

- [ ] **Step 4: Create the server constant** `artifacts/api-server/src/lib/terms.ts`:

```ts
// WQF-B (spec B3/B4) — the Terms of Service + Privacy Notice version a user must
// have accepted to hold a session. Bumping it signs EVERY user out once and makes
// each accept again at their next log-in — that is the mechanism, not a side
// effect. Format YYYY-MM-DD: the date the owner approved the text.
// Mirrored for display by artifacts/studio/src/pages/legal/legalMeta.ts
// (TERMS_VERSION); the studio's termsVersionDrift.test.ts keeps the two equal.
export const CURRENT_TERMS_VERSION = "2026-11-25";
```

- [ ] **Step 5: Create** `artifacts/studio/src/pages/legal/legalMeta.ts`. No `import.meta.env` here, because e2e imports this file (`tsconfig.e2e.json` has no `vite/client` types).

```ts
// WQF-B — display mirror of the server's CURRENT_TERMS_VERSION
// (artifacts/api-server/src/lib/terms.ts). termsVersionDrift.test.ts fails if
// the two differ. Provisional until WQF-B9 sets the owner's approval date.
export const TERMS_VERSION = "2026-11-25";

// Owner-supplied (spec B1). Published on the Privacy Notice by design.
export const PRIVACY_CONTACT_EMAIL = "OWNER_ADDRESS_FROM_DISPATCH_PROMPT";

// True until a qualified person has reviewed the text (spec B1). WQF-B9
// deletes this flag and the banner it drives; Part B does not deploy before.
export const LEGAL_DRAFT = true;
```
  Replace `OWNER_ADDRESS_FROM_DISPATCH_PROMPT` with the exact address the lead gave. The drift test's third case fails until that is done, which is intended.

- [ ] **Step 6: Create the text** `artifacts/studio/src/pages/legal/legalText.ts`. This is the full draft. It is grounded in what the app stores (`lib/db/src/schema/*`) and sends (`lib/email.ts`, `services/orsClient.ts`, `lib/analytics.ts`, `lib/errorTracking.ts`, server PostHog `$set` of email in `routes/auth.ts:153-160`):

```ts
export interface LegalSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalDoc {
  slug: "terms" | "privacy";
  title: string;
  intro: string;
  sections: LegalSection[];
}

export const TERMS_OF_SERVICE: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  intro:
    "These terms cover your use of Optimization Studio (\"the app\"), a teaching tool built around the textbook Supply Chain Network Design. You are using it because your instructor or institution chose it for your course. By ticking the box when you register or log in, you agree to these terms and to the Privacy Notice.",
  sections: [
    {
      heading: "Your account",
      paragraphs: [
        "Use your own email address and keep your password to yourself. One account is for one person.",
        "You are responsible for what happens under your account. If you think someone else has used it, reset your password from the log-in page.",
      ],
    },
    {
      heading: "Using the app",
      paragraphs: ["Use the app for learning: building scenarios, solving them and comparing the results for your course."],
      bullets: [
        "Do not try to reach another person's account or data.",
        "Do not overload, probe or attack the app, or run automated scripts against it.",
        "Do not upload anything unlawful, or anything you do not have the right to share.",
        "Follow your instructor's rules on how the app and WatBot may be used in graded work.",
      ],
    },
    {
      heading: "WatBot",
      paragraphs: [
        "WatBot is an AI tutor. It answers from the course's sources, but its answers can still be wrong or incomplete. Check important points against the textbook and with your instructor.",
        "Your questions, the context sent with them and WatBot's answers are processed by Anthropic to produce the answers, and are stored with your account. The Privacy Notice explains this.",
      ],
    },
    {
      heading: "Your work",
      paragraphs: [
        "Scenarios you create stay yours. You allow us to store and process them only to run the app for you.",
        "Results come from a real optimization solver run on teaching data. They are for learning, and they are not advice for real business decisions.",
      ],
    },
    {
      heading: "Availability and changes",
      paragraphs: [
        "The app is provided as it is, for teaching. It may change, be unavailable at times, or be withdrawn. We may suspend an account that breaks these terms.",
      ],
    },
    {
      heading: "Limits on our responsibility",
      paragraphs: [
        "To the extent the law allows, we are not responsible for indirect losses, or for decisions made using the app's results. Nothing in these terms limits rights you have under the law that cannot be limited.",
      ],
    },
    {
      heading: "Ending your use",
      paragraphs: [
        "You can stop at any time. You can delete your account yourself from the home page with \"Delete my account\". The Privacy Notice says what that removes.",
      ],
    },
    {
      heading: "Changes to these terms",
      paragraphs: [
        "If these terms change, the version date at the top changes and you will be asked to accept the new version the next time you log in.",
      ],
    },
  ],
};

export const PRIVACY_NOTICE: LegalDoc = {
  slug: "privacy",
  title: "Privacy Notice",
  intro:
    "This notice explains what Optimization Studio (\"the app\") stores about you, which outside services receive it, and how to use your rights. The app is used on behalf of your instructor or institution as part of your course.",
  sections: [
    {
      heading: "What the app stores",
      paragraphs: [
        "Site feedback you send with the feedback button is stored without your account, your session or your IP address. It is anonymous: it cannot be traced back to you, so it cannot be found or removed per account.",
        "Your IP address is used briefly, in memory, to limit repeated log-in and reset attempts. It is not stored in the app's database, but our hosting provider's request logs may record it.",
      ],
      bullets: [
        "Your account: your email address, your password stored only as a one-way hash (we cannot read it), your role, and when the account was created and last changed.",
        "Your acceptance of these terms: which version you accepted and when.",
        "Your work: the scenarios you create, their inputs and results, and the history of your solves.",
        "WatBot: your questions, the context sent with them (such as the open tab and a summary of the selected scenario), WatBot's answers, and any rating or report you give an answer.",
        "Password reset: a hashed one-time reset code and its expiry time, kept for at most one hour.",
      ],
    },
    {
      heading: "Why we use it",
      paragraphs: ["We do not sell your information or use it for advertising."],
      bullets: [
        "To run the app: sign you in, save your work, solve your scenarios and answer your WatBot questions.",
        "To keep the app secure and to find and fix errors.",
        "To understand, in aggregate, how features are used, so the course and the app can be improved.",
      ],
    },
    {
      heading: "Outside services that receive your data",
      paragraphs: [
        "Each of these services processes data for us, under its own terms, to provide the part of the app listed. Most are based in the United States, so your data may be processed there.",
      ],
      bullets: [
        "Anthropic (WatBot): your WatBot questions, the context sent with them, and the answers.",
        "PostHog (usage analytics): pages you view and controls you use (on-screen text is masked), your account id, and your email address.",
        "Sentry (error reports): technical details of errors, the page, and your account id. Request bodies and cookies are removed before sending.",
        "Resend (email): your email address and the reset link, when you ask for a password reset.",
        "OpenRouteService (road distances): the map coordinates of the sites in a network, when you ask for road distances. No account details are sent.",
        "Render (hosting): runs the app and its database, so it holds everything the app stores, including backups.",
      ],
    },
    {
      heading: "Cookies and browser storage",
      paragraphs: [],
      bullets: [
        "One sign-in cookie, which keeps you logged in for up to 7 days.",
        "PostHog stores an analytics identifier in your browser.",
        "The app remembers display settings, such as the theme, in your browser's storage.",
      ],
    },
    {
      heading: "How long we keep it",
      paragraphs: [
        "We keep your data until you delete your account. Password-reset codes expire after one hour. Our hosting provider keeps database backups for a limited period, so deleted data can remain in a backup until that backup expires.",
      ],
    },
    {
      heading: "Your rights and how to use them",
      paragraphs: [
        "Delete your account yourself: on the home page, choose \"Delete my account\" and confirm with your password. This permanently deletes your account, your scenarios and solves, your WatBot conversations, ratings and reports, and your record of which version you accepted.",
        "In-app deletion does not reach copies held by PostHog, Sentry or Anthropic, or database backups. To ask for those to be deleted, or to ask for a copy of your data or a correction, write to the contact address below.",
        "Depending on where you live, laws such as the GDPR may give you further rights, including to object to or restrict processing, and to complain to your data protection authority.",
      ],
    },
    {
      heading: "Education records (FERPA)",
      paragraphs: [
        "The app is used on behalf of your instructor or institution, and records of your coursework in it may be education records under FERPA. Your institution governs consent for and access to those records; you may also direct requests to your institution.",
      ],
    },
    {
      heading: "Children",
      paragraphs: ["The app is meant for university and college courses and is not directed at children under 13."],
    },
    {
      heading: "Changes to this notice",
      paragraphs: [
        "If this notice changes, the version date at the top changes and you will be asked to accept the new version the next time you log in.",
      ],
    },
  ],
};
```

- [ ] **Step 7: Create the page** `artifacts/studio/src/pages/legal/LegalPage.tsx` (tokens only, so `themeSurfaceGuard.test.ts` stays green):

```tsx
import { Link } from "wouter";
import { LEGAL_DRAFT, PRIVACY_CONTACT_EMAIL, TERMS_VERSION } from "./legalMeta";
import type { LegalDoc } from "./legalText";

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid={`page-${doc.slug}`}>
      <main className="max-w-[720px] mx-auto px-6 py-10">
        {LEGAL_DRAFT && (
          <div role="status" data-testid="legal-draft-banner" className="mb-6 rounded-md border px-4 py-3 text-sm font-semibold"
            style={{ borderColor: "var(--line)", background: "var(--card)" }}>
            Draft — pending review. This text has not yet been reviewed and may change.
          </div>
        )}
        <h1 className="scnd-display text-3xl font-bold" style={{ color: "var(--text-brand)" }}>{doc.title}</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }} data-testid="legal-version">Version {TERMS_VERSION}</p>
        <p className="mt-4 text-sm leading-relaxed">{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.heading} className="mt-6">
            <h2 className="text-base font-semibold">{s.heading}</h2>
            {s.bullets && (
              <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed space-y-1">
                {s.bullets.map((b) => <li key={b}>{b}</li>)}
              </ul>
            )}
            {s.paragraphs.map((p) => <p key={p} className="mt-2 text-sm leading-relaxed">{p}</p>)}
          </section>
        ))}
        <section className="mt-6">
          <h2 className="text-base font-semibold">Contact</h2>
          <p className="mt-2 text-sm">
            Questions and requests:{" "}
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="underline" style={{ color: "var(--link)" }} data-testid="link-legal-contact">
              {PRIVACY_CONTACT_EMAIL}
            </a>
          </p>
        </section>
        <p className="mt-8 text-sm">
          <Link href="/" className="underline" style={{ color: "var(--link)" }}>Back to Optimization Studio</Link>
        </p>
      </main>
    </div>
  );
}
```

- [ ] **Step 8: Add the routes** to the single `<Switch>` in `artifacts/studio/src/App.tsx`. Add the imports next to the other page imports (lines 11-14):

```tsx
import { LegalPage } from "@/pages/legal/LegalPage";
import { TERMS_OF_SERVICE, PRIVACY_NOTICE } from "@/pages/legal/legalText";
```
  Insert after line 64 (`<Route path="/reset-password">…`):

```tsx
      {/* WQF-B1 — public for every visitor, signed in or not, so the consent
          links work from the log-in form and from the home footer alike. */}
      <Route path="/terms"><LegalPage doc={TERMS_OF_SERVICE} /></Route>
      <Route path="/privacy"><LegalPage doc={PRIVACY_NOTICE} /></Route>
```

- [ ] **Step 9: Run the Step 3 command again.** Expected: PASS (drift 3/3, LegalPage 4/4, App suite green including the 4 new cases).

- [ ] **Step 10: Per-task gate**, then **changelog** `### WQF-B2 — draft Terms of Service and Privacy Notice pages`. The entry says that the text is a draft pending qualified review, that the contact address was owner-supplied, that `CURRENT_TERMS_VERSION` is provisional `2026-11-25` until WQF-B9, and gives the measured gate counts.

- [ ] **Step 11: Commit** `[WQF-B2] add the draft Terms of Service and Privacy Notice pages` (explicit `P`, guard, attribution).

---

### Task B3: The consent checkbox on Log in and Register

**Role:** frontend-engineer. **Commit:** `[WQF-B3] require the terms box on log in and register`.

**Files:**
- Create: `artifacts/studio/src/components/auth/TermsConsent.tsx`
- Modify: `artifacts/studio/src/pages/auth/Login.tsx:12-38,63-65`, `artifacts/studio/src/pages/auth/Register.tsx:12-36,64-66`
- Modify: `artifacts/studio/src/__tests__/Login.test.tsx`, `artifacts/studio/src/__tests__/Register.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `/terms` and `/privacy` routes (B2); `LoginRequest.acceptTerms` and `RegisterRequest.acceptTerms` (B1).
- Produces: `TermsConsent({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void })`. Test ids: `checkbox-accept-terms`, `link-consent-terms`, `link-consent-privacy`. Checkbox element id `accept-terms`. Both forms send `acceptTerms: true`.

- [ ] **Step 1: Invoke skills** (karpathy, then ponytail).

- [ ] **Step 2: Write the failing tests.** In `Login.test.tsx`, replace the test "submits email and password" (`:42-52`) with the block below, and insert a `await userEvent.click(screen.getByTestId("checkbox-accept-terms"));` before the `button-login` click in "writes the auth-user cache synchronously…" (`:60`):

```tsx
  it("starts with the terms box unticked and the Log in button disabled", async () => {
    render(<Login />);
    expect(screen.getByTestId("checkbox-accept-terms")).toHaveAttribute("aria-checked", "false");
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    expect(screen.getByTestId("button-login")).toBeDisabled();
    await userEvent.click(screen.getByTestId("button-login"));
    expect(mockLoginMutate).not.toHaveBeenCalled();
  });

  it("enables Log in once the box is ticked, and disables it again when unticked", async () => {
    render(<Login />);
    const box = screen.getByTestId("checkbox-accept-terms");
    await userEvent.click(box);
    expect(screen.getByTestId("button-login")).toBeEnabled();
    await userEvent.click(box);
    expect(screen.getByTestId("button-login")).toBeDisabled();
  });

  it("submits email, password and acceptTerms: true", async () => {
    render(<Login />);
    await userEvent.type(screen.getByTestId("input-email"), "student@example.com");
    await userEvent.type(screen.getByTestId("input-password"), "correcthorse");
    await userEvent.click(screen.getByTestId("checkbox-accept-terms"));
    await userEvent.click(screen.getByTestId("button-login"));
    expect(mockLoginMutate).toHaveBeenCalledWith(
      { data: { email: "student@example.com", password: "correcthorse", acceptTerms: true } },
      expect.anything(),
    );
  });

  it("labels the box with the exact consent sentence and links both documents in a new tab", () => {
    render(<Login />);
    expect(document.querySelector("label[for='accept-terms']")).toHaveTextContent(
      "I agree to the Terms of Service and the Privacy Notice (FERPA, GDPR)",
    );
    for (const [id, path] of [["link-consent-terms", "/terms"], ["link-consent-privacy", "/privacy"]] as const) {
      const a = screen.getByTestId(id);
      expect(a).toHaveAttribute("href", path);
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
```

  In `Register.test.tsx`, add the same four cases with `Register`, `button-register`, `mockRegisterMutate` (or the file's existing mutate mock name) and `alert-register-error`. Also insert a checkbox click before every existing `button-register` click that expects a mutate call.

- [ ] **Step 3: Run the tests and watch them fail.**
  Run: `pnpm --filter studio exec vitest run src/__tests__/Login.test.tsx src/__tests__/Register.test.tsx`
  Expected: FAIL with `Unable to find an element by: [data-testid="checkbox-accept-terms"]`.

- [ ] **Step 4: Create** `artifacts/studio/src/components/auth/TermsConsent.tsx`:

```tsx
import { Checkbox } from "@/components/ui/checkbox";

// Plain <a target="_blank">, not wouter's <Link>: the documents open in a new
// tab so a half-filled form survives (spec B2), and a SPA click handler must
// not get a chance to navigate this tab instead (D6).
const legalHref = (path: "/terms" | "/privacy") => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;

export function TermsConsent({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const link = { className: "underline", style: { color: "var(--link)" }, target: "_blank", rel: "noopener noreferrer" } as const;
  return (
    <div className="flex items-start gap-2">
      <Checkbox id="accept-terms" checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)}
        className="mt-0.5" data-testid="checkbox-accept-terms" />
      <label htmlFor="accept-terms" style={{ fontSize: "12.5px", lineHeight: 1.45, color: "var(--text-muted)" }}>
        I agree to the <a href={legalHref("/terms")} {...link} data-testid="link-consent-terms">Terms of Service</a> and
        the <a href={legalHref("/privacy")} {...link} data-testid="link-consent-privacy">Privacy Notice</a> (FERPA, GDPR)
      </label>
    </div>
  );
}
```
  Check the rendered label text in the RTL test above. The JSX line breaks collapse to single spaces, so the sentence matches exactly.

- [ ] **Step 5: Wire it into `Login.tsx`.** Add `import { TermsConsent } from "@/components/auth/TermsConsent";` and `const [acceptedTerms, setAcceptedTerms] = useState(false);` after line 17. In `handleSubmit` (line 19), add `if (!acceptedTerms) return;` as the line after `e.preventDefault();`. Change line 22 to `{ data: { email, password, acceptTerms: true } },`. Insert `<TermsConsent checked={acceptedTerms} onCheckedChange={setAcceptedTerms} />` after the password field's closing `</div>` (line 62). Change line 63 to:

```tsx
        <Button type="submit" disabled={loginUser.isPending || !acceptedTerms} data-testid="button-login" className="mt-1">
```

- [ ] **Step 6: Make the same change in `Register.tsx`:** state after line 17, guard `if (passwordTooShort || !acceptedTerms) return;` at line 23, `{ data: { email, password, acceptTerms: true } }` at line 25, `<TermsConsent …/>` after line 63, and `disabled={registerUser.isPending || !acceptedTerms}` at line 64.

- [ ] **Step 7: Run the Step 3 command again.** Expected: PASS, all cases in both files.

- [ ] **Step 8: Per-task gate.** The e2e typecheck stays green. The UI-login e2e specs that now need a tick are rewritten in B8. List them in the changelog so the lead knows the e2e gate is expected red until B8: `bundle4-auth-landing.spec.ts:87`, `design-upgrade-p5.spec.ts:385,996`, `design-system.spec.ts:174`.

- [ ] **Step 9: Changelog** `### WQF-B3 — terms box on log in and register`, then **Commit** `[WQF-B3] require the terms box on log in and register`.

---

### Task B4: Record acceptance; refuse register and log-in without it (schema + API)

**Role:** backend-engineer. **Commit:** `[WQF-B4] record terms acceptance at register and log in`.

**Files:**
- Modify: `lib/db/src/schema/auth.ts:1-29`
- Modify: `lib/api-spec/openapi.yaml` (`/auth/register` responses `:912-924`, `/auth/login` responses `:936-948`, `RegisterRequest.acceptTerms` and `LoginRequest.acceptTerms` descriptions, new `TermsRequiredError` after `ErrorEnvelope` `:1618-1623`), plus regenerated output
- Modify: `artifacts/api-server/src/routes/auth.ts:113-212`
- Modify: `artifacts/api-server/src/__tests__/auth.test.ts`, plus the mocked-login fixtures listed in Step 9
- Create: `artifacts/api-server/src/__tests__/termsConsentIntegration.test.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `CURRENT_TERMS_VERSION` (B2); `acceptTerms` (B1).
- Produces: `usersTable.termsVersion: string | null` and `usersTable.termsAcceptedAt: Date | null`. The generated type `TermsRequiredError = { error: "terms_required" }`. Register answers 400 `{ error: "Accept the Terms of Service and the Privacy Notice to create an account." }` when `acceptTerms !== true`. Log-in answers 403 `TermsRequiredError` per the Global Constraints.

- [ ] **Step 1: Invoke skills** (karpathy, then ponytail).

- [ ] **Step 2: Schema change.** In `lib/db/src/schema/auth.ts`, change line 2 to `import { index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";` and insert after line 25 (`resetTokenExpiresAt`):

```ts
  // WQF-B (spec B3) — the terms acceptance record. Both nullable, no backfill:
  // a null version means "has not accepted the CURRENT terms", which signs the
  // user out (middlewares/auth.ts) until they log in with the box ticked.
  // NOT NULL would need hard rule #3's two-step protocol. timestamptz per
  // lib/db/CLAUDE.md; written DB-side (now()) by both writers (D3).
  termsVersion: text("terms_version"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
```

- [ ] **Step 3: Push to local `nos_dev` and verify.**
  ```bash
  cd /Users/shubhamkr/nos-wqfb-4
  DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter @workspace/db push
  psql "postgresql://shubhamkr@localhost:5432/nos_dev" -At -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name LIKE 'terms_%' ORDER BY 1;"
  ```
  Expected: drizzle-kit reports changes applied, and psql prints exactly:
  ```
  terms_accepted_at|timestamp with time zone|YES
  terms_version|text|YES
  ```
  If push proposes any statement other than these two `ADD COLUMN`s, abort and report. Afterwards, message the other sessions that `nos_dev.users` gained two nullable columns.

- [ ] **Step 4: Write the failing mocked tests** in `artifacts/api-server/src/__tests__/auth.test.ts`. Extend the mocks first:
  - `mockDb` (`:5-8`) gains `update: vi.fn(),`.
  - `usersTable` in the `@workspace/db` mock (`:13`) becomes `{ id: "id", email: "email", termsVersion: "terms_version", termsAcceptedAt: "terms_accepted_at" }`.
  - `makeChain`'s method list (`:35`) gains `"update", "set"`.
  - Add `import { CURRENT_TERMS_VERSION } from "../lib/terms.js";` after line 29.

  Then append:

```ts
describe("WQF-B3 — terms consent at register and log-in", () => {
  const hashOf = (pw: string) => argon2.hash(pw);

  it("refuses to register without acceptTerms: true, before any lookup or insert", async () => {
    for (const extra of [{}, { acceptTerms: false }]) {
      const res = await request(app).post("/api/auth/register")
        .send({ email: "student@example.com", password: "supersecret", ...extra });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Accept the Terms of Service and the Privacy Notice to create an account." });
    }
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("records the current terms version and a DB-side time on the new row", async () => {
    const insertChain = makeChain([{ id: "user-1", email: "student@example.com", role: "student", termsVersion: CURRENT_TERMS_VERSION }]);
    mockDb.insert.mockReturnValue(insertChain);
    const res = await request(app).post("/api/auth/register")
      .send({ email: "student@example.com", password: "supersecret", acceptTerms: true });
    expect(res.status).toBe(201);
    const values = insertChain.values.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(values.termsAcceptedAt).toBeDefined();
  });

  it("403s terms_required with no cookie when the stored version is stale and acceptTerms is absent", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: null }]));
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "supersecret" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "terms_required" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("checks the password before the terms: a wrong password is still the generic 401", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: null }]));
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid email or password" });
  });

  it("records acceptance and logs in when acceptTerms is true and the stored version is stale", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: "1999-01-01" }]));
    const updateChain = makeChain([]);
    mockDb.update.mockReturnValue(updateChain);
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "supersecret", acceptTerms: true });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/nos_session=/);
    const written = updateChain.set.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(written.termsAcceptedAt).toBeDefined();
  });

  it("does not write the users row when the stored version is already current (D2)", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: CURRENT_TERMS_VERSION }]));
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "supersecret", acceptTerms: true });
    expect(res.status).toBe(200);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("a failed acceptance write is the route's own 500, and its params never reach the body", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: null }]));
    const chain = makeChain([]);
    (chain as { then: unknown }).then = (_ok: unknown, fail: (e: Error) => void) =>
      Promise.reject(new Error("Failed query: update users\nparams: SECRET-USER-ID")).catch(fail);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "supersecret", acceptTerms: true });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not sign in." });
    expect(JSON.stringify(res.body)).not.toContain("SECRET-USER-ID");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
```

- [ ] **Step 5: Write the failing real-Postgres test** `artifacts/api-server/src/__tests__/termsConsentIntegration.test.ts`:

```ts
/**
 * WQF-B — terms consent against a real database. No db mock. Requires a live
 * DATABASE_URL (local nos_dev). Every row this file touches is one it created;
 * cleanup is scoped to those ids.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import app from "../app.js";
import { CURRENT_TERMS_VERSION } from "../lib/terms.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";

const createdUserIds: string[] = [];
const PASSWORD = "correcthorse1";

afterAll(async () => {
  if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
});
beforeEach(() => resetLoginRateLimiterForTests());

async function registerFreshUser(): Promise<{ id: string; email: string; cookie: string }> {
  const email = `wqfb-terms-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, acceptTerms: true });
  expect(res.status).toBe(201);
  createdUserIds.push(res.body.user.id);
  return { id: res.body.user.id, email, cookie: (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]! };
}

async function termsRow(id: string) {
  const [row] = await db.select({ v: usersTable.termsVersion, at: usersTable.termsAcceptedAt }).from(usersTable).where(eq(usersTable.id, id));
  return row!;
}

describe("WQF-B — terms acceptance record (real Postgres)", () => {
  it("declares both columns nullable, terms_accepted_at as timestamptz", async () => {
    const res = await db.execute(sql`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('terms_version', 'terms_accepted_at')
      ORDER BY column_name`);
    expect(res.rows).toEqual([
      { column_name: "terms_accepted_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "terms_version", data_type: "text", is_nullable: "YES" },
    ]);
  });

  it("register records the current version and a time within a minute of now", async () => {
    const user = await registerFreshUser();
    const row = await termsRow(user.id);
    expect(row.v).toBe(CURRENT_TERMS_VERSION);
    expect(Math.abs(row.at!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("a stale user is refused without the box, then recorded when they accept", async () => {
    const user = await registerFreshUser();
    await db.update(usersTable).set({ termsVersion: null, termsAcceptedAt: null }).where(eq(usersTable.id, user.id));

    const refused = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: "terms_required" });
    expect(refused.headers["set-cookie"]).toBeUndefined();
    expect((await termsRow(user.id)).v).toBeNull(); // the refusal wrote nothing

    const accepted = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD, acceptTerms: true });
    expect(accepted.status).toBe(200);
    const row = await termsRow(user.id);
    expect(row.v).toBe(CURRENT_TERMS_VERSION);
    expect(Math.abs(row.at!.getTime() - Date.now())).toBeLessThan(60_000);
  });
});
```

- [ ] **Step 6: Run both test files and watch them fail.**
  Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/auth.test.ts src/__tests__/termsConsentIntegration.test.ts`
  Expected: FAIL. Register without the box returns 201, a stale log-in returns 200, and register writes `termsVersion` undefined.

- [ ] **Step 7: Contract.** In `openapi.yaml`:
  - Under `/auth/register` `responses`, before `'409'`:
```yaml
        '400':
          description: >-
            Email or password invalid, or acceptTerms is not true (the student
            did not tick the terms box).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
```
  - Under `/auth/login` `responses`, after `'401'`:
```yaml
        '403':
          description: >-
            The password was correct, but the account has not accepted the
            current Terms of Service and Privacy Notice and the request did not
            carry acceptTerms: true. No session cookie is set.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TermsRequiredError'
```
  - Replace both `acceptTerms` descriptions. `RegisterRequest`: `Must be true (the student ticked the terms box); otherwise the server answers 400. The server records the current terms version and time on the new account.` `LoginRequest`: `Required as true only when the account has not accepted the current terms version, in which case its absence answers 403 terms_required; when true and the stored version is stale, the server records the current version and time.`
  - After `ErrorEnvelope`:
```yaml
    TermsRequiredError:
      type: object
      required: [error]
      properties:
        error:
          type: string
          enum: [terms_required]
```
  Run `pnpm --filter @workspace/api-spec run codegen`. Expected: success. If typecheck reports an ambiguous star export, add an explicit `export type { … } from "./generated/types";` in `lib/api-zod/src/index.ts`, the way lines 3-15 already do.

- [ ] **Step 8: Server.** In `artifacts/api-server/src/routes/auth.ts`, change line 2 so `sql` is still imported (it already is). Add `TermsRequiredError` to the type-only imports and add the constant:

```ts
import type { TermsRequiredError } from "@workspace/api-zod";
import { CURRENT_TERMS_VERSION } from "../lib/terms.js";
```
  In the register handler, after `const { email, password } = parsed.data;` (line 121):

```ts
  // WQF-B3 — the box is the consent; no tick, no account. Checked before any
  // lookup so a refused request costs nothing and reveals nothing.
  if (parsed.data.acceptTerms !== true) {
    res.status(400).json({ error: "Accept the Terms of Service and the Privacy Notice to create an account." });
    return;
  }
```
  In the insert at lines 140-144, add `termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: sql\`now()\`,` to `.values({ … })`.

  In the log-in handler, after the 401 block (line 198), insert:

```ts
  // WQF-B3 — after the password check, never before: the terms state of an
  // account is not revealed to someone who does not hold its password.
  if (user.termsVersion !== CURRENT_TERMS_VERSION) {
    if (parsed.data.acceptTerms !== true) {
      const body: TermsRequiredError = { error: "terms_required" };
      res.status(403).json(body);
      return;
    }
    // D2 — written only when stale, so termsAcceptedAt is when THIS version
    // was first accepted. No error binding (drizzle params carry the user id).
    try {
      await db.update(usersTable)
        .set({ termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: sql`now()` })
        .where(eq(usersTable.id, user.id));
    } catch {
      logger.error({ step: "login-terms-accept" }, "terms acceptance write failed");
      res.status(500).json({ error: "Could not sign in." });
      return;
    }
  }
```

- [ ] **Step 9: Repair the mocked logins the new rule now refuses.** Mocked users rows that lack `termsVersion` now get 403 on log-in. List them:
  ```bash
  grep -lE 'vi\.mock\("@workspace/db"' artifacts/api-server/src/__tests__/*.test.ts artifacts/api-server/src/**/__tests__/*.test.ts 2>/dev/null | xargs grep -lE '/api/auth/login"'
  ```
  Expected hits include `routes.test.ts` (`loginAs`, `:149-151`), `error-handling.test.ts`, `importMultiModelRoundTrip.test.ts`, `auth.test.ts` (log-in success cases, e.g. `:271`), and `passwordReset.test.ts` if it logs in. In each mocked users row that a log-in is **expected to succeed** against, add `termsVersion: CURRENT_TERMS_VERSION`, importing the constant from `../lib/terms.js`. Inside a hoisted `vi.mock` factory, load it with `const { CURRENT_TERMS_VERSION } = await import("../lib/terms.js");` in an `async` factory. Do **not** change assertions. If a test fails for any reason other than this one, it is a real regression: stop and report.

- [ ] **Step 10: Run Step 6's command again.** Expected: PASS, with 7 new mocked cases and 3 integration cases.

- [ ] **Step 11: Per-task gate.** Expected: green. Any red api-server test must be one of the categories in Step 9, or a registered flake.

- [ ] **Step 12: Changelog** `### WQF-B4 — terms acceptance at register and log in`. The entry states the local `nos_dev` push and the measured `information_schema` result, that **production is not yet migrated (WQF-B12 does it first)**, D1–D3, the tests and the gate. **Commit** `[WQF-B4] record terms acceptance at register and log in` with `P` = schema, spec, generated, `routes/auth.ts`, the tests, and the changelog.

---

### Task B5: One-time log-out, and reset-password signs in only a current user

**Role:** backend-engineer. Handed `artifacts/studio/src/pages/auth/{ResetPassword,Login}.tsx` and their tests, because the cookie rule and the studio landing are **one contract**: a server that stops setting the cookie, paired with a studio that still writes the user into its cache, would show a signed-in shell that 401s. **Commit:** `[WQF-B5] sign out users who have not accepted the current terms`.

**Files:**
- Modify: `artifacts/api-server/src/middlewares/auth.ts:1-46`
- Modify: `artifacts/api-server/src/routes/auth.ts:418` (reset cookie)
- Modify: `lib/api-spec/openapi.yaml:1006-1026` (reset description text only; shape unchanged), plus regenerated output
- Modify: `artifacts/studio/src/pages/auth/ResetPassword.tsx:1-51`, `artifacts/studio/src/pages/auth/Login.tsx`
- Modify tests: `artifacts/api-server/src/__tests__/auth.test.ts` (`requireAuth` rows `:288`, sessionUser case `:271`), `passwordReset.test.ts` (`USER` fixture, `:258-273`), `termsConsentIntegration.test.ts`; the `findUserById` mocks in `routes.test.ts:88-90`, `error-handling.test.ts:43-45`, `importMultiModelRoundTrip.test.ts:67-69`; `artifacts/studio/src/__tests__/{ResetPassword,Login}.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `usersTable.termsVersion` (B4); `CURRENT_TERMS_VERSION` (B2).
- Produces: `sessionUser(req)` returns `undefined` for a version mismatch, so `requireAuth` answers 401 and `GET /auth/user` returns `{ user: null }`. Reset still answers `AuthUserEnvelope` and sets a cookie only when current. Studio: after a reset, the student lands on `/` or on `/login?reset=done`. Login renders `data-testid="alert-password-changed"` for `?reset=done`.

- [ ] **Step 1: Invoke skills** (karpathy, then ponytail).

- [ ] **Step 2: Write the failing server tests.** In `auth.test.ts`, change the `row` fixtures at `:271` and `:288` to include `termsVersion: CURRENT_TERMS_VERSION`, then add to `describe("requireAuth middleware")`:

```ts
  it("401s a session whose user has not accepted the current terms (WQF-B4 one-time log-out)", async () => {
    const cookie = sessionCookieValue(row);
    for (const termsVersion of [null, "1999-01-01"]) {
      mockDb.select.mockReturnValue(makeChain([{ ...row, termsVersion }]));
      const { status, next } = await run(cookie);
      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });
```
  In `passwordReset.test.ts`, give the `USER` fixture `termsVersion: CURRENT_TERMS_VERSION`, keep the "logs the caller in" case, and add:

```ts
  it("succeeds WITHOUT a cookie for an account that has not accepted the current terms (WQF-B2)", async () => {
    mockDb.update.mockReturnValue(makeChain([{ ...USER, termsVersion: null }]));
    const res = await request(app).post("/api/auth/reset-password").send({ token: "raw-token", password: "correcthorse1" });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: "u1", email: "student@example.test", role: "student" }); // contract unchanged
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
```
  Append to `termsConsentIntegration.test.ts`:

```ts
import { hashResetToken, generateResetToken } from "../lib/resetTokens.js";

async function plantToken(userId: string): Promise<string> {
  const token = generateResetToken();
  await db.update(usersTable)
    .set({ resetTokenHash: hashResetToken(token), resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) })
    .where(eq(usersTable.id, userId));
  return token;
}

describe("WQF-B — one-time log-out and the reset landing (real Postgres)", () => {
  it("a version change signs an existing session out on its next request", async () => {
    const user = await registerFreshUser();
    expect((await request(app).get("/api/scenarios").set("Cookie", user.cookie)).status).toBe(200); // non-vacuity
    await db.update(usersTable).set({ termsVersion: "1999-01-01" }).where(eq(usersTable.id, user.id));
    expect((await request(app).get("/api/scenarios").set("Cookie", user.cookie)).status).toBe(401);
    expect((await request(app).get("/api/auth/user").set("Cookie", user.cookie)).body).toEqual({ user: null });
  });

  it("reset sets no cookie for a stale account; the account then logs in by accepting", async () => {
    const user = await registerFreshUser();
    await db.update(usersTable).set({ termsVersion: null }).where(eq(usersTable.id, user.id));
    const reset = await request(app).post("/api/auth/reset-password").send({ token: await plantToken(user.id), password: "brandnewpass1" });
    expect(reset.status).toBe(200);
    expect(reset.body.user.id).toBe(user.id);
    expect(reset.headers["set-cookie"]).toBeUndefined();
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password: "brandnewpass1", acceptTerms: true });
    expect(login.status).toBe(200);
  });

  it("reset still signs a current account straight in", async () => {
    const user = await registerFreshUser();
    const reset = await request(app).post("/api/auth/reset-password").send({ token: await plantToken(user.id), password: "brandnewpass1" });
    expect(reset.status).toBe(200);
    const cookie = (reset.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    expect((await request(app).get("/api/auth/user").set("Cookie", cookie)).body.user.id).toBe(user.id);
  });
});
```

- [ ] **Step 3: Write the failing studio tests.** In `ResetPassword.test.tsx`, change the mocks (`:13-23`):

```tsx
const mockSetQueryData = vi.fn();
const mockFetchQuery = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: mockSetQueryData, fetchQuery: mockFetchQuery }),
}));
const mockMutate = vi.fn();
let state: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: null };
vi.mock("@workspace/api-client-react", () => ({
  useResetPassword: () => ({ mutate: mockMutate, ...state }),
  getCurrentAuthUser: vi.fn(),
  getGetCurrentAuthUserQueryKey: () => ["getCurrentAuthUser"],
}));
```
  Replace the existing "writes the cache … navigates home" case with:

```tsx
  async function submitReset() {
    setHash("#token=abc123");
    mockMutate.mockImplementation((_body, { onSuccess }) => onSuccess({ user: { id: "u1", email: "s@example.test", role: "student" } }));
    render(<ResetPassword />);
    await userEvent.type(screen.getByTestId("input-new-password"), "brandnewpass1");
    await userEvent.click(screen.getByTestId("button-set-password"));
  }

  it("asks the server who is signed in and goes home when the reset signed the student in", async () => {
    mockFetchQuery.mockResolvedValue({ user: { id: "u1", email: "s@example.test", role: "student" } });
    await submitReset();
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(mockFetchQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["getCurrentAuthUser"], staleTime: 0 }));
    expect(mockSetQueryData).not.toHaveBeenCalled(); // never trust the body: it is identical either way
  });

  it("sends the student to Log in when the reset set no session (terms not yet accepted)", async () => {
    mockFetchQuery.mockResolvedValue({ user: null });
    await submitReset();
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login?reset=done", { replace: true }));
  });

  it("falls back to Log in when the who-am-I check itself fails", async () => {
    mockFetchQuery.mockRejectedValue(new Error("offline"));
    await submitReset();
    await vi.waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login?reset=done", { replace: true }));
  });
```
  In `Login.test.tsx`, add:

```tsx
  it("tells the student their password changed when arriving from a reset", () => {
    window.history.replaceState(null, "", "/login?reset=done");
    render(<Login />);
    expect(screen.getByTestId("alert-password-changed")).toHaveTextContent("Your password was changed. Log in to continue.");
    window.history.replaceState(null, "", "/login");
  });

  it("shows no password notice on a plain visit", () => {
    window.history.replaceState(null, "", "/login");
    render(<Login />);
    expect(screen.queryByTestId("alert-password-changed")).toBeNull();
  });
```

- [ ] **Step 4: Run all the touched tests and watch them fail.**
  ```bash
  DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/auth.test.ts src/__tests__/passwordReset.test.ts src/__tests__/termsConsentIntegration.test.ts
  pnpm --filter studio exec vitest run src/__tests__/ResetPassword.test.tsx src/__tests__/Login.test.tsx
  ```
  Expected: FAIL. The stale session gets `next()` / 200, the stale reset sets a cookie, the studio calls `setQueryData` and navigates `/`, and there is no `alert-password-changed`.

- [ ] **Step 5: Server.** In `middlewares/auth.ts`, add `import { CURRENT_TERMS_VERSION } from "../lib/terms.js";` and replace line 45:

```ts
  // WQF-B4 — a user who has not accepted the CURRENT terms holds no session.
  // Sessions are stateless signed cookies, so this one comparison is the
  // whole one-time log-out (deploy) and every future re-acceptance (a
  // constant bump). It runs at the start of each request, so a request that
  // already passed it when the version changed completes normally.
  return user && passwordTag(user.passwordHash) === tag && user.termsVersion === CURRENT_TERMS_VERSION ? user : undefined;
```
  In `routes/auth.ts`, replace line 418 with:

```ts
  // WQF-B2 — sign in only a user who has accepted the current terms; anyone
  // else gets the same 200 body with NO cookie and must log in, where the box
  // is. Setting a cookie here would hand out a session sessionUser rejects.
  if (user.termsVersion === CURRENT_TERMS_VERSION) setSessionCookie(res, user);
```
  In `openapi.yaml`, change the reset `description` (`:1010-1013`) to: `On success the caller is logged in if the account has accepted the current Terms of Service and Privacy Notice; otherwise the password is still changed, no session cookie is set, and the caller must log in (accepting the terms). The response body is the same either way. The token is consumed by the same statement that writes the new hash, which is what makes it single-use.` Change the `'200'` description to `Password changed; caller is logged in when their terms acceptance is current.`. Run `pnpm --filter @workspace/api-spec run codegen` and commit whatever it regenerates (possibly only comments).

- [ ] **Step 6: Mocked `findUserById` stubs.** In `routes.test.ts:88-90`, `error-handling.test.ts:43-45` and `importMultiModelRoundTrip.test.ts:67-69`, make each factory `async` and return `termsVersion` too:

```ts
vi.mock("../lib/sessionUser.js", async () => {
  const { CURRENT_TERMS_VERSION } = await import("../lib/terms.js");
  return {
    findUserById: async (id: string) => ({ id, email: `${id}@example.com`, role: "student", passwordHash: testPasswordHash, termsVersion: CURRENT_TERMS_VERSION }),
  };
});
```
  `testPasswordHash` is a module-level `let` read at call time, exactly as before.

- [ ] **Step 7: Studio.** In `ResetPassword.tsx`, change line 4 to `import { useResetPassword, getCurrentAuthUser, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";` and replace the `onSuccess` (`:40-46`) with:

```tsx
        onSuccess: async () => {
          // WQF-B2 / D4 — the server sets the session cookie only for an account
          // that has accepted the current terms, and the body is identical either
          // way, so ask the server who is signed in instead of trusting it.
          // fetchQuery also fills the cache BEFORE navigating, which is what the
          // old synchronous setQueryData was protecting (Gate race, Login.tsx).
          let signedIn = false;
          try {
            const fresh = await queryClient.fetchQuery({
              queryKey: getGetCurrentAuthUserQueryKey(),
              queryFn: () => getCurrentAuthUser(),
              staleTime: 0,
            });
            signedIn = Boolean(fresh.user);
          } catch {
            // The password is already changed; Log in is always a safe landing.
          }
          navigate(signedIn ? "/" : "/login?reset=done", { replace: true });
        },
```
  In `Login.tsx`, add after the state lines:

```tsx
  // WQF-B2 — ResetPassword lands here when the reset could not sign the
  // student in (terms not yet accepted). Read once; wouter's path excludes search.
  const [passwordChanged] = useState(() => new URLSearchParams(window.location.search).get("reset") === "done");
```
  Render this as the first child of the `<form>`, before the error alert:

```tsx
        {passwordChanged && !loginUser.isError && (
          <Alert data-testid="alert-password-changed">
            <AlertDescription>Your password was changed. Log in to continue.</AlertDescription>
          </Alert>
        )}
```

- [ ] **Step 8: Run Step 4's commands again.** Expected: PASS.

- [ ] **Step 9: Per-task gate.** Every remaining api-server red must be a mocked users row or `findUserById` stub that lacks `termsVersion`. Add the field and change nothing else. Real-Postgres suites that register through the route are already current.

- [ ] **Step 10: Changelog** `### WQF-B5 — one-time log-out and the reset landing`. Note D4, and that `e2e_journey.py` still runs clean because it registers with the box (B1). **Commit** `[WQF-B5] sign out users who have not accepted the current terms`.

---

### Task B6: `DELETE /api/auth/account`

**Role:** backend-engineer. **Commit:** `[WQF-B6] add in-app account deletion`.

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (new path after `/auth/user` `:961-972`; new `DeleteAccountRequest` after `ResetPasswordRequest` `:1582-1599`), plus regenerated output
- Create: `artifacts/api-server/src/services/deleteAccount.ts`
- Modify: `artifacts/api-server/src/routes/auth.ts` (extract `clearSessionCookie` from logout `:217-222`; add the route)
- Create: `artifacts/api-server/src/__tests__/deleteAccountRoute.test.ts` (mocked), `artifacts/api-server/src/__tests__/deleteAccountIntegration.test.ts` (real Postgres)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces: `deleteAccountData(userId: string): Promise<DeleteAccountOutcome>`, where `type DeleteAccountOutcome = "deleted" | "busy" | "gone"`, from `services/deleteAccount.ts`. It throws on any database error, after a full rollback.
- Produces: `DELETE /api/auth/account`, body `{ password: string }` (1-128). Responses: **204** (cookie cleared), **400** `Enter your current password to delete your account.`, **401** not authenticated, **403** `That password is not correct.`, **409** `A solve is still queued or running for your account. Wait for it to finish, then try again.`, **429** `Too many attempts, try again shortly`, **500** `Could not delete your account. Nothing was deleted. Try again.` Generated: zod `DeleteAccountBody`; client `deleteAccount` and `useDeleteAccount`, with mutate variables `{ data: DeleteAccountRequest }`.

- [ ] **Step 1: Invoke skills** (karpathy, then ponytail).

- [ ] **Step 2: Contract first, so the tests can import the generated body.** Add the path after `/auth/user`:

```yaml
  /auth/account:
    delete:
      tags: [Auth]
      operationId: deleteAccount
      summary: Delete the signed-in user's account and the app's data about them
      description: >-
        Requires the current password. One transaction: locks the user's row,
        refuses with 409 while any of the user's solve jobs is queued or
        running, then deletes the user's solve jobs, scenarios and account;
        WatBot conversations, messages, reports and feedback go by ON DELETE
        CASCADE. Anonymous site feedback and the input-keyed result cache are
        not linked to accounts and are not touched. Third-party copies
        (analytics, error reports, the AI provider) and hosting backups are
        not reached. Clears the session cookie.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/DeleteAccountRequest'
      responses:
        '204':
          description: Account deleted; session cookie cleared.
        '400':
          description: Password missing or over-length.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
        '401':
          description: Not authenticated.
        '403':
          description: The password is not correct. Nothing was deleted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
        '409':
          description: A solve job is queued or running. Nothing was deleted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
        '429':
          description: Shares the log-in attempt limit (per client IP).
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
        '500':
          description: The transaction failed and rolled back. Nothing was deleted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorEnvelope'
```
  And the schema:

```yaml
    DeleteAccountRequest:
      type: object
      required: [password]
      properties:
        password:
          type: string
          minLength: 1
          maxLength: 128
          description: >-
            The current password, re-checked with argon2 before anything is
            deleted. Same upper bound as log-in (argon2 cost guard).
```
  Run `pnpm --filter @workspace/api-spec run codegen`. Expected: success. `grep -n "export const DeleteAccountBody" lib/api-zod/src/generated/api.ts` prints a line.

- [ ] **Step 3: Write the failing mocked route test** `artifacts/api-server/src/__tests__/deleteAccountRoute.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import argon2 from "argon2";
import { createHmac } from "node:crypto";

const mockDeleteAccountData = vi.hoisted(() => vi.fn());
vi.mock("../services/deleteAccount.js", () => ({ deleteAccountData: mockDeleteAccountData }));
const current = vi.hoisted(() => ({ row: null as null | Record<string, unknown> }));
vi.mock("../lib/sessionUser.js", () => ({ findUserById: async () => current.row }));

import app from "../app.js";
import { sessionCookieValue, SESSION_SECRET } from "../middlewares/auth.js";
import { CURRENT_TERMS_VERSION } from "../lib/terms.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";

let row: { id: string; email: string; role: string; passwordHash: string; termsVersion: string };
beforeAll(async () => {
  row = { id: "user-1", email: "s@example.test", role: "student", passwordHash: await argon2.hash("correcthorse1"), termsVersion: CURRENT_TERMS_VERSION };
});
beforeEach(() => {
  vi.clearAllMocks();
  resetLoginRateLimiterForTests();
  current.row = row;
});

function cookie(): string {
  const v = sessionCookieValue(row);
  const signed = `s:${v}.${createHmac("sha256", SESSION_SECRET).update(v).digest("base64").replace(/=+$/, "")}`;
  return `nos_session=${encodeURIComponent(signed)}`;
}
const del = (body: unknown, withCookie = true) => {
  const r = request(app).delete("/api/auth/account");
  return (withCookie ? r.set("Cookie", cookie()) : r).send(body as object);
};

describe("DELETE /api/auth/account (route)", () => {
  it("401s without a session and deletes nothing", async () => {
    const res = await del({ password: "correcthorse1" }, false);
    expect(res.status).toBe(401);
    expect(mockDeleteAccountData).not.toHaveBeenCalled();
  });

  it("400s a missing password", async () => {
    const res = await del({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Enter your current password to delete your account." });
    expect(mockDeleteAccountData).not.toHaveBeenCalled();
  });

  it("403s a wrong password and deletes nothing (D8)", async () => {
    const res = await del({ password: "wrong-password" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "That password is not correct." });
    expect(mockDeleteAccountData).not.toHaveBeenCalled();
  });

  it("deletes ONLY the session's own user id, answers 204 and clears the cookie", async () => {
    mockDeleteAccountData.mockResolvedValue("deleted");
    const res = await del({ password: "correcthorse1", userId: "someone-else" });
    expect(res.status).toBe(204);
    expect(mockDeleteAccountData).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^nos_session=;.*Expires=Thu, 01 Jan 1970/);
  });

  it("treats an already-gone user as deleted (D11)", async () => {
    mockDeleteAccountData.mockResolvedValue("gone");
    expect((await del({ password: "correcthorse1" })).status).toBe(204);
  });

  it("409s while a solve is queued or running, and keeps the cookie", async () => {
    mockDeleteAccountData.mockResolvedValue("busy");
    const res = await del({ password: "correcthorse1" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "A solve is still queued or running for your account. Wait for it to finish, then try again." });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("a failed transaction is the route's own 500 and its params never escape", async () => {
    mockDeleteAccountData.mockRejectedValue(new Error("Failed query: delete from scenarios\nparams: SECRET-USER-ID"));
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await del({ password: "correcthorse1" });
    expect(res.status).toBe(500);
    // Without the no-binding catch this is app.ts's generic "Internal server error".
    expect(res.body).toEqual({ error: "Could not delete your account. Nothing was deleted. Try again." });
    expect(JSON.stringify(res.body)).not.toContain("SECRET-USER-ID");
    logSpy.mockRestore();
  });

  it("shares the log-in limiter: the 21st attempt in a minute is a 429", async () => {
    for (let i = 0; i < 20; i++) await del({ password: "wrong-password" });
    const res = await del({ password: "correcthorse1" });
    expect(res.status).toBe(429);
    expect(mockDeleteAccountData).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Write the failing real-Postgres test** `artifacts/api-server/src/__tests__/deleteAccountIntegration.test.ts`:

```ts
/**
 * WQF-B5 — account deletion against a real database. No db mock. Requires a
 * live DATABASE_URL (local nos_dev only). Root CLAUDE.md migration-test rule:
 * the destructive function is called ONLY with ids this file created, and
 * cleanup is scoped to those ids. Two users per test: a victim and a bystander,
 * so "exactly the user's rows go and nobody else's" is observable.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, usersTable, scenariosTable, solveJobsTable, feedbackTable, resultCacheTable,
  watbotConversationsTable, watbotMessagesTable, watbotReportsTable, watbotFeedbackTable,
} from "@workspace/db";
import app from "../app.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";

const PASSWORD = "correcthorse1";
const createdUserIds: string[] = [];
const createdFeedbackIds: number[] = [];
const createdCacheHashes: string[] = [];

afterAll(async () => {
  if (createdUserIds.length) {
    await db.delete(solveJobsTable).where(inArray(solveJobsTable.userId, createdUserIds));
    await db.delete(scenariosTable).where(inArray(scenariosTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  if (createdFeedbackIds.length) await db.delete(feedbackTable).where(inArray(feedbackTable.id, createdFeedbackIds));
  if (createdCacheHashes.length) await db.delete(resultCacheTable).where(inArray(resultCacheTable.inputsHash, createdCacheHashes));
});
beforeEach(() => resetLoginRateLimiterForTests());

async function registerUser(tag: string) {
  const email = `wqfb-del-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, acceptTerms: true });
  expect(res.status).toBe(201);
  createdUserIds.push(res.body.user.id);
  return { id: res.body.user.id as string, email, cookie: (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]! };
}

async function seedOwnedRows(userId: string) {
  const [scenario] = await db.insert(scenariosTable).values({ name: "wqfb-del", userId, modelId: "p-median-us", inputs: {} }).returning();
  const [job] = await db.insert(solveJobsTable)
    .values({ scenarioId: scenario!.id, userId, status: "succeeded", inputsHash: `wqfb-del-${scenario!.id}` }).returning();
  // Point the scenario's SET NULL FKs at the job, as a real solved scenario does.
  await db.update(scenariosTable).set({ latestSolveJobId: job!.id, resultRunId: job!.id }).where(eq(scenariosTable.id, scenario!.id));
  const [conv] = await db.insert(watbotConversationsTable).values({ userId, modelId: "p-median-us", title: "t" }).returning();
  const [msg] = await db.insert(watbotMessagesTable).values({ conversationId: conv!.id, userId, role: "tutor", blocks: [] }).returning();
  await db.insert(watbotReportsTable).values({ userId, messageId: msg!.id, reason: "other" });
  await db.insert(watbotFeedbackTable).values({ userId, conversationId: conv!.id, messageId: msg!.id, helped: true });
  return { scenarioId: scenario!.id };
}

async function counts(userId: string) {
  const n = async (q: Promise<unknown[]>) => (await q).length;
  return {
    users: await n(db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId))),
    scenarios: await n(db.select({ id: scenariosTable.id }).from(scenariosTable).where(eq(scenariosTable.userId, userId))),
    solveJobs: await n(db.select({ id: solveJobsTable.id }).from(solveJobsTable).where(eq(solveJobsTable.userId, userId))),
    conversations: await n(db.select({ id: watbotConversationsTable.id }).from(watbotConversationsTable).where(eq(watbotConversationsTable.userId, userId))),
    messages: await n(db.select({ id: watbotMessagesTable.id }).from(watbotMessagesTable).where(eq(watbotMessagesTable.userId, userId))),
    reports: await n(db.select({ id: watbotReportsTable.id }).from(watbotReportsTable).where(eq(watbotReportsTable.userId, userId))),
    feedback: await n(db.select({ id: watbotFeedbackTable.id }).from(watbotFeedbackTable).where(eq(watbotFeedbackTable.userId, userId))),
  };
}
const ONE_EACH = { users: 1, scenarios: 1, solveJobs: 1, conversations: 1, messages: 1, reports: 1, feedback: 1 };
const NONE = { users: 0, scenarios: 0, solveJobs: 0, conversations: 0, messages: 0, reports: 0, feedback: 0 };

const del = (cookie: string, password = PASSWORD) =>
  request(app).delete("/api/auth/account").set("Cookie", cookie).send({ password });

describe("DELETE /api/auth/account — real Postgres", () => {
  it("removes exactly the caller's rows (incl. cascades); the bystander, site feedback and the result cache stay", async () => {
    const victim = await registerUser("victim");
    const bystander = await registerUser("bystander");
    await seedOwnedRows(victim.id);
    await seedOwnedRows(bystander.id);
    const [fb] = await db.insert(feedbackTable).values({ body: `wqfb-del-marker-${Date.now()}` }).returning();
    createdFeedbackIds.push(fb!.id);
    const hash = `wqfb-del-cache-${Date.now()}`;
    await db.insert(resultCacheTable).values({ inputsHash: hash, modelId: "p-median-us", result: {} });
    createdCacheHashes.push(hash);
    expect(await counts(victim.id)).toEqual(ONE_EACH); // non-vacuity

    const res = await del(victim.cookie);
    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^nos_session=;/);

    expect(await counts(victim.id)).toEqual(NONE);
    expect(await counts(bystander.id)).toEqual(ONE_EACH);
    expect(await db.select().from(feedbackTable).where(eq(feedbackTable.id, fb!.id))).toHaveLength(1);
    expect(await db.select().from(resultCacheTable).where(eq(resultCacheTable.inputsHash, hash))).toHaveLength(1);
    expect((await request(app).get("/api/scenarios").set("Cookie", victim.cookie)).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: victim.email, password: PASSWORD, acceptTerms: true })).status).toBe(401);
  });

  // A running job with a fresh heartbeat is never claimed or reaped by any
  // dispatcher (claims take only queued rows; the reaper takes heartbeats
  // older than 60s). The queued job is legacy-shaped (no input_snapshot), which
  // the dispatcher scan skips (jobRunner.ts:620-626). Root CLAUDE.md: another
  // session's dispatcher shares nos_dev — if this flakes, check the registry.
  for (const status of ["running", "queued"] as const) {
    it(`409s while a job is ${status}, and deletes nothing`, async () => {
      const victim = await registerUser(`busy-${status}`);
      const { scenarioId } = await seedOwnedRows(victim.id);
      await db.insert(solveJobsTable).values({
        scenarioId, userId: victim.id, status, inputsHash: `wqfb-del-busy-${scenarioId}`,
        ...(status === "running" ? { claimedAt: sql`now()`, ownerHeartbeatAt: sql`now()` } : {}),
      });
      const res = await del(victim.cookie);
      expect(res.status).toBe(409);
      expect({ ...(await counts(victim.id)), solveJobs: 1 }).toEqual(ONE_EACH);
      expect((await counts(victim.id)).solveJobs).toBe(2);
    });
  }

  it("403s a wrong password and deletes nothing", async () => {
    const victim = await registerUser("wrongpw");
    await seedOwnedRows(victim.id);
    expect((await del(victim.cookie, "not-my-password")).status).toBe(403);
    expect(await counts(victim.id)).toEqual(ONE_EACH);
  });

  // D9 — the FK-race stand-in. A job the caller does not own (so the user-scoped
  // solve_jobs delete leaves it) still points at the caller's scenario, so the
  // scenarios delete fails on solve_jobs.scenario_id: the same FK a job enqueued
  // after the busy check would hit. The WHOLE transaction must roll back.
  it("rolls everything back when the scenario delete hits a solve_jobs FK, and answers the route's own 500", async () => {
    const victim = await registerUser("fkrace");
    const bystander = await registerUser("fkrace-other");
    const { scenarioId } = await seedOwnedRows(victim.id);
    const [foreign] = await db.insert(solveJobsTable)
      .values({ scenarioId, userId: bystander.id, status: "succeeded", inputsHash: `wqfb-del-fk-${scenarioId}` }).returning();
    try {
      const res = await del(victim.cookie);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Could not delete your account. Nothing was deleted. Try again." });
      // The victim's OWN job was deleted earlier in the same transaction; it is
      // back, which proves a rollback and not a partial delete.
      expect(await counts(victim.id)).toEqual(ONE_EACH);
      expect((await request(app).get("/api/scenarios").set("Cookie", victim.cookie)).status).toBe(200);
    } finally {
      await db.delete(solveJobsTable).where(and(eq(solveJobsTable.id, foreign!.id), eq(solveJobsTable.userId, bystander.id)));
    }
  });
});
```

- [ ] **Step 5: Run both and watch them fail.**
  Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/deleteAccountRoute.test.ts src/__tests__/deleteAccountIntegration.test.ts`
  Expected: FAIL. The mocked file cannot resolve `../services/deleteAccount.js`, and the route returns 404 for `DELETE /api/auth/account`.

- [ ] **Step 6: Create the service** `artifacts/api-server/src/services/deleteAccount.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { db, scenariosTable, solveJobsTable, usersTable } from "@workspace/db";

export type DeleteAccountOutcome = "deleted" | "busy" | "gone";

/**
 * WQF-B5 — deletes ONE user's own rows. Every statement is scoped by `userId`;
 * there is no unscoped mode (root CLAUDE.md: a destructive helper must not be
 * able to run wide from a test). Order is forced by FKs without cascade:
 * solve_jobs.{user_id,scenario_id} and scenarios.user_id (schema/solve_jobs.ts:34-35,
 * schema/scenarios.ts:8). scenarios.{result_run_id,latest_solve_job_id} are
 * ON DELETE SET NULL, so deleting solve_jobs first is safe. watbot_* rows go
 * by ON DELETE CASCADE from users. result_cache and feedback carry no user
 * link and are never touched.
 *
 * The users row lock (FOR UPDATE) conflicts with enqueueScenarioSolve's
 * FOR NO KEY UPDATE on the same row (jobRunner.ts:390) and with the FOR KEY
 * SHARE any solve_jobs insert takes through its FK, so a concurrent enqueue
 * waits and then fails its own FK, or Postgres aborts one side as a deadlock.
 * Either way a failure inside this transaction rolls everything back and the
 * caller answers "nothing was deleted" (D9).
 */
export async function deleteAccountData(userId: string): Promise<DeleteAccountOutcome> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, userId)).for("update");
    if (!locked) return "gone" as const;

    const [active] = await tx.select({ id: solveJobsTable.id }).from(solveJobsTable)
      .where(and(eq(solveJobsTable.userId, userId), inArray(solveJobsTable.status, ["queued", "running"])))
      .limit(1);
    if (active) return "busy" as const;

    await tx.delete(solveJobsTable).where(eq(solveJobsTable.userId, userId));
    await tx.delete(scenariosTable).where(eq(scenariosTable.userId, userId));
    await tx.delete(usersTable).where(eq(usersTable.id, userId));
    return "deleted" as const;
  });
}
```

- [ ] **Step 7: Route.** In `routes/auth.ts`:
  - Add `DeleteAccountBody` to the `@workspace/api-zod` import, plus `import { requireAuth } from "../middlewares/auth.js";` (merge into the line-20 import), `import { findUserById } from "../lib/sessionUser.js";`, and `import { deleteAccountData, type DeleteAccountOutcome } from "../services/deleteAccount.js";`.
  - Extract the logout clear (`:217-222`) into a helper and call it from logout:

```ts
function clearSessionCookie(res: Response) {
  const crossOrigin = process.env.NODE_ENV === "production";
  res.clearCookie(SESSION_COOKIE, { path: "/", sameSite: crossOrigin ? "none" : "lax", secure: crossOrigin });
}
```
  - Add, after the `/auth/user` handler (line 247):

```ts
// WQF-B5 — in-app account deletion. The id is ALWAYS the session's own
// (rule #5); nothing in the body names a user. No PostHog event (D10): a
// capture keyed on this id would recreate the person just deleted.
router.delete("/auth/account", requireAuth, async (req: Request, res: Response) => {
  const parsed = DeleteAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your current password to delete your account." });
    return;
  }
  // D8 — same per-IP budget as log-in: a stolen cookie must not become an
  // unlimited password oracle, and argon2 is the expensive part.
  if (loginLimiter.check(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many attempts, try again shortly" });
    return;
  }

  let user: Awaited<ReturnType<typeof findUserById>>;
  try {
    user = await findUserById(req.userId!);
  } catch {
    logger.error({ step: "account-delete-lookup" }, "account delete lookup failed");
    res.status(500).json({ error: "Could not delete your account. Nothing was deleted. Try again." });
    return;
  }
  const valid = user?.passwordHash ? await argon2.verify(user.passwordHash, parsed.data.password) : false;
  if (!user || !valid) {
    res.status(403).json({ error: "That password is not correct." });
    return;
  }

  // No error binding: a failed drizzle statement's message carries the user id.
  let outcome: DeleteAccountOutcome;
  try {
    outcome = await deleteAccountData(user.id);
  } catch {
    logger.error({ step: "account-delete" }, "account delete failed; transaction rolled back");
    res.status(500).json({ error: "Could not delete your account. Nothing was deleted. Try again." });
    return;
  }
  if (outcome === "busy") {
    res.status(409).json({ error: "A solve is still queued or running for your account. Wait for it to finish, then try again." });
    return;
  }
  clearSessionCookie(res); // "deleted", or "gone" (D11)
  res.status(204).send();
});
```

- [ ] **Step 8: Run Step 5's command again.** Expected: PASS, 8 mocked and 6 integration cases. To prove the no-binding catch, temporarily replace `catch {` with `catch (e) { throw e; }` in the delete `try`. The 500 case must then fail with `{ error: "Internal server error" }`. Revert.

- [ ] **Step 9: Per-task gate**, then **changelog** `### WQF-B6 — in-app account deletion`. The entry covers D8–D11, the deterministic FK stand-in and why the live race is serialised, the tests, the measured gate, and this follow-up: the deploy smoke's production test accounts could now clean themselves up through this endpoint (not done here). **Commit** `[WQF-B6] add in-app account deletion`.

---

### Task B7: Footer links and the delete dialog

**Role:** frontend-engineer. **Commit:** `[WQF-B7] add Terms, Privacy and Delete my account to the home footer`.

**Files:**
- Create: `artifacts/studio/src/components/AccountLinks.tsx`, `artifacts/studio/src/components/DeleteAccountDialog.tsx`
- Create: `artifacts/studio/src/__tests__/DeleteAccountDialog.test.tsx`, `artifacts/studio/src/__tests__/AccountLinks.test.tsx`
- Modify: `artifacts/studio/src/components/AppShell.tsx:1-14,113-118`, `artifacts/studio/src/__tests__/AppShell.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `useDeleteAccount` (B6), `/terms` and `/privacy` (B2).
- Produces: `AccountLinks()` with test ids `account-links`, `link-terms`, `link-privacy`, `link-delete-account`. `DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })` with test ids `dialog-delete-account`, `input-delete-password`, `button-confirm-delete`, `button-cancel-delete`, `alert-delete-error`.

- [ ] **Step 1: Invoke skills** (karpathy, then ponytail).

- [ ] **Step 2: Write the failing tests.** Create `DeleteAccountDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/", mockNavigate] }));
const mockSetQueryData = vi.fn();
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ setQueryData: mockSetQueryData }) }));
const mockMutate = vi.fn();
const mockReset = vi.fn();
let state: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: null };
vi.mock("@workspace/api-client-react", () => ({
  useDeleteAccount: () => ({ mutate: mockMutate, reset: mockReset, ...state }),
  getGetCurrentAuthUserQueryKey: () => ["getCurrentAuthUser"],
}));
const mockResetUser = vi.fn();
vi.mock("@/lib/analytics", () => ({ resetUser: () => mockResetUser() }));
const mockClearErrorUser = vi.fn();
vi.mock("@/lib/errorTracking", () => ({ clearErrorUser: () => mockClearErrorUser() }));
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: mockToast }));

import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";

beforeEach(() => {
  vi.clearAllMocks();
  state = { isPending: false, isError: false, error: null };
});

describe("DeleteAccountDialog", () => {
  it("names what is deleted, says it cannot be undone, and needs the password before confirming", async () => {
    render(<DeleteAccountDialog open onOpenChange={() => {}} />);
    const dialog = screen.getByTestId("dialog-delete-account");
    for (const phrase of ["scenarios", "solves", "WatBot", "cannot be undone"]) expect(dialog).toHaveTextContent(phrase);
    expect(screen.getByTestId("button-confirm-delete")).toBeDisabled();
    await userEvent.type(screen.getByTestId("input-delete-password"), "correcthorse1");
    expect(screen.getByTestId("button-confirm-delete")).toBeEnabled();
  });

  it("sends the password, then clears the session state and goes to Log in", async () => {
    mockMutate.mockImplementation((_v, { onSuccess }) => onSuccess());
    render(<DeleteAccountDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByTestId("input-delete-password"), "correcthorse1");
    await userEvent.click(screen.getByTestId("button-confirm-delete"));
    expect(mockMutate).toHaveBeenCalledWith({ data: { password: "correcthorse1" } }, expect.anything());
    expect(mockSetQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], { user: null });
    expect(mockResetUser).toHaveBeenCalled();
    expect(mockClearErrorUser).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Your account was deleted." }));
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("shows the server's sentence on failure, never a raw HTTP message", () => {
    state = { isPending: false, isError: true, error: Object.assign(new Error("HTTP 409 Conflict: {…}"), { status: 409, data: { error: "A solve is still queued or running for your account. Wait for it to finish, then try again." } }) };
    render(<DeleteAccountDialog open onOpenChange={() => {}} />);
    const alert = screen.getByTestId("alert-delete-error");
    expect(alert).toHaveTextContent("A solve is still queued or running");
    expect(alert.textContent).not.toMatch(/HTTP/);
  });

  it("cancel closes without deleting and resets the mutation", async () => {
    const onOpenChange = vi.fn();
    render(<DeleteAccountDialog open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByTestId("button-cancel-delete"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockReset).toHaveBeenCalled();
  });
});
```
  Create `AccountLinks.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/components/DeleteAccountDialog", () => ({
  DeleteAccountDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="dialog-delete-account" /> : null),
}));

import { AccountLinks } from "@/components/AccountLinks";

describe("AccountLinks", () => {
  it("renders Terms · Privacy · Delete my account in that order", () => {
    render(<AccountLinks />);
    expect(screen.getByTestId("account-links")).toHaveTextContent(/^Terms·Privacy·Delete my account$/);
    expect(screen.getByTestId("link-terms")).toHaveAttribute("href", "/terms");
    expect(screen.getByTestId("link-privacy")).toHaveAttribute("href", "/privacy");
  });

  it("opens the delete dialog only on click", async () => {
    render(<AccountLinks />);
    expect(screen.queryByTestId("dialog-delete-account")).toBeNull();
    await userEvent.click(screen.getByTestId("link-delete-account"));
    expect(screen.getByTestId("dialog-delete-account")).toBeInTheDocument();
  });
});
```
  In `AppShell.test.tsx`, add `vi.mock("@/components/AccountLinks", () => ({ AccountLinks: () => <div data-testid="account-links" /> }));` next to the FeedbackWidget mock (`:32`), and add:

```tsx
  it("puts the account links in the home footer only, never in the header beside Log out", () => {
    const { unmount } = render(<AppShell userEmail="s@example.test" hero heroTitle="Network Design Labs"><div /></AppShell>);
    const footer = screen.getByTestId("homepage-credit-footer");
    expect(footer).toContainElement(screen.getByTestId("account-links"));
    expect(document.querySelector("header")).not.toContainElement(screen.getByTestId("account-links"));
    unmount();
    render(<AppShell userEmail="s@example.test"><div /></AppShell>);
    expect(screen.queryByTestId("account-links")).toBeNull();
  });
```

- [ ] **Step 3: Run them and watch them fail.**
  Run: `pnpm --filter studio exec vitest run src/__tests__/DeleteAccountDialog.test.tsx src/__tests__/AccountLinks.test.tsx src/__tests__/AppShell.test.tsx`
  Expected: FAIL with `Failed to resolve import "@/components/DeleteAccountDialog"`.

- [ ] **Step 4: Create** `artifacts/studio/src/components/DeleteAccountDialog.tsx`:

```tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteAccount, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { describeWriteError } from "@/lib/describeWriteError";
import { resetUser } from "@/lib/analytics";
import { clearErrorUser } from "@/lib/errorTracking";
import { toast } from "@/hooks/use-toast";

export function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const deleteAccount = useDeleteAccount();
  const [password, setPassword] = useState("");

  function handleOpenChange(next: boolean) {
    if (!next) { setPassword(""); deleteAccount.reset(); }
    onOpenChange(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    deleteAccount.mutate({ data: { password } }, {
      onSuccess: () => {
        // Same synchronous cache clear as AppShell's logout, for the same Gate race.
        queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), { user: null });
        resetUser();
        clearErrorUser();
        toast({ title: "Your account was deleted." });
        navigate("/login", { replace: true });
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="dialog-delete-account">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>This permanently deletes, and cannot be undone:</DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-sm space-y-1">
            <li>your account and your record of accepting the terms</li>
            <li>your scenarios and all their solves</li>
            <li>your WatBot conversations, ratings and reports</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Anonymous site feedback cannot be traced to you and is not affected. Copies held by analytics and
            error-reporting services, and hosting backups, are not removed here; the Privacy Notice says how to ask.
          </p>
          {deleteAccount.isError && (
            <Alert variant="destructive" data-testid="alert-delete-error">
              <AlertDescription>{describeWriteError(deleteAccount.error, "Could not delete your account. Try again.")}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="delete-password">Current password</Label>
            <Input id="delete-password" type="password" autoComplete="current-password" maxLength={128} value={password}
              onChange={(e) => setPassword(e.target.value)} data-testid="input-delete-password" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-cancel-delete">Cancel</Button>
            <Button type="submit" variant="destructive" disabled={!password || deleteAccount.isPending} data-testid="button-confirm-delete">
              {deleteAccount.isPending ? "Deleting…" : "Delete my account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Create** `artifacts/studio/src/components/AccountLinks.tsx`:

```tsx
import { useState } from "react";
import { Link } from "wouter";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";

const MONO = "var(--app-font-mono)";

// WQF-B — lives in the home footer, deliberately far from the header's Log out
// button (spec B5), so a destructive action cannot be hit by a near-miss.
export function AccountLinks() {
  const [open, setOpen] = useState(false);
  const style = { color: "var(--text-brand)" };
  return (
    <div data-testid="account-links" className="mt-2 flex items-center justify-center gap-1.5"
      style={{ fontFamily: MONO, fontSize: "11px", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
      <Link href="/terms" className="underline" style={style} data-testid="link-terms">Terms</Link>
      <span aria-hidden>·</span>
      <Link href="/privacy" className="underline" style={style} data-testid="link-privacy">Privacy</Link>
      <span aria-hidden>·</span>
      <button type="button" className="underline" style={style} onClick={() => setOpen(true)} data-testid="link-delete-account">
        Delete my account
      </button>
      <DeleteAccountDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
```

- [ ] **Step 6: Mount it.** In `AppShell.tsx`, add `import { AccountLinks } from "@/components/AccountLinks";` and insert `<AccountLinks />` after `<DeveloperCredit />` (line 116), inside the `homepage-credit-footer`.

- [ ] **Step 7: Run Step 3's command again.** Expected: PASS.

- [ ] **Step 8: Per-task gate**, then **changelog** `### WQF-B7 — footer links and delete dialog`, then **Commit** `[WQF-B7] add Terms, Privacy and Delete my account to the home footer`.

---

### Task B8: Real-browser e2e for Part B, plus sibling-spec rewrites

**Role:** qa-sdet (exempt from karpathy/ponytail). Reviewed by a separate `fable` reviewer agent. **Commit:** `[WQF-B8] cover terms consent, reset landing and account deletion in the browser`.

**Files:**
- Create: `artifacts/studio/e2e/helpers/termsDb.ts`, `artifacts/studio/e2e/terms-consent.spec.ts`
- Modify (tick the box before a UI log-in click): `artifacts/studio/e2e/bundle4-auth-landing.spec.ts:84-87`, `artifacts/studio/e2e/design-upgrade-p5.spec.ts:382-385` and `:993-996`, `artifacts/studio/e2e/design-system.spec.ts:157-174`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: every test id from B2, B3, B5 and B7; `TERMS_VERSION` from `../src/pages/legal/legalMeta`.
- Produces: `psql(sql, vars)`, `makeTermsStale(email)`, `readTerms(email)`, `plantResetToken(email, token)` and `userExists(email)` in `e2e/helpers/termsDb.ts`.

- [ ] **Step 1: Start the local two servers** (`artifacts/studio/e2e/CLAUDE.md`). First check that the ports are free: `lsof -iTCP:3101 -sTCP:LISTEN; lsof -iTCP:5184 -sTCP:LISTEN` must print nothing; pick other ports if not.
  ```bash
  cd /Users/shubhamkr/nos-wqfb-8
  DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3101 pnpm --filter api-server run dev   # background
  PORT=5184 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3101 VITE_POSTHOG_KEY=phc_local_dummy_key VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 pnpm --filter studio run dev   # background
  ```

- [ ] **Step 2: Create the DB helper** `artifacts/studio/e2e/helpers/termsDb.ts`:

```ts
/**
 * WQF-B8 / D13 — the few Part B browser tests that must age or read a users
 * row reach the local database through psql, with every value bound by psql
 * itself (`:'name'` variables on stdin), never string-built. The studio
 * package gains no DB driver (same reasoning as global.teardown.ts).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export function psql(sql: string, vars: Record<string, string>): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (local e2e gate only)");
  const args = [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  return execFileSync("psql", args, { input: sql, encoding: "utf8", timeout: 15_000 }).trim().split("\n")[0] ?? "";
}

export function makeTermsStale(email: string): void {
  const id = psql("UPDATE users SET terms_version = NULL, terms_accepted_at = NULL WHERE email = :'email' RETURNING id;\n", { email });
  if (!id) throw new Error(`no users row for ${email}`);
}

export function readTerms(email: string): { version: string; acceptedAt: string } {
  const [version = "", acceptedAt = ""] = psql("SELECT terms_version, terms_accepted_at FROM users WHERE email = :'email';\n", { email }).split("|");
  return { version, acceptedAt };
}

export function plantResetToken(email: string, token: string): void {
  const hash = createHash("sha256").update(token).digest("hex"); // = lib/resetTokens.ts hashResetToken
  const id = psql(
    "UPDATE users SET reset_token_hash = :'hash', reset_token_expires_at = now() + interval '1 hour' WHERE email = :'email' RETURNING id;\n",
    { email, hash },
  );
  if (!id) throw new Error(`no users row for ${email}`);
}

export function userExists(email: string): boolean {
  return psql("SELECT count(*) FROM users WHERE email = :'email';\n", { email }) === "1";
}
```

- [ ] **Step 3: Write the spec** `artifacts/studio/e2e/terms-consent.spec.ts`:

```ts
/**
 * WQF-B — Part B in a real browser: the terms box, the stale-terms log-in
 * (one-time log-out), the reset-password landing, the legal pages and the
 * delete-account dialog. Target: E2E_BASE_URL (local two-server recipe,
 * e2e/CLAUDE.md). Tests that age or read a users row also need DATABASE_URL;
 * the e2e gate step requires 0 skipped in this file.
 */
import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "./fixtures";
import { TERMS_VERSION } from "../src/pages/legal/legalMeta";
import { makeTermsStale, plantResetToken, readTerms, userExists } from "./helpers/termsDb";

const T = 15_000;
const PASSWORD = "correcthorse1";
const newEmail = (tag: string) => `e2e-wqfb-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
const needsDb = () => test.skip(!process.env.DATABASE_URL, "needs DATABASE_URL (local e2e gate only)");

async function registerViaApi(page: Page, tag: string): Promise<string> {
  const email = newEmail(tag);
  const res = await page.request.post("/api/auth/register", { data: { email, password: PASSWORD, acceptTerms: true } });
  expect(res.status()).toBe(201);
  return email;
}

async function logInThroughForm(page: Page, email: string, password = PASSWORD) {
  await page.getByTestId("input-email").fill(email);
  await page.getByTestId("input-password").fill(password);
  await expect(page.getByTestId("button-login")).toBeDisabled();
  await page.getByTestId("checkbox-accept-terms").check({ timeout: T });
  await page.getByTestId("button-login").click({ timeout: T });
}

test.describe("terms consent (unauthenticated)", () => {
  test.use({ storageState: undefined });

  for (const [path, button] of [["/login", "button-login"], ["/register", "button-register"]] as const) {
    test(`${path}: the box starts unticked and the button stays disabled until it is ticked`, async ({ page }) => {
      await page.goto(path);
      const box = page.getByTestId("checkbox-accept-terms");
      await expect(box).toBeVisible({ timeout: T });
      await expect(box).not.toBeChecked();
      await expect(page.locator("label[for='accept-terms']")).toHaveText("I agree to the Terms of Service and the Privacy Notice (FERPA, GDPR)");
      await page.getByTestId("input-email").fill(newEmail("box"));
      await page.getByTestId("input-password").fill(PASSWORD);
      await expect(page.getByTestId(button)).toBeDisabled();
      await box.check({ timeout: T });
      await expect(page.getByTestId(button)).toBeEnabled();
      await box.uncheck({ timeout: T });
      await expect(page.getByTestId(button)).toBeDisabled();
    });
  }

  test("the consent links open the Terms and the Privacy Notice in a new tab", async ({ page }) => {
    await page.goto("/login");
    for (const [id, pageId] of [["link-consent-terms", "page-terms"], ["link-consent-privacy", "page-privacy"]] as const) {
      await expect(page.getByTestId(id)).toHaveAttribute("target", "_blank");
      const [popup] = await Promise.all([page.context().waitForEvent("page"), page.getByTestId(id).click({ timeout: T })]);
      await expect(popup.getByTestId(pageId)).toBeVisible({ timeout: T });
      await popup.close();
    }
    await expect(page).toHaveURL(/\/login$/); // the form tab never navigated
  });

  test("/terms and /privacy are public and marked as a draft", async ({ page }) => {
    for (const [path, id] of [["/terms", "page-terms"], ["/privacy", "page-privacy"]] as const) {
      await page.goto(path);
      await expect(page.getByTestId(id)).toBeVisible({ timeout: T });
      await expect(page.getByTestId("legal-draft-banner")).toBeVisible(); // WQF-B9 flips this to toHaveCount(0)
      await expect(page.getByTestId("legal-version")).toHaveText(`Version ${TERMS_VERSION}`);
    }
  });

  test("registering through the form records the current terms version", async ({ page }) => {
    needsDb();
    const email = newEmail("reg");
    await page.goto("/register");
    await page.getByTestId("input-email").fill(email);
    await page.getByTestId("input-password").fill(PASSWORD);
    await page.getByTestId("checkbox-accept-terms").check({ timeout: T });
    await page.getByTestId("button-register").click({ timeout: T });
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
    const row = readTerms(email);
    expect(row.version).toBe(TERMS_VERSION);
    expect(row.acceptedAt).not.toBe("");
  });
});

test.describe("one-time log-out (B4) and terms_required (B3)", () => {
  test.use({ storageState: undefined });

  test("a stale user is signed out, the API refuses without the box, and the form records acceptance", async ({ page }) => {
    needsDb();
    const email = await registerViaApi(page, "stale");
    await page.goto("/");
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T }); // non-vacuity: signed in first

    makeTermsStale(email);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/, { timeout: T });

    const refused = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual({ error: "terms_required" });
    expect(refused.headers()["set-cookie"]).toBeUndefined();

    await expect(page.getByTestId("checkbox-accept-terms")).not.toBeChecked();
    await logInThroughForm(page, email);
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
    expect(readTerms(email).version).toBe(TERMS_VERSION);
  });
});

test.describe("reset-password landing (B2)", () => {
  test.use({ storageState: undefined });

  test("a stale account's reset lands on Log in with a notice; ticking the box gets in", async ({ page }) => {
    needsDb();
    const email = await registerViaApi(page, "reset-stale");
    makeTermsStale(email);
    const token = randomBytes(32).toString("base64url");
    plantResetToken(email, token);
    await page.goto(`/reset-password#token=${token}`);
    await page.getByTestId("input-new-password").fill("brandnewpass1");
    await page.getByTestId("button-set-password").click({ timeout: T });
    await expect(page).toHaveURL(/\/login\?reset=done$/, { timeout: T });
    await expect(page.getByTestId("alert-password-changed")).toHaveText("Your password was changed. Log in to continue.");
    await logInThroughForm(page, email, "brandnewpass1");
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
  });

  test("a current account's reset signs straight in", async ({ page }) => {
    needsDb();
    const email = await registerViaApi(page, "reset-current");
    await page.context().clearCookies();
    const token = randomBytes(32).toString("base64url");
    plantResetToken(email, token);
    await page.goto(`/reset-password#token=${token}`);
    await page.getByTestId("input-new-password").fill("brandnewpass1");
    await page.getByTestId("button-set-password").click({ timeout: T });
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
  });
});

test.describe("delete my account (B5)", () => {
  test.use({ storageState: undefined });

  test("the footer link opens a dialog away from Log out; a wrong password is refused; the right one deletes", async ({ page }) => {
    const email = await registerViaApi(page, "delete");
    await page.goto("/");
    const footer = page.getByTestId("homepage-credit-footer");
    await expect(footer.getByTestId("link-delete-account")).toBeVisible({ timeout: T });
    await expect(page.locator("header").getByTestId("link-delete-account")).toHaveCount(0);
    await expect(footer.getByTestId("account-links")).toHaveText(/Terms\s*·\s*Privacy\s*·\s*Delete my account/);

    await footer.getByTestId("link-delete-account").click({ timeout: T });
    const dialog = page.getByTestId("dialog-delete-account");
    await expect(dialog).toBeVisible({ timeout: T });
    await expect(dialog).toContainText("cannot be undone");
    await expect(page.getByTestId("button-confirm-delete")).toBeDisabled();

    await page.getByTestId("input-delete-password").fill("not-my-password");
    await page.getByTestId("button-confirm-delete").click({ timeout: T });
    await expect(page.getByTestId("alert-delete-error")).toHaveText("That password is not correct.", { timeout: T });

    await page.getByTestId("input-delete-password").fill(PASSWORD);
    await page.getByTestId("button-confirm-delete").click({ timeout: T });
    await expect(page).toHaveURL(/\/login$/, { timeout: T });
    const login = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD, acceptTerms: true } });
    expect(login.status()).toBe(401);
    if (process.env.DATABASE_URL) expect(userExists(email)).toBe(false);
  });

  test("cancel closes the dialog and deletes nothing", async ({ page }) => {
    await registerViaApi(page, "delete-cancel");
    await page.goto("/");
    await page.getByTestId("homepage-credit-footer").getByTestId("link-delete-account").click({ timeout: T });
    await page.getByTestId("button-cancel-delete").click({ timeout: T });
    await expect(page.getByTestId("dialog-delete-account")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: T });
  });
});
```

- [ ] **Step 4: Run the new spec against local code.**
  ```bash
  cd /Users/shubhamkr/nos-wqfb-8/artifacts/studio
  DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" E2E_BASE_URL=http://localhost:5184 npx playwright test e2e/terms-consent.spec.ts --reporter=list
  ```
  Expected: every test passes, **0 skipped**. To check that the tests can fail, temporarily remove `|| !acceptedTerms` from `Login.tsx`'s `disabled`: the `/login` box test must fail at `toBeDisabled`. Revert.

- [ ] **Step 5: Sibling rewrites** (root gotcha: a UI change breaks earlier bundles' specs). Sweep for any other site that clicks a submit button without ticking the box:
  ```bash
  grep -nE 'button-(login|register)"\)\.click|goto\("/(login|register)"' artifacts/studio/e2e/*.spec.ts | grep -v -E 'terms-consent|labs\.spec'
  ```
  Insert `await page.getByTestId("checkbox-accept-terms").check({ timeout: 10_000 });` immediately before each UI submit click. Known sites:
  - `bundle4-auth-landing.spec.ts`: before line 87 (`button-login` click in "/login shows an error alert on a bad login")
  - `design-upgrade-p5.spec.ts`: before line 385 (log in again after logout) and before line 996 (the Q9 login-error alert)
  - `design-system.spec.ts`: before line 174 (button background): tick first, so the measured colour is the enabled button students click. With `disabled:opacity-50` the `backgroundColor` would read the same, but the assertion should keep measuring the state it was written for.

  Then run those three files plus `password-reset.spec.ts`:
  ```bash
  DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" E2E_BASE_URL=http://localhost:5184 npx playwright test e2e/bundle4-auth-landing.spec.ts e2e/design-upgrade-p5.spec.ts e2e/design-system.spec.ts e2e/password-reset.spec.ts --reporter=list
  ```
  Expected: all pass. `design-upgrade-p5` needs `tile.openstreetmap.org` (`e2e/CLAUDE.md`); a tile failure there is environmental.

- [ ] **Step 6: Gate.** `pnpm --filter studio run typecheck:e2e` is clean, plus the per-task gate.

- [ ] **Step 7: Changelog** `### WQF-B8 — Part B in the browser`. The entry covers D13, the spec's test list with pass/skip counts, and the sibling rewrites. **Commit** `[WQF-B8] cover terms consent, reset landing and account deletion in the browser`. Stop both dev servers you started, by their PIDs only.

---

### Task B9: Owner legal sign-off — final version, remove the draft banner

**Role:** frontend-engineer. **Owner-gated:** dispatch only after the owner confirms that a qualified person has reviewed the text, and supplies the approval date and any text edits (Owner input 2). **Commit:** `[WQF-B9] adopt the reviewed terms and remove the draft banner`.

**Files:**
- Modify: `artifacts/api-server/src/lib/terms.ts`, `artifacts/studio/src/pages/legal/legalMeta.ts`, `artifacts/studio/src/pages/legal/LegalPage.tsx`, `artifacts/studio/src/pages/legal/legalText.ts` (reviewer edits only, verbatim)
- Modify: `artifacts/studio/src/__tests__/LegalPage.test.tsx`, `artifacts/studio/e2e/terms-consent.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: the owner's approval date `YYYY-MM-DD` and the reviewed text.
- Produces: `CURRENT_TERMS_VERSION === TERMS_VERSION === <approval date>`. `LEGAL_DRAFT` and `legal-draft-banner` no longer exist.

- [ ] **Step 1: Invoke skills** (karpathy, then ponytail).

- [ ] **Step 2: Flip the tests first.** In `LegalPage.test.tsx`, replace the "shows the draft banner…" case with the block below and drop `LEGAL_DRAFT` from the import. In `terms-consent.spec.ts`, change the banner line to `await expect(page.getByTestId("legal-draft-banner")).toHaveCount(0);`.

```tsx
  it("no longer shows a draft banner (the owner confirmed a qualified review)", () => {
    render(<LegalPage doc={PRIVACY_NOTICE} />);
    expect(screen.queryByTestId("legal-draft-banner")).toBeNull();
  });
```

- [ ] **Step 3: Run it and watch it fail.** `pnpm --filter studio exec vitest run src/__tests__/LegalPage.test.tsx`. Expected: FAIL, because the banner is present.

- [ ] **Step 4: Implement.** Delete the `LEGAL_DRAFT` export and its comment from `legalMeta.ts`. Delete the `{LEGAL_DRAFT && (…)}` block and `LEGAL_DRAFT` from the import in `LegalPage.tsx`. Set `CURRENT_TERMS_VERSION` in `terms.ts` and `TERMS_VERSION` in `legalMeta.ts` to the owner's approval date (same value). Apply the reviewer's text edits to `legalText.ts`, word for word. If an edit removes a phrase that `LegalPage.test.tsx` asserts (a service name, "FERPA", "Delete my account", "cannot be traced back to you", "backups", "GDPR"), stop and ask the lead; do not weaken the test.

- [ ] **Step 5: Verify.**
  ```bash
  pnpm --filter studio exec vitest run src/__tests__/LegalPage.test.tsx src/__tests__/termsVersionDrift.test.ts
  grep -rn "LEGAL_DRAFT\|legal-draft-banner" artifacts/studio/src && echo "STILL PRESENT" || echo "CLEAN"
  ```
  Expected: PASS and `CLEAN`. (`terms-consent.spec.ts` asserts `toHaveCount(0)`. That test id is the only remaining reference, and it lives under `e2e/`, not `src/`.)

- [ ] **Step 6: Per-task gate**, then **changelog** `### WQF-B9 — reviewed terms adopted`. The entry records the owner's confirmation date, and that bumping the version signs out every local dev user once. It names no reviewer and no personal data. **Commit** `[WQF-B9] adopt the reviewed terms and remove the draft banner`.

---

### Task B10: Close-out gates on `wqf-b`

**Role:** lead (Opus). No code. The results go into B11's changelog record.

- [ ] **Step 1:** In a fresh worktree of the `wqf-b` tip, run `pnpm gate` with 0 concurrent vitest. Exit 0 is required. Exit 3 means a timeout-hit run, so re-run serially. Exit 1 is a real failure. Record the measured counts for api-server, studio and pytest.
- [ ] **Step 2:** Solver-wiring check (`CLAUDE.md`: these are not pytest-discovered). Against the local api-server from B8 Step 1, run `cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3101/api auth` and `python3 e2e_accuracy.py`. Expected: both clean, with `e2e_accuracy.py` unmodified (hard rule #2).
- [ ] **Step 3:** e2e gate against local code, using the two-server recipe from B8 Step 1:
  ```bash
  cd <wqf-b worktree>
  DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" E2E_BASE_URL=http://localhost:5184 pnpm e2e:gate
  ```
  Expected: green, apart from registered flakes, which are matched by name and re-run twice in isolation. Then confirm `terms-consent.spec.ts` shows **0 skipped**: `node -e 'const r=require("./artifacts/studio/e2e/report/results.json");const s=[];(function w(x){for(const k of x.suites||[])w(k);for(const sp of x.specs||[])if(sp.file.includes("terms-consent"))for(const t of sp.tests)s.push(t.status)})(r);console.log(s)'` must list no `skipped`.
- [ ] **Step 4:** Draft guard: `grep -rn "LEGAL_DRAFT\|legal-draft-banner" artifacts/studio/src` prints nothing (B9 landed).

### Task B11: Finish the branch, merge, whole-branch review, retro

**Role:** lead (Opus). Order per root `CLAUDE.md` Branch discipline (D12).

- [ ] **Step 1:** Invoke `superpowers:finishing-a-development-branch`. Its output is a recommendation, not an approval.
- [ ] **Step 2: HARD STOP.** Ask the owner for **merge approval**. List B1–B9 with their SHAs and the B10 gate numbers, and say that production is not yet migrated.
- [ ] **Step 3:** On approval: `git fetch origin`, then confirm local `main` is not stale (`git merge-base --is-ancestor origin/main main`). Create a merge worktree: `git worktree add /Users/shubhamkr/nos-wqfb-merge main`. Run `git merge --no-ff wqf-b` there, alone and not piped, then check `git rev-parse --abbrev-ref HEAD` = `main`. For `docs/CHANGELOG-implementation.md`, resolve as main's text verbatim plus this branch's lines.
- [ ] **Step 4:** **Whole-branch review on the merged state:** an Opus reviewer agent (`model: opus`) plus `ponytail:ponytail-review` over `main^1..main`. Brief: the spec Part B, this plan's Decisions, and Global Constraints. Fixes go **back on the branch** (step 5a: `git switch wqf-b` in its worktree; new commit `[WQF-B-R<n>] …`), then re-merge, then re-run B10 Steps 1 and 3 on the merged state.
- [ ] **Step 5:** `/harness-retro WQF-B`. Its metrics row, failure causes and the second-occurrence gate rule are handled per `.claude/skills/harness-retro/SKILL.md`.
- [ ] **Step 6:** Append a `### WQF-B — merged and reviewed` changelog line on a **new branch** (`wqf-b-merge-record`, rule 1: every commit on its own branch), then merge it locally after the same approval chain.

### Task B12: Deploy runbook — schema first, then nos-studio, then nos-api

**Role:** lead, with the owner. Invoke the **`render-ops` skill** first. Every step below is its own approval; one approval never covers the next.

- [ ] **Step 1: Production schema push FIRST** (`docs/ops/schema-push-before-deploy.md`; D14: before `origin/main` moves). The change only adds nullable columns, so the runbook's step 2 backup is not required, and step 3 applies. **The owner runs it, or explicitly approves the lead running it.** The production connection string never enters this transcript or any file.
  1. Pre-check on the merged `main` against local `nos_dev`: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter @workspace/db push` reports no changes, which proves the schema and local state match.
  2. Owner's IP on the database allowlist (runbook step 1).
  3. `DATABASE_URL="<production connection string>?sslmode=require" pnpm --filter @workspace/db push -- --verbose --strict`. **Accept only** the two statements `ALTER TABLE "users" ADD COLUMN "terms_version" text;` and `ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;`. Any other statement means abort and stop.
  4. Verify by querying, not by trusting the push output: `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name LIKE 'terms_%' ORDER BY column_name;` must return the two rows from B4 Step 3. Remove the allowlist entry afterwards.
- [ ] **Step 2: Push approval.** Before asking, run the PRIV-1 scan of `git log origin/main..main -p` for personal emails, IPs and production ids. The owner's public contact address is the one expected hit. The push request states that a push to `main` is deploy-adjacent: it may ship nos-studio, which is the intended first service, and it arms nos-api (`autoDeployTrigger: commit`). If nos-api builds before nos-studio, every log-in from the old studio is refused with `terms_required` until nos-studio ships. In that case deploy nos-studio immediately. Push only on an explicit yes, then run `list_deploys` for both services.
- [ ] **Step 3: nos-studio deploy approval.** Run `pnpm deploy:preflight -- <deployed-sha>..HEAD` and include its checklist in the request. The request states: the studio now requires the tick and sends `acceptTerms`; the old API ignores the field, so acceptances in this window are not recorded and those students are asked again once the API ships; deploy nos-api right after. Re-fetch `origin/main` before triggering, because Render builds the tip. Trigger, then `list_deploys` until live.
- [ ] **Step 4: nos-api deploy approval**, requested immediately after nos-studio is live. The request includes the preflight checklist (schema: **migrated in Step 1**, with the verification output) and states in plain words: **"Every signed-in user will be logged out when this deploy goes live, and must log in again with the terms box ticked."** Trigger, then `list_deploys` until live.
- [ ] **Step 5: Verify production.** `pnpm smoke --env production` (`cookie_attributes` registers with `acceptTerms: true` since B1). Then the **owner** logs in at the production studio: a previously signed-in browser lands on Log in, the box is unticked, the button is disabled until ticked, the log-in succeeds, and `/terms` and `/privacy` show no draft banner. Check Sentry for new `NOS-API` errors on `/api/auth/*` in the first 15 minutes.
- [ ] **Step 6:** Record the deploy in the changelog on a new branch (`wqf-b-deploy-record`): SHAs, times, smoke result, and the owner's log-in check. No production ids. Merge and push it under the same per-step approvals.

---

## Self-review

- **Spec coverage:**
  - B1 pages and the privacy content (what is stored, the six outside services, rights, the contact address, FERPA framing): B2, with text tests.
  - B1 draft-until-review: B2 banner, B9 removal, B10 Step 4 guard.
  - B2 checkbox (unticked, exact text, new-tab links, disabled button; forgot-password unchanged): B3 + B8. Reset-password cookie only when current, contract unchanged, studio to Log in: B5 + B8.
  - B3 columns, constant, `acceptTerms` in both requests with codegen, register 400 and record, log-in 403 `terms_required` with no cookie and record on accept: B1 + B4.
  - B4 session check in `sessionUser`/`requireAuth`: B5. One-time log-out at deploy and its approval wording: B12 Step 4.
  - B5 footer links away from Log out, the dialog with password, `DELETE /api/auth/account` with the lock, 409, ordered deletes, cascades, cookie clear, no-binding catch, `result_cache`/`feedback` untouched, the privacy statement on anonymous feedback and on third parties: B2, B6, B7, B8.
  - B6 deploy order: B12.
  - Testing lines: B3/B4 route tests with and without `acceptTerms` (B4); session version test (B5); B5 real-Postgres exact-rows plus 409 (B6); real-browser layout assertions (B8); full gate plus e2e gate with `E2E_BASE_URL` (B10).
- **Placeholder scan:** the one value the plan cannot contain is the owner's contact address (B2 Step 5), which is an explicit owner input. `termsVersionDrift.test.ts` fails until it is set, so it cannot ship blank. `renderAt` in B2 Step 2 names the existing `App.test.tsx` helper, which the task must use under its real name. The `<n>` and `<measured counts>` values in changelog templates are measured per task.
- **Type consistency:** `CURRENT_TERMS_VERSION` (server), `TERMS_VERSION` (studio), `termsVersion`/`termsAcceptedAt` (drizzle), `TermsRequiredError`, `DeleteAccountBody`/`useDeleteAccount`, `deleteAccountData`/`DeleteAccountOutcome`, and the test ids are spelled identically in every task that produces or consumes them.
