# Quick Fixes Bundle (QFX) — Design

**Date:** 2026-10-24
**Status:** approved in brainstorm (2026-10-24); awaiting written-spec review
**Scope:** 10 UI quick fixes across the Studio workspace. The items are almost entirely frontend; the single cross-layer item is QFX-7 (super-model `name` removal touches the server validator).
**Decision record:** `.lavish/quick-fixes-findings.html` (gitignored scratch — the decisions are restated normatively below; this document is the authority).

## 0. Overkill check

No new dependency. Every item reuses something already in the repo: `DataTable`, `DownloadMenu`/`useEntityFileMenus`, `superFiles.ts` (already parses CSV/XLSX for the super model), the vendored `xlsx` package (`artifacts/studio/package.json:105`), `NetworkMap`, `OptimizationParametersTab`, `metrics.bandCoverage` (already emitted by `solve.py`). No solver change, no DB schema change, no OpenAPI change. The simpler alternative considered — splitting into two bundles (global vs super-model) — adds branch/merge overhead without reducing risk, so it was rejected. Each item below fully closes its ask; none is a partial step.

## 1. Items

Each item is one task and one commit (`[QFX-n] …`). Paths are relative to `artifacts/studio/src` unless stated.

### QFX-1 — Super model: Import network + Export ▾ beside Save

- **Today:** `pages/Workspace.tsx:4522-4531` renders "Import network" plus three buttons "Export JSON" / "Export CSV" / "Export XLSX" in the page header, super model only. Save is the shared toolbar row (`Workspace.tsx:4576-4605`, gated by `showToolbarSave` at `:2435`).
- **Change:** for `super-model` only, remove both controls from the header and render them in the Save row, to the right of Save, on every super input tab that shows Save. Export becomes one dropdown button "Export ▾" with items JSON / CSV / XLSX, built on the existing `components/data-table/DownloadMenu.tsx` popover (same visual as chapter "Download ▾"). The export handler (`Workspace.tsx:2782`) is unchanged — only its trigger moves.
- **Chapter models:** unchanged (no whole-network import exists for them; not added).
- **Input Map tab:** the Save-in-Layers-row gates (`Workspace.tsx:2411-2428`) cover only p-median-us, p-median-brazil, max-coverage-us, delivery-teaching-us, transport-coal, two-echelon-gold-au and two-echelon-jade-us — not super. So super's Input Map, like its other editable tabs, uses the shared toolbar Save row (`showToolbarSave`), and one change to that row covers every super input tab. The Optimization Parameters tab is included because it shows the toolbar Save.
- **Done when:** the header has no Import/Export for super; every super input tab shows `Save · Import network · Export ▾`; each export format still downloads the same file as before.

### QFX-2 — Per-table Upload ▾ / Download ▾ on super tables; XLSX for every model

- **Today:** chapter tables get `Upload ▾`/`Download ▾` (CSV, JSON) from `components/data-table/useEntityFileMenus.tsx` + `DownloadMenu.tsx:30-33`. Upload goes to the server import endpoint as `csvText` or a JSON document (`components/ImportDialog.tsx:96-114`); download is built client-side (`lib/exportEntity.ts`). `components/workspace/super/SuperTableTab.tsx` has neither.
- **Change A — XLSX everywhere:** `DownloadFormat` gains `"xlsx"`.
  - Download: the rows `exportEntity` already builds for CSV are written as a one-sheet workbook with the vendored `xlsx` package. Same columns, same order, same header labels as the CSV.
  - Upload: the browser reads the first sheet with `xlsx` and converts it to CSV text, then calls the **unchanged** CSV import path. No server or API change. A workbook with zero sheets or an empty first sheet is rejected client-side with "The file has no data on its first sheet."
- **Change B — super tables:** each `SuperTableTab` gets `Upload ▾`/`Download ▾` (CSV / JSON / XLSX) using the same `DownloadMenu` UI. Super tables do not use the server `ImportEntity` pipeline, so the handlers are super-specific:
  - Download: one table, columns exactly as that table's entry in `lib/superFiles.ts` `SUPER_TABLE_FILES` (so a downloaded table file round-trips through the whole-network import).
  - Upload: parse with the existing `superFiles.ts` sheet parser restricted to that one table, then **replace** that table in the network document and write through the existing network route (`artifacts/api-server/src/routes/superNetwork.ts` — every table key optional). Server validation errors (e.g. demand now referencing a removed customer) surface through `describeWriteError` like every other write.
