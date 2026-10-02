# Chapter 9 (JADE) Editable Transportation Costs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `two-echelon-jade-us`'s four transportation cost parameters (inbound/outbound rate + minimum charge) editable scenario inputs that feed the solve, show their per-lane consequence on the Distances tab, and record the rates each result was solved at.

**Architecture:** Four global scalars under one optional, all-or-nothing `inputs.transportCosts` object. The solver reads them with the existing module constants as defaults, so an absent key is byte-identical to today's objective (hard rule 2's back-compat lock). They enter `solve_jade` purely as cost-closure coefficients — no new business-rule branch (hard rule 6). The frontend adds one new input tab, two derived columns on `JadeDistancesTab`, and a solved-at block in `CostSummaryTab`; all unit conversion reuses `useDistanceDraft` through a new additive `convert` option rather than a parallel hook.

**Tech Stack:** Python 3 + PuLP/CBC, Express 5 + Drizzle + Zod, OpenAPI + Orval codegen, React + Vite + TanStack Query + Radix, vitest/supertest, vitest/RTL, Playwright, pytest.

**Source spec:** [`docs/superpowers/specs/2026-10-02-ch9-transport-costs-design.md`](../specs/2026-10-02-ch9-transport-costs-design.md) — commits `27cc1ad` (original) and `07e9cac` (review round 1 folded in). §3.2's 12 registration points remain the spine of this plan. The implementation-review amendments recorded near the end of this document add the missing coefficient-safety dependency and correct several executable steps; they do not edit the source spec.

---

## Global Constraints

Every task's requirements implicitly include this section.

**Data contract (spec §3.1), verbatim:**

- Inputs key: `transportCosts: { icTransCost, icMinTrans, obTransCost, obMinTrans }`. **The object is optional; when present, ALL FOUR are required.** A partial object is a 422, never a half-merge.
- Bounds: every field `>= 0` and finite. **Rate `<= 10` $/ton-mile; minimum charge `<= 10,000` $/ton.** `0` is legal for both a rate and a minimum.
- These maxima are declared in **three** places and pinned equal by tests: the manifest JSON Schema (`maximum`), Zod (`.max(...)`), and the UI.
- The maxima are pedagogical/product limits, **not** a numerical-safety proof. Existing finite distance and demand overrides can still make `rate × distance × demand` non-finite. The JADE semantic precheck rejects that cross-field condition with `coefficient_range` before enqueue; `solve.py` repeats the finite check before model construction. Do not claim a universal CBC-safe coefficient range without a separate empirical conditioning spike.
- **The non-finite hazard is PRE-EXISTING, not introduced here.** Measured: `jadeInputs.ts`'s `distanceOverrides[].distance` and `addedCustomers[].demands` are `z.number().nonnegative()` with **no `.finite()`**, so `Infinity` itself is accepted today, and `0.12 × 1e308` already overflows with no `transportCosts` present at all. Two consequences this plan takes on deliberately: add `.finite()` to those two existing JADE fields (Task 3), and prove the coefficient guard fires with `transportCosts` **absent** as well as present — a guard that only triggers on custom rates would be covering the wrong thing.
- Canonical storage is **always `$/ton-mile`** — the display-unit toggle is a display concern only.
- `transportCosts` is **absent** on every existing scenario and on every newly created one; absence means the textbook values `0.07 / 10 / 0.12 / 10`.

**Hard rules this change is most likely to break:**

- **Hard rule 2 — `e2e_accuracy.py` is sacred.** Run it unmodified; expect **99/99**. With `transportCosts` absent the objective must be byte-identical to today's.
- **Hard rule 6 — solver changes enter as data, not branches.** The rates become coefficient values in the existing `ic_cost`/`ob_cost` closures. No new `if` on a business rule, no second model branch in `solve.py`.
- **Hard rule 1 — never edit generated code.** `lib/api-zod/src/generated/**` and `lib/api-client-react/src/generated/**` come from `lib/api-spec/openapi.yaml` via Orval. Edit the spec, re-run codegen, commit both together.
- **Hard rule 4 — one task = one commit**, message `[ch9-tc-<n>] <imperative summary>`. Regenerated codegen output goes in the same commit as its spec change.
- **Hard rule 9 — no historical narrative in `CLAUDE.md`.** What landed goes in `docs/CHANGELOG-implementation.md`, in the same commit as the work.
- **Hard rule 10 — never delegate to GLM in this repo.**

**Invariants the solver change can easily break:**

- `_EMPTY_METRICS` (`solve.py:271`) is a **module-level constant shared by every model's error/infeasible path**. Never mutate it — always spread into a fresh dict (`{**_EMPTY_METRICS, ...}`).
- The `dist.get(..., 9999)` missing-distance sentinel stays exactly as it is (spec §4; a pre-existing wart, explicitly out of scope).
- `metrics.transportRates` is **optional, never `.default(...)`** on `MetricsSchema` — a pre-change stored envelope lacks the key and must keep validating (the export route `safeParse`s persisted results).
- The echo is present on **every successfully executed JADE outcome**, including the infeasible early return at `solve.py:1260`. A dataset load failure (`_load_error_envelope` at `solve.py:1105`) is not an executed solve and stays unchanged.
- Objective arithmetic handed to PuLP must be finite. Test the guard with huge-but-finite override values and spy/stub the CBC runner so the test proves CBC was never invoked; a generic worker failure after dispatch is too late.

**Repo gotchas that apply directly here:**

