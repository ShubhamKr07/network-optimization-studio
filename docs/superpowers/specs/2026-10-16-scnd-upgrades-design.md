# SCND Upgrades — design

Date: 2026-10-16 · Branch: `scnd-upgrades` (worktree `/Users/shubhamkr/nos-scnd-upgrades`, base `main` @ `5ba7c4c`)
Revision 2 — folds the Codex reviews (Bundle 1 medium, 13 findings; Bundle 2 deep, 18 findings; model `gpt-5.6-luna`).

Sixteen user-requested Workspace (model page) changes, split into two bundles executed in order on one branch:

- **Bundle 1** — small UI fixes + exclusive service bands (B1.1–B1.9). One implementation plan.
- **Bundle 2** — one shared `DataTable` rendering shell that every Workspace table is rewritten onto (B2.1–B2.10). Executed as **four phases, each with its own implementation plan** (P1 shell, P2 API/schema, P3 outputs, P4 inputs/modals), because a single plan is too large to verify.

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
| +Add form | Modal for **entities only** (warehouse, customer, plant, mine, station, refinery). Distance/cost tables — **including Delivery Costs** — keep their inline "+ Add row". Delivery gets no *entity* adds (`fixedGeography`) |
| Filter | Every table > 10 rows, all models; replaces the ad-hoc From/To boxes |
| Paging | 50 rows; pager shown only when filtered rows > 50 |
| Demand cell | Always formatted (`1,234`), reformats live while typing, fixed "Units" suffix |
| Column cleanup | All tables; **numbers centre-aligned** |

### Decisions taken while folding the reviews (flagged to the user)
- **D1 Delivery Costs export/import is sparse** — only overridden pairs, exactly like `distances`/`laneCosts` (`templates.ts:887`). Not the full 33×313 matrix.
- **D2 History read-only becomes uniform** — JADE per-product demand/status and added-warehouse/added-customer controls are disabled while browsing history too (today they are not, `CustomersTab.tsx:115-123`, `WarehousesTab.tsx:433-465`). Treated as a bug fix.
- **D3 Demand keeps today's numeric semantics** — finite non-negative decimals allowed (manifest type is `number`); empty clears the override.
- **D4 Refinery add trigger keeps `button-add-warehouse-row`** (existing literal, `WarehousesTab.tsx:543`); no testid rename.
- **D5 Stale Output Map shows no narrative** — the existing parent `StaleOutputBanner` gate (`Workspace.tsx:3927-3935`) is kept.
- **D6 Legacy `computeBandCoverage` is kept** — the legacy `Studio.tsx:36,1751` still calls it.

## Bundle 1 — small fixes + bands

### B1.1 Output Map result text
- New `components/workspace/tabs/OutputMapNarrative.tsx`, rendered below the map inside `OutputMapTab.tsx`. Testid `output-map-narrative`.
- Rendered only when `OutputMapTab` renders a result. Unsolved → nothing. Stale → the parent gate already shows `StaleOutputBanner` instead of the tab (D5), so no narrative.
- Pure `buildResultNarrative(modelId, result, unit)` in `lib/resultNarrative.ts`, backed by a **per-family adapter** that reads each family's real fields:

| Family (models) | Open facilities | Coverage / service | Distance |
|---|---|---|---|
| p-median (`p-median-us`, `p-median-brazil`) | `details.openWarehouseIds` → "warehouses" | band coverage (exclusive, B1.9) | weighted avg |
| transport (`transport-coal`) | none narrated as "warehouses"; narrate mines → stations flows | band coverage | weighted avg |
| max-coverage (`max-coverage-us`) | `details.openWarehouseIds` | `details.coveragePct` / `coveredDemand` | weighted avg |
| delivery (`delivery-teaching-us`) | `details.openWarehouseIds` | band coverage; no capacity/utilisation text | weighted avg |
| two-echelon (`two-echelon-gold-au`, `two-echelon-jade-us`) | `metrics.openFacilityIds` (plants/refineries + warehouses) | per-leg band coverage | `avgDistanceByLeg` per leg |

  Missing field → that sentence is omitted, never invented. Objective + solve time from the same source as `output-map-metric-overlay`.
- Second paragraph: fixed per-model "How to read this map" text (markers, lane colours, band legend).
- Tests: one adapter/narrative unit test per family using a populated fixture taken from a real solver output shape; one RTL test for unsolved → hidden.

