# Super Model — design

Date: 2026-10-23 · Status: approved in brainstorming; Codex review (medium) folded in; open decisions D1–D4 resolved in Lavish review 2026-10-23; Phases 2–3 + Input Map (D5–D9) folded in from brainstorming 2026-10-23; Phase 2–3 plan review (Codex high) folded in 2026-10-23 (§7.1 issue paths, §7.2 formula guard, §7.3 in-file duplicates, §8 busy / empty sides / timers / Render gate)

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
| D5 Input Map | Fully editable Input Map with Ch9 parity (§6.1), delivered with Phase 2 |
| D6 File parsing | CSV/XLSX parsed and generated **in the browser**; the API keeps one JSON import/export contract (§7.1) |
| D7 Road fetch | Synchronous route, not a solve job; ORS called with no row lock, result written onto the current row (§8) |
| D8 Road cache validity | Derived per pair from a coordinate snapshot by one server function, never maintained on write (§8) |
| D9 ORS profile | `driving-hgv`, hosted ORS API, key supplied by the user later (§8) |
| D10 Duplicate keys in an import | Rejected per table with document-relative issues, before merge (§7.3); never last-wins |
| D11 Map move dialog | `MoveConfirmDialog` `preserveIdentity` prop (§6.1) |
| D12 Road error statuses | 503 unavailable · 429 quota · 502 failed · 422 unroutable · 409 busy, contractual in OpenAPI (§8) |
| D13 XLSX library | SheetJS from `cdn.sheetjs.com`, conditional on the plan's Task 4 checks; any failed check ⇒ re-plan (§7.2) |

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
  roadDistances?: { fetchedAt, profile: "driving-hgv",            // phase 3, server-written only (§8)
                   coords: { [locationId]: [lat, lng] },          // snapshot of every location used
                   pairs: [{ fromId, toId, miles }] }
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
  2. else, if method is `road`, the road pair passed by the TS builder (only valid pairs are passed, §8) — the precheck refuses solve if any required pair is missing or stale. Phase 1's schema rejects `road` with 422; Phase 3 accepts it
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
  home card is a single link, so it cannot hold nested download links). Phase 1 ships the JSON template; Phase 2
  adds the blank template and the sample network as a CSV zip and as an XLSX workbook.
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
  forced-open count > `p`; method `road` with any required road pair missing or stale (§8); any non-finite coefficient.
- Cached result shows the existing stale badge whenever `inputsUpdatedAt > solvedAt`.

### 6.1 Input Map (D5)

