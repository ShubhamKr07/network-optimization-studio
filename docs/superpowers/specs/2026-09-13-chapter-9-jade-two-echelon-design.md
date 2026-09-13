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

### 2.1 Sets and canonical IDs
- **Plants** `P` (4): each has a location; Plant 4 ("Long Beach – Imports") is the "China" import port referenced in the case questions.
- **Products** `K` (4): Product Family 1–4.
- **Warehouses (candidates)** `W` (25): id, name, city, state, zip, lat, lng. Uncapacitated (no per-warehouse throughput limit — capacity in this model lives on plants).
- **Customers** `C` (100): id, name, city, state, zip, lat, lng; per-(customer, product) demand in tons.

The notebook's integer IDs are **not safe wire IDs**: plants 1–4 overlap customers 1–4, plants 1–3 overlap warehouses 1–3, and all 25 warehouse IDs overlap customer IDs. Extraction therefore re-keys every entity into one globally unique namespace:

- plants: `plant-1`…`plant-4`
- products: `product-1`…`product-4`
- warehouses: `wh-<notebook-id>` (for example `wh-11`)
- customers: `customer-<notebook-id>` (for example `customer-11`)

Each entity also retains its integer notebook ID as display-only `sourceId`. Every dataset join, scenario input, result edge, import/export row, and UI identity uses the canonical string `id`, never `sourceId`, city, array position, or an unqualified notebook integer.

### 2.2 Data (exact, extracted from `get_data()`)
- `customer_demands[(c,k)]` — 400 entries (100×4); Σ = **1,545,308 tons**.
- `plant_wh_distance[(p,w)]` — 100 entries (4×25), miles.
- `wh_cust_distance[(w,c)]` — 2500 entries (25×100), miles.
- `plant_product_capability[(p,k)]` — 16 entries (4×4); the notebook ships four diagonal cells at `210000000` (effectively uncapacitated) and twelve off-diagonal cells at `0`.

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
Notebook `scenario_1`: `number_of_whs = 2`, warehouse **11 (Phoenix)** and **14 (New York)** forced open (`(1,1)`), all others `(0,1)`, capability diagonal, bands `[200,400,800,1600]`. The canonical package/payload expresses those facilities as `wh-11` and `wh-14` while preserving notebook IDs in `sourceId`.
Result: **`Status: Optimal`, `Objective: 254060828.6157...`**. This exact configuration and objective becomes the `e2e_accuracy.py` anchor.

**Binary can-make consequence:** the capability editor toggles each cell between `0` and `210000000`. The default (diagonal-on) reproduces the notebook exactly, so the accuracy anchor holds regardless of the UI simplification.

**Distance-band consequence:** the notebook contains plant→warehouse distances up to `2907.302` miles and warehouse→customer distances up to `3219.9609` miles. Respectively 34/100 and 825/2500 base pairs exceed the last default band (`1600`). The port therefore uses an explicit overflow bucket (`band: -1`) rather than folding an out-of-range lane into the last band. Service Stats reports cumulative outbound-demand coverage for the four boundaries plus a separately labelled `> 1600 mi` overflow row; Output Map applies the same four bands plus overflow independently to both displayed legs.

## 3. Dataset package

`solvers/two-echelon-jade-us/dataset/` (record maps keyed by canonical ID, matching the existing package convention):
- `plants.json` — `{id: {id, sourceId, name, city, state, lat, lng}}` (4)
- `products.json` — `{id: {id, sourceId, name}}` (4)
- `warehouses.json` — `{id: {id, sourceId, name, city, state, zip, lat, lng}}` (25); scenario status does not live in immutable base data
- `customers.json` — `{id: {id, sourceId, name, city, state, zip, lat, lng, demand, demands: {productId: tons}}}` (100), where scalar `demand` is the sum of the four product demands for shared map sizing/legacy consumers
- `distances.json` — single composite-key distance map matching the existing package convention (Ch10 uses one `distances.json` mixing both legs): keys `"plantId,warehouseId"` (100 inbound) and `"warehouseId,customerId"` (2500 outbound), 2600 entries total. One file, not two — the existing `data/referenceDistances.ts` loader + `GET /models/:id/reference-distances` endpoint read a single `distances.json`; keeping one file avoids touching that shared loader. Leg is derived from which id-namespace each endpoint belongs to (and surfaced as `ReferenceDistancePair.leg`), not from separate files.
- `plant_product_capability.json` — all 16 `{plantId, productId, capacity}` cells (four at `210000000`, twelve at `0`)
- `version.json` — sha256 + version (via `lib/dataset-schema`)

