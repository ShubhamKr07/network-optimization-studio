# Chapter 9 — JADE Multi-Product Two-Echelon Model Integration — Design Spec

**Date:** 2026-09-13
**Model id:** `two-echelon-jade-us`
**Source:** `JADE_case_Chapter_9_Network_Design_Book.ipynb` (Watson et al., *Supply Chain Network Design*, Ch. 9, "Investment Decision Case Study")
**Status:** design — awaiting user review before plan

---

## 1. Goal

Integrate the Chapter 9 JADE case as the 5th solvable model in Network Optimization Studio: a **multi-product, two-echelon (plant → warehouse → customer), single-source facility-location** problem over the US. Full-stack in one bundle — dataset package, solver, contract, registry, and full tabbed Workspace UI including a **plants echelon**, a **products axis**, a **plant×product capability matrix editor**, and full Phase-B scenario-local network editing — then pass the in-browser verify gate and **unhide** from Landing.

This is the largest single integration to date: it adds two structural dimensions no existing model has (a plants echelon *and* a products axis), a novel capability-matrix editor, and full Phase-B parity, together. It will be executed as one plan across several agent-team waves. If a wave reveals the bundle is too large to stay coherent, the orchestrator surfaces a split rather than pushing through.

## 2. Model definition (faithful to the notebook)

### 2.1 Sets
- **Plants** `P` (4): each has a location; Plant 4 ("Long Beach – Imports") is the "China" import port referenced in the case questions.
- **Products** `K` (4): Product Family 1–4.
- **Warehouses (candidates)** `W` (25): id, name, city, state, zip, lat, lon. Uncapacitated (no per-warehouse throughput limit — capacity in this model lives on plants).
- **Customers** `C` (100): id, name, city, state, zip, lat, lon; per-(customer, product) demand in tons.

### 2.2 Data (exact, extracted from `get_data()`)
- `customer_demands[(c,k)]` — 400 entries (100×4); Σ = **1,545,308 tons**.
- `plant_wh_distance[(p,w)]` — 100 entries (4×25), miles.
- `wh_cust_distance[(w,c)]` — 2500 entries (25×100), miles.
- `plant_product_capability[(p,k)]` — capacity; notebook ships diagonal (plant *i* makes product *i*), value `210000000` (effectively uncapacitated) when a plant can make a product, `0` otherwise.

### 2.3 Cost coefficients
- Outbound (wh→customer) transport rate `ob_trans_cost = 0.12` per ton-mile; min charge `ob_min_trans = 10` per ton.
- Inbound (plant→wh) transport rate `ic_trans_cost = 0.07` per ton-mile; min charge `ic_min_trans = 10` per ton.
- Effective per-unit lane cost applies the min charge: `cost(a,b) = max(rate * distance(a,b), min_charge)` — i.e. below `min_charge/rate` miles the flat min charge governs.

### 2.4 Decision variables
- `flow_pw[p,w,k]` ≥ 0 continuous — tons of product `k` shipped plant `p` → warehouse `w`.
- `flow_wc[w,c,k]` ∈ {0,1} — assignment fraction of customer `c`'s product-`k` demand served from warehouse `w` (binary; single-source forces integrality per customer).
- `facility[w]` ∈ {0,1} — warehouse `w` open.
- `single_source[w,c]` ∈ {0,1} — warehouse `w` serves customer `c` (across all products).

