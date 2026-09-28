# Chapter 4 Two-Step Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Chapter 4's free objective toggle with an ordered two-step workflow (Step 1 Max Coverage → Step 2 Min Distance) in which Step 2's coverage floor is produced by Step 1's achieved covered demand and cannot be typed.

**Architecture:** `scenarios.inputs` gains two keys — a server-authoritative `stepEpoch` (validity marker) and `step2` (Step 2's own `gap`/`timeLimitSec`). A step is *solved* when a succeeded `solve_jobs` row exists whose `input_snapshot.inputs.stepEpoch` equals the scenario's current epoch; nothing about step state is stored. One server routine owns every `inputs` write and derives the epoch itself, so no caller can move it incorrectly. The solve route derives its target step inside the existing enqueue lock and synthesizes Step 2's payload — including the floor — at enqueue, never storing it.

**Tech Stack:** Express 5 + Drizzle (Postgres, `drizzle-kit push`), Zod validators, OpenAPI + Orval codegen, React + TanStack Query + wouter, vitest/supertest (API), vitest/RTL (frontend), Playwright (e2e), pytest (solver).

**Source spec:** [`docs/superpowers/specs/2026-09-27-ch4-two-step-workflow-design.md`](../specs/2026-09-27-ch4-two-step-workflow-design.md) — decisions CH4-1…CH4-26. Its §8 is superseded by the US dataset migration's MIG-13: production Chapter 4 rows were deleted on 2026-09-28, so there are **no legacy Chapter 4 scenarios to adopt**. CH4-19 and CH4-20 do not apply and no task implements them.

---

## Global Constraints

Every task's requirements implicitly include this section.

**From the spec (exact values, verbatim):**

- Model id `max-coverage-us`; private wire `modelType` `max_coverage_us`; validator `maxCoverageInputsSchema`; solver entry `solve_max_coverage`. Never treat an old identifier (`chens-cosmetics-cn`, `chens`) as "read as" its replacement (MIG-18).
- `stepEpoch` — integer, minimum 1, defaults to 1.
- `step2` carries **only** `gap` and `timeLimitSec`. `p`, `highServiceDistKm`, `maxDistKm` are inherited from Step 1 and are not editable on Step 2. `avgServiceDistCapKm` does not exist in min-distance mode.
- A **Step 1 field** is any key in `inputs` other than `step2`, `stepEpoch` and `distanceBands`.
- The stored `objective` stays `"coverage"` for every persisted Chapter 4 payload. Only the server may produce a `min_distance` payload.
- Epoch rule: changed keys include a Step 1 field → `stepEpoch = persisted + 1`; changed keys are only `step2`, only `distanceBands`, or both → unchanged.
- Model-registry validator stays the **executable** one (accepts `min_distance`) — durable-job recovery depends on it. Narrowing happens at the write routes.
- Chapter 4 defaults, unchanged by this plan: `p` 3, `highServiceDistKm` 700, `maxDistKm` 5500, `avgServiceDistCapKm` 1000, `distanceBands` [700, 1400, 2800, 5500], `timeLimitSec` 120, `gap` 0. **`highServiceDistKm` and `avgServiceDistCapKm` must never be made equal.**
- Frozen goldens at those defaults: `coveragePct` 68.4192, `coveredDemand` 53385024, open `{DAL, LA, PIT}`, `weightedAvgDistance` 635.13 km. Step 2 at floor 53385024: `objective` 48714263031.75, same open set, `weightedAvgDistance` 624.33 km.
- `scenarios.solveInputRevision`, `scenarios.result`, `scenarios.stale` and the A7 publication CAS are **untouched**.
- No change to the other five models. No change to the workspace navigation chrome. No new if/else branch in `solve.py`.

**From CLAUDE.md (hard rules that bind these tasks):**

- Never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`. Change `lib/api-spec/openapi.yaml`, run codegen, commit spec + regenerated output **in the same commit**.
- `e2e_accuracy.py` is sacred and must pass unmodified. It has no Chapter 4 section — verified zero `max-coverage-us` references — so no task here touches it, but it is still run at the final gate.
- Ownership filtering is security-critical: every scenario query filters by the authenticated `user_id`; non-owned resources return **404, never 403**. The new step-result endpoint inherits this.
- One task = one commit. Message format `[<task-id>] <imperative summary>`.
- Solver business rules enter as data, never as new branches in `solve.py`.

**Learned the hard way in the Chapter 4 migration execution — these are not optional:**

- **Never assert on `Function.prototype.toString()`.** The vitest/esbuild transform **strips comments**, so a source-shape assertion against a stringified function silently tests nothing. For source-shape assertions use `readFileSync`, as `lockedModelGuards.test.ts:33,82` already does.
- **Do not import across packages to satisfy a test.** A cross-package import forces `rootDir` changes and breaks the build.
- **Run every api-server command with `DATABASE_URL` inline.** `lib/db/src/index.ts` throws at import time without it, so eight suites fail at *collection* and look like real failures. Use `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` on every api-server test command in this plan.

---

## Plan-resolution notes (spec text vs. the repo as it stands)

Verified against the tree at `1761260`. Each was checked by reading the named file; every one is resolved inside a task below rather than left for the implementer to discover.

| # | Spec says | Repo actually | Resolved in |
|---|---|---|---|
| 1 | CH4-17 removes the objective toggle at `OptimizationParametersTab.tsx:233` | A **second** toggle exists: `SolveDialog.tsx:226` (`solve-dialog-chen-objective-toggle`) plus its own floor input at `:282`. `Workspace.tsx:1827`'s `setChenObjectiveMode` writes `coverageFloorDemand` into `localInputs`; left in place the UI 422s against this plan's own CH4-25 guard | Task 6 |
| 2 | CH4-22 rewrites `max-coverage.spec.ts`, `chen-bands-units-qa.spec.ts`, `tab-coverage.spec.ts` | The latter two reference neither testid. Real dependents: `max-coverage.spec.ts:208-222` (genuine break) and `nonjade-servicestats-live-coverage.spec.ts:391` (asserts `chen-objective-section`, the wrapper — survives) | Task 9 |
| 3 | §10 requires a new pytest for CH4-21 | Already exists: `test_max_coverage.py:277` runs Step 1 → achieved floor → Step 2 and asserts optimal, floor honoured, distance improved | Task 4 (assert, don't rewrite) |
| 4 | `applyMaxCoverageInputWrite(tx, …)` | The PATCH handler is **not transactional** — a bare `db.select` at `:306` then an unrelated `db.update` at `:351`. A `tx`-taking routine requires wrapping it | Task 2 |
| 5 | §10: `step2` rejects `p`/`highServiceDistKm`/`maxDistKm` | Repo convention is deliberately non-`.strict()` (`pMedian.ts:18` and three others), which would **strip** those keys, not reject them | Task 1 — `step2` is `.strict()`; local exception, documented in code |
| 6 | §10 concurrency regressions | `routes.test.ts:35` mocks `@workspace/db` wholesale, so a mocked `db.transaction` cannot prove epoch serialization | Tasks 2/4 — real-Postgres tests beside `solver/__tests__/scenarioSolveAtomicity.test.ts` |
| 7 | `GET /scenarios/:id` gains `steps` | `toApiScenario` (`routes/scenarios.ts:186`) is synchronous and shared by the list route; a per-scenario query there is an N+1 | Task 5 — single-scenario GET merges separately; list route unchanged |

**Two deliberate naming deviations from the spec, with reasons (hard rule #8):**

- The routine is **`applyScenarioInputWrite`**, not `applyMaxCoverageInputWrite`. CH4-26's stated purpose is that no future writer becomes a sixth exception. A Chapter-4-scoped routine leaves the five model-agnostic `.set({ inputs })` sites in place for a future writer to copy. The routine is universal; the epoch rule fires only for `max-coverage-us`. Same blast radius, accurate name.
- It takes **`userId`**. The spec's three-argument form cannot scope the locked `SELECT` by owner, and hard rule #5 requires it.

---

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `artifacts/api-server/src/services/scenarioInputWrite.ts` | The single `inputs`-write authority: locked read, diff, epoch decision, update. Plus the insert-side epoch initializer. |
| `artifacts/api-server/src/services/maxCoverageSteps.ts` | Pure step logic: Step 1 key classification, epoch computation, Step 2 input synthesis, step-state projection from `solve_jobs`. |
| `artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts` | Pure unit tests, no DB. |
| `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts` | The raw-body 422 guard + the `readFileSync` source-shape test that no route writes `inputs` outside the routine. |
| `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts` | Real-Postgres regressions: epoch across every writer, concurrency, 409, recovered Step 2 job, steps projection. Grows across Tasks 2–5. |
| `artifacts/studio/src/hooks/useMaxCoverageSteps.ts` | Derives step state + the solve-target label from the `steps` object. |
| `artifacts/studio/src/components/workspace/StepToggle.tsx` | Header step toggle + `N of 2 solved` counter. |
| `artifacts/studio/src/components/workspace/FreezeConfirmDialog.tsx` | Confirm-and-clear interception dialog. |
| `artifacts/studio/src/components/workspace/StepComparisonTable.tsx` | Frame 3d side-by-side comparison, rendered at `2 of 2`. |
| `artifacts/studio/src/__tests__/StepToggle.test.tsx` | RTL coverage for the toggle and counter. |
| `artifacts/studio/src/__tests__/StepComparisonTable.test.tsx` | RTL coverage for the comparison table. |

**Modified files**

| Path | Change |
|---|---|
| `artifacts/api-server/src/validation/inputs/maxCoverage.ts` | Declare `stepEpoch` + `step2`. |
| `lib/db/src/schema/solve_jobs.ts` | Partial unique index over active rows. |
| `artifacts/api-server/src/routes/scenarios.ts` | Route create/PATCH/import-apply/clone through the routine; raw-body guard; 409 mapping; `steps` on the single GET; new step-result endpoint. |
| `artifacts/api-server/src/solver/jobRunner.ts` | Derive target step in the enqueue lock; synthesize Step 2 input; active-job guard. |
| `lib/api-spec/openapi.yaml` | `steps` on `Scenario`; `409` on solve; the new endpoint. |
| `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx` | Remove the free toggle; per-step rendering. |
| `artifacts/studio/src/components/workspace/SolveDialog.tsx` | Remove the second toggle and the floor input. |
| `artifacts/studio/src/pages/Workspace.tsx` | Remove `setChenObjectiveMode` min-distance authoring; header toggle; freeze interception; per-step output gating. |
| `artifacts/studio/src/components/workspace/SidebarTree.tsx` | Keep output entries clickable when unsolved (CH4-18). |
| `artifacts/studio/e2e/max-coverage.spec.ts` | Rewrite step 4 to the two-step flow. |

---

## Task 0: Dependency audit — run before Task 1, and again before closeout

**Files:** none changed. This task produces a recorded finding list, not a diff.

**Why it is a task and not a paragraph.** The review supplied this audit as prose; prose gets skipped. It runs **twice** — once before implementation, so an unexpected consumer is found while the plan can still absorb it, and once before final approval, so a consumer added *during* implementation cannot slip through.

- [ ] **Step 1: Backend writers and enqueue consumers**

```bash
rg -n "enqueueScenarioSolve|solveJobsTable" artifacts/api-server/src
rg -n "inputs:|jsonb_set" artifacts/api-server/src/routes artifacts/api-server/src/services
```

Expected known set: `routes/scenarios.ts` (create, PATCH, import/apply, clone, solve), `routes/distanceBands.ts` (`jsonb_set`), `solver/jobRunner.ts`, `routes/solveHistory.ts` (read-only). Anything else must either route through `applyScenarioInputWrite` / `initialInputsForInsert` or be recorded here with the reason it is safe.

- [ ] **Step 2: Frontend result-state and both parameter-editor mounts**

```bash
rg -n "displayedResult|displayedInputs|hasFreshSolvedRun|resultHistoryState" artifacts/studio/src
rg -n "SolveDialog|OptimizationParametersTab" artifacts/studio/src artifacts/studio/e2e
```

Baseline measured at `32cacf8`: 44 hits for the first group in `Workspace.tsx` alone, plus `Workspace.DisplayedInputs.test.tsx` (309 lines). Every hit is a call site Task 8's adapter must cover or deliberately leave on the legacy path. **Known consumers outside `Workspace.tsx` that read `scenario.result` directly and need the Chapter 4 treatment: `CostSummaryTab.tsx:126`, `ObjectiveBar.tsx:40`** (finding A1).

- [ ] **Step 3: Sibling e2e dependencies and removed selectors**

```bash
rg -n "max-coverage-us|Run Optimizer|chen-objective|coverage-floor" artifacts/studio/e2e
```

Known: `max-coverage.spec.ts` (real breakage), `nonjade-servicestats-live-coverage.spec.ts:391` (wrapper only, survives). A hit in any other spec is the recurring `spec_gap` class — fix it in Task 9, before merge.

- [ ] **Step 4: Contract, data, and ancestry checks**

- **Contract:** edit `openapi.yaml` first, regenerate, inspect the generated diff, then typecheck every consumer. Confirm only OpenAPI-derived files changed and none was hand-edited (hard rule #1).
- **Data:** verify the MIG-13 premise *in the target database*, not from this plan's prose — the queries are in Task 10 Step 1. A legacy `objective: "min_distance"` row is a stop-and-ask.
- **Ancestry:** confirm the implementation branch contains the dataset-migration commits before relying on legacy compatibility being gone:

```bash
git merge-base --is-ancestor 1761260 HEAD && echo "migration present" || echo "STOP - migration not in ancestry"
```

- **Other models:** run enqueue, PATCH, output and e2e regressions for at least one non-Chapter-4 model. Task 4's non-Chapter-4 enqueue regression is the minimum; `p-median-us` e2e is the fuller check.
- **Ownership:** prove both the scenario read and the step-result read return 404 for a non-owner (Task 5 covers both).

- [ ] **Step 5: Record the findings**

Write the unexpected hits and their dispositions into the branch's progress ledger before Task 1 begins. An audit whose findings are not written down is an audit that did not happen.

---

## Task 1: `stepEpoch` / `step2` in the validator, and the one-active-job index

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/maxCoverage.ts:96-175`
- Modify: `lib/db/src/schema/solve_jobs.ts:1`, `:110-117`
- Test: `artifacts/api-server/src/validation/inputs/__tests__/maxCoverage.test.ts`
- Test: `artifacts/api-server/src/__tests__/schemaColumns.test.ts`

**Interfaces:**
- Produces: `maxCoverageInputsSchema` now accepts and preserves `stepEpoch: number` (int, ≥1, default 1) and `step2?: { gap: number; timeLimitSec: number }`. Type `MaxCoverageInputs` gains both. `solveJobsTable` gains index `UQ_solve_jobs_active_per_scenario`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing validation tests**

Append to `artifacts/api-server/src/validation/inputs/__tests__/maxCoverage.test.ts`. `baseCoverageInputs()` below is defined locally in this step — do not assume a helper of that name already exists in the file.

```ts
describe("two-step workflow keys (CH4-5, CH4-6, CH4-7)", () => {
  function baseCoverageInputs(): Record<string, unknown> {
    return {
      objective: "coverage",
      p: 3,
      highServiceDistKm: 700,
      maxDistKm: 5500,
      avgServiceDistCapKm: 1000,
      gap: 0,
      timeLimitSec: 120,
      capacityMode: "none",
      distanceBands: [700, 1400, 2800, 5500],
      warehouseOverrides: [],
      customerOverrides: [],
      addedWarehouses: [],
      addedCustomers: [],
      distanceOverrides: [],
    };
  }

  it("round-trips stepEpoch and step2 without stripping them", () => {
    const parsed = maxCoverageInputsSchema.parse({
      ...baseCoverageInputs(),
      stepEpoch: 4,
      step2: { gap: 0.01, timeLimitSec: 60 },
    });
    expect(parsed.stepEpoch).toBe(4);
    expect(parsed.step2).toEqual({ gap: 0.01, timeLimitSec: 60 });
  });

  it("defaults stepEpoch to 1 for a payload that predates the workflow", () => {
    const parsed = maxCoverageInputsSchema.parse(baseCoverageInputs());
    expect(parsed.stepEpoch).toBe(1);
    expect(parsed.step2).toBeUndefined();
  });

  it("rejects stepEpoch below 1 and non-integer stepEpoch", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...baseCoverageInputs(), stepEpoch: 0 }).success).toBe(false);
    expect(maxCoverageInputsSchema.safeParse({ ...baseCoverageInputs(), stepEpoch: 1.5 }).success).toBe(false);
  });

  // CH4-6 — these three are inherited from Step 1. Rejection, not stripping:
  // step2 is `.strict()` precisely so a client cannot smuggle them in.
  it.each(["p", "highServiceDistKm", "maxDistKm", "avgServiceDistCapKm"])(
    "rejects %s inside step2",
    (field) => {
      const result = maxCoverageInputsSchema.safeParse({
        ...baseCoverageInputs(),
        step2: { gap: 0, timeLimitSec: 60, [field]: 1 },
      });
      expect(result.success).toBe(false);
    },
  );

  it("requires both gap and timeLimitSec when step2 is present", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...baseCoverageInputs(), step2: { gap: 0 } }).success).toBe(false);
    expect(maxCoverageInputsSchema.safeParse({ ...baseCoverageInputs(), step2: { timeLimitSec: 60 } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/validation/inputs/__tests__/maxCoverage.test.ts
```

Expected: FAIL — `parsed.stepEpoch` is `undefined` (Zod strips the undeclared key), and every `step2` rejection case passes-through instead of erroring.

- [ ] **Step 3: Declare both keys in the schema**

In `artifacts/api-server/src/validation/inputs/maxCoverage.ts`, insert immediately above `export const maxCoverageInputsSchema` (currently line 96):

```ts
// CH4-6 — Step 2 owns exactly two parameters. `p`, `highServiceDistKm` and
// `maxDistKm` are INHERITED from Step 1 (inheriting highServiceDistKm is
// load-bearing: the floor must constrain demand within the same radius that
// produced it), and `avgServiceDistCapKm` does not exist in min-distance mode.
//
// `.strict()` here is a DELIBERATE local exception to this repo's
// non-strict convention (pMedian.ts:18, jadeInputs.ts:6, twoEchelon.ts:30,
// transportLp.ts:6). That convention exists so an OLD payload missing a key
// still validates; `step2` is new, so there is no legacy shape to be lenient
// toward, and CH4-6 requires the inherited fields to be REJECTED rather than
// silently stripped — a strip would accept a Step 2 payload that looks like
// it re-parameterized the network and quietly ignore it.
const step2ParamsSchema = z
  .object({
    gap: z.number().min(0),
    timeLimitSec: z.number().int().min(1),
  })
  .strict();
```

Then add these two properties inside the `z.object({ … })` body, directly after the `timeLimitSec` line (currently line 111):

```ts
    // CH4-7/CH4-23 — the step-validity marker. SERVER-AUTHORITATIVE: declared
    // here so it round-trips instead of being stripped, but every write route
    // discards whatever the client sent and recomputes it from the persisted
    // row (services/scenarioInputWrite.ts). Declaring it without that guard
    // would let a client submit an OLD epoch and resurrect a superseded job.
    // Defaults to 1 so a payload written before this contract reads as epoch 1.
    stepEpoch: z.number().int().min(1).default(1),
    // Absent until Step 2 is first touched.
    step2: step2ParamsSchema.optional(),
```

- [ ] **Step 4: Run the validation tests to verify they pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/validation/inputs/__tests__/maxCoverage.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Write the failing index test**

Append to `artifacts/api-server/src/__tests__/schemaColumns.test.ts`:

```ts
describe("CH4-11 — one active solve job per Chapter 4 scenario", () => {
  it("declares a partial unique index scoped to max-coverage-us AND active status", () => {
    const config = getTableConfig(solveJobsTable);
    const unique = config.indexes.find((i) => i.config.name === "UQ_solve_jobs_active_per_scenario");
    expect(unique).toBeDefined();
    expect(unique!.config.unique).toBe(true);

    // R1 — assert the PREDICATE, not merely that a `where` exists. A test that
    // only checks `where !== undefined` passes just as happily on an unscoped
    // index, which is the exact defect this assertion exists to catch: an
    // unscoped predicate would impose one-active-job on all six models.
    const predicate = JSON.stringify(unique!.config.where);
    expect(predicate).toContain("max-coverage-us");
    expect(predicate).toContain("queued");
    expect(predicate).toContain("running");
  });
});
```

Add the import at the top of that file:

```ts
import { getTableConfig } from "drizzle-orm/pg-core";
```

- [ ] **Step 6: Run the index test to verify it fails**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/schemaColumns.test.ts
```

Expected: FAIL — `unique` is `undefined`.

- [ ] **Step 7: Add the partial unique index**

In `lib/db/src/schema/solve_jobs.ts`, extend the import on line 1 to include `uniqueIndex`:

```ts
import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index, uniqueIndex, doublePrecision, check, pgSequence } from "drizzle-orm/pg-core";
```

Then add to the table-extras array (after the `IDX_solve_jobs_owner_heartbeat_running` entry, currently line 117):

```ts
  // CH4-11 — at most ONE active job per scenario, enforced by the DATABASE.
  // enqueueScenarioSolve locks the scenario row and then inserts WITHOUT
  // checking for an existing job; the row lock serialises the two
  // transactions but does not make the second one refuse. This index does.
  // It matters more for max-coverage-us than for a single-objective model
  // because the target step is DERIVED FROM STATE (CH4-9): two Step 1
  // enqueues at `0 of 2` race, and whichever publishes second decides what
  // `1 of 2` means. Belt-and-braces with the in-transaction guard, the same
  // posture lockedModelGuards.test.ts applies to route guards.
  // R1 — SCOPED TO CHAPTER 4. The predicate carries `model_id` as well as
  // status. An unscoped index would silently impose one-active-job on all six
  // models, contradicting this plan's own "no change to the other five" scope
  // line, and would break scenarioSolveAtomicity.test.ts, which deliberately
  // enqueues a second p-median-us job while the first is still queued (9 call
  // sites). A repo-wide policy is a separate decision with its own migration
  // and compatibility review — not something to smuggle in here.
  uniqueIndex("UQ_solve_jobs_active_per_scenario")
    .on(table.scenarioId)
    .where(sql`${table.modelId} = 'max-coverage-us' AND ${table.status} IN ('queued', 'running')`),