### B1.2 Save inline with Layers (delivery-teaching-us, max-coverage-us)
- Split the `fixedGeography` flag's two meanings in `InputMapTab.tsx` (~1039-1052): **geometry editing disabled** (kept for delivery) vs **inline Save allowed** (now allowed for delivery, which has real status/demand edits wired at `Workspace.tsx:3394-3411`).
- Max-coverage: `showInlineSave` true (was `false`, `Workspace.tsx:3425-3431`).
- For both, suppress the separate `workspace-toolbar-row` Save (`saveInLayersRow`/`showToolbarSave`, ~2355-2379). Inline Save sits at the right of the Layers row, vertically centred with the checkboxes. Testid `button-save` preserved.
- e2e: `max-coverage.spec.ts:356-367` and the delivery Save assertions rewritten to scope `button-save` within `pmedian-map-toolbar`.

### B1.3 Solution Summary bar (`CostSummaryTab.tsx`)
- Remove "Solution Summary" and "Solution Summary — Compare" titles.
- Left: green "Compare Scenario" button (`button-toggle-compare`, existing success/primary green token) shows/hides the existing checkbox picker (`cost-summary-compare-toggle-{id}` preserved). Picker starts hidden; it opens automatically if 2+ scenarios are already selected.
- Right: "Download CSV". Single mode: unchanged server export. **Compare mode: downloads the comparison table** via pure `buildCompareCsv(rows, scenarios)`:
  - Columns: `metric`, then one column per compared scenario in the on-screen order (header = scenario name).
  - Rows: exactly the metric rows the compare table renders (cost lines, coverage, max-coverable demand, JADE rates, facilities, runtime, quality, exclusive band rows), in on-screen order; a row absent for a scenario is an empty cell (the on-screen `—` is display-only).
  - Values are raw numbers (no currency/thousands formatting); units go in the metric label (e.g. `Avg distance (mi)`).
  - Filename `cost-summary-compare.csv`. Built from the same row model the table renders, not DOM text.
  - Test: mixed optional rows + scenarios with differing band sets.

### B1.4 Remove duplicate titles
- Drop the title equal to the tab name in `OpenWarehousesTab.tsx:202`, `AssignmentsTab.tsx:171`, `JadeAssignmentsTab.tsx:303`, `FlowsTab.tsx:113`, `JadeFlowsTab.tsx:396` (tab-level only), `ServiceStatsTab.tsx:298`. Download stays right-aligned in the same row. JADE Flows sub-table titles stay.

### B1.5 Sidebar auto open/close
- `SidebarTree.tsx` becomes **controlled for collapsed state only** (`collapsed`, `onCollapsedChange` props); flyout and interacting-row state stay internal. Remove the `nos:sidebar-collapsed` localStorage read/write (~80-100, 204-216).
- `Workspace.tsx` owns `sidebarCollapsed`, initialised `false` on Workspace mount (every model-page load, including model switches that remount).
- The Run Optimizer click handler (~2883-2888) sets it `true` when it opens `SolveDialog`.
- Hamburger `button-toggle-sidebar` still toggles.
- Tests rewritten: `SidebarTree.test.tsx:195-217` (localStorage) → controlled-prop tests; `sidebar-rail.spec.ts:65-139` (collapsed-by-default + persistence) → expanded on load, collapsed after Run Optimizer, not persisted across reload.