**Wiring (`pages/Workspace.tsx`).** Super gets an `input-map` sidebar entry like the other models, and
the input-map view branch renders `InputMapTab` with `mode: "super"`. `InputMapTab` only delegates that
mode to a new `components/workspace/super/SuperInputMap.tsx`, so the 2,763-line file gets no Super logic.
Seeding (today's SM-13 "Super has no Input Map" fallback): an **empty** scenario still opens on the import
prompt; a non-empty scenario opens on the Input Map. `handleImportApplied` switches the active view to
the Input Map after any successful Super import (JSON, CSV or XLSX; replace or merge).

**Reuse vs new.** Reused as-is: `EntityMarkers` (the Super row `id` is the marker `displayCode`),
`MapLegend`, `MapActionMenu`, `MoveConfirmDialog`, `InvalidateOnResize`, `statusPresentation.ts`.
Not reused: `CreateEntityDialog`, `EditWarehouseDialog` and `EditCustomerDialog` model one scalar
`demand`, but Super has per-product demand rows. Super gets one new `SuperEntityDialog` (create + edit,
for plant / warehouse / customer). Every Super row is scenario-owned, so every pin takes the menu's
"added" action set (edit, move, copy, delete).

**Fit.** On first render and after each successful import, the map calls `fitBounds` on every plant,
warehouse and customer point (all statuses), padding 40 px, max zoom 10. With one point it uses
`setView(point, 8)`; with no points, the world view. Add / move / copy / delete never refit.

**Actions.**
- **Add** (click on the map, choose kind): `SuperEntityDialog` with `id` (pre-filled with the first free
  `PL-n` / `WH-n` / `C-n`, editable, must be unique across plants + warehouses + customers, as §3.3),
  `name` (required), optional `city` / `state`, warehouse `status`, customer `status` and one demand
  input per product. Demand inputs left blank or 0 write no `demand` row. A new plant has no
  `plantProducts` rows; capability is edited in the Plant Capability tab.
- **Edit**: the same dialog with `id` read-only (ID changes would orphan references).
- **Move**: `MoveConfirmDialog` with `preserveIdentity` (D11: no regenerated code or nearest-city preview; states that id, city and state are unchanged), then the new lat/lng is written.
- **Copy**: new row with the next free ID of that kind, name suffixed " (copy)", offset 0.05° east.
  A customer copy also copies its `demand` rows; a plant copy copies its `plantProducts` rows;
  `distanceOverrides` are never copied.
- **Delete**: the tables' cascade and row-count confirmation (D3), reusing `studio/src/lib/superNetwork.ts`'s
  cascade.
- Layer toggles for plants, warehouses and customers. No flows (they belong to the Output Map).

**Save, readiness, stale.** Map edits change `localInputs` exactly as table edits do and are written by
the same Save; there is no map-only write. Readiness and the stale badge read **saved** state, as today:
an unsaved move changes neither, and after Save `inputsUpdatedAt` bumps, so the badge shows.

**Registration delta.** The plan maps this feature against `model-integration-precheck.md`'s 18 points
and gates; at least the Workspace tab/sidebar registration and its tests change.
`Workspace.TabCoverage.test.tsx` (which asserts Super has no Input Map) and `e2e/super-model.spec.ts`
(SM-13 opening behaviour) are updated in the same task.

## 7. Import / export

### 7.1 Contract

New network-level endpoints; Super does not use the existing per-entity import routes (which stay as
they are for other models):

- `POST /scenarios/:id/network/import?mode=replace|merge` — `application/json` (one network document).
- `GET /scenarios/:id/network/export?format=json` — the network document.

**D6:** CSV and XLSX never reach the API. The Studio parses them into the §3.2 network document and posts
it to the JSON route; CSV-zip and XLSX exports are built in the browser from the JSON export. The server's
validation stays the only authority. The API therefore needs no multipart parser and no binary-format
dependency, and its contract is unchanged by Phase 2.

Both scoped to the authenticated owner; non-owned or non-Super scenario ⇒ 404. Added to `openapi.yaml`
and regenerated in the same task.

### 7.2 Formats

- **One kind per import:** a set of `.csv` files, or one `.xlsx`, or one `.json`.
- **CSV:** multi-select files (native `<input multiple>`), matched by filename — `products.csv`,
  `plants.csv`, `warehouses.csv`, `customers.csv`, `plant_products.csv`, `demand.csv`,
  `distance_overrides.csv`, `parameters.csv`. Unknown filenames rejected by name. Missing file = table
  absent. Parsed with papaparse (already a workspace dependency).
- **XLSX:** one workbook, sheets with the same names minus `.csv`. Unknown sheet names rejected by name.
  One new Studio dependency (and one zip library for CSV-zip export), chosen in the plan after a version
  and `pnpm audit` check, both loaded with a dynamic `import()`.
- **JSON:** one document shaped like §3.2, without `roadDistances`.

**Table files.** Row 1 is a header naming the §3.2 fields of that table, in any order; unknown columns
rejected by name; a required column missing is an error. Cell rules:
- ID and text columns are read as text (an XLSX numeric cell `101` becomes `"101"`); whitespace trimmed.
- Numeric columns must parse as a finite number; XLSX numeric cells are taken as-is, XLSX date cells and
  error cells are errors. An XLSX formula cell uses its cached value; no cached value is an error.
- Empty cells: optional fields (`city`, `state`, `status`) are omitted; an empty required cell is an error.
- A fully empty row is skipped.

**`parameters.csv` / sheet `parameters`.** Two columns, header `key,value`. Allowed keys, exactly:
`p`, `gap`, `timeLimitSec`, `distanceMethod`, `circuityFactor`, `transportCosts.icTransCost`,
`transportCosts.icMinTrans`, `transportCosts.obTransCost`, `transportCosts.obMinTrans`. Values are
numbers except `distanceMethod` (text). Unknown key or duplicate key is an error. A key that is absent,
or present with an empty value, is absent from the document (replace ⇒ default; merge ⇒ kept).

**Formula safety (export) and round-trip.** CSV export uses the existing `clientCsv.ts` guard: a text cell
starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`, **unless the whole string is a finite number**
(e.g. `-5`, `+1`), which a spreadsheet reads as a number and cannot carry a formula. CSV import reverses it: a
text cell whose first character is `'` followed by one of those characters has the `'` removed. Numeric-looking
strings in text columns therefore round-trip unchanged. XLSX export writes text
as string cells and numbers as numeric cells, never formulas, so no prefix is added and none is stripped.

**Limits.** Super does not use the per-entity `MAX_IMPORT_ROWS`. Table sizes are bounded by §3.3's caps
plus the schema's existing duplicate and reference rules (`superInputs.ts`): `plantProducts` ≤ plants ×
products (200), `demand` ≤ customers × products (5,000), `distanceOverrides` ≤ all plant→WH +
WH→customer pairs (26,000). `MAX_IMPORT_BYTES` applies to the **serialized JSON request** for every
format (the Studio checks it before posting, the API's body limit enforces it); the plan measures that a
maximum-size network fits and raises the Super route's limit if it does not.

**Errors.** Each names file (or sheet), row and column.
- Client parse errors are produced directly in the browser.
- Server validation errors: the network-import 422 response gains a structured `issues` array
  (`{ path: (string|number)[], message }`) alongside today's `error` string (OpenAPI + regenerated client
  in the same task). Paths are **document-relative**: `path[1]` indexes the imported table's rows (in merge
  mode the server translates merged-table rows back to document rows; an issue on a pre-existing row the
  import did not mention is reported table-level as "Existing <table> row n"). The Studio maps `path[0]`
  (table) to the file or sheet the table came from, `path[1]` to the file row through the row map it kept
  while parsing (the header row plus every skipped empty row are accounted for, so with no skipped rows it
  equals `path[1] + 2`), and `path[2]` to the column. JSON imports keep showing `error`.

### 7.3 Semantics

Order: parse all files → per-table row validation → build resulting network → whole-network validation
(§3.3) → single write. Any error ⇒ nothing written; errors name file/sheet, row, column.

- **Replace:** every table and parameter in the import replaces the scenario's; a table absent from the
  import becomes empty; parameters absent keep defaults. `roadDistances` is cleared. UI confirms the
  overwrite unless the scenario is empty.
- **Duplicates inside the import** (both modes): an ID or composite key that appears twice in the imported
  document — per table, with plant / warehouse / customer IDs sharing one namespace (§3.3) — is an error
  naming each repeated row; it is never resolved by keeping the last row. Composite keys are compared as
  exact `(a, b)` pairs, so IDs containing any delimiter character cannot collide.
- **Merge:** per table, a row whose ID (or composite key, for plant-product / demand / override rows)
  matches an existing row replaces that row whole; a new ID inserts; rows not mentioned are kept; merge
  never deletes. Parameters present overwrite. `roadDistances` is left as stored; pairs touching a
  moved or removed location become stale and a new location's pairs are missing, by D8 (§8). The merged result must pass whole-network validation (references, global ID
  uniqueness, caps).
- The write goes through the existing scenario input write path, so ownership and `inputsUpdatedAt`
  behave as for every other write.
- Export → import (replace) round-trips to identical `inputs` minus `roadDistances`, in every format.

## 8. Road distances (OpenRouteService) — phase 3

**Contract changes (one checklist the plan follows):** `superParamSchemas.distanceMethod` accepts `road`;
the persisted `superInputsSchema` gains optional `roadDistances` (§3.2); the network document schema does
not; PATCH preservation (below); `precheckSuper` road item; TS payload builder passes valid road pairs;
`merge_inputs.py` Super resolution step 2; the new route in `openapi.yaml` + regenerated clients; the
Studio method selector, fetch action and readiness; error codes in the TS union, OpenAPI enum and client
together; `superModelRegistration.test.ts`'s "road ⇒ 422" assertion is inverted.

**ORS request (D9).** `POST https://api.openrouteservice.org/v2/matrix/driving-hgv`, header
`Authorization: <ORS_API_KEY>`, body `{ locations: [[lng, lat], …], sources: [i…], destinations: [j…],
metrics: ["distance"], units: "mi" }` — note **[longitude, latitude]** order. Response `distances[s][d]`
is the miles from `sources[s]` to `destinations[d]`; `null` = unroutable. Miles are stored unrounded.
The plan's first Phase-3 task re-checks this shape against the current ORS API reference and records
what it checked; tests stub it.

**Pairs fetched.** Every plant→warehouse and warehouse→customer pair over **all** rows, including
inactive warehouses, excluded customers and pairs that have a `distanceOverride`. Rationale: at the §3.3
caps this is still ≤9 requests, and a status toggle or override removal then never needs a refetch.

**Batching.** Published limits checked 2026-10-23 (re-verified in the plan): ≤3,500 origin×destination
pairs per request; free key 500 matrix requests/day and 40/minute. Request 1: all plants × all warehouses
(≤1,000). Then customers in chunks of `floor(3500 / warehouses)`, each chunk × all warehouses as
sources — ≤8 requests at the caps (50 WH ⇒ chunks of 70). Requests are serial.

**Route (D7).** `POST /scenarios/:id/network/road-distances`, empty body; owner-scoped; non-owned or
non-Super ⇒ 404; locked model ⇒ the existing locked response; missing `ORS_API_KEY` ⇒ 503
`road_distances_unavailable`. Synchronous, in two phases so no row lock is held across HTTP:
1. Read the owned row (no lock) and build the requests from its locations.
2. Call ORS serially. Each request has its own 30 s timeout (its own `AbortController` and a timer cleared
   when the request ends, so a finished request is never aborted later); the whole fetch has a 120 s
   deadline (an `AbortController` shared by all requests). No retries.
3. On full success, open a transaction, `SELECT … FOR UPDATE` the row, and write **only**
   `roadDistances = { fetchedAt, profile, coords, pairs }` onto the row's **current** inputs (every other
   field is the current row's, not phase 1's snapshot), through `applyScenarioInputWrite`.
   `coords` holds the lat/lng each location had in phase 1.
   A concurrent edit between phase 1 and 3 is therefore never overwritten, and any location it moved has
   coordinates differing from `coords`, so its pairs are stale by D8 — no compare-and-swap is needed.
   If the row is gone or no longer owned in phase 3 ⇒ 404.

