# Super Model — design

Date: 2026-10-23 · Status: approved in brainstorming, pending written-spec review

## 1. Goal

Add an 8th model, **Super Model** (`super-model`), as its own home-page block. It is derived from the
Chapter 9 JADE model (`two-echelon-jade-us`) and becomes the base that later grows a richer objective.
It ships **no preset dataset**: a scenario starts empty and the user imports a network.

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
| Transport cost | Ch9's global `$/unit-mile` rate with minimum charge, inbound + outbound (`transportCosts`, 4 params) |
| Capacity | Hard cap. Missing row or `capacity = 0` ⇒ plant cannot make the product |
| Distances | Per-scenario method: `haversine`, `circuity` (haversine × user factor), `road` (OpenRouteService). Imported pair overrides always win |
| Geography | Any valid lat/lng; miles; map auto-fits imported points |
| Import | Whole network in one shot in three formats: multi-select CSV, XLSX workbook, JSON. Export in same formats |
| Re-import | User chooses at import time: **Replace all** or **Merge by ID**. Both atomic |
| Editing | All Ch9 controls: inline edit + add/delete on every table, warehouse status, customer exclude, `p`, rates |
| Outputs | New summary (§5) + open-warehouses grid + map. Ch9's other grids are not shown for this model |
| Home page | Own "Super Model" block after the chapter blocks; blank templates + a downloadable sample network |
| Size | Classroom caps, numbers fixed in the plan after a measured CBC timing run |
| Delivery | Three phases (§9) |

## 3. Data model

All network data lives in `scenarios.inputs` (jsonb). There is no base dataset, so Ch9's
`added*` / `*Overrides` split does not exist here — every table is a plain array.

```
inputs = {
  p: integer ≥ 1,
  gap, timeLimitSec,                                  // as Ch9
  transportCosts: { icTransCost, icMinTrans, obTransCost, obMinTrans },  // as Ch9
  distanceMethod: "haversine" | "circuity" | "road",  // "road" usable from phase 3
  circuityFactor: number ≥ 1,                         // read only when distanceMethod = "circuity"
  products:      [{ id, name }],
  plants:        [{ id, name, city, state, lat, lng }],
  warehouses:    [{ id, name, city, state, lat, lng, status: "candidate"|"forcedOpen"|"forcedClosed" }],
  customers:     [{ id, name, city, state, lat, lng, status: "active"|"excluded" }],
  plantProducts: [{ plantId, productId, capacity ≥ 0, costPerUnit ≥ 0 }],
  demand:        [{ customerId, productId, demand ≥ 0 }],
  distanceOverrides: [{ fromId, toId, miles > 0 }],   // plant→WH or WH→customer pairs
  roadDistances?: { fetchedAt, pairs: [{ fromId, toId, miles }] }  // phase 3, server-written cache
}
```

Rules:

- IDs are stable join keys; `name`/`city`/`state` are display-only (city names are not unique).
- `(plantId, productId)` and `(customerId, productId)` are unique. A missing demand row means 0.
- Every reference (`plantId`, `productId`, `customerId`, `fromId`, `toId`) must resolve.
- A new scenario's `inputs` holds parameters with defaults and empty tables. `required[]` covers only
  keys that an empty scenario carries, so the WF-5 "missing required values" notice cannot fire on an
  empty-but-valid scenario. "Ready to solve" is a separate checklist (§6).

## 4. Solver

### 4.1 Shared core

Extract the model-building body of `solve_jade` (`artifacts/api-server/src/solver/solve.py`) into a core
function that receives a resolved network (plants, warehouses + bounds, customers, products, demands,
capacity map, plant cost map, distance map) and parameters. Constraints C1–C7 are kept exactly:

- C1 each positive (customer, product) demand served exactly once
- C2 warehouse flow balance per product, summed over plants
- C3 plant-product capacity ≤ `capacity`
- C4 open-if-used big-M
- C5 exactly `p` open
- C6 forced open / closed bounds
- C7 single-source: one warehouse per customer across all products

Objective gains one term:

```
min  Σ flow_pw[pl,w,k] · ic_cost(pl,w)
   + Σ flow_wc[w,c,k] · ob_cost(w,c) · demand[c,k]
   + Σ flow_pw[pl,w,k] · costPerUnit[pl,k]          ← new
```

