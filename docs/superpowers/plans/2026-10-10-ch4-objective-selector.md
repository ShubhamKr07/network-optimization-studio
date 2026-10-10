# Chapter 4 Objective Selector & Sequential Solve — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, seed a TaskCreate entry per task **and** per process gate (gate run, `e2e_accuracy.py`, changelog entry, finishing skill, `/harness-retro`), per the standing ledger rule.

**Goal:** Let a Chapter 4 (`max-coverage-us`) student choose Model 1 or Model 2 at a zero coverage floor, and make any positive floor run Model 1 then Model 2, reporting Model 1's maximum coverable demand next to Model 2's answer.

**Architecture:** `solve.py` gets ONE LP builder parameterised by sense and floor (hard rule #6) plus a run plan resolved from `(floor, objective)`; a shared TypeScript rule `resolveMaxCoverageRun` in `@workspace/units` drives the write path, precheck, and the studio form, and is pinned against the Python copy through one shared JSON case table. `objective` becomes a conditionally client-authored input (stored as sent at floor 0, normalised to `min_distance` at a positive floor), precheck swaps `coverage_floor_infeasible` for `objective_required`, and the studio gains a selector, local-draft Solve gating, `hasIncumbent` gating, a max-coverable row and a floor-exceeds-max alert. A scoped, idempotent migration clears the old derived `objective` from floor-0 rows — written and tested here, **not run against production**.

**Tech Stack:** pnpm monorepo. Express 5 + Drizzle (Postgres) in `artifacts/api-server`; React + Vite + TanStack Query in `artifacts/studio`; Python 3 + PuLP/CBC in `artifacts/api-server/src/solver`; contract-first OpenAPI + Orval (`lib/api-spec` → `lib/api-zod`, `lib/api-client-react`); `@workspace/units` in `lib/units`.

**Spec (source of truth):** `docs/superpowers/specs/2026-10-10-ch4-objective-selector-design.md`. Every task cites the section it implements.

## Global Constraints

- **Workdir / branch:** `/Users/shubhamkr/nos-ch4-upgrade-v2`, branch `ch4-upgrade-v2`. Never touch `/Users/shubhamkr/network-optimization-studio`. First command of every task: `cd /Users/shubhamkr/nos-ch4-upgrade-v2 && git rev-parse --abbrev-ref HEAD` — must print `ch4-upgrade-v2`, else STOP.
- **Before every `git commit`:** `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }` — run it alone, read its output, then commit **with an explicit pathspec** (`git commit <paths> -m …`). Never pipe a state-changing git command.
- **One task = one commit**, message `[CH4OS-<n>] <imperative summary>`, body ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every task appends its own entry to `docs/CHANGELOG-implementation.md` in the SAME commit** (hard rule #9). CH4OS-1 creates the section heading `## CH4OS — Chapter 4 objective selector and sequential solve (2026-10-10 spec)` at the bottom; each later task appends a `### CH4OS-<n>` subsection under it. Changelog numbers are **measured in that task's own run** — an underivable value is the literal string `unknown`, never an estimate.
- **Hard rule #12:** each engineering task (CH4OS-1…4) begins with Step 0: invoke `andrej-karpathy-skills:karpathy-guidelines` and `ponytail:ponytail` via the Skill tool. qa-sdet tasks (CH4OS-5, CH4OS-6) are exempt. Engineering reviews run `ponytail:ponytail-review` on Opus; qa-sdet reviews run on a separate `fable` reviewer (AGENTS.md).
- **Never edit generated code** (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`). Regenerate with `pnpm --filter @workspace/api-spec run codegen` (script: `orval --config ./orval.config.ts && pnpm -w run typecheck:libs`) and commit spec + output together.
- **`e2e_accuracy.py` is sacred** and has no Chapter 4 section. Run it unmodified (`cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py`); expected `99/99`.
- **Hard rule #6:** the solver change is one LP builder whose two senses differ by a coefficient table, a direction and one optional row. No new model code path.
- **Local DB:** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` passed inline on every command that needs it. `nos_dev` is **shared with other sessions**: another session's dispatcher can claim a `queued` row this session inserted (assert "either active status" where a test needs an active job); load-induced flakes are routine — check `docs/superpowers/flake-registry.md` by test **name** and re-run a failing file twice in isolation before calling it a regression.
- **Gate commands run separately, never chained with `&&`.** Before trusting a full suite: `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]` — run alone, not chained.
- **Spec values, verbatim:**
  - Selector: radio group `objective-select`, options `objective-coverage` "Max coverage (Model 1)" and `objective-min-distance` "Min distance (Model 2)"; nothing selected by default; shown only at floor 0, directly below `input-coverage-floor`.
  - Hint / precheck message: `Choose an objective — Max coverage or Min distance — before solving.`
  - `derived-model-line` (X = high-service distance, Y = cap, N = floor):
    - `model1`: `Model 1 — maximize demand within X, holding average distance at or under Y`
    - `model2`: `Model 2 — minimize average distance, holding average distance at or under Y`
    - `sequential`: `Model 1, then Model 2 — find the maximum demand coverable within X, then minimize average distance covering at least N, holding average distance at or under Y`
    - `null`: `Choose an objective to solve.`
  - Solver messages (N floor, M Model 1 covered demand): optimal Model 1 → `Coverage floor N exceeds the maximum coverable demand M (Model 1). Lower the floor to at most M.`; not proven → `Coverage floor N could not be met. Model 1's best coverable demand found was M; the exact maximum was not proven within the time/gap limit.`; no-objective → `objective is required when coverageFloorDemand is 0`.
  - Time budget (`sequential`): Model 1 `max(1, timeLimitSec // 2)`; Model 2 `max(1, timeLimitSec − Model 1 elapsed)`. `model1`/`model2` keep the full `timeLimitSec`.
  - Test ids: `cost-summary-max-coverable-demand` ("Max coverable demand (Model 1)" / "Best coverable demand found (Model 1)"), `cost-summary-compare-max-coverable-demand-${id}`, `floor-exceeds-max-alert`.
- **Not in scope (spec §7, §11):** no cost-summary CSV column, no `COST_SUMMARY_TEMPLATE_VERSION` bump, `objectiveMode` keeps two values, manifest keeps `objective` out of `required[]`, no change to any other model.
- **e2e window:** from CH4OS-2's commit until CH4OS-5's, the floor-0 e2e fixtures carry no `objective` and their solves 422 on `objective_required`. Playwright is not in the unit gate; CH4OS-5 closes it and must land before merge.
- **No merge, no push, no deploy, no production migration run in this plan.**
- **Line numbers below are from the pre-task state.** Earlier tasks shift them; locate by symbol, verify, then edit.

---

## File Structure

| Path | Change | Task |
|---|---|---|
| `artifacts/api-server/src/solver/solve.py` | `resolve_max_coverage_run`, `_build_max_coverage_lp`, `_run_max_coverage_lp`, `_read_max_coverage_solution`, `_max_coverage_no_network_envelope`, `_floor_exceeds_message`, `_cbc_evidence`; `solve_max_coverage` rewritten on top of them | 1 |
| `artifacts/api-server/src/solver/tests/test_max_coverage.py` | BASE gains `objective`; new goldens, run-plan, time-budget, outcome-matrix tests; `TestModeDerivedFromFloor` replaced | 1 |
| `lib/units/src/__tests__/maxCoverageRunCases.json` | **new** — the five-case table both rule copies are tested against | 1 |
| `artifacts/api-server/src/__tests__/resultEnvelope.test.ts` | floor-0 payloads carry `objective`; infeasible test asserts the new details | 1 |
| `artifacts/api-server/src/solver/pmedian.ts` | comment only (solve.py now reads `objective`) | 1 |
| `lib/units/src/objective.ts` + `__tests__/objective.test.ts` | add `resolveMaxCoverageRun`; mark `deriveMaxCoverageObjective` historical | 2 |
| `artifacts/api-server/src/services/scenarioInputWrite.ts` | new `deriveServerOwnedInputs` rule; drop `changed.delete("objective")`; delete `assertNoServerOwnedFields` | 2 |
| `artifacts/api-server/src/routes/scenarios.ts` | delete the two guard blocks + import | 2 |
| `artifacts/api-server/src/validation/inputs/maxCoverage.ts` | comment only (no rule change — see CH4OS-2 note) | 2 |
| `artifacts/api-server/src/services/precheck.ts` | `objective_required` in, `coverage_floor_infeasible` out | 2 |
| `lib/api-spec/openapi.yaml` + regenerated `lib/api-zod`, `lib/api-client-react` | enum swap | 2 |
| api-server tests: `precheck`, `maxCoverageContract`, `maxCoverageWriteGuard`, `routes`, `solver/__tests__/scenarioSolveAtomicity` | consumers rewritten | 2 |
| `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx` | selector + four-case model line | 2 |
| `artifacts/studio/src/pages/Workspace.tsx` | delete `withoutServerOwnedInputs`; objective plumbing; local-draft Solve gating | 2 |
| `artifacts/studio/src/components/workspace/SolveDialog.tsx` | `solveBlockedReason` prop | 2 |
| studio tests: `OptimizationParametersTab`, `Workspace`, `SolveDialog`, `noHardcodedDemandHint` | rewritten / extended | 2 |
| `artifacts/studio/src/components/workspace/FloorExceedsMaxAlert.tsx` | **new** — shared alert | 3 |
| `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` | `hasIncumbent` gating, max-coverable row + Compare row, alert | 3 |
| `artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx` | alert | 3 |
| studio tests: `CostSummaryTab`, `OutputMapTab`, **new** `FloorExceedsMaxAlert.test.tsx` | | 3 |
| `artifacts/api-server/src/migrations/clearFloorZeroObjective.ts` + `__tests__/clearFloorZeroObjective.test.ts` | **new** | 4 |
| `artifacts/api-server/package.json` | `clear-floor-zero-objective` script | 4 |
| `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts` | allow-list entry | 4 |
| `docs/ops/ch4-objective-clear-runbook.md` | **new** | 4 |
| `artifacts/studio/e2e/helpers/maxCoverageInputs.ts`, `chen-bands-units-qa.spec.ts`, `max-coverage.spec.ts` | sibling rewrites | 5 |
| `artifacts/studio/e2e/max-coverage-objective.spec.ts` | **new** seeded journey | 5 |

---

## Task 1 (CH4OS-1): Solver — one LP builder, run plan, sequential solve

**Role:** solver-engineer. **Spec:** §2, §5, §9 (Solver).

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py:1430-1553` (the `solve_max_coverage` block)
- Modify: `artifacts/api-server/src/solver/tests/test_max_coverage.py`
- Create: `lib/units/src/__tests__/maxCoverageRunCases.json`
- Modify: `artifacts/api-server/src/__tests__/resultEnvelope.test.ts:63-81,83-96`
- Modify: `artifacts/api-server/src/solver/pmedian.ts:157-163` (comment)
- Modify: `docs/CHANGELOG-implementation.md` (append)

**Interfaces:**
- Consumes: `_run_cbc(prob, gap, time_limit, *, problem_uid=None, msg=False)` → `CBCCaptureResult` (`solve.py:208`); `_envelope(...)` (`solve.py:247`); `_EMPTY_METRICS`, `_EMPTY_DETAILS` (`solve.py:272-273`); `CBCCaptureResult(solutionStatus=, terminationReason=, achievedGap=, solverIncumbentObjective=, solverBestBound=, lpStatus=)` (`cbc_termination.py:463`).
- Produces: `resolve_max_coverage_run(floor, objective) -> "model1" | "model2" | "sequential" | None`. On a `sequential` run, `details.maxCoverableDemand: int` and `details.model1 = {openWarehouseIds: list[str], coveredDemand: int, coveragePct: float, weightedAvgDistance: float, optimal: bool}`. Floor-too-high: `status "infeasible"`, raw `objective 0`, `edges []`, `details = {openWarehouseIds: [], assignments: [], objective: "min_distance", coverageFloorDemand, maxCoverableDemand, model1}`, `infeasibilityReason` = the spec message. `lib/units/src/__tests__/maxCoverageRunCases.json`: `Array<{floor: number, objective: "coverage"|"min_distance"|null, run: "model1"|"model2"|"sequential"|null}>` — CH4OS-2's TS test reads the same file.

**Backward compatibility (why this commit is green alone):** the server today stores `objective: "coverage"` on every floor-0 row and `pmedian.ts:166` forwards it, so floor-0 solves resolve to `model1` — byte-identical LP and envelope. Positive floors become `sequential`: Model 2's LP is unchanged (same constraint order), and the envelope gains only additive `details` keys; `coverage_floor_infeasible` precheck still blocks too-high floors until CH4OS-2.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in your report that both ran.

- [ ] **Step 1: Create the shared case table**

Create `lib/units/src/__tests__/maxCoverageRunCases.json`:

```json
[
  { "floor": 0, "objective": "coverage", "run": "model1" },
  { "floor": 0, "objective": "min_distance", "run": "model2" },
  { "floor": 0, "objective": null, "run": null },
  { "floor": 1, "objective": null, "run": "sequential" },
  { "floor": 54946145, "objective": "coverage", "run": "sequential" }
]
```

- [ ] **Step 2: Write the failing tests**

In `artifacts/api-server/src/solver/tests/test_max_coverage.py`:

(a) Add `import types` to the imports, and after `import solve  # noqa: E402` add:

```python
from cbc_termination import CBCCaptureResult  # noqa: E402
```

(b) Replace the BASE comment block and `BASE` (currently `:47-58`) with:

```python
# CH4OS (spec 2026-10-10 §3) -- `objective` is a student input again at a ZERO
# floor: floor 0 + "coverage" runs Model 1, floor 0 + "min_distance" runs
# Model 2, floor 0 + no objective cannot solve, and ANY positive floor runs
# Model 1 then Model 2 whatever objective is sent. BASE is the Model 1 case.
BASE = {"modelType": "max_coverage_us", "objective": "coverage",
        "p": 3, "highServiceDistMi": 450, "maxDistMi": 3400,
        "avgServiceDistCapMi": 650, "coverageFloorDemand": 0,
        "gap": 0.0, "timeLimitSec": 60, "warehouseOverrides": [], "customerOverrides": [],
        "addedWarehouses": [], "addedCustomers": [], "distanceOverrides": []}
```

(c) Replace `test_floor_infeasible` (`:107-109`) with:

```python
def test_floor_above_model1_max_is_infeasible_and_carries_model1():
    # CH4OS §5 -- Model 2 is still built and solved at the given floor; CBC
    # returns infeasible; the envelope is the standard infeasible one (raw
    # objective 0, NOT null -- solverProcessMessage.ts requires a number) plus
    # Model 1's summary. M is read off a real Model 1 run, never a literal.
    m = run(BASE)["details"]["coveredDemand"]
    r = run({**BASE, "coverageFloorDemand": 500100100})
    assert r["status"] == "infeasible"
    assert r["objective"] == 0
    assert r["edges"] == []
    d = r["details"]
    assert d["openWarehouseIds"] == [] and d["assignments"] == []
    assert d["objective"] == "min_distance"
    assert d["coverageFloorDemand"] == 500100100
    assert d["maxCoverableDemand"] == m
    assert set(d["model1"]["openWarehouseIds"]) == {"DAL", "LA", "PIT"}
    assert d["model1"]["coveredDemand"] == m
    assert d["model1"]["optimal"] is True
    assert r["infeasibilityReason"] == (
        f"Coverage floor 500100100 exceeds the maximum coverable demand {m} (Model 1). "
        f"Lower the floor to at most {m}.")
```

(d) Append after `test_min_distance_golden`:

```python
def test_model2_floor_zero_golden():
    # CH4OS §2 row 2 -- floor 0 + min_distance runs Model 2 with NO floor row.
    # Measured, not estimated: see CH4OS-1 Step 5 for the command. Pre-measured
    # 2026-10-11 via the floor-1 equivalent on the old code (same LP plus one
    # slack row): objective 29873735731.0, avg 382.87, open {BAL, DAL, LA},
    # coveredDemand 52346880, coveragePct 67.0887 -- which is also MIG-11's
    # p-median value, as it must be: a slack floor and a loose cap reduce
    # Model 2 to the p-median.
    r = run({**BASE, "objective": "min_distance"})
    assert r["status"] == "optimal"
    assert r["details"]["objective"] == "min_distance"
    assert r["objective"] == pytest.approx(29873735731.0, abs=0.05)
    assert r["metrics"]["weightedAvgDistance"] == pytest.approx(382.87, abs=0.05)
    assert set(r["details"]["openWarehouseIds"]) == {"BAL", "DAL", "LA"}
    assert r["details"]["coveredDemand"] == 52346880
    assert r["details"]["coveragePct"] == pytest.approx(67.0887, abs=1e-3)
    _assert_coverage_fields(r)


def test_sequential_golden_reports_model1_max_alongside_model2():
    # CH4OS §2 row 4 -- Model 2's golden is unchanged (same LP as
    # test_min_distance_golden); maxCoverableDemand equals the Model 1
    # golden's coveredDemand, asserted by RUNNING Model 1, not a literal copy.
    model1 = run(BASE)
    r = run({**BASE, "coverageFloorDemand": 54946145})
    assert r["status"] == "optimal"
    assert r["objective"] == pytest.approx(30269639699.0, abs=0.05)
    assert r["metrics"]["weightedAvgDistance"] == pytest.approx(387.94, abs=0.05)
    assert set(r["details"]["openWarehouseIds"]) == {"DAL", "LA", "PIT"}
    assert r["details"]["maxCoverableDemand"] == model1["details"]["coveredDemand"]
    m1 = r["details"]["model1"]
    assert m1["coveredDemand"] == model1["details"]["coveredDemand"]
    assert set(m1["openWarehouseIds"]) == set(model1["details"]["openWarehouseIds"])
    assert m1["coveragePct"] == pytest.approx(model1["details"]["coveragePct"], abs=1e-3)
    assert m1["weightedAvgDistance"] == pytest.approx(model1["metrics"]["weightedAvgDistance"], abs=0.05)
    assert m1["optimal"] is True
```

(e) Replace the whole `class TestModeDerivedFromFloor` (`:350-368`) with:

```python
# ---------------------------------------------------------------------------
# CH4OS -- the run plan. resolve_max_coverage_run is the Python copy of
# @workspace/units' resolveMaxCoverageRun; both are tested against ONE case
# table, so the two copies cannot drift without one of the two suites failing.
# ---------------------------------------------------------------------------
_RUN_CASES_PATH = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "..",
                                               "lib", "units", "src", "__tests__",
                                               "maxCoverageRunCases.json"))
with open(_RUN_CASES_PATH) as _f:
    RUN_CASES = json.load(_f)


class TestResolveMaxCoverageRun:
    def test_case_table_is_not_vacuous(self):
        assert len(RUN_CASES) == 5
        assert {c["run"] for c in RUN_CASES} == {"model1", "model2", "sequential", None}

    @pytest.mark.parametrize("case", RUN_CASES, ids=lambda c: f'{c["floor"]}-{c["objective"]}')
    def test_matches_the_shared_case_table(self, case):
        assert solve.resolve_max_coverage_run(case["floor"], case["objective"]) == case["run"]


class TestRunPlanReportsWhatRan:
    """details.objective reports what RAN; maxCoverableDemand/model1 are the
    sequential discriminator (spec §5: no separate details.run field)."""

    def test_model1(self):
        r = run(BASE)
        assert r["details"]["objective"] == "coverage"
        assert "maxCoverableDemand" not in r["details"]
        assert "model1" not in r["details"]

    def test_model2(self):
        r = run({**BASE, "objective": "min_distance"})
        assert r["details"]["objective"] == "min_distance"
        assert "maxCoverableDemand" not in r["details"]

    def test_positive_floor_ignores_a_sent_objective_and_runs_sequentially(self):
        r = run({**BASE, "coverageFloorDemand": 54946145, "objective": "coverage"})
        assert r["details"]["objective"] == "min_distance"
        assert isinstance(r["details"]["maxCoverableDemand"], int)

    def test_absent_objective_at_floor_zero_is_an_error_envelope(self):
        payload = {k: v for k, v in BASE.items() if k != "objective"}
        r = solve.solve(payload)
        assert r["status"] == "error"
        assert r["infeasibilityReason"] == "objective is required when coverageFloorDemand is 0"
        assert r["_failureReason"] == "internal_error"
        assert r["_failureStage"] == "dispatch"


def _no_network(lp_status, solution_status, reason):
    return CBCCaptureResult(solutionStatus=solution_status, terminationReason=reason,
                            achievedGap=None, solverIncumbentObjective=None,
                            solverBestBound=None, lpStatus=lp_status)


class TestSequentialTimeBudget:
    """Spec §5: Model 1 gets max(1, T // 2); Model 2 gets max(1, T - Model 1
    elapsed). CBC is fully stubbed and solve.py's `time` is replaced IN ITS OWN
    NAMESPACE ONLY (never the global module), so elapsed time is exact."""

    def _stub(self, monkeypatch, step_sec, first_solved=True):
        clock = [1000.0]
        monkeypatch.setattr(solve, "time", types.SimpleNamespace(time=lambda: clock[0]))
        limits = []

        def fake(prob, gap, time_limit, **kw):
            limits.append(time_limit)
            clock[0] += step_sec
            # first_solved: call 1 is "Optimal" with no variable values -> an
            # empty Model 1 network, which is all the budget split needs. Every
            # other call is no_solution, so solve.py never reads an (absent)
            # objective value off an unsolved LP.
            if first_solved and len(limits) == 1:
                return _no_network("Optimal", "optimal", "optimality_proven")
            return _no_network("Not Solved", "no_solution", "time_limit")

        monkeypatch.setattr(solve, "_run_cbc", fake)
        return limits

    def test_model1_gets_half_and_model2_gets_the_remainder(self, monkeypatch):
        limits = self._stub(monkeypatch, 25.0)
        solve.solve({**BASE, "coverageFloorDemand": 54946145, "timeLimitSec": 60})
        assert limits == [30, 35.0]

    def test_both_limits_floor_at_one_second(self, monkeypatch):
        limits = self._stub(monkeypatch, 25.0)
        solve.solve({**BASE, "coverageFloorDemand": 54946145, "timeLimitSec": 3})
        assert limits == [1, 1]

    @pytest.mark.parametrize("objective", ["coverage", "min_distance"])
    def test_single_model_runs_keep_the_full_limit(self, monkeypatch, objective):
        limits = self._stub(monkeypatch, 25.0, first_solved=False)
        solve.solve({**BASE, "objective": objective, "timeLimitSec": 60})
        assert limits == [60]


def _script_cbc(monkeypatch, script):
    """Wraps the REAL _run_cbc. script[i] decides call i: None = real result
    untouched; "feasible" = real result relabelled not-proven-optimal (CBC
    stopped on a limit WITH an incumbent); "infeasible" / "no_solution" =
    synthetic results CBC can return but this dataset cannot be made to
    produce on demand. Returns the list of time limits, one per call."""
    real = solve._run_cbc
    limits = []

    def fake(prob, gap, time_limit, **kw):
        step = script[len(limits)] if len(limits) < len(script) else None
        limits.append(time_limit)
        if step == "infeasible":
            return _no_network("Infeasible", "infeasible", "infeasible")
        if step == "no_solution":
            return _no_network("Not Solved", "no_solution", "time_limit")
        r = real(prob, gap, time_limit, **kw)
        if step == "feasible":
            r.solutionStatus = "feasible"
            r.terminationReason = "time_limit"
        return r

    monkeypatch.setattr(solve, "_run_cbc", fake)
    return limits


class TestSequentialOutcomeMatrix:
    """Spec §5's seven-row outcome matrix, one test per row."""
    FEASIBLE = 54946145
    TOO_HIGH = 500100100

    def test_m1_optimal_m2_solved_returns_model2_with_model1(self, monkeypatch):
        limits = _script_cbc(monkeypatch, [])
        r = solve.solve({**BASE, "coverageFloorDemand": self.FEASIBLE})
        assert len(limits) == 2
        assert r["status"] == "optimal"
        assert r["details"]["model1"]["optimal"] is True
        assert isinstance(r["details"]["maxCoverableDemand"], int)

    def test_m1_optimal_m2_infeasible_says_maximum(self, monkeypatch):
        m = solve.solve(BASE)["details"]["coveredDemand"]
        _script_cbc(monkeypatch, [])
        r = solve.solve({**BASE, "coverageFloorDemand": self.TOO_HIGH})
        assert r["status"] == "infeasible"
        assert r["objective"] == 0
        assert r["infeasibilityReason"] == (
            f"Coverage floor {self.TOO_HIGH} exceeds the maximum coverable demand {m} (Model 1). "
            f"Lower the floor to at most {m}.")

    def test_m1_feasible_m2_solved_flags_model1_not_optimal(self, monkeypatch):
        _script_cbc(monkeypatch, ["feasible"])
        r = solve.solve({**BASE, "coverageFloorDemand": self.FEASIBLE})
        assert r["status"] == "optimal"
        assert r["details"]["model1"]["optimal"] is False
        assert isinstance(r["details"]["maxCoverableDemand"], int)

    def test_m1_feasible_m2_infeasible_says_best_found_never_maximum(self, monkeypatch):
        m = solve.solve(BASE)["details"]["coveredDemand"]
        _script_cbc(monkeypatch, ["feasible"])
        r = solve.solve({**BASE, "coverageFloorDemand": self.TOO_HIGH})
        assert r["status"] == "infeasible"
        assert r["details"]["model1"]["optimal"] is False
        assert r["infeasibilityReason"] == (
            f"Coverage floor {self.TOO_HIGH} could not be met. Model 1's best coverable demand "
            f"found was {m}; the exact maximum was not proven within the time/gap limit.")
        assert "maximum coverable" not in r["infeasibilityReason"]
        assert "Lower the floor" not in r["infeasibilityReason"]

    def test_m1_solved_m2_no_solution_keeps_model2_envelope_plus_model1(self, monkeypatch):
        _script_cbc(monkeypatch, [None, "no_solution"])
        r = solve.solve({**BASE, "coverageFloorDemand": self.FEASIBLE})
        assert r["status"] == "error"
        assert r["_failureReason"] == "solver_error"
        assert isinstance(r["details"]["maxCoverableDemand"], int)
        assert r["details"]["model1"]["optimal"] is True

    def test_m1_infeasible_returns_model1_envelope_and_never_runs_model2(self, monkeypatch):
        limits = _script_cbc(monkeypatch, ["infeasible"])
        r = solve.solve({**BASE, "coverageFloorDemand": self.FEASIBLE})
        assert len(limits) == 1
        assert r["status"] == "infeasible"
        assert "maxCoverableDemand" not in r["details"]
        assert r["infeasibilityReason"].startswith("No feasible assignment under the constraints")

    def test_m1_no_solution_returns_model1_envelope_and_never_runs_model2(self, monkeypatch):
        limits = _script_cbc(monkeypatch, ["no_solution"])
        r = solve.solve({**BASE, "coverageFloorDemand": self.FEASIBLE})
        assert len(limits) == 1
        assert r["status"] == "error"
        assert "maxCoverableDemand" not in r["details"]
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/api-server/src/solver && python3 -m pytest tests/test_max_coverage.py -x -q 2>&1 | tail -5`
Expected: FAIL — first failure is `AttributeError: module 'solve' has no attribute 'resolve_max_coverage_run'` or an assertion on `maxCoverableDemand`.

- [ ] **Step 4: Implement the solver**

In `artifacts/api-server/src/solver/solve.py`, replace everything from the comment block `# Al's Athletics — Max Coverage solver (Chapter 4)` (`:1431`) through the end of `solve_max_coverage` (the `return _envelope(...)` ending at `:1553`) with:

```python
# ---------------------------------------------------------------------------
# Al's Athletics — Max Coverage solver (Chapter 4)
# US single-echelon warehouse -> customer service-level model. TWO models over
# ONE LP builder (hard rule 6: the senses differ by a coefficient table, a
# direction and one optional row -- no model code path):
#   max_coverage  (Model 1) -> MAXIMISE high-service-covered demand
#   min_distance  (Model 2) -> MINIMISE total demand-weighted distance,
#                              covering at least `floor` when floor > 0
# Both keep every shared constraint: exactly p open, forced-open/inactive,
# assignment only within maxDistMi, and the average-distance cap.
# The RUN PLAN (spec 2026-10-10-ch4-objective-selector-design.md §2/§5) picks
# which models run: model1, model2, or sequential (Model 1, then Model 2, with
# Model 1's covered demand reported as maxCoverableDemand).
# Distances are RAW MILES and ARE the effective distances (§2.1 of the
# 2026-10-09 spec: no unit conversion, no circuity factor). Demand is the
# integer domain (D30).
# ---------------------------------------------------------------------------
def resolve_max_coverage_run(floor, objective):
    """Which Chapter 4 run a (floor, objective) pair asks for.

    Python copy of @workspace/units' resolveMaxCoverageRun
    (lib/units/src/objective.ts) -- solve.py cannot import TypeScript. Both
    copies are tested against ONE case table,
    lib/units/src/__tests__/maxCoverageRunCases.json.
      floor > 0                         -> "sequential"
      floor == 0, objective coverage     -> "model1"
      floor == 0, objective min_distance -> "model2"
      floor == 0, objective absent       -> None (cannot solve)
    """
    if floor > 0:
        return "sequential"
    return {"coverage": "model1", "min_distance": "model2"}.get(objective)


# The final solve of each run, as DATA: (LP sense, details.objective label).
# "sequential" additionally runs Model 1 first -- that is the only difference.
_MAX_COVERAGE_FINAL_SOLVE = {
    "model1": ("max_coverage", "coverage"),
    "model2": ("min_distance", "min_distance"),
    "sequential": ("min_distance", "min_distance"),
}


def _build_max_coverage_lp(ctx, sense, floor):
    """ONE LP for both Chapter 4 models. The floor row is added only when
    floor > 0. Constraint ORDER is the pre-CH4OS order (cap, objective, floor,
    assignment, p, forced/link), so the LP handed to CBC is byte-identical for
    every pre-existing case and every pre-existing golden still holds."""
    from pulp import LpMaximize, LpInteger
    cand, custs, dem = ctx["cand"], ctx["custs"], ctx["dem"]
    adj, hsp, mdp = ctx["adj"], ctx["hsp"], ctx["mdp"]
    direction, coef = {"max_coverage": (LpMaximize, hsp), "min_distance": (LpMinimize, adj)}[sense]
    prob = LpProblem("max_coverage", direction)
    a = LpVariable.dicts("A", [(w, c) for w in cand for c in custs], 0, 1, LpInteger)
    o = LpVariable.dicts("O", cand, 0, 1, LpInteger)
    prob += lpSum(adj[w, c] * dem[c] * a[w, c] for w in cand for c in custs) <= ctx["cap"] * ctx["total"]
    prob += lpSum(coef[w, c] * dem[c] * a[w, c] for w in cand for c in custs)
    if floor > 0:
        prob += lpSum(hsp[w, c] * dem[c] * a[w, c] for w in cand for c in custs) >= floor
    for c in custs:
        prob += lpSum(a[w, c] for w in cand) == 1
    prob += lpSum(o[w] for w in cand) == ctx["p"]
    for w in cand:
        if w in ctx["forced"]:
            prob += o[w] == 1
        for c in custs:
            prob += a[w, c] <= o[w]
            prob += a[w, c] <= mdp[w, c]
    return prob, a, o


def _run_max_coverage_lp(ctx, sense, floor, gap, time_limit):
    prob, a, o = _build_max_coverage_lp(ctx, sense, floor)
    cbc = _run_cbc(prob, gap, time_limit, problem_uid="max_coverage", msg=0)
    return prob, a, o, cbc


def _read_max_coverage_solution(ctx, a, o):
    """Reads a solved LP back into the reported quantities. Rounding is D22,
    unchanged: coveragePct 4 dp, weighted average 2 dp."""
    edges, covered, tdd = [], 0.0, 0.0
    for w in ctx["cand"]:
        for c in ctx["custs"]:
            v = a[w, c].varValue
            if v and v > 0.5:
                d = ctx["adj"][w, c]
                edges.append({"fromId": w, "toId": c, "distance": round(d, 2), "flow": ctx["dem"][c]})
                tdd += ctx["dem"][c] * d
                if ctx["hsp"][w, c]:
                    covered += ctx["dem"][c]
    total = ctx["total"]
    return {
        "edges": edges,
        "openIds": sorted(w for w in ctx["cand"] if o[w].varValue and o[w].varValue > 0.5),
        "coveredDemand": int(covered),
        "coveragePct": round(covered * 100 / total, 4),
        "weightedAvgDistance": round(tdd / total, 2),
    }


def _cbc_evidence(cbc):
    return {"termination_reason": cbc.terminationReason, "achieved_gap": cbc.achievedGap,
            "solver_incumbent_objective": cbc.solverIncumbentObjective,
            "solver_best_bound": cbc.solverBestBound}


def _max_coverage_no_network_envelope(cbc, run_time):
    """A CBC run that produced no network -- pre-CH4OS semantics, unchanged:
    "Infeasible" is the truthful infeasible envelope (D17); any other
    non-"Optimal" status is a solver_error failure. `details` is a fresh copy
    so a sequential run can add Model 1's summary without mutating the shared
    _EMPTY_DETAILS constant."""
    if cbc.lpStatus == "Infeasible":
        return _envelope("infeasible", "infeasible", 0, run_time, [], _EMPTY_METRICS, dict(_EMPTY_DETAILS),
                         "No feasible assignment under the constraints — the coverage "
                         "floor and the average-distance cap are both candidates",
                         **_cbc_evidence(cbc))
    env = _envelope("error", "error", 0, run_time, [], _EMPTY_METRICS, dict(_EMPTY_DETAILS),
                    f"Solver terminated with status: {cbc.lpStatus}", **_cbc_evidence(cbc))
    env["_failureReason"] = "solver_error"
    env["_failureStage"] = "cbc_parse"
    return env


def _floor_exceeds_message(floor, model1):
    m = model1["coveredDemand"]
    if model1["optimal"]:
        return (f"Coverage floor {floor} exceeds the maximum coverable demand {m} (Model 1). "
                f"Lower the floor to at most {m}.")
    return (f"Coverage floor {floor} could not be met. Model 1's best coverable demand found "
            f"was {m}; the exact maximum was not proven within the time/gap limit.")


def solve_max_coverage(inp):
    # Dataset load-failure containment (H4).
    if "max-coverage-us" in _LOAD_ERRORS:
        return _load_error_envelope("max-coverage-us")
    t = time.time()
    m = build_merged_max_coverage_dataset(inp, WAREHOUSES_MAX_COVERAGE, CUSTOMERS_MAX_COVERAGE, DISTANCE_MAX_COVERAGE)
    cand = [wid for wid in m["warehouses"] if wid not in m["inactive"]]
    custs = [cid for cid in m["customers"] if cid not in m["excluded"]]
    dem = {cid: m["customers"][cid]["demand"] for cid in custs}
    total = sum(dem.values())
    hi, mx, p = inp["highServiceDistMi"], inp["maxDistMi"], inp["p"]
    if total <= 0:
        # Pure pre-solve, data-derived infeasibility (zero effective demand).
        return _envelope("infeasible", "infeasible", 0, round(time.time() - t, 2), [],
                         _EMPTY_METRICS, _EMPTY_DETAILS, "Total effective demand is zero",
                         termination_reason="infeasible")
    # .get((w,c), 9999): an added entity with no distance to a counterpart is
    # unreachable, never a KeyError (the "solver never throws" contract).
    adj = {(w, c): m["distance"].get((w, c), 9999) for w in cand for c in custs}
    ctx = {"cand": cand, "custs": custs, "dem": dem, "total": total, "adj": adj,
           "hsp": {k: (1 if v <= hi else 0) for k, v in adj.items()},
           "mdp": {k: (1 if v <= mx else 0) for k, v in adj.items()},
           "p": p, "forced": m["forced"], "cap": inp["avgServiceDistCapMi"]}
    floor = inp["coverageFloorDemand"]
    run = resolve_max_coverage_run(floor, inp.get("objective"))
    if run is None:
        # Defensive only: services/precheck.ts's `objective_required` blocks
        # this before enqueue. A dispatch failure, never a published result.
        env = _envelope("error", "error", 0, round(time.time() - t, 2), [], _EMPTY_METRICS,
                        dict(_EMPTY_DETAILS), "objective is required when coverageFloorDemand is 0")
        env["_failureReason"] = "internal_error"
        env["_failureStage"] = "dispatch"
        return env
    gap, limit = inp["gap"], inp["timeLimitSec"]
    model1 = None
    if run == "sequential":
        # Budget split (§5): the job watchdog kills at timeLimitSec + 15 s
        # grace, and each CBC call gets its own limit.
        t1 = time.time()
        _, a1, o1, cbc1 = _run_max_coverage_lp(ctx, "max_coverage", 0, gap, max(1, limit // 2))
        if cbc1.lpStatus != "Optimal":
            # Model 2 shares every Model 1 constraint, so it cannot be
            # feasible when Model 1 is not; return Model 1's envelope as is.
            return _max_coverage_no_network_envelope(cbc1, round(time.time() - t, 2))
        s1 = _read_max_coverage_solution(ctx, a1, o1)
        model1 = {"openWarehouseIds": s1["openIds"], "coveredDemand": s1["coveredDemand"],
                  "coveragePct": s1["coveragePct"], "weightedAvgDistance": s1["weightedAvgDistance"],
                  # Not proven optimal -> coveredDemand is only a lower bound
                  # on the true maximum ("best found", never "maximum").
                  "optimal": cbc1.solutionStatus == "optimal"}
        limit = max(1, limit - (time.time() - t1))
    sense, mode = _MAX_COVERAGE_FINAL_SOLVE[run]
    prob, a, o, cbc = _run_max_coverage_lp(ctx, sense, floor, gap, limit)
    if cbc.lpStatus != "Optimal":
        env = _max_coverage_no_network_envelope(cbc, round(time.time() - t, 2))
        if model1 is not None:
            env["details"].update(objective="min_distance", coverageFloorDemand=floor,
                                  maxCoverableDemand=model1["coveredDemand"], model1=model1)
            if cbc.lpStatus == "Infeasible":
                env["infeasibilityReason"] = _floor_exceeds_message(floor, model1)
        return env
    s = _read_max_coverage_solution(ctx, a, o)
    cov = s["coveragePct"]
    metrics = {"openFacilityIds": s["openIds"], "weightedAvgDistance": s["weightedAvgDistance"],
               "utilizationByNode": [],
               "bandCoverage": [{"band": hi, "percent": cov}, {"band": mx, "percent": 100.0}]}
    details = {"objective": mode, "p": p, "highServiceDistMi": hi, "maxDistMi": mx,
               "avgServiceDistCapMi": inp.get("avgServiceDistCapMi"), "coverageFloorDemand": inp.get("coverageFloorDemand"),
               "openWarehouseIds": s["openIds"], "coveragePct": cov, "coveredDemand": s["coveredDemand"],
               "uncoveredPct": round(100 - cov, 4), "assignments": []}
    if model1 is not None:
        details["maxCoverableDemand"] = model1["coveredDemand"]
        details["model1"] = model1
    obj = cov if mode == "coverage" else round(value(prob.objective), 2)   # D22: min-dist objective 2-dp
    return _envelope(cbc.solutionStatus, cbc.lpStatus, obj, round(time.time() - t, 2), s["edges"], metrics, details,
                     **_cbc_evidence(cbc))
```

`LpProblem`, `LpMinimize`, `LpVariable`, `lpSum`, `value` are already imported at module top (`solve.py:24-26`); `LpMaximize`/`LpInteger` are imported inside the builder exactly as the old function did.

- [ ] **Step 5: Measure the new golden on the new code**

Run:
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/api-server/src/solver && echo '{"modelType":"max_coverage_us","objective":"min_distance","p":3,"highServiceDistMi":450,"maxDistMi":3400,"avgServiceDistCapMi":650,"coverageFloorDemand":0,"gap":0.0,"timeLimitSec":60,"warehouseOverrides":[],"customerOverrides":[],"addedWarehouses":[],"addedCustomers":[],"distanceOverrides":[]}' | python3 solve.py | python3 -c "import json,sys; r=json.load(sys.stdin); print(r['status'], r['objective'], r['metrics']['weightedAvgDistance'], sorted(r['details']['openWarehouseIds']), r['details']['coveredDemand'], r['details']['coveragePct'])"
```
Expected: `optimal 29873735731.0 382.87 ['BAL', 'DAL', 'LA'] 52346880 67.0887`. If any value differs, the measured value wins: paste it into `test_model2_floor_zero_golden` and record both numbers in the changelog entry.

- [ ] **Step 6: Run the Chapter 4 suite**

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/api-server/src/solver && python3 -m pytest tests/test_max_coverage.py -q 2>&1 | tail -3`
Expected: all PASS (the pre-existing goldens — coverage 70.42/394.65, min-distance 30269639699.0, MIG-11's 29873735731 — pass unmodified).

- [ ] **Step 7: Update the api-server envelope test that spawns solve.py**

In `artifacts/api-server/src/__tests__/resultEnvelope.test.ts`:
- Replace the comment at `:63-64` with `// CH4OS — a zero floor runs Model 1 only when objective "coverage" is sent.` and add `objective: "coverage",` to the payloads at `:66-69` and `:91-93`.
- In the `"max-coverage-us model-level infeasible (coverage floor)"` test (`:74-81`), change the cast to `as { status: string; details: Record<string, unknown> }` and add after the status assertion:

```ts
    // CH4OS — the sequential infeasible envelope carries Model 1's summary in
    // `details` and still validates: details is z.record(z.string(), z.unknown()).
    expect(typeof raw.details.maxCoverableDemand).toBe("number");
    expect(raw.details.model1).toBeTypeOf("object");
```

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/resultEnvelope.test.ts`
Expected: PASS.

- [ ] **Step 8: Correct the now-false payload-builder comment**

In `artifacts/api-server/src/solver/pmedian.ts`, replace the two lines `// \`objective\` is still forwarded for traceability, but solve.py ignores` / `// it and re-derives the mode from the floor itself.` with:

```ts
    // CH4OS — `objective` is forwarded and READ: at a zero floor it selects
    // Model 1 or Model 2 (solve.py's resolve_max_coverage_run).
```

- [ ] **Step 9: Full solver suite + sacred accuracy gate**

Run, separately:
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/api-server/src/solver && python3 -m pytest tests/ -x -q 2>&1 | tail -3
cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py 2>&1 | tail -3
```
Expected: pytest all PASS (a `test_transport.py::TestSingleSource` timeout is the known load flake — re-run that class alone); `e2e_accuracy.py` `99/99`, file unmodified (`git diff --stat -- artifacts/api-server/src/solver/tests/e2e_accuracy.py` prints nothing).

- [ ] **Step 10: Append the changelog entry**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown
## CH4OS — Chapter 4 objective selector and sequential solve (2026-10-10 spec)

Spec: `docs/superpowers/specs/2026-10-10-ch4-objective-selector-design.md`. Plan: `docs/superpowers/plans/2026-10-10-ch4-objective-selector.md`.

### CH4OS-1 — solver: one LP builder, run plan, sequential Model 1 → Model 2

- `solve_max_coverage` now builds both models through `_build_max_coverage_lp(ctx, sense, floor)` (hard rule #6: coefficient table + direction + one optional row, pre-CH4OS constraint order so existing LPs are byte-identical) and runs the plan from `resolve_max_coverage_run(floor, objective)`.
- `sequential` adds `details.maxCoverableDemand` + `details.model1`; floor-too-high returns the standard infeasible envelope (raw objective 0) with the "maximum" / "best found" message.
- Time budget: Model 1 `max(1, T // 2)`, Model 2 `max(1, T − elapsed)`.
- Shared case table `lib/units/src/__tests__/maxCoverageRunCases.json` (TS consumer lands in CH4OS-2).
- New golden (Model 2, floor 0), measured by Step 5's command: <the line Step 5 printed>.
- Gate: `test_max_coverage.py` <pytest summary line>; full solver pytest <summary line>; `e2e_accuracy.py` <N/N>.
```

Fill each `<…>` with the exact text the named step printed in this task's own run (or `unknown`).

- [ ] **Step 11: Commit**

```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
```
then:
```bash
git add artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/tests/test_max_coverage.py lib/units/src/__tests__/maxCoverageRunCases.json artifacts/api-server/src/__tests__/resultEnvelope.test.ts artifacts/api-server/src/solver/pmedian.ts docs/CHANGELOG-implementation.md
git commit artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/tests/test_max_coverage.py lib/units/src/__tests__/maxCoverageRunCases.json artifacts/api-server/src/__tests__/resultEnvelope.test.ts artifacts/api-server/src/solver/pmedian.ts docs/CHANGELOG-implementation.md -m "[CH4OS-1] build both Chapter 4 models from one LP and run Model 1 then Model 2 at a positive floor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2 (CH4OS-2): The objective contract — ONE commit across layers

**Roles:** backend-engineer (lib/units, api-server, OpenAPI) + frontend-engineer (studio), one working tree, **one commit** (CLAUDE.md: "a change crossing a layer boundary is ONE commit"; a new closed-union error code is TS union + OpenAPI enum + regenerated client together). Consumers are removed before producers inside the task: studio and tests stop needing `coverage_floor_infeasible` / the strip before the server stops producing them, but all of it lands in this single commit.

**Spec:** §3, §4, §6.1, §9 (API, Studio, lib/units).

**Files:**
- Modify: `lib/units/src/objective.ts:43-55`, `lib/units/src/__tests__/objective.test.ts`
- Modify: `artifacts/api-server/src/services/scenarioInputWrite.ts:1-35,85-100,140-158`
- Modify: `artifacts/api-server/src/routes/scenarios.ts:85,210-213,307-308`
- Modify: `artifacts/api-server/src/validation/inputs/maxCoverage.ts:1-13,103-108` (comments only)
- Modify: `artifacts/api-server/src/services/precheck.ts:60-74,79-89,205-247,328-346`
- Modify: `lib/api-spec/openapi.yaml:1926` + regenerate
- Modify tests: `artifacts/api-server/src/__tests__/{precheck,maxCoverageContract,maxCoverageWriteGuard,routes}.test.ts`, `artifacts/api-server/src/solver/__tests__/scenarioSolveAtomicity.test.ts:262-279`
- Modify: `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx`
- Modify: `artifacts/studio/src/components/workspace/SolveDialog.tsx`
- Modify tests: `artifacts/studio/src/__tests__/{OptimizationParametersTab.test.tsx,Workspace.test.tsx,SolveDialog.test.tsx,noHardcodedDemandHint.test.ts}`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `lib/units/src/__tests__/maxCoverageRunCases.json` (CH4OS-1).
- Produces:
  - `@workspace/units`: `type MaxCoverageRun = "model1" | "model2" | "sequential"`; `resolveMaxCoverageRun(coverageFloorDemand: number, objective: "coverage" | "min_distance" | undefined): MaxCoverageRun | null`.
  - `PrecheckErrorCode` gains `"objective_required"`, loses `"coverage_floor_infeasible"`; same in `openapi.yaml` and generated `PrecheckErrorCode`.
  - `OptimizationParametersTabProps` gains `objective?: "coverage" | "min_distance"` and `onObjectiveChange?: (objective: "coverage" | "min_distance") => void`; test ids `objective-select`, `objective-coverage`, `objective-min-distance` (prefixed by `testIdPrefix`).
  - `SolveDialogProps` gains `solveBlockedReason?: string | null`; hint test id `solve-dialog-blocked-hint`.
  - `assertNoServerOwnedFields` and `withoutServerOwnedInputs` are **deleted**.

**Note — validation rule unchanged:** spec §3 lists `validation/inputs/maxCoverage.ts`'s `superRefine`, but the schema already declares `objective: z.enum(["coverage","min_distance"]).optional()` (`:107`) and the spec defines no rejection path, so no rule changes there; the positive-floor normalisation lives in `deriveServerOwnedInputs` (spec §3 "Write path"). Only the file's comments change.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail` (each engineer that edits code in this task).

### 2a — shared rule

- [ ] **Step 1: Failing lib/units test**

Append to `lib/units/src/__tests__/objective.test.ts` (and extend the import on line 2 to `import { objectiveDimension, objectiveConverts, convertObjective, deriveMaxCoverageObjective, resolveMaxCoverageRun } from "../objective.js";`, plus `import { readFileSync } from "node:fs";` at the top):

```ts
// CH4OS — the live rule. Read from the SAME case table solve.py's
// TestResolveMaxCoverageRun reads, so the two copies are pinned against each
// other rather than against two hand-copied lists.
describe("resolveMaxCoverageRun — the shared case table", () => {
  const cases = JSON.parse(
    readFileSync(new URL("./maxCoverageRunCases.json", import.meta.url), "utf8"),
  ) as Array<{ floor: number; objective: "coverage" | "min_distance" | null; run: string | null }>;

  it("the table is not vacuous", () => {
    expect(cases).toHaveLength(5);
    expect(new Set(cases.map((c) => c.run))).toEqual(new Set(["model1", "model2", "sequential", null]));
  });

  it.each(cases)("floor $floor, objective $objective -> $run", ({ floor, objective, run }) => {
    expect(resolveMaxCoverageRun(floor, objective ?? undefined)).toBe(run);
  });
});
```

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter @workspace/units exec vitest run src/__tests__/objective.test.ts`
Expected: FAIL — `resolveMaxCoverageRun` is not exported.

- [ ] **Step 2: Implement**

In `lib/units/src/objective.ts`, replace the doc comment above `deriveMaxCoverageObjective` (`:43-52`) and append the new function after it:

```ts
/**
 * HISTORICAL rule (pre-CH4OS): floor 0 -> coverage, floor > 0 -> min_distance.
 * Used ONLY by artifacts/api-server/src/migrations/ch4ToMiles.ts, which must
 * keep reproducing what it did when it ran. Every live consumer uses
 * `resolveMaxCoverageRun` below. Do not delete; do not change.
 */
export function deriveMaxCoverageObjective(coverageFloorDemand: number): "coverage" | "min_distance" {
  return coverageFloorDemand === 0 ? "coverage" : "min_distance";
}

export type MaxCoverageRun = "model1" | "model2" | "sequential";

/**
 * CH4OS — the ONE TypeScript rule for which Chapter 4 run a scenario asks for
 * (spec 2026-10-10-ch4-objective-selector-design.md §3). Consumed by the
 * api-server write path and precheck and by the studio form. solve.py carries
 * a Python copy (`resolve_max_coverage_run`); both are tested against
 * `__tests__/maxCoverageRunCases.json`.
 *   floor > 0                         -> "sequential" (Model 1, then Model 2)
 *   floor == 0, objective coverage     -> "model1"
 *   floor == 0, objective min_distance -> "model2"
 *   floor == 0, objective absent       -> null (cannot solve)
 */
export function resolveMaxCoverageRun(
  coverageFloorDemand: number,
  objective: "coverage" | "min_distance" | undefined,
): MaxCoverageRun | null {
  if (coverageFloorDemand > 0) return "sequential";
  if (objective === "coverage") return "model1";
  if (objective === "min_distance") return "model2";
  return null;
}
```

Run the Step 1 command. Expected: PASS (existing `deriveMaxCoverageObjective` tests unchanged and passing).

### 2b — write path

- [ ] **Step 3: Failing route tests**

In `artifacts/api-server/src/__tests__/routes.test.ts`, replace the whole `describe("CH4O-5 — the derived objective reaches all three write paths", …)` block (`:1236-1322`, including its leading comment) with:

```ts
// CH4OS (spec 2026-10-10 §3) — `objective` is conditionally client-authored.
// Floor 0: stored as sent, or absent (precheck's objective_required then blocks
// the solve). Positive floor: stored as "min_distance" whatever was sent — no
// rejection path. Asserted on what the route hands the (mocked) DB.
describe("CH4OS — objective on every write path", () => {
  function insertedInputs(chain: ReturnType<typeof makeChain>): Record<string, unknown> {
    const args = (chain.values as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: Record<string, unknown>;
    };
    return args.inputs;
  }
  function setArgsOf(chain: ReturnType<typeof makeChain>) {
    return (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: Record<string, unknown>;
      solveInputRevision?: unknown;
    };
  }

  it("CREATE at floor 0 with no objective stores it ABSENT", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([maxCoverageRow]);
    mockDb.insert.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "ch4 unchosen", modelId: "max-coverage-us", inputs: maxCoverageInputs });
    expect(res.status).toBe(201);
    expect("objective" in insertedInputs(chain)).toBe(false);
  });

  it("CREATE at floor 0 stores the student's objective as sent", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([maxCoverageRow]);
    mockDb.insert.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "ch4 m2", modelId: "max-coverage-us", inputs: { ...maxCoverageInputs, objective: "min_distance" } });
    expect(res.status).toBe(201);
    expect(insertedInputs(chain).objective).toBe("min_distance");
  });

  it("CREATE at a positive floor normalises a sent `coverage` to min_distance — not a 422", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([maxCoverageRow]);
    mockDb.insert.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "ch4 seq", modelId: "max-coverage-us", inputs: { ...maxCoverageInputs, coverageFloorDemand: 500, objective: "coverage" } });
    expect(res.status).toBe(201);
    expect(insertedInputs(chain).objective).toBe("min_distance");
  });

  it("CREATE at a positive floor with no objective stores min_distance", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([maxCoverageRow]);
    mockDb.insert.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "ch4 seq2", modelId: "max-coverage-us", inputs: { ...maxCoverageInputs, coverageFloorDemand: 500 } });
    expect(res.status).toBe(201);
    expect(insertedInputs(chain).objective).toBe("min_distance");
  });

  it("422s a CREATE whose inputs omit coverageFloorDemand", async () => {
    const cookie = await loginAs(OWNER);
    const { coverageFloorDemand: _omit, ...withoutFloor } = maxCoverageInputs;
    void _omit;
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "ch4 no floor", modelId: "max-coverage-us", inputs: withoutFloor });
    expect(res.status).toBe(422);
  });

  it("CLONE keeps a floor-0 source's chosen objective", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([
      { ...maxCoverageRow, inputs: { ...maxCoverageInputs, objective: "min_distance" } },
    ]));
    const chain = makeChain([maxCoverageRow]);
    mockDb.insert.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/13/clone").set("Cookie", cookie).send({});
    expect(res.status).toBe(201);
    expect(insertedInputs(chain).objective).toBe("min_distance");
  });

  it("CLONE of a positive-floor source stores min_distance", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([
      { ...maxCoverageRow, inputs: { ...maxCoverageInputs, coverageFloorDemand: 500 } },
    ]));
    const chain = makeChain([maxCoverageRow]);
    mockDb.insert.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/13/clone").set("Cookie", cookie).send({});
    expect(res.status).toBe(201);
    expect(insertedInputs(chain).objective).toBe("min_distance");
  });

  it("UPDATE accepts objective, and an objective-only change bumps the solve revision (makes a result stale)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([maxCoverageRow]));   // persisted: floor 0, no objective
    const chain = makeChain([maxCoverageRow]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).patch("/api/scenarios/13").set("Cookie", cookie)
      .send({ inputs: { ...maxCoverageInputs, objective: "coverage" } });
    expect(res.status).toBe(200);
    const setArgs = setArgsOf(chain);
    expect(setArgs.inputs.objective).toBe("coverage");
    expect(setArgs.solveInputRevision).toBeDefined();
  });

  // Control for the test above: without it, "solveInputRevision is defined"
  // passes against a writer that bumps on EVERY save.
  it("UPDATE with identical inputs does NOT bump the solve revision", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([maxCoverageRow]));
    const chain = makeChain([maxCoverageRow]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).patch("/api/scenarios/13").set("Cookie", cookie)
      .send({ inputs: maxCoverageInputs });
    expect(res.status).toBe(200);
    expect(setArgsOf(chain).solveInputRevision).toBeUndefined();
  });

  it("UPDATE re-normalises on a positive floor", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([maxCoverageRow]));
    const chain = makeChain([maxCoverageRow]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).patch("/api/scenarios/13").set("Cookie", cookie)
      .send({ inputs: { ...maxCoverageInputs, coverageFloorDemand: 500, objective: "coverage" } });
    expect(res.status).toBe(200);
    expect(setArgsOf(chain).inputs.objective).toBe("min_distance");
    expect(setArgsOf(chain).inputs.coverageFloorDemand).toBe(500);
  });
});
```

In `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts`: delete the import on line 4 and the whole `describe("assertNoServerOwnedFields — the guard inverts", …)` block (`:18-43`), and add in its place:

```ts
// CH4OS — `objective` is a student input again, so no write route refuses it.
// Source read (not behaviour): the guard function is deleted, and a stale
// reference would mean a route still refusing the field.
describe("CH4OS — no write route refuses objective", () => {
  it("routes/scenarios.ts no longer references assertNoServerOwnedFields", () => {
    const src = readFileSync(resolve(__dirname, "../routes/scenarios.ts"), "utf8");
    expect(src).not.toContain("assertNoServerOwnedFields");
    expect(src).toContain("deriveServerOwnedInputs("); // non-vacuity: the file is the one that writes
  });
});
```

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/routes.test.ts src/__tests__/maxCoverageWriteGuard.test.ts`
Expected: FAIL — the floor-0 "as sent" / positive-floor-with-coverage tests get 422 (`objective is derived…`) and the floor-0-absent test sees `objective: "coverage"`.

- [ ] **Step 4: Implement the write path**

In `artifacts/api-server/src/services/scenarioInputWrite.ts`:

Line 3: `import { resolveMaxCoverageRun } from "@workspace/units";`

Replace the comment block + `deriveServerOwnedInputs` (`:11-33`) with:

```ts
// The create/clone half of the write contract. `applyScenarioInputWrite`
// below is the UPDATE half; both apply the same rule.
//
// CH4OS (spec 2026-10-10-ch4-objective-selector-design.md §3) — max-coverage-us's
// `objective` is CONDITIONALLY client-authored. At a zero floor the student's
// choice is stored as sent, or left absent (precheck's `objective_required`
// then blocks the solve). At a positive floor every run is Model 1 then
// Model 2 whatever was sent, so the stored value is normalised to
// "min_distance" — keeping details.objective, resultSummary.objectiveMode and
// Compare's meaning for every positive-floor row. There is no rejection path.
//
// Ordering at every call site is fixed: validate -> derive -> persist. Only
// validation guarantees the floor is an integer, and this reads it.
export function deriveServerOwnedInputs(
  modelId: string,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  if (modelId !== MAX_COVERAGE_MODEL_ID) return inputs;
  const floor = inputs.coverageFloorDemand;
  if (typeof floor !== "number") return inputs; // validation already guaranteed this; defensive only
  if (resolveMaxCoverageRun(floor, undefined) !== "sequential") return inputs;
  return { ...inputs, objective: "min_distance" };
}
```

Replace the comment above `inputsToStore` (`:85-88`) with:

```ts
  // CH4OS — normalise the VALIDATED candidate (validate -> derive -> persist).
  // At a zero floor the client's `objective` (or its absence) is kept as sent.
```

Delete the four lines `// \`objective\` is derived from coverageFloorDemand, so it can never change` … `changed.delete("objective");` (`:104-107`) and put in their place:

```ts
  // CH4OS — `objective` is a real student input now: changing it alone is a
  // geometric change (bumps inputsUpdatedAt + solve_input_revision), so an
  // existing result goes stale. No key is exempted from the diff.
```

Delete the whole `assertNoServerOwnedFields` function and its doc comment (`:140-158`).

In `artifacts/api-server/src/routes/scenarios.ts`:
- Line 85 → `import { applyScenarioInputWrite, deriveServerOwnedInputs } from "../services/scenarioInputWrite.js";`
- Delete the block (`:210-213`):
```ts
  {
    const guardError = assertNoServerOwnedFields(body.modelId, body.inputs);
    if (guardError) { res.status(422).json({ error: guardError }); return; }
  }
```
- Delete (`:307-308`):
```ts
    const guardError = assertNoServerOwnedFields(existing.modelId, body.inputs);
    if (guardError) { res.status(422).json({ error: guardError }); return; }
```
(and the blank line that follows it).

In `artifacts/api-server/src/validation/inputs/maxCoverage.ts`, replace the header lines `// model with TWO coupled objectives, selected by the COVERAGE FLOOR rather` … `// (services/scenarioInputWrite.ts) — never client-authored.` (`:3-13`) with:

```ts
// model with TWO objectives (spec 2026-10-10-ch4-objective-selector-design.md):
//   - floor == 0  ->  the student picks `objective`: "coverage" (Model 1,
//                     maximize demand within highServiceDistMi) or
//                     "min_distance" (Model 2, minimize demand-weighted
//                     distance). Absent is storable but not solvable
//                     (precheck `objective_required`).
//   - floor  > 0  ->  Model 1, then Model 2 covering at least the floor; the
//                     write path stores "min_distance" whatever was sent
//                     (services/scenarioInputWrite.ts).
// The weighted-average service-distance cap (avgServiceDistCapMi) is a
// constraint in BOTH models, so it and the floor are unconditionally required.
```

and replace the comment above `objective:` (`:103-106`) with:

```ts
    // CH4OS — optional, client-authored at a zero floor; normalised to
    // "min_distance" at a positive floor by deriveServerOwnedInputs.
```

Fix the scenario-solve atomicity fixture: in `artifacts/api-server/src/solver/__tests__/scenarioSolveAtomicity.test.ts`, inside `const maxCoverageInputs = {` (`:263`), add `objective: "coverage",` as the first property (its `POST …/solve` test at `:306` must pass the new precheck).

Run the Step 3 command. Expected: PASS.

### 2c — precheck + contract

- [ ] **Step 5: Failing precheck/contract tests**

In `artifacts/api-server/src/__tests__/precheck.test.ts`:
- In `MAX_COVERAGE_BASE_COVERAGE` (`:1436`) add `objective: "coverage",` as the first property.
- Replace `MAX_COVERAGE_BASE_MIN_DISTANCE` (`:1453-1458`) with:
```ts
// A POSITIVE floor runs Model 1 then Model 2; the write path stores
// "min_distance" for it, so the fixture does too.
const MAX_COVERAGE_BASE_MIN_DISTANCE: MaxCoverageInputs = {
  ...MAX_COVERAGE_BASE_COVERAGE,
  objective: "min_distance",
  coverageFloorDemand: 100,
};
```
- Replace the whole `describe("coverage_floor_infeasible (positive floor only, …)", …)` block (`:1577-1631`) with:

```ts
  describe("objective_required (CH4OS — a zero floor needs an explicit objective)", () => {
    const { objective: _absent, ...noObjective } = MAX_COVERAGE_BASE_COVERAGE;
    void _absent;

    it("fires at floor 0 with no objective, with the exact student-facing message", () => {
      const result = precheckMaxCoverageInputs(noObjective as MaxCoverageInputs, MAX_COVERAGE_DATASET_FAKE);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        { code: "objective_required", message: "Choose an objective — Max coverage or Min distance — before solving." },
      ]);
    });

    it.each(["coverage", "min_distance"] as const)("does not fire at floor 0 when objective is %s", (objective) => {
      expect(precheckMaxCoverageInputs({ ...noObjective, objective } as MaxCoverageInputs, MAX_COVERAGE_DATASET_FAKE))
        .toEqual({ ok: true, errors: [] });
    });

    it("does not fire at a positive floor with no objective — that run is sequential regardless", () => {
      expect(precheckMaxCoverageInputs({ ...noObjective, coverageFloorDemand: 100 } as MaxCoverageInputs, MAX_COVERAGE_DATASET_FAKE))
        .toEqual({ ok: true, errors: [] });
    });
  });

  describe("coverage_floor_infeasible is gone (CH4OS — the solver reports the exact maximum)", () => {
    it("a floor far above coverable demand passes precheck", () => {
      // Coverable demand at highServiceDistMi 500 is 100+200+300 = 600. Before
      // CH4OS this was coverage_floor_infeasible; now Model 1 runs and reports it.
      const inputs: MaxCoverageInputs = { ...MAX_COVERAGE_BASE_MIN_DISTANCE, coverageFloorDemand: 999999 };
      expect(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE)).toEqual({ ok: true, errors: [] });
    });

    it("excluding coverable demand below a positive floor passes precheck too", () => {
      const inputs: MaxCoverageInputs = {
        ...MAX_COVERAGE_BASE_MIN_DISTANCE,
        coverageFloorDemand: 350,
        customerOverrides: [{ id: "C-3", status: "excluded" }],
      };
      expect(precheckMaxCoverageInputs(inputs, MAX_COVERAGE_DATASET_FAKE)).toEqual({ ok: true, errors: [] });
    });
  });
```
- In `describe("max-coverage-us — infeasibility attribution", …)` (`:1688-1720`), replace the tests `"names the floor when it exceeds coverable demand"` and `"names BOTH when both bounds are violated"` (and the comment between them) with:

```ts
  it("no longer names the floor — a floor above coverable demand reaches the solver", () => {
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...MAX_COVERAGE_BASE_COVERAGE, coverageFloorDemand: 500_100_100,
    });
    expect(res.errors.map((e) => e.code)).not.toContain("coverage_floor_infeasible");
  });

  // One list, no precedence rule (the solver/CLAUDE.md attribution gotcha).
  it("reports objective_required and the cap TOGETHER", () => {
    const { objective: _o, ...noObjective } = MAX_COVERAGE_BASE_COVERAGE;
    void _o;
    const res = runNetworkEditsPrecheckForModel("max-coverage-us", {
      ...noObjective, coverageFloorDemand: 0, avgServiceDistCapMi: 1,
    });
    const codes = res.errors.map((e) => e.code);
    expect(codes).toContain("objective_required");
    expect(codes).toContain("avg_distance_cap_infeasible");
  });
```

In `artifacts/api-server/src/__tests__/maxCoverageContract.test.ts`:
- Rename the test at `:55` to `"round-trips all 10 PrecheckError.code values through the generated client"` (count unchanged) and in its `codes` array replace `"coverage_floor_infeasible",` with `"objective_required",` and the `// CH4O-6 — avg_distance_cap_infeasible's sibling to coverage_floor_infeasible.` comment with `// CH4O-6 — the average-distance cap bound.`
- After that test's closed-enum assertion, add a new test in the same `describe`:

```ts
  // CH4OS — the removed code is REJECTED by the client and absent from the
  // published contract; reading the YAML catches a hand-edited generated file
  // that the safeParse alone would miss.
  it("publishes objective_required and no longer publishes coverage_floor_infeasible", () => {
    expect(PrecheckScenarioResponse.safeParse({
      ok: false, errors: [{ code: "coverage_floor_infeasible", message: "x" }],
    }).success).toBe(false);
    const yaml = readFileSync(resolve(__dirname, "../../../../lib/api-spec/openapi.yaml"), "utf8");
    const enumLine = yaml.match(/PrecheckError:[\s\S]*?enum: \[([^\]]*)\]/)?.[1] ?? "";
    expect(enumLine).toContain("objective_required");
    expect(enumLine).not.toContain("coverage_floor_infeasible");
  });
```
Add `import { readFileSync } from "node:fs";` and `import { resolve } from "node:path";` to that file's imports if absent.

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/precheck.test.ts src/__tests__/maxCoverageContract.test.ts`
Expected: FAIL (TS union lacks `objective_required`; generated enum rejects it).

- [ ] **Step 6: Implement precheck + OpenAPI + regenerate**

In `artifacts/api-server/src/services/precheck.ts`:
- Add import after line 15: `import { resolveMaxCoverageRun } from "@workspace/units";`
- In the header comment (`:59-74`), replace the `"coverage_floor_infeasible"` bullet with:
```ts
//   - "objective_required"         a ZERO coverageFloorDemand with no
//                                  `objective` chosen (CH4OS). The floor-too-
//                                  high case is no longer a precheck: the
//                                  solver runs Model 1 and reports the exact
//                                  maximum coverable demand.
```
- In `PrecheckErrorCode` (`:79-89`) replace `| "coverage_floor_infeasible"` with `| "objective_required"`.
- In the `precheckMaxCoverageInputs` doc comment (`:216-221`), replace the `coverage_floor_infeasible` bullet with:
```ts
 *   - objective_required         floor 0 with no `objective` (CH4OS) — via
 *                                @workspace/units' resolveMaxCoverageRun, the
 *                                same rule the write path and studio use.
```
- Immediately after the line `const errors: PrecheckError[] = [...precheckPMedianInputs(inputs as unknown as PMedianInputs, dataset).errors];`, insert:
```ts

  // --- objective_required (CH4OS): a zero floor needs an explicit choice ----
  if (resolveMaxCoverageRun(inputs.coverageFloorDemand, inputs.objective) === null) {
    errors.push({
      code: "objective_required",
      message: "Choose an objective — Max coverage or Min distance — before solving.",
    });
  }
```
- Delete the whole `// --- coverage_floor_infeasible: …` block through its closing `}` (`:328-346`).

In `lib/api-spec/openapi.yaml:1926`, the `enum:` line becomes:
```yaml
          enum: [completeness, id_collision, reference_integrity, p_range, capacity, zero_demand, no_feasible_route, objective_required, coefficient_range, avg_distance_cap_infeasible]
```

Regenerate:
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter @workspace/api-spec run codegen
git status --short lib/api-zod lib/api-client-react
```
Expected: codegen succeeds (it ends with `typecheck:libs`); status lists exactly `lib/api-zod/src/generated/api.ts`, `lib/api-zod/src/generated/types/precheckErrorCode.ts`, `lib/api-client-react/src/generated/api.schemas.ts`. `grep -rn coverage_floor_infeasible lib/api-zod/src/generated lib/api-client-react/src/generated` prints nothing.

Run the Step 5 command. Expected: PASS.

### 2d — studio

- [ ] **Step 7: Failing studio tests — the form**

In `artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx`:
- In the `"OptimizationParametersTab — Chapter 4 single form"` describe (`:708+`), change the header comment's `reads the SAME \`deriveMaxCoverageObjective\` rule` to `reads the SAME \`resolveMaxCoverageRun\` rule`, and:
  - `"names Model 1 when the floor is zero"` → render with `coverageFloorDemand={0} objective="coverage"`.
  - Replace `"names Model 2 when the floor is positive, and states BOTH the floor and the avg-distance cap"` with:
```ts
  it("names the sequential run when the floor is positive, stating the cutoff, the floor AND the cap", () => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={500} />);
    expect(screen.getByTestId("derived-model-line")).toHaveTextContent(
      "Model 1, then Model 2 — find the maximum demand coverable within 700 km, then minimize average distance covering at least 500, holding average distance at or under 1,000 km",
    );
  });
```
  - In `"omits the cap clause from the Model 2 line when avgServiceDistCapMi is absent"` replace the two positive assertions with `expect(line).toHaveTextContent("Model 1, then Model 2");` and `expect(line).toHaveTextContent("covering at least 500");` (keep both `not.toHaveTextContent` lines).
  - `"renders the line's distances in the DISPLAY unit, not the canonical one"` → add `objective="coverage"` to its render.
  - `"omits the cap clause (never throws, never claims a false cap) when avgServiceDistCapMi is absent"` → add `objective="coverage"` to its render.
- Append:

```tsx
// CH4OS (spec §6.1) — the objective selector and the four-case model line.
describe("OptimizationParametersTab — CH4OS objective selector", () => {
  beforeEach(() => window.localStorage.removeItem(STORAGE_KEY));

  it("at floor 0 shows the selector directly below the floor, nothing selected by default", () => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={0} onObjectiveChange={vi.fn()} />);
    const select = screen.getByTestId("objective-select");
    expect(screen.getByTestId("objective-coverage")).not.toBeChecked();
    expect(screen.getByTestId("objective-min-distance")).not.toBeChecked();
    expect(select).toHaveTextContent("Max coverage (Model 1)");
    expect(select).toHaveTextContent("Min distance (Model 2)");
    const floor = screen.getByTestId("input-coverage-floor");
    const line = screen.getByTestId("derived-model-line");
    expect(floor.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(select.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reflects the stored objective", () => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={0} objective="min_distance" onObjectiveChange={vi.fn()} />);
    expect(screen.getByTestId("objective-min-distance")).toBeChecked();
    expect(screen.getByTestId("objective-coverage")).not.toBeChecked();
  });

  it("reports a choice through onObjectiveChange", () => {
    const onObjectiveChange = vi.fn();
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={0} onObjectiveChange={onObjectiveChange} />);
    fireEvent.click(screen.getByTestId("objective-min-distance"));
    expect(onObjectiveChange).toHaveBeenCalledWith("min_distance");
  });

  it("is hidden at a positive floor", () => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={500} objective="min_distance" onObjectiveChange={vi.fn()} />);
    expect(screen.queryByTestId("objective-select")).not.toBeInTheDocument();
  });

  it("namespaces its test ids and radio-group name inside the Solve dialog", () => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={0} idPrefix="solve-dialog-" testIdPrefix="solve-dialog-" onObjectiveChange={vi.fn()} />);
    expect(screen.getByTestId("solve-dialog-objective-coverage")).toHaveAttribute("name", "solve-dialog-objective-select");
    expect(screen.queryByTestId("objective-coverage")).toBeNull();
  });

  it.each([
    [0, "coverage", "Model 1 — maximize demand within 700 km, holding average distance at or under 1,000 km"],
    [0, "min_distance", "Model 2 — minimize average distance, holding average distance at or under 1,000 km"],
    [0, undefined, "Choose an objective to solve."],
  ] as const)("floor %s + objective %s -> the spec's line", (floor, objective, text) => {
    render(<OptimizationParametersTab {...ch4Props} coverageFloorDemand={floor} objective={objective} />);
    expect(screen.getByTestId("derived-model-line")).toHaveTextContent(text);
  });
});
```

(The fourth case, `sequential`, is the rewritten floor-500 test above.)

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter studio exec vitest run src/__tests__/OptimizationParametersTab.test.tsx`
Expected: FAIL (no `objective-select`; line still floor-derived).

- [ ] **Step 8: Implement the form**

In `artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx`:
- Line 6: `import { type CanonicalUnit, resolveMaxCoverageRun } from "@workspace/units";`
- In `OptimizationParametersTabProps`, replace the `CH4O-7 — there is no \`objective\` prop any more: …` sentence (`:110-113`) with `CH4OS — \`objective\` is the student's floor-0 choice (see the prop below); the derived-model-line reads \`resolveMaxCoverageRun\`.`, replace `(and, via the same \`deriveMaxCoverageObjective\` rule, this component) derives \`objective\` from (0 -> coverage, > 0 -> min_distance, §2.3).` in the `coverageFloorDemand` doc (`:126-130`) with `(with \`objective\`) feeds \`resolveMaxCoverageRun\`: 0 -> the student's choice, > 0 -> Model 1 then Model 2.`, and add after `coverageFloorDemand?: number;`:
```ts
  /** CH4OS (spec §6.1) — the student's objective at a zero floor. Undefined =
   * not chosen (Solve is blocked). Ignored and hidden at a positive floor. */
  objective?: "coverage" | "min_distance";
  /** CH4OS — a radio choice. Workspace.tsx writes it into `localInputs`. */
  onObjectiveChange?: (objective: "coverage" | "min_distance") => void;
```
- Destructure `objective,` and `onObjectiveChange,` after `coverageFloorDemand,` in the component signature.
- Between the floor `<Input … data-testid={tid("input-coverage-floor")} />` and the `{(() => {` IIFE, insert:
```tsx
            {/* CH4OS (spec §6.1) — directly below the floor, only at floor 0,
                nothing selected by default. Native radios: one `name` per
                mount (pid) so the tab and the Solve dialog's copy never
                share a group. */}
            {(coverageFloorDemand ?? 0) === 0 && (
              <fieldset className="mt-2 space-y-1" data-testid={tid("objective-select")}>
                <legend className="text-xs text-muted-foreground">Objective</legend>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name={pid("objective-select")}
                    value="coverage"
                    checked={objective === "coverage"}
                    onChange={() => onObjectiveChange?.("coverage")}
                    data-testid={tid("objective-coverage")}
                  />
                  Max coverage (Model 1)
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name={pid("objective-select")}
                    value="min_distance"
                    checked={objective === "min_distance"}
                    onChange={() => onObjectiveChange?.("min_distance")}
                    data-testid={tid("objective-min-distance")}
                  />
                  Min distance (Model 2)
                </label>
              </fieldset>
            )}
```
- Inside the IIFE, replace the opening comment's first sentence `Reads the SAME derivation the server uses, so the label and the solve that runs cannot disagree.` with `Reads the SAME rule (resolveMaxCoverageRun) the server and solve.py use, so the label and the solve that runs cannot disagree.`, and replace the final `return ( <p …>{deriveMaxCoverageObjective(floor) === "coverage" ? … : …}</p> );` with:
```tsx
              const within = fmt(highServiceDistMi!);
              const run = resolveMaxCoverageRun(floor, objective);
              const text =
                run === "model1"
                  ? `Model 1 — maximize demand within ${within}${capClause}`
                  : run === "model2"
                    ? `Model 2 — minimize average distance${capClause}`
                    : run === "sequential"
                      ? `Model 1, then Model 2 — find the maximum demand coverable within ${within}, then minimize average distance covering at least ${floor.toLocaleString()}${capClause}`
                      : "Choose an objective to solve.";
              return (
                <p className="mt-1 text-[11px] text-muted-foreground" data-testid={tid("derived-model-line")}>
                  {text}
                </p>
              );
```

Run the Step 7 command. Expected: PASS.

- [ ] **Step 9: Failing studio tests — Workspace + SolveDialog**

In `artifacts/studio/src/__tests__/SolveDialog.test.tsx`, append:
```tsx
// CH4OS (spec §6.1) — Workspace derives this from the LOCAL draft.
describe("SolveDialog — solveBlockedReason", () => {
  const HINT = "Choose an objective — Max coverage or Min distance — before solving.";

  it("disables Solve and shows the hint when set", () => {
    renderDialog({ solveBlockedReason: HINT });
    expect(screen.getByTestId("solve-dialog-solve")).toBeDisabled();
    expect(screen.getByTestId("solve-dialog-blocked-hint")).toHaveTextContent(HINT);
  });

  it("leaves Solve enabled with no hint when unset", () => {
    const { onSolve } = renderDialog({ solveBlockedReason: null });
    expect(screen.queryByTestId("solve-dialog-blocked-hint")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    expect(onSolve).toHaveBeenCalledTimes(1);
  });
});
```

In `artifacts/studio/src/__tests__/Workspace.test.tsx`:
- `defaultInputsForModel — max-coverage-us` (`:2732`): rename the test to `"carries both unconditionally-required mode fields and starts with NO objective selected (CH4OS)"` (assertions unchanged).
- In `describe("Workspace — Chen inputs UI (max-coverage-us, C4.12)")`:
  - Replace the test `"shows the avg-service-cap AND the editable coverage floor (no toggle) and strips the derived objective from the save payload"` (`:2846-2870`): change its name to `"shows the avg-service-cap AND the editable coverage floor, and sends the student's objective in the save payload (CH4OS)"`, replace its leading comment with `// CH4OS — \`objective\` is a student input again, so the save body carries it as-is.`, and replace the final assertion with `expect(args.data.inputs).toHaveProperty("objective", "coverage");`.
  - Replace the test `"strips the derived objective from the Save-as-scenario CREATE body (CH4O-5)"` (`:2996-3048`): rename to `"carries the history entry's objective into the Save-as-scenario CREATE body (CH4OS)"`, replace its leading comment with `// CH4OS — the history entry's own objective goes into the CREATE body unchanged; the server keeps it (floor 0) or normalises it (positive floor).`, and replace the final assertion `expect(args.data.inputs).not.toHaveProperty("objective");` with `expect(args.data.inputs).toHaveProperty("objective", "coverage");`.
  - In `"solving a dirty Chapter 4 draft leaves it CLEAN afterwards…"` (`:3065+`), replace `expect(solveSaveArgs.data.inputs).not.toHaveProperty("objective");` with `expect(solveSaveArgs.data.inputs).toHaveProperty("objective", "coverage");` and replace the comment `// The save-before-solve branch ran, stripped the body, and the solve was` with `// The save-before-solve branch ran (objective sent as-is), and the solve was`.
  - Append inside the same describe:

```tsx
  // ── CH4OS (spec §6.1) — Solve is gated on the LOCAL draft ─────────────────
  const OBJECTIVE_HINT = "Choose an objective — Max coverage or Min distance — before solving.";

  it("floor 0 with no stored objective: nothing selected, Run Optimizer disabled with the hint; choosing re-enables it with no save", () => {
    const { objective: _o, ...noObjective } = maxCoverageCoverageInputs;
    void _o;
    const unselected = { ...maxCoverageScenario, inputs: noObjective };
    mockUseGetScenario.mockReturnValue({ data: unselected } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [unselected] } as unknown as ReturnType<typeof useListScenarios>);
    render(<Workspace modelId="max-coverage-us" userEmail="student@example.com" />);
    openParamsTab();

    expect(screen.getByTestId("objective-coverage")).not.toBeChecked();
    expect(screen.getByTestId("objective-min-distance")).not.toBeChecked();
    const run = screen.getByTestId("button-run-optimizer");
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("title", OBJECTIVE_HINT);

    fireEvent.click(screen.getByTestId("objective-coverage"));
    expect(screen.getByTestId("button-run-optimizer")).toBeEnabled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
  });

  it("raising the floor drops the objective and hides the selector; returning to 0 shows it unselected and disables Solve", () => {
    renderChen();   // stored objective "coverage", floor 0
    openParamsTab();
    expect(screen.getByTestId("objective-coverage")).toBeChecked();

    fireEvent.change(screen.getByTestId("input-coverage-floor"), { target: { value: "5" } });
    expect(screen.queryByTestId("objective-select")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-run-optimizer")).toBeEnabled();   // sequential needs no choice

    fireEvent.change(screen.getByTestId("input-coverage-floor"), { target: { value: "0" } });
    expect(screen.getByTestId("objective-coverage")).not.toBeChecked();
    expect(screen.getByTestId("objective-min-distance")).not.toBeChecked();
    expect(screen.getByTestId("button-run-optimizer")).toBeDisabled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
  });

  it("the Solve dialog's own Solve button disables from the same local draft, with the hint, and re-enables on a choice", () => {
    renderChen();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.change(screen.getByTestId("solve-dialog-input-coverage-floor"), { target: { value: "5" } });
    fireEvent.change(screen.getByTestId("solve-dialog-input-coverage-floor"), { target: { value: "0" } });

    expect(screen.getByTestId("solve-dialog-solve")).toBeDisabled();
    expect(screen.getByTestId("solve-dialog-blocked-hint")).toHaveTextContent(OBJECTIVE_HINT);

    fireEvent.click(screen.getByTestId("solve-dialog-objective-min-distance"));
    expect(screen.getByTestId("solve-dialog-solve")).toBeEnabled();
    expect(screen.queryByTestId("solve-dialog-blocked-hint")).not.toBeInTheDocument();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
  });
```
- Replace the whole `describe("CH4O-5 — the derived objective never leaves the client", …)` block (`:3423-3480`) with:

```tsx
describe("CH4OS — the student's objective is sent as-is", () => {
  const minDistanceInputs = {
    objective: "min_distance",
    p: 3, highServiceDistMi: 600, maxDistMi: 5000, avgServiceDistCapMi: 1000,
    coverageFloorDemand: 0, gap: 0, timeLimitSec: 120, capacityMode: "none",
    distanceBands: [600, 5000], warehouseOverrides: [], customerOverrides: [],
    addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
  };
  const seededScenario = {
    id: 1, name: "Chen min distance", modelId: "max-coverage-us", inputs: minDistanceInputs,
    result: null, stale: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };

  it("a PATCH carries the chosen min_distance objective and the floor", () => {
    mockUseGetScenario.mockReturnValue({ data: seededScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [seededScenario] } as unknown as ReturnType<typeof useListScenarios>);
    render(<Workspace modelId="max-coverage-us" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    const avgCap = screen.getByTestId("input-avg-service-cap");
    fireEvent.change(avgCap, { target: { value: "1200" } });
    fireEvent.blur(avgCap);
    fireEvent.click(screen.getByTestId("button-save"));
    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args.data.inputs).toMatchObject({ objective: "min_distance", coverageFloorDemand: 0, avgServiceDistCapMi: 1200 });
  });
});
```

In `artifacts/studio/src/__tests__/noHardcodedDemandHint.test.ts`, replace the comment lines `// decision 3). The real feasibility guard is the server-side` / ``// `coverage_floor_infeasible` precheck — no client-side hint, static or`` / `// dynamic, should replace it.` with:
```ts
// decision 3). Since CH4OS the floor-too-high case is reported by the solver
// itself (Model 1's exact maximum, spec 2026-10-10 §6.3) — no client-side
// hint, static or dynamic, should replace it.
```

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter studio exec vitest run src/__tests__/Workspace.test.tsx src/__tests__/SolveDialog.test.tsx`
Expected: FAIL (save bodies stripped; no gating; no `solveBlockedReason`).

- [ ] **Step 10: Implement Workspace + SolveDialog**

`artifacts/studio/src/components/workspace/SolveDialog.tsx`:
- In `SolveDialogProps`, after `onSolve: () => void;` add:
```ts
  /** CH4OS (spec §6.1) — when set, Solve is disabled and this sentence is
   * shown beside it. Workspace.tsx derives it from the LOCAL draft
   * (max-coverage-us at floor 0 with no objective chosen), so it reacts to the
   * embedded selector immediately, before any save. */
  solveBlockedReason?: string | null;
```
- Destructure `solveBlockedReason,` after `onSolve,`.
- Replace the `<DialogFooter>` contents' Solve button with:
```tsx
          {solveBlockedReason && (
            <p className="text-xs text-muted-foreground self-center sm:mr-auto" data-testid="solve-dialog-blocked-hint">
              {solveBlockedReason}
            </p>
          )}
```
inserted as the first child of `<DialogFooter>`, and the Solve `<Button>` becomes:
```tsx
          <Button type="button" onClick={onSolve} disabled={!!solveBlockedReason} data-testid="solve-dialog-solve">
            Solve
          </Button>
```

`artifacts/studio/src/pages/Workspace.tsx`:
- Line 4 → `import { type CanonicalUnit, resolveMaxCoverageRun } from "@workspace/units";`
- In `defaultInputsForModel`'s max-coverage case, replace the comment lines `// required, and \`objective\` is DERIVED server-side from the floor` / `// (\`0\` → coverage): sending one is a 422, so a default must not carry it.` / `// A zero floor is the coverage-mode default.` with `// required. CH4OS — no \`objective\`: a new scenario starts with nothing` / `// selected, so the student must choose before solving (spec §6.1).`; and the two lines `// \`objective\` is deliberately absent: the server derives it (§2.3) and` / `// the write guard REFUSES a client-sent one.` with `// \`objective\` is deliberately absent (CH4OS: nothing selected by default).`
- Delete `withoutServerOwnedInputs` and its doc comment (`:216-235`).
- After `coverageFloorDemandFromInputs` (`:295-298`) add:
```ts
// CH4OS — max-coverage-us's student-chosen objective. Anything but the two
// valid strings (absent, or a malformed legacy value) reads as "not chosen".
function objectiveFromInputs(inputs: Record<string, unknown> | null): "coverage" | "min_distance" | undefined {
  const raw = inputs?.objective;
  return raw === "coverage" || raw === "min_distance" ? raw : undefined;
}

const OBJECTIVE_REQUIRED_HINT = "Choose an objective — Max coverage or Min distance — before solving.";
```
- In the precheck query comment (`:1518`), replace `(zero_demand/no_feasible_route/coverage_floor_infeasible +` with `(zero_demand/no_feasible_route/objective_required +`.
- In `handleOptimizationParamsChange` (`:1919`), insert before `updateInputsField(field, value);`:
```ts
    // CH4OS (spec §6.1) — crossing the zero-floor boundary in EITHER direction
    // drops `objective` from the draft: above 0 the selector is hidden (any
    // positive floor runs Model 1 then Model 2; the server stores
    // min_distance), and back at 0 it must show with nothing selected.
    if (field === "coverageFloorDemand" && localInputs && !isBrowsingHistoryNow) {
      const crossesZero = (coverageFloorDemandFromInputs(localInputs) === 0) !== (value === 0);
      if (crossesZero) {
        const { objective: _dropped, ...rest } = localInputs;
        void _dropped;
        setLocalInputs({ ...rest, coverageFloorDemand: value });
        return;
      }
    }
```
- After `handleOptimizationParamsChange`, add:
```ts
  // CH4OS — the selector's write. Same history-read-only guard as every input.
  function handleObjectiveChange(objective: "coverage" | "min_distance") {
    updateInputsField("objective", objective);
  }
```
- `buildWholeInputPayload` (`:2046-2048`) body → `return { ...(localInputs ?? {}), distanceBands: activeBandLens };`
- Immediately after `buildWholeInputPayload`, add:
```ts
  // CH4OS (spec §6.1) — Solve is gated on the LOCAL draft, not the persisted
  // precheck query: GET .../precheck validates the SAVED row, while the
  // selector edits only `localInputs`. The server's `objective_required`
  // precheck stays the enqueue-time authority.
  const objectiveRequired =
    modelId === "max-coverage-us" &&
    localInputs != null &&
    resolveMaxCoverageRun(coverageFloorDemandFromInputs(localInputs), objectiveFromInputs(localInputs)) === null;
```
- In `handleSolve`'s guard (`:2959-2964`) add `objectiveRequired ||` as the first condition inside the parentheses.
- In `handleSolve`'s `onSuccess` comment (`:2988-3003`), replace the sentences from ``// `buildWholeInputPayload()` runs the body through`` through ``// is stripped there), so this is the one correct form for both.`` with:
```ts
          // The response is the persisted row, which can differ from the
          // request (CH4OS: a positive floor is normalised to
          // objective "min_distance" server-side), and `isDirty` is a
          // JSON.stringify comparison — so adopting the request would leave
          // the draft permanently "Unsaved changes".
```
- `handleSaveAsScenario` (`:3163`) → `const inputs = { ...entry.inputs, distanceBands: activeBandLens };`
- In `optimizationParamsBaseProps`, replace the three-line `// CH4O-7 — no \`objective:\` entry here any more: …` comment (`:3240-3242`) with:
```ts
    // CH4OS — the student's floor-0 objective and its writer; the model line
    // and Solve gating both read `resolveMaxCoverageRun` (never a second copy).
    objective: modelId === "max-coverage-us" ? objectiveFromInputs(localInputs) : undefined,
    onObjectiveChange: handleObjectiveChange,
```
- Header Run Optimizer button (`:4354-4361`):
```tsx
            <Button
              size="sm"
              disabled={!currentScenario || isBrowsingHistoryNow || solvePhase !== "idle" || objectiveRequired}
              title={objectiveRequired ? OBJECTIVE_REQUIRED_HINT : undefined}
              onClick={openSolveDialog}
              data-testid="button-run-optimizer"
            >
```
- `<SolveDialog …>`: add `solveBlockedReason={objectiveRequired ? OBJECTIVE_REQUIRED_HINT : null}` after `onSolve={handleSolve}`.

Run the Step 9 command, then the Step 7 command. Expected: both PASS.

### 2e — whole-task gate, changelog, commit

- [ ] **Step 11: Grep for leftovers**

Run:
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && grep -rn "assertNoServerOwnedFields\|withoutServerOwnedInputs\|coverage_floor_infeasible" artifacts lib --include=*.ts --include=*.tsx --include=*.yaml | grep -v node_modules
grep -rn "deriveMaxCoverageObjective" artifacts lib --include=*.ts --include=*.tsx | grep -v node_modules
```
Expected: first prints nothing. Second prints only `lib/units/src/objective.ts`, `lib/units/src/__tests__/objective.test.ts`, `artifacts/api-server/src/migrations/ch4ToMiles.ts` (+ its tests) and comment mentions in `maxCoverageWriteGuard.test.ts` (ch4ToMiles allow-list reason — still accurate: that migration uses the historical rule).

- [ ] **Step 12: Full gate (commands separately)**

```bash
cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]; echo "concurrent vitest: $cnt"
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm run typecheck
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter studio test
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter @workspace/units test
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/api-server/src/solver && python3 -m pytest tests/ -x -q 2>&1 | tail -3
```
Expected: all PASS. If an api-server test outside the files above fails because a floor-0 max-coverage fixture now hits `objective_required` (the only new failure mode this task introduces), add `objective: "coverage"` to that fixture, re-run, and name the file in the changelog entry. Any other failure: check `docs/superpowers/flake-registry.md` by test name; re-run the file twice in isolation before treating it as real.

- [ ] **Step 13: Append the changelog entry**

```markdown
### CH4OS-2 — objective contract (one commit: units, write path, precheck, OpenAPI, studio)

- `@workspace/units` `resolveMaxCoverageRun` (pinned against solve.py via `maxCoverageRunCases.json`); `deriveMaxCoverageObjective` kept as the historical rule for `ch4ToMiles` only.
- Write path: floor 0 stores `objective` as sent or absent; positive floor stores `min_distance`; `assertNoServerOwnedFields` + both route guards deleted; `changed.delete("objective")` removed, so an objective change bumps the solve revision.
- Precheck: `objective_required` added, `coverage_floor_infeasible` removed (TS union + `openapi.yaml` + regenerated Orval output).
- Studio: `objective-select` radios at floor 0; four-case `derived-model-line`; Solve disabled from the local draft in the header button and `SolveDialog` (`solveBlockedReason`); `withoutServerOwnedInputs` deleted.
- Validation rule unchanged (schema already accepted both values; spec defines no rejection path) — comments only.
- Known window: e2e floor-0 fixtures 422 on `objective_required` until CH4OS-5.
- Extra fixtures touched by Step 12: <file list, or "none">.
- Gate: typecheck <result>; api-server <summary line>; studio <summary line>; units <summary line>; solver pytest <summary line>.
```

- [ ] **Step 14: Commit**

```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
```
then (add any Step 12 fixture files to both lists):
```bash
FILES="lib/units/src/objective.ts lib/units/src/__tests__/objective.test.ts artifacts/api-server/src/services/scenarioInputWrite.ts artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/validation/inputs/maxCoverage.ts artifacts/api-server/src/services/precheck.ts lib/api-spec/openapi.yaml lib/api-zod/src/generated/api.ts lib/api-zod/src/generated/types/precheckErrorCode.ts lib/api-client-react/src/generated/api.schemas.ts artifacts/api-server/src/__tests__/precheck.test.ts artifacts/api-server/src/__tests__/maxCoverageContract.test.ts artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts artifacts/api-server/src/__tests__/routes.test.ts artifacts/api-server/src/solver/__tests__/scenarioSolveAtomicity.test.ts artifacts/studio/src/components/workspace/tabs/OptimizationParametersTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/components/workspace/SolveDialog.tsx artifacts/studio/src/__tests__/OptimizationParametersTab.test.tsx artifacts/studio/src/__tests__/Workspace.test.tsx artifacts/studio/src/__tests__/SolveDialog.test.tsx artifacts/studio/src/__tests__/noHardcodedDemandHint.test.ts docs/CHANGELOG-implementation.md"
git add $FILES
git commit $FILES -m "[CH4OS-2] let students choose the Chapter 4 objective at a zero floor and require it before solving" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3 (CH4OS-3): Studio results — incumbent gating, max-coverable row, floor-exceeds-max alert

**Role:** frontend-engineer. **Spec:** §6.2, §6.3, §9 (Studio).

**Files:**
- Create: `artifacts/studio/src/components/workspace/FloorExceedsMaxAlert.tsx`
- Create: `artifacts/studio/src/__tests__/FloorExceedsMaxAlert.test.tsx`
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` (imports `:1-10`; single summary `:344-383`, table `:433`; Compare `:461-560`)
- Modify: `artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx` (import `:13`; insert before `:372`)
- Modify tests: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, `artifacts/studio/src/__tests__/OutputMapTab.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: CH4OS-1's `details.maxCoverableDemand`, `details.coverageFloorDemand`, `details.model1 = {openWarehouseIds, coveredDemand, coveragePct, weightedAvgDistance, optimal}`; `classifyResultOutcome`, `hasIncumbent`, `resultQualityText` (`lib/resultOutcome.ts:28,41,49`).
- Produces: `FloorExceedsMaxAlert({ result, formatDistance, className? })`, `floorExceedsMax(result)`; test ids `floor-exceeds-max-alert`, `cost-summary-max-coverable-demand`, `cost-summary-compare-max-coverable-demand-${id}`.

**Interpretation recorded here (spec §6.2 "render blank, with the existing No incumbent label"):** for a max-coverage result without an incumbent, the Objective cell shows `resultQualityText` ("No incumbent" — the same text the Output Map overlay already shows) and the distance and coverage cells show `—`. Compare's max-coverable cell is empty (`""`) for a scenario without the field, per "blank". Scoped to `modelId === "max-coverage-us"` (spec §11: no change to other models).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Failing tests**

Create `artifacts/studio/src/__tests__/FloorExceedsMaxAlert.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SolveResult } from "@workspace/api-client-react";
import { FloorExceedsMaxAlert } from "@/components/workspace/FloorExceedsMaxAlert";

const model1 = { openWarehouseIds: ["DAL", "LA", "PIT"], coveredDemand: 54946145, coveragePct: 70.42, weightedAvgDistance: 394.6, optimal: true };
const infeasible = {
  status: "infeasible", solutionStatus: "infeasible", terminationReason: "infeasible", achievedGap: null,
  objective: 0, runTimeSec: 1.2, quality: "infeasible", edges: [],
  metrics: { weightedAvgDistance: 0, bandCoverage: [], utilizationByNode: [] },
  details: { openWarehouseIds: [], assignments: [], objective: "min_distance", coverageFloorDemand: 500100100, maxCoverableDemand: 54946145, model1 },
  solverUsed: "CBC (PuLP)", infeasibilityReason: "x",
} as unknown as SolveResult;
const fmt = (v: number) => `${v.toFixed(1)} mi`;

describe("FloorExceedsMaxAlert (CH4OS §6.3)", () => {
  it("states the floor, the proven maximum, Model 1's summary and the fix", () => {
    render(<FloorExceedsMaxAlert result={infeasible} formatDistance={fmt} />);
    const alert = screen.getByTestId("floor-exceeds-max-alert");
    expect(alert).toHaveTextContent("Coverage floor 500,100,100 exceeds the maximum coverable demand 54,946,145.");
    expect(alert).toHaveTextContent("Model 2 is infeasible.");
    expect(alert).toHaveTextContent("Model 1 (max coverage): sites DAL, LA, PIT · coverage 70.42 % (54,946,145 demand) · avg distance 394.6 mi.");
    expect(alert).toHaveTextContent("Lower the floor to at most 54,946,145.");
  });

  it("uses best-found wording, and never 'maximum' or a lower-to advice, when Model 1 is not proven optimal", () => {
    const notProven = { ...infeasible, details: { ...(infeasible.details as object), model1: { ...model1, optimal: false } } } as unknown as SolveResult;
    render(<FloorExceedsMaxAlert result={notProven} formatDistance={fmt} />);
    const alert = screen.getByTestId("floor-exceeds-max-alert");
    expect(alert).toHaveTextContent("Coverage floor 500,100,100 could not be met.");
    expect(alert).toHaveTextContent("Model 1's best coverable demand found was 54,946,145; the exact maximum was not proven within the time/gap limit.");
    expect(alert).not.toHaveTextContent("maximum coverable demand");
    expect(alert).not.toHaveTextContent("Lower the floor");
  });

  it("renders nothing for a feasible result or an infeasible one without Model 1's summary", () => {
    const { container, rerender } = render(<FloorExceedsMaxAlert result={{ ...infeasible, status: "optimal", solutionStatus: "optimal" } as unknown as SolveResult} formatDistance={fmt} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FloorExceedsMaxAlert result={{ ...infeasible, details: { openWarehouseIds: [], assignments: [] } } as unknown as SolveResult} formatDistance={fmt} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Append to `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`:

```tsx
// CH4OS (spec §6.2/§6.3) — infeasible max-coverage results never show a fake 0;
// Model 1's max coverable demand is shown whenever the envelope carries it.
describe("Solution Summary — CH4OS sequential results", () => {
  const model1 = { openWarehouseIds: ["DAL", "LA", "PIT"], coveredDemand: 54946145, coveragePct: 70.42, weightedAvgDistance: 394.6, optimal: true };
  const infeasibleResult = {
    ...optimalResult,
    status: "infeasible" as const, solutionStatus: "infeasible" as const, terminationReason: "infeasible" as const,
    objective: 0, edges: [],
    metrics: { weightedAvgDistance: 0, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: [], assignments: [], objective: "min_distance", coverageFloorDemand: 500100100, maxCoverableDemand: 54946145, model1 },
  } as unknown as SolveResult;
  const sequentialResult = {
    ...optimalResult,
    objective: 30269639699,
    metrics: { ...optimalResult.metrics, weightedAvgDistance: 387.9 },
    details: { objective: "min_distance", coveragePct: 70.42, coveredDemand: 54946145, highServiceDistMi: 450, maxCoverableDemand: 54946145, model1 },
  } as unknown as SolveResult;

  it("an infeasible max-coverage result renders No incumbent / — and never a 0", () => {
    renderTab({ result: infeasibleResult, modelId: "max-coverage-us" });
    expect(screen.getByTestId("cost-summary-value-objective")).toHaveTextContent("No incumbent");
    expect(screen.getByTestId("cost-summary-coverage-pct")).toHaveTextContent("—");
    expect(screen.getByTestId("cost-summary-covered-demand")).toHaveTextContent("—");
    expect(screen.getByTestId("cost-summary-value-avg-distance-to-customers")).toHaveTextContent("—");
    for (const id of ["cost-summary-value-objective", "cost-summary-coverage-pct", "cost-summary-covered-demand", "cost-summary-value-avg-distance-to-customers"]) {
      expect(screen.getByTestId(id).textContent).not.toMatch(/^0(\.0+)?( |$)/);
    }
  });

  it("still shows Model 1's max coverable demand and the alert on an infeasible result", () => {
    renderTab({ result: infeasibleResult, modelId: "max-coverage-us" });
    expect(screen.getByTestId("cost-summary-max-coverable-demand")).toHaveTextContent("54,946,145");
    expect(screen.getByText("Max coverable demand (Model 1)")).toBeInTheDocument();
    expect(screen.getByTestId("floor-exceeds-max-alert")).toHaveTextContent("avg distance 394.6 mi");
  });

  it("a sequential optimal result keeps every coverage row and adds the max-coverable row", () => {
    renderTab({ result: sequentialResult, modelId: "max-coverage-us" });
    expect(screen.getByTestId("cost-summary-coverage-pct")).toHaveTextContent("70.42 %");
    expect(screen.getByTestId("cost-summary-max-coverable-demand")).toHaveTextContent("54,946,145");
    expect(screen.queryByTestId("floor-exceeds-max-alert")).not.toBeInTheDocument();
  });

  it("labels it 'Best coverable demand found' when Model 1 was not proven optimal", () => {
    const notProven = { ...sequentialResult, details: { ...(sequentialResult.details as object), model1: { ...model1, optimal: false } } } as unknown as SolveResult;
    renderTab({ result: notProven, modelId: "max-coverage-us" });
    expect(screen.getByText("Best coverable demand found (Model 1)")).toBeInTheDocument();
    expect(screen.queryByText("Max coverable demand (Model 1)")).not.toBeInTheDocument();
  });

  it("Compare: the infeasible column reads No incumbent / —; the max-coverable column is blank where absent", () => {
    const infeasibleScenario = scenario({ id: 70, name: "Too high", modelId: "max-coverage-us", result: infeasibleResult });
    const plainScenario = scenario({
      id: 71, name: "Model 1", modelId: "max-coverage-us",
      result: { ...optimalResult, details: { objective: "coverage", coveragePct: 70.42, coveredDemand: 54946145, highServiceDistMi: 450 } } as unknown as SolveResult,
    });
    renderTab({ scenarios: [infeasibleScenario, plainScenario], modelId: "max-coverage-us" });
    fireEvent.click(screen.getByTestId(`cost-summary-compare-toggle-${plainScenario.id}`).querySelector("input")!);
    expect(screen.getByTestId(`cost-summary-compare-objective-${infeasibleScenario.id}`)).toHaveTextContent("No incumbent");
    expect(screen.getByTestId(`cost-summary-compare-distance-${infeasibleScenario.id}`)).toHaveTextContent("—");
    expect(screen.getByTestId(`cost-summary-compare-coverage-pct-${infeasibleScenario.id}`)).toHaveTextContent("—");
    expect(screen.getByTestId(`cost-summary-compare-max-coverable-demand-${infeasibleScenario.id}`)).toHaveTextContent("54,946,145");
    expect(screen.getByTestId(`cost-summary-compare-max-coverable-demand-${plainScenario.id}`)).toHaveTextContent("");
    expect(screen.getByTestId(`cost-summary-compare-max-coverable-demand-${plainScenario.id}`).textContent).toBe("");
  });

  it("leaves a non-Chapter-4 infeasible result's rendering untouched (spec §11)", () => {
    renderTab({ result: { ...infeasibleResult, details: {} } as unknown as SolveResult, modelId: "p-median-us" });
    expect(screen.getByTestId("cost-summary-value-objective")).not.toHaveTextContent("No incumbent");
  });
});
```

In `artifacts/studio/src/__tests__/OutputMapTab.test.tsx`, append `{ id: "max-coverage-us", distanceUnit: "mi" },` to `mockUseListModels`'s `data` array, then append:

```tsx
describe("OutputMapTab — CH4OS floor-exceeds-max alert", () => {
  const infeasibleWithModel1 = {
    ...result,
    status: "infeasible" as const, solutionStatus: "infeasible" as const, objective: 0, edges: [],
    metrics: { weightedAvgDistance: 0, bandCoverage: [], utilizationByNode: [] },
    details: {
      openWarehouseIds: [], assignments: [], objective: "min_distance", coverageFloorDemand: 500100100, maxCoverableDemand: 54946145,
      model1: { openWarehouseIds: ["DAL", "LA", "PIT"], coveredDemand: 54946145, coveragePct: 70.42, weightedAvgDistance: 394.6, optimal: true },
    },
  };

  it("renders the alert above the map, in the display unit", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={infeasibleWithModel1} bands={[450, 3400]} modelId="max-coverage-us" />);
    const alert = screen.getByTestId("floor-exceeds-max-alert");
    expect(alert).toHaveTextContent("Coverage floor 500,100,100 exceeds the maximum coverable demand 54,946,145.");
    expect(alert).toHaveTextContent("avg distance 394.6 mi");
    expect(screen.getByTestId("output-map-no-incumbent")).toHaveTextContent("No incumbent");
  });

  it("renders no alert for an ordinary infeasible result", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={{ ...infeasibleWithModel1, details: {} }} bands={[450, 3400]} modelId="max-coverage-us" />);
    expect(screen.queryByTestId("floor-exceeds-max-alert")).not.toBeInTheDocument();
  });
});
```

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter studio exec vitest run src/__tests__/FloorExceedsMaxAlert.test.tsx src/__tests__/CostSummaryTab.test.tsx src/__tests__/OutputMapTab.test.tsx`
Expected: FAIL (module not found; objective cell shows a formatted 0).