Render's HTTP request timeout must be proven ≥ 120 s plus margin before any road-distance code is
written; if it cannot be proven, the route design is re-planned (a hard gate, not an in-task redesign).

**Failures write nothing:** 429 ⇒ `road_distances_quota` ("OpenRouteService quota reached, try again
later"); timeout, deadline or any other ORS error ⇒ `road_distances_failed` naming the batch (e.g.
"warehouses → customers 71–140"); any `null` ⇒ `road_distances_unroutable` naming the first such pair
(the user can add an override for it), and no later batch is requested; a fetch already in progress ⇒
`road_distances_busy` (below). The codes are one closed set (TS union, OpenAPI enum, regenerated client), with HTTP statuses fixed by D12: 503 `road_distances_unavailable`, 429 `road_distances_quota`, 502 `road_distances_failed`, 422 `road_distances_unroutable`, 409 `road_distances_busy`.

**Empty sides.** With no warehouses or no customers there is nothing to fetch: the route makes no ORS
request and writes `roadDistances` with an empty pair list; readiness stays blocked by its completeness
items.

**Concurrency.** At most one ORS fetch per process, and nothing waits: a request that arrives while a fetch
is in progress is answered at once with 409 `road_distances_busy` ("already being fetched on this server, try
again in a minute"). The flag is released when the fetch ends, however it ends. Serial requests (≤9 per
fetch) keep normal use under 40/min; an ORS 429 still surfaces as `road_distances_quota`. `// ponytail:`
single-instance flag; a shared limiter is needed only if `nos-api` scales past one instance. The daily quota
is shared by all users of the key; the error says so.

