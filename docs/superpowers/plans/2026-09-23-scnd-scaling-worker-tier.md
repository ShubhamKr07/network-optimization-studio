# SCND Scaling — Worker Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move solves off the API's request path onto an isolated solver worker tier that claims from Option A's durable `solve_jobs` queue, with bounded automatic retry, serialized admission, and — only if the measured topology demands it — a scheduled scaler.

**Architecture:** Option A already owns the durable queue, the CAS claim, the owner lease, boot recovery and SIGTERM drain, all running *inside the API process*. This plan does not duplicate any of it. It adds (1) a `solve_claimants` registry so claimants are identifiable and their willingness to claim is observable, (2) a `SOLVE_DISPATCH_MODE` seam that lets the same codebase boot as API-with-dispatcher, API-enqueue-only, worker, or worker-standby, (3) a retry protocol on top of A's lease reclaim, (4) an admission decision serialized with the enqueue it guards, and (5) topology-conditional scheduling. API and worker use the same Dockerfile/dependency tree and must deploy the same commit; Render may still build that definition independently for each service unless image reuse is configured, so the plan does not assume one physical build or identical digest without evidence.

**Tech Stack:** TypeScript / Node 24, Express 5, Drizzle ORM on Postgres 16 (`drizzle-kit push`, no migration files), vitest + supertest, Python 3 / PuLP / CBC via `spawn`, Render (Docker web service + background worker), `pnpm` monorepo.

**Spec:** `docs/superpowers/specs/2026-09-22-scnd-scaling-design.md` (Rev: six review rounds folded, S-R1…S-R23). Section references below (§1.2, §3.1, …) are to that spec and are normative. Where this plan and the spec disagree, **the spec wins and the plan is wrong** — report it rather than papering over it.

**Review verdict (2026-09-24): APPROVED AS A CONDITIONAL EXECUTION PLAN.** The task decomposition and architecture are implementable, and the corrections from this review are folded into the normative steps below. This is **not approval to start Phase 1 today**: S0 must first prove that Option A is merged, Stage 1 is explicitly approved, Measurement has selected an outcome, and — for every worker path — the Stage-2 sizing/configuration pack and live connection ceiling pass. Unknown downstream values that this plan is designed to produce (V10, V11 and V14) do not block implementation; values consumed by implementation do.

---

## Global Constraints

- **Hard rule #1** — never hand-edit generated code under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. API shape changes go through `lib/api-spec/openapi.yaml` + Orval regen, committed together.
- **Hard rule #2** — `artifacts/api-server/src/solver/tests/e2e_accuracy.py` is sacred and must pass unmodified. **This plan touches zero solver math and zero datasets**, so it must pass byte-identically; re-run it only if a task unexpectedly touches Python.
- **Hard rule #3** — adding a NOT NULL column to a populated table uses the two-step protocol. *Deviation note (rule #8): `attempts integer NOT NULL DEFAULT 0` is added in one statement, because a constant DEFAULT makes Postgres supply the value for existing rows atomically; the protocol exists for NOT NULL adds with no default. `claimant_id` and `next_attempt_at` are nullable and unaffected.*
- **Hard rule #4** — one task = one commit, `[<task-id>] <imperative summary>`.
- **Hard rule #5** — ownership filtering is security-critical: every user-facing row lookup filters by `user_id`, and non-owned resources return **404**, never 403. Service-internal claim/reaper/retention operations and global admission aggregates necessarily cross users; they run only under the server's control-plane role, expose no other user's rows or identifiers, and have negative API tests proving that this exception cannot reach a response.
- **Hard rule #6** — solver changes enter as data, not branches. This plan adds no `solve.py` code paths.
- **Branch discipline** — all work on a descriptive branch (`scnd-scaling-worker-tier`), never direct to `main`. Upstream set at the first stable checkpoint.
- **A is a hard prerequisite.** Nothing here executes until Option A is complete and merged. Preflight asserts it.
- **Never weaken A.** A2's ownership-gated completion predicate, A2's version-mismatch terminal failure, and A7's publication CAS are consumed, not modified. A task that finds itself editing them has misread the spec.
- **Schema before claimant code.** All schema changes here are additive. Push and verify the final schema against an isolated staging database before deploying API/worker code, then against production before the standby worker deploy. The rollback is code/mode only; do not drop the additive columns/tables during rollback. Since this repo uses `drizzle-kit push` rather than migration files, the runbook records the exact schema diff and operator evidence.
- **No production cutover before the pre-cutover gate.** A staging rehearsal, the applicable automated reliability suite, the final-built-topology capacity run, and (for O4) the scaler failure suite and coalescing measurement all precede S7.2. Production cutover is followed by a bounded smoke/operational verification; it is never used to discover whether the design works.
- **Verification gate — run before considering any task done:**
  ```bash
  pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test
  ```
  Python is untouched; the solver pytest suite and `e2e_accuracy.py` are run once at Preflight as a baseline and once at the final gate as a no-regression confirmation.

---

## The value-resolution protocol

This plan is written **before** Measurement has produced its numbers. That is deliberate and safe because no unknown measured number is silently substituted: each is a **resolution step** that reads the real value from a named source before its consumer executes (spec §10, register V1–V14).

**The rule that makes this safe, and the only one that matters:**

> **A missing value is a STOP, never a substitution.**
> If the named source does not exist, is empty, or contradicts itself: **halt the task, report what was looked for and where, and wait.** Do not infer a plausible number. Do not carry a spec "starting value" forward as if it were measured. Do not proceed with a placeholder intending to fix it later.

The spec's starting values (`MAX_ATTEMPTS=3`, backoff `5 s`/`60 s`, `MAX_RUNNING_PER_USER=1`, `MAX_QUEUED_PER_USER=3`, ±20 % jitter, `Retry-After` clamp 5–120 s, `worker_pool = CONCURRENCY + 2`) exist so the design can be argued with. **They are exactly the kind of plausible number that makes a silent substitution invisible.** They may exist as development defaults in a config module, but production may use them only after the responsible evidence/product decision ratifies them and the S0.3 pack records that provenance.

Every resolution step in this plan writes its result to a single append-only file, `docs/superpowers/metrics/scaling-resolved-values.md`, with the value, its source, the resolving command or artifact, and the date. That file is the audit trail: at the end, every V-row is either recorded there with provenance or visibly absent.

Measured values that enter runtime behavior must also be materialized as validated configuration (`SOLVE_SLOTS_PER_WORKER`, `SOLVE_MEAN_SERVICE_SEC`, the ratified queue-wait SLO, pool sizes, worker plan/count and wake-up mode). The Markdown register is evidence, not a runtime configuration source. Production boot must fail closed when a required value for the selected path is absent or malformed.

## Required execution order

The numbered phases group related work; they do **not** override this dependency order:

1. **S0.1–S0.2:** prove A/Stage-1 prerequisites and select the outcome branch.
2. **S0.3:** for a worker branch, finish the Stage-2 evidence/configuration pack and connection ledger. This is the authorization boundary before code changes.
3. **S1–S6:** build registry, modes, worker, retry/claim, admission and retention.
4. **O4 only: S9.1–S9.3:** build and test the scheduled scaler before claiming a fleet topology exists.
5. **S7.1 then S8.1a:** rehearse in a production-like non-production Render environment and pass the applicable final-topology capacity/reliability gate. O4 also resolves S10.1 here; if it fires, the successor single-flight design/build must finish and join G-FLEET before proceeding.
6. **S7.2:** only after the preceding go/no-go passes and SP-4 names a window, perform production cutover.
7. **Post-cutover S8.1b then S8.2:** run the bounded production smoke/operational checks and publish the pilot decision. MP-4 remains required before students use the tier.

Any task text below that appears to permit a different order is subordinate to this dependency list.

---

## File Structure

**New:**

| File | Responsibility |
|---|---|
| `lib/db/src/schema/solve_claimants.ts` | The claimant registry table (§1.3). Schema only — no logic |
| `lib/db/src/schema/solve_admission.ts` | The singleton admission-lock row; created and seeded before admission can run |
| `artifacts/api-server/src/solver/claimantRegistry.ts` | Register at boot, heartbeat, mark ready, stop accepting claims, and the single `claimableWorkerPredicate` every consumer uses |
| `artifacts/api-server/src/solver/dispatchMode.ts` | Parse + fail-closed validate `SOLVE_DISPATCH_MODE`; expose `isClaimant()`, `servesHttp()`, `mode` |
| `artifacts/api-server/src/solver/admission.ts` | The serialized admission transaction and `Retry-After` computation (§3.2) |
| `artifacts/api-server/src/worker/index.ts` | Worker entrypoint — boots in `worker_only`/`worker_standby`, no HTTP listener |
| `artifacts/api-server/src/solver/retentionSweep.ts` | Bounded, off-peak cleanup (§6) |
| `scripts/src/scaling/scaler.ts` | **O4 only.** Render API desired-count setter + reconciliation |
| `docs/ops/scnd-class-calendar.yaml` | **O4 only.** The source calendar (§2.2) |
| `docs/ops/scnd-worker-cutover.md` | The five-step cutover runbook + rollback |
| `docs/superpowers/metrics/scaling-resolved-values.md` | Append-only resolved-value audit trail |

**Modified:**

| File | Change |
|---|---|
| `lib/db/src/schema/solve_jobs.ts` | `+ attempts`, `+ next_attempt_at`, `+ claimant_id` FK. **`worker_id` is never added** (S-R16) |
| `lib/db/src/index.ts` | Export the new table |
| `artifacts/api-server/src/solver/jobRunner.ts` | Mode-gate the dispatcher; attempts at claim; conditional reclaim in `reapStaleLeases()`; stamp `claimant_id` |
| `artifacts/api-server/src/index.ts` | Mode-gate boot; register claimant; drain sets `accepting_claims=false` |
| `artifacts/api-server/src/routes/scenarios.ts` | Replace the `QUEUE_DEPTH_LIMIT` pre-check with `admission.ts` |
| `render.yaml` | Add the worker service; keep `maxShutdownDelaySeconds` explicit |