**Extraction:** a committed one-off script accepts the supplied notebook path, reads the `.ipynb` as JSON, finds `get_data()`, and literal-parses its data assignments without executing notebook cells. It must never import/execute the notebook: its top level contains `!pip install`, solver execution, file writes, and Plotly generation. The script canonicalizes IDs as above, serializes the package, and asserts entity/pair counts, global canonical-ID uniqueness, coordinates, total demand `1545308`, per-product totals, distance extrema, all 16 capability cells, and the package hash. The generated canonical package is committed; the out-of-tree notebook is provenance, not a runtime/build dependency. This package is **not** a reuse of `p-median-us` (different canonical ids, per-product demand, plants, and a two-leg distance space — 2600 pairs across both leg key-namespaces in one `distances.json`).

## 4. Solver

New `solve_jade()` in `solve.py`. `buildPayload()` maps public `modelId: "two-echelon-jade-us"` to internal `modelType: "two_echelon_jade"`; `solve(inp)` dispatches that `modelType`, matching the existing Python boundary. Today `solve()` ends in a `return solve_pmedian(inp)` catch-all; JADE adds a `model_type == 'two_echelon_jade'` branch and replaces the catch-all with an explicit `p_median` branch + unknown→error envelope. **Verified safe:** `buildPayload` (`pmedian.ts:153`) sets `modelType` explicitly for every model (`p_median`/`capacitated_pmedian`/`transport`/`two_echelon`), so no live payload relies on the catch-all — only a genuinely malformed/legacy payload now errors instead of silently p-median-ing. Recorded as a deliberate shared-dispatcher change in that commit. Faithful port of §2. All scenario edits enter as **variable bounds / coefficient changes**, never new if/else code paths (hard rule 6):
- P → the `= number_of_whs` constraint rhs.
- force open/close → `facility[w]` lower/upper bounds.
- capability toggles → `capability[p,k]` value (`0` / `210000000`); the solver builds the full effective plant×product cross-product, so an absent/off-diagonal base cell can be enabled by a scenario.
- customer exclusion → drop from served/flow terms (demand treated absent).
- added entities / distance overrides → extra rows in the sets and the distance maps.

`merge_inputs.py` bridge extends to build the JADE payload: base dataset ∪ `addedPlants`/`addedWarehouses`/`addedCustomers`, with leg-discriminated `distanceOverrides` and `plantProductCapability` overrides applied over the base maps, plus force-status and exclusions. All merges are per-call and non-mutating.

Envelope (`resultEnvelope.ts` / `_envelope()`):
- `edges[]` carry `leg ∈ {plant_to_warehouse, warehouse_to_customer}` (two **new** enum values), `fromId`/`toId`/`distance`/`flow`, and optional `productId`.
  - Inbound: one edge per positive `(plant, warehouse, product)` flow; `productId` is required.
  - Outbound: one edge per customer, aggregated across that customer's four products; single-source guarantees one serving warehouse, and `flow` is total served tons. `productId` is absent. This prevents duplicate map lines/assignment rows while preserving product detail where the Flows grid needs it.
- `metrics`: existing `avgDistanceByLeg`, `weightedAvgDistance`, `bandCoverage`, plus optional typed `openFacilityIds`, `totalDemand`, `inboundCost`, and `outboundCost`. Objective remains the envelope's existing top-level `objective`, not a duplicate metric. `openFacilityIds` is authoritative even for an open warehouse with zero outbound flow.
  - **`utilizationByNode` is undefined for JADE** — warehouses are uncapacitated (§2.1), so a utilization % has no denominator. For JADE, `utilizationByNode` carries **demand served** per open warehouse (tons), not a percentage; the Open Warehouses grid renders "Demand served" (tons), never a "%" column. The generic percentage-utilization column stays gated off for this model (`capacityModes: []`), consistent with how the p-median-us Open Warehouses grid already hides utilization when `capacityMode === "none"`.
