# Super Model — design

Date: 2026-10-23 · Status: approved in brainstorming; Codex review (medium) folded in; open decisions D1–D4 resolved in Lavish review 2026-10-23

## 1. Goal

Add an 8th model, **Super Model** (`super-model`), as its own home-page block. It is derived from the
Chapter 9 JADE model (`two-echelon-jade-us`) and becomes the base that later grows a richer objective.
It ships **no preset network**: a scenario starts empty and the user imports a network.

Changes relative to Ch9:

- New **Products** tab.
- **Plant Capability** becomes a normalized table — one row per plant-product — with directly editable
  `capacity` and a new `costPerUnit`, which enters the MIP objective.
- Demand leaves the Customers table and moves to a new **Demand** table (customer, product, demand).
- New output summary (§5).

`two-echelon-jade-us` is untouched in behaviour; its 284 production scenarios are unaffected.

## 2. Decisions (locked in brainstorming)

| Topic | Decision |
|---|---|
| Solver approach | Shared solver core extracted from `solve_jade`; Ch9 and Super Model both call it |
| Warehouse decision | Open exactly `p` (as Ch9) |
| Transport cost | Ch9's global per-unit rate with per-unit minimum (`transportCosts`, 4 params; §4.1) |
| Capacity | Hard cap. Missing row or `capacity = 0` ⇒ plant cannot make the product |
| Distances | Per-scenario method: `haversine`, `circuity` (haversine × user factor), `road` (OpenRouteService). Imported pair overrides always win |
| Geography | Any valid lat/lng; miles; map auto-fits imported points |
| Import | Whole network in one shot in three formats: multi-select CSV, XLSX workbook, JSON. Export in same formats |
| Re-import | User chooses at import time: **Replace all** or **Merge by ID**. Both atomic |
| Editing | All Ch9 controls: inline edit + add/delete on every table, warehouse status, customer exclude, `p`, rates |
| Outputs | New summary (§5) + open-warehouses grid + map. No distance bands, no other Ch9 grids |
| Home page | Own "Super Model" block after the chapter blocks; blank templates + a downloadable sample network |
| Size | Provisional caps in §3.3, confirmed by a measured CBC timing run as Phase 1's first task |
| Delivery | Three phases (§9) |
| D1 Size caps | Provisional caps of §3.3 accepted; warehouses × customers × products lowered to 50,000 by the SM-2 timing run |
| D2 Big-M | Derived `M = |customers| × |products|` for both models (§4.1) |
| D3 Row delete | Cascade after a confirmation stating the row count (§6) |
| D4 CSV export | Single zip of the per-table CSVs (§7.1) |

## 3. Data model

### 3.1 Dataset package (empty, but present)

The registry requires a `datasetDir` (`ManifestSchema`, `lib/dataset-schema`), and every solve hashes
`readVersion(modelId)` into its cache key (`jobRunner.ts` `computeInputsHash`). Super Model therefore
ships a **minimal dataset package** rather than special-casing those paths:

- `solvers/super-model/manifest.json`, `datasetDir: "solvers/super-model/dataset"`
- `dataset/version.json` (`version: 1`, sha256 over the package as for every other model)
- empty entity files (`plants.json`, `warehouses.json`, `customers.json`, `products.json` = `{}`)
- a `PACKAGE_SPECS` entry like the others. `GET /api/dataset?modelId=super-model` returns the empty package.

No caching/version code changes. The network itself is never in the package — only in `inputs`.

### 3.2 Inputs

All network data lives in `scenarios.inputs` (jsonb). There is no base network, so Ch9's
`added*` / `*Overrides` split does not exist here — every table is a plain array.

```
inputs = {
  p: integer ≥ 1,
  gap, timeLimitSec,                                  // as Ch9
  transportCosts: { icTransCost, icMinTrans, obTransCost, obMinTrans },  // as Ch9, same bounds
  distanceMethod: "haversine" | "circuity" | "road",  // "road" accepted from phase 3
  circuityFactor: number in [1, 3],                   // read only when distanceMethod = "circuity"
  products:      [{ id, name }],
  plants:        [{ id, name, city, state, lat, lng }],
  warehouses:    [{ id, name, city, state, lat, lng, status: "active"|"forced_open"|"inactive" }],
  customers:     [{ id, name, city, state, lat, lng, status: "active"|"excluded" }],
  plantProducts: [{ plantId, productId, capacity ≥ 0, costPerUnit ≥ 0 }],
  demand:        [{ customerId, productId, demand ≥ 0 }],
  distanceOverrides: [{ fromId, toId, miles ≥ 0 }],   // 0 allowed: co-located pairs (SM-6), as Ch9
  roadDistances?: { fetchedAt, pairs: [{ fromId, toId, miles }] }   // phase 3, server-written only
}
```

