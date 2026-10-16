# SCND Upgrades — Bundle 2 Phase P3 Implementation Plan (output tables)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, seed a TaskCreate entry per task **and** per process gate (each task's anchor re-verification, RTL run, e2e run, gate run and changelog entry; the phase-exit checks), per the standing ledger rule.

**Goal:** Move all nine Workspace output-table instances onto the shared P1 `DataTable` shell (spec B2.1/B2.2), one instance per commit (B2.10), and give every output a **Download ▾ (CSV / JSON)** control (B2.4): server-exported for `openWarehouses`, `assignments`, `flows`, `costSummary`, `serviceStats`; client-built from typed row builders for JADE Flows P→W, JADE Flows W→C and the Cost Summary compare table. Every table gets the shell's filter menu above 10 rows and its pager above 50 filtered rows, with number columns centred; every testid in the B2.10 matrix maps survives.

**Architecture:** Each output tab keeps its own row derivation (unchanged) and becomes a thin **adapter**: a memoised `ColumnDef<Row>[]` (column ids = today's filter-descriptor keys, so e2e that addresses filters by key keeps working), a literal `testIds` map, `ctx={{ readOnly: true, demandEditable: false }}`, and a `toolbar.download` slot. One new shared control, `components/data-table/DownloadMenu.tsx` (Popover-based, like `FilterMenu`), replaces every single "Download CSV" button; P4 reuses it for inputs. Client-built exports share one writer (`downloadClientExport` in Bundle 1's `lib/clientCsv.ts`) and one envelope shape `{ entity, unit?, rows }`; JADE Flows rows come from `lib/jadeFlowsExport.ts`, the compare JSON from `buildCompareJson` next to Bundle 1's `buildCompareCsv` (same row model). No server, OpenAPI, solver or DB change: the server already serves JSON for all five output entities (see grounding fact G-1).

**Tech Stack:** React 18 + TypeScript + Vite (`artifacts/studio`), Tailwind, Radix Popover (`components/ui/popover.tsx`), vitest 3 + React Testing Library 16 + `@testing-library/user-event` 14 (jsdom), Playwright e2e (`artifacts/studio/e2e`).

**Spec (source of truth):** `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` **rev 4** — §B2.1, §B2.2, §B2.4, §B2.10, "Risks and mitigations", "Verification gate". **Interfaces consumed verbatim:** `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-p1.md` (rev 4, commit `8f80d35`), section "Interfaces". **Matrix:** `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md` §2a (the nine output instance records + testid maps), §3 (e2e inventory), §4 (G1–G21), §5. **Base code:** the post-Bundle-1 state defined by `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle1.md` (SCU-1.2 exclusive band rows, SCU-1.3 Solution Summary bar + `lib/clientCsv.ts` + `lib/compareCsv.ts` + the compare row model, SCU-1.4 title removals), plus P1 and P2.

## Global Constraints