- **A UI-changing bundle breaks prior bundles' Playwright specs.** Before merge, grep `artifacts/studio/e2e/` for every testid and visible string this bundle changes and rewrite the siblings (Task 11).
- **Studio/api-server/pytest suites flake under concurrent load from other sessions.** Before trusting any full-suite result, require zero concurrent runs: `ps aux | grep "[v]itest" | grep -v "zsh -c"` must print nothing (the bare `grep -c` form also matches the agent's own `zsh -c` wrapper and can never reach 0).
- **Prefer blur (click a neighbouring field) over `.press("Enter")`** when committing a draft field in a Playwright test.
- **Bound every e2e `.click()`/`.fill()` with an explicit `{ timeout }`** — an unbounded action inherits the whole test budget.
- `e2e_accuracy.py` and `e2e_journey.py` are **standalone scripts**, not pytest-discovered. `python3 -m pytest tests/ -x` does not run them.

**Deviation already found while writing this plan (carry it into execution):** spec §2.4 names five `useDistanceDraft` callers (`WarehouseTable`, `CustomerTable`, `SolveDialog`'s `ChenDistanceInput`, `JadeDistancesTab`, `LaneCostsTab`). The real caller set, measured with `grep -rn "useDistanceDraft(" artifacts/studio/src`, is **six files / ten call sites**: `SolveDialog.tsx:313`, `JadeDistancesTab.tsx:164,308`, `LegDistancesTab.tsx:98,169`, `LaneCostsTab.tsx:88,154`, `OptimizationParametersTab.tsx:650`, `DistancesTab.tsx:144,318`. `WarehouseTable`/`CustomerTable` only *mention* the hook in comments and never call it. Task 5's "all existing callers unchanged" assertion must use the measured list.

**Verification gate (CLAUDE.md), run before any task is considered done:**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && pnpm --filter studio typecheck:e2e \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```

Per-task steps below run the narrower command that proves that task; Task 11 runs the full gate plus the two standalone scripts and `pnpm e2e:gate`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `artifacts/studio/src/lib/transportCosts.ts` | Single source of truth on the frontend: the textbook defaults, the two maxima, the effective-value reader, the per-lane `$/ton` formula, and the reciprocal rate↔display conversion. Imported by the new tab, `JadeDistancesTab`, `CostSummaryTab` and their tests, so none of them re-derive a constant. |
| `artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx` | The new input tab: four draft-until-commit fields in two leg rows, inline validation, Reset, history-disabled. |
| `artifacts/api-server/src/__tests__/jadeTransportCosts.test.ts` | API-side contract: Zod accept/reject, the three-way maxima pin, `buildPayload` passthrough, cache-key separation. |
| `artifacts/studio/src/__tests__/TransportCostsTab.test.tsx` | Tab behaviour incl. the unit round-trip and semantic-no-op tests. |
| `artifacts/studio/src/__tests__/transportCostsBounds.test.ts` | Pins the UI maxima against `solvers/two-echelon-jade-us/manifest.json` read from disk. |
| `artifacts/studio/e2e/jade-transport-costs.spec.ts` | The real-browser journey: solve → edit → stale → re-solve → Compare. |

**Modified:**

| File | Change |
|---|---|
| `artifacts/api-server/src/solver/solve.py` | Read the four rates in `solve_jade`; echo them into metrics on both executed outcomes. |
| `artifacts/api-server/src/solver/tests/test_jade.py` | Back-compat lock, coefficient tests, boundary/crossover tests, echo tests. |
| `artifacts/api-server/src/services/precheck.ts` | Cross-field finite-arithmetic guard for effective JADE distance/demand/rate combinations before enqueue. |
| `artifacts/api-server/src/__tests__/precheck.test.ts` | `coefficient_range` cases, including huge finite overrides and normal-boundary acceptance. |
| `lib/api-spec/openapi.yaml` + regenerated `lib/api-zod`, `lib/api-client-react` | `SolveMetrics.transportRates` and `PrecheckError.code: coefficient_range`. |
| `artifacts/api-server/src/solver/resultEnvelope.ts` | `transportRates` optional on `MetricsSchema`. |
| `artifacts/api-server/src/validation/inputs/jadeInputs.ts` | `transportCosts` optional object + exported maxima. |
| `solvers/two-echelon-jade-us/manifest.json` | `inputsSchema.properties.transportCosts`. |
| `artifacts/api-server/src/solver/pmedian.ts` | `transportCosts: i.transportCosts` in the JADE `buildPayload()` branch. |
| `artifacts/studio/src/hooks/useDistanceDraft.ts` | Optional `convert` override. |
| `artifacts/studio/src/pages/Workspace.tsx` | Tab entry, render branch, `isEditableInputTab`, `clearTransportCosts`, rate props into `JadeDistancesTab`. |
| `artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx` | `$/ton` + `Min?` columns. |
| `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` | Solved-at rates, single-scenario and Compare, with legacy fallback. |
| `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx` | JADE input-tab list gains the new tab (sibling test that otherwise fails). |
| `docs/CHANGELOG-implementation.md` | One entry, appended at the bottom. |

---

## Task 1: Solver reads and echoes the rates

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py` (`solve_jade`, around `:1163` and the two `_envelope(...)` returns at `:1260` and `:1360`)
- Test: `artifacts/api-server/src/solver/tests/test_jade.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: solve.py reads `inp["transportCosts"]` as a dict with keys `icTransCost`, `icMinTrans`, `obTransCost`, `obMinTrans` (all floats), and emits `result["metrics"]["transportRates"]` with the same four keys. Task 4's `buildPayload` must send exactly that key name and shape; Task 2's `MetricsSchema` must accept exactly that metrics key.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/solver/tests/test_jade.py`. The isolated single-warehouse/single-customer fixture is lifted from the existing `test_min_charge_below_breakpoint_and_above` (`test_jade.py:162`), whose arithmetic is already verified: inbound `0.07 × 200 mi = $14/ton`, outbound `max(0.12 × 10 mi, 10) = $10/ton`, 100 tons ⇒ objective `100×14 + 100×10 = 2400`.

```python
def _isolated_inputs(**extra):
    """Single forced-open warehouse + single customer, 100 tons of product-1,
    inbound 200mi / outbound 10mi. Same fixture as
    test_min_charge_below_breakpoint_and_above above, parameterised so a
    transportCosts override can move the arithmetic predictably."""
    inputs = {
        "p": 1, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 30,
        "excludedCustomerIds": _all_base_customer_ids(),
        "addedWarehouses": [{"id": "test-wh", "city": "Testville", "state": "ZZ",
                             "lat": 40.0, "lng": -90.0, "status": "forced_open"}],
        "addedCustomers": [{"id": "test-cust", "city": "Testville", "state": "ZZ",
                            "lat": 40.0, "lng": -90.0,
                            "demands": {"product-1": 100.0, "product-2": 0.0,
                                        "product-3": 0.0, "product-4": 0.0}}],
        "distanceOverrides": [
            {"leg": "plant_to_warehouse", "fromId": "plant-1", "toId": "test-wh", "distance": 200.0},
            {"leg": "warehouse_to_customer", "fromId": "test-wh", "toId": "test-cust", "distance": 10.0},
        ],
    }
    inputs.update(extra)
    return inputs


TEXTBOOK_RATES = {"icTransCost": 0.07, "icMinTrans": 10.0,
                  "obTransCost": 0.12, "obMinTrans": 10.0}


def test_transport_costs_absent_is_identical_to_explicit_textbook_values():
    # The back-compat lock (spec §3.3): absence means the constants.
    absent = solve_jade(GROUND_TRUTH_INPUTS)
    explicit = solve_jade({**GROUND_TRUTH_INPUTS, "transportCosts": dict(TEXTBOOK_RATES)})
    assert absent["status"] == "optimal"
    assert explicit["status"] == "optimal"
    assert abs(absent["objective"] - explicit["objective"]) < 1e-6
    assert set(absent["metrics"]["openFacilityIds"]) == set(explicit["metrics"]["openFacilityIds"])


def test_transport_costs_absent_still_hits_ground_truth():
    result = solve_jade(GROUND_TRUTH_INPUTS)
    assert abs(result["objective"] - 254060828.6157) / 254060828.6157 < 1e-6


def test_inbound_rate_scales_the_inbound_leg_only():
    # inbound 0.14*200 = 28 (rate governs), outbound unchanged at the $10 min.
    # 100 tons -> 100*28 + 100*10 = 3800.
    result = solve_jade(_isolated_inputs(
        transportCosts={**TEXTBOOK_RATES, "icTransCost": 0.14}))
    assert result["status"] == "optimal", result.get("infeasibilityReason")
    assert abs(result["objective"] - 3800.0) < 1e-6


def test_outbound_rate_above_the_breakpoint_moves_the_crossover():
    # outbound 1.5*10 = 15 > the $10 min, so the RATE now governs a lane the
    # minimum used to govern. 100*14 + 100*15 = 2900.
    result = solve_jade(_isolated_inputs(
        transportCosts={**TEXTBOOK_RATES, "obTransCost": 1.5}))
    assert result["status"] == "optimal", result.get("infeasibilityReason")
    assert abs(result["objective"] - 2900.0) < 1e-6


def test_zero_minimum_charge_disables_the_floor():
    # outbound max(0.12*10, 0) = 1.2. 100*14 + 100*1.2 = 1520.
    result = solve_jade(_isolated_inputs(
        transportCosts={**TEXTBOOK_RATES, "obMinTrans": 0.0}))
    assert result["status"] == "optimal", result.get("infeasibilityReason")
    assert abs(result["objective"] - 1520.0) < 1e-6


def test_zero_rate_makes_the_minimum_govern_every_lane_on_that_leg():
    # inbound max(0*200, 10) = 10. 100*10 + 100*10 = 2000.
    result = solve_jade(_isolated_inputs(
        transportCosts={**TEXTBOOK_RATES, "icTransCost": 0.0}))
    assert result["status"] == "optimal", result.get("infeasibilityReason")
    assert abs(result["objective"] - 2000.0) < 1e-6


def test_metrics_echo_the_effective_rates_on_success():
    rates = {**TEXTBOOK_RATES, "icTransCost": 0.09}
    result = solve_jade(_isolated_inputs(transportCosts=rates))
    assert result["metrics"]["transportRates"] == rates


def test_metrics_echo_the_textbook_defaults_when_transport_costs_absent():
    result = solve_jade(_isolated_inputs())
    assert result["metrics"]["transportRates"] == TEXTBOOK_RATES


def test_infeasible_early_return_also_echoes_the_rates():
    # Two forced-open warehouses with p=1 -> the forced_open > p infeasible
    # branch, which returns BEFORE the success envelope.
    rates = {**TEXTBOOK_RATES, "obTransCost": 0.31}
    result = solve_jade({
        "p": 1, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 30,
        "warehouseStatuses": [
            {"warehouseId": "wh-11", "status": "forced_open"},
            {"warehouseId": "wh-14", "status": "forced_open"},
        ],
        "transportCosts": rates,
    })
    assert result["status"] == "infeasible"
    assert result["metrics"]["transportRates"] == rates


def test_shared_empty_metrics_constant_is_never_mutated():
    # _EMPTY_METRICS is shared by every model's error/infeasible path — the
    # echo must spread into a fresh dict, never assign into the constant.
    solve_jade({
        "p": 1, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 30,
        "warehouseStatuses": [
            {"warehouseId": "wh-11", "status": "forced_open"},
            {"warehouseId": "wh-14", "status": "forced_open"},
        ],
        "transportCosts": dict(TEXTBOOK_RATES),
    })
    assert "transportRates" not in solve_mod._EMPTY_METRICS


def test_non_finite_objective_coefficient_fails_before_cbc(monkeypatch):
    # Defense in depth for callers that bypass the API semantic precheck.
    # Both inputs are finite, but rate * distance * demand overflows.
    called = False

    def forbidden_cbc(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("CBC must not run with a non-finite coefficient")

    monkeypatch.setattr(solve_mod, "_run_cbc", forbidden_cbc)
    inputs = _isolated_inputs(
        addedCustomers=[{
            "id": "test-cust", "city": "Testville", "state": "ZZ",
            "lat": 40.0, "lng": -90.0,
            "demands": {"product-1": 1e308, "product-2": 0.0,
                        "product-3": 0.0, "product-4": 0.0},
        }],
        distanceOverrides=[
            {"leg": "plant_to_warehouse", "fromId": "plant-1", "toId": "test-wh", "distance": 200.0},
            {"leg": "warehouse_to_customer", "fromId": "test-wh", "toId": "test-cust", "distance": 1e100},
        ],
        transportCosts={**TEXTBOOK_RATES, "obTransCost": 10.0},
    )
    with pytest.raises(ValueError, match="non-finite JADE transport coefficient"):
        solve_jade(inputs)
    assert called is False
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_jade.py -k "transport or minimum_charge or zero_rate or empty_metrics or echo" -v
```

Expected: FAIL — `KeyError: 'transportRates'` on the echo tests, and the objective assertions off because the overrides are ignored.

- [ ] **Step 3: Read the rates in `solve_jade`**

In `artifacts/api-server/src/solver/solve.py`, replace the two cost closures (currently `solve.py:1163-1167`, immediately after the `total_demand = ...` line) with:

```python
    # ch9-tc — the four transportation cost parameters are scenario inputs
    # with the module constants as their named defaults (spec §4). Absence
    # of `transportCosts` is byte-identical to the pre-change objective,
    # which is the hard-rule-2 back-compat lock. Pure coefficient
    # substitution: no business-rule branch (hard rule 6).
    tc      = inp.get("transportCosts") or {}
    ic_rate = tc.get("icTransCost", JADE_IC_RATE)
    ic_min  = tc.get("icMinTrans",  JADE_IC_MIN)
    ob_rate = tc.get("obTransCost", JADE_OB_RATE)
    ob_min  = tc.get("obMinTrans",  JADE_OB_MIN)
    transport_rates = {
        "icTransCost": ic_rate, "icMinTrans": ic_min,
        "obTransCost": ob_rate, "obMinTrans": ob_min,
    }

    def ic_cost(pl, w):
        return max(ic_rate * dist.get((pl, w), 9999), ic_min)

    def ob_cost(w, c):
        return max(ob_rate * dist.get((w, c), 9999), ob_min)
```

Before creating PuLP objective terms, validate finite demand aggregates, every inbound per-ton cost,
every outbound per-ton cost, and each outbound-cost × customer-product-demand coefficient with
`math.isfinite`. This mirrors the actual objective: inbound `flow_pw` is already a tonnage variable and
is not multiplied by demand, while outbound `flow_wc` is binary and is. Raise a deterministic
`ValueError` containing `non-finite JADE transport coefficient` and the leg/entity/product IDs on the
first failure. This is a defense-in-depth assertion, not the user-facing validation path: Task 3's
semantic precheck must reject the same input before enqueue. Do not add an arbitrary finite magnitude
ceiling here; that needs a separate measured CBC-conditioning decision.

- [ ] **Step 4: Echo the rates on both executed outcomes**

Infeasible early return (`solve.py:1260`) — replace `_EMPTY_METRICS` with a spread copy, never an in-place assignment:

```python
        return _envelope("infeasible", status_str, 0, run_time, [],
                         {**_EMPTY_METRICS, "transportRates": transport_rates},
                         _EMPTY_DETAILS, reason,
                          termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                          solver_incumbent_objective=cbc.solverIncumbentObjective,
                          solver_best_bound=cbc.solverBestBound)
```

Success return (`solve.py:1360`) — add one key to the metrics dict literal, after `"outboundCost"`:

```python
            "inboundCost": round(inbound_cost, 2),
            "outboundCost": round(outbound_cost, 2),
            "transportRates": transport_rates,
```

Leave `_load_error_envelope("two-echelon-jade-us")` at `solve.py:1105` untouched — a dataset load failure never reached a solve and is not a result the rates describe.

- [ ] **Step 5: Run the new tests to verify they pass**

```bash
cd artifacts/api-server/src/solver && python3 -m pytest tests/test_jade.py -v
```

Expected: PASS, whole file.

- [ ] **Step 6: Run the sacred accuracy script**

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```

Expected: `99/99`. If it is not 99/99, the change is wrong — do not touch the script (hard rule 2).

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/tests/test_jade.py
git commit -m "[ch9-tc-1] read editable JADE transport rates in solve_jade and echo them into metrics

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `transportRates` and `coefficient_range` on the generated API contract

Registration points 3 and 6, plus the implementation-review precheck contract. The result failure mode is **silent**: Zod strips unknown result keys, so without this the UI never sees the field no matter what the solver emits. The precheck enum must also describe the new server error code rather than widening an already-stale server/spec mismatch.

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (`SolveMetrics` and `PrecheckError.code`)
- Modify (generated, via codegen only): `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`
- Modify: `artifacts/api-server/src/solver/resultEnvelope.ts` (`MetricsSchema`, `:34-58`)
- Test: `artifacts/api-server/src/__tests__/resultEnvelope.test.ts`

**Interfaces:**
- Consumes: Task 1's `metrics.transportRates` shape.
- Produces: `SolveResult["metrics"]["transportRates"]?: { icTransCost: number; icMinTrans: number; obTransCost: number; obMinTrans: number }` on the generated `@workspace/api-client-react` types — Task 9 reads exactly this — plus `coefficient_range` in the generated precheck error-code union used by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/__tests__/resultEnvelope.test.ts`:

```ts
describe("ch9-tc — metrics.transportRates", () => {
  const rates = { icTransCost: 0.09, icMinTrans: 10, obTransCost: 0.12, obMinTrans: 0 };

  it("round-trips transportRates through ResultEnvelopeSchema", () => {
    const envelope = makeEnvelope({ metrics: { weightedAvgDistance: 1, transportRates: rates } });
    const parsed = ResultEnvelopeSchema.parse(envelope);
    expect(parsed.metrics.transportRates).toEqual(rates);
  });

  it("still validates a legacy envelope with no transportRates key", () => {
    const envelope = makeEnvelope({ metrics: { weightedAvgDistance: 1 } });
    const parsed = ResultEnvelopeSchema.parse(envelope);
    expect(parsed.metrics.transportRates).toBeUndefined();
    expect("transportRates" in parsed.metrics).toBe(false);
  });

  it("rejects a partial transportRates object", () => {
    const envelope = makeEnvelope({
      metrics: { weightedAvgDistance: 1, transportRates: { icTransCost: 0.09 } },
    });
    expect(ResultEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});
```

If `resultEnvelope.test.ts` has no `makeEnvelope` helper, build the envelope inline from the file's existing fixture shape — read the file first and match whatever it already does rather than introducing a second fixture style.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter api-server test -- resultEnvelope
```

Expected: FAIL — `parsed.metrics.transportRates` is `undefined` (Zod stripped it) on the first test.

- [ ] **Step 3: Add the schema to the OpenAPI contract**

In `lib/api-spec/openapi.yaml`, inside `SolveMetrics.properties`, after `outboundCost` (`:1213-1215`):

```yaml
        transportRates:
          $ref: "#/components/schemas/TransportRates"
```

And add the component schema next to `SolveMetrics` (before the `SolutionStatus` block at `:1223`):

```yaml
    # ch9-tc — Chapter 9 JADE: the four transportation cost parameters this
    # result was actually solved at, echoed by solve_jade. Canonical units
    # are $/ton-mile (rates) and $/ton (minimum charges) — the display-unit
    # toggle converts rates reciprocally at render time, never in storage.
    # Optional and never defaulted: a result stored before this field
    # existed simply omits it, and Compare labels that column's values as
    # the textbook fallback.
    TransportRates:
      type: object
      properties:
        icTransCost:
          type: number
          description: $ per ton-mile, plant -> warehouse.
        icMinTrans:
          type: number
          description: $ per ton minimum charge, plant -> warehouse.
        obTransCost:
          type: number
          description: $ per ton-mile, warehouse -> customer.
        obMinTrans:
          type: number
          description: $ per ton minimum charge, warehouse -> customer.
      required:
        - icTransCost
        - icMinTrans
        - obTransCost
        - obMinTrans
```

Also append `coefficient_range` to `PrecheckError.properties.code.enum` (`openapi.yaml:1804`). Keep
the server union and OpenAPI enum identical; Task 3 adds the server member and behavior.

Measured correction to the review's wording: that enum **already** contains `p_range` and `capacity`
(C4.5 added them), so this is a one-member append, not a catch-up. `precheck.ts:49-58`'s comment
claiming those two codes are "NOT YET reflected in openapi.yaml" is simply stale and is deleted in
Task 3 — do not use it as evidence that other codes are still missing.

- [ ] **Step 4: Regenerate the client/validators**

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected: Orval rewrites `lib/api-zod/src/generated/**` and `lib/api-client-react/src/generated/**`, then the workspace lib typecheck passes. Never hand-edit the output.

Prove generation is deterministic before committing:

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
pnpm --filter @workspace/api-spec run codegen
git diff --exit-code -- lib/api-zod lib/api-client-react
```

Expected: the second run produces no unstaged generated diff. If it does, stop and identify the
nondeterministic generator input rather than committing churn.

- [ ] **Step 5: Mirror it in the server-owned envelope Zod**

In `artifacts/api-server/src/solver/resultEnvelope.ts`, add to `MetricsSchema` after `outboundCost`:

```ts
  // ch9-tc — Chapter 9 JADE: the four rates this result was solved at
  // (spec §2.5). Optional and deliberately NOT `.default(...)` — an
  // envelope persisted before this field existed must keep validating,
  // and the export route safeParses stored results. Without this entry
  // Zod would strip the key silently (precheck failure #1).
  transportRates: z
    .object({
      icTransCost: z.number(),
      icMinTrans: z.number(),
      obTransCost: z.number(),
      obMinTrans: z.number(),
    })
    .optional(),
```

- [ ] **Step 6: Run to verify the tests pass**

```bash
pnpm --filter api-server test -- resultEnvelope && pnpm run typecheck
```

Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit (spec + regenerated output together, hard rules 1/4)**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react artifacts/api-server/src/solver/resultEnvelope.ts artifacts/api-server/src/__tests__/resultEnvelope.test.ts
git commit -m "[ch9-tc-2] add transport rates and coefficient-range errors to the API contract

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Input validation — scalar bounds plus the cross-field coefficient gate

Registration points 1 and 2, plus the implementation-review coefficient dependency. Point 2's failure mode is **silent**: without the Zod entry the key is stripped on PATCH, the request still succeeds, and the solve quietly uses defaults. The added semantic guard closes the separate case where every individual number is finite and within its own schema, but their product is not finite.

**Files:**
- Modify: `artifacts/api-server/src/validation/inputs/jadeInputs.ts`
- Modify: `solvers/two-echelon-jade-us/manifest.json`
- Modify: `artifacts/api-server/src/services/precheck.ts`
- Create: `artifacts/api-server/src/__tests__/jadeTransportCosts.test.ts`
- Test: `artifacts/api-server/src/__tests__/precheck.test.ts`

**Interfaces:**
- Consumes: Task 1's key names.
- Produces: `jadeInputsSchema` gains an optional `transportCosts`; `JadeInputs["transportCosts"]` is `{ icTransCost: number; icMinTrans: number; obTransCost: number; obMinTrans: number } | undefined`. Also exports `JADE_RATE_MAX = 10`, `JADE_MIN_CHARGE_MAX = 10_000`, and one `JADE_TEXTBOOK_TRANSPORT_COSTS` object for TypeScript-side default/precheck use. Task 4's payload test and this task's pin test import the bounds; `precheckJadeInputs` gains the `coefficient_range` failure class generated in Task 2.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/__tests__/jadeTransportCosts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readManifest } from "@workspace/dataset-schema";
import {
  jadeInputsSchema,
  JADE_RATE_MAX,
  JADE_MIN_CHARGE_MAX,
} from "../validation/inputs/jadeInputs.js";

const BASE = {
  p: 2,
  distanceBands: [200, 400, 800, 1600],
  gap: 0,
  timeLimitSec: 120,
};

const RATES = { icTransCost: 0.07, icMinTrans: 10, obTransCost: 0.12, obMinTrans: 10 };

describe("ch9-tc — jadeInputsSchema.transportCosts", () => {
  it("accepts inputs with no transportCosts at all (absence means textbook)", () => {
    const parsed = jadeInputsSchema.parse({ ...BASE });
    expect(parsed.transportCosts).toBeUndefined();
  });

  it("accepts a complete object", () => {
    const parsed = jadeInputsSchema.parse({ ...BASE, transportCosts: RATES });
    expect(parsed.transportCosts).toEqual(RATES);
  });

  it("rejects a partial object (all-or-nothing, never a half-merge)", () => {
    for (const key of Object.keys(RATES)) {
      const partial: Record<string, number> = { ...RATES };
      delete partial[key];
      const result = jadeInputsSchema.safeParse({ ...BASE, transportCosts: partial });
      expect(result.success, `omitting ${key} must be rejected`).toBe(false);
    }
  });

  it("accepts zero for every field", () => {
    const zeros = { icTransCost: 0, icMinTrans: 0, obTransCost: 0, obMinTrans: 0 };
    expect(jadeInputsSchema.safeParse({ ...BASE, transportCosts: zeros }).success).toBe(true);
  });

  it("rejects negative, NaN and infinite values", () => {
    for (const bad of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = jadeInputsSchema.safeParse({
        ...BASE,
        transportCosts: { ...RATES, icTransCost: bad },
      });
      expect(result.success, `${String(bad)} must be rejected`).toBe(false);
    }
  });

  it("rejects a rate above the maximum and accepts the maximum itself", () => {
    expect(jadeInputsSchema.safeParse({
      ...BASE, transportCosts: { ...RATES, obTransCost: JADE_RATE_MAX },
    }).success).toBe(true);
    expect(jadeInputsSchema.safeParse({
      ...BASE, transportCosts: { ...RATES, obTransCost: JADE_RATE_MAX + 0.01 },
    }).success).toBe(false);
  });

  it("rejects a minimum charge above the maximum and accepts the maximum itself", () => {
    expect(jadeInputsSchema.safeParse({
      ...BASE, transportCosts: { ...RATES, obMinTrans: JADE_MIN_CHARGE_MAX },
    }).success).toBe(true);
    expect(jadeInputsSchema.safeParse({
      ...BASE, transportCosts: { ...RATES, obMinTrans: JADE_MIN_CHARGE_MAX + 1 },
    }).success).toBe(false);
  });

  it("pins the manifest JSON Schema maxima equal to the Zod maxima", () => {
    const schema = readManifest("two-echelon-jade-us").inputsSchema as {
      properties: Record<string, any>;
    };
    const tc = schema.properties.transportCosts;
    expect(tc, "manifest must declare transportCosts").toBeDefined();
    expect(tc.required.sort()).toEqual(
      ["icMinTrans", "icTransCost", "obMinTrans", "obTransCost"],
    );
    expect(tc.properties.icTransCost.maximum).toBe(JADE_RATE_MAX);
    expect(tc.properties.obTransCost.maximum).toBe(JADE_RATE_MAX);
    expect(tc.properties.icMinTrans.maximum).toBe(JADE_MIN_CHARGE_MAX);
    expect(tc.properties.obMinTrans.maximum).toBe(JADE_MIN_CHARGE_MAX);
    for (const key of ["icTransCost", "icMinTrans", "obTransCost", "obMinTrans"]) {
      expect(tc.properties[key].minimum).toBe(0);
    }
  });
});
```

In the same file, parse the four `JADE_*` numeric assignments from `solve.py` (the numeric-regex
pattern used by Task 6) and assert that they equal `JADE_TEXTBOOK_TRANSPORT_COSTS`. This prevents the
server precheck's absent-key defaults from drifting from the solver; do not merely compare the export
to another test-local literal.

Extend the existing JADE precheck tests with both overflow directions and a normal-boundary case:

```ts
it("rejects huge finite distance × demand arithmetic before solve dispatch", () => {
  const result = precheckJadeInputs(jadeInputs({
    transportCosts: { ...RATES, obTransCost: 10 },
    // Use an otherwise-complete added network fixture from this suite.
    distanceOverrides: completeDistances({ outboundDistance: 1e100 }),
    addedCustomers: [addedCustomer({ "product-1": 1e308 })],
  }));
  expect(result.ok).toBe(false);
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "coefficient_range" }),
  ]));
});

it("accepts the measured baseline and scalar maxima when every derived coefficient is finite", () => {
  const result = precheckJadeInputs(jadeInputs({ transportCosts: MAX_RATES }));
  expect(result.errors.filter(e => e.code === "coefficient_range")).toEqual([]);
});
```

Add two more cases the review did not specify, both of which fail if the guard is written as a
rate-specific check instead of a coefficient check:

```ts
it("fires with NO transportCosts at all — the hazard predates this feature", () => {
  const result = precheckJadeInputs(jadeInputs({
    // transportCosts omitted entirely: the textbook 0.12 $/ton-mi still
    // overflows against these overrides.
    distanceOverrides: completeDistances({ outboundDistance: 1e100 }),
    addedCustomers: [addedCustomer({ "product-1": 1e308 })],
  }));
  expect(result.errors.some(e => e.code === "coefficient_range")).toBe(true);
});

it("rejects a literally infinite distance or demand at the SHAPE layer", () => {
  // These are `z.number().nonnegative()` today with no `.finite()`, so
  // Infinity currently parses. After Task 3 they must not.
  expect(jadeInputsSchema.safeParse({
    ...BASE,
    distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: Number.POSITIVE_INFINITY }],
  }).success).toBe(false);
  expect(jadeInputsSchema.safeParse({
    ...BASE,
    addedCustomers: [{
      id: "c-x", city: "X", state: "ZZ", lat: 0, lng: 0,
      demands: { "product-1": Number.POSITIVE_INFINITY, "product-2": 0, "product-3": 0, "product-4": 0 },
    }],
  }).success).toBe(false);
});
```

Also add a solve/enqueue-route test that stubs the worker dispatch boundary, submits a huge-but-finite
distance/demand combination, expects HTTP 422 with `coefficient_range`, and asserts the dispatch stub
was not called. A direct unit test of `precheckJadeInputs` alone does not prove the dependency is wired
into the production solve path. The hook point is real and measured: `jobRunner.ts:410` calls
`runNetworkEditsPrecheckForModel` inside the locked enqueue transaction and returns
`{ kind: "precheck_failed" }`, which `routes/scenarios.ts:557-559` maps to `422` with the `errors`
array — so no new enforcement wiring is needed, only the new code.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter api-server test -- jadeTransportCosts
```

Expected: FAIL — the import of `JADE_RATE_MAX` does not resolve.

- [ ] **Step 3: Add the Zod schema**

In `artifacts/api-server/src/validation/inputs/jadeInputs.ts`, above `export const jadeInputsSchema`:

```ts
// ch9-tc — pedagogical/product upper bounds (spec §3.1), exported because
// jadeTransportCosts.test.ts pins these equal to the manifest's `maximum`
// values and the UI's own constants. They are NOT the numerical-safety
// proof: existing distance/demand overrides are independently unbounded
// finite values. precheckJadeInputs performs the cross-field finite-
// coefficient check before enqueue; solve.py repeats it defensively.
export const JADE_RATE_MAX = 10;
export const JADE_MIN_CHARGE_MAX = 10_000;
export const JADE_TEXTBOOK_TRANSPORT_COSTS = {
  icTransCost: 0.07,
  icMinTrans: 10,
  obTransCost: 0.12,
  obMinTrans: 10,
} as const;

// All-or-nothing: the OBJECT is optional, but when present all four fields
// are required. A partial object is a 422, never a half-merge — that
// removes the whole "which three fields silently fell back to the constant"
// bug class. Absence means solve.py's textbook constants (JADE_IC_RATE etc).
const transportCostsSchema = z.object({
  icTransCost: z.number().finite().min(0).max(JADE_RATE_MAX),
  icMinTrans: z.number().finite().min(0).max(JADE_MIN_CHARGE_MAX),
  obTransCost: z.number().finite().min(0).max(JADE_RATE_MAX),
  obMinTrans: z.number().finite().min(0).max(JADE_MIN_CHARGE_MAX),
});
```

And add the field inside `jadeInputsSchema`, after `timeLimitSec`:

```ts
  // ch9-tc — optional with NO `.default(...)`: an absent key must stay
  // absent through parse, so a reset scenario is indistinguishable from one
  // never edited (and so two scenarios differing only here hash differently).
  transportCosts: transportCostsSchema.optional(),
```

- [ ] **Step 4: Add the manifest JSON Schema**

In `solvers/two-echelon-jade-us/manifest.json`, inside `inputsSchema.properties`, after `timeLimitSec`:

```json
    "transportCosts": {
      "type": "object",
      "properties": {
        "icTransCost": { "type": "number", "minimum": 0, "maximum": 10 },
        "icMinTrans": { "type": "number", "minimum": 0, "maximum": 10000 },
        "obTransCost": { "type": "number", "minimum": 0, "maximum": 10 },
        "obMinTrans": { "type": "number", "minimum": 0, "maximum": 10000 }
      },
      "required": ["icTransCost", "icMinTrans", "obTransCost", "obMinTrans"]
    },
```

- [ ] **Step 5: Add the JADE semantic coefficient guard**

First close the shape-layer half, in `jadeInputs.ts`: `distanceOverrideSchema.distance` and
`jadeDemandsSchema`'s/`customerOverrideSchema`'s demand numbers are `z.number().nonnegative()` with
no `.finite()` today, so literal `Infinity` is accepted by the current contract. Add `.finite()` to
each. This is a pre-existing defect, not one this feature introduces; it is fixed here because the
coefficient guard below is otherwise checking products of values that were never required to be
finite in the first place. State that in the commit body.

Then, in `precheck.ts`, add `"coefficient_range"` to `PrecheckErrorCode` and delete the stale
`:49-58` comment claiming `p_range`/`capacity` are absent from OpenAPI — measured false, they are at
`openapi.yaml:1804`; Task 2 appends only `coefficient_range`. In
`precheckJadeInputs`, after reference/completeness checks have established valid effective IDs and
before the capacity return:

1. Build effective per-product demand using the same base/override/added precedence already used by
   the capacity check. Require per-product and all-product aggregates to remain finite as values are
   accumulated; individually finite demand cells can still overflow a sum.
2. Build effective distances from `getReferenceDistances("two-echelon-jade-us")` plus
   `distanceOverrides`, with overrides winning. **This is the one genuinely new dependency in the
   finding:** `precheckJadeInputs` has no distance data today (it checks ids, p-range and
   per-product capacity only), so it gains a dataset import. `getReferenceDistances` exists at
   `data/referenceDistances.ts:187` and JADE is registered at `:182`, so this is a reuse, not a new
   loader — but the 2600-lane sweep is the real cost of this finding and belongs in the task's
   estimate. Include the solver's `9999` fallback only where the
   solver itself could reach it; do not silently repair a missing required added-entity edge.
3. Resolve effective rates from `inputs.transportCosts` or the exported
   `JADE_TEXTBOOK_TRANSPORT_COSTS`; do not create another TypeScript copy. Task 6's numeric parity
   test keeps that object aligned with the four authoritative Python constants.
4. Mirror the actual objective shape: for every active plant→warehouse pair require the inbound
   per-ton coefficient `max(rate * distance, minimum)` to be finite; for every active
   warehouse→customer/product term require both the outbound per-ton cost and
   `outboundCost * effectiveDemand` to be finite. Do not multiply inbound coefficients by demand in
   the check—the inbound LP variable is a continuous tonnage flow and its coefficient is per ton.
5. Emit a deterministic `coefficient_range` error naming the leg and relevant IDs/product. De-duplicate
   equivalent failures so a pathological scenario does not create an unbounded response.

Do **not** reject merely because a coefficient is large but finite. A magnitude threshold requires an
empirical CBC-conditioning spike and is outside this feature's evidence.

- [ ] **Step 6: Run to verify it passes**

```bash
pnpm --filter api-server test -- jadeTransportCosts precheck routes manifests && pnpm run typecheck
```

Expected: PASS for both files; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/validation/inputs/jadeInputs.ts solvers/two-echelon-jade-us/manifest.json artifacts/api-server/src/services/precheck.ts artifacts/api-server/src/__tests__/precheck.test.ts artifacts/api-server/src/__tests__/jadeTransportCosts.test.ts
git commit -m "[ch9-tc-3] validate transport costs and reject non-finite JADE coefficients

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Payload passthrough, persistence through the real write path, and cache-key separation

Registration point 4 — **silent** if missed: `buildPayload` is a field-by-field translation, so an unlisted field never reaches the solver and the solve quietly uses defaults.

**Files:**
- Modify: `artifacts/api-server/src/solver/pmedian.ts` (the `two-echelon-jade-us` branch, `:88-136`)
- Test: `artifacts/api-server/src/__tests__/jadeTransportCosts.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3's `JadeInputs["transportCosts"]`, Task 1's wire key.
- Produces: the solve.py stdin payload for JADE carries `transportCosts` verbatim (same key name on both sides — no translation).

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/__tests__/jadeTransportCosts.test.ts`:

```ts
import { buildPayload } from "../solver/pmedian.js";
import { computeInputsHash, computeInputsHashV2 } from "../solver/jobRunner.js";

describe("ch9-tc — buildPayload", () => {
  const jadeInputs = jadeInputsSchema.parse({ ...BASE, transportCosts: RATES });

  it("passes transportCosts straight through for JADE", () => {
    const payload = buildPayload({ modelId: "two-echelon-jade-us", inputs: jadeInputs });
    expect(payload.modelType).toBe("two_echelon_jade");
    expect(payload.transportCosts).toEqual(RATES);
  });

  it("omits the key entirely when the scenario has no transportCosts", () => {
    const bare = jadeInputsSchema.parse({ ...BASE });
    const payload = buildPayload({ modelId: "two-echelon-jade-us", inputs: bare });
    expect(payload.transportCosts).toBeUndefined();
  });

  it("never emits transportCosts for a non-JADE model", () => {
    const payload = buildPayload({
      modelId: "transport-coal",
      inputs: {
        distanceBands: [500, 1000], gap: 0, timeLimitSec: 60,
        capacityFactor: 1, singleSource: false, capacityInactive: false,
        mineCapacities: {}, stationDemands: {},
        addedMines: [], addedStations: [], laneCostOverrides: [],
      } as never,
    });
    expect("transportCosts" in payload).toBe(false);
  });
});

describe("ch9-tc — cache key separation", () => {
  const a = { modelId: "two-echelon-jade-us" as const, inputs: jadeInputsSchema.parse({ ...BASE }) };
  const b = {
    modelId: "two-echelon-jade-us" as const,
    inputs: jadeInputsSchema.parse({ ...BASE, transportCosts: { ...RATES, obTransCost: 0.2 } }),
  };

  it("gives two scenarios differing only in transportCosts different v1 hashes", () => {
    expect(computeInputsHash(a)).not.toBe(computeInputsHash(b));
  });

  it("gives them different v2 hashes too", () => {
    expect(computeInputsHashV2(a)).not.toBe(computeInputsHashV2(b));
  });
});
```

Also add a real-write-path test to `artifacts/api-server/src/__tests__/routes.test.ts`, alongside its existing JADE PATCH cases (follow that file's own supertest + `loginAs()` conventions, and call `resetLoginRateLimiterForTests()` in `beforeEach` if the file does not already):

```ts
  it("ch9-tc — persists all four transportCosts fields through the production write path", async () => {
    const created = await createScenario({ modelId: "two-echelon-jade-us" });
    const patched = await agent
      .patch(`/api/scenarios/${created.id}`)
      .send({ inputs: { ...created.inputs, transportCosts: { icTransCost: 0.09, icMinTrans: 5, obTransCost: 0.15, obMinTrans: 0 } } });
    expect(patched.status).toBe(200);

    const read = await agent.get(`/api/scenarios/${created.id}`);
    expect(read.body.inputs.transportCosts).toEqual({
      icTransCost: 0.09, icMinTrans: 5, obTransCost: 0.15, obMinTrans: 0,
    });
  });

  it("ch9-tc — a reset (key omitted) persists as absent, not as the textbook literals", async () => {
    const created = await createScenario({ modelId: "two-echelon-jade-us" });
    await agent.patch(`/api/scenarios/${created.id}`).send({
      inputs: { ...created.inputs, transportCosts: { icTransCost: 0.09, icMinTrans: 5, obTransCost: 0.15, obMinTrans: 0 } },
    });
    const { transportCosts, ...withoutRates } = { ...created.inputs, transportCosts: null } as Record<string, unknown>;
    const reset = await agent.patch(`/api/scenarios/${created.id}`).send({ inputs: withoutRates });
    expect(reset.status).toBe(200);

    const read = await agent.get(`/api/scenarios/${created.id}`);
    expect(read.body.inputs.transportCosts).toBeUndefined();
  });

  it("ch9-tc — rejects a partial transportCosts object with 422", async () => {
    const created = await createScenario({ modelId: "two-echelon-jade-us" });
    const bad = await agent
      .patch(`/api/scenarios/${created.id}`)
      .send({ inputs: { ...created.inputs, transportCosts: { icTransCost: 0.09 } } });
    expect(bad.status).toBe(422);
  });

  it("ch9-tc — clone preserves absent-vs-present semantics", async () => {
    const withRates = await createScenario({
      modelId: "two-echelon-jade-us",
      inputs: { transportCosts: { icTransCost: 0.09, icMinTrans: 5, obTransCost: 0.15, obMinTrans: 0 } },
    });
    const clone = await agent.post(`/api/scenarios/${withRates.id}/clone`).send({});
    expect(clone.body.inputs.transportCosts).toEqual({
      icTransCost: 0.09, icMinTrans: 5, obTransCost: 0.15, obMinTrans: 0,
    });

    const without = await createScenario({ modelId: "two-echelon-jade-us" });
    const cloneBare = await agent.post(`/api/scenarios/${without.id}/clone`).send({});
    expect(cloneBare.body.inputs.transportCosts).toBeUndefined();
  });
```

Two more silent-drop guards, added by the plan's own self-review (neither was in the external review):

```ts
// artifacts/api-server/src/__tests__/jadeTransportCosts.test.ts
it("ch9-tc — applyAutoDistances preserves transportCosts", () => {
  // autoDistance.ts:462 re-parses the whole inputs object through
  // jadeInputsSchema after normalizing distanceOverrides. An optional field
  // survives that round trip only because it is declared — this test is the
  // regression lock for the same Zod-strips-unknown-keys class as point 2.
  const withRates = jadeInputsSchema.parse({ ...BASE, transportCosts: RATES });
  const after = applyJadeAutoDistances(withRates /* plus whatever fixture args this helper needs */);
  expect(after.transportCosts).toEqual(RATES);
});
```

```tsx
// artifacts/studio/src/__tests__/Workspace.test.tsx — next to the existing
// defaultInputsForModel guard tests.
it("ch9-tc — a new JADE scenario carries NO transportCosts key", () => {
  const defaults = defaultInputsForModel("two-echelon-jade-us");
  expect("transportCosts" in defaults).toBe(false);
});
```

The second one protects a property the whole design rests on: absence means textbook, so a reset
scenario is indistinguishable from a never-edited one and hashes identically. The day someone
"helpfully" seeds the four defaults into `defaultInputsForModel`, every new scenario silently becomes
custom and that property is gone with no other test noticing.

Match `routes.test.ts`'s actual helper names (`createScenario`/`agent`/`loginAs` may be spelled differently there) — read the file and reuse its own fixtures rather than inventing new ones. If the clone route has a different path, read `routes/scenarios.ts` and use the real one.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter api-server test -- jadeTransportCosts routes
```