**Validity (D8) — one function.** `validRoadPairs(inputs)` in the API server is the only implementation:
a stored pair is valid iff both endpoints exist in the current tables and their current lat/lng equal
`coords` exactly (both sides come from the same stored JSON numbers; a move writes new numbers). ID
reuse is harmless: a re-added location at identical coordinates has the identical road distance.
- **Precheck** uses it. With method `road`, the readiness item fails with the count of **required** pairs
  that have no valid road pair, where required = plant→eligible-warehouse (not `inactive`) and
  eligible-warehouse→active-customer pairs **without** a `distanceOverride`. Pairs involving inactive
  warehouses, excluded customers or overridden pairs never block.
- **Solve payload**: the TS builder passes only valid pairs to Python; `merge_inputs.py` applies
  override → passed road pair → haversine/circuity, with no validity logic of its own.
- **Studio** shows the precheck result; it never recomputes validity.

**Server-written only.** The network document schema has no `roadDistances`. On every other input write
(PATCH, import), `applyScenarioInputWrite` for `super-model` discards any client-supplied
`roadDistances` and, under its existing row lock, carries the persisted value onto the candidate — except
replace-import, which clears it. Merge-import keeps it (D8 handles moved/new locations). Only the road
route writes it.

**Key, privacy, tests.** `ORS_API_KEY` is a secret env var on `nos-api` (`sync: false` in `render.yaml`),
never logged or returned; local dev reads it from the environment; its addition is a deploy-checklist
item and the user supplies the key later. The fetch confirmation dialog states, every time, that plant,
warehouse and customer coordinates are sent to OpenRouteService. The ORS client takes an injected
`fetch`; tests never call ORS.

