# Quick Fixes Bundle (QFX) — Design

**Date:** 2026-10-24
**Status:** approved in brainstorm (2026-10-24); Codex medium review (2026-10-24, 20 findings) and final Codex review (9 findings) folded; plan-time code findings folded (2026-10-24); product decisions L1–L3 decided 2026-10-24
**Scope:** 10 UI quick fixes across the Studio workspace. All are frontend except QFX-7, the one cross-layer item: removing `name` from super-model location rows touches the server validator.
**Decision record:** `.lavish/quick-fixes-findings.html` (gitignored scratch). The decisions are restated normatively below, and this document is the authority.

## 0. Overkill check

- **No new dependency.** Every item reuses something already in the repo:
  - `DataTable`
  - `DownloadMenu` / `useEntityFileMenus`
  - `superFiles.ts` (already parses CSV/XLSX for the super model)
  - the vendored `xlsx` package (`artifacts/studio/package.json:105`)
  - `NetworkMap`
  - `OptimizationParametersTab`
  - `resultNarrative.ts`'s open-site resolution
  - `frozenBandCoverageToExclusive`
- **No solver, DB schema or OpenAPI change.** The only server change is one Zod field (QFX-7).
- **Alternatives rejected:**
  - Two bundles (global vs super-model): more branch overhead, same risk.
  - A server table-replace endpoint for QFX-2: the per-table upload writes into the existing draft instead (§QFX-2).
- **Each item fully closes its ask.**

## 1. Items

- Each item is one task and one commit (`[QFX-n] …`). Paths are relative to `artifacts/studio/src` unless stated.
- "Draft" means the workspace's unsaved `scenario.inputs` edit buffer that the toolbar Save persists.

### QFX-1 — Super model: Import network + Export ▾ beside Save

**Today**
- `pages/Workspace.tsx:4522-4531` renders three things in the page header, for the super model only:
  - "Import network"
  - three buttons: "Export JSON", "Export CSV", "Export XLSX" (handler `:2782`)
- Save is the shared toolbar row (`Workspace.tsx:4576-4605`), gated by `showToolbarSave` (`:2435`).
- The Save-in-Layers-row gates (`:2411-2428`) cover only the seven chapter models, never super. So every super input tab uses the shared toolbar Save row, including Input Map and Optimization Parameters.

**Change** (`super-model` only)
- Remove both controls from the header.
- Render them in the toolbar Save row, right of Save, wherever `showToolbarSave` is true: `Save · Import network · Export ▾`.
- Export ▾ is one `DownloadMenu` with items JSON / CSV / XLSX. Each item calls the unchanged `:2782` handler with its format.
- Import network keeps its current dialog and behaviour.
- When browsing history (`isBrowsingHistoryNow`, read-only), Import network is hidden and Export ▾ stays visible. Export writes the latest **saved** network (`handleSuperExport`, `Workspace.tsx:2785`), not the historical entry on screen (user decision C2, 2026-10-24).
- Chapter models are unchanged.

**Done when**
- No Import/Export controls remain in the super header.
- Every super input tab shows the trio.
- Each format downloads byte-identical output to today.

### QFX-2 — XLSX in per-table menus (all models) + per-table menus on super tables

**Today**
- Chapter **input** tables have `Upload ▾`/`Download ▾` (CSV, JSON).
  - Built from `components/data-table/useEntityFileMenus.tsx` and `DownloadMenu.tsx:14-33`.
  - Uploads go to the server import endpoint as `csvText` or a JSON document (`components/ImportDialog.tsx:96-114`).
  - Downloads are **server-built**. `downloadEntityExport` calls `exportScenario` with `csv` or `json`, then saves the response (`lib/exportEntity.ts:48-61`). The server and OpenAPI support only those two formats (`artifacts/api-server/src/routes/scenarios.ts:626-627`, `lib/api-spec/openapi.yaml:733-738`). A few downloads are client-built (`contexts/ExportContext.tsx:70-118`, `lib/clientCsv.ts:30-33`).
