# SCND Scaling — Worker Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move solves off the API's request path onto an isolated solver worker tier that claims from Option A's durable `solve_jobs` queue, with bounded automatic retry, serialized admission, and — only if the measured topology demands it — a scheduled scaler.

**Architecture:** Option A already owns the durable queue, the CAS claim, the owner lease, boot recovery and SIGTERM drain, all running *inside the API process*. This plan does not duplicate any of it. It adds (1) a `solve_claimants` registry so claimants are identifiable and their willingness to claim is observable, (2) a `SOLVE_DISPATCH_MODE` seam that lets the same codebase boot as API-with-dispatcher, API-enqueue-only, worker, or worker-standby, (3) a retry protocol on top of A's lease reclaim, (4) an admission decision serialized with the enqueue it guards, and (5) topology-conditional scheduling. The worker is the *same image* as the API, booted in a different mode — no second build, no second dependency tree.

**Tech Stack:** TypeScript / Node 24, Express 5, Drizzle ORM on Postgres 16 (`drizzle-kit push`, no migration files), vitest + supertest, Python 3 / PuLP / CBC via `spawn`, Render (Docker web service + background worker), `pnpm` monorepo.

**Spec:** `docs/superpowers/specs/2026-09-22-scnd-scaling-design.md` (Rev: six review rounds folded, S-R1…S-R23). Section references below (§1.2, §3.1, …) are to that spec and are normative. Where this plan and the spec disagree, **the spec wins and the plan is wrong** — report it rather than papering over it.

---

## Global Constraints

- **Hard rule #1** — never hand-edit generated code under `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. API shape changes go through `lib/api-spec/openapi.yaml` + Orval regen, committed together.
- **Hard rule #2** — `artifacts/api-server/src/solver/tests/e2e_accuracy.py` is sacred and must pass unmodified. **This plan touches zero solver math and zero datasets**, so it must pass byte-identically; re-run it only if a task unexpectedly touches Python.
- **Hard rule #3** — adding a NOT NULL column to a populated table uses the two-step protocol. *Deviation note (rule #8): `attempts integer NOT NULL DEFAULT 0` is added in one statement, because a constant DEFAULT makes Postgres supply the value for existing rows atomically; the protocol exists for NOT NULL adds with no default. `claimant_id` and `next_attempt_at` are nullable and unaffected.*
- **Hard rule #4** — one task = one commit, `[<task-id>] <imperative summary>`.
- **Hard rule #5** — ownership filtering is security-critical: non-owned resources return **404**, never 403. Every new query touching `solve_jobs` or `scenarios` filters by `user_id`.
- **Hard rule #6** — solver changes enter as data, not branches. This plan adds no `solve.py` code paths.
- **Branch discipline** — all work on a descriptive branch (`scnd-scaling-worker-tier`), never direct to `main`. Upstream set at the first stable checkpoint.
- **A is a hard prerequisite.** Nothing here executes until Option A is complete and merged. Preflight asserts it.
- **Never weaken A.** A2's ownership-gated completion predicate, A2's version-mismatch terminal failure, and A7's publication CAS are consumed, not modified. A task that finds itself editing them has misread the spec.
- **Verification gate — run before considering any task done:**
  ```bash
  pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test
  ```
  Python is untouched; the solver pytest suite and `e2e_accuracy.py` are run once at Preflight as a baseline and once at the final gate as a no-regression confirmation.

---

## The value-resolution protocol

This plan is written **before** Measurement has produced its numbers. That is deliberate and safe, because no number is hardcoded here — each is a **resolution step** that reads the real value from a named source at the moment it is needed (spec §10, register V1–V14).

**The rule that makes this safe, and the only one that matters:**

> **A missing value is a STOP, never a substitution.**
> If the named source does not exist, is empty, or contradicts itself: **halt the task, report what was looked for and where, and wait.** Do not infer a plausible number. Do not carry a spec "starting value" forward as if it were measured. Do not proceed with a placeholder intending to fix it later.

The spec's starting values (`MAX_ATTEMPTS=3`, backoff `5 s`/`60 s`, `MAX_RUNNING_PER_USER=1`, `MAX_QUEUED_PER_USER=3`, ±20 % jitter, `Retry-After` clamp 5–120 s, `worker_pool = CONCURRENCY + 2`) exist so the design can be argued with. **They are exactly the kind of plausible number that makes a silent substitution invisible.** They are permitted as *code defaults* — a constant in a config module with a comment naming its register row — and forbidden as *substitutes for a resolved value* in any sizing, admission, or cost calculation.

