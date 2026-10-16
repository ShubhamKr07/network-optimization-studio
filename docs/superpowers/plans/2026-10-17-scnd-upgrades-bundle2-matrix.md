# SCND Upgrades — Bundle 2 migration matrix (B2.10)

> Produced as the first artefact of Bundle 2 Phase P1 (spec `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` rev 2, §B2.10). Consumed by the P3 (outputs) and P4 (inputs/modals) plans: **one table instance per commit**, and every migration commit rewrites the e2e specs its testid map touches.

**Measured at `46d2f98`** (worktree `/Users/shubhamkr/nos-scnd-upgrades`, branch `scnd-upgrades`, before Bundle 1 lands). All paths are under `artifacts/studio/src/` unless shown otherwise. Every line reference was grep-verified at that commit. Bundle 1 tasks SCU-1.2–1.6 edit `ServiceStatsTab`, `CostSummaryTab`, `OpenWarehousesTab`, `AssignmentsTab`, `JadeAssignmentsTab`, `FlowsTab`, `JadeFlowsTab`, `InputMapTab` and `Workspace.tsx`, so **line numbers in those files will have shifted**. SCU-2.P1.1 re-verifies them at its own base; a P3/P4 task must still locate by the quoted text, not by line number.

**Counts (from the sections below):** 30 table instances = 9 outputs (P3) + 7 distance/cost inputs (P4) + 14 entity inputs (P4). 2 excluded surface groups. 30 e2e spec files exist (`ls artifacts/studio/e2e/*.spec.ts | wc -l`); `labs.spec.ts` is excluded from every grep (dead, pre-D0).

## How to read this document

1. **Summary matrix** — one row per instance: where it lives, who reaches it, and what it does today.
2. **Instance records** — the full per-instance record: row pipeline, columns, filter descriptors, paging, upload/download, add flow, editable cells and disable rules, highlighting, the **complete testid map** (literal or `{template}` + element + line), e2e references (file:line + needle) and unit-test files.
3. **e2e selector inventory** — a mechanical, re-runnable grep of every testid prefix from (2) across `artifacts/studio/e2e/**`, grouped by instance.
4. **API-gap resolution** — every place the spec's B2.1 `DataTable` API, as written, could not express a current table, and the P1 interface that now covers it.
5. **Behaviour changes and open questions** for P3/P4 — things the migration changes by spec, or that the spec does not decide.

## 1. Summary matrix

Legend: **FM** = `FilterMenu` + `useTableFilters`; **F/T** = the plain `input-filter-from` / `input-filter-to` boxes (removed by B2.2); **hist** = history browsing (`isBrowsingHistoryNow`); **D2** = uniform history read-only (spec decision). "Filter after P1" applies the B2.2 rule: FM whenever effective rows > 10, on every model.

| # | Ph | Instance | Tab file:line (table) / mount | Models (gate) | Row source & pipeline | Filter today | Paging today | Upload / Download | Add flow | Editable cells + disable today | Highlight |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | P3 | OpenWarehouses | `OpenWarehousesTab.tsx:220` / `Workspace.tsx:4109` | all with `openWarehouses` grid: p-median-us, p-median-brazil, max-coverage-us, delivery-teaching-us, two-echelon-gold-au, JADE (`Workspace.tsx:4107`) | result open warehouses | FM, opt-in JADE only (`Workspace.tsx:4129`), >10 | none | ↓ `openWarehouses` csv (server) | — | none | none |
| 2 | P3 | Assignments | `AssignmentsTab.tsx:184` / `Workspace.tsx:4159` | non-JADE with `customer-assignments` (`:4142,4157`) | result assignments | none | none (all rows) | ↓ `assignments` csv | — | none | none |
| 3 | P3 | JadeAssignments | `JadeAssignmentsTab.tsx:323` / `Workspace.tsx:4144` | JADE (`:4142`) | result per-product assignments | FM >10 (`:308`), band filter reset on bands/unit change (`:277-280`) | local `PAGE_SIZE=50` (`:166`), pager when >50 (`:359`) | ↓ `assignments` csv | — | none | none |
| 4 | P3 | Flows | `FlowsTab.tsx:126` / `Workspace.tsx:4205` | transport-coal, two-echelon-gold-au (`:4193,4204`) | result flows | none | none | ↓ `flows` csv | — | none | none |
| 5 | P3 | JadeFlows P→W | `JadeFlowsTab.tsx:436` / `Workspace.tsx:4194` | JADE (`:4193`), inner tab `plant-warehouse` | result plant→warehouse flows | FM >10 (`:404`), band reset (`:327-330`) | none | ↓ client CSV `plant-to-warehouse-flows.csv` (`:337-343`) | — | none | none |
| 6 | P3 | JadeFlows W→C | `JadeFlowsTab.tsx:476` / same | JADE, inner tab `warehouse-customer` | result warehouse→customer flows | FM >10 (`:420`), band reset (`:332-335`) | none | ↓ client CSV `warehouse-to-customer-flows.csv` (`:345-351`) | — | none | none |
| 7 | P3 | CostSummary single | `CostSummaryTab.tsx:459` / `Workspace.tsx:4177` | all 7 (`:4175`), `!compareMode` | metric rows (transposed) | none | none | ↓ `costSummary` csv (`:447`) | — | none | none |
| 8 | P3 | CostSummary compare | `CostSummaryTab.tsx:509` / same | all 7, 2–4 solved same-model scenarios | metric rows × scenario columns | none | none | none today; Bundle 1 SCU-1.3 adds client CSV | — | none | none |
| 9 | P3 | ServiceStats Plant Production | `ServiceStatsTab.tsx:368` / `Workspace.tsx:4231` | JADE (`showPlantProduction`, `:241-242`) | result per plant × product | FM >10 (`:363-365`) | none | part of `serviceStats` csv (`:303`) | — | none | none |
| 10 | P4 | Distances | `DistancesTab.tsx:733` / `Workspace.tsx:3754` | p-median-us, p-median-brazil, max-coverage-us (`:3751`) | reference pairs (active, or carrying a current/saved override) ⊕ overrides ⊕ added pairs appended (`:390-403`) | F/T always (`:632,642`) | local 50 (`:330`), pager **always** (`:849`) | ↑↓ `distances` csv/json | inline `+ Add row` | override cell (`useDistanceDraft`); no hist prop (write dropped at `Workspace.tsx:1877-1878`) | amber changed, sky estimated (`:753`) |
| 11 | P4 | LegDistances | `LegDistancesTab.tsx:430` / `Workspace.tsx:3796` | two-echelon-gold-au (`:3793`); both legs in one list | overrides list, leg badge column | F/T always (`:345,352`) | none | ↑↓ `legDistances` | inline | value cell (`useDistanceDraft`); no hist prop | amber changed (`:449`) |
| 12 | P4 | JadeDistances | `JadeDistancesTab.tsx:760` / `Workspace.tsx:3831` | JADE (`:3828`) | reference ⊕ overrides ⊕ added; focus jump (`:441-505`) | FM text `from`/`to` >10 (`:449-450,666`) | local 50 (`:335`), pager always (`:904`) | ↑↓ `legDistances` | inline (+ leg select) | override cell; no hist prop | amber changed, sky estimated (`:783`) |
| 13 | P4 | LaneCosts | `LaneCostsTab.tsx:388` / `Workspace.tsx:3884` | transport-coal (`:3881`) | overrides list | F/T always (`:306,313`) | none | ↑↓ `laneCosts` | inline | value cell; no hist prop | amber changed (`:407`) |
| 14 | P4 | DeliveryCosts | `DeliveryCostsTab.tsx:365` / `Workspace.tsx:3913` | delivery-teaching-us (`:3910`) | base 33×313 ⊕ overrides, base then added (`:186`) | F/T always (`:285,295`) | module 50 (`:59`), pager **always** (`:427-451`) | none today (P2 adds `deliveryCosts`) | inline `+ Add row` (kept, B2.7) | local `CostCell`; never disabled | amber **override-present** (`:379`) |
| 15 | P4 | TransportCosts | `TransportCostsTab.tsx:214` / `Workspace.tsx:3865` | JADE (`:3862`) | 2 fixed rows | none | none | none (out of scope) | none | 4 fields, `disabled={isBrowsingHistoryNow}` (`Workspace.tsx:3871`) — only input tab with a hist prop | none |
| 16 | P4 | CapabilityMatrix | `CapabilityMatrixTab.tsx:171` / `Workspace.tsx:3570` | `supportsPlantProductCapability` = JADE (`:3567`) | plants × products pivot | FM >10 (`:167`), filter-only `state` descriptor (`:65`) | none | none (out of scope) | none | checkbox per cell, never disabled | none |
| 17 | P4 | Warehouses base | `WarehouseTable.tsx:102` via `WarehousesTab.tsx:571` / `Workspace.tsx:3473` | p-median-us, p-median-brazil, JADE, max-coverage-us, delivery (`:3470`) | dataset warehouses ⊕ status/capacity overrides | FM opt-in JADE only (`Workspace.tsx:3501`), >10 | none | ↑↓ `warehouses` | — | capacity input, status buttons; disabled in hist | none |
| 18 | P4 | Warehouses added | `WarehousesTab.tsx:391` / same | all of #17 except delivery (`Workspace.tsx:3488-3494`) | `inputs.addedWarehouses` | none | none | shares #17 toolbar | inline form below table `button-add-warehouse-row` → B2.8 modal | capacity, status, delete; **not** disabled in hist (D2) | none (precheck chip) |
| 19 | P4 | Refineries base | `WarehouseTable.tsx:102` via `WarehousesTab.tsx:571` (`entity="refineries"`) / `Workspace.tsx:3524` | two-echelon-gold-au (`:3521`) | dataset minus mines ⊕ `refineryOverrides` | none | none | ↑↓ `refineries` | — | status buttons, disabled in hist (`:3542`) | none |
| 20 | P4 | Refineries added | `WarehousesTab.tsx:391` / same | two-echelon-gold-au | `inputs.addedRefineries` | none | none | shares #19 | inline form, trigger `button-add-warehouse-row` (D4) → modal | status, delete; not disabled in hist | none |
| 21 | P4 | Customers base (scalar) | `CustomerTable.tsx:136` via `CustomersTab.tsx:745` / `Workspace.tsx:3622` | p-median-us, gold-au, p-median-brazil, max-coverage-us, delivery (`:3614-3618`) | dataset customers ⊕ demand/include overrides | FM opt-in JADE only → never here | none | ↑↓ `customers` | — | demand `type=number` (`CustomerTable.tsx:163-173`), disabled in hist or `!demandEditable` (Brazil) | none |
| 22 | P4 | Customers added (scalar) | `CustomersTab.tsx:486` / same | all of #21 except delivery (`Workspace.tsx:3664-3671`) | `inputs.addedCustomers` | none | none | shares #21 | inline form `button-add-customer-row` → modal | demand (empty → 0 today), delete; not disabled in hist | none (precheck chip) |
| 23 | P4 | JADE per-product customers base | `CustomersTab.tsx:678` / same | JADE (`productMode`, `:158`) | dataset ⊕ per-product overrides | FM >10, one `demand:{productId}` range per product (`:370-378`) | none | ↑↓ `customers` | — | per-product demand `input-customer-demand-{c}-{p}`; **not** disabled in hist | none |
| 24 | P4 | JADE per-product customers added | `CustomersTab.tsx:486` (productMode) / same | JADE (`Workspace.tsx:3680-3684`) | `inputs.addedCustomers` with `demands` | none | none | shares #23 | same form + per-product demand inputs | per-product demand, delete; not disabled in hist | none |
| 25 | P4 | Plants base | `PlantsTab.tsx:393` / `Workspace.tsx:3551` | JADE (`:3548`) | dataset plants (read-only) | FM >10 (`:113`) | none | ↑↓ `plants` | — | none | none |
| 26 | P4 | Plants added | `PlantsTab.tsx:275` / same | JADE (`:3555-3557`) | `inputs.addedPlants` | **second, independent** FM >10 (`:265-267`) | none | shares #25 | inline form `button-add-plant-row` → modal | delete only; no disabled prop at all | none |
| 27 | P4 | Mines base | `MineTable.tsx:26` via `MinesTab.tsx:418` / `Workspace.tsx:3698` | transport-coal (`:3695`) | dataset ⊕ `mineCapacities` | none | none | ↑↓ `mines` | — | capacity (`parseInt`); no disabled prop | none |
| 28 | P4 | Mines added | `MinesTab.tsx:262` / same | transport-coal (`:3704-3706`) | `inputs.addedMines` | none | none | shares #27 | inline form `button-add-mine-row` → modal | capacity, delete; not disabled in hist | none (precheck chip) |
| 29 | P4 | Stations base | `StationTable.tsx:26` via `StationsTab.tsx:395` / `Workspace.tsx:3718` | transport-coal (`:3715`) | dataset ⊕ `stationDemands` | none | none | ↑↓ `stations` | — | demand (`parseInt`, truncates decimals); no disabled prop | none |
| 30 | P4 | Stations added | `StationsTab.tsx:240` / same | transport-coal (`:3724-3726`) | `inputs.addedStations` | none | none | shares #29 | inline form `button-add-station-row` → modal | demand, delete; not disabled in hist | none (precheck chip) |

**Excluded surfaces (spec §B2.10 "Excluded"):**
- **ServiceStats band bars** — non-tabular divs (`ServiceStatsTab.tsx:287-343`); Bundle 1 SCU-1.2 rewrites them as exclusive band rows; not a DataTable.
- **`ImportDialog` preview/error grids** — `components/ImportDialog.tsx:150` and `:185` (each already uses `FilterMenu`, `:146,181`); dialog-internal.
- Scanned and found **no** table: `OptimizationParametersTab.tsx`, `BandChipEditor.tsx`, `InputMapTab.tsx`, `components/workspace/map/**`; the CostSummary compare picker and the JadeFlows segmented control are not tables.

