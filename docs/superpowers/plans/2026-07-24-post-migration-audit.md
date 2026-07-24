# Post-Migration Bug-Class Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systematically find other latent bugs in the same categories the Render migration already surfaced today, plus any other blockers the migration introduced or exposed, across the whole repo — before a real student hits them.

**Architecture:** Eight independent, read-only audit tasks. Each produces a **written findings report**, not a code diff — this is a diagnostic pass, not a build. Fixing what's found is explicitly the controller's (human's assistant's) decision afterward, not part of this plan. This is a deliberate adaptation of the writing-plans template: there is no code to test-drive for a pure audit, so each task's "steps" are concrete investigation actions (grep for X, read file Y at these lines, run command Z, record the exact result) instead of TDD RED/GREEN steps, and each task's "test" is the report existing with every checklist item answered from real evidence, not assumption.

**Tech Stack:** Existing repo tooling only (grep, git log, pnpm/vitest/pytest, `render` CLI, `render` MCP server) — no new dependencies.

## Global Constraints

- **Read-only.** No task in this plan edits application code, `render.yaml`, or any Render resource. Grep/read/run diagnostic commands only. `render psql`/CLI reads are fine; nothing that mutates a live resource (no `update_environment_variables`, no `trigger_deploy`, no schema pushes).
- **Every finding needs file:line evidence**, not a hunch — this mirrors the task-reviewer convention already used all session ("Your report should point at evidence: file:line references for every finding").
- **Severity triage is the controller's job, not the auditor's.** Each report lists what was found; it does NOT recommend "fix this now" — that's a decision for after all eight reports are in, made by the human/controller with full cross-task context.
- **Executed via the `glm` subagent type** (Read/Grep/Bash-via-`glm_agent`) for every task — established pattern this session for read-only investigation work.
- Full context on what already broke and why, for calibration: the auth-routing race (merged `AuthedRouter`/`UnauthedRouter` into one fixed `<Switch>`, commit `9f21477`) and the unreachable create-scenario dialog (commit `e6daf7e`) — both were "first-time/empty-state path nobody's test or manual check ever exercised." Several tasks below explicitly hunt for more of exactly that shape.

---

## Task 1: Untested first-run / empty-state UI paths (client-side)

