# SCND Upgrades — design

Date: 2026-10-16 · Branch: `scnd-upgrades` (worktree `/Users/shubhamkr/nos-scnd-upgrades`, base `main` @ `5ba7c4c`)

Sixteen user-requested Workspace (model page) changes, split into two bundles executed in order on one branch:

- **Bundle 1** — small UI fixes + exclusive service bands (B1.1–B1.9).
- **Bundle 2** — one shared `DataTable` component that every Workspace table is rewritten onto (B2.1–B2.9).

All paths below are under `artifacts/studio/src/` unless shown otherwise. Line numbers are as of `5ba7c4c` and are orientation only.

## Scope decisions (locked with the user)

| Topic | Decision |
|---|---|
| "Chapter 5" alignment | `delivery-teaching-us` only (plus Ch4 `max-coverage-us`) |
| Service bands | Exclusive display rows in Service Stats + Compare; reporting-only, no re-solve, `solve.py` untouched |
| Feedback icon | Homepage only (it is not on the model page today); move to bottom-right above footer |
| Table approach | **Option 1: one shared `DataTable`, every table migrated**, e2e specs rewritten alongside |
| Upload/Download scope | Every input table **except Plant Capability Matrix and JADE Transport Costs**; Delivery Costs **included** (needs new server entity). Output tables gain JSON download |
| JSON upload | Server accepts JSON natively (OpenAPI change) — one validation path |
| +Add form | Modal for **entities only** (warehouse, customer, plant, mine, station, refinery). Distance/cost tables keep inline "+ Add row". Delivery stays add-free (`fixedGeography`) |
| Filter | Every table > 10 rows, all models; replaces the ad-hoc From/To boxes |
| Paging | 50 rows; pager shown only when rows > 50 |
| Demand cell | Always formatted (`1,234`), reformats live while typing, fixed "Units" suffix |
| Column cleanup | All tables; **numbers centre-aligned** |

## Bundle 1 — small fixes + bands

### B1.1 Output Map result text
- New `components/workspace/tabs/OutputMapNarrative.tsx`, rendered below the map in `OutputMapTab.tsx`.
- Pure function `buildResultNarrative(modelId, result, unit)` in `lib/resultNarrative.ts`, one template per problem family (p-median, max-coverage, transport, two-echelon, delivery). Reads the same values the `output-map-metric-overlay` already shows (objective, weighted avg distance per leg, solve time) plus open facilities and coverage.
- Second paragraph: fixed per-model "How to read this map" text (markers, lane colours, band legend).
- **Hidden entirely when the scenario is unsolved.** When `scenario.stale`, a line "Inputs changed since this result was solved — re-run to update." is prepended.
- Testid `output-map-narrative`.
- Tests: one unit test per family on `buildResultNarrative`; one RTL test for hidden-when-unsolved and stale line.

### B1.2 Save inline with Layers (delivery-teaching-us, max-coverage-us)
- Turn on `PMedianInputMap`'s inline Save (`InputMapTab.tsx` Layers row, `ml-auto`, vertically centred) for both models; suppress the separate `workspace-toolbar-row` Save for them (`Workspace.tsx` `saveInLayersRow`/`showToolbarSave`, ~2355-2379, 3411, 3431).
- Delivery: inline Save shown despite `fixedGeography` (delivery still has saveable edits).
- Testid `button-save` preserved.

### B1.3 Solution Summary bar (`CostSummaryTab.tsx`)
- Remove "Solution Summary" and "Solution Summary — Compare" titles.
- Left: green "Compare Scenario" button (`button-toggle-compare`, uses the existing primary/success green token) shows/hides the existing checkbox picker (`cost-summary-compare-toggle-{id}` preserved). Picker starts hidden.
- Right: "Download CSV". Single mode: unchanged server export. **Compare mode: downloads the comparison table** (client-side CSV built from the rendered compare rows; filename `cost-summary-compare.csv`).

### B1.4 Remove duplicate titles
- Drop the title text equal to the tab name in `OpenWarehousesTab`, `AssignmentsTab`, `JadeAssignmentsTab`, `FlowsTab`, `JadeFlowsTab` (tab-level only), `ServiceStatsTab`. Download button stays right-aligned in the same row. JADE Flows sub-table titles (Plant→Warehouse, Warehouse→Customer) stay.

### B1.5 Sidebar auto open/close
- Lift collapsed state from `SidebarTree.tsx` (local `useState` + localStorage `nos:sidebar-collapsed`) into `Workspace.tsx` as a controlled prop pair.
- Every model-page load starts **expanded**. Remove the localStorage read/write.
- Clicking Run Optimizer (`button-run-optimizer`, when it opens `SolveDialog`) collapses it.
- Hamburger `button-toggle-sidebar` still toggles. Collapsed-rail flyout behaviour unchanged.