**Tests** follow the split A established: real-Postgres integration under `artifacts/api-server/src/solver/__tests__/`, mocked unit tests under `artifacts/api-server/src/__tests__/`.

---

## Phase 0 — Preflight

### Task S0.1: Prerequisite gates

**Files:** none (verification only)

- [ ] **Step 0: Start from a clean, current `main`.** Inspect `git status --short`; if tracked or untracked work is present, **STOP** rather than sweeping it into this branch. Confirm this reviewed plan is itself on `main` before creating the implementation branch.

- [ ] **Step 1: Assert Option A is complete and merged**

```bash
for task in A4 A5 A6 A7 A8 A9 A10 A11 A12 A13; do
  git log --format='%s' main | rg -q "\\[$task\\]" || { echo "missing $task"; exit 1; }
done
```
Expected: no output and exit 0. Then run A's exported contract tests for the queue/lease/recovery/publication interfaces this plan consumes. **If any A task or contract test is missing → STOP.** The previous count/regex checked only a subset and could falsely authorize a partial A.

- [ ] **Step 2: Assert Stage 1 (architecture/spec) approval is recorded**

Read `docs/superpowers/specs/2026-09-22-scnd-scaling-design.md`'s Status line. Expected: an explicit approval, not "REQUEST CHANGES", not this plan's own assertion. **If absent → STOP and ask.**

Also verify the approved text consistently applies S-R23: O1/O2 + SP-1(a) requires the recorded **hold** decision and G-WORKER, while only SP-1(b) requires a waiver and G-API. If any generic Stage-3 sentence still says every O1/O2 path requires a waiver, treat it as an unresolved spec conflict and **STOP for the spec erratum**; this plan cannot override a normative contradiction.

