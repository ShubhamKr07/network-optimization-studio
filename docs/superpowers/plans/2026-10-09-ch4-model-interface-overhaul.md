# Chapter 4 Model Interface Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `max-coverage-us`'s two-step solve workflow with a single form and one solve per scenario whose objective is derived from the coverage floor, make the model miles-canonical, and move its coverage metrics onto Solution Summary.

**Architecture:** Three phases, **13 tasks, every one of which leaves the full verification gate green.** No declared-red commits. That is the product of one ordering rule, stated here because the first draft of this plan broke it three times:

> **A change that crosses a layer boundary is ONE task.** Schema, solver, payload builder, test fixtures and frontend defaults all speak one contract. Split a contract change across tasks and every intermediate commit is broken — a solver reading a field the schema has not yet made required raises `KeyError` on a live solve.

Its corollary drives the task order: **consumers are removed before producers.** The frontend stops reading `steps` (Task 2) before the server stops serving it (Task 3) before the contract stops declaring it (Task 4). Each step touches a field nobody downstream still needs.

Spec: `docs/superpowers/specs/2026-10-09-ch4-model-interface-overhaul-design.md`. Every task cites the section it implements.

**Tech Stack:** pnpm monorepo. Express 5 + Drizzle (Postgres, `drizzle-kit push`, no migration files) in `artifacts/api-server`; React + Vite + Radix + wouter + TanStack Query in `artifacts/studio`; Python 3 + PuLP/CBC in `artifacts/api-server/src/solver`; contract-first OpenAPI + Orval codegen in `lib/api-spec` → `lib/api-zod` + `lib/api-client-react`.

## Global Constraints

- **Branch:** all work on `ch4-model-upgrade`. Before every `git commit`:
  `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`
- **One task = one commit.** Message format `[CH4O-N] <imperative summary>`.
- **Never edit generated code.** `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` come from Orval. Change `lib/api-spec/openapi.yaml`, re-run codegen, commit spec + regenerated output in the same commit.
- **`e2e_accuracy.py` is sacred** and has **no Chapter 4 section** (verified: zero `max-coverage` references). Expected count stays **99/99**. Do not modify it.
- **Solver changes enter as data, not branches** — bounds and coefficients, never new `if`/`else` paths.
- **Verification gate.** Run the commands **SEPARATELY, never chained with `&&`** — a chained failure short-circuits and silently skips the rest, which is how the first draft came to claim a suite passed that had never run:
  ```bash
  pnpm run typecheck
  pnpm --filter api-server test
  pnpm --filter studio test
  (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
  ```
- **Local DB:** no `DATABASE_URL` in the environment. Pass inline:
  `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`
- **Known flakes — re-run in isolation before treating as a regression.** Read the current list in `CLAUDE.md`, not a remembered copy. Touched here: `routes`, `resultEnvelope`, `jobRunner`, `importMultiModelRoundTrip`, `crossModelStepContract`, `maxCoverageStepWorkflow`. **`precheck` is NOT on that list** — a `precheck` failure is a real finding.
- **Before trusting a full studio-suite result, require zero concurrent vitest runs:**
  `ps aux | grep "[v]itest" | grep -vc "zsh -c"` must print `0`. Not `grep -c "[v]itest"`, which matches the agent's own wrapper and reports 2 when the answer is 0.
- **No production database writes.** The migration is tested against local Postgres only; production is a separately-approved step in Task 13.
- **Constants, exact values:** `MI = 1.609344`. Longest warehouse→customer pair = **3219 mi** (= 5180.478336 km). `MAX_COVERAGE_CIRCUITY = TRANSPORT_CIRCUITY = 1.17`. `p` max = **26**.
- **New defaults (miles), Task 8:** `highServiceDistMi: 450`, `maxDistMi: 3400`, `avgServiceDistCapMi: 650`, `coverageFloorDemand: 0`, `distanceBands: [450, 900, 1800, 3400]`, `p: 3`. `maxDistMi` must stay above 3219. `highServiceDistMi` must never equal `avgServiceDistCapMi` (`Workspace.test.tsx` guards it).
- **Line numbers here are from the pre-task state of each file.** Earlier tasks shift them — notably Task 2 deletes a 3-line wrapper in `CostSummaryTab.tsx`, shifting every later reference in that file upward. **Locate by symbol name, verify, then edit.** Never edit by line number alone.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `artifacts/api-server/src/migrations/ch4ToMiles.ts` | One-off km→mi migration of persisted `inputs`; exported pure functions so it is unit-testable. In api-server, not `scripts/`, because it must import the model's Zod validator (Task 9) |
| `artifacts/api-server/src/migrations/__tests__/ch4ToMiles.test.ts` | Migration unit + real-Postgres tests |
| `docs/ops/ch4-miles-migration-runbook.md` | Human-gated production staging |

**Deleted files:**

| Path | Task |
|---|---|
| `artifacts/studio/src/components/workspace/StepToggle.tsx` | 2 |
| `artifacts/studio/src/components/workspace/StepComparisonTable.tsx` | 2 |
| `artifacts/studio/src/hooks/useMaxCoverageSteps.ts` | 2 |
| `artifacts/studio/src/__tests__/StepToggle.test.tsx` | 2 |
| `artifacts/studio/src/__tests__/StepComparisonTable.test.tsx` | 2 |
| `artifacts/studio/e2e/ch4-two-step.spec.ts` | 2 |
| `artifacts/api-server/src/services/maxCoverageSteps.ts` | 3 |
| `artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts` | 3 |
| `artifacts/api-server/src/services/__tests__/maxCoverageStepsBatch.test.ts` | 3 |
| `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts` | 3 |
| `artifacts/api-server/src/__tests__/crossModelStepContract.test.ts` | 3 |
| `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts` | 5 (rewritten, not deleted) |

---

# PHASE 1 — Remove the two-step workflow (still kilometres)

Nothing in Phase 1 touches units or field names.

---

## Task 1: Shared objective derivation

**Spec:** §2.3, §4.3.

**Files:**
- Modify: `lib/units/src/objective.ts`, `lib/units/src/index.ts`
- Test: `lib/units/src/__tests__/objective.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `deriveMaxCoverageObjective(coverageFloorDemand: number): "coverage" | "min_distance"`, exported from `@workspace/units`.

Purely additive — nothing consumes it until Task 5. `@workspace/units` is already a dependency of both `artifacts/api-server` (`package.json:21`) and `artifacts/studio` (`package.json:73`), and `objective.ts` already owns this model's objective-mode semantics, so no new package is needed.

- [ ] **Step 1: Write the failing test**

Append to `lib/units/src/__tests__/objective.test.ts`:

```ts
import { deriveMaxCoverageObjective } from "../objective.js";