Warehouse/customer status values reuse Ch9's existing vocabulary (`jadeInputs.ts`): `active` = eligible
candidate, `forced_open` = must open (counts toward `p`), `inactive` = cannot open.

No `distanceBands`: Super shows no band output.

### 3.3 Rules

- **IDs** are required, non-blank, and stable. They are **globally unique across plants, warehouses and
  customers** (enforced on every write); product IDs are unique among products. Global uniqueness makes
  `(fromId, toId)` unambiguous: a pair is plant→warehouse or warehouse→customer by its endpoints' tables,
  so no `leg` field is needed. Any other endpoint combination is rejected.
- `(plantId, productId)`, `(customerId, productId)`, `(fromId, toId)` are unique. A missing demand row
  means 0; a missing plant-product row means cannot make.
- Every reference (`plantId`, `productId`, `customerId`, `fromId`, `toId`) must resolve.
- lat ∈ [-90, 90], lng ∈ [-180, 180]; all numbers finite.
- **Size caps** (measured by SM-2's timed CBC run, `scripts/super-model-timing.py`: 20 plants, 10 products,
  p=10, gap 0.01, 120 s limit. At 50 warehouses x 200 customers x 10 products = 100,000 CBC returned
  `no_solution` (`time_limit`, 126.35 s and 125.1 s); halved to 50 x 100 x 10 = 50,000 it proved optimality
  in 40.94 s and 43.09 s): products <= 10, plants <= 20, warehouses <= 50, customers <= 500, and
  warehouses x customers x products <= 50,000 (Ch9 is 10,000). Over-cap writes are
  rejected with a message naming the cap.
- **Validation authority** is the hand-written Zod schema (`superInputs.ts`), which runs on every write
  path (PATCH, network import). The manifest's `required[]` drives only the studio's missing-values
  notice; it lists only keys every new scenario is created with (parameters + the empty tables), so an
  empty-but-valid scenario never shows that notice. Tests prove an empty scenario validates and an
  incomplete non-empty row fails.
- **Distance normalization:** `super-model` is not added to `normalizeAddedEntityDistances`
  (`autoDistance.ts`); no estimated distance rows are ever written. Computed distances exist only inside
  the solver run.
- **Staleness:** every write to `inputs` bumps `inputsUpdatedAt`, including a server write of
  `roadDistances`. (The Ch9 distance-band exception does not apply — Super has no bands.)

## 4. Solver

### 4.1 Shared core

Extract the model-building body of `solve_jade` (`artifacts/api-server/src/solver/solve.py`) into a core
function that receives a resolved network (plants, warehouses + bounds, customers, products, demands,
capacity map, plant cost map, distance map) and parameters.

Variables and units (as Ch9):

- `flow_pw[pl,w,k] ≥ 0` continuous, product units shipped plant→warehouse
- `flow_wc[w,c,k] ∈ {0,1}`, warehouse `w` serves customer `c`'s product `k` demand
- `open[w] ∈ {0,1}`, `src[w,c] ∈ {0,1}`

Per-unit coefficients (minimum is per unit, exactly as Ch9 today):

- `ic(pl,w) = max(icTransCost × miles(pl,w), icMinTrans)`  $/unit
- `oc(w,c)  = max(obTransCost × miles(w,c), obMinTrans)`  $/unit

Constraints C1–C7 as Ch9: demand served once per (customer, product) with positive demand; warehouse
flow balance per product summed over plants; plant-product capacity; open-if-used; exactly `p` open;
status bounds; single source per customer across all products.

**C4 big-M** becomes derived: `M = |customers| × |products|`, the maximum possible
`Σ_c,k flow_wc[w,c,k]`. Valid by construction for any network size, and replaces the fixed
`JADE_OPEN_BIG_M` for Ch9 too (same integer-feasible set; `e2e_accuracy.py` proves the objective is
unchanged).

Objective:

```
min  Σ flow_pw[pl,w,k] · ic(pl,w)
   + Σ flow_wc[w,c,k] · oc(w,c) · demand[c,k]
   + Σ flow_pw[pl,w,k] · costPerUnit[pl,k]          ← new
```