### 2.5 Constraints
1. **Serve every (customer, product) with positive demand:** `Σ_w flow_wc[w,c,k] = 1`.
2. **Flow conservation at warehouse per product:** `Σ_c flow_wc[w,c,k]·demand[c,k] − Σ_p flow_pw[p,w,k] = 0`.
3. **Plant-product capacity:** `Σ_w flow_pw[p,w,k] ≤ capability[p,k]`.
4. **Open-if-used (big-M):** `Σ_{c,k} flow_wc[w,c,k] − facility[w]·10000000 ≤ 0`.
5. **Exactly P open:** `Σ_w facility[w] = number_of_whs`.
6. **Force open/close bounds:** `facility[w] ≥ lower[w]`, `facility[w] ≤ upper[w]` where `(lower,upper) ∈ {(0,1) solver-picks, (1,1) forced-open, (0,0) forced-closed}`.
7. **Single-source tie:** `flow_wc[w,c,k] − single_source[w,c] ≤ 0`; and `Σ_w single_source[w,c] ≤ 1` (one warehouse per customer across all products).

### 2.6 Objective (minimize)
`Σ flow_pw[p,w,k]·icCost(p,w) + Σ flow_wc[w,c,k]·obCost(w,c)·demand[c,k]`
where `icCost`/`obCost` apply the min-charge rule of §2.3.

### 2.7 Ground truth (hard-rule-2 anchor)
Notebook `scenario_1`: `number_of_whs = 2`, warehouse **11 (Phoenix)** and **14 (New York)** forced open (`(1,1)`), all others `(0,1)`, capability diagonal, bands `[200,400,800,1600]`.
Result: **`Status: Optimal`, `Objective: 254060828.6157...`**. This exact configuration and objective becomes the `e2e_accuracy.py` anchor.

**Binary can-make consequence:** the capability editor toggles each cell between `0` and `210000000`. The default (diagonal-on) reproduces the notebook exactly, so the accuracy anchor holds regardless of the UI simplification.

## 3. Dataset package

`solvers/two-echelon-jade-us/dataset/`:
- `plants.json` — `[{id, name, city, state, lat, lon}]` (4)
- `products.json` — `[{id, name}]` (4)
- `warehouses.json` — `[{id, name, city, state, zip, lat, lon, status}]` (25)
- `customers.json` — `[{id, name, city, state, zip, lat, lon, demands: {productId: tons}}]` (100)
- `plant_wh_distance.json` — index/id-keyed distance map (100)
- `wh_cust_distance.json` — index/id-keyed distance map (2500)
- `plant_product_capability.json` — `[{plantId, productId, capacity}]` (diagonal, 4 on-cells)
- `version.json` — sha256 + version (via `lib/dataset-schema`)

**Extraction:** one-off script imports the notebook's `get_data()` as a module and serializes — no hand-retyping (same method as C1.1 / Ch10 M0). This is its own id namespace; **not** a reuse of `p-median-us` (different ids, per-product demand, plants, two distance matrices).

## 4. Solver

New `solve_jade()` in `solve.py`, dispatched by `modelId == "two-echelon-jade-us"`. Faithful port of §2. All scenario edits enter as **variable bounds / coefficient changes**, never new if/else code paths (hard rule 6):
- P → the `= number_of_whs` constraint rhs.
- force open/close → `facility[w]` lower/upper bounds.
- capability toggles → `capability[p,k]` value (`0` / `210000000`).
- customer exclusion → drop from served/flow terms (demand treated absent).
- added entities / distance overrides → extra rows in the sets and the distance maps.

`merge_inputs.py` bridge extends to build the JADE payload: base dataset ∪ `addedPlants`/`addedWarehouses`/`addedCustomers`, with `distanceOverrides` and `plantProductCapability` overrides applied over the base maps, plus force-status and exclusions.

Envelope (`resultEnvelope.ts` / `_envelope()`):
- `edges[]` carry `leg ∈ {plant_to_warehouse, warehouse_to_customer}` (two **new** enum values), `fromId`/`toId`/`distance`/flow.
- `metrics`: `objective`, `avgDistanceByLeg`, open-warehouse count, total demand, inbound vs outbound cost split.
- `status`, `runTimeSec`, `quality`, `solverUsed`, `infeasibilityReason` as for all models. Wrapper never throws (degrades to `{status:"error", ...}`).

## 5. Contract / schema