- **Done when:** every per-table menu in every model offers CSV/JSON/XLSX for both directions, and each super table can be downloaded and re-uploaded to an identical document.

### QFX-3 — Solve button at the bottom of Optimization Parameters

- **Today:** `components/workspace/tabs/OptimizationParametersTab.tsx` has no Solve button. The header "Run Optimizer" (`Workspace.tsx:4532-4540`) opens `SolveDialog.tsx` (P, gap, time limit, bands; Close/Solve). The tab already holds P, gap and time limit.
- **Change:** append a primary "Solve" button at the bottom of the Optimization Parameters tab for every model. Click calls the **same `onSolve` handler** `SolveDialog` triggers. That handler lives in `Workspace.tsx` and already does save-before-solve (`SolveDialog.tsx:108-114`: it persists a dirty draft before solving, the documented Round-2 bug fix) and hands off to `SolveProgressOverlay`. No dialog opens. No second solve path is written. The tab and the dialog edit the same `scenario.inputs` draft, so both solve with identical inputs. The header "Run Optimizer" keeps opening `SolveDialog` exactly as today (user decision).
- **Disabled states:** the button takes the same `solveBlockedReason` the dialog receives (`SolveDialog.tsx:105`) and is disabled while a solve is in flight. When `solveBlockedReason` is set, it is shown as the button's tooltip. For the super model, this is how the readiness block reaches the button; no separate readiness check is added.
- **max-coverage-us:** its params tab is also embedded inside the dialog via `paramsSlot` (`Workspace.tsx:4657-4681`). The bottom Solve button is **not** rendered in that embedded instance (the dialog has its own Solve) — only on the standalone tab.
- **Done when:** clicking the tab's Solve starts a solve job without any dialog opening, for all seven chapter models plus the super model. A dirty draft is saved first. The header path is unchanged.
- **Plan-time check:** confirm `solveBlockedReason` covers the super readiness block. If it does not, route the readiness reason into `solveBlockedReason`, the one shared input, rather than adding a check only for the tab button.

### QFX-4 — Sort by clicking a column header

- **Today:** no sorting anywhere; headers in `components/data-table/DataTable.tsx:109-121` are plain text. Filter (`components/tables/FilterMenu.tsx`) appears only above 10 rows.
- **Change:** in `DataTable`, each column header is a button that cycles **ascending → descending → off**, showing ▲ / ▼ (none when off) and `aria-sort` on the `<th>`. One sorted column at a time. Always available, at any row count.
  - Comparison: numbers numerically; strings with `localeCompare(…, undefined, { numeric: true, sensitivity: "base" })` (so `WH2` < `WH10`); blank/null last in both directions.
  - Sorting is display-only: it reorders the rendered rows after filtering and never changes the order of rows in scenario inputs or what Save writes. Row identity for edits stays the existing row key, not the display index.
  - Sort state is local component state; it resets when the tab unmounts.
  - Columns whose cell is an action (delete button, etc.) are not sortable.
- **Done when:** all 20 `DataTable` consumers sort; editing a cell in a sorted table edits the correct row.

### QFX-5 — Chapter 5: % demand within each distance band

- **Today:** the Ch.5 (`delivery-teaching-us`) single-scenario summary (`components/workspace/tabs/CostSummaryTab.tsx:540-565`) shows objective, inbound/outbound cost, weighted average distance, runtime, quality, solver. "% demand served" would always be 100% (the model has no capacity — `artifacts/api-server/src/solver/tests/test_delivery.py:228-238`), so the item is redefined (user decision) as **% of demand within each distance band**. Ch.5 has `distanceBands` (`solvers/delivery-teaching-us/manifest.json:22`) and `solve.py` already emits `result.metrics.bandCoverage`.
- **Change:** the Ch.5 single-scenario summary gains one row per band, "% demand within ≤ X mi" plus the overflow row, read from the result's own `metrics.bandCoverage`. Use the same helpers and labels the Compare view already uses (`CostSummaryTab.tsx:830-845`: `bandBoundaries`, `frozenBandCoverageToExclusive`, `exclusiveBandLabels`), so the single and compare views cannot disagree. Values are from the cached result; when `scenario.stale` the existing stale badge already applies.
- **Compare:** already renders band rows when every compared scenario shares band boundaries; the task verifies this for Ch.5 with 2+ scenarios and fixes it if Ch.5 is excluded. When boundaries differ, existing behaviour (rows omitted) stands.
- **Done when:** a solved Ch.5 scenario shows band % rows in its summary, and Compare of 2–4 Ch.5 scenarios with shared bands shows them per column.