- [ ] **Step 3: Baseline the gate**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x) \
  && (cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```
Record the counts. `e2e_accuracy.py` is expected at **99/99**. **If red before any change → STOP**; do not start work on a broken baseline.

- [ ] **Step 4: Create the branch and the audit file**

```bash
git switch main
git switch -c scnd-scaling-worker-tier
test ! -e docs/superpowers/metrics/scaling-resolved-values.md || {
  echo "resolved-value register already exists; inspect instead of overwriting"; exit 1;
}
mkdir -p docs/superpowers/metrics
printf '# Scaling — resolved values\n\nAppend-only. One row per resolved register value (spec §10).\nA missing value is a STOP, never a substitution.\n\n| V | Value | Resolved to | Source | Date |\n|---|---|---|---|---|\n' \
  > docs/superpowers/metrics/scaling-resolved-values.md
git add docs/superpowers/metrics/scaling-resolved-values.md
git commit -m "[S0.1] preflight: branch + resolved-value audit trail"
```

### Task S0.2: Resolve V1 (outcome row) and V2 (SP-1), then branch

**Files:**
- Modify: `docs/superpowers/metrics/scaling-resolved-values.md`

**Interfaces:**
- Produces: the **selected outcome row**, which every later phase's applicability depends on.

- [ ] **Step 1: Resolve V1 — the outcome row**

Read Measurement's topology decision document (spec §10 V1: M5.2 topology runs + M5.4 gate verdicts). Extract the selected row: **O1**, **O2**, **O3**, or **O4**.

**If that document does not exist, or names no single row → STOP.** Measurement Phases 3–5 have not delivered. Report: "V1 unresolved — no topology decision document at `<path>`." Do not assume O3 because it is the middle option; do not assume O4 because this plan has the most tasks for it.

- [ ] **Step 2: Resolve V2 — SP-1, only if V1 ∈ {O1, O2}**

Ask the product owner the §1.1 checkpoint question verbatim, including **both consequences** (§1.1a):
> (a) Hold the isolation rule → build the minimum dedicated worker tier anyway; you pay for an always-on worker the measured load does not require.
> (b) Record a waiver → run a real cohort on a non-isolated API tier, relying on A's shipped queue/lease/recovery/drain.

**STOP and wait for the answer.** Never assume either. If V1 ∈ {O3, O4}, SP-1 does not fire — record "n/a, worker tier satisfies the rule by construction."

- [ ] **Step 3: Determine this plan's applicable scope**

| V1 | V2 | Execute | Gate set |
|---|---|---|---|
| O1 / O2 | (b) waiver | **Phases 1–8 do not apply.** Stop this plan; the deliverable is the recorded waiver + G-API evidence | G-API |
| O1 / O2 | (a) hold | Phases 1–8 | G-WORKER |
| O3 | n/a | Phases 1–8 | G-WORKER |
| O4 | n/a | Phases 1–8, **plus 9–10** | G-FLEET |

- [ ] **Step 4: Record and commit**

Append V1 and V2 rows to the audit file with source and date.

```bash
git add docs/superpowers/metrics/scaling-resolved-values.md
git commit -m "[S0.2] resolve V1 outcome row and V2 SP-1; select plan scope"
```

### Task S0.3: Stage-2 worker-path authorization pack

**Applicability:** O1/O2 + SP-1(a), O3 and O4. O1/O2 + waiver (b) stops this plan at S0.2 and uses G-API.

**Files:**
- Modify: `docs/superpowers/metrics/scaling-resolved-values.md`
- Create: `docs/ops/scnd-connection-ledger.md`, `docs/ops/scnd-scaling-runtime-config.md`

- [ ] **Step 1: Resolve the implementation inputs, not implementation outputs.** Resolve V3 (`cpu_N`), V4 (`N`), V5 (`mean_service_sec`), V6 (cache-hit rate), V7 (per-solve peak RSS), and V8 (worker plan, count and slots) from the named Measurement artifacts. Recompute the chosen count/cost from those operands rather than merely copying the topology label. Select `SOLVE_WAKEUP_MODE=notify|poll` from the measured latency need and record the choice. If any required source is absent or still provisional, **STOP**. V10 (observed rolling-deploy peak), V11 (boot-to-first-claim), and V14 (coalescing result) are produced later and do not block this step.

  **Two source-specific warnings, because a generic STOP is not actionable enough here:**

  - **V5 needs a Measurement *change*, not merely a Measurement run.** `simulate.py`'s `SimResult` has no `mean_service_sec` field today — it exposes `p50_wait`, `p95_wait`, `p95_end_to_end`, `max_queue_depth`, `utilization`, `observed_stratum_mix`. The operand is one division over `total_solver_wall`, which `simulate()` already accumulates for `utilization`. So the STOP here is "raise a one-line addition with Measurement," not "wait indefinitely." **Never substitute `cpu_N`** — it is a CPU-time quantity answering a different question, and doing so is the exact error spec rounds 3 and 4 corrected (S-R12, S-R13).
  - **V7 sets `slots_per_instance` via `capacity.py: map_to_instances(...)`.** Derive it from measured per-solve peak RSS, **not** from the instance's advertised memory — memory, not CPU, is what caps slots per box, and advertised memory ignores what a solve actually holds.
- [ ] **Step 2: Materialize validated runtime configuration.** Record the selected Render worker plan/count (and O4 cron plan/cost), API and worker transaction-pool sizes, `SOLVE_SLOTS_PER_WORKER`, `SOLVE_WORKER_CONCURRENCY` (equal to slots), dispatcher batch limit (at least concurrency), `SOLVE_MEAN_SERVICE_SEC`, ratified queue-wait SLO, retry/cap values, claimant heartbeat/staleness, consecutive-failed-scan threshold, drain gate/platform shutdown delay, wake-up mode, and notification-session count. Starting values may be adopted only when the responsible Measurement/product decision explicitly ratifies them and the register records that provenance.
- [ ] **Step 3: Complete the maximum-simultaneous connection ledger before adding a worker service.** Use:

  ```text
  peak_total = api_generations    × api_instances    × api_pool
             + worker_generations × worker_instances × worker_pool
             + worker_generations × worker_instances × notify_sessions
             + controller_connections
             + migration_and_operations_reserve
  ```

  Use two API and worker generations for rolling-deploy overlap. `notify_sessions=1` only for `notify`; each overlapping worker generation owns its own dedicated `LISTEN` connection. `controller_connections=1` only for O4. Name, source and owner for the operations reserve; it is not an unexplained plug number.
- [ ] **Step 4: Resolve V9 only after the ledger is complete.** Run `SHOW max_connections` on the target Postgres service and check `peak_total <= max_connections - platform_reserved_connections`. If it does not fit, choose and cost a larger database plan or transaction pooler; a pooler does **not** absorb dedicated `LISTEN` sessions. Recompute and revalidate before proceeding.
- [ ] **Step 5: Record the Stage-2 authorization checkpoint.** The three artifacts must identify the selected outcome, exact Measurement artifact versions, configuration values, ledger arithmetic, live ceiling evidence and approver/date. Commit: `[S0.3] authorize measured worker topology and connection budget`. **Phase 1 may not start without this checkpoint.**

---

## Phase 1 — Claimant registry

### Task S1.1: `solve_claimants` schema

**Files:**
- Create: `lib/db/src/schema/solve_claimants.ts`
- Modify: `lib/db/src/index.ts`
- Test: `artifacts/api-server/src/solver/__tests__/claimantRegistry.test.ts`

**Interfaces:**
- Produces: `solveClaimantsTable`, `ClaimantRole = "api" | "worker"`.

- [ ] **Step 1: Write the failing test**

```ts
// claimantRegistry.test.ts — real Postgres
import { db, solveClaimantsTable } from "@workspace/db";

it("rejects an unknown role", async () => {
  await expect(
    db.insert(solveClaimantsTable).values({
      claimantId: "c1", role: "scheduler", mode: "worker_only",
      claimGeneration: 1, acceptingClaims: true,
    }),
  ).rejects.toThrow(/CK_solve_claimants_role/);
});

it("defaults accepting_claims to true", async () => {
  await db.insert(solveClaimantsTable).values({
    claimantId: "c2", role: "worker", mode: "worker_only", claimGeneration: 2,
  });
  const [row] = await db.select().from(solveClaimantsTable)
    .where(eq(solveClaimantsTable.claimantId, "c2"));
  expect(row!.acceptingClaims).toBe(true);
});

it("rejects a role/mode combination that can poison capacity accounting", async () => {
  await expect(db.insert(solveClaimantsTable).values({
    claimantId: "c3", role: "api", mode: "worker_only", claimGeneration: 3,
  })).rejects.toThrow(/CK_solve_claimants_role_mode/);
});
```

- [ ] **Step 2: Run it; expect failure**

`pnpm --filter api-server test claimantRegistry` → FAIL, `solveClaimantsTable` is not exported.

- [ ] **Step 3: Write the schema**

```ts
// lib/db/src/schema/solve_claimants.ts
import { pgTable, text, integer, timestamp, boolean, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Scaling §1.3. Claimant liveness is a DIFFERENT question from job liveness:
// solve_jobs.owner_heartbeat_at (A2) says "this job's owner is alive";
// heartbeat_at here says "this process is alive" whether or not it owns work,
// which is what makes an idle pre-scaled worker observable (S-R9).
// accepting_claims is a THIRD question — willingness, not liveness (S-R17).
export const solveClaimantsTable = pgTable("solve_claimants", {
  claimantId: text("claimant_id").primaryKey(),
  role: text("role").notNull(),
  mode: text("mode").notNull(),
  claimGeneration: integer("claim_generation").notNull(),
  bootedAt: timestamp("booted_at").notNull().defaultNow(),
  readyAt: timestamp("ready_at"),
  heartbeatAt: timestamp("heartbeat_at").notNull().defaultNow(),
  acceptingClaims: boolean("accepting_claims").notNull().default(true),
}, (t) => [
  // The claimable_worker predicate's covering index.
  index("IDX_solve_claimants_claimable")
    .on(t.heartbeatAt)
    .where(sql`${t.role} = 'worker' AND ${t.mode} = 'worker_only'
               AND ${t.readyAt} IS NOT NULL AND ${t.acceptingClaims}`),
  check("CK_solve_claimants_role", sql`${t.role} IN ('api', 'worker')`),
  check("CK_solve_claimants_mode",
    sql`${t.mode} IN ('api_dispatch', 'enqueue_only', 'worker_only', 'worker_standby')`),
  check("CK_solve_claimants_role_mode", sql`
    (${t.role} = 'api' AND ${t.mode} IN ('api_dispatch', 'enqueue_only')) OR
    (${t.role} = 'worker' AND ${t.mode} IN ('worker_only', 'worker_standby'))
  `),
]);

export type SolveClaimant = typeof solveClaimantsTable.$inferSelect;
```

Export it from `lib/db/src/index.ts` alongside the existing schema exports.

- [ ] **Step 4: Push the schema and re-run**

```bash
test -n "$SCND_DEV_DATABASE_URL" || { echo "SCND_DEV_DATABASE_URL is required"; exit 1; }
DATABASE_URL="$SCND_DEV_DATABASE_URL" pnpm --filter @workspace/db push
pnpm --filter api-server test claimantRegistry
```
Expected: PASS. `SCND_DEV_DATABASE_URL` must name an isolated non-production database; never paste a production URL into this task.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/solve_claimants.ts lib/db/src/index.ts \
        artifacts/api-server/src/solver/__tests__/claimantRegistry.test.ts
git commit -m "[S1.1] solve_claimants registry schema + claimable-worker index"
```

### Task S1.2: Registration, readiness, heartbeat, and the one predicate

**Files:**
- Create: `artifacts/api-server/src/solver/claimantRegistry.ts`
- Test: `artifacts/api-server/src/solver/__tests__/claimantRegistry.test.ts` (extend)

**Interfaces:**
- Consumes: `getBootClaimGeneration()` from `jobRunner.ts` (A2, existing).
- Produces:
  ```ts
  export function getClaimantId(): string;
  export async function registerClaimant(role, mode, generation): Promise<void>;
  export async function markClaimantReady(): Promise<void>;
  export async function heartbeatClaimant(): Promise<boolean>;
  export async function stopAcceptingClaims(): Promise<void>;
  export function configureClaimantTiming(env: NodeJS.ProcessEnv): void;
  export function claimableWorkerPredicate(): SQL;      // the ONLY definition
  export async function countClaimableWorkers(): Promise<number>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it("a drainer is excluded from the claimable count but remains a live row", async () => {
  await registerClaimant("worker", "worker_only", 10);
  await markClaimantReady();
  expect(await countClaimableWorkers()).toBe(1);

  await stopAcceptingClaims();
  expect(await countClaimableWorkers()).toBe(0);           // excluded

  const [row] = await db.select().from(solveClaimantsTable)
    .where(eq(solveClaimantsTable.claimantId, getClaimantId()));
  expect(row).toBeDefined();                                // but not invisible
  expect(row!.acceptingClaims).toBe(false);
});

it("a registered-but-not-ready worker is not claimable", async () => {
  await registerClaimant("worker", "worker_only", 11);
  expect(await countClaimableWorkers()).toBe(0);            // ready_at is null
});

it("a stale-heartbeat worker is not claimable", async () => {
  await registerClaimant("worker", "worker_only", 12);
  await markClaimantReady();
  await db.update(solveClaimantsTable)
    .set({ heartbeatAt: sql`now() - interval '1 hour'` })
    .where(eq(solveClaimantsTable.claimantId, getClaimantId()));
  expect(await countClaimableWorkers()).toBe(0);
});

it("an api-role claimant is never counted as a claimable worker", async () => {
  await registerClaimant("api", "api_dispatch", 13);
  await markClaimantReady();
  expect(await countClaimableWorkers()).toBe(0);
});
```

- [ ] **Step 2: Run; expect failure** — module does not exist.

- [ ] **Step 3: Implement**

```ts
// artifacts/api-server/src/solver/claimantRegistry.ts
import crypto from "crypto";
import { sql, eq, and } from "drizzle-orm";
import { db, solveClaimantsTable } from "@workspace/db";

const claimantId = crypto.randomUUID();
export function getClaimantId(): string { return claimantId; }

let claimantTiming: ClaimantTiming | undefined;
export function configureClaimantTiming(env: NodeJS.ProcessEnv): void {
  if (claimantTiming) throw new Error("claimant timing already configured");
  claimantTiming = parseClaimantTiming(env); // enforces staleness >= 3 × heartbeat
}
function requireClaimantTiming(): ClaimantTiming {
  if (!claimantTiming) throw new Error("claimant timing not configured");
  return claimantTiming;
}

export async function registerClaimant(
  role: "api" | "worker", mode: string, claimGeneration: number,
): Promise<void> {
  // Fail-closed: a claimant that cannot register cannot claim. This shares
  // A2's boot-recovery failure path deliberately — a process that starts
  // "successfully" but is invisible to the control plane is worse than one
  // that visibly restarts.
  await db.insert(solveClaimantsTable)
    .values({ claimantId, role, mode, claimGeneration });
}

export async function markClaimantReady(): Promise<void> {
  // Called only AFTER the queue probe succeeds — readiness means "can use the
  // queue", not "process started" (§1.3).
  await db.update(solveClaimantsTable)
    .set({ readyAt: sql`now()`, heartbeatAt: sql`now()` })
    .where(eq(solveClaimantsTable.claimantId, claimantId));
}

export async function heartbeatClaimant(): Promise<boolean> {
  const res = await db.update(solveClaimantsTable)
    .set({ heartbeatAt: sql`now()` })
    .where(eq(solveClaimantsTable.claimantId, claimantId))
    .returning({ id: solveClaimantsTable.claimantId });
  return res.length === 1;
}

export async function stopAcceptingClaims(): Promise<void> {
  await db.update(solveClaimantsTable)
    .set({ acceptingClaims: false })
    .where(eq(solveClaimantsTable.claimantId, claimantId));
}

// THE definition of "a worker that can take work" (§1.3, S-R21).
// Admission (§3.2), scaler reconciliation (§2.1) and alerting (§2.2) all call
// this. There is deliberately no second, weaker version anywhere.
export function claimableWorkerPredicate() {
  const { stalenessMs } = requireClaimantTiming();
  return and(
    eq(solveClaimantsTable.role, "worker"),
    eq(solveClaimantsTable.mode, "worker_only"),
    sql`${solveClaimantsTable.readyAt} IS NOT NULL`,
    eq(solveClaimantsTable.acceptingClaims, true),
    sql`${solveClaimantsTable.heartbeatAt} > now() -
        (${stalenessMs} * interval '1 millisecond')`,
  )!;
}

export async function countClaimableWorkers(executor = db): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`count(*)::int` })
    .from(solveClaimantsTable).where(claimableWorkerPredicate());
  return row?.n ?? 0;
}
```

- [ ] **Step 4: Run; expect PASS.**

Also test boundary freshness, malformed timing configuration, `staleness < 3 × heartbeat`, and that admission/scaler both import this predicate rather than restating it.

- [ ] **Step 5: Commit**

```bash
git commit -m "[S1.2] claimant registration, readiness, heartbeat, claimable-worker predicate"
```

---

## Phase 2 — Dispatch modes

### Task S2.1: `SOLVE_DISPATCH_MODE` with fail-closed validation

**Files:**
- Create: `artifacts/api-server/src/solver/dispatchMode.ts`
- Test: `artifacts/api-server/src/__tests__/dispatchMode.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DispatchMode = "api_dispatch" | "enqueue_only" | "worker_only" | "worker_standby";
  export function resolveDispatchMode(env: NodeJS.ProcessEnv): DispatchMode;  // throws
  export function isClaimant(m: DispatchMode): boolean;
  export function servesHttp(m: DispatchMode): boolean;
  export function claimantRole(m: DispatchMode): "api" | "worker";
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it.each([undefined, "", "worker", "API_DISPATCH", "true"])(
  "aborts boot on an invalid mode: %s", (raw) => {
    expect(() => resolveDispatchMode({ SOLVE_DISPATCH_MODE: raw } as never))
      .toThrow(/SOLVE_DISPATCH_MODE/);
  });

it("has no default — an unset mode is an error, not api_dispatch", () => {
  expect(() => resolveDispatchMode({} as never)).toThrow();
});

it("worker_only refuses to boot with a PORT listener configured", () => {
  expect(() => resolveDispatchMode(
    { SOLVE_DISPATCH_MODE: "worker_only", PORT: "3001" } as never,
  )).toThrow(/must not bind/);
});

it("worker_standby is a claimant role but never claims", () => {
  expect(claimantRole("worker_standby")).toBe("worker");
  expect(isClaimant("worker_standby")).toBe(false);
});

it("enqueue_only serves HTTP and claims nothing", () => {
  expect(servesHttp("enqueue_only")).toBe(true);
  expect(isClaimant("enqueue_only")).toBe(false);
});
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement**

```ts
// artifacts/api-server/src/solver/dispatchMode.ts
export type DispatchMode =
  | "api_dispatch" | "enqueue_only" | "worker_only" | "worker_standby";

const MODES: readonly DispatchMode[] =
  ["api_dispatch", "enqueue_only", "worker_only", "worker_standby"];

export function resolveDispatchMode(env: NodeJS.ProcessEnv): DispatchMode {
  const raw = env.SOLVE_DISPATCH_MODE;
  // No default, deliberately (§1.2). A silent default is how two tiers end up
  // claiming the same queue in production.
  if (!raw || !MODES.includes(raw as DispatchMode)) {
    throw new Error(
      `SOLVE_DISPATCH_MODE must be one of ${MODES.join(" | ")}; got ${raw ?? "<unset>"}`,
    );
  }
  const mode = raw as DispatchMode;
  if ((mode === "worker_only" || mode === "worker_standby") && env.PORT) {
    throw new Error(`${mode} must not bind an HTTP listener; PORT is set`);
  }
  return mode;
}

export const isClaimant = (m: DispatchMode) =>
  m === "api_dispatch" || m === "worker_only";
export const servesHttp = (m: DispatchMode) =>
  m === "api_dispatch" || m === "enqueue_only";
export const claimantRole = (m: DispatchMode): "api" | "worker" =>
  m === "api_dispatch" || m === "enqueue_only" ? "api" : "worker";
```

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Commit** — `[S2.1] SOLVE_DISPATCH_MODE with fail-closed startup validation`

### Task S2.2: Gate the dispatcher and the in-process kick on mode

**Files:**
- Modify: `artifacts/api-server/src/solver/jobRunner.ts`, `artifacts/api-server/src/index.ts`
- Test: `artifacts/api-server/src/__tests__/jobRunnerDispatcher.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveDispatchMode`, `isClaimant`, `registerClaimant`, `markClaimantReady`.

- [ ] **Step 1: Write the failing tests**

```ts
it("enqueue_only registers no dispatcher and no in-process kick", async () => {
  process.env.SOLVE_DISPATCH_MODE = "enqueue_only";
  const mod = await import("../solver/jobRunner.js");
  await mod.initDispatcherForBoot();
  expect(mod.getActiveJobIds()).toEqual([]);
  // Structural, not observational: there is no scheduler to stop.
  expect(mod.isDispatcherScheduled()).toBe(false);
});

it("worker_standby registers a claimant but schedules no scan", async () => {
  process.env.SOLVE_DISPATCH_MODE = "worker_standby";
  const mod = await import("../solver/jobRunner.js");
  await mod.initDispatcherForBoot();
  expect(mod.isDispatcherScheduled()).toBe(false);
  expect(await countClaimableWorkers()).toBe(0);   // standby is never claimable
});
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement**

In `jobRunner.ts`, accept the already-validated mode as an injected boot dependency and wrap `startDispatcherScheduler()` and the enqueue-time kick:

```ts
import { isClaimant, type DispatchMode } from "./dispatchMode.js";
let dispatchMode: DispatchMode | undefined;

export function configureDispatcher(mode: DispatchMode): void {
  if (dispatchMode !== undefined) throw new Error("dispatcher already configured");
  dispatchMode = mode;
}

export function isDispatcherScheduled(): boolean { return dispatcherTimer !== null; }

export function startDispatcherScheduler(): void {
  // §1.2: only a claiming mode runs the scan. enqueue_only and worker_standby
  // return here, so there is nothing to disable at runtime and nothing to
  // accidentally re-enable.
  if (!dispatchMode) throw new Error("dispatcher mode not configured");
  if (!isClaimant(dispatchMode)) return;
  /* ...existing A2 body unchanged... */
}
```

In each process entrypoint, call `resolveDispatchMode(process.env)` and all selected-path config parsers (including `configureClaimantTiming`) exactly once, then inject the validated mode with `configureDispatcher(mode)`. Do not parse required production environment at module-import time: that breaks unit tests, tooling and migrations before the entrypoint can validate configuration. In `index.ts`, register the claimant before readiness and only serve HTTP when `servesHttp(mode)`.

Refactor A's module-load `SOLVE_WORKER_CONCURRENCY` and dispatcher batch parsing into this validated runtime configuration. On a worker path, production boot requires `SOLVE_WORKER_CONCURRENCY === SOLVE_SLOTS_PER_WORKER` and `dispatcherBatchLimit >= concurrency`; invalid/unset values fail boot rather than falling back to A's historical defaults of 3 and 5. The claim loop computes free slots from this injected concurrency. Unit tests may construct explicit defaults, but production capacity must never be larger on paper than in `pump()`.

Before the first deployment of this code, set `SOLVE_DISPATCH_MODE=api_dispatch` on the API and all non-production API services in `render.yaml`; update local/test launch scripts to pass an explicit mode. The worker gets `worker_standby`. Deploying code that requires an unset variable is not a valid cutover step.

- [ ] **Step 4: Run; expect PASS. Full gate.**

- [ ] **Step 5: Commit** — `[S2.2] gate dispatcher scan and in-process kick on dispatch mode`

---

## Phase 3 — Worker service

### Task S3.1: Worker entrypoint + Render service

**Files:**
- Create: `artifacts/api-server/src/worker/index.ts`
- Modify: `render.yaml`, `artifacts/api-server/build.mjs`, `artifacts/api-server/src/solver/jobRunner.ts`, `artifacts/api-server/src/solver/claimantRegistry.ts`
- Test: `artifacts/api-server/src/__tests__/workerBoot.test.ts`

- [ ] **Step 1: Write the failing tests** — boot in `worker_only` registers a claimant, marks ready only after a successful queue probe, and binds no listener; boot exits non-zero on registry/queue-probe failure; running mode suspends new claims during a DB outage and self-terminates after the ratified consecutive-failed-scan threshold; two simultaneous signals execute shutdown once.

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement the entrypoint**

```ts
// artifacts/api-server/src/worker/index.ts
import { resolveDispatchMode, claimantRole } from "../solver/dispatchMode.js";
import { configureClaimantTiming, registerClaimant, markClaimantReady,
         startSupervisedClaimantHeartbeat, stopAcceptingClaims }
  from "../solver/claimantRegistry.js";
import { configureDispatcher, getBootClaimGeneration, initDispatcherForBoot,
         startDispatcherScheduler, stopDispatcherScheduler,
         setDraining, waitForActiveJobsToDrain, closeWorkerResources,
         DRAIN_GATE_MS } from "../solver/jobRunner.js";

const mode = resolveDispatchMode(process.env);   // throws → non-zero exit

async function main() {
  // Boot DB failure → exit non-zero; Render restarts with backoff (§8).
  // A worker that boots "successfully" but claims nothing is worse than one
  // that is visibly restarting.
  configureDispatcher(mode);
  configureClaimantTiming(process.env);
  await registerClaimant(claimantRole(mode), mode, getBootClaimGeneration());
  startSupervisedClaimantHeartbeat(); // reports failures; never drops a rejected promise
  await initDispatcherForBoot();    // queue probe/recovery must succeed
  startDispatcherScheduler();       // no-op in worker_standby (S2.2)
  await markClaimantReady();        // capacity becomes visible only after claim path is live
}

let shutdownStarted = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    // Order matters (§2.1): stop claiming and renounce capacity FIRST, so
    // admission stops counting this worker's slots before it drains.
    setDraining(true);
    stopDispatcherScheduler();
    try { await stopAcceptingClaims(); }
    catch (err) { console.error("failed to persist draining state", err); }
    try {
      await waitForActiveJobsToDrain(DRAIN_GATE_MS);
      await closeWorkerResources(); // LISTEN session, timers, DB pools
      process.exit(0);
    } catch (err) {
      console.error("worker drain failed", err);
      process.exit(1);
    }
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
```

The scan/heartbeat supervisor suspends new claims on DB failure, preserves A's rule that a failed owner heartbeat cancels its process group, and exits non-zero after the ratified consecutive-failure threshold so Render replaces a wedged paid instance. A successful scan resets the counter. Expose the counter and last-success timestamp to logs/metrics.

Add to `render.yaml`:

```yaml
  - type: worker
    name: nos-solver-worker
    runtime: docker
    dockerfilePath: ./Dockerfile
    dockerCommand: node --enable-source-maps artifacts/api-server/dist/worker.mjs
    plan: <resolved-V8-plan> # replace with the literal ratified at S0.3; no placeholder may be committed
    maxShutdownDelaySeconds: <ratified-shutdown-seconds>
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: nos-postgres
          property: connectionString
      - key: SOLVE_DISPATCH_MODE
        value: worker_standby      # cutover step 1 (§1.2); flipped at step 2
      - key: SOLVE_WAKEUP_MODE
        value: <resolved-at-S0.3>
      # Add every other required Stage-2 runtime value as a literal or sync:false
      # secret. Do not copy API-only PORT/CORS/session configuration to a worker.
```

- [ ] **Step 4: Validate configuration and shutdown semantics.** Run the unit/integration tests, build the Docker image, start the worker entrypoint and prove no listening socket exists. Run `render blueprints validate render.yaml`. A worker is a new `type: worker` service; never mutate the existing web service's immutable type/runtime. Verify `maxShutdownDelaySeconds >= DRAIN_GATE_MS / 1000` and remains within Render's 1–300 second range. Record the deployed git commit for API and worker and fail the rehearsal/cutover if they differ; matching Dockerfiles do not prove matching artifacts.

- [ ] **Step 5: Commit** — `[S3.1] worker entrypoint, SIGTERM order, render worker service`

### Task S3.2: Wake-up path — `LISTEN/NOTIFY` with polling fallback

**Files:** Modify `artifacts/api-server/src/solver/jobRunner.ts`; Test: `artifacts/api-server/src/solver/__tests__/wakeup.test.ts`

- [ ] **Step 1: Write the failing tests** — a job enqueued by one connection wakes a listening worker in well under `DISPATCHER_INTERVAL_MS`; a process failure between enqueue and commit cannot lose the wake-up; the periodic scan still finds work if notification delivery or the dedicated connection is lost; reconnect reissues `LISTEN`; shutdown closes that session.
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** a `notifyEnqueued(tx)` helper and call `SELECT pg_notify('solve_jobs_enqueued', '')` **inside A's existing enqueue transaction**. Postgres delivers it only on commit, eliminating the commit→notify crash gap. S5.2 must preserve this call when it wraps enqueue in admission; do not wait for the later admission task to make this phase testable. `notify` mode owns one dedicated, non-pooled connection per worker process, reconnects with bounded backoff, and reissues `LISTEN` after every reconnect. `poll` owns none. Extend worker boot so the selected wake-up path is established before `markClaimantReady()`, and extend `closeWorkerResources()` to close the dedicated session. **The periodic scan is never removed** — it is the durable fallback, and the S0.3 ledger must match the mode that ships.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `[S3.2] LISTEN/NOTIFY wake-up with the scan retained as durable fallback`

### Task S3.3: Worker-tier observability and actionable alerts

**Files:** Create `artifacts/api-server/src/solver/workerObservability.ts`, `docs/ops/scnd-worker-alerts.md`; Modify `claimantRegistry.ts`, `jobRunner.ts`, the existing Sentry/structured-logging integration; Test: `artifacts/api-server/src/solver/__tests__/workerObservability.test.ts`

- [ ] Emit bounded-cardinality structured health events using the repo's existing logging/Sentry path for claimable workers, queued/running jobs, oldest claimable-job age, enqueue→claim latency, active slots, scan/heartbeat failure streak, drain duration and transaction-pool usage. Tags/labels must not contain user, scenario, job or claimant IDs. Do not add a new metrics vendor inside this plan. S4.4 extends this module with retry/exhaustion events and S5.2 with admission outcomes once those protocols exist.
- [ ] Configure and document actionable Render/Sentry alerts for queued work with zero claimable workers, oldest-job age above the ratified SLO, repeated scan/heartbeat failures, retry-exhaustion spikes, connection headroom below the ledger reserve, and any API claimant after cutover. Each alert names an owner and links to the cutover/rollback runbook; S7.1 captures proof that a synthetic trigger reaches the owner.
- [ ] Test metric transitions and alert predicates, including a deliberately stale claimant and a drainer that remains alive but contributes zero capacity.
- [ ] Commit — `[S3.3] worker capacity, queue and failure observability`

---

## Phase 4 — Retry protocol

### Task S4.1: Retry columns

**Files:** Modify `lib/db/src/schema/solve_jobs.ts`; Test: extend `dispatcherRecovery.test.ts`

- [ ] **Step 1: Write the failing test** — `attempts` defaults to 0 on insert; `claimant_id` FKs to `solve_claimants` and rejects an unknown id; a claimant row referenced by a job cannot be deleted.
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement**

```ts
  // Scaling §3.1. NOT NULL with a constant default — see the plan's Global
  // Constraints for why hard rule #3's two-step does not apply here.
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at"),
  // §1.3 / S-R16. Nullable: pre-registry and legacy terminal rows have no
  // claimant and must never be fabricated one (A1's Class-1 convention).
  // worker_id is deliberately NOT added — the registry supersedes it.
  claimantId: text("claimant_id").references(() => solveClaimantsTable.claimantId),
```
plus `index("IDX_solve_jobs_claimant").on(table.claimantId)`.

- [ ] **Step 4: Push schema; run; expect PASS.**
- [ ] **Step 5: Commit** — `[S4.1] solve_jobs attempts, next_attempt_at, claimant_id FK`

### Task S4.2: Consume an attempt at claim; refuse exhausted rows

**Files:** Modify `artifacts/api-server/src/solver/jobRunner.ts` (`claimJobRow`); Test: `dispatcherRecovery.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("consumes an attempt at CLAIM time, not at failure time", async () => {
  const jobId = await seedQueuedJob();
  await claimJobRow(jobId);
  const [row] = await fetchJob(jobId);
  expect(row.attempts).toBe(1);          // nothing has failed yet
});

it("refuses to claim a row already at MAX_ATTEMPTS", async () => {
  const jobId = await seedQueuedJob({ attempts: MAX_ATTEMPTS });
  expect(await claimJobRow(jobId)).toBeNull();
});

it("refuses to claim before next_attempt_at", async () => {
  const jobId = await seedQueuedJob({ nextAttemptAt: "now() + interval '1 hour'" });
  expect(await claimJobRow(jobId)).toBeNull();
});
```

- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** — add to the CAS claim's `WHERE`:
```sql
AND attempts < ${MAX_ATTEMPTS}
AND (next_attempt_at IS NULL OR next_attempt_at <= now())
```
and to its `SET`: `attempts = attempts + 1, claimant_id = ${getClaimantId()}`.

*Why at claim and not at failure (§3.1): a worker that dies between claiming and writing anything never records a failure, so incrementing on recorded failure leaves a crash-loop unbounded. Incrementing inside the CAS transaction makes the bound real regardless of how the attempt ends.*

- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `[S4.2] consume an attempt inside the CAS claim; refuse exhausted and not-yet-due rows`

### Task S4.3: Conditional lease recovery

**Files:** Modify `artifacts/api-server/src/solver/jobRunner.ts` (`reapStaleLeases`); Test: `dispatcherRecovery.test.ts`

- [ ] **Step 1: Write the failing test — this is the S-R11 regression**

```ts
it("terminalizes rather than requeues a stale lease on the final attempt", async () => {
  const jobId = await seedRunningJobWithStaleLease({ attempts: MAX_ATTEMPTS });
  await reapStaleLeases();
  const [row] = await fetchJob(jobId);
  expect(row.status).toBe("failed");
  expect(row.failureReason).toBe("internal_error");
  expect(row.failureStage).toBe("dispatch");
  expect(row.errorCode).toBe("SOLVE_FAILED");
  // The bound must be real, not decorative:
  expect(await claimJobRow(jobId)).toBeNull();
});

it("requeues with a jittered delay when attempts remain", async () => {
  const ids = await Promise.all([1, 2, 3, 4, 5].map(() =>
    seedRunningJobWithStaleLease({ attempts: 1 })));
  await reapStaleLeases();
  const delays = (await fetchJobs(ids)).map((r) => r.nextAttemptAt!.getTime());
  expect(new Set(delays).size).toBeGreaterThan(1);   // genuinely random, not a constant
});
```

- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** — one conditional statement:

```sql
UPDATE solve_jobs SET
  status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
  failure_reason = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'internal_error' END,
  failure_stage  = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'dispatch' END,
  error_code     = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'SOLVE_FAILED' END,
  error          = CASE WHEN attempts >= ${MAX_ATTEMPTS}
                     THEN ${SAFE_INTERNAL_FAILURE_MESSAGE} END,
  finished_at    = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN now() END,
  next_attempt_at = CASE WHEN attempts < ${MAX_ATTEMPTS}
    THEN now() + (random() * least(${BASE_SEC} * power(2, attempts - 1), ${CAP_SEC}))
                 * interval '1 second'
  END,
  claim_generation = NULL, claimed_at = NULL, owner_heartbeat_at = NULL,
  claimant_id = CASE WHEN attempts < ${MAX_ATTEMPTS} THEN NULL ELSE claimant_id END
WHERE status = 'running' AND owner_heartbeat_at < now() - ${STALE}
```

*The old owner needs no new fencing: A2's completion predicate is `WHERE id=? AND status='running' AND claim_generation=?`, and a requeued or terminalized row matches neither, so a zombie's late completion updates zero rows and is dropped exactly as A2 already drops stale completions.*

*`random()` is evaluated by Postgres, so the delay is both DB-clock-authoritative and genuinely random — full jitter over `[0, capped]`, which is what de-synchronizes a fleet retrying one dead worker's jobs.*

On a requeue, also clear every attempt-local terminal/ownership field (`started_at`, `finished_at`, failure/error columns and any partial result fields); retain immutable enqueue inputs and the attempt count. On terminal exhaustion, retain the final claimant for audit and write A's safe student-facing message. Add a row-shape invariant test for both branches.

- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `[S4.3] conditional lease recovery: terminalize at exhaustion, jittered requeue otherwise`

### Task S4.4: Retry classification and fleet-safe claiming

**Files:** Modify `artifacts/api-server/src/solver/jobRunner.ts`; Test: `dispatcherRecovery.test.ts`

- [ ] **Step 1: Write the failure-matrix tests.** Lease expiry and `failure_reason='internal_error'` at `failure_stage IN ('spawn','dispatch')` requeue only while attempts remain. Every `solver_error`, `data_error`, `timeout` or `interrupted` outcome, recovery-identity mismatch, and `internal_error` at any other stage is terminal on its first failure. Every terminal path publishes at most once through A's existing completion/publication CAS. A retry after scenario mutation remains unable to publish through A7.
- [ ] **Step 2: Implement one shared transition helper** used by recorded failures and stale-lease recovery. It receives the typed reason/stage and current attempts, performs the conditional update with database-clock jitter, clears ownership only on requeue, and writes A's safe public error on exhaustion. Do not infer retryability from free-text diagnostics.
- [ ] Emit retry/retry-exhaustion counters and failure class through S3.3's bounded-cardinality observability module.
- [ ] **Step 3: Replace fleet polling with a transactional `FOR UPDATE SKIP LOCKED` claim.** Select due, non-exhausted queued candidates in deterministic `(queued_at,id)` order, lock only the bounded batch, and stamp attempt/generation/claimant in the same transaction. Retain `claimJobRow(jobId)` as a CAS boundary for enqueue kicks if needed, but every fleet scan must use the locked query promised by the spec. S5.3 adds the per-user running-cap predicate to this query.
- [ ] **Step 4: Prove concurrency.** With at least two independent DB connections and two claimant identities, no job is returned twice, a locked row does not head-of-line block another candidate, and `next_attempt_at` is honored.
- [ ] **Step 5: Commit** — `[S4.4] typed retry matrix and SKIP LOCKED fleet claims`

---

## Phase 5 — Admission

### Task S5.1: Verify the authorized runtime pack and connection implementation

**Files:** Modify `docs/superpowers/metrics/scaling-resolved-values.md`, `docs/ops/scnd-connection-ledger.md`, `docs/ops/scnd-scaling-runtime-config.md`

- [ ] **Step 1: Read, do not re-resolve, the S0.3 artifacts.** Assert V3–V9 and every required runtime value are present, source-pinned and consistent with `render.yaml` and process configuration. Assert admission's `slotsPerWorker`, jobRunner's actual concurrency and the worker env value are identical, and that the claim batch can fill all free slots. A discrepancy is a **STOP and re-authorization**, not an opportunity to choose a value here.
- [ ] **Step 2: Verify connection ownership in code.** API/worker transaction pool maxima equal the ledger; `notify` creates exactly one dedicated non-pooled session per worker process; `poll` creates none; the O4 controller closes its connection each run. Add tests/telemetry that expose configured pool maximum, current pool usage and notification-session state.
- [ ] **Step 3: Add a CI assertion** that recomputes the ledger from the checked-in runtime pack and fails if a Blueprint/config edit exceeds the S0.3 ceiling or introduces an unbudgeted connection owner.
- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/metrics/scaling-resolved-values.md docs/ops/scnd-connection-ledger.md
git commit -m "[S5.1] verify authorized runtime values and connection ownership"
```

### Task S5.2: Serialized admission transaction

**Files:**
- Create: `lib/db/src/schema/solve_admission.ts`
- Create: `artifacts/api-server/src/solver/admission.ts`
- Modify: `lib/db/src/index.ts`
- Modify: `artifacts/api-server/src/routes/scenarios.ts`
- Test: `artifacts/api-server/src/solver/__tests__/admission.test.ts`

**Interfaces:**
- Consumes: `countClaimableWorkers()`, `computeInputsHashV2()`, `enqueueSolveJob()`.
- Produces: `admitAndEnqueue(scenarioId, userId, input): Promise<AdmissionOutcome>` where
  `AdmissionOutcome = {kind:"cached"} | {kind:"admitted", jobId} | {kind:"rejected", retryAfterSec} | {kind:"unavailable", retryAfterSec}`.

- [ ] **Step 1: Write the failing tests — S-R18 is the headline**

```ts
it("a full-cohort concurrent burst cannot overshoot the admission bound", async () => {
  await seedClaimableWorkers(1);                       // 1 worker × N slots
  const cohort = await seedUsersAndScenarios(50);      // distinct students/scenarios
  const results = await Promise.all(
    cohort.map(({ scenarioId, userId, input }) =>
      admitAndEnqueue(scenarioId, userId, input)),
  );
  const admitted = results.filter((r) => r.kind === "admitted").length;
  // The bound must hold under a read/insert race, not just sequentially.
  expect(admitted).toBeLessThanOrEqual(maxAdmissibleFor(1));
  expect(results.filter((r) => r.kind === "rejected").length).toBe(50 - admitted);
});

it("returns 503 unavailable rather than dividing by zero at no claimable slots", async () => {
  await seedClaimableWorkers(0);
  const r = await admitAndEnqueue(scenarioId, userId, input);
  expect(r.kind).toBe("unavailable");
  expect(r.retryAfterSec).toBeGreaterThan(0);
});

it("never rejects a cache hit for queue depth", async () => {
  await seedClaimableWorkers(0);                       // zero capacity
  await seedCacheEntry(computeInputsHashV2(input));
  expect((await admitAndEnqueue(scenarioId, userId, input)).kind).toBe("cached");
});

it("a draining worker stops contributing capacity immediately", async () => {
  await seedClaimableWorkers(1);
  await stopAcceptingClaims();                          // SIGTERM equivalent
  expect((await admitAndEnqueue(scenarioId, userId, input)).kind).toBe("unavailable");
});
```

- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Create and seed the lock row.** Add a `solve_admission` table with a CHECK-constrained singleton key (`id = 1`). Because this repo uses `drizzle-kit push` rather than data migrations, the transaction must first run `INSERT INTO solve_admission(id) VALUES (1) ON CONFLICT DO NOTHING`, then lock that row. Test a fresh database and concurrent first use; a missing row must never turn `SELECT … FOR UPDATE` into a lock on nothing.
- [ ] **Step 4: Implement with ratified, boot-validated configuration**

```ts
export async function admitAndEnqueue(scenarioId, userId, input) {
  return db.transaction(async (tx) => {
    // Serialize on one row. At 0.694 submissions/sec the contention is
    // negligible, and a lock that is obviously correct beats a
    // SERIALIZABLE retry loop that must itself be tested under the burst.
    await ensureAdmissionSingleton(tx);
    await tx.execute(sql`SELECT 1 FROM solve_admission WHERE id = 1 FOR UPDATE`);

    // 1. Cache eligibility FIRST — a student whose answer already exists is
    //    never rejected for queue depth (§3.2).
    if (await cacheHit(tx, computeInputsHashV2(input))) return { kind: "cached" };

    // 2. Claimable capacity — the §1.3 predicate, never a nominal count.
    const slots = config.slotsPerWorker * await countClaimableWorkers(tx);
    if (slots === 0) {
      return { kind: "unavailable", retryAfterSec: config.unavailableRetrySec };
    }

    // 3. Wait, in slot-seconds ÷ slots = seconds.
    const { queued, busy } = await queueState(tx);
    const waitSec = ((queued + busy) * config.meanServiceSec) / slots;

    // 4. Decide.
    if (waitSec > config.queueWaitSloSec) {
      return { kind: "rejected", retryAfterSec: clamp(
        Math.ceil(waitSec), config.retryAfterMinSec, config.retryAfterMaxSec,
      ) };
    }
    // 5. Enqueue in the SAME transaction — this is what makes the bound real.
    return { kind: "admitted", jobId: await enqueueSolveJob(tx, scenarioId, userId, input) };
  });
}
```

`config` is parsed once from the S0.3 runtime pack at the process entrypoint; there are no untracked constants in this function. Refactor A's existing enqueue operation to accept the transaction without weakening its scenario lock, input snapshot, recovery identity, `enqueued_solve_input_revision`, or publication-CAS inputs. Do not create a second, reduced insert path.

Replace the `QUEUE_DEPTH_LIMIT` pre-check in `routes/scenarios.ts`; map `rejected → 429`, `unavailable → 503`, both with `Retry-After`. Preserve ownership-filtered 404 behavior and the existing cache/result response contract.

Emit the bounded-cardinality admission outcome and estimated-wait fields through S3.3's existing observability module; never tag them with a user/scenario/job identifier.

- [ ] **Step 5: Run; expect PASS.** In addition to the cohort test, prove concurrent cold misses on independent DB connections serialize, cache hits do not consume admission capacity, the worker count is read through the same transaction executor, and rollback leaves neither an admission decision nor a job row behind. Run the full gate.
- [ ] **Step 6: Commit** — `[S5.2] serialized cache/capacity/admission/enqueue transaction`

### Task S5.3: Per-user fairness caps

**Files:** Modify `admission.ts`, `jobRunner.ts`, `lib/db/src/schema/solve_jobs.ts`; Test: `admission.test.ts`

- [ ] **Step 1: Write the failing test** — one user cannot exceed `MAX_QUEUED_PER_USER`; the claim query skips a user already at `MAX_RUNNING_PER_USER`; a second user's job is not starved behind the first's backlog.
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** the queued cap inside the locked admission transaction and the running cap in S4.4's `SKIP LOCKED` candidate query. Add the partial/indexed access paths used by both checks (at minimum user/status for queued and running rows), and confirm them with `EXPLAIN (ANALYZE, BUFFERS)` on a representative retained data volume. *A cap, not round-robin: round-robin under `SKIP LOCKED` needs a per-user cursor or window function in the hottest query in the system, to buy an ordering property the cap already delivers.*
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `[S5.3] per-user queued/running caps with a starvation bound`

---

## Phase 6 — Retention

### Task S6.1: Resolve V13 and implement the bounded sweep

**Files:** Create `artifacts/api-server/src/solver/retentionSweep.ts`; Test: `retentionSweep.test.ts`

- [ ] **Step 1: Resolve V13 as two ordered horizons.** Product input (SP-3) must provide `payload_retention_days` and `history_retention_days`, with payload ≤ history. One number cannot make history outlive heavy JSONB payloads. Also record the `result_cache` age/size cap and eviction trigger. **STOP and ask** if any is absent; this trades student-visible history and cache effectiveness against storage cost and is not the implementer's choice.
- [ ] **Step 2: Write the failing tests** — at the payload horizon, terminal rows retain history metadata but null `result`/`input_snapshot`; only at the later history horizon is the row deleted. A `solve_claimants` row referenced by any job is never deleted. Cache entries obey their independent cap, including old composite-identity generations. Active-run/subscriber cleanup is absent unless the conditional single-flight successor owns it. A concurrent claim/admission operation is not blocked by a sweep batch.
- [ ] **Step 3: Run; expect failure.**
- [ ] **Step 4: Implement** separately observable, idempotent batches under a local statement/lock timeout, using bounded candidate selection with `FOR UPDATE SKIP LOCKED`, off-peak. Record rows/bytes removed, duration, timeout/failure and remaining eligible count. Never delete queued/running jobs.
- [ ] **Step 5: Run; expect PASS. Commit** — `[S6.1] bounded retention sweep for jobs, payloads, cache and claimants`

---

## Phase 7 — Cutover

> **Order warning — under O4, Phases 9 and 10 come first.** Do not begin S7.1 on a fleet topology until S9.1–S9.3 are built and exercised. Under O1/O2+SP-1(a) and O3 there is no scaler, and this phase follows Phase 6 directly.

### Task S7.1: Rehearsal and V10

**Files:** Create `docs/ops/scnd-worker-cutover.md`

- [ ] **Step 1: Rehearse the additive schema push and five cutover steps in a production-like non-production Render environment**, with an isolated database, the selected worker plan/count, identical pool limits, worker `maxShutdownDelaySeconds`, and the real Blueprint/service types. Capture the `drizzle-kit push` diff and post-push schema assertions. A database alone cannot exercise Render rolling generations, SIGTERM timing or service-mode configuration.
- [ ] **Step 2: Resolve V10** — observe peak `pg_stat_activity` **under a rolling deployment**. This is the only condition that exercises the ledger's overlap term; a steady-state observation cannot validate it. **If the rehearsal environment cannot do a rolling deploy → STOP**, the term stays unverified.
- [ ] **Step 3: Write the runbook** with the exact commands, the `NOT EXISTS` cutover proof, and the rollback.
- [ ] **Step 4: Record V10; commit** — `[S7.1] cutover rehearsal, peak-connection observation, runbook`

### Task S7.2: Production cutover and V11

**Files:** Modify `docs/ops/scnd-worker-cutover.md`, `docs/superpowers/metrics/scaling-resolved-values.md`

- [ ] **Step 0: Assert the pre-cutover go/no-go.** S7.1 and S8.1a must pass. O4 additionally requires S9.1–S9.3 and S10.1 (plus any triggered successor) complete. A failed one-worker gate on O1/O2 + SP-1(a) escalates to O4/G-FLEET; it does not authorize cutover with a known SLO miss.
- [ ] **Step 1: Ask SP-4** — confirm the cutover window (outside a class window), named operator/observer, and that the documented rollback deploy is acceptable. **STOP and wait.**
- [ ] **Step 2: Apply and verify the rehearsed additive schema diff**, then execute the five cutover checkpoints: standby deploy → worker `worker_only` deploy → API `enqueue_only` deploy → proof → scale. Stop after any failed checkpoint; config-changing steps are separate deploys.
- [ ] **Step 3: Run the proof** — `NOT EXISTS (running job joined to a claimant row with role='api')`, after the old API revision's configured shutdown/drain budget has elapsed. **If it returns rows → STOP and roll back.**
- [ ] **Step 4: Resolve V11 according to topology.** O3 / isolation-required single-worker paths record process-start→ready→first-claim for deploy/restart evidence. O4's normative V11 is Render scale-API-call→new-worker ready→first successful claim and is produced in S9.2's non-production scaler exercise before this cutover. Production cutover confirms, but is not the first place to discover, the pre-scale lead time.
- [ ] **Step 5: Record V11; commit** — `[S7.2] production cutover to worker_only; measure boot-to-first-claim`

---

## Phase 8 — Gates

### Task S8.1a: Pre-cutover topology gate

**Files:** Test: `artifacts/api-server/src/solver/__tests__/gWorker.test.ts`

- [ ] **Step 1: Write the automatable suite** — spec §5.1's G-WORKER list in full: G-API's A-reliability proofs, dispatcher-mode enforcement (including `worker_standby` never claims), the registry cutover proof and idle-worker readiness, multi-worker claim under `SKIP LOCKED`, retry exhaustion including the final-attempt kill, fairness/starvation at the cap, DB outage and pool exhaustion, and deletion/cancellation mid-solve. For O4, add G-FLEET's missed scale-up, Render API failure, reconciliation deadline, active-job scale-in, autoscaling-enabled detection, and the cold-identical burst that feeds S10.1.
- [ ] **Step 2: Attach operational evidence rather than pretending it is a Vitest.** S7.1 supplies rolling-deploy connection peak, actual SIGTERM/drain timing, no-listener worker proof and Blueprint validation. The gate runner verifies those signed artifacts and their environment identity/freshness.
- [ ] **Step 3: Run the capacity and reliability gates against the final built topology in non-production** — not the prototype and not first in production. Measurement's run selected; **this run decides** (§5). For O4 this means the scheduler/scaler is already built and exercised.
- [ ] **Step 4: Full gate + `e2e_accuracy.py`** — expect 99/99 unmodified, confirming zero solver drift.
- [ ] **Step 5: Commit** — `[S8.1a] pass the pre-cutover final-topology gate`

### Task S8.1b: Post-cutover operational verification

**Files:** Modify `docs/ops/scnd-worker-cutover.md`, `docs/superpowers/metrics/scaling-resolved-values.md`

- [ ] **Step 1: After S7.2, run a bounded production smoke/operational subset** using a designated owned test scenario: mode/registry proof, one enqueue→worker→poll solve, cache hit, telemetry/alerts, connection headroom and rollback readiness. Do not inject DB/pool failures, kill jobs, or use another user's data in production.
- [ ] **Step 2: Compare actuals to the authorized bounds.** Confirm no API claimant remains, claimable worker count matches the selected topology, observed connections fit the ledger, drain/boot timing fits the runbook and no retry/failure alert is unexpectedly active. A failed check triggers the documented rollback; it does not become an accepted exception.
- [ ] **Step 3: Record evidence and commit** — `[S8.1b] verify production worker cutover`

### Task S8.2: Decision document

- [ ] **Step 1: Reconfirm V3 and V6 — the cost model's operands resolved at S0.3**

- **V3 — `cpu_N`**, mean CPU service demand at the knee: `capacity.py: weighted_mean_service_demand(stats, manifest, gap)` over the M1 campaign stats, evaluated at V4's concurrency.
- **V6 — cache hit rate `h`**: from the Phase 3 load-run cache mix.

**If either is absent or the final-topology observation materially differs from the S0.3 source → STOP and repeat sizing/authorization.** Note which quantity goes where, because this is the error the spec was corrected for twice: **`cpu_N` sizes and costs; it never answers a latency question.** `mean_service_sec` (V5) is the wall-clock quantity, and it belongs only to §3.2's admission model.

- [ ] **Step 2: Write** `docs/superpowers/specs/2026-09-24-scnd-pilot-gate-results.md`: per-gate pass/fail, identified bottleneck, worker count and cost recomputed from measured `cpu_N` (V3), sensitivity to `h` (V6) and free-choice frequency, **both cost denominators** (per successful submitted job and per successful CBC execution, per spec §4), and the completed resolved-value table.
- [ ] **Step 3: State the authority plainly** — both applicable gates **and** MP-4 are required for a pilot; capacity never waives reliability. This is Stage 3 (spec preamble).
- [ ] **Step 4: Commit** — `[S8.2] publish the pilot-gate decision document`

---

## Phase 9 — Scheduler *(execute only if V1 = O4)*

> **Order warning — this phase runs BEFORE Phase 7 and Phase 8.** Per *Required execution order* item 4, an O4 build finishes S9.1–S9.3 **before** the S7.1 rehearsal and the S8.1a gate, because S8.1a's fleet evidence (missed scale-up, Render API failure, reconciliation deadline, active-job scale-in, autoscaling detection) cannot be produced by a scaler that does not exist. The document's phase numbering is presentational; the dependency list governs. An agent executing top-to-bottom will reach S7.1 first — **stop and come here instead.**

### Task S9.1: Resolve V12 and write the calendar
- [ ] Resolve **V12** — class days/windows and IANA timezone. Product input (SP-3). **STOP and ask.** Never a fixed UTC offset; the zone database handles DST.
- [ ] Write `docs/ops/scnd-class-calendar.yaml` with holidays and an expiring manual-override field.
- [ ] Commit — `[S9.1] class calendar with IANA timezone and expiring override`

### Task S9.2: Scaler
- [ ] Test first: idempotent (sets a desired count, never increments), `pg_try_advisory_lock` prevents overlap, bounded retry on 429/5xx, handles the Render API's asynchronous acceptance by reconciliation deadline, **asserts native autoscaling is OFF** (Render ignores manual counts when it is on, silently defeating the whole cost lever), and never exceeds Render's supported 1–100 manual-instance range.
- [ ] Implement `scripts/src/scaling/scaler.ts` as a Render Cron Job and add the `type: cron` service, S0.3-authorized cron plan, schedule, command, scoped `sync:false` Render credential, database connection, and calendar path to `render.yaml`; validate with `render blueprints validate`. Include its billed runtime in the cost decision. The cron tick interval must be shorter than the smallest calendar boundary tolerance, while the calendar remains the authority. *GitHub Actions `schedule` is disqualified: its trigger delay exceeds the pre-scale lead time it would be scheduling.*
- [ ] Hold the advisory lock on one explicitly checked-out Postgres session across read→Render API call→reconciliation, and release it in `finally`; a pooled `db.execute()` followed by another pooled statement does not prove lock ownership. The cron process closes that session before exit, matching S0.3's one-controller-connection ledger term.
- [ ] Reconcile on `countClaimableWorkers()` — the §1.3 predicate, so drainers never inflate the count.
- [ ] In the production-like environment, measure Render scale-API-call → new-worker ready → first successful claim and record V11. Set the calendar's pre-scale lead from that measurement plus the ratified safety margin; re-run the missed-scale-up and reconciliation tests with it.
- [ ] Emit and test actionable alerts for missed readiness deadline, Render API exhaustion, native autoscaling unexpectedly enabled, desired/claimable divergence, and a count above the one-worker floor outside class/override windows. These are reliability and cost controls, not dashboard-only nice-to-haves.
- [ ] Commit — `[S9.2] Render cron scaler with advisory lock and reconciliation`

### Task S9.3: Scale-in safety
- [ ] Test first: enqueue at the drain boundary completes; a job killed at the shutdown budget is requeued **or terminalized** by §3.1; autoscaling-enabled is detected; an expired override cannot hold burst capacity indefinitely.
- [ ] *No pre-check is implemented, deliberately: Render's scale API picks the victim instance, so there is no instance you can drain on purpose. Safety comes from SIGTERM order + A's lease + bounded attempts.*
- [ ] Commit — `[S9.3] scale-in safety tests and drain contract`

---

## Phase 10 — Coalescing condition *(execute only if V1 = O4)*

> **Order warning — this resolves at S8.1a time, not after cutover.** The cold-identical-burst run that feeds V14 is part of the S8.1a gate. If the condition fires, the single-flight successor spec must be designed, built and joined to G-FLEET **before** S7.2 production cutover — not retrofitted afterwards.

### Task S10.1: Resolve V14
- [ ] Run the cold-identical-burst test from G-FLEET; measure duplicate compute.
- [ ] Compare against the selected topology's capacity headroom **and** cost budget (spec §1.1's coalescing condition).
- [ ] **If it fits** → record V14, proceed without single-flight. **If it does not** → **ask SP-2** and stop: single-flight needs its own brainstorm/spec/review cycle before implementation. *Writing it inline is what produced 12 of the A plan's 56 findings across six rounds.*
- [ ] Commit — `[S10.1] resolve the coalescing condition from measured duplicate compute`

---

## Revision record

**Rev 2 — 2026-09-24 review, folded.** Verdict: **approved as a conditional execution plan.** All corrections accepted; none needed a divergent remedy. The revision text is preserved verbatim in commit `0e14422`.

Most findings were not stylistic — **seven were defects that would have surfaced during execution**, and they cluster into three kinds worth naming, because the same kinds will recur in the next plan:

**Code that could not run as written.** I referenced `solve_admission` in the admission transaction's `FOR UPDATE` and never created or seeded that table. I called `countClaimableWorkers(tx)` against a signature taking no arguments. I used `sql.raw` to interpolate an interval instead of parameterizing it. Each is the kind of error that reads fine in prose and fails on the first run — **plan code needs the same "would this compile" pass as real code**, not just a coherence pass.

**Verification that verified nothing.** S0.1's `grep -cE "\[A1[0-3]\]|\[A9\]"` checked a subset of A and counted rather than asserting each task — it could have authorized a partial A, the one prerequisite this plan cannot proceed without. And the headline S-R18 burst test fired 50 concurrent requests from **one** user and scenario, so once S5.3's per-user caps landed, 49 would have been rejected by the cap and the test would have passed without ever exercising the read/insert race it exists to prove. Both are worse than a missing check, because they report success.

**Contracts silently weakened.** My admission transaction called `enqueueSolveJob(tx, …)` as though enqueue were a simple insert. A's real enqueue locks the scenario, captures the input snapshot, computes the recovery-contract identity and stamps `enqueued_solve_input_revision` — the input to A7's publication CAS. A parallel reduced insert path would have dropped those without any test noticing, which is precisely the "never weaken A" constraint this plan states in its own Global Constraints and then violated in its own code sample.

**Gaps, not errors:** no task implemented §3.1's retryable/non-retryable classification, so every failure would have retried including the deterministic ones; no task implemented `FOR UPDATE SKIP LOCKED`, which the spec promises in §1 and gates on in §5.1; no observability task existed despite §8 making DB-side observability the *replacement* for a readiness endpoint; and my requeue left attempt-local state (`started_at`, failure columns) on the row.

**Corrections adopted beyond those:**

| Area | Change |
|---|---|
| Authorization | New **S0.3** Stage-2 pack — sizing, runtime config and connection ledger complete **before any code changes**. Value resolution moved out of Phase 5, where it was too late to inform the build |
| Execution order | New **Required execution order** section: phases are presentational, the dependency list governs. O4 builds the scaler before rehearsal; S8.1 split into **S8.1a** (pre-cutover, final topology in non-production) and **S8.1b** (post-cutover, bounded production smoke). My single S8.1 sat *after* cutover — I would have cut production over before the reliability gate ran |
| Configuration | Measured values must be **validated runtime configuration**, not a Markdown register. Production boot fails closed. `SOLVE_WORKER_CONCURRENCY === SOLVE_SLOTS_PER_WORKER` enforced, so admission cannot promise capacity `pump()` does not have |
| Boot/shutdown | `markClaimantReady()` moved after the claim path is live (I marked ready before the scheduler started); supervised heartbeat replaces `setInterval(asyncFn)` with its dropped rejections; SIGTERM gets a re-entrancy guard, error handling and `closeWorkerResources()` |
| Schema | `CK_solve_claimants_role_mode` — my two independent CHECKs permitted `role='api', mode='worker_only'`, a combination that poisons capacity accounting |
| Ledger | `worker_generations × worker_instances × notify_sessions` — I omitted the generation multiplier, so a rolling deploy's second set of `LISTEN` sessions was unbudgeted. `controller_connections` is O4-only. The operations reserve must be named and owned, not a plug |
| Wake-up | `pg_notify` moved **inside** A's enqueue transaction; Postgres delivers only on commit, closing the commit→notify crash gap my version had |
| Deploy safety | `SOLVE_DISPATCH_MODE=api_dispatch` must be set on existing services **before** the first deploy of this code. My S2.1 makes an unset mode fail boot — shipping it without that step would have broken production on deploy. No placeholder values may be committed to `render.yaml`; my worker service also had no `DATABASE_URL` |
| Safety | Dev database comes from `SCND_DEV_DATABASE_URL` with an isolation warning, not a pasted local URL; `git switch` + explicit pathspec commits; the register guard refuses to overwrite an existing file |

**Restored in this pass** (lost when V-resolution consolidated into S0.3): the V5 warning that `SimResult` has no such field and the fix is a one-line Measurement change — a generic STOP is not actionable, and the "never substitute `cpu_N`" rule is the error spec rounds 3 and 4 both corrected; and V7's warning not to derive `slots_per_instance` from advertised memory. **Added:** order warnings at the Phase 7/9/10 headings, since an agent reading top-to-bottom reaches S7.1 before the scaler exists, and three DoD rows for the checkpoint, the retry classification and the concurrency equality.

---

## Definition of Done

- [ ] **S0.3's Stage-2 authorization checkpoint is recorded, and no Phase-1 commit predates it.** This is the boundary between "we have a plan" and "we may change code"; verify by commit date, not by assertion.
- [ ] Every V-row in spec §10 is either recorded in `scaling-resolved-values.md` with provenance, or visibly marked n/a for the selected outcome. **No row is silently absent.**
- [ ] No spec "starting value" appears in a sizing, admission or cost calculation as a substitute for a resolved value, and every production-consumed value exists as validated runtime configuration — **the Markdown register is evidence, not a config source.** Production boot fails closed on an absent or malformed required value.
- [ ] **No deterministic failure class retries** (S4.4): `solver_error`, `data_error`, `timeout`, recovery-identity mismatch and `internal_error` outside `spawn`/`dispatch` are terminal on first failure. Retry covers lost work, never rejected work.
- [ ] **`SOLVE_WORKER_CONCURRENCY === SOLVE_SLOTS_PER_WORKER`** in production, and `dispatcherBatchLimit >= concurrency` — admission must never promise more capacity on paper than `pump()` actually runs.
- [ ] `worker_id` appears nowhere (S-R16).
- [ ] The full gate is green and `e2e_accuracy.py` passes **99/99 unmodified** — this plan touches no Python.
- [ ] `render blueprints validate render.yaml` passes; API/worker deploy the same commit; runtime config matches the authorized pack; the connection ledger fits both the live ceiling and observed rolling-deploy peak.
- [ ] `/harness-retro` has run for the branch.
- [ ] S8.1a passed on the **final built topology**, S8.1b passed after cutover (or cutover was rolled back), and the decision document records the result.