- **OpenAPI** (`lib/api-spec/openapi.yaml`) + orval regen (spec + generated in one commit, hard rules 1/4):
  - `modelId` enum gains `two-echelon-jade-us`.
  - `Edge.leg` gains `plant_to_warehouse`, `warehouse_to_customer`.
  - `exportScenario` `entity` enum gains `plants`, `flows` (the third validation layer C6.1 flagged — do not miss it).
  - New `Plant` schema; `ModelInfo.capabilities` gains `supportsPlantProductCapability: boolean` (default false for other models).
  - `SolveMetrics.avgDistanceByLeg` already exists (Ch10) — reused.
- **Zod inputs** — `artifacts/api-server/src/validation/inputs/jadeInputs.ts` behind `validateInputsForModel`:
  - `p` (int ≥ 1 ≤ 25), `distanceBands` (4 ascending), `gap` (≥0), `timeLimitSec` (>0).
  - `warehouseOverrides[]` — **status only** (`potential|forced_open|inactive`); **no warehouse capacity field** (uncapacitated model).
  - `customerOverrides[]` — demand overrides (per product) + `status` (active/excluded).
  - `plantProductCapability[]` — sparse `{plantId, productId, enabled}` overrides on the diagonal default.
  - Phase-B: `addedPlants[]`, `addedWarehouses[]`, `addedCustomers[]`, `distanceOverrides[]` (composite-key, both legs).
- **Manifest** (`solvers/two-echelon-jade-us/manifest.json`) + `lib/dataset-schema` registration:
  - `supportsP: true`, `supportsFacilityStatus: true`, `supportsCapacityMode: false`, `supportsPlantProductCapability: true`, `supportsReferenceDistances: true`, `supportsAddedCustomerExclusion: true`.
  - `outputGrids: ["openWarehouses","assignments","flows","costSummary","serviceStats"]`.
  - `countryBounds` = US (computed from dataset lat/lon).

## 6. Frontend (tabbed Workspace)