Expected: FAIL only where passthrough/write handling is still missing — `payload.transportCosts` is
`undefined` and the PATCH round-trip may return `undefined`. The v1 and v2 hash assertions should
already pass after Task 3 because both hash the canonical inputs object; retain them as regression
locks, but do not cite them as expected-red evidence for Task 4.

- [ ] **Step 3: Add the passthrough**

In `artifacts/api-server/src/solver/pmedian.ts`, in the `two-echelon-jade-us` branch, after the `distanceOverrides: i.distanceOverrides,` line:

```ts
      // ch9-tc — the four editable transportation rates (spec §3.2 point 4).
      // Same key name on both sides, so this is a pure passthrough, not a
      // translation; `undefined` when the scenario never set them, which
      // solve_jade reads as "use the textbook constants" (byte-identical to
      // the pre-change payload for every existing scenario).
      transportCosts: i.transportCosts,
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter api-server test -- jadeTransportCosts routes && pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/solver/pmedian.ts artifacts/api-server/src/__tests__/jadeTransportCosts.test.ts artifacts/api-server/src/__tests__/routes.test.ts
git commit -m "[ch9-tc-4] pass transportCosts into the JADE solver payload and cover the write path

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `useDistanceDraft` gains an optional `convert` override

Spec §2.4: do **not** write a parallel `useRateDraft`. The hook already provides the fixed canonical anchor, toggle reprojection, incomplete-draft discard and `resetKey` behaviour; the only JADE-specific need is the reciprocal conversion.

**Files:**
- Modify: `artifacts/studio/src/hooks/useDistanceDraft.ts`
- Test: `artifacts/studio/src/__tests__/useDistanceDraft.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export interface DraftConversion {
    toDisplay(canonicalValue: number, canonical: CanonicalUnit): number;
    fromDisplay(displayValue: number, canonical: CanonicalUnit): number;
  }
  // new optional field on UseDistanceDraftOptions:
  convert?: DraftConversion;
  ```
  Default is the `useDisplayUnit()` pair the hook reads today, so every existing caller is byte-identical. Task 6 passes a reciprocal pair for rate fields and an identity pair for minimum-charge fields.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/studio/src/__tests__/useDistanceDraft.test.ts`, following that file's existing harness (it already renders the hook inside a shared wrapper):

Add `type CanonicalUnit` to the test's `@workspace/units` import; the live reciprocal converter below
uses it in its public `DraftConversion`-compatible signatures.

