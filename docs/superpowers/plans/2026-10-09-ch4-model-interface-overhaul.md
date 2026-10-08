# Chapter 4 Model Interface Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `max-coverage-us`'s two-step solve workflow with a single form and one solve per scenario whose objective is derived from the coverage floor, make the model miles-canonical, and move its coverage metrics onto Solution Summary.

**Architecture:** Three phases, each leaving the full verification gate green. Phase 1 removes the two-step machinery and derives the objective — all still in kilometres, so no rename churn mixes with behavioural change. Phase 2 converts the model to miles-canonical in one atomic rename across every layer (a rename cannot be half-approved). Phase 3 moves the output reports. The spec is `docs/superpowers/specs/2026-10-09-ch4-model-interface-overhaul-design.md`; every task below cites the spec section it implements.

**Tech Stack:** pnpm monorepo. Express 5 + Drizzle (Postgres, `drizzle-kit push`, no migration files) in `artifacts/api-server`; React + Vite + Radix + wouter + TanStack Query in `artifacts/studio`; Python 3 + PuLP/CBC in `artifacts/api-server/src/solver`; contract-first OpenAPI + Orval codegen in `lib/api-spec` → `lib/api-zod` + `lib/api-client-react`.

## Global Constraints

- **Branch:** all work on `ch4-model-upgrade`. Before every `git commit`, assert you are not on `main`:
  `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`
- **One task = one commit.** Message format `[<task-id>] <imperative summary>`, e.g. `[CH4O-5] invert the scenario write guard`.
- **Never edit generated code.** `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` come from Orval. Change `lib/api-spec/openapi.yaml`, re-run codegen, commit spec + regenerated output in the same commit.
- **`e2e_accuracy.py` is sacred** and has **no Chapter 4 section** (verified: zero `max-coverage` references). Its expected count stays **99/99**. Do not modify it. Chapter 4's accuracy lives in `test_max_coverage.py`.
- **Solver changes enter as data, not branches** — business rules become variable bounds or coefficient changes in the PuLP model, never new `if`/`else` code paths.
- **Verification gate** — run before considering any task done:
  ```bash
  pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
    && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
  ```
- **Local DB:** no `DATABASE_URL` in the environment. Pass inline per command:
  `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"`
- **Known flakes — re-run in isolation before treating as a regression.** Read the current list in `CLAUDE.md`, not a remembered copy. Touched by this work: `routes`, `resultEnvelope`, `jobRunner`, `importMultiModelRoundTrip`, `crossModelStepContract`, `maxCoverageStepWorkflow`. **`precheck` is NOT on that list** — a `precheck` failure here is a real finding.
- **Before trusting a full studio-suite result, require zero concurrent vitest runs:**
  `ps aux | grep "[v]itest" | grep -vc "zsh -c"` must print `0`. Not `grep -c "[v]itest"`, which matches the agent's own wrapper and reports 2 when the answer is 0.
- **No production database writes.** The migration script is written and tested against local Postgres only. Running it against production is a separate, separately-approved operation (Task 18).
- **Constants, exact values:** `MI = 1.609344`. Longest warehouse→customer pair = **3219 mi** (= 5180.478336 km). `MAX_COVERAGE_CIRCUITY = TRANSPORT_CIRCUITY = 1.17`. `p` max = **26**.
- **New defaults (miles), Phase 2:** `highServiceDistMi: 450`, `maxDistMi: 3400`, `avgServiceDistCapMi: 650`, `coverageFloorDemand: 0`, `distanceBands: [450, 900, 1800, 3400]`, `p: 3`. `maxDistMi` must stay above 3219. `highServiceDistMi` must never equal `avgServiceDistCapMi` (`Workspace.test.tsx` has a guard test).

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `artifacts/api-server/src/migrations/ch4ToMiles.ts` | One-off km→mi migration of persisted `inputs`; exported pure functions so it is unit-testable. In api-server, not `scripts/`, because it must import the model's Zod validator (see Task 12) |
| `artifacts/api-server/src/migrations/__tests__/ch4ToMiles.test.ts` | Migration unit + real-Postgres tests |
| `docs/ops/ch4-miles-migration-runbook.md` | Human-gated production staging for the migration |

**Deleted files:**

| Path | Why |
|---|---|
| `artifacts/api-server/src/services/maxCoverageSteps.ts` | Epoch authority + step summaries. One export moves out first (Task 4) |
| `artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts` | — |
| `artifacts/api-server/src/services/__tests__/maxCoverageStepsBatch.test.ts` | — |
| `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts` | — |
| `artifacts/api-server/src/__tests__/crossModelStepContract.test.ts` | Registration point 18 — retires with the feature |
| `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts` | Replaced by the inverted-guard test |
| `artifacts/studio/src/components/workspace/StepToggle.tsx` | — |
| `artifacts/studio/src/components/workspace/StepComparisonTable.tsx` | — |
| `artifacts/studio/src/hooks/useMaxCoverageSteps.ts` | — |
| `artifacts/studio/src/__tests__/StepToggle.test.tsx` | — |
| `artifacts/studio/src/__tests__/StepComparisonTable.test.tsx` | — |
| `artifacts/studio/e2e/ch4-two-step.spec.ts` | — |

**Heavily modified:** `validation/inputs/maxCoverage.ts`, `services/scenarioInputWrite.ts`, `services/precheck.ts`, `services/templates.ts`, `services/autoDistance.ts`, `solver/solve.py`, `solver/pmedian.ts`, `solver/jobRunner.ts`, `routes/scenarios.ts`, `lib/api-spec/openapi.yaml`, `lib/units/src/objective.ts`, `studio/src/pages/Workspace.tsx`, `studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`, `studio/src/components/workspace/tabs/CostSummaryTab.tsx`, `studio/src/components/workspace/tabs/ServiceStatsTab.tsx`, `studio/src/components/workspace/SolveDialog.tsx`, `studio/src/lib/formatObjective.ts`, `studio/src/components/ObjectiveBar.tsx`.

---

# PHASE 1 — Remove the two-step workflow (still kilometres)

Nothing in Phase 1 touches units or field names. Every task leaves the gate green.

---

## Task 1: Shared objective derivation

**Spec:** §2.3, §4.3 (the shared home).

**Files:**
- Modify: `lib/units/src/objective.ts`
- Modify: `lib/units/src/index.ts`
- Test: `lib/units/src/__tests__/objective.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `deriveMaxCoverageObjective(coverageFloorDemand: number): "coverage" | "min_distance"`, exported from `@workspace/units`.

Why here: `@workspace/units` is already a dependency of both `artifacts/api-server` (`package.json:21`) and `artifacts/studio` (`package.json:73`), and `objective.ts` already owns this model's objective-mode semantics. No new package.

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
  // keys Chapter 4's unit semantics off this same string. A drift here renders
  // a coverage percent as a demand-distance.
  it("produces modes objectiveDimension already understands", () => {
    expect(objectiveDimension("max-coverage-us", deriveMaxCoverageObjective(0))).toBe("percent");
    expect(objectiveDimension("max-coverage-us", deriveMaxCoverageObjective(100))).toBe("demand-distance");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/units test -- objective`
Expected: FAIL — `deriveMaxCoverageObjective is not a function` / import error.

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

In `lib/units/src/index.ts`, add `deriveMaxCoverageObjective` to the existing `./objective.js` export list.

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

## Task 2: Solver — derive the mode, and make the cap bind in both objectives

**Spec:** §2.4.

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py:1441-1538` (`solve_max_coverage`)
- Test: `artifacts/api-server/src/solver/tests/test_max_coverage.py`

**Interfaces:**
- Consumes: nothing from Task 1 (Python cannot import TypeScript).
- Produces: `solve_max_coverage` requires `inp["coverageFloorDemand"]` and `inp["avgServiceDistCapKm"]` unconditionally; `details["objective"]` now echoes the locally-derived mode.

Two changes only. The average-distance cap **hoists out of** the objective branch, and `mode` is derived from the floor instead of read from `inp["objective"]`. No new code path — hard rule 6.

- [ ] **Step 1: Write the failing tests**

In `artifacts/api-server/src/solver/tests/test_max_coverage.py`, change `BASE` to carry both fields and add a cap-binding class. `BASE` becomes:

```python
BASE = {"modelType": "max_coverage_us", "p": 3, "highServiceDistKm": 700, "maxDistKm": 5500,
        "avgServiceDistCapKm": 1000, "coverageFloorDemand": 0,
        "gap": 0.0, "timeLimitSec": 60, "warehouseOverrides": [], "customerOverrides": [],
        "addedWarehouses": [], "addedCustomers": [], "distanceOverrides": []}