**Legacy reuse:** `components/tables/{WarehouseTable,CustomerTable,MineTable,StationTable}.tsx` are also rendered by the legacy `pages/Studio.tsx:25-28`; `Workspace.tsx` imports only their types (`:76-79`). P4 therefore stops rendering them from the Workspace tabs instead of rewriting them in place, and leaves `Studio.tsx` untouched (D6's reasoning applies).

## 2. Instance records

### 2a. Outputs (P3) — measured at `46d2f98`

All paths under `artifacts/studio/src/` unless shown. All output grids are mounted from one gate in `pages/Workspace.tsx:4074-4088`: the view must be in `["open-warehouses","customer-assignments","cost-summary","service-stats","flows"]` (`:4076`), a fresh solved run must exist (`:4078`, else `StaleOutputBanner`), and the model manifest's `capabilities.outputGrids` must contain the capability (`:4081-4087`, else `tab-content-placeholder`). Measured `outputGrids` (from `solvers/*/manifest.json`):

| model | outputGrids |
|---|---|
| p-median-us, p-median-brazil, max-coverage-us, delivery-teaching-us | openWarehouses, assignments, costSummary, serviceStats |
| transport-coal | flows, costSummary, serviceStats |
| two-echelon-gold-au | openWarehouses, flows, assignments, costSummary, serviceStats |
| two-echelon-jade-us | openWarehouses, assignments, flows, costSummary, serviceStats |

Note: Bundle 1 (SCU-1.3, SCU-1.4) removes the tab-level title spans quoted below and rebuilds the CostSummary bar before P3 starts. P3 must re-verify line numbers after Bundle 1 lands; the testids below are unchanged by Bundle 1 except where Bundle 1 adds `button-toggle-compare`.

#### OpenWarehouses
- **File:** `components/workspace/tabs/OpenWarehousesTab.tsx:220` (`<table>`), mounted at `pages/Workspace.tsx:4109`
- **Models / gate:** every model whose `outputGrids` has `openWarehouses`: p-median-us, p-median-brazil, max-coverage-us, delivery-teaching-us, two-echelon-gold-au, two-echelon-jade-us (gate `Workspace.tsx:4107`). Not transport-coal.
- **Row source & pipeline:** `openWarehouseRows(result)` (`:80-108`): sum `edge.flow` per `fromId`, skipping `mine_to_refinery`/`plant_to_warehouse` legs; plus zero-flow rows for `metrics.openFacilityIds` not already present; `utilization` joined from `metrics.utilizationByNode`. Order = Map insertion order (edge order, then openFacilityIds). No overrides/added/inactive. Identity: `resolveWarehouseIdentity` (`:129-143`) prefers `identityById`, else `displayCodeById(displayedInputs)` (added warehouses/refineries) + `locationById`.
- **Columns:** `Warehouse — text — EntityIdCell(displayId, location)`; `Total Flow` or `Demand Served` (when `capacityModes` is an explicit `[]`, JADE + delivery, `Workspace.tsx:4119-4124`) `— number — totalFlow.toLocaleString()`; `Utilization — number — Math.round(utilization)% or "—"` (hidden when `showDemandServed` or `capacityMode === "none"`, `:158`).
- **Filter today:** FilterMenu, opt-in `enableFilters` (true only for JADE, `Workspace.tsx:4129`), shown when `totalCount > 10` (`:204`). Descriptors (`:165-190`): `warehouse` text (accessor = `"City, ST displayId"` or displayId), `flow` number, `utilization` number (only when shown).
- **Paging today:** none.
- **Upload / Download entity:** download `openWarehouses` csv via `useExport().download("openWarehouses","csv")` (`:211`); disabled via `disabledReasonFor("openWarehouses")` (`:212-213`). No upload.
- **Add flow:** n/a.
- **Editable cells + disable rules:** none.
- **Highlighting:** none (`className="border-b"` only).
- **Testid map:**

| testid | element | line |
|---|---|---|
| `open-warehouses-empty` | empty-state div ("No solved result yet.") | 196 |
| `button-download-open-warehouses-csv` | toolbar Download CSV button | 209 |
| `button-filter-menu-trigger` (+ FilterMenu internals `filter-menu-popover`, `filter-control-{key}`, `input-filter-{key}`, `input-filter-{key}-min/-max`, `select-filter-{key}`, `option-filter-{key}-{v}`, `checkbox-filter-{key}-{v}`, `button-clear-filter-{key}`, `text-filter-active-count`, `text-filter-count`, `button-clear-all-filters`) | FilterMenu (JADE only) | 205 → `components/tables/FilterMenu.tsx:56-188` |
| `open-warehouse-row-{warehouseId}` | `<tr>` | 232 |
| (none) | `<th>` × 2-3, `<td>` cells | 223-225, 233-239 |

- **e2e references:** `jade-ch9-workspace-bundle.spec.ts:471` — `[data-testid^="open-warehouse-row-"]`; `:473-475` — body text contains "Demand Served"; `jade-two-echelon.spec.ts:152-153` — `open-warehouse-row-` prefix + count; `max-coverage.spec.ts:181-184` — `open-warehouse-row-DAL/LA/PIT` + count 3. `open-warehouses-empty`, `button-download-open-warehouses-csv`, "Total Flow", "Utilization" (as asserted string): none (grep run). Comment-only mentions of "Open Warehouses": `delivery-teaching.spec.ts:34,260`, `max-coverage.spec.ts:179`, `workspace-fixups-2.spec.ts:9,302`.
- **Unit tests referencing it:** `__tests__/OpenWarehousesTab.test.tsx`, `__tests__/Workspace.test.tsx` (row prefix); `__tests__/Workspace.TabCoverage.test.tsx` (download button).

#### Assignments (shared, non-JADE)
- **File:** `components/workspace/tabs/AssignmentsTab.tsx:184` (`<table>`), mounted at `pages/Workspace.tsx:4159`
- **Models / gate:** `customer-assignments` and `modelId !== "two-echelon-jade-us"` (`Workspace.tsx:4142` routes JADE away, `:4157`): p-median-us, p-median-brazil, max-coverage-us, delivery-teaching-us, two-echelon-gold-au.
- **Row source & pipeline:** `aggregatedAssignmentRows(result)` (`:91-106`): if any edge has `leg`, keep only `FACILITY_TO_DEMAND_LEGS`; one row per `toId` (first edge supplies warehouse/distance, flows summed). Edge order. No overrides/added/inactive.
- **Columns:** `Customer — text — resolveCell(customerId)`; `Warehouse — text — resolveCell(warehouseId, codeById ?? id)`; `Distance ({unit}) — number — unit.toDisplay(distance).toFixed(1) or "—"` (header label at `:155`); `Flow — number — flow.toLocaleString()`.
- **Filter today:** none.
- **Paging today:** none (renders every row; workspace-fixups-2 e2e expects > 10 rows on p-median-us, 200 customers).
- **Upload / Download entity:** download `assignments` csv (`:176`). No upload.
- **Add flow:** n/a. **Editable cells:** none. **Highlighting:** none.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `assignments-empty` | empty-state div | 160 |
| `button-download-assignments-csv` | Download CSV button | 174 |
| `assignment-row-{customerId}` | `<tr>` | 195 |
| (none) | `<th>` × 4, `<td>` × 4 | 187-190, 196-199 |

- **e2e references:** `workspace-fixups-2.spec.ts:306-319` — `assignment-row-` prefix, count > 10, **structural**: `firstRow.locator("td").nth(0).locator(".flex.flex-col")` → 2 `span`s, second has class `font-mono` (EntityIdCell DOM shape, `components/tables/EntityIdCell.tsx:34-39`). `jade-two-echelon.spec.ts:157` comment only. `assignments-empty`, `button-download-assignments-csv`: none (grep run).
- **Unit tests referencing it:** `__tests__/AssignmentsTab.test.tsx`, `__tests__/Workspace.test.tsx`, `__tests__/Workspace.TabCoverage.test.tsx`.

#### JadeAssignments
- **File:** `components/workspace/tabs/JadeAssignmentsTab.tsx:323` (`<Table>`), mounted at `pages/Workspace.tsx:4144`
- **Models / gate:** `customer-assignments && modelId === "two-echelon-jade-us"` (`Workspace.tsx:4142`).
- **Row source & pipeline:** `extractAssignments(result)` mapped to rows keyed `${productId}|${customerId}` (`:233-246`); labels from `dataset` + `displayedInputs.addedCustomers/addedWarehouses` (snapshot); `band = bandLabel(distanceMi, effectiveBands)` where bands = live `activeBandLens` (`Workspace.tsx:4148`) or `DEFAULT_DISTANCE_BANDS`. → `useTableFilters` → `pageCount`/`currentPage = min(page,pageCount)`/slice 50 (`:284-286`). Page is NOT reset on filter change (clamped only).
- **Columns:** `Product — enum — productLabel`; `Customer — text — renderJadeEntityCell(customerId, customerLabel, identityById, rows.length > 10)`; `Assigned Warehouse — text/enum — renderJadeEntityCell(warehouseId, …)`; `Distance — number — "{toDisplay.toFixed(1)} {unit}"` (header class `text-right`, `:329`); `Distance Band — enum — r.band` ("Band N"/"Overflow").
- **Filter today:** FilterMenu when `totalCount > 10` (`:308`). Descriptors (`:248-267`): `product` select, `customer` text, `warehouse` select, `distance` number (canonical value), `band` select whose accessor is **`bandRangeLabel(toDisplay(distance), displayBands, unit)`** ("Band N: 0 mi - 200 mi"), i.e. the filter value differs from the cell text. Effect (`:277-280`) clears ONLY the `band` filter when bands/unit change.
- **Paging today:** local `PAGE_SIZE = 50` (`:166`), local `Pager` (`:168-205`), shown when `filteredRows.length > 50` (`:359`).
- **Upload / Download entity:** download `assignments` csv (`:314`). No upload.
- **Add flow:** n/a. **Editable:** none. **Highlighting:** none.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `jade-assignments-empty` | empty-state div | 294 |
| `jade-assignments-tab` | tab root div | 301 |
| `text-jadeassignments-count` | toolbar "{filtered} of {total}" span (always shown) | 305 |
| `button-filter-menu-trigger` + FilterMenu internals | FilterMenu | 308 |
| `button-download-jadeassignments-csv` | Download CSV | 313 |
| `row-jadeassignment-{productId}\|{customerId}` | `<TableRow>` | 335 |
| `cell-jadeassignment-product-{key}` | `<TableCell>` | 336 |
| `cell-jadeassignment-customer-{key}` | `<TableCell>` | 337 |
| `cell-jadeassignment-warehouse-{key}` | `<TableCell>` | 340 |
| `cell-jadeassignment-distance-{key}` | `<TableCell>` | 343 |
| `cell-jadeassignment-band-{key}` | `<TableCell>` | 346 |
| (none) | "No rows match the current filter." colSpan=5 row | 349-354 |
| `button-jadeassignments-prev` | pager Prev | 187 |
| `jadeassignments-page-indicator` | "Page X of Y" | 191 |
| `button-jadeassignments-next` | pager Next | 200 |

- **e2e references:** `jade-ch9-workspace-bundle.spec.ts:334,398` — `jade-assignments-tab`; `:335` — `cell-jadeassignment-band-` first = "Overflow"; `:399-400` — **structural** `[data-testid="jade-assignments-tab"] thead th` inner texts `== ["Product","Customer","Assigned Warehouse","Distance","Distance Band"]`; `workspace-fixups.spec.ts:328-329,375` — `jade-assignments-tab` + scoped `button-filter-menu-trigger`; `:340,415` — `distinctFilterOptionLabels(page,"band")` (helper `:200` reads FilterMenu option testids by key), `text-filter-count` `:350,356,431,447`; match `^Band \d+: …`; `:454` — `cell-jadeassignment-distance-` cells scoped in tab; `workspace-fixups-2.spec.ts:540-541` (trigger), `:546-557` (band option labels "Band 1: 0 mi - 200 mi"… via filter key `band`), `:562` — `cell-jadeassignment-band-` texts `^(Band \d+|Overflow)$`; `jade-two-echelon.spec.ts:160` — `row-jadeassignment-` prefix; `:164-165` — `text-jadeassignments-count` contains "of 400". Pager testids, `jade-assignments-empty`, download button: none (grep run).
- **Unit tests referencing it:** `__tests__/JadeAssignmentsTab.test.tsx` (`row-jadeassignment-`, `text-jadeassignments-count`, download button).

#### Flows (shared, non-JADE)
- **File:** `components/workspace/tabs/FlowsTab.tsx:126` (`<table>`), mounted at `pages/Workspace.tsx:4205`
- **Models / gate:** `flows && modelId !== "two-echelon-jade-us"` (`Workspace.tsx:4193` routes JADE away, `:4204`): transport-coal, two-echelon-gold-au.
- **Row source & pipeline:** `flowRows(result)`; row key `${fromId}-${toId}[-${productId}]` (`:144`). Edge order. No overrides/added.
- **Columns:** `From — text — resolveCell(fromId)`; `To — text — resolveCell(toId)`; `Product — enum — productId ?? "—"` (only when any row has `productId`, `:108,131`); `Distance ({unit}) — number`; `Flow — number`. **Note:** the call site does not pass `distanceUnit` (`Workspace.tsx:4205`), so `canonicalResolved` is false and every distance cell renders "—" with header "Distance" (`:95-98`). Recorded as a grounding fact, not changed by the migration.
- **Filter today:** none. **Paging today:** none.
- **Upload / Download entity:** download `flows` csv (`:118`).
- **Add flow / Editable / Highlighting:** none.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `flows-empty` | empty-state div | 100 |
| `button-download-flows-csv` | Download CSV | 116 |
| `flow-row-{fromId}-{toId}` / `flow-row-{fromId}-{toId}-{productId}` | `<tr>` | 145 |

- **e2e references:** `jade-two-echelon.spec.ts:167` comment only. Others: none (grep run).
- **Unit tests referencing it:** `__tests__/FlowsTab.test.tsx`, `__tests__/Workspace.test.tsx`, `__tests__/Workspace.TabCoverage.test.tsx`.

#### JadeFlows P→W
- **File:** `components/workspace/tabs/JadeFlowsTab.tsx:436` (`<Table>` inside `jade-flows-pw-table` div `:435`), mounted at `pages/Workspace.tsx:4194`
- **Models / gate:** `flows && modelId === "two-echelon-jade-us"` (`Workspace.tsx:4193`). Rendered when inner tab = `plant-warehouse` (default, `:213`).
- **Row source & pipeline:** `aggregatePlantToWarehouse(result.edges)` (`:137-152`) → rows keyed `${plantId}|${warehouseId}` (`:233-245`); plant labels from `effectivePlants ?? dataset.plants`; `band = bandLabel(distance, effectiveBands)`. → `useTableFilters` → render all (no paging).
- **Columns:** `Plant — enum — renderJadeEntityCell(plantId, plantLabel, …, pwRows.length > 10)`; `Warehouse — enum — renderJadeEntityCell(warehouseId, …)`; `Distance — number — "{x.toFixed(1)} {unit}"` (`text-right`); `Flow — number — flow.toLocaleString()` (`text-right`); `Distance Band — enum — band`.
- **Filter today:** FilterMenu when `pwFilters.totalCount > 10` (`:404`). Descriptors (`:269-287`): `plant` select, `warehouse` select, `distance` number, `flow` number, `band` select (range-label accessor ≠ cell text). Effect `:327-330` clears only `band` on bands/unit change.
- **Paging today:** none.
- **Upload / Download entity:** **client-built** `downloadClientCsv("plant-to-warehouse-flows.csv", ["Plant","Warehouse","Distance","Flow","Distance Band"], …)` (`:337-343`; helper `:189-203`, moved to `lib/clientCsv.ts` by Bundle 1 SCU-1.3). Spec B2.4 renames to `jade-flows-plant-warehouse.{csv,json}` with a typed row builder.
- **Add flow / Editable / Highlighting:** none.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `jade-flows-empty` | empty-state | 354 |
| `jade-flows-tab` | tab root (shared with W→C) | 393 |
| `jade-flows-inner-tabs` | segmented control group | 365 |
| `button-jade-flows-inner-plant-warehouse` | segment button (`aria-pressed`) | 369 |
| `button-jade-flows-inner-warehouse-customer` | segment button | 380 |
| `text-jadeflows-pw-count` | "{filtered} of {total}" span | 401 |
| `button-filter-menu-trigger` + internals | FilterMenu | 404 |
| `button-download-jade-flows-pw-csv` | Download CSV | 409 |
| `jade-flows-pw-table` | wrapper `<div>` around `<Table>` | 435 |
| `jade-flow-pw-row-{plantId}-{warehouseId}` | `<TableRow>` (note: `-`, not the `|` key) | 448 |
| `cell-jade-flow-pw-plant-{plantId}\|{warehouseId}` | cell | 449 |
| `cell-jade-flow-pw-warehouse-{key}` | cell | 452 |
| `cell-jade-flow-pw-distance-{key}` | cell | 455 |
| `cell-jade-flow-pw-flow-{key}` | cell | 458 |
| `cell-jade-flow-pw-band-{key}` | cell | 461 |
| (none) | "No rows match the current filter." colSpan=5 | 465-469 |

- **e2e references:** `jade-ch9-workspace-bundle.spec.ts:405` — `jade-flows-tab`; `:406` — `button-jade-flows-inner-plant-warehouse` `aria-pressed="true"`; `:407-408` — **structural** `[data-testid="jade-flows-pw-table"] thead th` == `["Plant","Warehouse","Distance","Flow","Distance Band"]`; `jade-two-echelon.spec.ts:171` — `jade-flow-pw-row-` prefix; `:250` — `jade-flow-pw-row-plant-4-wh-11`; `:189-190` — "Plant → Warehouse"/"Warehouse → Customer" (these are on the Output Map leg toggles, `legToggles`, not this tab). Filenames `plant-to-warehouse-flows`: none (grep run).
- **Unit tests referencing it:** `__tests__/JadeFlowsTab.test.tsx` (`jade-flow-pw-row-`, `jade-flows-pw-table`, `text-jadeflows-*`, `button-download-jade-flows-*`).

#### JadeFlows W→C
- **File:** `components/workspace/tabs/JadeFlowsTab.tsx:476` (`<Table>` inside `jade-flows-wc-table` div `:475`), same mount/gate as P→W; rendered when inner tab = `warehouse-customer`.
- **Row source & pipeline:** `warehouseToCustomerEdges(result.edges)` (`:154-…`, `leg === "warehouse_to_customer"`) → rows keyed `${warehouseId}|${customerId}` (`:249-261`) → filters → all rows (no paging).
- **Columns:** `Warehouse — enum`; `Customer — text`; `Distance — number`; `Flows — number` (header literally "Flows"); `Distance Band — enum`.
- **Filter today:** FilterMenu when `wcFilters.totalCount > 10` (`:420`). Descriptors (`:289-305`): `warehouse` select, `customer` text, `distance` number, `flow` number (label "Flows"), `band` select (range label). Effect `:332-335` clears only `band`.
- **Paging today:** none (JADE W→C has ~400 rows rendered at once).
- **Upload / Download entity:** client-built `warehouse-to-customer-flows.csv` (`:345-351`); spec renames to `jade-flows-warehouse-customer.{csv,json}`.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `text-jadeflows-wc-count` | count span | 417 |
| `button-filter-menu-trigger` + internals | FilterMenu | 420 |
| `button-download-jade-flows-wc-csv` | Download CSV | 425 |
| `jade-flows-wc-table` | wrapper div | 475 |
| `jade-flow-wc-row-{warehouseId}-{customerId}` | `<TableRow>` | 488 |
| `cell-jade-flow-wc-warehouse-{warehouseId}\|{customerId}` | cell | 489 |
| `cell-jade-flow-wc-customer-{key}` | cell | 492 |
| `cell-jade-flow-wc-distance-{key}` | cell | 495 |
| `cell-jade-flow-wc-flow-{key}` | cell | 498 |
| `cell-jade-flow-wc-band-{key}` | cell | 501 |
| (none) | "No rows match the current filter." colSpan=5 | 505-509 |
| (shared) `jade-flows-tab`, `jade-flows-inner-tabs`, `button-jade-flows-inner-*`, `jade-flows-empty` | see P→W | 354-393 |

- **e2e references:** `jade-ch9-workspace-bundle.spec.ts:412` — click `button-jade-flows-inner-warehouse-customer`; `:413` — `jade-flows-wc-table` visible; `:414-415` — **structural** `[data-testid="jade-flows-wc-table"] thead th` == `["Warehouse","Customer","Distance","Flows","Distance Band"]`. `jade-flow-wc-row-`, `cell-jade-flow-wc-`, `text-jadeflows-wc-count`: none (grep run).
- **Unit tests referencing it:** `__tests__/JadeFlowsTab.test.tsx`.

#### CostSummary single
- **File:** `components/workspace/tabs/CostSummaryTab.tsx:459` (`<table data-testid="cost-summary-list">`), mounted at `pages/Workspace.tsx:4177`
- **Models / gate:** all 7 (`costSummary` in every manifest; `Workspace.tsx:4175`). Rendered when `!compareMode` (`:334`; compareMode = `!isBrowsingHistory && compareScenarios.length >= 2`, `:297`).
- **Row source & pipeline:** **transposed metric list**, not entity rows: `rows: Array<[label, value, mono, testId?]>` built imperatively (`:365-424`): Objective; (coverage rows: High service cutoff, % of demand within high service, Total demand within high service — when `details.coveragePct` is a number or no incumbent); Max coverable demand (Model 1); Inbound/Outbound cost (presence-gated); Weighted avg. distance / Avg distance to customers; Runtime; Quality; Solver; JADE rates ×4 (`modelId === JADE_MODEL_ID`). Already-formatted strings.
- **Columns:** `"" (metric label) — text — label`; `{ownName} — text — preformatted value` (header `<th data-testid="cost-summary-single-column">`). Value cell `font-mono` per row flag.
- **Filter today:** none. **Paging today:** none.
- **Upload / Download entity:** download `costSummary` csv (`:447`). Bundle 1 SCU-1.3 adds compare-mode client CSV.
- **Add flow / Editable / Highlighting:** none. Toolbar also hosts the compare picker `toggleList` (`:299-331`) above the table and `FloorExceedsMaxAlert` (`:455-458`) above the table inside the scroll area.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `cost-summary-compare-toggles` | picker container (above table, both modes) | 300 |
| `cost-summary-history-hint` | picker hint `<p>` | 303 |
| `cost-summary-compare-toggle-{scenarioId}` | `<label>` wrapping checkbox | 316 |
| `cost-summary-compare-hint-{scenarioId}` | "(solve first)" span | 320 |
| `cost-summary-empty` | empty state | 336 |
| `button-download-cost-summary-csv` | Download CSV | 445 |
| `cost-summary-list` | `<table>` | 459 |
| `cost-summary-single-column` | **`<th>` header cell** | 463 |
| `cost-summary-value-{slug(label)}` (default; slug = `label.toLowerCase().replace(/[^a-z]+/g,"-")`) | value `<td>` | 472 |
| explicit overrides: `cost-summary-high-service-cutoff`, `cost-summary-coverage-pct`, `cost-summary-covered-demand`, `cost-summary-max-coverable-demand`, `cost-summary-rate-ic`, `cost-summary-min-ic`, `cost-summary-rate-ob`, `cost-summary-min-ob` | value `<td>` | 386-388, 396, 418-421 (via 472) |

  Measured slugs in use by e2e: `cost-summary-value-objective`, `-weighted-avg-distance`, `-avg-distance-to-customers`, `-quality`.
- **e2e references:** `jade-two-echelon.spec.ts:174` — `cost-summary-list`; `:125` — `cost-summary-value-objective`; `delivery-teaching.spec.ts:208` — `cost-summary-value-weighted-avg-distance` "422.6 mi"; `chen-bands-units-qa.spec.ts:168,195,202,203` — `cost-summary-value-avg-distance-to-customers`; `:217,221` — `cost-summary-value-weighted-avg-distance`; `jade-transport-costs.spec.ts:84,87,160` — `cost-summary-value-objective`; `:153,158` — `cost-summary-rate-ic/ob`; `:157,159` — `cost-summary-min-ic/ob`; `max-coverage-objective.spec.ts:120,131,150` — objective; `:152` — avg-distance-to-customers "—"; `:121,151` — `cost-summary-max-coverable-demand`; `:132` — `cost-summary-coverage-pct`; `max-coverage.spec.ts:177,282,283` — objective; `:202` — avg-distance-to-customers; `:205-206` — `cost-summary-high-service-cutoff`; `:207` — `cost-summary-coverage-pct`; `:284` — max-coverable-demand; `truthful-status.spec.ts:210,222` — `cost-summary-value-quality`; picker: `bundle6-ui-tweaks.spec.ts:212,215`, `two-echelon.spec.ts:174,178`, `jade-transport-costs.spec.ts:168`, `workspace-ux-r1-r9.spec.ts:245-246,287-288` (`cost-summary-compare-toggles`, `cost-summary-compare-toggle-{id}` → `input`). `cost-summary-single-column`, `cost-summary-empty`, `button-download-cost-summary-csv`, `cost-summary-history-hint`, `cost-summary-compare-hint-`, `cost-summary-covered-demand`: none (grep run).
- **Unit tests referencing it:** `__tests__/CostSummaryTab.test.tsx` (`cost-summary-list`, `cost-summary-value-`), `__tests__/Workspace.test.tsx` (`cost-summary-value-`), `__tests__/Workspace.TabCoverage.test.tsx` (download).

#### CostSummary compare
- **File:** `components/workspace/tabs/CostSummaryTab.tsx:509` (`<table>` inside `cost-summary-compare-table` div `:508`), same mount; rendered when `compareMode`.
- **Models / gate:** all 7; 2–4 (`MAX_COMPARE = 4`, `:128`) solved, non-stale, same-model scenarios, not browsing history.
- **Row source & pipeline:** **transposed**: rows = metrics (hand-written `<tr>` JSX, `:520-765`), columns = selected scenarios in selection order (`:293-296`). Row presence gated across the selection (coverage rows `:541-577`; max coverable `:578-592`; inbound/outbound `:600-624`; JADE rates `:625-683`; open facilities if `supportsFacilityStatus` `:700-735`; band rows when `scenariosShareBands` `:752-765`).
- **Columns:** `"" — text — metric label` (band rows' label cell is `font-mono` `≤ {boundary}`); then one per scenario: header `{s.name}` with testid; cell = formatted value or "—".
- **Filter / Paging:** none. **Download:** none in compare mode today (comment `:493-495`); Bundle 1 SCU-1.3 adds `cost-summary-compare.csv` client-built, B2.4 adds JSON.
- **Testid map:**

| testid | element | line |
|---|---|---|
| (picker testids as in single) | above table | 300-331 |
| `cost-summary-compare-table` | **wrapper `<div>`** around `<table>` | 508 |
| `cost-summary-compare-column-{scenarioId}` | **`<th>` header cell** | 514 |
| `cost-summary-compare-objective-{id}` | `<td>` | 529 |
| `cost-summary-compare-high-service-cutoff-{id}` | `<td>` | 549 |
| `cost-summary-compare-coverage-pct-{id}` | `<td>` | 560 |
| `cost-summary-compare-covered-demand-{id}` | `<td>` | 571 |
| `cost-summary-compare-max-coverable-demand-{id}` | `<td>` | 587 |
| `cost-summary-compare-inbound-{id}` | `<td>` | 608 |
| `cost-summary-compare-outbound-{id}` | `<td>` | 618 |
| `cost-summary-compare-rate-ic-{id}` / `-min-ic-` / `-rate-ob-` / `-min-ob-` | `<td>` | 639, 651, 665, 677 |
| `cost-summary-compare-distance-{id}` | `<td>` | 691 |
| `cost-summary-compare-open-facilities-cities-{id}` | `<td>` | 711 |
| `cost-summary-compare-open-facility-{id}-{facilityId}` | nested `<span>` in that `<td>` | 719 |
| `cost-summary-compare-runtime-{id}` | `<td>` | 738 |
| `cost-summary-compare-quality-{id}` | `<td>` | 746 |
| `cost-summary-compare-band-{band}-{id}` | `<td>` | 760 |
| `cost-summary-compare-bands-note` | `<p>` **below the table**, when bands differ | 770 |

- **e2e references:** `bundle6-ui-tweaks.spec.ts:216` — `cost-summary-compare-table`; `:222` — `cost-summary-compare-open-facilities-cities-{B}`; `two-echelon.spec.ts:180` — table; `:185` — **structural** `tr:has([data-testid^="cost-summary-compare-open-facilities-cities-"])` toContainText cunnamulla/daggar (requires the label and cells in one `<tr>`); `workspace-ux-r1-r9.spec.ts:249,291` — table; `:250-251` — `cost-summary-compare-column-{id}`; `:255-256,299` — open-facilities-cities; `:260-261` — `cost-summary-compare-distance-{id}`; `:293-294` — `cost-summary-compare-objective-{id}`; `jade-transport-costs.spec.ts:170,172,178` — `cost-summary-compare-rate-ic/ob-{id}`; `:176,180` — `cost-summary-compare-min-ic/ob-{id}`. high-service/coverage/covered/max/inbound/outbound/runtime/quality/band/bands-note: none (grep run).
- **Unit tests referencing it:** `__tests__/CostSummaryTab.test.tsx` (`cost-summary-compare-table`, `cost-summary-compare-band-`).

#### ServiceStats Plant Production
- **File:** `components/workspace/tabs/ServiceStatsTab.tsx:368` (`<Table>` inside `plant-production-section` div `:360`), mounted at `pages/Workspace.tsx:4231`
- **Models / gate:** `showPlantProduction` = `supportsPlantProductCapability && effectivePlants && products && baseCapabilities` (`:241-242`); the call site passes those only for `two-echelon-jade-us` (`Workspace.tsx:4235-4238`). JADE only.
- **Row source & pipeline:** `buildPlantProductionRows(effectivePlants, products, baseCapabilities, capabilityOverrides, edges)` (`:231-234`) — full plants × products grid (16 rows measured by e2e), left-joined to inbound production; snapshot props. → `useTableFilters` → all rows (no paging).
- **Columns:** `Plant — enum — renderPlantCell(plantId, plantLabel, identityById, rows.length > 10)`; `Product — enum — productLabel`; `Actual production — number — actual.toLocaleString()`; `Enabled capacity — number — capacity.toLocaleString()`; `Remaining capacity — number — remaining ?? "—"` (nullable). Number cells are `font-mono`, left-aligned today (no `text-right`).
- **Filter today:** FilterMenu when `totalCount > 10` (`:363-365`); module-level descriptors (`:160-165`): `plant` select (value = `plantIdCityState` label, e.g. "plant-1 — Ashland, KY"), `product` select, `actual` number, `capacity` number. **No descriptor for Remaining capacity.**
- **Paging today:** none. **Download:** part of `serviceStats` csv (`:303`, tab-level button, not section-level). **Upload:** none.
- **Add flow / Editable / Highlighting:** none.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `plant-production-section` | section wrapper div | 360 |
| `button-filter-menu-trigger` + internals | FilterMenu (section header) | 364 |
| `row-plant-production-{plantId}-{productId}` | `<TableRow>` | 382 |
| (none) | `<TableHead>` × 5, cells | 371-375, 384-391 |

- **e2e references:** `jade-ch9-workspace-bundle.spec.ts:419,481` — `plant-production-section`; `:421-423` — **structural** `[data-testid="plant-production-section"] thead th` == `["Plant","Product","Actual production","Enabled capacity","Remaining capacity"]`; `:426,496,499` — `row-plant-production-` count 16 / 4 / 16; `:429` — `row-plant-production-plant-1-product-2`; `:482-499` — section-scoped `button-filter-menu-trigger` (`:483-484`), `text-filter-count` "16 of 16"/"4 of 16" (`:488,495,498`), `checkbox-filter-plant-plant-1 — Ashland, KY` (`:494`; descriptor key `plant` + option value), `button-clear-all-filters`.
- **Unit tests referencing it:** `__tests__/ServiceStatsTab.test.tsx`.

#### EXCLUDED — ServiceStats band bars
- `components/workspace/tabs/ServiceStatsTab.tsx:315-357`: non-tabular `<div>` bar list (`service-stats-band-{band}` `:343`, `service-stats-no-bands` `:316`), plus `service-stats-empty` `:258`, `service-stats-unit-pending` `:266`, `button-download-service-stats-csv` `:301`. Not a table; out of DataTable scope (spec B2.10 "Excluded"). Bundle 1 SCU-1.2 rewrites its rows. e2e (for the record): `bundle2-fastfollow.spec.ts:311-312`, `chen-bands-units-qa.spec.ts:361`, `delivery-teaching.spec.ts:211,225`, `jade-two-echelon.spec.ts:177`, `nonjade-servicestats-live-coverage.spec.ts:232,233,248,249,253,350,353,435,436,454,455,459`, `workspace-ux-r1-r9.spec.ts:211,214,220`.

#### Other tabular things found in these files
- `CostSummaryTab.tsx:299-331` compare picker is a checkbox list (flex-wrap `<label>`s), not a table — stays outside DataTable (toolbar `extra`).
- `JadeFlowsTab.tsx:360-390` segmented control — not a table; two separate DataTable instances behind it.
- No other `<table>`/`<Table>` in the seven files (grep of `<table\|<Table\b` returned only the instances above).

#### API-gap findings (outputs)
1. **Header-cell testids.** `cost-summary-single-column` (`CostSummaryTab.tsx:463`) and `cost-summary-compare-column-{id}` (`:514`) sit on `<th>`. Spec `ColumnDef` has `cellTestId?(row)` but no header testid → needs `headerTestId?: string` on `ColumnDef`. e2e uses the compare one (`workspace-ux-r1-r9.spec.ts:250-251`).
2. **Table testid on a wrapper div, not `<table>`.** `cost-summary-compare-table` (`:508`), `jade-flows-pw-table` (`JadeFlowsTab.tsx:435`), `jade-flows-wc-table` (`:475`), `plant-production-section` (`ServiceStatsTab.tsx:360`), `jade-assignments-tab` (`JadeAssignmentsTab.tsx:301`), `jade-flows-tab` (`JadeFlowsTab.tsx:393`) are on containers, and e2e scopes `… thead th` and `button-filter-menu-trigger` **inside** them (`jade-ch9-workspace-bundle.spec.ts:399,407,414,421,483`; `workspace-fixups.spec.ts:329`). `testIds.table` must therefore land on an element that contains BOTH the toolbar (filter trigger) and the `<thead>`, i.e. the DataTable root, or the adapter keeps the wrapper outside DataTable. `cost-summary-list` (`:459`), by contrast, is on `<table>` itself. Needs either `testIds.root` + `testIds.table` or a rule that `testIds.table` goes on the root container.
3. **Structural selectors depend on `<thead><th>` and `<tr><td>`.** `thead th` innerTexts (4 sites above), `tr:has(...)` (`two-echelon.spec.ts:185`), `td.nth(0) .flex.flex-col span` (`workspace-fixups-2.spec.ts:310-318`). DataTable must render real `thead`/`th`/`tr`/`td` (via `components/ui/table.tsx`, which does) and must not add extra `<th>`s (e.g. a selection or action column) or the header-equality assertions fail.
4. **"{filtered} of {total}" counter outside FilterMenu.** `text-jadeassignments-count` (`JadeAssignmentsTab.tsx:305`), `text-jadeflows-pw-count` / `-wc-count` (`JadeFlowsTab.tsx:401,417`) are always-visible toolbar spans (e2e `jade-two-echelon.spec.ts:164`). Not in the spec's `testIds` map → needs `testIds.count?` (or `toolbar.extra` must receive filtered/total counts, which a static ReactNode cannot).
5. **Pager button testids.** JadeAssignments emits `button-jadeassignments-prev`/`-next` (`:187,200`) besides the indicator; spec `testIds` has only `pager` + `pageIndicator` → needs `pagerPrev?`/`pagerNext?`.
6. **Filter-value ≠ cell text, and band-filter reset.** JADE `band` filter accessor is a unit-aware range label while the cell shows "Band N" (`JadeAssignmentsTab.tsx:256-264`, `JadeFlowsTab.tsx:276-284,296-303`); `value()` covers this. But each of those tabs clears only the `band` filter when bands/unit change (`JadeAssignmentsTab.tsx:277-280`, `JadeFlowsTab.tsx:327-335`) — DataTable owns filter state, so it needs a hook such as `filterResetKeys?: Record<columnId, unknown>` (clear that column's filter when the dep changes) or an imperative handle. Not expressible in the spec API.
7. **Descriptor keys must equal today's keys for e2e.** e2e addresses filters by key: `distinctFilterOptionLabels(page,"band")` (`workspace-fixups.spec.ts:340,415`, `workspace-fixups-2.spec.ts:546`) and `checkbox-filter-plant-…` (`jade-ch9-workspace-bundle.spec.ts:494`). Since spec says descriptor id = column id, adapters must use column ids `band`, `plant`, `product`, `actual`, `capacity`, `warehouse`, `customer`, `distance`, `flow`, `utilization` exactly. Labels too ("Flows" for W→C flow).
8. **Auto-derivation would ADD filters / change types vs today.** Plant Production has no `remaining` descriptor today (would gain a range); JadeAssignments `customer` is `text` today and `warehouse` `select` — auto rule "text → select if ≤ 20 distinct" keeps `customer` text only if > 20 distinct (JADE: ~100, OK) and `warehouse` needs explicit `filter: "select"` if > 20 distinct warehouses. OpenWarehouses `warehouse` is `text` today. Adapters must pin `filter` explicitly where today's type must survive. Also OpenWarehouses gets a filter only when `enableFilters` (JADE) today; the spec's "every table > 10 rows" widens it to all models — a behaviour change to record.
9. **No-match row.** "No rows match the current filter." colSpan row inside `<tbody>` (`JadeAssignmentsTab.tsx:349-354`, `JadeFlowsTab.tsx:465-469,505-509`). Spec `emptyState?` must cover two distinct cases: no rows at all vs. filter-empty (today's tab-level empty states are early returns before any table; the filter-empty one is in-table). Needs `noMatchState?` or a documented single `emptyState` used for filter-empty only.
10. **Transposed metric tables (CostSummary single + compare).** Rows are metrics, columns are scenarios; label column is not a data column of a domain row; cells are pre-formatted strings, per-row `font-mono` flag, per-row default slug testid. Expressible only if the adapter builds `rows: MetricRow[]` and dynamic `columns` per scenario with `cellTestId(row) => row.testIdFor(scenarioId)`. `kind: "number"` centre-alignment would apply to every value column although values are formatted text ("70.42 %", "1.23s", "Optimal") — adapter must use `kind: "text"`, which contradicts "numbers centre-aligned" for numeric metrics. Plus the bands note `<p>` sits **below** the table (`:769-774`) — no footer slot in the spec API (`toolbar`, `emptyState`, `sections` only). Needs `footer?: ReactNode`.
11. **Nested per-entity testids in one cell.** `cost-summary-compare-open-facility-{id}-{facilityId}` spans inside one `<td>` (`:719`) — fine via `cell()` (spec allows nested testids).
12. **Content above the table inside the scroll area.** `FloorExceedsMaxAlert` (`CostSummaryTab.tsx:455-458`) renders above the table; compare picker `toggleList` above the toolbar in both modes. Expressible only as `toolbar.extra`/outside DataTable; no `header`/`above` slot.
13. **Filter visibility opt-in.** OpenWarehouses' FilterMenu is gated by an `enableFilters` prop (JADE only). Spec rule is unconditional > 10 rows; no per-table opt-out other than `filter: false` on every column.
14. **Row testid key ≠ rowKey.** JADE flows use `rowKey` `a|b` but row testid `a-b` (`JadeFlowsTab.tsx:448,488`), while cell testids use `a|b`. Fine because `testIds.row(row)` is a function, but `rowKey` must not be reused to build testids.
15. **Number alignment change.** Today numeric output columns are `text-right` (OW/Assign/Flows/JADE distance+flow) or left (Plant Production). Spec "numbers centre-aligned" changes visual alignment in all of them; no e2e asserts alignment (grep for `text-right` in e2e not part of these needles; header text equality is unaffected).

### 2b. Distance / cost input tables (P4) — 7 table instances

All paths under `artifacts/studio/src/` unless shown. Lines at `46d2f98` (worktree HEAD), grep-verified. e2e greps exclude `labs.spec.ts` (dead).

**History read-only today (all seven):** only `TransportCostsTab` receives a prop (`disabled={isBrowsingHistoryNow}`, `pages/Workspace.tsx:3871`). The other six get **no** read-only prop; their inputs stay enabled while browsing history and the write is silently dropped at the choke point `updateInputsField` (`pages/Workspace.tsx:1877-1878`, `if (isBrowsingHistoryNow) return;`). D2's uniform `ctx.readOnly` is therefore a **new prop** for Distances, LegDistances, JadeDistances, LaneCosts, DeliveryCosts, CapabilityMatrix. Separately, `useDistanceDraft` (`hooks/useDistanceDraft.ts:164`) disables inputs while `canonicalUnit` is unresolved (`draft.disabled`).

---

#### Distances
- **File:** `components/workspace/tabs/DistancesTab.tsx:733` (`<Table>`), parent mount `pages/Workspace.tsx:3754`
- **Models / gate:** `p-median-us`, `p-median-brazil`, `max-coverage-us` — `pages/Workspace.tsx:3751` (`activeView.entity === "distances" && (modelId === "p-median-us" || … "p-median-brazil" || … "max-coverage-us")`). Base column only when `referenceCapable` (`activeModelManifest?.capabilities?.supportsReferenceDistances`, `Workspace.tsx:3769`).
- **Row source & pipeline:** `mergedRowsAll` (`DistancesTab.tsx:390-403`): base = `useGetReferenceDistances(modelId)` pairs (`:342-348`, `staleTime: Infinity`), filtered to pairs where `!inactiveWarehouseIdSet.has(fromId) && !excludedCustomerIdSet.has(toId)` **OR** the pair carries a current (`overrideByKey`) or saved (`savedByKey`) override; each base row gets `override = overrideByKey.get(key)`. Added = `distanceOverrides` whose key is not in `baseByKey`, `base: null`, appended after base (`:399-402`). No sort (reference-matrix order, then overrides-array order). Current edits = `distanceOverrides` prop (= `localInputs`); saved = `savedDistanceOverrides` (= `savedInputsRef.current`, `Workspace.tsx:3757`). Draft per cell via `DistanceOverrideCell` → `useDistanceDraft` (`:137-201`). Text filter → `mergedRows` (`:436-441`) → clamp (`:449-451`, effect lowers `page` when `page > pageCount`) → slice 50 (`:453`).
  **Focus jump** (`:459-467`): on `focusEntityId`, clears both From/To filters, finds `idx` in the **unfiltered** `mergedRowsAll` where `fromId === focusEntityId || toId === focusEntityId`, sets `page = floor(idx / 50) + 1`. A second effect (`:470-479`) scans DOM `[data-testid^="row-distance-"]` and `scrollIntoView({block:"center"})` the first whose suffix starts with `${id}-` or ends with `-${id}`.
- **Columns:** `From — text — fromId (EntityIdCell displayId/location)` · `To — text — toId (EntityIdCell)` · `Base ({unit}) — number — r.base (spinner/"unavailable"/"—" states, `baseCell` :531-545)` · `Override ({unit}) — number — r.override?.distance (editable)` · `(blank) — actions — remove button`
- **Filter today:** From/To boxes, `input-filter-from` (`:632`) / `input-filter-to` (`:642`), placeholders "Filter from ID…"/"Filter to ID…", substring on display code `displayCodeById?.[id] ?? id` (`:420,430-434`); always shown (no >10 gate). No FilterMenu.
- **Paging today:** local `PAGE_SIZE = 50` (`:330`), shared `Pager` (`:205-246`) with `idPrefix="distances"` (mounted `:849`). **Always rendered** whenever the table renders (no `> 50` gate). Filter change sets `page=1` (`:627,637`).
- **Upload / Download entity:** `download("distances","csv"|"json")` (`:594,605`); `ImportDialog entity="distances"` (`:655`).
- **Add flow:** inline. `button-add-distance-row` "+ Add row" (`:704`) → form `add-distance-row-form` (`:661`) with From/To/value + Add/Cancel. Messages (`handleAddRow`, `:547-567`): "From ID and To ID are both required." · "Distance must be a positive number." · "A distance override for this pair already exists — edit it in the table instead." Error `text-add-distance-error` (`:880`).
- **Editable cells + disable rules:** Override cell (`DistanceOverrideCell`, `useDistanceDraft`, commit on blur/Enter, Escape discards, `disabled={draft.disabled}` only — unit unresolved). Inline error "Distance must be a positive number." (`:166-169`). Remove button shown when `r.override || r.base == null` (`:825`). No history prop (see top).
- **Highlighting:** row `className={changed ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined}` (`:753`); `changed` = `isChangedRow` (`:485`: saved vs current presence/value). Badges "Estimated" (sky) and "Changed" (amber) inside the Override cell.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `distances-tab` | root div | 868 |
| `distances-tab-toolbar` | toolbar div | 590 |
| `button-export-distances-csv` | Download CSV button | 597 |
| `button-export-distances-json` | Download JSON button | 608 |
| `button-import-distances` | Upload button | 618 |
| `input-filter-from` | From filter box | 632 |
| `input-filter-to` | To filter box | 642 |
| `distances-reference-section` | wrapper when `referenceCapable` | 876 |
| `distances-reference-error` | reference load error banner | 711 |
| `distances-reference-loading` | reference loading banner | 716 |
| `distances-tab-empty` | empty state `<p>` (`mergedRowsAll.length === 0`) | 727 |
| `row-distance-{fromId}-{toId}` | `<TableRow>` | 752 |
| `warning-unknown-from-{fromId}-{toId}` | unknown-warehouse icon | 765 |
| `warning-unknown-to-{fromId}-{toId}` | unknown-customer icon | 782 |
| `spinner-distance-unit-{fromId}-{toId}` | Base cell spinner (unit unresolved) | 533 |
| `spinner-distance-base-{fromId}-{toId}` | Base cell spinner (reference loading) | 537 |
| `input-distance-{fromId}-{toId}` | Override input (via `inputTestId`, :191) | 802 |
| `text-distance-error-{fromId}-{toId}` | Override inline error (via `errorTestId`, :194) | 803 |
| `badge-distance-estimated-{fromId}-{toId}` | "Estimated" badge | 808 |
| `badge-distance-changed-{fromId}-{toId}` | "Changed" badge | 816 |
| `button-remove-distance-{fromId}-{toId}` | remove override | 829 |
| (none) | "No rows match the current filter." colSpan=5 row | 841-842 |
| `button-distances-prev` | pager Prev (`button-${idPrefix}-prev`) | 225 |
| `distances-page-indicator` | "Page {page} of {pageCount}" (`${idPrefix}-page-indicator`) | 229 |
| `button-distances-next` | pager Next (`button-${idPrefix}-next`) | 238 |
| `add-distance-row-form` | add form div | 661 |
| `input-new-distance-from` / `-to` / `-value` | add form inputs | 667 / 674 / 689 |
| `button-add-distance-confirm` / `button-add-distance-cancel` | Add / Cancel | 691 / 694 |
| `button-add-distance-row` | "+ Add row" | 704 |
| `text-add-distance-error` | add error | 880 |

- **e2e references:** `bundle5-homepage-distances.spec.ts:174` distances-tab · `:178` distances-page-indicator · `:179` "Page 1 of 104" · `:180` button-distances-prev · `:181,183` button-distances-next · `:184` "Page 2 of 104" · `:189` input-filter-from · `:190` "Page 1 of 4" · `:192,197` row-distance- prefix · `:211` input-filter-to · `:212` "Page 1 of 1" · `:213` row-distance-{wh}-{c} · `:224` input-distance-. `bundle6.1-legend-distances.spec.ts:232` distances-tab · `:242` distances-page-indicator · `:243,247` "Page 1/2 of 104" · `:244` button-distances-prev · `:245,246` button-distances-next · `:250` input-filter-from · `:251` input-filter-to · `:253` row-distance- · `:265` input-distance- · `:266` badge-distance-changed-. `chen-bands-units-qa.spec.ts:268,405,745` distances-tab-toolbar · `:269,408` button-add-distance-row · `:271,409,410,411,417,427,434` input-new-distance-* · `:412,428,435` button-add-distance-confirm · `:416,429` text-add-distance-error + "Distance must be a positive number." · `:425,430` badge-distance-changed-ALN-C4 · `:439` input-filter-from · `:440` input-filter-to · `:441,442,456,482` input-distance-ALN-C4 · `:644,645,746,751,758` button-export-distances-csv. `max-coverage.spec.ts:311,372` distances-tab-toolbar · `:312` button-add-distance-row · `:313-315` input-new-distance-* · `:321` button-add-distance-confirm · `:373,377` input-filter-from · `:374` badge-distance-estimated- prefix · `:384` button-import-distances. `input-map-v2.spec.ts:144` distances-tab · `:145,154` badge-distance-estimated- · `:151` input-distance-. Grep run, none: add-distance-row-form, distances-reference-*, distances-tab-empty, warning-unknown-*, button-remove-distance-, text-distance-error, spinner-distance. (`delivery-teaching.spec.ts:217` `input-distance-threshold` is an unrelated parameter field matching the prefix.)
- **Unit tests referencing it:** `__tests__/DistancesTab.test.tsx` (1536 lines; filter boxes :289-341, pager :361-367, :1112-1209); root testid in `Workspace.InputMapV2.test.tsx`, `Workspace.Brazil.test.tsx`, `Workspace.TabCoverage.test.tsx`.

---

#### LegDistances (one table instance — both legs share one flat list)
- **File:** `components/workspace/tabs/LegDistancesTab.tsx:430`, parent mount `pages/Workspace.tsx:3796`
- **Models / gate:** `two-echelon-gold-au` only — `Workspace.tsx:3793`. One instance: both legs (mine→refinery, refinery→customer) render in one table, leg shown as a badge column (`:419-420` help text "One flat list covers both legs…").
- **Row source & pipeline:** overrides only, **no base matrix**: rows = `distanceOverrides` (`localInputs`) filtered by From/To substring on **raw id** (`visibleRows`, `:236`). Saved = `savedDistanceOverrides` (`savedByKey`, `:200`). No inactive handling, no added/base split, no sort, **no paging**. Leg computed per row by id-space membership (`legFor`, `:207`). Focus jump (`:183-195`): DOM scroll only (no page to compute).
- **Columns:** `Leg — enum — legFor(fromId,toId)` ("Mine → Refinery" / "Refinery → Customer" / "Unrecognized pair", `LEG_LABEL` `:230`) · `From — text — fromId (EntityIdCell)` · `To — text — toId` · `Distance ({unit}) — number — o.distance (editable)` · `(blank) — actions`
- **Filter today:** From/To boxes `input-filter-from` (`:345`) / `input-filter-to` (`:352`), always shown. No FilterMenu.
- **Paging today:** none.
- **Upload / Download entity:** `download("legDistances", …)` (`:310,321`); `ImportDialog entity="legDistances"` (`:362`).
- **Add flow:** inline `button-add-legdistance-row` (`:411`) → `add-legdistance-row-form` (`:368`). Messages (`:262-276`): "From ID and To ID are both required." · "Distance must be a positive number." · "A distance override for this pair already exists — edit it in the table instead." · "This pair doesn't resolve as a mine→refinery leg or a refinery→customer leg — check the IDs." Error `text-add-legdistance-error` (`:513`).
- **Editable cells + disable rules:** `LegDistanceValueCell` (`useDistanceDraft`, `presentation: "grouped"`, `:90-125`), `disabled={draft.disabled}` only. Remove always shown. No history prop.
- **Highlighting:** `className={changed ? "bg-amber-50" : undefined}` (`:449`), `isChanged` = no saved entry or saved ≠ current (`:242`) — so every unsaved new row is amber. "Changed" badge.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `legdistances-tab` | root | 418 |
| `legdistances-tab-toolbar` | toolbar | 306 |
| `button-export-legdistances-csv` / `-json` | downloads | 313 / 324 |
| `button-import-legdistances` | Upload | 334 |
| `input-filter-from` / `input-filter-to` | filter boxes | 345 / 352 |
| `legdistances-tab-empty` | empty state | 425 |
| `row-legdistance-{fromId}-{toId}` | row | 448 |
| `badge-leg-{fromId}-{toId}` | leg badge | 454 |
| `input-legdistance-{fromId}-{toId}` | value input (via `inputTestId`, :122) | 473 |
| `badge-legdistance-changed-{fromId}-{toId}` | "Changed" | 478 |
| `button-remove-legdistance-{fromId}-{toId}` | remove | 490 |
| (none) | "No rows match the current filter." colSpan=5 | 501-502 |
| `add-legdistance-row-form`, `input-new-legdistance-{from,to,value}`, `button-add-legdistance-{confirm,cancel}`, `button-add-legdistance-row`, `text-add-legdistance-error` | add flow | 368, 374/381/396, 398/401, 411, 513 |

- **e2e references:** `bundle2-fastfollow.spec.ts:304` legdistances-tab · `:305` row-legdistance- prefix. `bundle6.1-legend-distances.spec.ts:311` legdistances-tab · `:313` badge-leg-{mine}-{refinery} · `:315` "Mine → Refinery". Grep run, none for every other id (filter boxes are only hit by Distances/Delivery/JADE specs above).
- **Unit tests referencing it:** `__tests__/LegDistancesTab.test.tsx` (728 lines); root in `Workspace.TwoEchelon.test.tsx`, `Workspace.TabCoverage.test.tsx`.

---

#### JadeDistances
- **File:** `components/workspace/tabs/JadeDistancesTab.tsx:760`, parent mount `pages/Workspace.tsx:3831`
- **Models / gate:** `two-echelon-jade-us` only — `Workspace.tsx:3828`.
- **Row source & pipeline:** same merge as Distances but keyed by the **triple** `tripleKey(leg, fromId, toId)` (`savedByKey` `:366`, `mergedRowsAll` `:415`). Base = reference pairs (leg defaults to `"warehouse_to_customer"` when absent). Status pass (`passesStatus`, `:404`): P→W rows hidden when `toId` warehouse inactive; W→C rows hidden when `fromId` warehouse inactive or `toId` customer excluded — **retained** if a current/saved override exists. Added = overrides with no base triple, appended. Filter → `useTableFilters` (`:452-453`) → clamp (`:475-477`) → slice 50 (`:479`).
  **Focus jump** (`:494-503`): clears FilterMenu (`rawTableFilters.clearAll()` only if any filter active), `idx` against **unfiltered** `mergedRowsAll` (`fromId === id || toId === id`), `page = floor(idx/50)+1`. Scroll effect (`:506-515`) matches suffix includes `-${id}-`, ends with `-${id}`, or starts with `${id}-`.
- **Columns:** `Leg — enum — r.leg` ("Plant → Warehouse"/"Warehouse → Customer", `:145-147`) · `From — text` · `To — text` · `Base ({unit}) — number — r.base` · `Override ({unit}) — number — r.override?.distance (editable)` · `$/ton — number — laneCostPerTon(effective, rate, min).toFixed(2)` (derived from `transportCosts`) · `Min? — enum/boolean — minChargeBinds(...)` badge "min" · `(blank) — actions`
- **Filter today:** **already FilterMenu** (`:667`), shown when `mergedRowsAll.length > 10` (`:666`). Descriptors (`:449-450`): `{key:"from", type:"text", accessor: searchText(fromId)}`, `{key:"to", type:"text", accessor: searchText(toId)}`; `searchText = "${city, ST} ${displayCode}"` (`:396`). Because FilterMenu derives `input-filter-${key}`, the controls emit **`input-filter-from` / `input-filter-to`** — the same literals as the other tabs' boxes. Wrapped `setFilter`/`clearAll` reset `page=1` (`:460-469`).
- **Paging today:** `PAGE_SIZE = 50` (`:335`), local `Pager` copy (`:239-280`) `idPrefix="jadedistances"` (mounted `:904`), **always rendered**.
- **Upload / Download entity:** `download("legDistances", …)` (`:636,647`; testids reuse `legdistances`); `ImportDialog entity="legDistances"` (`:677`).
- **Add flow:** inline `button-add-jadedistance-row` (`:735`) → `add-jadedistance-row-form` (`:683`) with leg `<select>` `select-new-jadedistance-leg` (`:688`, options "Plant → Warehouse"/"Warehouse → Customer"). Messages (`:600-608`): "From ID and To ID are both required." · "Distance must be a positive number." · "A distance override for this (leg, from, to) triple already exists — edit it in the table instead." Error `text-add-jadedistance-error` (`:932`).
- **Editable cells + disable rules:** `JadeDistanceOverrideCell` (`useDistanceDraft`, `:200-235`), `disabled={draft.disabled}` only; remove when `r.override || r.base == null` (`:880`). No history prop.
- **Highlighting:** `className={changed ? "bg-amber-50" : r.override?.estimated ? "bg-sky-50" : undefined}` (`:783`); `isChangedRow` (`:520`). Badges Estimated/Changed/min.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `jade-distances-tab` | root | 923 |
| `jadedistances-tab-toolbar` | toolbar | 632 |
| `button-export-legdistances-csv` / `-json` | downloads | 639 / 650 |
| `button-import-legdistances` | Upload | 660 |
| `button-filter-menu-trigger`, `filter-menu-popover`, `filter-control-from`/`-to`, `input-filter-from`/`-to`, `button-clear-filter-{from,to}`, `text-filter-count`, `button-clear-all-filters`, `text-filter-active-count` | FilterMenu internals (`FilterMenu.tsx:56,63,76,92,102,183,192,65`) | 667 |
| `jadedistances-reference-section` | compat wrapper | 928 |
| `jadedistances-reference-error` / `-loading` | banners | 742 / 747 |
| `jade-distances-tab-empty` | empty state | 754 |
| `row-jadedistance-{leg}-{fromId}-{toId}` | row | 782 |
| `badge-leg-{leg}-{fromId}-{toId}` | leg badge | 786 |
| `warning-unknown-from-{leg}-{fromId}-{toId}` / `warning-unknown-to-…` | unknown-id icons | 800 / 817 |
| `spinner-jadedistance-unit-…` / `spinner-jadedistance-base-…` | base-cell spinners | 563 / 572 |
| `input-jadedistance-{leg}-{fromId}-{toId}` | override input (via :223) | 832 |
| `text-jadedistance-error-{leg}-{fromId}-{toId}` | inline error (via :226) | 833 |
| `badge-jadedistance-estimated-…` / `badge-jadedistance-changed-…` | badges | 838 / 846 |
| `cell-jadedistance-cost-{leg}-{fromId}-{toId}` | **`<TableCell>` testid** ($/ton) | 860 |
| `badge-jadedistance-min-{leg}-{fromId}-{toId}` | "min" badge | 869 |
| `button-remove-jadedistance-…` | remove | 884 |
| (none) | "No rows match the current filter." colSpan=8 | 896-897 |
| `button-jadedistances-prev` / `jadedistances-page-indicator` / `button-jadedistances-next` | pager | 259 / 263 / 272 |
| `add-jadedistance-row-form`, `select-new-jadedistance-leg`, `input-new-jadedistance-{from,to,value}`, `button-add-jadedistance-{confirm,cancel}`, `button-add-jadedistance-row`, `text-add-jadedistance-error` | add flow | 683, 688, 698/705/720, 722/725, 735, 932 |

- **e2e references:** `jade-two-echelon.spec.ts:282` jade-distances-tab · `:288` button-filter-menu-trigger · `:289,290,294` input-filter-to · `:291` badge-jadedistance-estimated- prefix. `jade-transport-costs.spec.ts:100,134` jade-distances-tab · `:101,112` cell-jadedistance-cost-… · `:103,114` badge-jadedistance-min-… · `:109` button-filter-menu-trigger · `:110,111,116` input-filter-to. Grep run, none: row-jadedistance-, jadedistances page/pager ids, add-flow ids, reference ids.
- **Unit tests referencing it:** `__tests__/JadeDistancesTab.test.tsx` (1488 lines; `jadedistances-page-indicator` :290,416,420,1016,1021); root in `Workspace.TabCoverage.test.tsx`.

---

#### LaneCosts
- **File:** `components/workspace/tabs/LaneCostsTab.tsx:388`, parent mount `pages/Workspace.tsx:3884`
- **Models / gate:** `transport-coal` only — `Workspace.tsx:3881`.
- **Row source & pipeline:** overrides only (no base): `laneCostOverrides` filtered by From/To substring on raw id (`visibleRows`, `:186`). Saved = `savedLaneCostOverrides` (`savedByKey`, `:184`). No inactive handling, no paging, no sort. Focus: DOM scroll only (`:168-180` region, prefix `row-lanecost-`).
- **Columns:** `From (mine) — text — fromId (EntityIdCell)` · `To (station) — text — toId` · `Cost ({unit}) — number — o.cost (editable, unit-converted via useDistanceDraft)` · `(blank) — actions`
- **Filter today:** From/To boxes `input-filter-from` (`:306`) / `input-filter-to` (`:313`), always shown.
- **Paging today:** none.
- **Upload / Download entity:** `download("laneCosts", …)` (`:271,282`); `ImportDialog entity="laneCosts"` (`:323`).
- **Add flow:** inline `button-add-lanecost-row` (`:372`) → `add-lanecost-row-form` (`:329`). Messages (`:236-244`): "From ID and To ID are both required." · "Cost must be a positive number." · "A lane cost override for this pair already exists — edit it in the table instead." Error `text-add-lanecost-error` (`:482`).
- **Editable cells + disable rules:** `LaneCostValueCell` (`useDistanceDraft`), `disabled={draft.disabled}` only. No history prop.
- **Highlighting:** `className={changed ? "bg-amber-50" : undefined}` (`:407`); "Changed" badge (`:446-447`).
- **Testid map:**

| testid | element | line |
|---|---|---|
| `lanecosts-tab` | root | 379 |
| `lanecosts-tab-toolbar` | toolbar | 267 |
| `button-export-lanecosts-csv` / `-json` | downloads | 274 / 285 |
| `button-import-lanecosts` | Upload | 295 |
| `input-filter-from` / `input-filter-to` | filter boxes | 306 / 313 |
| `lanecosts-tab-empty` | empty | 383 |
| `row-lanecost-{fromId}-{toId}` | row | 406 |
| `warning-unknown-from-{fromId}-{toId}` / `warning-unknown-to-…` | unknown-id icons | 415 / 428 |
| `input-lanecost-{fromId}-{toId}` | value input (via :112) | 442 |
| `badge-lanecost-changed-{fromId}-{toId}` | "Changed" | 447 |
| `button-remove-lanecost-{fromId}-{toId}` | remove | 459 |
| (none) | "No rows match the current filter." colSpan=4 | 470 |
| `add-lanecost-row-form`, `input-new-lanecost-{from,to,value}`, `button-add-lanecost-{confirm,cancel}`, `button-add-lanecost-row`, `text-add-lanecost-error` | add flow | 329, 335/342/357, 359/362, 372, 482 |

- **e2e references:** `bundle2-fastfollow.spec.ts:236` sidebar-input-laneCosts · `:237` lanecosts-tab · `:238` row-lanecost- prefix. Grep run, none otherwise.
- **Unit tests referencing it:** `__tests__/LaneCostsTab.test.tsx` (727 lines); root in `Workspace.test.tsx`, `Workspace.TabCoverage.test.tsx`.

---

#### DeliveryCosts
- **File:** `components/workspace/tabs/DeliveryCostsTab.tsx:365`, parent mount `pages/Workspace.tsx:3913`
- **Models / gate:** `delivery-teaching-us` only — `Workspace.tsx:3910`.
- **Row source & pipeline:** base = `useGetReferenceCosts(modelId)` pairs (`:133`); overrides = `laneCostOverrides`; added = overrides not in `baseByKey` (`addedOverrides`, `:152`). **No saved-overrides prop** (Workspace passes only `laneCostOverrides`, `onChange`, `modelId`, `:3913-3917`), **no inactive filtering** (fixed geography), no focus jump. Filter base and added separately on raw id (`matchesFilter` `:157`, `filteredBasePairs` `:166`), page across the concatenation **base first, then added** (`pagedRows` `:186`, two-segment slice), clamp effect + `clampedPage = min(page, pageCount)` (`:184`).
- **Columns:** `From — text — fromId (raw mono, no EntityIdCell)` · `To — text — toId` · `Base — number — r.base` (no unit; billable miles) · `Cost — number — r.override?.cost (editable)` · `(blank) — actions`
- **Filter today:** From/To boxes `input-filter-from` (`:285`) / `input-filter-to` (`:295`), always shown, reset `page=1`.
- **Paging today:** module-level `PAGE_SIZE = 50` (`:59`); inline pager JSX (`:427-451`) **always rendered** when the table renders.
- **Upload / Download entity:** **none today** (no toolbar export/import; P2 adds `deliveryCosts`).
- **Add flow:** inline `button-add-deliverycost-row` (`:338`) → `add-deliverycost-row-form` (`:301`), cost is a plain `useState` string (not `useDistanceDraft`). Messages (`:230-254`): "From ID and To ID are both required." · `Unknown warehouse id "{fromId}" — not found in the base cost matrix.` · `Unknown customer id "{toId}" — not found in the base cost matrix.` · "Cost must be a non-negative number." · "A cost override for this pair already exists — edit it in the table instead." Error `text-add-deliverycost-error` (`:461`).
- **Editable cells + disable rules:** local `CostCell` (plain draft state, commit on blur/Enter if finite ≥ 0, `:65`); never disabled. No history prop.
- **Highlighting:** `className={r.override ? "bg-amber-50" : undefined}` (`:379`) — **override-present**, not changed-vs-saved. "Overridden" badge.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `delivery-costs-tab` | root | 456 |
| `delivery-costs-tab-toolbar` | toolbar | 275 |
| `input-filter-from` / `input-filter-to` | filter boxes | 285 / 295 |
| `delivery-costs-tab-loading` / `-error` / `-empty` | states | 351 / 355 / 359 |
| `row-deliverycost-{fromId}-{toId}` | row | 379 |
| `input-deliverycost-{fromId}-{toId}` | cost input (via :115) | 389 |
| `badge-deliverycost-overridden-{fromId}-{toId}` | "Overridden" | 394 |
| `button-remove-deliverycost-{fromId}-{toId}` | remove | 407 |
| (none) | "No rows match the current filter." colSpan=5 | 419-420 |
| `button-delivery-costs-prev` / `delivery-costs-page-indicator` / `button-delivery-costs-next` | pager | 434 / 438 / 447 |
| `add-deliverycost-row-form`, `input-new-deliverycost-{from,to,value}`, `button-add-deliverycost-{confirm,cancel}`, `button-add-deliverycost-row`, `text-add-deliverycost-error` | add flow | 301, 307/314/323, 325/328, 338, 461 |

- **e2e references:** `delivery-teaching.spec.ts:188,240` sidebar-input-deliveryCosts · `:241` delivery-costs-tab · `:242` input-filter-from · `:243` input-filter-to · `:244` input-deliverycost-… · `:248` badge-deliverycost-overridden-…. Grep run, none: pager ids, row ids, add ids.
- **Unit tests referencing it:** `__tests__/DeliveryCostsTab.test.tsx` (310 lines; pager indicator, filter boxes, add flow); root in `Workspace.test.tsx`, `Workspace.TabCoverage.test.tsx`.

---

#### TransportCosts
- **File:** `components/workspace/tabs/TransportCostsTab.tsx:214`, parent mount `pages/Workspace.tsx:3865`
- **Models / gate:** `two-echelon-jade-us` only — `Workspace.tsx:3862` (`entity === "transportCosts"`).
- **Row source & pipeline:** two **fixed** rows (`legs` array `ic`/`ob`, `:195`) over the scalar object `transportCosts` (effective values via `transportCostsFromInputs`); `isCustom` drives Reset. No filter, no paging, no add.
- **Columns:** `Leg — text — label + lane (two-line)` · `Rate ({rateLabel}) — number — transportCosts[rateField] (editable, reciprocal rate conversion)` · `Min ($/ton) — number — transportCosts[minField] (editable, identity conversion)`
- **Filter today:** none (2 rows). **Paging:** none. **Upload/Download:** none (out of scope per spec). **Add:** none.
- **Editable cells + disable rules:** `TransportCostField` ×4, `disabled={disabled || draft.disabled}` (`:122`), `disabled = isBrowsingHistoryNow` (`Workspace.tsx:3871`) — **the only tab of the seven with a history prop**. Display-space no-op guard `commitField` (`:182`). Reset button `disabled={disabled || !isCustom}`.
- **Highlighting:** none.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `transport-costs-tab` | root | 213 |
| `label-transport-rate-unit-head` | **`<TableHead>` testid** (Rate header) | 218 |
| `row-transport-{ic\|ob}` | row | 226 |
| `input-transport-{ic\|ob}-rate` / `error-transport-{ic\|ob}-rate` | rate input / error (via :133,136) | 240-241 |
| `label-transport-rate-unit-{ic\|ob}` | rate unit suffix span | 246 |
| `input-transport-{ic\|ob}-min` / `error-transport-{ic\|ob}-min` | min input / error | 260-261 |
| `label-transport-min-unit-{ic\|ob}` | "$/ton" suffix | 266 |
| `text-transport-formula` | formula text (outside table) | 276 |
| `button-transport-reset` | "Reset to textbook values" | 286 |

- **e2e references:** `jade-transport-costs.spec.ts:91,121,136` sidebar-input-transportCosts · `:92,137` transport-costs-tab · `:93,122` input-transport-ic-rate · `:123` input-transport-ob-rate. Grep run, none: row-transport-, label-transport-*, error-transport-*, text-transport-formula, button-transport-reset, "Reset to textbook".
- **Unit tests referencing it:** `__tests__/TransportCostsTab.test.tsx` (257 lines); `Workspace.Jade.test.tsx` (input-transport-); root in `Workspace.TabCoverage.test.tsx`.

---

#### CapabilityMatrix (Plant Capability Matrix)
- **File:** `components/workspace/tabs/CapabilityMatrixTab.tsx:171`, parent mount `pages/Workspace.tsx:3570`
- **Models / gate:** any model with `activeModelManifest?.capabilities?.supportsPlantProductCapability` — today `two-echelon-jade-us` only — `Workspace.tsx:3567`.
- **Row source & pipeline:** rows = effective plants `mergeEffectivePlants(dataset, localInputs)` (base ∪ added, `Workspace.tsx:3572`), **pivot**: one row per plant, one column per product (`products.map`, `:176-178`). Cell = `isCellEnabled(baseCapabilities, overrides, plantId, productId)`; toggle writes a sparse override or removes it when equal to base (`toggle`, `:138`). FilterMenu → `filteredRows`; no paging; no sort.
- **Columns:** `Plant — text — EntityIdCell(plant)` · then **one dynamic column per product**: `{product.name} — enum(boolean) — effectiveEnabled(...)` rendered as checkbox + "{capacity} Units" caption.
- **Filter today:** FilterMenu when `totalCount > 10` (`:167`); descriptors (`buildFilterDescriptors`, `:65`): `{key:"plant", type:"text", accessor: name+id+city+state joined}`, `{key:"state", type:"select", accessor: state}` — **"state" is a filter-only descriptor with no rendered column**. JADE has 4 plants, so the menu is absent in practice (asserted by `jade-ch9-workspace-bundle.spec.ts:531`). Count line `text-capability-count` "{filteredCount} of {totalCount}" rendered **always**, outside FilterMenu (`:164-166`).
- **Paging today:** none. **Upload/Download:** none (out of scope per spec). **Add:** none (plants added in Plants tab).
- **Editable cells + disable rules:** Radix `Checkbox` per cell, never disabled (no history prop; write dropped by `updateInputsField`).
- **Highlighting:** none (no override marking).
- **Testid map:**

| testid | element | line |
|---|---|---|
| `capability-matrix-tab` | root | 157 |
| `capability-matrix-empty` | empty (no plants or no products) | 150 |
| `text-capability-capacity-label` | info line above table (nowrap asserted in e2e) | 159 |
| `text-capability-count` | "{n} of {m}" | 164 |
| FilterMenu ids (`button-filter-menu-trigger`, `filter-control-plant`/`-state`, `input-filter-plant`, `select-filter-state`, `option-filter-state-{v}`, `checkbox-filter-state-{v}`, …) | only when > 10 plants | 167 |
| `row-capability-{plantId}` | row | 182 |
| `text-capability-plant-{plantId}` | **`<TableCell>` testid** (plant cell) | 183 |
| `checkbox-capability-{plantId}-{productId}` | cell checkbox | 199 |
| `text-capability-capacity-{plantId}-{productId}` | "{n} Units" caption | 204 |
| (none) | "No plants match the current filter." colSpan=products+1 | 216-217 |

- **e2e references:** `jade-ch9-workspace-bundle.spec.ts:439,529` sidebar-input-capability-matrix · `:440,530` capability-matrix-tab · `:441,443,451,455` text-capability-capacity-plant-1-product-{1,2} + "210,000,000 Units"/"0 Units" · `:442,444,449,450,453,454` checkbox-capability-plant-1-product-2/1 · `:531` button-filter-menu-trigger count 0. `jade-two-echelon.spec.ts:229,255` sidebar · `:230,256` capability-matrix-tab · `:231,257` checkbox-capability-plant-4-product-1. `workspace-fixups.spec.ts:283` sidebar · `:284` capability-matrix-tab · `:292` text-capability-plant-plant-1 (asserts exactly 2 `<span>` children, :293-296) · `:300` text-capability-capacity-label (whiteSpace nowrap, height < 24) · `:309,310` capacity captions. Grep run, none: row-capability-, text-capability-count, capability-matrix-empty.
- **Unit tests referencing it:** `__tests__/CapabilityMatrixTab.test.tsx` (403 lines); `Workspace.Jade.test.tsx` (row-/checkbox-capability-); root in `Workspace.TabCoverage.test.tsx`.

---

#### Cross-table note: `input-filter-from` / `input-filter-to` collide
The same two literals are emitted by Distances, LegDistances, LaneCosts, DeliveryCosts (plain `<Input>` boxes) **and** by JadeDistances (FilterMenu `text` descriptors keyed `from`/`to`). Removing the boxes (spec B2.2) and routing every table through auto-derived descriptors keeps these literals **only if** the From/To column ids are `from`/`to` **and** they derive to `text` (FilterMenu → `input-filter-${key}`). Under the spec's rule 4 (text → select if ≤ 20 distinct), From on Distances (25 warehouses for p-median-us) stays text but To/From on small tables would become `select-filter-*` — the e2e lines above that `.fill()` the box must then be rewritten to the menu.

#### API-gap findings (distance/cost inputs)
1. **Pager has three testids, the API names two.** Every pager emits `button-{p}-prev`, `{p}-page-indicator`, `button-{p}-next` (`DistancesTab.tsx:225,229,238`; `JadeDistancesTab.tsx:259,263,272`; `DeliveryCostsTab.tsx:434,438,447`), and e2e clicks prev/next (`bundle5-homepage-distances.spec.ts:180-183`, `bundle6.1-legend-distances.spec.ts:244-246`). `testIds.{pager,pageIndicator}` cannot express prev/next → needs `pagerPrev`/`pagerNext` (or a single `pagerPrefix` that derives all three).
2. **Focus-jump needs external page control.** Distances (`:459-467`) and JadeDistances (`:494-503`) set `page` from outside the row pipeline and clear filters. The spec says jump computes against the **filtered** list (B2.2) — today both compute against the **unfiltered** list after clearing filters. DataTable needs a `focusRowKey`/`jumpTo(predicate)` input (or an exposed imperative handle) that clears filters and sets the page; nothing in the listed props supports it.
3. **Cell-level testids on `<td>`.** `cell-jadedistance-cost-…` (`JadeDistancesTab.tsx:860`) and `text-capability-plant-{id}` (`CapabilityMatrixTab.tsx:183`) are on the `<TableCell>` itself; covered by `cellTestId?(row)` — OK, but `text-capability-plant` is asserted to contain exactly 2 `<span>` children (`workspace-fixups.spec.ts:292-296`), so the shell must not wrap `cell()` output in an extra element.
4. **Header testids.** `label-transport-rate-unit-head` on a `<TableHead>` (`TransportCostsTab.tsx:218`). `ColumnDef` has no `headerTestId`; `header` would need to be `ReactNode` with the testid on an inner element (changes the element the testid lives on) or a new `headerTestId?`.
5. **Filter-only descriptors.** CapabilityMatrix's `state` select (`CapabilityMatrixTab.tsx:65` `buildFilterDescriptors`) has no rendered column; JadeDistances' `from`/`to` filter on `"city, ST displayCode"` while the cell shows EntityIdCell. Expressible only if `value()` may differ from display (it can) **and** a column may be filter-only (needs `hidden?: true` or a separate `extraFilters`).
6. **Dynamic pivot columns.** CapabilityMatrix columns are `products.map(...)` (`:176-178`, `:191-207`). Expressible as a runtime-built `columns` array (no API gap), but auto-derivation would create one select filter per product — needs `filter: false` on each product column.
7. **Empty-filter row (colSpan) and its copy.** Every table renders an in-`<tbody>` row "No rows match the current filter." (Capability: "No plants match the current filter."), colSpan 4/5/8/products+1. `emptyState` covers the zero-row case; a distinct "no filter matches" message per table needs its own prop (e.g. `noMatchText?`).
8. **Multiple pre-table states.** Distances/JadeDistances render loading/error banners **above** the table while still rendering rows (`DistancesTab.tsx:711,716`); Delivery replaces the table with loading/error/empty `<p>`s (`:351,355,359`). `emptyState` is one slot; banners need `toolbar.extra` or a `banner?` slot.
9. **Pager visibility change.** All three pagers are always rendered today; spec's `> 50` gate means `distances-page-indicator` disappears on small tables. Unit tests asserting `"Page 1 of N"` with N=1 (e.g. `DistancesTab.test.tsx` and e2e `bundle5-homepage-distances.spec.ts:212` "Page 1 of 1" after filtering to one row) break by design.
10. **Wrapper testids around the table.** `distances-reference-section` / `jadedistances-reference-section` wrap banners + table + pager (`DistancesTab.tsx:876`, `JadeDistancesTab.tsx:928`) conditionally. Not a DataTable concern if the adapter keeps the wrapper outside, but `testIds.table` alone cannot place it.
11. **Count text outside FilterMenu.** `text-capability-count` (`CapabilityMatrixTab.tsx:164`) is always visible, independent of the >10 gate → `toolbar.extra`.
12. **Toolbar testid.** Each tab's toolbar div has its own testid (`distances-tab-toolbar`, `legdistances-tab-toolbar`, `jadedistances-tab-toolbar`, `lanecosts-tab-toolbar`, `delivery-costs-tab-toolbar`) asserted in e2e (`chen-bands-units-qa.spec.ts:268,405,745`; `max-coverage.spec.ts:311,372`). `testIds` has no `toolbar` key.
13. **Add-row form renders below the table, outside `<tbody>`.** Not inside tbody for any of these five tabs (`DistancesTab.tsx:878`) — fits `toolbar.add` only if `add` may render a below-table region rather than a toolbar button; the spec keeps inline "+ Add row" for these tables, so DataTable needs a `footer?` slot (or the adapter renders it outside DataTable).
14. **Overflowing scroll container.** All tables sit in `max-h-[55vh]`/`[60vh] overflow-y-auto` wrappers; the shell's `table.tsx` already wraps in `overflow-auto`. Needs a `maxHeightClassName?` or the adapter wraps.
15. **History read-only is a new prop for six of seven** (see top). Not an API gap, but the adapters cannot source `ctx.readOnly` from current props.

### 2c. Entity input tables (P4)

Base commit `46d2f98`. All paths under `artifacts/studio/src/` unless shown. e2e paths are relative to `artifacts/studio/e2e/`. Every testid below was read from `grep -n 'data-testid'` on the tab file and its `components/tables/*` child. Every e2e reference came from `grep -rn '<needle>' artifacts/studio/e2e/`.

**Shared-component note.** `components/tables/{WarehouseTable,CustomerTable,MineTable,StationTable}` are also rendered by the legacy `pages/Studio.tsx:25-28`, which is dead code pending Phase D. `Workspace.tsx:76-79` imports only their override **types**. So a P4 migration should **not** rewrite those four files in place. The Workspace tab should stop rendering them, and they stay for `Studio.tsx`. Their override types should move or be re-exported so `Workspace.tsx` does not depend on a legacy component. `EntityIdCell` renders **no** testid (`EntityIdCell.tsx:28-39`; the single grep hit is a comment) and is not used by any entity input tab. It is used by Lane/Leg/JADE distances, outputs and CapabilityMatrix.

**Common facts for all entity tabs:**
- No `<TableRow>` in these files has a `className`. `grep -n "<TableRow[^>]*className"` returned nothing (exit 1), so **there is no override/changed/added row highlighting today** on any entity table. The only per-row visual signal is the amber precheck chip on added rows.
- No paging (no `PAGE_SIZE` in any of these files).
- Each table has its own scroll box: base `max-h-[60vh] overflow-y-auto` (`WarehouseTable.tsx:101`, `CustomerTable.tsx:135`, `MineTable.tsx:25`, `StationTable.tsx:25`, `CustomersTab.tsx:677`, `PlantsTab.tsx:392`). Added `max-h-[40vh] overflow-y-auto` (`WarehousesTab.tsx:390`, `CustomersTab.tsx:485`, `PlantsTab.tsx:274`, `MinesTab.tsx:261`, `StationsTab.tsx:239`).
- History flag: `isBrowsingHistoryNow = canGoForwardResult` (`pages/Workspace.tsx:1868`). It is passed as `disabled` **only** to Warehouses (`:3505`), Refineries (`:3542`) and Customers (`:3648`). Plants (`:3551-3558`), Mines (`:3698-3709`) and Stations (`:3718-3729`) receive no disabled prop at all. Their base and added controls stay live in history; only the write layer no-ops. D2 covers all of these.
- Sidebar visibility gate: `pages/Workspace.tsx:2289-2308`.

---

#### Warehouses — base
- **File:** `components/tables/WarehouseTable.tsx:102`, rendered by `components/workspace/tabs/WarehousesTab.tsx:571`. Parent mount: `pages/Workspace.tsx:3473`.
- **Models / gate:** `p-median-us`, `p-median-brazil`, `two-echelon-jade-us`, `max-coverage-us`, `delivery-teaching-us` (`Workspace.tsx:3470`).
- **Row source & pipeline:** `dataset.warehouses` filtered `w.kind !== "mine"` (`WarehousesTab.tsx:145`), then mapped to add the effective `status` (`overrides.find(...)?.status ?? "active"`, `:294-297`), then FilterMenu-filtered when `enableFilters` (`:298-299`). Overrides come from `warehouseOverridesFromInputs(localInputs)`, shape `{id, capacity?, status}` (`WarehouseTable.tsx:6`). An override that is a no-op is dropped (`status==="active" && capacity==null`, `:79-80`). Inactive rows stay in the list (status is only a toggle). Order is dataset order; there is no sort.
- **Columns:** ID — text — `wh.id` (`:105/121`); City — text — `wh.city`; State — text (conditional on `hasStateColumn`, `:107`) — `wh.state`; Latitude — number — `lat.toFixed(4)`; Longitude — number — `lng.toFixed(4)`; Zip — text (conditional: `warehouses.some(w=>w.zip)`, `:110`); Capacity — number (conditional: `capacityMode==="per_wh"`, `:111`) — `o?.capacity`; Status — enum — `warehouseStatusPresentation[status].label` ("Potential"/"Fixed-Open"/"Inactive").
- **Filter today:** opt-in `enableFilters`, which is true only for JADE (`Workspace.tsx:3501`), and only when `candidates.length > 10` (`WarehousesTab.tsx:300`). Descriptors (`:281-293`): `id` text, `city` text, `state` select (conditional), `status` select (accessor = presentation **label**). FilterMenu sits in the toolbar's right slot (`:336-340`).
- **Paging today:** none.
- **Upload / Download entity:** `"warehouses"` (`entity` prop default, `:134`). Download `download(entity,"csv"|"json")` (`:307,318`). Upload `ImportDialog entity={entity}` (`:355`), with `enableFilters` passed through (`:357`).
- **Add flow:** none on base rows (the add flow lives in the Added section).
- **Editable cells + disable rules:** capacity `<Input type="number" min=0>` (`WarehouseTable.tsx:129-146`). Local draft; it commits on every keystroke via `parseInt`. Disabled when `disabled` (history) (`:141`). Status: 3-button segmented toggle (`:151-166`), `disabled={disabled}` (`:156`). Disabled title: "Read-only while browsing result history."
- **Highlighting:** none (no row className). The active status button uses `bg-primary` / `bg-destructive` / `bg-slate-200` (`:158-162`).
- **Testid map:**

| testid | element | line |
|---|---|---|
| `warehouses-tab` (`${entity}-tab`) | tab root div | `WarehousesTab.tsx:569` |
| `warehouses-tab-toolbar` (`${entity}-tab-toolbar`) | toolbar row | `WarehousesTab.tsx:303` |
| `button-export-warehouses-csv` | download CSV | `WarehousesTab.tsx:310` |
| `button-export-warehouses-json` | download JSON | `WarehousesTab.tsx:321` |
| `button-import-warehouses` | Upload | `WarehousesTab.tsx:331` |
| `button-filter-menu-trigger` (+ FilterMenu internals `filter-menu-popover`, `filter-control-{key}`, `input-filter-{key}`, `select-filter-{key}`, `option-filter-{key}-{v}`, `checkbox-filter-{key}-{v}`, `button-clear-filter-{key}`, `text-filter-count`, `button-clear-all-filters`, `text-filter-active-count`) | filter | `FilterMenu.tsx:57-183` |
| `warehouses-tab-empty` (`${entity}-tab-empty`) | empty-dataset text | `WarehousesTab.tsx:558` |
| `input-wh-capacity-{id}` | capacity input | `WarehouseTable.tsx:145` |
| `button-wh-{id}-{active\|forced_open\|inactive}` | status buttons | `WarehouseTable.tsx:154` |
| *(none)* | table / `<tr>` / `<td>` — base rows carry **no** row testid | `WarehouseTable.tsx:120` |

- **e2e references:**
  - `warehouses-tab`: `workspace-fixups.spec.ts:266,504,542`; `workspace-fixups-2.spec.ts:250,255,277,509`; `delivery-teaching.spec.ts:282`; `jade-ch9-workspace-bundle.spec.ts:459,460,462,505`; `tab-coverage.spec.ts:142,154`
  - `warehouses-tab-toolbar`: `workspace-fixups.spec.ts:516`; `workspace-fixups-2.spec.ts:510` (bounding-box height < 40, `:518-519`); `bundle6-ui-tweaks.spec.ts:188`; `jade-ch9-workspace-bundle.spec.ts:513` (filter trigger scoped inside the toolbar)
  - `button-export-warehouses-csv`: `workspace-fixups.spec.ts:517`. `button-import-warehouses`: `workspace-fixups.spec.ts:518`
  - `button-wh-`: `delivery-teaching.spec.ts:284` (`button-wh-W1-inactive`); `jade-ch9-workspace-bundle.spec.ts:522,525` (`[data-testid^="button-wh-"][data-testid$="-active"]` used as a **row count**)
  - Filter internals used against this table: `jade-ch9-workspace-bundle.spec.ts:513-526`. These cover `text-filter-count` "25 of 25" / "2 of 25", `checkbox-filter-status-Fixed-Open` (so the descriptor key `status` and the option value = the presentation **label** are load-bearing), and `button-clear-all-filters`.
  - `thead th` header text: `jade-ch9-workspace-bundle.spec.ts:462-463` (`not.toContain("Capacity")`)
  - **Must change:** `workspace-fixups-2.spec.ts:255` asserts `[data-testid="warehouses-tab"] [data-testid="button-filter-menu-trigger"]` count **0** on a non-JADE 26-row tab. The spec's "Filter: every table > 10 rows, all models" inverts this.
  - `input-wh-capacity-`: none (grep run). "Fixed-Open"/"Potential": comments only, plus `jade-ch9-workspace-bundle.spec.ts:520`.
- **Unit tests:** `__tests__/WarehousesTab.test.tsx`, `__tests__/WarehouseTable.test.tsx`, `__tests__/Workspace.test.tsx`, `Workspace.Integration`, `Workspace.DisplayedInputs`, `Workspace.TwoEchelon`, `Workspace.Brazil`, `Workspace.TabCoverage`, `DistancesTab.test.tsx`, `CustomersTab.test.tsx`, `MinesTab.test.tsx` (name-grep hits).

#### Warehouses — added
- **File:** `components/workspace/tabs/WarehousesTab.tsx:391`, inside the section `:380-552`. Parent mount: `Workspace.tsx:3473`.
- **Models / gate:** rendered iff `onAddedWarehousesChange != null` (`:380`). The caller wires it for every warehouse model **except** `delivery-teaching-us` (`Workspace.tsx:3488-3494`): p-median-us, p-median-brazil, JADE and max-coverage-us.
- **Row source & pipeline:** `addedWarehousesFromInputs(localInputs)` (`Workspace.tsx:674`), shape `AddedWarehouse {id, city, state, lat, lng, capacity?, status, displayCode?}` (`WarehousesTab.tsx:24-34`). Insertion order. Not filtered: the base FilterMenu does not apply to this section. Inactive rows stay.
- **Columns:** ID — text — `displayCode ?? id`, plus the precheck chip (`:410-427`); City — text; State — text (conditional, `:396`); Latitude — number; Longitude — number; Capacity — number (conditional `per_wh`, `:399`) — `w.capacity`; Status — enum — `ADDED_STATUS_LABEL` (a duplicated literal map, `:41-45`); (blank header) — delete action.
- **Filter today:** none.
- **Paging today:** none.
- **Upload / Download entity:** the same toolbar as base (`warehouses`). There is no separate one.
- **Add flow:** inline form, not a table row. It sits below the table (`:486-551`). Trigger is `button-add-warehouse-row` ("+ Add warehouse", `:543-545`). Fields: `input-new-warehouse-city`, `-state` (conditional), `-lat`, `-lng`, `-display-code`, `-capacity` (conditional `per_wh`). A gazetteer auto-fill runs on City/State blur (`:197-209`). Confirm is `button-add-warehouse-confirm`, cancel is `button-add-warehouse-cancel`, and the error text is `text-add-warehouse-error`. Validation strings (`:236-262`): "City and state are both required." / "City is required."; "Display code '{c}' is already in use by another warehouse in this scenario."; "Latitude and longitude must both be numbers."; "Capacity must be a positive number, or left blank." The id is `newUid("wh")`.
- **Editable cells + disable rules:** capacity `<Input type="number" min=0>` (`:435-446`) commits on every keystroke via `parseFloat`. Status: 3 buttons (`:451-464`). Delete button (`:468-476`). **None are disabled in history** (no `disabled` reference in `:380-552`). D2 bug: spec cites `~433-465`; the measured range is `:435-476`.
- **Highlighting:** none. The amber precheck chip is `warning-precheck-added-warehouse-{id}` (`:418-425`).
- **Testid map:**

| testid | element | line |
|---|---|---|
| `added-warehouses-section` | section wrapper (also used for refineries) | `:381` |
| `added-warehouses-empty` | empty text | `:386` |
| `row-added-warehouse-{id}` | `<tr>` | `:409` |
| `warning-precheck-added-warehouse-{id}` | precheck chip | `:420` |
| `input-added-wh-capacity-{id}` | capacity input | `:445` |
| `button-added-wh-{id}-{status}` | status buttons | `:454` |
| `button-delete-added-warehouse-{id}` | delete | `:472` |
| `add-warehouse-row-form` | add form | `:487` |
| `input-new-warehouse-city` / `-state` / `-lat` / `-lng` / `-display-code` / `-capacity` | add inputs | `:494,503,513,522,530,533` |
| `button-add-warehouse-confirm` / `button-add-warehouse-cancel` | add buttons | `:535,538` |
| `button-add-warehouse-row` | add trigger | `:543` |
| `text-add-warehouse-error` | add error | `:548` |

- **e2e references:**
  - `added-warehouses-section`: `workspace-fixups.spec.ts:506,543`; `workspace-fixups-2.spec.ts:251,264,278`; `tab-coverage.spec.ts:155,259`
  - `row-added-warehouse-`: `workspace-fixups.spec.ts:508,544`; `workspace-fixups-2.spec.ts:264,278`; `tab-coverage.spec.ts:157,261`
  - `add-warehouse-row-form`: `jade-ch9-workspace-bundle.spec.ts:466`
  - `input-new-warehouse-*`: `workspace-fixups-2.spec.ts:258-261`; `jade-ch9-workspace-bundle.spec.ts:467` (`-capacity` count 0)
  - `button-add-warehouse-confirm`: `workspace-fixups-2.spec.ts:262`. `button-add-warehouse-cancel`: `jade-ch9-workspace-bundle.spec.ts:468`
  - `button-add-warehouse-row`: `workspace-fixups.spec.ts:267,519`; `workspace-fixups-2.spec.ts:257,358`; `jade-ch9-workspace-bundle.spec.ts:465`
  - None for `added-warehouses-empty`, `warning-precheck-added-warehouse-`, `input-added-wh-capacity-`, `button-added-wh-`, `button-delete-added-warehouse-`, `text-add-warehouse-error`, "Added warehouses" (comments only: `workspace-fixups.spec.ts:475,499`, `tab-coverage.spec.ts:150`) (grep run)
  - B2.8 note: every `input-new-warehouse-*` / `add-warehouse-row-form` / `button-add-warehouse-confirm|cancel` reference above moves to `create-entity-*`.
- **Unit tests:** `__tests__/WarehousesTab.test.tsx`, `__tests__/Workspace.test.tsx`.

#### Refineries — base (two-echelon-gold-au)
- **File:** the same component, `components/tables/WarehouseTable.tsx:102` via `WarehousesTab.tsx:571` with `entity="refineries"`. Parent mount: `Workspace.tsx:3524`.
- **Models / gate:** `two-echelon-gold-au` only (`Workspace.tsx:3521`). Verified: refineries are a reuse of WarehousesTab.
- **Row source & pipeline:** `dataset.warehouses` minus `kind==="mine"`. Overrides come from `refineryOverridesFromInputs`, and the change handler is `updateInputsField("refineryOverrides", …)` (`:3528`). `capacityMode="none"` is hard-wired (`:3527`), so there is never a Capacity column.
- **Columns:** ID, City, State (conditional), Latitude, Longitude, Zip (conditional), Status (enum).
- **Filter today:** none. `enableFilters` is not passed, so it defaults false.
- **Paging:** none.
- **Upload / Download entity:** `"refineries"` (download `:307,318`; ImportDialog `:355`).
- **Add flow:** none on base.
- **Editable cells + disable rules:** status buttons only, `disabled={isBrowsingHistoryNow}` (`Workspace.tsx:3542`).
- **Highlighting:** none.
- **Testid map:** same as Warehouses base with entity substitution: `refineries-tab` (`:569`), `refineries-tab-toolbar` (`:303`), `button-export-refineries-csv|json` (`:310,321`), `button-import-refineries` (`:331`), `refineries-tab-empty` (`:558`), `button-wh-{id}-{status}` (`WarehouseTable.tsx:154`, which is **not** entity-prefixed).
- **e2e references:** `refineries-tab`: `workspace-fixups-2.spec.ts:357`; `tab-coverage.spec.ts:244,258`. None for `button-export-refineries` or `button-import-refineries` (grep run).
- **Unit tests:** `__tests__/Workspace.TwoEchelon.test.tsx`, `__tests__/WarehousesTab.test.tsx`.

#### Refineries — added (two-echelon-gold-au)
- **File:** `WarehousesTab.tsx:391` (the same Added section). Parent mount: `Workspace.tsx:3524`.
- **Models / gate:** `two-echelon-gold-au`. `onAddedWarehousesChange` is wired to `addedRefineries` (`Workspace.tsx:3532-3534`).
- **Row source:** `addedRefineriesFromInputs` (`Workspace.tsx:1019`). Delete goes through `deleteAddedEntityAndOverrides("addedRefineries", id)`.
- **Columns:** same as Warehouses added, minus Capacity (`capacityMode="none"`).
- **Add flow:** same form. The button label reads "+ Add refinery" (`addedEntityLabel`, `:150,544`), the heading reads "Added refineries" (`:383`), and the collision message reads "…another refinery…". **Every testid stays warehouse-worded** (`added-warehouses-section`, `row-added-warehouse-*`, `button-add-warehouse-row`, `input-new-warehouse-*`), which matches spec D4.
- **Editable cells:** status buttons and delete. They are **not disabled in history** (D2).
- **Testid map:** identical to Warehouses added (`WarehousesTab.tsx:381-548`).
- **e2e references:** `workspace-fixups-2.spec.ts:358` (`button-add-warehouse-row` on the Refineries tab); `tab-coverage.spec.ts:252-261` (comment explaining the warehouse-worded ids, plus `added-warehouses-section` / `row-added-warehouse-`). There are no "Added refineries" / "Add refinery" strings (grep run).
- **Unit tests:** `__tests__/Workspace.TwoEchelon.test.tsx`.

#### Customers — base (scalar demand)
- **File:** `components/tables/CustomerTable.tsx:136`, rendered by `components/workspace/tabs/CustomersTab.tsx:745`. Parent mount: `Workspace.tsx:3622`.
- **Models / gate:** `p-median-us`, `two-echelon-gold-au`, `p-median-brazil`, `max-coverage-us`, `delivery-teaching-us`. JADE takes the per-product branch instead. Gate: `Workspace.tsx:3614-3618`; `isJade` at `:3620`; `productMode` at `CustomersTab.tsx:158`.
- **Row source & pipeline:** `dataset.customers`, then `useTableFilters` (always called; filtered rows are used unconditionally, `CustomersTab.tsx:391-392`). Overrides come from `customerOverridesFromInputs`, shape `{id, demand?, status:"active"|"excluded"}` (`CustomerTable.tsx:5`). An override that is a no-op is dropped (`:81-82`). Excluded rows stay. Order is dataset order.
- **Columns:** ID — text; City — text; State — text (conditional); Latitude — number; Longitude — number; Zip — text (conditional, `:144`); Demand — number — `o?.demand ?? c.demand`; Status — enum — "Active"/"Excluded".
- **Filter today:** opt-in `enableFilters={isJade}` (`Workspace.tsx:3644`), so it is **false on every model that reaches this scalar branch**. The menu is never shown here today. Descriptors (`CustomersTab.tsx:363-386`): `id` text, `city` text, `state` **text** (conditional), `demand` number. There is no `status` descriptor.
- **Paging:** none.
- **Upload / Download entity:** `"customers"` (`:400,411,448`).
- **Add flow:** none on base.
- **Editable cells + disable rules:**
  - Demand `<Input type="number" min={0}>` (`CustomerTable.tsx:163-172`). `disabled={disabled || !demandEditable}` (`:168`). `demandEditable = activeModelManifest.capabilities.demandEditable ?? true`, which is false for p-median-brazil (`Workspace.tsx:3654`). Titles: "Read-only while browsing result history." / "Demand for this row is fixed by the textbook dataset and can't be edited." (`:169`).
  - Status buttons (`:177-191`) are `disabled={disabled}` only. The demandEditable gate does not apply to status.
- **Highlighting:** none.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `customers-tab` | tab root | `CustomersTab.tsx:674` |
| `customers-tab-toolbar` | toolbar | `CustomersTab.tsx:396` |
| `button-export-customers-csv` / `-json` | download | `CustomersTab.tsx:403,414` |
| `button-import-customers` | Upload | `CustomersTab.tsx:424` |
| `button-filter-menu-trigger` (+ internals) | filter (JADE only) | `CustomersTab.tsx:431` → `FilterMenu.tsx` |
| `customers-tab-empty` | empty text | `CustomersTab.tsx:664` |
| `input-customer-demand-{id}` | demand input | `CustomerTable.tsx:171` |
| `error-customer-demand-{id}` | inline error "Demand must be ≥ 0" | `CustomerTable.tsx:173` |
| `button-customer-{id}-{active\|excluded}` | status buttons | `CustomerTable.tsx:180` |
| *(none)* | table / `<tr>` — no row testid | `CustomerTable.tsx:155` |

- **e2e references:**
  - `customers-tab`: `workspace-fixups.spec.ts:269`; `jade-two-echelon.spec.ts:315`; `import.spec.ts:94`; `bundle2-fastfollow.spec.ts:152`; `max-coverage.spec.ts:408`; `delivery-teaching.spec.ts:295`
  - `button-import-customers`: `jade-two-echelon.spec.ts:316`; `import.spec.ts:95`; `max-coverage.spec.ts:409`
  - `input-customer-demand-` (**demand-format sensitive, B2.9**):
    - `import.spec.ts:108`: `toHaveValue(String(originalDemand + 500))` breaks once the value is grouped
    - `chen-bands-units-qa.spec.ts:541,553,556,558,572,622,682,684`: `Number(await inputValue())` and `toHaveValue(String(Number(before)+500))` at `:572`. `Number("1,234")` is `NaN`, so this fails or silently mis-computes
    - `bundle2-fastfollow.spec.ts:154-157`: Brazil base demand `toBeDisabled()`
    - `max-coverage.spec.ts:292-296`: `Number(inputValue()) || 0` silently becomes 0 on a grouped value, then `fill()`s an ungrouped number
  - `button-customer-`: `delivery-teaching.spec.ts:297` (`button-customer-C1-excluded`)
  - None for `button-export-customers`, `customer-product-table`, `error-customer-demand-`, "Demand must be" (grep run).
- **Unit tests:** `__tests__/CustomerTable.test.tsx`, `__tests__/CustomersTab.test.tsx`, `__tests__/Studio.test.tsx` (legacy), `Workspace.test.tsx`, `Workspace.Brazil.test.tsx`, `Workspace.TwoEchelon.test.tsx`, `Workspace.Integration.test.tsx`, `Workspace.TabCoverage.test.tsx`.

#### Customers — added (scalar demand)
- **File:** `CustomersTab.tsx:486`, inside the section `:477-658`. Parent mount: `Workspace.tsx:3622`.
- **Models / gate:** iff `onAddedCustomersChange` is wired (`:477`). Wired for `p-median-us`, `two-echelon-gold-au`, `p-median-brazil` and `max-coverage-us` (`Workspace.tsx:3664-3671`). Not wired for delivery. JADE gets its own wiring, see below.
- **Row source:** `addedCustomersFromInputs` (`Workspace.tsx:679`), shape `{id, city, state, lat, lng, demand, demands?, displayCode?}` (`CustomersTab.tsx:37-48`).
- **Columns:** ID (`displayCode ?? id` plus chip); City; State (conditional); Latitude; Longitude; Demand — number — `c.demand`; (blank) delete.
- **Filter / paging:** none / none.
- **Add flow:** inline form below the table (`:579-651`). Trigger `button-add-customer-row` "+ Add customer" (`:648-650`). Fields: `input-new-customer-city|state|lat|lng|display-code|demand`. Confirm `button-add-customer-confirm`, cancel `button-add-customer-cancel`, error `text-add-customer-error`. Messages (`:304-351`): "City and state are both required." / "City is required."; "Display code '{c}' is already in use by another customer in this scenario."; "Latitude and longitude must both be numbers."; "Demand must be a number ≥ 0." The id is `newUid("cs")`.
- **Editable cells + disable rules:** demand `<Input type="number" min=0 value={c.demand}>` (`:547-557`). It commits on each keystroke when `Number.isFinite(parsed) && parsed >= 0`; otherwise the keystroke is silently ignored and there is no error text. **Not gated by `demandEditable`**, by design (`:80-83`), and **not disabled in history** (D2). The delete button (`:561-569`) is also not disabled in history.
- **Highlighting:** none. There is a precheck chip.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `added-customers-section` | section | `:478` |
| `added-customers-empty` | empty text | `:481` |
| `row-added-customer-{id}` | `<tr>` | `:505` |
| `warning-precheck-added-customer-{id}` | chip | `:516` |
| `input-added-customer-demand-{id}` | demand input | `:556` |
| `button-delete-added-customer-{id}` | delete | `:565` |
| `add-customer-row-form` | form | `:580` |
| `input-new-customer-city|state|lat|lng|display-code` | add inputs | `:587,596,606,615,623` |
| `input-new-customer-demand` | add demand (scalar) | `:638` |
| `button-add-customer-confirm` / `-cancel` | add buttons | `:640,643` |
| `button-add-customer-row` | trigger | `:648` |
| `text-add-customer-error` | error | `:653` |

- **e2e references:** `button-add-customer-row`: `workspace-fixups.spec.ts:270`. None for the others (grep run on `added-customers-section`, `added-customers-empty`, `row-added-customer-`, `warning-precheck-added-customer-`, `input-added-customer-demand-`, `button-delete-added-customer-`, `add-customer-row-form`, `input-new-customer-`, `button-add-customer-confirm|cancel`, `text-add-customer-error`, "Added customers", "Add customer").
- **Unit tests:** `__tests__/CustomersTab.test.tsx`.

#### JADE per-product customers — base
- **File:** `CustomersTab.tsx:678`, wrapper `customer-product-table` at `:677`. Parent mount: `Workspace.tsx:3622`.
- **Models / gate:** `two-echelon-jade-us` (`productMode = products.length > 0 && onProductOverridesChange != null`, `CustomersTab.tsx:158`; wiring at `Workspace.tsx:3673-3686`).
- **Row source & pipeline:** `dataset.customers`, then `useTableFilters` (`:391-392`). Overrides are `CustomerProductOverride {id, demands?: Record<productId,number>, status:"active"|"excluded"}` (`:58-62`) from `jadeCustomerOverridesFromInputs`. An override that is a no-op is dropped when `active` and has no demands (`:174-176`). The product list is `dataset.products`, so it is **dynamic**.
- **Columns:** ID; City; State (**always rendered** — it ignores `hasStateColumn`, `:683,698`); Latitude; Longitude; **one Demand column per product**, header `p.name` (`:686`), value `o?.demands?.[p.id] ?? c.demands?.[p.id] ?? 0`; Status — enum Active/Excluded.
- **Filter today:** `enableFilters={isJade}` (true), shown when `customers.length > 10` (`:393`). Descriptors: `id` text, `city` text, `state` text (conditional), one per product `demand:{productId}` number (label = product name) (`:370-378`).
- **Paging:** none.
- **Upload / Download entity:** `"customers"`.
- **Add flow:** none on base.
- **Editable cells + disable rules:**
  - Per-product demand `<Input type="number" min=0>` (`:708-715`). It uses a local `productDrafts` keyed `${c.id}:${p.id}` and commits on keystroke. Empty deletes that product's override; invalid input shows the error text "Demand must be ≥ 0" (`:185-204`, `:716`), and that error `<p>` has **no testid**.
  - Status buttons (`:723-734`).
  - **Neither is disabled in history** (no `disabled` reference in `:676-743`; CustomersTabProps comment `:115-123`). This is the D2 bug. `demandEditable` is not consulted (JADE is true anyway).
- **Highlighting:** none.
- **Testid map:**

| testid | element | line |
|---|---|---|
| `customer-product-table` | scroll wrapper div | `:677` |
| `input-customer-demand-{customerId}-{productId}` | per-product demand | `:714` |
| `button-customer-{id}-{active\|excluded}` | status buttons | `:725` |
| plus `customers-tab`, `customers-tab-toolbar`, `button-export-customers-*`, `button-import-customers`, `button-filter-menu-trigger` (shared toolbar) | | `:674,396-431` |

- **e2e references:** `customer-product-table`: none (grep run). `input-customer-demand-` prefix: the specs above are all non-JADE models (chen = max-coverage-us, import = p-median-us, bundle2 = brazil). `jade-two-echelon.spec.ts:315-316` uses `customers-tab` / `button-import-customers`. Caution: a `^="input-customer-demand-"` prefix selector also matches the JADE `{c}-{p}` ids.
- **Unit tests:** `__tests__/CustomersTab.test.tsx`, `Workspace.Jade*` (by `Workspace.test` family).

#### JADE per-product customers — added
- **File:** `CustomersTab.tsx:486` (the same Added section, `productMode` branch). Parent mount: `Workspace.tsx:3622`.
- **Models / gate:** JADE (`onAddedCustomersChange` wired at `Workspace.tsx:3680-3684`).
- **Row source:** `jadeAddedCustomersFromInputs` (`Workspace.tsx:461`). `demands` is per product; `demand` is a derived sum (`CustomersTab.tsx:267-276`).
- **Columns:** ID, City, State (conditional), Lat, Lng, one column per product (`:494-496`), delete.
- **Add flow:** the same form. Per-product inputs are `input-new-customer-demand-{productId}` (`:634`); blank means 0. Message: "Demand for {product.name} must be a number ≥ 0." (`:337`).
- **Editable cells:** per-product `<Input type="number" min=0 value={c.demands?.[p.id] ?? 0}>` (`:532-542`). Invalid input is silently ignored. **Not disabled in history** (D2), and the delete button is not either.
- **Testid map:** `row-added-customer-{id}` (`:505`), `warning-precheck-added-customer-{id}` (`:516`), `input-added-customer-demand-{id}-{productId}` (`:541`), `button-delete-added-customer-{id}` (`:565`), `input-new-customer-demand-{productId}` (`:634`), plus the shared section/form/trigger ids from Customers added.
- **e2e references:** none (grep run on `input-added-customer-demand-` and `input-new-customer-`).
- **Unit tests:** `__tests__/CustomersTab.test.tsx`.

#### Plants — base (JADE)
- **File:** `components/workspace/tabs/PlantsTab.tsx:393`. Parent mount: `Workspace.tsx:3551`.
- **Models / gate:** capability `supportsPlantProductCapability`, which today is only `two-echelon-jade-us` (`Workspace.tsx:3548`).
- **Row source & pipeline:** `dataset.plants`, then `useTableFilters` (`:106-112`). Read-only rows: **no overrides, no editable cells, no status**.
- **Columns:** ID — text — `p.name ?? p.id` (note: **name**, not id); City; State; Latitude; Longitude.
- **Filter today:** **not opt-in**. Shown when `plants.length > 10` (`:113`). Descriptors: `id` text (accessor `name ?? id`), `city` text, `state` text. JADE has 4 plants per `jade-ch9-workspace-bundle.spec.ts:528` comment, so it is never shown in practice.
- **Paging:** none.
- **Upload / Download entity:** `"plants"` (`:212,223,254`).
- **Add flow:** none on base.
- **Editable cells:** none.
- **Highlighting:** none.
- **Testid map:** `plants-tab` (`:390`), `plants-tab-toolbar` (`:208`), `button-export-plants-csv|json` (`:215,226`), `button-import-plants` (`:236`), `button-filter-menu-trigger` (`:243`), `plants-tab-empty` (`:380`). There are no row or cell testids.
- **e2e references:** `plants-tab`: `workspace-fixups.spec.ts:263`; `workspace-fixups-2.spec.ts:478,499`. None for `button-export-plants`, `button-import-plants` (grep run).
- **Unit tests:** `__tests__/PlantsTab.test.tsx`.

#### Plants — added (JADE)
- **File:** `PlantsTab.tsx:275`, inside the section `:261-374`. Parent mount: `Workspace.tsx:3551`.
- **Models / gate:** iff `onAddedPlantsChange` is wired (`:261`). JADE (`Workspace.tsx:3555-3557`).
- **Row source:** `addedPlantsFromInputs` (`Workspace.tsx:437`), shape `{id, city, state, lat, lng, displayCode?}` (`PlantsTab.tsx:49-56`). Then its **own** `useTableFilters` (`:115-121`).
- **Columns:** ID (`displayCode ?? id`), City, State, Latitude, Longitude, (blank) delete. There is no precheck chip.
- **Filter today:** a **separate second FilterMenu** in the section header when `addedPlants.length > 10` (`:122,265-267`). Its descriptors are `id` (`displayCode ?? id`), `city`, `state`. **This conflicts with spec B2.2 "Base and added sections share one menu"**, and two menus would both emit `button-filter-menu-trigger`.
- **Paging:** none.
- **Add flow:** inline form (`:312-367`). Trigger `button-add-plant-row` "+ Add plant". Fields `input-new-plant-city|state|lat|lng|display-code`. Confirm `button-add-plant-confirm`, cancel `button-add-plant-cancel`, error `text-add-plant-error`. Messages: "City and state are both required."; "Display code '{c}' is already in use by another plant in this scenario."; "Latitude and longitude must both be numbers." The id comes from `newPlantUid()` (`ap-…`, `:25-29`) and the code from `PL-{state}-{city}-NN` (`:31-41`). Both are local helpers, not `lib/entityId`.
- **Editable cells:** only the delete button (`:295-303`). It is **not disabled in history** (no disabled prop on PlantsTab at all).
- **Testid map:** `added-plants-section` (`:262`), `added-plants-empty` (`:270`), `row-added-plant-{id}` (`:288`), `button-delete-added-plant-{id}` (`:299`), `add-plant-row-form` (`:313`), `input-new-plant-city|state|lat|lng|display-code` (`:320,328,337,346,354`), `button-add-plant-confirm` (`:356`), `button-add-plant-cancel` (`:359`), `button-add-plant-row` (`:364`), `text-add-plant-error` (`:369`).
- **e2e references:** `added-plants-section`: `workspace-fixups-2.spec.ts:479,488,500`. `row-added-plant-`: `workspace-fixups-2.spec.ts:488,500`. `input-new-plant-*`: `workspace-fixups-2.spec.ts:482-485`. `button-add-plant-row`: `workspace-fixups.spec.ts:264`; `workspace-fixups-2.spec.ts:481`. `button-add-plant-confirm`: `workspace-fixups-2.spec.ts:486`. No hits for the others (grep run).
- **Unit tests:** `__tests__/PlantsTab.test.tsx`.

#### Mines — base (transport-coal)
- **File:** `components/tables/MineTable.tsx:26`, rendered by `components/workspace/tabs/MinesTab.tsx:418`. Parent mount: `Workspace.tsx:3698`.
- **Models / gate:** `transport-coal` (`Workspace.tsx:3695`).
- **Row source & pipeline:** `dataset.warehouses` (mine rows for this model). Overrides are `mineOverridesFromInputs` (`Workspace.tsx:305`), `{id, capacity?}`, written back as the map `inputs.mineCapacities` (`:3701`). There is no status. Order is dataset order.
- **Columns:** ID; City; State (always); Latitude; Longitude; Zip (conditional); "Capacity override (tons)" — number — `o?.capacity` (placeholder "base capacity", which shows **blank when not overridden**, unlike customer demand).
- **Filter today:** none.
- **Paging:** none.
- **Upload / Download entity:** `"mines"` (`MinesTab.tsx:206,217,243`).
- **Add flow:** none on base.
- **Editable cells:** capacity `<Input type="number" min=0>` (`MineTable.tsx:50-62`). It commits on keystroke via `parseInt`. **No disabled prop exists; it is live in history** (D2).
- **Highlighting:** none.
- **Testid map:** `mines-tab` (`MinesTab.tsx:416`), `mines-tab-toolbar` (`:202`), `button-export-mines-csv|json` (`:209,220`), `button-import-mines` (`:230`), `mines-tab-empty` (`:406`), `input-mine-capacity-{id}` (`MineTable.tsx:61`). There are no row testids.
- **e2e references:** `mines-tab`: `workspace-fixups-2.spec.ts:413`; `tab-coverage.spec.ts:194,204`. None for `button-export-mines`, `button-import-mines`, `input-mine-capacity-`, "Capacity override" (grep run).
- **Unit tests:** `__tests__/MinesTab.test.tsx`, `__tests__/MineTable.test.tsx`, `Workspace.TransportCoal.test.tsx`, `Workspace.test.tsx`.

#### Mines — added (transport-coal)
- **File:** `MinesTab.tsx:262`, inside the section `:253-400`. Parent mount: `Workspace.tsx:3698`.
- **Models / gate:** iff `onAddedMinesChange` is wired (`:253`). transport-coal (`Workspace.tsx:3704-3706`).
- **Row source:** `addedMinesFromInputs` (`Workspace.tsx:1025`), `{id, city, state, lat, lng, capacity?, displayCode?}` (`MinesTab.tsx:33-41`). Delete goes through `deleteAddedTransportEntityAndOverrides`.
- **Columns:** ID (plus a precheck chip "Missing N lane cost(s)"), City, State, Latitude, Longitude, Capacity — number (placeholder "unconstrained"), (blank) delete.
- **Filter / paging:** none / none.
- **Add flow:** inline form (`:337-393`). Trigger `button-add-mine-row` "+ Add mine". Fields `input-new-mine-city|state|lat|lng|display-code|capacity`. Confirm `button-add-mine-confirm`, cancel `button-add-mine-cancel`, error `text-add-mine-error`. Messages: "City and state are both required."; "Display code '{c}' is already in use by another mine in this scenario."; "Latitude and longitude must both be numbers."; "Capacity must be a positive number, or left blank for unconstrained." The id is `newUid("mn")`.
- **Editable cells:** capacity `<Input type="number" min=0>` (`:305-316`) and delete (`:319-327`). **Not disabled in history.**
- **Testid map:** `added-mines-section` (`:254`), `added-mines-empty` (`:257`), `row-added-mine-{id}` (`:279`), `warning-precheck-added-mine-{id}` (`:291`), `input-added-mine-capacity-{id}` (`:315`), `button-delete-added-mine-{id}` (`:323`), `add-mine-row-form` (`:338`), `input-new-mine-city|state|lat|lng|display-code|capacity` (`:345,353,362,371,379,381`), `button-add-mine-confirm|cancel` (`:382,385`), `button-add-mine-row` (`:390`), `text-add-mine-error` (`:395`).
- **e2e references:** `added-mines-section`: `tab-coverage.spec.ts:205`. `row-added-mine-`: `tab-coverage.spec.ts:207`. `button-add-mine-row`: `workspace-fixups-2.spec.ts:414`. No hits for the others (grep run).
- **Unit tests:** `__tests__/MinesTab.test.tsx`.

#### Stations — base (transport-coal)
- **File:** `components/tables/StationTable.tsx:26`, rendered by `components/workspace/tabs/StationsTab.tsx:395`. Parent mount: `Workspace.tsx:3718`.
- **Models / gate:** `transport-coal` (`Workspace.tsx:3715`).
- **Row source & pipeline:** `dataset.customers` (station rows). Overrides are `stationOverridesFromInputs` (`Workspace.tsx:310`), `{id, demand?}`, written back as the map `inputs.stationDemands` (`:3721`). There is no status.
- **Columns:** ID; City; State; Latitude; Longitude; Zip (conditional); "Demand override (tons)" — number — `o?.demand` (placeholder "base demand", **blank when not overridden**).
- **Filter / paging:** none / none.
- **Upload / Download entity:** `"stations"` (`StationsTab.tsx:189,200,226`).
- **Editable cells:** demand `<Input type="number" min=0>` (`StationTable.tsx:50-62`). It commits on keystroke via **`parseInt`**, which truncates decimals. **There is no disabled prop.** Note: B2.9's `FormattedNumberInput` names "base, added, and JADE per-product demand" with `input-customer-demand-*` testids. Station demand is a separate testid family (`input-station-demand-*`), and the spec is silent on whether it is in scope.
- **Highlighting:** none.
- **Testid map:** `stations-tab` (`StationsTab.tsx:393`), `stations-tab-toolbar` (`:185`), `button-export-stations-csv|json` (`:192,203`), `button-import-stations` (`:213`), `stations-tab-empty` (`:383`), `input-station-demand-{id}` (`StationTable.tsx:61`).
- **e2e references:** `stations-tab`: `workspace-fixups-2.spec.ts:416`. None for `button-export-stations`, `button-import-stations`, `input-station-demand-`, "Demand override" (grep run).
- **Unit tests:** `__tests__/StationsTab.test.tsx`, `__tests__/StationTable.test.tsx`, `Workspace.TransportCoal.test.tsx`.

#### Stations — added (transport-coal)
- **File:** `StationsTab.tsx:240`, inside the section `:231-378`. Parent mount: `Workspace.tsx:3718`.
- **Models / gate:** iff `onAddedStationsChange` is wired. transport-coal (`Workspace.tsx:3724-3726`).
- **Row source:** `addedStationsFromInputs` (`Workspace.tsx:1030`), `{id, city, state, lat, lng, demand, displayCode?}` (`StationsTab.tsx:29-37`).
- **Columns:** ID (plus chip), City, State, Latitude, Longitude, Demand — number, (blank) delete.
- **Add flow:** inline form (`:315-370`). Trigger `button-add-station-row`. Fields `input-new-station-city|state|lat|lng|display-code|demand`. Confirm `button-add-station-confirm`, cancel `button-add-station-cancel`, error `text-add-station-error`. Messages: "City and state are both required."; "Display code '{c}' is already in use by another station in this scenario."; "Latitude and longitude must both be numbers."; "Demand must be a number ≥ 0." (`:158-176`). The id is `newUid("st")`.
- **Editable cells:** demand `<Input type="number" min=0 value={s.demand}>` (`:283-293`) and delete (`:296-302`). **Not disabled in history.**
- **Testid map:** `added-stations-section` (`:232`), `added-stations-empty` (`:235`), `row-added-station-{id}` (`:257`), `warning-precheck-added-station-{id}` (`:269`), `input-added-station-demand-{id}` (`:292`), `button-delete-added-station-{id}` (`:300`), `add-station-row-form` (`:315`), `input-new-station-city|state|lat|lng|display-code|demand` (`:322,330,339,348,356,358`), `button-add-station-confirm|cancel` (`:359,362`), `button-add-station-row` (`:367`), `text-add-station-error` (`:372`).
- **e2e references:** `button-add-station-row`: `workspace-fixups-2.spec.ts:417`. No hits for the others (grep run).
- **Unit tests:** `__tests__/StationsTab.test.tsx`.

#### Scanned and excluded (no Workspace table instance)
- `components/workspace/tabs/OptimizationParametersTab.tsx`: **no `<Table>`/`<table>`** (grep returned nothing).
- `components/workspace/tabs/BandChipEditor.tsx`: **no table** (chip editor).
- `components/workspace/tabs/InputMapTab.tsx`: **no table** (map surface; 2780 lines, no `<Table`/`<table` match).
- `components/workspace/map/**`: no table.
- `components/ImportDialog.tsx:150` and `:185`: **EXCLUDED** per spec B2.10 (dialog-internal preview/error grids, not Workspace tables). Note that `ImportDialog.tsx:14` imports `FilterMenu`; it receives the `enableFilters` prop from WarehousesTab (`:357`) and CustomersTab (`:450`).

---

#### API-gap findings (entity inputs)

1. **The add flow is not a table row.** Every add form is a `flex` div **below** the `<Table>`, not a `<tr>` inside `tbody` (`WarehousesTab.tsx:486-551`, `CustomersTab.tsx:579-651`, `PlantsTab.tsx:312-367`, `MinesTab.tsx:337-393`, `StationsTab.tsx:315-370`). The trigger is the only thing that moves into `toolbar.add`. B2.8 replaces the form with the modal, so `toolbar.add` only needs a `ReactNode`. The error text `text-add-*-error` renders *below the section*, which is outside any toolbar slot. The modal must own it, or `sections` needs a footer slot.
2. **The sections differ in more than rows.** Base and added have **different column sets** for the same tab. Added gets a trailing blank-header delete column and a precheck chip in the ID cell, and Warehouses added uses a different status label source (`ADDED_STATUS_LABEL` vs `warehouseStatusPresentation`). Mines and Stations differ in placeholder semantics: base shows blank-when-not-overridden ("base capacity"), added shows the stored value. The spec's `sections?` (rows grouped under one toolbar) has no per-section `columns`. **The API needs `sections: Array<{ id, title?, rows, columns?, testIds?, emptyState? }>`**, or two DataTable instances sharing an external filter state.
3. **Testids are per section.** The row testid exists only on added rows (`row-added-{entity}-{id}`). **Base rows carry no row testid at all** (`WarehouseTable.tsx:120`, `CustomerTable.tsx:155`, `MineTable.tsx:42`, `StationTable.tsx:42`, `CustomersTab.tsx:695`, `PlantsTab.tsx:405`). `testIds.row` must be optional **per section**, and an absent value must emit no attribute (not `undefined`, and not an auto id). Section wrappers carry their own testid (`added-{entity}s-section`) and the empty-state testid (`added-*-empty`) sits inside the section. Both need a per-section `testIds.section` and `testIds.empty`. The tab root (`{entity}-tab`) and empty-dataset (`{entity}-tab-empty`) testids sit outside any table. The tab keeps them, but note that the empty-dataset branch still renders the toolbar and the added section (`WarehousesTab.tsx:555-566`): **the base table is replaced by text while the added section still renders**.
4. **Scroll wrappers carry testids.** `customer-product-table` is on the scroll **wrapper div** (`CustomersTab.tsx:677`), not the `<table>`. If `testIds.table` is placed on `<table>`, any selector that relies on the wrapper's containment still works only if both are present. Decide where `testIds.table` lands (the wrapper is recommended, since today's ids are all on wrappers or section divs). Separate `max-h` boxes (60vh base / 40vh added) mean today each section scrolls independently.
5. **Dynamic columns (JADE).** The per-product columns come from `dataset.products` (`CustomersTab.tsx:686,701-719,494-496,529-544`). `columns` must be computed per render; that is fine if `columns` is a prop rebuilt each render. But **filter descriptor ids must stay stable** (spec: ids = column ids). Today's ids are `demand:{productId}` (`:373`), so the column id must be `demand:${p.id}` to keep the descriptor keys (no e2e depends on them; grep run on `filter-control-demand`). Cell testids are **compound** `input-customer-demand-{c}-{p}`. `cellTestId?(row)` works per column, but for JADE the testid is on a nested `<Input>`, not the `<td>`, so it must come from `cell()`, not `cellTestId`.
6. **Testids on nested elements, multiple per cell.** The status cell emits 2-3 buttons with their own testids (`button-wh-{id}-{s}`, `button-customer-{id}-{s}`, `button-added-wh-{id}-{s}`). The demand cell emits an input plus `error-customer-demand-{id}` (`CustomerTable.tsx:171-173`). The ID cell emits the precheck chip (`warning-precheck-added-*`). The spec allows this ("cell may render nested elements carrying any number of their own testids"), and `cellTestId` is unused for all entity tables. **No entity table puts a testid on a `<td>`.**
7. **Per-row local draft state lives in the table component.** `WarehouseTable` and `CustomerTable` keep `drafts`/`errors` plus a `lastCommittedRef` stale-draft reconciliation run during render (`WarehouseTable.tsx:52-98`, `CustomerTable.tsx:47-132`), and the JADE table keeps `productDrafts`/`productErrors` (`CustomersTab.tsx:182-204`). `cell(row, ctx)` is a pure render function, so this state must move into the cell component (e.g. `FormattedNumberInput` owning its draft) or into the adapter's tab. `CellContext` has no slot for it, and none is needed if each editable cell is its own component.
8. **`ctx.demandEditable` is base-only.** Brazil `!demandEditable` applies to base demand only, and added demand is never gated (`CustomersTab.tsx:80-83`). With `sections`, `ctx` must be **per section**. Otherwise the cell must check `isAdded(row)`. `ctx.isAdded(row)` is in the spec and is sufficient if every section shares one row type. The base `Customer` and `AddedCustomer` types differ (no `zip` and no `status` on added), so `T` would be a union or a normalised effective row.
9. **Filter scope.** The spec says base and added share one menu. Today, Plants has **two independent menus** (`PlantsTab.tsx:241-245` and `:265-267`), and every other tab filters base only. The spec's single shared menu is a **behaviour change** for Plants, and two `button-filter-menu-trigger`s would be ambiguous anyway. Filter over the union of sections means descriptors need `value()` on both row shapes. Today's descriptor quirks that e2e pins: the JADE Warehouses `status` select option **value = presentation label** ("Fixed-Open", `jade-ch9-workspace-bundle.spec.ts:520`), so the column `value()` must return the label, not the enum `forced_open`. Plants `id` filters on `name ?? id` (`PlantsTab.tsx:107`), and Customers `state` is a **text** filter while Warehouses `state` is a **select** (`CustomersTab.tsx:368` vs `WarehousesTab.tsx:286`). Auto-derivation (≤20 distinct → select) will change some of these silently.
10. **Filter visibility today is opt-in and JADE-only** for Warehouses and Customers (`Workspace.tsx:3501,3644`). Refineries, Mines and Stations have no filter. B2.2's "every table > 10 rows, all models" flips `workspace-fixups-2.spec.ts:255`, which asserts **no** filter trigger on the 26-row non-JADE warehouses tab. That spec must be rewritten in the Warehouses migration commit.
11. **Conditional columns.** State (`hasStateColumn`), Zip (`rows.some(r=>r.zip)`), and Capacity (`capacityMode==="per_wh"`). These are expressible by building `columns` conditionally. `jade-ch9-workspace-bundle.spec.ts:462-463` reads `thead th` inner texts and asserts no "Capacity". A trailing blank `<TableHead />` (delete column) yields an empty-string `th`. Keep it, or the header-count tests (if any) change. There are no header testids anywhere in entity tables.
12. **Toolbar order and labels.** Today's order is **Download CSV, Download JSON, Upload, then Filter right-aligned** (`WarehousesTab.tsx:303-341`). The ids are `button-export-{entity}-csv|json` and `button-import-{entity}`. B2.3/B2.4 turn these into dropdowns. The four `button-export-*`/`button-import-*` literals must be preserved on the dropdown triggers or items (e2e: `workspace-fixups.spec.ts:517-518`, `jade-two-echelon.spec.ts:316`, `import.spec.ts:95`, `max-coverage.spec.ts:409`). A single "Download ▾" cannot carry two ids on one trigger, so the plan should map `button-export-{e}-csv|json` to the **menu items**, and e2e needs one extra click to open the menu. `workspace-fixups-2.spec.ts:518-519` asserts the toolbar's bounding box is < 40 px high (one line).
13. **No highlighting today.** The spec's `rowClassName` / `isOverridden` / `isChanged` adds amber override highlighting to tables that have none today (all entity tables). That is a new visible behaviour if applied here. The spec only cites Distances/LaneCosts/DeliveryCosts as having amber today, so the default should be no `rowClassName` for entity adapters.

#### Current customer demand input (replaced by `FormattedNumberInput`, B2.9)

Base, scalar (`components/tables/CustomerTable.tsx:163-173`):
```tsx
<Input
  type="number"
  min={0}
  value={disabled ? String(o?.demand ?? c.demand) : drafts[c.id] ?? String(o?.demand ?? c.demand)}
  onChange={e => handleDemandChange(c.id, e.target.value)}
  disabled={disabled || !demandEditable}
  title={disabled ? "Read-only while browsing result history." : demandEditable ? undefined : "Demand for this row is fixed by the textbook dataset and can't be edited."}
  className="h-7 text-xs w-28 font-mono"
  data-testid={`input-customer-demand-${c.id}`}
/>
{!disabled && error && <p className="text-[10px] text-destructive mt-0.5" data-testid={`error-customer-demand-${c.id}`}>{error}</p>}
```
- **There is no `aria-label`** (`grep -n "aria-label\|aria-describedby" CustomerTable.tsx` returned nothing). The spec says "the input's `aria-label` is unchanged", but there is none today. P4 either adds one (a new accessible name) or keeps none and links "Units" only via `aria-describedby`.
- **There is no "Units" suffix today.**
- Commit semantics (`handleDemandChange`, `:85-106`): commits **on every keystroke** (no blur). `""` maps to `upsert(id, {demand: null})`, which clears the override (and drops the whole override when status is active, `:81-82`). `Number(raw)` must be finite and `>= 0`, otherwise the error "Demand must be ≥ 0" shows and nothing commits. Decimals are accepted because `Number`, not `parseInt`, is used. The draft is kept in `drafts[id]` and reconciled during render against `lastCommittedRef` (`:113-132`).
- Disabled when `disabled` (history) **or** `!demandEditable` (Brazil base).

Added, scalar (`CustomersTab.tsx:547-557`): `<Input type="number" min={0} value={c.demand} onChange={e => { const parsed = Number(e.target.value); if (Number.isFinite(parsed) && parsed >= 0) upsertAddedDemand(c.id, parsed); }} className="h-7 text-xs w-28 font-mono" data-testid={`input-added-customer-demand-${c.id}`} />`. Controlled directly by props with no draft. An empty value yields `Number("") = 0`, which commits 0 (not null). There is no error text and no disabled state.

JADE base per-product (`CustomersTab.tsx:708-716`): `type="number" min={0}`, `value={productDrafts[key] ?? String(overrideValue ?? baseValue)}`, `onChange → handleProductDemandChange(c.id, p.id, raw)`. Empty deletes that product key from `demands`. Invalid input shows the error "Demand must be ≥ 0" as a `<p>` with **no testid**. Testid `input-customer-demand-{c}-{p}`. Never disabled.

JADE added per-product (`CustomersTab.tsx:532-542`): `value={c.demands?.[p.id] ?? 0}`. Commits a finite value `>= 0`. Testid `input-added-customer-demand-{c}-{p}`. Never disabled.

**e2e that will break under grouped display** (B2.9 must rewrite these in the same commit):
- `import.spec.ts:108` (`toHaveValue(String(originalDemand + 500))`)
- `chen-bands-units-qa.spec.ts:556-572` and `:682-686` (`Number(inputValue())` / `toHaveValue(String(Number(before)+500))`)
- `max-coverage.spec.ts:292-296` (`Number(inputValue()) || 0` silently becomes 0 when the value is grouped, e.g. "1,234")

## 3. e2e selector / visible-string inventory

**Method (re-runnable):** for every instance in §2, each testid in its testid map is reduced to its static prefix (text before the first `{`, `${` or `|`; prefixes shorter than 6 characters are dropped as too generic), and every prefix is grepped as a plain substring across `artifacts/studio/e2e/*.spec.ts` and `artifacts/studio/e2e/helpers/**` (excluding `labs.spec.ts`). The FilterMenu testids that every filtered table shares are grouped once at the end, because a per-table grep cannot tell which table a `button-filter-menu-trigger` line targets — the per-instance "e2e references" lines in §2 resolve that by reading the scope (`page.getByTestId("<tab>").getByTestId(...)`). Refineries (added) shares the Warehouses-added testids (D4) and has no inventory of its own.

**Visible strings** (headers, button labels, empty-state and "Page X of Y" text) were grepped per instance and are listed in §2's "e2e references" lines next to the testids, because a string needle (e.g. `"Distance"`) is not unique to one table.

**Use:** a P3/P4 migration commit greps the prefixes of the instance it migrates, rewrites every listed line it breaks, and runs those specs with `E2E_BASE_URL=http://localhost:<studio-port>` (recipe: `artifacts/studio/e2e/CLAUDE.md`).

#### OpenWarehouses
- prefixes grepped (3): `button-download-open-warehouses-csv`, `open-warehouse-row-`, `open-warehouses-empty`
- e2e hits: 7 lines in 3 files
  - `jade-ch9-workspace-bundle.spec.ts`: 471
  - `jade-two-echelon.spec.ts`: 152, 153
  - `max-coverage.spec.ts`: 181, 182, 183, 184

#### Assignments (shared, non-JADE)
- prefixes grepped (3): `assignment-row-`, `assignments-empty`, `button-download-assignments-csv`
- e2e hits: 4 lines in 2 files
  - `jade-two-echelon.spec.ts`: 157
  - `workspace-fixups-2.spec.ts`: 306, 307, 310

#### JadeAssignments
- prefixes grepped (12): `button-download-jadeassignments-csv`, `button-jadeassignments-next`, `button-jadeassignments-prev`, `cell-jadeassignment-band-`, `cell-jadeassignment-customer-`, `cell-jadeassignment-distance-`, `cell-jadeassignment-product-`, `cell-jadeassignment-warehouse-`, `jade-assignments-empty`, `jade-assignments-tab`, `jadeassignments-page-indicator`, `text-jadeassignments-count`
- e2e hits: 12 lines in 4 files
  - `jade-ch9-workspace-bundle.spec.ts`: 334, 335, 398, 399
  - `jade-two-echelon.spec.ts`: 164
  - `workspace-fixups-2.spec.ts`: 540, 541, 562
  - `workspace-fixups.spec.ts`: 328, 329, 375, 454

#### Flows (shared, non-JADE)
- prefixes grepped (3): `button-download-flows-csv`, `flow-row-`, `flows-empty`
- e2e hits: 1 lines in 1 files
  - `jade-two-echelon.spec.ts`: 167

#### JadeFlows P→W
- prefixes grepped (13): `button-download-jade-flows-pw-csv`, `button-jade-flows-inner-plant-warehouse`, `button-jade-flows-inner-warehouse-customer`, `cell-jade-flow-pw-band-`, `cell-jade-flow-pw-distance-`, `cell-jade-flow-pw-flow-`, `cell-jade-flow-pw-warehouse-`, `jade-flow-pw-row-`, `jade-flows-empty`, `jade-flows-inner-tabs`, `jade-flows-pw-table`, `jade-flows-tab`, `text-jadeflows-pw-count`
- e2e hits: 6 lines in 2 files
  - `jade-ch9-workspace-bundle.spec.ts`: 405, 406, 407, 412
  - `jade-two-echelon.spec.ts`: 171, 250

#### JadeFlows W→C
- prefixes grepped (11): `button-download-jade-flows-wc-csv`, `cell-jade-flow-wc-band-`, `cell-jade-flow-wc-customer-`, `cell-jade-flow-wc-distance-`, `cell-jade-flow-wc-flow-`, `jade-flow-wc-row-`, `jade-flows-empty`, `jade-flows-inner-tabs`, `jade-flows-tab`, `jade-flows-wc-table`, `text-jadeflows-wc-count`
- e2e hits: 3 lines in 1 files
  - `jade-ch9-workspace-bundle.spec.ts`: 405, 413, 414

#### CostSummary single
- prefixes grepped (17): `button-download-cost-summary-csv`, `cost-summary-compare-hint-`, `cost-summary-compare-toggle-`, `cost-summary-compare-toggles`, `cost-summary-coverage-pct`, `cost-summary-covered-demand`, `cost-summary-empty`, `cost-summary-high-service-cutoff`, `cost-summary-history-hint`, `cost-summary-list`, `cost-summary-max-coverable-demand`, `cost-summary-min-ic`, `cost-summary-min-ob`, `cost-summary-rate-ic`, `cost-summary-rate-ob`, `cost-summary-single-column`, `cost-summary-value-`
- e2e hits: 44 lines in 10 files
  - `bundle6-ui-tweaks.spec.ts`: 212, 215
  - `chen-bands-units-qa.spec.ts`: 168, 195, 202, 203, 217, 221
  - `delivery-teaching.spec.ts`: 208
  - `jade-transport-costs.spec.ts`: 84, 87, 153, 157, 158, 159, 160, 168
  - `jade-two-echelon.spec.ts`: 125, 174
  - `max-coverage-objective.spec.ts`: 120, 121, 131, 132, 150, 151, 152
  - `max-coverage.spec.ts`: 177, 202, 205, 206, 207, 282, 283, 284
  - `truthful-status.spec.ts`: 28, 210, 222
  - `two-echelon.spec.ts`: 19, 174, 178
  - `workspace-ux-r1-r9.spec.ts`: 245, 246, 287, 288

#### CostSummary compare
- prefixes grepped (17): `cost-summary-compare-band-`, `cost-summary-compare-bands-note`, `cost-summary-compare-column-`, `cost-summary-compare-coverage-pct-`, `cost-summary-compare-covered-demand-`, `cost-summary-compare-distance-`, `cost-summary-compare-high-service-cutoff-`, `cost-summary-compare-inbound-`, `cost-summary-compare-max-coverable-demand-`, `cost-summary-compare-objective-`, `cost-summary-compare-open-facilities-cities-`, `cost-summary-compare-open-facility-`, `cost-summary-compare-outbound-`, `cost-summary-compare-quality-`, `cost-summary-compare-rate-ic-`, `cost-summary-compare-runtime-`, `cost-summary-compare-table`
- e2e hits: 17 lines in 4 files
  - `bundle6-ui-tweaks.spec.ts`: 216, 222
  - `jade-transport-costs.spec.ts`: 170, 172
  - `two-echelon.spec.ts`: 180, 185
  - `workspace-ux-r1-r9.spec.ts`: 249, 250, 251, 255, 256, 260, 261, 291, 293, 294, 299

#### ServiceStats Plant Production
- prefixes grepped (2): `plant-production-section`, `row-plant-production-`
- e2e hits: 8 lines in 1 files
  - `jade-ch9-workspace-bundle.spec.ts`: 419, 421, 426, 429, 481, 483, 496, 499

#### Distances
- prefixes grepped (30): `add-distance-row-form`, `badge-distance-changed-`, `badge-distance-estimated-`, `button-add-distance-cancel`, `button-add-distance-confirm`, `button-add-distance-row`, `button-distances-next`, `button-distances-prev`, `button-export-distances-csv`, `button-export-distances-json`, `button-import-distances`, `button-remove-distance-`, `distances-page-indicator`, `distances-reference-error`, `distances-reference-loading`, `distances-reference-section`, `distances-tab`, `distances-tab-empty`, `distances-tab-toolbar`, `input-distance-`, `input-filter-from`, `input-filter-to`, `input-new-distance-from`, `row-distance-`, `spinner-distance-base-`, `spinner-distance-unit-`, `text-add-distance-error`, `text-distance-error-`, `warning-unknown-from-`, `warning-unknown-to-`
- e2e hits: 76 lines in 9 files
  - `bundle2-fastfollow.spec.ts`: 304
  - `bundle5-homepage-distances.spec.ts`: 174, 178, 180, 181, 183, 189, 192, 197, 211, 213, 224
  - `bundle6.1-legend-distances.spec.ts`: 232, 242, 244, 245, 246, 250, 251, 253, 265, 266, 311
  - `chen-bands-units-qa.spec.ts`: 268, 269, 405, 408, 409, 412, 416, 420, 425, 428, 429, 430, 435, 439, 440, 441, 442, 456, 482, 644, 645, 745, 746, 751, 758
  - `delivery-teaching.spec.ts`: 217, 242, 243
  - `input-map-v2.spec.ts`: 144, 145, 148, 151, 154
  - `jade-transport-costs.spec.ts`: 100, 110, 111, 116, 134
  - `jade-two-echelon.spec.ts`: 282, 283, 289, 290, 294
  - `max-coverage.spec.ts`: 311, 312, 313, 316, 321, 372, 373, 374, 377, 384

#### LegDistances (one table instance — both legs share one flat list)
- prefixes grepped (17): `add-legdistance-row-form`, `badge-leg-`, `badge-legdistance-changed-`, `button-add-legdistance-`, `button-add-legdistance-row`, `button-export-legdistances-csv`, `button-import-legdistances`, `button-remove-legdistance-`, `input-filter-from`, `input-filter-to`, `input-legdistance-`, `input-new-legdistance-`, `legdistances-tab`, `legdistances-tab-empty`, `legdistances-tab-toolbar`, `row-legdistance-`, `text-add-legdistance-error`
- e2e hits: 21 lines in 8 files
  - `bundle2-fastfollow.spec.ts`: 304, 305
  - `bundle5-homepage-distances.spec.ts`: 189, 211
  - `bundle6.1-legend-distances.spec.ts`: 250, 251, 311, 313
  - `chen-bands-units-qa.spec.ts`: 439, 440
  - `delivery-teaching.spec.ts`: 242, 243
  - `jade-transport-costs.spec.ts`: 110, 111, 116
  - `jade-two-echelon.spec.ts`: 283, 289, 290, 294
  - `max-coverage.spec.ts`: 373, 377

#### JadeDistances
- prefixes grepped (25): `add-jadedistance-row-form`, `badge-jadedistance-min-`, `badge-leg-`, `button-add-jadedistance-`, `button-add-jadedistance-row`, `button-export-legdistances-csv`, `button-import-legdistances`, `button-jadedistances-next`, `button-jadedistances-prev`, `cell-jadedistance-cost-`, `filter-control-from`, `input-filter-from`, `input-jadedistance-`, `input-new-jadedistance-`, `jade-distances-tab`, `jade-distances-tab-empty`, `jadedistances-page-indicator`, `jadedistances-reference-error`, `jadedistances-reference-section`, `jadedistances-tab-toolbar`, `row-jadedistance-`, `select-new-jadedistance-leg`, `text-add-jadedistance-error`, `text-jadedistance-error-`, `warning-unknown-from-`
- e2e hits: 14 lines in 7 files
  - `bundle5-homepage-distances.spec.ts`: 189
  - `bundle6.1-legend-distances.spec.ts`: 250, 313
  - `chen-bands-units-qa.spec.ts`: 439
  - `delivery-teaching.spec.ts`: 242
  - `jade-transport-costs.spec.ts`: 100, 101, 103, 112, 114, 134
  - `jade-two-echelon.spec.ts`: 282
  - `max-coverage.spec.ts`: 373, 377

#### LaneCosts
- prefixes grepped (17): `add-lanecost-row-form`, `badge-lanecost-changed-`, `button-add-lanecost-`, `button-add-lanecost-row`, `button-export-lanecosts-csv`, `button-import-lanecosts`, `button-remove-lanecost-`, `input-filter-from`, `input-filter-to`, `input-lanecost-`, `input-new-lanecost-`, `lanecosts-tab`, `lanecosts-tab-empty`, `lanecosts-tab-toolbar`, `row-lanecost-`, `text-add-lanecost-error`, `warning-unknown-from-`
- e2e hits: 19 lines in 8 files
  - `bundle2-fastfollow.spec.ts`: 237, 238
  - `bundle5-homepage-distances.spec.ts`: 189, 211
  - `bundle6.1-legend-distances.spec.ts`: 250, 251
  - `chen-bands-units-qa.spec.ts`: 439, 440
  - `delivery-teaching.spec.ts`: 242, 243
  - `jade-transport-costs.spec.ts`: 110, 111, 116
  - `jade-two-echelon.spec.ts`: 283, 289, 290, 294
  - `max-coverage.spec.ts`: 373, 377

#### DeliveryCosts
- prefixes grepped (17): `add-deliverycost-row-form`, `badge-deliverycost-overridden-`, `button-add-deliverycost-`, `button-add-deliverycost-row`, `button-delivery-costs-next`, `button-delivery-costs-prev`, `button-remove-deliverycost-`, `delivery-costs-page-indicator`, `delivery-costs-tab`, `delivery-costs-tab-loading`, `delivery-costs-tab-toolbar`, `input-deliverycost-`, `input-filter-from`, `input-filter-to`, `input-new-deliverycost-`, `row-deliverycost-`, `text-add-deliverycost-error`
- e2e hits: 20 lines in 7 files
  - `bundle5-homepage-distances.spec.ts`: 189, 211
  - `bundle6.1-legend-distances.spec.ts`: 250, 251
  - `chen-bands-units-qa.spec.ts`: 439, 440
  - `delivery-teaching.spec.ts`: 241, 242, 243, 244, 248
  - `jade-transport-costs.spec.ts`: 110, 111, 116
  - `jade-two-echelon.spec.ts`: 283, 289, 290, 294
  - `max-coverage.spec.ts`: 373, 377

#### TransportCosts
- prefixes grepped (4): `button-transport-reset`, `label-transport-rate-unit-head`, `text-transport-formula`, `transport-costs-tab`
- e2e hits: 2 lines in 1 files
  - `jade-transport-costs.spec.ts`: 92, 137

#### CapabilityMatrix (Plant Capability Matrix)
- prefixes grepped (13): `capability-matrix-empty`, `capability-matrix-tab`, `checkbox-capability-`, `checkbox-filter-state-`, `filter-control-plant`, `input-filter-plant`, `option-filter-state-`, `row-capability-`, `select-filter-state`, `text-capability-capacity-`, `text-capability-capacity-label`, `text-capability-count`, `text-capability-plant-`
- e2e hits: 21 lines in 3 files
  - `jade-ch9-workspace-bundle.spec.ts`: 440, 441, 442, 443, 444, 449, 450, 451, 453, 454, 455, 530
  - `jade-two-echelon.spec.ts`: 230, 231, 256, 257
  - `workspace-fixups.spec.ts`: 284, 292, 300, 309, 310

#### Warehouses — base
- prefixes grepped (7): `button-export-warehouses-csv`, `button-export-warehouses-json`, `button-import-warehouses`, `input-wh-capacity-`, `warehouses-tab`, `warehouses-tab-empty`, `warehouses-tab-toolbar`
- e2e hits: 21 lines in 6 files
  - `bundle6-ui-tweaks.spec.ts`: 188
  - `delivery-teaching.spec.ts`: 282
  - `jade-ch9-workspace-bundle.spec.ts`: 459, 460, 462, 505, 511, 513
  - `tab-coverage.spec.ts`: 142, 154
  - `workspace-fixups-2.spec.ts`: 250, 255, 277, 509, 510
  - `workspace-fixups.spec.ts`: 266, 504, 516, 517, 518, 542

#### Warehouses — added
- prefixes grepped (13): `add-warehouse-row-form`, `added-warehouses-empty`, `added-warehouses-section`, `button-add-warehouse-cancel`, `button-add-warehouse-confirm`, `button-add-warehouse-row`, `button-added-wh-`, `button-delete-added-warehouse-`, `input-added-wh-capacity-`, `input-new-warehouse-city`, `row-added-warehouse-`, `text-add-warehouse-error`, `warning-precheck-added-warehouse-`
- e2e hits: 22 lines in 4 files
  - `jade-ch9-workspace-bundle.spec.ts`: 465, 466, 468
  - `tab-coverage.spec.ts`: 155, 157, 252, 253, 259, 261
  - `workspace-fixups-2.spec.ts`: 251, 257, 258, 262, 264, 278, 358
  - `workspace-fixups.spec.ts`: 267, 506, 508, 519, 543, 544

#### Refineries — base (two-echelon-gold-au)
- prefixes grepped (6): `button-export-refineries-csv`, `button-import-refineries`, `button-wh-`, `refineries-tab`, `refineries-tab-empty`, `refineries-tab-toolbar`
- e2e hits: 6 lines in 4 files
  - `delivery-teaching.spec.ts`: 284
  - `jade-ch9-workspace-bundle.spec.ts`: 522, 525
  - `tab-coverage.spec.ts`: 244, 258
  - `workspace-fixups-2.spec.ts`: 357

#### Customers — base (scalar demand)
- prefixes grepped (7): `button-export-customers-csv`, `button-import-customers`, `customers-tab`, `customers-tab-empty`, `customers-tab-toolbar`, `error-customer-demand-`, `input-customer-demand-`
- e2e hits: 20 lines in 7 files
  - `bundle2-fastfollow.spec.ts`: 152, 154
  - `chen-bands-units-qa.spec.ts`: 541, 553, 556, 558, 572, 622, 682, 684
  - `delivery-teaching.spec.ts`: 295
  - `import.spec.ts`: 94, 95, 108
  - `jade-two-echelon.spec.ts`: 315, 316
  - `max-coverage.spec.ts`: 292, 408, 409
  - `workspace-fixups.spec.ts`: 269

#### Customers — added (scalar demand)
- prefixes grepped (11): `add-customer-row-form`, `added-customers-empty`, `added-customers-section`, `button-add-customer-confirm`, `button-add-customer-row`, `button-delete-added-customer-`, `input-added-customer-demand-`, `input-new-customer-demand`, `row-added-customer-`, `text-add-customer-error`, `warning-precheck-added-customer-`
- e2e hits: 1 lines in 1 files
  - `workspace-fixups.spec.ts`: 270

#### JADE per-product customers — base
- prefixes grepped (5): `button-import-customers`, `customer-product-table`, `customers-tab`, `customers-tab-toolbar`, `input-customer-demand-`
- e2e hits: 20 lines in 7 files
  - `bundle2-fastfollow.spec.ts`: 152, 154
  - `chen-bands-units-qa.spec.ts`: 541, 553, 556, 558, 572, 622, 682, 684
  - `delivery-teaching.spec.ts`: 295
  - `import.spec.ts`: 94, 95, 108
  - `jade-two-echelon.spec.ts`: 315, 316
  - `max-coverage.spec.ts`: 292, 408, 409
  - `workspace-fixups.spec.ts`: 269

#### JADE per-product customers — added
- prefixes grepped (5): `button-delete-added-customer-`, `input-added-customer-demand-`, `input-new-customer-demand-`, `row-added-customer-`, `warning-precheck-added-customer-`
- e2e hits: none (grep run)

#### Plants — base (JADE)
- prefixes grepped (5): `button-export-plants-csv`, `button-import-plants`, `plants-tab`, `plants-tab-empty`, `plants-tab-toolbar`
- e2e hits: 3 lines in 2 files
  - `workspace-fixups-2.spec.ts`: 478, 499
  - `workspace-fixups.spec.ts`: 263

#### Plants — added (JADE)
- prefixes grepped (10): `add-plant-row-form`, `added-plants-empty`, `added-plants-section`, `button-add-plant-cancel`, `button-add-plant-confirm`, `button-add-plant-row`, `button-delete-added-plant-`, `input-new-plant-city`, `row-added-plant-`, `text-add-plant-error`
- e2e hits: 7 lines in 2 files
  - `workspace-fixups-2.spec.ts`: 479, 481, 482, 486, 488, 500
  - `workspace-fixups.spec.ts`: 264

#### Mines — base (transport-coal)
- prefixes grepped (6): `button-export-mines-csv`, `button-import-mines`, `input-mine-capacity-`, `mines-tab`, `mines-tab-empty`, `mines-tab-toolbar`
- e2e hits: 3 lines in 2 files
  - `tab-coverage.spec.ts`: 194, 204
  - `workspace-fixups-2.spec.ts`: 413

#### Mines — added (transport-coal)
- prefixes grepped (11): `add-mine-row-form`, `added-mines-empty`, `added-mines-section`, `button-add-mine-confirm`, `button-add-mine-row`, `button-delete-added-mine-`, `input-added-mine-capacity-`, `input-new-mine-city`, `row-added-mine-`, `text-add-mine-error`, `warning-precheck-added-mine-`
- e2e hits: 3 lines in 2 files
  - `tab-coverage.spec.ts`: 205, 207
  - `workspace-fixups-2.spec.ts`: 414

#### Stations — base (transport-coal)
- prefixes grepped (6): `button-export-stations-csv`, `button-import-stations`, `input-station-demand-`, `stations-tab`, `stations-tab-empty`, `stations-tab-toolbar`
- e2e hits: 1 lines in 1 files
  - `workspace-fixups-2.spec.ts`: 416

#### Stations — added (transport-coal)
- prefixes grepped (11): `add-station-row-form`, `added-stations-empty`, `added-stations-section`, `button-add-station-confirm`, `button-add-station-row`, `button-delete-added-station-`, `input-added-station-demand-`, `input-new-station-city`, `row-added-station-`, `text-add-station-error`, `warning-precheck-added-station-`
- e2e hits: 1 lines in 1 files
  - `workspace-fixups-2.spec.ts`: 417

#### Shared FilterMenu testids (every table with a filter today; FilterMenu.tsx)
- prefixes grepped (11): `button-clear-all-filters`, `button-clear-filter-`, `button-filter-menu-trigger`, `checkbox-filter-`, `filter-control-`, `filter-menu-popover`, `input-filter-`, `option-filter-`, `select-filter-`, `text-filter-active-count`, `text-filter-count`
- e2e hits: 55 lines in 10 files
  - `bundle5-homepage-distances.spec.ts`: 189, 211
  - `bundle6.1-legend-distances.spec.ts`: 250, 251
  - `chen-bands-units-qa.spec.ts`: 439, 440
  - `delivery-teaching.spec.ts`: 242, 243
  - `jade-ch9-workspace-bundle.spec.ts`: 35, 484, 487, 488, 494, 495, 497, 498, 513, 516, 517, 520, 521, 523, 524, 531
  - `jade-transport-costs.spec.ts`: 109, 110, 111, 116
  - `jade-two-echelon.spec.ts`: 283, 288, 289, 290, 294
  - `max-coverage.spec.ts`: 373, 377
  - `workspace-fixups-2.spec.ts`: 255, 462, 512, 541, 544, 559
  - `workspace-fixups.spec.ts`: 191, 195, 201, 329, 332, 350, 356, 360, 413, 430, 431, 436, 447, 451

## 4. API-gap resolution — what the spec's B2.1 API could not express, and the P1 interface that covers it

The spec's B2.1 prop list (`rows`, `rowKey`, `columns{id,header,kind,cell,value,filter,cellTestId}`, `testIds{table,row,pager,pageIndicator,filterTrigger}`, `rowClassName`, `ctx`, `toolbar`, `emptyState`, `sections`) was checked against every instance above. Each gap is closed by an **additive** field in the P1 interfaces (`docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-p1.md`, "Interfaces"). Nothing in the spec's list was removed or renamed.

| # | Gap (evidence) | P1 resolution |
|---|---|---|
| G1 | Pager Prev/Next carry their own testids: `button-{p}-prev`/`-next` (`DistancesTab.tsx:225,238`; `JadeAssignmentsTab.tsx:187,200`; e2e `bundle5-homepage-distances.spec.ts:180-183`) | `testIds.pagerPrev`, `testIds.pagerNext` (plus spec's `pager`, `pageIndicator`) |
| G2 | Header-cell testids: `cost-summary-single-column`, `cost-summary-compare-column-{id}` (`CostSummaryTab.tsx:463,514`), `label-transport-rate-unit-head` (`TransportCostsTab.tsx:218`) | `ColumnDef.headerTestId` |
| G3 | Table testids sit on wrapper divs that contain the toolbar, filter trigger and `thead` (`jade-flows-pw-table` `JadeFlowsTab.tsx:435`; `cost-summary-compare-table` `:508`; `customer-product-table` `CustomersTab.tsx:677`); e2e scopes `thead th` and `button-filter-menu-trigger` inside them (`jade-ch9-workspace-bundle.spec.ts:399-421,483`) | `testIds.root` (wrapper of toolbar + table + pager), `testIds.scroll` (scroll wrapper), `testIds.table` (`<table>` itself, e.g. `cost-summary-list` `CostSummaryTab.tsx:459`); per section `testId`, `scrollTestId`, `tableTestId` |
| G4 | Toolbar testids asserted by e2e (`distances-tab-toolbar` `chen-bands-units-qa.spec.ts:268,405,745`; `max-coverage.spec.ts:311,372`) | `testIds.toolbar` |
| G5 | Always-visible "X of Y" counters outside FilterMenu (`text-jadeassignments-count` `JadeAssignmentsTab.tsx:305`; `text-jadeflows-pw-count`/`-wc-count` `JadeFlowsTab.tsx:401,417`) | `testIds.count` — renders `{filtered} of {total}` only when mapped. `text-capability-count` (`CapabilityMatrixTab.tsx:164`) differs in text and goes in `toolbar.extra` |
| G6 | In-tbody "No rows match the current filter." colSpan row, distinct from the tab empty state (`DistancesTab.tsx:840-845`; `JadeAssignmentsTab.tsx:349-354`; `JadeFlowsTab.tsx:465-469,505-509`; CapabilityMatrix "No plants match…") | `noMatchText` (default `"No rows match the current filter."`) + `testIds.noMatch`; `emptyState` + `testIds.empty` stay for zero rows |
| G7 | Focus jump sets the page and clears filters from outside the pipeline (`DistancesTab.tsx:459-479`; `JadeDistancesTab.tsx:441-505`) | `focus: { token, matches }` — clears filters, jumps, `scrollIntoView({block:"center"})` |
| G8 | JADE `band` filter is cleared alone when bands/unit change (`JadeAssignmentsTab.tsx:277-280`; `JadeFlowsTab.tsx:327-335`) | `ColumnDef.filterResetKey` |
| G9 | Filter on a value with no rendered column (`CapabilityMatrixTab.tsx:65` `state`) | `ColumnDef.hidden` (filter-only column) |
| G10 | Base and added sections differ in columns, row testids, scroll height and empty state; add forms sit below the table, outside `<tbody>` (`WarehousesTab.tsx:486-551`, `:555-566`; base rows carry no row testid `WarehouseTable.tsx:120`) | `DataTableSection{ id, title, testId, tableTestId, scrollTestId, scrollClassName, includes, columns, rowTestId, footer, emptyState }`; `testIds.row` is optional and emits nothing when absent |
| G11 | Scroll wrappers `max-h-[55vh]` / `[60vh]` / `[40vh]` | `scrollClassName` (single table) / `DataTableSection.scrollClassName` |
| G12 | A cell testid sits on the `<td>` and e2e counts its direct `<span>` children (`text-capability-plant-{id}`, `workspace-fixups.spec.ts:292-296`); e2e reads `td.nth(0) .flex.flex-col span` (`workspace-fixups-2.spec.ts:310-318`) | `cellTestId` goes on the `<td>`, and `cell()` output is placed **directly** in the `<td>` with no wrapper (asserted in the P1 tests) |
| G13 | Per-cell classes (`font-mono text-xs` base cells) | `ColumnDef.cellClassName` (alignment and padding stay the shell's) |
| G14 | Two FilterMenus on one tab both emit `button-filter-menu-trigger` (JadeFlows P→W + W→C, Plants base + added) | `testIds.filterTrigger` (FilterMenu gains `triggerTestId`, default unchanged) |
| G15 | Footer note below a table (`CostSummaryTab.tsx:769-774` bands note) | `footer` (inside the root, after the pager) |
| G16 | Editable cells hold per-row draft state reconciled during render (`WarehouseTable.tsx:52-98`, `CustomerTable.tsx:47-132`, `CustomersTab.tsx:182-204`) | No new prop: `cell()` returns a component element (e.g. `<DemandCell row={r} />`); rows are keyed by `rowKey`, so the component's state survives re-renders. Recorded so P4 does not try to put draft state in the adapter |
| G17 | `ctx.demandEditable` (Brazil) applies to **base** rows only (`CustomersTab.tsx:80-83`) | No new prop: the demand cell checks `ctx.isAdded(row)`; `ctx` stays table-wide |
| G18 | Row testid ≠ row key (`jade-flow-pw-row-{a}-{b}` vs key `a\|b`, `JadeFlowsTab.tsx:448,488`) | `testIds.row` is an explicit function; nothing is derived from `rowKey` |
| G19 | Banners and loading/error screens (`distances-reference-error/-loading`, DeliveryCosts loading/error) and compat wrappers (`distances-reference-section`) | Out of the shell by design: the adapter renders them around `<DataTable>` |

**Not expressible, by design (behaviour the spec changes):** the always-on pagers (#10, #12, #14) — B2.2 shows the pager only above 50 filtered rows; the F/T boxes (#10, #11, #13, #14) — removed; the second, independent Plants-added FilterMenu (#26) — B2.2 shares one menu across sections; DeliveryCosts' base-then-added slicing is preserved by `rows` order.

## 5. Behaviour changes and open questions for P3/P4

**Behaviour changes the spec mandates (record each in the changelog when its table migrates):**
1. **Filter menus appear on tables that have none today** — every table with > 10 effective rows, on every model. Today only JADE opts in for OpenWarehouses (`Workspace.tsx:4129`), Warehouses (`:3501`) and Customers (`:3644`); Refineries, Mines, Stations, Assignments, Flows and CostSummary have none. `workspace-fixups-2.spec.ts:255` asserts **zero** filter triggers on the 26-row non-JADE warehouses tab and must be rewritten in that commit.
2. **Pagers disappear at ≤ 50 rows** (#10, #12, #14). "Page 1 of 1" assertions break by design: `bundle5-homepage-distances.spec.ts:212`, plus the pager cases in `__tests__/DistancesTab.test.tsx` (:361-367, :1112-1209).
3. **F/T boxes become FilterMenu text controls.** FilterMenu emits `input-filter-{columnId}`, so a column with id `from`/`to` and **text** type re-emits the literals `input-filter-from`/`-to` — but inside the popover, so specs must open `button-filter-menu-trigger` first. Auto-derivation turns a ≤ 20-distinct text column into a `select`, so adapters that want the literal kept set `filter: "text"` explicitly. Spec lines that `.fill()` those boxes: `bundle5-homepage-distances.spec.ts:189,211`, `bundle6.1-legend-distances.spec.ts:250-251`, `chen-bands-units-qa.spec.ts:439-440`, `delivery-teaching.spec.ts:242-243`, `max-coverage.spec.ts:373,377`.
4. **Column ids must equal today's descriptor keys** wherever e2e selects a filter control by key: `band` (`workspace-fixups.spec.ts:340,415`; `workspace-fixups-2.spec.ts:546`), `plant` (`jade-ch9-workspace-bundle.spec.ts:494`), and the JADE warehouse status option value `Fixed-Open` (`jade-ch9-workspace-bundle.spec.ts:520`, so that `value()` returns the label).
5. **Auto-derivation changes some filter types** unless the adapter pins them: OpenWarehouses `warehouse` (text today), JADE `warehouse` (select today even above 20 values), Customers `state` (text) vs Warehouses `state` (select), and Plant Production gains a Remaining-capacity range filter it does not have today.
6. **Numbers become centre-aligned.** Output numeric columns are right-aligned today; Plant Production is left-aligned.
7. **Focus jump** keeps today's behaviour — clear filters, then page against the now-unfiltered list (#10, #12). See the P1 plan's deviation 2.
8. **D2 is wider than the spec's citations.** No disabled prop at all today: Plants, Mines, Stations (`Workspace.tsx:3551-3558`, `3698-3729`) and six of the seven distance/cost tabs (only TransportCosts has one, `Workspace.tsx:3871`). Added-warehouse controls are `WarehousesTab.tsx:435-476` (the spec says ~433-465); customers-added `:532-569`; JADE base `CustomersTab.tsx:708-734`.
9. **Demand display gets grouping** — e2e lines that read the demand value with `Number(...)` would silently read `NaN → 0` once it shows `1,234`: `import.spec.ts:108`, `chen-bands-units-qa.spec.ts:556-572,682-686`, `max-coverage.spec.ts:292-296`. They are rewritten in the B2.9 application commit (P4). History-disabled assertions that must keep passing: `bundle2-fastfollow.spec.ts:154-157`, `chen-bands-units-qa.spec.ts:622-623`.

**Open questions (the spec does not decide them; ask before the P4 task that hits them):**
- **Q1 Station demand** (`input-station-demand-*`, `StationTable.tsx:50-62`; added `input-added-station-demand-*`): B2.9 names customer demand only. Station demand parses with `parseInt` (truncates decimals) and shows blank when not overridden. Is it in B2.9's scope?
- **Q2 Added scalar customer demand, empty field:** today it commits `0` (`CustomersTab.tsx:547-557`); `FormattedNumberInput` reports `null`, and D3 says null = clear override. For an *added* row there is no override to clear. Is empty → 0 kept for added rows?
- **Q3 "aria-label unchanged"** (B2.9): the current customer demand input has **no** `aria-label` (`CustomerTable.tsx:163-173`), so the rule has nothing to preserve. Does P4 add one (e.g. `Demand for {id}`), or leave the input unlabelled as today?
- **Q4 Plants added filter:** B2.2's single shared menu replaces two independent menus (`PlantsTab.tsx:241-245`, `:265-267`). Confirm this is wanted for Plants, where base and added have different id accessors (`name ?? id` vs `displayCode ?? id`).