- [ ] **Step 2: Create the alert component**

`artifacts/studio/src/components/workspace/FloorExceedsMaxAlert.tsx`:

```tsx
import type { SolveResult } from "@workspace/api-client-react";
import { classifyResultOutcome } from "@/lib/resultOutcome";

// CH4OS (spec 2026-10-10 §6.3) — the floor-too-high alert, ONE component shared
// by Solution Summary and the Output Map so the two surfaces cannot word it
// differently. Shown only for an infeasible result carrying Model 1's summary
// — i.e. a sequential max-coverage run whose floor exceeded what Model 1
// covered. Gated on the envelope's SHAPE (only solve.py's sequential run emits
// `maxCoverableDemand`), never on modelId. Appears only after solving; nothing
// is precomputed on the form.
export interface Model1Summary {
  openWarehouseIds: string[];
  coveredDemand: number;
  coveragePct: number;
  weightedAvgDistance: number;
  optimal: boolean;
}

export function floorExceedsMax(
  result: SolveResult | null,
): { floor: number; max: number; model1: Model1Summary } | null {
  if (!result || classifyResultOutcome(result) !== "infeasible") return null;
  const d = result.details as { coverageFloorDemand?: unknown; maxCoverableDemand?: unknown; model1?: unknown } | undefined;
  if (typeof d?.maxCoverableDemand !== "number" || typeof d.coverageFloorDemand !== "number") return null;
  if (d.model1 == null || typeof d.model1 !== "object") return null;
  return { floor: d.coverageFloorDemand, max: d.maxCoverableDemand, model1: d.model1 as Model1Summary };
}

export function FloorExceedsMaxAlert({
  result,
  formatDistance,
  className = "mb-2",
}: {
  result: SolveResult | null;
  /** Canonical distance -> display text, from the host tab (unit-aware). */
  formatDistance: (canonical: number) => string;
  className?: string;
}) {
  const info = floorExceedsMax(result);
  if (!info) return null;
  const { floor, max, model1 } = info;
  const n = floor.toLocaleString();
  const m = max.toLocaleString();
  const model1Line =
    `Model 1 (max coverage): sites ${model1.openWarehouseIds.join(", ")} · coverage ${model1.coveragePct.toFixed(2)} % ` +
    `(${model1.coveredDemand.toLocaleString()} demand) · avg distance ${formatDistance(model1.weightedAvgDistance)}.`;
  return (
    <div
      role="alert"
      data-testid="floor-exceeds-max-alert"
      className={`${className} rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900`}
    >
      {model1.optimal ? (
        <>
          <strong>Coverage floor {n} exceeds the maximum coverable demand {m}.</strong>{" "}
          Model 2 is infeasible. {model1Line} Lower the floor to at most {m}.
        </>
      ) : (
        <>
          <strong>Coverage floor {n} could not be met.</strong>{" "}
          Model 2 is infeasible. Model 1&apos;s best coverable demand found was {m}; the exact maximum was not
          proven within the time/gap limit. {model1Line}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire Solution Summary + Compare**

`artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx`:
- Line 7 → `import { classifyResultOutcome, hasIncumbent, resultQualityText } from "@/lib/resultOutcome";` and add `import { FloorExceedsMaxAlert } from "@/components/workspace/FloorExceedsMaxAlert";`.
- After `const JADE_MODEL_ID = "two-echelon-jade-us";` add `const MAX_COVERAGE_MODEL_ID = "max-coverage-us";`.
- Single summary — replace from `const objectiveMode = objectiveModeOfDetails(result.details);` through the end of the `if (showCoverageRows) { rows.push(…); }` block with:

```tsx
    // CH4OS (spec §6.2) — a max-coverage result with no incumbent (infeasible/
    // no_solution/unbounded/error) carries solve.py's sentinel objective 0 /
    // weightedAvgDistance 0; show "No incumbent"/"—", never a fake 0. Scoped
    // to max-coverage-us (spec §11: no change to other models).
    const noIncumbent = modelId === MAX_COVERAGE_MODEL_ID && !hasIncumbent(classifyResultOutcome(result));
    const objectiveMode = objectiveModeOfDetails(result.details);
    const objectiveText = noIncumbent
      ? resultQualityText(result)
      : modelId != null && canonicalDistanceUnit != null
        ? formatObjective(modelId, objectiveMode, result.objective, canonicalDistanceUnit, unit)
        : formatChenObjective(result.objective, objectiveMode) ?? result.objective.toLocaleString();
    const rows: Array<[string, string, boolean, string?]> = [["Objective", objectiveText, true]];
    // CH4O-10 — Chapter 4's coverage rows (envelope-shape gate). CH4OS — also
    // shown, blank, for a no-incumbent max-coverage result.
    const ch4 = result.details as {
      coveragePct?: number; coveredDemand?: number; highServiceDistMi?: number;
      maxCoverableDemand?: number; model1?: { optimal?: boolean };
    } | undefined;
    const showCoverageRows = typeof ch4?.coveragePct === "number" || noIncumbent;
    if (showCoverageRows) {
      rows.push(
        // The SOLVED SNAPSHOT's cutoff, never localInputs.
        ["High service cutoff", formatDistance(ch4?.highServiceDistMi, canonicalDistanceUnit, unit), true, "cost-summary-high-service-cutoff"],
        ["% of demand within high service", noIncumbent || ch4?.coveragePct == null ? "—" : `${ch4.coveragePct.toFixed(2)} %`, true, "cost-summary-coverage-pct"],
        ["Total demand within high service", noIncumbent ? "—" : (ch4?.coveredDemand ?? 0).toLocaleString(), true, "cost-summary-covered-demand"],
      );
    }
    // CH4OS — Model 1's result rides along on a sequential run, including an
    // infeasible one (it comes from Model 1, not Model 2).
    if (typeof ch4?.maxCoverableDemand === "number") {
      rows.push([
        ch4.model1?.optimal === false ? "Best coverable demand found (Model 1)" : "Max coverable demand (Model 1)",
        ch4.maxCoverableDemand.toLocaleString(),
        true,
        "cost-summary-max-coverable-demand",
      ]);
    }
