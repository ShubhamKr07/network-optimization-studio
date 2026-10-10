# Ch4 Max Coverage — objective selector and sequential solve (design)

Date: 2026-10-10 · Model: `max-coverage-us` (Chapter 4, AL's Athletics) · Branch: `ch4-upgrade-v2`

## 1. Goal

Today the coverage floor alone picks the model (`floor == 0` → Model 1, `floor > 0` → Model 2), one solve per run (CH4O, `2026-10-09-ch4-model-interface-overhaul-design.md` §2.3). This change:

- lets the student **choose** the objective when the floor is 0, and
- makes a positive floor run **Model 1 then Model 2** in sequence, reporting Model 1's maximum coverable demand alongside Model 2's answer.

Model 1 = maximise demand within `highServiceDistMi`. Model 2 = minimise total demand-weighted distance subject to covering at least `coverageFloorDemand` within `highServiceDistMi`. Both models keep every existing constraint: exactly `p` open sites, forced-open/inactive overrides, assignment only within `maxDistMi`, and the weighted-average distance cap `avgServiceDistCapMi`.

`highServiceDistMi`, `maxDistMi` and `avgServiceDistCapMi` are already required to be strictly positive by the input schema, so every case below is decided by the floor and the objective alone.

## 2. Behaviour

| Floor | `objective` | Runs | Result headline | Also shown | Published result |
|---|---|---|---|---|---|
| 0 | `coverage` | Model 1 | covered demand / coverage % | weighted avg distance | Model 1 network |
| 0 | `min_distance` | Model 2 with floor 0 | weighted avg distance | coverage % / covered demand | Model 2 network |
| 0 | absent | nothing — Solve blocked by precheck `objective_required` | — | — | unchanged |
| > 0, floor ≤ Model 1 max | absent or `min_distance` | Model 1, then Model 2 with the given floor | weighted avg distance (Model 2) | coverage % / covered demand (Model 2), **"Max coverable demand (Model 1): N"** | Model 2 network |
| > 0, floor > Model 1 max | absent or `min_distance` | Model 1, then Model 2 (infeasible) | alert, see §6.3 | Model 1's sites, coverage %, covered demand, avg distance — inside the alert | status `infeasible`, no network, carries Model 1 summary |

The floor-too-high case follows the existing infeasible convention for every model. The infeasible result is published as the scenario's result, replacing the previous one (`jobRunner.ts:1850-1878`). No new job-runner path.

## 3. Inputs contract

**`objective` changes from server-owned to conditionally client-authored.** This reverses CH4O-5 for the floor-0 case only.

Validation (`validation/inputs/maxCoverage.ts`, `superRefine`):

- `coverageFloorDemand == 0`: `objective` is optional and may be `coverage` or `min_distance`. If absent, it is stored absent. Saving is allowed, but solving is not (§4).
- `coverageFloorDemand > 0`: `objective` must be absent or `min_distance`. `coverage` returns 422 with the message "objective must be min_distance or omitted when coverageFloorDemand > 0". When absent, the server stores `min_distance`, so `details.objective`, `resultSummary.objectiveMode` and Compare keep their current meaning for every positive-floor row.

Write path (`services/scenarioInputWrite.ts`):

- `assertNoServerOwnedFields` no longer refuses `objective`. Delete it and its call sites at `routes/scenarios.ts` :212, :224, :307 and :1998, since `objective` is the only field it guards.
- `deriveServerOwnedInputs` changes to: when the floor is above 0 and `objective` is absent, set `min_distance`. Otherwise, store what was sent.
- `changed.delete("objective")` is removed. `objective` is now a real student input, so changing it is a geometric change that bumps `inputsUpdatedAt` and `solveInputRevision`, which makes an existing result stale.

Shared rule (`lib/units/src/objective.ts`): replace `deriveMaxCoverageObjective(floor)` with one authority:

```ts
type MaxCoverageRun = "model1" | "model2" | "sequential";
resolveMaxCoverageRun(floor: number, objective: "coverage" | "min_distance" | undefined): MaxCoverageRun | null
// floor > 0                         -> "sequential"
// floor == 0, objective coverage     -> "model1"
// floor == 0, objective min_distance -> "model2"
// floor == 0, objective absent       -> null   (cannot solve)
```

`solve.py` carries its own copy. `test_max_coverage.py`'s `TestModeDerivedFromFloor` is rewritten to pin the two copies against each other over all five cases.

Studio save path (`pages/Workspace.tsx`): `withoutServerOwnedInputs` no longer strips `objective` unconditionally. It strips it only when the floor is above 0, because the form hides the selector there and a stale `coverage` would 422. Rename it to `normalizeMaxCoverageObjective` to match what it now does.

The manifest `inputsSchema` keeps `objective` in `properties` and **not** in `required[]`. That avoids the scenario-blocking "missing required values" notice described in CLAUDE.md's Gotchas.

## 4. Precheck

`services/precheck.ts` → `precheckMaxCoverageInputs`:

- **Add** `objective_required`: the floor is 0 and `objective` is absent. Message: "Choose an objective — Max coverage or Min distance — before solving." This blocks the solve route through the existing `precheck_failed` path.
- **Remove** `coverage_floor_infeasible`. Every floor-too-high case now reaches the solver, which runs Model 1 and reports the exact maximum (§2), instead of a form error based on a loose bound.
- `avg_distance_cap_infeasible`, `zero_demand`, `no_feasible_route` and `p_range` are unchanged.

A closed-union error-code change is one task across three places: the TS `PrecheckErrorCode` union (`precheck.ts:87`), the OpenAPI enum (`openapi.yaml:1926`), and regenerated Orval output in the same commit (hard rule #1). Remove consumers before producers: `Workspace.tsx:1518` (comment only), `noHardcodedDemandHint.test.ts`, `maxCoverageContract.test.ts:64-68` and `precheck.test.ts:1577-1709` are rewritten in the same change.

## 5. Solver (`solve.py` → `solve_max_coverage`)

Hard rule #6: no new model code path. Factor the existing LP construction into one builder:

```python
def _build_max_coverage_lp(ctx, sense, floor):   # sense: "max_coverage" | "min_distance"
```

The shared constraints are identical for both senses. The two senses differ only in the objective expression and in whether a `>= floor` row is added (added only when floor > 0). Run plan from `resolve_max_coverage_run(floor, objective)`:

| Run | Solves |
|---|---|
| `model1` | `_build(…, "max_coverage", 0)` |
| `model2` | `_build(…, "min_distance", 0)` |
| `sequential` | `_build(…, "max_coverage", 0)` → record `maxCoverableDemand` = its covered demand → `_build(…, "min_distance", floor)` |
| `None` | error envelope "objective is required when coverageFloorDemand is 0". Defensive only, since precheck blocks first. |

**Time budget.** The job watchdog is `timeLimitSec` plus 15 s grace (`jobRunner.ts:892-900`), so the two sequential solves share one budget. Model 1 gets `timeLimitSec`, and Model 2 gets `max(1, timeLimitSec − Model 1 elapsed)`. Each solve uses `gap` as configured.

**Model 1 not proven optimal** (time or gap stop with an incumbent): Model 2 still runs. `maxCoverableDemand` is the incumbent's covered demand, and `details.model1.optimal = false`, so the UI says "best found" rather than "maximum". If Model 1 itself is infeasible (only possible through the cap, `maxDistMi` or `p`), the run returns Model 1's existing infeasible envelope and Model 2 is not attempted, because Model 2 shares those constraints.

**Result fields** (additions only; existing fields keep their meaning):

- `details.objective` is `coverage` for `model1`, and `min_distance` for both `model2` and `sequential`, so `objectiveMode` and the CSV `objective_mode` keep two values.
- `details.run` is `"model1" | "model2" | "sequential"`. It is new, used for labelling only.
- On `sequential` only, `details.maxCoverableDemand` (int) and `details.model1 = { openWarehouseIds, coveredDemand, coveragePct, weightedAvgDistance, optimal }` are added.
- Top-level `objective`, `metrics`, edges and the rest of `details` come from the **last** solve that produced a network: Model 1 for `model1`, Model 2 otherwise.

**Floor above Model 1's max**: Model 2 is still built and solved with the given floor, as instructed, and CBC returns infeasible. The run returns the standard infeasible envelope (`objective` null, empty metrics, no edges), with `details` = `{ openWarehouseIds: [], assignments: [], objective: "min_distance", run: "sequential", coverageFloorDemand, maxCoverableDemand, model1: {…} }`. The message is: "Coverage floor N exceeds the maximum coverable demand M (Model 1). Lower the floor to at most M." `resultEnvelope.ts` types `details` as `z.record(z.string(), z.unknown())` (:130, :319, :398), and the infeasible-status validator (:263-267) checks only `terminationReason` and the four objective/evidence fields, never `details` (verified 2026-10-10). So the extra keys need no contract change.

## 6. Studio

### 6.1 Parameter form (`OptimizationParametersTab.tsx`)

- **Directly below** `input-coverage-floor`, when the floor is 0, add a radio group `objective-select` with two options: `objective-coverage` "Max coverage (Model 1)" and `objective-min-distance` "Min distance (Model 2)". Nothing is selected by default. It is hidden when the floor is above 0.
- The floor going from 0 to above 0 drops `objective` from local inputs. The floor going back to 0 shows the selector with nothing selected.
- `derived-model-line` reads `resolveMaxCoverageRun`:
  - `model1`: "Model 1 — maximize demand within X, holding average distance at or under Y" (unchanged)
  - `model2`: "Model 2 — minimize average distance, holding average distance at or under Y"
  - `sequential`: "Model 1, then Model 2 — find the maximum demand coverable within X, then minimize average distance covering at least N, holding average distance at or under Y"
  - `null`: "Choose an objective to solve."
- Solve is disabled while precheck reports `objective_required`, through the existing precheck query (`Workspace.tsx:1513-1524`). The precheck message is shown next to the selector.
- Workspace defaults (`Workspace.tsx:142-159`) keep floor 0 and add no `objective`, so a new scenario starts unselected.

### 6.2 Results

- The objective pill (`ObjectiveBar.tsx`) and `formatObjective` are unchanged. They already switch on `details.objective` (coverage → "NN.NN %", min_distance → demand-mi).
- Solution Summary (`CostSummaryTab.tsx:351-383`): the existing coverage rows and the "Avg distance to customers" row stay in every mode, with row order unchanged. The objective pill is the headline. Add one row, `cost-summary-max-coverable-demand`, "Max coverable demand (Model 1)", shown when `details.maxCoverableDemand` is a number. When `details.model1.optimal === false`, it reads "Best coverable demand found (Model 1)".
- Compare table: add `cost-summary-compare-max-coverable-demand-${id}`, blank for scenarios without it.

### 6.3 Floor-too-high alert

Where the studio renders an infeasible result (`resultOutcome.ts` → `OutputMapTab.tsx:210/423` and the Solution Summary), a max-coverage result with `details.run === "sequential"` and `details.maxCoverableDemand` shows an alert, `floor-exceeds-max-alert`:

> **Coverage floor N exceeds the maximum coverable demand M.** Model 2 is infeasible. Model 1 (max coverage): sites A, B, C · coverage P % (D demand) · avg distance K mi. Lower the floor to at most M.

It appears only after solving. Nothing is precomputed on the form.

## 7. Exports and history

- The cost-summary CSV (`services/templates.ts:1617-1654`) is **unchanged**: no new column, no `COST_SUMMARY_TEMPLATE_VERSION` bump. Adding `max_coverable_demand` is deferred until someone asks for it, which avoids the version-and-contract hazard recorded in CLAUDE.md.
- `resultSummary.objectiveMode` (`jobRunner.ts:1403`) and the OpenAPI `objectiveMode` description keep the values `coverage` and `min_distance`. They are unchanged.

## 8. Production migration — clear stored objective on floor-0 rows

Every existing floor-0 `max-coverage-us` row carries a server-derived `objective: "coverage"`. Per decision, it is **cleared**, so those students must choose an objective before re-solving.

- New `artifacts/api-server/src/migrations/clearFloorZeroObjective.ts`. It selects `model_id = 'max-coverage-us' AND (inputs->>'coverageFloorDemand')::int = 0 AND inputs ? 'objective'`, removes the `objective` key, and sets `inputs_updated_at = now()` and `solve_input_revision = solve_input_revision + 1`, so the cached result shows as stale.
- **Scoped**, per CLAUDE.md's gotcha: the function takes an optional id filter. Its tests pass only their own fixture ids. The unfiltered scan exists only in the CLI entry point.
- **Idempotent by construction**: the `inputs ? 'objective'` predicate means a second run matches nothing.
- **Dry-run first**: the CLI prints matching row ids and the count without writing. That count, taken at run time, is the number quoted for approval. No figure is assumed here.
- `result` and `result_cache` are left untouched (stale, not deleted).
- Runbook `docs/ops/ch4-objective-clear-runbook.md`: snapshot or backup → dry run → explicit human approval → run → verify count of `inputs ? 'objective'` among floor-0 rows = 0.
- **Order**: deploy the API and studio first. Rows still holding `coverage` keep solving as Model 1 in the meantime, which is a valid choice. Then run the migration. It is not run as part of this branch's merge; it needs its own approval (CLAUDE.md branch discipline step 7).

## 9. Tests

**Solver (`tests/test_max_coverage.py`)**, base inputs as today (p 3, hi 450, max 3400, cap 650, gap 0):

- `model1` (floor 0, `coverage`): existing golden unchanged. Open {DAL, LA, PIT}, coveragePct 70.42, weightedAvgDistance 394.65.
- `model2` (floor 0, `min_distance`): new golden, value computed by running it, not estimated.
- `sequential`, floor 54946145: Model 2 golden unchanged (objective 30269639699.0, weightedAvgDistance 387.94, open {DAL, LA, PIT}). Plus `maxCoverableDemand` equals the Model 1 golden's `coveredDemand`, asserted by running Model 1, not by a literal copy.
- `sequential`, floor 500100100: status infeasible, `details.maxCoverableDemand` equals the Model 1 covered demand, `details.model1.openWarehouseIds` = {DAL, LA, PIT}, and the message names both numbers.
- `sequential`, floor 1 with cap 100000: Model 2 still equals the p-median result (open {BAL, DAL, LA}, objective 29873735731).
- `None` (floor 0, no objective): error envelope.
- The pinned `TestModeDerivedFromFloor` is replaced by the five-case `resolve` pin from §3.
- Time budget: Model 2's limit is below `timeLimitSec` after Model 1 uses part of it.
- `e2e_accuracy.py` has no max-coverage section. Run it unmodified as the sacred gate anyway.

**API (vitest)**:

- Validation: the floor/objective matrix, including 422 for floor above 0 with `coverage`.
- Write path: an objective change bumps the revision, and floor above 0 with no objective stores `min_distance`.
- `objective` is accepted on create, update and clone.
- Precheck: `objective_required` fires, and `coverage_floor_infeasible` no longer exists.
- Migration: scoped by fixture ids, idempotent, and the dry run writes nothing. A real-Postgres test exercises the actual writer.
- A contract test asserts the OpenAPI enum contains `objective_required` and not `coverage_floor_infeasible`.

**Studio (vitest + RTL)**:

- The selector shows only at floor 0, has no default, and is cleared when the floor goes above 0.
- `derived-model-line` text matches each of the four cases.
- Solve is disabled on `objective_required`.
- The max-coverable row and the Compare column render.
- The floor-exceeds-max alert renders from an infeasible sequential result.

**E2E**:

- Grep `e2e/` for `derived-model-line`, `input-coverage-floor` and `coverage_floor_infeasible`, and rewrite the sibling specs (the CLAUDE.md gotcha).
- One new Playwright journey covers floor 0 → choose each objective → solve, and floor above max → alert. Seed solver results as e2e convention requires.

**QA**: a real-browser QA pass by qa-sdet over all five behaviour rows, per the standing QA-in-every-plan rule.

## 10. Commit slicing

The objective contract crosses validation, write path, the shared rule, solver, precheck, OpenAPI and studio. Per CLAUDE.md ("a change crossing a layer boundary is ONE commit"), the contract change is **one** task and one commit, with codegen in it. The migration, its runbook, the e2e rewrites and the changelog entry can each be their own task.

## 11. Out of scope

- Pre-solve warning on the form (Model 1 is not run speculatively).
- Showing Model 1's full network as a separate result section.
- Export column for `maxCoverableDemand`.
- Any change to other models.

## 12. Supersedes

This document supersedes `2026-10-09-ch4-model-interface-overhaul-design.md` §2.3 ("objective is derived, not chosen by a toggle"), its derivation rule (:125-126), and the "solve.py derives it locally" note (:207-213). It applies to the floor-0 case and to the single-solve assumption for positive floors. The rest of that spec stands.