## 9. Phases

Each phase ends in a usable model and follows branch discipline (branch per commit, prompt before merge).

1. Timing run to confirm caps; dataset package; model registration; shared solver core + `solve_super`;
   metrics contract; precheck; all tabs and editing; network import/export endpoints in JSON with
   replace/merge; blank templates; sample network; `haversine` + `circuity`; output summary; Compare.
   The plan must include a table mapping each of the 18 points in `model-integration-precheck.md`
   (`KNOWN_SCHEMAS`/`VALID_MODEL_IDS`, OpenAPI enums, `chapters.ts`, `lib/units` objective dimension,
   precheck dispatch, `Workspace.tsx` tabs, `pMax`, import/export allowlists, result narrative, …) to
   the task and files that satisfy it, including regenerated code and registration-test updates.
2. Multi-select CSV and XLSX import, CSV-zip and XLSX export (browser-side, D6); CSV/XLSX templates and
   sample; the editable Input Map (§6.1).
3. OpenRouteService road distances (§8), built and tested against a stubbed ORS; live check once the
   user supplies `ORS_API_KEY`.

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
  export → import round-trip; network-import 422 carries structured `issues`. Phase 3: road route
  ownership 404, missing key 503, batching at the caps (request count, `[lng, lat]` order and chunk shape
  asserted on the stubbed `fetch`), 429 / null / timeout / deadline each write nothing, a second fetch while
  one runs is 409 busy and the flag is released after success, failure and abort, empty sides make no ORS
  request, a PATCH landing
  between fetch and write is kept and its moved location's pairs are stale, client PATCH cannot set or
  clear `roadDistances`, replace-import clears it and merge keeps it, readiness ignores inactive /
  excluded / overridden pairs, solve uses valid road pairs and overrides still win.
- **Studio unit:** format parity — one network as CSV set, XLSX and JSON parses to identical documents;
  each export re-parses to the same document; 422 `issues` path → file/row/column (incl. skipped rows,
  merge translation, a sheet not starting at A1); in-document duplicates rejected per table; delimiter-
  containing IDs in composite keys; parameters key rules; cell coercion (numeric-looking IDs stay text, XLSX dates/errors rejected, formula cached value);
  round-trip of strings starting with `=`, `+`, `-`, `@` through CSV and XLSX.
  At least one test goes through the real writer, not a hand-built fixture.
- **RTL:** each tab's edit/add/delete incl. cascade confirmation, readiness checklist, import mode
  dialog; Input Map add / edit / move / copy / delete (cascade) and switch-to-map after import; road fetch
  dialog privacy notice and error messages.
- **Playwright (QA task):** real browser — new scenario → import sample → solve → summary values; Phase 2:
  import the sample as CSV set and as XLSX → Input Map shows the pins → edit a pin on the map → save.
  Sibling e2e specs grepped for any changed testid/string.

## 11. Out of scope

Warehouse fixed costs, per-lane or per-product transport rates, unmet-demand penalties, per-product
summary breakdowns, distance bands, km units, cross-model Compare.