```
- In the following `rows.push(` for distance/runtime/quality/solver, change the distance value to `noIncumbent ? "—" : formatDistance(result.metrics.weightedAvgDistance, canonicalDistanceUnit, unit)`.
- Inside `<div className="overflow-auto flex-1 p-2">` (single view), insert before `<table`:
```tsx
          <FloorExceedsMaxAlert
            result={result}
            formatDistance={v => formatDistance(v, canonicalDistanceUnit, unit)}
          />
```
- Compare: after `const sharedBands = scenariosShareBands(results);` add:
```tsx
  // CH4OS — same no-incumbent rule as the single view, per column.
  const noIncumbentFor = (s: Scenario) =>
    modelId === MAX_COVERAGE_MODEL_ID && !hasIncumbent(classifyResultOutcome(s.result!));
```
  and change `compareShowCoverageRows` to:
```tsx
  const compareShowCoverageRows = compareScenarios.some(
    s => typeof (s.result!.details as { coveragePct?: number } | undefined)?.coveragePct === "number" || noIncumbentFor(s),
  );
```
- Compare Objective cell body → `{noIncumbentFor(s) ? resultQualityText(s.result!) : modelId != null && canonicalDistanceUnit != null ? formatObjective(modelId, scenarioObjectiveMode(s), s.result!.objective, canonicalDistanceUnit, unit) : formatChenObjective(s.result!.objective, scenarioObjectiveMode(s)) ?? s.result!.objective.toLocaleString()}`.
- Compare coverage-pct cell → `{typeof d?.coveragePct === "number" && !noIncumbentFor(s) ? \`${d.coveragePct.toFixed(2)} %\` : "—"}`; covered-demand cell → `{typeof d?.coveredDemand === "number" && !noIncumbentFor(s) ? d.coveredDemand.toLocaleString() : "—"}`.
- Directly after the closing `)}` of the `{compareShowCoverageRows && ( <> … </> )}` block, insert:
```tsx
            {/* CH4OS (spec §6.2) — Model 1's max coverable demand; blank for
                scenarios whose envelope does not carry it. */}
            {compareScenarios.some(s => typeof (s.result!.details as { maxCoverableDemand?: unknown } | undefined)?.maxCoverableDemand === "number") && (
              <tr>
                <td className="p-2 text-muted-foreground">Max coverable demand (Model 1)</td>
                {compareScenarios.map(s => {
                  const d = s.result!.details as { maxCoverableDemand?: number } | undefined;
                  return (
                    <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-max-coverable-demand-${s.id}`}>
                      {typeof d?.maxCoverableDemand === "number" ? d.maxCoverableDemand.toLocaleString() : ""}
                    </td>
                  );
                })}
              </tr>
            )}