### QFX-6 — Tab-specific "Add …" forms on super tables

- **Today:** every super table's "+ Add row" appends a blank inline row (`SuperTableTab.tsx:35-38`, `blankRow` in `superTables.tsx:73-82`: empty id, lat/lng 0).
- **Change:** each super tab's button and dialog are specific to that tab (user decision):

  | Tab | Button | Dialog fields |
  |---|---|---|
  | Products | + Add product | ID, Name |
  | Plants | + Add plant | ID, City, State, Lat, Lng |
  | Warehouses | + Add warehouse | ID, City, State, Lat, Lng, Status |
  | Customers | + Add customer | ID, City, State, Lat, Lng, Status |
  | Plant Capability | + Add capability | Plant ▾, Product ▾, Capacity, Cost per unit |
  | Demand | + Add demand | Customer ▾, Product ▾, Demand |
  | Distances | + Add distance override | From ▾, To ▾, Miles |

  - Dropdown (▾) fields list existing rows' IDs from the network document; an empty source table disables the button with "Add a {product/plant/customer} first."
  - Validation mirrors the server validator (`artifacts/api-server/src/validation/inputs/superInputs.ts`): required fields, lat −90..90, lng −180..180, numbers finite and ≥ 0, ID unique across the shared location namespace (products separately), composite pair not already present. Errors show inline; Add stays disabled until valid. Defaults: next free ID (same helper the map's `SuperEntityDialog` uses, `SuperInputMap.tsx:71`), status `active`.
  - Implementation shares one form renderer driven by a per-tab field spec (derived from `superTables.tsx` column defs plus the per-tab title/button label/validators). The renderer is internal; nothing about it is visible as "generic".
  - Add appends the row to the table's draft (same draft/Save flow as today's inline edits); no auto-save.
  - The blank-row "+ Add row" is removed.
- **Done when:** each tab's button opens its own titled form, invalid input cannot be added, and an added row appears in the table and persists after Save.

### QFX-7 — Remove `name` from plants, warehouses, customers