**Files (read-only targets):**
- `artifacts/studio/src/pages/*.tsx`, `artifacts/studio/src/components/**/*.tsx`
- `artifacts/studio/src/__tests__/*.test.tsx` (to check what's actually covered)

**Interfaces:**
- Consumes: nothing from other tasks (fully independent).
- Produces: a findings list other tasks don't depend on, but Task 8 (e2e) should read it before proposing which flows to script.

- [ ] **Step 1: Enumerate every early-return / conditional-render branch keyed on "empty" or "no data yet" state**

Run:
```bash
grep -rn "if (!.*\.length)\|if (!.*?\.length)\|scenarios?.length\|^\s*if (!.*data)" artifacts/studio/src/pages/*.tsx artifacts/studio/src/components/**/*.tsx
```
Also manually scan `Landing.tsx`, `Compare.tsx`, `ImportDialog.tsx`, `WarehouseTable.tsx`, `CustomerTable.tsx` for any `if (...) return (...)` before the component's main return.

- [ ] **Step 2: For every early-return branch found, check whether it renders EVERY dialog/consumer its own buttons can trigger**

The bug pattern already found (`Studio.tsx`'s `!scenarios?.length` branch calling `setShowCreateDialog(true)` with no `<Dialog>` in that branch) is the exact template. For each early return: list every `onClick`/`onChange` handler inside it, trace what state each one sets, and confirm the JSX that reads that state is reachable from the SAME branch (not just from the component's main/other return). Report each branch as "clean" (consumer reachable) or "suspect" (consumer NOT reachable from this branch, quote both the trigger and where the real consumer JSX lives).

- [ ] **Step 3: Check test coverage for each early-return branch found in Step 1**

For each one, search `artifacts/studio/src/__tests__/` for a test that actually renders the component with the EMPTY/zero-data mock state (not just the populated state). Report which branches have zero test coverage of the empty case — that's the same coverage gap that let the create-dialog bug through.

- [ ] **Step 4: Write the report**

Save to `.superpowers/sdd/audit-task1-empty-states.md`: a table of every early-return branch found (file:line), whether its triggers' consumers are reachable (clean/suspect + evidence), and whether it has empty-state test coverage (yes/no + test file:line if yes).

---

## Task 2: `invalidateQueries` + `navigate`/`setLocation` race audit

**Files (read-only targets):**
- `artifacts/studio/src/pages/Studio.tsx`, `artifacts/studio/src/pages/Compare.tsx` (already known to contain this pattern — confirmed via `grep -rln "invalidateQueries" artifacts/studio/src --include="*.tsx"`)
- Any other file the grep below turns up.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: findings that inform whether the same fix class applied to `Login.tsx`/`Register.tsx`/`AppShell.tsx` (write `queryClient.setQueryData(...)` directly instead of `invalidateQueries` + wait) needs to be applied elsewhere too.

- [ ] **Step 1: Find every co-occurrence of a mutation's `onSuccess` calling both `invalidateQueries` and a navigation call**

Run:
```bash
grep -n "invalidateQueries" artifacts/studio/src/pages/Studio.tsx artifacts/studio/src/pages/Compare.tsx
grep -n "navigate(\|setLocation(" artifacts/studio/src/pages/Studio.tsx artifacts/studio/src/pages/Compare.tsx
```
Read both files around every match to see the full `onSuccess` block each belongs to (mutation name, what it invalidates, what it navigates to).

- [ ] **Step 2: For each occurrence, assess the actual race risk**

The auth bug's race required TWO SEPARATE `<Switch>` trees swapping based on the async state — that's what made it a hard 404, not just a flicker. For each occurrence found in Step 1, answer: does this navigation move to a route that could be rendered by a DIFFERENT parent-level conditional tree than the one currently mounted (real 404/dead-end risk, same shape as the fixed bug), or does it navigate within a single stable tree that's already fully mounted (lower risk — at worst a stale-data flash, not a dead end)? Quote the exact route being navigated to and what renders it.

- [ ] **Step 3: Check if any of these already have regression test coverage for the specific timing (not just "navigate was called with X")**

Grep the corresponding test files (`Studio.test.tsx`, `Compare.test.tsx`) for whether the mutation's mocked `onSuccess` actually simulates async timing (a `setTimeout`/promise delay before invoking the callback) or just calls it synchronously in the same tick — synchronous-only mocks can't catch this class of bug, same lesson as `Login.test.tsx`/`Register.test.tsx` before today's fix.

- [ ] **Step 4: Write the report**

Save to `.superpowers/sdd/audit-task2-invalidate-navigate-races.md`: every occurrence found, the race-risk assessment (real dead-end risk vs. minor staleness), and whether existing tests would catch a regression.

---

## Task 3: Hardcoded/stale URL and env-var completeness audit

**Files (read-only targets):**
- Whole repo for hardcoded URLs; `render.yaml` + every `process.env.*` read in `artifacts/api-server/src` and `artifacts/studio` for env-var completeness.

**Interfaces:**
- Consumes: nothing.
- Produces: a checklist the controller can use to sanity-check `render.yaml` against reality before the next deploy.

- [ ] **Step 1: Find every hardcoded `onrender.com` (or other absolute prod-looking URL) reference in source**

Run:
```bash
grep -rln "onrender.com" --include="*.ts" --include="*.tsx" --include="*.yaml" --include="*.json" . 2>/dev/null | grep -v node_modules
```
(Already known from earlier work: only `render.yaml` and `artifacts/api-server/src/__tests__/cors.test.ts` matched — confirm this is STILL true, since new code may have landed since. If a NEW hardcoded URL shows up anywhere in `artifacts/`, quote it and flag as suspect — it's exactly the class of bug that caused the `VITE_API_BASE_URL` mismatch fixed earlier today.)

- [ ] **Step 2: List every `process.env.*` read in the API server, cross-check each against `render.yaml`**

Run:
```bash
grep -rn "process\.env\." artifacts/api-server/src --include="*.ts" | grep -v __tests__
```
For each distinct env var name found (expect at least: `SESSION_SECRET`, `CORS_ALLOWED_ORIGIN`, `NODE_ENV`, `SOLVE_WORKER_CONCURRENCY`, `SOLVE_QUEUE_DEPTH_LIMIT`, `LOG_LEVEL`, `DATABASE_URL`, `PORT`), check whether `render.yaml`'s `nos-api` service declares it (either a fixed `value`, `generateValue: true`, or `fromDatabase`). Report any env var the code reads that render.yaml does NOT set (it would silently fall back to a default or throw) and any env var render.yaml sets that the code never reads (dead config).

- [ ] **Step 3: Do the same cross-check for the studio static site's build-time env vars**

Run:
```bash
grep -rn "import\.meta\.env\." artifacts/studio/src --include="*.ts" --include="*.tsx" | grep -v __tests__
```
Cross-check each against `render.yaml`'s `nos-studio` `envVars` block and `vite.config.ts`'s own required-env-var checks (`PORT`, `BASE_PATH`).

- [ ] **Step 4: Write the report**

Save to `.superpowers/sdd/audit-task3-url-envvar-audit.md`: any new hardcoded URLs found (should be none beyond the two known ones), the full env-var cross-check table (code reads it? render.yaml sets it? mismatch flagged), for both services.

---

## Task 4: Production error-handling audit

**Files (read-only targets):**
- `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, every file under `artifacts/api-server/src/routes/`.

**Interfaces:**
- Consumes: nothing.
- Produces: a concrete example (request + response) the controller can use to decide whether a JSON error-handling middleware is worth adding.

- [ ] **Step 1: Confirm there is no catch-all Express error-handling middleware**

Run:
```bash
grep -rn "err, req, res, next\|errorHandler\|app.use((err" artifacts/api-server/src --include="*.ts" | grep -v __tests__
```
(Already checked once today: zero matches. Confirm this is still the case, and read `app.ts` in full to double check no 4-argument middleware exists anywhere, including inside `routes/index.ts`'s router setup.)

- [ ] **Step 2: Confirm what an actually-thrown, unhandled exception in a route currently returns**

Already reproduced once today: a genuine unhandled exception in `POST /auth/register` returned a raw `500` with an HTML "Internal Server Error" body (Express's built-in default handler), not the API's own JSON convention (`{"error": "..."}`) used by every deliberately-written error response elsewhere in this codebase. Confirm this is still Express's actual default behavior by reading the Express version in `artifacts/api-server/package.json` and checking whether Express 5 changed this default (it uses `finalhandler` internally — confirm whether that still emits HTML by default or JSON, since this affects how severe the gap is).

- [ ] **Step 3: Check whether NODE_ENV=production actually suppresses stack traces in that default HTML page**

Read Express/`finalhandler`'s documented behavior (check `node_modules/express`'s own docs/source if present, or Express's public docs knowledge) for whether the default error page includes the stack trace when `NODE_ENV !== 'development'`. This matters for information disclosure, not just UX polish.

- [ ] **Step 4: Write the report**

Save to `.superpowers/sdd/audit-task4-error-handling.md`: confirmation of the missing catch-all handler, the exact current behavior (HTML vs JSON, stack trace exposed or not), and what every OTHER route in this codebase does instead (the `{error: "..."}` convention) so the controller can see the inconsistency clearly.

---

## Task 5: DB connection-pool capacity audit

**Files (read-only targets):**
- `lib/db/src/index.ts`
- `artifacts/api-server/src/solver/jobRunner.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a concrete number (max concurrent DB connections this app can open) vs. the plan's actual limit, for the controller to decide if `basic_256mb` is enough.

- [ ] **Step 1: Read the current `pg.Pool` configuration in full**

`lib/db/src/index.ts` — confirm (already known) that `new Pool({connectionString, ssl})` sets no explicit `max`. Check `pg`'s own documented default pool size (its own package, check `node_modules/pg/lib/defaults.js` or equivalent if present in this environment, or state the well-known default of 10 if the source isn't inspectable here).

- [ ] **Step 2: Read `jobRunner.ts`'s worker pool concurrency**

Already known: `CONCURRENCY = parsePositiveIntEnv(process.env.SOLVE_WORKER_CONCURRENCY, DEFAULT_CONCURRENCY)`. Read the file to get the exact `DEFAULT_CONCURRENCY` value, and confirm whether each concurrent solve job holds a DB connection for its full duration (check `runJob`'s DB calls — `markRunning`, `markSucceeded`/`markFailed`, the `result_cache` lookup/write-through) or only briefly at start/end.

- [ ] **Step 3: Find Render's documented connection limit for the `basic_256mb` Postgres plan**

Check if this information exists anywhere already fetched/cached in this repo (e.g., in `docs/superpowers/plans/2026-07-24-render-migration.md` or CLAUDE.md) from earlier work. If not documented anywhere accessible, state clearly in the report that this specific number needs to be looked up from Render's own plan documentation (do not guess a number) — flag it as an open question for the controller rather than inventing a figure.

- [ ] **Step 4: Write the report**

Save to `.superpowers/sdd/audit-task5-db-pool-capacity.md`: the app's own max-connections behavior (pool default × however many Node processes/instances — check `render.yaml`'s `nos-api` for any `numInstances`/scaling config too), the worker concurrency number, and whichever of "confirmed headroom" / "confirmed at risk" / "unknown, needs Render's plan docs" applies.

---

## Task 6: Graceful shutdown / zero-downtime redeploy audit

**Files (read-only targets):**
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/solver/jobRunner.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a description of what currently happens to an in-flight solve job when Render redeploys `nos-api`.

- [ ] **Step 1: Confirm there is no SIGTERM/SIGINT handler**

Run:
```bash
grep -rn "SIGTERM\|SIGINT\|process.on(" artifacts/api-server/src --include="*.ts" | grep -v __tests__
```
(Already checked once today: zero matches.) Confirm still true.

- [ ] **Step 2: Trace what actually happens to an in-flight solve job on process termination**

Read `jobRunner.ts`'s `runSolverProcess` (the `spawn("python3", [SOLVER_PY])` call) — when the parent Node process receives SIGTERM and Node's default behavior kills it, does the spawned Python child become an orphan that keeps running, or does it die with the parent (check whether `spawn` is called with `detached` true/false, and whether there's any `child.unref()` — the default without `detached` should tie child lifetime to the parent on most platforms, but confirm from the actual code, don't assume)? Also trace what happens to the corresponding `solve_jobs` row — does it stay stuck in `"running"` forever (never marked failed/succeeded), since `markFailed`/`markSucceeded` would never get called if the process is killed mid-job?

- [ ] **Step 3: Check Render's documented redeploy behavior for zero-downtime**

Note whether `nos-api`'s `render.yaml` config has anything relevant (health check grace period, etc.) and whether a single-instance Starter-plan service (no `numInstances > 1`) can even achieve zero-downtime redeploys at all, or whether every redeploy has an inherent brief gap — this affects how much a graceful-shutdown handler would actually help versus not.

- [ ] **Step 4: Write the report**

Save to `.superpowers/sdd/audit-task6-graceful-shutdown.md`: confirmed absence of a shutdown handler, the traced fate of an in-flight solve job + its DB row on a kill, and whether single-instance Starter plan makes this a bigger or smaller concern than it would be with multiple instances.

---

## Task 7: Cross-user ownership isolation — re-verify against the REAL deployed API

**Files (read-only targets):** none — this is a live-API check, not a code read. Use `curl` against `https://nos-api-uwf8.onrender.com` (the real deployed API).

**Interfaces:**
- Consumes: nothing (independent), but note for the controller: this duplicates in spirit what A2.2 already verified — but that was against the LOCAL dev DB, months before this app was ever deployed publicly. This is the first time this specific guarantee gets checked against the real production database and real network conditions.

- [ ] **Step 1: Register two distinct test users against the real deployed API**

```bash
curl -s -c /tmp/audit-user-a.txt -X POST https://nos-api-uwf8.onrender.com/api/auth/register \
  -H "Content-Type: application/json" -H "Origin: https://nos-studio.onrender.com" \
  -d '{"email":"audit-user-a@example.com","password":"auditpassword123"}'
curl -s -c /tmp/audit-user-b.txt -X POST https://nos-api-uwf8.onrender.com/api/auth/register \
  -H "Content-Type: application/json" -H "Origin: https://nos-studio.onrender.com" \
  -d '{"email":"audit-user-b@example.com","password":"auditpassword123"}'
```
Record both users' real ids from the JSON response bodies.

- [ ] **Step 2: User A creates a scenario; confirm User B cannot read, update, or delete it**

```bash
curl -s -b /tmp/audit-user-a.txt -X POST https://nos-api-uwf8.onrender.com/api/scenarios \
  -H "Content-Type: application/json" -H "Origin: https://nos-studio.onrender.com" \
  -d '{"name":"Audit isolation check","modelId":"p-median-us","inputs":{"p":3,"capacityMode":"none","uniformCapacity":null,"warehouseOverrides":[],"customerOverrides":[],"distanceBands":[200,400,800,1600],"gap":0,"timeLimitSec":60}}'
```
Record the returned scenario `id`, call it `<id>`. Then, using User B's cookie jar (`/tmp/audit-user-b.txt`):
```bash
curl -s -i -b /tmp/audit-user-b.txt https://nos-api-uwf8.onrender.com/api/scenarios/<id>
curl -s -i -b /tmp/audit-user-b.txt -X PATCH https://nos-api-uwf8.onrender.com/api/scenarios/<id> -H "Content-Type: application/json" -d '{"name":"hijacked"}'
curl -s -i -b /tmp/audit-user-b.txt -X DELETE https://nos-api-uwf8.onrender.com/api/scenarios/<id>
```
Expected per CLAUDE.md's hard rule: all three return **404** (never 403 — that's the anti-enumeration convention this codebase commits to). Record the ACTUAL status codes and bodies.