```
- Compare distance cell → `{noIncumbentFor(s) ? "—" : formatDistanceValueOnly(s.result!.metrics.weightedAvgDistance, canonicalDistanceUnit, unit)}`.

- [ ] **Step 4: Wire the Output Map**

`artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx`: add `import { FloorExceedsMaxAlert } from "@/components/workspace/FloorExceedsMaxAlert";` after line 13, and immediately before `<div className="flex-1 min-h-0 relative" ref={mapRef}>` insert:
```tsx
      {/* CH4OS (spec §6.3) — same alert as Solution Summary, above the map so
          it never covers it; self-gated, renders nothing otherwise. */}
      <FloorExceedsMaxAlert result={result} formatDistance={showDistance} className="mx-2 mt-2" />
```

Run the Step 1 command. Expected: PASS.

- [ ] **Step 5: Studio suite + typecheck**

```bash
cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]; echo "concurrent vitest: $cnt"
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter studio run typecheck
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter studio test
```
Expected: PASS (`rawErrorMessageSurface`/`mutationErrorSurface` guards untouched — the new component renders no error message).

- [ ] **Step 6: Changelog + commit**

Append:
```markdown
### CH4OS-3 — studio results: incumbent gating, max-coverable row, floor-exceeds-max alert

- `CostSummaryTab`: max-coverage results without an incumbent render "No incumbent" (Objective) and "—" (coverage, distance) in single and Compare views; new `cost-summary-max-coverable-demand` row ("Best coverable demand found (Model 1)" when Model 1 not proven) and Compare row `cost-summary-compare-max-coverable-demand-${id}` (blank where absent).
- New shared `FloorExceedsMaxAlert` (`floor-exceeds-max-alert`) in Solution Summary and Output Map.
- Interpretation: "blank with the No incumbent label" = Objective cell shows `resultQualityText`, other cells `—`; scoped to max-coverage-us.
- Gate: studio typecheck <result>; studio <summary line>.
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
```
```bash
FILES="artifacts/studio/src/components/workspace/FloorExceedsMaxAlert.tsx artifacts/studio/src/__tests__/FloorExceedsMaxAlert.test.tsx artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/components/workspace/tabs/OutputMapTab.tsx artifacts/studio/src/__tests__/CostSummaryTab.test.tsx artifacts/studio/src/__tests__/OutputMapTab.test.tsx docs/CHANGELOG-implementation.md"
git add $FILES
git commit $FILES -m "[CH4OS-3] show Model 1's max coverable demand and never a fake zero for an infeasible Chapter 4 result" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4 (CH4OS-4): Migration — clear the derived objective on floor-0 rows