describe("deriveMaxCoverageObjective", () => {
  it("returns coverage for a zero floor", () => {
    expect(deriveMaxCoverageObjective(0)).toBe("coverage");
  });

  it("returns min_distance for any positive floor", () => {
    expect(deriveMaxCoverageObjective(1)).toBe("min_distance");
    expect(deriveMaxCoverageObjective(53385024)).toBe("min_distance");
  });

  // The derived value must line up with objectiveDimension's own switch, which
  // keys Chapter 4's unit semantics off this same string. Drift here renders a
  // coverage percent as a demand-distance.
  it("produces modes objectiveDimension already understands", () => {
    expect(objectiveDimension("max-coverage-us", deriveMaxCoverageObjective(0))).toBe("percent");
    expect(objectiveDimension("max-coverage-us", deriveMaxCoverageObjective(100))).toBe("demand-distance");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/units test -- objective`
Expected: FAIL — `deriveMaxCoverageObjective is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/units/src/objective.ts`, below `objectiveDimension`:

```ts
/**
 * The ONE rule mapping max-coverage-us's coverage floor to its objective mode.
 * Lives in @workspace/units because both artifacts/api-server (which derives
 * and persists it) and artifacts/studio (which displays which model will run)
 * depend on this package. A UI copy of this rule is how a label and the solve
 * that actually ran came to be able to disagree under the old two-step flow.
 *
 * solve.py derives the same rule independently (it cannot import TypeScript);
 * test_max_coverage.py pins the two against each other.
 */
export function deriveMaxCoverageObjective(coverageFloorDemand: number): "coverage" | "min_distance" {
  return coverageFloorDemand === 0 ? "coverage" : "min_distance";
}
```

Add `deriveMaxCoverageObjective` to `lib/units/src/index.ts`'s existing `./objective.js` export list.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/units test -- objective`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add lib/units/src/objective.ts lib/units/src/index.ts lib/units/src/__tests__/objective.test.ts
git commit -m "[CH4O-1] add the shared max-coverage objective derivation"
```

---

## Task 2: Delete the frontend step machinery

**Spec:** §4.2.

**Consumers before producers.** This runs first, while the server still serves `Scenario.steps` and the contract still declares it. The frontend simply stops reading a field that is still being served — nothing breaks and the gate stays green. The first draft did contract-removal first and had to declare two red commits as a result.

**Files:**
- Delete: `artifacts/studio/src/components/workspace/StepToggle.tsx`, `StepComparisonTable.tsx`, `artifacts/studio/src/hooks/useMaxCoverageSteps.ts`, `artifacts/studio/src/__tests__/StepToggle.test.tsx`, `StepComparisonTable.test.tsx`, `artifacts/studio/e2e/ch4-two-step.spec.ts`
- Modify: `artifacts/studio/src/lib/formatObjective.ts`, `components/ObjectiveBar.tsx`, `pages/Studio.tsx`, `pages/Workspace.tsx`, `components/workspace/tabs/CostSummaryTab.tsx`
- Test: `artifacts/studio/src/__tests__/formatObjective.test.ts`, `Workspace.DisplayedInputs.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `scenarioObjectiveMode(input: { result?: { details?: unknown } | null } | null | undefined): string | null` in `formatObjective.ts`, replacing `scenarioObjectiveModeCh4Aware`.

- [ ] **Step 1: Delete the six files**

```bash
git rm artifacts/studio/src/components/workspace/StepToggle.tsx \
       artifacts/studio/src/components/workspace/StepComparisonTable.tsx \
       artifacts/studio/src/hooks/useMaxCoverageSteps.ts \
       artifacts/studio/src/__tests__/StepToggle.test.tsx \
       artifacts/studio/src/__tests__/StepComparisonTable.test.tsx \
       artifacts/studio/e2e/ch4-two-step.spec.ts
```

- [ ] **Step 2: Collapse the objective-mode helper**

In `formatObjective.ts`, replace `scenarioObjectiveModeCh4Aware` and its whole preceding comment block with:

```ts
// The objective mode a solved scenario ran under, read off its own envelope.
// The `steps`-preferring version this replaces existed because Chapter 4 left
// `result` deliberately stale across a Step 1 edit, so `result.details` could
// report the mode of a solve that no longer counted. With no epoch there is no
// such state: a Chapter 4 result is current, or the scenario is `stale` by the
// ordinary staleness guard like every other model's.
export function scenarioObjectiveMode(
  input: { result?: { details?: unknown } | null } | null | undefined,
): string | null {
  return objectiveModeOfDetails(input?.result?.details);
}
```

Delete the `ScenarioSteps` type import from this file.

- [ ] **Step 3: Clear the three consumers**

`ObjectiveBar.tsx` — delete the `ScenarioSteps` type import, the `steps?: ScenarioSteps | null` prop, its destructure, and change the mode read to `const objectiveMode = scenarioObjectiveMode({ result });`.

`Studio.tsx` — delete the `steps={currentScenario?.steps ?? null}` prop from the `<ObjectiveBar>` call. (Studio is the legacy pre-SCN-v0.3 page, unreachable from any chapter route since every `chapters.ts` entry carries `workspace: true`, but it still compiles and still has tests.)

`CostSummaryTab.tsx` — delete the 3-line local `scenarioObjectiveMode` wrapper and import `scenarioObjectiveMode` directly from `@/lib/formatObjective`. **This deletion shifts every later line reference in this file upward by 3** — which is why Tasks 10 and 11 cite symbols, not lines.

- [ ] **Step 4: Clear Workspace.tsx**

Locate each by symbol and delete:

- imports: `useGetScenarioStepResult`, `getGetScenarioStepResultQueryKey`, `useMaxCoverageSteps`, `StepToggle`, `StepComparisonTable`
- `step2FromInputs`, `step2GapFromInputs`, `step2TimeLimitSecFromInputs`
- `const stepState = useMaxCoverageSteps(...)`, `const [selectedStep, setSelectedStep] = useState<1 | 2>(1)`, and the snap-to-target effect
- `pendingStep1Inputs` state, `guardStep1Edit`, `confirmStep1Edit`, and the confirm dialog JSX
- all **17** `guardStep1Edit(...)` call sites — each becomes the direct `setLocalInputs(next)` / mutation it wrapped. Enumerate with `grep -n "guardStep1Edit" artifacts/studio/src/pages/Workspace.tsx`
- `selectedStepSolved`, the `useGetScenarioStepResult` query, and the `stepState.isMaxCoverage ? ... : ...` ternaries in `activeOutputResult` / `activeOutputInputs` / `activeOutputReady` — each collapses to its existing non-Ch4 branch
- `updateStep2Field` and its two `handleOptimizationParamsChange` dispatch branches
- the Step 2 prop assembly and the `step:` props on both `OptimizationParametersTab` mounts
- every remaining `stepState.*` condition, each collapsing to its non-Ch4 branch. Specifically: the solve-button label becomes the literal `"Run Optimizer"`; `timing=` passes `displayedTiming` unconditionally; the result-history stepper drops its `!stepState.isMaxCoverage &&` prefix so Chapter 4 regains it; `keepOutputsClickable` loses its Ch4 arm
- the `<StepComparisonTable>` render, keeping the `costSummary` return it wrapped

- [ ] **Step 5: Update the two affected test files**

`formatObjective.test.ts` — delete the `steps`-present cases, rename the remaining `scenarioObjectiveModeCh4Aware` references.
`Workspace.DisplayedInputs.test.tsx` — delete the step-related cases.

- [ ] **Step 6: Run the gate**

```bash
ps aux | grep "[v]itest" | grep -vc "zsh -c"   # must print 0
pnpm run typecheck
pnpm --filter studio test
pnpm --filter api-server test
```
Expected: all PASS. The server still serves `steps`; nothing reads it.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A artifacts/studio
git commit -m "[CH4O-2] delete the frontend two-step machinery"
```

---

## Task 3: Delete the server step machinery, keeping the create/clone hook

**Spec:** §3.1, §3.3.

Runs before the contract change so that removing `Scenario.steps` later touches a field nobody produces. `steps` is **not** in `Scenario`'s `required` list (verified in `openapi.yaml`), so a response that stops including it still validates against the unchanged contract — that is what keeps this task green.

**Files:**
- Delete: `artifacts/api-server/src/services/maxCoverageSteps.ts`, `services/__tests__/maxCoverageSteps.test.ts`, `services/__tests__/maxCoverageStepsBatch.test.ts`, `solver/__tests__/maxCoverageStepWorkflow.test.ts`, `__tests__/crossModelStepContract.test.ts`
- Modify: `artifacts/api-server/src/services/scenarioInputWrite.ts`, `routes/scenarios.ts`, `solver/jobRunner.ts`
- Modify: `model-integration-precheck.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `deriveServerOwnedInputs(modelId: string, inputs: Record<string, unknown>): Record<string, unknown>` and `MAX_COVERAGE_MODEL_ID`, both exported from `services/scenarioInputWrite.ts`.

**`jobRunner`'s enqueue has TWO `modelId === MAX_COVERAGE_MODEL_ID` blocks. Delete
only the Step-1→Step-2 synthesis one; KEEP the other.** Corrected after Task 3
asked — an earlier draft of this line said "no per-model branch", which read as
"delete both" and is wrong.

The survivor is the CH4-11 "refuse a second active solve job" check, and it is
backed by a DB-level partial unique index
(`UQ_solve_jobs_active_per_scenario`, `lib/db/src/schema/solve_jobs.ts:151-153`,
predicate `model_id = 'max-coverage-us' AND status IN ('queued','running')`).
Removing the app-level check while that index stands converts a graceful 409 into
an unhandled DB error. Removing the index too is a **schema migration** — a
separate, human-approved decision, and the schema's own comment already says a
repo-wide policy "is a separate decision with its own migration and compatibility
review". This plan does not touch it.

Standing consequence, recorded so it is not mistaken for an oversight later:
Chapter 4 keeps a single-active-solve-job restriction that no other model has.
That restriction predates this overhaul and survives it.

- [ ] **Step 1: Move the create/clone hook out BEFORE deleting its file**

`initialInputsForInsert` is defined in `maxCoverageSteps.ts` but §2.3 keeps it as the create/clone derivation hook. Move it into `scenarioInputWrite.ts` (above `applyScenarioInputWrite`), renamed, along with `MAX_COVERAGE_MODEL_ID`:

```ts
export const MAX_COVERAGE_MODEL_ID = "max-coverage-us";

// The create/clone half of the write contract. `applyScenarioInputWrite` below
// is the UPDATE half; both must derive the same server-owned fields, or a field
// exists on updated rows and not on created ones. Task 5 completes the real
// derivation -- this move is behaviour-preserving (it still writes stepEpoch: 1,
// exactly as initialInputsForInsert did).
export function deriveServerOwnedInputs(
  modelId: string,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return inputs;
  return { ...inputs, stepEpoch: 1 };
}
```

In `routes/scenarios.ts`, repoint the import and both call sites (insert, clone) from `initialInputsForInsert` to `deriveServerOwnedInputs`.

- [ ] **Step 2: Delete the five files**

```bash
git rm artifacts/api-server/src/services/maxCoverageSteps.ts \
       artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts \
       artifacts/api-server/src/services/__tests__/maxCoverageStepsBatch.test.ts \
       artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts \
       artifacts/api-server/src/__tests__/crossModelStepContract.test.ts
```

- [ ] **Step 3: Clear the route references**

In `routes/scenarios.ts`: delete the `maxCoverageSteps.js` import; delete the `ch4Rows` filter, the `loadScenarioStepsBatch` call and the `steps` merge on the list route; delete the `loadScenarioSteps` call and `steps` merge on the single-scenario read; delete the whole `router.get("/scenarios/:scenarioId/steps/:step/result", ...)` handler.

Keep the `MAX_COVERAGE_DATASET` import and the distance-stub path — unrelated to steps.

- [ ] **Step 4: Clear the jobRunner branch**

Delete the `maxCoverageSteps.js` import block and the entire `if (scenario.modelId === MAX_COVERAGE_MODEL_ID) { ... }` block inside the enqueue transaction, leaving:

```ts
    // The validated inputs ARE the solve inputs, for every model. The
    // max-coverage Step 2 synthesis that used to sit here is gone with the
    // two-step workflow.
    const solveInputs: Record<string, unknown> = validation.data as Record<string, unknown>;

    const input = { modelId: scenario.modelId, inputs: solveInputs } as SolveInput;
```

Check whether `desc` and `solveJobsTable` are still used elsewhere in the file before removing those imports.

- [ ] **Step 5: Stop writing `stepEpoch` on the update path**

In `scenarioInputWrite.ts`, delete the `nextStepEpoch` import and the `export { isStep1Key } from "./maxCoverageSteps.js";` line. Replace the `stepEpoch` computation with the moved hook:

```ts
  const inputsToStore: Record<string, unknown> = deriveServerOwnedInputs(persisted.modelId, normalized);
```

`changed.delete("stepEpoch")` stays for now — the schema still declares `stepEpoch` with a default until Task 5, so a row that never receives one simply takes the default. Then verify nothing references the deleted exports:

```bash
grep -rn "isStep1Key\|nextStepEpoch\|readStepEpoch\|synthesizeStep2Inputs\|deriveTargetStep\|loadScenarioSteps" artifacts/api-server/src || echo "CLEAN"
```
Expected: `CLEAN`.

- [ ] **Step 6: Update the two docs this task invalidates**

`model-integration-precheck.md` — strike point 18 (`crossModelStepContract.test.ts`'s `NON_STEP_MODELS`), renumber point 19 → 18, change Gate 1's opening from "nineteen" to "eighteen", and fix the `[BLOCKER]` line naming the deleted file.

`CLAUDE.md` — remove `maxCoverageStepWorkflow` and `crossModelStepContract` from the known-flake list; fix the index row from "the 10 registration points" to "the 18 registration points".

- [ ] **Step 7: Run the gate**

```bash
pnpm run typecheck
pnpm --filter api-server test
pnpm --filter studio test
```
Expected: all PASS. The contract still declares `steps`; nothing populates it, and it is optional.

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A artifacts/api-server/src model-integration-precheck.md CLAUDE.md
git commit -m "[CH4O-3] delete the server-side two-step machinery"
```

---

## Task 4: Remove the step surfaces from the API contract

**Spec:** §3.2.

By now nothing consumes `steps` (Task 2) and nothing produces it (Task 3), so this removes a dead optional field and regenerates. Green.

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerate: `lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`
- Modify (11 test files carrying inert mocks — added after Task 2's review):
  `artifacts/studio/src/__tests__/deliveryEditableInputs.test.tsx`, and
  `Workspace.{Analytics,Brazil,InputMapV2,Jade,OutputMap,StaleOutputs,TabCoverage,Transport,TransportCoal,TwoEchelon}.test.tsx`

**Interfaces:**
- Consumes: Tasks 2 and 3 having removed every consumer and producer.
- Produces: a generated client with no `ScenarioSteps`, `ScenarioStepState`, `ScenarioStepSummary` or `getScenarioStepResult`.

**Eleven test files mock exports this task deletes, and `vi.mock` will NOT fail on
them.** Found during Task 2's review. Each carries a `vi.mock` factory stub for
`useGetScenarioStepResult` / `getGetScenarioStepResultQueryKey`. A factory with
extra keys does not error, so after this task they silently become mocks of
non-existent exports — inert, but permanently misleading. Strip those two keys
from each factory as part of this task rather than leaving them to a later sweep:

```bash
grep -rln "useGetScenarioStepResult\|getGetScenarioStepResultQueryKey" artifacts/studio/src
```

- [ ] **Step 1: Edit the spec**

Delete from `lib/api-spec/openapi.yaml`:
- the whole `/scenarios/{scenarioId}/steps/{step}/result` path item
- `Scenario`'s `steps` property and its description (it is not in `required`, so no `required` edit is needed)
- the `ScenarioStepSummary`, `ScenarioStepState` and `ScenarioSteps` schemas

- [ ] **Step 2: Regenerate**

```bash
pnpm --filter @workspace/api-spec run codegen
```

- [ ] **Step 3: Verify the symbols are gone**

```bash
grep -rn "ScenarioSteps\|getScenarioStepResult" lib/api-zod/src/generated lib/api-client-react/src/generated || echo "CLEAN"
```
Expected: `CLEAN`.

- [ ] **Step 4: Run the gate**

```bash
pnpm run typecheck
pnpm --filter api-server test
pnpm --filter studio test
```
Expected: all PASS. If typecheck names any file still importing `ScenarioSteps`, Task 2 missed a consumer — fix it here rather than leaving the commit red.

- [ ] **Step 5: Commit (spec + generated together)**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "[CH4O-4] remove the per-step result surfaces from the API contract"
```

---

## Task 5: ATOMIC — make the floor and cap unconditional, derive the objective

**Spec:** §2.2, §2.3, §2.4 (the solver half).

**One task because it is one contract change.** The schema, the solver, the payload builder, ~12 test fixtures and the frontend defaults all speak the same shape. Splitting them — as the first draft did — means `solve.py` reads `inp["coverageFloorDemand"]` while the schema still has it optional and `Workspace.tsx` still omits it, so an ordinary coverage solve raises `KeyError` at that commit.

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/maxCoverage.ts`
- Modify: `artifacts/api-server/src/services/scenarioInputWrite.ts`
- Modify: `artifacts/api-server/src/solver/solve.py` (`solve_max_coverage`)
- Modify: `artifacts/api-server/src/solver/pmedian.ts` (payload builder)
- Modify: `artifacts/api-server/src/services/precheck.ts` (drop the floor rule's mode guard)
- Modify: `solvers/max-coverage-us/manifest.json` (`inputsSchema` only — units stay km)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (`defaultInputsForModel`)
- Modify (fixtures): `artifacts/api-server/src/__tests__/{autoDistance,importMultiModelRoundTrip,jobRunner,maxCoverageContract,pmedian,precheck,resultEnvelope,routes,templates}.test.ts`, `registry/__tests__/registration.test.ts`
- Test: `validation/inputs/__tests__/maxCoverage.test.ts` (rewrite), `__tests__/maxCoverageWriteGuard.test.ts` (rewrite), `solver/tests/test_max_coverage.py`

**Interfaces:**
- Consumes: `deriveMaxCoverageObjective` (Task 1), `deriveServerOwnedInputs` + `MAX_COVERAGE_MODEL_ID` (Task 3).
- Produces: `maxCoverageInputsSchema` with `avgServiceDistCapKm` and `coverageFloorDemand` both unconditionally required and `objective` optional; `assertNoServerOwnedFields(modelId: string, rawInputs: unknown): string | null`.

Ordering within the write path is fixed: **validate → derive → persist.** The derivation reads `coverageFloorDemand`, and only validation guarantees it is an integer.

- [ ] **Step 1: Find every fixture that will break**

```bash
grep -rln 'objective: "coverage"\|objective: "min_distance"' artifacts/api-server/src --include="*.ts" | sort
```
Expected: ~12 files (the 5 deleted in Task 3 are already gone). Each either sends `objective` (now refused) or omits `coverageFloorDemand`/`avgServiceDistCapKm` (now required). All must be updated in this task — this is why it is one task.

- [ ] **Step 2: Write the failing tests**

Rewrite the objective-discrimination block in `validation/inputs/__tests__/maxCoverage.test.ts`. The existing tests assert the **inverse** of the new rule, so they are replaced, not renamed:

```ts
describe("maxCoverageInputsSchema — both mode fields unconditionally required", () => {
  it("rejects a payload missing avgServiceDistCapKm, even with a zero floor", () => {
    const r = maxCoverageInputsSchema.safeParse({ ...valid, avgServiceDistCapKm: undefined, coverageFloorDemand: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects a payload missing coverageFloorDemand", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...valid, coverageFloorDemand: undefined }).success).toBe(false);
  });

  it("accepts a zero floor with a cap (Model 1)", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...valid, coverageFloorDemand: 0 }).success).toBe(true);
  });

  it("accepts a positive floor with a cap (Model 2)", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...valid, coverageFloorDemand: 53385024 }).success).toBe(true);
  });

  it("keeps the high < max invariant", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...valid, highServiceDistKm: 5500, maxDistKm: 700 }).success).toBe(false);
  });

  it("no longer carries stepEpoch or step2", () => {
    const r = maxCoverageInputsSchema.parse({ ...valid, stepEpoch: 7, step2: { gap: 1, timeLimitSec: 9 } });
    expect(r).not.toHaveProperty("stepEpoch");
    expect(r).not.toHaveProperty("step2");
  });
});
```

Rewrite `__tests__/maxCoverageWriteGuard.test.ts`:

```ts
describe("assertNoServerOwnedFields — the guard inverts", () => {
  it("ACCEPTS a client-supplied coverageFloorDemand (now user-authored)", () => {
    expect(assertNoServerOwnedFields("max-coverage-us", { coverageFloorDemand: 1000 })).toBeNull();
  });

  it("REFUSES a client-supplied objective", () => {
    expect(assertNoServerOwnedFields("max-coverage-us", { objective: "coverage" })).toMatch(/objective/);
    expect(assertNoServerOwnedFields("max-coverage-us", { objective: "min_distance" })).toMatch(/objective/);
  });

  it("refuses objective when present even as null — `in`, not truthiness", () => {
    expect(assertNoServerOwnedFields("max-coverage-us", { objective: null })).toMatch(/objective/);
  });

  it("ignores every other model", () => {
    expect(assertNoServerOwnedFields("p-median-us", { objective: "coverage" })).toBeNull();
  });
});