### B1.6 Feedback icon (`AppShell.tsx:110-124`, `FeedbackWidget.tsx:68-75`)
- Homepage hero footer only. Replace the centred launcher (`left-1/2 -translate-x-1/2`) with right alignment in the footer wrapper, directly above `DeveloperCredit`. Panel keeps opening upward, anchored right, width constrained to viewport.
- `feedback.spec.ts`: add a layout assertion (button's right edge within 32 px of viewport right; button bottom above `DeveloperCredit` top).

### B1.7 Output Map tooltips
- New `.leaflet-tooltip.nos-map-tooltip` rule in `index.css`: solid `hsl(var(--card))` background, `--border` border, shadow, opacity 1.
- `className: "nos-map-tooltip"` on exactly the four Output Map tooltip sites in `NetworkMap.tsx` (lane ~738-749 with `opacity 0.85 → 1`; customer ~801; warehouse ~848; plant ~866). Not added to `InputMapTab.tsx:2093` or `EntityMarkers.tsx:232-280`.
- Test: RTL/DOM assertion that each Output Map tooltip carries the class and opacity 1.

### B1.8 Rename
- Sidebar label `Capability Matrix` → `Plant Capability Matrix` (`Workspace.tsx:1277`). Ids/testids unchanged; e2e text assertions (e.g. `workspace-fixups.spec.ts:246-283`) updated.

### B1.9 Exclusive service bands
**Semantics.** Band 0 = `0 ≤ d ≤ b[0]`; band *i* = `b[i-1] < d ≤ b[i]`; overflow = `d > b[max]`. Classification is **always** `assignBandOrOverflow` (`lib/units/src/bands.ts:20-25`) so rows match map colours and table cells.

**Live helper.** New `computeExclusiveBandCoverage(edges, bands, decimals)` in `@workspace/units`, distinct from `computeCumulativeBandCoverage` (which is left unchanged — server export still uses it).
- Returns one row per sorted boundary **plus an overflow row, always**.
- Total flow 0 → every row 0 (no residual applied).
- Algorithm: raw exclusive % per row → round to `decimals` → residual `100 − Σ` added to the row with the largest positive share (ties → lowest band). A 0 row never receives residual.
- `decimals`: delivery 2, all other models 0 — same precision the models use today.
- Tests: zero-distance edge lands in band 0; boundary-equal distance lands in the lower band; overflow present at 0; residual sums to exactly 100; all-zero flow. Extend `bandsSingleSource.test.ts` to pin the helper to `assignBandOrOverflow`.

**Compare helper.** Pure `cumulativeToExclusive(bandCoverage, decimals)` for frozen `metrics.bandCoverage`:
- `bandCoverage` absent/empty → returns `null`; compare renders no band rows for that scenario (empty CSV cells).
- Drop rows with `band === OVERFLOW_BAND (-1)` before differencing (delivery/JADE/two-echelon emit an explicit `-1` row, `solve.py:1072-1076, 1401-1406, 1842-1845`); never treat `-1` as a boundary.
- Sort by boundary; exclusive[i] = cum[i] − cum[i-1] (cum[-1] = 0); negative differences (non-monotonic rounded data) clamp to 0; overflow = max(0, 100 − cum[last]).
- Then the same round + residual rule as the live helper.
- Max-coverage's two-row `[highService, 100%]` shape works through the same path.
- Fixtures: p-median integer, delivery 2-dp with `-1` row, JADE with `-1` row, max-coverage two-row, absent coverage.

**Display.** Service Stats (`ServiceStatsTab.tsx:287-343`) and Compare (`CostSummaryTab.tsx` ~755) labels: `0–200 mi`, `200–400 mi`, `> 1600 mi` (unit-aware).

**Untouched.** `solve.py`, server exports, legacy `computeBandCoverage` (D6). `e2e_accuracy.py` must still be run.

## Bundle 2 — shared DataTable

### B2.1 `components/data-table/DataTable.tsx` — rendering shell + per-table adapters
One shared shell; each table supplies an **adapter** (column list + row pipeline + testid map). Specialised grids keep their domain logic in their adapter rather than forcing it into the column abstraction.

Props:
- `rows: T[]` (already-effective rows — see B2.2 pipeline), `rowKey(row) => string` (composite keys allowed, e.g. `${fromId}|${toId}`).
- `columns: ColumnDef<T>[]`:
  - `id`, `header`, `kind: "text" | "number" | "enum"`
  - `cell(row, ctx) => ReactNode` — may render nested elements carrying any number of their own testids
  - `value(row) => string | number | null` — raw value for filtering and client export
  - `filter?: false | "text" | "select" | "range"` — overrides auto-derivation
  - `cellTestId?(row) => string`
- `testIds: { table?, row?(row), pager?, pageIndicator?, filterTrigger? }` — **explicit literal mapping per table**, no auto-generated prefixes. Each adapter maps to the testids that table emits today (inventory in the migration matrix, B2.9).
- `rowClassName?(row, ctx)` — for override/changed/added highlighting (amber rows in Distances/LaneCosts/DeliveryCosts today).
- `ctx: CellContext` passed to `cell`/`rowClassName`: `{ readOnly, demandEditable, isOverridden(row), isChanged(row), isAdded(row) }`.
- `toolbar?: { upload?, download?, add?, extra? }` (B2.3–B2.6), `emptyState?`, `sections?` (base rows + added rows rendered as two titled groups under one toolbar, where a tab has both today).

Rendering: `components/ui/table.tsx` primitives; `table-layout: auto`; uniform `px-3 py-1.5`; `whitespace-nowrap` headers; **`kind: "number"` header + cell centre-aligned**; cell inputs `w-full`; no fixed widths.

`readOnly` (history browsing) applies to **every** editable cell in base, added, and JADE rows (D2).

### B2.2 Row pipeline, filter, paging
**Pipeline (fixed order).** Adapter derives effective rows (base ⊕ saved overrides ⊕ current edits ⊕ added rows, retaining inactive rows that carry overrides — as `DistancesTab.tsx:390-403` does today) → filter → clamp page → slice 50.
- Filter change or row-set identity change resets to page 1; a page beyond the end clamps to the last page.
- Newly added rows append after base rows.
- Existing focus-jump behaviour (`DistancesTab.tsx:455-467`, `JadeDistancesTab.tsx:441-505`) is preserved: jump-to-row computes its page against the **filtered** list and navigates there.

**Filter** (`FilterMenu` + `useTableFilters`, reused) top-right when effective rows > 10. Descriptors are generated from `columns`; precedence:
1. explicit `filter`
2. `kind: number` → range
3. `kind: enum` → select
4. `kind: text` → select if ≤ 20 distinct non-null values, else text

`null`/`NaN` values match only an "(empty)" select option and are excluded from ranges. Filtering uses `value()`, never display text. Descriptor ids = column ids (stable). Base and added sections share one menu. Trigger testid `button-filter-menu-trigger` kept. The four From/To boxes (`input-filter-from/to` in Distances, LegDistances, LaneCosts, DeliveryCosts) are removed.

**Paging.** `usePagedRows(rows, 50)` + `TablePager` (Prev / "Page X of Y" / Next), rendered only when filtered rows > 50 (Delivery's always-on pager, `DeliveryCostsTab.tsx:427-451`, changes accordingly). Replaces the four local `PAGE_SIZE = 50` implementations. Pager/indicator testids mapped per table (e.g. `delivery-costs-page-indicator`, `jadeassignments-page-indicator` kept).

### B2.3 Upload ▾ (CSV / JSON)
- Dropdown → existing `ImportDialog` with chosen format; preview / apply / all-or-nothing flow unchanged. File accept `.csv,text/csv` or `.json,application/json`. Client guard: file > 2 MB rejected before upload with the limit named.
- Expected-fields panel (from `@workspace/import-schema`): CSV header / JSON key, type, required (add vs update), enum values, numeric bounds, unit, example CSV header line + example JSON envelope.
- Tables: Warehouses/Refineries, Customers, Plants, Mines, Stations, Distances, Leg Distances (two-echelon-gold-au), JADE Distances (same API entity `legDistances`), Lane Costs, **Delivery Costs**. Not: Plant Capability Matrix, JADE Transport Costs.

### B2.4 Download ▾ (CSV / JSON)
- Inputs: existing `useExport().download(entity, format)` (server; JSON = existing envelope). Same expected-fields panel.
- Outputs, server-exported (`assignments`, `openWarehouses`, `costSummary`, `serviceStats`, `flows`): CSV + JSON via the server.
- Outputs, client-built (JADE Flows P→W and W→C, Cost Summary compare): typed row builders, not rendered column values:
  - JADE Flows: `{ plantId|warehouseId, toId, product, flow, distance }` with distance in the active unit and `unit` in the envelope.
  - Compare: same row model as B1.3's CSV.
  - JSON shape `{ entity, unit?, rows }`; filenames `jade-flows-plant-warehouse.{csv,json}`, `jade-flows-warehouse-customer.{csv,json}`, `cost-summary-compare.{csv,json}`.
  - Scope = all rows (not filtered/paged), matching server exports.

### B2.5 `lib/import-schema` — field schema single source (new workspace package)
**Content.** Per entity, ordered fields:
- `csvHeader`, `jsonKey` (`from_id` ↔ `fromId`)
- `type`, `nullable`, `requiredForAdd`, `requiredForUpdate`
- `enum?`, `min?`/`max?`, `unitFamily?`
- `example`, `models` (applicability)

Carries version families (distances v1/v2, `DISTANCES_COLUMNS(_V2)`, `LANE_COST_COLUMNS`, `PLANT_CAPABILITY_COLUMNS`, `COLUMNS` from `artifacts/api-server/src/services/import.ts:100-211`) and the blank-id = add-mode rule. Header matching stays exact.

**Wiring** (one task):
- `lib/import-schema/{package.json, tsconfig.json (composite), src/index.ts, src/__tests__}`
- references added to root `tsconfig.json`, `artifacts/api-server/tsconfig.json`, `artifacts/studio/tsconfig.json`
- `"@workspace/import-schema": "workspace:*"` in both packages; lockfile updated
- the Dockerfile and `render.yaml` build follow workspace dependency edges — verify with `pnpm --filter api-server... build` and `pnpm --filter studio... build`, plus a local Docker build of `nos-api`

Server switches to importing it with **no column change**; existing import tests are the regression net.

### B2.6 JSON import contract (one task: spec + Orval regen in one commit)
**Request.** Body stays `application/json`. `ImportRequest` becomes `oneOf`:
- `{ entity, format: "csv", csvText }` — today's shape; `format` optional, defaults to `csv` for backward compatibility
- `{ entity, format: "json", document }`, where `document` is the **same envelope the JSON export emits**: `{ templateVersion, entity, unit?, rows }` with JSON keys. An exported JSON file round-trips unchanged.

**Validation.** Server maps `document.rows` to the same internal records the CSV parser yields, then the existing validator.
- `document.entity` must equal `entity`; `templateVersion` must be supported.
- Unknown keys → error; duplicate ids → existing duplicate rule.
- Malformed JSON → 400 with `errorClass: "malformed"`.

**Errors.** `ImportError` gains optional `rowIndex` (0-based, JSON) and `field`; CSV keeps `line`. Preview and all-or-nothing apply return the same error envelope; the current 422 `{ error, preview }` on apply (`scenarios.ts:1743-1750`) is documented in OpenAPI as-is.

**Limits.** `express.json({ limit: "2mb" })` (today's default is 100 kb, `app.ts:68`); over-limit → 413 `{ error: "payload_too_large" }`, documented. Max rows 20,000 per import.

**Ownership.** Unchanged: both routes scope by `userId`, non-owned → 404 (`scenarios.ts:1612-1615, 1696-1699`).

**Tests:**
- JSON preview + apply
- export→import round-trip with a populated row for every entity
- non-owner JSON → 404
- 413
- malformed JSON
- entity mismatch
- `format` omitted = CSV
- contract test pinned to the version constants, not literals

### B2.7 `deliveryCosts` entity (one task: closed-union change)
**Representation (D1).**
- Sparse overrides of `inputs.laneCostOverrides` (`solvers/delivery-teaching-us/manifest.json:33-43`).
- Rows `{ fromId, toId, cost }`; `cost` = billable miles, **no unit conversion and no `unit` field**. Separate metadata from transport `laneCosts`, whose cost is a geographic distance with unit conversion (`templates.ts:1171-1191`).
- Export emits only overridden pairs. Import upserts overrides, pairs must exist in the base matrix, and a row whose cost equals base removes the override.

**Change checklist:**
- OpenAPI import + export entity enums
- Orval regen (generated files never hand-edited)
- service union `services/import.ts:81-89`
- route allowlists `scenarios.ts:1603-1605, 1686-1688` and delivery model guard `scenarios.ts:1271-1305, 1634-1659`
- `ImportDialog.tsx:22-25`, `ExportEntity` (`exportEntity.ts:9`), `INPUT_ENTITIES` (`ExportContext.tsx:26-53`)
- import-schema entry
- tests + populated round-trip fixture

Delivery Costs keeps its inline "+ Add row" (`DeliveryCostsTab.tsx:224-341`); its unit tests (`DeliveryCostsTab.test.tsx:156-259`) stay.

### B2.8 +Add {Entity} modal
- Extend `CreateEntityDialog` (`components/workspace/map/dialogs/CreateEntityDialog.tsx:40-78`):
  - discriminated submit union for six kinds: warehouse, customer, plant, mine, station, refinery (role configs exist in `map/types.ts:152-245`)
  - `lat`/`lng` become **editable inputs** when opened from a table, still prefilled and read-only when opened from the map
  - per-kind fields: refinery no capacity, plant no value/status, mine capacity, station demand
- Replaces the inline add rows for those six entities only. Submit writes through the existing `onAdded*Change` handlers, with the same validation messages as the inline forms.
- Trigger testids keep today's literals: `button-add-{warehouse|customer|plant|mine|station}-row`; refinery keeps `button-add-warehouse-row` (D4). Form fields use `create-entity-*`.

### B2.9 Demand cell — `FormattedNumberInput`
- `<input type="text" inputMode="decimal">`. Displays en-US grouping (`1,234.5`) and reformats on each keystroke.
- Caret is preserved by counting significant characters (digits + decimal point) left of the caret before and after reformat.
- Paste: strips grouping commas and spaces, rejects other characters. IME composition: no reformat until `compositionend`. Select-all + type replaces. Leading zeros normalised.
- Values above `Number.MAX_SAFE_INTEGER` rejected.
- `onChange(value: number | null)`: `null` = empty = clear override (D3); negatives rejected; decimals allowed.
- "Units" is a visible suffix **outside** the input, linked via `aria-describedby`; the input's `aria-label` is unchanged.
- Applied to base, added, and JADE per-product demand. Brazil `!demandEditable` applies to base demand only (today's rule); history read-only applies everywhere (D2). Testids `input-customer-demand-*` kept.
- Tests:
  - caret mid-number
  - paste
  - empty → null
  - decimals
  - max-safe
  - IME
  - Brazil base locked vs added editable
  - history disabled for base, added and JADE

### B2.10 Migration matrix (P1-P4) — one table instance per commit
The P1 plan produces the full matrix as its first artefact. For every table instance it records:
- tab file, model gate, row source/pipeline
- filter columns, paging, upload/download entity
- add flow
- **testid map** (every current testid → new location)

Known instances:

| Phase | Tables |
|---|---|
| P1 | `DataTable`, `usePagedRows`, `TablePager`, `FormattedNumberInput`, filter derivation — own tests, no consumers |
| P2 | `lib/import-schema` (B2.5), JSON import (B2.6), `deliveryCosts` (B2.7) — server + contract only |
| P3 outputs | OpenWarehouses; Assignments; JadeAssignments; Flows; JadeFlows P→W; JadeFlows W→C; CostSummary single; CostSummary compare; ServiceStats Plant Production |
| P4 inputs | Distances; LegDistances; JadeDistances; LaneCosts; DeliveryCosts; TransportCosts; CapabilityMatrix; Warehouses base + added (incl. refineries); Customers base + added; JADE per-product customers; Plants base + added; Mines base + added; Stations base + added; then B2.8 modal + B2.9 demand |

**Excluded:** ServiceStats band bars (non-tabular divs), `ImportDialog` preview/error grids (dialog-internal, not Workspace tables).

## Risks and mitigations
**e2e breakage (largest).** Before P3, a **selector/visible-string inventory across every `artifacts/studio/e2e/*.spec.ts`** is generated and checked in to the plan.
- Each migration commit rewrites the specs its testid map touches and runs them locally with `E2E_BASE_URL` set (local two-server recipe, `artifacts/studio/e2e/CLAUDE.md`).
- `labs.spec.ts` stays excluded (dead); other known-stale specs are repaired or quarantined explicitly, never silently skipped.

**Editable-cell regressions.** Per migrated input table, an RTL test covering:
- read-only in history (base + added + JADE)
- Brazil base vs added demand
- amber override row
- one edit round-trip

**Behaviour changes users will notice:**
- band numbers (exclusive)
- history lock on added/JADE rows (D2)
- Delivery pager hidden at ≤ 50 rows
- From/To boxes replaced by the filter menu

All are recorded in the changelog.

**Contract drift.** JSON import and `deliveryCosts` each ship OpenAPI + regenerated client in one commit; contract tests pin to constants and use populated rows.

**Package wiring.** `lib/import-schema` verified through both filtered builds and a local Docker build before P3 starts.

**Load flakes.** Check `docs/superpowers/flake-registry.md` before treating failures as regressions.

## Verification gate
**Every task:**
```bash
pnpm run typecheck && pnpm --filter studio typecheck:e2e && pnpm --filter api-server test \
  && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
plus `pnpm --filter @workspace/import-schema test` once it exists.

**Contract tasks (B2.6, B2.7):** Orval regen produces no diff on re-run; route integration tests for preview/apply/404/413/round-trip.

**After B1.9 and after P2:** `python3 e2e_accuracy.py` and `python3 e2e_journey.py <BASE_URL> <section>` (delivery + transport sections).

**Before merge:**
- full `E2E_BASE_URL=… pnpm e2e:gate`
- real-browser QA pass (qa-sdet)
- local `nos-api` Docker build

## Out of scope
- Input Map tooltips
- changing band boundaries or the band editor
- entity adds for delivery
- upload/download for Plant Capability Matrix and Transport Costs
- server/`solve.py` band computation
- deleting legacy `computeBandCoverage`