**Role:** backend-engineer. **Spec:** §8, §9 (Migration).

**This migration is NOT run against production in this plan.** Production is a separate, human-approved operation per the runbook, after both services are deployed (branch discipline step 7). Locally only `--dry-run` is run against `nos_dev` (it writes nothing); the real write path is exercised only by the real-Postgres test, on its own fixture ids.

**Files:**
- Create: `artifacts/api-server/src/migrations/clearFloorZeroObjective.ts`
- Create: `artifacts/api-server/src/migrations/__tests__/clearFloorZeroObjective.test.ts`
- Modify: `artifacts/api-server/package.json:15-16` (script)
- Modify: `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts` (`ALLOWED_INPUTS_WRITERS`)
- Create: `docs/ops/ch4-objective-clear-runbook.md`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Produces: `clearFloorZeroObjective(database = db, dryRun = false, scenarioIds?: number[]): Promise<{ matched: number[]; dryRun: boolean }>`; npm script `clear-floor-zero-objective`.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`.

- [ ] **Step 1: Failing real-Postgres test**

Create `artifacts/api-server/src/migrations/__tests__/clearFloorZeroObjective.test.ts`:

```ts
// CH4OS-4 — real-Postgres round trip for clearFloorZeroObjective. No vi.mock of
// db: real jsonb, real read-back. EVERY call passes this file's own fixture ids
// (CLAUDE.md: a test suite must never be able to execute a production data
// migration), so a plain `pnpm --filter api-server test` cannot clear rows it
// did not create, whatever DATABASE_URL points at.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { clearFloorZeroObjective } from "../clearFloorZeroObjective.js";