```

Then append:

```python
class TestCapBindsInBothModes:
    """The average-distance cap is a constraint in min_distance mode too.

    A loose cap must leave the known min-distance optimum untouched -- the
    optimum's own weighted average is 624.33 km, so a 1000 km cap cannot bind.
    That is the sanity check distinguishing a units artifact from a real
    modelling error.
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
        # Either a different feasible solution respecting the cap, or a truthful
        # infeasible -- never the unconstrained optimum, which violates the cap.
        if r["status"] == "optimal":
            assert r["metrics"]["weightedAvgDistance"] <= tight_cap + 0.01
            assert r["metrics"]["weightedAvgDistance"] != pytest.approx(loose["metrics"]["weightedAvgDistance"], abs=0.01)
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

Also delete the now-invalid `"objective": "coverage"` / `"objective": "min_distance"` keys from every existing `run({**BASE, ...})` call in this file, and add an explicit `"coverageFloorDemand"` where a test means min-distance. The existing `test_min_distance`-style case keeps its `coverageFloorDemand: 53385024`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_max_coverage.py -x -k "CapBinds or ModeDerived" -v
```
Expected: FAIL — `test_tight_cap_changes_the_min_distance_solution` returns the unconstrained optimum (cap ignored in min-distance mode), and `TestModeDerivedFromFloor` reads the forwarded input value.

- [ ] **Step 3: Write the implementation**

In `solve.py`, replace lines 1474-1483 (from `mode = inp["objective"]` through the `else:` block's floor constraint) with:

```python
    # The objective is DERIVED from the coverage floor, never read from
    # inp["objective"] -- and details.objective echoes this locally-derived
    # value (see the _envelope call's details dict below). Forwarding the input
    # while branching on the floor would let the envelope be labelled one model
    # and computed as the other, with nothing to catch it.
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

Delete the old `prob = LpProblem(...)` / `a = ...` / `o = ...` lines at 1475-1477 that this block replaces (they move above the cap constraint).

Then update the infeasible message at 1496-1500 to name both candidates:

```python
    if st == "Infeasible":                                            # D17: mathematical infeasibility ONLY
        return _envelope("infeasible", "infeasible", 0, round(time.time() - t, 2), [],
                         _EMPTY_METRICS, _EMPTY_DETAILS,
                         "No feasible assignment under the constraints — the coverage "
                         "floor and the average-distance cap are both candidates",
                         termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                         solver_incumbent_objective=cbc.solverIncumbentObjective,
                         solver_best_bound=cbc.solverBestBound)
```

`details` at 1530-1533 keeps `"objective": mode` — it already echoes the local variable, which is now the derived one. No change needed there; confirm it reads `mode`, not `inp["objective"]`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_max_coverage.py -v
```
Expected: PASS, all cases.

Then the sacred script, which must be unaffected:
```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```
Expected: `99/99`. If this changes, stop — the change touched a model it must not.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/tests/test_max_coverage.py
git commit -m "[CH4O-2] derive the max-coverage mode from the floor and bind the cap in both"
```

---

## Task 3: Precheck — add the cap bound, drop the mode guard on the floor bound

**Spec:** §2.4 (attribution lives entirely here), §3.3.

**Files:**
- Modify: `artifacts/api-server/src/services/precheck.ts:306-332`
- Test: `artifacts/api-server/src/__tests__/precheck.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a new precheck error code `avg_distance_cap_infeasible`. `coverage_floor_infeasible` keeps its code and fires regardless of `inputs.objective`.

Both infeasibility bounds live here, not split with `solve.py`. `jobRunner.ts:410-413` returns `precheck_failed` before Python is ever spawned, so a cap check inside `solve.py` could never run when the floor bound fires. `runNetworkEditsPrecheckForModel` returns an error **list**, so both causes report together with no precedence rule to invent.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/__tests__/precheck.test.ts` (match the file's existing helper for building max-coverage inputs):

```ts
describe("max-coverage-us — infeasibility attribution", () => {
  it("names the cap when it is below the nearest-warehouse lower bound", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...baseMaxCoverageInputs,
      coverageFloorDemand: 0,
      avgServiceDistCapKm: 1,
    });
    expect(res.ok).toBe(false);
    expect(res.errors.map(e => e.code)).toContain("avg_distance_cap_infeasible");
  });

  it("names the floor when it exceeds coverable demand", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...baseMaxCoverageInputs,
      coverageFloorDemand: 500_100_100,
    });
    expect(res.ok).toBe(false);
    expect(res.errors.map(e => e.code)).toContain("coverage_floor_infeasible");
  });

  // The regression guard for the contradiction review found: with the cap check
  // in solve.py this was unreachable, because precheck short-circuits before
  // Python runs, so a both-violating scenario was attributed to the floor alone.
  it("names BOTH when both bounds are violated", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...baseMaxCoverageInputs,
      coverageFloorDemand: 500_100_100,
      avgServiceDistCapKm: 1,
    });
    expect(res.ok).toBe(false);
    const codes = res.errors.map(e => e.code);
    expect(codes).toContain("coverage_floor_infeasible");
    expect(codes).toContain("avg_distance_cap_infeasible");
  });

  // The old rule was gated on objective === "min_distance". A non-zero floor IS
  // min-distance mode now, and objective is server-derived, so gating on it
  // would make the rule depend on a field derived from the value being checked.
  it("applies the floor bound without consulting inputs.objective", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...baseMaxCoverageInputs,
      objective: "coverage",
      coverageFloorDemand: 500_100_100,
    });
    expect(res.errors.map(e => e.code)).toContain("coverage_floor_infeasible");
  });

  it("passes a scenario that violates neither bound", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...baseMaxCoverageInputs,
      coverageFloorDemand: 0,
      avgServiceDistCapKm: 1000,
    });
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api-server test -- precheck`
Expected: FAIL — `avg_distance_cap_infeasible` never appears; the `objective: "coverage"` case does not raise the floor error.

- [ ] **Step 3: Write the implementation**

In `precheck.ts`, change the floor rule's guard at line 321 from

```ts
  if (inputs.objective === "min_distance" && inputs.coverageFloorDemand != null) {
```

to

```ts
  // No `objective` guard: a non-zero floor IS min-distance mode (§2.3), and
  // `objective` is server-derived FROM this value, so gating on it would make
  // the rule depend on its own output.
  if (inputs.coverageFloorDemand != null && inputs.coverageFloorDemand > 0) {
```

Then add the cap rule immediately after that block, inside the same function:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api-server test -- precheck`
Expected: PASS. `precheck` is NOT a known flake — a failure here is real.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/services/precheck.ts artifacts/api-server/src/__tests__/precheck.test.ts
git commit -m "[CH4O-3] move both infeasibility bounds into the max-coverage precheck"
```

---

## Task 4: Move the create/clone derivation hook out of the doomed file

**Spec:** §2.3, §3.1.

**Files:**
- Modify: `artifacts/api-server/src/services/scenarioInputWrite.ts`
- Modify: `artifacts/api-server/src/services/maxCoverageSteps.ts:5,53-59` (remove the two moved exports)
- Modify: `artifacts/api-server/src/routes/scenarios.ts:84,239,2021`
- Test: `artifacts/api-server/src/__tests__/` (existing suites must stay green; no new test here)

**Interfaces:**
- Consumes: nothing.
- Produces: `deriveServerOwnedInputs(modelId: string, inputs: Record<string, unknown>): Record<string, unknown>` and `MAX_COVERAGE_MODEL_ID`, both exported from `services/scenarioInputWrite.ts`.

A pure refactor with no behaviour change: `initialInputsForInsert` is defined in `maxCoverageSteps.ts`, which Task 7 deletes, but §2.3 keeps it as the create/clone derivation hook. Moving it first means Task 7 can delete its file outright.

- [ ] **Step 1: Move the function and the constant**

Cut from `maxCoverageSteps.ts` and paste into `scenarioInputWrite.ts` (above `applyScenarioInputWrite`), renamed:

```ts
export const MAX_COVERAGE_MODEL_ID = "max-coverage-us";

// The create/clone half of the write contract. `applyScenarioInputWrite` below
// is the UPDATE half; both must derive the same server-owned fields, or a field
// exists on updated rows and not on created ones. Task 5 fills in the real
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

Delete `maxCoverageSteps.ts`'s own `MAX_COVERAGE_MODEL_ID` (`:5`) and `initialInputsForInsert` (`:53-59`), and add `import { MAX_COVERAGE_MODEL_ID } from "./scenarioInputWrite.js";` there so its remaining functions still compile.

In `scenarioInputWrite.ts`, change the re-export line at `:113` from
`export { initialInputsForInsert, isStep1Key } from "./maxCoverageSteps.js";`
to
`export { isStep1Key } from "./maxCoverageSteps.js";`
and update its import at `:5` to `import { nextStepEpoch } from "./maxCoverageSteps.js";`.

In `routes/scenarios.ts`, change the import at `:84` to pull `deriveServerOwnedInputs` instead of `initialInputsForInsert`, and rename both call sites (`:239` insert, `:2021` clone).

- [ ] **Step 2: Run the full api-server suite to verify nothing changed**

Run: `pnpm run typecheck && pnpm --filter api-server test`
Expected: PASS, with the same counts as before this task. This is a rename; any behavioural diff means something was missed.

- [ ] **Step 3: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/services/scenarioInputWrite.ts artifacts/api-server/src/services/maxCoverageSteps.ts artifacts/api-server/src/routes/scenarios.ts
git commit -m "[CH4O-4] move the create/clone derivation hook into scenarioInputWrite"
```

---

## Task 5: Schema rewrite, derived objective at all three write sites, inverted guard

**Spec:** §2.2, §2.3.

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/maxCoverage.ts`
- Modify: `artifacts/api-server/src/services/scenarioInputWrite.ts`
- Modify: `solvers/max-coverage-us/manifest.json` (`inputsSchema` only — units stay km until Phase 2)
- Test: `artifacts/api-server/src/validation/inputs/__tests__/maxCoverage.test.ts` (rewrite)
- Test: `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts` (rewrite)

**Interfaces:**
- Consumes: `deriveMaxCoverageObjective` (Task 1), `deriveServerOwnedInputs` + `MAX_COVERAGE_MODEL_ID` (Task 4).
- Produces: `maxCoverageInputsSchema` with `avgServiceDistCapKm` and `coverageFloorDemand` both unconditionally required and `objective` optional; `assertNoServerOwnedFields(modelId, rawInputs): string | null`.

Ordering is fixed: **validate → derive → persist**, at all three sites. The derivation reads `coverageFloorDemand`, and only validation guarantees it is an integer.

- [ ] **Step 1: Write the failing tests**

Rewrite `validation/inputs/__tests__/maxCoverage.test.ts`'s objective-discrimination block. The existing tests assert the **inverse** of the new rule, so they are replaced, not renamed:

```ts
describe("maxCoverageInputsSchema — both mode fields unconditionally required", () => {
  it("rejects a payload missing avgServiceDistCapKm, even with a zero floor", () => {
    const r = maxCoverageInputsSchema.safeParse({ ...valid, avgServiceDistCapKm: undefined, coverageFloorDemand: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects a payload missing coverageFloorDemand", () => {
    const r = maxCoverageInputsSchema.safeParse({ ...valid, coverageFloorDemand: undefined });
    expect(r.success).toBe(false);
  });

  it("accepts a zero floor with a cap (Model 1)", () => {
    const r = maxCoverageInputsSchema.safeParse({ ...valid, coverageFloorDemand: 0 });
    expect(r.success).toBe(true);
  });

  it("accepts a positive floor with a cap (Model 2)", () => {
    const r = maxCoverageInputsSchema.safeParse({ ...valid, coverageFloorDemand: 53385024 });
    expect(r.success).toBe(true);
  });

  it("keeps the high < max invariant", () => {
    const r = maxCoverageInputsSchema.safeParse({ ...valid, highServiceDistKm: 5500, maxDistKm: 700 });
    expect(r.success).toBe(false);
  });

  it("no longer carries stepEpoch or step2", () => {
    const r = maxCoverageInputsSchema.parse({ ...valid, stepEpoch: 7, step2: { gap: 1, timeLimitSec: 9 } });
    expect(r).not.toHaveProperty("stepEpoch");
    expect(r).not.toHaveProperty("step2");
  });
});
```

Rewrite `__tests__/maxCoverageWriteGuard.test.ts` — the guard inverts:

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

describe("the derived objective reaches all three write paths", () => {
  it("persists a derived objective on CREATE without the client sending one", async () => {
    const created = await createScenario({ modelId: "max-coverage-us", inputs: { ...valid, coverageFloorDemand: 0 } });
    expect((created.inputs as Record<string, unknown>).objective).toBe("coverage");
  });

  it("persists a derived objective on CREATE for a positive floor", async () => {
    const created = await createScenario({ modelId: "max-coverage-us", inputs: { ...valid, coverageFloorDemand: 500 } });
    expect((created.inputs as Record<string, unknown>).objective).toBe("min_distance");
  });

  it("persists a derived objective on CLONE", async () => {
    const src = await createScenario({ modelId: "max-coverage-us", inputs: { ...valid, coverageFloorDemand: 500 } });
    const clone = await cloneScenario(src.id);
    expect((clone.inputs as Record<string, unknown>).objective).toBe("min_distance");
  });

  it("re-derives on UPDATE when the floor changes", async () => {
    const s = await createScenario({ modelId: "max-coverage-us", inputs: { ...valid, coverageFloorDemand: 0 } });
    const updated = await patchScenarioInputs(s.id, { ...valid, coverageFloorDemand: 500 });
    expect((updated.inputs as Record<string, unknown>).objective).toBe("min_distance");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api-server test -- maxCoverage`
Expected: FAIL — the schema still discriminates on `objective`; the guard still refuses `coverageFloorDemand` and accepts `objective`; create/clone still write `stepEpoch`.

- [ ] **Step 3: Rewrite the schema**

In `validation/inputs/maxCoverage.ts`: delete `step2ParamsSchema` entirely; in the main object, make `avgServiceDistCapKm` and `coverageFloorDemand` required, make `objective` optional, and delete `stepEpoch` and `step2`:

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

Delete both `avgServiceDistCapKm`/`coverageFloorDemand` branches from `.superRefine`, keeping only the `highServiceDistKm >= maxDistKm` check. Leave the `.transform` and `distanceOverrides` refinement untouched.

- [ ] **Step 4: Wire the derivation and invert the guard**

In `scenarioInputWrite.ts`, add `import { deriveMaxCoverageObjective } from "@workspace/units";` and complete `deriveServerOwnedInputs`:

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

Replace the `stepEpoch` computation at `:64-65` with the same call, and change `changed.delete("stepEpoch")` at `:85` to `changed.delete("objective")`:

```ts
  const inputsToStore: Record<string, unknown> = deriveServerOwnedInputs(persisted.modelId, normalized);
```

```ts
  // `objective` is derived from coverageFloorDemand, so it can never change
  // alone -- but leaving it in would misclassify a bands-only save as geometric
  // on the first write after the migration, which is where it first appears.
  changed.delete("objective");
```

Then rewrite the guard (renaming it) at `:134-148`:

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

Rename every `assertNoServerOwnedStepFields` call site (`routes/scenarios.ts:84` import plus its uses) to `assertNoServerOwnedFields`.

- [ ] **Step 5: Update the manifest's inputsSchema**

In `solvers/max-coverage-us/manifest.json`: delete `stepEpoch` and `step2` if present, move `avgServiceDistCapKm` and `coverageFloorDemand` into `required`, and remove `objective` from `required`. Units stay `km` and field names stay `...Km` — Phase 2 changes those.

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm run typecheck && pnpm --filter api-server test
```
Expected: PASS. Re-run any failure in isolation first — `routes` and `jobRunner` are known load flakes.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/validation/inputs/maxCoverage.ts artifacts/api-server/src/services/scenarioInputWrite.ts artifacts/api-server/src/routes/scenarios.ts solvers/max-coverage-us/manifest.json artifacts/api-server/src/validation/inputs/__tests__/maxCoverage.test.ts artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts
git commit -m "[CH4O-5] derive the objective server-side and invert the write guard"
```

---

## Task 6: Remove the step surfaces from the API contract

**Spec:** §3.2.

**Files:**
- Modify: `lib/api-spec/openapi.yaml:380-410,1639-1640,1671-1706`
- Regenerate: `lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`

**Interfaces:**
- Consumes: nothing.
- Produces: `Scenario` no longer carries `steps`; `ScenarioSteps`/`ScenarioStepState`/`ScenarioStepSummary` and `getScenarioStepResult` no longer exist in the generated client.

This task intentionally leaves the frontend red — Task 8 fixes it. `ObjectiveBar.tsx`'s `ScenarioSteps` type import is the expected first typecheck error, and that loudness is the point.

- [ ] **Step 1: Edit the spec**

Delete from `lib/api-spec/openapi.yaml`:
- the whole `/scenarios/{scenarioId}/steps/{step}/result` path item (from line 380 through the end of its `responses`)
- `Scenario`'s `steps` property (1639-1640)
- the `ScenarioStepSummary`, `ScenarioStepState` and `ScenarioSteps` schemas (1671-1706)

- [ ] **Step 2: Regenerate**

```bash
pnpm --filter @workspace/api-spec run codegen
```
Expected: writes `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/`. Never hand-edit either.

- [ ] **Step 3: Verify the generated client dropped the symbols**

```bash
grep -rn "ScenarioSteps\|getScenarioStepResult" lib/api-zod/src/generated lib/api-client-react/src/generated || echo "CLEAN"
```
Expected: `CLEAN`.

- [ ] **Step 4: Confirm the expected breakage**

```bash
pnpm run typecheck
```
Expected: FAIL, naming `artifacts/studio/src/components/ObjectiveBar.tsx` (and `Workspace.tsx`, `useMaxCoverageSteps.ts`, `Studio.tsx`) for the removed `ScenarioSteps` type. Record which files it names — Task 8 must clear exactly those.

- [ ] **Step 5: Commit (spec + generated together)**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "[CH4O-6] remove the per-step result surfaces from the API contract"
```

---

## Task 7: Delete the server-side step machinery

**Spec:** §3.1, §3.3.

**Files:**
- Delete: `artifacts/api-server/src/services/maxCoverageSteps.ts`
- Delete: `artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts`
- Delete: `artifacts/api-server/src/services/__tests__/maxCoverageStepsBatch.test.ts`
- Delete: `artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts`
- Delete: `artifacts/api-server/src/__tests__/crossModelStepContract.test.ts`
- Modify: `artifacts/api-server/src/routes/scenarios.ts:85,200-205,270-277,279-300`
- Modify: `artifacts/api-server/src/solver/jobRunner.ts:35-37,419-447`
- Modify: `artifacts/api-server/src/services/scenarioInputWrite.ts:5,113`
- Modify: `model-integration-precheck.md` (strike point 18)
- Modify: `CLAUDE.md` (flake list)

**Interfaces:**
- Consumes: `MAX_COVERAGE_MODEL_ID` from `scenarioInputWrite.ts` (Task 4).
- Produces: `jobRunner`'s enqueue has no per-model branch — `solveInputs` is `validation.data` for every model.

- [ ] **Step 1: Delete the five files**

```bash
git rm artifacts/api-server/src/services/maxCoverageSteps.ts \
       artifacts/api-server/src/services/__tests__/maxCoverageSteps.test.ts \
       artifacts/api-server/src/services/__tests__/maxCoverageStepsBatch.test.ts \
       artifacts/api-server/src/solver/__tests__/maxCoverageStepWorkflow.test.ts \
       artifacts/api-server/src/__tests__/crossModelStepContract.test.ts
```

- [ ] **Step 2: Clear the route references**

In `routes/scenarios.ts`: delete the `maxCoverageSteps.js` import (`:85`) and add `MAX_COVERAGE_MODEL_ID` to the existing `scenarioInputWrite.js` import; delete the `ch4Rows` filter and `loadScenarioStepsBatch` call on the list route (`:200-205`) and the `steps` merge onto its response rows; delete the `loadScenarioSteps` call and `steps` merge on the single-scenario read (`:270-277`); delete the whole `router.get("/scenarios/:scenarioId/steps/:step/result", ...)` handler (`:279-300`).

Keep the `MAX_COVERAGE_DATASET` import and the distance-stub path at `:1265` — unrelated to steps.

- [ ] **Step 3: Clear the jobRunner branch**

In `jobRunner.ts`: delete the `maxCoverageSteps.js` import block (`:35-37`), then delete the entire `if (scenario.modelId === MAX_COVERAGE_MODEL_ID) { ... }` block (`:419-447`) so the surrounding code reads:

```ts
    // The validated inputs ARE the solve inputs, for every model. The
    // max-coverage Step 2 synthesis that used to sit here is gone with the
    // two-step workflow.
    const solveInputs: Record<string, unknown> = validation.data as Record<string, unknown>;

    const input = { modelId: scenario.modelId, inputs: solveInputs } as SolveInput;
```

Remove any now-unused imports (`desc`, `solveJobsTable` may still be used elsewhere in the file — check before deleting).

- [ ] **Step 4: Clear the last re-export**

In `scenarioInputWrite.ts`: delete the `nextStepEpoch` import (`:5`) and the `export { isStep1Key } from "./maxCoverageSteps.js";` line (`:113`). Grep for remaining `isStep1Key` consumers and delete those too:

```bash
grep -rn "isStep1Key\|nextStepEpoch\|readStepEpoch\|synthesizeStep2Inputs\|deriveTargetStep\|loadScenarioSteps" artifacts/api-server/src || echo "CLEAN"
```
Expected: `CLEAN`.

- [ ] **Step 5: Update the two docs this task invalidates**

In `model-integration-precheck.md`: strike point 18 (`crossModelStepContract.test.ts`'s `NON_STEP_MODELS`) and renumber point 19 → 18. Update Gate 1's opening sentence from "nineteen" to "eighteen". Update the `[BLOCKER]` line that names `crossModelStepContract.test.ts`.

In `CLAUDE.md`: remove `maxCoverageStepWorkflow` and `crossModelStepContract` from the known-flake list (line 158). Fix the index row at line 16 from "the 10 registration points" to "the 18 registration points".

- [ ] **Step 6: Run the gate**

```bash
pnpm run typecheck && pnpm --filter api-server test
```
Expected: typecheck still fails on the **frontend** files Task 6 recorded (that is Task 8's job); api-server tests PASS.

To confirm api-server alone is clean:
```bash
pnpm --filter api-server run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A artifacts/api-server/src model-integration-precheck.md CLAUDE.md
git commit -m "[CH4O-7] delete the server-side two-step machinery"
```

---

## Task 8: Delete the frontend step machinery

**Spec:** §4.2.

**Files:**
- Delete: `artifacts/studio/src/components/workspace/StepToggle.tsx`
- Delete: `artifacts/studio/src/components/workspace/StepComparisonTable.tsx`
- Delete: `artifacts/studio/src/hooks/useMaxCoverageSteps.ts`
- Delete: `artifacts/studio/src/__tests__/StepToggle.test.tsx`
- Delete: `artifacts/studio/src/__tests__/StepComparisonTable.test.tsx`
- Delete: `artifacts/studio/e2e/ch4-two-step.spec.ts`
- Modify: `artifacts/studio/src/lib/formatObjective.ts:58-68`
- Modify: `artifacts/studio/src/components/ObjectiveBar.tsx:1,19,37,48`
- Modify: `artifacts/studio/src/pages/Studio.tsx:1083`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (many sites, listed below)
- Test: `artifacts/studio/src/__tests__/formatObjective.test.ts`, `Workspace.DisplayedInputs.test.tsx`

**Interfaces:**
- Consumes: Task 6's regenerated client (no `ScenarioSteps`).
- Produces: `scenarioObjectiveMode(input): string | null` in `formatObjective.ts`, replacing `scenarioObjectiveModeCh4Aware`.

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

In `formatObjective.ts`, replace `scenarioObjectiveModeCh4Aware` (`:58-68`) and its whole preceding comment block (`:36-57`) with:

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

Delete the `ScenarioSteps` type import at `:8`.

- [ ] **Step 3: Clear the two consumers**

In `ObjectiveBar.tsx`: delete the `ScenarioSteps` type import (`:1`), the `steps?: ScenarioSteps | null` prop (`:19`), its destructure (`:37`), and change `:48` to `const objectiveMode = scenarioObjectiveMode({ result });`.

In `Studio.tsx:1083`: delete the `steps={currentScenario?.steps ?? null}` prop from the `<ObjectiveBar>` call.

In `CostSummaryTab.tsx:162-163`: the thin `scenarioObjectiveMode` wrapper now wraps a function of the same name — delete the local wrapper and import `scenarioObjectiveMode` directly from `@/lib/formatObjective`.

- [ ] **Step 4: Clear Workspace.tsx**

Delete, in this order (line numbers from the pre-task file — re-grep as you go):

- the `useGetScenarioStepResult` / `getGetScenarioStepResultQueryKey` imports (`:19-20`) and the `useMaxCoverageSteps`, `StepToggle`, `StepComparisonTable` imports (`:75,77,78`)
- `step2FromInputs` / `step2GapFromInputs` / `step2TimeLimitSecFromInputs` (`:286-303`)
- `const stepState = useMaxCoverageSteps(currentScenario)` and `const [selectedStep, setSelectedStep] = useState<1 | 2>(1)` (`:1535-1536`) plus the snap-to-target effect (`:1537-1567`)
- `pendingStep1Inputs` state (`:1573`), `guardStep1Edit` (`:1587-1596`), `confirmStep1Edit` (`:1607-1620`) and the confirm dialog JSX (`:4718-4810`)
- all **17** `guardStep1Edit(...)` call sites — each becomes a direct `setLocalInputs(next)` / the mutation it was wrapping. Grep: `grep -n "guardStep1Edit" artifacts/studio/src/pages/Workspace.tsx`
- `selectedStepSolved`, the `useGetScenarioStepResult` query, and the `stepState.isMaxCoverage ? ... : ...` ternaries in `activeOutputResult` / `activeOutputInputs` / `activeOutputReady` (`:1904-1932`) — each collapses to its existing non-Ch4 branch
- `updateStep2Field` (`:2070`) and its two dispatch branches (`:2061-2062`)
- the Step 2 prop assembly (`:3402-3406`) and `step:` props on both `OptimizationParametersTab` mounts (`:3415`, `:3431`)
- the `stepState` conditions at `:3231`, `:4091`, `:4220`, `:4250`, `:4460-4461`, `:4529`, `:4577`, `:4610`, `:4625`, `:4643-4649` — each collapses to its non-Ch4 branch. In particular `:4577` becomes the literal `"Run Optimizer"`, `:4220` passes `displayedTiming` unconditionally, and `:4529` drops the `!stepState.isMaxCoverage &&` prefix so Chapter 4 regains the result-history stepper
- the `<StepComparisonTable>` render (`:4362-4372`), keeping the `costSummary` return it wrapped

- [ ] **Step 5: Update the two affected test files**

In `formatObjective.test.ts`: delete the `steps`-present cases and rename the remaining `scenarioObjectiveModeCh4Aware` references.
In `Workspace.DisplayedInputs.test.tsx`: delete the step-related cases.

- [ ] **Step 6: Run the gate**

```bash
ps aux | grep "[v]itest" | grep -vc "zsh -c"   # must print 0
pnpm run typecheck && pnpm --filter studio test
```
Expected: typecheck PASS (whole workspace green again), studio tests PASS. Studio vitest flakes under concurrent load from other sessions — if unrelated files time out together, re-run with zero concurrent runs before treating it as a regression.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A artifacts/studio/src artifacts/studio/e2e
git commit -m "[CH4O-8] delete the frontend two-step machinery"
```

---

## Task 9: Rebuild the Optimization Parameters form

**Spec:** §4.1, §4.3, §4.6.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`
- Modify: `artifacts/studio/src/components/workspace/SolveDialog.tsx:98,138,179-184`
- Modify: `artifacts/studio/src/pages/Workspace.tsx:148,314,1245-1322,3385`
- Test: `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`
- Test: `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx`

**Interfaces:**
- Consumes: `deriveMaxCoverageObjective` from `@workspace/units` (Task 1).
- Produces: `OptimizationParametersTab` with no `step*` props and no `objective` prop; the Chapter 4 block gated on `highServiceDistKm != null`.

**DO NOT touch `SolveDialog.tsx:170`.** That line is `<Slider step={1}>` — the P slider's numeric increment. Deleting it makes the slider continuous. `SolveDialog` has no `step` prop; Chapter 4 reaches this form through `paramsSlot`.

**DO NOT add a second `pMax` declaration.** Chapter 4's `26` lives at exactly one site, `Workspace.tsx:3384`, and `Workspace.test.tsx:2827` greps the source text asserting exactly one match. Even quoting the expression in a comment counts.

- [ ] **Step 1: Write the failing tests**

Append to `OptimizationParametersTab.test.tsx`:

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
    render(<UnitProvider><OptimizationParametersTab {...ch4Props} /></UnitProvider>);
    expect(screen.getByTestId("input-avg-service-cap")).toBeInTheDocument();
  });

  it("renders an editable coverage floor", () => {
    render(<UnitProvider><OptimizationParametersTab {...ch4Props} /></UnitProvider>);
    const floor = screen.getByTestId("input-coverage-floor");
    expect(floor).toBeEnabled();
    fireEvent.change(floor, { target: { value: "500" } });
    expect(ch4Props.onChange).toHaveBeenCalledWith("coverageFloorDemand", 500);
  });

  it("names Model 1 when the floor is zero", () => {
    render(<UnitProvider><OptimizationParametersTab {...ch4Props} coverageFloorDemand={0} /></UnitProvider>);
    expect(screen.getByTestId("derived-model-line")).toHaveTextContent(/Model 1/);
  });

  it("names Model 2 when the floor is positive", () => {
    render(<UnitProvider><OptimizationParametersTab {...ch4Props} coverageFloorDemand={500} /></UnitProvider>);
    expect(screen.getByTestId("derived-model-line")).toHaveTextContent(/Model 2/);
  });

  it("renders no Chapter 4 block for a model without the thresholds", () => {
    render(<OptimizationParametersTab p={3} gap={0} timeLimitSec={120} distanceBands={[200]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("chen-objective-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("derived-model-line")).not.toBeInTheDocument();
  });

  it("renders no step 2 panel", () => {
    render(<UnitProvider><OptimizationParametersTab {...ch4Props} /></UnitProvider>);
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
Expected: FAIL — no `input-coverage-floor`, no `derived-model-line`, the cap hidden without `objective === "coverage"`.

- [ ] **Step 3: Rewrite the component**

In `OptimizationParametersTab.tsx`:

1. Delete from `OptimizationParametersTabProps`: `objective`, `step`, `stepEditable`, `step2Gap`, `step2TimeLimitSec`, `coverageFloorFromStep1`. Add `coverageFloorDemand?: number;`.
2. Delete `step2Gap` / `step2TimeLimitSec` from the `OptimizationParametersField` union (`coverageFloorDemand` is already in it at `:31`).
3. Delete the `Lock` import (`:1`) — its only use was the deleted panel.
4. Delete the whole `{step === 2 && (...)}` panel (`:396-443`).
5. Delete all three `(step ?? 1) === 1 &&` guards (`:266`, `:312`, `:451`).
6. Change the Chapter 4 block's gate from `objective != null` to `highServiceDistKm != null`.
7. Remove the `objective === "coverage" &&` wrapper from the avg-cap field (`:366-391`) so it renders always.
8. Add the floor input and the derived-model line after the avg cap, inside the Chapter 4 block:

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
            <p className="mt-1 text-[11px] text-muted-foreground" data-testid={tid("derived-model-line")}>
              {deriveMaxCoverageObjective(coverageFloorDemand ?? 0) === "coverage"
                ? `Model 1 — maximize demand within ${highServiceDistKm} ${unitSuffix}, holding average distance at or under ${avgServiceDistCapKm} ${unitSuffix}`
                : `Model 2 — minimize average distance, covering at least ${(coverageFloorDemand ?? 0).toLocaleString()} demand within ${highServiceDistKm} ${unitSuffix}`}
            </p>
          </div>
```

Import `deriveMaxCoverageObjective` from `@workspace/units` — the same function the server derives with, so the label and the solve cannot disagree. `unitSuffix` is the already-resolved display unit string used by the sibling distance labels.

- [ ] **Step 4: Remove the client-side `objective` concept — five sites**

- `OptimizationParametersTab.tsx:120,215` — prop declaration and destructure (done in Step 3)
- `Workspace.tsx:148` — delete `objective: "coverage"` from `defaultInputsForModel`. **This is the one that breaks creation if missed:** Task 5's guard now *refuses* a client-sent `objective`, so leaving it makes every new Chapter 4 scenario 422.
- `Workspace.tsx:314` — delete `objectiveFromInputs`
- `Workspace.tsx:3385` — delete the `objective:` entry from the base props object
- `SolveDialog.tsx:98,138,179-184` — delete the `objective` prop, its destructure and the built-in objective panel. Unreachable: `objective` only ever existed for `max-coverage-us`, which routes through `paramsSlot` (`Workspace.tsx:4747`), so the panel never mounts.

Also add `coverageFloorDemand: coverageFloorDemandFromInputs(localInputs)` to the base props object, following the existing `gapFromInputs` reader pattern.

- [ ] **Step 5: Add the explicit tab case**

In `Workspace.tsx`'s `inputEntriesForModel` (`:1245`), add before the `p-median-brazil` tail:

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

- [ ] **Step 6: Run the gate**

```bash
ps aux | grep "[v]itest" | grep -vc "zsh -c"   # must print 0
pnpm run typecheck && pnpm --filter studio test
```
Expected: PASS.

Then confirm the `pMax` grep guard still holds:
```bash
pnpm --filter studio test -- Workspace.test
```
Expected: PASS, including `caps p at 26 in the single pMax declaration for max-coverage-us (MIG-8)`.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A artifacts/studio/src
git commit -m "[CH4O-9] rebuild Chapter 4's parameters form as one editable surface"
```

- [ ] **Step 8: Full gate before leaving Phase 1**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
Expected: all PASS. Phase 1 is complete and the two-step workflow is gone, still in kilometres.

---

# PHASE 2 — Miles-canonical conversion

The rename is **one atomic task** (Task 11) because it cannot be half-approved: renaming the validator without the solver and the frontend leaves the app 422-ing at runtime.

---

## Task 10: Regenerate the dataset in miles

**Spec:** §2.1.

**Files:**
- Modify: `scripts/src/build-max-coverage-dataset.ts:8-10,15,35`
- Regenerate: `solvers/max-coverage-us/dataset/{distances.json,version.json}`
- Modify: `lib/dataset-schema/src/maxCoverageDataset.test.ts:23`
- Modify: `solvers/max-coverage-us/manifest.json` (`distanceUnit`)

**Interfaces:**
- Consumes: nothing.
- Produces: `solvers/max-coverage-us/dataset/distances.json` holding p-median-us's exact integer miles; `manifest.distanceUnit === "mi"`.

The dataset is **generated**, not authored: the script builds it by multiplying p-median-us's integer miles by `MI2KM`. Dropping that multiply restores the integers exactly — verified, `601.894656 / 1.609344 = 374.0`, which is p-median-us's own `374`.

- [ ] **Step 1: Write the failing test**

In `lib/dataset-schema/src/maxCoverageDataset.test.ts`, retitle `:23` and add a value assertion:

```ts
  it("has all 5200 distance pairs, keyed '<warehouseId>,<customerId>' in miles", () => {
    expect(Object.keys(distances)).toHaveLength(5200);
  });

  // Miles-canonical (§2.1). The matrix IS p-median-us's integer-mile matrix, so
  // every value is a whole number and the longest pair is 3219 mi. Asserting the
  // VALUE, not just the manifest string -- a manifest that says "mi" over a km
  // matrix is the failure this catches.
  it("is integer miles, longest pair 3219", () => {
    const values = Object.values(distances) as number[];
    expect(values.every(v => Number.isInteger(v))).toBe(true);
    expect(Math.max(...values)).toBe(3219);
  });
```

Add to `lib/dataset-schema/src/manifest.test.ts`:

```ts
  it("declares max-coverage-us as miles-canonical", () => {
    expect(manifestFor("max-coverage-us").distanceUnit).toBe("mi");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/dataset-schema test`
Expected: FAIL — values are non-integer km, max is 5180.478336, manifest says `km`.

- [ ] **Step 3: Change the generator and regenerate**

In `scripts/src/build-max-coverage-dataset.ts`: delete the `const MI2KM = 1.609344;` line (`:15`), change line 35 to `distances[\`${srcW[wOrd].id},${srcC[cOrd].id}\`] = miles;`, and rewrite the header comment's transform 2:

```
//  2. Re-key only. Chapter 4 is miles-canonical (§2.1 of the 2026-10-09 design):
//     the matrix IS Chapter 3's integer-mile matrix, used as-is. NO unit
//     conversion and no circuity factor -- stored == solved == displayed ==
//     exported.
```

Then:
```bash
pnpm --filter @workspace/scripts exec tsx ./src/build-max-coverage-dataset.ts
```
Expected: rewrites `distances.json` and `version.json`. The script computes `sha256` with `createHash` — never hand-write it (registration point 2; a wrong hash makes every solve throw inside `readVersion()` before the solver spawns).

- [ ] **Step 4: Set the manifest unit**

In `solvers/max-coverage-us/manifest.json`, change `"distanceUnit": "km"` to `"distanceUnit": "mi"`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @workspace/dataset-schema test
```
Expected: PASS.

```bash
git diff --stat solvers/max-coverage-us/dataset
```
Expected: `distances.json` and `version.json` changed; `warehouses.json` and `customers.json` **unchanged** (they carry no distances).

- [ ] **Step 6: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add scripts/src/build-max-coverage-dataset.ts solvers/max-coverage-us/dataset solvers/max-coverage-us/manifest.json lib/dataset-schema/src/maxCoverageDataset.test.ts lib/dataset-schema/src/manifest.test.ts
git commit -m "[CH4O-10] regenerate Chapter 4's dataset as integer miles"
```

---

## Task 11: The rename — `...Km` → `...Mi` across every layer

**Spec:** §2.1, §2.5, §3.3.

**Files — mechanical rename (`highServiceDistKm`→`highServiceDistMi`, `maxDistKm`→`maxDistMi`, `avgServiceDistCapKm`→`avgServiceDistCapMi`):**

Source:
- `artifacts/api-server/src/validation/inputs/maxCoverage.ts`
- `artifacts/api-server/src/services/precheck.ts`
- `artifacts/api-server/src/services/autoDistance.ts`
- `artifacts/api-server/src/solver/pmedian.ts:166-169`
- `artifacts/api-server/src/solver/solve.py`
- `artifacts/api-server/src/solver/tests/benchmark/{corpus.py,translate.py,corpus/manifest.json}`
- `artifacts/studio/src/pages/Workspace.tsx`
- `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`
- `artifacts/studio/src/components/workspace/SolveDialog.tsx`
- `solvers/max-coverage-us/manifest.json`

Tests:
- `artifacts/api-server/src/__tests__/{autoDistance,importMultiModelRoundTrip,jobRunner,maxCoverageContract,pmedian,precheck,resultEnvelope,routes}.test.ts`
- `artifacts/api-server/src/registry/__tests__/registration.test.ts`
- `artifacts/api-server/src/validation/inputs/__tests__/maxCoverage.test.ts`
- `artifacts/api-server/src/solver/tests/{test_max_coverage.py,benchmark/test_corpus.py}`
- `artifacts/studio/src/__tests__/{helpers/ch4.tsx,NetworkMap,OptimizationParametersTab,SolveDialog,Workspace,Workspace.DisplayedInputs,Workspace.TabCoverage}.test.tsx`
- `artifacts/studio/e2e/{chen-bands-units-qa,max-coverage,nonjade-servicestats-live-coverage}.spec.ts`

**Interfaces:**
- Consumes: Task 10's miles dataset.
- Produces: the three renamed fields everywhere; `autoDistance` exports lose `haversineKm`/`clampKm`.

- [ ] **Step 1: Run the mechanical rename**

```bash
cd /Users/shubhamkr/network-optimization-studio
grep -rl -e highServiceDistKm -e maxDistKm -e avgServiceDistCapKm \
  --include="*.ts" --include="*.tsx" --include="*.py" --include="*.json" --include="*.yaml" . \
  | grep -v node_modules | grep -v "/generated/" \
  | xargs sed -i '' -e 's/highServiceDistKm/highServiceDistMi/g' \
                    -e 's/maxDistKm/maxDistMi/g' \
                    -e 's/avgServiceDistCapKm/avgServiceDistCapMi/g'
```

Then verify nothing was missed and nothing generated was touched:
```bash
grep -rn -e highServiceDistKm -e maxDistKm -e avgServiceDistCapKm . | grep -v node_modules || echo "CLEAN"
git diff --name-only | grep "/generated/" && echo "ERROR: generated files touched" || echo "generated untouched"
```
Expected: `CLEAN`, then `generated untouched`.

- [ ] **Step 2: Fix the unit strings the rename cannot reach**

In `precheck.ts`, both message strings now say `mi`:
- `` `Customer '${custId}' has no active warehouse within maxDistMi (${inputs.maxDistMi} mi)` ``
- `` `coverageFloorDemand (...) exceeds the ... demand coverable within highServiceDistMi (${inputs.highServiceDistMi} mi)` ``
- the Task 3 cap message: `` `avgServiceDistCapMi (${inputs.avgServiceDistCapMi} mi) is below the ${lowerBound.toFixed(2)} mi best achievable weighted-average distance` ``

In `solve.py`, the `solve_max_coverage` header comment's "Distances are RAW km" becomes "RAW miles", and the `_LOAD_ERRORS` / infeasibility comments mentioning km are corrected.

- [ ] **Step 3: Collapse the km haversine in autoDistance.ts**

Delete `R_KM` (`:101`), `MIN_DISTANCE_KM` (`:102`), `haversineKm` (`:104-109`) and `clampKm` (`:111-113`). In `fillEstimatedMaxCoverageDistances`, change `:557` to:

```ts
      const d = clampMi(haversineMiles(a, b) * MAX_COVERAGE_CIRCUITY);
```

Rewrite the comment block at `:89-100`:

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

Update `autoDistance.test.ts`'s km-haversine cases to the miles path.

- [ ] **Step 4: Update the frontend defaults**

In `Workspace.tsx`'s `defaultInputsForModel` → `case "max-coverage-us"`, replace the seed values and rewrite the stale comment:

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

Mirror the same values into `solvers/max-coverage-us/manifest.json`'s `inputsSchema` where it documents them.

- [ ] **Step 5: Recompute the pytest goldens BY RUNNING**

The km goldens are all invalid now, for two independent reasons: the demand-weighted objective scales by `1/1.609344`, and the round-number defaults flip the high-service/max-distance **predicates** for some pairs, so the open set and covered demand can legitimately differ. **Do not hand-divide any golden.**

Update `test_max_coverage.py`'s `BASE` to the new defaults:
```python
BASE = {"modelType": "max_coverage_us", "p": 3, "highServiceDistMi": 450, "maxDistMi": 3400,
        "avgServiceDistCapMi": 650, "coverageFloorDemand": 0,
        "gap": 0.0, "timeLimitSec": 60, "warehouseOverrides": [], "customerOverrides": [],
        "addedWarehouses": [], "addedCustomers": [], "distanceOverrides": []}
```

Then read the real values off a real solve:
```bash
cd artifacts/api-server/src/solver
echo '{"modelType":"max_coverage_us","p":3,"highServiceDistMi":450,"maxDistMi":3400,"avgServiceDistCapMi":650,"coverageFloorDemand":0,"gap":0.0,"timeLimitSec":60,"warehouseOverrides":[],"customerOverrides":[],"addedWarehouses":[],"addedCustomers":[],"distanceOverrides":[]}' \
  | python3 solve.py | python3 -m json.tool
```
Record `details.coveragePct`, `details.coveredDemand`, `details.openWarehouseIds`, `metrics.weightedAvgDistance`, and paste them into the coverage-mode assertions **with the command that produced them in a comment**.

Repeat for min-distance, using the coverage run's `coveredDemand` as the floor:
```bash
echo '{"modelType":"max_coverage_us","p":3,"highServiceDistMi":450,"maxDistMi":3400,"avgServiceDistCapMi":650,"coverageFloorDemand":<COVERED_FROM_ABOVE>,"gap":0.0,"timeLimitSec":60,"warehouseOverrides":[],"customerOverrides":[],"addedWarehouses":[],"addedCustomers":[],"distanceOverrides":[]}' \
  | python3 solve.py | python3 -m json.tool
```

Sanity check, not a golden: the min-distance `weightedAvgDistance` must be **≤** the coverage run's, and **≤ 650** (the cap). If the cap binds here, pick a looser cap for `TestCapBindsInBothModes`'s "loose" case and say so in a comment.

Update `TestCapBindsInBothModes`'s loose-cap expectation to the newly recorded min-distance average.

- [ ] **Step 6: Run the full gate**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
Expected: all PASS.

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```
Expected: `99/99`, unchanged — this script has no Chapter 4 section. Any change means the conversion leaked into another model.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add -A
git commit -m "[CH4O-11] make Chapter 4 miles-canonical: rename the three distance fields"
```

---

## Task 12: The km→mi migration script

**Spec:** §3.4.

**Files:**
- Create: `artifacts/api-server/src/migrations/ch4ToMiles.ts`
- Create: `artifacts/api-server/src/migrations/__tests__/ch4ToMiles.test.ts`
- Create: `docs/ops/ch4-miles-migration-runbook.md`
- Modify: `artifacts/api-server/package.json` (add the script entry)

**Interfaces:**
- Consumes: `maxCoverageInputsSchema` (Task 5/11), `deriveMaxCoverageObjective` (Task 1).
- Produces: `migrateInputs(inputs: Record<string, unknown>): { ok: true; inputs: Record<string, unknown> } | { ok: false; reason: string }` (pure) and `migrateAll(database?: Db): Promise<{ migrated: number[]; skipped: Array<{ id: number; reason: string }>; alreadyMigrated: number[] }>`.

**This lives in `api-server`, NOT in `scripts/` — a deliberate deviation from the
migration convention, for a reason that blocks the alternative.** §3.4 requires
every migrated row to be re-validated against the real schema before its UPDATE is
committed; that is the guarantee behind the 2 dp rounding choice. The schema is
`artifacts/api-server/src/validation/inputs/maxCoverage.ts`, and
`@workspace/api-server` has **no `main` and no `exports`** (verified in its
`package.json`) — it is a private app, not an importable library. `@workspace/scripts`
depends only on `@workspace/db` and `drizzle-orm`, and no existing script imports
api-server code (the harness detectors only read its files as *text*). So a
`scripts/`-hosted migration could not reach the validator, and would have to
re-implement the invariants — two copies of the rules the migration exists to
satisfy.

Record the deviation in the commit body (hard rule #8).

Structure still follows `scripts/src/migrate-delete-chens-scenarios.ts`: exported
pure functions taking an optional `database`, so the logic is unit-testable without
Postgres.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/migrations/__tests__/ch4ToMiles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { migrateInputs } from "../ch4ToMiles.js";

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
    const r = migrateInputs(kmRow);
    expect(r.ok).toBe(true);
    expect(r.inputs.highServiceDistMi).toBeCloseTo(434.96, 2);
    expect(r.inputs.maxDistMi).toBeCloseTo(3417.54, 2);
    expect(r.inputs.avgServiceDistCapMi).toBeCloseTo(621.37, 2);
    expect(r.inputs).not.toHaveProperty("highServiceDistKm");
  });

  it("converts distanceBands and keeps them strictly ascending", () => {
    const r = migrateInputs(kmRow);
    const bands = r.inputs.distanceBands as number[];
    expect(bands).toHaveLength(4);
    expect(bands.every((v, i) => i === 0 || v > bands[i - 1])).toBe(true);
  });

  // THE one that corrupts data if missed. distanceOverrides[].distance is raw km
  // that precheck overlays DIRECTLY onto the base matrix, and for an added
  // entity it is the ONLY record of that distance. Assert the VALUE -- a test
  // that only checks the array length passes against the exact bug.
  it("converts EVERY distanceOverrides[].distance", () => {
    const r = migrateInputs({
      ...kmRow,
      distanceOverrides: [
        { fromId: "ALN", toId: "C1", distance: 601.894656 },
        { fromId: "aw-x", toId: "C2", distance: 100, estimated: true },
      ],
    });
    const o = r.inputs.distanceOverrides as Array<{ distance: number; estimated?: boolean }>;
    expect(o[0].distance).toBeCloseTo(374, 2);
    expect(o[1].distance).toBeCloseTo(62.14, 2);
    expect(o[1].estimated).toBe(true);   // a boolean flag does not convert
  });

  it("defaults a missing avgServiceDistCapKm (old min-distance row)", () => {
    const { avgServiceDistCapKm, ...noCap } = kmRow;
    const r = migrateInputs({ ...noCap, objective: "min_distance", coverageFloorDemand: 53385024 });
    expect(r.inputs.avgServiceDistCapMi).toBe(650);
  });

  it("derives the objective from the floor and drops the step fields", () => {
    expect(migrateInputs(kmRow).inputs.objective).toBe("coverage");
    expect(migrateInputs({ ...kmRow, coverageFloorDemand: 500 }).inputs.objective).toBe("min_distance");
    expect(migrateInputs(kmRow).inputs).not.toHaveProperty("stepEpoch");
    expect(migrateInputs(kmRow).inputs).not.toHaveProperty("step2");
  });

  it("defaults an absent coverageFloorDemand to 0", () => {
    expect(migrateInputs(kmRow).inputs.coverageFloorDemand).toBe(0);
  });

  it("dedupes bands that collide after rounding", () => {
    const r = migrateInputs({ ...kmRow, distanceBands: [1, 1.001, 700] });
    const bands = r.inputs.distanceBands as number[];
    expect(new Set(bands).size).toBe(bands.length);
  });

  it("falls back to [high, max] when every band rounds away", () => {
    const r = migrateInputs({ ...kmRow, distanceBands: [0.0001] });
    expect(r.inputs.distanceBands).toEqual([r.inputs.highServiceDistMi, r.inputs.maxDistMi]);
  });

  it("SKIPS a row it cannot make valid, rather than writing it", () => {
    const r = migrateInputs({ ...kmRow, highServiceDistKm: 5500, maxDistKm: 700 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/validation/i);
  });

  it("is idempotent — an already-migrated row is returned unchanged", () => {
    const once = migrateInputs(kmRow);
    const twice = migrateInputs(once.inputs);
    expect(twice.ok).toBe(true);
    expect(twice.inputs).toEqual(once.inputs);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api-server test -- ch4ToMiles`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the script**

Create `artifacts/api-server/src/migrations/ch4ToMiles.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import { db, pool, scenariosTable, resultCacheTable } from "@workspace/db";
import { maxCoverageInputsSchema } from "../validation/inputs/maxCoverage.js";
import { deriveMaxCoverageObjective } from "@workspace/units";

// One-off km -> mi migration of persisted max-coverage-us `inputs` (§3.4 of
// docs/superpowers/specs/2026-10-09-ch4-model-interface-overhaul-design.md).
// Written and tested here; running it against production is a separate,
// human-gated operation -- see docs/ops/ch4-miles-migration-runbook.md.
export const MAX_COVERAGE_MODEL_ID = "max-coverage-us";
const MI = 1.609344;

// 2 dp, NOT integers. Integer rounding turns valid persisted rows invalid:
// high=1km/max=1.1km both round to 1 and break the strict inequality, and
// anything under 0.804672 km rounds to 0 and breaks `positive()`.
const toMi = (km: number): number => Math.round((km / MI) * 100) / 100;

type Migrated = { ok: true; inputs: Record<string, unknown> } | { ok: false; reason: string };

export function migrateInputs(raw: Record<string, unknown>): Migrated {
  // Idempotency, keyed on the renamed field's presence. Each row's JSON update
  // must be atomic, or a half-converted row looks unmigrated here and gets
  // converted twice.
  if ("highServiceDistMi" in raw) return { ok: true, inputs: raw };

  const { highServiceDistKm, maxDistKm, avgServiceDistCapKm, stepEpoch, step2, ...rest } = raw as Record<string, number | undefined> & Record<string, unknown>;

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

export async function migrateAll(database: Db = db) {
  const rows = await database
    .select({ id: scenariosTable.id, inputs: scenariosTable.inputs })
    .from(scenariosTable)
    .where(eq(scenariosTable.modelId, MAX_COVERAGE_MODEL_ID));

  const migrated: number[] = [];
  const alreadyMigrated: number[] = [];
  const skipped: Array<{ id: number; reason: string }> = [];

  for (const row of rows) {
    const inputs = (row.inputs ?? {}) as Record<string, unknown>;
    if ("highServiceDistMi" in inputs) { alreadyMigrated.push(row.id); continue; }
    const result = migrateInputs(inputs);
    if (!result.ok) { skipped.push({ id: row.id, reason: result.reason }); continue; }
    await database.update(scenariosTable)
      .set({ inputs: result.inputs, result: null, solvedAt: null })
      .where(eq(scenariosTable.id, row.id));
    migrated.push(row.id);
  }

  // result_cache is NOT an FK child of scenarios (pk is inputs_hash plus a plain
  // model_id column), so its rows would otherwise strand km payloads forever.
  // solve_jobs rows are deliberately left as history.
  await database.delete(resultCacheTable).where(eq(resultCacheTable.modelId, MAX_COVERAGE_MODEL_ID));

  return { migrated, skipped, alreadyMigrated };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  const result = dryRun
    ? { migrated: [], skipped: [], alreadyMigrated: [], note: "--dry-run: no writes" }
    : await migrateAll();
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
}
```

Add to `artifacts/api-server/package.json`'s `scripts`:
```json
    "migrate-ch4-to-miles": "tsx ./src/migrations/ch4ToMiles.ts",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api-server test -- ch4ToMiles`
Expected: PASS, all 11 cases.

- [ ] **Step 5: Run it against the local dev DB for real**

The local DB holds 5 `max-coverage-us` scenarios written under the km schema.

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server run migrate-ch4-to-miles
```
Expected: JSON naming 5 migrated ids, 0 skipped.

Run it a second time to prove idempotency:
```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" \
  pnpm --filter api-server run migrate-ch4-to-miles
```
Expected: `migrated: []`, `alreadyMigrated` listing the same 5 ids.

- [ ] **Step 6: Write the runbook**

Create `docs/ops/ch4-miles-migration-runbook.md` covering: that production's Chapter 4 scenario count is **unmeasurable from an agent session** (`query_render_postgres` connects from `35.227.164.209`, not on `nos-postgres`'s IP allowlist, so measuring needs `psql` from an allowlisted host); a `SELECT count(*) FROM scenarios WHERE model_id = 'max-coverage-us'` pre-check; the `--dry-run` step; the real run; a post-check that every row has `highServiceDistMi`; and an explicit statement that **this runbook is idempotent** (unlike `docs/ops/timestamptz-migration.md`, which silently double-converts) because of the presence-key guard.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/migrations artifacts/api-server/package.json docs/ops/ch4-miles-migration-runbook.md
git commit -m "$(cat <<'MSG'
[CH4O-12] add the Chapter 4 km-to-miles scenario migration

Hosted in api-server rather than scripts/, deviating from the migration
convention: the revalidate-or-skip guarantee needs maxCoverageInputsSchema, and
@workspace/api-server has no main/exports so scripts/ cannot import it.
MSG
)"
```

---

# PHASE 3 — Output reports

---

## Task 13: Move the coverage metrics onto Solution Summary

**Spec:** §4.4, decisions 5-8 and 10.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx:183-186,269-276,300,321-348`
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`
- Test: `artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx`

**Interfaces:**
- Consumes: `scenarioObjectiveMode` (Task 8).
- Produces: Solution Summary rows `cost-summary-high-service-cutoff`, `cost-summary-coverage-pct`, `cost-summary-covered-demand`; compare equivalents `cost-summary-compare-<metric>-${s.id}`.

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

In `ServiceStatsTab.test.tsx`: delete the four KPI assertions at `:205-208` and `:699`, and **generalise** `:219`:

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
Expected: FAIL — rows absent, label unconditional, mismatched checkbox disabled, KPI block still present.

- [ ] **Step 3: Add the Solution Summary rows**

In `CostSummaryTab.tsx`'s single-scenario `rows` builder (after `:379`'s `Objective` row, before `Weighted avg. distance`):

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

Change the avg-distance row at `:387` to take the conditional label:

```tsx
      [showCoverageRows ? "Avg distance to customers" : "Weighted avg. distance",
       formatDistance(result.metrics.weightedAvgDistance, canonicalDistanceUnit, unit), true],
```

- [ ] **Step 4: Add the compare rows and remove `lockedObjectiveMode`**

Add three compare rows between `Objective` (`:490`) and the avg-distance row (`:589`), each gated on its own scenario's `details.coveragePct` and keyed `cost-summary-compare-high-service-cutoff-${s.id}` / `-coverage-pct-` / `-covered-demand-`. Apply the same conditional label to the compare avg-distance row.

Then delete `lockedObjectiveMode` at **all four** sites: its derivation (`:277-280`), the `toggleScenario` refusal (`:287-290`), the `disabled` prop on the checkbox (`:318-326`), and the `(different objective)` label (`:342`). No per-model gate is needed — `lockedObjectiveMode` is `null` whenever no selected scenario carries an objective mode, and only Chapter 4's envelopes carry one, so removal is Chapter-4-only in effect.

Add a comment at the compare objective row:

```tsx
                {/* Asymmetric conversion is CORRECT, not a bug: objectiveDimension
                    maps coverage to "percent" (non-converting) and min_distance to
                    "demand-distance" (converting), so toggling the display unit
                    changes one column and leaves its neighbour frozen. Do not
                    "fix" this. */}
```

- [ ] **Step 5: Strip the Service Stats KPI block**

In `ServiceStatsTab.tsx`, delete the JSX block at `:321-348` **and its three now-dead declarations**, each of which has that block as its only consumer: `details` (`:273-275`), `showCoverageKpis` (`:276`), `avgServiceDistance` (`:300`).

Keep `toDisplay` / `canonicalUnit` / `distanceUnit` — the band labels use them directly at `:376-380`.

Fix the stale comment at `:183-186`: it claims Chapter 4's bands stay frozen "belt-and-suspenders, here on the envelope's own `showCoverageKpis` shape", but that guard was already deleted (see `:278-287`) and `bandCoverage` branches on `useLiveCoverage` alone. Remove the `showCoverageKpis` clause from the comment.

- [ ] **Step 6: Run tests to verify they pass**

```bash
ps aux | grep "[v]itest" | grep -vc "zsh -c"   # must print 0
pnpm --filter studio test
```
Expected: PASS. `CostSummaryTab.test.tsx:334`'s exact-row-sequence assertion will need its expected list updated — **keep it an equality check**; weakening it to `toContain` discards the only ordering guarantee this tab has. `:416-421`'s `startsWith("Weighted avg. distance")` needle must become label-aware.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/tabs artifacts/studio/src/__tests__
git commit -m "[CH4O-13] move Chapter 4's coverage metrics onto Solution Summary"
```

---

## Task 14: Add the coverage columns to the cost-summary export

**Spec:** §4.5, decision 9.

**Files:**
- Modify: `artifacts/api-server/src/services/templates.ts:40-53,1530-1614`
- Modify: `docs/superpowers/metrics/README.md`
- Test: `artifacts/api-server/src/__tests__/templates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `COST_SUMMARY_TEMPLATE_VERSION = 4`; `CostSummaryTemplateRow` gains `highServiceDist`, `coveragePct`, `coveredDemand`.

**Do NOT bump `OUTPUT_TEMPLATE_VERSION`.** It is one shared constant read by eight grids (`:1388`, `:1597`, `:1703`, `:1778`, `:1889`, `:1971`, `:1983`), so bumping it moves `serviceStats` and six others whose columns did not change. `DISTANCE_TEMPLATE_VERSION` (`:38`) is the precedent for a per-family constant.

- [ ] **Step 1: Write the failing tests**

```ts
describe("costSummary CSV — Chapter 4 coverage columns", () => {
  it("emits the three new columns", () => {
    const csv = costSummaryRowsToCsv([buildCostSummaryRow(ch4Result, "max-coverage-us", "mi")]);
    expect(csv.split("\n")[0]).toContain("highServiceDist,coveragePct,coveredDemand");
  });

  it("leaves them blank for a non-Chapter-4 result", () => {
    const csv = costSummaryRowsToCsv([buildCostSummaryRow(pmedianResult, "p-median-us", "mi")]);
    expect(csv.split("\n")[1]).toContain(",,,");
  });

  // highServiceDist IS a distance and converts; the other two are a percent and
  // a demand count with no distance dimension, so running either through a
  // conversion is the rate-style error this repo already has a gotcha for.
  it("converts highServiceDist but NOT coveragePct or coveredDemand", () => {
    const mi = buildCostSummaryRow(ch4Result, "max-coverage-us", "mi");
    const km = buildCostSummaryRow(ch4Result, "max-coverage-us", "km");
    expect(km.highServiceDist).not.toBe(mi.highServiceDist);
    expect(km.coveragePct).toBe(mi.coveragePct);
    expect(km.coveredDemand).toBe(mi.coveredDemand);
  });

  it("uses its own template version, leaving the shared one alone", () => {
    expect(buildCostSummaryRow(ch4Result, "max-coverage-us", "mi").templateVersion).toBe(COST_SUMMARY_TEMPLATE_VERSION);
    expect(COST_SUMMARY_TEMPLATE_VERSION).not.toBe(OUTPUT_TEMPLATE_VERSION);
  });

  it("leaves the serviceStats grid's version untouched", () => {
    expect(buildServiceStatsRows(ch4Result, "max-coverage-us", "mi")[0].templateVersion).toBe(OUTPUT_TEMPLATE_VERSION);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api-server test -- templates`
Expected: FAIL — columns absent, `COST_SUMMARY_TEMPLATE_VERSION` undefined.

- [ ] **Step 3: Implement**

Add beside `OUTPUT_TEMPLATE_VERSION` (`:53`):

```ts
// Grid-local, following DISTANCE_TEMPLATE_VERSION's precedent. The cost-summary
// grid gains three Chapter 4 coverage columns; OUTPUT_TEMPLATE_VERSION is read
// by eight grids and must stay at 3, or seven untouched exports get a version
// bump they did not earn.
export const COST_SUMMARY_TEMPLATE_VERSION = 4;
```

Extend `CostSummaryTemplateRow` with `highServiceDist: number | null; coveragePct: number | null; coveredDemand: number | null;`, populate them in the builder (`:1600`), and add them to the header and row in `costSummaryRowsToCsv` (`:1611-1614`) between `objectiveMode` and `weightedAvgDistance`:

```ts
    highServiceDist:
      details?.highServiceDistMi == null ? null : roundForFile(toDisplay(details.highServiceDistMi, canonicalUnit, requestedUnit)),
    // Neither converts: a percent and a demand count have no distance dimension.
    coveragePct: details?.coveragePct ?? null,
    coveredDemand: details?.coveredDemand ?? null,
```

Change the builder's `templateVersion` at `:1597` to `COST_SUMMARY_TEMPLATE_VERSION`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api-server test -- templates`
Expected: PASS.

- [ ] **Step 5: Update the column docs**

In `docs/superpowers/metrics/README.md`, add the three columns to the `costSummary` grid's table and note that this grid now carries its own `COST_SUMMARY_TEMPLATE_VERSION`, separate from the shared `OUTPUT_TEMPLATE_VERSION` — so the next reader does not assume one version governs every grid.

- [ ] **Step 6: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/api-server/src/services/templates.ts artifacts/api-server/src/__tests__/templates.test.ts docs/superpowers/metrics/README.md
git commit -m "[CH4O-14] export Chapter 4's coverage metrics in the cost-summary CSV"
```

---

## Task 15: Rewrite the sibling e2e specs

**Spec:** §5.3.

**Files:**
- Modify: `artifacts/studio/e2e/max-coverage.spec.ts`
- Modify: `artifacts/studio/e2e/chen-bands-units-qa.spec.ts`
- Modify: `artifacts/studio/e2e/nonjade-servicestats-live-coverage.spec.ts`
- Audit: `artifacts/studio/e2e/{truthful-status,workspace-ux-r1-r9,bundle4-auth-landing}.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: a green `pnpm e2e:gate`.

This is the repo's recurring `spec_gap` class: this branch deletes testids (`step2-*`, the StepToggle surface), deletes a visible-string contract (`Solve Step 1`/`Solve Step 2`), renames every Chapter 4 distance field, and changes km→mi labels. None of these specs is `@flaky`-tagged, so a full gate breaks even with every unit suite green.

- [ ] **Step 1: Find every affected spec**

```bash
cd artifacts/studio
grep -rln -e "step2-" -e "step-toggle" -e "Solve Step" -e "DistKm" -e "DistCapKm" \
          -e "service-stats-coverage" -e "Weighted avg. distance" e2e/
```
Record the list. Then for each, grep the specific testid or string your change touched.

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

The two `VITE_*` dummies are **required, not a workaround**: without them `posthog-analytics.spec.ts` and `sentry-capture.spec.ts` fail for a purely environmental reason and look like real breakage. Both specs stub the ingest host before any request leaves the page, and the DSN need only be syntactically valid.

- [ ] **Step 3: Rewrite each spec**

`max-coverage.spec.ts` — the single form: no step toggle, no `Solve Step N` button label (now `Run Optimizer`), the new mile defaults (450 / 3400 / 650, bands 450/900/1800/3400), and the floor input driving which model runs. Assert the derived-model line.

`chen-bands-units-qa.spec.ts` — km→mi labels and values throughout.

`nonjade-servicestats-live-coverage.spec.ts` — Chapter 4 field names; the coverage KPIs have moved to Solution Summary, so its Service Stats assertions become band-graph-only.

Use `readSolvedAt` from `e2e/helpers/solvedAt.ts` for solve completion — never re-declare it. Capture the value **before** triggering and poll until it differs; polling for non-null is wrong because an already-solved scenario starts non-null.

For the distance fields, commit a draft via **blur** (click a neighbouring field), not `.press("Enter")` — Enter reliably races Radix's dialog auto-focus. And bound any interaction following a dialog opening or a disabled-state transition with an explicit `{ timeout }`, or a 10-second problem becomes a full-test-timeout one surfacing at an unrelated later line.

- [ ] **Step 4: Run the gate**

```bash
pnpm e2e:gate
```
Then read the **report**, not the console tail:
```bash
python3 -c "import json; s=json.load(open('artifacts/studio/e2e/report/results.json'))['stats']; print(s)"
```
Expected: `unexpected: 0`. Note `flaky` too — a gate green only because retries absorbed a sixth of the suite is not the same as a green gate.

Known e2e flakes to re-run in isolation rather than chase: `workspace-fixups-2.spec.ts`, the `chen-bands-units-qa` case, `bundle5-homepage-distances.spec.ts`, `jade-two-echelon.spec.ts`, `nonjade-servicestats-live-coverage.spec.ts:279`, `delivery-teaching.spec.ts`.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/e2e
git commit -m "[CH4O-15] rewrite the Chapter 4 e2e specs for the single-form miles UI"
```

---

## Task 16: Close out the branch

**Spec:** §5, §6a, hard rule #9.

**Files:**
- Modify: `docs/CHANGELOG-implementation.md`
- Modify: `CLAUDE.md` (Gotchas only — no historical narrative)

- [ ] **Step 1: Run the complete gate, with nothing else running**

```bash
ps aux | grep "[v]itest" | grep -vc "zsh -c"   # must print 0
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
Expected: all PASS. Record the counts.

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```
Expected: `99/99`.

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 auth
```
Expected: PASS. `e2e_accuracy.py` and `e2e_journey.py` are standalone scripts, **not** pytest-discovered — the gate command above does not run them.

- [ ] **Step 2: Append the changelog entry**

Append to the **bottom** of `docs/CHANGELOG-implementation.md`: the task ids and commit SHAs, the gate counts, the recomputed pytest goldens with the commands that produced them, the four Codex review rounds and what each found, and the deviations. Hard rule #9: this is where the narrative goes — `CLAUDE.md` gets only a hyperlink.

- [ ] **Step 3: Lift the durable lessons into `CLAUDE.md`'s Gotchas**

Three earned this branch, each a distilled rule with no narrative:

- A unit migration must convert **every** unit-bearing value in a persisted blob, not just the obvious scalars — `distanceOverrides[].distance` is overlaid directly onto the base matrix and, for an added entity, is the only record of that distance.
- A server-derived field needs its derivation on **every** write path. Create, clone and update are three sites; a derivation on the update path alone either 422s every create or persists nothing.
- A precheck that short-circuits before the solver means solver-side error attribution is unreachable for anything the precheck already catches. Put co-equal bounds in one place that returns a list.

- [ ] **Step 4: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add docs/CHANGELOG-implementation.md CLAUDE.md
git commit -m "[CH4O-16] record the Chapter 4 overhaul and its durable lessons"
```

- [ ] **Step 5: Invoke the finishing skill, then STOP**

Invoke `superpowers:finishing-a-development-branch`. It owns the end-of-branch decision and running it is what makes that decision deliberate.

Then **stop and prompt for approval to merge.** This is a hard stop, not a notification. Steps 3–7 of the branch pipeline each need their own explicit yes: merge, then whole-branch review on the merged state, then push, then — separately — any deploy. Approval for one step is never approval for the next.

When the deploy question comes up: this branch touches `solvers/**`, so **`nos-api` needs redeploying as well as `nos-studio`** — `solvers/*/manifest.json` is read at boot by `registry/modelRegistry.ts:47` and baked into the API image by `Dockerfile:16`. Do not conclude "frontend-only" from a pathspec over `artifacts/api-server lib/db lib/api-spec`; that exact mistake shipped a stale model name once already. Check `list_deploys` after any push — the commit webhook does not fire for either service.

- [ ] **Step 6: Run the retro**

`/harness-retro CH4O` — the branch is not finished until this has run. It records the metrics row, logs each gate failure by cause, and fires the second-occurrence gate rule.

---

## Self-Review

**Spec coverage:**

| Spec § | Task |
|---|---|
| §2.1 units + dataset | 10 |
| §2.2 schema | 5 |
| §2.3 derivation + guard + three write paths | 1, 4, 5 |
| §2.4 solver + attribution | 2, 3 |
| §2.5 defaults | 11 |
| §3.0 registration points | 7 (docs), 9 (point 12), 10 (point 2), 11 |
| §3.1 deletions | 7, 8 |
| §3.2 API contract | 6 |
| §3.3 modified files | 3, 5, 7, 11, 14 |
| §3.4 migration | 12 |
| §4.1 tab parity + explicit case | 9 |
| §4.2 frontend deletions | 8 |
| §4.3 the form | 9 |
| §4.4 output reports | 13 |
| §4.5 CSV | 14 |
| §4.6 validation surfacing | 9 |
| §5.1 recomputed goldens | 11 |
| §5.2 new tests | every task's Step 1 |
| §5.3 sibling e2e | 15 |
| §5.4 flakes | global constraints + 7 (list edit) |
| §6a review history | 16 (changelog) |

**Gaps found and closed during review:** §4.6's validation surfacing had no task of its own — folded into Task 9, which owns the form that must display the 422 field paths. §3.0's registration-point audit is spread across four tasks rather than one, which is correct (each point belongs with the change that touches it) but is called out here so it is not mistaken for an omission.

**Type consistency:** `deriveMaxCoverageObjective` (Task 1) is the name used in Tasks 5, 9 and 12. `deriveServerOwnedInputs` (Task 4) is the name used in Tasks 5 and 7. `assertNoServerOwnedFields` (Task 5) replaces `assertNoServerOwnedStepFields` everywhere. `scenarioObjectiveMode` (Task 8) replaces `scenarioObjectiveModeCh4Aware`. `COST_SUMMARY_TEMPLATE_VERSION` (Task 14) is distinct from `OUTPUT_TEMPLATE_VERSION`. `migrateInputs` / `migrateAll` (Task 12) match their test file.

**Ordering invariant:** Task 6 deliberately leaves the workspace typecheck red and Task 8 clears it. That is the only task that ends red, and it is stated in both tasks.