Every resolution step in this plan writes its result to a single append-only file, `docs/superpowers/metrics/scaling-resolved-values.md`, with the value, its source, the resolving command or artifact, and the date. That file is the audit trail: at the end, every V-row is either recorded there with provenance or visibly absent.

---

## File Structure

**New:**

| File | Responsibility |
|---|---|
| `lib/db/src/schema/solve_claimants.ts` | The claimant registry table (§1.3). Schema only — no logic |
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

- [ ] **Step 1: Assert Option A is complete and merged**

```bash
git log --oneline main | grep -cE "^\w+ \[A1[0-3]\]|\[A9\]"
```
Expected: A4–A13 all present on `main`. **If any A task is missing → STOP.** A's durable queue, lease, recovery and drain are the substrate; building on a partial A means building on a contract that may still change.

- [ ] **Step 2: Assert Stage 1 (architecture/spec) approval is recorded**

Read `docs/superpowers/specs/2026-09-22-scnd-scaling-design.md`'s Status line. Expected: an explicit approval, not "REQUEST CHANGES", not this plan's own assertion. **If absent → STOP and ask.**

- [ ] **Step 3: Baseline the gate**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x) \
  && (cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```
Record the counts. `e2e_accuracy.py` is expected at **99/99**. **If red before any change → STOP**; do not start work on a broken baseline.

- [ ] **Step 4: Create the branch and the audit file**

```bash
git checkout -b scnd-scaling-worker-tier
mkdir -p docs/superpowers/metrics
printf '# Scaling — resolved values\n\nAppend-only. One row per resolved register value (spec §10).\nA missing value is a STOP, never a substitution.\n\n| V | Value | Resolved to | Source | Date |\n|---|---|---|---|---|\n' \
  > docs/superpowers/metrics/scaling-resolved-values.md
git add -A && git commit -m "[S0.1] preflight: branch + resolved-value audit trail"
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
]);

export type SolveClaimant = typeof solveClaimantsTable.$inferSelect;
```

Export it from `lib/db/src/index.ts` alongside the existing schema exports.

- [ ] **Step 4: Push the schema and re-run**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter @workspace/db push
pnpm --filter api-server test claimantRegistry
```
Expected: PASS.

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
  export function claimableWorkerPredicate(): SQL;      // the ONLY definition
  export async function countClaimableWorkers(): Promise<number>;
  export const CLAIMANT_STALENESS_MS: number;
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

// Starting value — spec §10. Three missed heartbeat ticks.
export const CLAIMANT_STALENESS_MS = 90_000;
export const CLAIMANT_HEARTBEAT_INTERVAL_MS = 30_000;

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
  return and(
    eq(solveClaimantsTable.role, "worker"),
    eq(solveClaimantsTable.mode, "worker_only"),
    sql`${solveClaimantsTable.readyAt} IS NOT NULL`,
    eq(solveClaimantsTable.acceptingClaims, true),
    sql`${solveClaimantsTable.heartbeatAt} > now() - ${sql.raw(`interval '${CLAIMANT_STALENESS_MS} milliseconds'`)}`,
  )!;
}

export async function countClaimableWorkers(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(solveClaimantsTable).where(claimableWorkerPredicate());
  return row?.n ?? 0;
}
```

- [ ] **Step 4: Run; expect PASS.**

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

In `jobRunner.ts`, wrap `startDispatcherScheduler()` and the enqueue-time kick:

```ts
import { resolveDispatchMode, isClaimant } from "./dispatchMode.js";
const DISPATCH_MODE = resolveDispatchMode(process.env);

export function isDispatcherScheduled(): boolean { return dispatcherTimer !== null; }

export function startDispatcherScheduler(): void {
  // §1.2: only a claiming mode runs the scan. enqueue_only and worker_standby
  // return here, so there is nothing to disable at runtime and nothing to
  // accidentally re-enable.
  if (!isClaimant(DISPATCH_MODE)) return;
  /* ...existing A2 body unchanged... */
}
```

In `index.ts`, register the claimant before readiness and only serve HTTP when `servesHttp(mode)`.

- [ ] **Step 4: Run; expect PASS. Full gate.**

- [ ] **Step 5: Commit** — `[S2.2] gate dispatcher scan and in-process kick on dispatch mode`

---

## Phase 3 — Worker service

### Task S3.1: Worker entrypoint + Render service

**Files:**
- Create: `artifacts/api-server/src/worker/index.ts`
- Modify: `render.yaml`, `artifacts/api-server/build.mjs`
- Test: `artifacts/api-server/src/__tests__/workerBoot.test.ts`

- [ ] **Step 1: Write the failing test** — boot in `worker_only` registers a claimant, marks ready only after a successful queue probe, and binds no listener.

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement the entrypoint**

```ts
// artifacts/api-server/src/worker/index.ts
import { resolveDispatchMode, claimantRole } from "../solver/dispatchMode.js";
import { registerClaimant, markClaimantReady, heartbeatClaimant,
         stopAcceptingClaims, CLAIMANT_HEARTBEAT_INTERVAL_MS } from "../solver/claimantRegistry.js";