// These go in `__tests__/routes.test.ts`, NOT the write-guard file — they need a
// real HTTP round trip. There are no `createScenario`/`cloneScenario`/
// `patchScenarioInputs` helpers in this repo; routes.test.ts drives supertest
// directly with a session cookie (see its existing `loginAs` helper, and call
// `resetLoginRateLimiterForTests()` in `beforeEach` — the limiter is 10/min/IP
// and never resets within a process).
describe("the derived objective reaches all three write paths", () => {
  it("persists a derived objective on CREATE without the client sending one", async () => {
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "ch4 coverage", modelId: "max-coverage-us", inputs: { ...validCh4Inputs, coverageFloorDemand: 0 } });
    expect(res.status).toBe(201);
    expect(res.body.inputs.objective).toBe("coverage");
  });

  it("persists a derived objective on CREATE for a positive floor", async () => {
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "ch4 mindist", modelId: "max-coverage-us", inputs: { ...validCh4Inputs, coverageFloorDemand: 500 } });
    expect(res.status).toBe(201);
    expect(res.body.inputs.objective).toBe("min_distance");
  });

  it("persists a derived objective on CLONE", async () => {
    const src = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "src", modelId: "max-coverage-us", inputs: { ...validCh4Inputs, coverageFloorDemand: 500 } });
    const clone = await request(app).post(`/api/scenarios/${src.body.id}/clone`).set("Cookie", cookie).send({});
    expect(clone.body.inputs.objective).toBe("min_distance");
  });

  it("re-derives on UPDATE when the floor changes", async () => {
    const src = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "upd", modelId: "max-coverage-us", inputs: { ...validCh4Inputs, coverageFloorDemand: 0 } });
    const updated = await request(app).patch(`/api/scenarios/${src.body.id}`).set("Cookie", cookie)
      .send({ inputs: { ...validCh4Inputs, coverageFloorDemand: 500 } });
    expect(updated.body.inputs.objective).toBe("min_distance");
  });
});
```

In `test_max_coverage.py`, change `BASE` and add two classes:

```python
BASE = {"modelType": "max_coverage_us", "p": 3, "highServiceDistKm": 700, "maxDistKm": 5500,
        "avgServiceDistCapKm": 1000, "coverageFloorDemand": 0,
        "gap": 0.0, "timeLimitSec": 60, "warehouseOverrides": [], "customerOverrides": [],
        "addedWarehouses": [], "addedCustomers": [], "distanceOverrides": []}
```

```python
class TestCapBindsInBothModes:
    """The average-distance cap is a constraint in min_distance mode too.

    A loose cap must leave the known min-distance optimum untouched -- its own
    weighted average is 624.33 km, so a 1000 km cap cannot bind. That is the
    sanity check distinguishing a real modelling error from an expected change.
    """

    def test_loose_cap_leaves_min_distance_optimum_unchanged(self):
        r = run({**BASE, "coverageFloorDemand": 53385024, "avgServiceDistCapKm": 1000})
        assert r["status"] == "optimal"
        assert r["metrics"]["weightedAvgDistance"] == pytest.approx(624.33, abs=0.05)
        assert set(r["details"]["openWarehouseIds"]) == {"DAL", "LA", "PIT"}

    def test_tight_cap_changes_the_min_distance_solution(self):
        loose = run({**BASE, "coverageFloorDemand": 53385024, "avgServiceDistCapKm": 1000})
        tight_cap = loose["metrics"]["weightedAvgDistance"] - 20
        r = run({**BASE, "coverageFloorDemand": 53385024, "avgServiceDistCapKm": tight_cap})
        if r["status"] == "optimal":
            assert r["metrics"]["weightedAvgDistance"] <= tight_cap + 0.01
        else:
            assert r["status"] == "infeasible"

    def test_cap_below_any_feasible_average_is_infeasible(self):
        r = run({**BASE, "coverageFloorDemand": 53385024, "avgServiceDistCapKm": 1.0})
        assert r["status"] == "infeasible"


class TestModeDerivedFromFloor:
    """`details.objective` reports what RAN, derived from the floor locally --
    never forwarded from inp["objective"]. If the echo forwarded the input while
    the math branched on the floor, a mismatch would label the envelope one model
    and compute the other, invisibly."""

    def test_zero_floor_runs_coverage(self):
        r = run({**BASE, "coverageFloorDemand": 0, "objective": "min_distance"})
        assert r["details"]["objective"] == "coverage"

    def test_positive_floor_runs_min_distance(self):
        r = run({**BASE, "coverageFloorDemand": 53385024, "objective": "coverage"})
        assert r["details"]["objective"] == "min_distance"
```

Delete every `"objective": ...` key from the other `run({**BASE, ...})` calls in that file, and add an explicit `coverageFloorDemand` wherever a test means min-distance.

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter api-server test -- maxCoverage
(cd artifacts/api-server/src/solver && python3 -m pytest tests/test_max_coverage.py -x -k "CapBinds or ModeDerived" -v)
```
Expected: FAIL on both — schema still discriminates on `objective`, guard still refuses the floor, solver still ignores the cap in min-distance mode.

- [ ] **Step 4: Rewrite the schema**

In `validation/inputs/maxCoverage.ts`: delete `step2ParamsSchema` entirely; in the main object:

```ts
    objective: z.enum(["coverage", "min_distance"]).optional(),
    p: z.number().int().min(1).max(26),
    highServiceDistKm: z.number().positive(),
    maxDistKm: z.number().positive(),
    // Both unconditionally required now: the cap binds in BOTH objectives
    // (§2.4), and the floor is the mode discriminator (§2.3), so neither can be
    // absent. The two objective-discriminated superRefine branches are gone.
    avgServiceDistCapKm: z.number().positive(),
    coverageFloorDemand: z.number().int().nonnegative(),
```

Delete `stepEpoch` and `step2` from the object, and delete both objective-discriminated branches from `.superRefine`, keeping only the `highServiceDistKm >= maxDistKm` check. Leave the `.transform` and the `distanceOverrides` refinement untouched.

- [ ] **Step 5: Wire the derivation and invert the guard**

In `scenarioInputWrite.ts`, add `import { deriveMaxCoverageObjective } from "@workspace/units";` and complete the hook:

```ts
export function deriveServerOwnedInputs(
  modelId: string,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return inputs;
  const floor = inputs.coverageFloorDemand;
  if (typeof floor !== "number") return inputs; // validation already guaranteed this; defensive only
  return { ...inputs, objective: deriveMaxCoverageObjective(floor) };
}
```

Change `changed.delete("stepEpoch")` to `changed.delete("objective")`:

```ts
  // `objective` is derived from coverageFloorDemand, so it can never change
  // alone -- but leaving it in would misclassify a bands-only save as geometric
  // on the first write after the migration, which is where it first appears.
  changed.delete("objective");
```

Rewrite and rename the guard:

```ts
/**
 * The write-route narrowing guard, INVERTED from its two-step form.
 *
 * Under the old workflow `coverageFloorDemand` was server-produced and
 * un-typeable. It is now exactly what the student types, and `objective` is the
 * only server-owned field. Still reads the RAW body before Zod runs: these
 * validators are non-strict, so an unknown key is STRIPPED rather than refused,
 * and silently discarding a client-sent `objective` would report success while
 * ignoring it.
 */
export function assertNoServerOwnedFields(modelId: string, rawInputs: unknown): string | null {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return null;
  if (rawInputs === null || typeof rawInputs !== "object") return null;
  // `in`, not truthiness: refused when PRESENT, even as null or undefined.
  if ("objective" in (rawInputs as Record<string, unknown>)) {
    return "objective is derived from coverageFloorDemand and cannot be set directly";
  }
  return null;
}
```

Rename every `assertNoServerOwnedStepFields` call site to `assertNoServerOwnedFields`.

- [ ] **Step 6: Change the solver**

In `solve.py`'s `solve_max_coverage`, replace the mode read and the objective branch so the cap hoists out:

```python
    # The objective is DERIVED from the coverage floor, never read from
    # inp["objective"] -- and details.objective echoes this locally-derived
    # value. Forwarding the input while branching on the floor would let the
    # envelope be labelled one model and computed as the other.
    mode = "coverage" if inp["coverageFloorDemand"] == 0 else "min_distance"
    prob = LpProblem("max_coverage", LpMaximize if mode == "coverage" else LpMinimize)
    a = LpVariable.dicts("A", [(w, c) for w in cand for c in custs], 0, 1, LpInteger)
    o = LpVariable.dicts("O", cand, 0, 1, LpInteger)
    # The average-service-distance cap applies in BOTH modes. Hoisting it out of
    # the branch below is the whole change: one constraint, no new code path
    # (hard rule 6).
    prob += lpSum(adj[w, c] * dem[c] * a[w, c] for w in cand for c in custs) <= inp["avgServiceDistCapKm"] * total
    if mode == "coverage":
        prob += lpSum(hsp[w, c] * dem[c] * a[w, c] for w in cand for c in custs)
    else:
        prob += lpSum(adj[w, c] * dem[c] * a[w, c] for w in cand for c in custs)
        prob += lpSum(hsp[w, c] * dem[c] * a[w, c] for w in cand for c in custs) >= inp["coverageFloorDemand"]
```

Confirm the `details` dict's `"objective": mode` reads the local `mode`, not `inp["objective"]`. Update the infeasible message to name both candidates:

```python
                         "No feasible assignment under the constraints — the coverage "
                         "floor and the average-distance cap are both candidates",
```

In `pmedian.ts`'s payload builder, `avgServiceDistCapKm` and `coverageFloorDemand` are no longer optional — they are always present on validated inputs, so the builder passes them unconditionally.

- [ ] **Step 7: Drop the precheck floor rule's mode guard**

In `precheck.ts`:

```ts
  // No `objective` guard: a non-zero floor IS min-distance mode (§2.3), and
  // `objective` is server-derived FROM this value, so gating on it would make
  // the rule depend on its own output.
  if (inputs.coverageFloorDemand != null && inputs.coverageFloorDemand > 0) {
```

(The new cap bound is Task 6 — it needs a contract change this task does not carry.)

- [ ] **Step 8: Update the manifest, the frontend defaults, and every fixture**

`solvers/max-coverage-us/manifest.json` — delete `stepEpoch`/`step2` from `inputsSchema`, move `avgServiceDistCapKm` and `coverageFloorDemand` into `required`, remove `objective` from `required`. Units stay `km`.

`Workspace.tsx`'s `defaultInputsForModel` → `case "max-coverage-us"`: **delete `objective: "coverage"`** and add `coverageFloorDemand: 0`. The deletion is not cosmetic — Step 5's guard now *refuses* a client-sent `objective`, so leaving it makes every new Chapter 4 scenario 422. Also add `coverageFloorDemand: coverageFloorDemandFromInputs(localInputs)` to the base props object, following the existing `gapFromInputs` reader pattern.

Then every fixture from Step 1: remove `objective`, add `coverageFloorDemand` (0 for coverage cases, the real floor for min-distance ones), add `avgServiceDistCapKm` where absent.

- [ ] **Step 9: Run the gate**

```bash
pnpm run typecheck
pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/test_max_coverage.py -v)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```
Expected: all PASS; `e2e_accuracy.py` `99/99`. Re-run any failure in isolation first — `routes`, `jobRunner`, `resultEnvelope` and `importMultiModelRoundTrip` are known load flakes.