### B1.6 Feedback icon (`AppShell.tsx`, `FeedbackWidget.tsx`)
- Homepage hero footer only. Position bottom-right, directly above `DeveloperCredit`. Panel keeps opening upward; anchor it right so it does not overflow the viewport.

### B1.7 Output Map tooltips
- One class `nos-map-tooltip` (in `index.css`, overriding `.leaflet-tooltip` for that class): solid `--card` background, border, shadow, opacity 1.
- Applied to every Output Map tooltip in `NetworkMap.tsx` (lane tooltip `opacity 0.85 → 1`, customer/warehouse/plant marker tooltips). Input Map tooltips unchanged.

### B1.8 Rename
- Sidebar label `Capability Matrix` → `Plant Capability Matrix` (`Workspace.tsx:1277`). Ids/testids (`sidebar-input-capability-matrix`, `capability-matrix-tab`) unchanged.

### B1.9 Exclusive service bands
- Semantics: band *i* = flow with `boundary[i-1] < distance ≤ boundary[i]` (first band from 0); overflow = `distance > max boundary`. Same `≤` classification as `assignBandOrOverflow` (`lib/units/src/bands.ts`) so a lane's band row matches its map colour and table cell.
- New shared `computeExclusiveBandCoverage(edges, bands, decimals)` in `@workspace/units`, built on `assignBandOrOverflow` (single classifier; extend `bandsSingleSource.test.ts`). Returns one entry per band **plus overflow, always**. Rounding: if rounded percents do not sum to 100, the residual is absorbed by the entry with the largest share (never pushes a 0 row negative).
- Service Stats (`ServiceStatsTab.tsx` ~287-343): live rows from `computeExclusiveBandCoverage`; labels `0–200 mi`, `200–400 mi`, `> 1600 mi` (unit-aware).
- Compare (`CostSummaryTab.tsx` ~755) reads frozen cumulative `metrics.bandCoverage`: derive exclusive by successive differences, overflow = 100 − last cumulative, same residual rule. Pure helper `cumulativeToExclusive(cum)` with unit tests.
- Server export and `solve.py` cumulative fields untouched → `e2e_accuracy.py` unaffected (must still be run).
- Legacy `computeBandCoverage` in `lib/bands.ts` (exclusive, no overflow) is deleted if it has no remaining callers after this change.

## Bundle 2 — shared DataTable

### B2.1 `components/data-table/DataTable.tsx`
Props:
- `rows: T[]`, `rowKey(row)`, `testIdPrefix` (drives `{prefix}-row-{key}`, `{prefix}-page-indicator`, etc. — chosen per table to **equal the testids that table emits today** wherever one exists).
- `columns: ColumnDef<T>[]` — `{ id, header, cell(row, ctx) => ReactNode, value(row) => string | number, kind: "text" | "number" | "enum", testId?(row) }`.
- `toolbar?: { upload?, download?, add? }` (B2.3–B2.5).
- `readOnly?: boolean` — passed to `cell` ctx; editable cells disable themselves while browsing history (existing tooltip text reused).
- `emptyState?`.

Rendering: `components/ui/table.tsx` primitives; `table-layout: auto`; uniform `px-3 py-1.5`; `whitespace-nowrap` on headers; **`kind: "number"` columns centre-aligned (header and cell)**; inputs inside cells are `w-full` of their cell, no fixed widths bleeding over neighbours.

### B2.2 Filter + paging
- Filter (`FilterMenu` + `useTableFilters`, reused) shown top-right when `rows.length > 10`. Per-column filter type auto-derived: `number` → min/max; ≤ 20 distinct values → checkbox list; else text substring. Existing trigger testid `button-filter-menu-trigger` kept.
- Paging: new `usePagedRows(rows, 50)` + `TablePager` (Prev / "Page X of Y" / Next) rendered only when filtered rows > 50. Filter change resets to page 1. Replaces the four local `PAGE_SIZE = 50` implementations.
- The From/To text boxes (`input-filter-from/to` in DistancesTab, LegDistancesTab, LaneCostsTab, DeliveryCostsTab) are removed; FilterMenu covers from/to/distance/cost columns.

### B2.3 Upload ▾ (CSV / JSON)
- Dropdown → opens existing `ImportDialog` with chosen format; preview/apply/all-or-nothing flow unchanged. File accept switches to `.json,application/json` for JSON.
- Expected-fields panel inside the dialog: field, type (string/number/enum values), required, example CSV header line and example JSON row.
- Tables: Warehouses/Refineries, Customers, Plants, Mines, Stations, Distances, Leg Distances, JADE Distances, Lane Costs, **Delivery Costs (new)**. Not: Plant Capability Matrix, JADE Transport Costs.