const TEST_USER_ID = `ch4os-clear-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const scenarioIds: number[] = [];

beforeAll(async () => {
  await db.insert(usersTable).values({ id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` }).onConflictDoNothing();
});

afterAll(async () => {
  if (scenarioIds.length > 0) await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

const BASE = {
  p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650, gap: 0, timeLimitSec: 120,
  capacityMode: "none", distanceBands: [450, 900, 1800, 3400],
  warehouseOverrides: [], customerOverrides: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};

const ms = (v: unknown) => new Date(v as string | Date).getTime();

// Backdates the epoch so "advanced to now()" is observable, and optionally
// stores a solved result.
async function seed(modelId: string, inputs: Record<string, unknown>, result?: Record<string, unknown>): Promise<number> {
  const [row] = await db.insert(scenariosTable).values({
    name: `ch4os fixture ${scenarioIds.length}`, userId: TEST_USER_ID, modelId, inputs,
  }).returning();
  scenarioIds.push(row!.id);
  await db.update(scenariosTable).set({
    inputsUpdatedAt: sql`now() - interval '1 hour'`,
    updatedAt: sql`now() - interval '1 hour'`,
    ...(result ? { result, solvedAt: sql`now() - interval '30 minutes'` } : {}),
  }).where(eq(scenariosTable.id, row!.id));
  return row!.id;
}

async function readRow(id: number) {
  return (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!;
}

describe("clearFloorZeroObjective — real Postgres", () => {
  it("clears objective on a floor-0 row, bumps the epoch like the input writer, leaves result alone (now stale)", async () => {
    const id = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0, objective: "coverage" }, { status: "optimal" });
    const before = await readRow(id);
    const report = await clearFloorZeroObjective(db, false, [id]);
    expect(report).toEqual({ matched: [id], dryRun: false });
    const after = await readRow(id);
    const inputs = after.inputs as Record<string, unknown>;
    expect("objective" in inputs).toBe(false);
    expect(inputs.coverageFloorDemand).toBe(0);
    expect(inputs.p).toBe(3);                                   // nothing else in the blob moved
    expect(after.solveInputRevision).toBe(before.solveInputRevision + 1);
    expect(ms(after.inputsUpdatedAt)).toBeGreaterThan(ms(before.inputsUpdatedAt));
    expect(ms(after.updatedAt)).toBeGreaterThan(ms(before.updatedAt));
    expect(after.result).toEqual({ status: "optimal" });
    expect(ms(after.solvedAt)).toBe(ms(before.solvedAt));
    expect(ms(after.inputsUpdatedAt)).toBeGreaterThan(ms(after.solvedAt)); // isStale()'s comparison
  });

  it("leaves positive-floor, already-cleared and other-model rows untouched", async () => {
    const positive = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 500, objective: "min_distance" });
    const cleared = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0 });
    // Synthetic: proves the model_id predicate, not a real p-median shape.
    const otherModel = await seed("p-median-us", { coverageFloorDemand: 0, objective: "coverage" });
    const before = await Promise.all([positive, cleared, otherModel].map(readRow));
    const report = await clearFloorZeroObjective(db, false, [positive, cleared, otherModel]);
    expect(report.matched).toEqual([]);
    const after = await Promise.all([positive, cleared, otherModel].map(readRow));
    for (let i = 0; i < 3; i++) {
      expect(after[i]!.inputs).toEqual(before[i]!.inputs);
      expect(after[i]!.solveInputRevision).toBe(before[i]!.solveInputRevision);
    }
  });

  it("is idempotent — a second run matches nothing and does not bump again", async () => {
    const id = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0, objective: "min_distance" });
    await clearFloorZeroObjective(db, false, [id]);
    const mid = await readRow(id);
    const second = await clearFloorZeroObjective(db, false, [id]);
    expect(second.matched).toEqual([]);
    expect((await readRow(id)).solveInputRevision).toBe(mid.solveInputRevision);
  });

  it("dry run reports the ids it would clear and writes nothing", async () => {
    const id = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0, objective: "coverage" });
    const before = await readRow(id);
    const report = await clearFloorZeroObjective(db, true, [id]);
    expect(report).toEqual({ matched: [id], dryRun: true });
    const after = await readRow(id);
    expect(after.inputs).toEqual(before.inputs);
    expect(after.solveInputRevision).toBe(before.solveInputRevision);
  });

  it("an explicit EMPTY id filter matches nothing — never 'every row'", async () => {
    const id = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0, objective: "coverage" });
    const report = await clearFloorZeroObjective(db, false, []);
    expect(report.matched).toEqual([]);
    expect((await readRow(id)).inputs).toHaveProperty("objective", "coverage");   // non-vacuity: a matching row existed
  });
});
```

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/migrations/__tests__/clearFloorZeroObjective.test.ts`
Expected: FAIL — cannot resolve `../clearFloorZeroObjective.js`.

