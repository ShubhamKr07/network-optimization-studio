# Super Model — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo, dispatch follows `AGENTS.md` (agent-team roles; pre-created locked worktree per task, never `isolation: "worktree"`), and every engineering role runs `karpathy-guidelines` + `ponytail` before writing code (CLAUDE.md hard rule #12).

**Goal:** Ship `super-model` — an 8th, import-driven, multi-product two-echelon model with a plant-product capacity + cost table, a demand table, computed distances, JSON network import/export, and a 7-line cost summary — without changing Ch9's results.

**Architecture:** Extract `solve_jade`'s model body into a shared core in `solve.py` with one new objective term (plant cost × flow; Ch9 passes an empty cost map). A new `solve_super` builds the network from scenario `inputs` (haversine / haversine×circuity, overrides win). The API stores the whole network in `scenarios.inputs`, validated by one Zod schema (`superInputs.ts`) whose `superRefine` enforces IDs/references/caps on every write path; a new network import/export endpoint pair wraps the existing `applyScenarioInputWrite`. Studio gets data-table tabs driven off `localInputs`, a network import dialog, and summary rows.

**Tech Stack:** Python 3 + PuLP/CBC (pytest), TypeScript Express 5 + Drizzle + Zod (vitest + supertest, real Postgres), OpenAPI + Orval, React + Vite (vitest + RTL), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-super-model-design.md` (branch `super-model-spec`). Phases 2 (multi-CSV + XLSX) and 3 (OpenRouteService) get their own plans.

## Global Constraints

- Model id `super-model`; wire `modelType` `super_model`; Studio path `/super-model`; chapter label `Super Model`.
- Distances in miles; haversine Earth radius `3959` mi (same as `autoDistance.ts:41`).
- `distanceMethod` in Phase 1: `"haversine" | "circuity"` only (`"road"` is added in Phase 3). `circuityFactor` ∈ [1, 3], default `1.17`.
- Warehouse status `active | forced_open | inactive`; customer status `active | excluded`.
- Size caps (D1): products ≤ 10, plants ≤ 20, warehouses ≤ 50, customers ≤ 500, warehouses × customers × products ≤ 50,000 (SM-2's timed run found 100,000 returned no solution in 120 s and halved it; see spec §3.3). Task 2 confirmed them by a timed run; if timing forces a change, update the constants in `superInputs.ts` and the spec in the same task.
- Big-M (D2): `M = |customers| × |products|` for both models.
- Row delete (D3): cascade after a confirmation stating the referencing-row count.
- `transportCosts` defaults: `{ icTransCost: 0.07, icMinTrans: 10, obTransCost: 0.12, obMinTrans: 10 }` (reuse `JADE_TEXTBOOK_TRANSPORT_COSTS`).
- Ch9 golden: objective `254060828.6157` (rel. 1e-6), open `{wh-11, wh-14}`; `e2e_accuracy.py` stays unmodified and 99/99.
- Hard rules: never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` (#1); ownership filter + 404 on every scenario route (#5); solver business rules as data, not `if/else` branches in `solve.py` (#6); one task = one commit, `[SM-<n>] <imperative>` (#4); every commit on its own branch, never `main`.
- Verification gate for every task: `pnpm gate` (exit 3 = timeout, re-run serially; exit 1 = real failure) plus, for solver tasks, `cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py`. Before trusting a vitest run, `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]`.
- DB-backed tests: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline per command.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `artifacts/api-server/src/solver/solve.py` | modify | `_solve_two_echelon_core` (shared), `solve_jade` → thin wrapper, `solve_super`, dispatcher branch |
| `artifacts/api-server/src/solver/merge_inputs.py` | modify | `haversine_mi`, `build_super_dataset` |
| `artifacts/api-server/src/solver/tests/test_super.py` | create | core + super solver tests, sample golden |
| `artifacts/api-server/src/solver/tests/test_jade.py` | modify | plant-cost-zero / big-M regression assertions |
| `scripts/build-super-sample.py` | create | generate sample network from the Ch9 dataset |
| `scripts/super-model-timing.py` | create | timed CBC run at the caps |
| `artifacts/studio/public/samples/super-model-sample.json` | create (generated) | downloadable sample + pytest golden fixture |
| `artifacts/studio/public/samples/super-model-template.json` | create | blank JSON template |
| `solvers/super-model/manifest.json`, `solvers/super-model/dataset/{plants,warehouses,customers,products}.json`, `dataset/version.json` | create | empty dataset package |
| `lib/dataset-schema/src/index.ts` | modify | `PACKAGE_SPECS`, `MODEL_IDS` |
| `artifacts/api-server/src/validation/inputs/superInputs.ts` | create | Zod schema, caps, `superRefine` integrity |
| `artifacts/api-server/src/registry/modelRegistry.ts`, `routes/scenarios.ts` (`VALID_MODEL_IDS`), `solver/pmedian.ts`, `routes/dataset.ts` | modify | registration |
| `artifacts/api-server/src/solver/resultEnvelope.ts` | modify | new metric keys (T1) |
| `artifacts/api-server/src/solver/jobRunner.ts` | modify | `SOLVER_CODE_HASH` covers `merge_inputs.py` (T2) |
| `artifacts/api-server/src/services/templates.ts` | modify | cost-summary export columns, template v5 (T4) |
| `lib/import-schema/src/index.ts` | modify | `MODEL_IDS` (T3) |
| `artifacts/api-server/src/services/precheckSuper.ts` | create | solver-readiness precheck |
| `artifacts/api-server/src/services/precheck.ts` | modify | dispatch line |
| `artifacts/api-server/src/services/superNetwork.ts` | create | replace/merge of an imported network document |
| `artifacts/api-server/src/routes/superNetwork.ts` | create | `POST/GET /scenarios/:id/network/{import,export}` |
| `artifacts/api-server/src/routes/index.ts`, `src/app.ts` | modify | mount router; body-parser carve-out |
| `lib/api-spec/openapi.yaml` (+ regenerated `lib/api-zod`, `lib/api-client-react`) | modify | enums, metrics, network endpoints |
| `lib/units/src/objective.ts` | modify | `super-model` → `"monetary"` |
| `artifacts/studio/src/lib/chapters.ts`, `pages/Landing.tsx` | modify | chapter entry, no "00" number |
| `artifacts/studio/src/lib/superNetwork.ts` | create | cascade-delete + reference counts, sample/template URLs |
| `artifacts/studio/src/components/workspace/super/SuperTableTab.tsx` | create | one editable DataTable tab driven by a column config |
| `artifacts/studio/src/components/workspace/super/superTables.tsx` | create | column configs for the 6 tables |
| `artifacts/studio/src/components/workspace/super/SuperDistancesTab.tsx` | create | overrides + method + circuity |
| `artifacts/studio/src/components/workspace/super/SuperNetworkImportDialog.tsx` | create | JSON import, replace/merge, overwrite confirm |
| `artifacts/studio/src/components/workspace/super/SuperReadinessPanel.tsx` | create | precheck checklist + empty state |
| `artifacts/studio/src/pages/Workspace.tsx` | modify | defaults, tab list, tab dispatch, outputs, precheck enable, pMax |
| `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` | modify | super summary + compare rows |
| `artifacts/studio/src/lib/resultNarrative.ts` | modify | super branch |
| `artifacts/studio/e2e/super-model.spec.ts` | create | real-browser import → solve → summary |
| `docs/CHANGELOG-implementation.md` | modify | entry per task |

---

### Task 1 [SM-1]: Shared solver core with plant cost term and derived big-M (Ch9 unchanged)

Role: solver-engineer.

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py:1104-1428` (`solve_jade`), `:154` (`JADE_OPEN_BIG_M`)
- Modify: `artifacts/api-server/src/solver/tests/test_jade.py`
- Create: `artifacts/api-server/src/solver/tests/test_super.py`
- Modify: `artifacts/api-server/src/solver/resultEnvelope.ts:34-71` (`MetricsSchema`)
- Modify: `lib/api-spec/openapi.yaml` (result `metrics` schema — locate with `grep -n "inboundCost" lib/api-spec/openapi.yaml`), then regen `lib/api-zod/src/generated` + `lib/api-client-react/src/generated`
- Create: `artifacts/api-server/src/solver/__tests__/twoEchelonMetricsContract.test.ts`

The metrics contract lands in this commit, not later: the solver starts emitting the keys here, and a contract change split across commits leaves an intermediate commit whose stored results silently drop them (CLAUDE.md, "A change crossing a layer boundary is ONE commit").

**Interfaces:**
- Produces (module-level in `solve.py`, names later tasks rely on):
  ```python
  def _solve_two_echelon_core(*, plants, warehouses, customers, product_ids, demands,
                              capability, plant_cost, dist, get_bounds, p, distance_bands,
                              gap, time_limit, rates, wh_label, problem_uid):
      """Returns the standard _envelope(...) dict."""
  ```
  - `plants`, `warehouses`, `customers`: `list[str]` ids
  - `demands`: `dict[cust_id, dict[product_id, float]]`
  - `capability`, `plant_cost`: `dict[(plant_id, product_id), float]` (missing key ⇒ 0)
  - `dist`: `dict[(from_id, to_id), float]`
  - `get_bounds`: `callable(wh_id) -> (lb, ub)`
  - `rates`: `{"icTransCost","icMinTrans","obTransCost","obMinTrans"}`
  - `wh_label`: `callable(wh_id) -> str` (city for utilization rows)
  - New metrics keys emitted for every caller, with this precision:
    - `plantVariableCost` and `totalCost`: cents, 2 dp, like the existing `inboundCost`/`outboundCost`. `totalCost = round(inbound + outbound + plant, 2)`, summed from the **unrounded** accumulators.
    - `avgDistPlantToWh` and `avgDistWhToCustomer`: unrounded miles. Display rounds.
  - Generated client gains optional `plantVariableCost`, `totalCost`, `avgDistPlantToWh`, `avgDistWhToCustomer` on result `metrics`.

- [ ] **Step 1: Write failing tests** in `tests/test_super.py` (same `sys.path` header as `test_jade.py:19-22`):

```python
import os, sys
tests_dir = os.path.dirname(os.path.abspath(__file__))
solver_dir = os.path.dirname(tests_dir)
sys.path.insert(0, tests_dir); sys.path.insert(0, solver_dir)
import solve as solve_mod
from solve import _solve_two_echelon_core

RATES = {"icTransCost": 0.07, "icMinTrans": 10.0, "obTransCost": 0.12, "obMinTrans": 10.0}

def _tiny(plant_cost, capability=None):
    # 2 plants, 2 warehouses, 2 customers, 1 product; p=1
    dist = {("P1","W1"): 100, ("P1","W2"): 300, ("P2","W1"): 300, ("P2","W2"): 100,
            ("W1","C1"): 100, ("W1","C2"): 200, ("W2","C1"): 200, ("W2","C2"): 100}
    return _solve_two_echelon_core(
        plants=["P1","P2"], warehouses=["W1","W2"], customers=["C1","C2"], product_ids=["K"],
        demands={"C1": {"K": 100.0}, "C2": {"K": 100.0}},
        capability=capability or {("P1","K"): 1e6, ("P2","K"): 1e6},
        plant_cost=plant_cost, dist=dist, get_bounds=lambda w: (0, 1), p=1,
        distance_bands=[], gap=0.0, time_limit=60, rates=RATES,
        wh_label=lambda w: w, problem_uid="test-core")

def test_plant_cost_term_adds_exactly_flow_times_cost():
    base = _tiny({})
    costed = _tiny({("P1","K"): 5.0, ("P2","K"): 5.0})
    m = costed["metrics"]
    assert base["status"] == costed["status"] == "optimal"
    assert abs(m["plantVariableCost"] - 200 * 5.0) < 1e-6
    assert abs(costed["objective"] - (base["objective"] + 1000.0)) < 1e-4
    assert abs(m["totalCost"] - (m["inboundCost"] + m["outboundCost"] + m["plantVariableCost"])) <= 0.011  # each term rounded to cents

def test_plant_cost_changes_sourcing():
    # P1 made expensive -> all inbound flow comes from P2
    r = _tiny({("P1","K"): 100.0, ("P2","K"): 0.0})
    pw = [e for e in r["edges"] if e["leg"] == "plant_to_warehouse"]
    assert {e["fromId"] for e in pw} == {"P2"}

def test_capacity_cap_binds():
    r = _tiny({}, capability={("P1","K"): 150.0, ("P2","K"): 1e6})
    by_plant = {}
    for e in r["edges"]:
        if e["leg"] == "plant_to_warehouse":
            by_plant[e["fromId"]] = by_plant.get(e["fromId"], 0) + e["flow"]
    assert by_plant.get("P1", 0) <= 150

def test_capacity_shortfall_reason():
    r = _tiny({}, capability={("P1","K"): 50.0, ("P2","K"): 50.0})
    assert r["status"] == "infeasible"
    assert "capacity" in r["infeasibilityReason"].lower()

def test_weighted_average_distances_unrounded():
    r = _tiny({})
    m = r["metrics"]
    assert m["avgDistPlantToWh"] == 100.0 and m["avgDistWhToCustomer"] == 150.0
```

(With p=1 and symmetric data the optimum opens one warehouse; plant→WH 100 mi from the nearer plant; WH→customers 100 and 200 ⇒ 150.)

- [ ] **Step 2: Run** `cd artifacts/api-server/src/solver && python3 -m pytest tests/test_super.py -x -q` — Expected: FAIL, `ImportError: cannot import name '_solve_two_echelon_core'`.

- [ ] **Step 3: Extract the core.** In `solve.py`:
  1. Delete the constant `JADE_OPEN_BIG_M = 10_000_000` (`:154`) and grep that no other reference remains (`grep -n JADE_OPEN_BIG_M -r artifacts/api-server/src/solver`).
  2. Create `_solve_two_echelon_core(...)` directly above `solve_jade` and **move** `solve_jade`'s body from the `ic_cost`/`ob_cost` definitions (`:1179`) through the final `return _envelope(...)` (`:1428`) into it, verbatim except these edits:
     - `ic_rate, ic_min, ob_rate, ob_min` are read from `rates`, and `transport_rates = dict(rates)`.
     - Add to the non-finite guard loop: `for (pl, k), c_pc in plant_cost.items(): if not math.isfinite(c_pc): raise ValueError(f"non-finite JADE transport coefficient: plant_cost plantId={pl!r} productId={k!r} cost={c_pc!r}")`.
     - The objective becomes:
       ```python
       prob += (lpSum(flow_pw[pl, w, k] * (ic_cost(pl, w) + plant_cost.get((pl, k), 0.0))
                      for pl in plants for w in warehouses for k in product_ids)
                + lpSum(flow_wc[w, c, k] * ob_cost(w, c) * demands[c].get(k, 0)
                        for w in warehouses for c in customers for k in product_ids))
       ```
     - C4 uses `big_m = len(customers) * len(product_ids)` in place of `JADE_OPEN_BIG_M`.
     - `problem_uid=problem_uid` in `_run_cbc`.
     - Infeasible branch: insert, after the zero-capacity-products reason and before the generic reason,
       ```python
       short = [k for k in product_ids
                if sum(capability.get((pl, k), 0) for pl in plants)
                   < sum(demands[c].get(k, 0) for c in customers)]
       ```
       If `short` is non-empty, set the reason to `f"Total plant capacity is below total demand for product(s): {', '.join(short)}. Raise capacity or reduce demand."`.
     - In the result loop, accumulate `plant_variable_cost += f * plant_cost.get((pl, k), 0.0)` next to `inbound_cost`.
     - Utilization rows use `wh_label(w)` instead of `wh_data[w]['city']`.
     - Add to the metrics dict:
       ```python
       "plantVariableCost": round(plant_variable_cost, 2),
       "totalCost": round(inbound_cost + outbound_cost + plant_variable_cost, 2),
       "avgDistPlantToWh": (leg_dist_flow["plant_to_warehouse"] / leg_flow["plant_to_warehouse"]
                            if leg_flow["plant_to_warehouse"] > 0 else 0.0),
       "avgDistWhToCustomer": (leg_dist_flow["warehouse_to_customer"] / leg_flow["warehouse_to_customer"]
                               if leg_flow["warehouse_to_customer"] > 0 else 0.0),
       ```
       Keep every existing key and its rounding unchanged.
  3. `solve_jade` keeps its lines `:1105-1177` (load guard, parsing, merge, `get_bounds`, `get_demands`, rates), then ends with:
     ```python
     return _solve_two_echelon_core(
         plants=plants, warehouses=warehouses, customers=customers, product_ids=product_ids,
         demands=demands, capability=capability, plant_cost={}, dist=dist, get_bounds=get_bounds,
         p=p, distance_bands=distance_bands, gap=gap, time_limit=time_limit,
         rates={"icTransCost": ic_rate, "icMinTrans": ic_min, "obTransCost": ob_rate, "obMinTrans": ob_min},
         wh_label=lambda w: wh_data[w]['city'], problem_uid="jade")
     ```
     Keep the `total_demand` guard wherever it currently sits.

- [ ] **Step 4: Add Ch9 regression assertions** to `test_jade.py`, next to `test_ground_truth_objective_and_facilities`:

```python
def test_ground_truth_plant_cost_zero_and_total_cost():
    m = solve_jade(GROUND_TRUTH_INPUTS)["metrics"]
    assert m["plantVariableCost"] == 0
    assert abs(m["totalCost"] - (m["inboundCost"] + m["outboundCost"])) <= 0.011
```

- [ ] **Step 4b: Metrics contract test (failing first)** `artifacts/api-server/src/solver/__tests__/twoEchelonMetricsContract.test.ts`. It runs the real solver on Ch9 ground truth (no hand-built fixture) and parses with `MetricsSchema`:

```ts
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { MetricsSchema } from "../resultEnvelope.js";

const here = path.dirname(fileURLToPath(import.meta.url)); // package is ESM — no __dirname
const SOLVE_PY = path.resolve(here, "../solve.py");

it("MetricsSchema keeps the shared-core summary metrics from a real Ch9 solve", () => {
  const payload = { modelType: "two_echelon_jade", p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120,
    warehouseStatuses: [{ warehouseId: "wh-11", status: "forced_open" }, { warehouseId: "wh-14", status: "forced_open" }] };
  const r = spawnSync("python3", [SOLVE_PY], { input: JSON.stringify(payload), encoding: "utf8", timeout: 180_000 });
  const out = JSON.parse(r.stdout.trim().split("\n").pop()!);
  const m = MetricsSchema.parse(out.metrics);
  for (const k of ["plantVariableCost", "totalCost", "avgDistPlantToWh", "avgDistWhToCustomer"] as const)
    expect(typeof m[k]).toBe("number");
  expect(m.plantVariableCost).toBe(0);
}, 200_000);
```

  Under `spawnSync` there is no fd 3, so the envelope arrives on stdout, as in `e2e_accuracy.py`'s `run()`. Run it and expect FAIL: `typeof undefined`, because the keys are stripped.

- [ ] **Step 4c: Contract.**
  - In `MetricsSchema` add `plantVariableCost: z.number().optional(), totalCost: z.number().optional(), avgDistPlantToWh: z.number().optional(), avgDistWhToCustomer: z.number().optional(),`.
  - Add the same four optional `type: number` properties to the OpenAPI result `metrics` schema.
  - Run `pnpm --filter @workspace/api-spec run codegen`.
  - Re-run the test and expect PASS.

- [ ] **Step 5: Run**
  - `python3 -m pytest tests/ -x -q` — Expected: all pass, including `test_jade.py`'s monkeypatch tests (`JADE_CAPABILITY`, `_run_cbc` still resolve on the `solve` module).
  - `cd tests && python3 e2e_accuracy.py` — Expected: `99/99`, JD-1 objective `254060828.6157`.

- [ ] **Step 6: Gate + changelog + commit** on branch `sm-1-solver-core` (from `super-model-spec`):
  - Run `pnpm gate`.
  - Append a `[SM-1]` entry to `docs/CHANGELOG-implementation.md` recording what landed, the e2e_accuracy result, and what's next.
  - Commit:
    ```bash
    [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
    git commit artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/tests/test_super.py artifacts/api-server/src/solver/tests/test_jade.py artifacts/api-server/src/solver/resultEnvelope.ts artifacts/api-server/src/solver/__tests__/twoEchelonMetricsContract.test.ts lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated docs/CHANGELOG-implementation.md -m "[SM-1] extract shared two-echelon core with plant cost term, derived big-M and summary metrics contract"
    ```

---

### Task 2 [SM-2]: `solve_super`, distance resolution, sample network golden, timing run

Role: solver-engineer.

**Files:**
- Modify: `artifacts/api-server/src/solver/merge_inputs.py` (append)
- Modify: `artifacts/api-server/src/solver/solve.py` (add `solve_super` after `solve_jade`; **no dispatcher branch yet** — Task 3 adds it with its TS twin)
- Create: `scripts/build-super-sample.py`
- Create: `scripts/super-model-timing.py`
- Create (generated): `artifacts/studio/public/samples/super-model-sample.json`
- Create: `artifacts/studio/public/samples/super-model-template.json`
- Modify: `artifacts/api-server/src/solver/jobRunner.ts:55-64` (`SOLVER_CODE_HASH`)
- Test: `artifacts/api-server/src/solver/tests/test_super.py`

**Cache invalidation, which replaces the version bump.** `model-integration-precheck.md`'s "bump `dataset/version.json` on solver logic change" rule predates `SOLVER_CODE_HASH` (`jobRunner.ts:55-64`). The cache key now hashes the solver source, and no dataset file changes in this phase, so no `version.json` bump is needed. But that hash covers **only** `solve.py`. Super's distance logic lives in `merge_inputs.py`, and so does jade's merge. Extend the hash to both files:

```ts
const SOLVER_CODE_HASH = crypto.createHash("sha256")
  .update(readFileSync(SOLVER_PY))
  .update(readFileSync(path.join(path.dirname(SOLVER_PY), "merge_inputs.py")))
  .digest("hex").slice(0, 12);
```

This invalidates every cached result once; that is expected. Add a test in the existing `jobRunner` hash test (grep `SOLVER_CODE_HASH` in `__tests__`) asserting that the hash input includes `merge_inputs.py`, or that the value differs from a hash of `solve.py` alone.

**Interfaces:**
- Consumes: `_solve_two_echelon_core` (Task 1).
- Produces:
  - `merge_inputs.haversine_mi(lat1, lng1, lat2, lng2) -> float`
  - `merge_inputs.build_super_dataset(inputs: dict) -> dict` with keys `plants, warehouses, customers` (id → row; customers exclude `excluded`), `product_ids, demands, capability, plant_cost, dist`
  - `solve.solve_super(inp) -> envelope`
  - Sample JSON shaped exactly like the `super-model` inputs (Task 3 schema).

- [ ] **Step 1: Failing tests** (append to `test_super.py`):

```python
import json, math
from merge_inputs import haversine_mi, build_super_dataset
from solve import solve_super
REPO = os.path.abspath(os.path.join(solver_dir, "..", "..", "..", ".."))
SAMPLE = os.path.join(REPO, "artifacts", "studio", "public", "samples", "super-model-sample.json")

def test_haversine_known_pair():
    # Los Angeles -> New York City, great-circle ≈ 2445 mi with R=3959
    d = haversine_mi(33.974044, -118.248849, 40.75012, -73.997846)
    assert 2430 < d < 2460

def _mini_inputs(**kw):
    base = dict(p=1, gap=0, timeLimitSec=60, distanceMethod="haversine", circuityFactor=1.17,
        transportCosts=dict(RATES),
        products=[{"id": "K", "name": "K"}],
        plants=[{"id": "P1", "name": "P1", "lat": 40.0, "lng": -100.0}],
        warehouses=[{"id": "W1", "name": "W1", "lat": 40.0, "lng": -99.0, "status": "active"}],
        customers=[{"id": "C1", "name": "C1", "lat": 40.0, "lng": -98.0, "status": "active"},
                   {"id": "C2", "name": "C2", "lat": 41.0, "lng": -98.0, "status": "excluded"}],
        plantProducts=[{"plantId": "P1", "productId": "K", "capacity": 1000, "costPerUnit": 2}],
        demand=[{"customerId": "C1", "productId": "K", "demand": 10},
                {"customerId": "C2", "productId": "K", "demand": 99}],
        distanceOverrides=[])
    base.update(kw); return base

def test_distance_resolution_precedence():
    ds = build_super_dataset(_mini_inputs(distanceOverrides=[{"fromId": "P1", "toId": "W1", "miles": 7}]))
    assert ds["dist"][("P1","W1")] == 7
    hv = haversine_mi(40.0, -99.0, 40.0, -98.0)
    assert abs(ds["dist"][("W1","C1")] - hv) < 1e-9
    ds2 = build_super_dataset(_mini_inputs(distanceMethod="circuity", circuityFactor=1.5))
    assert abs(ds2["dist"][("W1","C1")] - hv * 1.5) < 1e-9
    assert "C2" not in ds["customers"] and "C2" not in ds["demands"]

def test_solve_super_mini():
    r = solve_super(_mini_inputs())
    assert r["status"] == "optimal"
    assert abs(r["metrics"]["plantVariableCost"] - 20) < 1e-6

def test_sample_network_reproduces_ch9_golden():
    inp = json.load(open(SAMPLE))
    r = solve_super(inp)
    assert r["status"] == "optimal"
    assert abs(r["objective"] - 254060828.6157) / 254060828.6157 < 1e-6
    assert set(r["details"]["openWarehouseIds"]) == {"wh-11", "wh-14"}
```

- [ ] **Step 2: Run** `python3 -m pytest tests/test_super.py -x -q` — Expected: FAIL, `ImportError: haversine_mi`.

- [ ] **Step 3: Implement in `merge_inputs.py`:**

```python
import math

def haversine_mi(lat1, lng1, lat2, lng2):
    r = 3959.0  # miles; same constant as autoDistance.ts R_MI
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))