- [ ] **Step 10: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A
git commit -m "[CH4O-5] require the floor and cap unconditionally, derive the objective"
```

---

## Task 6: The cap infeasibility bound — including its contract

**Spec:** §2.4 (attribution lives entirely in precheck).

**Files:**
- Modify: `artifacts/api-server/src/services/precheck.ts`
- Modify: `lib/api-spec/openapi.yaml` (`PrecheckError.code` enum)
- Regenerate: `lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`
- Test: `artifacts/api-server/src/__tests__/precheck.test.ts`, `__tests__/maxCoverageContract.test.ts`

**Interfaces:**
- Consumes: Task 5's unconditional `avgServiceDistCapKm`.
- Produces: `PrecheckErrorCode` gains `"avg_distance_cap_infeasible"`, in the TS union, the OpenAPI enum and the generated client.

**A new error code is a contract change in three places, not one.** `PrecheckErrorCode` is a **closed** union of 9 members (`precheck.ts`), `openapi.yaml`'s `PrecheckError.code` is a matching closed enum, and `maxCoverageContract.test.ts` asserts the exact list. An `errors.push({ code: "avg_distance_cap_infeasible" })` without all three does not typecheck — and if cast around, the generated Zod rejects the server's own response.

Both bounds live in precheck, not split with `solve.py`: `jobRunner` returns `precheck_failed` **before** Python is spawned, so a cap check inside `solve.py` could never run when the floor bound fires. `runNetworkEditsPrecheckForModel` returns an error **list**, so both causes report together with no precedence rule to invent.

**The cap bound is NECESSARILY LOOSE in min-distance mode, and must not be
"tightened".** Surfaced by Task 5's review; recorded here so it is not mistaken for
an incomplete implementation.

In min-distance mode the cap constrains the *same expression* the objective
minimises — `sum(adj·dem·a) <= cap·total` against `minimize sum(adj·dem·a)`. Two
consequences:

1. A tight cap can only ever make the problem **infeasible**. It can never reshape
   the optimum, since any solution satisfying it is already at least as good under
   the objective. "The cap changed the answer" is not a reachable outcome in that
   mode — only "the cap made it unsolvable".
2. The exact necessary-and-sufficient bound would be "cap × total ≥ the
   unconstrained minimum total weighted distance", which requires **solving the
   p-median**. A precheck may not do that.

So the nearest-active-warehouse relaxation specified above is valid but
deliberately weak: it catches a cap below the relaxation and does NOT catch a cap
sitting between that relaxation and the true optimum. Those fall through to
`solve.py`'s generic infeasible message — which is exactly why that message names
both the floor and the cap as candidates rather than guessing. **Do not attempt a
tighter bound; there is no cheap one.** Coverage mode is unaffected: there the cap
genuinely does reshape the solution, because the objective maximises a different
expression.

- [ ] **Step 1: Write the failing tests**

Append to `precheck.test.ts`. The existing Chapter 4 fixtures in that file are
`MAX_COVERAGE_BASE_COVERAGE` and `MAX_COVERAGE_BASE_MIN_DISTANCE` (with
`MAX_COVERAGE_DATASET_FAKE` as the dataset) — there is no `baseMaxCoverageInputs`:

```ts
describe("max-coverage-us — infeasibility attribution", () => {
  it("names the cap when it is below the nearest-warehouse lower bound", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...MAX_COVERAGE_BASE_COVERAGE, coverageFloorDemand: 0, avgServiceDistCapKm: 1,
    });
    expect(res.ok).toBe(false);
    expect(res.errors.map(e => e.code)).toContain("avg_distance_cap_infeasible");
  });

  it("names the floor when it exceeds coverable demand", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...MAX_COVERAGE_BASE_COVERAGE, coverageFloorDemand: 500_100_100,
    });
    expect(res.errors.map(e => e.code)).toContain("coverage_floor_infeasible");
  });

  // The regression guard for the contradiction review found: with the cap check
  // in solve.py this was unreachable, because precheck short-circuits before
  // Python runs, so a both-violating scenario was attributed to the floor alone.
  it("names BOTH when both bounds are violated", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...MAX_COVERAGE_BASE_COVERAGE, coverageFloorDemand: 500_100_100, avgServiceDistCapKm: 1,
    });
    const codes = res.errors.map(e => e.code);
    expect(codes).toContain("coverage_floor_infeasible");
    expect(codes).toContain("avg_distance_cap_infeasible");
  });

  it("passes a scenario that violates neither bound", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...MAX_COVERAGE_BASE_COVERAGE, coverageFloorDemand: 0, avgServiceDistCapKm: 1000,
    });
    expect(res.ok).toBe(true);
  });
});
```

In `maxCoverageContract.test.ts`, update the exact-code-list assertion from 9 codes to 10, adding `avg_distance_cap_infeasible`. **Keep it an exact-list assertion** — it is what stops the TS union and the OpenAPI enum drifting apart.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter api-server test -- precheck maxCoverageContract
```
Expected: FAIL — the code does not exist in the union, and the contract test asserts 9.

- [ ] **Step 3: Extend the contract**

In `precheck.ts`, add to `PrecheckErrorCode`:

```ts
  | "avg_distance_cap_infeasible"
```

In `openapi.yaml`, add `avg_distance_cap_infeasible` to `PrecheckError.code`'s enum. Then:

```bash
pnpm --filter @workspace/api-spec run codegen
```

- [ ] **Step 4: Add the rule**

In `precheck.ts`, immediately after the floor rule:

```ts
  // --- avg_distance_cap_infeasible: avgServiceDistCapKm vs a cheap NECESSARY
  // lower bound on achievable weighted-average distance. Assign every active
  // customer to its nearest active warehouse, ignoring BOTH `p` and maxDistKm:
  // that is a relaxation, so no feasible solution can beat it. Reuses the
  // `rawKm` overlay already built above -- O(|W| x |C|) over data in hand.
  //
  // A necessary condition, not a complete one: a cap above this bound can still
  // be infeasible once `p` and maxDistKm bite. Those cases fall through to
  // solve.py's generic infeasible message, which names both candidates.
  if (inputs.avgServiceDistCapKm != null && totalDemand > 0) {
    let weightedNearest = 0;
    for (const custId of activeCustomerIds) {
      let nearest = Infinity;
      for (const whId of activeWarehouseIds) {
        const d = rawKm.get(whId + "|" + custId);
        if (d != null && d < nearest) nearest = d;
      }
      if (nearest === Infinity) continue; // unreachable customers are the max-dist rule's business
      weightedNearest += effectiveDemand(custId) * nearest;
    }
    const lowerBound = weightedNearest / totalDemand;
    if (inputs.avgServiceDistCapKm < lowerBound) {
      errors.push({
        code: "avg_distance_cap_infeasible",
        message: `avgServiceDistCapKm (${inputs.avgServiceDistCapKm} km) is below the ${lowerBound.toFixed(2)} km best achievable weighted-average distance`,
      });
    }
  }
```

- [ ] **Step 5: Run the gate**

```bash
pnpm run typecheck
pnpm --filter api-server test
pnpm --filter studio test
```
Expected: all PASS. `precheck` is NOT a known flake — a failure is real.

- [ ] **Step 6: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "[CH4O-6] add the average-distance cap infeasibility bound and its error code"
```

---

## Task 7: Rebuild the Optimization Parameters form

**Spec:** §4.1, §4.3, §4.6.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`
- Modify: `artifacts/studio/src/components/workspace/SolveDialog.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Test: `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`, `Workspace.TabCoverage.test.tsx`

**Interfaces:**
- Consumes: `deriveMaxCoverageObjective` from `@workspace/units` (Task 1); `coverageFloorDemand` on the base props (Task 5).
- Produces: `OptimizationParametersTab` with no `step*` props and no `objective` prop; the Chapter 4 block gated on `highServiceDistKm != null`.

**DO NOT touch `SolveDialog.tsx:170`.** That line is `<Slider step={1}>` — the P slider's numeric **increment**. Deleting it makes the slider continuous, so a student could select 3.7 warehouses. `SolveDialog` has no `step` prop; Chapter 4 reaches this form through `paramsSlot`.

**DO NOT add a second `pMax` declaration.** Chapter 4's `26` lives at exactly one site, and `Workspace.test.tsx`'s MIG-8 test greps the source text asserting exactly one match of `modelId === "max-coverage-us" ? (\d+)`. Even quoting the expression in a comment counts.

- [ ] **Step 1: Write the failing tests**

Append to `OptimizationParametersTab.test.tsx`. That file already defines a
`render` helper passing `{ wrapper: UnitProvider }` and a `STORAGE_KEY`
constant (`"nos:display-unit-pref"`) — use both; `UnitProvider` has no props
beyond `children`:

```tsx
const ch4Props = {
  p: 3, pMax: 26, gap: 0, timeLimitSec: 120,
  distanceBands: [700, 1400, 2800, 5500],
  highServiceDistKm: 700, maxDistKm: 5500, avgServiceDistCapKm: 1000,
  coverageFloorDemand: 0,
  canonicalUnit: "km" as const,
  onChange: vi.fn(), onServiceDistanceChange: vi.fn(),
};