- `weightedAvgDistance` is flow-weighted across both legs (`Σ distance·flow / Σ flow`); each `avgDistanceByLeg` entry uses the same formula restricted to that leg. It is never derived from the cost objective because transport rates and minimum charges make `objective / demand` dimensionally wrong.
- `details`: retains model-specific detailed per-product outbound assignments for audit/download if needed, but the standard Customer Assignments grid consumes the aggregated outbound edges.
- `status`, `runTimeSec`, `quality`, `solverUsed`, `infeasibilityReason` as for all models. Wrapper never throws (degrades to `{status:"error", ...}`).

All edge consumers must classify semantic legs rather than recognize only the Chapter-10 strings. Customer Assignments consumes only facility→demand legs (`refinery_to_customer`, `warehouse_to_customer`); Flows consumes only source→facility legs (`mine_to_refinery`, `plant_to_warehouse`); Open Warehouses and open-count summaries use `metrics.openFacilityIds` with outbound flow totals. The map palette handles all four values and unknown/absent legs fall back neutrally. For map rendering only, product-specific inbound edges with the same `(leg,fromId,toId)` are coalesced into one line with summed flow; the underlying result and Flows grid remain per-product.

## 5. Contract / schema

- **OpenAPI** (`lib/api-spec/openapi.yaml`) + orval regen (spec + generated in one commit, hard rules 1/4):
  - Every public `modelId` enum gains `two-echelon-jade-us` (`GET /dataset`, `Scenario`, and `ScenarioInput`, not only one occurrence).
  - `Dataset` gains optional `plants`, `products`, and `plantProductCapabilities`; `WarehouseCandidate`/`Customer` gain optional `name` and integer `sourceId`, and `Customer` gains optional `demands` while retaining scalar total `demand`. New `Plant`, `Product`, and `PlantProductCapability` schemas expose the canonical base matrix needed to render the editor. These fields remain optional so all four existing dataset responses stay valid.
  - `Edge.leg` gains `plant_to_warehouse`, `warehouse_to_customer`; `Edge.productId` is optional globally and required by JADE inbound-edge construction.
  - `SolveMetrics.avgDistanceByLeg` is reused; optional `openFacilityIds`, `totalDemand`, `inboundCost`, and `outboundCost` are added to both OpenAPI and `resultEnvelope.ts` so Zod does not strip them.
  - `ModelInfo.capabilities` gains `supportsPlantProductCapability: boolean` (optional/default false in `ManifestSchema`, explicitly defaulted false at the public boundary).
  - Import/export enums are updated consistently: `plants` and `plantCapabilities` join `ImportRequest`, `ImportApplyRequest`, the export query, and `ExportEnvelope`; `flows` already exists in the export query but must also be accepted by `ExportEnvelope`. Backend `ImportEntity`, column definitions, templates, model↔entity pairing checks, and reset-to-baseline checks change in the same task.
- **Zod inputs** — `artifacts/api-server/src/validation/inputs/jadeInputs.ts` behind `validateInputsForModel`:
  - `p` (int ≥ 1), `distanceBands` (exactly 4 strictly ascending positive values), `gap` (≥0), `timeLimitSec` (positive integer). The UI maximum and semantic validation use the effective active warehouse count, including added warehouses; there is no stale static maximum of 25.
  - `warehouseOverrides[]` — **status only** (`active|forced_open|inactive`, with `active` displayed as "Potential"); **no warehouse capacity field** (uncapacitated model).
  - `customerOverrides[]` — sparse per-product demand overrides as `{id, demands?: {productId: tons}, status}`; omitted product keys inherit base demand and all demand values are nonnegative.
  - `plantProductCapability[]` — pair-unique sparse `{plantId, productId, enabled}` overrides over the base 16-cell matrix.
  - Phase-B: `addedPlants[]`, `addedWarehouses[]`, `addedCustomers[]`, and pair-unique `distanceOverrides[]` as `{leg, fromId, toId, distance, estimated?}`, with nonnegative distance, `leg` required, and endpoints role-compatible.
  - `addedCustomers[].demands` contains all four canonical product keys. Added plants default every capability cell to disabled; students enable cells in the effective plant×product matrix. Copying a plant copies geometry only and starts disabled; deleting one removes its capability overrides and plant→warehouse distance rows.
