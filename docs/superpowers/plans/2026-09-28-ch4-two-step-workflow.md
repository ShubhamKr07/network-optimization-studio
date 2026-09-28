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
describe("CH4-11 — one active solve job per scenario", () => {
  it("declares a partial unique index over queued/running rows", () => {
    // Drizzle exposes table-level builders through the symbol-keyed config.
    // Read the emitted DDL name rather than the builder shape so this test
    // survives a drizzle-orm minor upgrade.
    const config = getTableConfig(solveJobsTable);
    const unique = config.indexes.find((i) => i.config.name === "UQ_solve_jobs_active_per_scenario");
    expect(unique).toBeDefined();
    expect(unique!.config.unique).toBe(true);
    expect(unique!.config.where).toBeDefined();
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
  uniqueIndex("UQ_solve_jobs_active_per_scenario")
    .on(table.scenarioId)
    .where(sql`${table.status} IN ('queued', 'running')`),
```

- [ ] **Step 8: Verify no scenario already holds two active rows, then push the schema**

The index is additive and nullable-free, so hard rule #3's NOT NULL protocol does not apply — but it cannot be created while a violating row pair exists. Check first:

```bash
psql "postgresql://shubhamkr@localhost:5432/nos_dev" -c \
  "SELECT scenario_id, count(*) FROM solve_jobs WHERE status IN ('queued','running') GROUP BY scenario_id HAVING count(*) > 1;"
```

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

**(b) PATCH** — the handler is not transactional today. Replace the whole `if (body.inputs !== undefined) { … }` block (lines 306-345) and the trailing `db.update` (lines 351-354) with a single transaction. The name-only path keeps its existing non-transactional shape:

```ts
  // CH4-26 — an inputs PATCH now runs inside ONE transaction so the locked
  // read, the diff, the epoch decision and the write are atomic. Before this
  // change the handler did a bare SELECT and an unrelated UPDATE, which
  // cannot carry a FOR UPDATE lock across the two.
  if (body.inputs !== undefined) {
    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ modelId: scenariosTable.modelId }).from(scenariosTable)
        .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
      if (!existing) return { kind: "not_found" } as const;
      // ch4-lock — checked BEFORE any write (the guard-placement rule
      // lockedModelGuards.test.ts enforces).
      if (isModelLocked(existing.modelId)) return { kind: "locked" } as const;
      return applyScenarioInputWrite(tx, {
        scenarioId: id,
        userId: req.userId!,
        nextInputs: body.inputs as Record<string, unknown>,
      });
    });

    if (outcome.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
    if (outcome.kind === "locked") { respondLocked(res); return; }
    if (outcome.kind === "invalid") { res.status(422).json({ error: outcome.error }); return; }

    if (body.name !== undefined) {
      await db.update(scenariosTable).set({ name: body.name, updatedAt: new Date() })
        .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
    }

    posthog?.capture({
      distinctId: req.userId!,
      event: "scenario updated",
      properties: {
        scenario_id: outcome.row.id,
        model_id: outcome.row.modelId,
        updated_fields: body.name !== undefined ? ["name", "inputs"] : ["inputs"],
      },
    });

    const [fresh] = await db.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
    res.json(toApiScenario(fresh));
    return;
  }
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
import { readFileSync } from "fs";
import { resolve } from "path";
import { assertNoServerOwnedStepFields } from "../services/scenarioInputWrite.js";

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
  // readFileSync, NOT Function.prototype.toString(): the vitest/esbuild
  // transform strips comments, so a stringified-function assertion silently
  // tests nothing. Same technique lockedModelGuards.test.ts:33,82 uses.
  it("routes/scenarios.ts contains no direct inputs write", () => {
    const src = readFileSync(resolve(__dirname, "../routes/scenarios.ts"), "utf8");
    const directWrites = src.match(/\.set\(\s*\{[^}]*\binputs\s*:/g) ?? [];
    expect(directWrites).toEqual([]);
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
    const [active] = await tx.select({ id: solveJobsTable.id }).from(solveJobsTable)
      .where(and(
        eq(solveJobsTable.scenarioId, scenarioId),
        inArray(solveJobsTable.status, ["queued", "running"]),
      ))
      .limit(1);
    if (active) {
      return { kind: "conflict", jobId: active.id } as const;
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
  it("two simultaneous solves produce exactly one active job; the loser gets 409 with the in-flight jobId", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);

    const [a, b] = await Promise.all([
      request(app).post(`/api/scenarios/${scenario.id}/solve`).set("Cookie", cookie),
      request(app).post(`/api/scenarios/${scenario.id}/solve`).set("Cookie", cookie),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([202, 409]);

    const winner = a.status === 202 ? a : b;
    const loser = a.status === 409 ? a : b;
    expect(loser.body.jobId).toBe(winner.body.jobId);

    const active = await db.select().from(solveJobsTable)
      .where(and(
        eq(solveJobsTable.scenarioId, scenario.id),
        inArray(solveJobsTable.status, ["queued", "running"]),
      ));
    expect(active.length).toBeLessThanOrEqual(1);
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
      j.input_snapshot -> 'inputs' -> 'step2'                               AS snapshot_step2,
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
  const currentStep2 = (inputs.step2 ?? null) as { gap?: number; timeLimitSec?: number } | null;

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
      // Step 2 staleness is a direct comparison of the parameters, field by
      // field so key order cannot manufacture a difference. solve_jobs.
      // inputsHash is NOT used: it mixes in SOLVER_CODE_HASH, so every
      // solve.py deploy would flip every scenario to stale. It is a cache key,
      // not a staleness signal.
      const snapshotStep2 = (raw.snapshot_step2 ?? null) as { gap?: number; timeLimitSec?: number } | null;
      const stale =
        (currentStep2?.gap ?? null) !== (snapshotStep2?.gap ?? null) ||
        (currentStep2?.timeLimitSec ?? null) !== (snapshotStep2?.timeLimitSec ?? null);
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

  it("flags Step 2 stale when its parameters changed since the job that solved it", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await db.insert(solveJobsTable).values({
      scenarioId: scenario.id,
      userId: owner!.userId,
      status: "succeeded",
      inputsHash: "seeded-step2",
      modelId: "max-coverage-us",
      inputSnapshot: {
        modelId: "max-coverage-us",
        inputs: { ...step1Inputs, objective: "min_distance", coverageFloorDemand: 53385024, stepEpoch: 1, step2: { gap: 0, timeLimitSec: 120 } },
      },
      result: {
        status: "optimal", solutionStatus: "optimal", quality: "Proven Optimal", runTimeSec: 2.1,
        metrics: { weightedAvgDistance: 624.33 },
        details: { objective: "min_distance", coveragePct: 68.4192, coveredDemand: 53385024 },
      },
    });

    const fresh = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(fresh.body.steps.step2.solved).toBe(true);
    expect(fresh.body.steps.step2.stale).toBe(false);

    // A step2-only save does NOT bump the epoch, so the job stays selected —
    // it just becomes stale.
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, step2: { gap: 0.05, timeLimitSec: 120 } } }).expect(200);

    const stale = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(stale.body.steps.step2.solved).toBe(true);
    expect(stale.body.steps.step2.stale).toBe(true);
    expect(stale.body.steps.step1.stale).toBe(false);
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

Remove the `solve-dialog-chen-objective-toggle` group (**lines 222-245**) and the entire `{objective === "min_distance" && ( … )}` block containing `solve-dialog-input-coverage-floor` (**lines 276-291**). Keep the `{objective === "coverage" && …}` average-service-cap block at 247. Remove `coverageFloorDemand` from `SolveDialogProps` (line 116) and from the destructuring (line 169), and remove the `onObjectiveModeChange` prop.

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
export function FreezeConfirmDialog({ open, onConfirm, onCancel }: FreezeConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
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
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} data-testid="freeze-confirm-cancel">
            Cancel
          </Button>
          <Button onClick={onConfirm} data-testid="freeze-confirm-accept">
            Edit and clear results
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
  const [pendingStep1Edit, setPendingStep1Edit] = useState<null | (() => void)>(null);

  // CH4-16 — every Step 1 write funnels through here. `distanceBands` is
  // exempt: it is a reporting lens, not a model constraint, and stays editable
  // while Step 1 is frozen (§4.3).
  function guardStep1Edit(apply: () => void, field?: string) {
    if (!stepState.step1Frozen || field === "distanceBands") { apply(); return; }
    setPendingStep1Edit(() => apply);
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
        open={pendingStep1Edit !== null}
        onCancel={() => setPendingStep1Edit(null)}
        onConfirm={() => { pendingStep1Edit?.(); setPendingStep1Edit(null); }}
      />
```

Route `handleOptimizationParamsChange` and the three entity-edit handlers (`updateInputsField` and the warehouse/customer/distance mutators at lines 1861/1898/1931) through `guardStep1Edit`.

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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="input-step2-gap" className="text-xs text-muted-foreground">Gap</Label>
              <Input id="input-step2-gap" type="number" data-testid="input-step2-gap"
                value={step2Gap ?? ""} className="h-8 text-sm mt-1 font-mono"
                onChange={e => onChange("step2Gap", parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <Label htmlFor="input-step2-time-limit" className="text-xs text-muted-foreground">Time limit (s)</Label>
              <Input id="input-step2-time-limit" type="number" data-testid="input-step2-time-limit"
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

In `Workspace.tsx`, pass `keepOutputsClickable={stepState.isMaxCoverage}` and, for Chapter 4, gate `hasSolvedRun` on the *selected* step rather than the scenario-wide flag:

```ts
  const selectedStepSolved = stepState.isMaxCoverage
    ? (selectedStep === 1 ? stepState.steps!.step1.solved : stepState.steps!.step2.solved)
    : hasFreshSolvedRun;
```

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

Output tabs read the selected step's full envelope through `useGetScenarioStepResult(scenarioId, selectedStep, { query: { enabled: stepState.isMaxCoverage && selectedStepSolved } })`, so the toggle refetches and an unsolved step fires no request.

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
pnpm run typecheck \
  && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test \
  && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```

Expected: all four green. `DATABASE_URL` inline is mandatory — without it eight api-server suites fail at *collection* (`lib/db/src/index.ts` throws at import) and look like real failures.

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

- [ ] **Step 8: Commit**

```bash
git add artifacts/studio/e2e/max-coverage.spec.ts
git commit -m "[ch4-2s-9] rewrite the Chapter 4 e2e spec for the two-step workflow"
```

---

## Self-Review

**1. Spec coverage.** Every live decision maps to a task. CH4-1 (chrome unchanged) is honoured by construction — no task touches `SidebarTree`'s structure or `TabBar`. CH4-2/3/4 → Task 7's interception plus Task 5's epoch-scoped projection. CH4-5 (Step 2 data not stored) → enforced by Task 2's freeze, asserted in Task 4's synthesis tests. CH4-6 → Task 1's `.strict()` step2. CH4-7/23/26 → Task 2. CH4-8 → Task 2 leaves `solveInputRevision` semantics intact. CH4-9/10/11 → Task 4. CH4-12/13/14 → Task 5. CH4-15/16/17/18 → Tasks 6–8. CH4-21 → Task 4 Step 9 (already covered by `test_max_coverage.py:277`). CH4-22 → Task 9, with the spec's file list corrected. CH4-24/25 → Task 3. **CH4-19 and CH4-20 are deliberately unimplemented** — superseded by MIG-13, stated at the top of this plan.

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Two places name an existing repo convention instead of repeating code: Task 6 Step 1's `saveMaxCoverageScenarioAndCaptureBody` (defined in prose, following `Workspace.test.tsx`'s existing save-test mocks) and Task 7 Step 7's `OptimizationParametersField` extension. Both are one-line conventions in files the implementer already has open.

**3. Type consistency.** `applyScenarioInputWrite` / `initialInputsForInsert` / `assertNoServerOwnedStepFields` / `nextStepEpoch` / `readStepEpoch` / `synthesizeStep2Inputs` / `deriveTargetStep` / `loadScenarioSteps` are each declared once and used under the same name throughout. `ScenarioSteps` / `ScenarioStepState` / `ScenarioStepSummary` are declared in Task 5's server module, mirrored into `openapi.yaml` in the same task, and consumed from `@workspace/api-client-react` in Tasks 6–8. `MaxCoverageStep = 1 | 2` matches the frontend's `selectedStep: 1 | 2`.

**Open risk to watch at review:** Task 2's PATCH restructure is the largest single change to a route this plan makes, and `routes.test.ts` mocks `db.transaction` as a pass-through — so its 276 tests will keep passing whether or not the transaction is real. Task 2 Step 8's real-Postgres concurrency case is the only thing that actually proves it. Do not accept Task 2 on the mocked suite alone.