- **Result** tables are download-only (`ExportContext.tsx:26-41`).
- `JadeFlowsTab.tsx:218-224` builds its own client-side download.
- `components/workspace/super/SuperTableTab.tsx` has no file menus.

**Change A — XLSX everywhere**
- The OpenAPI export enum stays `csv | json`; XLSX never reaches the server.
- Add `"xlsx"` to `DownloadFormat` and to every consumer of that type:
  - `DownloadMenu`
  - `exportEntity`
  - `ExportContext`
  - `clientCsv`
  - `useEntityFileMenus`
  - `JadeFlowsTab`
- **Download (no API change).** XLSX is produced in the browser from the CSV the existing route already returns:
  - Fetch the **CSV** export with the same `unit` and `runId` options. For client-built downloads, use the CSV text they already build.
  - Parse the CSV (the same CSV parser `superFiles.ts` uses) and write a one-sheet workbook with the vendored `xlsx` package.
  - Cell typing: a field becomes a numeric cell only if it matches `^-?(0|[1-9]\d*)(\.\d+)?$`. Everything else, including IDs like `007` and blanks, becomes a text cell (`t: "s"`). Text cells are never interpreted as formulas, so a value starting with `=` stays literal.
  - Filename: the CSV filename with `.xlsx`.
  - Same columns, order and header labels as the CSV
  - sheet name = the entity's file stem
  - MIME type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Upload** (input tables only). The browser reads the workbook with `xlsx`:
  - It uses the **first sheet**, converts it to CSV text, and hands that to the **unchanged** CSV import path. There is no server change.
  - Other sheets and the sheet name are ignored.
  - Errors: zero sheets → "The workbook has no sheets."; a first sheet with no header row → "The first sheet is empty."
  - Missing or unknown columns produce the existing server CSV errors.
- **Result tables stay download-only**, and gain the XLSX download.
- **Legacy `pages/Studio.tsx` is excluded.** It is dead code pending Phase D.

**Change B — super tables get Upload ▾ / Download ▾ (CSV / JSON / XLSX)**
- Same `DownloadMenu` UI. The handlers are super-specific, because super tables are not server `ImportEntity`s.
- **File formats.** Per-table columns are exactly that table's `SUPER_TABLE_FILES` entry in `lib/superFiles.ts`, so a per-table file is also a valid part of a whole-network import:
  - **CSV:** one table. The filename is ignored on upload; download is named `<table file>.csv`.
  - **XLSX:** first sheet only. The sheet name is ignored on upload; download has one sheet named `<table file>`.
  - **JSON:** an object `{ "<tableKey>": [rows] }`, the same shape as the whole-network document restricted to one key. On upload, any other key is an error: "This file must contain only <tableKey>." A bare array is rejected with the same message.