```ts
  describe("ch9-tc — convert override", () => {
    // Build the converter INSIDE renderHook from the current UnitApi. This
    // tracks pref changes; a converter hardcoded to "km" cannot test toggles.
    function renderRateDraft(initialProps: Omit<UseDistanceDraftOptions, "convert">) {
      return renderHook(
        (props: Omit<UseDistanceDraftOptions, "convert">) => {
          const unit = useDisplayUnit();
          const convert = {
            toDisplay: (v: number, canonical: CanonicalUnit) =>
              v / unit.toDisplay(1, canonical),
            fromDisplay: (v: number, canonical: CanonicalUnit) =>
              v * unit.toDisplay(1, canonical),
          };
          return {
            unit,
            draft: useDistanceDraft({ ...props, convert }),
          };
        },
        { wrapper, initialProps },
      );
    }

    it("renders the committed value through convert.toDisplay", () => {
      // Pref "km", canonical "mi": 0.07 $/ton-mi -> 0.0435 $/ton-km.
      const { result } = renderRateDraft({ canonicalUnit: "mi", value: 0.07, onCommit: vi.fn() });
      act(() => result.current.unit.setPref("km"));
      expect(result.current.draft.text).toBe("0.0435");
    });

    it("commits through convert.fromDisplay, not the distance conversion", () => {
      const onCommit = vi.fn();
      const { result } = renderRateDraft({ canonicalUnit: "mi", value: 0.07, onCommit });
      act(() => result.current.unit.setPref("km"));
      act(() => result.current.draft.onChange("0.0870"));
      act(() => result.current.draft.commit());
      // 0.0870 $/ton-km * 1.609344 = 0.14001... $/ton-mi (NOT 0.054...).
      expect(onCommit.mock.calls[0][0]).toBeCloseTo(0.14, 4);
    });

    it("re-projects a complete dirty draft from its canonical anchor on a toggle", () => {
      const onCommit = vi.fn();
      const { result } = renderRateDraft({ canonicalUnit: "mi", value: 0.07, onCommit });
      act(() => result.current.draft.onChange("0.14"));
      act(() => result.current.unit.setPref("km"));
      expect(result.current.draft.text).toBe("0.087");
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("discards an incomplete dirty rate draft on a toggle", () => {
      const onCommit = vi.fn();
      const { result } = renderRateDraft({ canonicalUnit: "mi", value: 0.07, onCommit });
      act(() => result.current.draft.onChange("0."));
      act(() => result.current.unit.setPref("km"));
      expect(result.current.draft.text).toBe("0.0435");
      expect(result.current.draft.isDirty).toBe(false);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("leaves every existing caller's behaviour unchanged when convert is omitted", () => {
      // The default must still be the distance (multiplicative) pair.
      const { result } = renderDraft({ canonicalUnit: "mi", value: 100, onCommit: vi.fn() });
      act(() => result.current.unit.setPref("km"));
      expect(result.current.draft.text).toBe("160.9344");
    });
  });
```

This matches the file's actual one-argument `renderDraft` harness and its real toggle mechanism,
`result.current.unit.setPref`. Expected displayed values are `roundForFile` (4 dp) outputs:
`0.07 / 1.609344 = 0.043495…` → `0.0435`; `0.14 / 1.609344 = 0.086991…` → `0.087`.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter studio test -- useDistanceDraft
```

Expected: FAIL — `convert` is not a recognised option, so the km-mode text is `0.1127` (the multiplicative bug this option exists to prevent).

- [ ] **Step 3: Implement the option**

In `artifacts/studio/src/hooks/useDistanceDraft.ts`, add the interface above `UseDistanceDraftOptions`:

```ts
/**
 * ch9-tc — how this field's value maps between canonical storage and the
 * active display unit. Defaults to `useDisplayUnit()`'s own distance pair,
 * so every pre-existing caller is byte-identical.
 *
 * A RATE is per unit distance, so its conversion is the RECIPROCAL of a
 * distance conversion — using the distance pair on a rate would make km
 * mode read 0.1127 $/ton-km for a 0.07 $/ton-mi rate, i.e. freight getting
 * MORE expensive because someone flipped a display switch. A value with no
 * distance dimension at all (a $/ton minimum charge) passes the identity
 * pair so the toggle leaves it alone.
 */
export interface DraftConversion {
  toDisplay(canonicalValue: number, canonical: CanonicalUnit): number;
  fromDisplay(displayValue: number, canonical: CanonicalUnit): number;
}
```

Add to `UseDistanceDraftOptions`:

```ts
  /** ch9-tc — see `DraftConversion`. Omit for a distance field. */
  convert?: DraftConversion;
```

Destructure it in the signature (`convert,` after `presentation = "raw",`) and rebind the two functions immediately after the `useDisplayUnit()` call:

```ts
  const { effectiveUnit, toDisplay: unitToDisplay, fromDisplay: unitFromDisplay } = useDisplayUnit();
  const toDisplay = convert?.toDisplay ?? unitToDisplay;
  const fromDisplay = convert?.fromDisplay ?? unitFromDisplay;
```

Nothing else in the hook body changes — `committedRawText`, the toggle reprojection at `:132` and `onChange`'s anchor at `:164` all already route through these two names.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter studio test -- useDistanceDraft DistancesTab LegDistancesTab LaneCostsTab SolveDialog OptimizationParametersTab JadeDistancesTab
```

Expected: PASS everywhere — the six existing caller files' suites prove the option is additive (see the Global Constraints deviation note for the measured caller list).

- [ ] **Step 5: Commit**

```bash
git add artifacts/studio/src/hooks/useDistanceDraft.ts artifacts/studio/src/__tests__/useDistanceDraft.test.ts
git commit -m "[ch9-tc-5] add an optional convert override to useDistanceDraft

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `lib/transportCosts.ts` + the Transportation Costs tab

**Files:**
- Create: `artifacts/studio/src/lib/transportCosts.ts`
- Create: `artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx`
- Create: `artifacts/studio/src/__tests__/TransportCostsTab.test.tsx`
- Create: `artifacts/studio/src/__tests__/transportCostsBounds.test.ts`

**Interfaces:**
- Consumes: Task 5's `DraftConversion`.
- Produces, from `@/lib/transportCosts`:
  ```ts
  export interface TransportCosts { icTransCost: number; icMinTrans: number; obTransCost: number; obMinTrans: number }
  export const TEXTBOOK_TRANSPORT_COSTS: TransportCosts;      // 0.07 / 10 / 0.12 / 10
  export const UI_RATE_MAX = 10;
  export const UI_MIN_CHARGE_MAX = 10_000;
  export function transportCostsFromInputs(inputs: Record<string, unknown> | null | undefined): TransportCosts;
  export function hasCustomTransportCosts(inputs: Record<string, unknown> | null | undefined): boolean;
  export function laneCostPerTon(distanceCanonical: number, rate: number, min: number): number;
  export function minChargeBinds(distanceCanonical: number, rate: number, min: number): boolean;
  export function rateConversion(unit: UnitApi): DraftConversion;
  export const IDENTITY_CONVERSION: DraftConversion;
  export function rateUnitLabel(canonical: CanonicalUnit | null | undefined, unit: UnitApi): string | null;
  ```
  Task 7 imports `transportCostsFromInputs`/`hasCustomTransportCosts`; Task 8 imports `laneCostPerTon`/`minChargeBinds`; Task 9 imports `TEXTBOOK_TRANSPORT_COSTS`/`rateConversion`/`rateUnitLabel`.
- The component's props:
  ```ts
  interface TransportCostsTabProps {
    canonicalUnit: CanonicalUnit | null;
    transportCosts: TransportCosts;          // effective values (textbook when absent)
    isCustom: boolean;                        // true when inputs carry the key
    onChange(next: TransportCosts): void;     // always writes all four
    onReset(): void;                          // clears the key entirely
    disabled?: boolean;                       // history browsing
    scenarioId?: number;                      // draft resetKey
  }
  ```
  Task 7 renders exactly this.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/studio/src/__tests__/transportCostsBounds.test.ts` (the UI half of the three-way pin; the pattern — walk up to `pnpm-workspace.yaml`, read the manifest from disk — is copied from `lockedChapterDrift.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UI_RATE_MAX, UI_MIN_CHARGE_MAX, TEXTBOOK_TRANSPORT_COSTS } from "@/lib/transportCosts";

const HERE = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repo root (pnpm-workspace.yaml) not found above " + start);
}

// ch9-tc — the maxima are declared in THREE places (manifest JSON Schema,
// api-server Zod, this UI constant) and the spec requires them pinned
// equal. jadeTransportCosts.test.ts pins manifest<->Zod on the server side;
// this is the UI leg of the same triangle, read from the manifest on disk
// so a server-side bound change that forgets the UI goes red here.
describe("ch9-tc — UI transport-cost bounds match the manifest", () => {
  const manifest = JSON.parse(
    readFileSync(join(findRepoRoot(HERE), "solvers/two-echelon-jade-us/manifest.json"), "utf8"),
  );
  const tc = manifest.inputsSchema.properties.transportCosts.properties;

  it("pins the rate maximum", () => {
    expect(tc.icTransCost.maximum).toBe(UI_RATE_MAX);
    expect(tc.obTransCost.maximum).toBe(UI_RATE_MAX);
  });

  it("pins the minimum-charge maximum", () => {
    expect(tc.icMinTrans.maximum).toBe(UI_MIN_CHARGE_MAX);
    expect(tc.obMinTrans.maximum).toBe(UI_MIN_CHARGE_MAX);
  });

  it("keeps the textbook defaults equal to solve.py's constants", () => {
    const solvePy = readFileSync(
      join(findRepoRoot(HERE), "artifacts/api-server/src/solver/solve.py"), "utf8",
    );
    const readPythonNumber = (name: string): number => {
      const match = solvePy.match(new RegExp(`^${name}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)`, "m"));
      if (!match) throw new Error(`missing numeric Python constant ${name}`);
      return Number(match[1]);
    };
    expect({
      icTransCost: readPythonNumber("JADE_IC_RATE"),
      icMinTrans: readPythonNumber("JADE_IC_MIN"),
      obTransCost: readPythonNumber("JADE_OB_RATE"),
      obMinTrans: readPythonNumber("JADE_OB_MIN"),
    }).toEqual(TEXTBOOK_TRANSPORT_COSTS);
  });
});
```

Parse numerically rather than matching source substrings: `10` and `10.0` are contract-equivalent,
and the parity lock must cover both minimum-charge constants as well as both rates.

Create `artifacts/studio/src/__tests__/TransportCostsTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";
import { TransportCostsTab } from "@/components/workspace/tabs/TransportCostsTab";
import { TEXTBOOK_TRANSPORT_COSTS } from "@/lib/transportCosts";

function renderTab(overrides: Partial<React.ComponentProps<typeof TransportCostsTab>> = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const utils = render(
    <UnitProvider>
      <PrefSetter />
      <TransportCostsTab
        canonicalUnit="mi"
        transportCosts={TEXTBOOK_TRANSPORT_COSTS}
        isCustom={false}
        onChange={onChange}
        onReset={onReset}
        scenarioId={1}
        {...overrides}
      />
    </UnitProvider>,
  );
  return { ...utils, onChange, onReset };
}

/** Seeds the INITIAL preference only — UnitProvider reads localStorage on
 *  mount. Use the app's own storage key so this cannot drift from
 *  UnitContext. Never use this to simulate a toggle on a mounted tree: a
 *  remount re-derives the field from the stored value and therefore proves
 *  nothing about draft reprojection, which is the behaviour §2.4 is about. */
function setPref(pref: "auto" | "km" | "mi") {
  window.localStorage.setItem("nos:display-unit-pref", pref);
}

/** A LIVE toggle on the mounted tree — the same mechanism
 *  useDistanceDraft.test.ts uses (`unit.setPref`), reached here through a
 *  sibling component inside the same UnitProvider. */
function PrefSetter() {
  const unit = useDisplayUnit();
  return (
    <>
      <button data-testid="set-km" onClick={() => unit.setPref("km")}>km</button>
      <button data-testid="set-mi" onClick={() => unit.setPref("mi")}>mi</button>
    </>
  );
}

describe("TransportCostsTab (ch9-tc)", () => {
  beforeEach(() => window.localStorage.clear());

  it("seeds the four fields from the textbook defaults when inputs carry no rates", () => {
    renderTab();
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");
    expect(screen.getByTestId("input-transport-ic-min")).toHaveValue("10");
    expect(screen.getByTestId("input-transport-ob-rate")).toHaveValue("0.12");
    expect(screen.getByTestId("input-transport-ob-min")).toHaveValue("10");
  });

  it("seeds from the scenario's own rates when present", () => {
    renderTab({
      transportCosts: { icTransCost: 0.09, icMinTrans: 5, obTransCost: 0.15, obMinTrans: 0 },
      isCustom: true,
    });
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.09");
    expect(screen.getByTestId("input-transport-ob-min")).toHaveValue("0");
  });

  it("commits all four fields on blur, never a partial object", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0.09" } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      ...TEXTBOOK_TRANSPORT_COSTS, icTransCost: 0.09,
    });
  });

  // THE most important test in this spec (§6).
  it("km -> mi -> km toggling on the MOUNTED tab leaves the stored canonical rate exactly 0.07", () => {
    setPref("km");
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    expect(field).toHaveValue("0.0435");

    // Live toggles on one mounted instance — a remount would re-derive the
    // field from the stored value and prove nothing about reprojection.
    fireEvent.click(screen.getByTestId("set-mi"));
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");

    fireEvent.click(screen.getByTestId("set-km"));
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.0435");

    fireEvent.click(screen.getByTestId("set-mi"));
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");

    // No toggle may ever write: the stored canonical value is untouched.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("re-projects a complete dirty rate draft across a live toggle without writing", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0.14" } });
    fireEvent.click(screen.getByTestId("set-km"));
    // 0.14 / 1.609344 = 0.086991… -> 0.087 at the field's 4 dp.
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.087");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the reciprocal conversion in km mode, not the multiplicative one", () => {
    setPref("km");
    renderTab();
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.0435");
    expect(screen.getByTestId("input-transport-ic-rate")).not.toHaveValue("0.1127");
  });

  it("labels rates in the active display unit and minimum charges in $/ton", () => {
    setPref("km");
    renderTab();
    expect(screen.getByTestId("label-transport-rate-unit-ic")).toHaveTextContent("$/ton-km");
    expect(screen.getByTestId("label-transport-min-unit-ic")).toHaveTextContent("$/ton");
  });

  it("leaves a minimum charge unconverted by the display toggle", () => {
    setPref("km");
    renderTab();
    expect(screen.getByTestId("input-transport-ic-min")).toHaveValue("10");
  });

  it("treats an equivalent spelling as a semantic no-op", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0.0700" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats a cross-unit round trip as a semantic no-op", () => {
    setPref("km");
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    // Retype exactly what is displayed; fromDisplay lands on 0.070006..., so
    // only a DISPLAY-space comparison catches this as unchanged.
    fireEvent.change(field, { target: { value: "0.0435" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards an in-progress draft when the scenario changes (resetKey)", () => {
    const { rerender, onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0.09" } });
    expect(field).toHaveValue("0.09");
    rerender(
      <UnitProvider>
        <TransportCostsTab
          canonicalUnit="mi"
          transportCosts={TEXTBOOK_TRANSPORT_COSTS}
          isCustom={false}
          onChange={onChange}
          onReset={vi.fn()}
          scenarioId={2}
        />
      </UnitProvider>,
    );
    // One scenario's unfinished text can never be committed into another.
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("discards an incomplete draft on a live unit toggle rather than committing it", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0." } });
    fireEvent.click(screen.getByTestId("set-km"));
    // Visibly discarded: back to the stored value in the new unit.
    expect(screen.getByTestId("input-transport-ic-rate")).toHaveValue("0.0435");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a negative value inline and never writes", () => {
    const { onChange } = renderTab();
    const field = screen.getByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "-1" } });
    expect(screen.getByTestId("error-transport-ic-rate")).toBeInTheDocument();
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a rate above 10 and a minimum charge above 10000 inline", () => {
    const { onChange } = renderTab();
    const rate = screen.getByTestId("input-transport-ob-rate");
    fireEvent.change(rate, { target: { value: "10.5" } });
    expect(screen.getByTestId("error-transport-ob-rate")).toBeInTheDocument();
    fireEvent.blur(rate);

    const min = screen.getByTestId("input-transport-ob-min");
    fireEvent.change(min, { target: { value: "10001" } });
    expect(screen.getByTestId("error-transport-ob-min")).toBeInTheDocument();
    fireEvent.blur(min);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("validates a km-displayed rate against the converted maximum", () => {
    setPref("km");
    const { onChange } = renderTab();
    const rate = screen.getByTestId("input-transport-ob-rate");
    // Canonical max 10 $/ton-mi = 6.2137 $/ton-km at the field's 4 dp.
    fireEvent.change(rate, { target: { value: "6.2137" } });
    expect(screen.queryByTestId("error-transport-ob-rate")).not.toBeInTheDocument();
    fireEvent.blur(rate);
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.change(rate, { target: { value: "6.2138" } });
    expect(screen.getByTestId("error-transport-ob-rate")).toHaveTextContent("6.2137");
    fireEvent.blur(rate);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("accepts zero for a minimum charge", () => {
    const { onChange } = renderTab();
    const min = screen.getByTestId("input-transport-ob-min");
    fireEvent.change(min, { target: { value: "0" } });
    fireEvent.blur(min);
    expect(onChange.mock.calls[0][0]).toEqual({ ...TEXTBOOK_TRANSPORT_COSTS, obMinTrans: 0 });
  });

  it("offers Reset only when the scenario carries custom rates, and clears rather than writing defaults", () => {
    const bare = renderTab();
    expect(bare.getByTestId("button-transport-reset")).toBeDisabled();
    bare.unmount();

    const custom = renderTab({ isCustom: true, transportCosts: { ...TEXTBOOK_TRANSPORT_COSTS, icTransCost: 0.09 } });
    fireEvent.click(custom.getByTestId("button-transport-reset"));
    expect(custom.onReset).toHaveBeenCalledTimes(1);
    expect(custom.onChange).not.toHaveBeenCalled();
  });

  it("disables every field and Reset while browsing history", () => {
    const { onChange } = renderTab({ disabled: true, isCustom: true });
    for (const id of ["ic-rate", "ic-min", "ob-rate", "ob-min"]) {
      expect(screen.getByTestId(`input-transport-${id}`)).toBeDisabled();
    }
    expect(screen.getByTestId("button-transport-reset")).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explains the pricing formula", () => {
    renderTab();
    expect(screen.getByTestId("text-transport-formula")).toHaveTextContent(
      "cost per ton = max(rate × distance, min)",
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio test -- TransportCostsTab transportCostsBounds
```