- **Workdir / branch / base:** bundle branch `scnd-upgrades` in `/Users/shubhamkr/nos-scnd-upgrades`. P3 starts only after (a) the finished Bundle 1 tip `B1_TIP` is merged into `scnd-upgrades` (P1 plan, Step L0), (b) all six `[SCU-2.P1.N]` and all three `[SCU-2.P2.N]` commits are on `scnd-upgrades`. The lead records `B1_TIP` and `P2_TIP` in Step L0 below. Each task runs in its own pre-created locked worktree (see "Execution topology"). The task's first Bash command is `cd <its worktree> && git rev-parse --abbrev-ref HEAD`; it must print `scu-2.p3.N-work`, otherwise STOP. Never touch `/Users/shubhamkr/network-optimization-studio`.
- **Base guards (every task, right after the branch check, each command alone):** `git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1` and `git merge-base --is-ancestor "$P2_TIP" HEAD || exit 1`.
- **Dependencies:** a fresh worktree has no `node_modules`. Run `pnpm install --frozen-lockfile` once in the task worktree before Step 1. pnpm only.
- **Before every `git commit`:** run `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1` **alone**, read its output, then commit **with an explicit pathspec** (`git commit <paths> -m …`). An untracked new file needs `git add <that file>` first. Never pipe a state-changing git command.
- **One task = one commit = one table instance** (spec B2.10). Message `[SCU-2.P3.N] <imperative summary>`; the body names the deviations it implements and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Changelog in the same commit (hard rule #9).** Each task appends `### SCU-2.P3.N — <title>` at the bottom of `docs/CHANGELOG-implementation.md` (under the `## SCU-B2` heading P1.1 created). Numbers come from that task's own run; anything not derivable is the literal string `unknown`. A cherry-pick conflict that is only two bottom-appended changelog blocks is resolved by keeping both, in task-id order.
- **Hard rule #12:** tasks P3.1–P3.9 are owned by **frontend-engineer** and start with Step 0: invoke `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`, via the Skill tool; the report says both ran. Review: latest Opus + `ponytail:ponytail-review`. P3.10 is **qa-sdet** (exempt from both skills; reviewed by a separate `fable` reviewer, AGENTS.md).
- **Never edit generated code** (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`). P3 needs **no** OpenAPI change (G-1). If a task seems to need one, STOP and escalate.
- **No server, solver or DB change.** `solve.py`, `e2e_accuracy.py`, `lib/db/**`, `artifacts/api-server/**` are untouched; `e2e_accuracy.py` therefore needs no P3 run (spec "Verification gate" runs it after B1.9 and after P2 only).
- **Spec values, verbatim (B2.1, B2.2, B2.4):**
  - Rendering: `components/ui/table.tsx` primitives; `table-layout: auto`; uniform `px-3 py-1.5`; `whitespace-nowrap` headers; **`kind: "number"` header + cell centre-aligned**; no fixed widths. (All of this is the shell's; adapters only choose `kind`.)
  - Filter menu top-right **when effective rows > 10** (all models); descriptors generated from `columns`; precedence explicit `filter` → `kind: number` → range → `kind: enum` → select → `kind: text` → select if ≤ 20 distinct non-null values, else text. Descriptor ids = column ids. Filtering uses `value()`, never display text. Trigger testid `button-filter-menu-trigger` kept.
  - Page size **50**; pager rendered **only when filtered rows > 50**; Prev / "Page X of Y" / Next; pager/indicator testids mapped per table (`jadeassignments-page-indicator` kept).
  - Outputs, server-exported (`assignments`, `openWarehouses`, `costSummary`, `serviceStats`, `flows`): CSV + JSON via the server (`useExport().download(entity, format)`).
  - Outputs, client-built (JADE Flows P→W and W→C, Cost Summary compare): **typed row builders, not rendered column values**. JADE Flows: `{ plantId|warehouseId, toId, product, flow, distance }` with distance in the active unit and `unit` in the envelope. Compare: same row model as B1.3's CSV. JSON shape `{ entity, unit?, rows }`; filenames `jade-flows-plant-warehouse.{csv,json}`, `jade-flows-warehouse-customer.{csv,json}`, `cost-summary-compare.{csv,json}`. **Scope = all rows (not filtered/paged)**, matching server exports.
  - `ctx` is required; output adapters pass `{ readOnly: true, demandEditable: false }` (P1 adapter rules).
- **Gate (every task, verbatim from the spec; scripts verified: root `package.json:10` `typecheck`, `artifacts/studio/package.json:11` `typecheck:e2e`, `:12` `test`, `artifacts/api-server/package.json:12` `test`):**
  `pnpm run typecheck && pnpm --filter studio typecheck:e2e && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
  plus `pnpm --filter @workspace/import-schema test` (P2 created that package). Run each command separately and judge it by its own exit status. Before trusting a full suite, run `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); [ "$cnt" = "0" ]` alone; never chain it with `&&`.
- **Local DB:** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` inline on every command that needs it (`api-server test`, the api dev server). `nos_dev` is shared with other sessions.
- **Local e2e (every task's e2e step; `artifacts/studio/e2e/CLAUDE.md` recipe).** Task N uses api port `3100+N` and studio port `5200+N` (P3.10 uses 3110/5210). From the task worktree, each server in the background:
  - `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=310N pnpm --filter api-server run dev`
  - `PORT=520N BASE_PATH=/ API_PROXY_TARGET=http://localhost:310N VITE_POSTHOG_KEY=phc_local_dummy_key VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 pnpm --filter studio run dev`
  - then, from `artifacts/studio`: `E2E_BASE_URL=http://localhost:520N pnpm exec playwright test <specs>`. **`E2E_BASE_URL` is never optional** — without it Playwright silently tests a remote Replit deployment. Stop both servers when the step ends. If a server cannot start, record `e2e: not run — <reason>, deferred to SCU-2.P3.10` in the changelog; never claim green.
- **Flakes:** before calling a failure a regression, check `docs/superpowers/flake-registry.md` by test **name** and re-run the failing file twice in isolation. Record any new sighting there.
- **Every `Expected:` count below is provisional.** The code blocks were compiled (`tsc --noEmit`, exit 0, both `tsconfig.json` and `tsconfig.e2e.json`) and run under vitest in a scratch copy of `artifacts/studio` at `5ba7c4c` with the **committed P1 rev-4 code** (byte-identical `types.ts`, `DataTable.tsx`, `usePagedRows.ts`, `deriveFilterDescriptors.ts`, `TablePager.tsx`) and a **simulated Bundle 1** (SCU-1.4 title removals and tests; SCU-1.3's `lib/clientCsv.ts`, `lib/compareCsv.ts`, CostSummary bar + compare row model and its tests, copied verbatim from the Bundle 1 plan; SCU-1.1 helpers stubbed with the Bundle 1 plan's code). Real Bundle 1 output may differ in detail; Step 1 of every task re-verifies the anchors this plan edits, and an observed count that differs is recorded, not argued with.
- **No merge, no push, no deploy.** Bundle 2 continues on this branch (P3 → P4).

## Grounding facts and deviations (read before any task)

Each deviation is the smallest correct reading where spec text and repo disagree, or where the spec leaves a choice open (hard rule #8). The commit implementing it names it in its body. **Items marked (Q) are also open questions for the user** (see the end of this plan); the plan proceeds with the stated default until answered.

- **G-1 Server JSON export already exists for all five output entities — no contract change.** `routes/scenarios.ts:622-625` accepts `format` `csv|json` for every entity; the JADE branch emits JSON at `:809-813`, the generic branch at `:837-869`; OpenAPI `exportScenario` declares `format: enum [csv, json]` (`lib/api-spec/openapi.yaml:523-528`) and `application/json` → `ExportEnvelope` (`:560-562`); covered by `__tests__/routes.test.ts:2098-2404` and `__tests__/solveExportIntegration.test.ts:90-97`. The studio already forwards `format` (`lib/exportEntity.ts:51-62`, `contexts/ExportContext.tsx:106-119`); the JSON file name is `${entity}.json`.
- **G-2 Bundle 1 changed every P3 file.** SCU-1.4 removed the tab titles (`justify-end` header rows), SCU-1.3 rebuilt `CostSummaryTab.tsx` around `summaryBar()` + the `CompareRow` row model and moved `csvCell`/`downloadTextFile`/`downloadClientCsv` into `lib/clientCsv.ts`, SCU-1.2 made band rows exclusive. Every code step below is written against that state; the old header rows are deleted wholesale, so their exact Bundle 1 classes do not matter.
- **Deviation 1 — Download ▾ testids.** One trigger + two items per table: trigger `button-download-{x}`, items `button-download-{x}-csv` / `button-download-{x}-json`, where `{x}` is today's stem (`open-warehouses`, `assignments`, `jadeassignments`, `flows`, `jade-flows-pw`, `jade-flows-wc`, `cost-summary`, `service-stats`). Today's `button-download-{x}-csv` literal therefore moves from a button to the CSV **menu item** (only rendered while the menu is open). Unit tests that clicked it now open the menu first (`chooseDownload` helper); disabled-state tests assert on the trigger. No e2e spec references any output download button (grep run on every literal), so no e2e breaks; each task adds one e2e assertion for its menu.
- **Deviation 2 (Q) — Download ▾ sits LEFT in the DataTable toolbar.** P1's toolbar contract is `upload, download, add, extra`, then right-aligned `count` + filter trigger. B1.4 had kept Download right-aligned in the five output tabs that have a toolbar row. Using the P1 slot moves it to the left of the count/filter group in OpenWarehouses, Assignments, JadeAssignments, Flows and both JADE Flows legs. CostSummary (B1.3 bar, Download stays right) and ServiceStats (tab-level, stays right) are unaffected. Default: follow the P1 contract (one toolbar layout across all 30 tables, inputs included). If the user wants Download right-aligned, that is a one-line P1 shell change (render `toolbar.download` inside the right-aligned group), not a per-table change.
- **Deviation 3 — JADE Flows legs stay mounted.** Today both legs' `useTableFilters` live in the parent, so a filter on P→W survives switching to W→C and back (unit test "selecting a range in EACH inner table…"). A DataTable owns its filter state, so conditional rendering would reset it on every leg switch. Both leg DataTables are therefore always mounted; the inactive one sits in a `hidden` wrapper. Two FilterMenus then coexist in the DOM, so each leg maps its own trigger testid (`button-filter-jade-flows-pw`, `button-filter-jade-flows-wc`; matrix G14 — exactly the literal P1's FilterMenu test uses). No e2e uses a JADE Flows filter trigger (grep run). Unit tests that addressed `button-filter-menu-trigger` on this tab are rewritten per leg; "`jade-flows-pw-table` not in document" becomes "not visible". The `hidden` attribute is proven in a real browser by P3.6's e2e line (`toBeHidden()`), because jsdom cannot prove CSS (`artifacts/studio/CLAUDE.md`).
- **Deviation 4 (Q) — CostSummary single and compare are transposed metric tables.** Rows are metrics, columns are scenarios, values are pre-formatted mixed text ("1,234", "70.42 %", "Proven optimal"). Adapter: a `metric` column (`kind: "text"`, filterable → a select over metric labels) and one value column per scenario with `kind: "number"` (centred, as "numbers centre-aligned" asks) and `filter: false` (a range or select over a column that mixes currency, percentages and words is meaningless). Spec "filter on every table > 10 rows" therefore shows a filter menu on the JADE single summary (11 rows) and on JADE/large compare tables. Default: spec-literal. Alternative (one line per adapter): `filter: false` on the metric column too, i.e. never filter metric lists.
- **Deviation 5 — per-row monospace moves into a `<span>`.** `ColumnDef.cellClassName` is per column; CostSummary decides `font-mono` per row. The cell renders `<span className="font-mono">` when the row is mono. B1.3's `CompareRow.{labelClassName, cellClassName}` (which also carried padding the shell now owns) become `labelMono?: boolean` / `mono: boolean`. The one unit test that asserted `font-mono` on the `<td>` ("renders numeric stats with font-mono…") looks inside the `<td>` instead. No e2e asserts the class (grep run).
- **Deviation 6 (Q) — JADE Flows typed rows are per product.** Spec B2.4 lists `product` in both builders, and the result carries it: P→W `plant_to_warehouse` edges are one per product (`solve.py:1350-1353`), and W→C has a per-(customer, product) record in `details.assignments` (`solve.py:1370-1373`); the W→C *edges* are per customer, product-less (`solve.py:1387-1391`). So: P→W exports one row per inbound edge (the on-screen table sums products per pair, so the export has more rows than the screen); W→C exports one row per `details.assignments` entry, falling back to the outbound edges with `product: null` when the result has none. CSV columns are the JSON keys in spec order plus a trailing `unit` column (the unit the distance is in); `null` → empty cell. Envelope `entity` values: `jadeFlowsPlantWarehouse`, `jadeFlowsWarehouseCustomer`, `costSummaryCompare` (client-only files; they are never imported).
- **Deviation 7 (Q) — Compare JSON rows.** `{ entity: "costSummaryCompare", unit?, rows: [{ metric, values: [{ scenarioId, scenario, value }] }] }` — one row per compare-table row (the CSV's row model), values in on-screen column order, keyed by id because scenario names are not unique. `unit` is the active display unit, omitted while unresolved.
- **Deviation 8 — filter values for columns that had no filter before.** Assignments and Flows gain filters (> 10 rows): entity columns filter on the text "City, ST displayId" (the OpenWarehouses accessor pattern, `OpenWarehousesTab.tsx:170-175`), and the new distance ranges use the **display-unit** value the student reads in the cell. JADE tables keep their existing descriptors unchanged (JADE distance ranges stay canonical, as today).
- **Deviation 9 — filter types pinned where auto-derivation would change today's control** (matrix §5.5): OpenWarehouses `warehouse` text; JadeAssignments `customer` text, `warehouse` select; JADE W→C `customer` text. Plant Production gains a Remaining-capacity range (spec-derived; matrix §5.5 lists it).
- **Deviation 10 — behaviour changes recorded in the changelog** (spec "Behaviour changes users will notice", matrix §5): filter menus appear on Assignments, Flows, OpenWarehouses (non-JADE) and CostSummary when > 10 rows; pagers appear at > 50 rows (p-median-us Customer Assignments: 200 → 4 pages; JADE W→C: 100 → 2 pages; JADE Customer Assignments keeps 8); number columns centre (were right-aligned, Plant Production left); a JadeAssignments filter change now returns to page 1 (today it only clamped); the tables' `sticky top-0` header is gone (the shell has none; pages are ≤ 50 rows); JADE Flows download file names change to the spec's.
- **Deviation 11 — `downloadClientCsv` is deleted** in P3.6: after W→C moves to `downloadClientExport`, nothing calls it (grep in that task).
- **G-3 (Q) — Flows distances render "—" today.** `Workspace.tsx` mounts `FlowsTab` without `distanceUnit` (matrix §2a "Flows"; `Workspace.tsx:4205` at `46d2f98`), so transport-coal and two-echelon-gold-au show "Distance" / "—". P3.4 preserves this (a migration, not a fix) and asks the user; the fix is passing `distanceUnit={activeModelManifest?.distanceUnit}` at that call site.

## File Structure

| Path (under `artifacts/studio/`) | Change | Task |
|---|---|---|
| `src/components/data-table/DownloadMenu.tsx` | **new** — `DownloadMenu`, `DownloadMenuProps`, `DownloadFormat` | P3.1 |
| `src/__tests__/DownloadMenu.test.tsx` | **new** | P3.1 |
| `src/__tests__/helpers/downloadMenu.ts` | **new** — `chooseDownload(triggerTestId, itemTestId)` | P3.1 |
| `src/components/workspace/tabs/OpenWarehousesTab.tsx` | adapter; `enableFilters` prop deleted | P3.1 |
| `src/pages/Workspace.tsx` | drop the OpenWarehouses `enableFilters` prop (3 lines) | P3.1 |
| `src/__tests__/{OpenWarehousesTab,Workspace.Integration,Workspace.TabCoverage}.test.tsx` | rewritten / extended | P3.1 (+ TabCoverage one line each in P3.2, P3.4, P3.7, P3.9) |
| `src/components/workspace/tabs/AssignmentsTab.tsx` + test | adapter | P3.2 |
| `src/components/workspace/tabs/JadeAssignmentsTab.tsx` + test | adapter; local `PAGE_SIZE`/`Pager` deleted | P3.3 |
| `src/components/workspace/tabs/FlowsTab.tsx` + test | adapter | P3.4 |
| `src/lib/jadeFlowsExport.ts` + `src/__tests__/jadeFlowsExport.test.ts` | **new** — typed JADE Flows row builders | P3.5 |
| `src/lib/clientCsv.ts` (Bundle 1) | + `ClientExportEnvelope`, `clientRowsToCsv`, `downloadClientExport` (P3.5); − `downloadClientCsv` (P3.6) | P3.5, P3.6 |
| `src/components/workspace/tabs/JadeFlowsTab.tsx` + test | P→W adapter (P3.5), W→C adapter (P3.6) | P3.5, P3.6 |
| `src/components/workspace/tabs/CostSummaryTab.tsx` + test | single adapter (P3.7), compare adapter (P3.8) | P3.7, P3.8 |
| `src/lib/compareCsv.ts` (Bundle 1) + `src/__tests__/compareCsv.test.ts` | + `buildCompareJson` | P3.8 |
| `src/components/workspace/tabs/ServiceStatsTab.tsx` + test | Plant Production adapter + tab-level Download ▾ | P3.9 |
| `e2e/{max-coverage,workspace-fixups-2,jade-two-echelon,jade-ch9-workspace-bundle,workspace-ux-r1-r9}.spec.ts` | one added assertion block per task | P3.1–P3.9 |
| `docs/CHANGELOG-implementation.md` | one `### SCU-2.P3.N` per task | all |
| `.harness/scu-p3/{scoped-replace,delete-block,insert-after}.py` (worktree root; gitignored scratch) | edit helpers, never committed | P3.1 Step 1 (re-created in each task) |

## Interfaces

**Consumed (P1 rev 4, verbatim — `@/components/data-table/*`):** `DataTable<T>(props: DataTableProps<T>)`; `DataTableProps<T>` (`rows`, `rowKey`, `columns`, `testIds?`, `rowClassName?`, **`ctx: DataTableContext<T>`**, `toolbar?`, `emptyState?`, `noMatchText?`, `sections?`, `focus?`, `scrollClassName?`, `footer?`); `ColumnDef<T>` (`id`, `header`, `filterLabel?`, `kind: "text" | "number" | "enum"`, `cell(row, ctx)`, `value(row): string | number | null`, `filter?: false | "text" | "select" | "range"`, `cellTestId?`, `headerTestId?`, `cellClassName?`, `hidden?`, `filterResetKey?`); `DataTableTestIds<T>` (`root`, `toolbar`, `table`, `scroll`, `count`, `row`, `pager`, `pagerPrev`, `pagerNext`, `pageIndicator`, `filterTrigger`, `empty`, `noMatch`); `DataTableToolbar` (`upload`, `download`, `add`, `extra`). Adapter rules relied on: `cell()` output goes directly in the `<td>`; `cellTestId` on the `<td>`, `headerTestId` on the `<th>`, `testIds.row` on the `<tr>`, `testIds.table` on the `<table>`, `testIds.root` on the outer `<div>` that holds toolbar + table + pager + footer; omitted testids emit nothing; columns memoised; toolbar order `upload, download, add, extra`, then right-aligned `count` + filter trigger.

**Consumed (Bundle 1, `lib/clientCsv.ts`, `lib/compareCsv.ts`, `CostSummaryTab.tsx`):** `csvCell(value: string | number): string`; `downloadTextFile(filename, text, mimeType): void`; `downloadClientCsv(filename, headers, rows)` (deleted by P3.6); `CompareCsvRow { csvLabel; cells: Array<{ raw: number | string | null }> }`; `buildCompareCsv(rows, scenarios): string`; the private `CompareRow`/`CompareCell` row model, `summaryBar(download: ReactNode)` and `compareRows` inside `CostSummaryTab`.

**Consumed (existing):** `useExport()` → `{ download(entity, format: "csv" | "json"), disabledReasonFor(entity) }` (`contexts/ExportContext.tsx`); `Popover`, `PopoverTrigger`, `PopoverContent` (`components/ui/popover.tsx`); `Button` (`components/ui/button.tsx`).

**Produced (P3):**

```ts
// components/data-table/DownloadMenu.tsx (P3.1) — P4 reuses it for input tables
export type DownloadFormat = "csv" | "json";
export interface DownloadMenuProps {
  testId: string;                                 // trigger data-testid
  itemTestIds: Record<DownloadFormat, string>;    // menu item data-testids
  onDownload: (format: DownloadFormat) => void;
  disabledReason?: string;                        // non-null disables the trigger; shown as its title
}
export function DownloadMenu(props: DownloadMenuProps): JSX.Element;

// __tests__/helpers/downloadMenu.ts (P3.1)
export function chooseDownload(triggerTestId: string, itemTestId: string): void;

// lib/clientCsv.ts (P3.5, additive to Bundle 1)
export interface ClientExportEnvelope<R> { entity: string; unit?: string; rows: R[] }
export function clientRowsToCsv<R extends Record<string, string | number | null>>(columns: Array<keyof R & string>, envelope: ClientExportEnvelope<R>): string;
export function downloadClientExport<R extends Record<string, string | number | null>>(baseName: string, format: "csv" | "json", columns: Array<keyof R & string>, envelope: ClientExportEnvelope<R>): void;

// lib/jadeFlowsExport.ts (P3.5)
export type PlantWarehouseExportRow = { plantId: string; toId: string; product: string | null; flow: number; distance: number };
export type WarehouseCustomerExportRow = { warehouseId: string; toId: string; product: string | null; flow: number | null; distance: number };
export const PLANT_WAREHOUSE_EXPORT_COLUMNS: Array<keyof PlantWarehouseExportRow>;
export const WAREHOUSE_CUSTOMER_EXPORT_COLUMNS: Array<keyof WarehouseCustomerExportRow>;
export function plantWarehouseExportRows(result: SolveResult, toDisplay: (canonical: number) => number): PlantWarehouseExportRow[];
export function warehouseCustomerExportRows(result: SolveResult, toDisplay: (canonical: number) => number): WarehouseCustomerExportRow[];

// lib/compareCsv.ts (P3.8, additive to Bundle 1)
export interface CompareJsonDocument {
  entity: "costSummaryCompare";
  unit?: string;
  rows: Array<{ metric: string; values: Array<{ scenarioId: number; scenario: string; value: number | string | null }> }>;
}
export function buildCompareJson(rows: CompareCsvRow[], scenarios: Array<{ id: number; name: string }>, unit: string | null): CompareJsonDocument;
```

**Testid maps produced** (every literal of matrix §2a kept; **new** literals in bold):

| Instance | `testIds` / `ColumnDef` testids | Outside the DataTable |
|---|---|---|
| OpenWarehouses | row `open-warehouse-row-{warehouseId}`; **pager `open-warehouses-pager`, `button-open-warehouses-prev`/`-next`, `open-warehouses-page-indicator`**; toolbar download **`button-download-open-warehouses`** → items `button-download-open-warehouses-csv`, **`-json`** | `open-warehouses-empty` |
| Assignments | row `assignment-row-{customerId}`; **`assignments-pager`, `button-assignments-prev`/`-next`, `assignments-page-indicator`**; **`button-download-assignments`** → `…-csv`, **`…-json`** | `assignments-empty` |
| JadeAssignments | row `row-jadeassignment-{key}`; cells `cell-jadeassignment-{product,customer,warehouse,distance,band}-{key}`; count `text-jadeassignments-count`; `button-jadeassignments-prev`/`-next`, `jadeassignments-page-indicator`; **`button-download-jadeassignments`** → `…-csv`, **`…-json`** | `jade-assignments-tab` (wrapper), `jade-assignments-empty` |
| Flows | row `flow-row-{from}-{to}[-{product}]`; **`flows-pager`, `button-flows-prev`/`-next`, `flows-page-indicator`**; **`button-download-flows`** → `…-csv`, **`…-json`** | `flows-empty` |
| JadeFlows P→W | root `jade-flows-pw-table`; row `jade-flow-pw-row-{plant}-{warehouse}`; cells `cell-jade-flow-pw-{plant,warehouse,distance,flow,band}-{key}`; count `text-jadeflows-pw-count`; **filter `button-filter-jade-flows-pw`**; **`button-jade-flows-pw-prev`/`-next`, `jade-flows-pw-page-indicator`**; **`button-download-jade-flows-pw`** → `…-csv`, **`…-json`** | `jade-flows-tab`, `jade-flows-inner-tabs`, `button-jade-flows-inner-*`, `jade-flows-empty` |
| JadeFlows W→C | root `jade-flows-wc-table`; row `jade-flow-wc-row-{warehouse}-{customer}`; cells `cell-jade-flow-wc-{warehouse,customer,distance,flow,band}-{key}`; count `text-jadeflows-wc-count`; **filter `button-filter-jade-flows-wc`**; **`button-jade-flows-wc-prev`/`-next`, `jade-flows-wc-page-indicator`**; **`button-download-jade-flows-wc`** → `…-csv`, **`…-json`** | (shared with P→W) |
| CostSummary single | table `cost-summary-list`; header `cost-summary-single-column`; value cells `cost-summary-value-{slug}` + the eight explicit overrides | `cost-summary-bar`, `button-toggle-compare`, picker testids, `cost-summary-empty`, **`button-download-cost-summary`** → `…-csv`, **`…-json`** (in the B1.3 bar) |
| CostSummary compare | headers `cost-summary-compare-column-{id}`; cells `cost-summary-compare-{key}-{id}`; nested `cost-summary-compare-open-facility-{id}-{facility}`; footer `cost-summary-compare-bands-note` | wrapper `cost-summary-compare-table`; the bar's Download ▾ (same literals as single) |
| ServiceStats Plant Production | row `row-plant-production-{plant}-{product}`; **`plant-production-pager`, `button-plant-production-prev`/`-next`, `plant-production-page-indicator`** (16 rows today, never shown) | wrapper `plant-production-section`; tab-level **`button-download-service-stats`** → `button-download-service-stats-csv`, **`-json`**; `service-stats-empty`, `-unit-pending`, `-no-bands` |

## Execution topology

Dependency graph: **P3.1** (creates `DownloadMenu` + test helper) blocks every other task. **P3.5** (creates `jadeFlowsExport.ts`, `downloadClientExport`) blocks **P3.6** (same file). **P3.7** blocks **P3.8** (same file). P3.2, P3.3, P3.4, P3.9 touch disjoint source files, but P3.1/2/4/7/9 each edit one of five **adjacent** constant lines in `Workspace.TabCoverage.test.tsx` (`:157-161`), which conflict on cherry-pick, and every task starts local servers on the shared `nos_dev`. **Run the tasks sequentially**, in id order P3.1 → P3.9, then P3.10: each task's worktree is created from the `scnd-upgrades` tip after the previous task was cherry-picked and re-gated. (Simplest correct order; parallel waves would buy little for nine one-file tasks and cost conflict handling.)

**Step L0 (lead, once, before P3.1):**

```bash
cd /Users/shubhamkr/nos-scnd-upgrades && git rev-parse --abbrev-ref HEAD      # must print scnd-upgrades
git status --short                                                             # must be empty (tracked files)
git log --format=%s scnd-upgrades | grep -c '^\[SCU-2\.P1\.'                    # must print 6
git log --format=%s scnd-upgrades | grep -c '^\[SCU-2\.P2\.'                    # must print 3
B1_TIP=<full SHA recorded by P1 Step L0>; git merge-base --is-ancestor "$B1_TIP" scnd-upgrades && echo B1-ok
P2_TIP=$(git rev-parse scnd-upgrades); echo "$P2_TIP"
```

Record `B1_TIP` and `P2_TIP` in every P3 dispatch brief. Then, per task N (1…10), with the previous task already cherry-picked:

```bash
BASE=$(git -C /Users/shubhamkr/nos-scnd-upgrades rev-parse scnd-upgrades)
git -C /Users/shubhamkr/nos-scnd-upgrades worktree add --lock /Users/shubhamkr/nos-scu-2.p3.N -b scu-2.p3.N-work "$BASE"
```

**Do NOT rely on `isolation: "worktree"`** (root CLAUDE.md gotcha). Dispatch without `isolation`; the agent's first Bash command is `cd /Users/shubhamkr/nos-scu-2.p3.N && git rev-parse --abbrev-ref HEAD` (must print `scu-2.p3.N-work`), then the three guards, each alone: `git merge-base --is-ancestor "$BASE" HEAD || exit 1`, `git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1`, `git merge-base --is-ancestor "$P2_TIP" HEAD || exit 1`. After the task commits, the controller cherry-picks it onto `scnd-upgrades` (`git -C /Users/shubhamkr/nos-scnd-upgrades cherry-pick <sha>`, run alone, output read), re-runs the gate on the bundle branch, and only then creates the next worktree.

**Edit helpers (every task's Step 1).** The test-file edits below are mechanical and scoped by test **name**, never by line number (Bundle 1 shifted lines and P1.1's matrix refresh records the new ones). Each task writes these three helpers to `<worktree>/.harness/scu-p3/` (gitignored scratch) and sets `H=<worktree>/.harness/scu-p3`. Every helper exits non-zero when its anchor is missing or ambiguous, which is the re-verification: a helper failure means the base differs from this plan — locate the code by the quoted testid/text, make the smallest equivalent edit, and record the deviation in the commit body.

`$H/scoped-replace.py`:

```python
# SCU-2.P3 — replace text ONLY inside one named test block of a test file.
# Usage: python3 scoped-replace.py <file> <it-title-substring> <old> <new> [nth,nth…]
# The block is the `it(` line whose text contains <title> through the first
# later line, at the same indentation, that starts with `});`. Fails (exit 1)
# unless exactly one `it(` matches and <old> occurs inside the block; every
# occurrence inside the block is replaced — or only the listed 1-based
# occurrences when [nth,…] is given. Prints the count.
import re, sys
path, title, old, new = sys.argv[1:5]
nths = {int(x) for x in sys.argv[5].split(",")} if len(sys.argv) > 5 else None
lines = open(path).read().split("\n")
starts = [i for i, l in enumerate(lines) if re.match(r"^\s*it\(", l) and title in l]
if len(starts) != 1:
    sys.exit(f"expected exactly 1 it() matching {title!r}, found {len(starts)}")
s = starts[0]
pad = lines[s][: len(lines[s]) - len(lines[s].lstrip())]
e = next(i for i in range(s + 1, len(lines)) if lines[i].startswith(pad + "});"))
block = "\n".join(lines[s : e + 1])
n = block.count(old)
if n == 0:
    sys.exit(f"{old!r} not found inside it({title!r})")
if nths is None:
    block, done = block.replace(old, new), n
else:
    if max(nths) > n:
        sys.exit(f"only {n} occurrences of {old!r} inside it({title!r})")
    parts = block.split(old)
    block = parts[0] + "".join((new if k + 1 in nths else old) + part for k, part in enumerate(parts[1:]))
    done = len(nths)
lines[s : e + 1] = block.split("\n")
open(path, "w").write("\n".join(lines))
print(f"{done} replaced in it({title!r})")
```

`$H/delete-block.py`:

```python
# SCU-2.P3 — delete one named `it(` or `describe(` block: its opening line
# through its own closing `});` (same indentation). With --with-comments, the
# contiguous `//` comment lines directly above it (and one blank line above
# those) go too. With --replace-with <path>, that file's text is put in the
# deleted block's place (re-using nothing of the old block).
# Usage: python3 delete-block.py <file> it|describe <title-substring> [--with-comments] [--replace-with <path>]
import re, sys
path, kind, title = sys.argv[1:4]
opts = sys.argv[4:]
with_comments = "--with-comments" in opts
replacement = open(opts[opts.index("--replace-with") + 1]).read().rstrip("\n").split("\n") if "--replace-with" in opts else []
lines = open(path).read().split("\n")
starts = [i for i, l in enumerate(lines) if re.match(rf"^\s*{kind}\(", l) and title in l]
if len(starts) != 1:
    sys.exit(f"expected exactly 1 {kind}() matching {title!r}, found {len(starts)}")
s = starts[0]
pad = lines[s][: len(lines[s]) - len(lines[s].lstrip())]
e = next(i for i in range(s + 1, len(lines)) if lines[i].startswith(pad + "});"))
if with_comments:
    while s > 0 and lines[s - 1].strip().startswith("//"):
        s -= 1
    if s > 0 and lines[s - 1].strip() == "":
        s -= 1
lines[s : e + 1] = replacement
open(path, "w").write("\n".join(lines))
print(f"{'replaced' if replacement else 'deleted'} {kind}({title!r}): {e - s + 1} lines")
```

`$H/insert-after.py`:

```python
# SCU-2.P3 — insert lines after the ONE line containing <anchor> (fixed string),
# re-indented to that line's indentation. Fails unless the anchor matches
# exactly one line. <text> is newline-separated, written without indentation.
# Usage: python3 insert-after.py <file> <anchor> <text>
import sys
path, anchor, text = sys.argv[1:4]
lines = open(path).read().split("\n")
hits = [i for i, l in enumerate(lines) if anchor in l]
if len(hits) != 1:
    sys.exit(f"expected exactly 1 line containing {anchor!r}, found {len(hits)}")
i = hits[0]
pad = lines[i][: len(lines[i]) - len(lines[i].lstrip())]
lines[i + 1 : i + 1] = [pad + t if t else t for t in text.split("\n")]
open(path, "w").write("\n".join(lines))
print(f"inserted {len(text.splitlines())} lines after line {i + 1}")
```

---

## Task SCU-2.P3.1: OpenWarehouses on DataTable + the shared Download ▾ (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (server `openWarehouses`), B2.10. **Matrix:** §2a "OpenWarehouses", §3 "OpenWarehouses", §5 item 1 (filter on every model), G13. **Deviations:** 1, 2, 9 (`warehouse` pinned text), 10.

**Files:**
- Create: `artifacts/studio/src/components/data-table/DownloadMenu.tsx`, `artifacts/studio/src/__tests__/DownloadMenu.test.tsx`, `artifacts/studio/src/__tests__/helpers/downloadMenu.ts`
- Modify: `artifacts/studio/src/components/workspace/tabs/OpenWarehousesTab.tsx` (imports; delete the `enableFilters` prop; replace the component)
- Modify: `artifacts/studio/src/pages/Workspace.tsx` (the OpenWarehouses mount: delete 3 lines)
- Test: `artifacts/studio/src/__tests__/OpenWarehousesTab.test.tsx`, `Workspace.Integration.test.tsx`, `Workspace.TabCoverage.test.tsx`
- e2e: `artifacts/studio/e2e/max-coverage.spec.ts` (one inserted block)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: P1 `DataTable`, `ColumnDef` (see "Interfaces"); `useExport()`; `Popover*`, `Button`.
- Produces: `DownloadMenu`, `DownloadMenuProps`, `DownloadFormat`; `chooseDownload`. `OpenWarehousesTabProps` loses `enableFilters` (its only caller passed it at `Workspace.tsx`, mount `:4109` at `46d2f98`).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Worktree, guards, install, helpers, anchor re-verification**

Run the branch check and the three base guards (see "Execution topology"), then `pnpm install --frozen-lockfile`. Write the three helpers to `.harness/scu-p3/` and set `H`. Then re-verify the anchors this task edits, each command alone:

- `grep -c 'export function OpenWarehousesTab(' artifacts/studio/src/components/workspace/tabs/OpenWarehousesTab.tsx` → `1`
- `grep -c 'enableFilters' artifacts/studio/src/components/workspace/tabs/OpenWarehousesTab.tsx` → `4` (prop declaration, destructure, two uses)
- `grep -n 'enableFilters={modelId === "two-echelon-jade-us"}' artifacts/studio/src/pages/Workspace.tsx` → exactly two hits: the Warehouses input mount (P4's, leave it) and the OpenWarehouses mount (the one inside `<OpenWarehousesTab`, preceded by the comment `// jade-INT (#9, spec §10 D2 "JADE-first") — opt-in FilterMenu,`)
- `grep -n 'data-testid' artifacts/studio/src/components/workspace/tabs/OpenWarehousesTab.tsx` → the literals of matrix §2a "OpenWarehouses" (`open-warehouses-empty`, `button-download-open-warehouses-csv`, `open-warehouse-row-…`) and no others
- `grep -c 'describe("OpenWarehousesTab — no duplicate title (SCU-1.4)"' artifacts/studio/src/__tests__/OpenWarehousesTab.test.tsx` → `1` (Bundle 1's)

- [ ] **Step 2: Write the failing tests**

Create `artifacts/studio/src/__tests__/helpers/downloadMenu.ts`:

```ts
// SCU-2.P3 — open a DownloadMenu (B2.4 "Download ▾") and pick one item.
// Shared by every output-tab test that used to click a single Download CSV button.
import { fireEvent, screen } from "@testing-library/react";

export function chooseDownload(triggerTestId: string, itemTestId: string): void {
  fireEvent.click(screen.getByTestId(triggerTestId));
  fireEvent.click(screen.getByTestId(itemTestId));
}
```

Create `artifacts/studio/src/__tests__/DownloadMenu.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import { chooseDownload } from "@/__tests__/helpers/downloadMenu";

const ids = { csv: "button-download-x-csv", json: "button-download-x-json" };

describe("DownloadMenu (SCU-2.P3, spec B2.4)", () => {
  it("renders only the trigger until opened; items carry the literal testids", () => {
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={() => {}} />);
    expect(screen.getByTestId("button-download-x")).toHaveTextContent("Download");
    expect(screen.queryByTestId("button-download-x-csv")).toBeNull();
    fireEvent.click(screen.getByTestId("button-download-x"));
    expect(screen.getByTestId("button-download-x-csv")).toHaveTextContent("CSV");
    expect(screen.getByTestId("button-download-x-json")).toHaveTextContent("JSON");
  });

  it("reports the chosen format and closes", () => {
    const onDownload = vi.fn();
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={onDownload} />);
    chooseDownload("button-download-x", "button-download-x-json");
    expect(onDownload).toHaveBeenCalledWith("json");
    expect(screen.queryByTestId("button-download-x-json")).toBeNull();
    chooseDownload("button-download-x", "button-download-x-csv");
    expect(onDownload).toHaveBeenLastCalledWith("csv");
  });

  it("disabledReason disables the trigger and is its title", () => {
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={() => {}} disabledReason="Loading…" />);
    const trigger = screen.getByTestId("button-download-x");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", "Loading…");
  });

  it("Escape closes the open menu", async () => {
    const user = userEvent.setup();
    render(<DownloadMenu testId="button-download-x" itemTestIds={ids} onDownload={() => {}} />);
    await user.click(screen.getByTestId("button-download-x"));
    expect(screen.getByTestId("button-download-x-csv")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("button-download-x-csv")).toBeNull();
  });
});
```

Edit `artifacts/studio/src/__tests__/OpenWarehousesTab.test.tsx` (run from `artifacts/studio`):

```bash
T=src/__tests__/OpenWarehousesTab.test.tsx
perl -0pi -e 's|(import \{ exportProviderWrapper, makeExportProviderValue \} from "\@/__tests__/helpers/renderWithExportProvider";\n)|$1import { chooseDownload } from "\@/__tests__/helpers/downloadMenu";\n|' $T
perl -pi -e 's/fireEvent\.click\(screen\.getByTestId\("button-download-open-warehouses-csv"\)\);/chooseDownload("button-download-open-warehouses", "button-download-open-warehouses-csv");/g; s/const button = screen\.getByTestId\("button-download-open-warehouses-csv"\);/const button = screen.getByTestId("button-download-open-warehouses");/g' $T
grep -c 'chooseDownload' $T          # → 4 (import + 3 call sites)
python3 $H/delete-block.py $T describe 'OpenWarehousesTab — no duplicate title (SCU-1.4)' --with-comments
cat > $H/p31-filter-block.tsx <<'BLOCK'

  // SCU-2.P3.1 (spec B2.2) — the FilterMenu is no longer an opt-in: every
  // model gets it once the table has > 10 rows (replaces the B6 enableFilters tests).
  describe("FilterMenu > 10 rows on every model (SCU-2.P3.1)", () => {
    const manyWarehousesResult = {
      status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "Proven optimal",
      edges: Array.from({ length: 11 }, (_, i) => ({ fromId: `WH${i}`, toId: `C${i}`, flow: 10, distance: 1 })),
      metrics: {},
      details: {}, solverUsed: "CBC", infeasibilityReason: null,
    };

    it("<= 10 rows: no FilterMenu", () => {
      render(<OpenWarehousesTab result={result} scenarioId={1} />);
      expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    });

    it("> 10 rows: FilterMenu shown without any opt-in prop", () => {
      render(<OpenWarehousesTab result={manyWarehousesResult} scenarioId={1} />);
      expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    });

    it("filtering by Warehouse (text, pinned) narrows the rendered rows", async () => {
      render(<OpenWarehousesTab result={manyWarehousesResult} scenarioId={1} />);
      await userEvent.click(screen.getByTestId("button-filter-menu-trigger"));
      await userEvent.type(screen.getByTestId("input-filter-warehouse"), "WH1");
      // "WH1" matches WH1 and WH10 (substring match).
      expect(screen.getByTestId("open-warehouse-row-WH1")).toBeInTheDocument();
      expect(screen.getByTestId("open-warehouse-row-WH10")).toBeInTheDocument();
      expect(screen.queryByTestId("open-warehouse-row-WH2")).not.toBeInTheDocument();
    });
  });
BLOCK
python3 $H/delete-block.py $T describe 'enableFilters (B6)' --with-comments --replace-with $H/p31-filter-block.tsx
```

Bundle 1's SCU-1.4 describe is deleted because it asserts `justify-end` on a header row that no longer exists; its real content (no title) moves into the new describe below. The B6 `enableFilters` describe (and its leading comment) is replaced in place by the filter-on-every-model describe.

Append at EOF:

```tsx

// SCU-2.P3.1 (spec B2.1/B2.2/B2.4, matrix §2a "OpenWarehouses") — the
// DataTable migration emits every testid in the instance's testid map, plus
// the new Download ▾ and pager literals; number columns are centred.
describe("OpenWarehousesTab on DataTable — testid map (SCU-2.P3.1)", () => {
  const manyResult = (n: number) => ({
    ...result,
    edges: Array.from({ length: n }, (_, i) => ({ fromId: `WH${i + 1}`, toId: `C${i + 1}`, flow: 10 * (i + 1), distance: 1 })),
    metrics: {},
  });

  it("emits open-warehouses-empty for no result", () => {
    render(<OpenWarehousesTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("open-warehouses-empty")).toHaveTextContent("No solved result yet.");
  });

  it("emits the row testid on a <tr> and the Download ▾ trigger + both items", () => {
    render(<OpenWarehousesTab result={result} scenarioId={1} />);
    expect(screen.getByTestId("open-warehouse-row-ALN").tagName).toBe("TR");
    fireEvent.click(screen.getByTestId("button-download-open-warehouses"));
    expect(screen.getByTestId("button-download-open-warehouses-csv")).toHaveTextContent("CSV");
    expect(screen.getByTestId("button-download-open-warehouses-json")).toHaveTextContent("JSON");
  });

  it("JSON goes through the same server export (entity openWarehouses, format json)", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<OpenWarehousesTab result={result} scenarioId={1} />);
    chooseDownload("button-download-open-warehouses", "button-download-open-warehouses-json");
    expect(spy).toHaveBeenCalledWith(1, "openWarehouses", "json", { unit: "mi" });
    spy.mockRestore();
  });

  it("renders no 'Open Warehouses' title (B1.4 kept)", () => {
    render(<OpenWarehousesTab result={result} scenarioId={1} />);
    expect(screen.queryByText("Open Warehouses")).not.toBeInTheDocument();
  });

  it("centres the number columns (header and cells), not the Warehouse column", () => {
    render(<OpenWarehousesTab result={result} scenarioId={1} />);
    expect(screen.getByRole("columnheader", { name: "Total Flow" })).toHaveClass("text-center");
    expect(screen.getByRole("columnheader", { name: "Utilization" })).toHaveClass("text-center");
    expect(screen.getByRole("columnheader", { name: "Warehouse" })).not.toHaveClass("text-center");
    const cells = screen.getByTestId("open-warehouse-row-ALN").querySelectorAll("td");
    expect(cells[1]).toHaveClass("text-center");
    expect(cells[2]).toHaveClass("text-center");
  });

  it("> 50 rows: pager with the mapped literals; 50 rows: none", () => {
    const { unmount } = render(<OpenWarehousesTab result={manyResult(50)} scenarioId={1} />);
    expect(screen.queryByTestId("open-warehouses-pager")).toBeNull();
    unmount();
    render(<OpenWarehousesTab result={manyResult(51)} scenarioId={1} />);
    expect(screen.getByTestId("open-warehouses-page-indicator")).toHaveTextContent("Page 1 of 2");
    expect(screen.getByTestId("open-warehouses-pager")).toContainElement(screen.getByTestId("button-open-warehouses-prev"));
    fireEvent.click(screen.getByTestId("button-open-warehouses-next"));
    expect(screen.getByTestId("open-warehouse-row-WH51")).toBeInTheDocument();
    expect(screen.queryByTestId("open-warehouse-row-WH1")).toBeNull();
  });
});
```

Edit `Workspace.Integration.test.tsx` and `Workspace.TabCoverage.test.tsx`:

```bash
# SCU-2.P3.1 — Workspace.Integration.test.tsx + Workspace.TabCoverage.test.tsx edits (run from artifacts/studio).
set -e
python3 $H/scoped-replace.py src/__tests__/Workspace.Integration.test.tsx "passes enableFilters=true to Warehouses/Customers/Open-Warehouses only on the JADE path" 'expect(openWarehousesTabSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enableFilters: true });' 'expect(openWarehousesTabSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty("enableFilters"); // SCU-2.P3.1: prop deleted — DataTable filters every model > 10 rows'
python3 $H/scoped-replace.py src/__tests__/Workspace.Integration.test.tsx "does NOT pass enableFilters=true for a non-JADE model" 'expect(openWarehousesTabSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enableFilters: false });' 'expect(openWarehousesTabSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty("enableFilters"); // SCU-2.P3.1'
perl -pi -e 's/tabTestId: "button-download-open-warehouses-csv"/tabTestId: "button-download-open-warehouses"/' src/__tests__/Workspace.TabCoverage.test.tsx
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/DownloadMenu.test.tsx src/__tests__/OpenWarehousesTab.test.tsx src/__tests__/Workspace.Integration.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): FAIL. `DownloadMenu.test.tsx` → `Failed to resolve import "@/components/data-table/DownloadMenu"`. `OpenWarehousesTab.test.tsx` → `Unable to find an element by: [data-testid="button-download-open-warehouses"]` (and the filter-on-every-model test: `Unable to find an element by: [data-testid="button-filter-menu-trigger"]`). `Workspace.Integration.test.tsx` → the two `not.toHaveProperty("enableFilters")` assertions fail. `Workspace.TabCoverage.test.tsx` → the coverage test of every model whose `outputGrids` include `openWarehouses` fails at `open-warehouses`.

- [ ] **Step 4: Implement**

Create `artifacts/studio/src/components/data-table/DownloadMenu.tsx`:

```tsx
// SCU-2.P3 (spec B2.4) — the "Download ▾" control every migrated Workspace
// table puts in its DataTable toolbar (P4 input tables reuse it). One trigger,
// two items: CSV and JSON. Testids are passed literally per table (nothing is
// derived). Built on the Popover FilterMenu already uses, so it opens on a
// plain click (fireEvent.click works in jsdom) and closes on Escape /
// outside click for free. `disabledReason` disables the TRIGGER and is its
// tooltip, exactly as the single Download CSV buttons it replaces did.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DownloadFormat = "csv" | "json";

export interface DownloadMenuProps {
  /** data-testid on the trigger button. */
  testId: string;
  /** data-testid on each menu item. */
  itemTestIds: Record<DownloadFormat, string>;
  onDownload: (format: DownloadFormat) => void;
  /** Non-null disables the trigger; shown as its title. */
  disabledReason?: string;
}

const ITEMS: Array<{ format: DownloadFormat; label: string }> = [
  { format: "csv", label: "CSV" },
  { format: "json", label: "JSON" },
];

export function DownloadMenu({ testId, itemTestIds, onDownload, disabledReason }: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          data-testid={testId}
          disabled={disabledReason != null}
          title={disabledReason}
        >
          Download
          <ChevronDown className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-32 p-1" align="end" role="menu">
        {ITEMS.map(({ format, label }) => (
          <button
            key={format}
            type="button"
            role="menuitem"
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
            data-testid={itemTestIds[format]}
            onClick={() => {
              setOpen(false);
              onDownload(format);
            }}
          >
            {label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

In `artifacts/studio/src/components/workspace/tabs/OpenWarehousesTab.tsx`, replace the two lines

```tsx
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
```

with

```tsx
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
```

Delete, in `OpenWarehousesTabProps`, the whole doc comment that starts `  /** B6 (JADE Ch.9 Workspace Bundle, spec §10) — opt-in FilterMenu. Defaults` and the line `  enableFilters?: boolean;` after it.

Replace everything from the line `export function OpenWarehousesTab({` to the end of the file with:

```tsx
// SCU-2.P3.1 (spec B2.1/B2.2/B2.4) — rendered by the shared DataTable: filter
// menu on every model once > 10 rows (the JADE-only `enableFilters` opt-in is
// gone), pager > 50, number columns centred, Download ▾ CSV/JSON (server).
export function OpenWarehousesTab({ result, scenarioId, displayedInputs, locationById, identityById }: OpenWarehousesTabProps) {
  const { download, disabledReasonFor } = useExport();
  const rows = useMemo(() => (result ? openWarehouseRows(result) : []), [result]);
  // jade-T14 — an explicit EMPTY `capacityModes` array (JADE's uncapacitated,
  // demand-served-in-tons model, manifest `capacityModes: []`) means "show
  // Demand Served, never a %"; `capacityModes` absent falls through to the
  // original `capacityMode`-string gate unchanged.
  const showDemandServed = displayedInputs?.capacityModes != null && displayedInputs.capacityModes.length === 0;
  // Back-compat: no `displayedInputs` at all -> show Utilization as today.
  const showUtilization = !showDemandServed && displayedInputs?.capacityMode !== "none";
  const codeById = useMemo(() => displayCodeById(displayedInputs), [displayedInputs]);

  const columns = useMemo<ColumnDef<OpenWarehouseRow>[]>(() => {
    const identity = (r: OpenWarehouseRow) => resolveWarehouseIdentity(r.warehouseId, codeById, locationById, identityById);
    const cols: ColumnDef<OpenWarehouseRow>[] = [
      {
        id: "warehouse",
        header: "Warehouse",
        kind: "text",
        // Pinned: today's descriptor is free text (matrix §5.5), never a select.
        filter: "text",
        value: r => {
          const { displayId, location } = identity(r);
          return location ? `${formatCityState(location.city, location.state)} ${displayId}` : displayId;
        },
        cell: r => {
          const { displayId, location } = identity(r);
          return <EntityIdCell entityId={r.warehouseId} displayId={displayId} location={location} />;
        },
      },
      {
        id: "flow",
        header: showDemandServed ? "Demand Served" : "Total Flow",
        kind: "number",
        cellClassName: "font-mono",
        value: r => r.totalFlow,
        cell: r => r.totalFlow.toLocaleString(),
      },
    ];
    if (showUtilization) {
      cols.push({
        id: "utilization",
        header: "Utilization",
        kind: "number",
        cellClassName: "font-mono",
        value: r => r.utilization,
        cell: r => (r.utilization != null ? `${Math.round(r.utilization)}%` : "—"),
      });
    }
    return cols;
  }, [codeById, locationById, identityById, showDemandServed, showUtilization]);

  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="open-warehouses-empty">No solved result yet.</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="overflow-auto flex-1 p-2">
        <DataTable<OpenWarehouseRow>
          rows={rows}
          rowKey={r => r.warehouseId}
          columns={columns}
          ctx={{ readOnly: true, demandEditable: false }}
          testIds={{
            row: r => `open-warehouse-row-${r.warehouseId}`,
            pager: "open-warehouses-pager",
            pagerPrev: "button-open-warehouses-prev",
            pagerNext: "button-open-warehouses-next",
            pageIndicator: "open-warehouses-page-indicator",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-open-warehouses"
                itemTestIds={{ csv: "button-download-open-warehouses-csv", json: "button-download-open-warehouses-json" }}
                onDownload={format => download("openWarehouses", format)}
                disabledReason={disabledReasonFor("openWarehouses")}
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
```

In `artifacts/studio/src/pages/Workspace.tsx`, inside the `<OpenWarehousesTab` mount, delete these three lines (keep the `locationById` line above them):

```tsx
            // jade-INT (#9, spec §10 D2 "JADE-first") — opt-in FilterMenu,
            // true only on the JADE path.
            enableFilters={modelId === "two-echelon-jade-us"}
```

The Warehouses input mount's `enableFilters` (the other grep hit) is P4's and stays.

- [ ] **Step 5: Run them to verify they pass**

Run: the Step 3 command, then `pnpm --filter studio exec vitest run src/__tests__/Workspace.test.tsx`.
Expected (provisional): PASS — scratch counts `DownloadMenu.test.tsx` 4, `OpenWarehousesTab.test.tsx` 38, `Workspace.Integration.test.tsx` 15, `Workspace.TabCoverage.test.tsx` 8; `Workspace.test.tsx` unchanged and green (it uses the `open-warehouse-row-` prefix only).

- [ ] **Step 6: Prove the testid-map test can fail (non-vacuity)**

In `OpenWarehousesTab.tsx`, temporarily change `` row: r => `open-warehouse-row-${r.warehouseId}`, `` to `` row: r => `open-warehouse-rowX-${r.warehouseId}`, ``. Run `pnpm --filter studio exec vitest run src/__tests__/OpenWarehousesTab.test.tsx`.
Expected: FAIL — scratch: `Tests  23 failed | 15 passed (38)`, first error `Unable to find an element by: [data-testid="open-warehouse-row-ALN"]`. Revert the change, re-run, PASS. Record both results in the changelog.

- [ ] **Step 7: e2e sweep**

1. Grep every literal this task changes or adds: `grep -rn 'button-download-open-warehouses\|open-warehouses-pager\|open-warehouses-page-indicator\|button-open-warehouses-\|enableFilters' artifacts/studio/e2e/` → no hits (measured at `46d2f98`; re-run).
2. Matrix §3 "OpenWarehouses" lines — re-read each, no rewrite needed: `jade-ch9-workspace-bundle.spec.ts` (`open-warehouse-row-` prefix + "Demand Served" text), `jade-two-echelon.spec.ts` (`open-warehouse-row-` count `2`), `max-coverage.spec.ts` (`open-warehouse-row-DAL/LA/PIT` + count `3`) — row testids and counts (< 50) are unchanged.
3. Add the new control's assertion (run from `artifacts/studio`):

```bash
python3 $H/insert-after.py e2e/max-coverage.spec.ts "expect(await page.locator('[data-testid^=\"open-warehouse-row-\"]').count()).toBe(3);" '// SCU-2.P3.1 — Download ▾ offers CSV and JSON (spec B2.4).
await page.getByTestId("button-download-open-warehouses").click();
await expect(page.getByTestId("button-download-open-warehouses-csv")).toBeVisible();
await expect(page.getByTestId("button-download-open-warehouses-json")).toBeVisible();
await page.keyboard.press("Escape");'
```

4. Local run (recipe in "Global Constraints", ports 3101/5201): `E2E_BASE_URL=http://localhost:5201 pnpm exec playwright test e2e/max-coverage.spec.ts e2e/jade-two-echelon.spec.ts e2e/jade-ch9-workspace-bundle.spec.ts e2e/tab-coverage.spec.ts`. Expected: all pass (failures matched against the flake registry by name, re-run twice in isolation before calling one real).

- [ ] **Step 8: Gate**

Run each separately: the vitest-quiet check; `pnpm run typecheck`; `pnpm --filter studio typecheck:e2e`; `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`; `pnpm --filter studio test`; `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`; `pnpm --filter @workspace/import-schema test`. Expected: every command exits 0.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P3.1 — OpenWarehouses on DataTable + Download ▾

- New shared `components/data-table/DownloadMenu.tsx` (trigger `button-download-{x}`, items `-csv`/`-json`; Popover-based) + test helper `chooseDownload`. OpenWarehouses renders through `DataTable`: filter menu on **every** model above 10 rows (the JADE-only `enableFilters` opt-in is deleted, `Workspace.tsx` + `OpenWarehousesTab.tsx`), pager above 50, number columns centred, Download ▾ CSV/JSON via the server `openWarehouses` export.
- Deviations 1, 2, 9, 10. Non-vacuity: row-testid break → <N failed>; reverted → green.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, E2E_BASE_URL=http://localhost:5201): <specs + result>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/components/data-table/DownloadMenu.tsx artifacts/studio/src/__tests__/DownloadMenu.test.tsx artifacts/studio/src/__tests__/helpers/downloadMenu.ts
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/data-table/DownloadMenu.tsx artifacts/studio/src/__tests__/DownloadMenu.test.tsx artifacts/studio/src/__tests__/helpers/downloadMenu.ts artifacts/studio/src/components/workspace/tabs/OpenWarehousesTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/OpenWarehousesTab.test.tsx artifacts/studio/src/__tests__/Workspace.Integration.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/e2e/max-coverage.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.1] move OpenWarehouses onto DataTable and add Download menu" -m "Deviations 1 (trigger + csv/json item testids), 2 (Download in the toolbar's left slot), 9 (warehouse filter pinned text), 10 (filter on every model; enableFilters deleted)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.2: Customer Assignments (shared, non-JADE) on DataTable (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (server `assignments`), B2.10. **Matrix:** §2a "Assignments", §3 "Assignments", G12 (EntityIdCell directly in the `<td>`). **Deviations:** 1, 2, 8, 10. **Depends on:** P3.1.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/AssignmentsTab.tsx`
- Test: `artifacts/studio/src/__tests__/AssignmentsTab.test.tsx`, `Workspace.TabCoverage.test.tsx`
- e2e: `artifacts/studio/e2e/workspace-fixups-2.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: P1 `DataTable`, `ColumnDef`; `DownloadMenu`, `chooseDownload` (P3.1).
- Produces: the testid map row "Assignments" above. Module-private `entityFilterText(id, fallbackDisplayLabel, locationById, identityById): string`.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Worktree, guards, install, helpers, anchor re-verification**

Branch check, the three base guards, `pnpm install --frozen-lockfile`, helpers to `.harness/scu-p3/` (P3.1 "Execution topology" block), `H` set. Then, each alone:
- `grep -c '^// Phase C, Task 3 — one row per solved edge' artifacts/studio/src/components/workspace/tabs/AssignmentsTab.tsx` → `1`
- `grep -n 'data-testid' artifacts/studio/src/components/workspace/tabs/AssignmentsTab.tsx` → `assignments-empty`, `button-download-assignments-csv`, `assignment-row-…` only
- `grep -c 'describe("AssignmentsTab — no duplicate title (SCU-1.4)"' artifacts/studio/src/__tests__/AssignmentsTab.test.tsx` → `1`

- [ ] **Step 2: Write the failing tests**

```bash
T=src/__tests__/AssignmentsTab.test.tsx
perl -0pi -e 's|(import \{ makeExportProviderValue \} from "\@/__tests__/helpers/renderWithExportProvider";\n)|$1import { chooseDownload } from "\@/__tests__/helpers/downloadMenu";\n|' $T
perl -pi -e 's/fireEvent\.click\(screen\.getByTestId\("button-download-assignments-csv"\)\);/chooseDownload("button-download-assignments", "button-download-assignments-csv");/g; s/const button = screen\.getByTestId\("button-download-assignments-csv"\);/const button = screen.getByTestId("button-download-assignments");/g' $T
grep -c 'chooseDownload' $T          # → 3 (import + 2 call sites)
python3 $H/delete-block.py $T describe 'AssignmentsTab — no duplicate title (SCU-1.4)' --with-comments
perl -pi -e 's/tabTestId: "button-download-assignments-csv"/tabTestId: "button-download-assignments"/' src/__tests__/Workspace.TabCoverage.test.tsx
```

Append at EOF of `AssignmentsTab.test.tsx`:

```tsx

// SCU-2.P3.2 (spec B2.1/B2.2/B2.4, matrix §2a "Assignments") — DataTable
// migration: every testid in the instance map, Download ▾ CSV/JSON, the new
// pager literals at > 50 rows, filter > 10 rows, number columns centred.
describe("AssignmentsTab on DataTable — testid map (SCU-2.P3.2)", () => {
  const many = (n: number) => ({
    ...result,
    edges: Array.from({ length: n }, (_, i) => ({ fromId: i % 2 ? "ALN" : "DAL", toId: `C${i + 1}`, flow: i + 1, distance: 10 + i })),
  });

  it("emits assignment-row-{customerId} on a <tr>, Download ▾ trigger + items", () => {
    render(<AssignmentsTab result={result} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("assignment-row-C1").tagName).toBe("TR");
    fireEvent.click(screen.getByTestId("button-download-assignments"));
    expect(screen.getByTestId("button-download-assignments-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-assignments-json")).toBeInTheDocument();
  });

  it("JSON goes through the server export (entity assignments, format json)", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<AssignmentsTab result={result} scenarioId={1} distanceUnit="mi" />);
    chooseDownload("button-download-assignments", "button-download-assignments-json");
    expect(spy).toHaveBeenCalledWith(1, "assignments", "json", { unit: "mi" });
    spy.mockRestore();
  });

  it("renders no 'Customer Assignments' title (B1.4 kept)", () => {
    render(<AssignmentsTab result={result} scenarioId={1} distanceUnit="mi" />);
    expect(screen.queryByText("Customer Assignments")).not.toBeInTheDocument();
  });

  it("keeps the header texts and order; centres Distance and Flow only", () => {
    render(<AssignmentsTab result={result} scenarioId={1} distanceUnit="mi" />);
    const heads = screen.getAllByRole("columnheader");
    expect(heads.map(h => h.textContent)).toEqual(["Customer", "Warehouse", "Distance (mi)", "Flow"]);
    expect(heads.map(h => h.classList.contains("text-center"))).toEqual([false, false, true, true]);
  });

  it("10 rows: no filter, no pager; 11 rows: filter; 51 rows: pager with the mapped literals", () => {
    const a = render(<AssignmentsTab result={many(10)} scenarioId={1} distanceUnit="mi" />);
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
    a.unmount();
    const b = render(<AssignmentsTab result={many(11)} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("assignments-pager")).toBeNull();
    b.unmount();
    render(<AssignmentsTab result={many(51)} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("assignments-page-indicator")).toHaveTextContent("Page 1 of 2");
    fireEvent.click(screen.getByTestId("button-assignments-next"));
    expect(screen.getByTestId("assignment-row-C51")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-assignments-prev"));
    expect(screen.getByTestId("assignment-row-C1")).toBeInTheDocument();
  });

  it("the Distance range filters on the DISPLAY-unit value", () => {
    render(<AssignmentsTab result={many(12)} scenarioId={1} distanceUnit="mi" />);
    fireEvent.click(screen.getByTestId("button-filter-menu-trigger"));
    fireEvent.change(screen.getByTestId("input-filter-distance-max"), { target: { value: "11" } });
    expect(screen.getAllByTestId(/^assignment-row-/).map(r => r.getAttribute("data-testid"))).toEqual(["assignment-row-C1", "assignment-row-C2"]);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/AssignmentsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): FAIL — `Unable to find an element by: [data-testid="button-download-assignments"]`; the header test fails on `text-center`; the 11-row test on `button-filter-menu-trigger`; TabCoverage fails at `customer-assignments` for the five non-JADE models.

- [ ] **Step 4: Implement**

In `AssignmentsTab.tsx`, replace the first line `import type { SolveResult } from "@workspace/api-client-react";` with

```tsx
import { useMemo } from "react";
import type { SolveResult } from "@workspace/api-client-react";
```

and after the line `import { EntityIdCell } from "@/components/tables/EntityIdCell";` add

```tsx
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
```

Replace everything from the line `// Phase C, Task 3 — one row per solved edge (customer <- warehouse` to the end of the file with:

```tsx
// SCU-2.P3.2 — the raw text a filter matches for one entity cell (never the
// rendered JSX): "City, ST displayId" when a location is known, else the
// display id — the same accessor shape OpenWarehousesTab's warehouse filter uses.
function entityFilterText(
  id: string,
  fallbackDisplayLabel: string,
  locationById: Record<string, { city: string; state: string }> | undefined,
  identityById: Record<string, EntityIdentity> | undefined,
): string {
  const identity = identityById?.[id];
  if (identity) {
    return identity.city || identity.state ? `${formatCityState(identity.city, identity.state)} ${identity.displayId}` : identity.displayId;
  }
  const loc = locationById?.[id];
  return loc ? `${formatCityState(loc.city, loc.state)} ${fallbackDisplayLabel}` : fallbackDisplayLabel;
}

// Phase C, Task 3 — one row per solved edge (customer <- warehouse
// assignment). Purely a read of the already-solved result; no local state,
// no editing (output tabs are read-only, unlike the input grid tabs).
// SCU-2.P3.2 (spec B2.1/B2.2/B2.4) — rendered by the shared DataTable: filter
// menu > 10 rows, pager > 50 (p-median-us's 200 customers now page), number
// columns centred, Download ▾ CSV/JSON (server `assignments`).
export function AssignmentsTab({ result, scenarioId, displayedInputs, locationById, identityById, distanceUnit }: AssignmentsTabProps) {
  const unit = useDisplayUnit();
  const { download, disabledReasonFor } = useExport();
  const canonicalResolved = distanceUnit != null;
  const distanceHeaderLabel = canonicalResolved ? `Distance (${unit.effectiveUnit(distanceUnit)})` : "Distance";
  const codeById = useMemo(() => displayCodeById(displayedInputs), [displayedInputs]);
  const rows = useMemo(() => (result ? aggregatedAssignmentRows(result) : []), [result]);

  const columns = useMemo<ColumnDef<AssignmentRow>[]>(() => [
    {
      id: "customer",
      header: "Customer",
      kind: "text",
      value: r => entityFilterText(r.customerId, r.customerId, locationById, identityById),
      cell: r => resolveCell(r.customerId, r.customerId, locationById, identityById),
    },
    {
      id: "warehouse",
      header: "Warehouse",
      kind: "text",
      value: r => entityFilterText(r.warehouseId, codeById[r.warehouseId] ?? r.warehouseId, locationById, identityById),
      cell: r => resolveCell(r.warehouseId, codeById[r.warehouseId] ?? r.warehouseId, locationById, identityById),
    },
    {
      id: "distance",
      header: distanceHeaderLabel,
      filterLabel: distanceHeaderLabel,
      kind: "number",
      cellClassName: "font-mono",
      // Filter range is in the DISPLAY unit — the number the student reads in the cell.
      value: r => (canonicalResolved ? unit.toDisplay(r.distance, distanceUnit) : null),
      cell: r => (canonicalResolved ? unit.toDisplay(r.distance, distanceUnit).toFixed(1) : "—"),
    },
    {
      id: "flow",
      header: "Flow",
      kind: "number",
      cellClassName: "font-mono",
      value: r => r.flow,
      cell: r => r.flow.toLocaleString(),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [codeById, locationById, identityById, distanceHeaderLabel, canonicalResolved, distanceUnit, unit.pref]);

  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="assignments-empty">
        No solved result yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="overflow-auto flex-1 p-2">
        <DataTable<AssignmentRow>
          rows={rows}
          rowKey={r => r.customerId}
          columns={columns}
          ctx={{ readOnly: true, demandEditable: false }}
          testIds={{
            row: r => `assignment-row-${r.customerId}`,
            pager: "assignments-pager",
            pagerPrev: "button-assignments-prev",
            pagerNext: "button-assignments-next",
            pageIndicator: "assignments-page-indicator",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-assignments"
                itemTestIds={{ csv: "button-download-assignments-csv", json: "button-download-assignments-json" }}
                onDownload={format => download("assignments", format)}
                disabledReason={disabledReasonFor("assignments")}
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: the Step 3 command, then `pnpm --filter studio exec vitest run src/__tests__/Workspace.test.tsx`.
Expected (provisional): PASS — scratch `AssignmentsTab.test.tsx` 28, `Workspace.TabCoverage.test.tsx` 8.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-assignments\|assignments-pager\|assignments-page-indicator\|button-assignments-' artifacts/studio/e2e/` → no hits (re-run).
2. Matrix §3 "Assignments": `workspace-fixups-2.spec.ts` (`assignment-row-` prefix, count `> 10`, the structural `td.nth(0) .flex.flex-col` → 2 `span`s, second `font-mono`) still holds: page 1 shows 50 rows and `cell()` puts `EntityIdCell` directly in the `<td>` (P1 adapter rule, G12). `jade-two-echelon.spec.ts` hit is a comment.
3. Insert (from `artifacts/studio`):

```bash
python3 $H/insert-after.py e2e/workspace-fixups-2.spec.ts "expect(rowCount).toBeGreaterThan(10);" '// SCU-2.P3.2 — 200 customers now page at 50 (spec B2.2) and the table gains
// the shared filter menu (> 10 rows, every model).
expect(rowCount).toBe(50);
await expect(page.getByTestId("assignments-page-indicator")).toHaveText("Page 1 of 4");
await expect(page.getByTestId("button-filter-menu-trigger")).toBeVisible();'
```

(p-median-us has 200 customers, `solvers/p-median-us/dataset/customers.json`; every customer is assigned, so 4 pages.)

4. Local run, ports 3102/5202: `E2E_BASE_URL=http://localhost:5202 pnpm exec playwright test e2e/workspace-fixups-2.spec.ts e2e/tab-coverage.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8. Expected: every command exits 0.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.2 — Customer Assignments on DataTable

- Shared `AssignmentsTab` renders through `DataTable`: filter menu above 10 rows (new on every non-JADE model; entity columns filter on "City, ST id", Distance on the display-unit value), pager above 50 (p-median-us: 200 customers → 4 pages), Distance/Flow centred, Download ▾ CSV/JSON (server `assignments`).
- Deviations 1, 2, 8, 10. Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/AssignmentsTab.tsx artifacts/studio/src/__tests__/AssignmentsTab.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/e2e/workspace-fixups-2.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.2] move Customer Assignments onto DataTable" -m "Deviations 1, 2, 8 (filter values: City, ST id text; display-unit distance range), 10 (new filter + pager)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.3: JADE Customer Assignments on DataTable (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2 (shell pager replaces the local one), B2.4 (server `assignments`, JADE product-level shape), B2.10. **Matrix:** §2a "JadeAssignments", §3, G5 (count), G8 (band filter reset), §5 items 4–5. **Deviations:** 1, 2, 9, 10. **Depends on:** P3.1.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/JadeAssignmentsTab.tsx`
- Test: `artifacts/studio/src/__tests__/JadeAssignmentsTab.test.tsx`
- e2e: `artifacts/studio/e2e/jade-two-echelon.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: P1 `DataTable`, `ColumnDef` (incl. `filterResetKey`, `filterLabel`, `cellTestId`); `DownloadMenu` (P3.1); `bandLabel`, `bandRangeLabel`, `DEFAULT_DISTANCE_BANDS` (`lib/bands.ts`, unchanged).
- Produces: the testid map row "JadeAssignments" above. Deletes the local `PAGE_SIZE` and `Pager` (`JadeAssignmentsTab.tsx:166-206` at `46d2f98`).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Worktree, guards, install, helpers, anchor re-verification**

Branch check, guards, install, helpers, `H`. Then, each alone:
- `grep -c '^const PAGE_SIZE = 50;' artifacts/studio/src/components/workspace/tabs/JadeAssignmentsTab.tsx` → `1`
- `head -6 artifacts/studio/src/components/workspace/tabs/JadeAssignmentsTab.tsx` → the six import lines replaced in Step 4 (`useEffect, useMemo, useState`, `Dataset, SolveResult`, `ui/table`, `ui/button`, `FilterMenu`, `useTableFilters`)
- `grep -n 'data-testid' artifacts/studio/src/components/workspace/tabs/JadeAssignmentsTab.tsx` → the 15 literals of matrix §2a "JadeAssignments"
- `grep -c 'describe("JadeAssignmentsTab — no duplicate title (SCU-1.4)"' artifacts/studio/src/__tests__/JadeAssignmentsTab.test.tsx` → `1`

- [ ] **Step 2: Write the failing tests**

```bash
T=src/__tests__/JadeAssignmentsTab.test.tsx
perl -pi -e 's/^(\s*)await user\.click\(screen\.getByTestId\("button-download-jadeassignments-csv"\)\);/$1await user.click(screen.getByTestId("button-download-jadeassignments"));\n$1await user.click(screen.getByTestId("button-download-jadeassignments-csv"));/; s/const button = screen\.getByTestId\("button-download-jadeassignments-csv"\);/const button = screen.getByTestId("button-download-jadeassignments");/' $T
grep -c 'getByTestId("button-download-jadeassignments")' $T     # → 3
perl -pi -e 's/^import \{ render as rtlRender, screen, within \} from "\@testing-library\/react";/import { render as rtlRender, screen, within, fireEvent } from "\@testing-library\/react";/' $T
python3 $H/delete-block.py $T describe 'JadeAssignmentsTab — no duplicate title (SCU-1.4)' --with-comments
```

Append at EOF:

```tsx

// SCU-2.P3.3 (spec B2.1/B2.2/B2.4, matrix §2a "JadeAssignments") — DataTable
// migration emits every testid in the instance's map.
describe("JadeAssignmentsTab on DataTable — testid map (SCU-2.P3.3)", () => {
  const many = (n: number) =>
    makeResult(
      Array.from({ length: n }, (_, i) => ({
        customerId: `customer-${i + 1}`,
        warehouseId: i % 2 ? "wh-11" : "wh-14",
        productId: "product-1",
        distanceMi: 100 + i,
      })),
    );

  it("emits the tab root, count, row and five cell testids; Download ▾ trigger + items", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />);
    const key = "product-1|customer-1";
    const tab = screen.getByTestId("jade-assignments-tab");
    expect(within(tab).getByTestId(`row-jadeassignment-${key}`).tagName).toBe("TR");
    for (const col of ["product", "customer", "warehouse", "distance", "band"]) {
      expect(within(tab).getByTestId(`cell-jadeassignment-${col}-${key}`).tagName).toBe("TD");
    }
    expect(within(tab).getByTestId("text-jadeassignments-count")).toHaveTextContent("2 of 2");
    expect(within(tab).getByTestId("cell-jadeassignment-distance-" + key)).toHaveTextContent("42.1 mi");
    fireEvent.click(within(tab).getByTestId("button-download-jadeassignments"));
    expect(screen.getByTestId("button-download-jadeassignments-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-jadeassignments-json")).toBeInTheDocument();
  });

  it("JSON goes through the server export (entity assignments, format json)", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />);
    fireEvent.click(screen.getByTestId("button-download-jadeassignments"));
    fireEvent.click(screen.getByTestId("button-download-jadeassignments-json"));
    expect(spy).toHaveBeenCalledWith(1, "assignments", "json", { unit: "mi" });
    spy.mockRestore();
  });

  it("thead th texts stay exactly the e2e contract; only Distance is centred", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />);
    const heads = [...screen.getByTestId("jade-assignments-tab").querySelectorAll("thead th")];
    expect(heads.map(h => h.textContent)).toEqual(["Product", "Customer", "Assigned Warehouse", "Distance", "Distance Band"]);
    expect(heads.map(h => h.classList.contains("text-center"))).toEqual([false, false, false, true, false]);
    expect(screen.queryByText("Customer Assignments")).not.toBeInTheDocument(); // B1.4 kept
  });

  it("51 rows: shell pager with today's literals (prev/next/indicator); 50 rows: none", () => {
    const a = render(<JadeAssignmentsTab result={many(50)} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />);
    expect(screen.queryByTestId("jadeassignments-page-indicator")).toBeNull();
    a.unmount();
    render(<JadeAssignmentsTab result={many(51)} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />);
    expect(screen.getByTestId("jadeassignments-page-indicator")).toHaveTextContent("Page 1 of 2");
    expect(screen.getByTestId("button-jadeassignments-prev")).toBeDisabled();
    fireEvent.click(screen.getByTestId("button-jadeassignments-next"));
    expect(screen.getByTestId("jadeassignments-page-indicator")).toHaveTextContent("Page 2 of 2");
    expect(screen.getByTestId("row-jadeassignment-product-1|customer-51")).toBeInTheDocument();
    expect(screen.getByTestId("text-jadeassignments-count")).toHaveTextContent("51 of 51");
  });

  it("filter descriptor keys and types are today's: product/warehouse/band select, customer text, distance range", async () => {
    const user = userEvent.setup();
    render(<JadeAssignmentsTab result={many(30)} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />);
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    expect(screen.getByTestId("select-filter-product")).toBeInTheDocument();
    expect(screen.getByTestId("select-filter-warehouse")).toBeInTheDocument();
    expect(screen.getByTestId("select-filter-band")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-customer")).toBeInTheDocument();
    expect(screen.getByTestId("input-filter-distance-min")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/JadeAssignmentsTab.test.tsx`
Expected (provisional): FAIL — `Unable to find an element by: [data-testid="button-download-jadeassignments"]`; the centring test fails on `text-center`.

- [ ] **Step 4: Implement**

Replace the six import lines at the top of `JadeAssignmentsTab.tsx` (`import { useEffect, useMemo, useState } from "react";` through `import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";`) so the file begins:

```tsx
import { useMemo } from "react";
import type { Dataset, SolveResult } from "@workspace/api-client-react";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
```

(the remaining imports — `lib/bands`, `ExportContext`, `EntityIdCell`, `entityIdentity`, `UnitContext`, `@workspace/units` — stay). Replace everything from the line `const PAGE_SIZE = 50;` to the end of the file with:

```tsx
// SCU-2.P3.3 (spec B2.1/B2.2/B2.4) — rendered by the shared DataTable: the
// local PAGE_SIZE/Pager are replaced by the shell's (same literals); filter
// menu > 10 rows with today's descriptor keys/types; Download ▾ CSV/JSON.
// Behaviour change (spec B2.2): a filter change now returns to page 1 (today
// the page was only clamped).
export function JadeAssignmentsTab({
  result = null,
  dataset = null,
  bands = [],
  distanceUnit,
  scenarioId,
  displayedInputs = null,
  identityById,
}: JadeAssignmentsTabProps) {
  const unit = useDisplayUnit();
  const { download, disabledReasonFor } = useExport();
  const canonicalResolved = distanceUnit != null;
  const resolvedUnitLabel = canonicalResolved ? unit.effectiveUnit(distanceUnit) : null;
  const effectiveBands = bands.length > 0 ? bands : DEFAULT_DISTANCE_BANDS;
  const bandsKey = effectiveBands.join(",");

  const rows: JadeAssignmentRow[] = useMemo(() => {
    return extractAssignments(result).map(a => ({
      key: `${a.productId}|${a.customerId}`,
      productId: a.productId,
      productLabel: productLabel(a.productId, dataset),
      customerId: a.customerId,
      customerLabel: customerLabel(a.customerId, dataset, displayedInputs?.addedCustomers),
      warehouseId: a.warehouseId,
      warehouseLabel: warehouseLabel(a.warehouseId, dataset, displayedInputs?.addedWarehouses),
      distance: a.distanceMi,
      band: bandLabel(a.distanceMi, effectiveBands),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, dataset, displayedInputs, bandsKey]);

  // workspace-fixups-2 T10 — the `>10` identity upgrade reads the UNFILTERED count.
  const upgrade = rows.length > 10;

  const columns = useMemo<ColumnDef<JadeAssignmentRow>[]>(() => {
    // `bandRangeLabel` (lib/bands.ts) has no unit awareness of its own:
    // converting BOTH the boundaries and the distance to the display unit
    // keeps the printed range numerically correct.
    const displayBands = canonicalResolved ? effectiveBands.map(b => unit.toDisplay(b, distanceUnit)) : effectiveBands;
    return [
      { id: "product", header: "Product", kind: "enum", cellTestId: r => `cell-jadeassignment-product-${r.key}`, value: r => r.productLabel, cell: r => r.productLabel },
      {
        id: "customer",
        header: "Customer",
        kind: "text",
        filter: "text", // pinned: today's descriptor type
        cellTestId: r => `cell-jadeassignment-customer-${r.key}`,
        value: r => r.customerLabel,
        cell: r => renderJadeEntityCell(r.customerId, r.customerLabel, identityById, upgrade),
      },
      {
        id: "warehouse",
        header: "Assigned Warehouse",
        filterLabel: "Warehouse",
        kind: "text",
        filter: "select", // pinned: today's descriptor type, even above 20 warehouses
        cellTestId: r => `cell-jadeassignment-warehouse-${r.key}`,
        value: r => r.warehouseLabel,
        cell: r => renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, upgrade),
      },
      {
        id: "distance",
        header: "Distance",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jadeassignment-distance-${r.key}`,
        value: r => r.distance, // canonical value, as today's descriptor
        cell: r => (canonicalResolved ? `${unit.toDisplay(r.distance, distanceUnit).toFixed(1)} ${resolvedUnitLabel}` : "—"),
      },
      {
        id: "band",
        header: "Distance Band",
        kind: "enum",
        cellTestId: r => `cell-jadeassignment-band-${r.key}`,
        // The FILTER value is the unit-aware range label; the CELL keeps "Band N"/"Overflow".
        value: r => (canonicalResolved ? bandRangeLabel(unit.toDisplay(r.distance, distanceUnit), displayBands, resolvedUnitLabel!) : "—"),
        cell: r => r.band,
        // Workspace fixups T7 item 5 — a bands/unit change clears ONLY this filter.
        filterResetKey: `${bandsKey}|${distanceUnit ?? ""}|${unit.pref}`,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandsKey, distanceUnit, unit.pref, identityById, upgrade]);

  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="jade-assignments-empty">
        No solved result yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="jade-assignments-tab">
      <div className="overflow-auto flex-1 p-2">
        <DataTable<JadeAssignmentRow>
          rows={rows}
          rowKey={r => r.key}
          columns={columns}
          ctx={{ readOnly: true, demandEditable: false }}
          testIds={{
            row: r => `row-jadeassignment-${r.key}`,
            count: "text-jadeassignments-count",
            pagerPrev: "button-jadeassignments-prev",
            pagerNext: "button-jadeassignments-next",
            pageIndicator: "jadeassignments-page-indicator",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-jadeassignments"
                itemTestIds={{ csv: "button-download-jadeassignments-csv", json: "button-download-jadeassignments-json" }}
                onDownload={format => download("assignments", format)}
                disabledReason={disabledReasonFor("assignments")}
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter studio exec vitest run src/__tests__/JadeAssignmentsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): PASS — scratch 32 + 8. The pre-existing band tests ("rerendering with changed bands updates the filter options live", "selecting a band range then editing bands clears only the band filter…") pass unchanged: that is `filterResetKey` reproducing today's effect.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-jadeassignments\|jadeassignments-page-indicator\|button-jadeassignments-' artifacts/studio/e2e/` → no hits before this task (re-run).
2. Matrix §3 "JadeAssignments", each re-read, no rewrite: `jade-ch9-workspace-bundle.spec.ts` (`jade-assignments-tab`; first band cell "Overflow"; `thead th` == the five headers — the shell renders exactly the columns), `workspace-fixups.spec.ts` (scoped trigger inside `jade-assignments-tab` — the toolbar is inside that wrapper; band option labels by filter key `band`; the band clear on a band edit keeps the product filter — `filterResetKey`; page-1 distance cells), `workspace-fixups-2.spec.ts` (trigger, band labels, band cell texts), `jade-two-echelon.spec.ts` (`row-jadeassignment-` prefix; count "of 400").
3. Insert:

```bash
python3 $H/insert-after.py e2e/jade-two-echelon.spec.ts '.toContainText("of 400", { timeout: HEADER_TIMEOUT }); // 100 customers x 4 product families' '// SCU-2.P3.3 — the shell pager keeps today'"'"'s literals: 400 rows = 8 pages of 50.
await expect(page.getByTestId("jadeassignments-page-indicator")).toHaveText("Page 1 of 8");'
```

4. Local run, ports 3103/5203: `E2E_BASE_URL=http://localhost:5203 pnpm exec playwright test e2e/jade-two-echelon.spec.ts e2e/jade-ch9-workspace-bundle.spec.ts e2e/workspace-fixups.spec.ts e2e/workspace-fixups-2.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.3 — JADE Customer Assignments on DataTable

- `JadeAssignmentsTab` renders through `DataTable`; its local `PAGE_SIZE`/`Pager` are gone (the shell's pager keeps `button-jadeassignments-prev/next` + `jadeassignments-page-indicator`); count, cell testids, descriptor keys/types and the bands/unit-only band-filter reset (`filterResetKey`) preserved; Distance centred; Download ▾ CSV/JSON (server `assignments`).
- Behaviour change: a filter change now returns to page 1 (spec B2.2; today it only clamped). Deviations 1, 2, 9, 10. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/JadeAssignmentsTab.tsx artifacts/studio/src/__tests__/JadeAssignmentsTab.test.tsx artifacts/studio/e2e/jade-two-echelon.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.3] move JADE Customer Assignments onto DataTable" -m "Deviations 1, 2, 9 (customer text / warehouse select pinned), 10 (filter change resets to page 1)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.4: Flows (shared, non-JADE) on DataTable (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (server `flows`), B2.10. **Matrix:** §2a "Flows", §3 "Flows". **Deviations:** 1, 2, 8, 10; grounding G-3. **Depends on:** P3.1.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx`
- Test: `artifacts/studio/src/__tests__/FlowsTab.test.tsx`, `Workspace.TabCoverage.test.tsx`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: P1 `DataTable`, `ColumnDef`; `DownloadMenu` (P3.1); `Edge` (`@workspace/api-client-react`, type only).
- Produces: the testid map row "Flows" above; module-private `entityFilterText(id, locationById, identityById)`, `flowRowKey(edge)`.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Worktree, guards, install, helpers, anchor re-verification**

Branch check, guards, install, helpers, `H`. Then, each alone:
- `grep -c '^export function FlowsTab(' artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx` → `1`
- `grep -n 'data-testid' artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx` → `flows-empty`, `button-download-flows-csv`, `flow-row-…` only
- `grep -n '<FlowsTab ' artifacts/studio/src/pages/Workspace.tsx` → one mount, **no** `distanceUnit` prop (G-3; leave it)

- [ ] **Step 2: Write the failing tests**

```bash
T=src/__tests__/FlowsTab.test.tsx
perl -0pi -e 's|(import \{ makeExportProviderValue \} from "\@/__tests__/helpers/renderWithExportProvider";\n)|$1import { chooseDownload } from "\@/__tests__/helpers/downloadMenu";\n|' $T
perl -pi -e 's/fireEvent\.click\(screen\.getByTestId\("button-download-flows-csv"\)\);/chooseDownload("button-download-flows", "button-download-flows-csv");/g; s/const button = screen\.getByTestId\("button-download-flows-csv"\);/const button = screen.getByTestId("button-download-flows");/g' $T
grep -c 'chooseDownload' $T          # → 3
python3 $H/delete-block.py $T describe 'FlowsTab — no duplicate title (SCU-1.4)' --with-comments
perl -pi -e 's/tabTestId: "button-download-flows-csv"/tabTestId: "button-download-flows"/' src/__tests__/Workspace.TabCoverage.test.tsx
```

Append at EOF of `FlowsTab.test.tsx`:

```tsx

// SCU-2.P3.4 (spec B2.1/B2.2/B2.4, matrix §2a "Flows") — DataTable migration.
describe("FlowsTab on DataTable — testid map (SCU-2.P3.4)", () => {
  const many = (n: number) => ({
    ...transportResult,
    edges: Array.from({ length: n }, (_, i) => ({ fromId: `M${i % 3}`, toId: `S${i + 1}`, flow: i + 1, distance: 100 + i })),
  });

  it("emits flow-row-{from}-{to} and flow-row-{from}-{to}-{product} on <tr>s; Download ▾ trigger + items", () => {
    render(<FlowsTab result={jadeResult} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("flow-row-plant-1-wh-11-product-1").tagName).toBe("TR");
    expect(screen.getByTestId("flow-row-plant-1-wh-11-product-2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-download-flows"));
    expect(screen.getByTestId("button-download-flows-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-flows-json")).toBeInTheDocument();
  });

  it("emits flows-empty for no result", () => {
    render(<FlowsTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("flows-empty")).toBeInTheDocument();
  });

  it("JSON goes through the server export (entity flows, format json)", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<FlowsTab result={transportResult} scenarioId={1} distanceUnit="mi" />);
    chooseDownload("button-download-flows", "button-download-flows-json");
    expect(spy).toHaveBeenCalledWith(1, "flows", "json", { unit: "mi" });
    spy.mockRestore();
  });

  it("keeps header order (Product only when present) and centres Distance/Flow", () => {
    render(<FlowsTab result={transportResult} scenarioId={1} distanceUnit="mi" />);
    const heads = screen.getAllByRole("columnheader");
    expect(heads.map(h => h.textContent)).toEqual(["From", "To", "Distance (mi)", "Flow"]);
    expect(heads.map(h => h.classList.contains("text-center"))).toEqual([false, false, true, true]);
    expect(screen.queryByText("Flows", { selector: "span" })).not.toBeInTheDocument(); // B1.4 kept
  });

  it("11 rows: filter; 51 rows: pager with the mapped literals", () => {
    const a = render(<FlowsTab result={many(11)} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("flows-pager")).toBeNull();
    a.unmount();
    render(<FlowsTab result={many(51)} scenarioId={1} distanceUnit="mi" />);
    expect(screen.getByTestId("flows-page-indicator")).toHaveTextContent("Page 1 of 2");
    fireEvent.click(screen.getByTestId("button-flows-next"));
    expect(screen.getByTestId("flow-row-M2-S51")).toBeInTheDocument();
    expect(screen.getByTestId("button-flows-prev")).not.toBeDisabled();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/FlowsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): FAIL — `Unable to find an element by: [data-testid="button-download-flows"]`; TabCoverage fails at `flows` for transport-coal and two-echelon-gold-au.

- [ ] **Step 4: Implement**

In `FlowsTab.tsx`, replace the first line `import type { SolveResult } from "@workspace/api-client-react";` with

```tsx
import { useMemo } from "react";
import type { Edge, SolveResult } from "@workspace/api-client-react";
```

and after `import { EntityIdCell } from "@/components/tables/EntityIdCell";` add

```tsx
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
```

Replace everything from the line `export function FlowsTab({` to the end of the file with:

```tsx
// SCU-2.P3.4 — filter text for one entity cell (raw text, never the JSX):
// "City, ST id" when a location is known, else the display id.
function entityFilterText(
  id: string,
  locationById: Record<string, { city: string; state: string }> | undefined,
  identityById: Record<string, EntityIdentity> | undefined,
): string {
  const identity = identityById?.[id];
  if (identity) return identity.city || identity.state ? `${identity.city}, ${identity.state} ${identity.displayId}` : identity.displayId;
  const loc = locationById?.[id];
  return loc ? `${loc.city}, ${loc.state} ${id}` : id;
}

// Per-product plant->warehouse edges can share the same (fromId,toId) pair
// across products — the productId must be part of the row identity, or two
// products' rows would collide on both `key` and `data-testid`.
function flowRowKey(e: Edge): string {
  return e.productId != null ? `${e.fromId}-${e.toId}-${e.productId}` : `${e.fromId}-${e.toId}`;
}

// SCU-2.P3.4 (spec B2.1/B2.2/B2.4) — rendered by the shared DataTable: filter
// menu > 10 rows, pager > 50, number columns centred, Download ▾ CSV/JSON
// (server `flows`).
export function FlowsTab({ result, scenarioId, locationById, identityById, distanceUnit }: FlowsTabProps) {
  const unit = useDisplayUnit();
  const { download, disabledReasonFor } = useExport();
  const canonicalResolved = distanceUnit != null;
  const distanceHeaderLabel = canonicalResolved ? `Distance (${unit.effectiveUnit(distanceUnit)})` : "Distance";
  const rows = useMemo(() => (result ? flowRows(result) : []), [result]);
  // jade-T14 — Product column only when at least one row carries a productId
  // (data-driven, never gated on modelId).
  const hasProduct = rows.some(r => r.productId != null);

  const columns = useMemo<ColumnDef<Edge>[]>(() => {
    const cols: ColumnDef<Edge>[] = [
      { id: "from", header: "From", kind: "text", value: e => entityFilterText(e.fromId, locationById, identityById), cell: e => resolveCell(e.fromId, locationById, identityById) },
      { id: "to", header: "To", kind: "text", value: e => entityFilterText(e.toId, locationById, identityById), cell: e => resolveCell(e.toId, locationById, identityById) },
    ];
    if (hasProduct) cols.push({ id: "product", header: "Product", kind: "enum", value: e => e.productId ?? null, cell: e => e.productId ?? "—" });
    cols.push(
      {
        id: "distance",
        header: distanceHeaderLabel,
        kind: "number",
        cellClassName: "font-mono",
        value: e => (canonicalResolved ? unit.toDisplay(e.distance, distanceUnit) : null),
        cell: e => (canonicalResolved ? unit.toDisplay(e.distance, distanceUnit).toFixed(1) : "—"),
      },
      { id: "flow", header: "Flow", kind: "number", cellClassName: "font-mono", value: e => e.flow, cell: e => e.flow.toLocaleString() },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationById, identityById, hasProduct, distanceHeaderLabel, canonicalResolved, distanceUnit, unit.pref]);

  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="flows-empty">No solved result yet.</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="overflow-auto flex-1 p-2">
        <DataTable<Edge>
          rows={rows}
          rowKey={flowRowKey}
          columns={columns}
          ctx={{ readOnly: true, demandEditable: false }}
          testIds={{
            row: e => `flow-row-${flowRowKey(e)}`,
            pager: "flows-pager",
            pagerPrev: "button-flows-prev",
            pagerNext: "button-flows-next",
            pageIndicator: "flows-page-indicator",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-flows"
                itemTestIds={{ csv: "button-download-flows-csv", json: "button-download-flows-json" }}
                onDownload={format => download("flows", format)}
                disabledReason={disabledReasonFor("flows")}
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: the Step 3 command. Expected (provisional): PASS — scratch 25 + 8.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-flows\|flows-pager\|flows-page-indicator\|button-flows-' artifacts/studio/e2e/` → no hits.
2. Matrix §3 "Flows": the only hit (`jade-two-echelon.spec.ts`) is a comment. **No spec opens the non-JADE Flows tab** (grep `sidebar-output-flows`: only JADE specs), so this task adds no e2e line; P3.10's real-browser pass covers transport-coal and two-echelon-gold-au Flows.
3. Local run, ports 3104/5204: `E2E_BASE_URL=http://localhost:5204 pnpm exec playwright test e2e/tab-coverage.spec.ts e2e/two-echelon.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.4 — Flows on DataTable

- Shared `FlowsTab` (transport-coal, two-echelon-gold-au) renders through `DataTable`: filter above 10 rows (new), pager above 50, Distance/Flow centred, Download ▾ CSV/JSON (server `flows`); `flow-row-{from}-{to}[-{product}]` kept.
- Unchanged and flagged (G-3): `Workspace.tsx` still mounts `FlowsTab` without `distanceUnit`, so distances read "—". Deviations 1, 2, 8, 10. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx artifacts/studio/src/__tests__/FlowsTab.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx docs/CHANGELOG-implementation.md -m "[SCU-2.P3.4] move Flows onto DataTable" -m "Deviations 1, 2, 8, 10. G-3 (missing distanceUnit at the Workspace call site) left as-is and flagged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.5: JADE Flows Plant → Warehouse on DataTable + typed client export (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (client-built, typed rows, `jade-flows-plant-warehouse.{csv,json}`), B2.10. **Matrix:** §2a "JadeFlows P→W", §3, G3 (root testid contains toolbar + `thead`), G14 (two menus on one tab), G18. **Deviations:** 1, 2, 3, 6, 10. **Depends on:** P3.1.

**Files:**
- Create: `artifacts/studio/src/lib/jadeFlowsExport.ts`, `artifacts/studio/src/__tests__/jadeFlowsExport.test.ts`
- Modify: `artifacts/studio/src/lib/clientCsv.ts` (append), `artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx`
- Test: `artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx`
- e2e: `artifacts/studio/e2e/jade-two-echelon.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: P1 `DataTable`, `ColumnDef`; `DownloadMenu` (P3.1); Bundle 1 `csvCell`, `downloadTextFile` (`lib/clientCsv.ts`).
- Produces: `ClientExportEnvelope`, `clientRowsToCsv`, `downloadClientExport` (`lib/clientCsv.ts`); `PlantWarehouseExportRow`, `WarehouseCustomerExportRow`, `PLANT_WAREHOUSE_EXPORT_COLUMNS`, `WAREHOUSE_CUSTOMER_EXPORT_COLUMNS`, `plantWarehouseExportRows`, `warehouseCustomerExportRows` (`lib/jadeFlowsExport.ts`; the W→C half is consumed by P3.6). The testid map row "JadeFlows P→W" above.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Worktree, guards, install, helpers, anchor re-verification**

Branch check, guards, install, helpers, `H`. Then `F=artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx` and, each alone:
- `grep -c 'import { downloadClientCsv } from "@/lib/clientCsv";' "$F"` → `1` (Bundle 1 SCU-1.3)
- `grep -c 'export function downloadClientCsv' artifacts/studio/src/lib/clientCsv.ts` → `1`
- `grep -cF '  const pwDescriptors: ColumnFilterDescriptor<PlantWarehouseRow>[] = useMemo(' "$F"` → `1`; the same `grep -cF` → `1` for each of `  const wcDescriptors: ColumnFilterDescriptor<WarehouseCustomerRow>[] = useMemo(`, `  function handleDownloadPw() {`, `  function handleDownloadWc() {`, `  const segmentedControl = (`, `    pwFilters.setFilter("band", undefined);`
- `grep -c '<span className="text-sm font-medium">Flows</span>' "$F"` → `0` (Bundle 1 SCU-1.4 removed it)
- `grep -n 'data-testid' "$F"` → the literals of matrix §2a "JadeFlows P→W" + "JadeFlows W→C"
- `grep -c "describe(\"JadeFlowsTab — no duplicate tab-level title (SCU-1.4)\"" artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx` → `1`

- [ ] **Step 2: Write the failing tests**

Create `artifacts/studio/src/__tests__/jadeFlowsExport.test.ts`:

```ts
// SCU-2.P3.5 (spec B2.4) — JADE Flows typed row builders + the shared
// client export writer. Fixture shapes copy solve.py's JADE emission
// (`solve.py:1350-1353` per-product inbound edges; `:1370-1373`
// details.assignments; `:1387-1391` per-customer outbound edges).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  plantWarehouseExportRows,
  warehouseCustomerExportRows,
  PLANT_WAREHOUSE_EXPORT_COLUMNS,
  WAREHOUSE_CUSTOMER_EXPORT_COLUMNS,
} from "@/lib/jadeFlowsExport";
import * as clientCsv from "@/lib/clientCsv";

const base = { status: "optimal" as const, objective: 1, runTimeSec: 1, quality: "Proven optimal", metrics: {}, solverUsed: "CBC", infeasibilityReason: null };
const edges = [
  { fromId: "plant-1", toId: "wh-11", flow: 1000, distance: 100, leg: "plant_to_warehouse" as const, productId: "product-1" },
  { fromId: "plant-1", toId: "wh-11", flow: 400, distance: 100, leg: "plant_to_warehouse" as const, productId: "product-2" },
  { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 10, leg: "warehouse_to_customer" as const },
];
const assignments = [
  { customerId: "customer-1", warehouseId: "wh-11", productId: "product-1", flow: 300, distanceMi: 10 },
  { customerId: "customer-1", warehouseId: "wh-11", productId: "product-2", flow: 200, distanceMi: 10 },
];
const toKm = (mi: number) => mi * 1.609344;

afterEach(() => vi.restoreAllMocks());

describe("plantWarehouseExportRows", () => {
  it("one row per inbound edge (per product, NOT the on-screen per-pair sum), distance in the display unit", () => {
    expect(plantWarehouseExportRows({ ...base, edges, details: {} }, toKm)).toEqual([
      { plantId: "plant-1", toId: "wh-11", product: "product-1", flow: 1000, distance: 160.9344 },
      { plantId: "plant-1", toId: "wh-11", product: "product-2", flow: 400, distance: 160.9344 },
    ]);
  });
});

describe("warehouseCustomerExportRows", () => {
  it("reads details.assignments: one row per (customer, product)", () => {
    expect(warehouseCustomerExportRows({ ...base, edges, details: { assignments } }, d => d)).toEqual([
      { warehouseId: "wh-11", toId: "customer-1", product: "product-1", flow: 300, distance: 10 },
      { warehouseId: "wh-11", toId: "customer-1", product: "product-2", flow: 200, distance: 10 },
    ]);
  });

  it("falls back to outbound edges (product null) when details.assignments is absent", () => {
    expect(warehouseCustomerExportRows({ ...base, edges, details: {} }, d => d)).toEqual([
      { warehouseId: "wh-11", toId: "customer-1", product: null, flow: 500, distance: 10 },
    ]);
  });
});

describe("clientRowsToCsv / downloadClientExport", () => {
  const envelope = {
    entity: "jadeFlowsPlantWarehouse",
    unit: "mi",
    rows: [{ plantId: "plant-1", toId: "wh-11", product: null, flow: 1000, distance: 100.5 }],
  };

  it("CSV = one column per row key in order, trailing unit column, null → empty", () => {
    expect(clientCsv.clientRowsToCsv(PLANT_WAREHOUSE_EXPORT_COLUMNS, envelope)).toBe(
      "plantId,toId,product,flow,distance,unit\nplant-1,wh-11,,1000,100.5,mi",
    );
  });

  it("no unit on the envelope → no unit column", () => {
    expect(clientCsv.clientRowsToCsv(["plantId"], { entity: "x", rows: [{ plantId: "a,b" }] })).toBe('plantId\n"a,b"');
  });

  it("downloads {base}.json as the envelope itself and {base}.csv as text/csv", () => {
    // downloadClientExport calls downloadTextFile inside the same module, so
    // spy at the DOM boundary: the Blob parts + the anchor's download name.
    const RealBlob = globalThis.Blob;
    const blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation((parts, opts) => new RealBlob(parts, opts));
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    clientCsv.downloadClientExport("jade-flows-plant-warehouse", "json", PLANT_WAREHOUSE_EXPORT_COLUMNS, envelope);
    clientCsv.downloadClientExport("jade-flows-plant-warehouse", "csv", PLANT_WAREHOUSE_EXPORT_COLUMNS, envelope);
    expect(names).toEqual(["jade-flows-plant-warehouse.json", "jade-flows-plant-warehouse.csv"]);
    expect(blobSpy.mock.calls[0][0]?.[0]).toBe(JSON.stringify(envelope, null, 2));
    expect(blobSpy.mock.calls[0][1]).toEqual({ type: "application/json" });
    expect(blobSpy.mock.calls[1][0]?.[0]).toBe(clientCsv.clientRowsToCsv(PLANT_WAREHOUSE_EXPORT_COLUMNS, envelope));
    expect(blobSpy.mock.calls[1][1]).toEqual({ type: "text/csv" });
    expect(WAREHOUSE_CUSTOMER_EXPORT_COLUMNS).toEqual(["warehouseId", "toId", "product", "flow", "distance"]);
  });
});
```

Edit `JadeFlowsTab.test.tsx` (from `artifacts/studio`; each line names the test it edits):

```bash
# SCU-2.P3.5 — JadeFlowsTab.test.tsx edits (run from artifacts/studio). $H = helper dir.
T=src/__tests__/JadeFlowsTab.test.tsx
set -e
python3 $H/scoped-replace.py $T "switches to the Warehouse -> Customer inner tab on click" 'expect(screen.queryByTestId("jade-flows-pw-table")).not.toBeInTheDocument();' 'expect(screen.getByTestId("jade-flows-pw-table")).not.toBeVisible(); // SCU-2.P3.5: kept mounted (filters survive a leg switch), hidden'
python3 $H/scoped-replace.py $T "hides the FilterMenu on Plant -> Warehouse when unfiltered row count is <= 10" '"button-filter-menu-trigger"' '"button-filter-jade-flows-pw"'
python3 $H/scoped-replace.py $T "shows the FilterMenu on Plant -> Warehouse when unfiltered row count is > 10" '"button-filter-menu-trigger"' '"button-filter-jade-flows-pw"'
python3 $H/scoped-replace.py $T "filtering via the FilterMenu narrows the visible Plant -> Warehouse rows" '"button-filter-menu-trigger"' '"button-filter-jade-flows-pw"'
python3 $H/scoped-replace.py $T "editing bands re-ranges the filter options live on a rerender" '"button-filter-menu-trigger"' '"button-filter-jade-flows-pw"'
python3 $H/scoped-replace.py $T "Plant -> Warehouse crossing >10 does NOT show the FilterMenu" 'screen.getByTestId("button-filter-menu-trigger")' 'screen.getByTestId("button-filter-jade-flows-pw")'
python3 $H/scoped-replace.py $T "both inner tables' Distance Band filter dropdown" '"button-filter-menu-trigger"' '"button-filter-jade-flows-pw"' 1
python3 $H/scoped-replace.py $T "selecting a range in EACH inner table" '"button-filter-menu-trigger"' '"button-filter-jade-flows-pw"' 1,4
python3 $H/delete-block.py $T it "Plant -> Warehouse 'Download CSV' produces a client-side CSV"
python3 $H/scoped-replace.py $T "renders no tab-level 'Flows' title" '"button-download-jade-flows-pw-csv"' '"button-download-jade-flows-pw"'
```

The deleted test asserted the old on-screen-column CSV (`plant-to-warehouse-flows.csv`, header `Plant,Warehouse,Distance,Flow,Distance Band`), which spec B2.4 replaces with typed rows. Append at EOF:

```tsx

// SCU-2.P3.5 (spec B2.1/B2.2/B2.4, matrix §2a "JadeFlows P→W") — Plant ->
// Warehouse on DataTable: every testid in the instance map, Download ▾ with
// typed client-built CSV + JSON (jade-flows-plant-warehouse.{csv,json}).
describe("JadeFlowsTab P→W on DataTable — testid map + client export (SCU-2.P3.5)", () => {
  function captureDownloads() {
    const RealBlob = globalThis.Blob;
    const blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation((parts, opts) => new RealBlob(parts, opts));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    return { names, text: (i: number) => blobSpy.mock.calls[i][0]?.[0] as string };
  }

  it("emits the root, count, row and five cell testids", () => {
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    const root = screen.getByTestId("jade-flows-pw-table");
    const key = "plant-1|wh-11";
    expect(within(root).getByTestId("jade-flow-pw-row-plant-1-wh-11").tagName).toBe("TR");
    for (const col of ["plant", "warehouse", "distance", "flow", "band"]) {
      expect(within(root).getByTestId(`cell-jade-flow-pw-${col}-${key}`).tagName).toBe("TD");
    }
    expect(within(root).getByTestId("text-jadeflows-pw-count")).toHaveTextContent("2 of 2");
    expect(within(root).getByTestId("button-download-jade-flows-pw")).toHaveTextContent("Download");
    // thead th texts are the e2e contract (jade-ch9-workspace-bundle.spec.ts:407-408)
    expect([...root.querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Plant", "Warehouse", "Distance", "Flow", "Distance Band"]);
    expect([...root.querySelectorAll("thead th")].map(th => th.classList.contains("text-center"))).toEqual([false, false, true, true, false]);
  });

  it("CSV: typed rows (per product, raw ids, display-unit distance, unit column) as jade-flows-plant-warehouse.csv", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-csv"));
    expect(dl.names).toEqual(["jade-flows-plant-warehouse.csv"]);
    expect(dl.text(0).split("\n")).toEqual([
      "plantId,toId,product,flow,distance,unit",
      "plant-1,wh-11,product-1,1000,293.66,mi",
      "plant-1,wh-11,product-2,400,293.66,mi",
      "plant-2,wh-14,product-1,300,1200,mi",
    ]);
  });

  it("JSON: the envelope { entity, unit, rows } as jade-flows-plant-warehouse.json — all rows, not the filtered page", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-json"));
    expect(dl.names).toEqual(["jade-flows-plant-warehouse.json"]);
    const doc = JSON.parse(dl.text(0));
    expect(doc.entity).toBe("jadeFlowsPlantWarehouse");
    expect(doc.unit).toBe("mi");
    expect(doc.rows).toHaveLength(3);
    expect(doc.rows[0]).toEqual({ plantId: "plant-1", toId: "wh-11", product: "product-1", flow: 1000, distance: 293.66 });
  });

  it("Download ▾ is disabled while the canonical unit is unresolved", () => {
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
    expect(screen.getByTestId("button-download-jade-flows-pw")).toBeDisabled();
  });

  it("> 50 rows: pager with jade-flows-pw literals", async () => {
    const user = userEvent.setup();
    const edges = Array.from({ length: 51 }, (_, i) => ({
      fromId: `plant-${i + 1}`, toId: "wh-11", flow: 1, distance: 10, leg: "plant_to_warehouse" as const, productId: "product-1",
    }));
    render(<JadeFlowsTab result={makeResult(edges)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    expect(screen.getByTestId("jade-flows-pw-page-indicator")).toHaveTextContent("Page 1 of 2");
    await user.click(screen.getByTestId("button-jade-flows-pw-next"));
    expect(screen.getByTestId("jade-flow-pw-row-plant-51-wh-11")).toBeInTheDocument();
    expect(screen.getByTestId("button-jade-flows-pw-prev")).not.toBeDisabled();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/jadeFlowsExport.test.ts src/__tests__/JadeFlowsTab.test.tsx`
Expected (provisional): FAIL — `jadeFlowsExport.test.ts`: `Failed to resolve import "@/lib/jadeFlowsExport"`; `JadeFlowsTab.test.tsx`: `Unable to find an element by: [data-testid="button-filter-jade-flows-pw"]`, `…[data-testid="button-download-jade-flows-pw"]`, and "switches to the Warehouse -> Customer inner tab" fails (`jade-flows-pw-table` is not in the document yet).

- [ ] **Step 4: Implement**

Append to `artifacts/studio/src/lib/clientCsv.ts`:

```ts

// SCU-2.P3.5 (spec B2.4) — client-built exports' shared envelope + writer.
// JSON is the envelope itself `{ entity, unit?, rows }`; CSV is one column per
// row key (in `columns` order) plus a trailing `unit` column when the
// envelope carries one. `null` → empty cell. Row types must be `type`
// aliases (an `interface` has no index signature).
export interface ClientExportEnvelope<R> {
  entity: string;
  unit?: string;
  rows: R[];
}

type ClientRow = Record<string, string | number | null>;

export function clientRowsToCsv<R extends ClientRow>(columns: Array<keyof R & string>, envelope: ClientExportEnvelope<R>): string {
  const unit = envelope.unit;
  const header: string[] = unit == null ? [...columns] : [...columns, "unit"];
  const lines = envelope.rows.map(r => {
    const cells = columns.map(c => r[c] ?? "");
    return unit == null ? cells : [...cells, unit];
  });
  return [header, ...lines].map(l => l.map(csvCell).join(",")).join("\n");
}

export function downloadClientExport<R extends ClientRow>(
  baseName: string,
  format: "csv" | "json",
  columns: Array<keyof R & string>,
  envelope: ClientExportEnvelope<R>,
): void {
  if (format === "csv") downloadTextFile(`${baseName}.csv`, clientRowsToCsv(columns, envelope), "text/csv");
  else downloadTextFile(`${baseName}.json`, JSON.stringify(envelope, null, 2), "application/json");
}
```

Create `artifacts/studio/src/lib/jadeFlowsExport.ts`:

```ts
// SCU-2.P3.5/P3.6 (spec B2.4) — typed row builders for JADE Flows' two
// client-built exports. Built from the solved RESULT, never from rendered
// column values: raw ids, one row per product where the result has one,
// distance converted to the active display unit (the unit goes in the
// envelope). Scope = all rows (never filtered or paged).
import type { SolveResult } from "@workspace/api-client-react";

export type PlantWarehouseExportRow = {
  plantId: string;
  toId: string;
  product: string | null;
  flow: number;
  distance: number;
};

export type WarehouseCustomerExportRow = {
  warehouseId: string;
  toId: string;
  product: string | null;
  flow: number | null;
  distance: number;
};

export const PLANT_WAREHOUSE_EXPORT_COLUMNS: Array<keyof PlantWarehouseExportRow> = ["plantId", "toId", "product", "flow", "distance"];
export const WAREHOUSE_CUSTOMER_EXPORT_COLUMNS: Array<keyof WarehouseCustomerExportRow> = ["warehouseId", "toId", "product", "flow", "distance"];

/** One row per `plant_to_warehouse` edge — solve.py emits these per product. */
export function plantWarehouseExportRows(result: SolveResult, toDisplay: (canonical: number) => number): PlantWarehouseExportRow[] {
  return result.edges
    .filter(e => e.leg === "plant_to_warehouse")
    .map(e => ({ plantId: e.fromId, toId: e.toId, product: e.productId ?? null, flow: e.flow, distance: toDisplay(e.distance) }));
}

interface JadeAssignmentDetail {
  customerId: string;
  warehouseId: string;
  productId: string;
  distanceMi: number;
  flow?: number;
}

/** One row per (customer, product) from `details.assignments` (solve.py's
 * per-product outbound record). A result without it falls back to the
 * per-customer `warehouse_to_customer` edges, product null. */
export function warehouseCustomerExportRows(result: SolveResult, toDisplay: (canonical: number) => number): WarehouseCustomerExportRow[] {
  const assignments = (result.details as { assignments?: JadeAssignmentDetail[] } | undefined)?.assignments ?? [];
  if (assignments.length > 0) {
    return assignments.map(a => ({
      warehouseId: a.warehouseId,
      toId: a.customerId,
      product: a.productId,
      flow: a.flow ?? null,
      distance: toDisplay(a.distanceMi),
    }));
  }
  return result.edges
    .filter(e => e.leg === "warehouse_to_customer")
    .map(e => ({ warehouseId: e.fromId, toId: e.toId, product: null, flow: e.flow, distance: toDisplay(e.distance) }));
}
```

In `JadeFlowsTab.tsx`:

(a) Replace `import { downloadClientCsv } from "@/lib/clientCsv";` with:

```tsx
import { downloadClientCsv, downloadClientExport } from "@/lib/clientCsv";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import { PLANT_WAREHOUSE_EXPORT_COLUMNS, plantWarehouseExportRows } from "@/lib/jadeFlowsExport";
```

(b) Replace everything from the line `  const pwDescriptors: ColumnFilterDescriptor<PlantWarehouseRow>[] = useMemo(` up to, **not** including, the line `  const wcDescriptors: ColumnFilterDescriptor<WarehouseCustomerRow>[] = useMemo(` with:

```tsx
  // SCU-2.P3.5 (spec B2.1/B2.2) — Plant -> Warehouse is a DataTable. Column
  // ids are today's descriptor keys (e2e selects filters by key); the `band`
  // FILTER value is the unit-aware range label while the CELL keeps the row's
  // "Band N"/"Overflow"; `filterResetKey` clears ONLY that filter when the
  // bands or the unit change (Workspace fixups T6 item 5).
  const pwUpgrade = pwRows.length > 10;
  const pwColumns = useMemo<ColumnDef<PlantWarehouseRow>[]>(
    () => [
      {
        id: "plant",
        header: "Plant",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-pw-plant-${r.key}`,
        value: r => r.plantLabel,
        cell: r => renderJadeEntityCell(r.plantId, r.plantLabel, identityById, pwUpgrade),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-pw-warehouse-${r.key}`,
        value: r => r.warehouseLabel,
        cell: r => renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, pwUpgrade),
      },
      {
        id: "distance",
        header: "Distance",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-pw-distance-${r.key}`,
        value: r => r.distance,
        cell: r => formatRowDistance(r.distance),
      },
      {
        id: "flow",
        header: "Flow",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-pw-flow-${r.key}`,
        value: r => r.flow,
        cell: r => r.flow.toLocaleString(),
      },
      {
        id: "band",
        header: "Distance Band",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-pw-band-${r.key}`,
        value: r =>
          canonicalResolved
            ? bandRangeLabel(unit.toDisplay(r.distance, distanceUnit), displayBands, resolvedUnitLabel!)
            : "—",
        cell: r => r.band,
        filterResetKey: `${effectiveBands.join(",")}|${distanceUnit ?? ""}|${unit.pref}`,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveBands.join(","), distanceUnit, unit.pref, identityById, pwUpgrade],
  );

```

(c) Replace

```tsx
  // Both hooks are called unconditionally regardless of which inner tab is
  // active (Rules of Hooks) — only the active tab's table + FilterMenu are
  // rendered below.
  const pwFilters = useTableFilters(pwRows, pwDescriptors);
  const wcFilters = useTableFilters(wcRows, wcDescriptors);
```

with

```tsx
  const wcFilters = useTableFilters(wcRows, wcDescriptors);
```

(d) Delete the P→W band-reset effect: from the line `  useEffect(() => {` whose next line is `    pwFilters.setFilter("band", undefined);` through its closing `  }, [effectiveBands.join(","), distanceUnit, unit.pref]);` (the W→C effect after it stays).

(e) Delete the whole `  function handleDownloadPw() { … }` block (`handleDownloadWc` stays).

(f) Directly before the line `  const segmentedControl = (`, insert:

```tsx
  const solved = result;

```

(g) Replace the JSX from the line `    <div className="flex flex-col h-full overflow-hidden" data-testid="jade-flows-tab">` to the end of the file with:

```tsx
    <div className="flex flex-col h-full overflow-hidden" data-testid="jade-flows-tab">
      <div className="flex items-center justify-between gap-2 p-2 border-b flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          {segmentedControl}
        </div>
        {innerTab === "warehouse-customer" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" data-testid="text-jadeflows-wc-count">
              {wcFilters.filteredCount} of {wcFilters.totalCount}
            </span>
            {wcFilters.totalCount > 10 && <FilterMenu descriptors={wcDescriptors} tableFilters={wcFilters} />}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid="button-download-jade-flows-wc-csv"
              onClick={handleDownloadWc}
            >
              Download CSV
            </Button>
          </div>
        )}
      </div>

      {/* SCU-2.P3.5 — Plant -> Warehouse stays MOUNTED while the other leg is
          shown (hidden), so its filter state survives a leg switch exactly as
          today's parent-held filter hooks did; hence its own trigger testid. */}
      <div className="overflow-auto flex-1 p-2" hidden={innerTab !== "plant-warehouse"}>
        <DataTable<PlantWarehouseRow>
            rows={pwRows}
            rowKey={r => r.key}
            columns={pwColumns}
            ctx={{ readOnly: true, demandEditable: false }}
            testIds={{
              root: "jade-flows-pw-table",
              row: r => `jade-flow-pw-row-${r.plantId}-${r.warehouseId}`,
              count: "text-jadeflows-pw-count",
              pagerPrev: "button-jade-flows-pw-prev",
              pagerNext: "button-jade-flows-pw-next",
              pageIndicator: "jade-flows-pw-page-indicator",
              filterTrigger: "button-filter-jade-flows-pw",
            }}
            toolbar={{
              download: (
                <DownloadMenu
                  testId="button-download-jade-flows-pw"
                  itemTestIds={{ csv: "button-download-jade-flows-pw-csv", json: "button-download-jade-flows-pw-json" }}
                  disabledReason={canonicalResolved ? undefined : "Loading…"}
                  onDownload={format =>
                    downloadClientExport("jade-flows-plant-warehouse", format, PLANT_WAREHOUSE_EXPORT_COLUMNS, {
                      entity: "jadeFlowsPlantWarehouse",
                      unit: resolvedUnitLabel!,
                      rows: plantWarehouseExportRows(solved, d => unit.toDisplay(d, distanceUnit!)),
                    })
                  }
                />
              ),
            }}
          />
      </div>
      {innerTab === "warehouse-customer" && (
        <div className="overflow-auto flex-1" data-testid="jade-flows-wc-table">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Warehouse</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Distance</TableHead>
                <TableHead className="text-right">Flows</TableHead>
                <TableHead>Distance Band</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wcFilters.filteredRows.map(r => (
                <TableRow key={r.key} data-testid={`jade-flow-wc-row-${r.warehouseId}-${r.customerId}`}>
                  <TableCell data-testid={`cell-jade-flow-wc-warehouse-${r.key}`}>
                    {renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, wcRows.length > 10)}
                  </TableCell>
                  <TableCell data-testid={`cell-jade-flow-wc-customer-${r.key}`}>
                    {renderJadeEntityCell(r.customerId, r.customerLabel, identityById, wcRows.length > 10)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`cell-jade-flow-wc-distance-${r.key}`}>
                    {formatRowDistance(r.distance)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`cell-jade-flow-wc-flow-${r.key}`}>
                    {r.flow.toLocaleString()}
                  </TableCell>
                  <TableCell data-testid={`cell-jade-flow-wc-band-${r.key}`}>{r.band}</TableCell>
                </TableRow>
              ))}
              {wcFilters.filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-xs text-muted-foreground text-center py-3">
                    No rows match the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/jadeFlowsExport.test.ts src/__tests__/JadeFlowsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): PASS — scratch 6 + 42 + 8.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'plant-to-warehouse-flows\|button-download-jade-flows-pw\|button-filter-jade-flows\|jade-flows-pw-page-indicator\|button-jade-flows-pw-' artifacts/studio/e2e/` → no hits.
2. Matrix §3 "JadeFlows P→W": `jade-ch9-workspace-bundle.spec.ts` (`jade-flows-tab`; P→W `aria-pressed="true"`; `[data-testid="jade-flows-pw-table"] thead th` == `["Plant","Warehouse","Distance","Flow","Distance Band"]` — the root now also holds the toolbar, which has no `th`; W→C click + `jade-flows-wc-table` visible, unchanged this task); `jade-two-echelon.spec.ts` (`jade-flow-pw-row-` prefix; `jade-flow-pw-row-plant-4-wh-11` visible — ≤ 8 aggregated P→W rows, page 1). No rewrite.
3. Insert:

```bash
python3 $H/insert-after.py e2e/jade-two-echelon.spec.ts "await expect(page.locator('[data-testid^=\"jade-flow-pw-row-\"]').first()).toBeVisible({ timeout: HEADER_TIMEOUT });" '// SCU-2.P3.5 — client-built Download ▾ offers CSV and JSON (spec B2.4).
await page.getByTestId("button-download-jade-flows-pw").click();
await expect(page.getByTestId("button-download-jade-flows-pw-csv")).toBeVisible();
await expect(page.getByTestId("button-download-jade-flows-pw-json")).toBeVisible();
await page.keyboard.press("Escape");'
```

4. Local run, ports 3105/5205: `E2E_BASE_URL=http://localhost:5205 pnpm exec playwright test e2e/jade-two-echelon.spec.ts e2e/jade-ch9-workspace-bundle.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.5 — JADE Flows Plant → Warehouse on DataTable + typed export

- P→W renders through `DataTable` (root `jade-flows-pw-table`, count, cell testids, band range filter + bands/unit reset kept); it stays mounted while W→C is shown (`hidden`), so its filters survive a leg switch, with its own trigger `button-filter-jade-flows-pw`. Download ▾ CSV/JSON is client-built from typed rows (`lib/jadeFlowsExport.ts`: one row per inbound edge = per product; raw ids; display-unit distance; `unit` column/envelope) as `jade-flows-plant-warehouse.{csv,json}` (was `plant-to-warehouse-flows.csv` of on-screen columns). `lib/clientCsv.ts` gains `downloadClientExport`.
- Deviations 1, 2, 3, 6, 10. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
git add artifacts/studio/src/lib/jadeFlowsExport.ts artifacts/studio/src/__tests__/jadeFlowsExport.test.ts
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/lib/jadeFlowsExport.ts artifacts/studio/src/__tests__/jadeFlowsExport.test.ts artifacts/studio/src/lib/clientCsv.ts artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx artifacts/studio/e2e/jade-two-echelon.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.5] move JADE Flows plant-to-warehouse onto DataTable with typed export" -m "Deviations 1, 2, 3 (leg stays mounted; own trigger testid), 6 (per-product typed rows, unit column), 10." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.6: JADE Flows Warehouse → Customer on DataTable + typed client export (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (`jade-flows-warehouse-customer.{csv,json}`), B2.10. **Matrix:** §2a "JadeFlows W→C", §3, G14. **Deviations:** 1, 2, 3, 6, 9 (`customer` text), 10, 11. **Depends on:** P3.5.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx`, `artifacts/studio/src/lib/clientCsv.ts` (delete `downloadClientCsv`)
- Test: `artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx`
- e2e: `artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: P3.5's `downloadClientExport`, `WAREHOUSE_CUSTOMER_EXPORT_COLUMNS`, `warehouseCustomerExportRows`; P1 `DataTable`; `DownloadMenu`.
- Produces: the testid map row "JadeFlows W→C" above. Removes `downloadClientCsv` (Deviation 11).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Worktree, guards, install, helpers, anchor re-verification**

Branch check, guards, install, helpers, `H`. Then, each alone:
- `grep -cF '  const wcDescriptors: ColumnFilterDescriptor<WarehouseCustomerRow>[] = useMemo(' artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx` → `1`
- `grep -rn 'downloadClientCsv' artifacts/studio/src` → only `lib/clientCsv.ts` (definition), `JadeFlowsTab.tsx` (import + `handleDownloadWc`) and a comment in `__tests__/JadeFlowsTab.test.tsx`
- `grep -c 'innerTab === "warehouse-customer" && (' artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx` → `2` (header group, legacy table) — P3.5's state

- [ ] **Step 2: Write the failing tests**

```bash
# SCU-2.P3.6 — JadeFlowsTab.test.tsx edits (run from artifacts/studio). $H = helper dir.
T=src/__tests__/JadeFlowsTab.test.tsx
set -e
python3 $H/scoped-replace.py $T "defaults to the Plant -> Warehouse inner tab" 'expect(screen.queryByTestId("jade-flows-wc-table")).not.toBeInTheDocument();' 'expect(screen.getByTestId("jade-flows-wc-table")).not.toBeVisible(); // SCU-2.P3.6: kept mounted, hidden'
python3 $H/scoped-replace.py $T "Plant -> Warehouse crossing >10 does NOT show the FilterMenu" 'screen.queryByTestId("button-filter-menu-trigger")' 'screen.queryByTestId("button-filter-jade-flows-wc")'
python3 $H/scoped-replace.py $T "both inner tables' Distance Band filter dropdown" '"button-filter-menu-trigger"' '"button-filter-jade-flows-wc"'
python3 $H/scoped-replace.py $T "selecting a range in EACH inner table" '"button-filter-menu-trigger"' '"button-filter-jade-flows-wc"'
python3 $H/delete-block.py $T describe "Per-leg client-side CSV download"
```

(The deleted describe held only the W→C on-screen-column CSV test; its P→W sibling went in P3.5.) Append at EOF:

```tsx

// SCU-2.P3.6 (spec B2.1/B2.2/B2.4, matrix §2a "JadeFlows W→C") — Warehouse ->
// Customer on DataTable: every testid in the instance map, pager > 50,
// Download ▾ with typed per-product CSV + JSON (jade-flows-warehouse-customer.*).
describe("JadeFlowsTab W→C on DataTable — testid map + client export (SCU-2.P3.6)", () => {
  function captureDownloads() {
    const RealBlob = globalThis.Blob;
    const blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation((parts, opts) => new RealBlob(parts, opts));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    return { names, text: (i: number) => blobSpy.mock.calls[i][0]?.[0] as string };
  }
  const withAssignments = {
    ...jadeResult,
    details: {
      assignments: [
        { customerId: "customer-1", warehouseId: "wh-11", productId: "product-1", flow: 300, distanceMi: 42.1 },
        { customerId: "customer-1", warehouseId: "wh-11", productId: "product-2", flow: 200, distanceMi: 42.1 },
        { customerId: "customer-2", warehouseId: "wh-14", productId: "product-1", flow: 300, distanceMi: 1200 },
      ],
    },
  };

  it("emits the root, count, row and five cell testids once the leg is shown", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    const root = screen.getByTestId("jade-flows-wc-table");
    expect(root).toBeVisible();
    const key = "wh-11|customer-1";
    expect(within(root).getByTestId("jade-flow-wc-row-wh-11-customer-1").tagName).toBe("TR");
    for (const col of ["warehouse", "customer", "distance", "flow", "band"]) {
      expect(within(root).getByTestId(`cell-jade-flow-wc-${col}-${key}`).tagName).toBe("TD");
    }
    expect(within(root).getByTestId("text-jadeflows-wc-count")).toHaveTextContent("2 of 2");
    expect([...root.querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Warehouse", "Customer", "Distance", "Flows", "Distance Band"]);
    expect([...root.querySelectorAll("thead th")].map(th => th.classList.contains("text-center"))).toEqual([false, false, true, true, false]);
  });

  it("CSV: one row per (customer, product) from details.assignments as jade-flows-warehouse-customer.csv", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={withAssignments} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc-csv"));
    expect(dl.names).toEqual(["jade-flows-warehouse-customer.csv"]);
    expect(dl.text(0).split("\n")).toEqual([
      "warehouseId,toId,product,flow,distance,unit",
      "wh-11,customer-1,product-1,300,42.1,mi",
      "wh-11,customer-1,product-2,200,42.1,mi",
      "wh-14,customer-2,product-1,300,1200,mi",
    ]);
  });

  it("JSON: { entity, unit, rows } as jade-flows-warehouse-customer.json", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={withAssignments} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc-json"));
    expect(dl.names).toEqual(["jade-flows-warehouse-customer.json"]);
    const doc = JSON.parse(dl.text(0));
    expect([doc.entity, doc.unit, doc.rows.length]).toEqual(["jadeFlowsWarehouseCustomer", "mi", 3]);
  });

  it("> 50 rows: pager with jade-flows-wc literals", async () => {
    const user = userEvent.setup();
    const edges = Array.from({ length: 51 }, (_, i) => ({
      fromId: "wh-11", toId: `customer-${i + 1}`, flow: 1, distance: 10, leg: "warehouse_to_customer" as const,
    }));
    render(<JadeFlowsTab result={makeResult(edges)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("jade-flows-wc-page-indicator")).toHaveTextContent("Page 1 of 2");
    await user.click(screen.getByTestId("button-jade-flows-wc-next"));
    expect(screen.getByTestId("jade-flow-wc-row-wh-11-customer-51")).toBeInTheDocument();
    expect(screen.getByTestId("button-jade-flows-wc-prev")).not.toBeDisabled();
  });

  it("a filter on one leg survives switching to the other leg and back", async () => {
    const user = userEvent.setup();
    const edges = Array.from({ length: 12 }, (_, i) => ({
      fromId: "wh-11", toId: `customer-${i + 1}`, flow: i + 1, distance: 10, leg: "warehouse_to_customer" as const,
    }));
    render(<JadeFlowsTab result={makeResult(edges)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    await user.click(screen.getByTestId("button-filter-jade-flows-wc"));
    await user.type(screen.getByTestId("input-filter-flow-min"), "11");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("text-jadeflows-wc-count")).toHaveTextContent("2 of 12");
    await user.click(screen.getByTestId("button-jade-flows-inner-plant-warehouse"));
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("text-jadeflows-wc-count")).toHaveTextContent("2 of 12");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/JadeFlowsTab.test.tsx`
Expected (provisional): FAIL — "defaults to the Plant -> Warehouse inner tab" (`jade-flows-wc-table` not in the document yet), `Unable to find an element by: [data-testid="button-filter-jade-flows-wc"]`, `…[data-testid="button-download-jade-flows-wc"]`.

- [ ] **Step 4: Implement**

In `JadeFlowsTab.tsx`:

(a) Replace the import block from `import { useEffect, useMemo, useState } from "react";` through `import { PLANT_WAREHOUSE_EXPORT_COLUMNS, plantWarehouseExportRows } from "@/lib/jadeFlowsExport";` with:

```tsx
import { useMemo, useState } from "react";
import type { Dataset, Edge, Plant, SolveResult } from "@workspace/api-client-react";
import { bandLabel, bandRangeLabel, DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import { formatCityState, plantIdCityState } from "@/lib/formatLocation";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { useDisplayUnit } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";
import { downloadClientExport } from "@/lib/clientCsv";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import {
  PLANT_WAREHOUSE_EXPORT_COLUMNS,
  plantWarehouseExportRows,
  WAREHOUSE_CUSTOMER_EXPORT_COLUMNS,
  warehouseCustomerExportRows,
} from "@/lib/jadeFlowsExport";
```

(b) Replace everything from the line `  const wcDescriptors: ColumnFilterDescriptor<WarehouseCustomerRow>[] = useMemo(` up to, **not** including, the line `  if (!result) {` with (this removes `wcDescriptors`, `wcFilters`, the W→C band-reset effect and its comment, and `handleDownloadWc`):

```tsx
  // SCU-2.P3.6 — Warehouse -> Customer is a DataTable, built like P->W above
  // (today's descriptor keys/labels: "Flows" for flow; band range filter with
  // its own filterResetKey, cleared independently of P->W's).
  const wcUpgrade = wcRows.length > 10;
  const wcColumns = useMemo<ColumnDef<WarehouseCustomerRow>[]>(
    () => [
      {
        id: "warehouse",
        header: "Warehouse",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-wc-warehouse-${r.key}`,
        value: r => r.warehouseLabel,
        cell: r => renderJadeEntityCell(r.warehouseId, r.warehouseLabel, identityById, wcUpgrade),
      },
      {
        id: "customer",
        header: "Customer",
        kind: "text",
        filter: "text", // pinned: today's descriptor type
        cellTestId: r => `cell-jade-flow-wc-customer-${r.key}`,
        value: r => r.customerLabel,
        cell: r => renderJadeEntityCell(r.customerId, r.customerLabel, identityById, wcUpgrade),
      },
      {
        id: "distance",
        header: "Distance",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-wc-distance-${r.key}`,
        value: r => r.distance,
        cell: r => formatRowDistance(r.distance),
      },
      {
        id: "flow",
        header: "Flows",
        kind: "number",
        cellClassName: "font-mono",
        cellTestId: r => `cell-jade-flow-wc-flow-${r.key}`,
        value: r => r.flow,
        cell: r => r.flow.toLocaleString(),
      },
      {
        id: "band",
        header: "Distance Band",
        kind: "enum",
        cellTestId: r => `cell-jade-flow-wc-band-${r.key}`,
        value: r =>
          canonicalResolved
            ? bandRangeLabel(unit.toDisplay(r.distance, distanceUnit), displayBands, resolvedUnitLabel!)
            : "—",
        cell: r => r.band,
        filterResetKey: `${effectiveBands.join(",")}|${distanceUnit ?? ""}|${unit.pref}`,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveBands.join(","), distanceUnit, unit.pref, identityById, wcUpgrade],
  );

```

(c) Replace the JSX from the line `    <div className="flex flex-col h-full overflow-hidden" data-testid="jade-flows-tab">` to the end of the file with:

```tsx
    <div className="flex flex-col h-full overflow-hidden" data-testid="jade-flows-tab">
      <div className="flex items-center justify-between gap-2 p-2 border-b flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          {segmentedControl}
        </div>
      </div>

      {/* SCU-2.P3.5 — Plant -> Warehouse stays MOUNTED while the other leg is
          shown (hidden), so its filter state survives a leg switch exactly as
          today's parent-held filter hooks did; hence its own trigger testid. */}
      <div className="overflow-auto flex-1 p-2" hidden={innerTab !== "plant-warehouse"}>
        <DataTable<PlantWarehouseRow>
            rows={pwRows}
            rowKey={r => r.key}
            columns={pwColumns}
            ctx={{ readOnly: true, demandEditable: false }}
            testIds={{
              root: "jade-flows-pw-table",
              row: r => `jade-flow-pw-row-${r.plantId}-${r.warehouseId}`,
              count: "text-jadeflows-pw-count",
              pagerPrev: "button-jade-flows-pw-prev",
              pagerNext: "button-jade-flows-pw-next",
              pageIndicator: "jade-flows-pw-page-indicator",
              filterTrigger: "button-filter-jade-flows-pw",
            }}
            toolbar={{
              download: (
                <DownloadMenu
                  testId="button-download-jade-flows-pw"
                  itemTestIds={{ csv: "button-download-jade-flows-pw-csv", json: "button-download-jade-flows-pw-json" }}
                  disabledReason={canonicalResolved ? undefined : "Loading…"}
                  onDownload={format =>
                    downloadClientExport("jade-flows-plant-warehouse", format, PLANT_WAREHOUSE_EXPORT_COLUMNS, {
                      entity: "jadeFlowsPlantWarehouse",
                      unit: resolvedUnitLabel!,
                      rows: plantWarehouseExportRows(solved, d => unit.toDisplay(d, distanceUnit!)),
                    })
                  }
                />
              ),
            }}
          />
      </div>
      {/* SCU-2.P3.6 — mounted alongside P->W (hidden when inactive) so each
          leg keeps its own filters across a leg switch. */}
      <div className="overflow-auto flex-1 p-2" hidden={innerTab !== "warehouse-customer"}>
        <DataTable<WarehouseCustomerRow>
          rows={wcRows}
          rowKey={r => r.key}
          columns={wcColumns}
          ctx={{ readOnly: true, demandEditable: false }}
          testIds={{
            root: "jade-flows-wc-table",
            row: r => `jade-flow-wc-row-${r.warehouseId}-${r.customerId}`,
            count: "text-jadeflows-wc-count",
            pagerPrev: "button-jade-flows-wc-prev",
            pagerNext: "button-jade-flows-wc-next",
            pageIndicator: "jade-flows-wc-page-indicator",
            filterTrigger: "button-filter-jade-flows-wc",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-jade-flows-wc"
                itemTestIds={{ csv: "button-download-jade-flows-wc-csv", json: "button-download-jade-flows-wc-json" }}
                disabledReason={canonicalResolved ? undefined : "Loading…"}
                onDownload={format =>
                  downloadClientExport("jade-flows-warehouse-customer", format, WAREHOUSE_CUSTOMER_EXPORT_COLUMNS, {
                    entity: "jadeFlowsWarehouseCustomer",
                    unit: resolvedUnitLabel!,
                    rows: warehouseCustomerExportRows(solved, d => unit.toDisplay(d, distanceUnit!)),
                  })
                }
              />
            ),
          }}
        />
      </div>
    </div>
  );
}
```

(d) In `artifacts/studio/src/lib/clientCsv.ts`, delete

```ts
export function downloadClientCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  downloadTextFile(filename, [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n"), "text/csv");
}

```

Verify: `grep -rn 'downloadClientCsv' artifacts/studio/src` → no hits (the only test-file mention was a comment inside the describe Step 2 deleted).

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter studio exec vitest run src/__tests__/JadeFlowsTab.test.tsx src/__tests__/jadeFlowsExport.test.ts src/__tests__/compareCsv.test.ts src/__tests__/CostSummaryTab.test.tsx`
Expected (provisional): PASS — scratch `JadeFlowsTab.test.tsx` 46; the CostSummary files prove Bundle 1's other `clientCsv` consumers are unaffected.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'warehouse-to-customer-flows\|button-download-jade-flows-wc\|jade-flows-wc-page-indicator\|button-jade-flows-wc-\|button-filter-jade-flows-wc' artifacts/studio/e2e/` → no hits.
2. Matrix §3 "JadeFlows W→C": `jade-ch9-workspace-bundle.spec.ts` (click `button-jade-flows-inner-warehouse-customer`; `jade-flows-wc-table` visible — its wrapper loses `hidden`; `thead th` == `["Warehouse","Customer","Distance","Flows","Distance Band"]`). No rewrite.
3. Insert (adds the real-browser proof of Deviation 3's `hidden` wrapper):

```bash
python3 $H/insert-after.py e2e/jade-ch9-workspace-bundle.spec.ts 'expect(wcHeaders).toEqual(["Warehouse", "Customer", "Distance", "Flows", "Distance Band"]);' '// SCU-2.P3.6 — W→C (one row per customer, 100) pages at 50; the P→W leg
// stays mounted but HIDDEN (real-browser proof that the `hidden` attribute
// hides it — jsdom cannot prove CSS).
await expect(page.getByTestId("jade-flows-wc-page-indicator")).toHaveText("Page 1 of 2");
await expect(page.getByTestId("jade-flows-pw-table")).toBeHidden();'
```

4. Local run, ports 3106/5206: `E2E_BASE_URL=http://localhost:5206 pnpm exec playwright test e2e/jade-ch9-workspace-bundle.spec.ts e2e/jade-two-echelon.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.6 — JADE Flows Warehouse → Customer on DataTable + typed export

- W→C renders through `DataTable` (root `jade-flows-wc-table`, count, cell testids, "Flows" header/label, band filter + reset kept), mounted alongside P→W (`hidden` when inactive; real-browser `toBeHidden` check added) with its own trigger `button-filter-jade-flows-wc`; pager above 50 (JADE: 100 customers → 2 pages). Download ▾ CSV/JSON client-built from `details.assignments` (one row per customer × product; outbound-edge fallback) as `jade-flows-warehouse-customer.{csv,json}`. `downloadClientCsv` deleted (no callers).
- Deviations 1, 2, 3, 6, 9, 10, 11. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx artifacts/studio/src/lib/clientCsv.ts artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.6] move JADE Flows warehouse-to-customer onto DataTable with typed export" -m "Deviations 1, 2, 3, 6 (per (customer, product) rows from details.assignments), 9, 10, 11 (downloadClientCsv removed)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.7: Solution Summary (single scenario) on DataTable (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (server `costSummary`), B1.3 (bar kept), B2.10. **Matrix:** §2a "CostSummary single", §3, G2 (header testid), G3 (`cost-summary-list` on the `<table>`), API-gap 10/12 (transposed rows; `FloorExceedsMaxAlert` above the table). **Deviations:** 1, 4, 5, 10. **Depends on:** P3.1.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx`
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, `Workspace.TabCoverage.test.tsx`
- e2e: `artifacts/studio/e2e/jade-two-echelon.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: Bundle 1's `summaryBar(download: ReactNode)`, the single-mode `rows: Array<[label, value, mono, testId?]>` builder (unchanged); P1 `DataTable`, `ColumnDef`; `DownloadMenu`.
- Produces: module-private `SummaryRow { label; value; mono; testId }`, `summaryColumns(ownName): ColumnDef<SummaryRow>[]`. The compare branch is untouched until P3.8 (its Download button is still B1.3's plain `button-download-cost-summary-csv` in this commit — an intermediate state, green on its own).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Worktree, guards, install, helpers, anchor re-verification**

Branch check, guards, install, helpers, `H`. Then `F=artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx`, `T=artifacts/studio/src/__tests__/CostSummaryTab.test.tsx` and, each alone (`grep -cF`, each → `1` unless stated):
- in `$F`: `const summaryBar = (download: ReactNode) => (`; `const DOWNLOAD_BUTTON_CLASS =`; `import { downloadTextFile } from "@/lib/clientCsv";`; `import { useState, type ReactNode } from "react";`; `  const [pickerOpen, setPickerOpen] = useState(() => selectedIds.length >= 2);` (all Bundle 1 SCU-1.3)
- in `$F`: `    const ownName = sameModelScenarios.find(s => s.id === scenarioId)?.name ?? "Current";`; `data-testid="cost-summary-list"`; `data-testid="cost-summary-single-column"`
- in `$T`: `compareToggle(` → `41` (Bundle 1's helper + 40 call sites); `describe("Solution Summary bar (SCU-1.3)"`

- [ ] **Step 2: Write the failing tests**

```bash
# SCU-2.P3.7 — CostSummaryTab.test.tsx + Workspace.TabCoverage.test.tsx edits (run from artifacts/studio).
set -e
T=src/__tests__/CostSummaryTab.test.tsx
perl -0pi -e 's|(import \* as clientCsv from "\@/lib/clientCsv";\n)|$1import { chooseDownload } from "\@/__tests__/helpers/downloadMenu";\n|' $T
grep -q 'helpers/downloadMenu' $T
python3 $H/scoped-replace.py $T "calls downloadEntityExport with entity=costSummary on Download click" 'fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));' 'chooseDownload("button-download-cost-summary", "button-download-cost-summary-csv");'
python3 $H/scoped-replace.py $T "is disabled with the reason surfaced for a result entity" 'screen.getByTestId("button-download-cost-summary-csv")' 'screen.getByTestId("button-download-cost-summary")'
python3 $H/scoped-replace.py $T "forwards runId when an older history entry is displayed" 'fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));' 'chooseDownload("button-download-cost-summary", "button-download-cost-summary-csv");'
python3 $H/scoped-replace.py $T "1 selected renders the normal single-scenario summary" 'screen.getByTestId("button-download-cost-summary-csv")' 'screen.getByTestId("button-download-cost-summary")'
python3 $H/scoped-replace.py $T "puts the toggle on the left and Download CSV on the right of one bar, in single mode" 'screen.getByTestId("button-download-cost-summary-csv")' 'screen.getByTestId("button-download-cost-summary")'
# per-row mono now sits on a <span> inside the <td> (ColumnDef.cellClassName is per column)
python3 $H/scoped-replace.py $T "renders numeric stats with font-mono, text stats without" 'expect(screen.getByTestId("cost-summary-value-objective")).toHaveClass("font-mono");' 'expect(screen.getByTestId("cost-summary-value-objective").querySelector(".font-mono")).not.toBeNull(); // SCU-2.P3.7: mono span inside the <td>'
python3 $H/scoped-replace.py $T "renders numeric stats with font-mono, text stats without" 'expect(screen.getByTestId("cost-summary-value-weighted-avg-distance")).toHaveClass("font-mono");' 'expect(screen.getByTestId("cost-summary-value-weighted-avg-distance").querySelector(".font-mono")).not.toBeNull();'
python3 $H/scoped-replace.py $T "renders numeric stats with font-mono, text stats without" 'expect(screen.getByTestId("cost-summary-value-quality")).not.toHaveClass("font-mono");' 'expect(screen.getByTestId("cost-summary-value-quality").querySelector(".font-mono")).toBeNull();'
perl -pi -e 's/tabTestId: "button-download-cost-summary-csv"/tabTestId: "button-download-cost-summary"/' src/__tests__/Workspace.TabCoverage.test.tsx
```

Append at EOF of `CostSummaryTab.test.tsx`:

```tsx

// SCU-2.P3.7 (spec B2.1/B2.2/B2.4, matrix §2a "CostSummary single") — the
// single-scenario Solution Summary on DataTable.
describe("CostSummaryTab single on DataTable — testid map (SCU-2.P3.7)", () => {
  const wrap = (ui: React.ReactElement) => render(<UnitProvider><ExportProvider value={makeExportProviderValue()}>{ui}</ExportProvider></UnitProvider>);

  it("cost-summary-list is the <table>; cost-summary-single-column is its value <th>; value cells keep their literal testids", () => {
    wrap(<CostSummaryTab result={result} scenarioId={1} />);
    const table = screen.getByTestId("cost-summary-list");
    expect(table.tagName).toBe("TABLE");
    const head = screen.getByTestId("cost-summary-single-column");
    expect(head.tagName).toBe("TH");
    expect(head).toHaveTextContent("Current");
    expect(head).toHaveClass("text-center");
    for (const id of ["cost-summary-value-objective", "cost-summary-value-weighted-avg-distance", "cost-summary-value-runtime", "cost-summary-value-quality", "cost-summary-value-solver"]) {
      const td = screen.getByTestId(id);
      expect(td.tagName).toBe("TD");
      expect(table).toContainElement(td);
    }
    // metric label first, value second, in one row
    const firstRow = table.querySelector("tbody tr")!;
    expect(firstRow.querySelector("td")!.textContent).toBe("Objective");
  });

  it("emits cost-summary-empty for no result and keeps the bar's Compare toggle", () => {
    wrap(<CostSummaryTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("cost-summary-empty")).toBeInTheDocument();
  });

  it("Download ▾ offers CSV and JSON through the server costSummary export", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    wrap(<CostSummaryTab result={result} scenarioId={1} />);
    chooseDownload("button-download-cost-summary", "button-download-cost-summary-json");
    expect(spy).toHaveBeenCalledWith(1, "costSummary", "json", { unit: "mi" });
    spy.mockRestore();
  });

  it("no 'Solution Summary' title (B1.3 kept); the summary has no filter at <= 10 metric rows", () => {
    wrap(<CostSummaryTab result={result} scenarioId={1} />);
    expect(screen.queryByText(/Solution Summary/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
  });

  it("JADE: inbound/outbound + the four rate rows keep their literal testids; 11 metric rows > 10 → the shell's filter menu appears", () => {
    const jade = scenario({ id: 1, name: "JADE", modelId: "two-echelon-jade-us", result: { ...result, metrics: { weightedAvgDistance: 300, inboundCost: 5, outboundCost: 7 } } });
    renderTab({ scenarios: [jade], modelId: "two-echelon-jade-us" });
    const table = screen.getByTestId("cost-summary-list");
    for (const id of ["cost-summary-value-inbound-cost", "cost-summary-value-outbound-cost", "cost-summary-rate-ic", "cost-summary-min-ic", "cost-summary-rate-ob", "cost-summary-min-ob"]) {
      expect(table).toContainElement(screen.getByTestId(id));
    }
    expect(table.querySelectorAll("tbody tr")).toHaveLength(11);
    expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
  });

  it("max-coverage: the coverage rows keep their explicit testids", () => {
    const mc = scenario({
      id: 1, name: "MC", modelId: "max-coverage-us",
      result: { ...result, details: { coveragePct: 70.42, coveredDemand: 1000, highServiceDistMi: 300, maxCoverableDemand: 1200, model1: { optimal: true } } },
    });
    renderTab({ scenarios: [mc], modelId: "max-coverage-us" });
    for (const id of ["cost-summary-high-service-cutoff", "cost-summary-coverage-pct", "cost-summary-covered-demand", "cost-summary-max-coverable-demand"]) {
      expect(screen.getByTestId("cost-summary-list")).toContainElement(screen.getByTestId(id));
    }
    expect(screen.getByTestId("cost-summary-coverage-pct")).toHaveTextContent("70.42 %");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/CostSummaryTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): FAIL — `Unable to find an element by: [data-testid="button-download-cost-summary"]`; the font-mono test (`querySelector(".font-mono")` is null: the class is on the `<td>` today); `cost-summary-single-column` lacks `text-center`; the JADE 11-row test finds no filter trigger.

- [ ] **Step 4: Implement**

In `CostSummaryTab.tsx`:

(a) Replace `import { useState, type ReactNode } from "react";` with `import { useMemo, useState, type ReactNode } from "react";`. After `import { downloadTextFile } from "@/lib/clientCsv";` add:

```tsx
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
```

(b) Directly before the line `const DOWNLOAD_BUTTON_CLASS =`, insert:

```tsx
// SCU-2.P3.7 (spec B2.1) — the single-scenario Solution Summary is a
// TRANSPOSED table: one row per metric, one value column (the open
// scenario). Values arrive pre-formatted; `testId` is the value cell's
// literal testid (explicit override, else the slug of the label).
interface SummaryRow {
  label: string;
  value: string;
  mono: boolean;
  testId: string;
}

function summaryColumns(ownName: string): ColumnDef<SummaryRow>[] {
  return [
    {
      id: "metric",
      header: "",
      filterLabel: "Metric",
      kind: "text",
      cellClassName: "text-muted-foreground",
      value: r => r.label,
      cell: r => r.label,
    },
    {
      id: "value",
      header: ownName,
      headerTestId: "cost-summary-single-column",
      // Numbers are centred (B2.1); the column also holds a few text values
      // ("Proven optimal", "CBC"), so it is not filterable — a range or a
      // select over mixed currency/%/text is meaningless (plan deviation 4).
      kind: "number",
      filter: false,
      cellTestId: r => r.testId,
      value: r => r.value,
      cell: r => (r.mono ? <span className="font-mono">{r.value}</span> : r.value),
    },
  ];
}

```

(c) After the line `  const [pickerOpen, setPickerOpen] = useState(() => selectedIds.length >= 2);` (Bundle 1), insert (hooks cannot sit inside the mode branch, so the columns are memoised up here):

```tsx
  // SCU-2.P3.7 — the single-mode value column is headed by the open scenario's name.
  const ownName = sameModelScenarios.find(s => s.id === scenarioId)?.name ?? "Current";
  const summaryCols = useMemo(() => summaryColumns(ownName), [ownName]);
```

(d) In the single-mode branch, replace the line `    const ownName = sameModelScenarios.find(s => s.id === scenarioId)?.name ?? "Current";` with:

```tsx
    const summaryRows: SummaryRow[] = rows.map(([label, value, mono, testId]) => ({
      label,
      value,
      mono,
      testId: testId ?? `cost-summary-value-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    }));
```

(e) In the single-mode `return`, replace everything from the line `        {summaryBar(` (the one whose child is the `button-download-cost-summary-csv` button) through the line `        </div>` that closes `<div className="overflow-auto flex-1 p-2">` (i.e. the bar, the `FloorExceedsMaxAlert` and the whole `<table data-testid="cost-summary-list">…</table>`) with:

```tsx
        {summaryBar(
          <DownloadMenu
            testId="button-download-cost-summary"
            itemTestIds={{ csv: "button-download-cost-summary-csv", json: "button-download-cost-summary-json" }}
            onDownload={format => download("costSummary", format)}
            disabledReason={disabledReasonFor("costSummary")}
          />,
        )}
        <div className="overflow-auto flex-1 p-2">
          <FloorExceedsMaxAlert
            result={result}
            formatDistance={v => formatDistance(v, canonicalDistanceUnit, unit)}
          />
          <DataTable<SummaryRow>
            rows={summaryRows}
            rowKey={r => r.label}
            columns={summaryCols}
            ctx={{ readOnly: true, demandEditable: false }}
            testIds={{ table: "cost-summary-list" }}
          />
        </div>
```

The `!result` branch's `{summaryBar(null)}` and the compare branch are unchanged in this task.

- [ ] **Step 5: Run them to verify they pass**

Run: the Step 3 command, then `pnpm --filter studio exec vitest run src/__tests__/Workspace.test.tsx src/__tests__/compareCsv.test.ts`.
Expected (provisional): PASS — scratch `CostSummaryTab.test.tsx` 82, `compareCsv.test.ts` 5, TabCoverage 8. Bundle 1's compare tests still click the compare-mode `button-download-cost-summary-csv` button directly and pass.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-cost-summary' artifacts/studio/e2e/` → no hits.
2. Matrix §3 "CostSummary single" (44 lines / 10 files) — every needle is a preserved testid: `cost-summary-list` (`jade-two-echelon.spec.ts`), `cost-summary-value-{objective,weighted-avg-distance,avg-distance-to-customers,quality}`, `cost-summary-{rate,min}-{ic,ob}`, `cost-summary-{max-coverable-demand,coverage-pct,high-service-cutoff}`, and the picker lines Bundle 1 already routed through `button-toggle-compare`. `toContainText` reads the `<td>`, which now wraps a mono `<span>` — text is unchanged. No rewrite.
3. Insert:

```bash
python3 $H/insert-after.py e2e/jade-two-echelon.spec.ts 'await expect(page.getByTestId("cost-summary-list")).toBeVisible({ timeout: HEADER_TIMEOUT });' '// SCU-2.P3.7 — JADE single summary has 11 metric rows (> 10) → the shell'"'"'s
// filter menu; Download ▾ offers CSV and JSON.
await expect(page.getByTestId("button-filter-menu-trigger")).toBeVisible();
await page.getByTestId("button-download-cost-summary").click();
await expect(page.getByTestId("button-download-cost-summary-json")).toBeVisible();
await page.keyboard.press("Escape");'
```

4. Local run, ports 3107/5207: `E2E_BASE_URL=http://localhost:5207 pnpm exec playwright test e2e/jade-two-echelon.spec.ts e2e/jade-transport-costs.spec.ts e2e/max-coverage.spec.ts e2e/max-coverage-objective.spec.ts e2e/delivery-teaching.spec.ts e2e/chen-bands-units-qa.spec.ts e2e/truthful-status.spec.ts`. Expected: pass (`chen-bands-units-qa.spec.ts` is the suite's most load-sensitive file — judge failures by test name against the flake registry).

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.7 — Solution Summary (single) on DataTable

- The single-scenario summary renders through `DataTable` (`cost-summary-list` on the `<table>`, `cost-summary-single-column` on the value `<th>`, every `cost-summary-value-*` and explicit override testid on its `<td>`); value column centred, not filterable; the metric column is filterable, so the JADE summary (11 rows) shows a filter menu. Per-row monospace moved into a `<span>`. The B1.3 bar's Download is now Download ▾ CSV/JSON (server `costSummary`).
- Deviations 1, 4, 5, 10. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/__tests__/CostSummaryTab.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/e2e/jade-two-echelon.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.7] move the single-scenario Solution Summary onto DataTable" -m "Deviations 1, 4 (transposed: value column centred + unfiltered, metric column filterable), 5 (per-row mono span), 10." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.8: Solution Summary compare on DataTable + compare JSON (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (compare: same row model as B1.3's CSV; `cost-summary-compare.{csv,json}`), B1.3, B2.10. **Matrix:** §2a "CostSummary compare", §3, G2, G15 (footer bands note), API-gap 3 (`tr:has`), 10, 11. **Deviations:** 1, 4, 5, 7, 10. **Depends on:** P3.7.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx`, `artifacts/studio/src/lib/compareCsv.ts` (append)
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, `artifacts/studio/src/__tests__/compareCsv.test.ts`
- e2e: `artifacts/studio/e2e/workspace-ux-r1-r9.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: Bundle 1's `CompareRow`/`CompareCell`, `compareRows`, `buildCompareCsv`, `downloadTextFile`; P1 `DataTable`, `ColumnDef`; `DownloadMenu`.
- Produces: `CompareJsonDocument`, `buildCompareJson` (`lib/compareCsv.ts`); module-private `compareColumns(scenarios)`. `CompareRow.{labelClassName, cellClassName}` → `{ labelMono?, mono }` (Deviation 5). `DOWNLOAD_BUTTON_CLASS` is deleted (no user left).

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Worktree, guards, install, helpers, anchor re-verification**

Branch check, guards, install, helpers, `H`. Then `F=artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` and, each alone (`grep -cF … "$F"`):
- `cellClassName: MONO` → `14`; `cellClassName: "p-2"` → `2`; `labelClassName: "font-mono",` → `1`; `  const MONO = "p-2 font-mono";` → `1` (Bundle 1 compare row model)
- `onClick={() => downloadTextFile("cost-summary-compare.csv"` → `1`; `data-testid="cost-summary-compare-table"` → `1`; `data-testid="cost-summary-compare-bands-note"` → `1`; `  const compareMode = !isBrowsingHistory && compareScenarios.length >= 2;` → `1`
- `grep -c 'export function buildCompareCsv' artifacts/studio/src/lib/compareCsv.ts` → `1`

- [ ] **Step 2: Write the failing tests**

```bash
# SCU-2.P3.8 — CostSummaryTab.test.tsx edits (run from artifacts/studio).
set -e
T=src/__tests__/CostSummaryTab.test.tsx
python3 $H/scoped-replace.py $T "in compare mode, Download CSV (right of the bar)" 'expect(bar.lastElementChild).toBe(screen.getByTestId("button-download-cost-summary-csv"));' 'expect(bar.lastElementChild).toBe(screen.getByTestId("button-download-cost-summary"));'
python3 $H/scoped-replace.py $T "in compare mode, Download CSV (right of the bar)" 'fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));' 'chooseDownload("button-download-cost-summary", "button-download-cost-summary-csv");'
python3 $H/scoped-replace.py $T "compare CSV: an optional row one scenario lacks is an empty cell" 'fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));' 'chooseDownload("button-download-cost-summary", "button-download-cost-summary-csv");'
python3 $H/scoped-replace.py $T "compare CSV rows are the compare table's rows" 'fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));' 'chooseDownload("button-download-cost-summary", "button-download-cost-summary-csv");'
perl -pi -e 's/^import \{ render as rtlRender, screen, fireEvent, cleanup \} from "\@testing-library\/react";/import { render as rtlRender, screen, fireEvent, cleanup, within } from "\@testing-library\/react";/' $T
grep -c ', within } from "@testing-library/react"' $T     # → 1 (if the import line differs, add `within` to it by hand)
```

Append at EOF of `CostSummaryTab.test.tsx`:

```tsx

// SCU-2.P3.8 (spec B2.1/B2.2/B2.4, matrix §2a "CostSummary compare") — the
// compare table on DataTable: every testid in the instance map, label + cells
// in one <tr>, centred value columns, footer bands note, CSV + JSON.
describe("CostSummaryTab compare on DataTable — testid map (SCU-2.P3.8)", () => {
  const s1 = scenario({
    id: 1, name: "Baseline", modelId: "p-median-us",
    result: { ...result, objective: 100, metrics: { weightedAvgDistance: 300, bandCoverage: [{ band: 200, percent: 40 }, { band: 400, percent: 80 }] }, edges: [{ fromId: "WH1", toId: "C1", flow: 1, distance: 100 }] },
  });
  const s2 = scenario({
    id: 2, name: "Alt P", modelId: "p-median-us",
    result: { ...result, objective: 120, metrics: { weightedAvgDistance: 250, bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 90 }] }, edges: [{ fromId: "WH1", toId: "C1", flow: 1, distance: 100 }] },
  });
  function enterCompare(scenarios: Scenario[] = [s1, s2]) {
    renderTab({ scenarios, modelId: "p-median-us" });
    fireEvent.click(screen.getByTestId("button-toggle-compare"));
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
  }

  it("wrapper, column <th>s and every always-present row's cells keep their literal testids", () => {
    enterCompare();
    const wrap = screen.getByTestId("cost-summary-compare-table");
    for (const id of [1, 2]) {
      const th = within(wrap).getByTestId(`cost-summary-compare-column-${id}`);
      expect(th.tagName).toBe("TH");
      expect(th).toHaveClass("text-center");
      for (const key of ["objective", "distance", "open-facilities-cities", "runtime", "quality", "band-200", "band-400", "band--1"]) {
        expect(within(wrap).getByTestId(`cost-summary-compare-${key}-${id}`).tagName).toBe("TD");
      }
    }
    expect(within(wrap).getByTestId("cost-summary-compare-column-2")).toHaveTextContent("Alt P");
  });

  it("the JADE/Chen chip layout (locationById present) nests cost-summary-compare-open-facility-{id}-{facility} spans in the cell", () => {
    rtlRender(
      <UnitProvider>
        <ExportProvider value={makeExportProviderValue()}>
          <CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} locationById={{}} />
        </ExportProvider>
      </UnitProvider>,
    );
    fireEvent.click(screen.getByTestId("button-toggle-compare"));
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    for (const id of [1, 2]) {
      const span = screen.getByTestId(`cost-summary-compare-open-facility-${id}-WH1`);
      expect(span.tagName).toBe("SPAN");
      expect(screen.getByTestId(`cost-summary-compare-open-facilities-cities-${id}`)).toContainElement(span);
    }
  });

  it("each metric label and its scenario cells share one <tr> (two-echelon.spec.ts:185 tr:has contract)", () => {
    enterCompare();
    const tr = screen.getByTestId("cost-summary-compare-objective-1").closest("tr")!;
    expect(tr.querySelector("td")!.textContent).toBe("Objective");
    expect(tr).toContainElement(screen.getByTestId("cost-summary-compare-objective-2"));
  });

  it("differing band sets: the bands note renders below the table inside the wrapper", () => {
    enterCompare([s1, scenario({ ...s2, result: { ...s2.result!, metrics: { ...s2.result!.metrics, bandCoverage: [{ band: 500, percent: 60 }] } } })]);
    const note = screen.getByTestId("cost-summary-compare-bands-note");
    expect(screen.getByTestId("cost-summary-compare-table")).toContainElement(note);
    expect(screen.getByRole("table").compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Download ▾ JSON: { entity, unit, rows } built from the SAME row model as the CSV", () => {
    const spy = vi.spyOn(clientCsv, "downloadTextFile").mockImplementation(() => {});
    enterCompare();
    chooseDownload("button-download-cost-summary", "button-download-cost-summary-csv");
    chooseDownload("button-download-cost-summary", "button-download-cost-summary-json");
    const [csvCall, jsonCall] = spy.mock.calls;
    expect(jsonCall[0]).toBe("cost-summary-compare.json");
    expect(jsonCall[2]).toBe("application/json");
    const doc = JSON.parse(jsonCall[1] as string);
    expect(doc.entity).toBe("costSummaryCompare");
    expect(doc.unit).toBe("mi");
    const csvLines = (csvCall[1] as string).split("\n").slice(1);
    expect(doc.rows).toHaveLength(csvLines.length);
    expect(doc.rows[0]).toEqual({
      metric: "Objective",
      values: [{ scenarioId: 1, scenario: "Baseline", value: 100 }, { scenarioId: 2, scenario: "Alt P", value: 120 }],
    });
    spy.mockRestore();
  });

  it("JADE compare: inbound/outbound and the four rate rows keep their per-scenario testids", () => {
    const j = (id: number, name: string) =>
      scenario({ id, name, modelId: "two-echelon-jade-us", result: { ...result, metrics: { weightedAvgDistance: 300, inboundCost: id, outboundCost: id * 2 } } });
    renderTab({ scenarios: [j(1, "A"), j(2, "B")], modelId: "two-echelon-jade-us" });
    fireEvent.click(screen.getByTestId("button-toggle-compare"));
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    for (const key of ["inbound", "outbound", "rate-ic", "min-ic", "rate-ob", "min-ob"]) {
      for (const id of [1, 2]) expect(screen.getByTestId(`cost-summary-compare-${key}-${id}`).tagName).toBe("TD");
    }
  });

  it("max-coverage compare: the coverage rows keep their per-scenario testids", () => {
    const m = (id: number) =>
      scenario({
        id, name: `M${id}`, modelId: "max-coverage-us",
        result: { ...result, details: { coveragePct: 70, coveredDemand: 1000, highServiceDistMi: 300, maxCoverableDemand: 1200, model1: { optimal: true } } },
      });
    renderTab({ scenarios: [m(1), m(2)], modelId: "max-coverage-us" });
    fireEvent.click(screen.getByTestId("button-toggle-compare"));
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    for (const key of ["high-service-cutoff", "coverage-pct", "covered-demand", "max-coverable-demand"]) {
      for (const id of [1, 2]) expect(screen.getByTestId(`cost-summary-compare-${key}-${id}`).tagName).toBe("TD");
    }
  });
});
```

In `artifacts/studio/src/__tests__/compareCsv.test.ts`, change `import { buildCompareCsv } from "@/lib/compareCsv";` to `import { buildCompareCsv, buildCompareJson } from "@/lib/compareCsv";` and append at EOF (without the `import` line below, which the merged import replaces):

```ts
// SCU-2.P3.8 (spec B2.4) — the compare JSON: same row model as the CSV.
import { buildCompareJson } from "@/lib/compareCsv";

describe("buildCompareJson", () => {
  const rows = [
    { csvLabel: "Objective", cells: [{ raw: 1 }, { raw: 2 }] },
    { csvLabel: "Inbound cost", cells: [{ raw: null }, { raw: 5 }] },
  ];
  const scenarios = [{ id: 7, name: "A" }, { id: 9, name: "A" }];

  it("one row per metric, one value per scenario keyed by id (names may repeat), null kept", () => {
    expect(buildCompareJson(rows, scenarios, "mi")).toEqual({
      entity: "costSummaryCompare",
      unit: "mi",
      rows: [
        { metric: "Objective", values: [{ scenarioId: 7, scenario: "A", value: 1 }, { scenarioId: 9, scenario: "A", value: 2 }] },
        { metric: "Inbound cost", values: [{ scenarioId: 7, scenario: "A", value: null }, { scenarioId: 9, scenario: "A", value: 5 }] },
      ],
    });
  });

  it("omits unit while the display unit is unresolved", () => {
    expect("unit" in buildCompareJson(rows, scenarios, null)).toBe(false);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/CostSummaryTab.test.tsx src/__tests__/compareCsv.test.ts`
Expected (provisional): FAIL — `compareCsv.test.ts`: `buildCompareJson is not a function` (or the TS import error); `CostSummaryTab.test.tsx`: the three Bundle 1 compare-download tests (`Unable to find an element by: [data-testid="button-download-cost-summary"]` in compare mode), the centring test, the JSON test.

- [ ] **Step 4: Implement**

Append to `artifacts/studio/src/lib/compareCsv.ts`:

```ts

// SCU-2.P3.8 (spec B2.4) — the compare JSON download: the SAME row model as
// the CSV, as `{ entity, unit?, rows }`. One row per metric; `values` holds one
// entry per compared scenario in on-screen order, keyed by id (scenario names
// are not unique). `unit` is the active display unit (omitted while unresolved).
export interface CompareJsonDocument {
  entity: "costSummaryCompare";
  unit?: string;
  rows: Array<{ metric: string; values: Array<{ scenarioId: number; scenario: string; value: number | string | null }> }>;
}

export function buildCompareJson(
  rows: CompareCsvRow[],
  scenarios: Array<{ id: number; name: string }>,
  unit: string | null,
): CompareJsonDocument {
  return {
    entity: "costSummaryCompare",
    ...(unit != null ? { unit } : {}),
    rows: rows.map(r => ({
      metric: r.csvLabel,
      values: scenarios.map((s, i) => ({ scenarioId: s.id, scenario: s.name, value: r.cells[i].raw })),
    })),
  };
}
```

In `CostSummaryTab.tsx`:

(a) `import { buildCompareCsv } from "@/lib/compareCsv";` → `import { buildCompareCsv, buildCompareJson } from "@/lib/compareCsv";`

(b) In `interface CompareRow`, replace

```tsx
  labelClassName?: string;
  cellClassName: string;
```

with

```tsx
  /** SCU-2.P3.8 — per-row monospace (DataTable owns padding/alignment). */
  labelMono?: boolean;
  mono: boolean;
```

(c) Replace the line `const DOWNLOAD_BUTTON_CLASS =` and its string-literal continuation line `  "text-xs border rounded px-2 py-1 hover:bg-muted disabled:opacity-50 disabled:pointer-events-none";` with:

```tsx
// SCU-2.P3.8 (spec B2.1) — compare is TRANSPOSED too: the metric column, then
// one value column per compared scenario (selection order). Cells render the
// row model's `display`; `value` is the raw CSV value. Value columns are
// centred numbers and not filterable (deviation 4); the metric column is.
function compareColumns(scenarios: Array<{ id: number; name: string }>): ColumnDef<CompareRow>[] {
  return [
    {
      id: "metric",
      header: "",
      filterLabel: "Metric",
      kind: "text",
      cellClassName: "text-muted-foreground",
      value: r => (typeof r.label === "string" ? r.label : r.csvLabel),
      cell: r => (r.labelMono ? <span className="font-mono">{r.label}</span> : r.label),
    },
    ...scenarios.map((sc, col): ColumnDef<CompareRow> => ({
      id: `scenario-${sc.id}`,
      header: sc.name,
      headerTestId: `cost-summary-compare-column-${sc.id}`,
      kind: "number",
      filter: false,
      cellTestId: r => r.testId(sc.id),
      value: r => r.cells[col].raw,
      cell: r => (r.mono ? <span className="font-mono">{r.cells[col].display}</span> : r.cells[col].display),
    })),
  ];
}
```

(d) After the line `  const compareMode = !isBrowsingHistory && compareScenarios.length >= 2;`, insert:

```tsx
  // SCU-2.P3.8 — memoised here, above the mode branch (no hooks inside it).
  const compareColumnsKey = compareScenarios.map(s => `${s.id}:${s.name}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const compareCols = useMemo(() => compareColumns(compareScenarios), [compareColumnsKey]);
```

(e) Mechanical row-model rewrite, then the `MONO` constant goes:

```bash
F=src/components/workspace/tabs/CostSummaryTab.tsx
perl -pi -e 's/cellClassName: MONO/mono: true/g; s/cellClassName: "p-2"/mono: false/g; s/labelClassName: "font-mono",/labelMono: true,/' $F
perl -ni -e 'print unless /^  const MONO = "p-2 font-mono";$/' $F
grep -c 'mono: true' $F      # → 14
grep -c 'mono: false' $F     # → 2
grep -c 'MONO\|cellClassName: "p-2"\|labelClassName' $F   # → 0
```

(f) Replace the compare branch's `return (` body from the line `      {summaryBar(` (its child is the `downloadTextFile("cost-summary-compare.csv", …)` button) to the end of the file (the `}` closing `CostSummaryTab`) with:

```tsx
      {summaryBar(
        <DownloadMenu
          testId="button-download-cost-summary"
          itemTestIds={{ csv: "button-download-cost-summary-csv", json: "button-download-cost-summary-json" }}
          onDownload={format =>
            format === "csv"
              ? downloadTextFile("cost-summary-compare.csv", buildCompareCsv(compareRows, compareScenarios), "text/csv")
              : downloadTextFile(
                  "cost-summary-compare.json",
                  JSON.stringify(buildCompareJson(compareRows, compareScenarios, unitLabel), null, 2),
                  "application/json",
                )
          }
        />,
      )}
      <div className="overflow-auto flex-1 p-2" data-testid="cost-summary-compare-table">
        <DataTable<CompareRow>
          rows={compareRows}
          rowKey={r => r.key}
          columns={compareCols}
          ctx={{ readOnly: true, demandEditable: false }}
          footer={
            !sharedBands && (
              <p className="text-xs text-muted-foreground p-2" data-testid="cost-summary-compare-bands-note">
                Selected scenarios use different distance bands — band coverage isn't shown side by side.{" "}
                {compareScenarios.map(s => `${s.name}: ${formatBandList(bandBoundaries(s.result!), canonicalDistanceUnit, unit)}`).join("; ")}
              </p>
            )
          }
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter studio exec vitest run src/__tests__/CostSummaryTab.test.tsx src/__tests__/compareCsv.test.ts src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): PASS — scratch `CostSummaryTab.test.tsx` 89. Bundle 1's contract test ("compare CSV rows are the compare table's rows, in order, with identical text cells") passes unchanged apart from opening the menu: the DataTable renders exactly `compareRows`, label first.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'cost-summary-compare.json\|button-download-cost-summary' artifacts/studio/e2e/` → only the P3.7 line (`jade-two-echelon.spec.ts`).
2. Matrix §3 "CostSummary compare" (17 lines / 4 files): `bundle6-ui-tweaks.spec.ts` (table wrapper; open-facilities cell), `two-echelon.spec.ts` (wrapper; **structural** `tr:has([data-testid^="cost-summary-compare-open-facilities-cities-"])` — label and cells stay in one `<tr>`, pinned by the unit test "each metric label and its scenario cells share one <tr>"), `workspace-ux-r1-r9.spec.ts` (wrapper; `cost-summary-compare-column-{id}` on the `<th>`; open-facilities, distance, objective cells), `jade-transport-costs.spec.ts` (`cost-summary-compare-{rate,min}-{ic,ob}-{id}`). No rewrite.
3. Insert:

```bash
python3 $H/insert-after.py e2e/workspace-ux-r1-r9.spec.ts 'await expect(page.getByTestId(`cost-summary-compare-distance-${id2}`)).toBeVisible();' '// SCU-2.P3.8 — compare Download ▾ offers CSV and JSON (spec B2.4).
await page.getByTestId("button-download-cost-summary").click();
await expect(page.getByTestId("button-download-cost-summary-csv")).toBeVisible();
await expect(page.getByTestId("button-download-cost-summary-json")).toBeVisible();
await page.keyboard.press("Escape");'
```

4. Local run, ports 3108/5208: `E2E_BASE_URL=http://localhost:5208 pnpm exec playwright test e2e/workspace-ux-r1-r9.spec.ts e2e/two-echelon.spec.ts e2e/bundle6-ui-tweaks.spec.ts e2e/jade-transport-costs.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.8 — Solution Summary compare on DataTable + compare JSON

- The compare table renders through `DataTable` from Bundle 1's `compareRows` (one value column per compared scenario, `cost-summary-compare-column-{id}` on its `<th>`, every `cost-summary-compare-*-{id}` cell testid, label + cells in one `<tr>`, bands note in the shell footer inside `cost-summary-compare-table`). Download ▾ in the bar: CSV = `buildCompareCsv` (unchanged), JSON = `buildCompareJson` (`{ entity: "costSummaryCompare", unit?, rows: [{ metric, values: [{ scenarioId, scenario, value }] }] }`), both from the same row model, all rows. `CompareRow` carries `mono`/`labelMono` instead of padding-bearing classes.
- Deviations 1, 4, 5, 7, 10. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/lib/compareCsv.ts artifacts/studio/src/__tests__/CostSummaryTab.test.tsx artifacts/studio/src/__tests__/compareCsv.test.ts artifacts/studio/e2e/workspace-ux-r1-r9.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.8] move the Solution Summary compare table onto DataTable and add compare JSON" -m "Deviations 1, 4, 5 (CompareRow mono flags), 7 (compare JSON row shape), 10." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.9: Service Stats Plant Production on DataTable + tab-level Download ▾ (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (server `serviceStats`), B2.10 ("Excluded: ServiceStats band bars"). **Matrix:** §1 row 9, §2a "ServiceStats Plant Production" (incl. the four tab-level testids kept **outside** the DataTable), §3, §5.5 (Remaining filter). **Deviations:** 1, 9, 10. **Depends on:** P3.1.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx`
- Test: `artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx`, `Workspace.TabCoverage.test.tsx`
- e2e: `artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `buildPlantProductionRows`, `renderPlantCell` (unchanged); P1 `DataTable`, `ColumnDef`; `DownloadMenu`.
- Produces: module-private `plantProductionColumns(identityById, upgrade)`; the testid map row "ServiceStats Plant Production" above. The band rows (Bundle 1 SCU-1.2) are not a table and are not touched.

- [ ] **Step 0: Invoke the simplicity skills**

Skill tool: `andrej-karpathy-skills:karpathy-guidelines`, then `ponytail:ponytail`. Record in the report that both ran.

- [ ] **Step 1: Worktree, guards, install, helpers, anchor re-verification**

Branch check, guards, install, helpers, `H`. Then `F=artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx` and, each alone (`grep -cF … "$F"`, each → `1`):
- `const PLANT_PRODUCTION_FILTER_DESCRIPTORS`; `const plantProductionFilters = useTableFilters(plantProductionRows, PLANT_PRODUCTION_FILTER_DESCRIPTORS);`
- `data-testid="button-download-service-stats-csv"`; `data-testid="plant-production-section"`
- `import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";`
- and `grep -n 'data-testid' "$F"` → `service-stats-empty`, `service-stats-unit-pending`, `button-download-service-stats-csv`, `service-stats-no-bands`, the band-row testid(s) Bundle 1 SCU-1.2 renders, `plant-production-section`, `row-plant-production-…`

- [ ] **Step 2: Write the failing tests**

```bash
# SCU-2.P3.9 — ServiceStatsTab.test.tsx + Workspace.TabCoverage.test.tsx edits (run from artifacts/studio).
set -e
T=src/__tests__/ServiceStatsTab.test.tsx
perl -pi -e 's/fireEvent\.click\(screen\.getByTestId\("button-download-service-stats-csv"\)\);/chooseDownload("button-download-service-stats", "button-download-service-stats-csv");/g; s/const button = screen\.getByTestId\("button-download-service-stats-csv"\);/const button = screen.getByTestId("button-download-service-stats");/g' $T
perl -0pi -e 's|(import \{ makeExportProviderValue \} from "\@/__tests__/helpers/renderWithExportProvider";\n)|$1import { chooseDownload } from "\@/__tests__/helpers/downloadMenu";\n|' $T
grep -c 'chooseDownload' $T
perl -pi -e 's/tabTestId: "button-download-service-stats-csv"/tabTestId: "button-download-service-stats"/' src/__tests__/Workspace.TabCoverage.test.tsx
# Bundle 1 SCU-1.4's test reads the CSV button; the trigger now sits in that header row
python3 $H/scoped-replace.py $T "renders no 'Service Stats' title and keeps Download right-aligned" '"button-download-service-stats-csv"' '"button-download-service-stats"'
```

Append at EOF of `ServiceStatsTab.test.tsx`:

```tsx

// SCU-2.P3.9 (spec B2.1/B2.2/B2.4, matrix §2a "ServiceStats Plant
// Production") — Plant Production on DataTable + the tab-level Download ▾.
// Own fixture (4 plants × 4 products = 16 rows, the real JADE shape).
describe("ServiceStatsTab Plant Production on DataTable — testid map (SCU-2.P3.9)", () => {
  const plants = ["p1", "p2", "p3", "p4"].map((id, i) => ({ id, name: `Plant ${i + 1}`, city: `City${i + 1}`, state: "ST", lat: 0, lng: 0 }));
  const products = ["product-1", "product-2", "product-3", "product-4"].map((id, i) => ({ id, name: `Product ${i + 1}` }));
  const baseCapabilities = plants.flatMap((pl, pi) => products.map((pr, ki) => ({ plantId: pl.id, productId: pr.id, capacity: pi === ki ? 1000 : 0 })));
  const jade = {
    ...result,
    metrics: {},
    edges: [{ fromId: "p1", toId: "w1", leg: "plant_to_warehouse" as const, productId: "product-1", flow: 400, distance: 10 }],
  };
  const renderJade = () =>
    render(
      <ServiceStatsTab result={jade} scenarioId={1} modelId="two-echelon-jade-us" effectivePlants={plants} products={products} baseCapabilities={baseCapabilities} />,
    );

  it("section root contains the title, filter trigger and the exact thead contract", () => {
    renderJade();
    const section = screen.getByTestId("plant-production-section");
    expect(section).toHaveTextContent("Plant Production");
    expect(section).toContainElement(screen.getByTestId("button-filter-menu-trigger"));
    const heads = [...section.querySelectorAll("thead th")];
    expect(heads.map(h => h.textContent)).toEqual(["Plant", "Product", "Actual production", "Enabled capacity", "Remaining capacity"]);
    expect(heads.map(h => h.classList.contains("text-center"))).toEqual([false, false, true, true, true]);
  });

  it("emits row-plant-production-{plant}-{product} on 16 <tr>s; remaining '—' for a disabled cell", () => {
    renderJade();
    expect(screen.getAllByTestId(/^row-plant-production-/)).toHaveLength(16);
    expect(screen.getByTestId("row-plant-production-p1-product-1").tagName).toBe("TR");
    expect(screen.getByTestId("row-plant-production-p1-product-1")).toHaveTextContent("600");
    expect(screen.getByTestId("row-plant-production-p1-product-2")).toHaveTextContent("—");
  });

  it("filter keys are today's (plant/product select, actual/capacity range) plus the derived remaining range", async () => {
    const user = userEvent.setup();
    renderJade();
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    for (const id of ["select-filter-plant", "select-filter-product", "input-filter-actual-min", "input-filter-capacity-min", "input-filter-remaining-min"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    await user.click(screen.getByTestId("checkbox-filter-plant-p1 — City1, ST"));
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("4 of 16");
    expect(screen.getAllByTestId(/^row-plant-production-/)).toHaveLength(4);
  });

  it("the tab-level states stay outside DataTable: service-stats-empty, -unit-pending, -no-bands", () => {
    const a = render(<ServiceStatsTab result={null} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-empty")).toBeInTheDocument();
    a.unmount();
    const b = render(<ServiceStatsTab result={result} scenarioId={1} modelId="model-not-in-manifest" />);
    expect(screen.getByTestId("service-stats-unit-pending")).toBeInTheDocument();
    b.unmount();
    render(<ServiceStatsTab result={{ ...result, metrics: {} }} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-no-bands")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-service-stats")).toBeInTheDocument();
  });

  it("tab-level Download ▾ offers CSV and JSON through the server serviceStats export", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    chooseDownload("button-download-service-stats", "button-download-service-stats-json");
    expect(spy).toHaveBeenCalledWith(1, "serviceStats", "json", { unit: "mi" });
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/ServiceStatsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): FAIL — `Unable to find an element by: [data-testid="button-download-service-stats"]`; the thead test fails on `text-center`; `input-filter-remaining-min` not found.

- [ ] **Step 4: Implement**

In `ServiceStatsTab.tsx`:

(a) Replace the three lines

```tsx
import { FilterMenu } from "@/components/tables/FilterMenu";
import { useTableFilters, type ColumnFilterDescriptor } from "@/lib/useTableFilters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
```

with

```tsx
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
```

(b) Replace the whole `const PLANT_PRODUCTION_FILTER_DESCRIPTORS: ColumnFilterDescriptor<PlantProductionRow>[] = [ … ];` block with:

```tsx
// SCU-2.P3.9 (spec B2.1/B2.2) — Plant Production on DataTable. Column ids are
// today's descriptor keys (e2e clicks `checkbox-filter-plant-<label>`). The
// derived filters now also include a Remaining-capacity range (spec B2.2:
// descriptors come from every column; today it had none). Built per render
// because the Plant cell depends on `identityById` + the unfiltered count.
function plantProductionColumns(identityById: Record<string, EntityIdentity> | undefined, upgrade: boolean): ColumnDef<PlantProductionRow>[] {
  return [
    {
      id: "plant",
      header: "Plant",
      kind: "enum",
      cellClassName: "text-xs",
      value: r => r.plantLabel,
      cell: r => renderPlantCell(r.plantId, r.plantLabel, identityById, upgrade),
    },
    { id: "product", header: "Product", kind: "enum", cellClassName: "text-xs", value: r => r.productLabel, cell: r => r.productLabel },
    { id: "actual", header: "Actual production", kind: "number", cellClassName: "text-xs font-mono", value: r => r.actual, cell: r => r.actual.toLocaleString() },
    { id: "capacity", header: "Enabled capacity", kind: "number", cellClassName: "text-xs font-mono", value: r => r.capacity, cell: r => r.capacity.toLocaleString() },
    {
      id: "remaining",
      header: "Remaining capacity",
      kind: "number",
      cellClassName: "text-xs font-mono",
      value: r => r.remaining,
      cell: r => (r.remaining === null ? "—" : r.remaining.toLocaleString()),
    },
  ];
}
```

(c) Replace `  const plantProductionFilters = useTableFilters(plantProductionRows, PLANT_PRODUCTION_FILTER_DESCRIPTORS);` with:

```tsx
  const plantProductionUpgrade = plantProductionRows.length > 10;
  const plantProductionCols = useMemo(
    () => plantProductionColumns(identityById, plantProductionUpgrade),
    [identityById, plantProductionUpgrade],
  );
```

(d) Replace the tab-level `<button … data-testid="button-download-service-stats-csv" …>Download CSV</button>` (the whole element, inside the Bundle 1 `justify-end` header row) with:

```tsx
        {/* SCU-2.P3.9 (spec B2.4) — tab-level Download ▾ CSV/JSON (server
            `serviceStats`); outside DataTable: it exports the whole tab. */}
        <DownloadMenu
          testId="button-download-service-stats"
          itemTestIds={{ csv: "button-download-service-stats-csv", json: "button-download-service-stats-json" }}
          onDownload={format => download("serviceStats", format)}
          disabledReason={disabledReasonFor("serviceStats")}
        />
```

(e) Replace the Plant Production section — from `        <div className="mt-2 border-t flex-shrink-0" data-testid="plant-production-section">` through the `      )}` that closes `{showPlantProduction && (` — with:

```tsx
        <div className="mt-2 border-t flex-shrink-0 p-2" data-testid="plant-production-section">
          <DataTable<PlantProductionRow>
            rows={plantProductionRows}
            rowKey={r => `${r.plantId}|${r.productId}`}
            columns={plantProductionCols}
            ctx={{ readOnly: true, demandEditable: false }}
            testIds={{
              row: r => `row-plant-production-${r.plantId}-${r.productId}`,
              pager: "plant-production-pager",
              pagerPrev: "button-plant-production-prev",
              pagerNext: "button-plant-production-next",
              pageIndicator: "plant-production-page-indicator",
            }}
            toolbar={{ extra: <span className="text-sm font-medium">Plant Production</span> }}
          />
        </div>
      )}
```

- [ ] **Step 5: Run them to verify they pass**

Run: the Step 3 command. Expected (provisional): PASS — scratch `ServiceStatsTab.test.tsx` 51 + TabCoverage 8; every pre-existing Plant Production test (16 rows, filter trigger, `text-filter-count` "16 of 16", per-row values, `identityById` upgrade) passes unchanged.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-service-stats\|plant-production-pager\|plant-production-page-indicator\|button-plant-production-' artifacts/studio/e2e/` → no hits.
2. Matrix §3 "ServiceStats Plant Production" (8 lines, `jade-ch9-workspace-bundle.spec.ts`): section visible; `[data-testid="plant-production-section"] thead th` == the five headers (the wrapper holds the toolbar + table); `row-plant-production-` count 16 / 4 / 16; `row-plant-production-plant-1-product-2`; section-scoped `button-filter-menu-trigger`; `text-filter-count` "16 of 16" / "4 of 16"; `checkbox-filter-plant-plant-1 — Ashland, KY` (column id `plant`, value = the `plantIdCityState` label); `button-clear-all-filters`. No rewrite. The band rows' e2e (`service-stats-band-*`, Bundle 1) are untouched by this task.
3. Insert:

```bash
python3 $H/insert-after.py e2e/jade-ch9-workspace-bundle.spec.ts 'expect(plantProdHeaders).toEqual(["Plant", "Product", "Actual production", "Enabled capacity", "Remaining capacity"]);' '// SCU-2.P3.9 — tab-level Download ▾ (outside the Plant Production DataTable).
await expect(page.getByTestId("button-download-service-stats")).toBeVisible();'
```

4. Local run, ports 3109/5209: `E2E_BASE_URL=http://localhost:5209 pnpm exec playwright test e2e/jade-ch9-workspace-bundle.spec.ts e2e/nonjade-servicestats-live-coverage.spec.ts e2e/delivery-teaching.spec.ts e2e/bundle2-fastfollow.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.9 — Plant Production on DataTable + Service Stats Download ▾

- JADE Plant Production renders through `DataTable` inside `plant-production-section` (title in `toolbar.extra`, filter right; column ids = today's keys; number columns centred; gains a Remaining-capacity range filter, spec-derived). The tab-level Download is Download ▾ CSV/JSON (server `serviceStats`) and stays outside the DataTable, as do `service-stats-empty`, `-unit-pending`, `-no-bands` and the band rows.
- Deviations 1, 9, 10. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.9] move Plant Production onto DataTable and add Service Stats Download menu" -m "Deviations 1, 9 (Remaining-capacity range filter added by derivation), 10." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.10: Real-browser QA over every migrated output, 7 models + full e2e gate (qa-sdet)

**Owner role:** **qa-sdet** (exempt from karpathy/ponytail, hard rule #12; if a ponytail ruleset is injected anyway, ignore it and say so). Review: a separate **`fable`** reviewer subagent against this task's diff (AGENTS.md). **Spec:** "Risks and mitigations — e2e breakage", "Verification gate — before merge" (full `E2E_BASE_URL=… pnpm e2e:gate`, real-browser QA pass). **Depends on:** P3.9 cherry-picked and re-gated.

**Files:**
- Modify only if the pass finds a stale sibling spec: `artifacts/studio/e2e/*.spec.ts` (standing gotcha: a UI bundle breaks PRIOR bundles' specs that are still in `e2e:gate`)
- Modify: `docs/CHANGELOG-implementation.md`; `docs/superpowers/flake-registry.md` (new flake sightings only)

**Interfaces:** consumes the P3.1–P3.9 testid maps ("Interfaces" table) and the matrix §3 inventory.

- [ ] **Step 1: Worktree, guards, install, servers**

Worktree `/Users/shubhamkr/nos-scu-2.p3.10`, branch `scu-2.p3.10-work`, the three base guards, `pnpm install --frozen-lockfile`. Start api (port 3110) and studio (port 5210) per the recipe.

- [ ] **Step 2: Sibling-spec sweep (standing gotcha)**

Grep `artifacts/studio/e2e/` (excluding `labs.spec.ts`) for every literal P3 removed or renamed and every visible string it changed: `plant-to-warehouse-flows`, `warehouse-to-customer-flows`, `enableFilters`, `button-download-open-warehouses-csv`, `button-download-assignments-csv`, `button-download-jadeassignments-csv`, `button-download-flows-csv`, `button-download-jade-flows-pw-csv`, `button-download-jade-flows-wc-csv`, `button-download-cost-summary-csv`, `button-download-service-stats-csv` (now menu items — any `.click()` on them needs the trigger click first), `"Download CSV"` (button text is now "Download"), and `button-filter-menu-trigger` on the JADE Flows tab (now per-leg). Every hit is either rewritten to the new UI and run green, or recorded as "not affected" with the reason.

- [ ] **Step 3: Real-browser pass (a throwaway Playwright script run via Bash against `http://localhost:5210` — qa-sdet has no browser MCP; keep the script under `.harness/scu-p3/qa/`, never committed)**

For each model, create/solve one scenario (or reuse one created by the e2e fixtures) and open every output grid its manifest lists (matrix §2a table): p-median-us, p-median-brazil, max-coverage-us, delivery-teaching-us (OpenWarehouses, Customer Assignments, Solution Summary, Service Stats), transport-coal (Flows, Solution Summary, Service Stats), two-echelon-gold-au (OpenWarehouses, Flows, Customer Assignments, Solution Summary, Service Stats), two-echelon-jade-us (OpenWarehouses, JADE Customer Assignments, JADE Flows both legs, Solution Summary, Service Stats + Plant Production). On every table, check and record (`page.screenshot()` per model; downloads captured with `page.waitForEvent("download")` and read back from disk):
1. Header + number cells centred; text columns left; no fixed widths; header text exactly as the matrix §2a column list (and no `Solution Summary` / tab-name titles).
2. Filter trigger present iff > 10 rows; opening it lists the expected controls; one filter narrows rows and the count line.
3. Pager present iff > 50 filtered rows (p-median-us Customer Assignments "Page 1 of 4"; JADE Customer Assignments "Page 1 of 8"; JADE W→C "Page 1 of 2"); Next/Prev work; a filter change returns to page 1.
4. Download ▾: CSV and JSON each download a file. Server outputs: `{entity}.csv` / `{entity}.json` with an `ExportEnvelope` JSON. Client: `jade-flows-plant-warehouse.{csv,json}`, `jade-flows-warehouse-customer.{csv,json}`, `cost-summary-compare.{csv,json}` — open each and check the header/keys and that the row count equals all rows (not the page) — e.g. P→W JSON rows = inbound edges (per product), W→C = customer × product records.
5. JADE Flows: apply a filter on P→W, switch to W→C and back — the P→W filter is still applied; the inactive leg is invisible.
6. History browsing (stepper on an older run): output Download ▾ disables with the existing reason tooltip; the tables stay read-only (they have no editable cells).
7. Unit toggle (mi ↔ km) on JADE: distance cells, the Assignments Distance header, the band filter options (and their reset) and the client export `unit` follow.

Record defects as findings with screenshots; a defect is fixed by the owning frontend-engineer task's author (new commit on this branch via a follow-up task), not silently patched here.

- [ ] **Step 4: Full e2e gate**

From `artifacts/studio`: `E2E_BASE_URL=http://localhost:5210 pnpm e2e:gate`. Then `pnpm e2e:quarantine` for the record. Expected: pass; any failure matched by test **name** against `docs/superpowers/flake-registry.md` and re-run twice in isolation before being called real. Record the pass/fail/flaky counts.

- [ ] **Step 5: Unit gate**

As P3.1 Step 8 (each command alone, vitest-quiet check first).

- [ ] **Step 6: Changelog + commit**

Append `### SCU-2.P3.10 — P3 real-browser QA + e2e gate` with the per-model checklist results, screenshots' location (not committed if large — under `.harness/`), the `e2e:gate` counts, any sibling-spec rewrites, and new flake sightings. Commit (branch-guarded, explicit pathspec: the changelog, any rewritten specs, the flake registry if touched) as `[SCU-2.P3.10] record P3 real-browser QA and e2e gate`, body ending with the Co-Authored-By line. Then dispatch the `fable` reviewer.

---

## Phase P3 exit (controller, after P3.10 is cherry-picked)

- [ ] `git log --oneline "$P2_TIP"..scnd-upgrades` shows exactly ten `[SCU-2.P3.N]` commits, N = 1…10, in order.
- [ ] `git diff --stat "$P2_TIP"..scnd-upgrades -- artifacts/api-server lib solvers` → empty (no server/contract/solver change); `git diff --name-only "$P2_TIP"..scnd-upgrades -- artifacts/api-server/src/solver/solve.py` → empty.
- [ ] `grep -rn 'useTableFilters\|FilterMenu\|PAGE_SIZE' artifacts/studio/src/components/workspace/tabs/{OpenWarehouses,Assignments,JadeAssignments,Flows,JadeFlows,CostSummary,ServiceStats}Tab.tsx` → comments only (every output table filters/pages through the shell).
- [ ] Re-run the full gate on the bundle tip (each command separately, vitest-quiet check first).
- [ ] Hand P4: `DownloadMenu` + `chooseDownload` (inputs add the expected-fields panel on top, B2.3/B2.4), the edit helpers, the Download ▾ testid scheme (Deviation 1) and the answers to the open questions below (Deviation 2 governs the input toolbars too).
- [ ] No `/harness-retro`, merge, push or deploy: the branch finishes after P4 (root CLAUDE.md branch pipeline).

## Open questions for the user (defaults in force until answered)

1. **Download ▾ placement (Deviation 2).** Default: left slot of the DataTable toolbar (P1 contract), so Download moves from the right (B1.4) to the left of the count/filter group in five output tabs, and every input table matches. Alternative: keep it right — a one-line P1 shell change, applied before P3.1.
2. **Filter menus on the Solution Summary metric tables (Deviation 4).** Default: spec-literal — a metric-name filter appears when a summary has > 10 rows (JADE single: 11). Alternative: never filter metric tables (`filter: false` on the metric column; two lines).
3. **JADE Flows export granularity (Deviation 6).** Default: per product (P→W one row per inbound edge; W→C one row per customer × product), which is what B2.4's `product` field implies — so the files have more rows than the on-screen per-pair / per-customer tables. Alternative: one row per on-screen row with `product: null`. Also confirm the CSV's trailing `unit` column.
4. **Compare JSON shape (Deviation 7):** `rows: [{ metric, values: [{ scenarioId, scenario, value }] }]` — OK?
5. **Flows distance "—" (G-3).** Transport-coal and gold-au Flows show no distances because `Workspace.tsx` never passes `distanceUnit` to `FlowsTab`. Fix it (one prop, plus a TabCoverage-level assertion) as part of P3.4, or leave it for a separate bug task?

## Self-review (run at plan time)

- **Spec coverage.** B2.1 (adapter per table, literal testids, `ctx`, number centring, no fixed widths — the shell's) → every task. B2.2 filter > 10 rows on all models (P3.1 deletes the JADE-only opt-in; P3.2/P3.4/P3.7 add filters where none existed), pager > 50 (each task's pager literals + tests; `jadeassignments-page-indicator` kept, P3.3), descriptor ids = column ids (every adapter), filter-type pins (Deviation 9). B2.4 server CSV + JSON for `assignments` (P3.2, P3.3), `openWarehouses` (P3.1), `costSummary` (P3.7), `serviceStats` (P3.9), `flows` (P3.4) — G-1 shows no server work is needed; client-built typed builders for JADE P→W (P3.5), W→C (P3.6) and compare (P3.8, same row model as B1.3's CSV), `{ entity, unit?, rows }`, the spec's file names, all rows. B2.10 one instance per commit (P3.1–P3.9 = the nine P3 rows of §1). "Risks — e2e breakage": every task greps its literals, re-reads its matrix §3 lines, adds an assertion for its new control and runs the specs locally with `E2E_BASE_URL`; P3.10 runs the sibling sweep, the real-browser pass and the full gate. "Behaviour changes users will notice" → Deviation 10, each task's changelog.
- **Placeholder scan.** The only `<…>` tokens are changelog values the task must measure (rule: measured or `unknown`), `B1_TIP`/`P2_TIP`/`BASE` (set by L0 / the topology commands) and the worktree index `N` in the topology template. No "TBD"/"similar to" steps: every code and test change is spelled out (or is a guarded mechanical script).
- **Type consistency with P1 (rev 4, `8f80d35`).** Adapters use only `DataTable`, `ColumnDef` (`id`, `header`, `filterLabel`, `kind`, `cell`, `value`, `filter`, `cellTestId`, `headerTestId`, `cellClassName`, `filterResetKey`), `DataTableTestIds` (`root`, `table`, `count`, `row`, `pager`, `pagerPrev`, `pagerNext`, `pageIndicator`, `filterTrigger`), `DataTableToolbar` (`download`, `extra`), `footer`, and the required `ctx` (`{ readOnly: true, demandEditable: false }`). Verified by compiling every code block with `tsc --noEmit` (`tsconfig.json` and `tsconfig.e2e.json`, exit 0) against byte-identical copies of the committed P1 files, and by running the touched test files under vitest: `DownloadMenu` 4, `OpenWarehousesTab` 38, `AssignmentsTab` 28, `JadeAssignmentsTab` 32, `FlowsTab` 25, `jadeFlowsExport` 6, `JadeFlowsTab` 42 (after P3.5) / 46 (after P3.6), `CostSummaryTab` 82 (after P3.7) / 89 (after P3.8), `compareCsv` 5 / 7, `ServiceStatsTab` 51, `Workspace.Integration` 15, `Workspace.TabCoverage` 8 — all passing, plus a full studio run whose only failures were the five path-bound suites that need the real repo root (`pnpm-workspace.yaml`) and load flakes that passed on isolated re-run. **The generated plan itself was then dry-run:** a script built the simulated post-Bundle-1 base from the real `5ba7c4c` files, executed every task's Step 2 code blocks verbatim (create / append / `bash` edit blocks, helpers included), ran that task's tests (each task: N failed before the implementation — P3.1 19, P3.2 13, P3.3 6, P3.4 9, P3.5 13, P3.6 8, P3.7 16, P3.8 7, P3.9 15), applied the implementation, executed its e2e insert block, and re-ran (each task: 0 failed). The final dry-run state type-checks under both configs and its full studio suite fails only the five path-bound suites.
- **What the scratch run could not prove:** real Bundle 1 code (simulated from its plan), the e2e behaviour (no servers were started at plan time — each task's local e2e step and P3.10 own that), and CSS (`hidden`, centring) in a real browser — P3.6's `toBeHidden()` line and P3.10 cover those.