- [ ] **Step 2: Implement**

Create `artifacts/api-server/src/migrations/clearFloorZeroObjective.ts`:

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool, scenariosTable } from "@workspace/db";

// CH4OS-4 — one-off: every pre-CH4OS floor-0 max-coverage-us row carries a
// server-derived `objective: "coverage"`. Per the spec's decision (2026-10-10
// §8) it is CLEARED, so those students choose an objective before re-solving.
// Running it against production is a separate, human-gated operation —
// docs/ops/ch4-objective-clear-runbook.md. Run AFTER nos-api and nos-studio
// are deployed: until then a row still holding "coverage" keeps solving as
// Model 1, which is a valid choice.

export interface ClearObjectiveReport {
  /** Ids this run cleared — or, under dryRun, would clear. Ascending. */
  matched: number[];
  dryRun: boolean;
}

type Db = typeof db;

/**
 * Selects `model_id = 'max-coverage-us' AND (inputs->>'coverageFloorDemand')::int = 0
 * AND inputs ? 'objective'`, removes the `objective` key, and bumps the solve
 * epoch exactly as services/scenarioInputWrite.ts does (`updated_at` and
 * `inputs_updated_at` = DB now(), `solve_input_revision + 1`), so the cached
 * result reads stale and an in-flight solve's publication CAS stops matching.
 * `result` and `result_cache` are untouched (stale, not deleted); the cache key
 * hashes the whole inputs blob, so a cleared row can never be served an old
 * entry.
 *
 * Idempotent by construction: `inputs ? 'objective'` matches nothing on a
 * second run. One UPDATE statement, so a row is cleared entirely or not at all.
 *
 * `scenarioIds` narrows the scan. Tests MUST pass their own fixture ids; an
 * EMPTY array means "no rows", never "every row". The unfiltered scan exists
 * only for the CLI entry point below.
 */
export async function clearFloorZeroObjective(
  database: Db = db,
  dryRun = false,
  scenarioIds?: number[],
): Promise<ClearObjectiveReport> {
  if (scenarioIds != null && scenarioIds.length === 0) return { matched: [], dryRun };
  const scope = and(
    eq(scenariosTable.modelId, "max-coverage-us"),
    sql`(${scenariosTable.inputs}->>'coverageFloorDemand')::int = 0`,
    sql`${scenariosTable.inputs} ? 'objective'`,
    scenarioIds == null ? undefined : inArray(scenariosTable.id, scenarioIds),
  );
  const rows = dryRun
    ? await database.select({ id: scenariosTable.id }).from(scenariosTable).where(scope)
    : await database.update(scenariosTable)
      .set({
        inputs: sql`${scenariosTable.inputs} - 'objective'`,
        updatedAt: sql`now()`,
        inputsUpdatedAt: sql`now()`,
        solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1`,
      })
      .where(scope)
      .returning({ id: scenariosTable.id });
  return { matched: rows.map((r) => r.id).sort((a, b) => a - b), dryRun };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  const report = await clearFloorZeroObjective(db, dryRun);
  console.log(JSON.stringify({ ...report, count: report.matched.length }, null, 2));
  await pool.end();
}
```

In `artifacts/api-server/package.json`, after the `"round-override-precision"` script line (add a comma to it) add:
```json
    "clear-floor-zero-objective": "tsx ./src/migrations/clearFloorZeroObjective.ts"
```

In `artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts`, add to `ALLOWED_INPUTS_WRITERS` after the `roundOverridePrecision.ts` entry:
```ts
    // CH4OS-4 — the one-off floor-0 objective clear. Not a request-path
    // route. Writes `inputs - 'objective'` and bumps the epoch exactly as the
    // input writer does (solve_input_revision + 1, inputs_updated_at = now()),
    // the same epoch-preservation currency ch4ToMiles.ts is allow-listed for.
    // Added deliberately per this test's own comment above.
    "migrations/clearFloorZeroObjective.ts",
```

Run, separately:
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/migrations/__tests__/clearFloorZeroObjective.test.ts
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server exec vitest run src/__tests__/maxCoverageWriteGuard.test.ts
```
Expected: both PASS (the guard's "not vacuous" test confirms the new entry really writes `inputs`).

- [ ] **Step 3: Local dry run (read-only) — proves the probe can return non-zero**

```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server run clear-floor-zero-objective -- --dry-run
```
Expected: JSON `{ "matched": [...], "dryRun": true, "count": N }`. **Do not run it without `--dry-run`** — `nos_dev` is shared. Cross-check the count with an independent query so a `0` is not a null measurement (CLAUDE.md gotcha):
```bash
psql "postgresql://shubhamkr@localhost:5432/nos_dev" -Atc "SELECT count(*) FROM scenarios WHERE model_id='max-coverage-us' AND (inputs->>'coverageFloorDemand')::int = 0 AND inputs ? 'objective';"
```
Expected: the same N. Record both in the changelog.

- [ ] **Step 4: Write the runbook**

Create `docs/ops/ch4-objective-clear-runbook.md`:

````markdown
# Chapter 4 floor-0 objective clear — runbook (CH4OS-4)

Operator runbook for `artifacts/api-server/src/migrations/clearFloorZeroObjective.ts`
(spec `docs/superpowers/specs/2026-10-10-ch4-objective-selector-design.md` §8).

**Do not run this against production from an agent session.** It is a separate,
separately-approved operation performed by a human operator with `psql` access.
Approving the branch merge, the push, or the deploy does NOT approve this run.

## What it does

For every `max-coverage-us` scenario with `coverageFloorDemand = 0` that still
carries the pre-CH4OS server-derived `objective`, it removes the key and bumps the
solve epoch (`updated_at`, `inputs_updated_at` = now(), `solve_input_revision + 1`).
The cached `result` stays and shows as stale; `result_cache` is untouched. The
student must choose Max coverage or Min distance before re-solving.
Idempotent: a second run matches nothing.

## Order — deploy first, migrate second

1. Deploy `nos-api`, then `nos-studio`, **back to back**. Both directions of skew
   are user-visible, so minimise the window:
   - *New studio + old API*: the new studio sends `objective`; the old API's
     write guard 422s every Chapter 4 save ("objective is derived …").
   - *Old studio + new API*: the old studio strips `objective` before saving, so
     any floor-0 row it saves becomes unselected, and it has no selector to fix
     that — Solve 422s with `objective_required` until the new studio is live.
     No data is lost; the student re-chooses once the new studio loads.
   This branch changes `solve.py` and the API, so `nos-api` must be
   redeployed, not just `nos-studio`. Check `list_deploys`
   after any push — the commit webhook has not been observed to fire.
2. Only after both are live: run the migration (below). Until then, rows still
   holding `"coverage"` keep solving as Model 1, which is a valid choice.

## Procedure

1. **Snapshot / backup** the production database (Render Dashboard → nos-postgres
   → Backups, or `pg_dump` of `scenarios`). Record the backup id.
2. **Count before** (from an allowlisted host):
   ```sql
   SELECT count(*) FROM scenarios
   WHERE model_id = 'max-coverage-us'
     AND (inputs->>'coverageFloorDemand')::int = 0
     AND inputs ? 'objective';
   ```
3. **Dry run** — writes nothing, prints the ids and the count:
   ```bash
   DATABASE_URL=<production URL> pnpm --filter api-server run clear-floor-zero-objective -- --dry-run
   ```
   The dry-run count must equal step 2's. **That count, taken at run time, is the
   number quoted for approval.** No figure is assumed in this document.
4. **Explicit human approval** citing the dry-run count and the backup id.
5. **Run:**
   ```bash
   DATABASE_URL=<production URL> pnpm --filter api-server run clear-floor-zero-objective
   ```
   `count` must equal the approved number.
6. **Verify:** re-run step 2's query — it must return `0`. Spot-check one cleared
   row: `inputs ? 'objective'` is false and `solve_input_revision` went up by 1.

## Rollback

Restore `inputs.objective = 'coverage'` for the ids the run printed:
```sql
UPDATE scenarios SET inputs = inputs || '{"objective":"coverage"}'::jsonb
WHERE id = ANY(ARRAY[<ids>]) AND model_id = 'max-coverage-us';
```
(The epoch bump is not reverted: results stay stale, which is safe.)

## Local verification (nos_dev, dry run only)

<CH4OS-4 Step 3's dry-run JSON and psql count, pasted verbatim, with the date.>
````

Replace the final placeholder line with the actual Step 3 output and the date before committing (measured, never estimated).

- [ ] **Step 5: Changelog + commit**

Append:
```markdown
### CH4OS-4 — migration: clear the derived objective on floor-0 rows (written, tested, NOT run in production)

- `migrations/clearFloorZeroObjective.ts` — id-scoped, idempotent, dry-run CLI (`pnpm --filter api-server run clear-floor-zero-objective [-- --dry-run]`); one UPDATE removing `objective` and bumping the epoch like the input writer; `result`/`result_cache` untouched.
- Real-Postgres test on fixture ids only (clears / leaves others / idempotent / dry run writes nothing / empty filter = no rows).
- Allow-listed in `maxCoverageWriteGuard.test.ts`. Runbook: `docs/ops/ch4-objective-clear-runbook.md` (deploy API + studio back to back first; separate approval to run).
- Local dry run (nos_dev): <count from Step 3>, independent psql count <count>.
- Production: not run. Requires its own approval.
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
```
```bash
FILES="artifacts/api-server/src/migrations/clearFloorZeroObjective.ts artifacts/api-server/src/migrations/__tests__/clearFloorZeroObjective.test.ts artifacts/api-server/package.json artifacts/api-server/src/__tests__/maxCoverageWriteGuard.test.ts docs/ops/ch4-objective-clear-runbook.md docs/CHANGELOG-implementation.md"
git add $FILES
git commit $FILES -m "[CH4OS-4] add a scoped, idempotent migration that clears the derived objective on floor-0 Chapter 4 rows" -m "Not run against production; see docs/ops/ch4-objective-clear-runbook.md." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5 (CH4OS-5): E2E — rewrite sibling specs + one seeded journey

**Role:** qa-sdet (exempt from karpathy/ponytail; if a ponytail ruleset is injected anyway, ignore it and say so in the report). **Spec:** §9 (E2E). **Review:** separate `fable` reviewer.

**Files:**
- Modify: `artifacts/studio/e2e/helpers/maxCoverageInputs.ts`
- Modify: `artifacts/studio/e2e/chen-bands-units-qa.spec.ts:68-90` (local factory)
- Modify: `artifacts/studio/e2e/max-coverage.spec.ts` (header `:10-45`, step 3 `:285-301`)
- Create: `artifacts/studio/e2e/max-coverage-objective.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:** consumes the studio test ids from CH4OS-2/3; `readSolvedAt` from `e2e/helpers/solvedAt.ts` (not used by the seeded journey — its solve never publishes).

- [ ] **Step 1: Grep every changed contract in e2e**

```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/studio && grep -rn "derived-model-line\|input-coverage-floor\|coverage_floor_infeasible\|objective\|Model 1\|Model 2\|maxCoverageInputs\|covering at least\|maximize demand within" e2e | grep -v "^e2e/labs.spec.ts"
```
Expected hits to handle (verified at plan time): `helpers/maxCoverageInputs.ts` (factory, floor 0, no objective → every Chapter 4 floor-0 create 422s on solve); `chen-bands-units-qa.spec.ts` (own factory, same problem; asserts `details.objective === "coverage"` at `:787`); `max-coverage.spec.ts` (`:253-256` Model 1 line, `:293-298` Model 2 line text); `nonjade-servicestats-live-coverage.spec.ts` (uses the shared helper — fixed by the helper change). Any additional hit: rewrite it to the CH4OS contract and list it in the changelog.

- [ ] **Step 2: Fix the factories**

`e2e/helpers/maxCoverageInputs.ts`: replace the doc paragraph starting `NO \`objective\` key, deliberately.` through `…gets a 4xx on create.` with:
```ts
 * `objective: "coverage"` (CH4OS, spec 2026-10-10 §3). At a zero floor the
 * student must choose an objective before solving — without one, Solve is
 * blocked (precheck `objective_required`). "coverage" keeps every golden
 * these specs assert (Model 1: 70.42 %, {DAL, LA, PIT}). Pass
 * `{ objective: undefined }` to create an unchosen scenario (JSON drops it).
```
and add `objective: "coverage",` as the first property of the returned object.

`e2e/chen-bands-units-qa.spec.ts` local `maxCoverageInputs()`: replace the three-line `// CH4O-5 — NO \`objective\` key: …` comment with `// CH4OS — a zero floor needs an explicit objective; "coverage" is the Model 1 run every golden here was measured against.` and add `objective: "coverage",` as the first property.

- [ ] **Step 3: Rewrite `max-coverage.spec.ts`'s model-line assertions**

- Header lines `:10-45` that describe the floor-derived mode and the `objective`-is-server-owned rule: replace with:
```ts
 * CH4OS (spec 2026-10-10) — at a zero floor the student CHOOSES the objective
 * (the shared factory sends "coverage" → Model 1); any positive floor runs
 * Model 1 then Model 2 and reports Model 1's max coverable demand. Steps:
 *   1. coverage solve (floor 0, objective coverage) → golden
 *   2. distance surfaces in mi; Model 1 line
 *   3. floor := achieved covered demand → sequential line → solve → Model 2
 *      golden + maxCoverableDemand
 *   4–7. demand delta, distance override, map add, import round-trips
```
- Step 3 block (`:285-298`): replace the comment and the two `derivedLine` assertions with:
```ts
      // ── 3. Floor := the achieved covered demand → the SEQUENTIAL run
      // (CH4OS): the selector hides and the line names both models the
      // INSTANT the floor is typed — a client-side re-render, no save. ──────
      await floorInput.fill(String(cov.details.coveredDemand));
      await expect(page.getByTestId("objective-select")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
      await expect(derivedLine).toContainText(
        `Model 1, then Model 2 — find the maximum demand coverable within 450 mi, then minimize average distance covering at least ${cov.details.coveredDemand!.toLocaleString()}`,
        { timeout: HEADER_TIMEOUT },
      );
```
- After `expect(minDist.details.objective).toBe("min_distance");` add:
```ts
      // CH4OS — Model 1's maximum rides along: equal to step 1's own run.
      expect((minDist.details as { maxCoverableDemand?: number }).maxCoverableDemand).toBe(cov.details.coveredDemand);
```
- After the existing `cost-summary-value-objective` `not.toContainText("%")` assertion add:
```ts
      await expect(page.getByTestId("cost-summary-max-coverable-demand")).toContainText(
        cov.details.coveredDemand!.toLocaleString(), { timeout: HEADER_TIMEOUT },
      );
```
- In step 1's block, after `const floorInput … toHaveValue("0");` and before the derived-line assertions, add:
```ts
      // CH4OS — floor 0 shows the selector, with the factory's "coverage" chosen.
      await expect(page.getByTestId("objective-coverage")).toBeChecked();
```

- [ ] **Step 4: Write the seeded journey**

Create `artifacts/studio/e2e/max-coverage-objective.spec.ts`:

```ts
/**
 * CH4OS (spec 2026-10-10 §9 E2E) — floor 0 → choose each objective → solve, and
 * floor above max → alert. Solver results are SEEDED (e2e convention: real CBC
 * timing belongs to pytest): POST /solve and the job poll are stubbed, and the
 * scenario GET is answered with the real row plus a seeded envelope. Every
 * WRITE (the save-before-solve PATCH) goes to the real API, so the stored
 * `objective` asserted below is real server behaviour, read back through
 * `page.request` (which page.route does not intercept).
 */
import { test, expect, type Page } from "./fixtures";
import { maxCoverageInputs } from "./helpers/maxCoverageInputs";

const HEADER_TIMEOUT = 10_000;
const HINT = "Choose an objective — Max coverage or Min distance — before solving.";
const JOB_ID = 424242;

async function registerAndGoHome(page: Page): Promise<void> {
  const email = `e2e-ch4os-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", { data: { email, password: "correcthorse1" } });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function storedObjective(page: Page, id: string): Promise<unknown> {
  const resp = await page.request.get(`/api/scenarios/${id}`);
  expect(resp.status()).toBe(200);
  return (await resp.json()).inputs.objective;
}

const model1 = { openWarehouseIds: ["DAL", "LA", "PIT"], coveredDemand: 54946145, coveragePct: 70.42, weightedAvgDistance: 394.65, optimal: true };
const evidence = { solutionStatus: "optimal", terminationReason: "optimality_proven", achievedGap: 0, solverIncumbentObjective: null, solverBestBound: null };
function network(objective: number, avg: number, open: string[], mode: string, covered: number, pct: number) {
  return {
    status: "optimal", ...evidence, objective, runTimeSec: 1.0, quality: "Optimal", edges: [],
    metrics: { openFacilityIds: open, weightedAvgDistance: avg, utilizationByNode: [], bandCoverage: [{ band: 450, percent: pct }, { band: 3400, percent: 100 }] },
    details: { objective: mode, p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650, coverageFloorDemand: 0,
               openWarehouseIds: open, coveragePct: pct, coveredDemand: covered, uncoveredPct: 100 - pct, assignments: [] },
    solverUsed: "CBC (PuLP)", infeasibilityReason: null,
  };
}
const SEEDED_MODEL1 = network(70.42, 394.65, ["DAL", "LA", "PIT"], "coverage", 54946145, 70.42);
const SEEDED_MODEL2 = network(29873735731, 382.87, ["BAL", "DAL", "LA"], "min_distance", 52346880, 67.0887);
const SEEDED_TOO_HIGH = {
  status: "infeasible", solutionStatus: "infeasible", terminationReason: "infeasible", achievedGap: null,
  solverIncumbentObjective: null, solverBestBound: null, objective: null, runTimeSec: 1.0, quality: "infeasible", edges: [],
  metrics: { utilizationByNode: [], bandCoverage: [], weightedAvgDistance: 0 },
  details: { openWarehouseIds: [], assignments: [], objective: "min_distance", coverageFloorDemand: 500100100, maxCoverableDemand: 54946145, model1 },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: "Coverage floor 500100100 exceeds the maximum coverable demand 54946145 (Model 1). Lower the floor to at most 54946145.",
};

async function installSolveStubs(page: Page, id: string, state: { seeded: Record<string, unknown> | null }) {
  await page.route(`**/api/scenarios/${id}/solve`, async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ jobId: JOB_ID }) });
  });
  await page.route(`**/api/scenarios/${id}/solve-jobs/*`, route => {
    const now = Date.now();
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        id: JOB_ID, status: "succeeded", error: null, errorCode: null, errorMessage: null, resultSummary: null,
        queuedAt: new Date(now - 2_000).toISOString(), startedAt: new Date(now - 1_500).toISOString(), finishedAt: new Date(now).toISOString(),
      }),
    });
  });
  await page.route(`**/api/scenarios/${id}`, async route => {
    if (route.request().method() !== "GET" || state.seeded == null) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, result: state.seeded, stale: false, solvedAt: new Date().toISOString() } });
  });
}