describe("OptimizationParametersTab — Chapter 4 single form", () => {
  it("renders the avg service cap unconditionally, with no objective prop", () => {
    render(<OptimizationParametersTab {...ch4Props} />);
    expect(screen.getByTestId("input-avg-service-cap")).toBeInTheDocument();
  });

  it("renders an editable coverage floor", () => {
    render(<OptimizationParametersTab {...ch4Props} />);
    const floor = screen.getByTestId("input-coverage-floor");
    expect(floor).toBeEnabled();
    fireEvent.change(floor, { target: { value: "500" } });
    expect(ch4Props.onChange).toHaveBeenCalledWith("coverageFloorDemand", 500);
  });

  it("names Model 1 when the floor is zero", () => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={0} />);
    expect(screen.getByTestId("derived-model-line")).toHaveTextContent(/Model 1/);
  });

  it("names Model 2 when the floor is positive", () => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={500} />);
    expect(screen.getByTestId("derived-model-line")).toHaveTextContent(/Model 2/);
  });

  // The line shows DISTANCES. It must CONVERT them for display, not print
  // canonical values under a converted label -- the failure a naive
  // unit-suffix implementation produces.
  it("renders the line's distances in the DISPLAY unit, not the canonical one", () => {
    // UnitProvider takes NO `initialPref` prop — it reads the persisted
    // preference from localStorage on mount. This file already has a STORAGE_KEY
    // constant and a `render` helper that passes `{ wrapper: UnitProvider }`;
    // use them rather than inventing a prop.
    window.localStorage.setItem(STORAGE_KEY, "mi");
    render(<OptimizationParametersTab {...ch4Props} canonicalUnit="km" highServiceDistKm={700} />);
    const line = screen.getByTestId("derived-model-line");
    expect(line).toHaveTextContent(/mi/);
    expect(line).not.toHaveTextContent("700");   // 700 km displays as ~435 mi
  });

  it("renders no Chapter 4 block for a model without the thresholds", () => {
    render(<OptimizationParametersTab p={3} gap={0} timeLimitSec={120} distanceBands={[200]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("chen-objective-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("derived-model-line")).not.toBeInTheDocument();
  });

  it("renders no step 2 panel", () => {
    render(<OptimizationParametersTab {...ch4Props} />);
    expect(screen.queryByTestId("step2-parameters")).not.toBeInTheDocument();
  });
});
```

Append to `Workspace.TabCoverage.test.tsx`:

```ts
it("gives max-coverage-us an explicit tab list rather than the p-median fallthrough", () => {
  expect(inputEntriesForModel("max-coverage-us").map(e => e.id)).toEqual([
    "input-map", "customers", "warehouses", "distances", "optimization-parameters",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter studio test -- OptimizationParametersTab TabCoverage
```
Expected: FAIL — no `input-coverage-floor`, no `derived-model-line`, cap hidden behind `objective === "coverage"`.

- [ ] **Step 3: Strip the step and objective props**

In `OptimizationParametersTab.tsx`:

1. Delete from the props interface: `objective`, `step`, `stepEditable`, `step2Gap`, `step2TimeLimitSec`, `coverageFloorFromStep1`. Add `coverageFloorDemand?: number;`.
2. Delete `step2Gap` / `step2TimeLimitSec` from the `OptimizationParametersField` union. `coverageFloorDemand` is already in it.
3. Delete the `Lock` import — its only use was the deleted panel.
4. Delete the whole `{step === 2 && (...)}` panel.
5. Delete all **three** `(step ?? 1) === 1 &&` guards.
6. Change the Chapter 4 block's gate from `objective != null` to `highServiceDistKm != null`.
7. Remove the `objective === "coverage" &&` wrapper from the avg-cap field so it renders always.

- [ ] **Step 4: Add the floor input and the derived-model line**

The line shows distances, so it must resolve and convert them itself. `useDisplayUnit()` provides `effectiveUnit` and `toDisplay`; conversion otherwise only happens inside the child `ChenDistanceInput`, so a parent that merely appends a unit label would print canonical numbers under a converted label.

Add near the top of the component body (unconditionally — Rules of Hooks):

```tsx
  const { effectiveUnit, toDisplay } = useDisplayUnit();
```

Then, inside the Chapter 4 block after the avg cap:

```tsx
          <div>
            <Label htmlFor={pid("input-coverage-floor")} className="text-xs text-muted-foreground">
              Coverage floor (demand)
            </Label>
            {/* NOT a distance -- never routed through ChenDistanceInput /
                useDistanceDraft, and never unit-converted. A demand count has
                no distance dimension. */}
            <Input
              id={pid("input-coverage-floor")}
              type="number"
              min={0}
              step={1}
              value={coverageFloorDemand ?? 0}
              onChange={e => onChange("coverageFloorDemand", parseInt(e.target.value, 10) || 0)}
              className="h-8 text-sm mt-1 font-mono"
              data-testid={tid("input-coverage-floor")}
            />
            {(() => {
              // Reads the SAME derivation the server uses, so the label and the
              // solve that runs cannot disagree. Distances are converted AND
              // labelled -- printing canonical numbers under a display-unit
              // label is the trap here.
              if (canonicalUnit == null) return null;
              const u = effectiveUnit(canonicalUnit);
              const d = (v: number) => toDisplay(v, canonicalUnit).toLocaleString(undefined, { maximumFractionDigits: 1 });
              const floor = coverageFloorDemand ?? 0;
              return (
                <p className="mt-1 text-[11px] text-muted-foreground" data-testid={tid("derived-model-line")}>
                  {deriveMaxCoverageObjective(floor) === "coverage"
                    // CORRECTED after Task 7's review. `highServiceDistKm!` is
                    // safe (the block gate proves it); `avgServiceDistCapKm!`
                    // was NOT gated by anything, and the `!` is exactly what
                    // kept tsc quiet. convert.ts returns its input unchanged
                    // when canonical === target, so on the DEFAULT km->km path
                    // toDisplay(undefined) is undefined and .toLocaleString()
                    // throws a TypeError DURING RENDER -- taking down the whole
                    // tab, not just this line. Reachable: the pre-branch schema
                    // allowed a min_distance row with floor 0 and no cap, which
                    // now derives to "coverage" and reads the missing cap.
                    // OMIT the clause rather than printing `?? 0` -- "at or
                    // under 0 mi" is a false statement about the model that will
                    // run.
                    ? `Model 1 — maximize demand within ${d(highServiceDistKm!)} ${u}` +
                      (avgServiceDistCapKm == null
                        ? ""
                        : `, holding average distance at or under ${d(avgServiceDistCapKm)} ${u}`)
                    : `Model 2 — minimize average distance, covering at least ${floor.toLocaleString()} demand within ${d(highServiceDistKm!)} ${u}`}
                </p>
              );
            })()}
          </div>
```

Import `deriveMaxCoverageObjective` from `@workspace/units`.

- [ ] **Step 5: Remove the client-side `objective` concept — five sites**

Two are done in Step 3 (prop declaration, destructure). The rest:

- `Workspace.tsx` — delete `objectiveFromInputs`
- `Workspace.tsx` — delete the `objective:` entry from the base props object
- `SolveDialog.tsx` — delete the `objective` prop, its destructure and the built-in objective panel. Unreachable: `objective` only ever existed for `max-coverage-us`, which routes through `paramsSlot`, so the panel never mounts.

(`defaultInputsForModel`'s `objective: "coverage"` was already deleted in Task 5 — it had to be, or every create would 422.)

- [ ] **Step 6: Add the explicit tab case**

In `Workspace.tsx`'s `inputEntriesForModel`, before the `p-median-brazil` tail:

```ts
    // Registration point 12. Written out explicitly even though it matches the
    // p-median tail: the precheck is explicit that OMISSION is a silent defect,
    // because falling through GRANTS an editable dataset surface a model may
    // not support. The tail being close to what this model wants makes writing
    // the case out more important, not less.
    case "max-coverage-us":
      return [
        { id: "input-map", label: "Input Map" },
        { id: "customers", label: "Customers" },
        { id: "warehouses", label: "Warehouses" },
        { id: "distances", label: "Distances" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
```

- [ ] **Step 7: Run the gate**

```bash
ps aux | grep "[v]itest" | grep -vc "zsh -c"   # must print 0
pnpm run typecheck
pnpm --filter studio test
```
Expected: PASS, including `Workspace.test.tsx`'s MIG-8 single-`pMax`-declaration test.

- [ ] **Step 8: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A artifacts/studio/src
git commit -m "[CH4O-7] rebuild Chapter 4's parameters form as one editable surface"
```

---

# PHASE 2 — Miles-canonical conversion

---

## Task 8: ATOMIC — convert the model to miles

**Spec:** §2.1, §2.5, §3.3.

**One task, for the same reason as Task 5.** Converting the dataset without the thresholds means `solve.py` compares mile distances against km thresholds — reading 3219 miles as 3219 km. Converting the thresholds without the dataset is the mirror image. The dataset, the manifest, the field names, the defaults and the goldens move together or the model is wrong in between.

**Files:**
- Modify: `scripts/src/build-max-coverage-dataset.ts`
- Regenerate: `solvers/max-coverage-us/dataset/{distances.json,version.json}`
- Modify: `solvers/max-coverage-us/manifest.json`
- Modify (rename): `artifacts/api-server/src/validation/inputs/maxCoverage.ts`, `services/precheck.ts`, `services/autoDistance.ts`, `solver/pmedian.ts`, `solver/solve.py`, `solver/tests/benchmark/{corpus.py,translate.py,corpus/manifest.json}`, `artifacts/studio/src/pages/Workspace.tsx`, `components/workspace/tabs/OptimizationParametersTab.tsx`, `components/workspace/SolveDialog.tsx`
- Modify: `artifacts/studio/src/lib/formatObjective.ts` (the hardcoded `demand-km`)
- Modify (tests): `lib/dataset-schema/src/{maxCoverageDataset,manifest}.test.ts`, the api-server fixtures from Task 5 Step 1, `artifacts/studio/src/__tests__/*`, `solver/tests/test_max_coverage.py`

**Interfaces:**
- Consumes: everything in Phase 1.
- Produces: `highServiceDistMi`, `maxDistMi`, `avgServiceDistCapMi` everywhere; `manifest.distanceUnit === "mi"`; `autoDistance` loses `haversineKm`/`clampKm`.

- [ ] **Step 1: Write the failing tests**

In `lib/dataset-schema/src/maxCoverageDataset.test.ts`, retitle and add a value assertion:

```ts
  it("has all 5200 distance pairs, keyed '<warehouseId>,<customerId>' in miles", () => {
    expect(Object.keys(distances)).toHaveLength(5200);
  });

  // Miles-canonical (§2.1). The matrix IS p-median-us's integer-mile matrix, so
  // every value is a whole number and the longest pair is 3219 mi. Asserting the
  // VALUE, not just the manifest string -- a manifest saying "mi" over a km
  // matrix is exactly the failure this catches.
  it("is integer miles, longest pair 3219", () => {
    const values = Object.values(distances) as number[];
    expect(values.every(v => Number.isInteger(v))).toBe(true);
    expect(Math.max(...values)).toBe(3219);
  });
```

In `lib/dataset-schema/src/manifest.test.ts`:

```ts
  it("declares max-coverage-us as miles-canonical", () => {
    expect(manifestFor("max-coverage-us").distanceUnit).toBe("mi");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/dataset-schema test`
Expected: FAIL — non-integer km values, max 5180.478336, manifest `km`.

- [ ] **Step 3: Regenerate the dataset**

In `scripts/src/build-max-coverage-dataset.ts`: delete `const MI2KM = 1.609344;`, change the distance assignment to `distances[...] = miles;`, and rewrite the header's transform 2:

```
//  2. Re-key only. Chapter 4 is miles-canonical (§2.1 of the 2026-10-09 design):
//     the matrix IS Chapter 3's integer-mile matrix, used as-is. NO unit
//     conversion and no circuity factor -- stored == solved == displayed ==
//     exported.
```

Then:
```bash
pnpm --filter @workspace/scripts exec tsx ./src/build-max-coverage-dataset.ts
git diff --stat solvers/max-coverage-us/dataset
```
Expected: `distances.json` and `version.json` changed; `warehouses.json`/`customers.json` unchanged. The script computes `sha256` with `createHash` — never hand-write it (registration point 2).

Set `"distanceUnit": "mi"` in `solvers/max-coverage-us/manifest.json`.

- [ ] **Step 4: Run the mechanical rename**

```bash
cd /Users/shubhamkr/network-optimization-studio
grep -rl -e highServiceDistKm -e maxDistKm -e avgServiceDistCapKm \
  --include="*.ts" --include="*.tsx" --include="*.py" --include="*.json" --include="*.yaml" . \
  | grep -v node_modules | grep -v "/generated/" \
  | xargs sed -i '' -e 's/highServiceDistKm/highServiceDistMi/g' \
                    -e 's/maxDistKm/maxDistMi/g' \
                    -e 's/avgServiceDistCapKm/avgServiceDistCapMi/g'
```

Verify — note the `--include` filters on the **verification** grep too. Without them it matches historical occurrences in `docs/**`, which are deliberate and must not be renamed, so `CLEAN` would be unreachable and the real signal lost:

```bash
grep -rn -e highServiceDistKm -e maxDistKm -e avgServiceDistCapKm \
  --include="*.ts" --include="*.tsx" --include="*.py" --include="*.json" --include="*.yaml" . \
  | grep -v node_modules | grep -v "/generated/" || echo "CLEAN"
git diff --name-only | grep "/generated/" && echo "ERROR: generated files touched" || echo "generated untouched"
```
Expected: `CLEAN`, then `generated untouched`.

- [ ] **Step 5: Fix the unit strings the rename cannot reach**

Three `Km`→`Mi` patterns do not touch unit *labels* or hardcoded unit words:

`precheck.ts` — all three message strings end `km)` and become `mi)`, including Task 6's cap message.

`solve.py` — `solve_max_coverage`'s header comment says "Distances are RAW km"; correct it and any neighbouring km mentions.

`formatObjective.ts` — **`formatChenObjective` hardcodes `` `demand-km` ``.** No rename pattern matches it. It is the unresolved-unit fallback for Chapter 4's min-distance objective, so without this fix the objective still reads "demand-km" after the conversion:

```ts
  if (objectiveMode === "min_distance") return `${objective.toExponential(2)} demand-mi`;
```

Correct the matching comment two lines above. Then sweep for any other hardcoded km label:

```bash
grep -rn "demand-km\|\"km\"\|'km'\| km)" artifacts/studio/src artifacts/api-server/src --include="*.ts" --include="*.tsx" --include="*.py" | grep -iv "p-median\|transport\|jade\|gold\|delivery\|CanonicalUnit\|DisplayUnitPref"
```
Review each hit: a km mention belonging to the unit *system* (`CanonicalUnit`, the display-pref enum) stays; one describing Chapter 4 changes.

- [ ] **Step 6: Collapse the km haversine**

In `autoDistance.ts`, delete `R_KM`, `MIN_DISTANCE_KM`, `haversineKm` and `clampKm`. In `fillEstimatedMaxCoverageDistances`:

```ts
      const d = clampMi(haversineMiles(a, b) * MAX_COVERAGE_CIRCUITY);
```

Rewrite the preceding comment block:

```ts
// Chapter 4 (max-coverage-us) is miles-canonical like every other model
// (§2.1), so it shares haversineMiles/clampMi rather than carrying its own km
// pair. MAX_COVERAGE_CIRCUITY stays 1.17, which PRESERVES the previous
// estimates: a fill was haversineKm x 1.17 and is now haversineMiles x 1.17,
// and 6371 / 1.609344 = 3958.76 against R_MI = 3959 is a 0.0061% difference.
// Rounding moves from 2 dp to clampMi's 1 dp, matching every other model.
//
// NOTE a pre-existing inconsistency this conversion surfaces but does NOT fix:
// Chapters 3 and 4 now share a byte-identical distance matrix, yet p-median-us
// fills added-entity distances at circuity 1 and this model at 1.17. Keeping
// 1.17 is what preserves Chapter 4's current estimates; reconciling the two is
// a separate task.
```

Update `autoDistance.test.ts`'s km-haversine cases onto the miles path.

- [ ] **Step 7: Update the defaults**

In `Workspace.tsx`'s `defaultInputsForModel` → `case "max-coverage-us"`:

```ts
    case "max-coverage-us":
      return {
        p: 3,
        highServiceDistMi: 450,
        maxDistMi: 3400,
        avgServiceDistCapMi: 650,
        coverageFloorDemand: 0,
        gap: 0,
        timeLimitSec: 120,
        capacityMode: "none",
        // Miles-canonical (§2.1/§2.5). Round teaching numbers, not exact
        // conversions of the old km seeds. maxDistMi 3400 clears the dataset's
        // longest pair (3219 mi) so no customer is unassignable.
        // highServiceDistMi and avgServiceDistCapMi must NEVER be made equal --
        // Workspace.test.tsx guards it, because equal values tighten the default
        // solve to a different open set.
        // `objective` is deliberately absent: the server derives it (§2.3) and
        // the write guard REFUSES a client-sent one.
        distanceBands: [450, 900, 1800, 3400],
        warehouseOverrides: [],
        customerOverrides: [],
        addedWarehouses: [],
        addedCustomers: [],
        distanceOverrides: [],
      };
```

Mirror the values into the manifest's `inputsSchema` where it documents them.

- [ ] **Step 8: Recompute the pytest goldens BY RUNNING**

Every km golden is invalid for two independent reasons: the demand-weighted objective scales by `1/1.609344`, **and** the round-number defaults flip the high-service/max-distance predicates for some pairs, so the open set and covered demand can legitimately differ. **Do not hand-divide any golden.**

Set `BASE`:
```python
BASE = {"modelType": "max_coverage_us", "p": 3, "highServiceDistMi": 450, "maxDistMi": 3400,
        "avgServiceDistCapMi": 650, "coverageFloorDemand": 0,
        "gap": 0.0, "timeLimitSec": 60, "warehouseOverrides": [], "customerOverrides": [],
        "addedWarehouses": [], "addedCustomers": [], "distanceOverrides": []}
```

Read the real values:
```bash
cd artifacts/api-server/src/solver
echo '{"modelType":"max_coverage_us","p":3,"highServiceDistMi":450,"maxDistMi":3400,"avgServiceDistCapMi":650,"coverageFloorDemand":0,"gap":0.0,"timeLimitSec":60,"warehouseOverrides":[],"customerOverrides":[],"addedWarehouses":[],"addedCustomers":[],"distanceOverrides":[]}' \
  | python3 solve.py | python3 -m json.tool
```
Record `details.coveragePct`, `details.coveredDemand`, `details.openWarehouseIds`, `metrics.weightedAvgDistance` into the coverage assertions, **with the producing command in a comment**.

Repeat for min-distance using the coverage run's `coveredDemand` as the floor. Sanity check, not a golden: the min-distance average must be **≤** the coverage run's and **≤ 650**. If the cap binds, choose a looser cap for `TestCapBindsInBothModes`'s loose case and say so in a comment.

- [ ] **Step 9: Run the gate**

```bash
pnpm run typecheck
pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
```
Expected: all PASS; `e2e_accuracy.py` still `99/99`. Any change there means the conversion leaked into another model.

- [ ] **Step 10: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A
git commit -m "[CH4O-8] make Chapter 4 miles-canonical, dataset and fields together"
```

---

## Task 9: The km→mi migration

**Spec:** §3.4.

**Files:**
- Create: `artifacts/api-server/src/migrations/ch4ToMiles.ts`
- Create: `artifacts/api-server/src/migrations/__tests__/ch4ToMiles.test.ts`
- Create: `docs/ops/ch4-miles-migration-runbook.md`
- Modify: `artifacts/api-server/package.json`

**Interfaces:**
- Consumes: `maxCoverageInputsSchema` (Tasks 5, 8), `deriveMaxCoverageObjective` (Task 1).
- Produces: `type MigrateResult = { ok: true; inputs: Record<string, unknown> } | { ok: false; reason: string }`; `migrateInputs(inputs: Record<string, unknown>): MigrateResult`; `migrateAll(database?: Db, dryRun?: boolean): Promise<MigrateReport>`.

**Hosted in api-server, not `scripts/` — a deliberate deviation.** §3.4 requires every migrated row to be re-validated against the real schema before its UPDATE commits. That schema lives in `artifacts/api-server/src/validation/inputs/maxCoverage.ts`, and `@workspace/api-server` has **no `main` and no `exports`** — a private app, not an importable library. `@workspace/scripts` depends only on `@workspace/db` and `drizzle-orm`. A `scripts/`-hosted migration could not reach the validator and would have to re-implement the invariants it exists to satisfy. Record the deviation in the commit body (hard rule #8).

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/migrations/__tests__/ch4ToMiles.test.ts`. Note `expectOk`: `expect(r.ok).toBe(true)` does **not** narrow a discriminated union for TypeScript, and api-server typechecks its tests under `strictNullChecks`, so reading `r.inputs` after a bare `expect` fails the next full typecheck.

```ts
import { describe, it, expect } from "vitest";
import { migrateInputs } from "../ch4ToMiles.js";

// Narrows for TypeScript as well as asserting — a plain expect() does not.
function expectOk(r: ReturnType<typeof migrateInputs>): Record<string, unknown> {
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r.inputs;
}

const kmRow = {
  objective: "coverage", p: 3,
  highServiceDistKm: 700, maxDistKm: 5500, avgServiceDistCapKm: 1000,
  gap: 0, timeLimitSec: 120, capacityMode: "none",
  distanceBands: [700, 1400, 2800, 5500],
  stepEpoch: 4, step2: { gap: 1, timeLimitSec: 90 },
  warehouseOverrides: [], customerOverrides: [],
  addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};

describe("migrateInputs", () => {
  it("converts the three scalars to 2 dp miles", () => {
    const i = expectOk(migrateInputs(kmRow));
    expect(i.highServiceDistMi).toBeCloseTo(434.96, 2);
    expect(i.maxDistMi).toBeCloseTo(3417.54, 2);
    expect(i.avgServiceDistCapMi).toBeCloseTo(621.37, 2);
    expect(i).not.toHaveProperty("highServiceDistKm");
  });

  it("converts distanceBands and keeps them strictly ascending", () => {
    const bands = expectOk(migrateInputs(kmRow)).distanceBands as number[];
    expect(bands).toHaveLength(4);
    expect(bands.every((v, n) => n === 0 || v > bands[n - 1])).toBe(true);
  });

  // THE one that corrupts data if missed. distanceOverrides[].distance is raw km
  // that precheck overlays DIRECTLY onto the base matrix, and for an added
  // entity it is the ONLY record of that distance. Assert the VALUE -- a test
  // that only checks the array length passes against the exact bug.
  it("converts EVERY distanceOverrides[].distance", () => {
    const i = expectOk(migrateInputs({
      ...kmRow,
      distanceOverrides: [
        { fromId: "ALN", toId: "C1", distance: 601.894656 },
        { fromId: "aw-x", toId: "C2", distance: 100, estimated: true },
      ],
    }));
    const o = i.distanceOverrides as Array<{ distance: number; estimated?: boolean }>;
    expect(o[0].distance).toBeCloseTo(374, 2);
    expect(o[1].distance).toBeCloseTo(62.14, 2);
    expect(o[1].estimated).toBe(true);   // a boolean flag does not convert
  });

  it("defaults a missing avgServiceDistCapKm (old min-distance row)", () => {
    const { avgServiceDistCapKm, ...noCap } = kmRow;
    const i = expectOk(migrateInputs({ ...noCap, objective: "min_distance", coverageFloorDemand: 53385024 }));
    expect(i.avgServiceDistCapMi).toBe(650);
  });

  it("derives the objective from the floor and drops the step fields", () => {
    expect(expectOk(migrateInputs(kmRow)).objective).toBe("coverage");
    expect(expectOk(migrateInputs({ ...kmRow, coverageFloorDemand: 500 })).objective).toBe("min_distance");
    const i = expectOk(migrateInputs(kmRow));
    expect(i).not.toHaveProperty("stepEpoch");
    expect(i).not.toHaveProperty("step2");
  });

  it("defaults an absent coverageFloorDemand to 0", () => {
    expect(expectOk(migrateInputs(kmRow)).coverageFloorDemand).toBe(0);
  });

  it("dedupes bands that collide after rounding", () => {
    const bands = expectOk(migrateInputs({ ...kmRow, distanceBands: [1, 1.001, 700] })).distanceBands as number[];
    expect(new Set(bands).size).toBe(bands.length);
  });

  it("falls back to [high, max] when every band rounds away", () => {
    const i = expectOk(migrateInputs({ ...kmRow, distanceBands: [0.0001] }));
    expect(i.distanceBands).toEqual([i.highServiceDistMi, i.maxDistMi]);
  });

  it("SKIPS a row it cannot make valid, rather than writing it", () => {
    const r = migrateInputs({ ...kmRow, highServiceDistKm: 5500, maxDistKm: 700 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/validation/i);
  });

  it("is idempotent — an already-migrated row is returned unchanged", () => {
    const once = expectOk(migrateInputs(kmRow));
    expect(expectOk(migrateInputs(once))).toEqual(once);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api-server test -- ch4ToMiles`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the migration**

Create `artifacts/api-server/src/migrations/ch4ToMiles.ts`:

```ts
import { eq, sql } from "drizzle-orm";   // `sql` for the epoch bump — see the .set() below
import { db, pool, scenariosTable, resultCacheTable } from "@workspace/db";
import { maxCoverageInputsSchema } from "../validation/inputs/maxCoverage.js";
import { deriveMaxCoverageObjective } from "@workspace/units";

// One-off km -> mi migration of persisted max-coverage-us `inputs` (§3.4 of
// docs/superpowers/specs/2026-10-09-ch4-model-interface-overhaul-design.md).
// Running it against production is a separate, human-gated operation -- see
// docs/ops/ch4-miles-migration-runbook.md.
export const MAX_COVERAGE_MODEL_ID = "max-coverage-us";
const MI = 1.609344;

// 2 dp, NOT integers. Integer rounding turns valid persisted rows invalid:
// high=1km/max=1.1km both round to 1 and break the strict inequality, and
// anything under 0.804672 km rounds to 0 and breaks `positive()`.
const toMi = (km: number): number => Math.round((km / MI) * 100) / 100;

export type MigrateResult =
  | { ok: true; inputs: Record<string, unknown> }
  | { ok: false; reason: string };

export function migrateInputs(raw: Record<string, unknown>): MigrateResult {
  // Idempotency, keyed on the renamed field's presence. Each row's JSON update
  // must be atomic, or a half-converted row looks unmigrated here and gets
  // converted twice.
  if ("highServiceDistMi" in raw) return { ok: true, inputs: raw };

  const { highServiceDistKm, maxDistKm, avgServiceDistCapKm, stepEpoch, step2, ...rest } =
    raw as Record<string, unknown>;

  const highServiceDistMi = toMi(highServiceDistKm as number);
  const maxDistMi = toMi(maxDistKm as number);
  // An old min-distance row has NO cap: the pre-overhaul schema made it
  // coverage-only and synthesizeStep2Inputs destructured it away.
  const avgServiceDistCapMi = avgServiceDistCapKm == null ? 650 : toMi(avgServiceDistCapKm as number);
  const coverageFloorDemand = typeof rest.coverageFloorDemand === "number" ? rest.coverageFloorDemand : 0;

  const rawBands = Array.isArray(rest.distanceBands) ? (rest.distanceBands as number[]) : [];
  const bands = [...new Set(rawBands.map(toMi))].filter(b => b > 0).sort((a, b) => a - b);

  const overrides = Array.isArray(rest.distanceOverrides)
    ? (rest.distanceOverrides as Array<Record<string, unknown>>).map(o => ({
        ...o,
        // EVERY entry. This value is raw km that precheck overlays directly onto
        // the base matrix, and for an added entity it is the only record of that
        // distance. `estimated` is a boolean and does not convert.
        distance: toMi(o.distance as number),
      }))
    : [];

  const candidate: Record<string, unknown> = {
    ...rest,
    highServiceDistMi,
    maxDistMi,
    avgServiceDistCapMi,
    coverageFloorDemand,
    objective: deriveMaxCoverageObjective(coverageFloorDemand),
    distanceBands: bands.length > 0 ? bands : [highServiceDistMi, maxDistMi],
    distanceOverrides: overrides,
  };

  // The guarantee behind the 2 dp choice: only rows the running server can load
  // are written back. A skipped row is a visible one-liner to fix by hand; a
  // written-but-invalid row 422s forever with no indication why.
  const parsed = maxCoverageInputsSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: `validation failed: ${parsed.error.message}` };
  return { ok: true, inputs: parsed.data as Record<string, unknown> };
}

type Db = typeof db;

export interface MigrateReport {
  migrated: number[];
  skipped: Array<{ id: number; reason: string }>;
  alreadyMigrated: number[];
}

// `dryRun` performs the FULL analysis -- selects every row, runs migrateInputs,
// classifies each -- and simply does not write. A dry run that reports zeros
// without inspecting anything cannot reveal a bad row, which is its only job.
export async function migrateAll(database: Db = db, dryRun = false): Promise<MigrateReport> {
  const rows = await database
    .select({ id: scenariosTable.id, inputs: scenariosTable.inputs })
    .from(scenariosTable)
    .where(eq(scenariosTable.modelId, MAX_COVERAGE_MODEL_ID));

  const report: MigrateReport = { migrated: [], skipped: [], alreadyMigrated: [] };

  for (const row of rows) {
    const inputs = (row.inputs ?? {}) as Record<string, unknown>;
    if ("highServiceDistMi" in inputs) { report.alreadyMigrated.push(row.id); continue; }
    const result = migrateInputs(inputs);
    if (!result.ok) { report.skipped.push({ id: row.id, reason: result.reason }); continue; }
    if (!dryRun) {
      await database.update(scenariosTable)
        // CORRECTED after Task 9's review. An earlier draft set only
        // {inputs, result, solvedAt}, which skipped the write authority's EPOCH
        // bump -- and that omission is not cosmetic:
        //
        // jobRunner publishes a result only if `latestSolveJobId = jobId AND
        // solveInputRevision = enqueuedSolveInputRevision`. Leave both columns
        // untouched and an in-flight KILOMETRE-era solve still matches the CAS
        // after the migration rewrites the row to miles -- so markSucceeded
        // writes a km-era result plus a fresh solvedAt. It is INVISIBLE, because
        // isStale() is `inputsUpdatedAt > solvedAt` and inputsUpdatedAt was also
        // not bumped, so the fresh solvedAt wins and the row reads as freshly
        // and correctly solved. The `result: null` meant to force a re-solve is
        // silently undone by a value computed in the wrong unit.
        //
        // That window is live PRECISELY when the runbook says to run the
        // migration: the old km-era server is still serving users.
        //
        // Bumping solveInputRevision makes the in-flight CAS fail, so the job
        // returns `superseded` and never publishes -- the designed behaviour for
        // "inputs changed under a running job", which is exactly what this is.
        // `sql`now()`` not `new Date()`: isStale() compares against solvedAt,
        // which jobRunner writes DB-side, and both sides of that comparison must
        // come from one clock.
        .set({
          inputs: result.inputs,
          result: null,
          solvedAt: null,
          resultRunId: null,
          inputsUpdatedAt: sql`now()`,
          solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(scenariosTable.id, row.id));
    }
    report.migrated.push(row.id);
  }

  // result_cache is NOT an FK child of scenarios (pk is inputs_hash plus a plain
  // model_id column), so its rows would otherwise strand km payloads forever.
  // solve_jobs rows are deliberately left as history.
  if (!dryRun) {
    await database.delete(resultCacheTable).where(eq(resultCacheTable.modelId, MAX_COVERAGE_MODEL_ID));
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  const report = await migrateAll(db, dryRun);
  console.log(JSON.stringify({ dryRun, ...report }, null, 2));
  await pool.end();
}
```

Add to `artifacts/api-server/package.json`'s `scripts`:
```json
    "migrate-ch4-to-miles": "tsx ./src/migrations/ch4ToMiles.ts",
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter api-server test -- ch4ToMiles
pnpm run typecheck
```
Expected: PASS both. The typecheck matters — it is what `expectOk` exists for.

- [ ] **Step 5: Run it against the local dev DB**

The local DB holds 5 `max-coverage-us` scenarios written under the km schema. Dry run first:

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server run migrate-ch4-to-miles -- --dry-run
```
Expected: `dryRun: true`, 5 ids under `migrated`, `skipped: []`. Nothing written.

Then for real, twice:
```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server run migrate-ch4-to-miles
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server run migrate-ch4-to-miles
```
Expected: 5 migrated, then `migrated: []` with the same 5 ids under `alreadyMigrated`.

- [ ] **Step 6: Write the runbook**

Create `docs/ops/ch4-miles-migration-runbook.md` covering: that production's Chapter 4 scenario count is **unmeasurable from an agent session** (`query_render_postgres` connects from `35.227.164.209`, not on `nos-postgres`'s allowlist, so it needs `psql` from an allowlisted host); a `SELECT count(*) FROM scenarios WHERE model_id = 'max-coverage-us'` pre-check; the `--dry-run` stage and what to do with any `skipped` row; the real run; a post-check that every row has `highServiceDistMi`; and an explicit statement that **this runbook IS idempotent** — unlike `docs/ops/timestamptz-migration.md`, which silently double-converts — because of the presence-key guard.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/migrations artifacts/api-server/package.json docs/ops/ch4-miles-migration-runbook.md
git commit -m "$(cat <<'MSG'
[CH4O-9] add the Chapter 4 km-to-miles scenario migration

Hosted in api-server rather than scripts/, deviating from the migration
convention: the revalidate-or-skip guarantee needs maxCoverageInputsSchema, and
@workspace/api-server has no main/exports so scripts/ cannot import it.
MSG
)"
```

---

# PHASE 3 — Output reports

---

## Task 10: Move the coverage metrics onto Solution Summary

**Spec:** §4.4, decisions 5-8 and 10.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx`
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, `ServiceStatsTab.test.tsx`

**Interfaces:**
- Consumes: `scenarioObjectiveMode` (Task 2).
- Produces: rows `cost-summary-high-service-cutoff`, `cost-summary-coverage-pct`, `cost-summary-covered-demand`, plus `cost-summary-compare-<metric>-${s.id}` equivalents.

**Locate by symbol, not line number.** Task 2 deleted a 3-line wrapper in `CostSummaryTab.tsx`, so every reference below has shifted upward.

- [ ] **Step 1: Write the failing tests**

In `CostSummaryTab.test.tsx`:

```tsx
describe("Solution Summary — Chapter 4 coverage rows", () => {
  const ch4Result = {
    ...optimalResult,
    details: { objective: "coverage", coveragePct: 68.4192, coveredDemand: 53385024, highServiceDistMi: 450 },
    metrics: { ...optimalResult.metrics, weightedAvgDistance: 394.6 },
  };

  it("renders the three rows for a Chapter 4 result", () => {
    renderTab({ result: ch4Result, modelId: "max-coverage-us" });
    expect(screen.getByTestId("cost-summary-high-service-cutoff")).toHaveTextContent("450");
    expect(screen.getByTestId("cost-summary-coverage-pct")).toHaveTextContent("68.42");
    expect(screen.getByTestId("cost-summary-covered-demand")).toHaveTextContent("53,385,024");
  });

  // The half that catches an accidental modelId gate.
  it("renders none of them for a non-Chapter-4 result", () => {
    renderTab({ result: optimalResult, modelId: "p-median-us" });
    expect(screen.queryByTestId("cost-summary-high-service-cutoff")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-coverage-pct")).not.toBeInTheDocument();
  });

  it("labels avg distance per model — both directions", () => {
    renderTab({ result: ch4Result, modelId: "max-coverage-us" });
    expect(screen.getByText(/Avg distance to customers/)).toBeInTheDocument();
    cleanup();
    renderTab({ result: optimalResult, modelId: "p-median-us" });
    expect(screen.getByText(/Weighted avg\. distance/)).toBeInTheDocument();
  });
});

describe("Solution Summary — cross-mode compare is allowed", () => {
  // Decision 10. lockedObjectiveMode blocked SELECTION by two mechanisms: a
  // disabled checkbox AND a refusal inside toggleScenario. Assert the
  // toggleScenario path too -- a test that only clicks an enabled checkbox
  // passes against a half-removed guard.
  it("lets a coverage and a min_distance scenario be selected together", () => {
    renderTab({ scenarios: [coverageScenario, minDistanceScenario], modelId: "max-coverage-us" });
    const checkbox = screen.getByTestId(`cost-summary-toggle-${minDistanceScenario.id}`);
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);
    expect(screen.getByTestId(`cost-summary-compare-objective-${minDistanceScenario.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`cost-summary-compare-objective-${coverageScenario.id}`)).toBeInTheDocument();
  });

  it("renders each scenario's OWN coverage values in compare", () => {
    renderTab({ scenarios: [coverageScenario, minDistanceScenario], modelId: "max-coverage-us" });
    fireEvent.click(screen.getByTestId(`cost-summary-toggle-${minDistanceScenario.id}`));
    // Deliberately different numbers: a row reading the wrong scenario's
    // details would pass against identical fixtures.
    expect(screen.getByTestId(`cost-summary-compare-covered-demand-${coverageScenario.id}`)).toHaveTextContent("53,385,024");
    expect(screen.getByTestId(`cost-summary-compare-covered-demand-${minDistanceScenario.id}`)).toHaveTextContent("41,000,000");
  });

  it("leaves non-Chapter-4 compare behaviour unchanged", () => {
    renderTab({ scenarios: [pmedianA, pmedianB], modelId: "p-median-us" });
    expect(screen.getByTestId(`cost-summary-toggle-${pmedianB.id}`)).toBeEnabled();
  });
});
```

In `ServiceStatsTab.test.tsx`, delete the four KPI assertions and **generalise** the negative one:

```tsx
  // After the move this block is absent for EVERY result, not just non-Ch4 ones
  // -- a strictly stronger claim than the one this replaces.
  it("renders no coverage KPI block at all", () => {
    renderTab({ result: ch4Result, modelId: "max-coverage-us" });
    expect(screen.queryByTestId("service-stats-coverage-kpis")).not.toBeInTheDocument();
    expect(screen.getByTestId("service-stats-band-450")).toBeInTheDocument();  // band graph stays
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
ps aux | grep "[v]itest" | grep -vc "zsh -c"   # must print 0
pnpm --filter studio test -- CostSummaryTab ServiceStatsTab
```
Expected: FAIL — rows absent, label unconditional, mismatched checkbox disabled, KPI block present.

- [ ] **Step 3: Add the Solution Summary rows**

In `CostSummaryTab.tsx`'s single-scenario `rows` builder, after the `Objective` row:

```tsx
    // Envelope-shape gate, not a modelId check -- the convention this codebase
    // already uses, and the same test that selects the avg-distance label below.
    const ch4 = result.details as { coveragePct?: number; coveredDemand?: number; highServiceDistMi?: number } | undefined;
    const showCoverageRows = typeof ch4?.coveragePct === "number";
    if (showCoverageRows) {
      rows.push(
        // The SOLVED SNAPSHOT's cutoff, never localInputs: a student who edits
        // the cutoff without re-solving must still see which cutoff produced the
        // numbers beside it.
        ["High service cutoff", formatDistance(ch4!.highServiceDistMi!, canonicalDistanceUnit, unit), true, "cost-summary-high-service-cutoff"],
        ["% of demand within high service", `${ch4!.coveragePct!.toFixed(2)} %`, true, "cost-summary-coverage-pct"],
        ["Total demand within high service", (ch4!.coveredDemand ?? 0).toLocaleString(), true, "cost-summary-covered-demand"],
      );
    }
```

Change the avg-distance row to take the conditional label:

```tsx
      [showCoverageRows ? "Avg distance to customers" : "Weighted avg. distance",
       formatDistance(result.metrics.weightedAvgDistance, canonicalDistanceUnit, unit), true],
```

- [ ] **Step 4: Add the compare rows and remove `lockedObjectiveMode`**

Add three compare rows between `Objective` and the avg-distance row, each gated on its own scenario's `details.coveragePct` and keyed `cost-summary-compare-high-service-cutoff-${s.id}` / `-coverage-pct-` / `-covered-demand-`. Apply the same conditional label to the compare avg-distance row.

Delete `lockedObjectiveMode` at **all four** sites: its derivation, the `toggleScenario` refusal, the checkbox `disabled` prop, and the `(different objective)` label. No per-model gate is needed — it is `null` whenever no selected scenario carries an objective mode, and only Chapter 4's envelopes carry one.

Add at the compare objective row:

```tsx
                {/* Asymmetric conversion is CORRECT, not a bug: objectiveDimension
                    maps coverage to "percent" (non-converting) and min_distance to
                    "demand-distance" (converting), so toggling the display unit
                    changes one column and leaves its neighbour frozen. Do not
                    "fix" this. */}
```

- [ ] **Step 5: Strip the Service Stats KPI block**

Delete the JSX block **and its three now-dead declarations**, each of which has that block as its only consumer: `details`, `showCoverageKpis`, `avgServiceDistance`.

Keep `toDisplay` / `canonicalUnit` / `distanceUnit` — the band labels use them directly.

Fix the stale comment claiming Chapter 4's bands stay frozen "belt-and-suspenders, here on the envelope's own `showCoverageKpis` shape". That guard was already deleted; `bandCoverage` branches on `useLiveCoverage` alone. Remove the `showCoverageKpis` clause.

- [ ] **Step 6: Run the gate**

```bash
ps aux | grep "[v]itest" | grep -vc "zsh -c"   # must print 0
pnpm run typecheck
pnpm --filter studio test
```
Expected: PASS. `CostSummaryTab.test.tsx`'s exact-row-sequence assertion needs its expected list updated — **keep it an equality check**; weakening it to `toContain` discards this tab's only ordering guarantee. The adjacent `startsWith("Weighted avg. distance")` needle must become label-aware.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src
git commit -m "[CH4O-10] move Chapter 4's coverage metrics onto Solution Summary"
```

---

## Task 11: Add the coverage columns to the cost-summary export

**Spec:** §4.5, decision 9.

**Files:**
- Modify: `artifacts/api-server/src/services/templates.ts`
- Document the new columns INLINE in `services/templates.ts` (that file's own
  established convention). **NOT** `docs/superpowers/metrics/README.md` — see below
- Test: `artifacts/api-server/src/__tests__/templates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `COST_SUMMARY_TEMPLATE_VERSION = 4`; `CostSummaryTemplateRow` gains `highServiceDist`, `coveragePct`, `coveredDemand`. The builder is `buildCostSummaryRows(...)` and returns `CostSummaryTemplateRow[]` — **plural, array**. There is no singular builder.

**Do NOT bump `OUTPUT_TEMPLATE_VERSION`.** It is one shared constant read by eight grids, so bumping it moves `serviceStats` and six others whose columns did not change. `DISTANCE_TEMPLATE_VERSION` is the precedent for a per-family constant.

- [ ] **Step 1: Write the failing tests**

```ts
describe("costSummary CSV — Chapter 4 coverage columns", () => {
  it("emits the three new columns", () => {
    const csv = costSummaryRowsToCsv(buildCostSummaryRows(ch4Result, "max-coverage-us", "mi"));
    expect(csv.split("\n")[0]).toContain("highServiceDist,coveragePct,coveredDemand");
  });

  it("leaves them blank for a non-Chapter-4 result", () => {
    const csv = costSummaryRowsToCsv(buildCostSummaryRows(pmedianResult, "p-median-us", "mi"));
    expect(csv.split("\n")[1]).toContain(",,,");
  });

  // highServiceDist IS a distance and converts; the other two are a percent and
  // a demand count with no distance dimension, so running either through a
  // conversion is the rate-style error this repo already has a gotcha for.
  it("converts highServiceDist but NOT coveragePct or coveredDemand", () => {
    const mi = buildCostSummaryRows(ch4Result, "max-coverage-us", "mi")[0];
    const km = buildCostSummaryRows(ch4Result, "max-coverage-us", "km")[0];
    expect(km.highServiceDist).not.toBe(mi.highServiceDist);
    expect(km.coveragePct).toBe(mi.coveragePct);
    expect(km.coveredDemand).toBe(mi.coveredDemand);
  });

  it("uses its own template version, leaving the shared one alone", () => {
    expect(buildCostSummaryRows(ch4Result, "max-coverage-us", "mi")[0].templateVersion)
      .toBe(COST_SUMMARY_TEMPLATE_VERSION);
    expect(COST_SUMMARY_TEMPLATE_VERSION).not.toBe(OUTPUT_TEMPLATE_VERSION);
  });

  it("leaves the serviceStats grid's version untouched", () => {
    expect(buildServiceStatsRows(ch4Result, "max-coverage-us", "mi")[0].templateVersion)
      .toBe(OUTPUT_TEMPLATE_VERSION);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api-server test -- templates`
Expected: FAIL — columns absent, `COST_SUMMARY_TEMPLATE_VERSION` undefined.

- [ ] **Step 3: Implement**

Add beside `OUTPUT_TEMPLATE_VERSION`:

```ts
// Grid-local, following DISTANCE_TEMPLATE_VERSION's precedent. The cost-summary
// grid gains three Chapter 4 coverage columns; OUTPUT_TEMPLATE_VERSION is read
// by eight grids and must stay at 3, or seven untouched exports get a version
// bump they did not earn.
export const COST_SUMMARY_TEMPLATE_VERSION = 4;
```

Extend `CostSummaryTemplateRow` with `highServiceDist: number | null; coveragePct: number | null; coveredDemand: number | null;`, populate them in `buildCostSummaryRows`, and add them to the header and row in `costSummaryRowsToCsv` between `objectiveMode` and `weightedAvgDistance`:

```ts
    highServiceDist:
      details?.highServiceDistMi == null ? null : roundForFile(toDisplay(details.highServiceDistMi, canonicalUnit, requestedUnit)),
    // Neither converts: a percent and a demand count have no distance dimension.
    coveragePct: details?.coveragePct ?? null,
    coveredDemand: details?.coveredDemand ?? null,
```

Change that builder's `templateVersion` to `COST_SUMMARY_TEMPLATE_VERSION`.

**A second site my brief missed, found by Task 11 and worth stating.** The
JSON-export wrapper in `routes/scenarios.ts` hardcoded `OUTPUT_TEMPLATE_VERSION`
for `costSummary`. Left alone, the wrapper would have reported v3 while the rows
inside it reported v4 — and that route's **own pre-existing comment** states that
wrapper-version == row-version is the invariant. So the grid-local constant has
two readers, not one: the row builder and the route's wrapper. `routes.test.ts`
has two tests pinning the old wrapper version and needs both updated.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api-server test -- templates`
Expected: PASS.

- [ ] **Step 5: Update the column docs**

**CORRECTED after Task 11 ran: `docs/superpowers/metrics/README.md` is the WRONG
FILE and must not be edited for this.** It is the *harness metrics store* —
process telemetry (`tasks.csv`, `failures.csv`, flake and permission audits)
written by `pnpm harness:record` and friends. It contains **zero** output-grid
content; verified by reading it in full, and its only near-match is a line
listing e2e spec names. I conflated `CLAUDE.md`'s "a metrics CSV's exact
columns" index row with the export grids; that row points at harness CSVs.

There is **no** document for output-grid CSV columns anywhere in this repo. So
document the three new columns and the grid-local version inline in
`services/templates.ts`, beside the builder — which is already how that file
records every other grid's column semantics.

- [ ] **Step 6: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/services/templates.ts artifacts/api-server/src/__tests__/templates.test.ts artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/__tests__/routes.test.ts
git commit -m "[CH4O-11] export Chapter 4's coverage metrics in the cost-summary CSV"
```

---

## Task 12: Rewrite the sibling e2e specs

**Spec:** §5.3.

**Files:**
- Modify: `artifacts/studio/e2e/max-coverage.spec.ts`, `chen-bands-units-qa.spec.ts`, `nonjade-servicestats-live-coverage.spec.ts`
- Audit: `truthful-status.spec.ts`, `workspace-ux-r1-r9.spec.ts`, `bundle4-auth-landing.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: a green `pnpm e2e:gate`.

The repo's recurring `spec_gap` class: this branch deletes testids, deletes a visible-string contract (`Solve Step 1`/`Solve Step 2`), renames every Chapter 4 distance field and changes km→mi labels. None of these specs is `@flaky`-tagged, so a full gate breaks even with every unit suite green.

- [ ] **Step 1: Find every affected spec**

The old `...Km` field strings no longer exist after Task 8, so search for what is still findable — testids, visible strings, and the new field names:

```bash
cd artifacts/studio
grep -rln -e "step2-" -e "step-toggle" -e "Solve Step" -e "DistMi" -e "DistCapMi" \
          -e "service-stats-coverage" -e "Weighted avg. distance" -e " km" e2e/
```
Record the list, then grep each for the specific testid or string your change touched.

- [ ] **Step 2: Start the local servers**

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3001 pnpm --filter api-server run dev
```
In a second shell:
```bash
PORT=5174 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 \
  VITE_POSTHOG_KEY=phc_local_dummy_key VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 \
  pnpm --filter studio run dev
```

The two `VITE_*` dummies are **required, not a workaround**: without them `posthog-analytics.spec.ts` and `sentry-capture.spec.ts` fail environmentally and look like real breakage. Both stub the ingest host before any request leaves the page, and the DSN need only be syntactically valid.

- [ ] **Step 3: Rewrite each spec**

`max-coverage.spec.ts` — the single form: no step toggle, no `Solve Step N` label (now `Run Optimizer`), the new mile defaults (450 / 3400 / 650, bands 450/900/1800/3400), and the floor input driving which model runs. Assert the derived-model line.

**The restored result-history stepper is ALREADY covered at unit level — do not
duplicate it here.** Recorded after Task 2's review and corrected after its fix
commit. Removing the two-step workflow restored three things Chapter 4 was denied
(the stepper, the solve-timing display, unfrozen editing), and the deleted unit
tests only ever asserted the OLD behaviour, so nothing positively pinned the new.
Task 2's fix commit (`2b391b9`) closed that gap entirely in `Workspace.test.tsx`:
the `"Run Optimizer"` label, the stepper rendering for `max-coverage-us` on a real
one-entry history, and unfrozen dialog editing. An earlier draft of this line
claimed the stepper's solved-history precondition was awkward to reach in jsdom and
assigned it here; that was wrong — the implementer reached it with the file's own
existing history-building helper. Add an e2e stepper assertion only if it falls out
of a spec you are already rewriting; it is not required work.

`chen-bands-units-qa.spec.ts` — km→mi labels and values throughout.

`nonjade-servicestats-live-coverage.spec.ts` — Chapter 4 field names; the coverage KPIs have moved to Solution Summary, so its Service Stats assertions become band-graph-only.

Use `readSolvedAt` from `e2e/helpers/solvedAt.ts` for solve completion — never re-declare it. Capture the value **before** triggering and poll until it differs; polling for non-null is wrong because an already-solved scenario starts non-null.

Commit a distance draft via **blur** (click a neighbouring field), not `.press("Enter")` — Enter reliably races Radix's dialog auto-focus. Bound any interaction following a dialog opening or a disabled-state transition with an explicit `{ timeout }`, or a 10-second problem becomes a full-test timeout surfacing at an unrelated later line.

- [ ] **Step 4: Run the gate and read the REPORT**

```bash
pnpm e2e:gate
python3 -c "import json; s=json.load(open('artifacts/studio/e2e/report/results.json'))['stats']; print(s)"
```
Expected: `unexpected: 0`. Note `flaky` too — a gate green only because retries absorbed a sixth of the suite is not a green gate.

Known e2e flakes to re-run in isolation rather than chase: `workspace-fixups-2.spec.ts`, the `chen-bands-units-qa` case, `bundle5-homepage-distances.spec.ts`, `jade-two-echelon.spec.ts`, `nonjade-servicestats-live-coverage.spec.ts:279`, `delivery-teaching.spec.ts`.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/e2e
git commit -m "[CH4O-12] rewrite the Chapter 4 e2e specs for the single-form miles UI"
```

---

## Task 13: Close out the branch

**Spec:** §5, §6a, hard rule #9.

**Files:**
- Modify: `docs/CHANGELOG-implementation.md`, `CLAUDE.md`

- [ ] **Step 1: Run the complete gate — nothing else running, commands separate**

```bash
ps aux | grep "[v]itest" | grep -vc "zsh -c"   # must print 0
pnpm run typecheck
pnpm --filter api-server test
pnpm --filter studio test
(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
(cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py)
(cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 auth)
```
Expected: all PASS; `e2e_accuracy.py` `99/99`. Record the counts. The last two are standalone scripts, **not** pytest-discovered — the pytest command does not run them.

- [ ] **Step 2: Append the changelog entry**

Append to the **bottom** of `docs/CHANGELOG-implementation.md`: task ids and commit SHAs, gate counts, the recomputed pytest goldens with the commands that produced them, the five Codex review rounds and what each found, and the deviations (notably the migration's host package). Hard rule #9: narrative goes here; `CLAUDE.md` gets only a hyperlink.

- [ ] **Step 3: Lift the durable lessons into `CLAUDE.md`'s Gotchas**

Four earned here, each a distilled rule with no narrative:

- A unit migration must convert **every** unit-bearing value in a persisted blob, not just the obvious scalars — `distanceOverrides[].distance` is overlaid directly onto the base matrix and, for an added entity, is the only record of that distance.
- A server-derived field needs its derivation on **every** write path. Create, clone and update are three sites; a derivation on the update path alone either 422s every create or persists nothing.
- A precheck that short-circuits before the solver makes solver-side error attribution unreachable for anything the precheck already catches. Put co-equal bounds in one place that returns a list.
- **A change crossing a layer boundary is one commit.** Schema, solver, payload builder, fixtures and frontend defaults speak one contract; splitting a contract change guarantees a broken intermediate commit. Corollaries: remove consumers before producers, and a new closed-union error code is a change in three places (TS union, OpenAPI enum, generated client).

- [ ] **Step 4: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add docs/CHANGELOG-implementation.md CLAUDE.md
git commit -m "[CH4O-13] record the Chapter 4 overhaul and its durable lessons"
```

- [ ] **Step 5: Invoke the finishing skill, then STOP**

Invoke `superpowers:finishing-a-development-branch`. It owns the end-of-branch decision; running it is what makes that decision deliberate.

Then **stop and prompt for approval to merge.** A hard stop, not a notification. Pipeline steps 3–7 each need their own explicit yes: merge, then whole-branch review on the merged state, then push, then — separately — any deploy. Approval for one step is never approval for the next.

When the deploy question arrives: this branch touches `solvers/**`, so **`nos-api` needs redeploying as well as `nos-studio`** — `solvers/*/manifest.json` is read at boot by `registry/modelRegistry.ts:47` and baked into the API image by `Dockerfile:16`. Do not conclude "frontend-only" from a pathspec over `artifacts/api-server lib/db lib/api-spec`; that exact mistake shipped a stale model name once already. Check `list_deploys` after any push — the commit webhook does not fire for either service.

The production migration (Task 9's runbook) is yet another separate approval —
**and its ORDER relative to the deploy is load-bearing.** Added after Task 5
escalated the underlying fact.

From Task 5 onward, `coverageFloorDemand` is unconditionally required. Every
Chapter 4 row written before that commit lacks it, so a deployed server running
the new code against an unmigrated database will **422 on save and refuse to
solve every pre-existing Chapter 4 scenario.** Task 9's migration is what fixes
those rows (it defaults an absent floor to `0`), so:

> Run the migration BEFORE or IN THE SAME WINDOW as the `nos-api` deploy. Never
> deploy the new code and leave the migration for later.

Verified locally at Task 5's commit: all 5 `max-coverage-us` rows in `nos_dev`
lack `coverageFloorDemand` and lack `highServiceDistMi`, so the migration's
presence-key picks every one of them up. Production's count is unmeasurable from
an agent session (see Task 9) — measure it with `psql` from an allowlisted host
before deciding the window.

Between Task 5 and Task 9 the local dev database's Chapter 4 scenarios are
expected to be unusable. That is a transient development state, not a defect, and
it is why the migration is not optional.

- [ ] **Step 6: Run the retro**

`/harness-retro CH4O` — the branch is not finished until this has run.

---

## Follow-ups this branch creates but does not close

Surfaced by Task 8's review and scoped in ITS words, because my own framing
under-stated two of the three. None blocks the branch; all three are real. Carry
these into the final whole-branch review's triage.

### FU-1 — The api-server has no non-mi model, so 13 unit-threading sites are now unobservable

Chapter 4 was the repo's only kilometre-canonical model. With it converted, **13
production sites** reading `manifest.distanceUnit ?? "mi"` are behaviourally
indistinguishable from a bare `"mi"` literal:

`solver/jobRunner.ts:1404`, `registry/modelRegistry.ts:115`,
`routes/referenceDistances.ts:48`, `routes/referenceCosts.ts:33`,
`routes/solveHistory.ts:94`, `routes/scenarios.ts:767,943,1022,1107,1216,1328`,
`services/import.ts:456`.

Worse: `distanceUnit` is `.optional()` in `ManifestSchema`
(`lib/dataset-schema/src/index.ts:279`), so **the `?? "mi"` fallback branch itself
is unobservable** — a manifest that silently *drops* `distanceUnit` now produces
correct behaviour for all seven models.

**Correction to how this was first recorded.** Two tests' lost teeth do NOT
"return automatically the day a non-mi model is added" — the surviving test is
pinned to `max-coverage-us` via its own fixture row, so a new km model would need
a new fixture and this test would never notice it. Teeth return only if *Chapter
4's own* unit becomes non-mi, which will not happen.

The frontend already solved this with a synthetic entry (`synthetic-km-model` in
`ServiceStatsTab.test.tsx`, precedent `two-echelon-fake-km`); the api-server never
got the equivalent. The fix is a module-level test seam shaped like
`middlewares/lockedModel.ts`'s `setLockedModelsForTests`, which restores all 13 at
once. **Size it against 13 sites, not 2 tests.**

### FU-2 — Import does not round unit-converted values; export does. THREE sites.

`roundForFile` wraps all 11 export counterparts in `services/templates.ts`.
Import has **three** unrounded `fromDisplay` sites — not one:
`services/import.ts:1095` (distances), `:1190` (laneCosts), `:1283` (legDistances).

**Verified downstream consequence.** Change detection at `import.ts:1104` is an
exact `beforeValue !== parsedDistance`. A km-sourced import stores
`62.13711922373339`; the next same-unit export emits `roundForFile` → `62.1371`;
re-importing that file reports a **spurious change on a row nobody edited**, and
the DistancesTab changed-row highlight fires. That is precisely this repo's
standing "compare in display space at `roundForFile`'s 4 dp" gotcha.

Why no test ever caught it: `160.9344 / 1.609344 === 100` **exactly** in IEEE-754,
so the mi→km→mi direction is lossless. km→mi is not, which is why converting
Chapter 4 exposed it.

Pre-existing, model-agnostic, and the fix changes stored values for every model
across three entities — correctly NOT a Chapter 4 units task's business. Needs a
product decision: round on import to match export, leave it, or round at the
comparison sites.

### FU-3 — Minor hygiene

The `62.13711922373339` assertion added in Task 8 pins a float repr. Fine on V8,
but it reads as a chosen precision when it is actually "the unrounded
`fromDisplay` output" — worth a one-line comment saying so.

---

## Self-Review

**Spec coverage:**

| Spec § | Task |
|---|---|
| §2.1 units + dataset | 8 |
| §2.2 schema | 5 |
| §2.3 derivation, guard, three write paths | 1, 3, 5 |
| §2.4 solver + attribution | 5 (solver), 6 (both bounds) |
| §2.5 defaults | 8 |
| §3.0 registration points | 3 (docs), 7 (point 12), 8 (point 2) |
| §3.1 deletions | 2, 3 |
| §3.2 API contract | 4 |
| §3.3 modified files | 5, 6, 8, 11 |
| §3.4 migration | 9 |
| §4.1 tab parity + explicit case | 7 |
| §4.2 frontend deletions | 2 |
| §4.3 the form | 7 |
| §4.4 output reports | 10 |
| §4.5 CSV | 11 |
| §4.6 validation surfacing | 7 |
| §5.1 recomputed goldens | 8 |
| §5.2 new tests | every task's Step 1 |
| §5.3 sibling e2e | 12 |
| §5.4 flakes | global constraints + 3 (list edit) |
| §6a review history | 13 (changelog) |

**Every task leaves the gate green**, by construction: consumers are removed before producers (2 → 3 → 4), and each contract change is a single task (5, 6, 8). The previous draft had two declared-red commits and a chained verification command that silently skipped the suite it claimed passed; both are gone.

**Placeholder scan:** no `TBD`/`TODO`, no "similar to Task N", no step that describes a code change without showing the code.

**Type consistency:** `deriveMaxCoverageObjective` (Task 1) is used in 5, 7, 9. `deriveServerOwnedInputs` (Task 3) in 5. `assertNoServerOwnedFields` (Task 5) replaces `assertNoServerOwnedStepFields`. `scenarioObjectiveMode` (Task 2) replaces `scenarioObjectiveModeCh4Aware`. `MigrateResult` / `migrateInputs` / `migrateAll` / `MigrateReport` (Task 9) match the test file, and `expectOk` exists because `expect(r.ok)` does not narrow a union. `buildCostSummaryRows` is **plural and returns an array** (Task 11). `COST_SUMMARY_TEMPLATE_VERSION` is distinct from `OUTPUT_TEMPLATE_VERSION`.

**Line-number discipline:** stated in the global constraints and repeated in Task 10, the one task whose target file an earlier task shifted.