- **Today:** super location tables show ID, Name, City, State, Lat, Lng, Status (`superTables.tsx:20-29`). The server requires `name` (`superInputs.ts:8`, shared `loc`); files carry it (`lib/superFiles.ts:10`); the map's copy action appends " (copy)" (`lib/superNetwork.ts:103`); the samples carry it (`public/samples/super-model-*.json`). Joins use `id` only; the solver's warehouse label is `city → name → id` (`solve.py:1474`).
- **Change (one commit — crosses the server/studio contract):**
  - Server: drop `name` from the shared `loc` in `superInputs.ts`. `z.object` strips unknown keys, so stored rows and old files that still carry `name` keep validating; the key is dropped on the next write.
  - Studio: drop the Name column from the three location tables, the `LocationDraft` type and `SuperEntityDialog`, the `LOC` columns in `superFiles.ts` (export no longer writes it; import ignores a `name` column if present rather than erroring as an unknown column), and the " (copy)" name suffix (copy keeps a new ID only).
  - Samples/template JSON: remove `name` from location rows.
  - Solver: no change needed (label falls back to city then id). `solve.py:1474` keeps reading `name` as a fallback for old stored rows; not touched (hard rule #6 unaffected).
  - **Products keep `name`** — it is the product's only readable label.
- **Data compatibility:** `name` is not in the manifest's top-level `required[]` (`solvers/super-model/manifest.json:15-16`), so the WF-5 missing-required notice is unaffected; no backfill needed.
- **Done when:** no location table, form, file or sample shows/writes `name`; importing an old file with a `name` column succeeds; existing super scenarios still load, save and solve.

### QFX-8 — Output map caption: up to 5 open warehouse names

- **Today:** the shared `components/NetworkMap.tsx` has hover tooltips only (`:852-859`), no permanent labels.
- **Change:** one caption line directly above the output map, every model: `Open: <label1>, …, <label5> +N more`. Label = the same text the warehouse tooltip uses for its name part (display code/id + city). Ordering: ascending ID, numeric-aware (`localeCompare` numeric). If ≤ 5 open, all are listed and no "+N more". "+N more" is a button that expands the caption to the full list ("Show fewer" collapses it). Zero open warehouses: caption hidden.
- **Done when:** every model's output map shows the caption with correct count and expands/collapses.

### QFX-9 — Distance method: 3-way segmented control + factor Apply

- **Today:** `components/workspace/super/SuperDistancesTab.tsx:23-38`: native `<select>` (haversine / circuity / road); factor field 1–3, default 1.17, saved on blur/Enter, enabled only for circuity; "Fetch road distances" for road.
- **Change:**
  - Replace the select with a segmented control `Haversine | Circuity | Road` (radio-group semantics, `role="radiogroup"`, keyboard arrows). Selecting a segment writes `distanceMethod` to the draft immediately (same as today's select change).
  - Under Circuity: a compact factor input (width ~6ch, `step=0.001`, min 1, max 3) and an **Apply** button. Typing does not write; Apply writes `circuityFactor` rounded to 3 dp. Apply is disabled when the value is unchanged or invalid (outside 1–3, more than 3 decimals, empty); invalid shows an inline message. Blur no longer commits.
  - Road keeps the "Fetch road distances" button and its dialog. Haversine shows no extra controls.
- **Done when:** method switches via the control, the factor only changes on Apply, and values outside the server range cannot be applied.

### QFX-10 — Refined native dropdowns

- **Today:** every dropdown is a native `<select>` with ad-hoc classes and the browser arrow (`superTables.tsx:106`, `SuperDistancesTab.tsx:23`, `SuperEntityDialog.tsx:48`, `JadeDistancesTab.tsx:619`, …). `components/ui/select.tsx` (Radix) is imported nowhere.
- **Change:** one rule block in `src/index.css` on `select` (excluding `[multiple]` and `[size]` listboxes): `appearance: none`, a chevron SVG background image positioned ~0.6rem from the right edge, `padding-right` reserving that space, consistent height/border-radius/border colour from the existing theme tokens, a visible focus ring, and a dark-mode chevron colour. Remove per-file padding that fights the rule only where a select is visibly broken. The unused `components/ui/select.tsx` is left as is (out of scope).
- **Done when:** every select in the app shows the inset chevron in light and dark mode, verified in a real browser.

## 2. Testing

- **Unit/RTL (frontend-engineer):** each item's existing test file is extended; new behaviour gets a failing test first (sort cycle + stable row edits; Solve-from-tab calls the solve mutation and opens no dialog; XLSX→CSV conversion and empty-sheet rejection; super per-table round-trip download→upload yields an identical document; each Add form's validation; name-less location rows; caption ordering/“+N more”; factor Apply/disabled rules; Ch.5 band rows match the Compare helper output).
- **API (QFX-7):** the super-inputs validator accepts rows without `name` and still accepts (strips) rows with it — one populated real-shape fixture, not an empty array.
- **Solver:** untouched; `python3 -m pytest tests/ -x` and `e2e_accuracy.py` must still pass.
- **Real browser (qa-sdet):** QFX-10 and QFX-8 rest on CSS/overlay layout jsdom cannot see (`artifacts/studio/CLAUDE.md`), so they get a Playwright or manual real-browser check in light and dark mode. Plus one end-to-end pass of QFX-1/2/3/6/9 on the super model.
- **Sibling e2e specs:** before merge, grep `artifacts/studio/e2e/` for every test id/string these items change (header Export buttons, `button-import-*`/`button-export-*` items, "+ Add row", Name column, distance `<select>`, `super-model.spec.ts`) and rewrite affected specs green (root CLAUDE.md gotcha).
- **Gate:** `pnpm gate` green with zero concurrent vitest processes.

## 3. Order and dependencies

QFX-10 (global CSS) and QFX-4 (DataTable) first — they touch shared components others render. QFX-7 before QFX-6 (forms must not include Name). QFX-2 before QFX-1 (Export ▾ reuses the XLSX-capable `DownloadMenu`). QFX-3, QFX-5, QFX-8, QFX-9 are independent.

## 4. Out of scope

Whole-network import/export for chapter models; removing the `SolveDialog`; migrating to Radix `Select`; permanent marker labels on maps; product `name`; any solver or DB schema change.