Expected: FAIL — module `@/lib/transportCosts` not found.

- [ ] **Step 3: Write the shared library**

Create `artifacts/studio/src/lib/transportCosts.ts`:

```ts
import type { CanonicalUnit } from "@workspace/units";
import type { UnitApi } from "@/contexts/UnitContext";
import type { DraftConversion } from "@/hooks/useDistanceDraft";

// ch9-tc — the frontend's single source of truth for Chapter 9's four
// transportation cost parameters. Every consumer (the input tab, the
// Distances tab's derived columns, the cost summary's solved-at block, and
// their tests) imports from here, so no constant or formula is re-derived
// in two places.

export interface TransportCosts {
  /** $ per ton-mile, plant -> warehouse. */
  icTransCost: number;
  /** $ per ton minimum charge, plant -> warehouse. */
  icMinTrans: number;
  /** $ per ton-mile, warehouse -> customer. */
  obTransCost: number;
  /** $ per ton minimum charge, warehouse -> customer. */
  obMinTrans: number;
}

/** solve.py's JADE_IC_RATE / JADE_IC_MIN / JADE_OB_RATE / JADE_OB_MIN.
 *  Pinned against solve.py by transportCostsBounds.test.ts. */
export const TEXTBOOK_TRANSPORT_COSTS: TransportCosts = {
  icTransCost: 0.07,
  icMinTrans: 10,
  obTransCost: 0.12,
  obMinTrans: 10,
};

/** Must equal the manifest's `maximum` and jadeInputs.ts's `.max(...)` —
 *  pinned by transportCostsBounds.test.ts (UI leg) and
 *  jadeTransportCosts.test.ts (server leg). */
export const UI_RATE_MAX = 10;
export const UI_MIN_CHARGE_MAX = 10_000;

export const TRANSPORT_COST_KEYS: ReadonlyArray<keyof TransportCosts> = [
  "icTransCost", "icMinTrans", "obTransCost", "obMinTrans",
];

function isCompleteTransportCosts(value: unknown): value is TransportCosts {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return TRANSPORT_COST_KEYS.every(k => typeof v[k] === "number" && Number.isFinite(v[k] as number));
}

/** The EFFECTIVE rates for a scenario: its own when complete, the textbook
 *  values otherwise. A partial object can never reach here through the API
 *  (Zod rejects it), so falling back wholesale is the honest reading. */
export function transportCostsFromInputs(
  inputs: Record<string, unknown> | null | undefined,
): TransportCosts {
  const raw = inputs?.transportCosts;
  return isCompleteTransportCosts(raw) ? { ...raw } : { ...TEXTBOOK_TRANSPORT_COSTS };
}

/** True when the scenario actually carries rates — drives whether Reset is
 *  offered, and distinguishes "reset" from "never edited". */
export function hasCustomTransportCosts(
  inputs: Record<string, unknown> | null | undefined,
): boolean {
  return isCompleteTransportCosts(inputs?.transportCosts);
}

/** The per-lane price, $/ton. `distanceCanonical` is in the model's
 *  canonical unit (miles for JADE), matching the rate's denominator — the
 *  RESULT carries no distance unit and must not be converted for display. */
export function laneCostPerTon(distanceCanonical: number, rate: number, min: number): number {
  return Math.max(rate * distanceCanonical, min);
}

/** True when the minimum charge, not the rate, is what the lane pays. */
export function minChargeBinds(distanceCanonical: number, rate: number, min: number): boolean {
  return rate * distanceCanonical <= min;
}

/**
 * A rate is per UNIT DISTANCE, so converting it is the reciprocal of
 * converting a distance: `UnitApi.toDisplay` multiplies, which would make
 * 0.07 $/ton-mi read 0.1127 $/ton-km — freight getting more expensive
 * because someone flipped a display switch. Derived from the same
 * authority rather than hardcoding 1.609344.
 */
export function rateConversion(unit: UnitApi): DraftConversion {
  return {
    toDisplay: (rate, canonical) => rate / unit.toDisplay(1, canonical),
    fromDisplay: (rate, canonical) => rate * unit.toDisplay(1, canonical),
  };
}

/** A $/ton minimum charge has no distance dimension — the toggle leaves it
 *  alone. */
export const IDENTITY_CONVERSION: DraftConversion = {
  toDisplay: v => v,
  fromDisplay: v => v,
};

/** "$/ton-mi" | "$/ton-km", or null while the canonical unit is unresolved
 *  (never guess a unit — Part D's "no fallback unit" rule). */
export function rateUnitLabel(
  canonical: CanonicalUnit | null | undefined,
  unit: UnitApi,
): string | null {
  return canonical == null ? null : `$/ton-${unit.effectiveUnit(canonical)}`;
}
```

- [ ] **Step 4: Write the tab**

Create `artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx`:

```tsx
import { useEffect, useState } from "react";
import { roundForFile, type CanonicalUnit } from "@workspace/units";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDisplayUnit } from "@/contexts/UnitContext";
import { useDistanceDraft, type DraftConversion } from "@/hooks/useDistanceDraft";
import { stripGrouping } from "@/lib/formatDistanceDisplay";
import {
  IDENTITY_CONVERSION,
  UI_MIN_CHARGE_MAX,
  UI_RATE_MAX,
  rateConversion,
  rateUnitLabel,
  type TransportCosts,
} from "@/lib/transportCosts";

// ch9-tc — Chapter 9's four transportation cost parameters (spec §5.1).
// Four global scalars, not a lane grid: the per-lane $/ton is always
// DERIVED (JadeDistancesTab's two columns), never stored.
//
// Canonical storage is always $/ton-mile. The display toggle converts a
// RATE reciprocally (see lib/transportCosts.ts) and leaves a $/ton minimum
// charge alone — which is why the two field kinds pass different
// `convert` pairs into the one shared draft hook rather than this file
// re-implementing the draft state machine.

interface TransportCostsTabProps {
  canonicalUnit: CanonicalUnit | null;
  /** Effective values — the scenario's own, or the textbook defaults. */
  transportCosts: TransportCosts;
  /** True when the scenario actually carries rates (enables Reset). */
  isCustom: boolean;
  /** Always called with ALL FOUR fields (the schema is all-or-nothing). */
  onChange(next: TransportCosts): void;
  /** Clears the key entirely — never writes the textbook literals, so a
   *  reset scenario is indistinguishable from one never edited. */
  onReset(): void;
  /** True while the result-history stepper is parked on a non-latest entry.
   *  Workspace's `updateInputsField` guard is the real write barrier; this
   *  is the visible half of the same rule. */
  disabled?: boolean;
  scenarioId?: number;
}

function TransportCostField({
  canonicalUnit,
  value,
  max,
  convert,
  disabled,
  resetKey,
  onCommitValid,
  inputTestId,
  errorTestId,
  label,
}: {
  canonicalUnit: CanonicalUnit | null;
  value: number;
  max: number;
  convert: DraftConversion;
  disabled: boolean;
  resetKey: unknown;
  onCommitValid: (canonicalValue: number) => void;
  inputTestId: string;
  errorTestId: string;
  label: string;
}) {
  const [rejected, setRejected] = useState<string | null>(null);
  useEffect(() => setRejected(null), [resetKey, value]);
  const draft = useDistanceDraft({
    canonicalUnit,
    value,
    convert,
    resetKey,
    onCommit: v => {
      // Domain validation lives HERE, not in the hook: the hook commits any
      // grammar-complete draft, and ten existing call sites share it.
      if (!Number.isFinite(v) || v < 0) {
        setRejected("Must be a number of 0 or more.");
        return;
      }
      // The committed value is canonical, so this is the authoritative
      // server-equivalent bound check even when the field displays km.
      if (v > max) {
        setRejected(`Must be ${max.toLocaleString()} or less.`);
        return;
      }
      setRejected(null);
      onCommitValid(v);
    },
  });

  // Live, as-you-type validation, independent of the commit grammar (same
  // pattern as JadeDistancesTab's own override cell).
  const trimmed = stripGrouping(draft.text).trim();
  const numeric = trimmed === "" ? null : Number(trimmed);
  const displayMax = canonicalUnit == null
    ? null
    : roundForFile(convert.toDisplay(max, canonicalUnit));
  const liveError =
    trimmed === "" || numeric === null || Number.isNaN(numeric)
      ? trimmed === "" ? null : "Must be a number."
      : numeric < 0
        ? "Must be 0 or more."
        : displayMax != null && numeric > displayMax
          ? `Must be ${displayMax.toLocaleString()} or less.`
          : null;
  const error = liveError ?? rejected;

  return (
    <div className="flex flex-col gap-0.5">
      <Input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft.text}
        disabled={disabled || draft.disabled}
        onChange={e => {
          setRejected(null);
          draft.onChange(e.target.value);
        }}
        onBlur={draft.commit}
        onKeyDown={e => {
          if (e.key === "Enter") draft.commit();
          else if (e.key === "Escape") draft.discard();
        }}
        className="h-8 w-28 text-sm font-mono"
        data-testid={inputTestId}
      />
      {error && (
        <span className="text-[10px] text-destructive" data-testid={errorTestId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function TransportCostsTab({
  canonicalUnit,
  transportCosts,
  isCustom,
  onChange,
  onReset,
  disabled = false,
  scenarioId,
}: TransportCostsTabProps) {
  const unit = useDisplayUnit();
  const rateConvert = rateConversion(unit);
  const rateLabel = rateUnitLabel(canonicalUnit, unit);

  /**
   * The semantic no-op guard (spec §2.4). It lives here, not in the hook:
   * `commit()` fires for any complete draft and never compares against the
   * stored value, and moving the comparison inside would change behaviour
   * for every other caller.
   *
   * Compare in DISPLAY space, at the same 4 dp the field renders. A
   * same-unit equivalent spelling ("0.0700") is already bit-identical
   * through `fromDisplay`, but a cross-unit round trip lands on
   * 0.069999…/0.070006…, and only the display-space comparison sees that as
   * unchanged. Raw string comparison is forbidden — "0.0700" and "0.07" are
   * the same value and must not stale the scenario.
   */
  function commitField(field: keyof TransportCosts, incoming: number, convert: DraftConversion) {
    if (canonicalUnit != null) {
      const stored = transportCosts[field];
      if (
        roundForFile(convert.toDisplay(incoming, canonicalUnit)) ===
        roundForFile(convert.toDisplay(stored, canonicalUnit))
      ) {
        return;
      }
    }
    onChange({ ...transportCosts, [field]: incoming });
  }

  const legs = [
    {
      key: "ic" as const,
      label: "Inbound",
      lane: "plant → warehouse",
      rateField: "icTransCost" as const,
      minField: "icMinTrans" as const,
    },
    {
      key: "ob" as const,
      label: "Outbound",
      lane: "warehouse → customer",
      rateField: "obTransCost" as const,
      minField: "obMinTrans" as const,
    },
  ];

  return (
    <div className="p-4 space-y-3" data-testid="transport-costs-tab">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Leg</TableHead>
            <TableHead data-testid="label-transport-rate-unit-head">
              Rate{rateLabel ? ` (${rateLabel})` : ""}
            </TableHead>
            <TableHead>Min ($/ton)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {legs.map(leg => (
            <TableRow key={leg.key} data-testid={`row-transport-${leg.key}`}>
              <TableCell className="text-xs">
                <div className="font-medium">{leg.label}</div>
                <div className="text-muted-foreground">{leg.lane}</div>
              </TableCell>
              <TableCell>
                <TransportCostField
                  canonicalUnit={canonicalUnit}
                  value={transportCosts[leg.rateField]}
                  max={UI_RATE_MAX}
                  convert={rateConvert}
                  disabled={disabled}
                  resetKey={scenarioId}
                  onCommitValid={v => commitField(leg.rateField, v, rateConvert)}
                  inputTestId={`input-transport-${leg.key}-rate`}
                  errorTestId={`error-transport-${leg.key}-rate`}
                  label={`${leg.label} rate`}
                />
                <span
                  className="text-[10px] text-muted-foreground"
                  data-testid={`label-transport-rate-unit-${leg.key}`}
                >
                  {rateLabel ?? "—"}
                </span>
              </TableCell>
              <TableCell>
                <TransportCostField
                  canonicalUnit={canonicalUnit}
                  value={transportCosts[leg.minField]}
                  max={UI_MIN_CHARGE_MAX}
                  convert={IDENTITY_CONVERSION}
                  disabled={disabled}
                  resetKey={scenarioId}
                  onCommitValid={v => commitField(leg.minField, v, IDENTITY_CONVERSION)}
                  inputTestId={`input-transport-${leg.key}-min`}
                  errorTestId={`error-transport-${leg.key}-min`}
                  label={`${leg.label} minimum charge`}
                />
                <span
                  className="text-[10px] text-muted-foreground"
                  data-testid={`label-transport-min-unit-${leg.key}`}
                >
                  $/ton
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground" data-testid="text-transport-formula">
        cost per ton = max(rate × distance, min)
      </p>

      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={disabled || !isCustom}
        onClick={onReset}
        data-testid="button-transport-reset"
      >
        Reset to textbook values
      </Button>
    </div>
  );
}
```

If `@/components/ui/table` does not export exactly these names, match whatever `JadeDistancesTab.tsx` imports — do not add a second table primitive.

- [ ] **Step 5: Run to verify the tests pass**

```bash
pnpm --filter studio test -- TransportCostsTab transportCostsBounds
```

Expected: PASS. If the km-mode expectation reads `0.1127`, the `convert` pair is wired to the distance conversion — fix `rateConversion`, not the test.

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/src/lib/transportCosts.ts artifacts/studio/src/components/workspace/tabs/TransportCostsTab.tsx artifacts/studio/src/__tests__/TransportCostsTab.test.tsx artifacts/studio/src/__tests__/transportCostsBounds.test.ts
git commit -m "[ch9-tc-6] add the Transportation Costs tab and its shared rate library

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Register the tab in Workspace (points 7–10)

All four of these are the documented silent failure modes of choosing a dedicated tab (spec §2.3), which is why they carry their own tests.