New **plants echelon** and **products axis** thread through the Workspace. Registration follows `model-integration-precheck.md` Gate 1 (10 points) — run explicitly at every new entity/model point (this repo's most-documented recurring bug class).

**Input tabs:**
- Warehouses — id, city/state, lat/lon, zip, status select (no capacity column).
- Customers — id, city/state, lat/lon, zip, per-product demand, active/excluded.
- **Plants (new)** — id, city/state, lat/lon (read-only base + added rows).
- **Capability Matrix (new)** — 4×4 (plant × product) checkbox grid; each cell toggles can-make.
- Optimization Parameters — P, distance bands, optimization gap, max time.
- Input Map — plant (square) + warehouse (triangle) + customer (circle) markers; click-to-place add-entity flow (all three entity types); no lanes.
- Distances — reference (base) + editable overrides for both legs (paginated, filtered), gated by `supportsReferenceDistances`.

**Output tabs:**
- Output Map — one map, layer toggles (plant→wh lanes, wh→customer lanes, markers), routes leg-colored (extend the two-echelon leg palette to the two new leg values); floating objective + weighted-distance overlay.
- Open Warehouses — open set + total demand served.
- Customer Assignments — single-source customer → warehouse.
- **Flows (new/extended)** — plant → warehouse inbound tons, per product.
- Solution Summary — inbound vs outbound cost split, objective, weighted avg distance.
- Service Stats — outbound (wh→customer) distance-band coverage.

**Maps decision (confirmed):** the notebook's 4 static HTML maps (input / inbound / outbound / combined) collapse to the app's **Input Map + Output Map** tabs; inbound-only / outbound-only / combined are Output-Map layer-toggle states, not separate tabs — consistent with every other model and strictly more interactive.

**Added-entity distance estimation:** `services/autoDistance.ts` extended for the plants echelon — added plant↔warehouse and added warehouse↔customer legs get estimated (circuity-adjusted haversine, same family as existing estimators). Added-entity rows never touch base dataset files (DD-1). Only added-entity distances are estimated, so `e2e_accuracy` (base data) is unaffected.

**Chapter registration:** `lib/chapters.ts` gains `two-echelon-jade-us` → `/chapter-9/jade`, chapter "Chapter 9", `workspace: true`, title "JADE Network — Multi-Product Two-Echelon". Initially `hiddenFromLanding: true`; flipped off after the verify gate.

## 7. Verification

- `e2e_accuracy.py` — add the JADE anchor (§2.7): forced Phoenix(11)+NY(14), P=2 → `Optimal`, objective `254060828.6157`. Sacred thereafter (hard rule 2). Note: `e2e_accuracy.py` is a standalone script, run directly (`python3 e2e_accuracy.py`), not via `pytest tests/`.
- `test_jade.py` (pytest) — capability toggle changes the solution; single-source holds (one wh per customer); plant-product capacity binds; min-charge applies below the breakpoint distance; excluded customer absent from assignments; force open/close honored.
- TS: registry test (drop-in manifest appears), Zod validation tests, `resultEnvelope` leg-value test, route/export tests (`plants`/`flows` entities), pmedian/merge translation tests.
- Frontend: RTL for the capability matrix, plants tab, leg-colored output map, output grids; `Workspace.TabCoverage` sweep extended to the new model.
- **QA (standing, in-plan by default):** `qa-sdet` real Playwright spec against local dev servers — create/solve a JADE scenario, toggle a capability cell and confirm the solution changes, verify leg-colored routes + layer toggles, output grids, capability matrix persistence. No product bugs before merge.

**Full verification gate** (must be green before unhide):
`pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)` plus `python3 e2e_accuracy.py` (87/87 + new JADE anchor) and the Playwright QA spec.

## 8. Execution & rollout

- **Method:** agent-team (standing default per user), waved with single-writer serialization on shared files (`openapi.yaml`, `manifest`/`ManifestSchema`, `solve.py`, `Workspace.tsx`, `chapters.ts`) and the two-lane concurrency model (api-server/lib ⊥ studio).
  - **W1** — dataset extraction + package, manifest + `lib/dataset-schema` registration, registry, OpenAPI contract + codegen.
  - **W2** — `solve_jade()` + `merge_inputs.py` bridge + envelope leg values (solver lane) ∥ Zod inputs + route/export wiring (api-server lane).
  - **W3** — frontend: chapters registration, input tabs (incl. Plants + Capability Matrix), Input/Output maps + leg palette, output grids (incl. Flows), Phase-B added-entities + distance overrides, `autoDistance` plants extension.
  - **W4** — QA (Playwright) + solver/e2e_accuracy anchor + full-gate re-verification.
- **Docs:** this spec merged to local main on creation; plan merged on creation; re-merged after review (per standing memory).
- **Rollout:** after the full gate + in-browser verify gate pass, flip `hiddenFromLanding` off, commit, push, deploy `nos-studio` + `nos-api` (manual `trigger_deploy` — Render autoDeploy never fires on its own for this repo), live-verify on production, clean up test accounts.

## 9. Open items / risks

- **Scope size** — biggest integration to date; W3 (frontend) is the heaviest. Orchestrator surfaces a split if a wave loses coherence.
- **Products axis in grids** — single-source makes customer assignment product-independent (one wh per customer); only inbound flows and demand are per-product. Grids reflect this (assignment = one row/customer; flows = per plant-wh-product).
- **`e2e_journey.py`** remains non-runnable (legacy `/login`) — not used as a gate; do not treat as coverage.
- **Recurring gate bug class** — every per-model gate/allowlist (header title, constraints panel, output-grid gating, map multi-select, legend, added-section capability gate) must be extended for `two-echelon-jade-us`; `model-integration-precheck.md` Gate 1 is the checklist.