```

- [ ] **Step 8: Verify no scenario already holds two active rows, then push the schema**

The index is additive and nullable-free, so hard rule #3's NOT NULL protocol does not apply — but it cannot be created while a violating row pair exists. Check first:

```bash
psql "postgresql://shubhamkr@localhost:5432/nos_dev" -c \
  "SELECT scenario_id, count(*) FROM solve_jobs \
   WHERE model_id = 'max-coverage-us' AND status IN ('queued','running') \
   GROUP BY scenario_id HAVING count(*) > 1;"
```

R1 — the preflight is model-scoped for the same reason the index is. An unscoped count would block the push on a perfectly legal pair of active p-median jobs.

Expected: `(0 rows)`. If any row comes back, STOP and report — do not delete jobs to make the index apply.

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter @workspace/db push
```

Expected: the push reports creating `UQ_solve_jobs_active_per_scenario` and exits 0.

- [ ] **Step 9: Run the index test to verify it passes**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/schemaColumns.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add artifacts/api-server/src/validation/inputs/maxCoverage.ts \
        artifacts/api-server/src/validation/inputs/__tests__/maxCoverage.test.ts \
        lib/db/src/schema/solve_jobs.ts \
        artifacts/api-server/src/__tests__/schemaColumns.test.ts
git commit -m "[ch4-2s-1] declare stepEpoch/step2 and add the one-active-job index"
```

---

## Task 2: `applyScenarioInputWrite` — the epoch authority, bound to every writer

**Files:**
- Create: `artifacts/api-server/src/services/maxCoverageSteps.ts`
- Create: `artifacts/api-server/src/services/scenarioInputWrite.ts`
- Create: `artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts`
- Create: `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts`
- Modify: `artifacts/api-server/src/routes/scenarios.ts:238` (create), `:268-370` (PATCH), `:1888` (import/apply), `:1921` (clone)

**Interfaces:**
- Consumes: `maxCoverageInputsSchema`, `MaxCoverageInputs` (Task 1).
- Produces:
  - `MAX_COVERAGE_MODEL_ID = "max-coverage-us"`
  - `NON_STEP1_KEYS: ReadonlySet<string>` — `{"step2", "stepEpoch", "distanceBands"}`
  - `isStep1Key(key: string): boolean`
  - `nextStepEpoch(persisted: Record<string, unknown>, next: Record<string, unknown>): number`
  - `initialInputsForInsert(modelId: string, inputs: Record<string, unknown>): Record<string, unknown>`
  - `applyScenarioInputWrite(tx, params: { scenarioId: number; userId: string; nextInputs: Record<string, unknown> }): Promise<{ kind: "ok"; row: Scenario } | { kind: "not_found" }>`

- [ ] **Step 1: Write the failing pure-unit tests**

Create `artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isStep1Key, nextStepEpoch, initialInputsForInsert } from "../maxCoverageSteps.js";

describe("CH4-7 — Step 1 key classification", () => {
  it("treats step2, stepEpoch and distanceBands as NOT Step 1 fields", () => {
    expect(isStep1Key("step2")).toBe(false);
    expect(isStep1Key("stepEpoch")).toBe(false);
    expect(isStep1Key("distanceBands")).toBe(false);
  });

  it("treats every other inputs key as a Step 1 field", () => {
    for (const key of ["p", "highServiceDistKm", "maxDistKm", "avgServiceDistCapKm",
                       "objective", "gap", "timeLimitSec", "warehouseOverrides",
                       "customerOverrides", "addedWarehouses", "addedCustomers",
                       "distanceOverrides", "capacityMode"]) {
      expect(isStep1Key(key)).toBe(true);
    }
  });
});

describe("CH4-23 — epoch computation from persisted vs candidate", () => {
  const persisted = { p: 3, gap: 0, stepEpoch: 5, distanceBands: [700, 5500], step2: { gap: 0, timeLimitSec: 60 } };

  it("bumps when a Step 1 field changed", () => {
    expect(nextStepEpoch(persisted, { ...persisted, p: 4 })).toBe(6);
  });

  it("does not bump for a step2-only change", () => {
    expect(nextStepEpoch(persisted, { ...persisted, step2: { gap: 0.01, timeLimitSec: 60 } })).toBe(5);
  });

  it("does not bump for a distanceBands-only change", () => {
    expect(nextStepEpoch(persisted, { ...persisted, distanceBands: [700, 1400, 5500] })).toBe(5);
  });

  it("does not bump when step2 and distanceBands both change and nothing else", () => {
    expect(nextStepEpoch(persisted, {
      ...persisted,
      step2: { gap: 0.02, timeLimitSec: 90 },
      distanceBands: [700, 1400, 5500],
    })).toBe(5);
  });

  it("does not bump when nothing changed at all", () => {
    expect(nextStepEpoch(persisted, { ...persisted })).toBe(5);
  });

  // A client-supplied stepEpoch is never an input to the decision: the only
  // thing that moves the epoch is a Step 1 field diff against the PERSISTED row.
  it("ignores a client-supplied stepEpoch entirely", () => {
    expect(nextStepEpoch(persisted, { ...persisted, stepEpoch: 1 })).toBe(5);
    expect(nextStepEpoch(persisted, { ...persisted, stepEpoch: 99 })).toBe(5);
    expect(nextStepEpoch(persisted, { ...persisted, stepEpoch: 1, p: 4 })).toBe(6);
  });

  it("reads an absent persisted epoch as 1", () => {
    expect(nextStepEpoch({ p: 3 }, { p: 4 })).toBe(2);
    expect(nextStepEpoch({ p: 3 }, { p: 3 })).toBe(1);
  });
});

describe("CH4-26 — insert-side epoch initialization", () => {
  it("forces stepEpoch to 1 for a max-coverage-us insert, discarding any supplied value", () => {
    expect(initialInputsForInsert("max-coverage-us", { p: 3, stepEpoch: 77 }).stepEpoch).toBe(1);
    expect(initialInputsForInsert("max-coverage-us", { p: 3 }).stepEpoch).toBe(1);
  });

  it("leaves another model's inputs untouched", () => {
    const inputs = { p: 3, capacityMode: "none" };
    expect(initialInputsForInsert("p-median-us", inputs)).toEqual(inputs);
    expect("stepEpoch" in initialInputsForInsert("p-median-us", inputs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/services/__tests__/maxCoverageSteps.test.ts
```

Expected: FAIL — `Cannot find module '../maxCoverageSteps.js'`.

- [ ] **Step 3: Write the pure step module**

Create `artifacts/api-server/src/services/maxCoverageSteps.ts`:

```ts
// CH4-7 / CH4-23 / CH4-26 — pure step logic for max-coverage-us's two-step
// workflow. No DB access lives here: every function is a pure transform, so
// the epoch rule can be tested exhaustively without Postgres.

export const MAX_COVERAGE_MODEL_ID = "max-coverage-us";

// A "Step 1 field" is any key in `inputs` other than these three. `step2` is
// Step 2's own parameters; `stepEpoch` is the marker itself; `distanceBands`
// is a reporting lens, not a model constraint, so it stays editable while
// Step 1 is frozen.
export const NON_STEP1_KEYS: ReadonlySet<string> = new Set(["step2", "stepEpoch", "distanceBands"]);

export function isStep1Key(key: string): boolean {
  return !NON_STEP1_KEYS.has(key);
}

// Per-key comparison via JSON.stringify, matching routes/scenarios.ts's own
// diffInputKeys: a key present on only one side always counts as changed,
// and one key's internal ordering cannot mask a change in a DIFFERENT key.
function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])) changed.push(key);
  }
  return changed;
}

export function readStepEpoch(inputs: Record<string, unknown> | null | undefined): number {
  const raw = inputs?.stepEpoch;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : 1;
}

// CH4-23 — the epoch is computed from the PERSISTED row and the candidate,
// never from a client value. Deliberately takes no `changedKeys` argument:
// an earlier draft did, which would have made the epoch boundary exactly as
// trustworthy as each caller's own diffing — and the whole point is that
// callers cannot be trusted (import/apply demonstrably isn't). A guard that
// accepts the guarded value as an argument is not a guard.
export function nextStepEpoch(
  persisted: Record<string, unknown>,
  next: Record<string, unknown>,
): number {
  const current = readStepEpoch(persisted);
  const touchedStep1 = changedKeys(persisted, next).some(isStep1Key);
  return touchedStep1 ? current + 1 : current;
}

// CH4-26 — create and clone both force epoch 1. For clone this is the whole
// point: carrying the source's epoch forward would make a fresh copy's epoch
// depend on how many times its SOURCE had been edited. Epoch is per-scenario
// workflow state, not user data, so it does not travel with a copy.
export function initialInputsForInsert(
  modelId: string,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return inputs;
  return { ...inputs, stepEpoch: 1 };
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/services/__tests__/maxCoverageSteps.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Write the write-authority routine**

Create `artifacts/api-server/src/services/scenarioInputWrite.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { scenariosTable } from "@workspace/db";
import { validateInputsForModel } from "../validation/inputs/index.js";
import { normalizeAddedEntityDistances } from "./autoDistance.js";
import { MAX_COVERAGE_MODEL_ID, nextStepEpoch } from "./maxCoverageSteps.js";
import { isStep1Key } from "./maxCoverageSteps.js";

export type ScenarioRow = typeof scenariosTable.$inferSelect;

export type ApplyInputWriteOutcome =
  | { kind: "ok"; row: ScenarioRow }
  | { kind: "not_found" }
  | { kind: "invalid"; error: string };

export interface ApplyScenarioInputWriteParams {
  scenarioId: number;
  userId: string;
  nextInputs: Record<string, unknown>;
}

/**
 * CH4-26 — the SINGLE place `scenarios.inputs` is updated. Every update-side
 * writer (PATCH, import/apply) calls this instead of composing its own
 * `.set({ inputs, … })`; create and clone use `initialInputsForInsert`.
 * `routes/distanceBands.ts` is the one deliberate exception: it writes a
 * single `jsonb_set` on `{distanceBands}` alone, which preserves the epoch BY
 * CONSTRUCTION and must keep its atomic field-scoped write — that property is
 * asserted by test, not re-implemented here.
 *
 * It takes no `changedKeys` argument. It selects the persisted row FOR UPDATE,
 * normalizes the candidate the same way the write path does, and computes the
 * diff itself — so a caller that miscomputes or omits a key cannot move the
 * epoch incorrectly, because it never supplies the input to that decision.
 *
 * Ownership-scoped (hard rule #5): a row the caller does not own is simply
 * not found, so a non-owner can never distinguish "not yours" from "absent".
 * This is why the routine takes `userId`, unlike the spec's three-argument
 * sketch — that form cannot scope the locked SELECT.
 */
export async function applyScenarioInputWrite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle's tx type is not exported
  tx: any,
  params: ApplyScenarioInputWriteParams,
): Promise<ApplyInputWriteOutcome> {
  const [persisted] = await tx.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, params.scenarioId), eq(scenariosTable.userId, params.userId)))
    .for("update");
  if (!persisted) return { kind: "not_found" };

  const validation = validateInputsForModel(persisted.modelId, params.nextInputs);
  if (!validation.success) return { kind: "invalid", error: validation.error };

  const normalized = normalizeAddedEntityDistances(
    persisted.modelId,
    validation.data,
  ) as Record<string, unknown>;

  const persistedInputs = (persisted.inputs ?? {}) as Record<string, unknown>;

  // CH4-23 — discard whatever the client sent and recompute from the locked
  // row. Computed inside this transaction, never read-modify-write in
  // application code, so two concurrent edits cannot both derive the same
  // next epoch.
  const inputsToStore: Record<string, unknown> =
    persisted.modelId === MAX_COVERAGE_MODEL_ID
      ? { ...normalized, stepEpoch: nextStepEpoch(persistedInputs, normalized) }
      : normalized;

  // Unchanged semantics for every model: a save is non-geometric (does not
  // bump inputsUpdatedAt / solve_input_revision) ONLY when distanceBands is
  // the sole changed key. CH4-8 — solve_input_revision is left alone by the
  // step workflow; a Step 2 parameter write is a real inputs change and bumps
  // it exactly as any other non-bands change already did.
  //
  // A2 — this absorbs import/apply's old invariant. That call site used to
  // carry the comment "import/apply is always a geometric input write ... so
  // it always increments solve_input_revision, DB-side, unconditionally"
  // (routes/scenarios.ts:1884-1887). Routing it through here makes the bump
  // CONDITIONAL in form — but not in effect, because distanceBands is never
  // an imported entity, so the bands-only branch is unreachable from that
  // caller. Delete the now-inaccurate comment at the call site rather than
  // leaving a claim the code no longer literally makes.
  const changed = new Set([
    ...Object.keys(persistedInputs),
    ...Object.keys(inputsToStore),
  ].filter((k) => JSON.stringify(persistedInputs[k]) !== JSON.stringify(inputsToStore[k])));
  changed.delete("stepEpoch");
  const isBandsOnlyChange = [...changed].every((k) => k === "distanceBands");

  const [row] = await tx.update(scenariosTable)
    .set({
      inputs: inputsToStore,
      updatedAt: new Date(),
      ...(isBandsOnlyChange
        ? {}
        : {
            inputsUpdatedAt: new Date(),
            solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1`,
          }),
    })
    .where(and(eq(scenariosTable.id, params.scenarioId), eq(scenariosTable.userId, params.userId)))
    .returning();

  return { kind: "ok", row };
}

// Re-exported so route files import one module for the whole write contract.
export { initialInputsForInsert, isStep1Key } from "./maxCoverageSteps.js";
```

- [ ] **Step 6: Route all four writers through it**

Four edits in `artifacts/api-server/src/routes/scenarios.ts`. Add the import beside the existing `validateInputsForModel` import (line 10):

```ts
import { applyScenarioInputWrite, initialInputsForInsert } from "../services/scenarioInputWrite.js";
```

**(a) create** — at line 238, wrap the validated inputs:

```ts
  const [row] = await db.insert(scenariosTable).values({
    name: body.name,
    userId: req.userId!,
    modelId: body.modelId,
    inputs: initialInputsForInsert(
      body.modelId,
      normalizeAddedEntityDistances(body.modelId, validation.data) as Record<string, unknown>,
    ),
    result: null,
  }).returning();
```

**(b) PATCH** — the handler is not transactional today. Replace the whole `if (body.inputs !== undefined) { … }` block (lines 306-345) and the trailing `db.update` (lines 351-354) with a single transaction. The name-only path keeps its existing non-transactional shape.

**R8 — a combined `{ name, inputs }` PATCH must be atomic.** An earlier draft committed `inputs` inside the transaction and then updated `name` in a separate statement afterwards, so a failure on the second left the client holding a half-applied PATCH. Both writes live in one transaction below, and the transaction returns the final row — no post-commit re-SELECT, which could also observe a concurrent write:

```ts
  // CH4-26 — an inputs PATCH runs inside ONE transaction so the locked read,
  // the diff, the epoch decision, the write and any rename are atomic. Before
  // this change the handler did a bare SELECT and an unrelated UPDATE, which
  // cannot carry a FOR UPDATE lock across the two.
  if (body.inputs !== undefined) {
    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ modelId: scenariosTable.modelId }).from(scenariosTable)
        .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
      if (!existing) return { kind: "not_found" } as const;
      // ch4-lock — checked BEFORE any write (the guard-placement rule
      // lockedModelGuards.test.ts enforces).
      if (isModelLocked(existing.modelId)) return { kind: "locked" } as const;

      const written = await applyScenarioInputWrite(tx, {
        scenarioId: id,
        userId: req.userId!,
        nextInputs: body.inputs as Record<string, unknown>,
      });
      if (written.kind !== "ok") return written;

      // R8 — same transaction, and the renamed row is what we return.
      if (body.name !== undefined) {
        const [renamed] = await tx.update(scenariosTable)
          .set({ name: body.name, updatedAt: new Date() })
          .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
          .returning();
        return { kind: "ok", row: renamed } as const;
      }
      return written;
    });

    if (outcome.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
    if (outcome.kind === "locked") { respondLocked(res); return; }
    if (outcome.kind === "invalid") { res.status(422).json({ error: outcome.error }); return; }

    posthog?.capture({
      distinctId: req.userId!,
      event: "scenario updated",
      properties: {
        scenario_id: outcome.row.id,
        model_id: outcome.row.modelId,
        updated_fields: body.name !== undefined ? ["name", "inputs"] : ["inputs"],
      },
    });

    res.json(toApiScenario(outcome.row));
    return;
  }