**Files:**
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (`inputEntriesForModel` `:1296-1304`, `isEditableInputTab` `:2352`, `renderTabContent`'s JADE branches around `:3912`)
- Modify: `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx` (JADE input list — a sibling test that fails without this)
- Test: `artifacts/studio/src/__tests__/Workspace.Jade.test.tsx`

**Interfaces:**
- Consumes: Task 6's `TransportCostsTab` props and `transportCostsFromInputs`/`hasCustomTransportCosts`.
- Produces: sidebar entity id `transportCosts` (testid `sidebar-input-transportCosts`), tab root testid `transport-costs-tab`, and a `clearTransportCosts()` local that deletes the key from `localInputs`.

- [ ] **Step 1: Write the failing tests**

Update the JADE input list in `artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx` (`:541`), inserting between Distances and Optimization Parameters:

```tsx
        { sidebarId: "distances", tabTestId: "jade-distances-tab" },
        { sidebarId: "transportCosts", tabTestId: "transport-costs-tab" },
        OPTIMIZATION_PARAMETERS,
```

Append to `artifacts/studio/src/__tests__/Workspace.Jade.test.tsx` (reuse that file's existing render helper, scenario fixture and MSW/mock setup — do not introduce a second one):

```tsx
describe("ch9-tc — Transportation Costs tab registration", () => {
  it("shows the Save affordance after a rate edit (isEditableInputTab)", async () => {
    renderJadeWorkspace();
    fireEvent.click(await screen.findByTestId("sidebar-input-transportCosts"));
    const field = await screen.findByTestId("input-transport-ic-rate");
    fireEvent.change(field, { target: { value: "0.09" } });
    fireEvent.blur(field);
    expect(await screen.findByTestId("text-unsaved-changes")).toBeInTheDocument();
    expect(screen.getByTestId("button-save")).toBeEnabled();
  });

  it("Reset removes the key from the draft rather than writing the textbook literals", async () => {
    renderJadeWorkspace({
      inputs: { ...jadeInputs, transportCosts: { icTransCost: 0.09, icMinTrans: 10, obTransCost: 0.12, obMinTrans: 10 } },
    });
    fireEvent.click(await screen.findByTestId("sidebar-input-transportCosts"));
    fireEvent.click(await screen.findByTestId("button-transport-reset"));
    // Back to the textbook display value, and Reset is no longer offered —
    // the draft now has no transportCosts key at all.
    expect(await screen.findByTestId("input-transport-ic-rate")).toHaveValue("0.07");
    expect(screen.getByTestId("button-transport-reset")).toBeDisabled();
  });

  it("disables the fields while browsing a non-latest result", async () => {
    renderJadeWorkspaceBrowsingHistory();
    fireEvent.click(await screen.findByTestId("sidebar-input-transportCosts"));
    expect(await screen.findByTestId("input-transport-ic-rate")).toBeDisabled();
    expect(screen.getByTestId("button-transport-reset")).toBeDisabled();
  });
});
```

If `Workspace.Jade.test.tsx` has no history-browsing helper, follow whatever mechanism another suite in this repo uses to park the result-history stepper on a non-latest entry; if none exists, assert the disabled state by rendering `TransportCostsTab` with `disabled` from Task 6's suite and cover the Workspace wiring by asserting `updateInputsField` cannot fire — state in the commit body which route you took.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio test -- Workspace.TabCoverage Workspace.Jade
```

Expected: FAIL — `sidebar-input-transportCosts` not found.

- [ ] **Step 3: Add the sidebar entry (point 7)**

In `inputEntriesForModel`'s `two-echelon-jade-us` case, between `distances` and `optimization-parameters`:

```ts
        { id: "distances", label: "Distances" },
        // ch9-tc — Chapter 9's four transportation cost parameters. Its own
        // tab rather than four more fields on Optimization Parameters:
        // these are model cost DATA, not solver controls like gap/
        // timeLimitSec (spec §2.3, decided with the simpler alternative
        // costed out).
        { id: "transportCosts", label: "Transportation Costs" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
```

- [ ] **Step 4: Add the render branch (point 8)**

Immediately after the existing JADE `distances` branch in `renderTabContent` (which ends around `:3947`):

```tsx
    // ch9-tc — Transportation Costs tab, two-echelon-jade-us only. Four
    // global scalars under `inputs.transportCosts`; absence means the
    // textbook values, which is why `transportCostsFromInputs` resolves the
    // EFFECTIVE values while `hasCustomTransportCosts` separately reports
    // whether the key is actually there (Reset must clear, not rewrite).
    if (activeTab.kind === "input" && activeTab.entity === "transportCosts" && modelId === "two-echelon-jade-us") {
      if (!localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <TransportCostsTab
          canonicalUnit={canonicalUnit}
          transportCosts={transportCostsFromInputs(localInputs)}
          isCustom={hasCustomTransportCosts(localInputs)}
          onChange={next => updateInputsField("transportCosts", next)}
          onReset={clearTransportCosts}
          disabled={isBrowsingHistoryNow}
          scenarioId={currentScenario?.id}
        />
      );
    }
```

Add the imports at the top of `Workspace.tsx`, next to the other tab imports:

```ts
import { TransportCostsTab } from "@/components/workspace/tabs/TransportCostsTab";
import { hasCustomTransportCosts, transportCostsFromInputs } from "@/lib/transportCosts";
```

- [ ] **Step 5: Add `clearTransportCosts` and the Save gate (points 9, 10)**

Next to `updateInputsField` (`:2016`):

```tsx
  // ch9-tc — Reset DELETES the key instead of writing 0.07/0.12/10/10, so a
  // reset scenario is byte-identical to one that was never edited (and
  // hashes the same for the solve cache). Routed through `guardStep1Edit`
  // like `updateInputsField`, with the same history-read-only guard.
  function clearTransportCosts() {
    if (isBrowsingHistoryNow) return;
    if (!localInputs) return;
    const next = { ...localInputs };
    delete next.transportCosts;
    guardStep1Edit(next, "transportCosts");
  }
```

And in `isEditableInputTab`, add to the entity list:

```ts
      // ch9-tc — the Transportation Costs tab writes into `localInputs` via
      // `updateInputsField` exactly like every other editable tab, so it
      // needs the same manual-Save toolbar. Without this entry the fields
      // edit the draft with no way to persist it.
      activeTab.entity === "transportCosts" ||
```

- [ ] **Step 6: Run to verify they pass**

```bash
pnpm --filter studio test -- Workspace && pnpm run typecheck
```

Expected: PASS for every `Workspace*` suite; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/src/__tests__/Workspace.Jade.test.tsx
git commit -m "[ch9-tc-7] register the Transportation Costs tab in Workspace

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Derived `$/ton` and `Min?` columns on the Distances tab (point 11)

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx` (props, header `:744-752`, row body `:805`, the two `colSpan={6}` placeholders)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (the JADE `distances` render branch — pass the rates)
- Test: `artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx`

**Interfaces:**
- Consumes: Task 6's `laneCostPerTon`/`minChargeBinds`/`TransportCosts`, Task 7's `transportCostsFromInputs`.
- Produces: new optional prop `transportCosts?: TransportCosts` on `JadeDistancesTab`; cell testids `cell-jadedistance-cost-<leg>-<fromId>-<toId>` and `badge-jadedistance-min-<leg>-<fromId>-<toId>`.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx`, reusing the file's existing render helper and reference-distance mock:

```tsx
describe("ch9-tc — derived $/ton and Min? columns", () => {
  const rates = { icTransCost: 0.07, icMinTrans: 10, obTransCost: 0.12, obMinTrans: 10 };

  it("prices an inbound lane at rate × distance when the rate governs", () => {
    // 200 mi inbound at 0.07 = $14.00/ton (> the $10 min).
    renderJadeDistances({ transportCosts: rates, referencePairs: [
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 200 },
    ] });
    expect(screen.getByTestId("cell-jadedistance-cost-plant_to_warehouse-plant-1-wh-11"))
      .toHaveTextContent("14.00");
    expect(screen.queryByTestId("badge-jadedistance-min-plant_to_warehouse-plant-1-wh-11"))
      .not.toBeInTheDocument();
  });

  it("marks a lane where the minimum charge governs", () => {
    // 10 mi outbound at 0.12 = $1.20 < the $10 min.
    renderJadeDistances({ transportCosts: rates, referencePairs: [
      { leg: "warehouse_to_customer", fromId: "wh-11", toId: "customer-1", distance: 10 },
    ] });
    expect(screen.getByTestId("cell-jadedistance-cost-warehouse_to_customer-wh-11-customer-1"))
      .toHaveTextContent("10.00");
    expect(screen.getByTestId("badge-jadedistance-min-warehouse_to_customer-wh-11-customer-1"))
      .toBeInTheDocument();
  });

  it("prices from the OVERRIDE distance, not the base, when one is set", () => {
    renderJadeDistances({
      transportCosts: rates,
      referencePairs: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 200 }],
      distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 400 }],
    });
    expect(screen.getByTestId("cell-jadedistance-cost-plant_to_warehouse-plant-1-wh-11"))
      .toHaveTextContent("28.00");
  });

  it("re-prices immediately when the rates prop changes, with no re-solve", () => {
    const { rerender } = renderJadeDistances({ transportCosts: rates, referencePairs: [
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 200 },
    ] });
    rerenderJadeDistances(rerender, { transportCosts: { ...rates, icTransCost: 0.14 }, referencePairs: [
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 200 },
    ] });
    expect(screen.getByTestId("cell-jadedistance-cost-plant_to_warehouse-plant-1-wh-11"))
      .toHaveTextContent("28.00");
  });

  it("does not convert the $/ton value when the display unit flips", () => {
    window.localStorage.setItem("nos:display-unit-pref", "km");
    renderJadeDistances({ transportCosts: rates, referencePairs: [
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 200 },
    ] });
    // The distance column reads 321.9 km; the COST is a dollar amount per
    // ton and carries no distance unit, so it stays 14.00.
    expect(screen.getByTestId("cell-jadedistance-cost-plant_to_warehouse-plant-1-wh-11"))
      .toHaveTextContent("14.00");
  });

  it("shows a dash when a row has no distance at all", () => {
    // An override-only row whose base is null and whose override was just
    // cleared has no effective distance — price nothing rather than
    // pricing the 9999 sentinel, which is solve.py's internal fallback and
    // not something to surface as a real lane cost.
    renderJadeDistances({
      transportCosts: rates,
      referencePairs: [],
      distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-9", toId: "wh-99", distance: undefined as unknown as number }],
    });
    expect(screen.getByTestId("cell-jadedistance-cost-plant_to_warehouse-plant-9-wh-99"))
      .toHaveTextContent("—");
  });
});
```

Adapt the helper names/shapes to the file's existing ones. If it has no `rerenderJadeDistances`, re-render through RTL's own `rerender` with the full element.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio test -- JadeDistancesTab
```

Expected: FAIL — no `cell-jadedistance-cost-*` testid exists.

- [ ] **Step 3: Add the prop and the two columns**

In `JadeDistancesTab.tsx`, add the import and the prop:

```ts
import { laneCostPerTon, minChargeBinds, TEXTBOOK_TRANSPORT_COSTS, type TransportCosts } from "@/lib/transportCosts";
```

```ts
  /** ch9-tc — the scenario's EFFECTIVE transportation rates, used only to
   *  DERIVE the $/ton and Min? columns. Never stored per lane and never
   *  editable here — the Transportation Costs tab owns the four values, and
   *  these columns recompute from the same live draft, so they cannot
   *  drift. Defaults to the textbook values for a caller that omits it. */
  transportCosts?: TransportCosts;
```

Destructure with `transportCosts = TEXTBOOK_TRANSPORT_COSTS,` in the component signature. Add the header cells after `Override`:

```tsx
                <TableHead>{unitSuffix("Override")}</TableHead>
                <TableHead>$/ton</TableHead>
                <TableHead>Min?</TableHead>
                <TableHead />
```

Add a derivation helper next to `LEG_LABEL`:

```ts
// ch9-tc — the lane's effective distance is the override when set, else the
// base; both are CANONICAL (miles for this model), which is also the rate's
// denominator, so the product is a plain $/ton with no distance unit.
function laneRates(leg: JadeLeg, tc: TransportCosts): { rate: number; min: number } {
  return leg === "plant_to_warehouse"
    ? { rate: tc.icTransCost, min: tc.icMinTrans }
    : { rate: tc.obTransCost, min: tc.obMinTrans };
}
```

And the two body cells, immediately after the Override `<TableCell>` closes:

```tsx
                    {(() => {
                      const effective = r.override?.distance ?? r.base;
                      const { rate, min } = laneRates(r.leg, transportCosts);
                      return (
                        <>
                          <TableCell
                            className="font-mono text-xs"
                            data-testid={`cell-jadedistance-cost-${r.leg}-${r.fromId}-${r.toId}`}
                          >
                            {effective == null ? "—" : laneCostPerTon(effective, rate, min).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {effective != null && minChargeBinds(effective, rate, min) && (
                              <span
                                className="text-[10px] text-slate-700 bg-slate-100 border border-slate-300 rounded px-1"
                                title="The minimum charge, not the rate, is what this lane pays"
                                data-testid={`badge-jadedistance-min-${r.leg}-${r.fromId}-${r.toId}`}
                              >
                                min
                              </span>
                            )}
                          </TableCell>
                        </>
                      );
                    })()}
```

Bump both `colSpan={6}` placeholders in this file to `colSpan={8}` (the empty-filter row, and any other full-width row) — a stale colSpan silently misaligns the table.

- [ ] **Step 4: Pass the rates from Workspace**

In the JADE `distances` render branch, add one prop:

```tsx
          excludedCustomerIds={excludedCustomerIdsFromInputs(localInputs)}
          transportCosts={transportCostsFromInputs(localInputs)}
          identityById={inputIdentityById}
```

Reading from `localInputs` (the live draft), not the saved snapshot, is what makes an unsaved rate edit re-price the columns immediately.

- [ ] **Step 5: Run to verify they pass**