### B2.4 Download ▾ (CSV / JSON)
- Inputs: existing `useExport().download(entity, format)`; menu shows the same expected-fields panel.
- Outputs: CSV and JSON. Server-export entities (`assignments`, `openWarehouses`, `costSummary`, `serviceStats`, `flows`) already support JSON. JADE Flows P→W / W→C (today client-side CSV) and the compare cost table get client-side JSON from column `value`s.

### B2.5 Field schema single source — `lib/import-schema` (new workspace package)
- Moves `COLUMNS`, `DISTANCES_COLUMNS(_V2)`, `LANE_COST_COLUMNS`, `PLANT_CAPABILITY_COLUMNS` (`artifacts/api-server/src/services/import.ts:100-211`) into the package, each field annotated with type/required/enum. Server imports them (no behaviour change; existing import tests must stay green); studio reads them for the panel.

### B2.6 JSON import + Delivery Costs entity (contract change — one commit each, spec + regen together)
- `/scenarios/{scenarioId}/import` and `/import/apply` accept `application/json` (array of row objects keyed by the same column names). Server maps JSON rows to the same records the CSV parser yields, then the existing validator. Error shape unchanged (row index + field). Ownership filter + 404-not-403 unchanged; a test asserts non-owned → 404 for the JSON path.
- `deliveryCosts` added to import and export entity unions: TS union, OpenAPI enum, regenerated client — **one task** (CLAUDE.md closed-union rule). Column set grounded at plan time from delivery's inputs schema.

### B2.7 +Add {Entity} modal
- Warehouses / Customers: reuse `CreateEntityDialog` (`components/workspace/map/dialogs/`). Plant / Mine / Station / Refinery: same dialog with a per-entity field config (refinery: no capacity; plant: no value/status; mine: capacity; station: demand).
- Replaces the inline add rows for those six entities. Submit writes through the same `onAdded*Change` handlers. Delivery shows no +Add.
- Existing `button-add-{entity}-row` testids kept on the trigger; form fields use the dialog's `create-entity-*` testids (sibling e2e rewritten).

### B2.8 Demand cell — `FormattedNumberInput`
- Displays `toLocaleString("en-US")` with commas, reformats on every keystroke preserving caret position relative to digits, fixed "Units" suffix inside the cell, emits a plain number (`onChange(number)`), rejects non-digits, min 0. Applied to base, added, and JADE per-product demand. Disabled rules (Brazil `!demandEditable`, history) unchanged. Testids `input-customer-demand-*` kept. Unit tests: caret, paste, empty, max-safe.

### B2.9 Migration order (one table per commit)
1. `DataTable` + `usePagedRows` + `TablePager` + `FormattedNumberInput` with their own tests, no consumers.
2. Read-only outputs: OpenWarehouses, Assignments, Flows, CostSummary (single + compare), ServiceStats Plant Production, JadeAssignments, JadeFlows ×2.
3. Distance/cost inputs: Distances, LegDistances, JadeDistances, LaneCosts, DeliveryCosts, TransportCosts, CapabilityMatrix.
4. Entity inputs: Warehouse (base + added), Customer (base + added + JADE per-product), Plants, Mines, Stations.

Each commit: migrate → grep `artifacts/studio/e2e/` for every testid/visible string it changed → rewrite those specs in the same commit → run affected specs locally (`E2E_BASE_URL` set) → unit gate.

## Risks and mitigations
- **e2e breakage (largest)** — preserve testids via `testIdPrefix`/`testId`; per-commit e2e sweep; full local `pnpm e2e:gate` before merge. Known affected specs listed in exploration (filters, import/export, add-row, pagination, demand, cost-summary, sidebar, bands, capability matrix, feedback, output map, save row).
- **Editable-cell regressions** (history read-only, Brazil demand lock, override highlighting) — RTL test per migrated input table covering read-only + one edit round-trip.
- **Band numbers change for students** — display-only; cumulative export unchanged; changelog notes the semantic change.
- **Contract drift** — JSON import and `deliveryCosts` each ship spec + regenerated client in one commit; contract tests pin to constants, use a populated row.
- **Import schema move** — existing import tests are the regression net; no column changes.
- **Load flakes** — check `docs/superpowers/flake-registry.md` before treating failures as regressions.

## Verification gate (every task)
`pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`, plus `python3 e2e_accuracy.py` after B1.9, plus affected Playwright specs; full `E2E_BASE_URL=… pnpm e2e:gate` and a real-browser QA pass (qa-sdet) before merge.

## Out of scope
Input Map tooltips; changing band boundaries or the editor; adds for delivery; upload/download for Plant Capability Matrix and Transport Costs; server/`solve.py` band computation.