- [ ] **Step 3: Confirm `GET /api/scenarios` (list) never includes the other user's scenario**

```bash
curl -s -b /tmp/audit-user-b.txt https://nos-api-uwf8.onrender.com/api/scenarios
```
Confirm User A's scenario id/name does not appear anywhere in User B's list.

- [ ] **Step 4: Write the report**

Save to `.superpowers/sdd/audit-task7-cross-user-isolation.md`: exact status codes and response bodies for every check in Steps 2-3, and a clear PASS/FAIL verdict against the "always 404, never 403, never leaked in list" requirement.

---

## Task 8: Formal recommendation — close the standing e2e test-debt now that real infra exists

**Files (read-only targets):**
- `artifacts/studio/e2e/labs.spec.ts`
- `artifacts/studio/e2e/import.spec.ts` (the one spec that DOES pass against current HEAD, per CLAUDE.md — use as the template for what "written against current API shape" looks like)
- `artifacts/studio/vite.config.ts` (the `API_PROXY_TARGET` dev-proxy mechanism from D5.2)

**Interfaces:**
- Consumes: Task 1's findings (which empty-state/first-run paths are riskiest) and Task 2's findings (which invalidate+navigate occurrences are riskiest) — this task should explicitly reference both when proposing which flows most need e2e coverage.
- Produces: a scoped, concrete proposal (not an implementation) for what `labs.spec.ts` needs rewritten to cover, given everything found today and in Tasks 1-7.