```bash
pnpm --filter studio test -- JadeDistancesTab Workspace && pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/JadeDistancesTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/JadeDistancesTab.test.tsx
git commit -m "[ch9-tc-8] derive per-lane \$/ton and a min-charge marker on the JADE Distances tab

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Solved-at rates in the cost summary and Compare (point 12)

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` (single-scenario rows near `:347`, Compare rows near `:460-475`)
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`

**Interfaces:**
- Consumes: Task 2's generated `SolveResult["metrics"]["transportRates"]`, Task 6's `TEXTBOOK_TRANSPORT_COSTS`/`rateConversion`/`rateUnitLabel`.
- Produces: single-scenario row testids `cost-summary-rate-ic`, `cost-summary-rate-ob`, `cost-summary-min-ic`, `cost-summary-min-ob`; Compare cell testids `cost-summary-compare-rate-ic-<scenarioId>`, `cost-summary-compare-min-ic-<scenarioId>`, `cost-summary-compare-rate-ob-<scenarioId>`, and `cost-summary-compare-min-ob-<scenarioId>`; legacy label text `textbook default (legacy result)`.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, reusing its existing render helper and result fixtures:

```tsx
describe("ch9-tc — solved-at transportation rates", () => {
  const rates = { icTransCost: 0.09, icMinTrans: 10, obTransCost: 0.12, obMinTrans: 0 };

  it("shows the rates the result was solved at, in the active display unit", () => {
    renderCostSummary({ modelId: "two-echelon-jade-us", result: jadeResult({ transportRates: rates }) });
    expect(screen.getByTestId("cost-summary-rate-ic")).toHaveTextContent("0.09");
    expect(screen.getByTestId("cost-summary-min-ob")).toHaveTextContent("0");
  });

  it("converts rates reciprocally in km mode and leaves minimum charges alone", () => {
    window.localStorage.setItem("nos:display-unit-pref", "km");
    renderCostSummary({ modelId: "two-echelon-jade-us", result: jadeResult({ transportRates: { ...rates, icTransCost: 0.07 } }) });
    expect(screen.getByTestId("cost-summary-rate-ic")).toHaveTextContent("0.0435");
    expect(screen.getByTestId("cost-summary-rate-ic")).not.toHaveTextContent("0.1127");
    expect(screen.getByTestId("cost-summary-min-ic")).toHaveTextContent("10");
  });

  it("falls back to the textbook values, labelled, for a legacy JADE result", () => {
    renderCostSummary({ modelId: "two-echelon-jade-us", result: jadeResult({}) /* no transportRates */ });
    expect(screen.getByTestId("cost-summary-rate-ic")).toHaveTextContent("0.07");
    expect(screen.getByTestId("cost-summary-rate-ic")).toHaveTextContent("textbook default (legacy result)");
  });

  it("renders no rate rows at all for a non-JADE model", () => {
    renderCostSummary({ modelId: "p-median-us", result: pmedianResult() });
    expect(screen.queryByTestId("cost-summary-rate-ic")).not.toBeInTheDocument();
  });

  it("gives each Compare column its OWN result's rates", () => {
    renderCostSummaryCompare({
      modelId: "two-echelon-jade-us",
      scenarios: [
        { id: 1, result: jadeResult({ transportRates: { ...rates, icTransCost: 0.07 } }) },
        { id: 2, result: jadeResult({ transportRates: { ...rates, icTransCost: 0.09 } }) },
      ],
    });
    expect(screen.getByTestId("cost-summary-compare-rate-ic-1")).toHaveTextContent("0.07");
    expect(screen.getByTestId("cost-summary-compare-rate-ic-2")).toHaveTextContent("0.09");
  });

  it("shows a Compare delta caused only by minimum charges", () => {
    renderCostSummaryCompare({
      modelId: "two-echelon-jade-us",
      scenarios: [
        { id: 1, result: jadeResult({ transportRates: { ...rates, icMinTrans: 10, obMinTrans: 10 } }) },
        { id: 2, result: jadeResult({ transportRates: { ...rates, icMinTrans: 25, obMinTrans: 0 } }) },
      ],
    });
    expect(screen.getByTestId("cost-summary-compare-min-ic-1")).toHaveTextContent("10");
    expect(screen.getByTestId("cost-summary-compare-min-ic-2")).toHaveTextContent("25");
    expect(screen.getByTestId("cost-summary-compare-min-ob-1")).toHaveTextContent("10");
    expect(screen.getByTestId("cost-summary-compare-min-ob-2")).toHaveTextContent("0");
  });

  it("labels a legacy column's fallback instead of showing a bare dash", () => {
    renderCostSummaryCompare({
      modelId: "two-echelon-jade-us",
      scenarios: [
        { id: 1, result: jadeResult({}) },
        { id: 2, result: jadeResult({ transportRates: { ...rates, icTransCost: 0.09 } }) },
      ],
    });
    expect(screen.getByTestId("cost-summary-compare-rate-ic-1")).toHaveTextContent("textbook default (legacy result)");
    expect(screen.getByTestId("cost-summary-compare-min-ic-1")).toHaveTextContent("textbook default (legacy result)");
    expect(screen.getByTestId("cost-summary-compare-min-ob-1")).toHaveTextContent("textbook default (legacy result)");
    expect(screen.getByTestId("cost-summary-compare-rate-ic-2")).toHaveTextContent("0.09");
  });

  it("shows the rows for an all-legacy JADE selection (modelId gating, not presence gating)", () => {
    renderCostSummaryCompare({
      modelId: "two-echelon-jade-us",
      scenarios: [{ id: 1, result: jadeResult({}) }, { id: 2, result: jadeResult({}) }],
    });
    expect(screen.getByTestId("cost-summary-compare-rate-ic-1")).toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-min-ic-1")).toBeInTheDocument();
  });

  it("does not invent a rate unit while the canonical manifest unit is unresolved", () => {
    renderCostSummary({
      modelId: "two-echelon-jade-us",
      canonicalDistanceUnit: null,
      result: jadeResult({ transportRates: rates }),
    });
    expect(screen.queryByText(/\$\/ton-mi|\$\/ton-km/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter studio test -- CostSummaryTab
```

Expected: FAIL — no `cost-summary-rate-ic` testid.

- [ ] **Step 3: Implement**

In `CostSummaryTab.tsx`, add the imports and two local helpers next to the file's other `format*` choke-point functions:

```ts
import { TEXTBOOK_TRANSPORT_COSTS, rateConversion, rateUnitLabel, type TransportCosts } from "@/lib/transportCosts";
```

```ts
// ch9-tc — the four rates a result was SOLVED AT (spec §2.5/§5.3). Read
// from the result envelope, never from the scenario's live `inputs`: for a
// stale scenario the inputs no longer match what the cached result was
// solved at, and the display would lie.
//
// Gated on `modelId`, deliberately NOT on presence — presence-only gating
// cannot render a fallback when EVERY selected envelope is a legacy one.
const JADE_MODEL_ID = "two-echelon-jade-us";

interface SolvedAtRates {
  rates: TransportCosts;
  legacy: boolean;
}

function solvedAtRates(result: { metrics?: { transportRates?: TransportCosts } } | null | undefined): SolvedAtRates {
  const stored = result?.metrics?.transportRates;
  return stored == null
    ? { rates: TEXTBOOK_TRANSPORT_COSTS, legacy: true }
    : { rates: stored, legacy: false };
}

const LEGACY_LABEL = "textbook default (legacy result)";

/** A rate renders in the active display unit (reciprocal conversion); a
 *  minimum charge is $/ton and never converts. */
function formatRate(rate: number, canonical: CanonicalUnit | null | undefined, unit: UnitApi): string {
  if (canonical == null) return "—";
  return rateConversion(unit).toDisplay(rate, canonical).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
```

Single-scenario view — push four rows after the existing `Outbound cost` row, gated on `modelId === JADE_MODEL_ID`:

```tsx
    if (modelId === JADE_MODEL_ID) {
      const { rates, legacy } = solvedAtRates(result);
      const suffix = legacy ? ` ${LEGACY_LABEL}` : "";
      const rl = rateUnitLabel(canonicalDistanceUnit, unit);
      rows.push(
        [`Inbound rate${rl ? ` (${rl})` : ""}`, `${formatRate(rates.icTransCost, canonicalDistanceUnit, unit)}${suffix}`, true, "cost-summary-rate-ic"],
        [`Inbound min ($/ton)`, `${rates.icMinTrans.toLocaleString()}${suffix}`, true, "cost-summary-min-ic"],
        [`Outbound rate${rl ? ` (${rl})` : ""}`, `${formatRate(rates.obTransCost, canonicalDistanceUnit, unit)}${suffix}`, true, "cost-summary-rate-ob"],
        [`Outbound min ($/ton)`, `${rates.obMinTrans.toLocaleString()}${suffix}`, true, "cost-summary-min-ob"],
      );
    }
```

**The row renderer must gain an explicit testid slot — this is not optional, and the review did not
catch it.** Measured: the single-scenario table renders rows generically and derives each testid from
the label (`CostSummaryTab.tsx:405`):

```tsx
data-testid={`cost-summary-value-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
```

With the review's unit-aware labels that yields `cost-summary-value-inbound-rate-ton-mi-` in miles and
`...-ton-km-` in km — a testid that **changes with the display toggle**, and that is not the
`cost-summary-rate-ic` id every test in this task and Task 10 expects. Change the tuple to
`[label, value, mono, testId?]` and render:

```tsx
{rows.map(([label, value, mono, testId]) => (
  <tr key={label}>
    <td className="p-2 text-muted-foreground">{label}</td>
    <td
      className={`p-2${mono ? " font-mono" : ""}`}
      data-testid={testId ?? `cost-summary-value-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      {value}
    </td>
  </tr>
))}
```

The `??` fallback is mandatory, not tidiness: **45 existing references** to `cost-summary-value-*`
ids live across `artifacts/studio/src/__tests__` and `artifacts/studio/e2e` (`objective`,
`inbound-cost`, `outbound-cost`, `quality`, `weighted-avg-distance`). Omitting the fallback renames
all of them at once. Pass the four explicit ids (`cost-summary-rate-ic`, `cost-summary-min-ic`,
`cost-summary-rate-ob`, `cost-summary-min-ob`) only for the new rows. The declaration at
`CostSummaryTab.tsx:346` widens with it: `const rows: Array<[string, string, boolean, string?]>`.

Compare view — add after the existing `Outbound cost` compare row:

```tsx
            {modelId === JADE_MODEL_ID && (
              <>
                <tr>
                  <td className="p-2 text-muted-foreground">
                    Inbound rate{rateUnitLabel(canonicalDistanceUnit, unit) ? ` (${rateUnitLabel(canonicalDistanceUnit, unit)})` : ""}
                  </td>
                  {compareScenarios.map(s => {
                    const { rates, legacy } = solvedAtRates(s.result);
                    return (
                      <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-rate-ic-${s.id}`}>
                        {formatRate(rates.icTransCost, canonicalDistanceUnit, unit)}
                        {legacy && <span className="ml-1 text-[10px] font-sans text-muted-foreground">{LEGACY_LABEL}</span>}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="p-2 text-muted-foreground">Inbound min ($/ton)</td>
                  {compareScenarios.map(s => {
                    const { rates, legacy } = solvedAtRates(s.result);
                    return (
                      <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-min-ic-${s.id}`}>
                        {rates.icMinTrans.toLocaleString()}
                        {legacy && <span className="ml-1 text-[10px] font-sans text-muted-foreground">{LEGACY_LABEL}</span>}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="p-2 text-muted-foreground">
                    Outbound rate{rateUnitLabel(canonicalDistanceUnit, unit) ? ` (${rateUnitLabel(canonicalDistanceUnit, unit)})` : ""}
                  </td>
                  {compareScenarios.map(s => {
                    const { rates, legacy } = solvedAtRates(s.result);
                    return (
                      <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-rate-ob-${s.id}`}>
                        {formatRate(rates.obTransCost, canonicalDistanceUnit, unit)}
                        {legacy && <span className="ml-1 text-[10px] font-sans text-muted-foreground">{LEGACY_LABEL}</span>}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="p-2 text-muted-foreground">Outbound min ($/ton)</td>
                  {compareScenarios.map(s => {
                    const { rates, legacy } = solvedAtRates(s.result);
                    return (
                      <td key={s.id} className="p-2 font-mono" data-testid={`cost-summary-compare-min-ob-${s.id}`}>
                        {rates.obMinTrans.toLocaleString()}
                        {legacy && <span className="ml-1 text-[10px] font-sans text-muted-foreground">{LEGACY_LABEL}</span>}
                      </td>
                    );
                  })}
                </tr>
              </>
            )}
```

All four values are required in Compare. In particular, do not collapse this to the two rates: a cost
delta can be caused entirely by minimum charges. If canonical distance units are unresolved, omit the
rate suffix (and let `formatRate` render its existing em dash) rather than guessing `$/ton-mi`.

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm --filter studio test -- CostSummaryTab && pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/__tests__/CostSummaryTab.test.tsx
git commit -m "[ch9-tc-9] show all four JADE transport values in summary and compare

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Playwright journey + sibling spec sweep

**Files:**
- Create: `artifacts/studio/e2e/jade-transport-costs.spec.ts`
- Modify: whatever the sweep in Step 1 finds under `artifacts/studio/e2e/`

**Interfaces:**
- Consumes: every testid produced by Tasks 6–9.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Sweep the sibling specs first**

```bash
cd artifacts/studio
grep -rn "colSpan\|jade-distances-tab\|cost-summary-compare-\|sidebar-input-" e2e/*.spec.ts | grep -i "jade\|cost-summary"
grep -rn "transport" e2e/*.spec.ts
```

Record what each hit asserts. This bundle changes: the JADE input tab set (one new entry), `JadeDistancesTab`'s column count (6 → 8), and `CostSummaryTab`'s JADE row set. Any spec that counts columns, counts rows, or indexes cells positionally in those tables must be rewritten **now**, before the new spec is written — this is the recurring `spec_gap` class, and the unit gate does not catch it (Playwright specs are not in `pnpm --filter studio test`).

- [ ] **Step 2: Start the local stack**

Two terminals (or background jobs), per CLAUDE.md's local e2e recipe:

```bash
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3001 pnpm --filter api-server run dev
PORT=5174 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev
```

- [ ] **Step 3: Write the spec**

Create `artifacts/studio/e2e/jade-transport-costs.spec.ts`:

```ts
/**
 * Browser E2E — Chapter 9 (JADE) editable transportation costs.
 *
 * Spec: docs/superpowers/specs/2026-10-02-ch9-transport-costs-design.md §6.
 * Plan: docs/superpowers/plans/2026-10-02-ch9-transport-costs.md Task 10.
 *
 * The journey the unit tests cannot cover: a real solve at the defaults, a
 * rate edit committed by BLUR, Save, the stale badge, a second solve, and a
 * Compare view where each column carries its own solved-at rates.
 *
 * Target: E2E_BASE_URL, requires the local dev proxy (CLAUDE.md's recipe).
 */
import { test, expect, type Page } from "@playwright/test";
import { skipIfJadeLocked } from "./helpers/modelLock";
import { readSolvedAt } from "./helpers/solvedAt";

test.use({ actionTimeout: 15_000 });
test.use({ viewport: { width: 1400, height: 1400 } });

const HEADER_TIMEOUT = 10_000;
const SOLVE_TIMEOUT = 90_000;

function jadeInputs() {
  return {
    p: 2,
    distanceBands: [200, 400, 800, 1600],
    gap: 0,
    timeLimitSec: 120,
    warehouseOverrides: [
      { id: "wh-11", status: "forced_open" },
      { id: "wh-14", status: "forced_open" },
    ],
  };
}

async function registerAndGoHome(page: Page, slug: string): Promise<void> {
  const email = `e2e-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const resp = await page.request.post("/api/auth/register", {
    data: { email, password: "correcthorse1" },
  });
  expect(resp.status()).toBe(201);
  await page.goto("/");
  await expect(page.getByTestId("text-user-email")).toBeVisible({ timeout: 8_000 });
}

async function createScenario(page: Page, name: string): Promise<number> {
  const resp = await page.request.post("/api/scenarios", {
    data: { name: `${name} ${Date.now()}`, modelId: "two-echelon-jade-us", inputs: jadeInputs() },
  });
  expect(resp.status()).toBe(201);
  return Number((await resp.json()).id);
}

async function solve(page: Page, id: number): Promise<void> {
  const before = await readSolvedAt(page, id);
  await page.getByTestId("button-run-optimizer").click();
  await expect(page.getByTestId("solve-dialog")).toBeVisible({ timeout: HEADER_TIMEOUT });
  await page.getByTestId("solve-dialog-solve").click();
  await expect
    .poll(() => readSolvedAt(page, id), { timeout: SOLVE_TIMEOUT, intervals: [500, 1000, 2000] })
    .not.toBe(before);
}

test.describe("Chapter 9 — editable transportation costs", () => {
  test("edit a rate, save, re-solve, and compare the two results' solved-at rates", async ({ page }) => {
    test.setTimeout(240_000);
    await registerAndGoHome(page, "ch9-tc");
    await skipIfJadeLocked(page);

    const baseline = await createScenario(page, "E2E TC baseline");
    await page.goto(`/chapter-9/jade?scenario=${baseline}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await solve(page, baseline);

    const objectiveAtDefaults = await page.getByTestId("cost-summary-value-objective").innerText()
      .catch(async () => {
        await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });
        return page.getByTestId("cost-summary-value-objective").innerText();
      });

    // The tab exists and seeds from the textbook values.
    await page.getByTestId("sidebar-input-transportCosts").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("transport-costs-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("input-transport-ic-rate")).toHaveValue("0.07");

    // Derived columns on the Distances tab, before any edit.
    await page.getByTestId("sidebar-input-distances").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("jade-distances-tab")).toBeVisible({ timeout: HEADER_TIMEOUT });

    // Edit the inbound rate and commit by BLUR (not Enter — Enter races any
    // dialog that steals focus; a blur onto a stable neighbour does not).
    await page.getByTestId("sidebar-input-transportCosts").click({ timeout: HEADER_TIMEOUT });
    await page.getByTestId("input-transport-ic-rate").fill("0.14");
    await page.getByTestId("input-transport-ob-rate").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("text-unsaved-changes")).toBeVisible({ timeout: HEADER_TIMEOUT });

    await page.getByTestId("button-save").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("stale-output-banner").or(page.getByTestId("chip-stale")).first())
      .toBeVisible({ timeout: HEADER_TIMEOUT });

    await solve(page, baseline);
    await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-rate-ic")).toContainText("0.14", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-min-ic")).toContainText("10", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-rate-ob")).toContainText("0.12", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-min-ob")).toContainText("10", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId("cost-summary-value-objective")).not.toHaveText(objectiveAtDefaults);

    // A second scenario at the defaults, then Compare.
    const sibling = await createScenario(page, "E2E TC sibling");
    await page.goto(`/chapter-9/jade?scenario=${sibling}`);
    await expect(page.getByTestId("workspace-page")).toBeVisible({ timeout: HEADER_TIMEOUT });
    await solve(page, sibling);
    await page.getByTestId("sidebar-output-cost-summary").click({ timeout: HEADER_TIMEOUT });
    await page.getByTestId(`cost-summary-compare-toggle-${baseline}`).locator("input").check({ timeout: HEADER_TIMEOUT });

    await expect(page.getByTestId(`cost-summary-compare-rate-ic-${baseline}`))
      .toContainText("0.14", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-rate-ic-${sibling}`))
      .toContainText("0.07", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-min-ic-${baseline}`))
      .toContainText("10", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-rate-ob-${baseline}`))
      .toContainText("0.12", { timeout: HEADER_TIMEOUT });
    await expect(page.getByTestId(`cost-summary-compare-min-ob-${baseline}`))
      .toContainText("10", { timeout: HEADER_TIMEOUT });
  });
});
```

These locators are verified against the current components: the objective value is
`cost-summary-value-objective`, and each Compare toggle wraps an actual checkbox input under
`cost-summary-compare-toggle-<id>`. Keep the `.locator("input").check()` form; clicking the wrapper is
not the established control contract.

- [ ] **Step 4: Run the new spec and the JADE siblings**

```bash
cd artifacts/studio
E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/jade-transport-costs.spec.ts e2e/jade-two-echelon.spec.ts e2e/jade-ch9-workspace-bundle.spec.ts
```

Expected: all green. A failure in a sibling is the `spec_gap` class — rewrite the sibling to the new UI, do not tag it `@flaky`.

- [ ] **Step 5: Commit**

```bash
git add artifacts/studio/e2e
git commit -m "[ch9-tc-10] e2e journey for editable JADE transport costs; update sibling specs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Full gate, changelog, retro

**Files:**
- Modify: `docs/CHANGELOG-implementation.md`

- [ ] **Step 1: Confirm no concurrent test runs**

```bash
ps aux | grep "[v]itest" | grep -v "zsh -c"
```

Expected: no rows. (Use this exact form — `grep -c "[v]itest"` also counts the agent's own `zsh -c` wrapper and can never reach 0.) If rows appear, another session is testing; wait rather than interpreting its contention as a regression.

- [ ] **Step 2: Run the full verification gate**

```bash
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && pnpm --filter studio typecheck:e2e \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```

Expected: all green. Known load-induced flakes to re-run in isolation before treating as regressions: api-server `cors`, `jobRunnerDispatcher`, `resultEnvelope`, `jobRunnerV2Cache`, `dispatcherRecovery` (the last lives at `src/solver/__tests__/`), and pytest `test_transport.py::TestSingleSource` (a hardcoded 60s subprocess timeout — re-run the class alone; a JADE-only change cannot affect transport).

- [ ] **Step 3: Run the two standalone scripts**

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
```

Expected: `99/99`. This is the hard-rule-2 gate and `python3 -m pytest tests/ -x` does not run it.

With the API running on `http://localhost:3001`:

```bash
cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py http://localhost:3001 all
```

Expected: green. Required because this bundle changes `solve.py`.

- [ ] **Step 4: Re-gate Playwright**

```bash
pnpm e2e:gate
```

Read `artifacts/studio/e2e/report/results.json` (`stats.unexpected` / `stats.flaky`) rather than the console tail — the terminal summary folds retried failures away and under-reports. Known load-sensitive specs: `workspace-fixups-2.spec.ts`, the `chen-bands-units-qa` case, `delivery-teaching.spec.ts`, `design-system`, `empty-first-run-workspace`, `input-map-v2`, `jade-ch9-workspace-bundle`. Re-run any reported failure in isolation before calling it a regression; if a new spec joins that class, add it to CLAUDE.md's Gotchas list in the same commit as this task.

- [ ] **Step 5: Write the changelog entry**

Append at the **bottom** of `docs/CHANGELOG-implementation.md` (most recent last), covering: the four editable rates and their all-or-nothing contract; the `10` / `10,000` pedagogical maxima; the separate cross-field finite-coefficient precheck and Python backstop (without claiming an unmeasured CBC reliability threshold); the `transportRates` echo on both executed JADE outcomes; the `useDistanceDraft` `convert` option (and that the spec's five-caller list was measured to be six files / ten call sites); the new tab and two derived columns; all four solved-at values in Compare; the gate numbers actually observed (`e2e_accuracy.py` count, suite totals, e2e unexpected/flaky counts — never an estimate; an underivable value is the literal string `unknown`); and the commit SHAs of Tasks 1–10.

Per hard rule 9 nothing from this entry is copied into `CLAUDE.md`. The one durable lesson worth lifting, if it survives review: *a rate is per unit distance, so it converts as the reciprocal of a distance — reusing `toDisplay`/`fromDisplay` directly on a rate makes freight change price when the display toggle flips.* That belongs in `## Gotchas` as one line, in this same commit.

- [ ] **Step 6: Commit**

```bash
git add docs/CHANGELOG-implementation.md CLAUDE.md
git commit -m "[ch9-tc-11] record the ch9 transport-costs bundle in the changelog

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Run the retro**

```
/harness-retro ch9-tc
```

A branch is not finished until this has run. It records the metrics row, logs each gate failure by cause, and fires the second-occurrence gate rule.

- [ ] **Step 8: STOP and ask for merge approval**

Do not merge. Per CLAUDE.md's branch discipline: all tasks done → **prompt the user** → merge to local `main` on approval → whole-branch review on the merged state → ask again before pushing (a push can ship `nos-studio`) → deploy is a third, separate approval.

---

## Implementation review close-out (commit `254ab0e`)

This section records the second implementation-plan review. Its corrections are requirements, not
optional reviewer suggestions; where an earlier task step conflicts with a row below, this section and
the amended step win.

| Severity | Finding | Required close-out | Proof |
|---|---|---|---|
| P1 | Rate/minimum maxima alone do not guarantee finite objective coefficients. Existing base-demand overrides, added-customer demands, and distance overrides accept arbitrarily large finite values. The prior arithmetic also understated maximum customer-product demand (`32,007.5`, not ~`22,000`), the largest measured real-lane coefficient at rate 10 (`929,682,163.2`), the conservative `9999` coefficient (~`3.20e9`), and the max minimum-charge coefficient (~`3.20e8`). | Keep `10` / `10,000` as product limits, remove all unsupported “CBC reliable range” claims, add `coefficient_range` to JADE semantic precheck before enqueue, and repeat `math.isfinite` checks in Python before PuLP objective construction. A hard finite magnitude ceiling requires a separate empirical CBC spike. | Huge finite distance/demand tests return 422 before worker dispatch; direct solver test proves `_run_cbc` is not called; baseline/maxima tests stay finite. |
| P1 | Compare rendered only rates, contradicting the four-value solved-at contract and hiding deltas caused only by minimum charges. | Render inbound/outbound minimum rows as well as rate rows, with stable per-scenario testids and legacy labels. | RTL minimum-only-difference test plus Playwright assertions for all four values. |
| P1 | Task 5's test used a nonexistent two-argument `renderDraft` helper and a converter hardcoded to km, so the planned dirty-toggle test could not exercise a live preference change. | Build the reciprocal converter inside `renderHook` from the current `UnitApi`; toggle with `result.current.unit.setPref`. | Tests cover clean render, commit, complete dirty reprojection, incomplete dirty discard, and omitted-converter compatibility. |
| P2 | Cost Summary guessed `$/ton-mi` while the canonical unit was unresolved. | Never use a fallback unit label. Omit the suffix or withhold the affected rate value until the manifest unit resolves. | Unresolved-canonical-unit RTL test contains neither `$/ton-mi` nor `$/ton-km`. |
| P2 | Live km validation compared the displayed number with the canonical maximum (`10`), allowing displayed values above the real km limit until blur. | Derive `displayMax = convert.toDisplay(max, canonicalUnit)` (rounded with the same field precision) for live validation; retain canonical validation on commit. Clear a prior rejection when `resetKey` or stored `value` changes. | km tests at `6.2137` (accepted) and `6.2138` (rejected) for canonical max `10` $/ton-mi; scenario reset clears stale errors. |
| P2 | Textbook-default parity checked only `JADE_IC_RATE` and `JADE_OB_RATE` with brittle source substrings. | Parse all four Python constants numerically and compare the object to `TEXTBOOK_TRANSPORT_COSTS`. | Test covers both rate and both minimum constants while treating `10` and `10.0` equivalently. |
| P2 | Final gate omitted TypeScript checking for Playwright sources. | Add `pnpm --filter studio typecheck:e2e` to both the standing and final gates. | Command passes before `pnpm e2e:gate`. |
| P3 | Task 4 said both hashes should initially be equal, but v1/v2 already hash canonical inputs after Task 3. | Treat hash tests as regression locks; only payload/write-path assertions are expected red before Task 4. | Both hash assertions pass before and after payload passthrough. |
| P3 | Task 10 guessed locators and contained trailing whitespace. | Use verified `cost-summary-value-objective` and the checkbox input inside `cost-summary-compare-toggle-<id>`; keep the document whitespace-clean. | Focused Playwright case passes; `git diff --check` and `git show --check` report no errors. |

### Author's disposition of the review (all findings verified against the code, not accepted on sight)

Every finding above was checked before folding. All nine are **accepted**; four needed a correction
or an extension, recorded here rather than silently absorbed.

| Finding | Verification run | Disposition |
|---|---|---|
| P1 coefficient arithmetic | Measured the dataset directly: 100 customers, total demand **1,545,308**, max customer total **86,877.5**, **max single customer-product cell 32,007.5**, 2600 lanes, max lane **3,219.9609 mi**. | **Confirmed — the spec's §3.1 table is wrong in all three rows.** The old "~22,000 tons per customer-product" was an average (86,877.5 / 4), not a maximum. Corrected figures: `9999`-sentinel coefficient at rate 10 = **3,200,429,925** (spec said 2.2e9); max minimum-charge coefficient = **320,075,000** (spec said 2.2e8). For the real-lane figure the review quotes `929,682,163.2` (max over actual serving-lane × customer-product pairs); the decoupled upper bound `max distance × max cell × 10` measures **1,030,628,985**. Both are ~1e9 against the spec's 7.1e8. Record whichever is recomputed at execution time, with its definition — do not quote one as the other. |
| P1 precheck dependency | `jobRunner.ts:410` runs `runNetworkEditsPrecheckForModel` inside the locked enqueue transaction; `routes/scenarios.ts:557-559` maps `precheck_failed` → 422. `openapi.yaml:1804` already lists `p_range`/`capacity`. `getReferenceDistances` at `data/referenceDistances.ts:187`, JADE registered `:182`. | **Accepted, with two corrections.** (1) `precheck.ts:49-58`'s "NOT YET reflected in openapi.yaml" comment is stale — the enum append is one member, not a catch-up. (2) **The hazard is pre-existing**: `distanceOverrides[].distance` and the demand numbers are `z.number().nonnegative()` with **no `.finite()`**, so `Infinity` parses today and `0.12 × 1e308` already overflows with no `transportCosts` at all. Task 3 therefore also adds `.finite()` at the shape layer and must prove the guard fires with `transportCosts` **absent**. A guard that only triggers on custom rates would be covering the wrong thing. |
| P1 Compare shows only rates | Read `CostSummaryTab.tsx:440-480`. | **Accepted without qualification.** My "the two rate rows are what explain a delta" was wrong: a delta caused purely by minimum charges would render with no visible cause. |
| P1 Task 5 harness fiction | Read `useDistanceDraft.test.ts:20-28`. | **Confirmed.** `renderDraft` takes ONE argument and the real toggle is `result.current.unit.setPref` — my two-argument `{ pref }` form never existed. |
| P2 unresolved unit fallback | `CostSummaryTab.tsx:20-44` — every formatter already returns `—` rather than guessing. | **Accepted.** My `?? "$/ton-mi"` violated the file's own no-fallback-unit rule. |
| P2 live km bound | `roundForFile(10 / 1.609344) = 6.2137`. | **Accepted.** Checking a km-displayed number against the canonical `10` let `6.2138`–`10` look valid until blur. |
| P2 textbook parity substrings | — | **Accepted.** `10` vs `10.0` is a real false-negative, and only two of four constants were covered. |
| P2 missing `typecheck:e2e` | `artifacts/studio/package.json` → `"typecheck:e2e": "tsc -p tsconfig.e2e.json --noEmit"`. | **Accepted** — the script exists and the gate never ran it. |
| P3 Task 4 expected-red | `jobRunner.ts:228-262` — both hashes digest `canonicalJson(input.inputs)`. | **Accepted.** The hash tests pass as soon as Task 3 lands; they are regression locks, not Task 4 evidence. |
| P3 Task 10 locators | `CostSummaryTab.tsx:405` (`cost-summary-value-*`), `:299-300` (`<label data-testid="cost-summary-compare-toggle-…"><input type="checkbox">`). | **Accepted** — both verified; `.locator("input").check()` is the right form. |

### Self-review of the sections the review did not cover (Tasks 6 tail, 7, 8, 10 sweep)

Same standard applied to the untouched half of the plan. Four defects found, all folded above.

| # | Defect | Evidence | Fix landed in |
|---|---|---|---|
| SR-1 | Task 9's new row testids **would not exist**, and the plan made the fix conditional ("if the table renders rows generically"). It does: `CostSummaryTab.tsx:405` derives the testid from the label, so unit-aware labels produce `cost-summary-value-inbound-rate-ton-mi-` and that id **changes when the display toggle flips**. | Read `:399-410`; `grep -rn "cost-summary-value-"` over tests + e2e returns **45** references. | Task 9 — explicit 4th tuple element with a **mandatory** `??` fallback so all 45 existing ids are byte-identical. |
| SR-2 | The tab's own "km → mi → km" test — the single most important test in the spec — only remounted the component with a different seeded preference. A remount re-derives the field from the stored value, so it proves nothing about draft reprojection; the test would pass against a component that discarded state on every toggle. | Compared against `useDistanceDraft.test.ts`'s real mechanism (`unit.setPref` on a mounted tree). | Task 6 — a `PrefSetter` sibling inside the same `UnitProvider`; the round-trip, dirty-reprojection and incomplete-discard tests now toggle live. |
| SR-3 | Nothing pinned `defaultInputsForModel("two-echelon-jade-us")` as **not** carrying `transportCosts`. Seeding the four defaults there would silently make every new scenario "custom", destroying the absence-means-textbook property the reset semantics and cache identity both rest on — with no other test noticing. | `Workspace.tsx:143` + the JADE case; no existing assertion. | Task 4. |
| SR-4 | `autoDistance.ts:462` re-parses the whole inputs object through `jadeInputsSchema` after normalizing `distanceOverrides`. That is the same Zod-strips-the-key class as registration point 2, on a second code path, and was untested. | Read `services/autoDistance.ts:381,462`. | Task 4. |

Three further checks came back **clean** and are recorded so a later session does not redo them:
`WorkspaceTab.entity` is `string`, not a closed union (`lib/workspaceTabs.ts:12`), so a new entity id
needs no type change; `SidebarTree` renders input entries generically with no per-entity map; and the
export surface is per-tab (each tab renders its own control) rather than centrally dispatched on
entity, so a tab with no export wiring adds nothing to `ExportEntity` and cannot break the toolbar —
the derived `$/ton`/`Min?` columns are deliberately **not** in the distances CSV, consistent with §7.

**Documentation dependency:** the source design spec still contains the superseded coefficient-range
arithmetic/claim and describes only its original 12 registration points. This plan intentionally does
not modify that file after the user's direction to keep this pass in the implementation document.
Do not call the documentation set fully reconciled until a separately approved spec update records
the coefficient precheck and corrected arithmetic; implementation may follow this plan's explicit
review amendments in the meantime.

### Dependency trace and completion strategy

Trace every field in both directions. A checkbox is complete only when the adjacent evidence exists:

| Dependency seam | What to trace | Failure signature |
|---|---|---|
| Input declaration | manifest JSON Schema ↔ `jadeInputsSchema` ↔ UI constants/field maxima | accepted by one layer, rejected or silently stripped by another |
| Persistence | create ↔ PATCH ↔ GET ↔ reset-by-omission ↔ clone | values disappear, defaults are materialized, or partial objects survive |
| Pre-dispatch semantics | effective base/added/override distances and demands → `precheckJadeInputs` → solve/enqueue 422 | individually finite values multiply to infinity and still enqueue |
| Payload | canonical scenario inputs → JADE `buildPayload` branch | solve succeeds using textbook defaults despite custom inputs |
| Cache identity | v1 and v2 hashes with inputs differing only in one transport field | stale result reused across different costs |
| Solver | payload → effective rate/min values → both cost closures → objective → infeasible/success envelopes | one leg/minimum ignored, non-finite term reaches PuLP, or echo absent on one return |
| Result contract | Python `metrics.transportRates` → server `MetricsSchema` → OpenAPI → generated clients | Zod strips the echo or UI types omit it |
| UI live values | Workspace input reader → tab edit/reset/history guard → `JadeDistancesTab` derived values | stale/hardcoded costs, write while browsing history, or reset writes literals |
| UI solved values | stored result (not live inputs) → single summary → four Compare rows → legacy fallback | stale result labelled with current inputs or minimum-only delta unexplained |
| Units | manifest canonical unit → live `UnitApi` → reciprocal rate converter → labels/live max | multiplicative rate conversion, guessed unit, or km bound mismatch |
| Regression surface | changed testids/row/column counts → sibling RTL/Playwright specs | feature test passes while an older bundle fails |

Run these discovery checks before coding and repeat them before close-out; unexpected new hits are
dependencies to inspect, not noise to ignore:

```bash
rg -n "transportCosts|transportRates|coefficient_range" \
  solvers artifacts/api-server lib/api-spec artifacts/studio/src artifacts/studio/e2e
rg -n "useDistanceDraft\(" artifacts/studio/src
rg -n "cost-summary-value-objective|cost-summary-compare-|jade-distances-tab|sidebar-input-" \
  artifacts/studio/src artifacts/studio/e2e
rg -n "computeInputsHash|computeInputsHashV2|runNetworkEditsPrecheckForModel|buildPayload" \
  artifacts/api-server/src
```

Close in this order so a downstream green test cannot mask an upstream omission:

1. Land schema/precheck and result-contract changes; run codegen twice and prove the second pass is
   idempotent.
2. Prove persistence, pre-dispatch rejection, payload passthrough and both cache hashes at API level.
3. Prove Python arithmetic/back-compat, including “CBC not called” on non-finite derived terms and
   `99/99` on the sacred accuracy script.
4. Prove hook/unit behavior, then tab/Workspace, then derived distance columns and Cost Summary.
5. Sweep sibling E2E specs, run Playwright TS typecheck, focused browser cases, the full gates, and
   standalone journeys.
6. Inspect generated and documentation diffs, then run whitespace/commit-integrity checks:

```bash
pnpm --filter @workspace/api-spec run codegen
git diff --exit-code -- lib/api-zod lib/api-client-react
pnpm --filter studio typecheck:e2e
git diff --check
git status --short
# After the implementation commits exist:
git show --check --stat HEAD
```

The codegen diff command assumes the intended first-pass generated files were staged as directed in
Task 2; it then proves a second generation pass is clean relative to the index.

---

## Definition of Done (spec §8)

- [ ] All 12 integration points of spec §3.2 plus the implementation-review coefficient-safety dependency landed; OpenAPI/codegen changes (`SolveMetrics.transportRates` and `PrecheckError.code`) committed together.
- [ ] Manifest, Zod and UI maxima pinned equal at rate `10` / minimum charge `10,000` — by `jadeTransportCosts.test.ts` (server leg) and `transportCostsBounds.test.ts` (UI leg).
- [ ] Huge finite overrides are rejected with `coefficient_range` before dispatch, and the Python backstop proves CBC is not called for a non-finite derived coefficient.
- [ ] `e2e_accuracy.py` passes 99/99 unmodified.
- [ ] Full verification gate green: `pnpm run typecheck`, api-server vitest, studio vitest, `pnpm --filter studio typecheck:e2e`, solver pytest.
- [ ] `pnpm e2e:gate` green, with any JADE sibling specs rewritten.
- [ ] `e2e_journey.py <BASE_URL> all` green against the running API.
- [ ] A scenario with no `transportCosts` solves to the same objective it did before the change.
- [ ] Unit-toggle round-trip leaves a stored rate bit-identical.
- [ ] Dirty-draft toggle, semantic-no-op commit, display-space km bounds, scenario-switch reset/error clearing and history-read-only tests green.
- [ ] PATCH persistence/reset/clone, cache-key separation, legacy-result validation, four-row Compare (including minimum-only differences) and infeasible result-rate echo tests green.
- [ ] `.finite()` added to JADE's existing distance/demand fields, and the coefficient guard proven to fire with `transportCosts` **absent** as well as present.
- [ ] `defaultInputsForModel("two-echelon-jade-us")` pinned to carry no `transportCosts` key, and `applyAutoDistances` pinned not to drop it.
- [ ] The Cost Summary row renderer takes an explicit testid with a label-derived fallback; all 45 existing `cost-summary-value-*` references still resolve.
- [ ] Codegen is idempotent; dependency `rg` sweep has no unexplained hits; `git diff --check` is clean.
- [ ] Changelog entry in `docs/CHANGELOG-implementation.md` in the same commit as the work.
- [ ] `/harness-retro ch9-tc` run.

---

## Out of scope (spec §7)

Per-lane rate overrides; per-product rates; CSV export/import of the rates (`CostSummaryExportRow` is **not** extended); other models (`two-echelon-gold-au`'s `laneCosts` and `delivery-teaching-us`'s `deliveryCosts` are not refactored toward a shared abstraction); the `dist.get(..., 9999)` sentinel; rates as dataset files (no new JSON under `solvers/two-echelon-jade-us/dataset/`, so `version.json`/sha256 and `PACKAGE_SPECS` stay untouched).