import { getBootClaimGeneration, initDispatcherForBoot,
         startDispatcherScheduler, stopDispatcherScheduler,
         setDraining, waitForActiveJobsToDrain, DRAIN_GATE_MS } from "../solver/jobRunner.js";

const mode = resolveDispatchMode(process.env);   // throws → non-zero exit

async function main() {
  // Boot DB failure → exit non-zero; Render restarts with backoff (§8).
  // A worker that boots "successfully" but claims nothing is worse than one
  // that is visibly restarting.
  await initDispatcherForBoot();
  await registerClaimant(claimantRole(mode), mode, getBootClaimGeneration());
  await markClaimantReady();        // only after the queue probe above succeeded
  setInterval(heartbeatClaimant, CLAIMANT_HEARTBEAT_INTERVAL_MS).unref();
  startDispatcherScheduler();       // no-op in worker_standby (S2.2)
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    // Order matters (§2.1): stop claiming and renounce capacity FIRST, so
    // admission stops counting this worker's slots before it drains.
    stopDispatcherScheduler();
    setDraining(true);
    await stopAcceptingClaims();
    await waitForActiveJobsToDrain(DRAIN_GATE_MS);
    process.exit(0);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Add to `render.yaml`:

```yaml
  - type: worker
    name: nos-solver-worker
    runtime: docker
    dockerfilePath: ./Dockerfile
    dockerCommand: node --enable-source-maps artifacts/api-server/dist/worker.mjs
    plan: starter            # placeholder — V8 sets the real plan at S5.1
    maxShutdownDelaySeconds: 120
    envVars:
      - key: SOLVE_DISPATCH_MODE
        value: worker_standby      # cutover step 1 (§1.2); flipped at step 2
```

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Commit** — `[S3.1] worker entrypoint, SIGTERM order, render worker service`

### Task S3.2: Wake-up path — `LISTEN/NOTIFY` with polling fallback

**Files:** Modify `artifacts/api-server/src/solver/jobRunner.ts`; Test: `artifacts/api-server/src/solver/__tests__/wakeup.test.ts`

- [ ] **Step 1: Write the failing test** — a job enqueued by one connection wakes a listening worker in well under `DISPATCHER_INTERVAL_MS`, and the periodic scan still finds it if `NOTIFY` is disabled.
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** `NOTIFY solve_jobs_enqueued` after the admission transaction commits, and a `LISTEN` session on the worker behind `SOLVE_WAKEUP_MODE=notify|poll`. **The scan is never removed** — it is the durable fallback, and the ledger term in §3.2 depends on which mode ships.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `[S3.2] LISTEN/NOTIFY wake-up with the scan retained as durable fallback`

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
  finished_at    = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN now() END,
  next_attempt_at = CASE WHEN attempts < ${MAX_ATTEMPTS}
    THEN now() + (random() * least(${BASE_SEC} * power(2, attempts - 1), ${CAP_SEC}))
                 * interval '1 second'
  END,
  claim_generation = NULL, claimed_at = NULL, owner_heartbeat_at = NULL
WHERE status = 'running' AND owner_heartbeat_at < now() - ${STALE}
```

*The old owner needs no new fencing: A2's completion predicate is `WHERE id=? AND status='running' AND claim_generation=?`, and a requeued or terminalized row matches neither, so a zombie's late completion updates zero rows and is dropped exactly as A2 already drops stale completions.*

*`random()` is evaluated by Postgres, so the delay is both DB-clock-authoritative and genuinely random — full jitter over `[0, capped]`, which is what de-synchronizes a fleet retrying one dead worker's jobs.*

- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `[S4.3] conditional lease recovery: terminalize at exhaustion, jittered requeue otherwise`

---

## Phase 5 — Admission

### Task S5.1: Resolve V5, V8 and build the connection ledger (V9, V10)

**Files:** Modify `docs/superpowers/metrics/scaling-resolved-values.md`; Create `docs/ops/scnd-connection-ledger.md`

- [ ] **Step 1: Resolve V5 — `mean_service_sec`**

Read it from Measurement's Phase 3/4 artifact. **This field does not exist in `simulate.py`'s `SimResult` today** — the Measurement side must add `total_solver_wall / count(consumes_solver_slot)`. **If the field is absent → STOP and raise it with Measurement**; do not substitute `cpu_N`, which is a CPU-time quantity and answers a different question (S-R12/S-R13).

- [ ] **Step 2: Resolve V4 and V7 — the inputs V8 is computed from**

- **V4 — knee concurrency `N`**: from Measurement's M5.2 topology runs. It is the operating point every other calibrated quantity is measured *at*, so resolving V8 without it means sizing at an unknown concurrency.
- **V7 — per-solve peak RSS**: from M1.2's normalized-peak-RSS primitive in the campaign output. It sets `slots_per_instance` via `capacity.py: map_to_instances(...)` — memory, not CPU, is what caps slots per box.

**If either is absent → STOP.** Do not derive `slots_per_instance` from the instance's advertised memory alone; that ignores what a solve actually holds.

- [ ] **Step 3: Resolve V8 — `slots_per_worker` and worker count** from `capacity.py: size_calibrated_plan(calibration, arrival_rate_per_sec, headroom)`, using V4 and V7. **If Phase 5 topology runs have not produced a calibration → STOP.**

- [ ] **Step 4: Compute the ledger, then read the ceiling — in that order (S-R12)**

```
peak_total = api_generations    × api_instances    × api_pool
           + worker_generations × worker_instances × worker_pool
           + worker_instances   × notify_sessions        # 0 if SOLVE_WAKEUP_MODE=poll
           + controller                                   # §2.2 advisory lock
           + operations_reserve
```
Use `worker_generations = api_generations = 2` (rolling deploy overlap). Then:

```bash
psql "$DATABASE_URL" -c "SHOW max_connections;"
```

**Reading the ceiling before the ledger is complete validates the wrong arithmetic confidently.** If `peak_total` exceeds the ceiling → a transaction pooler (which cannot pool the `LISTEN` sessions) or a larger plan, and the cost goes to spec §4.

- [ ] **Step 5: Record V4, V5, V7, V8, V9 with provenance; commit.**

```bash
git add docs/superpowers/metrics/scaling-resolved-values.md docs/ops/scnd-connection-ledger.md
git commit -m "[S5.1] resolve V4/V5/V7/V8; complete the connection ledger and validate V9"
```

### Task S5.2: Serialized admission transaction

**Files:**
- Create: `artifacts/api-server/src/solver/admission.ts`
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
  const results = await Promise.all(
    Array.from({ length: 50 }, () => admitAndEnqueue(scenarioId, userId, input)),
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
- [ ] **Step 3: Implement**

```ts
export async function admitAndEnqueue(scenarioId, userId, input) {
  return db.transaction(async (tx) => {
    // Serialize on one row. At 0.694 submissions/sec the contention is
    // negligible, and a lock that is obviously correct beats a
    // SERIALIZABLE retry loop that must itself be tested under the burst.
    await tx.execute(sql`SELECT 1 FROM solve_admission WHERE id = 1 FOR UPDATE`);

    // 1. Cache eligibility FIRST — a student whose answer already exists is
    //    never rejected for queue depth (§3.2).
    if (await cacheHit(tx, computeInputsHashV2(input))) return { kind: "cached" };

    // 2. Claimable capacity — the §1.3 predicate, never a nominal count.
    const slots = SLOTS_PER_WORKER * await countClaimableWorkers(tx);
    if (slots === 0) return { kind: "unavailable", retryAfterSec: UNAVAILABLE_RETRY_SEC };

    // 3. Wait, in slot-seconds ÷ slots = seconds.
    const { queued, busy } = await queueState(tx);
    const waitSec = ((queued + busy) * MEAN_SERVICE_SEC) / slots;

    // 4. Decide.
    if (waitSec > QUEUE_WAIT_SLO_SEC) {
      return { kind: "rejected", retryAfterSec: clamp(Math.ceil(waitSec), 5, 120) };
    }
    // 5. Enqueue in the SAME transaction — this is what makes the bound real.
    return { kind: "admitted", jobId: await enqueueSolveJob(tx, scenarioId, userId, input) };
  });
}
```

Replace the `QUEUE_DEPTH_LIMIT` pre-check in `routes/scenarios.ts`; map `rejected → 429`, `unavailable → 503`, both with `Retry-After`.

- [ ] **Step 4: Run; expect PASS. Full gate.**
- [ ] **Step 5: Commit** — `[S5.2] serialized cache/capacity/admission/enqueue transaction`

### Task S5.3: Per-user fairness caps

**Files:** Modify `admission.ts`, `jobRunner.ts`; Test: `admission.test.ts`

- [ ] **Step 1: Write the failing test** — one user cannot exceed `MAX_QUEUED_PER_USER`; the claim query skips a user already at `MAX_RUNNING_PER_USER`; a second user's job is not starved behind the first's backlog.
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** the caps in the admission transaction and the claim predicate. *A cap, not round-robin: round-robin under `SKIP LOCKED` needs a per-user cursor or window function in the hottest query in the system, to buy an ordering property the cap already delivers.*
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `[S5.3] per-user queued/running caps with a starvation bound`

---

## Phase 6 — Retention

### Task S6.1: Resolve V13 and implement the bounded sweep

**Files:** Create `artifacts/api-server/src/solver/retentionSweep.ts`; Test: `retentionSweep.test.ts`

- [ ] **Step 1: Resolve V13 — the retention window in days.** Product input (SP-3). **STOP and ask.** It trades student-visible solve history against storage cost and is not the author's to pick.
- [ ] **Step 2: Write the failing test** — expired terminal rows have `result`/`input_snapshot` nulled *before* the row is deleted, so solve history outlives the heavy payloads; a `solve_claimants` row referenced by any job is never deleted; the sweep holds no lock that blocks the claim path.
- [ ] **Step 3: Run; expect failure.**
- [ ] **Step 4: Implement** batched deletes under a statement timeout, off-peak.
- [ ] **Step 5: Run; expect PASS. Commit** — `[S6.1] bounded retention sweep for jobs, payloads, cache and claimants`

---

## Phase 7 — Cutover

### Task S7.1: Rehearsal and V10

**Files:** Create `docs/ops/scnd-worker-cutover.md`

- [ ] **Step 1: Rehearse the five steps against a non-production database**, per §1.2.
- [ ] **Step 2: Resolve V10** — observe peak `pg_stat_activity` **under a rolling deployment**. This is the only condition that exercises the ledger's overlap term; a steady-state observation cannot validate it. **If the rehearsal environment cannot do a rolling deploy → STOP**, the term stays unverified.
- [ ] **Step 3: Write the runbook** with the exact commands, the `NOT EXISTS` cutover proof, and the rollback.
- [ ] **Step 4: Record V10; commit** — `[S7.1] cutover rehearsal, peak-connection observation, runbook`

### Task S7.2: Production cutover and V11

- [ ] **Step 1: Ask SP-4** — confirm the cutover window (outside a class window) and that a rollback deploy is acceptable. **STOP and wait.**
- [ ] **Step 2: Execute the five steps**, one deploy each: standby → `worker_only` → API `enqueue_only` → proof → scale.
- [ ] **Step 3: Run the proof** — `NOT EXISTS (running job joined to a claimant row with role='api')`, after the old API revision's 120 s drain has elapsed. **If it returns rows → STOP and roll back.**
- [ ] **Step 4: Resolve V11 — boot-to-first-claim.** Instrument scale-API-call → first successful claim. **This is an output of this work, not an input** (spec §10 V11); feed it into §2's pre-scale lead time.
- [ ] **Step 5: Record V11; commit** — `[S7.2] production cutover to worker_only; measure boot-to-first-claim`

---

## Phase 8 — Gates

### Task S8.1: G-WORKER suite

**Files:** Test: `artifacts/api-server/src/solver/__tests__/gWorker.test.ts`

- [ ] **Step 1: Write the suite** — spec §5.1's G-WORKER list in full: G-API's A-reliability proofs, dispatcher-mode enforcement (including `worker_standby` never claims), the registry cutover proof and idle-worker readiness, multi-worker claim under `SKIP LOCKED`, retry exhaustion including the final-attempt kill, fairness/starvation at the cap, DB outage and pool exhaustion, peak connections under a rolling deploy, deletion/cancellation mid-solve.
- [ ] **Step 2: Run against the final built topology** — not the prototype. Measurement's run selected; **this run decides** (§5).
- [ ] **Step 3: Full gate + `e2e_accuracy.py`** — expect 99/99 unmodified, confirming zero solver drift.
- [ ] **Step 4: Commit** — `[S8.1] G-WORKER reliability suite on the built topology`

### Task S8.2: Decision document

- [ ] **Step 1: Resolve V3 and V6 — the cost model's operands**

- **V3 — `cpu_N`**, mean CPU service demand at the knee: `capacity.py: weighted_mean_service_demand(stats, manifest, gap)` over the M1 campaign stats, evaluated at V4's concurrency.
- **V6 — cache hit rate `h`**: from the Phase 3 load-run cache mix.

**If either is absent → STOP.** And note which quantity goes where, because this is the error the spec was corrected for twice: **`cpu_N` sizes and costs; it never answers a latency question.** `mean_service_sec` (V5) is the wall-clock quantity, and it belongs only to §3.2's admission model.

- [ ] **Step 2: Write** `docs/superpowers/specs/2026-09-2x-scnd-pilot-gate-results.md`: per-gate pass/fail, identified bottleneck, worker count and cost recomputed from measured `cpu_N` (V3), sensitivity to `h` (V6) and free-choice frequency, **both cost denominators** (per successful submitted job and per successful CBC execution, per spec §4), and the completed resolved-value table.
- [ ] **Step 3: State the authority plainly** — both applicable gates **and** MP-4 are required for a pilot; capacity never waives reliability. This is Stage 3 (spec preamble).
- [ ] **Step 4: Commit** — `[S8.2] resolve V3/V6; pilot-gate decision document`

---

## Phase 9 — Scheduler *(execute only if V1 = O4)*

### Task S9.1: Resolve V12 and write the calendar
- [ ] Resolve **V12** — class days/windows and IANA timezone. Product input (SP-3). **STOP and ask.** Never a fixed UTC offset; the zone database handles DST.
- [ ] Write `docs/ops/scnd-class-calendar.yaml` with holidays and an expiring manual-override field.
- [ ] Commit — `[S9.1] class calendar with IANA timezone and expiring override`

### Task S9.2: Scaler
- [ ] Test first: idempotent (sets a desired count, never increments), `pg_try_advisory_lock` prevents overlap, bounded retry on 429/5xx, **asserts native autoscaling is OFF** (Render ignores manual counts when it is on, silently defeating the whole cost lever).
- [ ] Implement `scripts/src/scaling/scaler.ts` as a Render Cron Job. *GitHub Actions `schedule` is disqualified: its trigger delay exceeds the pre-scale lead time it would be scheduling.*
- [ ] Reconcile on `countClaimableWorkers()` — the §1.3 predicate, so drainers never inflate the count.
- [ ] Commit — `[S9.2] Render cron scaler with advisory lock and reconciliation`

### Task S9.3: Scale-in safety
- [ ] Test first: enqueue at the drain boundary completes; a job killed at the shutdown budget is requeued **or terminalized** by §3.1; autoscaling-enabled is detected.
- [ ] *No pre-check is implemented, deliberately: Render's scale API picks the victim instance, so there is no instance you can drain on purpose. Safety comes from SIGTERM order + A's lease + bounded attempts.*
- [ ] Commit — `[S9.3] scale-in safety tests and drain contract`

---

## Phase 10 — Coalescing condition *(execute only if V1 = O4)*

### Task S10.1: Resolve V14
- [ ] Run the cold-identical-burst test from G-FLEET; measure duplicate compute.
- [ ] Compare against the selected topology's capacity headroom **and** cost budget (spec §1.1's coalescing condition).
- [ ] **If it fits** → record V14, proceed without single-flight. **If it does not** → **ask SP-2** and stop: single-flight needs its own brainstorm/spec/review cycle before implementation. *Writing it inline is what produced 12 of the A plan's 56 findings across six rounds.*
- [ ] Commit — `[S10.1] resolve the coalescing condition from measured duplicate compute`

---

## Definition of Done

- [ ] Every V-row in spec §10 is either recorded in `scaling-resolved-values.md` with provenance, or visibly marked n/a for the selected outcome. **No row is silently absent.**
- [ ] No spec "starting value" appears in a sizing, admission or cost calculation as a substitute for a resolved value.
- [ ] `worker_id` appears nowhere (S-R16).
- [ ] The full gate is green and `e2e_accuracy.py` passes **99/99 unmodified** — this plan touches no Python.
- [ ] `/harness-retro` has run for the branch.
- [ ] The G-WORKER (or G-FLEET) suite passed on the **final built topology**, and the decision document records it.