- **Parsing.** `superTableToFile` is async, because SheetJS stays lazy-loaded (`superFiles.ts:156,199`). Reuse `superFiles.ts` (`readSheet` with the table's `Col[]`). Add a `parseSuperTableFile(tableKey, file)` entry point that does not route by filename or sheet name.
- **Duplicates.** `parseSuperTableFile` rejects duplicate keys **within the file** before the Replace/Merge dialog is offered. It uses the same key rules as the server (`services/superNetwork.ts:13-35`):
  - location IDs share one namespace across plants, warehouses and customers
  - products are their own namespace
  - pair tables use `pairKey`
- **Location IDs across tables.** For Replace and Merge on a location table, a key that collides with another location table's ID is reported on Save by the server's global-uniqueness check.
- **Write semantics (decision L1).** After a file parses without errors, a dialog asks the user how to apply it. Both choices write **only the draft**; nothing is persisted until the user presses Save, which goes through the normal input-write path like any inline edit.
  - **Replace table:** the table's rows become exactly the file's rows. Rows missing from the file are removed.
  - **Merge (upsert):** a file row whose key matches an existing row overwrites that row in place. A new key is appended. Existing rows not in the file are kept. Keys are the server's `KEY` (`services/superNetwork.ts`): `id` for products and locations; `(plantId, productId)`, `(customerId, productId)` and `(fromId, toId)` for the pair tables.
  - The dialog shows the counts each choice would produce: "Replace: N rows (M removed)" and "Merge: A added, U updated, K kept". It has buttons **Replace**, **Merge** and **Cancel**. Cancel leaves the draft untouched.
  - Parse errors show in the dialog's place, and no choice is offered.
  - Per-table uploads **never** call `POST /scenarios/:scenarioId/network/import` (`routes/superNetwork.ts:32-54`). They change local draft state only (`SuperTableTab` → `updateInputsField`, `Workspace.tsx:3835-3842`). Save uses the existing whole-input PATCH (`Workspace.tsx:2134-2176`).
  - Rejected: writing through `POST …network/import?mode=replace`. It resets omitted tables to defaults and clears the road-distance cache (`routes/superNetwork.ts:54`, `roadDistances: "clear"`).
- **Validation.** Cross-table errors are reported on Save through `describeWriteError` like any other write (e.g. demand still referencing a removed customer).

**Done when**
- Every per-table menu in every model offers XLSX download.
- Every input-table Upload accepts XLSX.
- Each super table round-trips: download, then upload, gives an unchanged document. Tested for CSV, JSON and XLSX.

### QFX-3 — Solve button at the bottom of Optimization Parameters

**Today**
- `components/workspace/tabs/OptimizationParametersTab.tsx` has no solve props and no Solve button. It already edits P, gap and time limit on the same draft the dialog edits.
- The header "Run Optimizer" (`Workspace.tsx:4532-4540`) opens `SolveDialog.tsx`, which calls `onSolve={handleSolve}`.
- `handleSolve` (`Workspace.tsx:3053-3118`) does save-before-solve. It returns early when any of these is true:
  - the objective is required
  - there is no scenario
  - the user is browsing history
  - a solve is in flight
  - the solve phase is not idle
- On success it hands off to `SolveProgressOverlay`.
- `solveBlockedReason` passed to the dialog is only the max-coverage objective hint (`:4697-4698`). `SuperReadinessPanel` (`:4630-4635`) is rendered separately and does **not** block Solve today.

**Change**
- `OptimizationParametersTab` gets new props: `showSolveButton?: boolean` (default `false`), `onSolve?: () => void`, `solveDisabled?: boolean`, `solveBlockedReason?: string | null`.
- When `showSolveButton` is true, a primary "Solve" button renders at the bottom of the tab and calls `onSolve`. No dialog opens.
- The standalone Optimization Parameters tab, for every model, passes:
  - `showSolveButton`
  - `onSolve={handleSolve}`
  - `solveDisabled` = the same conditions `handleSolve` early-returns on
  - the same `solveBlockedReason` the dialog gets
- The max-coverage `paramsSlot` instance embedded in `SolveDialog` (`:4672-4675`) does **not** pass `showSolveButton`, because the dialog has its own Solve.
- When `solveBlockedReason` is non-null, it is shown under the button and the button is disabled.
- The header "Run Optimizer" keeps opening `SolveDialog` unchanged (user decision).
- **Super readiness (decision L2): block both buttons.** For the super model, `solveBlockedReason` (the single shared input) is also set from the server precheck that `SuperReadinessPanel` renders (`Workspace.tsx:1561`, `usePrecheckScenario`). The rule uses the existing dirty flag (`Workspace.tsx:1927-1930`): when the draft is **clean** and `precheck.errors` is non-empty, `solveBlockedReason` is "Fix the readiness issues before solving: " plus the first error message. This is neutral wording, because the same text also shows in `SolveDialog`, where no readiness panel sits above it. That one value disables **both** the tab Solve and the `SolveDialog` Solve, and is shown under each.
  - When the draft is **dirty**, the precheck describes the saved row rather than the draft, so it does not block. `handleSolve` saves first and the server rejects an invalid solve as it does today. Precheck refetches after the save.
  - When the precheck is loading or fails to load, it does not block.
  - The max-coverage objective hint keeps priority when both apply (only max-coverage can produce that hint, so they never collide in practice).

**Done when**
- The tab's Solve starts a solve with no dialog for all 7 chapter models plus super.
- A dirty draft is saved first (via `handleSolve`).
- The embedded max-coverage instance shows no extra button.

### QFX-4 — Sort by clicking a column header

**Today**
- No sorting exists.
- Header cells in `components/data-table/DataTable.tsx:101-121` are plain text.
- The pipeline is fixed: effective rows → filter → page clamp → slice of 50 (`:35`). Optional `sections` group rows.
- `ColumnDef` (`types.ts:17-40`) has no sort metadata.
- Super tables use the **array index** as both row key and edit identity (`SuperTableTab.tsx:18-30`, `superTables.tsx:7-8`).

**Change**
- Add `sortable?: boolean` to `ColumnDef` (default `true`). Every delete/action column sets `sortable: false`, both in `superTables.tsx:127-130` and in the chapter tabs.
- A sortable header is a `<button>` inside the `<th>`:
  - it cycles **ascending → descending → off**
  - it shows ▲ / ▼ (nothing when off)
  - it sets `aria-sort` on the `<th>`
- Only one column is sorted at a time. Sort is available at any row count.
- **Exempt:** CostSummary's transposed metric tables (single `value` column and compare scenario columns) set `sortable: false`. They are label/value tables, already exempt from Filter (spec B2.2). The user's ask covers "the needed tables". (Plan-time decision, 2026-10-24.)
- Pipeline becomes: effective rows → filter → **sort** → page clamp → slice. With `sections`, rows are sorted within each section; section order is unchanged.
- Sorting works on decorated items `{ row, originalIndex }` and never mutates or re-indexes the input array.
- Every edit, delete and row-key callback still receives the **original** index or key. This is the critical rule for super tables.
- Comparison rules:
  - Numbers compare numerically.
  - Strings use `localeCompare(a, b, undefined, { numeric: true, sensitivity: "base" })`.
  - Blank/null values go last in both directions.
  - Ties keep the original order (stable).
- A sort change resets to page 1, the same as a filter change (`pageResetKey`).
- Sort state is component-local and resets on unmount.
- Sorting never changes what Save writes.

**Done when**
- All `DataTable` consumers sort.
- Regression test: sort a super table descending, edit a cell, then delete a row. Both actions hit the intended underlying row.

### QFX-5 — Chapter 5: % demand within each distance band

**Today**
- The Ch.5 (`delivery-teaching-us`) single-scenario summary (`components/workspace/tabs/CostSummaryTab.tsx:540-565`) shows: objective, weighted average distance, runtime, quality, solver.
- The inbound/outbound cost rows are conditional on emitted metrics, and Ch.5 does not emit them.
- "% demand served" would always read 100%, because the model has no capacity (`artifacts/api-server/src/solver/tests/test_delivery.py:228-238`). The item is redefined (user decision) as **% of demand within each distance band**.
- Ch.5 has `distanceBands` (`solvers/delivery-teaching-us/manifest.json:22`). `solve.py:865-880` emits **cumulative** `metrics.bandCoverage` rows. The exclusive rows and the overflow row are derived client-side.

**Change**
- The Ch.5 single-scenario summary gains one row per band plus the overflow row.
- They are produced by **the same helpers Compare uses** (`CostSummaryTab.tsx:830-853`):
  - `bandBoundaries`
  - `frozenBandCoverageToExclusive(result.metrics.bandCoverage, bandDecimals("delivery-teaching-us"), frozenBandShape("delivery-teaching-us"))`
  - `exclusiveBandLabels`
- So single and compare views cannot disagree.
- Raw `bandCoverage` is never read directly.
- The existing stale badge applies.
- **Compare:** already renders band rows for Ch.5. The block (`CostSummaryTab.tsx:830-853`) is gated only on shared bands, never on `modelId`. Pinning tests cover 2+ shared-band Ch.5 scenarios. Differing boundaries keep today's behaviour (rows omitted).
- **Out of scope:** the single-view Download uses the server-side costSummary export, so the new band rows do not appear in the downloaded file.

**Done when**
- A solved Ch.5 scenario shows band % rows equal to Compare's for the same result.
- Compare of 2–4 shared-band Ch.5 scenarios shows them per column.

### QFX-6 — Tab-specific "Add …" forms on super tables

**Today**
- "+ Add row" appends a blank inline row: empty id, lat/lng 0 (`SuperTableTab.tsx:35-38`, `superTables.tsx:73-82`).
- `nextFreeId` (`lib/superNetwork.ts:64-68`) generates IDs only in the shared location namespace.

**Change**
- Each tab gets its own button and titled dialog (user decision).
- Fields follow the server validator (`artifacts/api-server/src/validation/inputs/superInputs.ts`). In the table below, `*` marks a required field.

| Tab | Button / title | Fields | Defaults | Button disabled when (message) |
|---|---|---|---|---|
| Products | Add product | ID\*, Name\* | ID empty (user types) | never |
| Plants | Add plant | ID\*, City, State, Lat\*, Lng\* | ID = `nextFreeId` | never |
| Warehouses | Add warehouse | ID\*, City, State, Lat\*, Lng\*, Status\* | ID = `nextFreeId`, Status `active` | never |
| Customers | Add customer | ID\*, City, State, Lat\*, Lng\*, Status\* | ID = `nextFreeId`, Status `active` | never |
| Plant Capability | Add capability | Plant\* ▾, Product\* ▾, Capacity\*, Cost per unit\* (the table column header is renamed from "Cost / unit" to match; user decision C4) | none | no plants or no products ("Add a plant and a product first.") |
| Demand | Add demand | Customer\* ▾, Product\* ▾, Demand\* | none | no customers or no products ("Add a customer and a product first.") |
| Distances | Add distance override | From\* ▾, To\* ▾, Miles\* | none | no plant→warehouse and no warehouse→customer pair possible ("Add warehouses with plants or customers first.") |

- ▾ = dropdown of existing IDs from the draft.
- In the Distances dialog, the To ▾ list is filtered by From: a plant offers warehouses, a warehouse offers customers. These are the only pairs the server accepts (`superInputs.ts:80-83`).
- Validation, mirroring the server:
  - Text is trimmed.
  - Required means non-empty after trimming.
  - Lat must be −90..90 and lng −180..180.
  - Lat and lng are signed finite numbers (no ≥ 0 rule).
  - Capacity, cost per unit, demand and miles must be finite and ≥ 0; **0 is allowed**.
  - Server limits (`superInputs.ts:4,20-27,85-86`): products 10, plants 20, warehouses 50, customers 500, and warehouses × customers × products ≤ 50,000.
    - At a table's limit, its Add button is disabled with "Limit reached: at most N <rows>."
    - An add that would push warehouses × customers × products past 50,000 shows that limit inline and cannot be confirmed.
  - IDs must be unique: across plants, warehouses and customers together, and separately among products.
  - The composite pair must not already exist (plant/product, customer/product, from/to).
- Errors show inline, and Add stays disabled until the form is valid.
- One internal form renderer is driven by a per-tab field spec. Nothing about it is user-visible as "generic".
- Add appends the row to the draft (no auto-save).
- The blank-row "+ Add row" button is removed.

**Done when**
- Each tab's button opens its own titled form.
- Invalid input cannot be added.
- An added row persists after Save.

### QFX-7 — Remove `name` from plants, warehouses, customers

**Today**
- Super location tables show ID, Name, City, State, Lat, Lng, Status (`superTables.tsx:20-29`).
- `name` is required server-side (`superInputs.ts:8`, shared `loc`).
- `name` appears in these places:
  - file columns (`lib/superFiles.ts:10`)
  - the parser, which rejects unknown columns (`superFiles.ts:53-62`), so old CSV/XLSX files are handled only by keeping `name` as a known column
  - the copy action's " (copy)" suffix (`lib/superNetwork.ts:103`)
  - `LocationDraft` (`superNetwork.ts:62`) and `SuperEntityDialog`
  - the output-dataset projection (`Workspace.tsx:698-709`)
  - `SuperInputMap.tsx:71,78`, which builds create/edit drafts with `name`
  - `scripts/build-super-sample.py:12`, which generates `super-model-sample.json`; edit the generator, then regenerate
  - the samples (`public/samples/super-model-*.json`)
  - tests: `superNetwork.test.ts:27-64`, api `superNetworkImport.test.ts:65-68`, and e2e `super-model.spec.ts:267-277, 303-304, 323-325`, which edit, persist and assert names
- Joins use `id` only.
- The solver's warehouse label is `city → name → id` (`solve.py:1474`).

**Change** (one commit, because it crosses the server/studio contract)
- **Server.** Drop `name` from the shared `loc`. `z.object` strips unknown keys, so stored rows and JSON payloads that still carry `name` keep validating, and the key disappears on the next write of that scenario. Products keep `name`.
- **Parser.** Location tables accept a legacy `name` column in CSV/XLSX and **discard** it. Any other unknown column is still an error. JSON location rows with `name` are stripped server-side as above.
- **Studio:**
  - remove the Name column from the three location tables
  - remove `name` from `LocationDraft` and `SuperEntityDialog`
  - remove `name` from the `LOC` file columns, so export no longer writes it
  - remove it from the `Workspace.tsx:698-709` projection
  - the copy action keeps the new-ID behaviour and drops the suffix
- **Samples and template:** remove `name` from location rows.
- **Tests:** update every test listed above, plus `SuperEntityDialog.test.tsx:5-35` and `SuperInputMap.test.tsx:12-16,88-107`. Then do a repo-wide search for super **location** `name` in fixtures and assertions (studio, api-server, e2e) and update every hit. Product `name` stays valid and is left untouched. Add one API test with a populated real-shape fixture that has rows without `name` and rows with `name`; both are accepted and stripped.
- **Unchanged:**
  - `solve.py` (the label falls back; hard rule #6 is unaffected)
  - solved results already stored (results are immutable snapshots)
- **Data compatibility:** `name` is not in the manifest's top-level `required[]` (`solvers/super-model/manifest.json:15-16`), so the WF-5 required-values notice is unaffected. No backfill is needed.

**Done when**
- No location table, form, export, projection or sample has `name`.
- Old CSV, XLSX, JSON and per-table files containing `name` import successfully.
- Existing super scenarios load, save and solve.

### QFX-8 — Output map caption: up to 5 open site labels

**Today**
- The shared `components/NetworkMap.tsx` uses hover tooltips only (`:852-859`).
- It reads `details.openWarehouseIds` (`:478`).
- The open-site source differs by model:
  - transport-coal's `openWarehouseIds` are mines
  - JADE's authority is `metrics.openFacilityIds`
  - super emits both
- `lib/resultNarrative.ts:115,152-172` already resolves this per model.
- When the result is unsolved or stale, the output map is replaced by a banner (`Workspace.tsx:4083-4097`).

**Change**
- **Adapter.** Extract `openSiteIds(result, modelId): string[] | null` from `resultNarrative.ts`'s existing resolution into one shared helper. `null` means the field is absent, which the narrative needs to tell apart from "opened nothing". The caption treats `null` as empty. `resultNarrative` and the caption both use it, so there is one authority.
- **Caption.** One line directly above the output map, for every model: `<Noun>: <label1>, …, <label5> +N more`.
  - Noun per model (decision L3), keyed by `modelId` in one map:
    - "Open warehouses": p-median-us, p-median-brazil, max-coverage-us, delivery-teaching-us
    - "Open mines": transport-coal
    - "Open facilities": two-echelon-gold-au, two-echelon-jade-us, super-model
    - An unknown model falls back to "Open sites".
  - Label = `displayId · ` + `formatCityState(city, state)` (`lib/formatLocation.ts:12-14`), reusing the existing formatter rather than a new one. No type prefix and no customer count. When both city and state are empty, the label is just `displayId`.
  - Order: ascending ID, numeric-aware.
  - With 5 or fewer open sites, all are listed and "+N more" is absent.
  - "+N more" is a button that expands to the full list; "Show fewer" collapses it.
- **Visibility.** The caption renders only where the map renders (not on the unsolved/stale banner) **and** only when the result shows an incumbent (`showIncumbent` in `OutputMapTab`). There is no separate failed banner, and failed results do reach the map. It is hidden when there are zero open sites.

**Done when**
- Every model's output map shows the correct caption, count and expand/collapse.

### QFX-9 — Distance method: 3-way segmented control + factor Apply

**Today**
- `components/workspace/super/SuperDistancesTab.tsx:23-38` has a native `<select>` (haversine / circuity / road).
- The factor field is a `DraftNumberInput` that writes to the draft on **every keystroke** (`entityCells.tsx:73-112`). It allows 1–3, defaults to 1.17, and is enabled only for circuity.
- Road shows "Fetch road distances".

**Change**
- **Segmented control.** Replace the select with `Haversine | Circuity | Road`. Selecting a segment writes `distanceMethod` to the draft immediately. Accessibility contract:
  - The container is `role="radiogroup"` with `aria-label="Distance method"`.
  - Each segment is a `<button role="radio" aria-checked>`.
  - Roving tabindex: only the checked segment has `tabIndex=0`; the others have `-1`.
  - ←/↑ and →/↓ move to the previous or next segment and select it, wrapping at the ends. Home and End go to the first and last segment.
  - Space and Enter select the focused segment.
- **Circuity factor.** Shown under Circuity:
  - a compact text input (~6ch, `inputMode="decimal"`) plus an **Apply** button
  - typing never touches the draft
  - Apply writes `circuityFactor` as the parsed number
  - valid input: 1 ≤ value ≤ 3 with **at most 3 decimal places**
  - more decimals is invalid (no rounding), with the inline message "Use a number from 1 to 3 with up to 3 decimals."
  - this is intentionally stricter than the server (`superInputs.ts:44-46`, any finite value 1–3); the server is unchanged
  - Apply is disabled when the input is invalid or equals the stored value
  - Enter triggers Apply; blur does nothing
  - the input re-syncs to the stored value when the draft changes from elsewhere (import, history restore)
- **Road** keeps "Fetch road distances" and its dialog. **Haversine** shows no extra controls.

**Done when**
- The method switches via the control.
- The draft changes only on Apply (test: typing causes no draft mutation).
- Out-of-range or over-precise values cannot be applied.

### QFX-10 — Refined native `<select>`s

**Today**
- Native selects use ad-hoc classes and the browser arrow, at:
  - `superTables.tsx:106` (a table-cell select)
  - `SuperDistancesTab.tsx:23` (replaced by QFX-9)
  - `SuperEntityDialog.tsx:48`
  - `JadeDistancesTab.tsx:619`
- `index.css` has no select rule.
- Radix `components/ui/select.tsx` is imported nowhere.
- Popover/menu buttons (`DownloadMenu`, `FilterMenu`) are not `<select>`s and are out of scope; they already use a lucide `ChevronDown`.

**Change**
- One rule block in `src/index.css` on `select:not([multiple]):not([size])`:
  - `appearance: none`
  - a chevron 0.6rem from the right edge, drawn as two `linear-gradient` triangles in `hsl(var(--muted-foreground))`. CSS variables do not resolve inside a `data:` SVG, and gradients follow the theme tokens with one rule.
  - background from `--background`; `bg-white` is removed from the selects that carry it, so the chevron stays visible if `.dark` is ever applied
  - The app currently has no dark-mode switch (nothing adds `.dark`). The "dark" check forces the class in the browser.
  - `padding-right: 2rem`
  - border, radius and focus ring from the existing input tokens
- Table-cell selects (`superTables.tsx:106`, `h-7`) keep their height and get the same chevron and padding.
- Remove a per-file padding class only where it overrides the rule's `padding-right`.
- Plan-time grep: find every remaining `<select` in `src/` and list it in the plan, so none is missed.
- Radix `select.tsx` is left untouched.

**Done when**
- Every native select in `src/` shows the inset chevron in light and dark mode, verified in a real browser.

## 2. Testing

- **Unit/RTL (frontend-engineer).** Write a failing test first for each:
  - sort cycle, `aria-sort`, and original-index edit/delete under sort
  - tab Solve calls `handleSolve`, opens no dialog, and is absent from the embedded max-coverage instance
  - XLSX→CSV conversion, the two workbook error messages, and per-table super round-trip (CSV/JSON/XLSX)
  - per-table JSON with a wrong key is rejected
  - L1 dialog: Replace and Merge counts and results per pair-key table; Cancel leaves the draft unchanged
  - L2: a clean draft with precheck errors disables both Solve buttons; a dirty draft does not
  - each Add form's validation, defaults and disabled-source message
  - name-less location rows and legacy `name` column import
  - caption ordering, "+N more" and `openSiteIds` per model
  - factor Apply/disabled rules, with no draft mutation while typing
  - Ch.5 band rows equal Compare-helper output
- **API (QFX-7).** The validator accepts rows without `name` and strips rows with it. Use a populated real-shape fixture, not an empty array.
- **Solver.** Untouched. `python3 -m pytest tests/ -x` and `python3 e2e_accuracy.py` must still pass.
- **Real browser (qa-sdet).** QFX-10 and QFX-8 rest on CSS and overlay layout that jsdom cannot see (`artifacts/studio/CLAUDE.md`), so they get a real-browser check in light and dark mode. Also one end-to-end pass of QFX-1/2/3/6/9 on the super model.
- **Sibling e2e specs.** Before merge, grep `artifacts/studio/e2e/` for every test id or string these items change, and rewrite the affected specs to green. That includes:
  - the header Export buttons
  - `button-import-*` / `button-export-*`
  - "+ Add row"
  - the Name column and name assertions (`super-model.spec.ts:267-277, 303-304, 323-325`)
  - the distance `<select>`
- **Gate.** `pnpm gate` is green with zero concurrent vitest processes. The local e2e gate runs as `E2E_BASE_URL=http://localhost:<studio-port> pnpm e2e:gate`; the env var is mandatory.

## 3. Per-item completion checklist

Each QFX task is done only when all of these hold:
1. It has a failing test written first, then passing.
2. It is one commit `[QFX-n] <imperative summary>` on the bundle branch, never `main`, with the `docs/CHANGELOG-implementation.md` entry in the same commit. The commit SHA is the rollback point.
3. `pnpm gate` is green.
4. The real-browser check, where §2 requires one, is done.

At bundle end:
- run `/harness-retro QFX`
- follow the root `CLAUDE.md` branch-discipline pipeline (prompt → merge → whole-branch review → push; deploy is a separate approval)

## 4. Order and dependencies

1. QFX-10 (global CSS) and QFX-4 (`DataTable`) first. They touch shared components the others render.
2. QFX-7 before QFX-2 and QFX-6. It changes the `SUPER_TABLE_FILES` location columns and the legacy `name` parsing that QFX-2's per-table parser reuses, and the forms must not include Name.
3. QFX-2 before QFX-1, because Export ▾ reuses the XLSX-capable `DownloadMenu`.
4. All tasks are sequential commits on one bundle branch, so each later task builds on the earlier ones' code. No parallel branches share the parser.
5. QFX-3, QFX-5, QFX-8 and QFX-9 are independent.

## 5. Out of scope

- whole-network import/export for chapter models
- removing `SolveDialog`
- migrating to Radix `Select`
- permanent marker labels on maps
- product `name`
- XLSX for legacy `pages/Studio.tsx`
- any solver or DB schema change