def build_super_dataset(inputs):
    """super-model: the whole network lives in inputs. Overrides win; otherwise
    haversine miles, x circuityFactor when distanceMethod == "circuity"."""
    plants = {r["id"]: r for r in inputs.get("plants", [])}
    warehouses = {r["id"]: r for r in inputs.get("warehouses", [])}
    customers = {r["id"]: r for r in inputs.get("customers", []) if r.get("status") != "excluded"}
    product_ids = [r["id"] for r in inputs.get("products", [])]
    demands = {c: {} for c in customers}
    for r in inputs.get("demand", []):
        if r["customerId"] in demands:
            demands[r["customerId"]][r["productId"]] = float(r["demand"])
    capability = {(r["plantId"], r["productId"]): float(r["capacity"]) for r in inputs.get("plantProducts", [])}
    plant_cost = {(r["plantId"], r["productId"]): float(r["costPerUnit"]) for r in inputs.get("plantProducts", [])}
    overrides = {(r["fromId"], r["toId"]): float(r["miles"]) for r in inputs.get("distanceOverrides", [])}
    factor = float(inputs.get("circuityFactor", 1.0)) if inputs.get("distanceMethod") == "circuity" else 1.0

    def resolve(a, b):
        if (a["id"], b["id"]) in overrides:
            return overrides[(a["id"], b["id"])]
        return haversine_mi(a["lat"], a["lng"], b["lat"], b["lng"]) * factor

    dist = {}
    for pl in plants.values():
        for w in warehouses.values():
            dist[(pl["id"], w["id"])] = resolve(pl, w)
    for w in warehouses.values():
        for c in customers.values():
            dist[(w["id"], c["id"])] = resolve(w, c)
    return {"plants": plants, "warehouses": warehouses, "customers": customers,
            "product_ids": product_ids, "demands": demands, "capability": capability,
            "plant_cost": plant_cost, "dist": dist}