`solve_jade` passes an empty cost map, so the new term is 0 and its objective is byte-identical. This is a
coefficient change, not a branch (hard rule #6). The existing non-finite-coefficient guard extends to
`costPerUnit`. Infeasibility reasons are reused unchanged (forced-open > p, too few active warehouses,
product with demand but no capable plant, …).

### 4.2 Super Model entry point

`solve_super` resolves `inputs` into the core's network shape:

- excluded customers and their demand rows dropped; warehouse status → bounds
- capacity / cost maps from `plantProducts` (missing pair ⇒ capacity 0)
- distance for every plant→WH and WH→customer pair, resolved in the merge layer:
  1. `distanceOverrides` pair if present
  2. else `road` → `roadDistances` pair (solve refused if the cache is incomplete)
  3. else `haversine` miles, × `circuityFactor` when method is `circuity`

Computed distances are not stored. The Python merge layer is the single authority for them.

## 5. Output summary

| Line | Definition |
|---|---|
| Objective | Solver objective value (equals Total Cost today; its meaning will change as the model grows) |
| Total Cost | Inbound + Outbound + Plant Variable |
| Total Inbound Transportation Cost | Σ flow_pw · ic_cost |
| Total Outbound Transportation Cost | Σ flow_wc · ob_cost · demand |
| Total Plant Variable Cost | Σ flow_pw · costPerUnit |
| Weighted Avg Distance — Plant to WH | Σ(units × miles) / Σ units over plant→WH flows, all products |
| Weighted Avg Distance — WH to Customer | Σ(units × miles) / Σ units over served demand, all products |

Shown with the open-warehouses grid and the map. Distances in miles.

## 6. UI (Studio)

- **Home page:** new "Super Model" block after the chapter blocks (no chapter number). Actions: new
  scenario; download blank templates (CSV set, XLSX, JSON); download the sample network.
- **Workspace tabs** (reuse Ch9 components where they fit):
  Products · Plants · Warehouses (status) · Customers (status, no demand column) ·
  Plant Capability (plant, product, capacity, cost/unit) · Demand (customer, product, demand) ·
  Distances (override list, method selector, circuity factor) · Parameters (`p`, rates, gap, time limit).
- Every table: inline edit, add row, delete row. Deleting a product/plant/customer/warehouse removes the
  rows that reference it, after a confirmation that names how many.
- **Empty state:** "Import network" prompt. Solve is disabled with a readiness checklist until there is
  ≥ 1 product, plant, warehouse, active customer, plant-product row with capacity > 0, demand row > 0,
  and `p` ≤ number of non-forced-closed warehouses.
- Cached result shows the existing stale badge whenever inputs change after a solve.

## 7. Import / export

- One "Import network" action, three formats, each a full network:
  - **CSV:** multi-select files (native `<input multiple>`), matched by filename —
    `products.csv`, `plants.csv`, `warehouses.csv`, `customers.csv`, `plant_products.csv`, `demand.csv`,
    `distance_overrides.csv`, `parameters.csv`. Unknown filenames rejected by name.
  - **XLSX:** one workbook, one sheet per table, same names. New dependency chosen in the plan.
  - **JSON:** one document shaped like §3.
- All formats are parsed to the same network object and validated by one server path (§3 rules +
  size caps). Errors are row-level and name the file/sheet, row, and column. Nothing is written on any
  error.
- The user picks **Replace all** (confirm overwrite) or **Merge by ID** (upsert by ID per table;
  rows not mentioned are kept) each time. Replace on an empty scenario skips the confirm.
- Import writes inputs through the existing scenario write path, so ownership (404 on non-owned) and
  staleness behave as for every other model.
- Export produces the same three formats; export → import round-trips to an identical network.
- Existing CSV formula-injection handling applies to CSV and XLSX text cells.

## 8. Road distances (OpenRouteService) — phase 3

- `distanceMethod: "road"` exposes a "Fetch road distances" action. An API-server job calls the ORS
  matrix API for all plant→WH and WH→customer pairs and writes `roadDistances` with `fetchedAt`.
- Editing a location, or adding/removing an entity, invalidates the cache; solve with `road` is refused
  until it is complete again.
- ORS API key: new `nos-api` env var (deploy checklist item).
- ORS free-tier quota and per-request location limits are verified in the phase-3 plan before batching
  is designed. No numbers are assumed here.
- Privacy: before the first fetch, the UI states that plant/warehouse/customer coordinates are sent to
  OpenRouteService.

## 9. Phases

Each phase ends in a usable model and follows branch discipline (branch per commit, prompt before merge).

1. Model registration (all 18 points in `model-integration-precheck.md`), shared solver core, `solve_super`,
   all tabs and editing, readiness checklist, JSON import/export with replace/merge, blank templates,
   sample network, `haversine` + `circuity` distances, output summary.
2. Multi-select CSV and XLSX import/export.
3. OpenRouteService road distances.

## 10. Testing

- **pytest:** shared core — plant-cost term changes the objective by exactly Σ flow·cost; capacity cap
  binds; missing row ⇒ cannot make; both distance methods; override precedence; summary arithmetic.
- **`e2e_accuracy.py` unmodified** — proves Ch9 is unchanged by the core extraction.
- **New golden:** the sample network (Ch9 JADE data, costPerUnit = 0, JADE distance matrix as overrides,
  same `p` and rates) reproduces Ch9's published objective.
- **API (vitest + supertest, real Postgres):** validation errors, ownership 404, replace vs merge,
  atomicity (bad row ⇒ nothing written), size caps, format parity (CSV / XLSX / JSON of one network give
  identical `inputs`), export → import round-trip. At least one test goes through the real writer, not a
  hand-built fixture.
- **RTL:** each tab's edit/add/delete, readiness checklist, import mode dialog.
- **Playwright (QA task):** real browser — new scenario → import sample → solve → summary values.
  Sibling e2e specs grepped for any changed testid/string.

## 11. Out of scope

Warehouse fixed costs, per-lane or per-product transport rates, unmet-demand penalties, per-product
summary breakdowns, km units, Compare changes beyond what the registration points provide by default.