- [ ] **Step 1: Read `labs.spec.ts`'s current (stale) assertions**

Quote exactly what it currently asserts (the pre-D0 API shape per CLAUDE.md's gotcha) so the proposal can say precisely what needs to change, not just "it's stale."

- [ ] **Step 2: Read `import.spec.ts` as the reference pattern for a spec written against current HEAD**

Confirm how it authenticates (register/login flow), how it talks to the API (via the `API_PROXY_TARGET` dev proxy vs. hitting the real deployed environment directly), and whether that same pattern could ALSO be pointed at the real deployed `nos-studio`/`nos-api` (via `E2E_BASE_URL`) instead of local dev, given today's finding that same-origin local dev is too fast to reliably catch timing-dependent bugs like the auth race.

- [ ] **Step 3: Propose a concrete, minimal `labs.spec.ts` rewrite scope**

Based on Task 1/2's findings plus today's two real bugs, list the SPECIFIC flows worth scripting first (e.g.: register a brand-new account with zero scenarios → click "Create first scenario" → confirm dialog opens and scenario is created — this is the literal empty-state bug from today; login → refresh → still authenticated; logout → confirm redirected to `/login` with no 404). Do not write the actual spec file — this task's deliverable is the proposal, not the implementation.

- [ ] **Step 4: Write the report**

Save to `.superpowers/sdd/audit-task8-e2e-debt-proposal.md`: the current `labs.spec.ts` gap, the reusable pattern from `import.spec.ts`, and the concrete flow list to script first — ordered by risk, referencing Task 1/2's findings by file:line.

---

## Self-Review

**Spec coverage:** the six bug/blocker categories named in the goal (untested first-run UI paths, invalidate+navigate races, deploy-config drift, production error-handling gaps, DB connection-pool limits, graceful-shutdown behavior) each map to Task 1, 2, 3, 4, 5, 6 respectively. Cross-user isolation (a category not explicitly named in the original ask but directly implied by "other blockers the migration may have exposed," and the single highest-severity category if it ever regressed) gets its own Task 7. The standing e2e debt this whole day's investigation kept surfacing as the root systemic cause gets a dedicated closure proposal in Task 8, explicitly consuming Task 1/2's findings so it isn't a generic "write more tests" refrain but a specifically-targeted one.

**Placeholder scan:** no task says "add appropriate handling" or "TBD" — every step names the exact grep command, exact file, or exact curl request to run, and Task 5/6's genuinely-unknown facts (Render's plan connection limit, Render's exact redeploy grace-period behavior) are explicitly flagged as "look this up, don't guess" rather than silently assumed.

**Type/interface consistency:** report file paths (`.superpowers/sdd/audit-task{N}-*.md`) are consistent across all 8 tasks; Task 8 is the only one with a real cross-task dependency (on 1 and 2), stated explicitly in its Interfaces block.