```

- [ ] **Step 4: Implement `solve_super` in `solve.py`** (import `build_super_dataset` next to `build_merged_jade_dataset` at `:32`):

```python
_SUPER_BOUNDS = {"forced_open": (1, 1), "inactive": (0, 0)}

def solve_super(inp):
    ds = build_super_dataset(inp)
    wh = ds["warehouses"]
    return _solve_two_echelon_core(
        plants=list(ds["plants"]), warehouses=list(wh), customers=list(ds["customers"]),
        product_ids=ds["product_ids"], demands=ds["demands"], capability=ds["capability"],
        plant_cost=ds["plant_cost"], dist=ds["dist"],
        get_bounds=lambda w: _SUPER_BOUNDS.get(wh[w].get("status"), (0, 1)),
        p=int(inp["p"]), distance_bands=[], gap=float(inp.get("gap", 0.0)),
        time_limit=int(inp.get("timeLimitSec", 120)), rates=dict(inp["transportCosts"]),
        wh_label=lambda w: wh[w].get("city") or wh[w].get("name") or w, problem_uid="super")
```

(The status→bounds map is data — a dict lookup, not a branch — matching `get_bounds` in `solve_jade`.)

- [ ] **Step 5: Write `scripts/build-super-sample.py`** — this generates the golden fixture:

```python
#!/usr/bin/env python3
"""Build artifacts/studio/public/samples/super-model-sample.json from the Ch9
JADE dataset: e2e_accuracy's Notebook scenario_1 (p=2, wh-11 + wh-14 forced
open), costPerUnit 0, every JADE distance as an override. Solving it must
reproduce 254060828.6157 (tests/test_super.py)."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS = os.path.join(ROOT, "solvers", "two-echelon-jade-us", "dataset")
OUT = os.path.join(ROOT, "artifacts", "studio", "public", "samples", "super-model-sample.json")
load = lambda f: json.load(open(os.path.join(DS, f)))
plants, wh, cust, prods = load("plants.json"), load("warehouses.json"), load("customers.json"), load("products.json")
loc = lambda r: {"id": r["id"], "name": r["name"], "city": r["city"], "state": r["state"], "lat": r["lat"], "lng": r["lng"]}
dist = load("distances.json")
pairs = [(p, w) for p in plants for w in wh] + [(w, c) for w in wh for c in cust]
missing = [f"{a},{b}" for a, b in pairs if f"{a},{b}" not in dist]
assert not missing, f"JADE matrix missing pairs: {missing[:5]}"
doc = {
    "p": 2, "gap": 0, "timeLimitSec": 120, "distanceMethod": "haversine", "circuityFactor": 1.17,
    "transportCosts": {"icTransCost": 0.07, "icMinTrans": 10, "obTransCost": 0.12, "obMinTrans": 10},
    "products": [{"id": k, "name": v["name"]} for k, v in prods.items()],
    "plants": [loc(r) for r in plants.values()],
    "warehouses": [{**loc(r), "status": "forced_open" if r["id"] in ("wh-11", "wh-14") else "active"} for r in wh.values()],
    "customers": [{**loc(r), "status": "active"} for r in cust.values()],
    "plantProducts": [{"plantId": r["plantId"], "productId": r["productId"], "capacity": r["capacity"], "costPerUnit": 0}
                      for r in load("plant_product_capability.json")],
    "demand": [{"customerId": c["id"], "productId": k, "demand": v}
               for c in cust.values() for k, v in c["demands"].items()],
    "distanceOverrides": [{"fromId": a, "toId": b, "miles": dist[f"{a},{b}"]} for a, b in pairs],
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(doc, open(OUT, "w"), indent=1)
print(f"wrote {OUT}: {len(doc['customers'])} customers, {len(doc['distanceOverrides'])} overrides")
```

  Run `python3 scripts/build-super-sample.py`. Expected: `wrote …: 100 customers, 2600 overrides`.

  Also write `super-model-template.json`: the same top-level keys with defaults (`p: 1`, `gap: 0`, `timeLimitSec: 120`, `distanceMethod: "haversine"`, `circuityFactor: 1.17`, textbook `transportCosts`) and each table holding one example row (ids `product-1`, `plant-1`, `wh-1`, `customer-1`).

- [ ] **Step 6: Run** `python3 -m pytest tests/ -x -q` — Expected: all pass, including `test_sample_network_reproduces_ch9_golden`.

- [ ] **Step 7: Timing run (confirms D1 caps).** Write `scripts/super-model-timing.py`:
  - Build a seeded-random network (`random.seed(1)`; lat/lng in the continental US) at the caps: 20 plants, 50 warehouses, 200 customers, 10 products (50 × 200 × 10 = 100,000).
  - Every plant makes every product; capacity = 2 × total demand / 20.
  - `p=10`, `gap=0.01`, `timeLimitSec=120`.
  - Call `solve_super` and print `status`, `runTimeSec`, `achievedGap`.

  Run it twice. Record both outputs verbatim in the changelog entry.
  - If the solve does not finish with `status` optimal or feasible within 120 s, halve the product cap to 50,000, re-run, and update the spec §3.3 numbers in this same task.
  - Never record an estimate; an unmeasured value is `unknown`.

- [ ] **Step 8: Gate + `e2e_accuracy.py` + changelog + commit** on branch `sm-2-solve-super`:
  ```bash
  git commit artifacts/api-server/src/solver/merge_inputs.py artifacts/api-server/src/solver/jobRunner.ts artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/tests/test_super.py scripts/build-super-sample.py scripts/super-model-timing.py artifacts/studio/public/samples/ docs/CHANGELOG-implementation.md -m "[SM-2] add solve_super with computed distances and Ch9-equivalent sample golden"
  ```

---

### Task 3 [SM-3]: Register `super-model` end to end (all 18 points)

Role: backend-engineer, with a frontend-engineer sub-step (steps 9–10) in the same commit — the registration tests compare the id sets across both sides, so this cannot be split.

Read `model-integration-precheck.md` first. The line numbers below are current at `f0e47cb4`; several of the doc's own numbers are stale.

**Files:** every file listed in steps 1–10. Test: `artifacts/api-server/src/__tests__/superModelRegistration.test.ts` (new) plus updates to the enumerating tests in step 11.

**Interfaces:**
- Produces: `superInputsSchema`, type `SuperInputs`, constants `SUPER_CAPS`, `SUPER_DEFAULT_INPUTS` from `artifacts/api-server/src/validation/inputs/superInputs.ts`.
- `buildPayload` emits `{ modelType: "super_model", ...inputs }`.

- [ ] **Step 1: Write the failing test** `superModelRegistration.test.ts` (real DB, same helpers as `jadeTransportCostsPersistence.test.ts`; copy its `registerAndGetCookie` and `afterAll` verbatim):

```ts
import { SUPER_DEFAULT_INPUTS } from "../validation/inputs/superInputs.js";
// ...register user, cookie...
it("creates an empty super-model scenario and round-trips its inputs", async () => {
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name: "sm-empty", modelId: "super-model", inputs: SUPER_DEFAULT_INPUTS }).expect(201);
  scenarioIds.push(res.body.id);
  expect(res.body.inputs.products).toEqual([]);
  expect(res.body.inputs.distanceMethod).toBe("haversine");
});
it("rejects duplicate ids across plants/warehouses/customers with 422", async () => {
  const inputs = { ...SUPER_DEFAULT_INPUTS,
    plants: [{ id: "X", name: "p", lat: 1, lng: 1 }],
    warehouses: [{ id: "X", name: "w", lat: 1, lng: 1, status: "active" }] };
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name: "sm-dup", modelId: "super-model", inputs });
  expect(res.status).toBe(422);
  expect(JSON.stringify(res.body)).toContain("X");
});
it("rejects an unresolved reference and an over-cap table with 422", async () => {
  const bad = { ...SUPER_DEFAULT_INPUTS, demand: [{ customerId: "nope", productId: "nope", demand: 1 }] };
  expect((await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name: "sm-ref", modelId: "super-model", inputs: bad })).status).toBe(422);
  const many = { ...SUPER_DEFAULT_INPUTS,
    products: Array.from({ length: 11 }, (_, i) => ({ id: `k${i}`, name: `k${i}` })) };
  expect((await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name: "sm-cap", modelId: "super-model", inputs: many })).status).toBe(422);
});
it("rejects non-finite numbers and the Phase-3-only road method with 422", async () => {
  // JSON cannot carry Infinity; prove it at the schema level instead
  const { superInputsSchema } = await import("../validation/inputs/superInputs.js");
  const base = { ...SUPER_DEFAULT_INPUTS,
    plants: [{ id: "p", name: "p", lat: 1, lng: 1 }], warehouses: [{ id: "w", name: "w", lat: 1, lng: 2, status: "active" }] };
  expect(superInputsSchema.safeParse({ ...base, distanceOverrides: [{ fromId: "p", toId: "w", miles: Infinity }] }).success).toBe(false);
  expect(superInputsSchema.safeParse({ ...base, distanceOverrides: [{ fromId: "p", toId: "w", miles: -Infinity }] }).success).toBe(false);
  const road = await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name: "sm-road", modelId: "super-model", inputs: { ...SUPER_DEFAULT_INPUTS, distanceMethod: "road" } });
  expect(road.status).toBe(422);
});
it("GET /api/models lists super-model", async () => {
  const res = await request(app).get("/api/models").set("Cookie", cookie).expect(200);
  expect(res.body.map((m: { id: string }) => m.id)).toContain("super-model");
});
```

- [ ] **Step 2: Run** `DATABASE_URL=… pnpm --filter api-server exec vitest run src/__tests__/superModelRegistration.test.ts`. Expected: FAIL (422 `modelId` not valid / import error).

- [ ] **Step 3: Zod schema** `artifacts/api-server/src/validation/inputs/superInputs.ts`:

```ts
import { z } from "zod";
import { JADE_RATE_MAX, JADE_MIN_CHARGE_MAX, JADE_TEXTBOOK_TRANSPORT_COSTS } from "./jadeInputs.js";

export const SUPER_CAPS = { products: 10, plants: 20, warehouses: 50, customers: 500, whCustProd: 50_000 } as const;

const id = z.string().trim().min(1);
const num = z.number().finite();   // every numeric field rejects NaN/±Infinity
const loc = { id, name: z.string().trim().min(1), city: z.string().optional(), state: z.string().optional(),
  lat: num.min(-90).max(90), lng: num.min(-180).max(180) };

const transportCosts = z.object({
  icTransCost: num.min(0).max(JADE_RATE_MAX), icMinTrans: num.min(0).max(JADE_MIN_CHARGE_MAX),
  obTransCost: num.min(0).max(JADE_RATE_MAX), obMinTrans: num.min(0).max(JADE_MIN_CHARGE_MAX),
});

export const superTableSchemas = {
  products: z.array(z.object({ id, name: z.string().trim().min(1) })).max(SUPER_CAPS.products),
  plants: z.array(z.object(loc)).max(SUPER_CAPS.plants),
  warehouses: z.array(z.object({ ...loc, status: z.enum(["active", "forced_open", "inactive"]).default("active") })).max(SUPER_CAPS.warehouses),
  customers: z.array(z.object({ ...loc, status: z.enum(["active", "excluded"]).default("active") })).max(SUPER_CAPS.customers),
  plantProducts: z.array(z.object({ plantId: id, productId: id, capacity: num.min(0), costPerUnit: num.min(0) })),
  demand: z.array(z.object({ customerId: id, productId: id, demand: num.min(0) })),
  distanceOverrides: z.array(z.object({ fromId: id, toId: id, miles: num.positive() })),   // num is .finite(): ±Infinity rejected
};

export const superParamSchemas = {
  p: z.number().int().min(1),
  gap: num.min(0),
  timeLimitSec: z.number().int().min(1),
  transportCosts,
  distanceMethod: z.enum(["haversine", "circuity"]),
  circuityFactor: num.min(1).max(3),
};

export const superInputsSchema = z.object({
  ...superParamSchemas,
  ...Object.fromEntries(Object.entries(superTableSchemas).map(([k, s]) => [k, s.default([])])) as {
    [K in keyof typeof superTableSchemas]: z.ZodDefault<(typeof superTableSchemas)[K]> },
}).superRefine((v, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const dupes = (rows: { key: string; path: (string | number)[] }[], what: string) => {
    const seen = new Set<string>();
    for (const r of rows) { if (seen.has(r.key)) issue(r.path, `Duplicate ${what} "${r.key}"`); seen.add(r.key); }
  };
  dupes([...v.plants.map((r, i) => ({ key: r.id, path: ["plants", i, "id"] })),
         ...v.warehouses.map((r, i) => ({ key: r.id, path: ["warehouses", i, "id"] })),
         ...v.customers.map((r, i) => ({ key: r.id, path: ["customers", i, "id"] }))], "location id");
  dupes(v.products.map((r, i) => ({ key: r.id, path: ["products", i, "id"] })), "product id");
  dupes(v.plantProducts.map((r, i) => ({ key: `${r.plantId}|${r.productId}`, path: ["plantProducts", i] })), "plant-product row");
  dupes(v.demand.map((r, i) => ({ key: `${r.customerId}|${r.productId}`, path: ["demand", i] })), "demand row");
  dupes(v.distanceOverrides.map((r, i) => ({ key: `${r.fromId}|${r.toId}`, path: ["distanceOverrides", i] })), "distance override");
  const P = new Set(v.plants.map(r => r.id)), W = new Set(v.warehouses.map(r => r.id)),
        C = new Set(v.customers.map(r => r.id)), K = new Set(v.products.map(r => r.id));
  v.plantProducts.forEach((r, i) => {
    if (!P.has(r.plantId)) issue(["plantProducts", i, "plantId"], `Unknown plant "${r.plantId}"`);
    if (!K.has(r.productId)) issue(["plantProducts", i, "productId"], `Unknown product "${r.productId}"`);
  });
  v.demand.forEach((r, i) => {
    if (!C.has(r.customerId)) issue(["demand", i, "customerId"], `Unknown customer "${r.customerId}"`);
    if (!K.has(r.productId)) issue(["demand", i, "productId"], `Unknown product "${r.productId}"`);
  });
  v.distanceOverrides.forEach((r, i) => {
    const ok = (P.has(r.fromId) && W.has(r.toId)) || (W.has(r.fromId) && C.has(r.toId));
    if (!ok) issue(["distanceOverrides", i], `"${r.fromId}" → "${r.toId}" is not a plant→warehouse or warehouse→customer pair`);
  });
  if (v.warehouses.length * v.customers.length * v.products.length > SUPER_CAPS.whCustProd)
    issue(["warehouses"], `warehouses × customers × products exceeds ${SUPER_CAPS.whCustProd.toLocaleString("en-US")}`);
});

export type SuperInputs = z.infer<typeof superInputsSchema>;

export const SUPER_DEFAULT_INPUTS = {
  p: 1, gap: 0, timeLimitSec: 120, transportCosts: { ...JADE_TEXTBOOK_TRANSPORT_COSTS },
  distanceMethod: "haversine", circuityFactor: 1.17,
  products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [],
} satisfies z.input<typeof superInputsSchema>;
```

  Over-cap messages come from Zod's `.max` ("Array must contain at most 10 element(s)"); `formatInputIssues` prefixes the path. Note `.trim()` on `id` (blank IDs rejected).

- [ ] **Step 4: Dataset package.**
  - Create `solvers/super-model/dataset/{plants,warehouses,customers,products}.json`, each containing `{}`.
  - In `lib/dataset-schema/src/index.ts`:
    - Add to `PACKAGE_SPECS` (`:115-177`): `{ modelId: "super-model", files: { "plants.json": z.record(z.string(), z.never()), "warehouses.json": z.record(z.string(), z.never()), "customers.json": z.record(z.string(), z.never()), "products.json": z.record(z.string(), z.never()) } }`.
    - Add `"super-model"` to `MODEL_IDS` (`:284-292`).
  - In `lib/import-schema/src/index.ts:26-35`, add `"super-model"` to that package's own `MODEL_IDS`, so `importSchemaRouteParity.test.ts`'s typed `modelId` accepts it. Add it to **no** `IMPORT_SCHEMAS[*].models` / `addModels` list; per-entity imports stay rejected for super.
  - Compute `version.json` with the repo's algorithm, `computeSha256` at `:194-202`. Run once: `pnpm --filter @workspace/dataset-schema exec tsx -e 'import {PACKAGE_SPECS,computeSha256} from "./src/index.ts"; console.log(computeSha256(PACKAGE_SPECS.find(s=>s.modelId==="super-model")!))'`. Then write `{ "version": 1, "sha256": "<that output>" }`. If `computeSha256`'s signature differs, read it and adapt the one-liner — do not hand-compute.

- [ ] **Step 5: Manifest** `solvers/super-model/manifest.json`:

```json
{
  "id": "super-model",
  "name": "Super Model — Import-Driven Multi-Product Two-Echelon",
  "chapter": "Super Model",
  "datasetDir": "solvers/super-model/dataset",
  "countryBounds": { "sw": [25.78, -122.69], "ne": [47.61, -71.05] },
  "capabilities": {
    "supportsP": true, "capacityModes": [], "demandEditable": true,
    "outputGrids": ["openWarehouses", "costSummary"],
    "supportsFacilityStatus": true
  },
  "distanceUnit": "mi",
  "inputsSchema": {
    "type": "object",
    "required": ["p", "gap", "timeLimitSec", "transportCosts", "distanceMethod", "circuityFactor",
                 "products", "plants", "warehouses", "customers", "plantProducts", "demand", "distanceOverrides"],
    "properties": {
      "p": { "type": "integer", "minimum": 1 }, "gap": { "type": "number", "minimum": 0 },
      "timeLimitSec": { "type": "integer", "minimum": 1 }, "transportCosts": { "type": "object" },
      "distanceMethod": { "type": "string", "enum": ["haversine", "circuity"] },
      "circuityFactor": { "type": "number", "minimum": 1, "maximum": 3 },
      "products": { "type": "array" }, "plants": { "type": "array" }, "warehouses": { "type": "array" },
      "customers": { "type": "array" }, "plantProducts": { "type": "array" }, "demand": { "type": "array" },
      "distanceOverrides": { "type": "array" }
    }
  }
}
```

  `countryBounds` is only the empty-map fallback; `NetworkMap` auto-fits rendered points (`NetworkMap.tsx:518-532`). `supportsPlantProductCapability` is deliberately **unset**, so Ch9's checkbox `CapabilityMatrixTab` and `PlantsTab` do not render for this model. Every key in `required[]` is present in `SUPER_DEFAULT_INPUTS`, so the WF-5 notice cannot fire on a new scenario.

- [ ] **Step 6: API registration.**
  - `modelRegistry.ts`: import and add `"super-model": superInputsSchema` to `KNOWN_SCHEMAS` (`:21-39`).
  - `routes/scenarios.ts:94-112`: add `"super-model"` to `VALID_MODEL_IDS`.
  - `routes/scenarios.ts` long `!==` allowlists at `:922`, `:1699`, `:1767`: do **not** add `super-model`. The per-entity import/export routes must keep rejecting it with their existing 422; that is the "rejected" case Step 11 asserts.
  - `routes/dataset.ts:13-67`, the canonical endpoint `GET /api/dataset?modelId=super-model` (Task 11 fixes the spec's `/models/super-model/dataset` wording): add `if (modelId === "super-model") { res.json({ plants: [], warehouses: [], customers: [], products: [] }); return; }`. Match the response key shape the jade branch at `:39-58` uses.
  - `services/templates.ts:1493-1517` `buildEffectiveFacilityCityLookup`: add `: modelId === "super-model" ? {}` before the fallback.
  - `solver/pmedian.ts`:
    - Add `| { modelId: "super-model"; inputs: SuperInputs }` to the `SolveInput` union (`:9-15`).
    - Add before the unguarded p-median block (`:214`):
      ```ts
      if (input.modelId === "super-model") {
        return { modelType: "super_model", ...input.inputs };
      }
      ```
  - `solve.py` dispatcher (`:1878-1897`): add `if model_type == 'super_model':\n        return solve_super(inp)`.
  - `services/precheck.ts` `runNetworkEditsPrecheckForModel`: no change in this task; Task 5 adds super's check.

- [ ] **Step 7: OpenAPI enums.** Add `super-model` to all four `modelId` enums in `lib/api-spec/openapi.yaml`:
  - `:47` one-line enum
  - `:200-209`, `:1716-1723` and `:1928-1935` list form (`            - super-model`)

  Then run `pnpm --filter @workspace/api-spec run codegen`.

- [ ] **Step 8: Units.** In `lib/units/src/objective.ts:20-42` add `case "super-model":` to the `"monetary"` group. Add a row for it in `lib/units/src/__tests__/objective.test.ts`.

- [ ] **Step 9 (frontend): Studio registration.**
  - `artifacts/studio/src/lib/chapters.ts` line 1: append `| "super-model"` to `StudioModelType`, keeping the whole union on line 1.
  - Append to `CHAPTERS` after the last entry:
    ```ts
    {
      path: "/super-model",
      modelId: "super-model",
      chapter: "Super Model",
      title: "Super Model — Import Your Network",
      description: "Import your own plants, warehouses, customers, products and demand, set plant capacities and per-unit costs, and choose which warehouses to open at minimum total cost.",
      workspace: true,
      labHeaderTitle: "Super Model · Model Lab",
      labHeaderSubtitle: "Import-driven · multi-product · plants → warehouses → customers",
    },
    ```
  - `pages/Landing.tsx:13-16`: change `chapterNumber` so a label without digits returns `"SM"` rather than `"00"`:
    ```ts
    function chapterNumber(chapterLabel: string): string {
      const n = chapterLabel.match(/\d+/)?.[0];
      return n ? n.padStart(2, "0") : "SM";
    }
    ```
    Add a case to the Landing test that asserts the super card shows `SM`.
  - Create `artifacts/studio/src/lib/superDefaults.json` with the same literal as `SUPER_DEFAULT_INPUTS`. In `pages/Workspace.tsx` `defaultInputsForModel` (`:134-207`), add `case "super-model": return structuredClone(superDefaults);` (JSON import).
  - Studio cannot import api-server, so the drift guard lives server-side: in `superModelRegistration.test.ts`, `readFileSync` that JSON and `expect(JSON.parse(...)).toEqual(SUPER_DEFAULT_INPUTS)`.
  - `inputEntriesForModel` (`:1222`): add, written out (never the default fallthrough):
    ```ts
    case "super-model":
      return [
        { id: "products", label: "Products" },
        { id: "plants", label: "Plants" },
        { id: "warehouses", label: "Warehouses" },
        { id: "customers", label: "Customers" },
        { id: "plantProducts", label: "Plant Capability" },
        { id: "demand", label: "Demand" },
        { id: "distances", label: "Distances" },
        { id: "transportCosts", label: "Transportation Costs" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
    ```
    Tab content arrives in Task 7. Until then the new entity ids render the existing "not available" placeholder.
  - `entityIcons`: add icons for `products`, `plantProducts` and `demand`; reuse existing lucide icons (`Package`, `Factory`, `ShoppingCart`).
  - `lib/resultNarrative.ts:88-91`: do not add yet (Task 8).

- [ ] **Step 10: Studio tests.** Update `lib/chapters.test.ts` (super block), `__tests__/entityIcons.test.ts:8-16` (add id), and `Workspace.TabCoverage.test.tsx` (new describe asserting the 9 super input tab labels).

- [ ] **Step 11: Enumerating tests.** Update each to 8 models:
  - `modelIdSetEquality.test.ts`: `WIRE_MODEL_TYPE_BY_MODEL_ID` gets `"super-model": "super_model"`.
  - `registration.test.ts`: `SOLVABLE` and `STUB_INPUTS` get `"super-model": SUPER_DEFAULT_INPUTS`, `toHaveLength(7)` becomes `8`, plus a source-text block like delivery's asserting `input.modelId === "super-model"` and `modelType: "super_model"`.
  - `registry.test.ts:17-20, :39-44`: sorted id list.
  - `datasets.test.ts:4-12`: `EXPECTED_COUNTS` row with all zeros.
  - `lib/dataset-schema/src/manifest.test.ts:420-421`.
  - `importSchemaRouteParity.test.ts` `GUARD_CASES` and `fixtures/importFixtures.ts` `MODEL_INPUTS`: super rejects every per-entity import entity.
  - `formatInputIssues.test.ts` and `importSchema.test.ts`: whatever their loops need.

  Run each and fix only what the new id breaks.

- [ ] **Step 12: Run** the new test file plus `pnpm gate`. Expected: green.

- [ ] **Step 13: Changelog + commit** on `sm-3-registration`. The commit takes every file above plus the regenerated `lib/api-zod/src/generated` and `lib/api-client-react/src/generated`, with message `[SM-3] register super-model across api, solver dispatch, openapi and studio`.

---

### Task 4 [SM-4]: Cost-summary export contract for `super-model`

Role: backend-engineer. The result-metrics contract already landed in Task 1. This task is the **export** contract: the `costSummary` entity's rows, CSV/JSON projections, template version and OpenAPI row schema.

**Files:**
- Modify: `artifacts/api-server/src/services/templates.ts`. Read `:49-68` (`COST_SUMMARY_TEMPLATE_VERSION = 4`), `:1584-1598` (row type), `buildCostSummaryRows` `:1647`, `costSummaryRowsToCsv` `:1687` and the JSON projector at `:1708` before editing.
- Modify: `artifacts/api-server/src/routes/scenarios.ts` export route model gating (`:887-925`). Allow `entity=costSummary` for `super-model`; every other per-entity export stays rejected.
- Modify: `lib/api-spec/openapi.yaml` `CostSummaryExportRow` (`:2293-2325`) and the envelope's `templateVersion` enum, then regen.
- Test: `artifacts/api-server/src/__tests__/superCostSummaryExport.test.ts` (new, real DB).

**Interfaces:**
- `CostSummaryTemplateRow` gains optional `totalCost`, `inboundCost`, `outboundCost`, `plantVariableCost`, `avgDistPlantToWh` and `avgDistWhToCustomer` (numbers; distances converted by the existing distance-dimension export logic at `:49`).
- `COST_SUMMARY_TEMPLATE_VERSION` becomes `5`.

- [ ] **Step 1: Failing test.**
  - Create a super scenario with the sample inputs (`SUPER_DEFAULT_INPUTS` + sample JSON via PATCH), solve it with the real job runner, and poll `GET .../solve-jobs/:jobId` until done.
  - `GET /api/scenarios/:id/export?entity=costSummary&format=json`, then:
    - assert `body.templateVersion === COST_SUMMARY_TEMPLATE_VERSION` — import the constant, **never** the literal `5` (CLAUDE.md gotcha);
    - assert the populated row has numeric `totalCost` and `plantVariableCost`;
    - validate the body with the regenerated `@workspace/api-zod` cost-summary envelope schema.
  - Same request with `format=csv`: assert the header contains `totalCost`, `plantVariableCost`, `avgDistPlantToWh` and `avgDistWhToCustomer`.
  - Clean up `solveJobsTable`, then the scenarios.
- [ ] **Step 2: Run.** Expected: FAIL (export rejects the model, or the columns are missing).
- [ ] **Step 3: Implement.**
  - Add the six optional fields to the row type and to `buildCostSummaryRows`, read from `result.metrics`.
  - Extend the CSV header/projector and the JSON projector. Distance fields go through the same unit conversion `weightedAvgDistance` uses.
  - Bump `COST_SUMMARY_TEMPLATE_VERSION` to `5` and the OpenAPI enum to `[5]` **in the same change**, add the six optional properties to `CostSummaryExportRow`, then regen.
  - Allow `costSummary` export for super in the route gating.
  - Grep every consumer of the version constant and fix any literal `4` in tests to reference the constant.
- [ ] **Step 4: Run** the test and `pnpm gate`. Expected: PASS.
- [ ] **Step 5: Changelog + commit** on `sm-4-cost-summary-export`: `[SM-4] add super-model cost-summary export columns and bump template version`, including the regenerated code.

---

### Task 5 [SM-5]: Solver-readiness precheck for `super-model`

Role: backend-engineer.

**Files:**
- Create: `artifacts/api-server/src/services/precheckSuper.ts`
- Modify: `artifacts/api-server/src/services/precheck.ts:1541-1564` (dispatch)
- Test: `artifacts/api-server/src/services/__tests__/precheckSuper.test.ts` (unit), and append one solve-route case to `superModelRegistration.test.ts`

**Interfaces:** `precheckSuperInputs(inputs: SuperInputs): PrecheckResult`, reusing `PrecheckError` codes `completeness | p_range | capacity | zero_demand | coefficient_range` (no new codes, so the OpenAPI enum is unchanged).

- [ ] **Step 1: Failing unit tests:**

```ts
import { precheckSuperInputs } from "../precheckSuper.js";
import { superInputsSchema } from "../../validation/inputs/superInputs.js";
import sample from "../../../../studio/public/samples/super-model-sample.json" with { type: "json" };
const S = (o: object) => superInputsSchema.parse({ ...sample, ...o });
const codes = (o: object) => precheckSuperInputs(S(o)).errors.map(e => e.code);

it("sample is ready", () => expect(precheckSuperInputs(S({}))).toEqual({ ok: true, errors: [] }));
it("empty tables -> completeness", () => expect(codes({ products: [], plantProducts: [], demand: [] })).toContain("completeness"));
it("no positive demand -> zero_demand", () => expect(codes({ demand: [] })).toContain("zero_demand"));
it("capacity below demand -> capacity", () =>
  expect(codes({ plantProducts: sample.plantProducts.map(r => ({ ...r, capacity: r.capacity > 0 ? 1 : 0 })) })).toContain("capacity"));
it("p above eligible warehouses -> p_range", () => expect(codes({ p: 26 })).toContain("p_range"));
it("forced-open above p -> p_range", () => expect(codes({ p: 1 })).toContain("p_range"));
```

  If the JSON-import-attribute syntax is not supported by this tsconfig, read the file with `readFileSync`.

- [ ] **Step 2: Run** the tests. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `precheckSuper.ts`:

```ts
import type { PrecheckError, PrecheckResult } from "./precheck.js";
import type { SuperInputs } from "../validation/inputs/superInputs.js";

export function precheckSuperInputs(v: SuperInputs): PrecheckResult {
  const errors: PrecheckError[] = [];
  const err = (code: PrecheckError["code"], message: string) => errors.push({ code, message });
  for (const t of ["products", "plants", "warehouses"] as const)
    if (v[t].length === 0) err("completeness", `Add at least one row to ${t}.`);
  const active = new Set(v.customers.filter(c => c.status !== "excluded").map(c => c.id));
  if (active.size === 0) err("completeness", "Add at least one active customer.");
  const demandBy = new Map<string, number>();
  for (const d of v.demand) if (active.has(d.customerId)) demandBy.set(d.productId, (demandBy.get(d.productId) ?? 0) + d.demand);
  if (![...demandBy.values()].some(x => x > 0)) err("zero_demand", "No active customer has positive demand.");
  const capBy = new Map<string, number>();
  for (const r of v.plantProducts) capBy.set(r.productId, (capBy.get(r.productId) ?? 0) + r.capacity);
  for (const [k, dem] of demandBy) if (dem > (capBy.get(k) ?? 0))
    err("capacity", `Product ${k}: total plant capacity ${capBy.get(k) ?? 0} is below total demand ${dem}.`);
  const eligible = v.warehouses.filter(w => w.status !== "inactive").length;
  const forced = v.warehouses.filter(w => w.status === "forced_open").length;
  if (v.p > eligible) err("p_range", `p = ${v.p} exceeds the ${eligible} warehouse(s) that can open.`);
  if (forced > v.p) err("p_range", `${forced} forced-open warehouses exceed p = ${v.p}.`);
  const t = v.transportCosts;
  if (![t.icTransCost, t.icMinTrans, t.obTransCost, t.obMinTrans, ...v.plantProducts.map(r => r.costPerUnit)].every(Number.isFinite))
    err("coefficient_range", "A cost coefficient is not a finite number.");
  return { ok: errors.length === 0, errors };
}
```

  Export `PrecheckError` and `PrecheckResult` from `precheck.ts` if they are not already exported. In `runNetworkEditsPrecheckForModel`, add `if (modelId === "super-model") return precheckSuperInputs(inputs as unknown as SuperInputs);` before the fallthrough.

- [ ] **Step 4: Solve-route test** (append to `superModelRegistration.test.ts`): create an empty super scenario, `POST /api/scenarios/:id/solve`, then expect 422, body `error` `"Network-edit precheck failed"`, and an `errors` array containing a `completeness` code. In `afterAll`, delete `solveJobsTable` rows by `scenarioId` first, as `jadeCoefficientPrecheckIntegration.test.ts` does.

- [ ] **Step 5: Run** the tests and `pnpm gate`. Then commit on `sm-5-precheck`: `[SM-5] add super-model solve-readiness precheck`.

---

### Task 6 [SM-6]: Network import/export endpoints (JSON; replace/merge; atomic)

Role: backend-engineer.

**Files:**
- Create: `artifacts/api-server/src/services/superNetwork.ts`
- Create: `artifacts/api-server/src/routes/superNetwork.ts`
- Modify: `artifacts/api-server/src/routes/index.ts:24-36` (mount before `scenariosRouter`)
- Modify: `artifacts/api-server/src/app.ts:71-73` (`IMPORT_BODY_PATH`, path-based; the `?mode=` query does not affect it)
- Modify: `artifacts/api-server/src/routes/scenarios.ts:165` (export `toApiScenario`)
- Modify: `lib/api-spec/openapi.yaml` (two paths and schemas), then regen
- Test: `artifacts/api-server/src/__tests__/superNetworkImport.test.ts`

**Interfaces:**
- `mergeNetwork(current: SuperInputs, doc: SuperNetworkDoc, mode: "replace" | "merge"): unknown`. The result is unvalidated next-inputs and goes to `applyScenarioInputWrite`, which validates.
- `superNetworkDocSchema`: every key of the super inputs optional; tables use `superTableSchemas`.
- OpenAPI operationIds `importScenarioNetwork` and `exportScenarioNetwork`. Generated hooks `useImportScenarioNetwork` and `useExportScenarioNetwork` (Task 9 consumes them).

- [ ] **Step 1: Failing tests** (real DB, same helpers as Task 3):

```ts
const sample = JSON.parse(readFileSync(path.join(root, "artifacts/studio/public/samples/super-model-sample.json"), "utf8"));
const imp = (id: number, body: { mode: string; network: object }, c = cookie) =>
  request(app).post(`/api/scenarios/${id}/network/import?mode=${body.mode}`).set("Cookie", c).send(body.network);

it("replace imports the full sample into an empty scenario", async () => {
  const id = await createEmptySuper();
  const res = await imp(id, { mode: "replace", network: sample });
  expect(res.status).toBe(200);
  expect(res.body.scenario.inputs.customers).toHaveLength(100);
});
it("replace empties tables absent from the document", async () => {
  const id = await createEmptySuper();
  await imp(id, { mode: "replace", network: sample }).expect(200);
  const res = await imp(id, { mode: "replace", network: { products: sample.products } });
  expect(res.body.scenario.inputs.customers).toEqual([]);
  expect(res.body.scenario.inputs.p).toBe(1); // absent param -> default
});
it("merge upserts by id and never deletes", async () => {
  const id = await createEmptySuper();
  await imp(id, { mode: "replace", network: sample }).expect(200);
  const renamed = { ...sample.customers[0], name: "Renamed" };
  const res = await imp(id, { mode: "merge", network: { customers: [renamed] } }).expect(200);
  expect(res.body.scenario.inputs.customers).toHaveLength(100);
  expect(res.body.scenario.inputs.customers.find((c: { id: string }) => c.id === renamed.id).name).toBe("Renamed");
});
it("a bad row writes nothing (atomic) and returns row-level errors", async () => {
  const id = await createEmptySuper();
  await imp(id, { mode: "replace", network: sample }).expect(200);
  const before = (await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie)).body.inputs;
  const res = await imp(id, { mode: "merge", network: { demand: [{ customerId: "ghost", productId: "product-1", demand: 1 }] } });
  expect(res.status).toBe(422);
  expect(JSON.stringify(res.body)).toContain("ghost");
  expect((await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie)).body.inputs).toEqual(before);
});
it("missing or bad mode -> 400", async () => {
  const id = await createEmptySuper();
  expect((await request(app).post(`/api/scenarios/${id}/network/import`).set("Cookie", cookie).send(sample)).status).toBe(400);
});
it("another user's scenario and a non-super scenario both 404", async () => {
  const id = await createEmptySuper();
  const other = await registerAndGetCookie();
  expect((await imp(id, { mode: "replace", network: sample }, other)).status).toBe(404);
  const jadeId = await createJade();
  expect((await imp(jadeId, { mode: "replace", network: sample })).status).toBe(404);
});
it("import marks a solved scenario stale", async () => {
  // seed result directly: db.update(scenariosTable).set({ result: {...minimal}, solvedAt: new Date(Date.now() - 1000) })
  // then import -> GET -> stale === true
});
it("export -> replace import round-trips identical inputs", async () => {
  const id = await createEmptySuper();
  await imp(id, { mode: "replace", network: sample }).expect(200);
  const exp = await request(app).get(`/api/scenarios/${id}/network/export?format=json`).set("Cookie", cookie).expect(200);
  const id2 = await createEmptySuper();
  const res = await imp(id2, { mode: "replace", network: exp.body }).expect(200);
  const a = (await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie)).body.inputs;
  expect(res.body.scenario.inputs).toEqual(a);
});
```

  `createEmptySuper` and `createJade` are local helpers in the test file that POST `/api/scenarios`: super with `SUPER_DEFAULT_INPUTS`, jade with the `jadeDefaults` literal from `jadeTransportCostsPersistence.test.ts`. Both push the new id to `scenarioIds`. The stale test must write the real `result`/`solvedAt` columns, not a hand-built API shape.

- [ ] **Step 2: Run** the tests. Expected: FAIL with 404s (route missing).

- [ ] **Step 3: `services/superNetwork.ts`:**

```ts
import { z } from "zod";
import { superParamSchemas, superTableSchemas, SUPER_DEFAULT_INPUTS, type SuperInputs } from "../validation/inputs/superInputs.js";

export const superNetworkDocSchema = z.object({
  ...Object.fromEntries(Object.entries(superParamSchemas).map(([k, s]) => [k, s.optional()])),
  ...Object.fromEntries(Object.entries(superTableSchemas).map(([k, s]) => [k, s.optional()])),
}).strict();
export type SuperNetworkDoc = z.infer<typeof superNetworkDocSchema>;

type Table = keyof typeof superTableSchemas;
const KEY: Record<Table, (r: Record<string, unknown>) => string> = {
  products: r => String(r.id), plants: r => String(r.id), warehouses: r => String(r.id), customers: r => String(r.id),
  plantProducts: r => `${r.plantId}|${r.productId}`, demand: r => `${r.customerId}|${r.productId}`,
  distanceOverrides: r => `${r.fromId}|${r.toId}`,
};

export function mergeNetwork(current: SuperInputs, doc: SuperNetworkDoc, mode: "replace" | "merge"): unknown {
  if (mode === "replace") return { ...SUPER_DEFAULT_INPUTS, ...doc };
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(doc)) {
    if (!(k in KEY)) { next[k] = v; continue; }                      // parameter: overwrite
    const key = KEY[k as Table];
    const rows = new Map((current[k as Table] as Record<string, unknown>[]).map(r => [key(r), r]));
    for (const r of v as Record<string, unknown>[]) rows.set(key(r), r);  // replace whole row or insert
    next[k] = [...rows.values()];
  }
  return next;
}
```

- [ ] **Step 4: `routes/superNetwork.ts`.** It follows the ownership pattern exactly (`and(eq(id), eq(userId))`, 404, `isModelLocked` before any write) and reuses `applyScenarioInputWrite` inside `db.transaction`:

```ts
import { Router, json } from "express";
import { and, eq } from "drizzle-orm";
import { db, scenariosTable } from "@workspace/db";
import { MAX_IMPORT_BYTES } from "@workspace/import-schema";
import { requireAuth } from "../middlewares/auth.js";          // same import scenarios.ts uses
import { isModelLocked, respondLocked } from "../middlewares/lockedModel.js";
import { applyScenarioInputWrite } from "../services/scenarioInputWrite.js";
import { superNetworkDocSchema, mergeNetwork } from "../services/superNetwork.js";
import { superInputsSchema } from "../validation/inputs/superInputs.js";
import { toApiScenario } from "./scenarios.js";                 // add `export` to toApiScenario (scenarios.ts:165) in this task
import { formatInputIssues } from "../validation/formatInputIssues.js"; // same helper validateInputs uses

const router = Router();
router.use(requireAuth);

async function loadOwnedSuper(id: number, userId: string) {
  const [row] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, userId)));
  return row && row.modelId === "super-model" ? row : null;   // non-super == not found (no enumeration)
}

router.post("/scenarios/:scenarioId/network/import", async (req, res, next) => {
  const id = Number(req.params.scenarioId);
  const row = Number.isInteger(id) ? await loadOwnedSuper(id, req.userId!) : null;
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (isModelLocked(row.modelId)) { respondLocked(res); return; }
  next();
}, json({ limit: MAX_IMPORT_BYTES }), async (req, res) => {
  const id = Number(req.params.scenarioId);
  const mode = req.query.mode;   // spec §7.1: mode is a query parameter; the body IS the network document
  if (mode !== "replace" && mode !== "merge") { res.status(400).json({ error: "mode must be replace or merge" }); return; }
  const doc = superNetworkDocSchema.safeParse(req.body);
  if (!doc.success) { res.status(422).json({ error: formatInputIssues(doc.error.issues) }); return; }
  const outcome = await db.transaction(async tx => {
    const [cur] = await tx.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!))).for("update");
    if (!cur) return { kind: "not_found" as const };
    const current = superInputsSchema.parse(cur.inputs);
    return applyScenarioInputWrite(tx, { scenarioId: id, userId: req.userId!, nextInputs: mergeNetwork(current, doc.data, mode) });
  });
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (outcome.kind === "invalid") { res.status(422).json({ error: outcome.error }); return; }
  res.json({ scenario: toApiScenario(outcome.row) });
});

router.get("/scenarios/:scenarioId/network/export", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const row = Number.isInteger(id) ? await loadOwnedSuper(id, req.userId!) : null;
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (req.query.format !== "json") { res.status(400).json({ error: "format must be json" }); return; }
  res.json(superInputsSchema.parse(row.inputs));
});

export default router;
```

  Match `applyScenarioInputWrite`'s real outcome discriminant (`kind`/`status`) by reading `scenarioInputWrite.ts:75-141`. Match the `requireAuth`, `formatInputIssues` and `toApiScenario` import paths by reading `scenarios.ts`'s imports. `applyScenarioInputWrite` re-selects `FOR UPDATE` itself; nested row locks in the same transaction are fine in Postgres.

  - `app.ts:71`: `const IMPORT_BODY_PATH = /^\/api\/scenarios\/[^/]+\/(?:import(?:\/apply)?|network\/import)\/?$/i;`
  - `routes/index.ts`: `router.use(superNetworkRouter);` before `scenariosRouter`.

- [ ] **Step 5: OpenAPI.**
  - Add path `/scenarios/{scenarioId}/network/import` with `post`, operationId `importScenarioNetwork`:
    - Query parameter `mode` (required, enum `[replace, merge]`). Request body: the network document (`type: object`), required.
    - Responses: 200 `{scenario: Scenario}`, 400, 404, 413 `PayloadTooLargeError`, 422 `{error: string}`.
  - Add path `/scenarios/{scenarioId}/network/export` with `get`, operationId `exportScenarioNetwork`:
    - Query `format` enum `[json]`.
    - Responses: 200 `application/json` object, 400, 404.
  - Run `pnpm --filter @workspace/api-spec run codegen`.

- [ ] **Step 6: Run** the tests and `pnpm gate` (re-check zero concurrent vitest first). Then commit on `sm-6-network-import`: `[SM-6] add super-model network import/export endpoints with replace and merge`.

---

### Task 7 [SM-7]: Studio input tabs (tables, cascade delete, distances, parameters)

Role: frontend-engineer.

**Files:**
- Create: `artifacts/studio/src/lib/superNetwork.ts`
- Create: `artifacts/studio/src/components/workspace/super/{SuperTableTab.tsx,superTables.tsx,SuperDistancesTab.tsx}`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (tab dispatch in `renderTabContent`, `pMax` at `:3232`)
- Test: `artifacts/studio/src/__tests__/superNetwork.test.ts`, `artifacts/studio/src/__tests__/SuperTableTab.test.tsx`, `artifacts/studio/src/__tests__/Workspace.Super.test.tsx`

**Interfaces:**
- `lib/superNetwork.ts`:
  ```ts
  export type SuperTable = "products" | "plants" | "warehouses" | "customers" | "plantProducts" | "demand" | "distanceOverrides";
  export function referencingRows(inputs: SuperInputsLike, table: "products"|"plants"|"warehouses"|"customers", id: string): number;
  export function cascadeDelete(inputs: SuperInputsLike, table: "products"|"plants"|"warehouses"|"customers", id: string): SuperInputsLike;
  ```
  `SuperInputsLike` is the generated `ScenarioInputs`-compatible record. Use `Record<string, unknown[]> & {…}` typed loosely, matching how other tabs type `localInputs`.
- `SuperTableTab` props: `{ table: SuperTable; rows: Record<string, unknown>[]; onChange(rows): void; onDelete?(row): void; readOnly: boolean; options?: { productIds?: string[]; plantIds?: string[]; customerIds?: string[] } }`.

- [ ] **Step 1: Failing unit tests** `superNetwork.test.ts`:

```ts
import { cascadeDelete, referencingRows } from "@/lib/superNetwork";
const inputs = {
  products: [{ id: "k" }], plants: [{ id: "p" }], warehouses: [{ id: "w" }], customers: [{ id: "c" }],
  plantProducts: [{ plantId: "p", productId: "k", capacity: 1, costPerUnit: 0 }],
  demand: [{ customerId: "c", productId: "k", demand: 1 }],
  distanceOverrides: [{ fromId: "p", toId: "w", miles: 1 }, { fromId: "w", toId: "c", miles: 1 }],
};
it("counts and removes everything a product references", () => {
  expect(referencingRows(inputs, "products", "k")).toBe(2);
  const n = cascadeDelete(inputs, "products", "k");
  expect(n.products).toEqual([]); expect(n.plantProducts).toEqual([]); expect(n.demand).toEqual([]);
  expect(n.distanceOverrides).toHaveLength(2);
});
it("warehouse delete removes overrides on both legs", () => {
  expect(referencingRows(inputs, "warehouses", "w")).toBe(2);
  expect(cascadeDelete(inputs, "warehouses", "w").distanceOverrides).toEqual([]);
});
it("plant and customer deletes", () => {
  expect(referencingRows(inputs, "plants", "p")).toBe(2);
  expect(referencingRows(inputs, "customers", "c")).toBe(2);
});
```

- [ ] **Step 2: Run** `pnpm --filter studio exec vitest run src/__tests__/superNetwork.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `lib/superNetwork.ts`:**

```ts
type Row = Record<string, unknown>;
export type SuperInputsLike = Record<string, unknown> & {
  products: Row[]; plants: Row[]; warehouses: Row[]; customers: Row[];
  plantProducts: Row[]; demand: Row[]; distanceOverrides: Row[];
};
export type SuperTable = "products" | "plants" | "warehouses" | "customers" | "plantProducts" | "demand" | "distanceOverrides";
type Entity = "products" | "plants" | "warehouses" | "customers";

const REFS: Record<Entity, Partial<Record<SuperTable, (r: Row, id: string) => boolean>>> = {
  products: { plantProducts: (r, id) => r.productId === id, demand: (r, id) => r.productId === id },
  plants: { plantProducts: (r, id) => r.plantId === id, distanceOverrides: (r, id) => r.fromId === id },
  warehouses: { distanceOverrides: (r, id) => r.fromId === id || r.toId === id },
  customers: { demand: (r, id) => r.customerId === id, distanceOverrides: (r, id) => r.toId === id },
};

export function referencingRows(inputs: SuperInputsLike, table: Entity, id: string): number {
  return Object.entries(REFS[table]).reduce((n, [t, hit]) => n + (inputs[t as SuperTable] as Row[]).filter(r => hit!(r, id)).length, 0);
}
export function cascadeDelete(inputs: SuperInputsLike, table: Entity, id: string): SuperInputsLike {
  const next = { ...inputs, [table]: inputs[table].filter(r => r.id !== id) } as SuperInputsLike;
  for (const [t, hit] of Object.entries(REFS[table]))
    (next as Record<string, Row[]>)[t] = (inputs[t as SuperTable] as Row[]).filter(r => !hit!(r, id));
  return next;
}
export const SUPER_SAMPLE_URL = "/samples/super-model-sample.json";
export const SUPER_TEMPLATE_URL = "/samples/super-model-template.json";
```

- [ ] **Step 4: Run** the test. Expected: PASS.

- [ ] **Step 5: `superTables.tsx`.** Column configs built from the existing `DataTable` `ColumnDef` (`components/data-table/types.ts`) and the cells in `data-table/entityCells.tsx`.
  - Text fields use a small text cell. If `entityCells.tsx` has none, add `DraftTextInput` there, mirroring `DraftNumberInput({value, parse, onCommit, disabled, testId})`.
  - Numbers use `DraftNumberInput`, status uses `StatusToggle`, references use a native `<select>`.
  - Column ids equal row keys; cell test ids follow `super-${table}-${rowKey}-${col}`.

  | table | columns |
  |---|---|
  | products | id (text), name (text) |
  | plants | id, name, city, state, lat (num), lng (num) |
  | warehouses | id, name, city, state, lat, lng, status (enum: active / forced_open / inactive via `StatusToggle`) |
  | customers | id, name, city, state, lat, lng, status (enum: active / excluded) |
  | plantProducts | plantId (select of plant ids), productId (select of product ids), capacity (num ≥ 0), costPerUnit (num ≥ 0) |
  | demand | customerId (select), productId (select), demand (num ≥ 0) |

  Row keys: `id` for entity tables, `plantId|productId` and `customerId|productId` for the two composite tables.

- [ ] **Step 6: `SuperTableTab.tsx`.** It renders `<DataTable rows columns rowKey toolbar={{ add }} />`.
  - "+ Add row" appends a blank row. Entity tables get `{ id: "", name: "", lat: 0, lng: 0, status: "active" }`; composite tables get the first available ids.
  - Every edit calls `onChange(nextRows)`; the workspace's Save validates server-side and shows its 422 via the existing `describeWriteError` toast.
  - Delete uses `DeleteRowButton`. Entity tables call `onDelete(row)`; composite tables filter the row out directly.
  - `readOnly` disables everything (`READ_ONLY_TITLE`).

  Test `SuperTableTab.test.tsx`, plain render as in `CapabilityMatrixTab.test.tsx`:
  - Editing a capacity cell calls `onChange` with the new number.
  - "+ Add row" appends one row.
  - A delete on `plantProducts` drops exactly that row.

- [ ] **Step 7: `SuperDistancesTab.tsx`.**
  - A method `<select data-testid="super-distance-method">` with "Straight line (haversine)" and "Straight line × circuity factor".
  - `<input type="number" min=1 max=3 step=0.01 data-testid="super-circuity-factor">`, enabled only for circuity.
  - A `SuperTableTab`-style table for `distanceOverrides` with columns fromId (select of plant + warehouse ids), toId (select of warehouse + customer ids) and miles (num > 0).
  - Helper text: "Pairs without an override use the method above. Overrides always win."

  Test: changing the method calls `onChange({ distanceMethod: "circuity" })`; the factor is disabled under haversine.

- [ ] **Step 8: Wire into `Workspace.tsx` `renderTabContent`.** For `modelId === "super-model"`, map each input entity id from Task 3's list:
  - `products|plants|warehouses|customers|plantProducts|demand` → `<SuperTableTab table={id} rows={localInputs[id]} onChange={rows => updateInputsField(id, rows)} onDelete={...} readOnly={isBrowsingHistoryNow} options={...} />`.
  - `onDelete` opens the existing confirm dialog primitive used elsewhere in Workspace (grep `AlertDialog`), titled `Delete ${id}?`, with body `This also deletes ${referencingRows(...)} referencing row(s).`. On confirm, `setLocalInputs(cascadeDelete(localInputs, table, id))`.
  - `distances` → `<SuperDistancesTab …/>`, writing `distanceMethod` / `circuityFactor` / `distanceOverrides` through `updateInputsField`.
  - `transportCosts` → reuse `TransportCostsTab` exactly as the jade call site at `:3853` does. Because super's `transportCosts` is required, Reset writes `{ ...TEXTBOOK_TRANSPORT_COSTS }` instead of `clearTransportCosts()`.
  - `optimization-parameters` → the existing `OptimizationParametersTab` with `showBandEditor={false}` (prop at `OptimizationParametersTab.tsx:148,260`); super has no distance bands.
  - `buildWholeInputPayload` (`Workspace.tsx:~2047`) currently injects `distanceBands: activeBandLens` into **every** save. Make it `modelId === "super-model" ? { ...(localInputs ?? {}) } : { ...(localInputs ?? {}), distanceBands: activeBandLens }`. The server schema would strip the key anyway; this keeps the client honest and is what the test asserts.
  - Test, in `Workspace.Super.test.tsx`: no band editor renders on Optimization Parameters, and the `mockUpdateScenario.mutate` payload's `inputs` has no `distanceBands` key.
  - On the `pMax` line (`:3232`, keep it one line) add an arm `modelId === "super-model" ? (localInputs.warehouses ?? []).filter(w => w.status !== "inactive").length :`.

- [ ] **Step 9: Workspace test** `Workspace.Super.test.tsx`. Copy `Workspace.Jade.test.tsx`'s mock setup verbatim, with model id `super-model`, the Task 3 manifest capabilities, `useGetScenario` returning a scenario whose inputs are the sample JSON, and the wouter path `/super-model`. Assert:
  - The nine sidebar input entries render.
  - Opening `sidebar-input-plantProducts` shows 16 rows.
  - Deleting `product-1` (confirm) leaves 0 demand rows for `product-1` and 12 plant-product rows.

- [ ] **Step 10: Gate + changelog + commit** on `sm-7-studio-inputs`: `[SM-7] add super-model input tabs with cascade delete`.

---

### Task 8 [SM-8]: Studio outputs (summary, compare, open warehouses, map, narrative)

Role: frontend-engineer.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` (single rows near the `JADE_MODEL_ID` block; compare rows near `:683-715`)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (`outputDataset` at `:3988`, `plants` prop `:4048`, location lookup `:4099`)
- Modify: `artifacts/studio/src/lib/resultNarrative.ts` (`MODELS` `:88-91` + branch)
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.Super.test.tsx`, `resultNarrative.test.ts`

- [ ] **Step 1: Failing test.** Render `CostSummaryTab` with `AllProviders` (`helpers/renderWithExportProvider.tsx`) and `modelId="super-model"`.
  - The result is a stored result fixture **captured from a real `solve_super` run**. Save it once to `artifacts/studio/src/__tests__/fixtures/superResult.json` with the command in Step 2. Do not hand-write it.
  - Assert these test ids and their formatted values:

    | Test id | Value |
    |---|---|
    | `cost-summary-value-objective` | `result.objective` |
    | `cost-summary-value-total-cost` | `metrics.totalCost` |
    | `cost-summary-value-total-inbound-transportation-cost` | `metrics.inboundCost` |
    | `cost-summary-value-total-outbound-transportation-cost` | `metrics.outboundCost` |
    | `cost-summary-value-total-plant-variable-cost` | `metrics.plantVariableCost` |
    | `cost-summary-value-weighted-avg-distance-plant-to-wh` | `metrics.avgDistPlantToWh` |
    | `cost-summary-value-weighted-avg-distance-wh-to-customer` | `metrics.avgDistWhToCustomer` |

  - Assert that no `cost-summary-rate-ic` row renders.
  - Compare: pass two super scenarios with results, toggle both, then assert `cost-summary-compare-total-cost-${id}` exists for each.

- [ ] **Step 2: Capture the fixture.** Run `python3 artifacts/api-server/src/solver/solve.py < <(python3 -c "import json;d=json.load(open('artifacts/studio/public/samples/super-model-sample.json'));d['modelType']='super_model';print(json.dumps(d))") > /tmp/raw.json`. Wrap the result in the stored-result shape the component expects (`objective`, `metrics`, `details`, `edges`, `runTimeSec`, `quality`, `solverUsed`), copying field names from an existing jade fixture under `src/__tests__/fixtures/`. Then run the test. Expected: FAIL.

- [ ] **Step 3: Implement.** In `CostSummaryTab`, add `const SUPER_MODEL_ID = "super-model";`.
  - For super, build the single-scenario `rows` as `[["Objective", …], ["Total Cost", money(m.totalCost)], ["Total Inbound Transportation Cost", money(m.inboundCost)], ["Total Outbound Transportation Cost", money(m.outboundCost)], ["Total Plant Variable Cost", money(m.plantVariableCost)], ["Weighted Avg Distance — Plant to WH", miles(m.avgDistPlantToWh)], ["Weighted Avg Distance — WH to Customer", miles(m.avgDistWhToCustomer)], …runtime, quality, solver rows unchanged]`.
  - Use the formatters this file already uses for cost and distance (grep `inboundCost` and `weightedAvgDistance` here), which also applies display rounding only at render.
  - Skip the generic inbound/outbound/weighted-average rows for super so lines are not duplicated.
  - Add the same seven keys via `pushRow` in compare mode, gated on `modelId === SUPER_MODEL_ID`.
  - `Workspace.tsx`: where jade folds plants into the output dataset (`:3988`, `:4048`, `:4099`), add a super arm that builds the same shapes from `activeOutputInputs` (`plants`, `warehouses`, `customers` rows carry `id`, `name`, `city`, `state`, `lat` and `lng` already) instead of `dataset`. The open-warehouses grid then works unchanged off `result.edges` and `metrics.openFacilityIds`.
  - `resultNarrative.ts`: add `"super-model"` to `MODELS` (`:88-91`) plus its **own** branch placed before the band-dependent code at `:122-137`. Jade's branch needs a largest band and returns null for super. The super narrative reads `metrics.openFacilityIds.length`, `metrics.totalCost`, `metrics.avgDistPlantToWh` and `metrics.avgDistWhToCustomer`, e.g. "Opened 2 warehouses. Total cost $254,060,828.62; plant→warehouse shipments average 412 mi and warehouse→customer deliveries 655 mi." Test it with the captured fixture and `bands: []`, asserting a non-null string containing the formatted total cost.

- [ ] **Step 4: Run** the tests and `pnpm gate`. Then commit on `sm-8-studio-outputs`: `[SM-8] add super-model summary, compare rows and output map wiring`.

---

### Task 9 [SM-9]: Studio import/export dialog, empty state, readiness panel, downloads

Role: frontend-engineer.

**Files:**
- Create: `artifacts/studio/src/components/workspace/super/SuperNetworkImportDialog.tsx`, `components/workspace/super/SuperReadinessPanel.tsx`
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (precheck `enabled` list `:1498-1507`; mount panel + dialog for super; export button)
- Test: `artifacts/studio/src/__tests__/SuperNetworkImportDialog.test.tsx`, `artifacts/studio/src/__tests__/SuperReadinessPanel.test.tsx`

**Interfaces:** Consumes `useImportScenarioNetwork` and `exportScenarioNetwork` (Task 6 generated client), precheck errors (`usePrecheckScenario`), and `SUPER_SAMPLE_URL` / `SUPER_TEMPLATE_URL` (Task 7).

- [ ] **Step 1: Failing dialog test.** Use the `ImportDialog.test.tsx` pattern: a real `QueryClient` with `retry: false`, and `global.fetch = fetchMock` routing on `url.endsWith("/network/import")`.
  - Choosing a JSON file with mode "Merge by ID" and confirming posts to `…/network/import?mode=merge` with the parsed file as the body and calls `onApplied(scenario)`.
  - On a non-empty scenario, "Replace all" first shows `super-import-confirm-overwrite`; confirming posts to `…?mode=replace`.
  - A 422 response renders its `error` text under `super-import-error`.
  - A file that is not JSON shows `super-import-file-error` and posts nothing.

- [ ] **Step 2: Run** the test. Expected: FAIL.

- [ ] **Step 3: Implement `SuperNetworkImportDialog`.**
  - Props: `{ open, onOpenChange, scenarioId, isEmpty: boolean, onApplied(scenario) }`.
  - Native `<input type="file" accept="application/json,.json" data-testid="super-import-file">`, read with `file.text()`, `JSON.parse` in try/catch.
  - Reject files larger than `MAX_IMPORT_BYTES` from `@workspace/import-schema`, the same check `ImportDialog` uses.
  - Radio `replace`/`merge` (`super-import-mode-replace` / `-merge`), default `replace` when `isEmpty`, else `merge`.
  - Confirm button `super-import-confirm`. Replace on a non-empty scenario shows an inline confirm step first: "This replaces every table in this scenario."
  - Errors use `describeWriteError` from `lib/describeWriteError.ts`.
  - Reuse the dialog primitives `ImportDialog.tsx` imports.

- [ ] **Step 4: Readiness panel test, then implementation.**
  - `SuperReadinessPanel` props `{ precheck?: { ok: boolean; errors: {code: string; message: string}[] }; isEmpty: boolean; onImport(): void }`.
  - When `isEmpty`, it shows the empty state: heading "Import a network to get started", button `super-open-import`, and links `super-download-template` (href `SUPER_TEMPLATE_URL`, `download`) and `super-download-sample` (href `SUPER_SAMPLE_URL`, `download`).
  - Otherwise it lists each precheck error message (`super-readiness-error-${i}`), or "Ready to solve" (`super-readiness-ok`).
  - Test both states and both download hrefs.

- [ ] **Step 5: Wire into Workspace.**
  - Add `modelId === "super-model"` to the precheck query `enabled` condition (`:1507`).
  - For super, render `SuperReadinessPanel` at the top of the Optimization Parameters tab. When the scenario is empty (all seven tables empty), also render it as the content of every input tab.
  - Add "Import network" and "Export network (JSON)" buttons to the super workspace header. Export fetches `exportScenarioNetwork(scenarioId, { format: "json" })` and saves it with the existing `helpers/download` utility (grep `downloadBlob` or similar in `lib/`).
  - `onApplied` → the existing `handleImportApplied(updated)`, which resets `localInputs` and invalidates queries.
  - The solve button stays wired as today; the server refuses with the precheck 422, which the existing solve error path already surfaces.

- [ ] **Step 6: Run** the tests and `pnpm gate`. Then commit on `sm-9-studio-import`: `[SM-9] add super-model network import, export and readiness panel`.

---

### Task 10 [SM-10]: Real-browser QA (Playwright) and sibling-spec sweep

Role: qa-sdet (exempt from the simplicity skills).

**Files:**
- Create: `artifacts/studio/e2e/super-model.spec.ts`
- Modify: any sibling spec the grep in Step 3 finds

- [ ] **Step 1: Spec.** Follow `e2e/jade-two-echelon.spec.ts`: `import { test, expect } from "./fixtures"`, `test.use({ actionTimeout: 15_000 })`, register a fresh user through `page.request`.
  - **Test A — home to imported network:**
    1. Go to `/`.
    2. Assert `landing-card-super-model` shows "SM" and click it.
    3. Create a scenario through the UI.
    4. The empty state is visible; `super-download-sample` has the sample href.
    5. Open import, set the sample file (`page.setInputFiles("[data-testid=super-import-file]", "public/samples/super-model-sample.json")`), choose replace, confirm.
    6. Customers tab shows 100 rows; readiness shows `super-readiness-ok`.
  - **Test B — solve:**
    1. Solve.
    2. Wait for the result (reuse `helpers/solvedAt.ts`).
    3. Assert `cost-summary-value-objective` contains `254,060,828` and the open-warehouses grid lists exactly wh-11 and wh-14.

    The repo rule is to seed solver results and leave CBC timing to pytest, but this solve is ~seconds and is the only real-browser proof that the solver path works end to end. Tag the test `@slow` if the existing tag convention has one; otherwise keep it, and if it flakes record it in `docs/superpowers/flake-registry.md`.
  - **Test C — editing:**
    1. Delete a product.
    2. Assert the confirmation states the referencing row count, and confirm.
    3. Save, reload, and assert the deletion persisted.

- [ ] **Step 2: Run.** Start both local servers per `artifacts/studio/e2e/CLAUDE.md`, then run `E2E_BASE_URL=http://localhost:<studio-port> pnpm --filter studio exec playwright test e2e/super-model.spec.ts`. Expected: PASS. **Never omit `E2E_BASE_URL`**; without it the run tests the remote Replit deployment.

- [ ] **Step 3: Sibling sweep.** Grep `artifacts/studio/e2e/` for every test id and visible string this bundle changed: Landing `chapterNumber` output, `entityIcons`, `inputEntriesForModel`. Run `E2E_BASE_URL=… pnpm e2e:gate`. Rewrite any broken sibling spec to the new UI and re-run until green.

- [ ] **Step 4: Commit** on `sm-10-qa`: `[SM-10] add super-model real-browser e2e coverage`.

---

### Task 11 [SM-11]: Close-out

Role: lead.

- [ ] Run the full gate once more on the integrated branch (`pnpm gate`, `e2e_accuracy.py` 99/99, `E2E_BASE_URL=… pnpm e2e:gate`), with zero concurrent vitest processes.
- [ ] Check `docs/CHANGELOG-implementation.md` has one entry per task with SHAs, gate counts and the Task 2 timing measurements. Move deferred items (Phase 2, Phase 3) to its "next" line.
- [ ] Fold the plan-review spec corrections into the spec in this close-out commit:
  - §3.1: the dataset endpoint is `GET /api/dataset?modelId=super-model`.
  - §5: costs are stored at cents (2 dp) and summed from unrounded values; average distances are unrounded; display rounds.
  - §6: template/sample downloads live in the workspace empty state.
  - §4.2/§3.2: `road` is rejected until Phase 3.
- [ ] Run `/harness-retro SM`.
- [ ] Invoke `superpowers:finishing-a-development-branch`, then **stop and ask the user for merge approval** (CLAUDE.md Branch discipline step 3). Merging, the whole-branch review, pushing and deploying are four separate approvals.
- [ ] Deploy note for later: this phase touches no `lib/db/src/schema/**` (the network lives in `inputs` jsonb) and adds no env var. Confirm with `pnpm deploy:preflight -- <deployed-sha>..HEAD` when deploy approval is requested.

---

## Self-review

- **Spec coverage:**

  | Spec section | Task(s) |
  |---|---|
  | §3.1 package | T3 |
  | §3.2 inputs | T3 |
  | §3.3 rules | T3 schema, T2 caps timing |
  | §3.3 normalization | T3: no `normalizeAddedEntityDistances` branch, falls through by design |
  | §3.3 staleness | T6 test; `applyScenarioInputWrite` bumps on any non-band change |
  | §4.1 | T1 |
  | §4.2 | T2 |
  | §5 summary | T1 metrics + result contract, T4 cost-summary export contract, T8 UI |
  | §5 Compare | T8 |
  | §6 home | T3 Landing |
  | §6 tabs | T7 |
  | §6 cascade | T7 |
  | §6 readiness | T5 + T9 |
  | §6 empty state and downloads | T9 |
  | §7.1/7.3 JSON | T6 + T9 |
  | §10 tests | T1–T10 |

  Phase 2/3 items (§7.2 CSV/XLSX, §8 ORS) are out of this plan by design.

- **Deviation from spec §6:** blank-template and sample downloads sit in the workspace empty state, not on the home card. Landing cards are whole-card `<Link>`s, so a nested download link would be invalid HTML. Recorded here; flag it to the user at plan review.
- **Type consistency:**
  - The `superTableSchemas` / `superParamSchemas` / `SUPER_DEFAULT_INPUTS` names are used identically in T3, T5 and T6.
  - Metric keys `plantVariableCost`, `totalCost`, `avgDistPlantToWh` and `avgDistWhToCustomer` are identical in T1, T4 and T8.
  - Wire value `super_model` is identical in T3 and T4.
  - Table ids `plantProducts`, `demand` and `distanceOverrides` are identical in the schema (T3), the tabs (T3/T7) and the merge keys (T6).
- **Known reads the implementer must do (not placeholders — exact files are named):** the outcome discriminant of `applyScenarioInputWrite`, `computeSha256`'s signature, `scenarios.ts` import paths, and the CostSummary formatter names. Each step says what to match.

## Plan review log

Codex (high effort) reviewed this plan on 2026-10-23. All 14 findings were folded in:

| # | Finding | Resolution |
|---|---|---|
| 1 | Contract sequencing | Metrics contract moved into T1 |
| 2 | Cost-summary export contract missing | T4 rewritten as that contract |
| 3 | `mode` was in the body | Moved to a query parameter (T6) |
| 4 | Override distances not finite | `.finite()` + test (T3) |
| 5 | `road` inconsistent | Rejected in Phase 1 + test (T3); spec note (T11) |
| 6 | Rounding vs. unrounded summary | Cents for costs, unrounded distances, cent tolerances |
| 7 | Band editor and band save path | Hidden, and save path skips bands (T7) |
| 8 | Narrative returns null | Own super branch (T8) |
| 9 | Dataset version bump | Superseded by `SOLVER_CODE_HASH`, now extended to `merge_inputs.py` (T2) |
| 10 | import-schema `MODEL_IDS` | Updated (T3) |
| 11 | ESM `__dirname` | `fileURLToPath` (T1) |
| 12 | `toApiScenario` export left optional | Explicit export (T6) |
| 13 | Dataset endpoint wording | Spec fix (T11) |
| 14 | Studio paths | Normalized to repo-root-relative |

Areas Codex did not cover were checked by the lead:
- **Solver math:** the tiny-network expectations were hand-verified — averages 100 and 150 mi, +1000 plant cost, P2 sourcing, the shortfall reaching the capacity reason.
- **Zod:** 3.25 (`z.ZodIssueCode.custom` valid).
- **Task ordering:** dispatcher and TS registration land together in T3.