async function solveSeeded(page: Page): Promise<void> {
  const run = page.getByTestId("button-run-optimizer");
  await expect(run).toBeEnabled({ timeout: HEADER_TIMEOUT });
  await run.click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click({ timeout: HEADER_TIMEOUT });
  await expect(page.getByTestId("output-map-tab")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("solve-progress-overlay")).toHaveCount(0, { timeout: HEADER_TIMEOUT });
}

test.describe("Chapter 4 — objective selector and sequential solve (CH4OS, seeded)", () => {
  test("floor 0: choose each objective and solve; floor above max: alert", async ({ page }) => {
    test.setTimeout(180_000);
    await registerAndGoHome(page);
    const create = await page.request.post("/api/scenarios", {
      data: { name: `E2E CH4OS ${Date.now()}`, modelId: "max-coverage-us", inputs: maxCoverageInputs({ objective: undefined }) },
    });
    expect(create.status()).toBe(201);
    const id = String((await create.json()).id);
    const state: { seeded: Record<string, unknown> | null } = { seeded: null };

    try {
      expect(await storedObjective(page, id)).toBeUndefined();   // stored ABSENT (spec §3)
      await installSolveStubs(page, id, state);
      await page.goto(`/chapter-4?scenario=${id}`);
      await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await page.getByTestId("sidebar-input-optimization-parameters").click();

      // ── Unchosen: nothing selected, Solve blocked from the local draft ──
      await expect(page.getByTestId("objective-select")).toBeVisible({ timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("objective-coverage")).not.toBeChecked();
      await expect(page.getByTestId("objective-min-distance")).not.toBeChecked();
      const line = page.getByTestId("derived-model-line");
      await expect(line).toHaveText("Choose an objective to solve.");
      await expect(page.getByTestId("button-run-optimizer")).toBeDisabled();
      await expect(page.getByTestId("button-run-optimizer")).toHaveAttribute("title", HINT);

      // ── Max coverage (Model 1) ──────────────────────────────────────────
      await page.getByTestId("objective-coverage").check();
      await expect(line).toHaveText("Model 1 — maximize demand within 450 mi, holding average distance at or under 650 mi");
      state.seeded = SEEDED_MODEL1;
      await solveSeeded(page);
      expect(await storedObjective(page, id)).toBe("coverage");     // save-before-solve hit the real API
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("70.42 %", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("cost-summary-max-coverable-demand")).toHaveCount(0);

      // ── Min distance (Model 2) ──────────────────────────────────────────
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await page.getByTestId("objective-min-distance").check();
      await expect(line).toHaveText("Model 2 — minimize average distance, holding average distance at or under 650 mi");
      state.seeded = SEEDED_MODEL2;
      await solveSeeded(page);
      expect(await storedObjective(page, id)).toBe("min_distance");
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("cost-summary-value-objective")).toContainText("demand-mi", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("cost-summary-coverage-pct")).toContainText("67.09 %");

      // ── Floor above Model 1's max → sequential → floor-exceeds-max alert ─
      await page.getByTestId("sidebar-input-optimization-parameters").click();
      await page.getByTestId("input-coverage-floor").fill("500100100");
      await expect(page.getByTestId("objective-select")).toHaveCount(0);
      await expect(line).toHaveText(
        "Model 1, then Model 2 — find the maximum demand coverable within 450 mi, then minimize average distance covering at least 500,100,100, holding average distance at or under 650 mi",
      );
      state.seeded = SEEDED_TOO_HIGH;
      await solveSeeded(page);
      expect(await storedObjective(page, id)).toBe("min_distance");  // server normalises a positive floor
      const mapAlert = page.getByTestId("floor-exceeds-max-alert");
      await expect(mapAlert).toContainText("Coverage floor 500,100,100 exceeds the maximum coverable demand 54,946,145.", { timeout: HEADER_TIMEOUT });
      await expect(mapAlert).toContainText("Lower the floor to at most 54,946,145.");
      await page.getByTestId("sidebar-output-cost-summary").click();
      await expect(page.getByTestId("floor-exceeds-max-alert")).toContainText("sites DAL, LA, PIT", { timeout: HEADER_TIMEOUT });
      await expect(page.getByTestId("cost-summary-value-objective")).toHaveText("No incumbent");
      await expect(page.getByTestId("cost-summary-max-coverable-demand")).toHaveText("54,946,145");
      await expect(page.getByTestId("cost-summary-value-avg-distance-to-customers")).toHaveText("—");
    } finally {
      await page.request.delete(`/api/scenarios/${id}`);
    }
  });
});
```

- [ ] **Step 5: Start the local two-server stack**

Pick free ports first (`lsof -i :3001 -i :5174` must print nothing; otherwise choose others and use them consistently). Run each in the background:
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3001 pnpm --filter api-server run dev
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && PORT=5174 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 VITE_POSTHOG_KEY=phc_local_dummy_key VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 pnpm --filter studio run dev
```
Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/` prints `200`. (The dev API runs a real dispatcher against the shared `nos_dev`; it can claim another session's queued jobs — keep the window short and stop both servers when done.)

- [ ] **Step 6: Run the touched specs, then the full gate**

```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/studio && E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/max-coverage-objective.spec.ts e2e/max-coverage.spec.ts e2e/chen-bands-units-qa.spec.ts e2e/nonjade-servicestats-live-coverage.spec.ts
```
Expected: all PASS. (`max-coverage.spec.ts` does real solves; its sequential step now runs Model 1 first — within `SOLVE_TIMEOUT`.)
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && E2E_BASE_URL=http://localhost:5174 pnpm e2e:gate
```
Expected: PASS. **`E2E_BASE_URL` is mandatory** — without it the gate silently tests a remote Replit deployment. A failure in a spec this branch did not touch: check `docs/superpowers/flake-registry.md` by test name (`chen-bands-units-qa.spec.ts` is the most load-sensitive file) and re-run it twice in isolation before treating it as real.

- [ ] **Step 7: Changelog + commit**

Append:
```markdown
### CH4OS-5 — e2e: sibling specs rewritten + seeded objective journey

- Grep (Step 1) hits handled: `helpers/maxCoverageInputs.ts` and `chen-bands-units-qa.spec.ts` factories now send `objective: "coverage"`; `max-coverage.spec.ts` asserts the sequential line, `maxCoverableDemand` and the max-coverable row; <any other hit, or "no others">.
- New `max-coverage-objective.spec.ts`: unchosen → blocked, Model 1, Model 2, floor-too-high alert; results seeded, writes real.
- Gate: targeted specs <result>; `E2E_BASE_URL=http://localhost:<port> pnpm e2e:gate` <passed/failed counts>; flakes re-run: <names or "none">.
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
```
```bash
FILES="artifacts/studio/e2e/helpers/maxCoverageInputs.ts artifacts/studio/e2e/chen-bands-units-qa.spec.ts artifacts/studio/e2e/max-coverage.spec.ts artifacts/studio/e2e/max-coverage-objective.spec.ts docs/CHANGELOG-implementation.md"
git add $FILES
git commit $FILES -m "[CH4OS-5] rewrite Chapter 4 e2e specs for the objective selector and add a seeded objective journey" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6 (CH4OS-6): Real-browser QA over all five behaviour rows

**Role:** qa-sdet (exempt from karpathy/ponytail). **Spec:** §2 (all five rows), §9 (QA). **Review:** separate `fable` reviewer.

Real solves (not seeded) through the real UI against the local two-server stack (CH4OS-5 Step 5 recipe). The QA driver is a throwaway Playwright script that is **not committed**; its screenshots go to `.harness/ch4os-qa/` (gitignored) and are viewed with the Read tool.

**Files:**
- Create (uncommitted, deleted after): `artifacts/studio/e2e/ch4os-qa.local.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

- [ ] **Step 1: Start the stack** — CH4OS-5 Step 5, verbatim.

- [ ] **Step 2: Write the QA driver**

Create `artifacts/studio/e2e/ch4os-qa.local.spec.ts` that, for one registered user, creates five scenarios via `page.request.post("/api/scenarios", …)` with the shared `maxCoverageInputs` factory and these overrides, then drives each through the real UI (open `/chapter-4?scenario=<id>`, Optimization Parameters, make the edit in the UI where the row is a UI action, Run Optimizer → Solve, wait with `readSolvedAt` from `./helpers/solvedAt`, `SOLVE_TIMEOUT = 240_000`), taking `page.screenshot({ path: \`../../.harness/ch4os-qa/row<N>-<surface>.png\`, fullPage: true })` of Optimization Parameters, Solution Summary and Output Map, and reading back `GET /api/scenarios/:id`:

| Row | Setup | Assert (UI + API) |
|---|---|---|
| 1 | `{}` (objective coverage, floor 0) | line `Model 1 — maximize demand within 450 mi, …`; result `details.objective` `coverage`, coverage 70.42 %, open {DAL, LA, PIT}, avg 394.65; Summary Objective `70.42 %`; no max-coverable row |
| 2 | `{ objective: undefined }`, then click `objective-min-distance` in the UI | line `Model 2 — minimize average distance, …`; stored objective `min_distance`; result objective 29873735731, avg 382.87, open {BAL, DAL, LA}; Summary Objective in demand-mi; coverage % shown |
| 3 | `{ objective: undefined }` | selector visible, nothing checked; line `Choose an objective to solve.`; `button-run-optimizer` disabled with title = hint; `page.request.post(\`/api/scenarios/${id}/solve\`)` → 422 whose `errors[].code` contains `objective_required` |
| 4 | `{}`, then type floor `54946145` in the UI | selector hidden; sequential line; stored objective `min_distance`; result objective 30269639699, avg 387.94, `maxCoverableDemand` 54946145; Summary row `Max coverable demand (Model 1)` `54,946,145` |
| 5 | `{}`, then type floor `500100100` in the UI | result `status` `infeasible`, `details.maxCoverableDemand` 54946145; `floor-exceeds-max-alert` on Summary and Output Map with the "maximum" wording; Summary Objective `No incumbent`, avg distance `—`; no `0` in any of those cells |

Plus one Compare check: in row 5's scenario, open Solution Summary, tick row 1's scenario: row-5 column Objective `No incumbent`, `cost-summary-compare-max-coverable-demand-<row5>` `54,946,145`, row-1 column blank.

Run: `cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/studio && E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/ch4os-qa.local.spec.ts --workers=1`
Expected: PASS. Open every screenshot with the Read tool and confirm the visible text matches the table (layout, the selector directly under the floor, the alert not covering the map). A defect is a finding: stop, report it with the screenshot path, do not patch product code in this task.

- [ ] **Step 3: Clean up**

```bash
rm /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/studio/e2e/ch4os-qa.local.spec.ts
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && git status --short artifacts/studio/e2e
```
Expected: no `ch4os-qa.local.spec.ts` listed. Stop both dev servers.

- [ ] **Step 4: Changelog + commit**

Append:
```markdown
### CH4OS-6 — real-browser QA, all five §2 rows (real solves, local stack)

| Row | Result | Evidence |
|---|---|---|
| 1 floor 0 + coverage | <pass/fail + key numbers seen> | `.harness/ch4os-qa/row1-*.png` |
| 2 floor 0 + min_distance | … | … |
| 3 floor 0 + none | … | … |
| 4 floor ≤ max | … | … |
| 5 floor > max | … | … |
| Compare | … | … |

Findings: <list, or "none">. Driver script not committed (deleted after the run).
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
```
```bash
git add docs/CHANGELOG-implementation.md
git commit docs/CHANGELOG-implementation.md -m "[CH4OS-6] record real-browser QA of the five Chapter 4 objective behaviours" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7 (CH4OS-7): Finish — full gate, finishing skill, retro, STOP

**Role:** lead.

- [ ] **Step 1: Nothing else running**

```bash
cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]; echo "concurrent vitest: $cnt"
```
Expected: `concurrent vitest: 0`. If not 0, wait and re-check — do not chain.

- [ ] **Step 2: Full verification gate — each command separately**

```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm run typecheck
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter studio test
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && pnpm --filter @workspace/units test
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/api-server/src/solver && python3 -m pytest tests/ -x -q 2>&1 | tail -3
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2/artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py 2>&1 | tail -3
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2 && git diff --stat main...HEAD -- artifacts/api-server/src/solver/tests/e2e_accuracy.py
```
Expected: all PASS; `e2e_accuracy.py` `99/99`; the last command prints nothing (sacred file unmodified). With the CH4OS-5 stack running, also: `cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 auth` → PASS (standalone script, not pytest-discovered).

- [ ] **Step 3: Changelog + commit**

Append:
```markdown
### CH4OS-7 — branch gate

- typecheck <result>; api-server <summary>; studio <summary>; units <summary>; solver pytest <summary>; `e2e_accuracy.py` <N/N>, unmodified; `e2e_journey.py auth` <result>.
- Not done in this branch (each needs its own approval): merge to `main`, whole-branch review, push, deploy of `nos-api` + `nos-studio` (back to back — see the runbook's skew note), production run of `clearFloorZeroObjective`.
```
```bash
cd /Users/shubhamkr/nos-ch4-upgrade-v2
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
```
```bash
git add docs/CHANGELOG-implementation.md
git commit docs/CHANGELOG-implementation.md -m "[CH4OS-7] record the Chapter 4 objective-selector branch gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Invoke the finishing skill**

Skill tool: `superpowers:finishing-a-development-branch`. Its output is a recommendation to put to the user, never a licence to act.

- [ ] **Step 5: Run the retro**

`/harness-retro CH4OS` — records the metrics row, logs each gate failure by cause, fires the second-occurrence gate rule (if it drafts `docs/superpowers/gates/<cause>.md`, stop for approval). The branch is not finished until this has run.

- [ ] **Step 6: STOP — prompt for merge approval**

Hard stop. Ask the user for approval to merge `ch4-upgrade-v2` into local `main`. Do not merge, push, or deploy. When asking, state:
- Pipeline after a yes: merge to local `main` (after `git fetch` and confirming local `main` is not stale vs `origin/main`) → whole-branch review on the merged state → push (separate yes; deploy-adjacent: `nos-studio` can ship on push, `nos-api` is `autoDeployTrigger: commit`) → deploy (separate yes; **both** services, back to back, API first — skew in either direction breaks Chapter 4 saves or solves) → production migration (separate yes; runbook `docs/ops/ch4-objective-clear-runbook.md`, dry-run count quoted at run time).

---

## Self-review (run at plan-writing time)

- **Spec coverage:** §2 rows 1–5 → CH4OS-1 (solver), CH4OS-2 (gating/precheck), CH4OS-3 (results), CH4OS-6 (QA). §3 → CH4OS-2 (units, write path, routes, studio save path; manifest untouched). §4 → CH4OS-2. §5 (builder, run plan, time budget, outcome matrix, result fields, infeasible envelope, messages) → CH4OS-1. §6.1 → CH4OS-2; §6.2/§6.3 → CH4OS-3. §7 → no-op, stated in Global Constraints. §8 → CH4OS-4. §9 tests → every task. §10 slicing → CH4OS-2 is the one cross-layer commit. §11 → Global Constraints.
- **Placeholders:** the only `<…>` slots are changelog fields that must carry values measured in that task's own run (hard invariant: never fabricate a metric) and the runbook's local-output section filled from CH4OS-4 Step 3.
- **Type consistency:** `resolveMaxCoverageRun` / `resolve_max_coverage_run`, `MaxCoverageRun`, `objective-select` / `objective-coverage` / `objective-min-distance`, `solveBlockedReason` / `solve-dialog-blocked-hint`, `floorExceedsMax` / `FloorExceedsMaxAlert`, `clearFloorZeroObjective` → `{ matched, dryRun }` are used identically in every task that names them.
