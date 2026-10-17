# SCND Upgrades — Bundle 2 Phase P3 Implementation Plan (output tables)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, seed a TaskCreate entry per task **and** per process gate (each task's anchor re-verification, RTL run, e2e run, gate run and changelog entry; the phase-exit checks), per the standing ledger rule.

**Goal:** Move all nine Workspace output-table instances onto the shared P1 `DataTable` shell (spec B2.1/B2.2), one instance per commit (B2.10), and give every output a **Download ▾ (CSV / JSON)** control (B2.4): server-exported for `openWarehouses`, `assignments`, `flows`, `costSummary`, `serviceStats`; client-built for JADE Flows P→W, JADE Flows W→C (each exactly the on-screen table) and the Cost Summary compare table (B1.3's row model). Download ▾ sits on the **right** of every output toolbar. Every table gets the shell's filter menu above 10 rows — except the two Solution Summary metric tables, which never filter — and its pager above 50 filtered rows, with number columns centred; every testid in the B2.10 matrix maps survives.

**Architecture:** Each output tab keeps its own row derivation (unchanged) and becomes a thin **adapter**: a memoised `ColumnDef<Row>[]` (column ids = today's filter-descriptor keys, so e2e that addresses filters by key keeps working), a literal `testIds` map, `ctx={{ readOnly: true, demandEditable: false }}`, and a `toolbar.download` slot rendered right-aligned (`toolbar.downloadAlign: "right"`, the one additive P1 prop this phase relies on; P3.7 adds one shell condition, Deviation 13). One new shared control, `components/data-table/DownloadMenu.tsx` (Popover-based, like `FilterMenu`), replaces every single "Download CSV" button; P4 reuses it for inputs. Client-built exports use Bundle 1's `downloadTextFile` and the envelope `{ entity, unit?, rows }`: JADE Flows files come from `lib/jadeFlowsExport.ts` (the on-screen row model, verbatim headers), the compare JSON from `buildCompareJson` next to Bundle 1's `buildCompareCsv` (same row model). Server JSON keeps its own versioned `ExportEnvelope` (G-4). No server, OpenAPI, solver or DB change: the server already serves JSON for all five output entities (see grounding fact G-1).

**Tech Stack:** React 18 + TypeScript + Vite (`artifacts/studio`), Tailwind, Radix Popover (`components/ui/popover.tsx`), vitest 3 + React Testing Library 16 + `@testing-library/user-event` 14 (jsdom), Playwright e2e (`artifacts/studio/e2e`).

**Spec (source of truth):** `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` **rev 4** — §B2.1, §B2.2, §B2.4, §B2.10, "Risks and mitigations", "Verification gate". **Interfaces consumed verbatim:** `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-p1.md` (rev 4, commit `8f80d35`, plus the additive `DataTableToolbar.downloadAlign` folded in with this plan's review), section "Interfaces". **User decisions folded (2026-10-17):** output Download ▾ right-aligned; Solution Summary metric tables never filter; JADE Flows downloads are exactly the on-screen table; the non-JADE Flows `distanceUnit` gap is fixed in P3.4. **Matrix:** `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-matrix.md` §2a (the nine output instance records + testid maps), §3 (e2e inventory), §4 (G1–G21), §5. **Base code:** the post-Bundle-1 state defined by `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle1.md` (SCU-1.2 exclusive band rows, SCU-1.3 Solution Summary bar + `lib/clientCsv.ts` + `lib/compareCsv.ts` + the compare row model, SCU-1.4 title removals), plus P1 and P2.

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
  - Filter menu top-right **when effective rows > 10** (all models) — **exception (spec B2.2, user decision): the Solution Summary metric tables (single + compare) never get a filter** (`filter: false` on every column); descriptors generated from `columns`; precedence explicit `filter` → `kind: number` → range → `kind: enum` → select → `kind: text` → select if ≤ 20 distinct non-null values, else text. Descriptor ids = column ids. Filtering uses `value()`, never display text. Trigger testid `button-filter-menu-trigger` kept.
  - Page size **50**; pager rendered **only when filtered rows > 50**; Prev / "Page X of Y" / Next; pager/indicator testids mapped per table (`jadeassignments-page-indicator` kept).
  - Outputs, server-exported (`assignments`, `openWarehouses`, `costSummary`, `serviceStats`, `flows`): CSV + JSON via the server (`useExport().download(entity, format)`).
  - Outputs, client-built (JADE Flows P→W and W→C, Cost Summary compare). **JADE Flows = exactly the on-screen table** (spec B2.4 as amended): same columns (Plant/Warehouse or Warehouse/Customer, Distance, Flow(s) summed over products, Distance Band), same rows (one per on-screen row), no product column; distance in the active unit, `unit` in the envelope (and in the CSV's Distance header). Compare: same row model as B1.3's CSV. JSON shape `{ entity, unit?, rows }`; filenames `jade-flows-plant-warehouse.{csv,json}`, `jade-flows-warehouse-customer.{csv,json}`, `cost-summary-compare.{csv,json}`. **Scope = all rows (not filtered/paged)**, matching server exports.
  - `ctx` is required; output adapters pass `{ readOnly: true, demandEditable: false }` (P1 adapter rules).
  - Output toolbars pass `downloadAlign: "right"`: Download ▾ renders last, after the count and the filter trigger (B1.4's right-aligned Download kept; spec B2.1 amended). Input tables keep the default left slot (P4).
- **Gate (every task, verbatim from the spec; scripts verified: root `package.json:10` `typecheck`, `artifacts/studio/package.json:11` `typecheck:e2e`, `:12` `test`, `artifacts/api-server/package.json:12` `test`):**
  `pnpm run typecheck && pnpm --filter studio typecheck:e2e && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
  plus `pnpm --filter @workspace/import-schema test` (P2 created that package). Run each command separately and judge it by its own exit status. **Before trusting any suite**, run the concurrency check alone and record its output in the changelog: `cnt=$(ps aux | grep "[v]itest" | grep -v "zsh -c" | wc -l | tr -d ' '); echo "vitest procs: $cnt"; [ "$cnt" = "0" ] || exit 1` — never chained with `&&` (the root CLAUDE.md gotcha: `grep -c` exits 1 on a zero count). Non-zero → wait and re-check; do not run the gate over another session's suite.
- **Local DB:** `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev"` written **explicitly, inline, on every command that needs it** — `pnpm --filter api-server test`, the api dev server, and nothing else in P3 (studio vitest, typecheck, pytest and Playwright do not open the DB themselves). `nos_dev` is shared with other sessions. **An isolated database is deliberately not required** (it would be overkill for P3): no P3 test writes fixed scenario ids — every e2e spec registers its own user and creates its own scenarios, and the api-server suite is unchanged by P3 — so the known cross-session hazard (another session's dispatcher claiming a `queued` row, root CLAUDE.md) cannot touch P3's assertions. The vitest-concurrency check above is the control that matters.
- **Local e2e (every task's e2e step; `artifacts/studio/e2e/CLAUDE.md` recipe).** Task N uses api port `3100+N` and studio port `5200+N` (P3.10 uses 3110/5210). From the task worktree, each server in the background:
  - `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=310N pnpm --filter api-server run dev`
  - `PORT=520N BASE_PATH=/ API_PROXY_TARGET=http://localhost:310N VITE_POSTHOG_KEY=phc_local_dummy_key VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 pnpm --filter studio run dev`
  - then, from `artifacts/studio`: `E2E_BASE_URL=http://localhost:520N pnpm exec playwright test <specs>` (quarantined specs: `E2E_BASE_URL=http://localhost:520N pnpm e2e:quarantine`). **`E2E_BASE_URL` is never optional** — without it Playwright silently tests a remote Replit deployment. Stop both servers when the step ends. If a server cannot start, record `e2e: not run — <reason>, deferred to SCU-2.P3.10` in the changelog; never claim green.
- **Flakes:** before calling a failure a regression, check `docs/superpowers/flake-registry.md` by test **name** and re-run the failing file twice in isolation. Record any new sighting there.
- **Every `Expected:` count below comes from a plan-time dry run on the REAL Bundle 1 tip and is still provisional — the binding numbers come from Step 1.** Step 1 of every task re-anchors against the real post-Bundle-1/P1/P2 tip and records a baseline run of that task's test files; the task's expected counts are then *baseline − deleted + added* (each task lists its deleted/added tests). Plan-time verification: a monorepo-shaped scratch copy of `artifacts/studio` + `lib/units` **at Bundle 1's real tip `aa7141a`** (node_modules from the main checkout; `@workspace/units` pointed at the `aa7141a` copy) plus the committed P1 rev-4 shell files (byte-identical) and this plan's `downloadAlign` addition. **P2 was not applied** in the scratch tree: P2 changes only the import path (`ImportDialog`, `ExportContext`/`exportEntity` entity lists, server) and no P3 file, so the P3 counts cannot depend on it — Step 1's real baseline at the P2 tip is what proves that.
- **No merge, no push, no deploy.** Bundle 2 continues on this branch (P3 → P4).

## Grounding facts and deviations (read before any task)

Each deviation is the smallest correct reading where spec text and repo disagree, or where the spec leaves a choice open (hard rule #8). The commit implementing it names it in its body. Items marked "user decision" record the user's 2026-10-17 answers (see "Decisions folded" at the end); no P3 question is open.

- **G-1 Server JSON export already exists for all five output entities — no contract change.** `routes/scenarios.ts:622-625` accepts `format` `csv|json` for every entity; the JADE branch emits JSON at `:809-813`, the generic branch at `:837-869`; OpenAPI `exportScenario` declares `format: enum [csv, json]` (`lib/api-spec/openapi.yaml:523-528`) and `application/json` → `ExportEnvelope` (`:560-562`); covered by `__tests__/routes.test.ts:2098-2404` and `__tests__/solveExportIntegration.test.ts:90-97`. The studio already forwards `format` (`lib/exportEntity.ts:51-62`, `contexts/ExportContext.tsx:106-119`); the JSON file name is `${entity}.json`.
- **G-2 Bundle 1 changed every P3 file — reconciled against its real tip `aa7141a`** (`git -C /Users/shubhamkr/nos-scnd-b1 show aa7141a:<path>`). SCU-1.4 removed the tab titles and left `justify-end` header rows in OpenWarehouses/Assignments/JadeAssignments/Flows/ServiceStats (JADE Flows keeps its `justify-between` header with the segmented control); SCU-1.3 rebuilt `CostSummaryTab.tsx` around `summaryBar()` + the `CompareRow` row model (`csvLabel: string | null` — `null` = row omitted from the CSV, used by the band rows while the unit is unresolved) and moved `csvCell`/`downloadTextFile`/`downloadClientCsv` into `lib/clientCsv.ts` (`csvCell` now escapes `\r` and guards spreadsheet formula injection on string cells); `buildCompareCsv` lives in `lib/compareCsv.ts` and drops `csvLabel: null` rows; SCU-1.2 made Service Stats use `computeExclusiveBandCoverage` / `frozenBandCoverageToExclusive` / `exclusiveBandLabels`; SCU-1.6 made `SidebarTree` controlled (no P3 file touches it). Measured: the real `OpenWarehousesTab`, `AssignmentsTab`, `JadeAssignmentsTab`, `FlowsTab`, `JadeFlowsTab` are byte-identical to what this plan was first written against, and `CostSummaryTab.tsx` differs only in comments, `csvLabel: string | null` and the band rows' `csvLabel: unitLabel == null ? null : …` — none inside a region P3 replaces. Real Bundle 1 tests P3 must also edit: `CostSummaryTab.test.tsx` "compare CSV: band rows are omitted (no duplicate '— (%)' labels) while the distance unit is unresolved" (P3.8 Step 2). Real baselines at `aa7141a` (+ P1): OpenWarehouses 34, Assignments 23, JadeAssignments 28, Flows 21, JadeFlows 38, CostSummary 77, ServiceStats 48, compareCsv 5, clientCsv 3, TabCoverage 8, Integration 15, DataTable 35.
- **Deviation 1 — Download ▾ testids.** One trigger + two items per table: trigger `button-download-{x}`, items `button-download-{x}-csv` / `button-download-{x}-json`, where `{x}` is today's stem (`open-warehouses`, `assignments`, `jadeassignments`, `flows`, `jade-flows-pw`, `jade-flows-wc`, `cost-summary`, `service-stats`). Today's `button-download-{x}-csv` literal therefore moves from a button to the CSV **menu item** (only rendered while the menu is open). Unit tests that clicked it now open the menu first (`chooseDownload` helper); disabled-state tests assert on the trigger. No e2e spec references any output download button (grep run on every literal), so no e2e breaks; each task adds one e2e assertion for its menu.
- **Deviation 2 (user decision A) — Download ▾ on the RIGHT of output toolbars.** P1's toolbar renders `upload, download, add, extra`, then right-aligned `count` + filter trigger. Outputs keep B1.4's right-aligned Download through one additive P1 prop, `DataTableToolbar.downloadAlign?: "left" | "right"` (default `"left"`; `"right"` renders `download` last, after the filter trigger), folded into the P1 plan (types + one DataTable test) and spec B2.1. Every output adapter passes `downloadAlign: "right"`; inputs (P4) keep the default. Bundle 1's SCU-1.4 "keeps Download right-aligned" tests are **kept** and retargeted from the vanished `justify-end` header row to the toolbar's right-aligned group (`closest("div.ml-auto")` + last child).
- **Deviation 3 — JADE Flows legs stay mounted.** Today both legs' `useTableFilters` live in the parent, so a filter on P→W survives switching to W→C and back (unit test "selecting a range in EACH inner table…"). A DataTable owns its filter state, so conditional rendering would reset it on every leg switch. Both leg DataTables are therefore always mounted; the inactive one sits in a `hidden` wrapper. Two FilterMenus then coexist in the DOM, so each leg maps its own trigger testid (`button-filter-jade-flows-pw`, `button-filter-jade-flows-wc`; matrix G14 — exactly the literal P1's FilterMenu test uses). No e2e uses a JADE Flows filter trigger (grep run). Unit tests that addressed `button-filter-menu-trigger` on this tab are rewritten per leg; "`jade-flows-pw-table` not in document" becomes "not visible". The `hidden` attribute is proven in a real browser by P3.6's e2e line (`toBeHidden()`), because jsdom cannot prove CSS (`artifacts/studio/CLAUDE.md`). **Menus do not leak across a leg switch (Codex finding 3):** both the filter popover and Download ▾ are Radix `Popover`s rendered in a portal; the leg buttons are outside them, so a pointer-down/focus on a leg button dismisses the open one (Radix `DismissableLayer`), and because the dismissal came from an outside interaction Radix does **not** return focus to the (now hidden) trigger. That is the "or equivalent" of explicitly closing them; it is pinned by RTL tests (P3.5: open Download ▾, switch leg → no menu item in the DOM, focus on the leg button; P3.6: same for the filter popover) and by the same checks in a real browser (P3.5/P3.6 e2e, `toHaveCount(0)` + `toBeFocused()`).
- **Deviation 4 (user decision B) — the Solution Summary metric tables never filter.** Single and compare are transposed metric tables (rows are metrics, columns are scenarios, values pre-formatted mixed text). Adapter: a `metric` column (`kind: "text"`) and one value column per scenario (`kind: "number"`, centred), **every column `filter: false`**, so the shell never renders a filter menu there whatever the row count (JADE single: 11 rows; JADE compare: 11+). Spec B2.2 gains this one exception line.
- **Deviation 5 — per-row monospace moves into a `<span>`.** `ColumnDef.cellClassName` is per column; CostSummary decides `font-mono` per row. The cell renders `<span className="font-mono">` when the row is mono. B1.3's `CompareRow.{labelClassName, cellClassName}` (which also carried padding the shell now owns) become `labelMono?: boolean` / `mono: boolean`. The one unit test that asserted `font-mono` on the `<td>` ("renders numeric stats with font-mono…") looks inside the `<td>` instead. No e2e asserts the class (grep run).
- **Deviation 6 (user decision C) — JADE Flows downloads are exactly the on-screen table.** Same columns, header text verbatim (`Plant, Warehouse, Distance, Flow, Distance Band` / `Warehouse, Customer, Distance, Flows, Distance Band`), same rows (P→W one per plant–warehouse pair with flow summed over products; W→C one per customer), all of them (never just the filtered page), no product column. Values are typed, built from the tab's own row model (not DOM text): the single-line entity label the cell falls back to, distance in the active display unit at the on-screen 1-dp precision, flow as a plain number, the band label the cell shows. CSV: the on-screen headers with the unit in the Distance header (`Distance (mi)`); JSON: `{ entity, unit, rows }` with keys `plant, warehouse, distance, flow, distanceBand` / `warehouse, customer, distance, flows, distanceBand`. Envelope `entity`: `jadeFlowsPlantWarehouse` / `jadeFlowsWarehouseCustomer` (client-only files; never imported). Spec B2.4 amended.
- **Deviation 7 — Compare JSON rows.** `{ entity: "costSummaryCompare", unit?, rows: [{ metric, values: [{ scenarioId, scenario, value }] }] }` — one row per compare-table row (the CSV's row model), values in on-screen column order, keyed by id because scenario names are not unique. `unit` is the active display unit, omitted while unresolved.
- **Deviation 8 — filter values for columns that had no filter before.** Assignments and Flows gain filters (> 10 rows): entity columns filter on the text "City, ST displayId" (the OpenWarehouses accessor pattern, `OpenWarehousesTab.tsx:170-175`), and the new distance ranges use the **display-unit** value the student reads in the cell. JADE tables keep their existing descriptors unchanged (JADE distance ranges stay canonical, as today).
- **Deviation 9 — filter types pinned where auto-derivation would change today's control** (matrix §5.5): OpenWarehouses `warehouse` text; JadeAssignments `customer` text, `warehouse` select; JADE W→C `customer` text. Plant Production gains a Remaining-capacity range (spec-derived; matrix §5.5 lists it).
- **Deviation 10 — behaviour changes recorded in the changelog** (spec "Behaviour changes users will notice", matrix §5): filter menus appear on Assignments, Flows and OpenWarehouses (non-JADE) when > 10 rows (never on the Solution Summary metric tables); pagers appear at > 50 rows (p-median-us Customer Assignments: 200 → 4 pages; JADE W→C: 100 → 2 pages; JADE Customer Assignments keeps 8); number columns centre (were right-aligned, Plant Production left); a JadeAssignments filter change now returns to page 1 (today it only clamped); the tables' `sticky top-0` header is gone (the shell has none; pages are ≤ 50 rows); JADE Flows download file names change to the spec's and their distance cells become numbers with the unit in the header; Download ▾ stays right-aligned on outputs; transport-coal/gold-au Flows now show distances (G-3).
- **Deviation 11 — `downloadClientCsv` is deleted** in P3.6: after W→C moves to `downloadJadeFlows`, nothing calls it (grep in that task).
- **Deviation 14 (user decision 2026-10-17) — km band labels round like every other displayed distance.** Bundle 1's band labels print each boundary with `toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false })`, so a mi-canonical model shown in km reads `0–321.8688 km`. The app's existing distance display formatter is `formatDistanceDisplay` (`lib/formatDistanceDisplay.ts:17`, "the ONE display formatter for a distance shown in a Distances-tab grid": ≤ 2 dp, thousands-grouped). P3.9 moves the formatting **into** `exclusiveBandLabels` (signature `(boundaries, toDisplay, unit)` instead of `(boundaries, format, unit)`), so Service Stats, the Compare band rows and the Output Map narrative — its three callers — all print `0–321.87 km`. Consequence, accepted and recorded: boundaries ≥ 1,000 gain the thousands separator that formatter applies everywhere else (`800–1,600 mi`, `> 1,600 mi`); five existing unit-test expectations and the narrative sentences are rewritten accordingly (P3.9 Step 2). No e2e asserted a 4-digit boundary. Owner: P3.9 (the band-label helper's home table), after P3.8.
- **Deviation 13 — the shell renders no filter menu when no column is filterable.** P1's `DataTable` decides `showFilter` on the row count alone (`rows.length > FILTER_ROW_THRESHOLD`, P1 plan Step 7), so a table whose columns are all `filter: false` would still render an empty FilterMenu above 10 rows. Decision B needs it gone; the smallest correct fix is one condition in the shell, `&& descriptors.length > 0`, made **in P3.7** (with one DataTable test) rather than by editing the P1 plan again (the P1 plan is kept to the single `downloadAlign` addition). No P1 test changes: none asserts a menu for an all-unfilterable table.
- **Deviation 12 (Codex finding 2) — client-built JADE downloads share the server exports' guard.** Both legs' Download ▾ take `disabledReason = useExport().disabledReasonFor("flows") ?? (canonical unit unresolved ? "Loading…" : undefined)`: an unaddressable history entry (`resultDisabledReason`) and an unresolved export unit disable it exactly as they disable every server download; the tab's own canonical-unit resolution covers the rest. `JadeFlowsTab` therefore reads `useExport()` and its tests render through `AllProviders`. The compare download needs no history guard: compare mode is unreachable while browsing history (`compareMode = !isBrowsingHistory && …`, Bundle 1).
- **G-3 (user decision D) — fix the non-JADE Flows distance gap in P3.4.** `Workspace.tsx` mounts `FlowsTab` without `distanceUnit` (matrix §2a "Flows"; `Workspace.tsx:4205` at `46d2f98`), so transport-coal and two-echelon-gold-au show "Distance" / "—". P3.4 passes `distanceUnit={canonicalUnit}`, the value the sibling output mounts already pass (`Workspace.tsx:4148,4164,4199` at `46d2f98`), and pins it with an RTL test (Workspace-level header + value; FlowsTab unit toggle) and an e2e (gold-au header, value, km↔mi toggle).
- **G-4 (Codex finding 9) — two different JSON shapes, on purpose.** Server JSON (`useExport().download`) is the versioned `ExportEnvelope` (`openapi.yaml` `ExportEnvelopeV1`… oneOf): `openWarehouses` is **V1, unitless** (`{ templateVersion: 1, entity, rows }`, no `unit` key); `assignments`, `flows`, `serviceStats` (incl. the JADE product-level assignments and combined-leg flows shapes) are V3 with `unit`; `costSummary` uses its own `COST_SUMMARY_TEMPLATE_VERSION` with `unit` (`routes/scenarios.ts:845-869`). Client-built files are `{ entity, unit?, rows }` with **no** `templateVersion` — they are reports, never import documents (P2's JSON import accepts only server entities). Each task's e2e asserts the family it touches: `typeof templateVersion === "number"` (the exact numbers are already pinned to their constants by the server's own contract tests, which P3 does not touch), `unit` present (`"mi"`) or absent (`openWarehouses`), `entity`, and the row count against the screen.

## File Structure

| Path (under `artifacts/studio/`) | Change | Task |
|---|---|---|
| `src/components/data-table/DownloadMenu.tsx` | **new** — `DownloadMenu`, `DownloadMenuProps`, `DownloadFormat` | P3.1 |
| `src/__tests__/DownloadMenu.test.tsx` | **new** | P3.1 |
| `src/__tests__/helpers/downloadMenu.ts` | **new** — `chooseDownload(triggerTestId, itemTestId)` | P3.1 |
| `src/components/workspace/tabs/OpenWarehousesTab.tsx` | adapter; `enableFilters` prop deleted | P3.1 |
| `src/pages/Workspace.tsx` | drop the OpenWarehouses `enableFilters` prop (3 lines, P3.1); pass `distanceUnit={canonicalUnit}` to `FlowsTab` (P3.4, G-3) | P3.1, P3.4 |
| `src/__tests__/{OpenWarehousesTab,Workspace.Integration,Workspace.TabCoverage}.test.tsx` | rewritten / extended | P3.1 (+ TabCoverage one line each in P3.2, P3.4, P3.7, P3.9) |
| `src/components/workspace/tabs/AssignmentsTab.tsx` + test | adapter | P3.2 |
| `src/components/workspace/tabs/JadeAssignmentsTab.tsx` + test | adapter; local `PAGE_SIZE`/`Pager` deleted | P3.3 |
| `src/components/workspace/tabs/FlowsTab.tsx` + test | adapter | P3.4 |
| `src/lib/jadeFlowsExport.ts` + `src/__tests__/jadeFlowsExport.test.ts` | **new** — JADE Flows downloads built from the on-screen row model | P3.5 |
| `src/lib/clientCsv.ts` (Bundle 1) | − `downloadClientCsv` (no caller after P3.6) | P3.6 |
| `src/components/workspace/tabs/JadeFlowsTab.tsx` + test | P→W adapter (P3.5), W→C adapter (P3.6) | P3.5, P3.6 |
| `src/components/workspace/tabs/CostSummaryTab.tsx` + test | single adapter (P3.7), compare adapter (P3.8) | P3.7, P3.8 |
| `src/lib/compareCsv.ts` (Bundle 1) + `src/__tests__/compareCsv.test.ts` | + `buildCompareJson` | P3.8 |
| `src/components/workspace/tabs/ServiceStatsTab.tsx` + test | Plant Production adapter + tab-level Download ▾ | P3.9 |
| `e2e/helpers/download.ts` | **new** — `downloadVia(page, trigger, item)` (real `download` event → file name + text), `csvDataLines(text)` | P3.1 |
| `e2e/{max-coverage,workspace-fixups-2,jade-two-echelon,two-echelon,jade-ch9-workspace-bundle,workspace-ux-r1-r9}.spec.ts` | one added assertion block per task (menu, real download + row completeness, paging/filter where the table has them) | P3.1–P3.9 |
| `docs/CHANGELOG-implementation.md` | one `### SCU-2.P3.N` per task | all |
| `.harness/scu-p3/{scoped-replace,delete-block,insert-after,insert-after-block}.py` (worktree root; gitignored scratch) | edit helpers, never committed | Step 1 of every task |
| `docs/superpowers/plans/2026-10-17-scnd-upgrades-bundle2-p1.md`, `docs/superpowers/specs/2026-10-16-scnd-upgrades-design.md` | already amended at plan time (P1: `DataTableToolbar.downloadAlign` + one test; spec: B2.1/B2.2/B2.4 lines) — **not** a P3 task edit | — |

## Interfaces

**Consumed (P1 rev 4, verbatim — `@/components/data-table/*`):** `DataTable<T>(props: DataTableProps<T>)`; `DataTableProps<T>` (`rows`, `rowKey`, `columns`, `testIds?`, `rowClassName?`, **`ctx: DataTableContext<T>`**, `toolbar?`, `emptyState?`, `noMatchText?`, `sections?`, `focus?`, `scrollClassName?`, `footer?`); `ColumnDef<T>` (`id`, `header`, `filterLabel?`, `kind: "text" | "number" | "enum"`, `cell(row, ctx)`, `value(row): string | number | null`, `filter?: false | "text" | "select" | "range"`, `cellTestId?`, `headerTestId?`, `cellClassName?`, `hidden?`, `filterResetKey?`); `DataTableTestIds<T>` (`root`, `toolbar`, `table`, `scroll`, `count`, `row`, `pager`, `pagerPrev`, `pagerNext`, `pageIndicator`, `filterTrigger`, `empty`, `noMatch`); `DataTableToolbar` (`upload`, `download`, `add`, `extra`, **`downloadAlign?: "left" | "right"`** — default `"left"`; `"right"` renders `download` last, after the count and the filter trigger). Adapter rules relied on: `cell()` output goes directly in the `<td>`; `cellTestId` on the `<td>`, `headerTestId` on the `<th>`, `testIds.row` on the `<tr>`, `testIds.table` on the `<table>`, `testIds.root` on the outer `<div>` that holds toolbar + table + pager + footer; omitted testids emit nothing; columns memoised; toolbar order `upload, download, add, extra`, then right-aligned `count` + filter trigger (+ `download` when `downloadAlign: "right"`). **Every output adapter passes `downloadAlign: "right"`.**

**Consumed (Bundle 1 at `aa7141a`: `lib/clientCsv.ts`, `lib/compareCsv.ts`, `lib/bands.ts`, `CostSummaryTab.tsx`):** `csvCell(value: string | number): string` (escapes `"`, `,`, `\r`, `\n`; prefixes `'` to a string cell starting `=`, `+`, `-`, `@`, tab or CR unless it is a number); `downloadTextFile(filename, text, mimeType): void`; `downloadClientCsv(filename, headers, rows)` (deleted by P3.6); `CompareCsvRow { csvLabel: string | null; cells: Array<{ raw: number | string | null }> }`; `buildCompareCsv(rows, scenarios): string` (omits `csvLabel: null` rows); `exclusiveBandLabels(boundaries, format, unit)` (signature changed by P3.9, Deviation 14); the private `CompareRow`/`CompareCell` row model, `summaryBar(download: ReactNode)` and `compareRows` inside `CostSummaryTab`.

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

// e2e/helpers/download.ts (P3.1)
export function downloadVia(page: Page, triggerTestId: string, itemTestId: string): Promise<{ name: string; text: string }>;
export function csvDataLines(text: string): string[];

// lib/jadeFlowsExport.ts (P3.5) — exactly the on-screen JADE Flows table
export interface JadeFlowScreenRow { fromLabel: string; toLabel: string; distance: number /* canonical */; flow: number; band: string }
export interface JadeFlowLeg {
  entity: "jadeFlowsPlantWarehouse" | "jadeFlowsWarehouseCustomer";
  fileBase: string;                                          // "jade-flows-plant-warehouse" | "jade-flows-warehouse-customer"
  headers: readonly [string, string, string, string, string]; // on-screen header text
  keys: readonly [string, string, string, string, string];    // JSON keys
}
export const PLANT_WAREHOUSE_LEG: JadeFlowLeg;
export const WAREHOUSE_CUSTOMER_LEG: JadeFlowLeg;
export interface JadeFlowsJson { entity: JadeFlowLeg["entity"]; unit: string; rows: Array<Record<string, string | number>> }
export function jadeFlowsCsv(leg: JadeFlowLeg, rows: JadeFlowScreenRow[], toDisplay: (canonical: number) => number, unit: string): string;
export function jadeFlowsJson(leg: JadeFlowLeg, rows: JadeFlowScreenRow[], toDisplay: (canonical: number) => number, unit: string): JadeFlowsJson;
export function downloadJadeFlows(leg: JadeFlowLeg, format: "csv" | "json", rows: JadeFlowScreenRow[], toDisplay: (canonical: number) => number, unit: string): void;

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

Dependency graph: **P3.1** (creates `DownloadMenu` + test helper) blocks every other task. **P3.5** (creates `jadeFlowsExport.ts`, the JADE download guard) blocks **P3.6** (same file). **P3.7** blocks **P3.8** (same file). P3.2, P3.3, P3.4, P3.9 touch disjoint source files, but P3.1/2/4/7/9 each edit one of five **adjacent** constant lines in `Workspace.TabCoverage.test.tsx` (`:157-161`), which conflict on cherry-pick, and every task starts local servers on the shared `nos_dev`. **Run the tasks sequentially**, in id order P3.1 → P3.9, then P3.10: each task's worktree is created from the `scnd-upgrades` tip after the previous task was cherry-picked and re-gated. (Simplest correct order; parallel waves would buy little for nine one-file tasks and cost conflict handling.)

**Step L0 (lead, once, before P3.1):**

```bash
cd /Users/shubhamkr/nos-scnd-upgrades && git rev-parse --abbrev-ref HEAD      # must print scnd-upgrades
git status --short                                                             # must be empty (tracked files)
git log --format=%s scnd-upgrades | grep -c '^\[SCU-2\.P1\.'                    # must print 6
git log --format=%s scnd-upgrades | grep -c '^\[SCU-2\.P2\.'                    # must print 3
B1_TIP=$(git -C /Users/shubhamkr/nos-scnd-upgrades rev-parse aa7141a); echo "$B1_TIP"   # Bundle 1's real tip (branch scnd-upgrades-b1)
git merge-base --is-ancestor "$B1_TIP" scnd-upgrades && echo B1-ok
P2_TIP=$(git rev-parse scnd-upgrades); echo "$P2_TIP"
```

Record `B1_TIP` and `P2_TIP` in every P3 dispatch brief. Then, per task N (1…10), with the previous task already cherry-picked:

```bash
BASE=$(git -C /Users/shubhamkr/nos-scnd-upgrades rev-parse scnd-upgrades)
git -C /Users/shubhamkr/nos-scnd-upgrades worktree add --lock /Users/shubhamkr/nos-scu-2.p3.N -b scu-2.p3.N-work "$BASE"
```

**Do NOT rely on `isolation: "worktree"`** (root CLAUDE.md gotcha). Dispatch without `isolation`; the agent's first Bash command is `cd /Users/shubhamkr/nos-scu-2.p3.N && git rev-parse --abbrev-ref HEAD` (must print `scu-2.p3.N-work`), then the three guards, each alone: `git merge-base --is-ancestor "$BASE" HEAD || exit 1`, `git merge-base --is-ancestor "$B1_TIP" HEAD || exit 1`, `git merge-base --is-ancestor "$P2_TIP" HEAD || exit 1`. After the task commits, the controller cherry-picks it onto `scnd-upgrades` (`git -C /Users/shubhamkr/nos-scnd-upgrades cherry-pick <sha>`, run alone, output read), re-runs the gate on the bundle branch, and only then creates the next worktree.

**Edit helpers (every task's Step 1).** The test-file edits below are mechanical and scoped by test **name**, never by line number (Bundle 1 shifted lines and P1.1's matrix refresh records the new ones). Each task writes these four helpers to `<worktree>/.harness/scu-p3/` (gitignored scratch) and sets `H=<worktree>/.harness/scu-p3`. **Baseline (every task's Step 1, last bullet — Codex finding 1):** after the anchor checks, run the vitest-concurrency check, then that task's Step 3 test command **before editing anything** and record `N passed` per file in the changelog; every expected count in the task is then derived as *baseline − deleted tests + added tests* (each task names both), not taken from this plan's scratch numbers. Every helper exits non-zero when its anchor is missing or ambiguous, which is the re-verification: a helper failure means the base differs from this plan — locate the code by the quoted testid/text, make the smallest equivalent edit, and record the deviation in the commit body.

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

`$H/insert-after-block.py`:

```python
# SCU-2.P3 — insert a file's text right after one named `it(`/`describe(`
# block's own closing `});` — or, with --inside, just BEFORE that closing line
# (i.e. as the block's last child). Fails unless exactly one block matches.
# Usage: python3 insert-after-block.py <file> it|describe <title-substring> <textfile> [--inside]
import re, sys
path, kind, title, textfile = sys.argv[1:5]
lines = open(path).read().split("\n")
starts = [i for i, l in enumerate(lines) if re.match(rf"^\s*{kind}\(", l) and title in l]
if len(starts) != 1:
    sys.exit(f"expected exactly 1 {kind}() matching {title!r}, found {len(starts)}")
s = starts[0]
pad = lines[s][: len(lines[s]) - len(lines[s].lstrip())]
e = next(i for i in range(s + 1, len(lines)) if lines[i].startswith(pad + "});"))
at = e if "--inside" in sys.argv[5:] else e + 1
lines[at:at] = open(textfile).read().rstrip("\n").split("\n")
open(path, "w").write("\n".join(lines))
print(f"inserted after {kind}({title!r})")
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
python3 $H/scoped-replace.py $T "renders no 'Open Warehouses' title and keeps Download right-aligned" 'expect(screen.getByTestId("button-download-open-warehouses-csv").closest("div.border-b")).toHaveClass("justify-end");' 'const dl = screen.getByTestId("button-download-open-warehouses"); // SCU-2.P3: Download ▾ right-aligned via toolbar.downloadAlign
    expect(dl.closest("div.ml-auto")).not.toBeNull();
    expect(dl.parentElement!.lastElementChild).toBe(dl);'
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

Bundle 1's SCU-1.4 test is **kept** (user decision A): its `justify-end` header-row assertion is retargeted to the toolbar's right-aligned group, where Download ▾ now renders last. The B6 `enableFilters` describe (and its leading comment) is replaced in place by the filter-on-every-model describe.

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

  it("Download ▾ renders last in the toolbar, right of the filter trigger (toolbar.downloadAlign: right)", () => {
    render(<OpenWarehousesTab result={manyResult(11)} scenarioId={1} />);
    const dl = screen.getByTestId("button-download-open-warehouses");
    expect(dl.parentElement!.lastElementChild).toBe(dl);
    expect(screen.getByTestId("button-filter-menu-trigger").compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
            // SCU-2.P3 (user decision 2026-10-17) — output tables keep Download on the right (B1.4).
            downloadAlign: "right",
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
Expected (provisional): PASS — real-tree dry run: `DownloadMenu.test.tsx` 4 (new), `OpenWarehousesTab.test.tsx` 39 (baseline 34 − 4 deleted B6 tests + 3 filter tests + 6 testid-map tests; the SCU-1.4 test kept), `Workspace.Integration.test.tsx` 15 (baseline, 2 assertions changed), `Workspace.TabCoverage.test.tsx` 8 (baseline); `Workspace.test.tsx` unchanged and green (it uses the `open-warehouse-row-` prefix only).

- [ ] **Step 6: Prove the testid-map test can fail (non-vacuity)**

In `OpenWarehousesTab.tsx`, temporarily change `` row: r => `open-warehouse-row-${r.warehouseId}`, `` to `` row: r => `open-warehouse-rowX-${r.warehouseId}`, ``. Run `pnpm --filter studio exec vitest run src/__tests__/OpenWarehousesTab.test.tsx`.
Expected: FAIL — real-tree dry run: `Tests  23 failed | 16 passed (39)`, first error `Unable to find an element by: [data-testid="open-warehouse-row-ALN"]`. Revert the change, re-run, PASS. Record both results in the changelog.

- [ ] **Step 7: e2e sweep**

1. Grep every literal this task changes or adds: `grep -rn 'button-download-open-warehouses\|open-warehouses-pager\|open-warehouses-page-indicator\|button-open-warehouses-\|enableFilters' artifacts/studio/e2e/` → no hits (measured at `46d2f98`; re-run).
2. Matrix §3 "OpenWarehouses" lines — re-read each, no rewrite needed: `jade-ch9-workspace-bundle.spec.ts` (`open-warehouse-row-` prefix + "Demand Served" text), `jade-two-echelon.spec.ts` (`open-warehouse-row-` count `2`), `max-coverage.spec.ts` (`open-warehouse-row-DAL/LA/PIT` + count `3`) — row testids and counts (< 50) are unchanged.
3. Create `artifacts/studio/e2e/helpers/download.ts` — the shared e2e helper, reused by P3.2–P3.9:

```ts
// SCU-2.P3 — click one Download ▾ item and read back the file the browser
// actually saved (a real `download` event, not a spy), so a spec can assert
// the file name and row completeness.
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

export async function downloadVia(page: Page, triggerTestId: string, itemTestId: string): Promise<{ name: string; text: string }> {
  await page.getByTestId(triggerTestId).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(itemTestId).click()]);
  const path = await download.path();
  if (!path) throw new Error(`download ${download.suggestedFilename()} has no local path`);
  return { name: download.suggestedFilename(), text: await readFile(path, "utf8") };
}

/** The data lines of a one-header-line CSV (blank trailing lines ignored). */
export function csvDataLines(text: string): string[] {
  return text.split("\n").filter(line => line.trim() !== "").slice(1);
}
```

4. Add this task's assertions (run from `artifacts/studio`; `imp` adds the helper import once per spec):

```bash
imp() { grep -q 'helpers/download' "$1" || python3 $H/insert-after.py "$1" '} from "./fixtures";' 'import { csvDataLines, downloadVia } from "./helpers/download";'; }
imp e2e/max-coverage.spec.ts
python3 $H/insert-after.py e2e/max-coverage.spec.ts "expect(await page.locator('[data-testid^=\"open-warehouse-row-\"]').count()).toBe(3);" '// SCU-2.P3.1 — Download ▾ (right of the toolbar): real CSV + JSON downloads carry
// every row; openWarehouses is the unitless v1 envelope (G-4).
const owCsv = await downloadVia(page, "button-download-open-warehouses", "button-download-open-warehouses-csv");
expect(owCsv.name).toBe("openWarehouses.csv");
expect(csvDataLines(owCsv.text)).toHaveLength(3);
const owJson = JSON.parse((await downloadVia(page, "button-download-open-warehouses", "button-download-open-warehouses-json")).text);
expect(owJson.entity).toBe("openWarehouses");
expect(typeof owJson.templateVersion).toBe("number");
expect("unit" in owJson).toBe(false);
expect(owJson.rows).toHaveLength(3);'
```

5. Local run (recipe in "Global Constraints", ports 3101/5201): `E2E_BASE_URL=http://localhost:5201 pnpm exec playwright test e2e/max-coverage.spec.ts e2e/jade-two-echelon.spec.ts e2e/jade-ch9-workspace-bundle.spec.ts e2e/tab-coverage.spec.ts`. Expected: all pass (failures matched against the flake registry by name, re-run twice in isolation before calling one real).

- [ ] **Step 8: Gate**

Run each separately: the vitest-quiet check; `pnpm run typecheck`; `pnpm --filter studio typecheck:e2e`; `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test`; `pnpm --filter studio test`; `(cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`; `pnpm --filter @workspace/import-schema test`. Expected: every command exits 0.

- [ ] **Step 9: Changelog**

Append to the bottom of `docs/CHANGELOG-implementation.md`:

```markdown

### SCU-2.P3.1 — OpenWarehouses on DataTable + Download ▾

- New shared `components/data-table/DownloadMenu.tsx` (trigger `button-download-{x}`, items `-csv`/`-json`; Popover-based) + test helper `chooseDownload`. OpenWarehouses renders through `DataTable`: filter menu on **every** model above 10 rows (the JADE-only `enableFilters` opt-in is deleted, `Workspace.tsx` + `OpenWarehousesTab.tsx`), pager above 50, number columns centred, Download ▾ (right-aligned, `downloadAlign: "right"`) CSV/JSON via the server `openWarehouses` export; Bundle 1's SCU-1.4 right-aligned test kept (retargeted). New `e2e/helpers/download.ts` (real download events).
- Vitest procs before the gate: <0>. Baseline (Step 1): <N passed per file>. Deviations 1, 2, 9, 10. Non-vacuity: row-testid break → <N failed>; reverted → green.
- Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e (local, E2E_BASE_URL=http://localhost:5201): <specs + result>.
```

Replace each `<…>` with the value measured in this run, or the literal `unknown`.

- [ ] **Step 10: Commit**

```bash
git add artifacts/studio/src/components/data-table/DownloadMenu.tsx artifacts/studio/src/__tests__/DownloadMenu.test.tsx artifacts/studio/src/__tests__/helpers/downloadMenu.ts artifacts/studio/e2e/helpers/download.ts
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/data-table/DownloadMenu.tsx artifacts/studio/src/__tests__/DownloadMenu.test.tsx artifacts/studio/src/__tests__/helpers/downloadMenu.ts artifacts/studio/e2e/helpers/download.ts artifacts/studio/src/components/workspace/tabs/OpenWarehousesTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/OpenWarehousesTab.test.tsx artifacts/studio/src/__tests__/Workspace.Integration.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/e2e/max-coverage.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.1] move OpenWarehouses onto DataTable and add Download menu" -m "Deviations 1 (trigger + csv/json item testids), 2 (Download right-aligned via toolbar.downloadAlign; SCU-1.4 test kept), 9 (warehouse filter pinned text), 10 (filter on every model; enableFilters deleted). New e2e helper downloadVia." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
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
python3 $H/scoped-replace.py $T "renders no 'Customer Assignments' title and keeps Download right-aligned" 'expect(screen.getByTestId("button-download-assignments-csv").closest("div.border-b")).toHaveClass("justify-end");' 'const dl = screen.getByTestId("button-download-assignments"); // SCU-2.P3: Download ▾ right-aligned via toolbar.downloadAlign
    expect(dl.closest("div.ml-auto")).not.toBeNull();
    expect(dl.parentElement!.lastElementChild).toBe(dl);'
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
            // SCU-2.P3 (user decision 2026-10-17) — output tables keep Download on the right (B1.4).
            downloadAlign: "right",
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: the Step 3 command, then `pnpm --filter studio exec vitest run src/__tests__/Workspace.test.tsx`.
Expected (provisional): PASS — real-tree dry run `AssignmentsTab.test.tsx` 28 (baseline 23 + 5 testid-map tests), `Workspace.TabCoverage.test.tsx` 8 (baseline).

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-assignments\|assignments-pager\|assignments-page-indicator\|button-assignments-' artifacts/studio/e2e/` → no hits (re-run).
2. Matrix §3 "Assignments": `workspace-fixups-2.spec.ts` (`assignment-row-` prefix, count `> 10`, the structural `td.nth(0) .flex.flex-col` → 2 `span`s, second `font-mono`) still holds: page 1 shows 50 rows and `cell()` puts `EntityIdCell` directly in the `<td>` (P1 adapter rule, G12). `jade-two-echelon.spec.ts` hit is a comment.
3. Insert (from `artifacts/studio`):

```bash
imp() { grep -q 'helpers/download' "$1" || python3 $H/insert-after.py "$1" '} from "./fixtures";' 'import { csvDataLines, downloadVia } from "./helpers/download";'; }
imp e2e/workspace-fixups-2.spec.ts
python3 $H/insert-after.py e2e/workspace-fixups-2.spec.ts "expect(rowCount).toBeGreaterThan(10);" '// SCU-2.P3.2 — 200 customers page at 50; the shared filter (> 10 rows) narrows
// to nothing and back; Download ▾ exports all 200 rows (not the page).
expect(rowCount).toBe(50);
await expect(page.getByTestId("assignments-page-indicator")).toHaveText("Page 1 of 4");
await page.getByTestId("button-filter-menu-trigger").click();
await page.getByTestId("input-filter-flow-min").fill("999999999999");
await expect(page.getByTestId("text-filter-count")).toHaveText("0 of 200");
await expect(page.getByTestId("assignments-page-indicator")).toHaveCount(0);
await page.getByTestId("button-clear-all-filters").click();
await expect(page.getByTestId("text-filter-count")).toHaveText("200 of 200");
await page.keyboard.press("Escape");
await expect(page.getByTestId("assignments-page-indicator")).toHaveText("Page 1 of 4");
const asCsv = await downloadVia(page, "button-download-assignments", "button-download-assignments-csv");
expect(asCsv.name).toBe("assignments.csv");
expect(csvDataLines(asCsv.text)).toHaveLength(200);
const asJson = JSON.parse((await downloadVia(page, "button-download-assignments", "button-download-assignments-json")).text);
expect([asJson.entity, asJson.unit, asJson.rows.length]).toEqual(["assignments", "mi", 200]);
expect(typeof asJson.templateVersion).toBe("number");'
```

(p-median-us has 200 customers, `solvers/p-median-us/dataset/customers.json`; every customer is assigned, so 4 pages.)

4. Local run, ports 3102/5202: `E2E_BASE_URL=http://localhost:5202 pnpm exec playwright test e2e/workspace-fixups-2.spec.ts e2e/tab-coverage.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8. Expected: every command exits 0.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.2 — Customer Assignments on DataTable

- Shared `AssignmentsTab` renders through `DataTable`: filter menu above 10 rows (new on every non-JADE model; entity columns filter on "City, ST id", Distance on the display-unit value), pager above 50 (p-median-us: 200 customers → 4 pages), Distance/Flow centred, Download ▾ CSV/JSON (server `assignments`).
- Vitest procs: <0>. Baseline: <N>. Deviations 1, 2, 8, 10. Gate: studio <N passed>, api-server <N passed>, pytest <N passed>, import-schema <N passed>. e2e: <specs + result>.
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
python3 $H/scoped-replace.py $T "keeps the count/filter/Download group right-aligned" 'expect(screen.getByTestId("button-download-jadeassignments-csv").closest("div.border-b")).toHaveClass("justify-end");' 'const dl = screen.getByTestId("button-download-jadeassignments"); // SCU-2.P3: Download ▾ right-aligned via toolbar.downloadAlign
    expect(dl.closest("div.ml-auto")).not.toBeNull();
    expect(dl.parentElement!.lastElementChild).toBe(dl);'
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
            // SCU-2.P3 (user decision 2026-10-17) — output tables keep Download on the right (B1.4).
            downloadAlign: "right",
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter studio exec vitest run src/__tests__/JadeAssignmentsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): PASS — real-tree dry run `JadeAssignmentsTab.test.tsx` 33 (baseline 28 + 5). The pre-existing band tests ("rerendering with changed bands updates the filter options live", "selecting a band range then editing bands clears only the band filter…") pass unchanged: that is `filterResetKey` reproducing today's effect.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-jadeassignments\|jadeassignments-page-indicator\|button-jadeassignments-' artifacts/studio/e2e/` → no hits before this task (re-run).
2. Matrix §3 "JadeAssignments", each re-read, no rewrite: `jade-ch9-workspace-bundle.spec.ts` (`jade-assignments-tab`; first band cell "Overflow"; `thead th` == the five headers — the shell renders exactly the columns), `workspace-fixups.spec.ts` (scoped trigger inside `jade-assignments-tab` — the toolbar is inside that wrapper; band option labels by filter key `band`; the band clear on a band edit keeps the product filter — `filterResetKey`; page-1 distance cells), `workspace-fixups-2.spec.ts` (trigger, band labels, band cell texts), `jade-two-echelon.spec.ts` (`row-jadeassignment-` prefix; count "of 400").
3. Insert:

```bash
imp() { grep -q 'helpers/download' "$1" || python3 $H/insert-after.py "$1" '} from "./fixtures";' 'import { csvDataLines, downloadVia } from "./helpers/download";'; }
imp e2e/jade-two-echelon.spec.ts
python3 $H/insert-after.py e2e/jade-two-echelon.spec.ts '.toContainText("of 400", { timeout: HEADER_TIMEOUT }); // 100 customers x 4 product families' '// SCU-2.P3.3 — the shell pager keeps today'"'"'s literals (400 rows = 8 pages);
// Download ▾ exports all 400 product-level rows (JADE v3 shape, with unit).
await expect(page.getByTestId("jadeassignments-page-indicator")).toHaveText("Page 1 of 8");
await page.getByTestId("button-jadeassignments-next").click();
await expect(page.getByTestId("jadeassignments-page-indicator")).toHaveText("Page 2 of 8");
const jaCsv = await downloadVia(page, "button-download-jadeassignments", "button-download-jadeassignments-csv");
expect(jaCsv.name).toBe("assignments.csv");
expect(csvDataLines(jaCsv.text)).toHaveLength(400);
const jaJson = JSON.parse((await downloadVia(page, "button-download-jadeassignments", "button-download-jadeassignments-json")).text);
expect([jaJson.entity, jaJson.unit, jaJson.rows.length]).toEqual(["assignments", "mi", 400]);'
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

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (server `flows`), B2.10. **Matrix:** §2a "Flows", §3 "Flows". **Deviations:** 1, 2, 8, 10; G-3 fixed here (user decision D). **Depends on:** P3.1.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx`, `artifacts/studio/src/pages/Workspace.tsx` (the `FlowsTab` mount: `distanceUnit`)
- Test: `artifacts/studio/src/__tests__/FlowsTab.test.tsx`, `Workspace.TabCoverage.test.tsx`
- e2e: `artifacts/studio/e2e/two-echelon.spec.ts`
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
- `grep -cF 'return <FlowsTab result={result} scenarioId={currentScenario!.id} locationById={jadeOutputLocationById} identityById={outputIdentityById} />;' artifacts/studio/src/pages/Workspace.tsx` → `1` (no `distanceUnit` — G-3, fixed in Step 4) and `grep -c 'distanceUnit={canonicalUnit}' artifacts/studio/src/pages/Workspace.tsx` → `3` (the sibling output mounts)

- [ ] **Step 2: Write the failing tests**

```bash
T=src/__tests__/FlowsTab.test.tsx
perl -0pi -e 's|(import \{ makeExportProviderValue \} from "\@/__tests__/helpers/renderWithExportProvider";\n)|$1import { chooseDownload } from "\@/__tests__/helpers/downloadMenu";\n|' $T
perl -pi -e 's/fireEvent\.click\(screen\.getByTestId\("button-download-flows-csv"\)\);/chooseDownload("button-download-flows", "button-download-flows-csv");/g; s/const button = screen\.getByTestId\("button-download-flows-csv"\);/const button = screen.getByTestId("button-download-flows");/g' $T
grep -c 'chooseDownload' $T          # → 3
python3 $H/scoped-replace.py $T "renders no 'Flows' title and keeps Download right-aligned" 'expect(screen.getByTestId("button-download-flows-csv").closest("div.border-b")).toHaveClass("justify-end");' 'const dl = screen.getByTestId("button-download-flows"); // SCU-2.P3: Download ▾ right-aligned via toolbar.downloadAlign
    expect(dl.closest("div.ml-auto")).not.toBeNull();
    expect(dl.parentElement!.lastElementChild).toBe(dl);'
perl -pi -e 's/tabTestId: "button-download-flows-csv"/tabTestId: "button-download-flows"/' src/__tests__/Workspace.TabCoverage.test.tsx
# G-3: Workspace must hand FlowsTab the canonical unit (transport-coal fixture: KY→CHI, 300 mi)
cat > $H/p34-tabcov.tsx <<'BLOCK'
  // SCU-2.P3.4 (G-3) — Workspace now passes the canonical unit to FlowsTab, so
  // transport-coal's Flows distances render under a unit header.
  it("Flows receives the canonical distance unit: the header names it and the distance renders (SCU-2.P3.4)", () => {
    render(<Workspace modelId="transport-coal" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-output-flows"));
    expect(screen.getByRole("columnheader", { name: "Distance (mi)" })).toBeInTheDocument();
    expect(screen.getByTestId("flow-row-KY-CHI")).toHaveTextContent("300.0");
  });
BLOCK
python3 $H/insert-after-block.py src/__tests__/Workspace.TabCoverage.test.tsx describe 'Workspace tab coverage — transport-coal' $H/p34-tabcov.tsx --inside
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

  it("follows the display-unit toggle: header and values convert to the display unit", () => {
    window.localStorage.setItem("nos:display-unit-pref", "km");
    try {
      render(<FlowsTab result={transportResult} scenarioId={1} distanceUnit="mi" />);
      expect(screen.getByRole("columnheader", { name: "Distance (km)" })).toBeInTheDocument();
      expect(screen.getByTestId("flow-row-KY-CHI")).toHaveTextContent("482.8");
    } finally {
      window.localStorage.removeItem("nos:display-unit-pref");
    }
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/FlowsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx`
Expected (provisional): FAIL — `Unable to find an element by: [data-testid="button-download-flows"]`; TabCoverage fails at `flows` for transport-coal and two-echelon-gold-au, and the new G-3 test finds no `Distance (mi)` header (today it reads "Distance" / "—").

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
            // SCU-2.P3 (user decision 2026-10-17) — output tables keep Download on the right (B1.4).
            downloadAlign: "right",
          }}
        />
      </div>
    </div>
  );
}
```

In `artifacts/studio/src/pages/Workspace.tsx` (G-3, user decision D), replace

```tsx
        return <FlowsTab result={result} scenarioId={currentScenario!.id} locationById={jadeOutputLocationById} identityById={outputIdentityById} />;
```

with (the same `canonicalUnit` the Assignments/JADE mounts pass)

```tsx
        return <FlowsTab result={result} scenarioId={currentScenario!.id} locationById={jadeOutputLocationById} identityById={outputIdentityById} distanceUnit={canonicalUnit} />;
```

- [ ] **Step 5: Run them to verify they pass**

Run: the Step 3 command. Expected (provisional): PASS — real-tree dry run `FlowsTab.test.tsx` 27 (baseline 21 + 6), `Workspace.TabCoverage.test.tsx` 9 (baseline + 1, the G-3 test).

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-flows\|flows-pager\|flows-page-indicator\|button-flows-' artifacts/studio/e2e/` → no hits.
2. Matrix §3 "Flows": the only hit (`jade-two-echelon.spec.ts`) is a comment. No spec opened the non-JADE Flows tab (grep `sidebar-output-flows`: only JADE specs), so this task adds one to `two-echelon.spec.ts` (gold-au, right after its first solve): distances render under `Distance (mi)` (G-3), follow the km↔mi toggle (`unit-toggle-km` / `unit-toggle-mi`, `components/UnitToggle.tsx:27`), and both downloads carry every on-screen row:

```bash
imp() { grep -q 'helpers/download' "$1" || python3 $H/insert-after.py "$1" '} from "./fixtures";' 'import { csvDataLines, downloadVia } from "./helpers/download";'; }
imp e2e/two-echelon.spec.ts
python3 $H/insert-after.py e2e/two-echelon.spec.ts "await expect(page.getByText(/cunnamulla/i).first()).toBeVisible({ timeout: HEADER_TIMEOUT });" '// SCU-2.P3.4 — gold-au Flows: distances render under the canonical unit (G-3
// fixed), follow the display-unit toggle, and Download ▾ exports every row.
await page.getByTestId("sidebar-output-flows").click();
const flowRows = page.locator('"'"'[data-testid^="flow-row-"]'"'"');
await expect(flowRows.first()).toBeVisible({ timeout: HEADER_TIMEOUT });
await expect(page.getByRole("columnheader", { name: "Distance (mi)" })).toBeVisible();
await expect(flowRows.first().locator("td").nth(2)).toHaveText(/^\d+\.\d$/);
await page.getByTestId("unit-toggle-km").click();
await expect(page.getByRole("columnheader", { name: "Distance (km)" })).toBeVisible();
await page.getByTestId("unit-toggle-mi").click();
await expect(page.getByRole("columnheader", { name: "Distance (mi)" })).toBeVisible();
const flowCount = await flowRows.count();
const flCsv = await downloadVia(page, "button-download-flows", "button-download-flows-csv");
expect(flCsv.name).toBe("flows.csv");
expect(csvDataLines(flCsv.text)).toHaveLength(flowCount);
const flJson = JSON.parse((await downloadVia(page, "button-download-flows", "button-download-flows-json")).text);
expect([flJson.entity, flJson.unit, flJson.rows.length]).toEqual(["flows", "mi", flowCount]);'
```

3. Local run, ports 3104/5204: `E2E_BASE_URL=http://localhost:5204 pnpm exec playwright test e2e/tab-coverage.spec.ts e2e/two-echelon.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.4 — Flows on DataTable

- Shared `FlowsTab` (transport-coal, two-echelon-gold-au) renders through `DataTable`: filter above 10 rows (new), pager above 50, Distance/Flow centred, Download ▾ CSV/JSON (server `flows`); `flow-row-{from}-{to}[-{product}]` kept.
- G-3 fixed (user decision D): `Workspace.tsx` now passes `distanceUnit={canonicalUnit}` to `FlowsTab`, so transport-coal/gold-au distances render under `Distance (mi)` and follow the unit toggle (RTL: TabCoverage + FlowsTab; e2e: `two-echelon.spec.ts`). Download ▾ right-aligned. Deviations 1, 2, 8, 10. Baseline: <N>. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/FlowsTab.tsx artifacts/studio/src/pages/Workspace.tsx artifacts/studio/src/__tests__/FlowsTab.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/e2e/two-echelon.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.4] move Flows onto DataTable and pass it the canonical distance unit" -m "Deviations 1, 2, 8, 10. G-3 fixed: Workspace passes distanceUnit={canonicalUnit} to FlowsTab (user decision D)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.5: JADE Flows Plant → Warehouse on DataTable + on-screen client export (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (client-built, exactly the on-screen table, `jade-flows-plant-warehouse.{csv,json}`), B2.10. **Matrix:** §2a "JadeFlows P→W", §3, G3 (root testid contains toolbar + `thead`), G14 (two menus on one tab), G18. **Deviations:** 1, 2, 3, 6, 10, 12. **Depends on:** P3.1.

**Files:**
- Create: `artifacts/studio/src/lib/jadeFlowsExport.ts`, `artifacts/studio/src/__tests__/jadeFlowsExport.test.ts`
- Modify: `artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx`
- Test: `artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx`
- e2e: `artifacts/studio/e2e/jade-two-echelon.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: P1 `DataTable`, `ColumnDef`, `DataTableToolbar.downloadAlign`; `DownloadMenu` (P3.1); Bundle 1 `csvCell`, `downloadTextFile` (`lib/clientCsv.ts`); `useExport().disabledReasonFor` (Deviation 12).
- Produces: `JadeFlowScreenRow`, `JadeFlowLeg`, `PLANT_WAREHOUSE_LEG`, `WAREHOUSE_CUSTOMER_LEG`, `JadeFlowsJson`, `jadeFlowsCsv`, `jadeFlowsJson`, `downloadJadeFlows` (`lib/jadeFlowsExport.ts`; the W→C leg is consumed by P3.6). The testid map row "JadeFlows P→W" above.

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
// SCU-2.P3.5 (spec B2.4, user decision 2026-10-17) — JADE Flows downloads are
// exactly the on-screen table: same headers, same rows, typed values.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadJadeFlows,
  jadeFlowsCsv,
  jadeFlowsJson,
  PLANT_WAREHOUSE_LEG,
  WAREHOUSE_CUSTOMER_LEG,
} from "@/lib/jadeFlowsExport";

const rows = [
  { fromLabel: "plant-1 — Bethlehem, PA", toLabel: "Chicago, IL", distance: 293.66, flow: 1400, band: "Band 2" },
  { fromLabel: "plant-2 — Houston, TX", toLabel: "Dallas, TX", distance: 1200, flow: 300, band: "Overflow" },
];
const toKm = (mi: number) => mi * 1.609344;

afterEach(() => vi.restoreAllMocks());

describe("jadeFlowsCsv", () => {
  it("P→W: on-screen headers (unit in the Distance header), one line per on-screen row, 1-dp display-unit distance", () => {
    expect(jadeFlowsCsv(PLANT_WAREHOUSE_LEG, rows, d => d, "mi").split("\n")).toEqual([
      "Plant,Warehouse,Distance (mi),Flow,Distance Band",
      '"plant-1 — Bethlehem, PA","Chicago, IL",293.7,1400,Band 2',
      '"plant-2 — Houston, TX","Dallas, TX",1200,300,Overflow',
    ]);
  });

  it("W→C keeps its on-screen 'Flows' header and converts distance to the display unit", () => {
    const csv = jadeFlowsCsv(WAREHOUSE_CUSTOMER_LEG, rows.slice(0, 1), toKm, "km");
    expect(csv.split("\n")).toEqual(["Warehouse,Customer,Distance (km),Flows,Distance Band", '"plant-1 — Bethlehem, PA","Chicago, IL",472.6,1400,Band 2']);
  });
});

describe("jadeFlowsJson", () => {
  it("{ entity, unit, rows } with one typed object per on-screen row", () => {
    expect(jadeFlowsJson(PLANT_WAREHOUSE_LEG, rows, d => d, "mi")).toEqual({
      entity: "jadeFlowsPlantWarehouse",
      unit: "mi",
      rows: [
        { plant: "plant-1 — Bethlehem, PA", warehouse: "Chicago, IL", distance: 293.7, flow: 1400, distanceBand: "Band 2" },
        { plant: "plant-2 — Houston, TX", warehouse: "Dallas, TX", distance: 1200, flow: 300, distanceBand: "Overflow" },
      ],
    });
    expect(Object.keys(jadeFlowsJson(WAREHOUSE_CUSTOMER_LEG, rows, d => d, "mi").rows[0])).toEqual(["warehouse", "customer", "distance", "flows", "distanceBand"]);
  });
});

describe("downloadJadeFlows", () => {
  it("writes {fileBase}.csv as text/csv and {fileBase}.json as application/json", () => {
    // downloadTextFile is called inside clientCsv's module boundary from here, so
    // spy at the DOM boundary: the Blob parts + the anchor's download name.
    const RealBlob = globalThis.Blob;
    const blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation((parts, opts) => new RealBlob(parts, opts));
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    downloadJadeFlows(PLANT_WAREHOUSE_LEG, "csv", rows, d => d, "mi");
    downloadJadeFlows(PLANT_WAREHOUSE_LEG, "json", rows, d => d, "mi");
    expect(names).toEqual(["jade-flows-plant-warehouse.csv", "jade-flows-plant-warehouse.json"]);
    expect(blobSpy.mock.calls[0][0]?.[0]).toBe(jadeFlowsCsv(PLANT_WAREHOUSE_LEG, rows, d => d, "mi"));
    expect(blobSpy.mock.calls[0][1]).toEqual({ type: "text/csv" });
    expect(JSON.parse(blobSpy.mock.calls[1][0]?.[0] as string)).toEqual(jadeFlowsJson(PLANT_WAREHOUSE_LEG, rows, d => d, "mi"));
    expect(blobSpy.mock.calls[1][1]).toEqual({ type: "application/json" });
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
# JadeFlowsTab now reads useExport() (Codex finding 2): render through AllProviders (Unit + Export)
perl -0pi -e 's|function render\(ui: ReactElement\) \{\n  return rtlRender\(<UnitProvider>\{ui\}</UnitProvider>\);\n\}|function render(ui: ReactElement) {\n  // SCU-2.P3.5 — JadeFlowsTab reads useExport() for its download guard.\n  return rtlRender(ui, { wrapper: AllProviders });\n}|' $T
perl -0pi -e 's|(import \{ UnitProvider \} from "\@/contexts/UnitContext";\n)|$1import { ExportProvider } from "\@/contexts/ExportContext";\nimport { AllProviders, makeExportProviderValue } from "\@/__tests__/helpers/renderWithExportProvider";\n|' $T
grep -c 'wrapper: AllProviders' $T
# the wrapper already supplies UnitProvider: rerender the bare element (same tree shape, so state survives)
perl -pi -e 's|rerender\(<UnitProvider>(<JadeFlowsTab .*?/>)</UnitProvider>\);|rerender($1);|g' $T
grep -c 'rerender(<JadeFlowsTab ' $T          # → 3
```

The deleted test asserted the old file (`plant-to-warehouse-flows.csv`, formatted `"293.7 mi"` distance cells); the replacement tests below pin the spec's file name, the unit-bearing Distance header and typed values while keeping exactly the on-screen columns and rows (Deviation 6). Because `JadeFlowsTab` now reads `useExport()` (Deviation 12), the edit block above switches the file's `render` to `AllProviders`. Append at EOF:

```tsx

// SCU-2.P3.5 (spec B2.1/B2.2/B2.4, matrix §2a "JadeFlows P→W") — Plant ->
// Warehouse on DataTable: every testid in the instance map; Download ▾ is
// client-built and is EXACTLY the on-screen table (user decision 2026-10-17).
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

  it("emits the root, count, row and five cell testids; Download ▾ is last in the toolbar", () => {
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    const root = screen.getByTestId("jade-flows-pw-table");
    const key = "plant-1|wh-11";
    expect(within(root).getByTestId("jade-flow-pw-row-plant-1-wh-11").tagName).toBe("TR");
    for (const col of ["plant", "warehouse", "distance", "flow", "band"]) {
      expect(within(root).getByTestId(`cell-jade-flow-pw-${col}-${key}`).tagName).toBe("TD");
    }
    expect(within(root).getByTestId("text-jadeflows-pw-count")).toHaveTextContent("2 of 2");
    const dl = within(root).getByTestId("button-download-jade-flows-pw");
    expect(dl.parentElement!.lastElementChild).toBe(dl);
    // thead th texts are the e2e contract (jade-ch9-workspace-bundle.spec.ts:407-408)
    expect([...root.querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Plant", "Warehouse", "Distance", "Flow", "Distance Band"]);
    expect([...root.querySelectorAll("thead th")].map(th => th.classList.contains("text-center"))).toEqual([false, false, true, true, false]);
  });

  it("CSV = the on-screen table: same headers (unit in Distance), same aggregated rows, as jade-flows-plant-warehouse.csv", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-csv"));
    expect(dl.names).toEqual(["jade-flows-plant-warehouse.csv"]);
    expect(dl.text(0).split("\n")).toEqual([
      "Plant,Warehouse,Distance (mi),Flow,Distance Band",
      '"plant-1 — Bethlehem, PA","Chicago, IL",293.7,1400,Band 2',
      '"plant-2 — Houston, TX","Dallas, TX",1200,300,Overflow',
    ]);
  });

  it("JSON = { entity, unit, rows } with one typed object per on-screen row", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-json"));
    expect(dl.names).toEqual(["jade-flows-plant-warehouse.json"]);
    expect(JSON.parse(dl.text(0))).toEqual({
      entity: "jadeFlowsPlantWarehouse",
      unit: "mi",
      rows: [
        { plant: "plant-1 — Bethlehem, PA", warehouse: "Chicago, IL", distance: 293.7, flow: 1400, distanceBand: "Band 2" },
        { plant: "plant-2 — Houston, TX", warehouse: "Dallas, TX", distance: 1200, flow: 300, distanceBand: "Overflow" },
      ],
    });
  });

  it("> 50 rows: pager with jade-flows-pw literals, and the download still carries ALL rows", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    const edges = Array.from({ length: 51 }, (_, i) => ({
      fromId: `plant-${i + 1}`, toId: "wh-11", flow: 1, distance: 10, leg: "plant_to_warehouse" as const, productId: "product-1",
    }));
    render(<JadeFlowsTab result={makeResult(edges)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    expect(screen.getByTestId("jade-flows-pw-page-indicator")).toHaveTextContent("Page 1 of 2");
    expect(screen.getAllByTestId(/^jade-flow-pw-row-/)).toHaveLength(50);
    await user.click(screen.getByTestId("button-jade-flows-pw-next"));
    expect(screen.getByTestId("jade-flow-pw-row-plant-51-wh-11")).toBeInTheDocument();
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-csv"));
    expect(dl.text(0).split("\n")).toHaveLength(1 + 51);
  });

  it("Download ▾ is disabled with the export reason while browsing an unaddressable history entry, and while the unit loads", () => {
    const { unmount } = rtlRender(
      <UnitProvider>
        <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "This result predates run history." })}>
          <JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />
        </ExportProvider>
      </UnitProvider>,
    );
    const dl = screen.getByTestId("button-download-jade-flows-pw");
    expect(dl).toBeDisabled();
    expect(dl).toHaveAttribute("title", "This result predates run history.");
    unmount();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
    expect(screen.getByTestId("button-download-jade-flows-pw")).toBeDisabled();
  });

  it("switching legs closes an open Download ▾ (no portaled menu left) and focus is on the leg control", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    expect(screen.getByTestId("button-download-jade-flows-pw-csv")).toBeInTheDocument();
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.queryByTestId("button-download-jade-flows-pw-csv")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/jadeFlowsExport.test.ts src/__tests__/JadeFlowsTab.test.tsx`
Expected (provisional): FAIL — `jadeFlowsExport.test.ts`: `Failed to resolve import "@/lib/jadeFlowsExport"`; `JadeFlowsTab.test.tsx`: `Unable to find an element by: [data-testid="button-filter-jade-flows-pw"]`, `…[data-testid="button-download-jade-flows-pw"]`, the history-disabled and leg-switch tests, and "switches to the Warehouse -> Customer inner tab" (`jade-flows-pw-table` is not in the document yet).

- [ ] **Step 4: Implement**

Create `artifacts/studio/src/lib/jadeFlowsExport.ts`:

```ts
// SCU-2.P3.5/P3.6 (spec B2.4, user decision 2026-10-17) — JADE Flows'
// client-built downloads are EXACTLY the on-screen table: the same columns
// (header text verbatim; the unit goes into the Distance header) and the same
// rows (one per plant→warehouse pair / per customer, flow summed over
// products), ALL rows — never just the filtered or paged ones. Values are
// typed, not rendered text: the single-line entity label the cell falls back
// to, distance in the active display unit at the on-screen 1-dp precision,
// flow as a plain number, the band label the cell shows.
import { csvCell, downloadTextFile } from "@/lib/clientCsv";

/** One on-screen JADE Flows row, as the tab's own row model holds it. */
export interface JadeFlowScreenRow {
  fromLabel: string;
  toLabel: string;
  /** Canonical distance (the result's unit). */
  distance: number;
  flow: number;
  band: string;
}

export interface JadeFlowLeg {
  entity: "jadeFlowsPlantWarehouse" | "jadeFlowsWarehouseCustomer";
  fileBase: string;
  /** On-screen header text, in column order. */
  headers: readonly [string, string, string, string, string];
  /** JSON keys, in the same order. */
  keys: readonly [string, string, string, string, string];
}

export const PLANT_WAREHOUSE_LEG: JadeFlowLeg = {
  entity: "jadeFlowsPlantWarehouse",
  fileBase: "jade-flows-plant-warehouse",
  headers: ["Plant", "Warehouse", "Distance", "Flow", "Distance Band"],
  keys: ["plant", "warehouse", "distance", "flow", "distanceBand"],
};

export const WAREHOUSE_CUSTOMER_LEG: JadeFlowLeg = {
  entity: "jadeFlowsWarehouseCustomer",
  fileBase: "jade-flows-warehouse-customer",
  headers: ["Warehouse", "Customer", "Distance", "Flows", "Distance Band"],
  keys: ["warehouse", "customer", "distance", "flows", "distanceBand"],
};

type Cells = [string, string, number, number, string];

function cells(row: JadeFlowScreenRow, toDisplay: (canonical: number) => number): Cells {
  return [row.fromLabel, row.toLabel, Number(toDisplay(row.distance).toFixed(1)), row.flow, row.band];
}

export function jadeFlowsCsv(leg: JadeFlowLeg, rows: JadeFlowScreenRow[], toDisplay: (canonical: number) => number, unit: string): string {
  const header = leg.headers.map(h => (h === "Distance" ? `Distance (${unit})` : h));
  return [header, ...rows.map(r => cells(r, toDisplay))].map(line => line.map(csvCell).join(",")).join("\n");
}

export interface JadeFlowsJson {
  entity: JadeFlowLeg["entity"];
  unit: string;
  rows: Array<Record<string, string | number>>;
}

export function jadeFlowsJson(leg: JadeFlowLeg, rows: JadeFlowScreenRow[], toDisplay: (canonical: number) => number, unit: string): JadeFlowsJson {
  return {
    entity: leg.entity,
    unit,
    rows: rows.map(r => Object.fromEntries(cells(r, toDisplay).map((v, i) => [leg.keys[i], v]))),
  };
}

export function downloadJadeFlows(
  leg: JadeFlowLeg,
  format: "csv" | "json",
  rows: JadeFlowScreenRow[],
  toDisplay: (canonical: number) => number,
  unit: string,
): void {
  if (format === "csv") downloadTextFile(`${leg.fileBase}.csv`, jadeFlowsCsv(leg, rows, toDisplay, unit), "text/csv");
  else downloadTextFile(`${leg.fileBase}.json`, JSON.stringify(jadeFlowsJson(leg, rows, toDisplay, unit), null, 2), "application/json");
}
```

In `JadeFlowsTab.tsx`:

(a) Replace `import { downloadClientCsv } from "@/lib/clientCsv";` with:

```tsx
import { downloadClientCsv } from "@/lib/clientCsv";
import { useExport } from "@/contexts/ExportContext";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import { downloadJadeFlows, PLANT_WAREHOUSE_LEG, type JadeFlowLeg, type JadeFlowScreenRow } from "@/lib/jadeFlowsExport";
```

(a2) Directly after the line `  const resolvedUnitLabel = canonicalResolved ? unit.effectiveUnit(distanceUnit) : null;`, insert the download guard (Deviation 12) and the shared leg downloader:

```tsx
  // SCU-2.P3.5 — client-built downloads use the SAME guard as every server
  // export (history entry without a run, unit loading), plus this table's own
  // canonical-unit resolution.
  const { disabledReasonFor } = useExport();
  const downloadDisabledReason = disabledReasonFor("flows") ?? (canonicalResolved ? undefined : "Loading…");
  const downloadLeg = (leg: JadeFlowLeg, format: "csv" | "json", screenRows: JadeFlowScreenRow[]) =>
    downloadJadeFlows(leg, format, screenRows, d => unit.toDisplay(d, distanceUnit!), resolvedUnitLabel!);
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

(f) Replace the JSX from the line `    <div className="flex flex-col h-full overflow-hidden" data-testid="jade-flows-tab">` to the end of the file with:

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
                  disabledReason={downloadDisabledReason}
                  onDownload={format =>
                    downloadLeg(
                      PLANT_WAREHOUSE_LEG,
                      format,
                      pwRows.map(r => ({ fromLabel: r.plantLabel, toLabel: r.warehouseLabel, distance: r.distance, flow: r.flow, band: r.band })),
                    )
                  }
                />
              ),
              downloadAlign: "right",
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
Expected (provisional): PASS — real-tree dry run `jadeFlowsExport.test.ts` 4, `JadeFlowsTab.test.tsx` 43 (baseline 38 − 1 deleted + 6 added).

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'plant-to-warehouse-flows\|button-download-jade-flows-pw\|button-filter-jade-flows\|jade-flows-pw-page-indicator\|button-jade-flows-pw-' artifacts/studio/e2e/` → no hits.
2. Matrix §3 "JadeFlows P→W": `jade-ch9-workspace-bundle.spec.ts` (`jade-flows-tab`; P→W `aria-pressed="true"`; `[data-testid="jade-flows-pw-table"] thead th` == `["Plant","Warehouse","Distance","Flow","Distance Band"]` — the root now also holds the toolbar, which has no `th`; W→C click + `jade-flows-wc-table` visible, unchanged this task); `jade-two-echelon.spec.ts` (`jade-flow-pw-row-` prefix; `jade-flow-pw-row-plant-4-wh-11` visible — ≤ 8 aggregated P→W rows, page 1). No rewrite.
3. Insert (real downloads = on-screen rows; the leg switch closes an open Download ▾ and leaves focus on the leg control — Codex finding 3, browser half):

```bash
imp() { grep -q 'helpers/download' "$1" || python3 $H/insert-after.py "$1" '} from "./fixtures";' 'import { csvDataLines, downloadVia } from "./helpers/download";'; }
imp e2e/jade-two-echelon.spec.ts
python3 $H/insert-after.py e2e/jade-two-echelon.spec.ts "await expect(page.locator('[data-testid^=\"jade-flow-pw-row-\"]').first()).toBeVisible({ timeout: HEADER_TIMEOUT });" '// SCU-2.P3.5 — the client-built download IS the on-screen table (all rows);
// an open menu does not survive a leg switch and focus stays on the leg control.
const pwCount = await page.locator('"'"'[data-testid^="jade-flow-pw-row-"]'"'"').count();
const pwCsv = await downloadVia(page, "button-download-jade-flows-pw", "button-download-jade-flows-pw-csv");
expect(pwCsv.name).toBe("jade-flows-plant-warehouse.csv");
expect(pwCsv.text.split("\n")[0]).toBe("Plant,Warehouse,Distance (mi),Flow,Distance Band");
expect(csvDataLines(pwCsv.text)).toHaveLength(pwCount);
const pwJson = JSON.parse((await downloadVia(page, "button-download-jade-flows-pw", "button-download-jade-flows-pw-json")).text);
expect([pwJson.entity, pwJson.unit, pwJson.rows.length]).toEqual(["jadeFlowsPlantWarehouse", "mi", pwCount]);
await page.getByTestId("button-download-jade-flows-pw").click();
await expect(page.getByTestId("button-download-jade-flows-pw-csv")).toBeVisible();
await page.getByTestId("button-jade-flows-inner-warehouse-customer").click();
await expect(page.getByTestId("button-download-jade-flows-pw-csv")).toHaveCount(0);
await expect(page.getByTestId("button-jade-flows-inner-warehouse-customer")).toBeFocused();
await page.getByTestId("button-jade-flows-inner-plant-warehouse").click();'
```

4. Local run, ports 3105/5205: `E2E_BASE_URL=http://localhost:5205 pnpm exec playwright test e2e/jade-two-echelon.spec.ts e2e/jade-ch9-workspace-bundle.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.5 — JADE Flows Plant → Warehouse on DataTable + on-screen export

- P→W renders through `DataTable` (root `jade-flows-pw-table`, count, cell testids, band range filter + bands/unit reset kept); it stays mounted while W→C is shown (`hidden`), so its filters survive a leg switch, with its own trigger `button-filter-jade-flows-pw`. Download ▾ (right-aligned) CSV/JSON is client-built and is exactly the on-screen table (`lib/jadeFlowsExport.ts`: same headers, unit in the Distance header, same aggregated rows, all of them) as `jade-flows-plant-warehouse.{csv,json}` (was `plant-to-warehouse-flows.csv`); it is disabled by the same export guard as server downloads (`disabledReasonFor("flows")`). Leg switch closes open menus (Radix outside-dismiss) — RTL + e2e.
- Vitest procs: <0>. Baseline: <N>. Deviations 1, 2, 3, 6, 10, 12. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
git add artifacts/studio/src/lib/jadeFlowsExport.ts artifacts/studio/src/__tests__/jadeFlowsExport.test.ts
```

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/lib/jadeFlowsExport.ts artifacts/studio/src/__tests__/jadeFlowsExport.test.ts artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx artifacts/studio/e2e/jade-two-echelon.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.5] move JADE Flows plant-to-warehouse onto DataTable with on-screen export" -m "Deviations 1, 2, 3 (leg stays mounted; own trigger testid; menus dismiss on leg switch), 6 (download = on-screen table), 10, 12 (export guard)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.6: JADE Flows Warehouse → Customer on DataTable + on-screen client export (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (`jade-flows-warehouse-customer.{csv,json}`), B2.10. **Matrix:** §2a "JadeFlows W→C", §3, G14. **Deviations:** 1, 2, 3, 6, 9 (`customer` text), 10, 11, 12. **Depends on:** P3.5.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx`, `artifacts/studio/src/lib/clientCsv.ts` (delete `downloadClientCsv`)
- Test: `artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx`
- e2e: `artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts`
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: P3.5's `WAREHOUSE_CUSTOMER_LEG`, `downloadLeg` (the in-component guard + downloader), `downloadDisabledReason`; P1 `DataTable`; `DownloadMenu`.
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
// Download ▾ = exactly the on-screen table (user decision 2026-10-17).
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
  const manyWc = (n: number) =>
    makeResult(Array.from({ length: n }, (_, i) => ({ fromId: "wh-11", toId: `customer-${i + 1}`, flow: i + 1, distance: 10, leg: "warehouse_to_customer" as const })));

  it("emits the root, count, row and five cell testids once the leg is shown; Download ▾ last", async () => {
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
    const dl = within(root).getByTestId("button-download-jade-flows-wc");
    expect(dl.parentElement!.lastElementChild).toBe(dl);
    expect([...root.querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Warehouse", "Customer", "Distance", "Flows", "Distance Band"]);
    expect([...root.querySelectorAll("thead th")].map(th => th.classList.contains("text-center"))).toEqual([false, false, true, true, false]);
  });

  it("CSV and JSON = the on-screen table (same headers incl. 'Flows', same per-customer rows)", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc-csv"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc-json"));
    expect(dl.names).toEqual(["jade-flows-warehouse-customer.csv", "jade-flows-warehouse-customer.json"]);
    expect(dl.text(0).split("\n")).toEqual([
      "Warehouse,Customer,Distance (mi),Flows,Distance Band",
      '"Chicago, IL","Los Angeles, CA",42.1,500,Band 1',
      '"Dallas, TX","New York City, NY",1200,300,Overflow',
    ]);
    const doc = JSON.parse(dl.text(1));
    expect([doc.entity, doc.unit, doc.rows.length]).toEqual(["jadeFlowsWarehouseCustomer", "mi", 2]);
    expect(doc.rows[0]).toEqual({ warehouse: "Chicago, IL", customer: "Los Angeles, CA", distance: 42.1, flows: 500, distanceBand: "Band 1" });
  });

  it("> 50 rows: pager with jade-flows-wc literals; the download carries ALL rows", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={manyWc(51)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("jade-flows-wc-page-indicator")).toHaveTextContent("Page 1 of 2");
    await user.click(screen.getByTestId("button-jade-flows-wc-next"));
    expect(screen.getByTestId("jade-flow-wc-row-wh-11-customer-51")).toBeInTheDocument();
    expect(screen.getByTestId("button-jade-flows-wc-prev")).not.toBeDisabled();
    await user.click(screen.getByTestId("button-download-jade-flows-wc"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc-csv"));
    expect(dl.text(0).split("\n")).toHaveLength(1 + 51);
  });

  it("Download ▾ is disabled with the export reason while browsing an unaddressable history entry", async () => {
    const user = userEvent.setup();
    rtlRender(
      <UnitProvider>
        <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "This result predates run history." })}>
          <JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />
        </ExportProvider>
      </UnitProvider>,
    );
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("button-download-jade-flows-wc")).toBeDisabled();
    expect(screen.getByTestId("button-download-jade-flows-wc")).toHaveAttribute("title", "This result predates run history.");
  });

  it("a filter on one leg survives switching to the other leg and back", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={manyWc(12)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    await user.click(screen.getByTestId("button-filter-jade-flows-wc"));
    await user.type(screen.getByTestId("input-filter-flow-min"), "11");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("text-jadeflows-wc-count")).toHaveTextContent("2 of 12");
    await user.click(screen.getByTestId("button-jade-flows-inner-plant-warehouse"));
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("text-jadeflows-wc-count")).toHaveTextContent("2 of 12");
  });

  it("switching legs closes an open filter menu (no portaled popover left) and focus is on the leg control", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={manyWc(12)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    await user.click(screen.getByTestId("button-filter-jade-flows-wc"));
    expect(screen.getByTestId("filter-menu-popover")).toBeInTheDocument();
    await user.click(screen.getByTestId("button-jade-flows-inner-plant-warehouse"));
    expect(screen.queryByTestId("filter-menu-popover")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("button-jade-flows-inner-plant-warehouse"));
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter studio exec vitest run src/__tests__/JadeFlowsTab.test.tsx`
Expected (provisional): FAIL — "defaults to the Plant -> Warehouse inner tab" (`jade-flows-wc-table` not in the document yet), `Unable to find an element by: [data-testid="button-filter-jade-flows-wc"]`, `…[data-testid="button-download-jade-flows-wc"]`.

- [ ] **Step 4: Implement**

In `JadeFlowsTab.tsx`:

(a) Replace the import block from `import { useEffect, useMemo, useState } from "react";` through `import { downloadJadeFlows, PLANT_WAREHOUSE_LEG, type JadeFlowLeg, type JadeFlowScreenRow } from "@/lib/jadeFlowsExport";` with:

```tsx
import { useMemo, useState } from "react";
import type { Dataset, Edge, Plant, SolveResult } from "@workspace/api-client-react";
import { bandLabel, bandRangeLabel, DEFAULT_DISTANCE_BANDS } from "@/lib/bands";
import { formatCityState, plantIdCityState } from "@/lib/formatLocation";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { useDisplayUnit } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";
import { useExport } from "@/contexts/ExportContext";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import {
  downloadJadeFlows,
  PLANT_WAREHOUSE_LEG,
  WAREHOUSE_CUSTOMER_LEG,
  type JadeFlowLeg,
  type JadeFlowScreenRow,
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
                  disabledReason={downloadDisabledReason}
                  onDownload={format =>
                    downloadLeg(
                      PLANT_WAREHOUSE_LEG,
                      format,
                      pwRows.map(r => ({ fromLabel: r.plantLabel, toLabel: r.warehouseLabel, distance: r.distance, flow: r.flow, band: r.band })),
                    )
                  }
                />
              ),
              downloadAlign: "right",
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
                disabledReason={downloadDisabledReason}
                onDownload={format =>
                  downloadLeg(
                    WAREHOUSE_CUSTOMER_LEG,
                    format,
                    wcRows.map(r => ({ fromLabel: r.warehouseLabel, toLabel: r.customerLabel, distance: r.distance, flow: r.flow, band: r.band })),
                  )
                }
              />
            ),
            downloadAlign: "right",
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
Expected (provisional): PASS — real-tree dry run `JadeFlowsTab.test.tsx` 48 (P3.5's count − 1 deleted + 6 added), `CostSummaryTab.test.tsx` 77, `compareCsv.test.ts` 5; the CostSummary files prove Bundle 1's other `clientCsv` consumers are unaffected.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'warehouse-to-customer-flows\|button-download-jade-flows-wc\|jade-flows-wc-page-indicator\|button-jade-flows-wc-\|button-filter-jade-flows-wc' artifacts/studio/e2e/` → no hits.
2. Matrix §3 "JadeFlows W→C": `jade-ch9-workspace-bundle.spec.ts` (click `button-jade-flows-inner-warehouse-customer`; `jade-flows-wc-table` visible — its wrapper loses `hidden`; `thead th` == `["Warehouse","Customer","Distance","Flows","Distance Band"]`). No rewrite.
3. Insert (the real-browser proof of Deviation 3's `hidden` wrapper and of the filter popover closing on a leg switch; all 100 rows in the files although the screen pages at 50):

```bash
imp() { grep -q 'helpers/download' "$1" || python3 $H/insert-after.py "$1" '} from "./fixtures";' 'import { csvDataLines, downloadVia } from "./helpers/download";'; }
imp e2e/jade-ch9-workspace-bundle.spec.ts
python3 $H/insert-after.py e2e/jade-ch9-workspace-bundle.spec.ts 'expect(wcHeaders).toEqual(["Warehouse", "Customer", "Distance", "Flows", "Distance Band"]);' '// SCU-2.P3.6 — W→C (one row per customer, 100) pages at 50 while the download
// carries all 100; the P→W leg stays mounted but HIDDEN (real-browser proof of
// the `hidden` wrapper); an open filter does not survive a leg switch.
await expect(page.getByTestId("jade-flows-wc-page-indicator")).toHaveText("Page 1 of 2");
await expect(page.getByTestId("jade-flows-pw-table")).toBeHidden();
await expect(page.getByTestId("text-jadeflows-wc-count")).toHaveText("100 of 100");
const wcCsv = await downloadVia(page, "button-download-jade-flows-wc", "button-download-jade-flows-wc-csv");
expect(wcCsv.name).toBe("jade-flows-warehouse-customer.csv");
expect(wcCsv.text.split("\n")[0]).toBe("Warehouse,Customer,Distance (mi),Flows,Distance Band");
expect(csvDataLines(wcCsv.text)).toHaveLength(100);
const wcJson = JSON.parse((await downloadVia(page, "button-download-jade-flows-wc", "button-download-jade-flows-wc-json")).text);
expect([wcJson.entity, wcJson.unit, wcJson.rows.length]).toEqual(["jadeFlowsWarehouseCustomer", "mi", 100]);
await page.getByTestId("button-filter-jade-flows-wc").click();
await expect(page.getByTestId("filter-menu-popover")).toBeVisible();
await page.getByTestId("button-jade-flows-inner-plant-warehouse").click();
await expect(page.getByTestId("filter-menu-popover")).toHaveCount(0);
await expect(page.getByTestId("button-jade-flows-inner-plant-warehouse")).toBeFocused();
await page.getByTestId("button-jade-flows-inner-warehouse-customer").click();'
```

4. Local run, ports 3106/5206: `E2E_BASE_URL=http://localhost:5206 pnpm exec playwright test e2e/jade-ch9-workspace-bundle.spec.ts e2e/jade-two-echelon.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.6 — JADE Flows Warehouse → Customer on DataTable + on-screen export

- W→C renders through `DataTable` (root `jade-flows-wc-table`, count, cell testids, "Flows" header/label, band filter + reset kept), mounted alongside P→W (`hidden` when inactive; real-browser `toBeHidden` check added) with its own trigger `button-filter-jade-flows-wc`; pager above 50 (JADE: 100 customers → 2 pages). Download ▾ (right-aligned) CSV/JSON = exactly the on-screen table (one row per customer, header `Flows` kept) as `jade-flows-warehouse-customer.{csv,json}`, behind the same export guard. `downloadClientCsv` deleted (no callers).
- Vitest procs: <0>. Baseline: <N>. Deviations 1, 2, 3, 6, 9, 10, 11, 12. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/JadeFlowsTab.tsx artifacts/studio/src/lib/clientCsv.ts artifacts/studio/src/__tests__/JadeFlowsTab.test.tsx artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.6] move JADE Flows warehouse-to-customer onto DataTable with on-screen export" -m "Deviations 1, 2, 3, 6 (download = on-screen table), 9, 10, 11 (downloadClientCsv removed), 12." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.7: Solution Summary (single scenario) on DataTable (B2.1, B2.2, B2.4)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (server `costSummary`), B1.3 (bar kept), B2.10. **Matrix:** §2a "CostSummary single", §3, G2 (header testid), G3 (`cost-summary-list` on the `<table>`), API-gap 10/12 (transposed rows; `FloorExceedsMaxAlert` above the table). **Deviations:** 1, 4, 5, 10, 13. **Depends on:** P3.1.

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx`; `artifacts/studio/src/components/data-table/DataTable.tsx` (one line: no filterable column → no filter menu — see Deviation 13)
- Test: `artifacts/studio/src/__tests__/CostSummaryTab.test.tsx`, `Workspace.TabCoverage.test.tsx`, `artifacts/studio/src/__tests__/DataTable.test.tsx` (one appended describe)
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

  it("no 'Solution Summary' title (B1.3 kept) and no filter menu", () => {
    wrap(<CostSummaryTab result={result} scenarioId={1} />);
    expect(screen.queryByText(/Solution Summary/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
  });

  it("JADE: inbound/outbound + the four rate rows keep their literal testids; 11 metric rows still get NO filter menu (spec B2.2 exception)", () => {
    const jade = scenario({ id: 1, name: "JADE", modelId: "two-echelon-jade-us", result: { ...result, metrics: { weightedAvgDistance: 300, inboundCost: 5, outboundCost: 7 } } });
    renderTab({ scenarios: [jade], modelId: "two-echelon-jade-us" });
    const table = screen.getByTestId("cost-summary-list");
    for (const id of ["cost-summary-value-inbound-cost", "cost-summary-value-outbound-cost", "cost-summary-rate-ic", "cost-summary-min-ic", "cost-summary-rate-ob", "cost-summary-min-ob"]) {
      expect(table).toContainElement(screen.getByTestId(id));
    }
    expect(table.querySelectorAll("tbody tr")).toHaveLength(11);
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
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

Append at EOF of `DataTable.test.tsx` (Deviation 13):

```tsx

// SCU-2.P3.7 (spec B2.2 exception) — a table with no filterable column renders
// no filter menu, whatever its row count (the Solution Summary metric tables).
describe("DataTable — no filterable column (SCU-2.P3.7)", () => {
  it("renders no filter trigger above 10 rows when every column is filter: false", () => {
    render(
      <DataTable<Row>
        rows={makeRows(12)}
        rowKey={r => r.id}
        columns={[{ id: "city", header: "City", kind: "text", value: r => r.city, cell: r => r.city, filter: false }]}
        ctx={{ readOnly: true, demandEditable: false }}
      />,
    );
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/CostSummaryTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx src/__tests__/DataTable.test.tsx`
Expected (provisional): FAIL — `Unable to find an element by: [data-testid="button-download-cost-summary"]`; the new DataTable test (the shell renders a filter menu with zero descriptors above 10 rows today); the font-mono test (`querySelector(".font-mono")` is null: the class is on the `<td>` today); `cost-summary-single-column` lacks `text-center`; the JADE 11-row test still passes the no-filter assertion only if the metric column is unfilterable (a derived select would appear today once rows > 10 — the test proves `filter: false`).

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
// literal testid (explicit override, else the slug of the label). No column
// is filterable, so the shell never shows a filter menu here (spec B2.2).
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
      kind: "text",
      // Metric tables are never filtered (user decision 2026-10-17, spec B2.2 exception).
      filter: false,
      cellClassName: "text-muted-foreground",
      value: r => r.label,
      cell: r => r.label,
    },
    {
      id: "value",
      header: ownName,
      headerTestId: "cost-summary-single-column",
      // Numbers are centred (B2.1); never filtered (spec B2.2 exception).
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

(f) In `artifacts/studio/src/components/data-table/DataTable.tsx` (Deviation 13), replace

```tsx
  const showFilter = rows.length > FILTER_ROW_THRESHOLD;
```

with

```tsx
  // SCU-2.P3.7 (spec B2.2 exception) — no filterable column, no filter menu.
  const showFilter = rows.length > FILTER_ROW_THRESHOLD && descriptors.length > 0;
```

- [ ] **Step 5: Run them to verify they pass**

Run: the Step 3 command, then `pnpm --filter studio exec vitest run src/__tests__/Workspace.test.tsx src/__tests__/compareCsv.test.ts`.
Expected (provisional): PASS — real-tree dry run `CostSummaryTab.test.tsx` 83 (baseline 77 + 6), `compareCsv.test.ts` 5, TabCoverage 9, `DataTable.test.tsx` 36 (P1's 35 + 1). Bundle 1's compare tests still click the compare-mode `button-download-cost-summary-csv` button directly and pass.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-cost-summary' artifacts/studio/e2e/` → no hits.
2. Matrix §3 "CostSummary single" (44 lines / 10 files) — every needle is a preserved testid: `cost-summary-list` (`jade-two-echelon.spec.ts`), `cost-summary-value-{objective,weighted-avg-distance,avg-distance-to-customers,quality}`, `cost-summary-{rate,min}-{ic,ob}`, `cost-summary-{max-coverable-demand,coverage-pct,high-service-cutoff}`, and the picker lines Bundle 1 already routed through `button-toggle-compare`. `toContainText` reads the `<td>`, which now wraps a mono `<span>` — text is unchanged. No rewrite.
3. Insert (no filter menu even at 11 rows; real downloads; costSummary family has `unit`):

```bash
imp() { grep -q 'helpers/download' "$1" || python3 $H/insert-after.py "$1" '} from "./fixtures";' 'import { csvDataLines, downloadVia } from "./helpers/download";'; }
imp e2e/jade-two-echelon.spec.ts
python3 $H/insert-after.py e2e/jade-two-echelon.spec.ts 'await expect(page.getByTestId("cost-summary-list")).toBeVisible({ timeout: HEADER_TIMEOUT });' '// SCU-2.P3.7 — the metric table never gets a filter (spec B2.2 exception), even
// at 11 rows; Download ▾ exports the server costSummary (one row, with unit).
await expect(page.getByTestId("button-filter-menu-trigger")).toHaveCount(0);
const csCsv = await downloadVia(page, "button-download-cost-summary", "button-download-cost-summary-csv");
expect(csCsv.name).toBe("costSummary.csv");
expect(csvDataLines(csCsv.text)).toHaveLength(1);
const csJson = JSON.parse((await downloadVia(page, "button-download-cost-summary", "button-download-cost-summary-json")).text);
expect([csJson.entity, csJson.unit, csJson.rows.length]).toEqual(["costSummary", "mi", 1]);
expect(typeof csJson.templateVersion).toBe("number");'
```

4. Local run, ports 3107/5207: `E2E_BASE_URL=http://localhost:5207 pnpm exec playwright test e2e/jade-two-echelon.spec.ts e2e/jade-transport-costs.spec.ts e2e/max-coverage.spec.ts e2e/max-coverage-objective.spec.ts e2e/delivery-teaching.spec.ts e2e/chen-bands-units-qa.spec.ts e2e/truthful-status.spec.ts`. Expected: pass (`chen-bands-units-qa.spec.ts` is the suite's most load-sensitive file — judge failures by test name against the flake registry).

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.7 — Solution Summary (single) on DataTable

- The single-scenario summary renders through `DataTable` (`cost-summary-list` on the `<table>`, `cost-summary-single-column` on the value `<th>`, every `cost-summary-value-*` and explicit override testid on its `<td>`); value column centred; no column filterable (user decision B, spec B2.2 exception), so even the 11-row JADE summary has no filter menu — which needed the one-line shell fix of Deviation 13 (`DataTable.tsx`: no descriptors → no menu). Per-row monospace moved into a `<span>`. The B1.3 bar's Download is now Download ▾ CSV/JSON (server `costSummary`).
- Vitest procs: <0>. Baseline: <N>. Deviations 1, 4, 5, 10. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/components/data-table/DataTable.tsx artifacts/studio/src/__tests__/CostSummaryTab.test.tsx artifacts/studio/src/__tests__/DataTable.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/e2e/jade-two-echelon.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.7] move the single-scenario Solution Summary onto DataTable" -m "Deviations 1, 4 (transposed metric table: value column centred, never filtered), 5 (per-row mono span), 10, 13 (DataTable: no filterable column, no filter menu)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
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
python3 $H/scoped-replace.py $T "compare CSV: band rows are omitted" 'fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));' 'chooseDownload("button-download-cost-summary", "button-download-cost-summary-csv");'
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

  it("JADE compare: inbound/outbound and the four rate rows keep their per-scenario testids; no filter menu", () => {
    const j = (id: number, name: string) =>
      scenario({ id, name, modelId: "two-echelon-jade-us", result: { ...result, metrics: { weightedAvgDistance: 300, inboundCost: id, outboundCost: id * 2 } } });
    renderTab({ scenarios: [j(1, "A"), j(2, "B")], modelId: "two-echelon-jade-us" });
    fireEvent.click(screen.getByTestId("button-toggle-compare"));
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    for (const key of ["inbound", "outbound", "rate-ic", "min-ic", "rate-ob", "min-ob"]) {
      for (const id of [1, 2]) expect(screen.getByTestId(`cost-summary-compare-${key}-${id}`).tagName).toBe("TD");
    }
    // > 10 metric rows, still never a filter menu (spec B2.2 exception, user decision 2026-10-17)
    expect(screen.getByTestId("cost-summary-compare-table").querySelectorAll("tbody tr").length).toBeGreaterThan(10);
    expect(screen.queryByTestId("button-filter-menu-trigger")).toBeNull();
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

In `artifacts/studio/src/__tests__/compareCsv.test.ts`, change the one import `import { buildCompareCsv } from "@/lib/compareCsv";` to `import { buildCompareCsv, buildCompareJson } from "@/lib/compareCsv";` (no second import line is added) and append at EOF:

```ts
// SCU-2.P3.8 (spec B2.4) — the compare JSON: same row model as the CSV.

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

describe("buildCompareJson — rows the CSV omits", () => {
  it("drops a csvLabel: null row exactly as buildCompareCsv does", () => {
    const doc = buildCompareJson([{ csvLabel: null, cells: [{ raw: 1 }] }, { csvLabel: "Objective", cells: [{ raw: 2 }] }], [{ id: 1, name: "A" }], "mi");
    expect(doc.rows.map(r => r.metric)).toEqual(["Objective"]);
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
// the CSV, as `{ entity, unit?, rows }`. One row per metric the CSV exports
// (a `csvLabel: null` row is omitted from both); `values` holds one entry per
// compared scenario in on-screen order, keyed by id (scenario names are not
// unique). `unit` is the active display unit (omitted while unresolved).
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
    rows: rows.flatMap(r => (r.csvLabel == null ? [] : [{
      metric: r.csvLabel,
      values: scenarios.map((s, i) => ({ scenarioId: s.id, scenario: s.name, value: r.cells[i].raw })),
    }])),
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
// centred numbers; no column is filterable (spec B2.2 exception — metric
// tables never get a filter menu, user decision 2026-10-17).
function compareColumns(scenarios: Array<{ id: number; name: string }>): ColumnDef<CompareRow>[] {
  return [
    {
      id: "metric",
      header: "",
      kind: "text",
      filter: false,
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
Expected (provisional): PASS — real-tree dry run `CostSummaryTab.test.tsx` 90 (P3.7's + 7), `compareCsv.test.ts` 8 (+ 3). Bundle 1's contract test ("compare CSV rows are the compare table's rows, in order, with identical text cells") passes unchanged apart from opening the menu: the DataTable renders exactly `compareRows`, label first.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'cost-summary-compare.json\|button-download-cost-summary' artifacts/studio/e2e/` → only the P3.7 line (`jade-two-echelon.spec.ts`).
2. Matrix §3 "CostSummary compare" (17 lines / 4 files): `bundle6-ui-tweaks.spec.ts` (table wrapper; open-facilities cell), `two-echelon.spec.ts` (wrapper; **structural** `tr:has([data-testid^="cost-summary-compare-open-facilities-cities-"])` — label and cells stay in one `<tr>`, pinned by the unit test "each metric label and its scenario cells share one <tr>"), `workspace-ux-r1-r9.spec.ts` (wrapper; `cost-summary-compare-column-{id}` on the `<th>`; open-facilities, distance, objective cells), `jade-transport-costs.spec.ts` (`cost-summary-compare-{rate,min}-{ic,ob}-{id}`). No rewrite.
3. Insert (no filter on the metric table; real compare downloads whose row count equals the table's and whose JSON columns follow the on-screen selection order):

```bash
imp() { grep -q 'helpers/download' "$1" || python3 $H/insert-after.py "$1" '} from "./fixtures";' 'import { csvDataLines, downloadVia } from "./helpers/download";'; }
imp e2e/workspace-ux-r1-r9.spec.ts
python3 $H/insert-after.py e2e/workspace-ux-r1-r9.spec.ts 'await expect(page.getByTestId(`cost-summary-compare-distance-${id2}`)).toBeVisible();' '// SCU-2.P3.8 — compare Download ▾: CSV + JSON are the compare table'"'"'s rows, in
// on-screen column order; never a filter on the metric table.
await expect(page.getByTestId("button-filter-menu-trigger")).toHaveCount(0);
const cmpRows = await page.locator('"'"'[data-testid="cost-summary-compare-table"] tbody tr'"'"').count();
const cmpCsv = await downloadVia(page, "button-download-cost-summary", "button-download-cost-summary-csv");
expect(cmpCsv.name).toBe("cost-summary-compare.csv");
expect(cmpCsv.text.split("\n")[0].startsWith("metric,")).toBe(true);
expect(csvDataLines(cmpCsv.text)).toHaveLength(cmpRows);
const cmpJson = JSON.parse((await downloadVia(page, "button-download-cost-summary", "button-download-cost-summary-json")).text);
expect(cmpJson.entity).toBe("costSummaryCompare");
expect(cmpJson.rows).toHaveLength(cmpRows);
expect(cmpJson.rows[0].values.map((v: { scenarioId: number }) => v.scenarioId)).toEqual([Number(id), Number(id2)]);'
```

4. Local run, ports 3108/5208: `E2E_BASE_URL=http://localhost:5208 pnpm exec playwright test e2e/workspace-ux-r1-r9.spec.ts e2e/two-echelon.spec.ts e2e/bundle6-ui-tweaks.spec.ts e2e/jade-transport-costs.spec.ts`. Expected: pass.

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.8 — Solution Summary compare on DataTable + compare JSON

- The compare table renders through `DataTable` from Bundle 1's `compareRows` (one value column per compared scenario, `cost-summary-compare-column-{id}` on its `<th>`, every `cost-summary-compare-*-{id}` cell testid, label + cells in one `<tr>`, bands note in the shell footer inside `cost-summary-compare-table`). Download ▾ in the bar: CSV = `buildCompareCsv` (unchanged), JSON = `buildCompareJson` (`{ entity: "costSummaryCompare", unit?, rows: [{ metric, values: [{ scenarioId, scenario, value }] }] }`), both from the same row model, all rows. `CompareRow` carries `mono`/`labelMono` instead of padding-bearing classes.
- Vitest procs: <0>. Baseline: <N>. Deviations 1, 4, 5, 7, 10. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/lib/compareCsv.ts artifacts/studio/src/__tests__/CostSummaryTab.test.tsx artifacts/studio/src/__tests__/compareCsv.test.ts artifacts/studio/e2e/workspace-ux-r1-r9.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.8] move the Solution Summary compare table onto DataTable and add compare JSON" -m "Deviations 1, 4, 5 (CompareRow mono flags), 7 (compare JSON row shape), 10." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task SCU-2.P3.9: Service Stats Plant Production on DataTable + tab-level Download ▾ + km band-label rounding (B2.1, B2.2, B2.4, B1.9 display)

**Owner role:** frontend-engineer. **Spec:** B2.1, B2.2, B2.4 (server `serviceStats`), B2.10 ("Excluded: ServiceStats band bars"). **Matrix:** §1 row 9, §2a "ServiceStats Plant Production" (incl. the four tab-level testids kept **outside** the DataTable), §3, §5.5 (Remaining filter). **Deviations:** 1, 9, 10, 14 (km band-label rounding, user decision). **Depends on:** P3.8 (the band-label helper's callers include the compare band rows P3.8 leaves in place).

**Files:**
- Modify: `artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx`
- Modify (Deviation 14): `artifacts/studio/src/lib/bands.ts` (`exclusiveBandLabels`), its two other callers `artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx` (compare band rows) and `artifacts/studio/src/lib/resultNarrative.ts` (`bandSentence`)
- Test: `artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx`, `Workspace.TabCoverage.test.tsx`, `exclusiveBands.test.ts`, `resultNarrative.test.ts`
- e2e: `artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts`, `artifacts/studio/e2e/chen-bands-units-qa.spec.ts` (km label)
- Modify: `docs/CHANGELOG-implementation.md`

**Interfaces:**
- Consumes: `buildPlantProductionRows`, `renderPlantCell` (unchanged); P1 `DataTable`, `ColumnDef`; `DownloadMenu`.
- Produces: module-private `plantProductionColumns(identityById, upgrade)`; the testid map row "ServiceStats Plant Production" above. The band rows (Bundle 1 SCU-1.2) are not a table; only their label text changes (Deviation 14).
- Changes (Deviation 14): `exclusiveBandLabels(boundaries: number[], toDisplay: (canonical: number) => number, unit: string): string[]` — was `format: (canonical: number) => string` (Bundle 1, `lib/bands.ts:153` at `aa7141a`); every boundary now prints through the existing `formatDistanceDisplay` (`lib/formatDistanceDisplay.ts:17`, ≤ 2 dp, grouped). Callers at `aa7141a`: `ServiceStatsTab.tsx:323-329`, `CostSummaryTab.tsx:736-740`, `resultNarrative.ts:96-98` — each passed its own `toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false })` formatter.

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

Km band-label rounding (Deviation 14) — rewrite the label expectations that change and add the km/mi tests (from `artifacts/studio`):

```bash
# SCU-2.P3.9 — km band-label rounding: band labels now print through formatDistanceDisplay
# (≤ 2 dp, thousands-grouped). Rewrite the label expectations that change (run from artifacts/studio).
set -e
# narrative band sentences: group 4-digit boundaries ("800–1,600 mi", "> 1,600 mi")
perl -pi -e 'if (/by distance band/) { s/(?<![\d,.])(\d)(\d{3})(?= mi\b|–)/$1,$2/g }' src/__tests__/resultNarrative.test.ts
grep -c '1,600 mi' src/__tests__/resultNarrative.test.ts
# Service Stats label assertions (overflow / range rows); 4-dp converted labels round to 2 dp
perl -pi -e 'if (/toHaveTextContent\("|toEqual\(\["/) { s/(?<![\d,.])(\d)(\d{3})(?= mi\b|–)/$1,$2/g; s/372\.8227 mi/372.82 mi/g }' src/__tests__/ServiceStatsTab.test.tsx
grep -c '372.82 mi' src/__tests__/ServiceStatsTab.test.tsx
cat > $H/p39-labels-block.ts <<'BLOCK'
describe("exclusiveBandLabels", () => {
  const same = (v: number) => v;

  it("labels each exclusive row with its range and the overflow row with '>' (en dash, unit-aware, grouped)", () => {
    expect(exclusiveBandLabels([200, 400, 800, 1600], same, "mi")).toEqual([
      "0–200 mi", "200–400 mi", "400–800 mi", "800–1,600 mi", "> 1,600 mi",
    ]);
  });

  it("sorts boundaries", () => {
    expect(exclusiveBandLabels([400, 200], same, "mi")).toEqual(["0–200 mi", "200–400 mi", "> 400 mi"]);
  });

  // SCU-2.P3.9 (user decision 2026-10-17) — converted boundaries print through
  // formatDistanceDisplay (≤ 2 dp): no "0–321.8688 km".
  it("rounds converted km boundaries to at most 2 dp (formatDistanceDisplay)", () => {
    expect(exclusiveBandLabels([200, 400], v => v * 1.609344, "km")).toEqual(["0–321.87 km", "321.87–643.74 km", "> 643.74 km"]);
  });

  it("rounds converted mi boundaries the same way", () => {
    expect(exclusiveBandLabels([600], v => v / 1.609344, "mi")).toEqual(["0–372.82 mi", "> 372.82 mi"]);
  });

  it("no boundaries -> no labels", () => {
    expect(exclusiveBandLabels([], same, "mi")).toEqual([]);
  });
});
BLOCK
python3 $H/delete-block.py src/__tests__/exclusiveBands.test.ts describe 'exclusiveBandLabels' --replace-with $H/p39-labels-block.ts
```

Append at EOF of `ServiceStatsTab.test.tsx`:

```tsx

// SCU-2.P3.9 (user decision 2026-10-17) — band labels round like every other
// displayed distance (formatDistanceDisplay, ≤ 2 dp): a mi-canonical model
// shown in km reads "0–321.87 km", never "0–321.8688 km"; mi stays exact.
describe("ServiceStatsTab — band labels round in km and mi (SCU-2.P3.9)", () => {
  const banded = { ...result, metrics: { bandCoverage: [{ band: 200, percent: 30 }, { band: 400, percent: 45 }] } };

  it("km display: converted boundaries print at most 2 dp", () => {
    window.localStorage.setItem(STORAGE_KEY, "km");
    render(<ServiceStatsTab result={banded} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("0–321.87 km");
    expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("321.87–643.74 km");
    expect(screen.getByTestId("service-stats-band--1")).toHaveTextContent("> 643.74 km");
    expect(screen.getByTestId("service-stats-band-200")).not.toHaveTextContent("321.8688");
  });

  it("mi display: whole-number boundaries are unchanged", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    render(<ServiceStatsTab result={banded} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("0–200 mi");
    expect(screen.getByTestId("service-stats-band--1")).toHaveTextContent("> 400 mi");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter studio exec vitest run src/__tests__/ServiceStatsTab.test.tsx src/__tests__/Workspace.TabCoverage.test.tsx src/__tests__/exclusiveBands.test.ts src/__tests__/resultNarrative.test.ts`
Expected (provisional): FAIL — `Unable to find an element by: [data-testid="button-download-service-stats"]`; the thead test fails on `text-center`; `input-filter-remaining-min` not found; the label tests now expect `0–321.87 km` / `800–1,600 mi` / `0–372.82 mi` and receive `0–321.8688 km` / `800–1600 mi` / `0–372.8227 mi`.

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

**Km band-label rounding (Deviation 14).** In `artifacts/studio/src/lib/bands.ts`, add `import { formatDistanceDisplay } from "@/lib/formatDistanceDisplay";` above the file's first `import`, and replace the `exclusiveBandLabels` function together with its leading `// SCU-1.1 (spec B1.9 "Display")` comment with:

```ts
// SCU-1.1 (spec B1.9 "Display") — one label per exclusive row, aligned with
// computeExclusiveBandCoverage / frozenBandCoverageToExclusive output:
// "0–200 mi", "200–400 mi", …, "> 1,600 mi". `toDisplay` converts a CANONICAL
// boundary to the display unit (the caller's useDisplayUnit); `unit` is the
// display unit label.
// SCU-2.P3.9 (user decision 2026-10-17) — every boundary is printed with the
// app's one distance display formatter, `formatDistanceDisplay` (≤ 2 dp,
// thousands-grouped), so a converted km boundary reads "0–321.87 km", never
// "0–321.8688 km". Formatting lives HERE, once, for Service Stats, the Compare
// band rows and the Output Map narrative alike.
export function exclusiveBandLabels(boundaries: number[], toDisplay: (canonical: number) => number, unit: string): string[] {
  const sorted = [...boundaries].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const fmt = (canonical: number) => formatDistanceDisplay(toDisplay(canonical));
  const labels = sorted.map((b, i) => `${i === 0 ? "0" : fmt(sorted[i - 1])}–${fmt(b)} ${unit}`);
  labels.push(`> ${fmt(sorted[sorted.length - 1])} ${unit}`);
  return labels;
}
```

Then update its three callers (each drops its own 4-dp formatter):

- `ServiceStatsTab.tsx`: delete the two lines `const fmt = (v: number) =>` / `toDisplay(v, canonicalUnit).toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false });` and pass `v => toDisplay(v, canonicalUnit),` where `fmt,` was the second argument of `exclusiveBandLabels(`.
- `CostSummaryTab.tsx` (compare band rows): delete the two lines `const fmt = (v: number) =>` / `unit.toDisplay(v, canonicalDistanceUnit!).toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false });` and change `: exclusiveBandLabels(boundaries, fmt, unitLabel);` to `: exclusiveBandLabels(boundaries, v => unit.toDisplay(v, canonicalDistanceUnit!), unitLabel);`.
- `resultNarrative.ts` (`bandSentence`): delete `const fmt = (v: number) => d.toDisplay(v).toLocaleString(undefined, { maximumFractionDigits: 4, useGrouping: false });` and change `exclusiveBandLabels(rows.slice(0, -1).map(r => r.band), fmt, d.unit)` to `exclusiveBandLabels(rows.slice(0, -1).map(r => r.band), d.toDisplay, d.unit)`.

Verify: `grep -rn 'maximumFractionDigits: 4, useGrouping: false' artifacts/studio/src` → no hits (those three were the only ones at `aa7141a`).

- [ ] **Step 5: Run them to verify they pass**

Run: the Step 3 command, then `pnpm --filter studio exec vitest run src/__tests__/CostSummaryTab.test.tsx src/__tests__/OutputMapTab.test.tsx`. Expected (provisional): PASS — real-tree dry run `ServiceStatsTab.test.tsx` 55 (baseline + 5 Plant Production + 2 km/mi label tests), TabCoverage 9, `exclusiveBands.test.ts` 7, `resultNarrative.test.ts` 14; every pre-existing Plant Production test (16 rows, filter trigger, `text-filter-count` "16 of 16", per-row values, `identityById` upgrade) passes unchanged.

- [ ] **Step 6: e2e sweep**

1. `grep -rn 'button-download-service-stats\|plant-production-pager\|plant-production-page-indicator\|button-plant-production-' artifacts/studio/e2e/` → no hits.
2. Km labels: `grep -rn '[0-9]\{4\} mi\|[0-9]\{4\} km\|\.[0-9]\{3,\} km' artifacts/studio/e2e/*.spec.ts` — at `aa7141a` only comments name 4-digit band boundaries (`delivery-teaching.spec.ts`, `chen-bands-units-qa.spec.ts`); no assertion reads a grouped/ungrouped boundary, so none breaks. The band-row e2e assert percentages or `"mi"` only (`delivery-teaching.spec.ts:213,227`, `nonjade-servicestats-live-coverage.spec.ts:244,360,443`, `bundle2-fastfollow.spec.ts:312`, `workspace-ux-r1-r9.spec.ts:220`).
3. Matrix §3 "ServiceStats Plant Production" (8 lines, `jade-ch9-workspace-bundle.spec.ts`): section visible; `[data-testid="plant-production-section"] thead th` == the five headers (the wrapper holds the toolbar + table); `row-plant-production-` count 16 / 4 / 16; `row-plant-production-plant-1-product-2`; section-scoped `button-filter-menu-trigger`; `text-filter-count` "16 of 16" / "4 of 16"; `checkbox-filter-plant-plant-1 — Ashland, KY` (column id `plant`, value = the `plantIdCityState` label); `button-clear-all-filters`. No rewrite. The band rows' e2e (`service-stats-band-*`, Bundle 1) are untouched by this task.
4. Insert (real tab-level downloads; serviceStats family has `unit`; no pager at 16 rows; and a km band label rounded to ≤ 2 dp in `chen-bands-units-qa.spec.ts`, right after its overflow-row check):

```bash
imp() { grep -q 'helpers/download' "$1" || python3 $H/insert-after.py "$1" '} from "./fixtures";' 'import { csvDataLines, downloadVia } from "./helpers/download";'; }
imp e2e/jade-ch9-workspace-bundle.spec.ts
python3 $H/insert-after.py e2e/jade-ch9-workspace-bundle.spec.ts 'expect(plantProdHeaders).toEqual(["Plant", "Product", "Actual production", "Enabled capacity", "Remaining capacity"]);' '// SCU-2.P3.9 — tab-level Download ▾ (outside the Plant Production DataTable):
// CSV and JSON carry the same rows; no pager at 16 rows.
const ssCsv = await downloadVia(page, "button-download-service-stats", "button-download-service-stats-csv");
expect(ssCsv.name).toBe("serviceStats.csv");
const ssJson = JSON.parse((await downloadVia(page, "button-download-service-stats", "button-download-service-stats-json")).text);
expect([ssJson.entity, ssJson.unit]).toEqual(["serviceStats", "mi"]);
expect(ssJson.rows.length).toBeGreaterThan(0);
expect(ssJson.rows).toHaveLength(csvDataLines(ssCsv.text).length);
await expect(page.getByTestId("plant-production-page-indicator")).toHaveCount(0);'
python3 $H/insert-after.py e2e/chen-bands-units-qa.spec.ts 'expect(overflowLabel).not.toMatch(/-\d/); // no negative distance ever rendered' '// SCU-2.P3.9 (user decision 2026-10-17) — km band labels round like every other
// displayed distance (formatDistanceDisplay, at most 2 dp): never "1086.8688 km".
await page.getByTestId("unit-toggle-km").click();
await expect(overflowRow).toContainText(" km", { timeout: HEADER_TIMEOUT });
expect((await overflowRow.innerText()).trim()).toMatch(/^> [\d,]+(\.\d{1,2})? km/);
await page.getByTestId("unit-toggle-auto").click();'
```

5. Local run, ports 3109/5209: `E2E_BASE_URL=http://localhost:5209 pnpm exec playwright test e2e/jade-ch9-workspace-bundle.spec.ts e2e/chen-bands-units-qa.spec.ts e2e/nonjade-servicestats-live-coverage.spec.ts e2e/delivery-teaching.spec.ts e2e/bundle2-fastfollow.spec.ts e2e/workspace-ux-r1-r9.spec.ts`. Expected: pass (`chen-bands-units-qa.spec.ts` is load-sensitive — judge failures by test name against the flake registry).

- [ ] **Step 7: Gate**

As P3.1 Step 8.

- [ ] **Step 8: Changelog**

```markdown

### SCU-2.P3.9 — Plant Production on DataTable + Service Stats Download ▾ + km band labels

- JADE Plant Production renders through `DataTable` inside `plant-production-section` (title in `toolbar.extra`, filter right; column ids = today's keys; number columns centred; gains a Remaining-capacity range filter, spec-derived). The tab-level Download is Download ▾ CSV/JSON (server `serviceStats`) and stays outside the DataTable, as do `service-stats-empty`, `-unit-pending`, `-no-bands` and the band rows.
- Band labels (Service Stats, Compare band rows, Output Map narrative) print through `formatDistanceDisplay` via `exclusiveBandLabels` (now `(boundaries, toDisplay, unit)`): km reads `0–321.87 km` (was `0–321.8688 km`); boundaries ≥ 1,000 gain a thousands separator (`> 1,600 mi`).
- Vitest procs: <0>. Baseline: <N>. Deviations 1, 9, 10, 14. Gate: <counts>. e2e: <specs + result>.
```

- [ ] **Step 9: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || exit 1
```

```bash
git commit artifacts/studio/src/components/workspace/tabs/ServiceStatsTab.tsx artifacts/studio/src/lib/bands.ts artifacts/studio/src/components/workspace/tabs/CostSummaryTab.tsx artifacts/studio/src/lib/resultNarrative.ts artifacts/studio/src/__tests__/ServiceStatsTab.test.tsx artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx artifacts/studio/src/__tests__/exclusiveBands.test.ts artifacts/studio/src/__tests__/resultNarrative.test.ts artifacts/studio/e2e/jade-ch9-workspace-bundle.spec.ts artifacts/studio/e2e/chen-bands-units-qa.spec.ts docs/CHANGELOG-implementation.md -m "[SCU-2.P3.9] move Plant Production onto DataTable, add Service Stats Download menu, round band labels" -m "Deviations 1, 9 (Remaining-capacity range filter added by derivation), 10, 14 (band labels via formatDistanceDisplay: km <= 2 dp)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
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

For each model, create/solve one scenario through the API (each run registers its own user, so nothing touches another session's rows) and open every output grid its manifest lists (matrix §2a table): p-median-us, p-median-brazil, max-coverage-us, delivery-teaching-us (OpenWarehouses, Customer Assignments, Solution Summary, Service Stats), transport-coal (Flows, Solution Summary, Service Stats), two-echelon-gold-au (OpenWarehouses, Flows, Customer Assignments, Solution Summary, Service Stats), two-echelon-jade-us (OpenWarehouses, JADE Customer Assignments, JADE Flows both legs, Solution Summary, Service Stats + Plant Production). On every table, check and record (`page.screenshot()` per model; downloads captured with `page.waitForEvent("download")` and read back from disk — `e2e/helpers/download.ts`'s `downloadVia`):
1. Header + number cells centred; text columns left; no fixed widths; header text exactly as the matrix §2a column list (and no `Solution Summary` / tab-name titles); **Download ▾ is the right-most toolbar control** (after the count and the filter trigger).
2. Filter trigger present iff > 10 rows — **never** on either Solution Summary table, whatever the row count (JADE single 11, JADE compare 11+); opening it lists the expected controls; one filter narrows rows and the count line.
3. Pager present iff > 50 filtered rows (p-median-us Customer Assignments "Page 1 of 4"; JADE Customer Assignments "Page 1 of 8"; JADE W→C "Page 1 of 2"); Next/Prev work; a filter change returns to page 1.
4. Download ▾ on every output: CSV and JSON each download a file, and each file is **complete** (row count = the table's total, not the page — e.g. 200, 400, 100). Server files `{entity}.csv` / `{entity}.json`, JSON per G-4: `openWarehouses` has a numeric `templateVersion` and **no** `unit`; `assignments`, `flows`, `serviceStats`, `costSummary` have a numeric `templateVersion` and `unit: "mi"` (km after the toggle). Client files: `jade-flows-plant-warehouse.{csv,json}` and `jade-flows-warehouse-customer.{csv,json}` have exactly the on-screen headers (Distance carrying the unit) and the on-screen rows, no product column; no `templateVersion`.
5. **Compare (Codex finding 5):** create two scenarios of the same model (p-median-us: P=3 and P=4; and once for JADE), solve both, open Solution Summary, open `button-toggle-compare`, select the second scenario; verify the compare table shows both `cost-summary-compare-column-{id}` headers in selection order and every metric row (objective, distance, open facilities, runtime, quality, band rows; JADE: inbound/outbound + 4 rate rows); download `cost-summary-compare.csv` and `.json` and check: CSV header `metric,<name1>,<name2>`, one CSV line per table row with the same leading label, raw numbers (no thousands separators), empty cells where the table shows "—"; JSON `entity: "costSummaryCompare"`, `unit`, one row per table row, `values[].scenarioId` in on-screen column order.
6. JADE Flows: apply a filter on W→C, switch to P→W and back — the W→C filter is still applied; the inactive leg is invisible; an open filter popover or Download ▾ closes on the switch, no menu stays on screen, focus is on the clicked leg control.
7. History browsing (stepper on an older run without a run id): every output Download ▾ — server and client-built (both JADE Flows legs) — is disabled with the existing reason tooltip; the tables stay read-only (no editable cells).
8. Unit toggle (mi ↔ km) on JADE and on gold-au Flows: distance cells, the Assignments/Flows Distance headers, the band filter options (and their reset) and every export's `unit` follow.

Record defects as findings with screenshots; a defect is fixed by the owning frontend-engineer task's author (new commit on this branch via a follow-up task), not silently patched here.

- [ ] **Step 4: Full e2e gate + non-vacuity of the P3 e2e assertions (Codex finding 6)**

From `artifacts/studio`, each alone:
1. `E2E_BASE_URL=http://localhost:5210 pnpm e2e:gate`
2. `E2E_BASE_URL=http://localhost:5210 pnpm e2e:quarantine` (for the record; never without `E2E_BASE_URL`)

Expected: pass; any failure matched by test **name** against `docs/superpowers/flake-registry.md` and re-run twice in isolation before being called real. Record pass/fail/flaky counts.

3. Prove the new e2e assertions can fail — two deliberate breaks, each followed by revert and a green re-run, results recorded:
   - **Control break:** in `components/data-table/DownloadMenu.tsx`, change `onDownload(format)` to `onDownload("csv")`. Run `E2E_BASE_URL=http://localhost:5210 pnpm exec playwright test e2e/max-coverage.spec.ts e2e/workspace-fixups-2.spec.ts`. Expected: FAIL at the JSON download (`expect(…name)` / `JSON.parse` of a CSV body). Revert (`git checkout -- <file>`), re-run, PASS.
   - **Export break:** in `lib/jadeFlowsExport.ts` `jadeFlowsCsv`, change `rows.map(…)` to `rows.slice(0, 1).map(…)`. Run `E2E_BASE_URL=http://localhost:5210 pnpm exec playwright test e2e/jade-ch9-workspace-bundle.spec.ts`. Expected: FAIL at `csvDataLines(wcCsv.text)).toHaveLength(100)`. Revert, re-run, PASS.
   `git status --short` must show both files unmodified afterwards.

- [ ] **Step 5: Unit gate**

As P3.1 Step 8 (each command alone, the vitest-concurrency check first, its output recorded).

- [ ] **Step 6: Changelog + commit**

Append `### SCU-2.P3.10 — P3 real-browser QA + e2e gate` with the per-model checklist results (incl. the compare and history items), screenshots' location (under `.harness/`, not committed), the `e2e:gate` and `e2e:quarantine` counts, the two non-vacuity results, any sibling-spec rewrites, and new flake sightings. Commit (branch-guarded, explicit pathspec: the changelog, any rewritten specs, the flake registry if touched) as `[SCU-2.P3.10] record P3 real-browser QA and e2e gate`, body ending with the Co-Authored-By line. Then dispatch the `fable` reviewer.

---

## Phase P3 exit (controller, after P3.10 is cherry-picked)

- [ ] `git log --oneline "$P2_TIP"..scnd-upgrades` shows exactly ten `[SCU-2.P3.N]` commits, N = 1…10, in order.
- [ ] `git diff --stat "$P2_TIP"..scnd-upgrades -- artifacts/api-server lib solvers` → empty (no server/contract/solver change); `git diff --name-only "$P2_TIP"..scnd-upgrades -- artifacts/api-server/src/solver/solve.py` → empty.
- [ ] `grep -rn 'useTableFilters\|FilterMenu\|PAGE_SIZE' artifacts/studio/src/components/workspace/tabs/{OpenWarehouses,Assignments,JadeAssignments,Flows,JadeFlows,CostSummary,ServiceStats}Tab.tsx` → comments only (every output table filters/pages through the shell).
- [ ] Re-run the full gate on the bundle tip (each command separately, the vitest-concurrency check first).
- [ ] Hand P4: `DownloadMenu` + `chooseDownload` + `e2e/helpers/download.ts` (inputs add the expected-fields panel on top, B2.3/B2.4), the edit helpers, the Download ▾ testid scheme (Deviation 1), and the placement rule: **input** toolbars keep the default left Download slot (`downloadAlign` omitted).
- [ ] No `/harness-retro`, merge, push or deploy: the branch finishes after P4 (root CLAUDE.md branch pipeline).

## Decisions folded (user, 2026-10-17) and Codex deep review (gpt-5.6-luna, xhigh)

- **A — Download ▾ on output tables stays right** → P1 `DataTableToolbar.downloadAlign?: "left" | "right"` (default `"left"`) + one P1 DataTable test, spec B2.1 line; every output adapter passes `"right"`; Bundle 1's SCU-1.4 right-aligned tests kept and retargeted (Deviation 2).
- **B — Solution Summary metric tables never filter** → `filter: false` on every column, tests assert no trigger at 11+ rows, spec B2.2 exception (Deviation 4).
- **C — JADE Flows downloads = exactly the on-screen table** → `lib/jadeFlowsExport.ts` rebuilt on the row model (same headers/rows, flow summed, no product), spec B2.4 amended (Deviation 6).
- **E — km band labels round** ("0–321.87 km", not "0–321.8688 km") via the existing `formatDistanceDisplay`, inside `exclusiveBandLabels`, in P3.9 — RTL km + mi label tests, e2e km label in `chen-bands-units-qa.spec.ts` (Deviation 14). Spec line to add (coordinator): B1.9 "Display".
- **Bundle 1 reconciled** against its real tip `aa7141a` (G-2); `B1_TIP=aa7141a` in Step L0; every count is from the real-tip dry run.
- **D — non-JADE Flows `distanceUnit`** fixed in P3.4 with RTL (TabCoverage + FlowsTab unit toggle) and e2e (`two-echelon.spec.ts`) (G-3).
- Codex 1 → every Step 1 records a real baseline; plan counts are labelled scratch-tree/provisional (Global Constraints, "Execution topology").
- Codex 2 → both JADE legs' Download ▾ use `disabledReasonFor("flows")` + the canonical-unit guard; RTL history-disabled tests (Deviation 12).
- Codex 3 → legs stay mounted; menus dismissed by Radix outside-interaction on a leg switch, focus not returned to the hidden trigger; RTL + browser tests (Deviation 3, P3.5/P3.6 e2e).
- Codex 4 → P3.8 adds no second `buildCompareJson` import.
- Codex 5 → P3.10 Step 3 item 5 (two same-model scenarios, compare rows, both compare files validated).
- Codex 6 → every output's e2e: menu, real `download` event, row completeness, paging/filter where present; non-JADE Flows e2e added (P3.4); P3.10 Step 4.3 proves the new e2e assertions fail on a broken control and a broken export.
- Codex 7 → `E2E_BASE_URL=… pnpm e2e:quarantine`; `DATABASE_URL` explicit on every command that needs it.
- Codex 8 → the vitest-concurrency check `… [ "$cnt" = "0" ] || exit 1`, unchained and recorded, before every trusted suite; an isolated DB is **not** required (overkill — reasoning in Global Constraints).
- Codex 9 → G-4 distinguishes the versioned server `ExportEnvelope` families from the client-built `{ entity, unit?, rows }`, with per-entity e2e assertions.
- Codex 10 → covered by D.

No open questions remain for P3.

## Self-review (run at plan time)

- **Spec coverage (rev 4 + the three amended lines).** B2.1 (adapter per table, literal testids, `ctx`, number centring, no fixed widths — the shell's; output Download right via `downloadAlign`) → every task. B2.2 filter > 10 rows on all models (P3.1 deletes the JADE-only opt-in; P3.2/P3.4 add filters where none existed) with the metric-table exception (P3.7/P3.8), pager > 50 (each task's pager literals + tests; `jadeassignments-page-indicator` kept, P3.3), descriptor ids = column ids, filter-type pins (Deviation 9). B2.4 server CSV + JSON for `openWarehouses` (P3.1), `assignments` (P3.2, P3.3), `flows` (P3.4), `costSummary` (P3.7), `serviceStats` (P3.9) — G-1: no server work; client-built JADE P→W (P3.5) and W→C (P3.6) = the on-screen table, compare (P3.8) = B1.3's row model; `{ entity, unit?, rows }`, the spec's file names, all rows. B2.10 one instance per commit (P3.1–P3.9). "Risks — e2e breakage": every task greps its literals, re-reads its matrix §3 lines, adds e2e for its new control with real downloads, and runs the specs locally with `E2E_BASE_URL`; P3.10 runs the sibling sweep, the real-browser pass (incl. compare and history), the full gate + quarantine and the non-vacuity breaks. "Behaviour changes users will notice" → Deviation 10, each task's changelog.
- **Placeholder scan.** The only `<…>` tokens are changelog values the task must measure (rule: measured or `unknown`), `B1_TIP`/`P2_TIP`/`BASE` (set by L0 / the topology commands) and the worktree index `N` in the topology template.
- **Type consistency with P1 (rev 4 `8f80d35` + `downloadAlign`).** Adapters use only `DataTable`, `ColumnDef` (`id`, `header`, `filterLabel`, `kind`, `cell`, `value`, `filter`, `cellTestId`, `headerTestId`, `cellClassName`, `filterResetKey`), `DataTableTestIds` (`root`, `table`, `count`, `row`, `pager`, `pagerPrev`, `pagerNext`, `pageIndicator`, `filterTrigger`), `DataTableToolbar` (`download`, `extra`, `downloadAlign`), `footer`, and the required `ctx`. Verified at plan time against byte-identical copies of the committed P1 files plus the `downloadAlign` edit exactly as folded into the P1 plan (`DataTable.test.tsx` 35 passing incl. the new test): every code block compiled with `tsc --noEmit` under `tsconfig.json` and `tsconfig.e2e.json` (exit 0). **The generated plan itself was then dry-run on the real Bundle 1 tip:** a script copied `artifacts/studio` + `lib/units` from `aa7141a` (plus the P1 shell), executed every task's Step 2 code blocks verbatim (create / append / `bash` edit blocks, helpers included), ran that task's tests (P3.1 21, P3.2 14, P3.3 7, P3.4 11, P3.5 14, P3.6 9, P3.7 16, P3.8 9, P3.9 28 failing before the implementation), applied the implementation, executed its e2e insert block, and re-ran (0 failing in every task; totals P3.1 66 passed, P3.2 36 passed, P3.3 33 passed, P3.4 36 passed, P3.5 47 passed, P3.6 134 passed, P3.7 133 passed, P3.8 107 passed, P3.9 135 passed). The final dry-run state type-checks under both configs, and its full studio suite passes 2521 of 2522: the one failure, `transportCostsBounds.test.ts`, reads `artifacts/api-server/src/solver/solve.py`, which the studio-only scratch tree does not contain.
- **What the dry run could not prove:** P2's effect (not applied — it touches no P3 file), the e2e behaviour (no servers were started at plan time — each task's local e2e step and P3.10 own that), and CSS (`hidden`, centring, right alignment) in a real browser — P3.6's `toBeHidden()`, the focus assertions and P3.10 cover those.