- **Manifest** (`solvers/two-echelon-jade-us/manifest.json`) + `lib/dataset-schema` registration:
  - `supportsP: true`, `capacityModes: []`, `demandEditable: true`, `supportsFacilityStatus: true`, `supportsPlantProductCapability: true`, `supportsReferenceDistances: true`, `supportsAddedCustomerExclusion: true`.
  - `outputGrids: ["openWarehouses","assignments","flows","costSummary","serviceStats"]`.
  - `countryBounds` = US (computed from dataset lat/lon).

- **Semantic precheck** — a JADE-specific `precheckJadeInputs` is registered in both the standalone precheck and solve-before-enqueue paths. It checks global ID collisions, known product keys, role/leg reference integrity, added-entity distance completeness on both legs, `forced_open <= p <= active warehouses`, and sufficient enabled plant capacity for every product with positive effective demand. Shape-valid JADE inputs must never fall through to the current default `{ok:true}` path.

## 6. Frontend (tabbed Workspace)

New **plants echelon** and **products axis** thread through the Workspace. Registration follows `model-integration-precheck.md` Gate 1 (10 points) — run explicitly at every new entity/model point (this repo's most-documented recurring bug class).

**Input tabs:**
- Warehouses — id, city/state, lat/lon, zip, status select (no capacity column).
- Customers — id, city/state, lat/lon, zip, per-product demand, active/excluded.
- **Plants (new)** — id, city/state, lat/lon (read-only base + added rows).
- **Capability Matrix (new)** — effective-plants×4 checkbox grid; base rows default from the 16-cell matrix and added-plant rows default off. Each cell writes/removes the corresponding sparse override.
- Optimization Parameters — P, distance bands, optimization gap, max time.
- Input Map — plant (square) + warehouse (triangle) + customer (circle) markers; click-to-place add-entity flow (all three entity types); no lanes.
- Distances — reference (base) + editable overrides for both legs (paginated, filtered), with a visible Leg column and `(leg,fromId,toId)` identity, gated by `supportsReferenceDistances`. `ReferenceDistancePair` gains an optional `leg` field for multi-leg datasets.

**Output tabs:**
- Output Map — one map, layer toggles (plant→wh lanes, wh→customer lanes, markers), routes leg-colored (extend the two-echelon leg palette to the two new leg values); floating objective + weighted-distance overlay.
- Open Warehouses — open set + total demand served.
- Customer Assignments — single-source customer → warehouse.
- **Flows (new/extended)** — plant → warehouse inbound tons, per product (`productId` displayed and included in CSV/JSON export).
- Solution Summary — inbound vs outbound cost split, objective, weighted avg distance.
- Service Stats — outbound (wh→customer) distance-band coverage.

**Maps decision (confirmed):** the notebook's 4 static HTML maps (input / inbound / outbound / combined) collapse to the app's **Input Map + Output Map** tabs; inbound-only / outbound-only / combined are Output-Map layer-toggle states, not separate tabs — consistent with every other model and strictly more interactive.

**Added-entity distance estimation:** `services/autoDistance.ts` extends to JADE with role-scoped coordinate maps and required leg tags. The implementation first reverse-derives the notebook's per-leg distance convention from all base pairs and locks the chosen circuity factor(s) with reconstruction tests; it does not assume either Chapter-10 factor applies. Added plant→warehouse and added warehouse→customer pairs are estimated only where at least one endpoint is added, tagged `estimated: true`, and never touch base dataset files (DD-1). Only added-entity distances are estimated, so the base accuracy anchor is unaffected.

**Chapter registration:** `lib/chapters.ts` gains `two-echelon-jade-us` → `/chapter-9/jade`, chapter "Chapter 9", `workspace: true`, title "JADE Network — Multi-Product Two-Echelon". Initially `hiddenFromLanding: true`; flipped off after the verify gate.

## 7. Verification

- `e2e_accuracy.py` — add the JADE anchor (§2.7): forced `wh-11` (Phoenix) + `wh-14` (New York), P=2 → normalized envelope status `optimal`, notebook quality/status `Optimal`, objective `254060828.6157`. Sacred thereafter (hard rule 2). Note: `e2e_accuracy.py` is a standalone script, run directly (`python3 e2e_accuracy.py`), not via `pytest tests/`.
- `test_jade.py` (pytest) — capability toggle changes the solution; single-source holds (one wh per customer); plant-product capacity binds; min-charge applies below the breakpoint distance; excluded customer absent from assignments; force open/close honored.
- Dataset: extraction tests assert canonical-ID uniqueness/mapping, all source counts and totals, all 16 capability cells, exact distance extrema, 34 inbound and 825 outbound pairs beyond 1600, and package sha256.
- TS: registry test (drop-in manifest appears), Dataset/Product/Plant contract tests, Zod validation tests, semantic-precheck tests (both legs, collisions, forced/P bounds, product feasibility), `resultEnvelope` leg/product/metric preservation tests, route/import/export/reset tests (`plants`, `plantCapabilities`, `legDistances`, `flows`), and payload/merge/dispatcher tests.
- Frontend: RTL for the effective-plants×products capability matrix, plants tab, overflow band, all four leg classifications, product-aware Flows, aggregated Customer Assignments, authoritative zero-flow open warehouses, and output grids; `Workspace.TabCoverage` sweep extended to the new model.
- **QA (standing, in-plan by default):** `qa-sdet` real Playwright spec against local dev servers — create/solve a JADE scenario, toggle a capability cell and confirm the solution changes, verify leg-colored routes + layer toggles, output grids, capability matrix persistence. No product bugs before merge.

**Full verification gate** (must be green before unhide):
`pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)` plus `python3 e2e_accuracy.py` (all pre-existing 87 checks remain green, plus the new JADE section) and the Playwright QA spec.

## 8. Execution & rollout

- **Method:** agent-team (standing default per user), waved with single-writer serialization on shared files (`openapi.yaml`, `manifest`/`ManifestSchema`, `solve.py`, `Workspace.tsx`, `chapters.ts`) and the two-lane concurrency model (api-server/lib ⊥ studio).
  - **W1** — safe literal-only dataset extraction + canonical-ID package, manifest + `lib/dataset-schema` registration, registry, complete Dataset/result/OpenAPI contract + codegen.
  - **W2** — `solve_jade()` + `merge_inputs.py` bridge + `modelType` dispatch + envelope leg/product/metric values (solver lane) ∥ Zod inputs + semantic precheck + route/import/export/reset wiring (api-server lane).
  - **W3** — frontend: chapters registration, input tabs (incl. Plants + Capability Matrix), Input/Output maps + leg palette, output grids (incl. Flows), Phase-B added-entities + distance overrides, `autoDistance` plants extension.
  - **W4** — QA (Playwright) + solver/e2e_accuracy anchor + full-gate re-verification.
- **Docs:** this spec merged to local main on creation; plan merged on creation; re-merged after review (per standing memory).
- **Rollout:** after the full gate + in-browser verify gate pass, flip `hiddenFromLanding` off, commit, push, deploy `nos-studio` + `nos-api` (manual `trigger_deploy` — Render autoDeploy never fires on its own for this repo), live-verify on production, clean up test accounts.

## 9. Open items / risks

- **Scope size** — biggest integration to date; W3 (frontend) is the heaviest. Orchestrator surfaces a split if a wave loses coherence.
- **Products axis in grids** — single-source makes customer assignment product-independent (one wh per customer); only inbound flows and demand are per-product. Grids reflect this (assignment = one row/customer; flows = per plant-wh-product).
- **Large distance matrix / band overflow** — reference tables contain many lanes beyond 1600 miles; overflow is explicit and tested rather than absorbed into the last band.
- **Added-plant feasibility** — added plants begin with all products disabled; the precheck explains which product lacks enabled capacity instead of relying on CBC's generic infeasible result.
- **`e2e_journey.py`** remains non-runnable (legacy `/login`) — not used as a gate; do not treat as coverage.
- **Recurring gate bug class** — every per-model gate/allowlist (header title, constraints panel, output-grid gating, map multi-select, legend, added-section capability gate) must be extended for `two-echelon-jade-us`; `model-integration-precheck.md` Gate 1 is the checklist.