```

Acceptance row 14 — the regression, written out rather than merely named. Append to `maxCoverageStepWorkflow.test.ts`:

```ts
describe("R8 — combined name-and-inputs PATCHes are atomic", () => {
  it("applies both when the write succeeds", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ name: "renamed together", inputs: { ...step1Inputs, p: 4 } }).expect(200);

    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(row!.name).toBe("renamed together");
    expect((row!.inputs as Record<string, unknown>).p).toBe(4);
    expect(await readEpoch(scenario.id)).toBe(2);
  });

  // The half that actually proves atomicity: a rejected inputs payload must
  // leave the NAME untouched too. Asserted against the persisted row — the
  // response status alone cannot distinguish "rolled back" from "name applied
  // anyway".
  it("applies NEITHER when the inputs half is rejected", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [before] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ name: "must not stick", inputs: { ...step1Inputs, p: 4, coverageFloorDemand: 1 } })
      .expect(422);

    const [after] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(after!.name).toBe(before!.name);
    expect((after!.inputs as Record<string, unknown>).p).toBe(3);
    expect(await readEpoch(scenario.id)).toBe(1);
  });
});
```

**(c) import/apply** — at line 1888, replace the bare `db.update` with the routine. Delete the surrounding `normalizeAddedEntityDistances` call at line 1885 (the routine now performs it) and the unconditional `solveInputRevision` bump (the routine decides):

```ts
  // CH4-26 — import/apply was the live hole: it wrote `inputs` and bumped
  // solve_input_revision unconditionally but knew nothing about stepEpoch,
  // and it never passes through the confirm-and-clear UI. Without the bump a
  // student could import a new customer set and keep looking at results
  // computed from the old one — the precise failure CH4-7 exists to prevent,
  // arriving through the one door the freeze does not cover.
  const writeOutcome = await db.transaction(async (tx) =>
    applyScenarioInputWrite(tx, {
      scenarioId: id,
      userId: req.userId!,
      nextInputs: nextInputs as Record<string, unknown>,
    }),
  );
  if (writeOutcome.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (writeOutcome.kind === "invalid") { res.status(422).json({ error: writeOutcome.error }); return; }
  const updated = writeOutcome.row;
```

**(d) clone** — at line 1921:

```ts
  const [clone] = await db.insert(scenariosTable).values({
    name: `${scenario.name} (copy)`,
    userId: req.userId!,
    modelId: scenario.modelId,
    // CH4-26 — a clone copies the student's parameters (Step 1 fields,
    // step2, distanceBands) but NOT the workflow metadata. It has no jobs to
    // invalidate, but carrying the source's epoch forward would make a fresh
    // copy's epoch depend on its source's edit history.
    inputs: initialInputsForInsert(scenario.modelId, scenario.inputs as Record<string, unknown>),
    result: null,
  }).returning();
```

- [ ] **Step 7: Write the failing real-Postgres regressions**

Create `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts`. Real, unmocked Postgres — `routes.test.ts` mocks `@workspace/db` wholesale, so a mocked `db.transaction` cannot prove any of this. Mirrors `scenarioSolveAtomicity.test.ts`'s conventions.

```ts
// CH4-23/CH4-26 — real, unmocked Postgres. Run with a live DATABASE_URL:
//   DATABASE_URL=postgresql://... pnpm --filter api-server exec vitest run \
//     src/solver/__tests__/maxCoverageStepWorkflow.test.ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import app from "../../app.js";

const scenarioIds: number[] = [];
const registeredUserIds: string[] = [];

const step1Inputs = {
  objective: "coverage",
  p: 3,
  highServiceDistKm: 700,
  maxDistKm: 5500,
  avgServiceDistCapKm: 1000,
  gap: 0,
  timeLimitSec: 120,
  capacityMode: "none",
  distanceBands: [700, 1400, 2800, 5500],
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

async function registerAndGetCookie(): Promise<string> {
  const email = `ch4-2s-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  registeredUserIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

async function createScenario(cookie: string) {
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name: "two-step fixture", modelId: "max-coverage-us", inputs: step1Inputs });
  expect(res.status).toBe(201);
  scenarioIds.push(res.body.id);
  return res.body;
}

async function readEpoch(scenarioId: number): Promise<number> {
  const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenarioId));
  return (row!.inputs as Record<string, unknown>).stepEpoch as number;
}

afterAll(async () => {
  if (scenarioIds.length > 0) {
    await db.delete(solveJobsTable).where(inArray(solveJobsTable.scenarioId, scenarioIds));
    await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  }
  if (registeredUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, registeredUserIds));
  }
});

describe("CH4-26 — epoch authority across every inputs writer", () => {
  it("create forces stepEpoch = 1", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    expect(await readEpoch(scenario.id)).toBe(1);
  });

  it("a Step 1 PATCH bumps the epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);
  });

  it("a step2-only PATCH does not bump the epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, step2: { gap: 0.01, timeLimitSec: 60 } } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(1);
  });

  it("a distanceBands-only PATCH does not bump the epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, distanceBands: [700, 1400, 5500] } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(1);
  });

  // CH4-23 — the integrity case. A forged OLD epoch must not be stored, or a
  // superseded job's snapshot would match the current epoch and present as
  // current. Asserted by reading the PERSISTED row back, not the response.
  it("discards a client-supplied stepEpoch and never lowers the stored value", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4, stepEpoch: 1 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 5, stepEpoch: 1 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(3);
  });

  it("clone reinitializes the epoch to 1 while preserving the parameters", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4, step2: { gap: 0.01, timeLimitSec: 60 } } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);

    const cloned = await request(app).post(`/api/scenarios/${scenario.id}/clone`).set("Cookie", cookie).expect(201);
    scenarioIds.push(cloned.body.id);
    expect(await readEpoch(cloned.body.id)).toBe(1);
    expect(cloned.body.inputs.p).toBe(4);
    expect(cloned.body.inputs.step2).toEqual({ gap: 0.01, timeLimitSec: 60 });
  });

  it("a bands-only write through the dedicated endpoint leaves the epoch untouched", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);

    await request(app).patch(`/api/scenarios/${scenario.id}/distance-bands`).set("Cookie", cookie)
      .send({ distanceBands: [700, 1400, 5500] }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);
  });

  // Two overlapping Step 1 edits must yield two DISTINCT consecutive epochs.
  // A read-modify-write in application code would let both read n and write
  // n+1, losing one bump and leaving a superseded job looking current.
  it("two concurrent Step 1 PATCHes produce two distinct consecutive epochs", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await Promise.all([
      request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
        .send({ inputs: { ...step1Inputs, p: 4 } }),
      request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
        .send({ inputs: { ...step1Inputs, p: 5 } }),
    ]);
    expect(await readEpoch(scenario.id)).toBe(3);
  });
});
```

- [ ] **Step 8: Run the regressions to verify they fail, then pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/solver/__tests__/maxCoverageStepWorkflow.test.ts
```

Before Step 6's route edits this FAILS (epoch `undefined`). After them: PASS, all cases.

- [ ] **Step 9: Re-run the suites the PATCH restructure touches**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/routes.test.ts \
    src/__tests__/lockedModelGuards.test.ts src/__tests__/import.test.ts \
    src/solver/__tests__/scenarioSolveAtomicity.test.ts
```

Expected: PASS. `routes.test.ts` mocks `db.transaction` as a pass-through (`routes.test.ts:11`), so the new transaction wrapper is transparent to it. If `lockedModelGuards.test.ts` fails, the lock check has been placed after a write — move it before, do not weaken the test.

- [ ] **Step 10: Commit**

```bash
git add artifacts/api-server/src/services/maxCoverageSteps.ts \
        artifacts/api-server/src/services/scenarioInputWrite.ts \
        artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts \
        artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts \
        artifacts/api-server/src/routes/scenarios.ts
git commit -m "[ch4-2s-2] route every inputs writer through one epoch authority"
```

---

## Task 3: Narrow the write routes — reject a client-supplied objective or floor

**Files:**
- Modify: `artifacts/api-server/src/services/scenarioInputWrite.ts`
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (create handler ~`:232`, PATCH handler ~`:306`)
- Create: `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts`
- Modify: `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts`

**Interfaces:**
- Consumes: `applyScenarioInputWrite`, `MAX_COVERAGE_MODEL_ID` (Task 2).
- Produces: `assertNoServerOwnedStepFields(modelId: string, rawInputs: unknown): string | null` — returns an error message when the raw body carries a server-owned field, else `null`.

- [ ] **Step 1: Write the failing guard tests**

Create `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, relative, sep, join } from "path";
import { assertNoServerOwnedStepFields } from "../services/scenarioInputWrite.js";

// R9 — plain recursive walk; no new dependency, and deliberately defined in
// this file rather than imported, so the guard cannot be weakened by editing
// a shared helper somewhere else.
function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkTsFiles(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) yield full;
  }
}

describe("CH4-24/CH4-25 — the write-route narrowing guard", () => {
  it("rejects objective min_distance for max-coverage-us", () => {
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "min_distance" })).toBeTruthy();
  });

  it("rejects a coverageFloorDemand key at all — present, even when null", () => {
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", coverageFloorDemand: 1 })).toBeTruthy();
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", coverageFloorDemand: null })).toBeTruthy();
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", coverageFloorDemand: undefined })).toBeTruthy();
  });

  it("accepts an ordinary coverage payload", () => {
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", p: 3 })).toBeNull();
  });

  // stepEpoch is treated differently ON PURPOSE: stripped and overwritten by
  // CH4-23, not rejected, because a client legitimately round-trips the whole
  // inputs blob and would otherwise be unable to save anything. A floor has no
  // such excuse — no well-behaved client ever sends one.
  it("accepts a client-supplied stepEpoch rather than rejecting it", () => {
    expect(assertNoServerOwnedStepFields("max-coverage-us", { objective: "coverage", stepEpoch: 9 })).toBeNull();
  });

  it("never constrains another model", () => {
    expect(assertNoServerOwnedStepFields("p-median-us", { objective: "min_distance", coverageFloorDemand: 5 })).toBeNull();
  });
});

describe("CH4-26 — no route writes scenarios.inputs outside the authority", () => {
  // R9 — the guard scans the WHOLE api-server source tree, not just
  // routes/scenarios.ts. A future writer added in another route or service
  // would sail past a single-file check, which is precisely the sixth
  // exception CH4-26 exists to prevent. The allow-list is frozen here: any
  // new `inputs:` write anywhere must either route through the authority or
  // be added to this list deliberately, with a reviewer seeing it.
  //
  // readFileSync, NOT Function.prototype.toString(): the vitest/esbuild
  // transform strips comments, so a stringified-function assertion silently
  // tests nothing. Same technique lockedModelGuards.test.ts:33,82 uses.
  const ALLOWED_INPUTS_WRITERS = new Set([
    // the authority itself
    "services/scenarioInputWrite.ts",
    // the documented atomic field-scoped exception (preserves the epoch by
    // construction — see CH4-26's table)
    "routes/distanceBands.ts",
  ]);

  it("no file outside the allow-list writes scenarios.inputs", () => {
    const root = resolve(__dirname, "..");
    const offenders: string[] = [];
    for (const file of walkTsFiles(root)) {
      const rel = relative(root, file).split(sep).join("/");
      if (rel.includes("__tests__/")) continue;
      if (ALLOWED_INPUTS_WRITERS.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      if (/\.set\(\s*\{[^}]*\binputs\s*:/s.test(src)) offenders.push(rel);
      if (/\.values\(\s*\{[^}]*\binputs\s*:/s.test(src) && !/initialInputsForInsert\(/.test(src)) {
        offenders.push(`${rel} (insert without initialInputsForInsert)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the allow-list is not vacuous — both allowed writers still exist and still write inputs", () => {
    for (const rel of ALLOWED_INPUTS_WRITERS) {
      const src = readFileSync(resolve(__dirname, "..", rel), "utf8");
      expect(src).toMatch(/\binputs\b/);
    }
  });

  it("the guard itself is not vacuous — it still finds the insert-side writes it permits", () => {
    const src = readFileSync(resolve(__dirname, "../routes/scenarios.ts"), "utf8");
    // create + clone both insert `inputs:` through initialInputsForInsert.
    expect(src.match(/initialInputsForInsert\(/g)?.length).toBe(2);
    expect(src).toContain("applyScenarioInputWrite(");
  });

  it("distanceBands.ts keeps its atomic field-scoped jsonb_set write", () => {
    const src = readFileSync(resolve(__dirname, "../routes/distanceBands.ts"), "utf8");
    expect(src).toContain("jsonb_set(");
    expect(src.match(/\.set\(\s*\{[^}]*\binputs\s*:\s*sql`jsonb_set/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the guard tests to verify they fail**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/maxCoverageWriteGuard.test.ts
```

Expected: FAIL — `assertNoServerOwnedStepFields` is not exported.

- [ ] **Step 3: Implement the guard**

Append to `artifacts/api-server/src/services/scenarioInputWrite.ts`:

```ts
/**
 * CH4-24/CH4-25 — the write-route narrowing guard.
 *
 * The model registry's validator stays the EXECUTABLE one (it must accept
 * `min_distance`, because `validateInputsForModel` is called by BOTH
 * `buildValidatedInputSnapshot` at enqueue AND the recovery reconstructor
 * that rebuilds a queued job after a process restart — a coverage-only
 * registry entry would make every recovered Step 2 job permanently
 * unrunnable). The narrowing therefore has to sit here, at the write routes.
 *
 * It inspects the RAW request body, before Zod has a chance to strip
 * anything. This repo's validators are deliberately non-`.strict()`, so
 * unknown and omitted keys are STRIPPED, not refused — simply leaving
 * `coverageFloorDemand` out of a persisted schema would silently discard a
 * client-supplied floor and report success, the opposite of what CH4-24
 * promises. Only the server can produce a payload that reaches the
 * executable validator with `min_distance` set; that is what makes the floor
 * un-typeable rather than merely un-shown.
 */
export function assertNoServerOwnedStepFields(modelId: string, rawInputs: unknown): string | null {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return null;
  if (rawInputs === null || typeof rawInputs !== "object") return null;
  const raw = rawInputs as Record<string, unknown>;

  if (raw.objective === "min_distance") {
    return "objective min_distance is produced by the Step 2 solve and cannot be set directly";
  }
  // `in`, not a truthiness check: the key is refused when PRESENT, even if
  // null or undefined.
  if ("coverageFloorDemand" in raw) {
    return "coverageFloorDemand is produced by the Step 1 solve and cannot be set directly";
  }
  return null;
}
```

- [ ] **Step 4: Apply the guard at both write routes**

In `artifacts/api-server/src/routes/scenarios.ts`, extend the Task 2 import:

```ts
import { applyScenarioInputWrite, initialInputsForInsert, assertNoServerOwnedStepFields } from "../services/scenarioInputWrite.js";
```

**create** — insert immediately after the `isModelLocked(body.modelId)` check and *before* `validateInputsForModel` (~line 232):

```ts
  {
    const guardError = assertNoServerOwnedStepFields(body.modelId, body.inputs);
    if (guardError) { res.status(422).json({ error: guardError }); return; }
  }
```

**PATCH** — inside the `if (body.inputs !== undefined)` block, as the first statement *before* `db.transaction`, so nothing is written when it trips:

```ts
    {
      const [existingModel] = await db.select({ modelId: scenariosTable.modelId }).from(scenariosTable)
        .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
      if (!existingModel) { res.status(404).json({ error: "Not found" }); return; }
      const guardError = assertNoServerOwnedStepFields(existingModel.modelId, body.inputs);
      if (guardError) { res.status(422).json({ error: guardError }); return; }
    }
```

Import/apply needs no guard: its `nextInputs` is server-derived from the import preview, and an import row cannot carry `objective` or `coverageFloorDemand`. Clone copies an already-guarded persisted blob.

- [ ] **Step 5: Run the guard tests to verify they pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/__tests__/maxCoverageWriteGuard.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 6: Add the literal-rejection regression against a real DB**

Append to `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts`:

```ts
describe("CH4-24/CH4-25 — the floor is rejected literally, not stripped", () => {
  it("422s a PATCH carrying coverageFloorDemand and leaves the row untouched", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4, coverageFloorDemand: 1 } })
      .expect(422);

    // Read the PERSISTED row back: a stripping bug and a rejecting guard are
    // indistinguishable from the response alone. If the guard had merely
    // stripped, `p` would now be 4 and the epoch 2.
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const inputs = row!.inputs as Record<string, unknown>;
    expect(inputs.p).toBe(3);
    expect(inputs.coverageFloorDemand).toBeUndefined();
    expect(inputs.stepEpoch).toBe(1);
  });

  it("422s a PATCH carrying objective min_distance", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, objective: "min_distance", coverageFloorDemand: 53385024 } })
      .expect(422);
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect((row!.inputs as Record<string, unknown>).objective).toBe("coverage");
  });

  it("422s a create carrying a floor", async () => {
    const cookie = await registerAndGetCookie();
    await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "rejected", modelId: "max-coverage-us", inputs: { ...step1Inputs, coverageFloorDemand: 1 } })
      .expect(422);
  });
});
```

- [ ] **Step 7: Run the real-DB regressions**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/solver/__tests__/maxCoverageStepWorkflow.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/services/scenarioInputWrite.ts \
        artifacts/api-server/src/routes/scenarios.ts \
        artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts \
        artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts
git commit -m "[ch4-2s-3] reject a client-supplied objective or coverage floor at the write routes"
```

---

## Task 4: Derive the target step, synthesize Step 2's input, refuse a second active job

**Files:**
- Modify: `artifacts/api-server/src/services/maxCoverageSteps.ts`
- Modify: `artifacts/api-server/src/solver/jobRunner.ts:361-412`
- Modify: `artifacts/api-server/src/routes/scenarios.ts:494-549`
- Modify: `lib/api-spec/openapi.yaml:273-308`
- Modify: `artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts`
- Modify: `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts`

**Interfaces:**
- Consumes: `readStepEpoch`, `MAX_COVERAGE_MODEL_ID` (Task 2).
- Produces:
  - `synthesizeStep2Inputs(step1Inputs: Record<string, unknown>, coveredDemand: number): Record<string, unknown>`
  - `EnqueueScenarioSolveOutcome` gains `{ kind: "conflict"; jobId: number }`
  - `POST /scenarios/{id}/solve` gains a documented `409` carrying `{ error, jobId }`

- [ ] **Step 1: Write the failing synthesis tests**

Append to `artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts`:

```ts
import { synthesizeStep2Inputs } from "../maxCoverageSteps.js";

describe("CH4-10 — Step 2's solve input is synthesized, never stored", () => {
  const step1 = {
    objective: "coverage", p: 3, highServiceDistKm: 700, maxDistKm: 5500,
    avgServiceDistCapKm: 1000, gap: 0, timeLimitSec: 120, capacityMode: "none",
    distanceBands: [700, 1400, 2800, 5500], stepEpoch: 3,
    step2: { gap: 0.01, timeLimitSec: 60 },
    warehouseOverrides: [], customerOverrides: [],
    addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
  };

  it("flips the objective and injects Step 1's achieved covered demand as the floor", () => {
    const out = synthesizeStep2Inputs(step1, 53385024);
    expect(out.objective).toBe("min_distance");
    expect(out.coverageFloorDemand).toBe(53385024);
  });

  it("drops avgServiceDistCapKm, which does not exist in min-distance mode", () => {
    expect("avgServiceDistCapKm" in synthesizeStep2Inputs(step1, 53385024)).toBe(false);
  });

  it("inherits p, highServiceDistKm and maxDistKm from Step 1", () => {
    const out = synthesizeStep2Inputs(step1, 53385024);
    expect(out.p).toBe(3);
    expect(out.highServiceDistKm).toBe(700);
    expect(out.maxDistKm).toBe(5500);
  });

  it("merges step2's gap and timeLimitSec over Step 1's", () => {
    const out = synthesizeStep2Inputs(step1, 53385024);
    expect(out.gap).toBe(0.01);
    expect(out.timeLimitSec).toBe(60);
  });

  it("falls back to Step 1's gap and timeLimitSec when step2 is absent", () => {
    const { step2: _omitted, ...withoutStep2 } = step1;
    const out = synthesizeStep2Inputs(withoutStep2, 53385024);
    expect(out.gap).toBe(0);
    expect(out.timeLimitSec).toBe(120);
  });

  it("carries the epoch through so the snapshot identifies its step's validity", () => {
    expect(synthesizeStep2Inputs(step1, 53385024).stepEpoch).toBe(3);
  });

  it("drops step2 itself — it is a UI parameter bag, not a solver input", () => {
    expect("step2" in synthesizeStep2Inputs(step1, 53385024)).toBe(false);
  });

  it("produces a payload the executable validator accepts", () => {
    expect(maxCoverageInputsSchema.safeParse(synthesizeStep2Inputs(step1, 53385024)).success).toBe(true);
  });
});
```

Add to that file's imports:

```ts
import { maxCoverageInputsSchema } from "../../validation/inputs/maxCoverage.js";
```

- [ ] **Step 2: Run the synthesis tests to verify they fail**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/services/__tests__/maxCoverageSteps.test.ts
```

Expected: FAIL — `synthesizeStep2Inputs` is not exported.

- [ ] **Step 3: Implement the synthesis**

Append to `artifacts/api-server/src/services/maxCoverageSteps.ts`:

```ts
// CH4-10 — Step 2's SolveInput.inputs is built at enqueue and NEVER stored on
// the scenario. It is the synthesized object that gets validated and persisted
// as the job's `input_snapshot`, so:
//   - the snapshot's `objective` is what identifies which step a job belongs to;
//   - the floor the student was shown and the floor the solver was given come
//     from one source and cannot disagree.
// `coverageFloorDemand` is declared as an integer (maxCoverage.ts) and Step 1's
// `coveredDemand` is emitted as `int(covered)` (solve.py), so the injection
// needs no rounding and cannot fail shape validation.
export function synthesizeStep2Inputs(
  step1Inputs: Record<string, unknown>,
  coveredDemand: number,
): Record<string, unknown> {
  const { avgServiceDistCapKm: _dropped, step2, ...inherited } = step1Inputs;
  const overrides = (step2 ?? {}) as { gap?: number; timeLimitSec?: number };
  return {
    ...inherited,
    objective: "min_distance",
    coverageFloorDemand: coveredDemand,
    gap: overrides.gap ?? (inherited.gap as number),
    timeLimitSec: overrides.timeLimitSec ?? (inherited.timeLimitSec as number),
  };
}

export type MaxCoverageStep = 1 | 2;

// CH4-9 — the step a solve targets, derived from state alone. Step 1 unsolved
// → target Step 1; Step 1 solved → target Step 2. Because a Step 1 edit clears
// BOTH results (CH4-2), "Step 1 is solved" is the only question that needs
// asking.
export function deriveTargetStep(step1Solved: boolean): MaxCoverageStep {
  return step1Solved ? 2 : 1;
}
```

- [ ] **Step 4: Run the synthesis tests to verify they pass**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/services/__tests__/maxCoverageSteps.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Wire derivation, synthesis and the active-job guard into the enqueue lock**

In `artifacts/api-server/src/solver/jobRunner.ts`, add to the imports:

```ts
import {
  MAX_COVERAGE_MODEL_ID,
  readStepEpoch,
  synthesizeStep2Inputs,
  deriveTargetStep,
} from "../services/maxCoverageSteps.js";
```

Extend the outcome union (currently line 361):

```ts
export type EnqueueScenarioSolveOutcome =
  | { kind: "not_found" }
  | { kind: "invalid"; error: string }
  | { kind: "precheck_failed"; errors: PrecheckResult["errors"] }
  // CH4-11 — a second active job for the same scenario is REFUSED, and the
  // refusal is a documented response carrying the in-flight job id so the
  // client can attach to it rather than retry blindly.
  | { kind: "conflict"; jobId: number }
  | { kind: "queued"; jobId: number; modelId: string };
```

Inside `enqueueScenarioSolve`'s transaction, insert the guard immediately after the `if (!scenario)` check and before `validateInputsForModel`:

```ts
    // CH4-11 — inside the SAME locked transaction. The scenario row lock
    // serialises two concurrent enqueues but does not make the second refuse;
    // this check plus UQ_solve_jobs_active_per_scenario is what does.
    //
    // R1 — GATED ON THE MODEL. Running this for every model would change
    // enqueue behaviour for the other five, which this plan's scope line
    // forbids, and would break scenarioSolveAtomicity.test.ts (it enqueues a
    // second p-median-us job on the same scenario while the first is queued).
    if (scenario.modelId === MAX_COVERAGE_MODEL_ID) {
      const [active] = await tx.select({ id: solveJobsTable.id }).from(solveJobsTable)
        .where(and(
          eq(solveJobsTable.scenarioId, scenarioId),
          inArray(solveJobsTable.status, ["queued", "running"]),
        ))
        .limit(1);
      if (active) {
        return { kind: "conflict", jobId: active.id } as const;
      }
    }
```

Then, after the existing precheck block and before `const input = …`, derive the step and synthesize:

```ts
    // CH4-9 — the target step is derived INSIDE this lock, against the freshly
    // locked row, so a concurrent edit cannot land between the decision and
    // the enqueue. CH4-10 — Step 2's payload is synthesized here and is what
    // gets persisted as input_snapshot; it is never written to the scenario.
    let solveInputs: Record<string, unknown> = validation.data as Record<string, unknown>;
    if (scenario.modelId === MAX_COVERAGE_MODEL_ID) {
      const epoch = readStepEpoch(scenario.inputs as Record<string, unknown>);
      const [step1Job] = await tx.select({ result: solveJobsTable.result }).from(solveJobsTable)
        .where(and(
          eq(solveJobsTable.scenarioId, scenarioId),
          eq(solveJobsTable.status, "succeeded"),
          sql`${solveJobsTable.inputSnapshot} -> 'inputs' ->> 'objective' = 'coverage'`,
          sql`COALESCE((${solveJobsTable.inputSnapshot} -> 'inputs' ->> 'stepEpoch')::int, 1) = ${epoch}`,
        ))
        .orderBy(desc(solveJobsTable.id))
        .limit(1);

      if (deriveTargetStep(Boolean(step1Job)) === 2) {
        const details = (step1Job!.result as { details?: { coveredDemand?: number } } | null)?.details;
        const coveredDemand = details?.coveredDemand;
        if (typeof coveredDemand !== "number") {
          // A succeeded Step 1 job always carries details.coveredDemand
          // (solve.py emits `int(covered)`), so this is a defect, not a user
          // outcome — refuse rather than solve against a fabricated floor.
          return { kind: "invalid", error: "Step 1 result is missing coveredDemand" } as const;
        }
        const synthesized = synthesizeStep2Inputs(solveInputs, coveredDemand);
        const step2Validation = validateInputsForModel(scenario.modelId, synthesized);
        if (!step2Validation.success) {
          return { kind: "invalid", error: step2Validation.error } as const;
        }
        solveInputs = step2Validation.data as Record<string, unknown>;
      }
    }

    const input = { modelId: scenario.modelId, inputs: solveInputs } as SolveInput;
```

Delete the original `const input = { modelId: scenario.modelId, inputs: validation.data } as SolveInput;` line it replaces. Ensure `inArray` and `desc` are in the `drizzle-orm` import at the top of `jobRunner.ts`.

- [ ] **Step 6: Map the conflict to 409 in the route**

In `artifacts/api-server/src/routes/scenarios.ts`, after the existing `precheck_failed` branch (~line 536):

```ts
  if (outcome.kind === "conflict") {
    res.status(409).json({
      error: "A solve is already running for this scenario",
      jobId: outcome.jobId,
    });
    return;
  }
```

- [ ] **Step 7: Document the 409 in the contract and regenerate**

In `lib/api-spec/openapi.yaml`, under `/scenarios/{scenarioId}/solve` → `post` → `responses`, add between `"404"` and `"422"`:

```yaml
        "409":
          description: A solve job is already queued or running for this scenario (CH4-11 — at most one active job per scenario). The body carries the in-flight `jobId` so the client can attach to the running job instead of retrying.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SolveConflict"
```

And add to `components.schemas`, directly after `SolveJobQueued`:

```yaml
    SolveConflict:
      type: object
      properties:
        error:
          type: string
        jobId:
          type: integer
          description: The id of the queued or running job that blocked this request.
      required: [error, jobId]
```

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected: exits 0; `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` are rewritten. Never hand-edit either (hard rule #1).

- [ ] **Step 8: Add the real-DB solve-path regressions**

Append to `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts`:

```ts
describe("CH4-9/CH4-11 — step derivation and the one-active-job guard", () => {
  // R7 — DETERMINISTIC, not timing-dependent. An earlier draft fired two
  // POSTs and asserted exactly [202, 409]; that races the dispatcher, because
  // the first job can finish before the second request takes the lock, making
  // [202, 202] a legitimate outcome and the test flaky. Seed the active job
  // instead, so the guard is the only variable.
  it("409s with the in-flight jobId when a Chapter 4 job is already active", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    const [seeded] = await db.insert(solveJobsTable).values({
      scenarioId: scenario.id,
      userId: owner!.userId,
      status: "queued",
      inputsHash: "seeded-active",
      modelId: "max-coverage-us",
      inputSnapshot: { modelId: "max-coverage-us", inputs: { ...step1Inputs, stepEpoch: 1 } },
    }).returning();

    const res = await request(app).post(`/api/scenarios/${scenario.id}/solve`).set("Cookie", cookie).expect(409);
    expect(res.body.jobId).toBe(seeded.id);

    await db.delete(solveJobsTable).where(eq(solveJobsTable.id, seeded.id));
  });

  // The database is the backstop: even if a future caller forgets the
  // in-transaction check, the partial unique index must refuse the row.
  it("the database itself rejects a second active Chapter 4 job", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    const values = (hash: string) => ({
      scenarioId: scenario.id,
      userId: owner!.userId,
      status: "queued" as const,
      inputsHash: hash,
      modelId: "max-coverage-us",
      inputSnapshot: { modelId: "max-coverage-us", inputs: { ...step1Inputs, stepEpoch: 1 } },
    });

    const [first] = await db.insert(solveJobsTable).values(values("dup-a")).returning();
    await expect(db.insert(solveJobsTable).values(values("dup-b"))).rejects.toThrow();
    await db.delete(solveJobsTable).where(eq(solveJobsTable.id, first.id));
  });

  // R1 — the other five models keep their existing semantics. This is the
  // regression that fails loudly if the index or the guard is ever unscoped.
  it("leaves non-Chapter-4 enqueue semantics untouched (two active p-median jobs are legal)", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "p-median two active", modelId: "p-median-us",
      inputs: {
        p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
        warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
        addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
      },
    }).expect(201);
    scenarioIds.push(created.body.id);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));

    const values = (hash: string) => ({
      scenarioId: created.body.id as number,
      userId: owner!.userId,
      status: "queued" as const,
      inputsHash: hash,
      modelId: "p-median-us",
    });

    const [a] = await db.insert(solveJobsTable).values(values("pm-a")).returning();
    const [b] = await db.insert(solveJobsTable).values(values("pm-b")).returning();
    expect(a.id).not.toBe(b.id);

    await db.delete(solveJobsTable).where(inArray(solveJobsTable.id, [a.id, b.id]));
  });

  it("a scenario with no succeeded Step 1 job targets Step 1", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const res = await request(app).post(`/api/scenarios/${scenario.id}/solve`).set("Cookie", cookie).expect(202);
    const [job] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, res.body.jobId));
    const snapshot = job!.inputSnapshot as { inputs: Record<string, unknown> };
    expect(snapshot.inputs.objective).toBe("coverage");
    expect(snapshot.inputs.coverageFloorDemand).toBeUndefined();
    expect(snapshot.inputs.stepEpoch).toBe(1);
  });
});
```

Add `and`, `inArray` to that file's `drizzle-orm` import.

- [ ] **Step 9: Verify CH4-21 against the existing solver golden**

CH4-21 is already covered — `test_max_coverage.py:277` runs Step 1 → achieved floor → Step 2 and asserts optimal, floor honoured, and distance improved. This plan writes no new pytest; it confirms the invariant still holds:

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_max_coverage.py -v
```

Expected: PASS, including the step1→step2 case. If it fails, a change in this task altered solver inputs — that is the defect, not the test.

- [ ] **Step 10: Run the API suites and commit**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/solver/__tests__/maxCoverageStepWorkflow.test.ts \
    src/solver/__tests__/scenarioSolveAtomicity.test.ts \
    src/solver/__tests__/dispatcherRecovery.test.ts src/__tests__/routes.test.ts
```

Expected: PASS.

```bash
git add artifacts/api-server/src/services/maxCoverageSteps.ts \
        artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts \
        artifacts/api-server/src/solver/jobRunner.ts \
        artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts \
        artifacts/api-server/src/routes/scenarios.ts \
        lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "[ch4-2s-4] derive the target step in the enqueue lock and refuse a second active job"
```

---

## Task 5: The `steps` read path and the lazy per-step result endpoint

**Files:**
- Modify: `artifacts/api-server/src/services/maxCoverageSteps.ts`
- Modify: `artifacts/api-server/src/routes/scenarios.ts:258-266` (single GET), plus a new endpoint
- Modify: `lib/api-spec/openapi.yaml:206-227`, `:1409-1462`
- Modify: `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts`

**Interfaces:**
- Consumes: `readStepEpoch` (Task 2), `MaxCoverageStep` (Task 4).
- Produces:
  - `loadScenarioSteps(scenarioId: number, userId: string, modelId: string, inputs: Record<string, unknown>): Promise<ScenarioSteps | null>`
  - `ScenarioSteps = { step1: ScenarioStepState; step2: ScenarioStepState }`
  - `ScenarioStepState = { solved: boolean; stale: boolean; jobId: number | null; summary: ScenarioStepSummary | null }`
  - `ScenarioStepSummary = { objective: "coverage" | "min_distance"; status: string; solutionStatus: string | null; quality: string | null; coveragePct: number | null; coveredDemand: number | null; weightedAvgDistance: number | null; distanceUnit: string; runTimeSec: number | null }`
  - `GET /scenarios/{scenarioId}/steps/{step}/result` → the complete stored envelope for one step.

- [ ] **Step 1: Implement the SQL-projected step loader**

Append to `artifacts/api-server/src/services/maxCoverageSteps.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getManifest } from "../registry/modelRegistry.js";

export interface ScenarioStepSummary {
  objective: "coverage" | "min_distance";
  status: string;
  solutionStatus: string | null;
  quality: string | null;
  coveragePct: number | null;
  coveredDemand: number | null;
  weightedAvgDistance: number | null;
  distanceUnit: string;
  runTimeSec: number | null;
}

export interface ScenarioStepState {
  solved: boolean;
  stale: boolean;
  jobId: number | null;
  summary: ScenarioStepSummary | null;
}

export interface ScenarioSteps {
  step1: ScenarioStepState;
  step2: ScenarioStepState;
}

const EMPTY_STEP: ScenarioStepState = { solved: false, stale: false, jobId: null, summary: null };

// A3 — the two snapshot shapes are NOT symmetric, and that asymmetry is what
// produced the R2 defect. A Step 1 snapshot is `validation.data`, so it
// RETAINS both `step2` and `stepEpoch`. A Step 2 snapshot comes from
// synthesizeStep2Inputs, which destructures `step2` away and writes the
// effective gap/timeLimitSec at the TOP LEVEL. Anything reading a snapshot
// must therefore know which step it is reading: `-> 'step2'` is populated for
// Step 1 and always null for Step 2. (Retaining `step2` on the Step 1
// snapshot is harmless — pmedian.ts picks wire fields explicitly, so it never
// reaches solve.py.)

// CH4-13 — the summary is projected in SQL. `solve_jobs.resultSummary`
// (jobRunner.ts's markSucceeded) carries only status/objective/objectiveMode/
// weightedAvgDistance/distanceUnit/runTimeSec — no covered demand, no coverage
// percent, no solution status. Rather than change the write path, which would
// leave every existing row short anyway, the missing fields are extracted from
// the stored envelope with jsonb path expressions, so Postgres returns the
// small object and never ships two full envelopes to Node. Same posture
// routes/solveHistory.ts already takes by pushing its dedupe into SQL.
//
// DISTINCT ON (objective) + ORDER BY id DESC yields at most two rows: the
// newest succeeded job per step, restricted to the CURRENT epoch. A job whose
// snapshot carries a superseded epoch is simply not selected — that is what
// "clearing a step" means (CH4-7): nothing is deleted, validity is marked.
export async function loadScenarioSteps(
  scenarioId: number,
  userId: string,
  modelId: string,
  inputs: Record<string, unknown>,
): Promise<ScenarioSteps | null> {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return null;

  const epoch = readStepEpoch(inputs);
  const distanceUnit = getManifest(modelId)?.distanceUnit ?? "mi";

  const result = await db.execute(sql`
    SELECT DISTINCT ON (j.input_snapshot -> 'inputs' ->> 'objective')
      j.id                                                                  AS job_id,
      j.input_snapshot -> 'inputs' ->> 'objective'                          AS objective,
      -- R2 — read the snapshot's TOP-LEVEL effective settings, not a nested
      -- `step2` bag. synthesizeStep2Inputs destructures `step2` away and
      -- writes the effective gap/timeLimitSec at the top level, so a real
      -- Step 2 snapshot has NO `step2` key at all. Reading one would make
      -- every freshly-solved Step 2 compare against null and report stale
      -- immediately.
      (j.input_snapshot -> 'inputs' ->> 'gap')::double precision            AS snapshot_gap,
      (j.input_snapshot -> 'inputs' ->> 'timeLimitSec')::int                AS snapshot_time_limit,
      j.result ->> 'status'                                                 AS status,
      j.result ->> 'solutionStatus'                                         AS solution_status,
      j.result ->> 'quality'                                                AS quality,
      (j.result ->> 'runTimeSec')::double precision                         AS run_time_sec,
      (j.result -> 'details' ->> 'coveragePct')::double precision           AS coverage_pct,
      (j.result -> 'details' ->> 'coveredDemand')::bigint                   AS covered_demand,
      (j.result -> 'metrics' ->> 'weightedAvgDistance')::double precision   AS weighted_avg_distance
    FROM solve_jobs j
    WHERE j.scenario_id = ${scenarioId}
      AND j.user_id = ${userId}
      AND j.status = 'succeeded'
      AND COALESCE((j.input_snapshot -> 'inputs' ->> 'stepEpoch')::int, 1) = ${epoch}
    ORDER BY j.input_snapshot -> 'inputs' ->> 'objective', j.id DESC
  `);

  const steps: ScenarioSteps = { step1: { ...EMPTY_STEP }, step2: { ...EMPTY_STEP } };

  // R2 — the CURRENT effective Step 2 settings, derived exactly as
  // synthesizeStep2Inputs derives them: `step2` overrides when present, else
  // Step 1's own values are inherited. Comparing effective-to-effective is
  // what makes "I never touched Step 2's settings" read as fresh.
  const step2Bag = (inputs.step2 ?? null) as { gap?: number; timeLimitSec?: number } | null;
  const effectiveStep2 = {
    gap: step2Bag?.gap ?? (inputs.gap as number | undefined) ?? null,
    timeLimitSec: step2Bag?.timeLimitSec ?? (inputs.timeLimitSec as number | undefined) ?? null,
  };

  for (const raw of result.rows as Record<string, unknown>[]) {
    const objective = raw.objective as "coverage" | "min_distance";
    const summary: ScenarioStepSummary = {
      objective,
      status: String(raw.status ?? ""),
      solutionStatus: raw.solution_status == null ? null : String(raw.solution_status),
      quality: raw.quality == null ? null : String(raw.quality),
      coveragePct: raw.coverage_pct == null ? null : Number(raw.coverage_pct),
      coveredDemand: raw.covered_demand == null ? null : Number(raw.covered_demand),
      weightedAvgDistance: raw.weighted_avg_distance == null ? null : Number(raw.weighted_avg_distance),
      distanceUnit,
      runTimeSec: raw.run_time_sec == null ? null : Number(raw.run_time_sec),
    };

    if (objective === "coverage") {
      // CH4-3 — Step 1 can never be stale: the only thing that can change it
      // (a Step 1 edit) bumps the epoch, which drops it entirely.
      steps.step1 = { solved: true, stale: false, jobId: Number(raw.job_id), summary };
    } else {
      // Step 2 staleness compares the EFFECTIVE settings the solve actually
      // ran with against the effective settings now configured — field by
      // field, so key order cannot manufacture a difference. solve_jobs.
      // inputsHash is NOT used: it mixes in SOLVER_CODE_HASH, so every
      // solve.py deploy would flip every scenario to stale. It is a cache key,
      // not a staleness signal.
      const snapshotGap = raw.snapshot_gap == null ? null : Number(raw.snapshot_gap);
      const snapshotTimeLimit = raw.snapshot_time_limit == null ? null : Number(raw.snapshot_time_limit);
      const stale =
        effectiveStep2.gap !== snapshotGap ||
        effectiveStep2.timeLimitSec !== snapshotTimeLimit;
      steps.step2 = { solved: true, stale, jobId: Number(raw.job_id), summary };
    }
  }

  return steps;
}
```

- [ ] **Step 2: Attach `steps` to the single-scenario GET and add the lazy endpoint**

In `artifacts/api-server/src/routes/scenarios.ts`, import the loader:

```ts
import { loadScenarioSteps } from "../services/maxCoverageSteps.js";
```

Replace the `GET /scenarios/:scenarioId` body (lines 258-266) — `toApiScenario` stays synchronous and untouched, because the list route shares it and a per-scenario query there would be an N+1:

```ts
router.get("/scenarios/:scenarioId", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const [row] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (isModelLocked(row.modelId)) { respondLocked(res); return; }

  // CH4-12 — `steps` is present ONLY for max-coverage-us; the loader returns
  // null for every other model and the key is omitted. Deliberately merged
  // here rather than inside toApiScenario: that projector is synchronous and
  // shared with GET /scenarios, where a per-row query would be an N+1.
  const steps = await loadScenarioSteps(
    row.id, req.userId!, row.modelId, (row.inputs ?? {}) as Record<string, unknown>,
  );
  res.json(steps ? { ...toApiScenario(row), steps } : toApiScenario(row));
});

// CH4-14 — full envelopes stay lazy. The output tabs read one step at a time,
// so a 200-customer assignments grid is fetched only when looked at.
// Ownership-scoped and 404-never-403 like every scenario route (hard rule #5).
router.get("/scenarios/:scenarioId/steps/:step/result", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const step = Number(req.params.step);
  if (step !== 1 && step !== 2) { res.status(404).json({ error: "Not found" }); return; }

  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }
  if (isModelLocked(scenario.modelId)) { respondLocked(res); return; }
  if (scenario.modelId !== "max-coverage-us") { res.status(404).json({ error: "Not found" }); return; }

  const steps = await loadScenarioSteps(
    scenario.id, req.userId!, scenario.modelId, (scenario.inputs ?? {}) as Record<string, unknown>,
  );
  const state = step === 1 ? steps!.step1 : steps!.step2;
  if (!state.solved || state.jobId == null) { res.status(404).json({ error: "Not found" }); return; }

  const [job] = await db.select({ result: solveJobsTable.result }).from(solveJobsTable)
    .where(and(eq(solveJobsTable.id, state.jobId), eq(solveJobsTable.userId, req.userId!)));
  if (!job?.result) { res.status(404).json({ error: "Not found" }); return; }

  res.json({ result: presentResultForRead(job.result as Record<string, unknown>) });
});
```

- [ ] **Step 3: Extend the contract and regenerate**

In `lib/api-spec/openapi.yaml`, add to `components.schemas` (after `SolveConflict`):

```yaml
    ScenarioStepSummary:
      type: object
      properties:
        objective:
          type: string
          enum: [coverage, min_distance]
        status: { type: string }
        solutionStatus: { type: ["string", "null"] }
        quality: { type: ["string", "null"] }
        coveragePct: { type: ["number", "null"] }
        coveredDemand: { type: ["number", "null"] }
        weightedAvgDistance: { type: ["number", "null"] }
        distanceUnit: { type: string }
        runTimeSec: { type: ["number", "null"] }
      required: [objective, status, solutionStatus, quality, coveragePct, coveredDemand, weightedAvgDistance, distanceUnit, runTimeSec]

    ScenarioStepState:
      type: object
      properties:
        solved: { type: boolean }
        stale:
          type: boolean
          description: Derived, never stored. Always false for step 1 — a Step 1 edit bumps the epoch and drops the step entirely (CH4-3).
        jobId: { type: ["integer", "null"] }
        summary:
          oneOf:
            - $ref: "#/components/schemas/ScenarioStepSummary"
            - type: "null"
      required: [solved, stale, jobId, summary]

    ScenarioSteps:
      type: object
      properties:
        step1: { $ref: "#/components/schemas/ScenarioStepState" }
        step2: { $ref: "#/components/schemas/ScenarioStepState" }
      required: [step1, step2]
```

Add to the `Scenario` schema's `properties` (after `resultRunId`, line 1444) — **optional, not in `required`**, so the other five models' responses stay contract-valid:

```yaml
        steps:
          $ref: "#/components/schemas/ScenarioSteps"
          description: Present only for max-coverage-us (Chapter 4). Derived from solve_jobs on every read; never stored.
```

Add the new path after `/scenarios/{scenarioId}/solve-jobs/{jobId}`:

```yaml
  /scenarios/{scenarioId}/steps/{step}/result:
    get:
      operationId: getScenarioStepResult
      tags: [scenarios]
      summary: Full stored result envelope for one workflow step (Chapter 4 only)
      parameters:
        - name: scenarioId
          in: path
          required: true
          schema: { type: integer }
        - name: step
          in: path
          required: true
          schema: { type: integer, enum: [1, 2] }
      responses:
        "200":
          description: The step's complete stored envelope
          content:
            application/json:
              schema:
                type: object
                properties:
                  result: { $ref: "#/components/schemas/SolveResult" }
                required: [result]
        "401":
          description: Not authenticated
        "404":
          description: Not found, not owned, not a Chapter 4 scenario, or that step is unsolved
```

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected: exits 0; a `useGetScenarioStepResult` hook appears in `lib/api-client-react/src/generated/`.

- [ ] **Step 4: Write the read-path regressions**

Append to `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts`:

```ts
describe("CH4-12/CH4-13/CH4-14 — the steps read path", () => {
  it("reports both steps unsolved for a fresh scenario", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const res = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(res.body.steps).toEqual({
      step1: { solved: false, stale: false, jobId: null, summary: null },
      step2: { solved: false, stale: false, jobId: null, summary: null },
    });
  });

  it("omits steps entirely for another model", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "p-median", modelId: "p-median-us",
      inputs: {
        p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
        warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
        addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
      },
    }).expect(201);
    scenarioIds.push(created.body.id);
    const res = await request(app).get(`/api/scenarios/${created.body.id}`).set("Cookie", cookie).expect(200);
    expect(res.body.steps).toBeUndefined();
  });

  it("404s the step-result endpoint for an unsolved step", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).get(`/api/scenarios/${scenario.id}/steps/1/result`).set("Cookie", cookie).expect(404);
  });

  // Hard rule #5 — a non-owner gets 404, never 403, so a scenario id cannot
  // be enumerated through this endpoint.
  it("404s the step-result endpoint for a non-owner", async () => {
    const owner = await registerAndGetCookie();
    const stranger = await registerAndGetCookie();
    const scenario = await createScenario(owner);
    await request(app).get(`/api/scenarios/${scenario.id}/steps/1/result`).set("Cookie", stranger).expect(404);
    await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", stranger).expect(404);
  });

  it("404s an out-of-range step", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).get(`/api/scenarios/${scenario.id}/steps/3/result`).set("Cookie", cookie).expect(404);
  });

  // Acceptance row 13 — the CROSS-MODEL half. A p-median scenario has no step
  // concept; its owner must still get 404, not a 500 from dereferencing a null
  // `steps`. This is the case the route's `modelId !== "max-coverage-us"`
  // guard exists for, and nothing was proving it.
  it("404s the step-result endpoint for a non-Chapter-4 scenario, even for its owner", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "cross-model", modelId: "p-median-us",
      inputs: {
        p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
        warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
        addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
      },
    }).expect(201);
    scenarioIds.push(created.body.id);
    await request(app).get(`/api/scenarios/${created.body.id}/steps/1/result`).set("Cookie", cookie).expect(404);
  });

  // A job carrying a SUPERSEDED epoch must not be selected: that is what
  // "clearing a step" means. Seeded directly so the test does not depend on a
  // real CBC run.
  it("ignores a succeeded job whose snapshot carries a superseded epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await db.insert(solveJobsTable).values({
      scenarioId: scenario.id,
      userId: owner!.userId,
      status: "succeeded",
      inputsHash: "seeded-superseded",
      modelId: "max-coverage-us",
      inputSnapshot: { modelId: "max-coverage-us", inputs: { ...step1Inputs, stepEpoch: 1 } },
      result: {
        status: "optimal", solutionStatus: "optimal", quality: "Proven Optimal", runTimeSec: 1.5,
        metrics: { weightedAvgDistance: 635.13 },
        details: { objective: "coverage", coveragePct: 68.4192, coveredDemand: 53385024 },
      },
    });

    const before = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(before.body.steps.step1.solved).toBe(true);
    expect(before.body.steps.step1.summary.coveredDemand).toBe(53385024);
    expect(before.body.steps.step1.summary.coveragePct).toBeCloseTo(68.4192, 4);
    expect(before.body.steps.step1.summary.distanceUnit).toBe("km");

    // A Step 1 edit bumps the epoch to 2 — the seeded job is now superseded.
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);

    const after = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(after.body.steps.step1.solved).toBe(false);
    expect(after.body.steps.step1.summary).toBeNull();
  });

  // Acceptance row 7 — CH4-2 says a Step 1 edit drops BOTH results, not just
  // Step 2's. An earlier draft only asserted Step 1, which would pass even if
  // Step 2 survived the epoch bump and kept presenting a result computed
  // against a configuration that no longer exists.
  it("a Step 1 edit clears BOTH steps, not only Step 1", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep1Job(scenario.id, owner!.userId, 1);
    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);

    const before = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(before.body.steps.step1.solved).toBe(true);
    expect(before.body.steps.step2.solved).toBe(true);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);

    const after = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(after.body.steps.step1.solved).toBe(false);
    expect(after.body.steps.step2.solved).toBe(false);
    expect(after.body.steps.step2.summary).toBeNull();
    expect(await readEpoch(scenario.id)).toBe(2);
  });

  // Acceptance row 8 — bands are a reporting lens. The epoch assertion alone
  // (Task 2) does not prove SOLVE VALIDITY survives: a bands edit must leave
  // both steps still solved, not merely leave the counter intact.
  it("a distanceBands-only change alters neither the epoch nor either step's validity", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep1Job(scenario.id, owner!.userId, 1);
    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);

    await request(app).patch(`/api/scenarios/${scenario.id}/distance-bands`).set("Cookie", cookie)
      .send({ distanceBands: [700, 1400, 5500] }).expect(200);

    const after = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(after.body.steps.step1.solved).toBe(true);
    expect(after.body.steps.step2.solved).toBe(true);
    expect(after.body.steps.step2.stale).toBe(false);
    expect(await readEpoch(scenario.id)).toBe(1);
  });

  // A Step 1 snapshot is `validation.data` — it RETAINS step2 and stepEpoch
  // (see A3). Seeding it literally is therefore faithful to production, unlike
  // the Step 2 case below.
  async function seedStep1Job(scenarioId: number, userId: string, stepEpoch: number) {
    const [job] = await db.insert(solveJobsTable).values({
      scenarioId,
      userId,
      status: "succeeded",
      inputsHash: `seeded-step1-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      modelId: "max-coverage-us",
      inputSnapshot: { modelId: "max-coverage-us", inputs: { ...step1Inputs, stepEpoch } },
      result: {
        status: "optimal", solutionStatus: "optimal", quality: "Proven Optimal", runTimeSec: 1.5,
        metrics: { weightedAvgDistance: 635.13 },
        details: { objective: "coverage", coveragePct: 68.4192, coveredDemand: 53385024 },
      },
    }).returning();
    return job;
  }

  // R2 — the snapshot is built through synthesizeStep2Inputs, the SAME
  // function the enqueue path uses. An earlier draft hand-authored a snapshot
  // carrying a nested `step2` bag, which production never stores; that test
  // passed while the projection it was meant to prove was broken.
  async function seedStep2Job(scenarioId: number, userId: string, currentInputs: Record<string, unknown>) {
    const [job] = await db.insert(solveJobsTable).values({
      scenarioId,
      userId,
      status: "succeeded",
      inputsHash: `seeded-step2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      modelId: "max-coverage-us",
      inputSnapshot: {
        modelId: "max-coverage-us",
        inputs: synthesizeStep2Inputs(currentInputs, 53385024),
      },
      result: {
        status: "optimal", solutionStatus: "optimal", quality: "Proven Optimal", runTimeSec: 2.1,
        metrics: { weightedAvgDistance: 624.33 },
        details: { objective: "min_distance", coveragePct: 68.4192, coveredDemand: 53385024 },
      },
    }).returning();
    return job;
  }

  it("reports a freshly-synthesized Step 2 job as fresh when no step2 bag exists (inherited defaults)", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);

    const res = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(res.body.steps.step2.solved).toBe(true);
    // This is the assertion that fails against the old nested-step2 projection.
    expect(res.body.steps.step2.stale).toBe(false);
  });

  it("reports a Step 2 job solved with EXPLICIT step2 settings as fresh", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, step2: { gap: 0.05, timeLimitSec: 60 } } }).expect(200);
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);

    const res = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(res.body.steps.step2.stale).toBe(false);
  });

  it("flags Step 2 stale only after its effective settings change, without moving the epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);
    expect((await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)).body.steps.step2.stale).toBe(false);

    // A step2-only save does NOT bump the epoch, so the job stays selected —
    // it just becomes stale.
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, step2: { gap: 0.05, timeLimitSec: 120 } } }).expect(200);

    const stale = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(stale.body.steps.step2.solved).toBe(true);
    expect(stale.body.steps.step2.stale).toBe(true);
    expect(stale.body.steps.step1.stale).toBe(false);
    expect(await readEpoch(scenario.id)).toBe(1);
  });
});
```

- [ ] **Step 5: Run the regressions, typecheck, and commit**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server exec vitest run src/solver/__tests__/maxCoverageStepWorkflow.test.ts \
    src/__tests__/maxCoverageContract.test.ts
pnpm run typecheck
```

Expected: PASS; typecheck clean.

```bash
git add artifacts/api-server/src/services/maxCoverageSteps.ts \
        artifacts/api-server/src/routes/scenarios.ts \
        artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts \
        lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "[ch4-2s-5] project per-step state on the scenario read and serve envelopes lazily"
```

---

## Task 6: Remove the free objective toggle from both mounts

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx:235-359`
- Modify: `artifacts/studio/src/components/workspace/SolveDialog.tsx:219-293`
- Modify: `artifacts/studio/src/pages/Workspace.tsx:122-123`, `:1817-1840`, `:3334-3335`, `:4044-4045`
- Create: `artifacts/studio/src/hooks/useMaxCoverageSteps.ts`
- Modify: `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`, `SolveDialog.test.tsx`, `Workspace.test.tsx`

**Interfaces:**
- Consumes: the `steps` object on `Scenario` (Task 5).
- Produces: `useMaxCoverageSteps(scenario)` → `{ isMaxCoverage: boolean; steps: ScenarioSteps | null; solvedCount: 0|1|2; targetStep: 1|2; step1Frozen: boolean; solveLabel: string }`.

**Why both mounts:** CH4-17 names only `OptimizationParametersTab.tsx:233`, but a second toggle lives at `SolveDialog.tsx:226` with its own floor input at `:282`, and `Workspace.tsx:1827`'s `setChenObjectiveMode` writes `coverageFloorDemand` into `localInputs`. Left in place, the first save after Task 3 would 422 against this feature's own guard.

**Known incoming change to the same file (cross-session, Chapter 5).** A parallel Chapter 5 design (`docs/superpowers/specs/2026-09-28-chapter-5-delivery-teaching-design.md` §7.3, on local `main`) adds an "Adjust Cost Table" control to `OptimizationParametersTab.tsx`: four members on the `OptimizationParametersField` union, four optional props on `OptimizationParametersTabProps`, and one presence-gated JSX block at **388-437**, landing beside the existing `capacityFactor` family. Agreed ordering is **this plan first**, Chapter 5 rebasing onto it.

The JSX does not conflict — this task's last deletion ends at 357 and that block starts at 388, thirty lines clear of git's three-line context. The conflict surface is the **union at line 10 and the props interface at 32-133**, which both changes edit. When rebasing, expect to reconcile a type union and an interface, not to relocate any markup. Chapter 5's block is specified to land **outside** Task 7's `{(step ?? 1) === 1 && …}` wrapper, because Chapter 5 has no step concept and its control must render whenever its props are present — do not move it inside that wrapper while resolving.

- [ ] **Step 1: Write the failing removal tests**

In `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`, replace the assertion at line 237 (`expect(screen.getByTestId("chen-objective-toggle")).toBeInTheDocument()`) with:

```ts
  it("no longer renders a free objective toggle for max-coverage-us (CH4-17)", () => {
    renderMaxCoverageTab();
    expect(screen.queryByTestId("chen-objective-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("input-coverage-floor")).not.toBeInTheDocument();
    // The section itself stays — it still renders the service-distance fields.
    expect(screen.getByTestId("chen-objective-section")).toBeInTheDocument();
  });
```

In `artifacts/studio/src/__tests__/SolveDialog.test.tsx`, replace line 156's positive assertion with:

```ts
    expect(screen.queryByTestId("solve-dialog-chen-objective-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-input-coverage-floor")).not.toBeInTheDocument();
```

Append to `artifacts/studio/src/__tests__/Workspace.test.tsx`:

```ts
describe("CH4-17 — no client-side floor authoring survives", () => {
  it("never sends coverageFloorDemand or objective min_distance in a PATCH", async () => {
    const patched = await saveMaxCoverageScenarioAndCaptureBody();
    expect("coverageFloorDemand" in patched.inputs).toBe(false);
    expect(patched.inputs.objective).toBe("coverage");
  });
});
```

`saveMaxCoverageScenarioAndCaptureBody` is a helper this task adds to `Workspace.test.tsx`: it renders the Workspace for `max-coverage-us` with one seeded scenario, clicks the header Save control, and returns the JSON body the mocked `updateScenario` mutation received. Follow the mocking already used by that file's existing save tests; do not invent a new mock layer.

- [ ] **Step 2: Run the frontend tests to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx \
  src/__tests__/SolveDialog.test.tsx src/__tests__/Workspace.test.tsx
```

Expected: FAIL — both toggles still render.

- [ ] **Step 3: Delete the toggle from `OptimizationParametersTab.tsx`**

Line numbers measured at `32cacf8`. The whole Chapter 4 region is **one** enclosing block — `{objective != null && (` at 235, `chen-objective-section` opening at 236, closing `</div>` at 358 and `)}` at 359 — so both removals below are *inside* it and the block itself stays.

Remove the entire `<div className="space-y-2">…</div>` that renders the `Objective` label and the `chen-objective-toggle` group (**lines 237-262**), and remove the whole `{objective === "min_distance" && ( … )}` coverage-floor block (**lines 343-357**). Keep `chen-objective-section`, the two `ChenDistanceInput` fields, and the `{objective === "coverage" && …}` average-service-cap block at 316.

Then drop the now-unused prop from the component's interface and its destructuring:

```ts
  // CH4-17 — removed. The step toggle is now the ONLY way to choose an
  // objective, so two controls cannot disagree and no path reaches a
  // min-distance solve without the floor that gives it meaning.
  // onObjectiveModeChange?: (mode: "coverage" | "min_distance") => void;
```

Delete the declaration outright rather than leaving it commented; the comment above belongs on the `objective` prop that remains (now read-only for display).

- [ ] **Step 4: Delete the toggle and floor input from `SolveDialog.tsx`**

Same structure here: `{objective != null && (` at 219 opens the gate, `solve-dialog-chen-objective-section` at 220, closing `</div>` at 292 and `)}` at 293. The gate stays; the two blocks inside it go.

Remove the `solve-dialog-chen-objective-toggle` group (**lines 222-245**) and the entire `{objective === "min_distance" && ( … )}` block containing `solve-dialog-input-coverage-floor` (**lines 276-291**). Remove `coverageFloorDemand` from `SolveDialogProps` (line 116) and from the destructuring (line 169), and remove the `onObjectiveModeChange` prop.

**R5 — for Chapter 4 the dialog becomes confirmation-only.** Deleting the toggle is not sufficient. The dialog still renders the P slider (`:195`), the average-service-cap block (`:247`), the band editor, and the ordinary top-level `gap` / `timeLimitSec` inputs. When the server targets **Step 2**, those are all wrong: `p` and the service-distance fields are inherited and frozen (CH4-6), the average-service cap does not exist in min-distance mode, and editing top-level `gap`/`timeLimitSec` writes **Step 1's** limits while the student believes they are tuning the run about to happen.

Maintaining a second step-aware parameter editor here would duplicate Task 7's work and double the surface where the two can disagree — the exact failure CH4-17 exists to prevent. So for `max-coverage-us` the dialog renders **no editable parameters**: the step label, the seeded floor when targeting Step 2, a read-only summary of the effective settings, and Solve/Cancel. All parameter editing stays in Optimization Parameters.

Gate the editable sections on a new `readOnlyParams?: boolean` prop, passed `true` only for `max-coverage-us`; the other five models render exactly as today. Add tests proving the Chapter 4 dialog exposes no `input-*` parameter control in either step, and that `p-median-us`'s dialog is unchanged.

- [ ] **Step 5: Remove the floor authoring from `Workspace.tsx`**

Delete `MAX_COVERAGE_DEFAULT_COVERAGE_FLOOR_DEMAND` (line 123) — it becomes dead the moment the toggle goes, and a dead default is exactly what the migration's review flagged. Keep `MAX_COVERAGE_DEFAULT_AVG_SERVICE_CAP_KM`.

Delete `setChenObjectiveMode` entirely (lines 1817-1840). Remove both `onObjectiveModeChange={setChenObjectiveMode}` props (lines 3335 and 4045) and both `coverageFloorDemand={…}` props (lines 3334 and 4044).

- [ ] **Step 6: Add the step-state hook**

Create `artifacts/studio/src/hooks/useMaxCoverageSteps.ts`:

```ts
import { useMemo } from "react";
import type { Scenario, ScenarioSteps } from "@workspace/api-client-react";

export interface MaxCoverageStepState {
  isMaxCoverage: boolean;
  steps: ScenarioSteps | null;
  solvedCount: 0 | 1 | 2;
  /** CH4-9 — derived from the SAME rule the server applies, so the Solve
   *  button's label cannot disagree with what actually runs. */
  targetStep: 1 | 2;
  /** §3 — Step 1 is frozen the moment it is solved, whichever step the
   *  toggle points at. */
  step1Frozen: boolean;
  solveLabel: string;
}

export function useMaxCoverageSteps(scenario: Scenario | null | undefined): MaxCoverageStepState {
  return useMemo(() => {
    const steps = (scenario?.steps ?? null) as ScenarioSteps | null;
    if (!steps) {
      return {
        isMaxCoverage: false, steps: null, solvedCount: 0,
        targetStep: 1, step1Frozen: false, solveLabel: "Run Optimizer",
      };
    }
    const solvedCount = ((steps.step1.solved ? 1 : 0) + (steps.step2.solved ? 1 : 0)) as 0 | 1 | 2;
    const targetStep: 1 | 2 = steps.step1.solved ? 2 : 1;
    return {
      isMaxCoverage: true,
      steps,
      solvedCount,
      targetStep,
      step1Frozen: steps.step1.solved,
      solveLabel: `Solve Step ${targetStep}`,
    };
  }, [scenario]);
}
```

- [ ] **Step 7: Run the frontend tests to verify they pass**

```bash
pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx \
  src/__tests__/SolveDialog.test.tsx src/__tests__/Workspace.test.tsx
pnpm run typecheck
```

Expected: PASS; typecheck clean (it will fail loudly if a removed prop is still passed anywhere).

- [ ] **Step 8: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx \
        artifacts/studio/src/components/workspace/SolveDialog.tsx \
        artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/hooks/useMaxCoverageSteps.ts \
        artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx \
        artifacts/studio/src/__tests__/SolveDialog.test.tsx \
        artifacts/studio/src/__tests__/Workspace.test.tsx
git commit -m "[ch4-2s-6] remove the free objective toggle from both mounts"
```

---

## Task 7: The step toggle, per-step parameters, and confirm-and-clear

**Files:**
- Create: `artifacts/studio/src/components/workspace/StepToggle.tsx`
- Create: `artifacts/studio/src/components/workspace/FreezeConfirmDialog.tsx`
- Create: `artifacts/studio/src/__tests__/StepToggle.test.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx:3877-3918` (header), plus the tab render
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`

**Interfaces:**
- Consumes: `useMaxCoverageSteps` (Task 6).
- Produces: `<StepToggle selected onSelect solvedCount steps />`, `<FreezeConfirmDialog open onConfirm onCancel />`.

- [ ] **Step 1: Write the failing toggle tests**

Create `artifacts/studio/src/__tests__/StepToggle.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepToggle } from "@/components/workspace/StepToggle";

const unsolved = { solved: false, stale: false, jobId: null, summary: null };
const solved = { solved: true, stale: false, jobId: 1, summary: null };

describe("CH4-15 — the step toggle is always selectable", () => {
  it("renders both steps and the N of 2 counter", () => {
    render(<StepToggle selected={1} onSelect={vi.fn()} solvedCount={0} steps={{ step1: unsolved, step2: unsolved }} />);
    expect(screen.getByTestId("step-toggle-1")).toBeInTheDocument();
    expect(screen.getByTestId("step-toggle-2")).toBeInTheDocument();
    expect(screen.getByTestId("text-steps-solved-counter")).toHaveTextContent("0 of 2 solved");
  });

  // The deck locks Step 2's SOLVE, not the act of looking at it (frame 3a).
  it("lets Step 2 be selected at 0 of 2, showing a lock rather than disabling it", () => {
    const onSelect = vi.fn();
    render(<StepToggle selected={1} onSelect={onSelect} solvedCount={0} steps={{ step1: unsolved, step2: unsolved }} />);
    const step2 = screen.getByTestId("step-toggle-2");
    expect(step2).not.toBeDisabled();
    fireEvent.click(step2);
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(screen.getByTestId("step-toggle-2-lock")).toBeInTheDocument();
  });

  it("counts a solved step and drops the lock once Step 1 is solved", () => {
    render(<StepToggle selected={1} onSelect={vi.fn()} solvedCount={1} steps={{ step1: solved, step2: unsolved }} />);
    expect(screen.getByTestId("text-steps-solved-counter")).toHaveTextContent("1 of 2 solved");
    expect(screen.queryByTestId("step-toggle-2-lock")).not.toBeInTheDocument();
  });

  it("marks the selected step with aria-pressed", () => {
    render(<StepToggle selected={2} onSelect={vi.fn()} solvedCount={2} steps={{ step1: solved, step2: solved }} />);
    expect(screen.getByTestId("step-toggle-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("step-toggle-1")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a stale badge only on Step 2", () => {
    render(<StepToggle selected={2} onSelect={vi.fn()} solvedCount={2}
      steps={{ step1: solved, step2: { ...solved, stale: true } }} />);
    expect(screen.getByTestId("step-toggle-2-stale")).toBeInTheDocument();
    expect(screen.queryByTestId("step-toggle-1-stale")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the toggle tests to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/StepToggle.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Build the toggle**

Create `artifacts/studio/src/components/workspace/StepToggle.tsx`:

```tsx
import { Lock } from "lucide-react";
import type { ScenarioSteps } from "@workspace/api-client-react";

interface StepToggleProps {
  selected: 1 | 2;
  onSelect: (step: 1 | 2) => void;
  solvedCount: 0 | 1 | 2;
  steps: ScenarioSteps;
}

const LABELS: Record<1 | 2, string> = { 1: "1. Max Coverage", 2: "2. Min Distance" };

// CH4-15 — always selectable. At `0 of 2` Step 2 is VIEWABLE with a lock icon;
// what is locked is its Solve, not the act of looking at it (frame 3a).
export function StepToggle({ selected, onSelect, solvedCount, steps }: StepToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="inline-flex rounded border border-[color:var(--ink-500)] overflow-hidden"
        role="group"
        aria-label="Workflow step"
        data-testid="step-toggle"
      >
        {([1, 2] as const).map((step) => {
          const state = step === 1 ? steps.step1 : steps.step2;
          const locked = step === 2 && !steps.step1.solved;
          return (
            <button
              key={step}
              type="button"
              data-testid={`step-toggle-${step}`}
              aria-pressed={selected === step}
              onClick={() => onSelect(step)}
              className={`flex items-center gap-1 text-xs px-3 py-1 transition-colors ${
                selected === step
                  ? "bg-primary text-white"
                  : "bg-transparent text-[color:var(--ink-300)] hover:bg-white/10"
              }`}
            >
              {LABELS[step]}
              {locked && <Lock className="w-3 h-3" data-testid={`step-toggle-${step}-lock`} />}
              {/* CH4-3 — staleness exists in exactly one place: Step 2, after
                  Step 2 has solved. Step 1 can never be stale, because the only
                  thing that can change it also clears it. */}
              {step === 2 && state.stale && (
                <span data-testid="step-toggle-2-stale" className="text-[10px] uppercase tracking-wide">
                  stale
                </span>
              )}
            </button>
          );
        })}
      </div>
      <span className="text-xs font-mono text-[color:var(--ink-300)]" data-testid="text-steps-solved-counter">
        {solvedCount} of 2 solved
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the toggle tests to verify they pass**

```bash
pnpm --filter studio exec vitest run src/__tests__/StepToggle.test.tsx
```

Expected: PASS, all cases.

- [ ] **Step 5: Build the confirm-and-clear dialog**

Create `artifacts/studio/src/components/workspace/FreezeConfirmDialog.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface FreezeConfirmDialogProps {
  open: boolean;
  /** R3 — true while the confirm PATCH is in flight. Both buttons disable. */
  busy: boolean;
  /** R3 — set when the PATCH failed. The dialog STAYS OPEN and shows this;
   *  closing on failure would claim results were cleared when they were not. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// CH4-16 — the freeze is enforced by intercepting the EDIT, not by rendering
// read-only. No table or tab component in this repo accepts a `readOnly` prop,
// and adding one would touch components shared with five other chapters.
// Fields stay live; the first edit attempt raises this dialog; confirming bumps
// the epoch, drops BOTH results to `0 of 2`, and lets the edit proceed.
// Accepted cost: a student can begin typing before learning there is a
// consequence.
export function FreezeConfirmDialog({ open, busy, error, onConfirm, onCancel }: FreezeConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent data-testid="freeze-confirm-dialog">
        <DialogHeader>
          <DialogTitle>Editing Step 1 clears both results</DialogTitle>
          <DialogDescription>
            Step 1's data and parameters are frozen while its results stand. Changing
            them discards the Max Coverage result and the Min Distance result, and
            returns this scenario to 0 of 2 solved. The solves themselves are kept in
            history.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" data-testid="freeze-confirm-error">{error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel} data-testid="freeze-confirm-cancel">
            Cancel
          </Button>
          <Button disabled={busy} onClick={onConfirm} data-testid="freeze-confirm-accept">
            {busy ? "Clearing…" : "Edit and clear results"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Wire the toggle, the label and the interception into `Workspace.tsx`**

Add the imports and the hook call beside the existing `hasFreshSolvedRun` derivation (~line 1439):

```ts
import { StepToggle } from "@/components/workspace/StepToggle";
import { FreezeConfirmDialog } from "@/components/workspace/FreezeConfirmDialog";
import { useMaxCoverageSteps } from "@/hooks/useMaxCoverageSteps";
```

```ts
  const stepState = useMaxCoverageSteps(currentScenario);
  const [selectedStep, setSelectedStep] = useState<1 | 2>(1);
  // Holds the fully-computed next `inputs` blob, NOT a callback. An earlier
  // draft stored a closure and then needed an invented `applyEditToDraft` to
  // turn it back into a payload at confirm time — the same invent-a-helper
  // trap this plan's Global Constraints call out. Computing the blob at
  // intercept time means confirm has nothing left to derive.
  const [pendingStep1Inputs, setPendingStep1Inputs] = useState<Record<string, unknown> | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // CH4-16 — every Step 1 write funnels through here. `distanceBands` is
  // exempt: it is a reporting lens, not a model constraint, and stays editable
  // while Step 1 is frozen (§4.3).
  //
  // `nextInputs` is the complete blob the edit would produce, so each call
  // site computes its own change exactly as it does today and passes the
  // result rather than a mutation function.
  function guardStep1Edit(nextInputs: Record<string, unknown>, field?: string) {
    if (!stepState.step1Frozen || field === "distanceBands") {
      setLocalInputs(nextInputs);
      return;
    }
    setPendingStep1Inputs(nextInputs);
  }

  // R3 — confirm-and-clear is a PERSISTED operation, not a draft edit.
  //
  // An earlier draft only invoked the local callback, so the epoch never
  // moved, `steps` never refetched, and the counter kept reading `1 of 2`
  // until the student happened to press Save. The dialog said results were
  // cleared while the server still held them — and Task 9's e2e asserted
  // `0 of 2` immediately after Confirm, which that implementation could never
  // satisfy. Two coherent designs existed; this is the one chosen, because it
  // is what the dialog copy and frame 6 both describe.
  //
  // Apply the draft edit, PATCH it, AWAIT the response, refetch the scenario,
  // and only then close. The server bumps the epoch inside its own locked
  // transaction (CH4-23) — the client never sends one. On failure the old
  // state stands and the dialog reports the error rather than closing on a
  // lie.
  async function confirmStep1Edit() {
    if (!pendingStep1Inputs || !currentScenario) return;
    setClearing(true);
    setClearError(null);
    try {
      await updateScenario.mutateAsync({
        scenarioId: currentScenario.id,
        data: { inputs: pendingStep1Inputs },
      });
      await queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(currentScenario.id) });
      setLocalInputs(pendingStep1Inputs);
      setPendingStep1Inputs(null);
    } catch (err) {
      setClearError(err instanceof Error ? err.message : "Could not clear the results. Nothing was changed.");
    } finally {
      setClearing(false);
    }
  }
```

In the header's right-hand track (after `<UnitToggle />`, ~line 3905), render the toggle for Chapter 4 only:

```tsx
            {stepState.isMaxCoverage && stepState.steps && (
              <StepToggle
                selected={selectedStep}
                onSelect={setSelectedStep}
                solvedCount={stepState.solvedCount}
                steps={stepState.steps}
              />
            )}
```

Change the Solve button's label (line 3915) — testid unchanged so no sibling spec breaks on the selector:

```tsx
              {stepState.isMaxCoverage ? stepState.solveLabel : "Run Optimizer"}
```

After a successful solve, point the toggle at the step that just ran, beside the existing auto-navigation to the Output Map (~line 2816):

```ts
        if (stepState.isMaxCoverage) setSelectedStep(stepState.targetStep);
```

Render the dialog **unconditionally in the main return**, not inside a branch — a dialog referenced from a branch that never renders it is a silent, real bug this repo has already shipped once (`Studio.tsx`'s create-scenario dialog):

```tsx
      <FreezeConfirmDialog
        open={pendingStep1Inputs !== null}
        busy={clearing}
        error={clearError}
        onCancel={() => { setPendingStep1Inputs(null); setClearError(null); }}
        onConfirm={confirmStep1Edit}
      />
```

`FreezeConfirmDialog` gains `busy` and `error` props: disable both buttons while `busy`, and render `error` in the dialog rather than closing on failure. Without them the dialog cannot express the awaited PATCH R3 requires.

Route `handleOptimizationParamsChange` and the three entity-edit handlers (`updateInputsField` and the warehouse/customer/distance mutators at lines 1861/1898/1931) through `guardStep1Edit`, each passing the complete next `inputs` blob it already computes today.

- [ ] **Step 7: Render Step 2's parameter panel**

In `OptimizationParametersTab.tsx`, add props `step?: 1 | 2`, `stepEditable?: boolean`, `step2Gap?: number`, `step2TimeLimitSec?: number`, `coverageFloorFromStep1?: number | null`, and render the Step 2 view when `step === 2`:

```tsx
      {step === 2 && (
        <div className="space-y-4" data-testid="step2-parameters">
          {/* CH4-6 — inherited from Step 1 and NOT editable here. Inheriting
              highServiceDistKm is load-bearing: the floor must constrain demand
              within the same radius that produced it. */}
          <dl className="grid grid-cols-3 gap-3 text-xs" data-testid="step2-inherited">
            <div><dt className="text-muted-foreground">P (inherited)</dt><dd className="font-mono">{p}</dd></div>
            <div><dt className="text-muted-foreground">High-service distance</dt><dd className="font-mono">{highServiceDistKm}</dd></div>
            <div><dt className="text-muted-foreground">Max distance</dt><dd className="font-mono">{maxDistKm}</dd></div>
          </dl>

          <div>
            <Label className="text-xs text-muted-foreground">Coverage floor (demand)</Label>
            {coverageFloorFromStep1 == null ? (
              <div data-testid="step2-floor-placeholder"
                className="h-8 mt-1 flex items-center px-2 text-sm font-mono text-muted-foreground border border-dashed border-border rounded">
                — produced by solve
              </div>
            ) : (
              <div data-testid="step2-floor-value"
                className="h-8 mt-1 flex items-center gap-2 px-2 text-sm font-mono border border-border rounded bg-muted">
                {coverageFloorFromStep1.toLocaleString()}
                <Lock className="w-3 h-3 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* R6 — `stepEditable` is FALSE at `0 of 2`. Step 2 is viewable
              there (CH4-15) but must not be editable: its settings only mean
              something once a Step 1 result exists to seed the floor. An
              earlier draft declared this prop and never read it, so the
              fields were editable in a state the design calls read-only. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="input-step2-gap" className="text-xs text-muted-foreground">Gap</Label>
              <Input id="input-step2-gap" type="number" data-testid="input-step2-gap"
                disabled={!stepEditable}
                value={step2Gap ?? ""} className="h-8 text-sm mt-1 font-mono"
                onChange={e => onChange("step2Gap", parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <Label htmlFor="input-step2-time-limit" className="text-xs text-muted-foreground">Time limit (s)</Label>
              <Input id="input-step2-time-limit" type="number" data-testid="input-step2-time-limit"
                disabled={!stepEditable}
                value={step2TimeLimitSec ?? ""} className="h-8 text-sm mt-1 font-mono"
                onChange={e => onChange("step2TimeLimitSec", parseInt(e.target.value, 10) || 1)} />
            </div>
          </div>
        </div>
      )}
```

Wrap the existing Chapter 4 block in `{(step ?? 1) === 1 && ( … )}` so the two views are mutually exclusive. Extend `OptimizationParametersField` with `"step2Gap" | "step2TimeLimitSec"`, and have `Workspace.tsx` map those two fields onto `localInputs.step2.{gap,timeLimitSec}` — never onto the top-level `gap`/`timeLimitSec`, which belong to Step 1.

- [ ] **Step 8: Run the frontend suites, typecheck, and commit**

```bash
pnpm --filter studio exec vitest run src/__tests__/StepToggle.test.tsx \
  src/__tests__/OptimizationParametersTab.test.tsx src/__tests__/Workspace.test.tsx
pnpm run typecheck
```

Expected: PASS; typecheck clean.

```bash
git add artifacts/studio/src/components/workspace/StepToggle.tsx \
        artifacts/studio/src/components/workspace/FreezeConfirmDialog.tsx \
        artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx \
        artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/__tests__/StepToggle.test.tsx \
        artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx \
        artifacts/studio/src/__tests__/Workspace.test.tsx
git commit -m "[ch4-2s-7] add the step toggle, Step 2 parameters and confirm-and-clear"
```

---

## Task 8: Per-step output gating and the side-by-side comparison

**Files:**
- Create: `artifacts/studio/src/components/workspace/StepComparisonTable.tsx`
- Create: `artifacts/studio/src/__tests__/StepComparisonTable.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/SidebarTree.tsx:116-135`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (output gating, Solution Summary)

**Interfaces:**
- Consumes: `useMaxCoverageSteps` (Task 6), `useGetScenarioStepResult` (Task 5 codegen).
- Produces: `<StepComparisonTable step1 step2 />` rendered only at `2 of 2`.

- [ ] **Step 1: Write the failing comparison tests**

Create `artifacts/studio/src/__tests__/StepComparisonTable.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepComparisonTable } from "@/components/workspace/StepComparisonTable";

const step1 = {
  objective: "coverage" as const, status: "optimal", solutionStatus: "optimal",
  quality: "Proven Optimal", coveragePct: 68.4192, coveredDemand: 53385024,
  weightedAvgDistance: 635.13, distanceUnit: "km", runTimeSec: 1.5,
};
const step2 = { ...step1, objective: "min_distance" as const, weightedAvgDistance: 624.33, runTimeSec: 2.1 };

describe("CH4-13 — frame 3d comparison", () => {
  it("renders both steps side by side from data the scenario already holds", () => {
    render(<StepComparisonTable step1={step1} step2={step2} />);
    expect(screen.getByTestId("step-comparison")).toBeInTheDocument();
    expect(screen.getByTestId("step-comparison-coveredDemand-1")).toHaveTextContent("53,385,024");
    expect(screen.getByTestId("step-comparison-coveredDemand-2")).toHaveTextContent("53,385,024");
    expect(screen.getByTestId("step-comparison-weightedAvgDistance-1")).toHaveTextContent("635.13 km");
    expect(screen.getByTestId("step-comparison-weightedAvgDistance-2")).toHaveTextContent("624.33 km");
  });

  it("shows coverage percent to 4 decimals, matching the solver's own rounding", () => {
    render(<StepComparisonTable step1={step1} step2={step2} />);
    expect(screen.getByTestId("step-comparison-coveragePct-1")).toHaveTextContent("68.4192");
  });

  it("renders an em dash for a null metric rather than NaN or blank", () => {
    render(<StepComparisonTable step1={{ ...step1, coveragePct: null }} step2={step2} />);
    expect(screen.getByTestId("step-comparison-coveragePct-1")).toHaveTextContent("—");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter studio exec vitest run src/__tests__/StepComparisonTable.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Build the comparison table**

Create `artifacts/studio/src/components/workspace/StepComparisonTable.tsx`:

```tsx
import type { ScenarioStepSummary } from "@workspace/api-client-react";

interface StepComparisonTableProps {
  step1: ScenarioStepSummary;
  step2: ScenarioStepSummary;
}

// CH4-13 — with both summaries already on the scenario, this renders from data
// the UI holds. No extra fetch when it unlocks at `2 of 2`.
const ROWS = [
  { key: "objective" as const, label: "Objective" },
  { key: "coveragePct" as const, label: "Coverage %" },
  { key: "coveredDemand" as const, label: "Covered demand" },
  { key: "weightedAvgDistance" as const, label: "Weighted avg distance" },
  { key: "runTimeSec" as const, label: "Run time (s)" },
  { key: "quality" as const, label: "Quality" },
];

function format(summary: ScenarioStepSummary, key: (typeof ROWS)[number]["key"]): string {
  const value = summary[key];
  if (value == null) return "—";
  switch (key) {
    case "objective": return value === "coverage" ? "Max coverage" : "Min distance";
    // 4 dp matches solve.py's own `round(covered * 100 / total, 4)` — do not
    // re-round to 2 here or the UI and the envelope disagree.
    case "coveragePct": return Number(value).toFixed(4);
    case "coveredDemand": return Number(value).toLocaleString();
    case "weightedAvgDistance": return `${Number(value).toFixed(2)} ${summary.distanceUnit}`;
    case "runTimeSec": return Number(value).toFixed(2);
    default: return String(value);
  }
}

export function StepComparisonTable({ step1, step2 }: StepComparisonTableProps) {
  return (
    <table className="w-full text-sm border-collapse" data-testid="step-comparison">
      <thead>
        <tr className="text-left border-b border-border">
          <th className="py-1.5 pr-3 font-semibold">Metric</th>
          <th className="py-1.5 pr-3 font-semibold">1. Max Coverage</th>
          <th className="py-1.5 font-semibold">2. Min Distance</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.key} className="border-b border-border/50">
            <td className="py-1.5 pr-3 text-muted-foreground">{row.label}</td>
            <td className="py-1.5 pr-3 font-mono" data-testid={`step-comparison-${row.key}-1`}>
              {format(step1, row.key)}
            </td>
            <td className="py-1.5 font-mono" data-testid={`step-comparison-${row.key}-2`}>
              {format(step2, row.key)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter studio exec vitest run src/__tests__/StepComparisonTable.test.tsx
```

Expected: PASS, all cases.

- [ ] **Step 5: Make unsolved output entries clickable (CH4-18)**

In `SidebarTree.tsx`, add an opt-in prop rather than changing the five other models' behaviour:

```ts
  /** CH4-18 — per frame 3e, Chapter 4's output entries stay CLICKABLE when the
   *  selected step is unsolved; the tab itself renders an empty state instead.
   *  A student can see what they would get before committing to a solve. Every
   *  other model keeps the existing disabled-until-solved behaviour. */
  keepOutputsClickable?: boolean;
```

In the outputs `<button>` (lines 118-119), replace the two gating attributes:

```tsx
                disabled={!hasSolvedRun && !keepOutputsClickable}
                aria-disabled={!hasSolvedRun && !keepOutputsClickable}
```

and the className condition:

```tsx
                className={
                  !hasSolvedRun && !keepOutputsClickable
                    ? "w-full text-left px-3 py-1.5 truncate text-muted-foreground/40 cursor-not-allowed"
                    : rowClass(entry.id === activeEntityId)
                }
```

In `Workspace.tsx`, pass `keepOutputsClickable={stepState.isMaxCoverage}`.

**R4 — define ONE canonical output adapter and route every consumer through it.** `Workspace.tsx` has 44 references to `displayedResult` / `displayedInputs` (declared at `:1688` and `:1703`), plus `hasFreshSolvedRun` at `:1439`, and a dedicated regression file `Workspace.DisplayedInputs.test.tsx` (309 lines). Firing `useGetScenarioStepResult` without rewiring those leaves the Output Map, every grid, export and timing rendering the *scenario's* latest result while the toggle claims to show a step — a Step 2 tab showing Step 1's numbers.

Declare these three beside the existing derivations and use them at **every** output call site:

```ts
  // R4 — the single source of output truth. For Chapter 4 it follows the step
  // toggle; for the other five models it is exactly today's behaviour, so no
  // existing consumer changes meaning.
  const stepResultQuery = useGetScenarioStepResult(
    currentScenario?.id ?? 0,
    selectedStep,
    { query: { enabled: stepState.isMaxCoverage && selectedStepSolved } },
  );

  const selectedStepSolved = stepState.isMaxCoverage
    ? (selectedStep === 1 ? stepState.steps!.step1.solved : stepState.steps!.step2.solved)
    : hasFreshSolvedRun;

  const activeOutputResult = stepState.isMaxCoverage
    ? (stepResultQuery.data?.result ?? null)
    : displayedResult;

  const activeOutputInputs = stepState.isMaxCoverage
    ? (currentScenario?.inputs as Record<string, unknown> | undefined ?? null)
    : displayedInputs;

  const activeOutputReady = stepState.isMaxCoverage
    ? (selectedStepSolved && stepResultQuery.isSuccess && activeOutputResult != null)
    : hasFreshSolvedRun;
```

Then replace `displayedResult` → `activeOutputResult`, `displayedInputs` → `activeOutputInputs`, and `hasFreshSolvedRun` → `activeOutputReady` at every output-rendering site: Output Map, all five grids, `CostSummaryTab`, exports, timing, and any result-dependent overlay. Render `stepResultQuery.isLoading` as a spinner and `stepResultQuery.isError` as a retry message — an unhandled error state would silently fall through to the "not solved yet" empty state and misreport a solved step as unsolved.

Acceptance row 11 — extend `Workspace.DisplayedInputs.test.tsx` with the Chapter 4 case, written out rather than merely named:

```tsx
describe("R4 — Chapter 4 outputs follow the step toggle", () => {
  it("renders Step 1's result on step 1 and Step 2's on step 2, from the same scenario", async () => {
    // Two distinct envelopes so a wrong-step render is unambiguous: Step 1's
    // weighted average is 635.13, Step 2's is 624.33.
    renderWorkspaceForMaxCoverage({
      steps: {
        step1: { solved: true, stale: false, jobId: 11, summary: step1Summary },
        step2: { solved: true, stale: false, jobId: 12, summary: step2Summary },
      },
      stepResults: { 1: step1Envelope, 2: step2Envelope },
    });

    await screen.findByTestId("sidebar-output-cost-summary");
    fireEvent.click(screen.getByTestId("sidebar-output-cost-summary"));
    expect(await screen.findByTestId("cost-summary-value-wavg")).toHaveTextContent("635.13");

    fireEvent.click(screen.getByTestId("step-toggle-2"));
    expect(await screen.findByTestId("cost-summary-value-wavg")).toHaveTextContent("624.33");
  });

  it("hides the result-history stepper for Chapter 4 but keeps it for p-median-us", async () => {
    renderWorkspaceForMaxCoverage({ steps: bothSolvedSteps, stepResults: { 1: step1Envelope, 2: step2Envelope } });
    await screen.findByTestId("step-toggle");
    expect(screen.queryByTestId("button-result-back")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-result-history-position")).not.toBeInTheDocument();

    cleanup();
    renderWorkspaceForPMedian({ withHistory: true });
    expect(await screen.findByTestId("button-result-back")).toBeInTheDocument();
  });
});
```

`renderWorkspaceForMaxCoverage` / `renderWorkspaceForPMedian` follow this file's existing render-helper convention — extend the helper already there rather than introducing a parallel one.

**Result-history stepper vs. the step toggle.** Two independent result selectors on one screen would need two-dimensional semantics nobody has specified. Hide the existing history controls (`button-result-back` / `button-result-forward` / `text-result-history-position` / `button-save-as-scenario`, `Workspace.tsx:3884-3899`) for Chapter 4 and make the step toggle its only result selector. Extend `Workspace.DisplayedInputs.test.tsx` with a Chapter 4 case proving the adapter follows the toggle, and assert the history controls are absent for `max-coverage-us` and still present for `p-median-us`.

In `renderTabContent`'s output branches, render an empty state for Chapter 4's unsolved step instead of `StaleOutputBanner`:

```tsx
        if (stepState.isMaxCoverage && !selectedStepSolved) {
          return (
            <div className="p-6 text-sm text-muted-foreground" data-testid="step-not-solved-empty">
              Not solved yet — Solve Step {selectedStep}
            </div>
          );
        }
```

- [ ] **Step 6: Render the comparison under Solution Summary at `2 of 2`**

In the `cost-summary` branch of `renderTabContent`:

```tsx
            {stepState.isMaxCoverage && stepState.solvedCount === 2 && (
              <div className="mt-6" data-testid="step-comparison-section">
                <h3 className="text-sm font-semibold mb-2">Step comparison</h3>
                <StepComparisonTable
                  step1={stepState.steps!.step1.summary!}
                  step2={stepState.steps!.step2.summary!}
                />
              </div>
            )}
```

The comparison reads `stepState.steps`, which the scenario already carries — no extra fetch. Every other output surface reads the R4 adapter above.

**Also rewire `CostSummaryTab.tsx` (found during review, not named in it).** Its `scenarioObjectiveMode()` at `:126` reads `s?.result?.details` — i.e. `scenario.result`, the column CH4-12 says Chapter 4's UI must never read. It uses that value to *block comparing two Chapter 4 scenarios solved under different objective modes*. Under the two-step workflow every scenario at `2 of 2` has `result` holding whichever step solved last (Step 2), so the guard silently compares Step 2 against Step 2 and its mode-mismatch check becomes vacuous. For `max-coverage-us`, source the objective mode from `steps.step1.summary` / `steps.step2.summary` instead, keyed by the step being compared, and keep the existing `result`-based path for the other five models. `ObjectiveBar.tsx:40` reads `result?.details` the same way and takes the same treatment via the adapter.

- [ ] **Step 7: Run the frontend gate, typecheck, and commit**

```bash
pnpm --filter studio test
pnpm run typecheck
```

Expected: PASS; typecheck clean.

```bash
git add artifacts/studio/src/components/workspace/StepComparisonTable.tsx \
        artifacts/studio/src/components/workspace/SidebarTree.tsx \
        artifacts/studio/src/pages/Workspace.tsx \
        artifacts/studio/src/__tests__/StepComparisonTable.test.tsx
git commit -m "[ch4-2s-8] gate outputs per step and add the 2-of-2 comparison"
```

---

## Task 9: Rewrite the sibling e2e specs and run the full gate

**Files:**
- Modify: `artifacts/studio/e2e/max-coverage.spec.ts:203-222`
- Verify: `artifacts/studio/e2e/nonjade-servicestats-live-coverage.spec.ts:391`
- Test: the whole verification gate

**Interfaces:** consumes everything above.

**Scope correction (CH4-22):** the spec names `chen-bands-units-qa.spec.ts` and `tab-coverage.spec.ts`; grepping the tree shows neither references `chen-objective-toggle` or `input-coverage-floor`. The real dependents are `max-coverage.spec.ts` (a genuine break) and `nonjade-servicestats-live-coverage.spec.ts:391`, which asserts only on `chen-objective-section` — the wrapper that survives. Verify, do not rewrite, the latter.

- [ ] **Step 1: Re-audit the e2e directory for every changed contract**

```bash
cd artifacts/studio
grep -rn "chen-objective-toggle\|chen-objective-min_distance\|chen-objective-coverage\|input-coverage-floor\|solve-dialog-chen-objective\|solve-dialog-input-coverage-floor\|Run Optimizer" e2e/
```

Expected: hits only in `max-coverage.spec.ts` (the toggle/floor group) plus `Run Optimizer` in specs driving the five non-Chapter-4 models, whose label is unchanged. Any hit in a spec not named in this task is a gap — rewrite it here, before merge. The unit gate does not run Playwright and will not catch it.

- [ ] **Step 2: Rewrite `max-coverage.spec.ts` step 3 to the two-step flow**

Replace lines 207-222 (the `Switch to min-distance` block) with:

```ts
      // ── 3. Step 1 is solved; Step 2 unlocks and runs from the seeded floor ──
      // The free objective toggle is gone (CH4-17): the step toggle is now the
      // only way to reach min-distance, and the floor is produced by Step 1's
      // achieved covered demand rather than typed.
      await expect(page.getByTestId("chen-objective-toggle")).toHaveCount(0);
      await expect(page.getByTestId("input-coverage-floor")).toHaveCount(0);
      await expect(page.getByTestId("text-steps-solved-counter")).toHaveText("1 of 2 solved");

      await page.getByTestId("step-toggle-2").click();
      await expect(page.getByTestId("step-toggle-2")).toHaveAttribute("aria-pressed", "true");

      // The floor is displayed, locked, and equal to Step 1's covered demand.
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await expect(page.getByTestId("step2-floor-value")).toContainText("53,385,024", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("step2-parameters")).toBeVisible();

      await expect(page.getByTestId("button-run-optimizer")).toHaveText("Solve Step 2");
      const minDist = await solveViaUi(page, id);
      expect(minDist.details.objective).toBe("min_distance");
      // Sacred min-distance golden (test_max_coverage.py::test_min_distance_golden).
      expect(minDist.objective).toBeCloseTo(48714263031.75, -3);
      expect(new Set(minDist.details.openWarehouseIds)).toEqual(new Set(["DAL", "LA", "PIT"]));

      await expect(page.getByTestId("text-steps-solved-counter")).toHaveText("2 of 2 solved");

      // Frame 3d — the comparison unlocks at 2 of 2 and renders from data the
      // scenario already carries.
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("demand-km", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("step-comparison")).toBeVisible();
      await expect(page.getByTestId("step-comparison-weightedAvgDistance-1")).toContainText("635.13 km");
      await expect(page.getByTestId("step-comparison-weightedAvgDistance-2")).toContainText("624.33 km");
```

- [ ] **Step 3: Add a confirm-and-clear e2e case**

Append to the same spec, after the demand-edit step:

```ts
      // ── 4b. A Step 1 edit raises confirm-and-clear and drops BOTH steps ───
      // CH4-2 — the deck's frame 6 clears only Step 2; dropping Step 1 as well
      // is the deliberate extension that makes solve targeting derivable from
      // state alone.
      await page.getByTestId("step-toggle-1").click();
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await page.getByTestId("input-high-service-dist").fill("750");
      await expect(page.getByTestId("freeze-confirm-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("freeze-confirm-accept").click();
      await expect(page.getByTestId("text-steps-solved-counter")).toHaveText("0 of 2 solved");
      await expect(page.getByTestId("button-run-optimizer")).toHaveText("Solve Step 1");
```

- [ ] **Step 4: Run the Chapter 4 e2e spec against local servers**

Start the two servers, then run the spec:

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3001 \
  pnpm --filter api-server run dev &
PORT=5199 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 \
  pnpm --filter studio run dev &
cd artifacts/studio && E2E_BASE_URL=http://localhost:5199 \
  npx playwright test e2e/max-coverage.spec.ts --reporter=list --retries=0
```

Expected: PASS. Then confirm the sibling spec still passes untouched:

```bash
cd artifacts/studio && E2E_BASE_URL=http://localhost:5199 \
  npx playwright test e2e/nonjade-servicestats-live-coverage.spec.ts --reporter=list --retries=0
```

Expected: PASS — it asserts only on `chen-objective-section`, which survives.

- [ ] **Step 5: Run the full verification gate**

```bash
git diff --check \
  && pnpm run typecheck \
  && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test \
  && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```

Expected: all green. `git diff --check` leads (whitespace errors and conflict markers fail fast and cost nothing). `DATABASE_URL` inline is mandatory — without it eight api-server suites fail at *collection* (`lib/db/src/index.ts` throws at import) and look like real failures.

Re-run **Task 0's audit** now, before closeout, so a consumer introduced during implementation cannot slip through. Record any new hit and its disposition.

- [ ] **Step 6: Run the sacred solver script, unmodified**

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```

Expected: `99/99`. It is not pytest-discovered, so the gate above does not run it. It has no Chapter 4 section, so this plan should not move the number — if it does, the change is wrong (hard rule #2).

- [ ] **Step 7: Re-gate the full e2e suite**

```bash
pnpm e2e:gate
```

Expected: PASS. A failure here in a spec this plan never edited is the recurring `spec_gap` class — fix the sibling spec now, before merge.

- [ ] **Step 8: Record the changelog entry (hard rule #9)**

`docs/CHANGELOG-implementation.md` is append-only, most recent last, and the entry lands in the **same commit** as the work it describes. Append one entry covering the whole bundle: the nine task ids and their commit SHAs, the gate numbers actually observed, the review findings R1–R11 and how each was resolved, and the deviations recorded in the plan-resolution table.

Lift only distilled, still-true rules into `CLAUDE.md`'s `## Gotchas` — never the narrative. Two candidates from this bundle, both new bug classes:

- A test that hand-authors a persisted shape the production writer never produces will pass while the code it covers is broken (R2: the `step2` bag that `synthesizeStep2Inputs` destructures away).
- A partial unique index or an in-transaction guard added for one model silently changes enqueue semantics for every model unless its predicate names the model (R1).

- [ ] **Step 9: Commit with an explicit, reviewed file list**

R11 — Step 1 may have required fixing sibling specs, and Step 4/7 may have touched more than `max-coverage.spec.ts`. Derive the list; do not hand-guess it, and do not `git add -A`:

```bash
git status --short
git diff --name-only
```

Stage exactly the reviewed paths, then:

```bash
git commit -m "[ch4-2s-9] rewrite the Chapter 4 e2e spec for the two-step workflow"
```

Verify nothing was missed or smuggled in:

```bash
git show --stat HEAD
git status --short   # must be empty
```

---

## Task 10: Production rollout — index, deploy, smoke, harness-retro

**Files:**
- Create: `docs/ops/ch4-two-step-rollout.md`
- Modify: `docs/CHANGELOG-implementation.md`

**Why this task exists (R10).** Task 1 pushes the schema to local `nos_dev` only. `render.yaml` carries **no** pre-deploy database step — verified: its only `push`-adjacent line is a comment about suppressing auto-deploy. So shipping the code does **not** create the production index, and the application would run with its in-transaction guard as the sole protection while the database backstop silently does not exist. Someone must apply it deliberately.

**This task requires explicit human approval before any production step.** Deploys and production DDL are outward-facing and irreversible in effect; do not begin without it.

- [ ] **Step 1: Verify the MIG-13 premise against the real production database**

The plan's §8 supersession rests on "production Chapter 4 rows were deleted". Prove it rather than citing the prose:

```sql
SELECT count(*) FROM scenarios WHERE model_id = 'max-coverage-us';
SELECT count(*) FROM scenarios WHERE model_id = 'chens-cosmetics-cn';
```

Expected: the second is `0`. If the first is non-zero those are post-migration scenarios and are fine — but confirm none carry a legacy `objective: "min_distance"` blob, which CH4-19/CH4-20 would have handled and this plan deliberately does not:

```sql
SELECT id, inputs ->> 'objective' FROM scenarios
WHERE model_id = 'max-coverage-us' AND inputs ->> 'objective' = 'min_distance';
```

Expected: `(0 rows)`. Any hit is a **stop-and-ask**: it means a persisted min-distance payload exists that the CH4-25 guard now forbids, and the rollout must not proceed until that row's handling is decided.

- [ ] **Step 2: Model-scoped duplicate-active preflight**

```sql
SELECT scenario_id, count(*)
FROM solve_jobs
WHERE model_id = 'max-coverage-us'
  AND status IN ('queued', 'running')
GROUP BY scenario_id
HAVING count(*) > 1;
```

Expected: `(0 rows)`. A hit blocks index creation. Do **not** delete jobs to clear it — report and ask.

- [ ] **Step 3: Inspect the Drizzle diff for unrelated drift**

```bash
DATABASE_URL="<production>" pnpm --filter @workspace/db exec drizzle-kit push --config ./drizzle.config.ts --verbose
```

Read the planned statements **before** confirming. The only expected change is `CREATE UNIQUE INDEX ... UQ_solve_jobs_active_per_scenario`. Anything else is pre-existing drift between the schema files and production — stop and report it rather than applying it as a side effect of this bundle.

- [ ] **Step 4: Apply the index before the application release**

The index must exist before code that assumes it. Apply, then verify the installed predicate literally:

```sql
SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_solve_jobs_active_per_scenario';
```

Expected: the definition contains both `model_id = 'max-coverage-us'` and `status = ANY (ARRAY['queued'::..., 'running'::...])` (Postgres normalizes `IN` to `= ANY`). If `model_id` is absent the unscoped version was applied — drop it immediately and re-apply, because it is actively constraining the other five models in production.

- [ ] **Step 5: Deploy API, then Studio**

This bundle changes `artifacts/api-server/**`, so both services deploy. API first: the frontend reads `steps`, which only the new API returns.

Check `list_deploys` first; the `nos-studio` webhook has never fired on its own in this repo, so expect to trigger manually. `nos-api` = `srv-d9hglg6pbkes73a1j8b0`, `nos-studio` = `srv-d9hg4gvlk1mc73dtp67g`.

- [ ] **Step 6: Post-deploy smoke — the full step lifecycle**

Against production, with a throwaway account, drive the real UI:

1. Create a Chapter 4 scenario → header reads `0 of 2 solved`, Solve reads `Solve Step 1`.
2. Solve → `1 of 2`, Step 2 unlocks, floor shows `53,385,024`.
3. **Reload the page** → still `1 of 2`. This is the one check that proves step state is server-derived rather than local UI state.
4. Solve Step 2 → `2 of 2`, comparison renders, `624.33 km` against `635.13 km`.
5. Toggle to Step 1 → outputs show Step 1's numbers, not Step 2's (the R4 adapter).
6. Edit a Step 1 parameter → confirm dialog → Confirm → `0 of 2` **without** pressing Save (the R3 persisted clear).
7. Verify at least one non-root route still loads (the documented SPA-rewrite check).

Delete the throwaway scenario and note the account name in the changelog.

- [ ] **Step 7: Record rollback**

Write `docs/ops/ch4-two-step-rollout.md` with the exact steps taken, the observed `indexdef`, the smoke results, and the rollback procedure:

```sql
DROP INDEX IF EXISTS "UQ_solve_jobs_active_per_scenario";
```

plus the application rollback (redeploy the prior commit on both services). Note that the index drop is safe to run independently of the code rollback — the in-transaction guard keeps working without it.

- [ ] **Step 8: Run `/harness-retro`**

A branch is not finished until `/harness-retro <task_id>` has run: it records the metrics row in `docs/superpowers/metrics/tasks.csv`, logs each gate failure by cause, and fires the second-occurrence gate rule. Never fabricate a metric — an underivable value is the literal string `unknown`.

- [ ] **Step 9: Commit**

```bash
git status --short
git diff --name-only
git add docs/ops/ch4-two-step-rollout.md docs/CHANGELOG-implementation.md docs/superpowers/metrics/tasks.csv
git commit -m "[ch4-2s-10] record the Chapter 4 two-step production rollout"
```

---

## Self-Review

**1. Spec coverage.** Every live decision maps to a task. CH4-1 (chrome unchanged) is honoured by construction — no task touches `SidebarTree`'s structure or `TabBar`. CH4-2/3/4 → Task 7's interception plus Task 5's epoch-scoped projection. CH4-5 (Step 2 data not stored) → enforced by Task 2's freeze, asserted in Task 4's synthesis tests. CH4-6 → Task 1's `.strict()` step2. CH4-7/23/26 → Task 2. CH4-8 → Task 2 leaves `solveInputRevision` semantics intact. CH4-9/10/11 → Task 4. CH4-12/13/14 → Task 5. CH4-15/16/17/18 → Tasks 6–8. CH4-21 → Task 4 Step 9 (already covered by `test_max_coverage.py:277`). CH4-22 → Task 9, with the spec's file list corrected. CH4-24/25 → Task 3. **CH4-19 and CH4-20 are deliberately unimplemented** — superseded by MIG-13, stated at the top of this plan.

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Two places name an existing repo convention instead of repeating code: Task 6 Step 1's `saveMaxCoverageScenarioAndCaptureBody` (defined in prose, following `Workspace.test.tsx`'s existing save-test mocks) and Task 7 Step 7's `OptimizationParametersField` extension. Both are one-line conventions in files the implementer already has open.

**3. Type consistency.** `applyScenarioInputWrite` / `initialInputsForInsert` / `assertNoServerOwnedStepFields` / `nextStepEpoch` / `readStepEpoch` / `synthesizeStep2Inputs` / `deriveTargetStep` / `loadScenarioSteps` are each declared once and used under the same name throughout. `ScenarioSteps` / `ScenarioStepState` / `ScenarioStepSummary` are declared in Task 5's server module, mirrored into `openapi.yaml` in the same task, and consumed from `@workspace/api-client-react` in Tasks 6–8. `MaxCoverageStep = 1 | 2` matches the frontend's `selectedStep: 1 | 2`.

**Open risk to watch at review:** Task 2's PATCH restructure is the largest single change to a route this plan makes, and `routes.test.ts` mocks `db.transaction` as a pass-through — so its 276 tests will keep passing whether or not the transaction is real. Task 2 Step 8's real-Postgres concurrency case is the only thing that actually proves it. Do not accept Task 2 on the mocked suite alone.

---

## Deep Review — Approval Gate (2026-09-28)

**Reviewed revision:** commit `6d0e82d` on `ch4-two-step-workflow-plan`. The reviewed working-tree file and commit blob both hashed to `0165a596556f78836a20c623da6487713bd593ed` before these comments were appended.

**Verdict: REQUEST CHANGES — not ready for implementation approval.** The main architecture is sound: server-owned step state, epoch-based invalidation, state-derived solve targeting, and server-synthesized Step 2 inputs are the right direction. The items below are not optional polish. Each closes an observable correctness, compatibility, or rollout gap. The simplest complete solution is to amend this plan rather than redesign the workflow.

### Approval blockers

#### R1 — Scope the one-active-job rule to Chapter 4

Task 1's partial unique index covers every model:

```ts
uniqueIndex("UQ_solve_jobs_active_per_scenario")
  .on(table.scenarioId)
  .where(sql`${table.status} IN ('queued', 'running')`)
```

Task 4's active-job lookup is likewise executed before the `MAX_COVERAGE_MODEL_ID` conditional. Together these change enqueue behaviour for the other five models, despite this plan promising that they remain unchanged. They also conflict with `scenarioSolveAtomicity.test.ts`, which deliberately enqueues a second non-Chapter-4 job while the first remains active.

**Required correction:**

- Add `model_id = 'max-coverage-us'` to the partial-index predicate.
- Run the active-job guard only for `max-coverage-us`.
- Make the schema test assert the exact model and status predicate, not merely that a `where` clause exists.
- Add a regression proving an existing non-Chapter-4 model retains its current multiple-enqueue semantics.

Do not broaden the rule repo-wide inside this Chapter 4 change. A repo-wide policy would require a separate decision, migration, and compatibility review.

#### R2 — Repair Step 2 staleness detection using the real snapshot shape

`synthesizeStep2Inputs` deliberately removes the nested `step2` bag and persists the effective Step 2 `gap` and `timeLimitSec` at the top level. `loadScenarioSteps`, however, reads `input_snapshot -> 'inputs' -> 'step2'` and compares it with the current nested bag. Consequently, a real Step 2 job with explicit Step 2 settings has no `snapshot_step2`, and will be reported stale immediately.

The proposed read-projection test is a false positive because it manually inserts a `step2` bag that the real synthesis path removes.

**Required correction:**

- Select the snapshot's top-level `gap` and `timeLimitSec`.
- Compare them with the current *effective* Step 2 settings:
  - `inputs.step2?.gap ?? inputs.gap`
  - `inputs.step2?.timeLimitSec ?? inputs.timeLimitSec`
- Build the test's job snapshot through `synthesizeStep2Inputs`; do not hand-author a shape that production never stores.
- Prove default inheritance, custom settings, unchanged settings, and changed-settings staleness.

#### R3 — Make “confirm and clear” a persisted operation

Task 7's confirmation handler invokes only a local draft callback. It does not PATCH the scenario, bump `stepEpoch`, refetch `steps`, or clear anything server-side. Task 9 nevertheless expects the counter to move to `0 of 2 solved` immediately after clicking Confirm, without clicking Save. That e2e cannot pass against the described implementation.

**Required product decision:** choose and document one of these behaviours before approval:

1. **Recommended — literal confirm-and-clear:** confirmation constructs the next inputs, awaits the PATCH, refetches the scenario, and only then closes the dialog. On failure, preserve the old state and show an error.
2. **Manual-save semantics:** confirmation only edits the draft; change the dialog copy to say results clear when saved, and make the e2e click Save before asserting `0 of 2`.

The current plan mixes the first behaviour's language and assertions with the second behaviour's implementation.

#### R4 — Define one canonical selected-step output adapter

Task 8 says the selected step's envelope is fetched, but it does not show how that result replaces the existing `displayedResult`, `displayedInputs`, `hasFreshSolvedRun`, timing, export, and result-history paths. `Workspace.tsx` currently uses those values across the Output Map and every output grid. Merely issuing `useGetScenarioStepResult` does not prevent a selected Step 2 tab from rendering the scenario's latest or historically selected Step 1 result.

**Required correction:** define and use these canonical values at every output call site:

```ts
activeOutputResult
activeOutputInputs
activeOutputReady
```

- For Chapter 4, `activeOutputResult` comes from the selected-step query.
- For Chapter 4, `activeOutputReady` requires the selected step to be solved and its result query to have succeeded.
- For the other models, retain `displayedResult`, `displayedInputs`, and `hasFreshSolvedRun` exactly as today.
- Specify loading and error states for the selected-step request.
- Route Output Map, all grids, exports, summary/comparison, timing, and any result-dependent overlays through the adapter.

The plan must also resolve the interaction between the existing result-history stepper and the new step toggle. **Simplest recommendation:** hide the old history controls for Chapter 4 and make the step toggle the only Chapter 4 result selector. If history remains, define the two-dimensional selection semantics and test them.

#### R5 — Make the Run Optimizer dialog step-correct

Task 6 removes the free objective toggle and floor authoring but keeps coverage-only UI plus the ordinary top-level `gap`, `timeLimitSec`, `p`, and distance-band editors. When the server targets Step 2, that dialog can still expose Step 1 controls and edit top-level limits rather than `step2.gap` and `step2.timeLimitSec`.

**Required correction:** make the Chapter 4 Run Optimizer dialog confirmation-only and keep parameter editing in Optimization Parameters. This is simpler and safer than maintaining two independent step-aware parameter editors. If editable fields remain in the dialog, the plan must specify Step 1 versus Step 2 props, frozen controls, correct nested writes, and tests for both states.

#### R6 — Enforce the Step 2 editability state

Task 7 adds `stepEditable`, but the shown Step 2 inputs never use it. At `0 of 2`, Step 2 is intended to be viewable but not editable.

**Required correction:** apply `disabled={!stepEditable}` to both Step 2 inputs and add tests proving:

- At `0 of 2`, Step 2 is selectable and viewable, but its settings are disabled.
- At `1 of 2`, its settings are enabled.
- Inherited Step 1 parameters and the coverage floor are always read-only.

### Important corrections required for closeout

#### R7 — Replace timing-dependent concurrency tests

A test that fires two solve POSTs and expects exactly `[202, 409]` can race the dispatcher: the first job may finish before the second request acquires the lock, making `[202, 202]` legitimate.

Use deterministic proofs instead:

- Seed a queued/running Chapter 4 job and assert the next POST returns 409 with its job ID.
- Directly prove the database rejects a second active Chapter 4 row.
- Test target-step derivation separately.
- If a true simultaneous-request proof is mandatory, add a test-only transaction/dispatcher barrier rather than relying on CBC timing.

#### R8 — Preserve atomicity for combined name-and-input PATCHes

The proposed PATCH transaction commits `inputs`, then updates `name` in a separate statement. If the name update fails, the client receives a partially applied PATCH.

Move the optional name update into the same transaction as `applyScenarioInputWrite`, and return the final row from that transaction. Add a regression for a combined `{ name, inputs }` request.

#### R9 — Strengthen the direct-writer dependency guard

The source-shape guard is narrowly tied to `routes/scenarios.ts` and a regex. It can miss a future writer in another route or service.

At minimum, inventory all writes below `artifacts/api-server/src` and freeze that inventory in a test. The only allowed forms should be:

- `applyScenarioInputWrite` for updates,
- `initialInputsForInsert` for create/clone,
- the documented atomic `distanceBands` `jsonb_set` exception.

An AST/ESLint rule would be more robust later, but is not required to close this plan if the repo-wide source guard is precise.

#### R10 — Add the production database rollout

Task 1 pushes only to local `nos_dev`. `render.yaml` contains no pre-deploy database push, and the API is Dashboard-managed with auto-deploy disabled. Therefore, deploying the code will not create the production index.

Add an explicit, human-approved rollout task:

1. Verify the target environment has no duplicate active Chapter 4 rows.
2. Inspect the Drizzle diff for unrelated schema drift.
3. Apply the model-scoped index before the application release.
4. Verify the installed predicate through `pg_indexes`.
5. Deploy API, then Studio.
6. Smoke-test the two-step flow.
7. Document rollback: application rollback plus the exact index drop, if needed.

The preflight query must be model-scoped:

```sql
SELECT scenario_id, count(*)
FROM solve_jobs
WHERE model_id = 'max-coverage-us'
  AND status IN ('queued', 'running')
GROUP BY scenario_id
HAVING count(*) > 1;
```

Verify the installed definition with:

```sql
SELECT indexdef
FROM pg_indexes
WHERE indexname = 'UQ_solve_jobs_active_per_scenario';
```

#### R11 — Complete the repository-required closeout

The plan does not include the required `docs/CHANGELOG-implementation.md` update or `/harness-retro`. Add both to the final task. Also correct Task 9's staging instructions: it asks the implementer to fix affected sibling e2e specs but stages only `max-coverage.spec.ts`. Stage an explicit reviewed file list derived from `git diff --name-only`; do not accidentally omit sibling fixes or stage unrelated work.

### Dependency-audit method

Run the following searches before implementation and again before final approval. Record unexpected hits and either route them through the new authority or explain why they are safe.

```bash
# Backend writers and enqueue consumers
rg -n "enqueueScenarioSolve|solveJobsTable" artifacts/api-server/src
rg -n "inputs:|jsonb_set" artifacts/api-server/src/routes artifacts/api-server/src/services

# Frontend result-state and both parameter-editor mounts
rg -n "displayedResult|displayedInputs|hasFreshSolvedRun|resultHistoryState" artifacts/studio/src
rg -n "SolveDialog|OptimizationParametersTab" artifacts/studio/src artifacts/studio/e2e

# Sibling e2e dependencies and removed selectors/copy
rg -n "max-coverage-us|Run Optimizer|chen-objective|coverage-floor" artifacts/studio/e2e
```

Additional dependency checks:

- **Contract:** edit OpenAPI first, regenerate, inspect generated diffs, then typecheck every consumer.
- **Data:** verify the MIG-13 premise directly in the target production database—no legacy Chapter 4 scenarios remain. Do not accept the prose assertion as the only evidence.
- **Commit ancestry:** verify the implementation branch contains the required dataset-migration/deletion evidence commits before removing legacy compatibility.
- **Other models:** run enqueue, PATCH, output, and e2e regressions for at least one representative non-Chapter-4 model, plus the complete gates.
- **Ownership:** prove both the scenario and step-result reads return 404 for a non-owner.
- **Generated code:** ensure only OpenAPI-derived outputs change and no generated file was hand-edited.

### Required deterministic acceptance matrix

Before approval, tests must prove all of the following:

- Two concurrent Step 1 edits commit two distinct consecutive epochs.
- An active Chapter 4 job yields a documented 409 carrying the in-flight job ID.
- The database rejects a second active Chapter 4 job.
- Existing non-Chapter-4 enqueue behaviour is unchanged.
- A real synthesized Step 2 snapshot is fresh immediately after solving.
- Changing only Step 2 settings marks only Step 2 stale without changing the epoch.
- Changing any Step 1 field increments the epoch and clears both steps.
- Changing only `distanceBands` changes neither epoch nor solve validity.
- Confirm-and-clear reaches persisted state before the UI shows `0 of 2`.
- At `0 of 2`, Step 2 is viewable but not editable or solvable.
- Step 1 and Step 2 each populate Output Map, every output grid, export, and comparison from the selected step's result.
- A refresh preserves `0/2`, `1/2`, or `2/2` from server state rather than local UI state.
- Non-owner and cross-model step-result requests return 404.
- Combined name-and-input PATCHes are atomic.

### Final approval gate

After the plan is corrected and implemented, collect evidence from this complete gate:

```bash
git diff --check
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
pnpm e2e:gate
```

Approval additionally requires:

- the production data and index preflight evidence,
- a successful post-deploy `0/2 → 1/2 → 2/2 → clear` smoke test,
- review of every changed and generated file,
- `docs/CHANGELOG-implementation.md` updated in the appropriate implementation commit,
- `/harness-retro` completed,
- no omitted sibling-test changes and no unrelated staged files.

**Approval condition:** resolve R1–R6 in the plan text, incorporate R7–R11 into the implementation and rollout tasks, and make the acceptance matrix deterministic. Once those changes are present, this design should be ready for implementation approval.

---

## Review response — 2026-09-28

**All eleven findings accepted. Every one verified against source before folding; none was accepted on the report alone.** Four were defects I introduced, not presentation problems, and two of those (R2, R3) would have shipped a feature that looked correct and was not.

| Id | Verified how | Landed in |
|---|---|---|
| **R1** | `scenarioSolveAtomicity.test.ts` has **9** `enqueueScenarioSolve(scenario.id…)` call sites and enqueues a second p-median job while the first is still queued. An unscoped index breaks it | Task 1 — predicate carries `model_id`; Task 4 guard gated on the model; schema test asserts the predicate; new non-Chapter-4 regression |
| **R2** | `synthesizeStep2Inputs` destructures `step2` away and writes effective `gap`/`timeLimitSec` at the top level; `loadScenarioSteps` read `-> 'step2'`, which is **always null** on a real Step 2 snapshot | Task 5 — SQL reads top-level settings, comparison is effective-to-effective, and the tests now build their snapshot through `synthesizeStep2Inputs` |
| **R3** | The confirm handler invoked a local callback only; the epoch moves solely on PATCH | Task 7 — `confirmStep1Edit` awaits the PATCH, invalidates, then closes; dialog gains `busy`/`error` and stays open on failure |
| **R4** | 44 references to `displayedResult`/`displayedInputs` in `Workspace.tsx` (`:1688`, `:1703`), plus a 309-line `Workspace.DisplayedInputs.test.tsx` | Task 8 — `activeOutputResult` / `activeOutputInputs` / `activeOutputReady`, loading and error states, history stepper hidden for Chapter 4 |
| **R5** | The dialog still renders the P slider (`:195`), avg-cap (`:247`), bands, and top-level `gap`/`timeLimitSec` | Task 6 — `readOnlyParams` for `max-coverage-us`; confirmation-only |
| **R6** | `stepEditable` appeared in the props list and in no JSX | Task 7 — `disabled={!stepEditable}` on both inputs, with the three state tests |
| **R7** | The first job can finish before the second request takes the lock, so `[202, 202]` is legitimate | Task 4 — seeded-active-job 409, a direct DB-rejection test, and the non-Chapter-4 regression |
| **R8** | The draft committed `inputs`, then updated `name` in a separate statement | Task 2 — one transaction owns both and returns the final row; regression asserts neither applies on rejection |
| **R9** | The guard read one file with one regex | Task 3 — whole-tree walk with a frozen allow-list, plus a non-vacuity check |
| **R10** | `render.yaml` has no pre-deploy hook; its only `push`-adjacent line is an auto-deploy comment | **New Task 10** — premise verification, model-scoped preflight, drift inspection, `pg_indexes` verification, ordered deploy, lifecycle smoke, rollback, `/harness-retro` |
| **R11** | Neither the changelog nor `/harness-retro` appeared anywhere in the plan | Task 9 Steps 8–9 and Task 10 Step 8 |

**R3 deserves naming.** The plan asserted `0 of 2` in an e2e that the described implementation could never satisfy — the dialog's copy promised a persisted clear while the code performed a draft edit. A passing-looking spec paired with prose that contradicts it is worse than either alone, because the spec reads as evidence. Option 1 was chosen: confirmation is a persisted operation, because that is what both the dialog copy and frame 6 describe.

### Additional findings from this pass, not raised in the review

Two are in the same class as R4 — a consumer left reading the old source of truth.

**A1 — `CostSummaryTab.tsx:126` reads `scenario.result`, which CH4-12 forbids for Chapter 4.** `scenarioObjectiveMode()` calls `objectiveModeOfDetails(s?.result?.details)` and uses it to **block comparing two Chapter 4 scenarios solved under different objective modes** (a coverage % and a demand-km total cannot share a column). Under the two-step workflow every scenario at `2 of 2` has `result` holding whichever step solved last — always Step 2 — so the guard compares min_distance against min_distance and becomes vacuous: it will happily place two incomparable columns side by side. Folded into Task 8: source the mode from `steps.*.summary` for `max-coverage-us`, keep the `result` path for the other five. `ObjectiveBar.tsx:40` reads the same way and takes the same treatment.

**A2 — the epoch write silently changes import/apply's documented invariant.** `routes/scenarios.ts:1884-1887` states import/apply "always increments solve_input_revision, DB-side, unconditionally". `applyScenarioInputWrite` makes that bump conditional on the bands-only check. For import/apply the two are equivalent — bands are never imported, so the condition can't fire — but the code will no longer say what the comment says. Task 2 must move that invariant into the routine's own comment rather than leave a now-false claim at the call site.

**A3 — `synthesizeStep2Inputs` is correct but its Step 1 counterpart is worth stating.** A Step 1 snapshot is `validation.data`, which **does** retain `step2` and `stepEpoch`. That is harmless (`pmedian.ts` picks wire fields explicitly, so neither reaches `solve.py`) and it is what makes the Task 5 Step 1 seeding realistic — but the asymmetry between the two snapshot shapes is exactly what produced R2, and it is now stated in Task 5 rather than left to be rediscovered.

### On the acceptance matrix

Adopted, and mapped row by row rather than asserted. **The first version of this response claimed "every row now maps to a named test" without checking — auditing the fourteen rows found three with no test at all and two named but never written.** All five are now closed; the table below is the audit, not a restatement.

| # | Acceptance row | Proved by |
|---|---|---|
| 1 | Two concurrent Step 1 edits → two distinct consecutive epochs | Task 2 Step 7 — `two concurrent Step 1 PATCHes…` |
| 2 | Active Chapter 4 job → 409 with in-flight job id | Task 4 Step 8 — `409s with the in-flight jobId…` |
| 3 | Database rejects a second active Chapter 4 job | Task 4 Step 8 — `the database itself rejects…` |
| 4 | Non-Chapter-4 enqueue unchanged | Task 4 Step 8 — `leaves non-Chapter-4 enqueue semantics untouched` |
| 5 | Real synthesized Step 2 snapshot is fresh | Task 5 — `reports a freshly-synthesized Step 2 job as fresh` |
| 6 | Step 2-only change → only Step 2 stale, epoch unmoved | Task 5 — `flags Step 2 stale only after its effective settings change…` |
| **7** | **Step 1 edit increments the epoch and clears BOTH steps** | **ADDED** — Task 5, `a Step 1 edit clears BOTH steps, not only Step 1`. The prior superseded-epoch test asserted Step 1 only, so it would have passed with Step 2 surviving |
| **8** | **Bands-only change alters neither epoch nor solve validity** | **ADDED** — Task 5, `a distanceBands-only change alters neither the epoch nor either step's validity`. Task 2 proved the epoch half only |
| 9 | Confirm-and-clear reaches persisted state before `0 of 2` | Task 9 e2e Step 3 (post-R3 rewrite) |
| 10 | At `0 of 2` Step 2 is viewable, not editable, not solvable | Task 7 R6 state tests + the `Solve Step 1` label assertion |
| **11** | **Both steps populate map, grids, export, comparison** | **WRITTEN OUT** — Task 8 extends `Workspace.DisplayedInputs.test.tsx` with a Chapter 4 adapter case; previously named only |
| 12 | Refresh preserves `N/2` from server state | Task 10 smoke Step 6.3 — **manual by necessity**: it is precisely the claim that state is server-derived, which no client-side test can prove |
| **13** | **Non-owner AND cross-model step-result → 404** | **ADDED** — Task 5, `404s the step-result endpoint for a non-Chapter-4 scenario, even for its owner`. Only the non-owner half existed |
| **14** | **Combined name-and-inputs PATCH is atomic** | **WRITTEN OUT** — Task 2, both halves, asserting the persisted name on rejection; previously named only |

Row 12 is the honest exception: it is a manual post-deploy check, not an automated one, and the plan says so rather than implying coverage it does not have.

### On the dependency audit and the final gate

Both were supplied as prose and are now **Task 0** and a step inside Task 9. Prose in a review gets read once; a task with checkboxes gets run. Task 0 executes before Task 1 and again before closeout, because a consumer added *during* implementation is exactly what a single up-front audit misses. `git diff --check` now leads the gate command.

**Status: R1–R11 folded. Ready for re-review.**