`solve_jade` passes an empty cost map, so the new term is 0. A coefficient change, not a branch (hard
rule #6). The non-finite-coefficient guard extends to `costPerUnit`. Infeasibility reasons are reused
(forced-open > p, too few eligible warehouses, product with demand but no capable plant) plus one new
reason: a product's total capacity < its total active demand.

### 4.2 Super Model entry point

`solve_super` resolves `inputs` into the core's network shape:

- excluded customers and their demand rows dropped; status → bounds
- capacity / cost maps from `plantProducts`
- distance for every plant→WH and WH→customer pair:
  1. `distanceOverrides` pair if present
  2. else, if method is `road`, the `roadDistances` pair (precheck refuses solve if any pair is missing) — Phase 3; Phase 1's schema rejects `road` with 422
  3. else haversine miles, × `circuityFactor` when method is `circuity`

## 5. Output summary

Costs are stored at cents (2 dp), each summed from unrounded solver values; average distances are stored unrounded. Display rounding happens only at render/export (decision C1).

| Line | Metric key | Definition |
|---|---|---|
| Objective | `objective` | Solver objective value (equals Total Cost today; its meaning changes as the model grows) |
| Total Cost | `totalCost` | inbound + outbound + plant variable |
| Total Inbound Transportation Cost | `inboundCost` | Σ flow_pw · ic |
| Total Outbound Transportation Cost | `outboundCost` | Σ flow_wc · oc · demand |
| Total Plant Variable Cost | `plantVariableCost` | Σ flow_pw · costPerUnit |
| Weighted Avg Distance — Plant to WH | `avgDistPlantToWh` | Σ(flow_pw × miles) / Σ flow_pw, all products (mi) |
| Weighted Avg Distance — WH to Customer | `avgDistWhToCustomer` | Σ(flow_wc × demand × miles) / Σ(flow_wc × demand) (mi) |

Contract (one task, per the "version constant + contract are one change" gotcha): the keys are added to
`solve.py`'s output, `resultEnvelope.ts` `MetricsSchema`, the OpenAPI result/cost-summary schemas,
regenerated Orval output, the cost-summary export rows, and the Studio summary renderer. A contract test
validates a real `solve_super` result (populated, not hand-built).

**Compare:** Super scenarios compare only with other Super scenarios. Compare renders the seven lines
above; a test covers a Super-vs-Super compare.

## 6. UI (Studio)

- **Home page:** new "Super Model" block after the chapter blocks, labelled "SM" instead of a chapter number. The card opens
  the workspace; blank-template and sample-network downloads live in the workspace empty state (decision C2 — a
  home card is a single link, so it cannot hold nested download links). Phase 1 ships the JSON template; the CSV
  set and XLSX arrive in Phase 2.
- **Workspace tabs** (reuse Ch9 components where they fit):
  Products · Plants · Warehouses (status) · Customers (status, no demand column) ·
  Plant Capability (plant, product, capacity, cost/unit) · Demand (customer, product, demand) ·
  Distances (override list, method selector, circuity factor) · Parameters (`p`, rates, gap, time limit).
- Every table: inline edit, add row, delete row. Deleting a product/plant/customer/warehouse also deletes
  the plant-product, demand and distance-override rows that reference it, after a confirmation stating
  how many rows go with it.
- **Empty state:** "Import network" prompt.
- **Solve readiness** comes from the server precheck (the same one the solve route enforces), shown as a
  checklist. It fails when: any of products / plants / warehouses / active customers is empty; no
  positive demand; any product's total capacity < its total active demand; `p` > eligible warehouses;
  forced-open count > `p`; method `road` with an incomplete cache; any non-finite coefficient.
- Cached result shows the existing stale badge whenever `inputsUpdatedAt > solvedAt`.

## 7. Import / export

### 7.1 Contract

New network-level endpoints; Super does not use the existing per-entity import routes (which stay as
they are for other models):

- `POST /scenarios/:id/network/import?mode=replace|merge` — `multipart/form-data` (CSV files or one XLSX
  file) or `application/json` (one network document).
- `GET /scenarios/:id/network/export?format=json|xlsx|csv` — csv returns a zip of the per-table files
  (download convenience only; CSV import stays multi-select files).

Both scoped to the authenticated owner; non-owned or non-Super scenario ⇒ 404. Added to `openapi.yaml`
and regenerated in the same task.

### 7.2 Formats

- **CSV:** multi-select files (native `<input multiple>`), matched by filename — `products.csv`,
  `plants.csv`, `warehouses.csv`, `customers.csv`, `plant_products.csv`, `demand.csv`,
  `distance_overrides.csv`, `parameters.csv` (key/value rows). Unknown filenames rejected by name.
  Missing files = table absent.
- **XLSX:** one workbook, sheets with the same names. New dependency chosen in the plan.
- **JSON:** one document shaped like §3.2 (no `roadDistances`).
- Request limits: existing `MAX_IMPORT_ROWS` per table and the §3.3 caps on the resulting network.
  Existing CSV formula-injection handling applies to CSV and XLSX text cells.

### 7.3 Semantics

Order: parse all files → per-table row validation → build resulting network → whole-network validation
(§3.3) → single write. Any error ⇒ nothing written; errors name file/sheet, row, column.

- **Replace:** every table and parameter in the import replaces the scenario's; a table absent from the
  import becomes empty; parameters absent keep defaults. `roadDistances` is cleared. UI confirms the
  overwrite unless the scenario is empty.
- **Merge:** per table, a row whose ID (or composite key, for plant-product / demand / override rows)
  matches an existing row replaces that row whole; a new ID inserts; rows not mentioned are kept; merge
  never deletes. Parameters present overwrite. `roadDistances` pairs touching any changed or new
  location are dropped. The merged result must pass whole-network validation (references, global ID
  uniqueness, caps).
- The write goes through the existing scenario input write path, so ownership and `inputsUpdatedAt`
  behave as for every other write.
- Export → import (replace) round-trips to identical `inputs` minus `roadDistances`.

## 8. Road distances (OpenRouteService) — phase 3

- With `distanceMethod: "road"`, a "Fetch road distances" action starts an API-server job that calls the
  ORS matrix API for all plant→WH and WH→customer pairs, converts meters → miles, and writes
  `roadDistances` in one atomic write when every pair has succeeded. A failed or partial job writes
  nothing and reports which batch failed.
- The API key is a secret env var `ORS_API_KEY` on the `nos-api` Render service (`sync: false`), never
  logged or returned. Its addition is a deploy-checklist item.
- Batching, per-request location limits, timeouts, retries and quota handling are designed in the
  phase-3 plan from ORS's current published limits — no numbers are assumed here.
- Unroutable pairs (ORS returns null) fail the job with the pair named; the user can add an override.
- Privacy: before the first fetch, the UI states that plant/warehouse/customer coordinates are sent to
  OpenRouteService.

## 9. Phases

Each phase ends in a usable model and follows branch discipline (branch per commit, prompt before merge).

1. Timing run to confirm caps; dataset package; model registration; shared solver core + `solve_super`;
   metrics contract; precheck; all tabs and editing; network import/export endpoints in JSON with
   replace/merge; blank templates; sample network; `haversine` + `circuity`; output summary; Compare.
   The plan must include a table mapping each of the 18 points in `model-integration-precheck.md`
   (`KNOWN_SCHEMAS`/`VALID_MODEL_IDS`, OpenAPI enums, `chapters.ts`, `lib/units` objective dimension,
   precheck dispatch, `Workspace.tsx` tabs, `pMax`, import/export allowlists, result narrative, …) to
   the task and files that satisfy it, including regenerated code and registration-test updates.
2. Multi-select CSV and XLSX import, CSV-zip and XLSX export.
3. OpenRouteService road distances.

## 10. Testing

- **pytest:** shared core — plant-cost term changes the objective by exactly Σ flow·cost; capacity cap
  binds; missing row ⇒ cannot make; derived big-M; both distance methods; override precedence; summary
  arithmetic (costs to the cent, distances unrounded); new capacity-shortfall infeasibility reason.
- **`e2e_accuracy.py` unmodified** — proves Ch9 is unchanged by the core extraction and the derived M.
- **New golden (sample network):** Ch9 JADE data reshaped — plants, warehouses, customers, products,
  diagonal capability with the dataset's capacities, `costPerUnit = 0`, demand rows from customer
  `demands`, every JADE distance as an override, default rates, `p = 2`, `wh-11` and `wh-14`
  `forced_open`, `gap = 0`. Asserts objective `254060828.6157` (rel. 1e-6) and open set
  `{wh-11, wh-14}` — the same case as `e2e_accuracy.py`'s Notebook scenario_1. The downloadable sample
  file is this fixture.
- **API (vitest + supertest, real Postgres):** validation errors; ownership 404; replace vs merge;
  atomicity (bad row ⇒ nothing written); global ID uniqueness; caps; staleness bump on every write;
  format parity (CSV / XLSX / JSON of one network give identical `inputs`); export → import round-trip.
  At least one test goes through the real writer, not a hand-built fixture.
- **RTL:** each tab's edit/add/delete incl. cascade confirmation, readiness checklist, import mode
  dialog.
- **Playwright (QA task):** real browser — new scenario → import sample → solve → summary values.
  Sibling e2e specs grepped for any changed testid/string.

## 11. Out of scope

Warehouse fixed costs, per-lane or per-product transport rates, unmet-demand penalties, per-product
summary breakdowns, distance bands, km units, cross-model Compare.
